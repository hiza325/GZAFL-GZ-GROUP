'use strict';

const express = require('express');
const db = require('../db');
const { toOrder } = require('../lib/serialize');
const { generateOrderCode, detectPlatform } = require('../lib/validate');
const { requireAuth } = require('../lib/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC').all(req.user.id);
  return res.json({ orders: rows.map(toOrder) });
});

router.post('/', (req, res) => {
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

  const info = db
    .prepare(
      `INSERT INTO orders (user_id, code, link, platform, status, commission, created_at)
       VALUES (?, ?, ?, ?, 'Đang xử lý', 0, ?)`
    )
    .run(req.user.id, code, link, platform, new Date().toISOString());

  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(info.lastInsertRowid));
  return res.status(201).json({ order: toOrder(row) });
});

module.exports = router;
