'use strict';

/**
 * ĐIỂM NHẬN POSTBACK từ mạng affiliate (xem lib/postback.js để biết cách xử lý).
 *
 * Đây là API KHÔNG dùng cookie phiên — nó dành cho MÁY GỌI của mạng, không phải người dùng.
 * URL khai với mạng (AccessTrade: Account Settings -> Properties -> Postback):
 *      https://ten-mien-cua-ban/api/postback/accesstrade
 *
 * Quy tắc trả lời:
 *  - Luôn trả 200 nhanh khi đã ghi nhận (kể cả lần gọi trùng), tránh mạng gửi lại liên tục.
 *  - 403 khi sai "chìa khoá" (POSTBACK_SECRET) — KHÔNG nhận dữ liệu không rõ nguồn.
 *  - 503 khi chưa cấu hình POSTBACK_SECRET, kèm hướng dẫn.
 */

const express = require('express');
const { rateLimit } = require('../lib/rateLimit');
const postback = require('../lib/postback');

const router = express.Router();

// Mạng gửi GET; vẫn nhận POST (form) để phòng khi họ đổi cách gọi
router.use(express.urlencoded({ extended: false, limit: '128kb' }));

// Chống ngập: 3000 lượt / 5 phút cho mỗi IP. Một ngày cao điểm cũng khó vượt,
// nhưng vẫn đủ để chặn kẻ gọi bừa. Lưu ý AccessTrade chỉ gửi lại tối đa 3 lần.
const floodLimit = rateLimit({ windowMs: 5 * 60 * 1000, max: 3000, name: 'postback' });

const MAX_KEYS = 60;        // số tham số tối đa nhận từ một lần gọi
const MAX_VALUE = 300;      // độ dài tối đa mỗi giá trị tham số

/**
 * Chỉ lấy những gì cần: cắt bớt số lượng tham số và độ dài giá trị,
 * để kẻ xấu không nhét dữ liệu khổng lồ vào nhật ký.
 */
function sanitize(source) {
  const out = {};
  const input = source && typeof source === 'object' ? source : {};
  let count = 0;
  for (const key of Object.keys(input)) {
    if (count >= MAX_KEYS) break;
    const name = String(key).slice(0, 60);
    const value = input[key];
    if (Array.isArray(value)) out[name] = value.slice(0, 3).map((v) => String(v).slice(0, MAX_VALUE));
    else if (value !== undefined && value !== null && typeof value !== 'object') {
      out[name] = String(value).slice(0, MAX_VALUE);
    }
    count += 1;
  }
  return out;
}

function clientIp(req) {
  return String(req.ip || req.socket?.remoteAddress || '').slice(0, 60);
}

/** Nhận postback. `:provider` chỉ để dễ đọc URL (accesstrade, mas, ecomobi...). */
function handle(req, res) {
  const params = sanitize({ ...req.query, ...req.body });
  const provider = String(req.params.provider || '').toLowerCase();
  const meta = { provider, ip: clientIp(req) };

  const check = postback.verifySecret(params);
  if (!check.configured) {
    console.warn('Postback bị bỏ qua: chưa đặt POSTBACK_SECRET trong backend/.env.');
    return res.status(503).json({
      ok: false,
      error: 'Máy chủ chưa cấu hình đối soát (thiếu POSTBACK_SECRET).'
    });
  }
  if (!check.ok) {
    // Vẫn ghi lại để biết có ai gọi sai/đoán mò
    postback.receiveRejected(params, meta, 'Sai chìa khoá');
    console.warn(`Postback bị từ chối: sai chìa khoá (IP ${meta.ip}, provider ${provider}).`);
    return res.status(403).json({ ok: false, error: 'Chìa khoá không hợp lệ.' });
  }

  try {
    const result = postback.receive(params, meta);
    return res.status(result.status).json(result.body);
  } catch (err) {
    // Ghi log thô rồi vẫn trả 200: dữ liệu đã kịp lưu, xử lý lại được sau
    console.error('Lỗi xử lý postback:', err.message);
    try {
      postback.receiveRejected(params, meta, 'Lỗi xử lý: ' + err.message);
    } catch (inner) {
      console.error('Không ghi được nhật ký postback:', inner.message);
    }
    return res.status(200).json({ ok: true, deferred: true });
  }
}

router.get('/:provider', floodLimit, handle);
router.post('/:provider', floodLimit, handle);

module.exports = router;
