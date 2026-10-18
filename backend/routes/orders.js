'use strict';

const express = require('express');
const db = require('../db');
const { toOrder } = require('../lib/serialize');
const { generateOrderCode, detectPlatform } = require('../lib/validate');
const { requireAuth } = require('../lib/auth');
const { notify } = require('../lib/notify');
const affiliate = require('../lib/affiliate');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC').all(req.user.id);
  return res.json({ orders: rows.map(toOrder) });
});

router.post('/', async (req, res, next) => {
  try {
    const link = String((req.body && req.body.link) || '').trim();

    if (!link) return res.status(400).json({ error: 'Vui lòng dán link sản phẩm trước khi tiếp tục.' });
    if (link.includes('\n') || link.split(/\s+/).filter(Boolean).length > 1) {
      return res.status(400).json({ error: 'Chỉ cho phép nhập đúng 1 link. Vui lòng không nhập nhiều link cùng lúc!' });
    }

    const platform = detectPlatform(link);
    if (!platform) {
      return res.status(400).json({ error: 'Phát hiện link không hợp lệ! Vui lòng chỉ nhập link Shopee, TikTok hoặc Lazada.' });
    }

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
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    let conversion;
    try {
      conversion = await affiliate.convert({ url: link, platform, subId, code, baseUrl });
    } catch (err) {
      // Không chặn người dùng: vẫn tạo đơn với link gốc để họ mua được bình thường,
      // chỉ là hệ thống chưa ghi nhận được hoa hồng. Ghi log để quản trị viên biết.
      console.error('Chuyển đổi link thất bại:', err.message);
      conversion = { affiliateLink: null, provider: 'raw', subId: null, isReal: false };
    }

    const info = db
      .prepare(
        `INSERT INTO orders (user_id, code, link, original_link, affiliate_link, sub_id, platform, status, commission, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'Đang xử lý', 0, ?)`
      )
      .run(
        req.user.id,
        code,
        link,
        link,
        conversion.affiliateLink,
        conversion.subId,
        platform,
        new Date().toISOString()
      );

    notify(req.user.id, {
      title: `Đã tạo đơn ${code}`,
      body: conversion.isReal
        ? `Link hoàn tiền cho sản phẩm ${platform} đã sẵn sàng. Hãy mua hàng qua link đó để được ghi nhận hoa hồng.`
        : `Đơn ${platform} đã được ghi nhận. Hệ thống chưa kết nối API của sàn nên hoa hồng sẽ do quản trị viên chốt.`,
      icon: 'shopping-cart'
    });

    const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(info.lastInsertRowid));
    return res.status(201).json({ order: toOrder(row), affiliate: affiliate.describe() });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
