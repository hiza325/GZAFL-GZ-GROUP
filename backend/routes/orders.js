'use strict';

const express = require('express');
const db = require('../db');
const { toOrder } = require('../lib/serialize');
const { generateOrderCode, parseOrderLink, MAX_ORDER_LINK_LENGTH } = require('../lib/validate');
const { requireAuth } = require('../lib/auth');
const { notify } = require('../lib/notify');
const { rateLimit } = require('../lib/rateLimit');
const affiliate = require('../lib/affiliate');

const router = express.Router();
router.use(requireAuth);

/**
 * URL công khai dùng để dựng link hoàn tiền / URL postback.
 *
 * Production BẮT BUỘC đặt PUBLIC_BASE_URL (server.js từ chối khởi động nếu thiếu):
 * Host header do client gửi nên không được tin — kẻ tấn công có thể khiến link
 * hoàn tiền trỏ sang tên miền giả. Chỉ dùng Host của request khi chạy thử.
 */
function resolvePublicBaseUrl(req) {
  const configured = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  return `${req.protocol}://${req.get('host')}`;
}

// Chống spam tạo đơn: 20 đơn / 10 phút cho mỗi tài khoản (mỗi đơn còn gọi API sàn).
const orderRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  name: 'orders-create',
  key: (req) => 'user:' + (req.user ? req.user.id : req.ip)
});

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC').all(req.user.id);
  return res.json({ orders: rows.map(toOrder) });
});

router.post('/', orderRateLimit, async (req, res, next) => {
  try {
    const raw = String((req.body && req.body.link) || '').trim();

    if (!raw) return res.status(400).json({ error: 'Vui lòng dán link sản phẩm trước khi tiếp tục.' });
    if (raw.length > MAX_ORDER_LINK_LENGTH) {
      return res.status(400).json({ error: 'Link quá dài. Vui lòng dán đúng link sản phẩm.' });
    }
    if (raw.includes('\n') || raw.split(/\s+/).filter(Boolean).length > 1) {
      return res.status(400).json({ error: 'Chỉ cho phép nhập đúng 1 link. Vui lòng không nhập nhiều link cùng lúc!' });
    }

    // Parse URL thật + kiểm tra tên miền: chặn javascript:, data:... và tên miền giả mạo
    const parsed = parseOrderLink(raw);
    if (!parsed) {
      return res.status(400).json({ error: 'Phát hiện link không hợp lệ! Vui lòng chỉ nhập link Shopee, TikTok, Tiki hoặc Lazada.' });
    }
    const link = parsed.url;
    const platform = parsed.platform;

    let code = null;
    for (let attempt = 0; attempt < 20; attempt++) {
      const candidate = generateOrderCode();
      if (!db.prepare('SELECT 1 AS x FROM orders WHERE code = ?').get(candidate)) {
        code = candidate;
        break;
      }
    }
    if (!code) return res.status(500).json({ error: 'Không tạo được mã đơn hàng.' });

    // sub_id là mấu chốt để biết hoa hồng phát sinh thuộc về ai (xem docs/affiliate-integration.md)
    const subId = affiliate.subIdFor(req.user.id);
    // Ưu tiên URL công khai cấu hình sẵn: sau reverse proxy, req.protocol có thể là
    // http nên link mock sẽ sai scheme nếu không bật TRUST_PROXY. Ở production,
    // server.js bắt buộc PUBLIC_BASE_URL nên không phụ thuộc Host header.
    const baseUrl = resolvePublicBaseUrl(req);

    let conversion;
    try {
      conversion = await affiliate.convert({ url: link, platform, subId, code, baseUrl });
    } catch (err) {
      // Không chặn người dùng: vẫn tạo đơn với link gốc để họ mua được bình thường,
      // chỉ là hệ thống chưa ghi nhận được hoa hồng. Ghi log để quản trị viên biết.
      console.error('Chuyển đổi link thất bại:', err.message);
      conversion = {
        affiliateLink: null,
        provider: 'raw',
        subId: null,
        isReal: false,
        error: String(err.message || 'Không tạo được link hoàn tiền.').slice(0, 300)
      };
    }

    const info = db
      .prepare(
        `INSERT INTO orders
           (user_id, code, link, original_link, affiliate_link, sub_id, platform, status, commission,
            affiliate_provider, affiliate_is_real, affiliate_error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'Đang xử lý', 0, ?, ?, ?, ?)`
      )
      .run(
        req.user.id,
        code,
        link,
        link,
        conversion.affiliateLink || null,
        conversion.subId || null,
        platform,
        conversion.provider || null,
        conversion.isReal ? 1 : 0,
        conversion.error ? String(conversion.error).slice(0, 300) : null,
        new Date().toISOString()
      );

    notify(req.user.id, {
      title: `Đã tạo đơn ${code}`,
      body: conversion.isReal
        ? `Link hoàn tiền cho sản phẩm ${platform} đã sẵn sàng. Hãy mua hàng qua link đó để được ghi nhận hoa hồng.`
        : conversion.error
          ? `Đơn ${platform} đã được ghi nhận nhưng chưa tạo được link hoàn tiền tự động. Quản trị viên sẽ kiểm tra và chốt hoa hồng cho bạn.`
          : `Đơn ${platform} đã được ghi nhận. Sàn này đang ở chế độ thử nghiệm nên hoa hồng sẽ do quản trị viên chốt.`,
      icon: 'shopping-cart'
    });

    const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(info.lastInsertRowid));
    return res.status(201).json({
      order: toOrder(row),
      affiliate: {
        provider: conversion.provider || null,
        isReal: !!conversion.isReal,
        error: conversion.error || null
      }
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
