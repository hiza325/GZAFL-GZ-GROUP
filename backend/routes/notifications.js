'use strict';

const express = require('express');
const db = require('../db');
const { toNotification } = require('../lib/serialize');
const { requireAuth } = require('../lib/auth');

const router = express.Router();
router.use(requireAuth);

const MAX_ITEMS = 50;

// Danh sách thông báo + số chưa đọc
router.get('/', (req, res) => {
  const rows = db
    .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ?')
    .all(req.user.id, MAX_ITEMS);

  const unread = db
    .prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0')
    .get(req.user.id);

  return res.json({
    notifications: rows.map(toNotification),
    unreadCount: Number(unread.c) || 0
  });
});

// Đánh dấu tất cả là đã đọc
router.post('/read-all', (req, res) => {
  const info = db
    .prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0')
    .run(req.user.id);
  return res.json({ ok: true, updated: Number(info.changes) || 0 });
});

module.exports = router;
