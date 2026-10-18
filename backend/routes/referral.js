'use strict';

const express = require('express');
const db = require('../db');
const { formatDateTime } = require('../lib/format');
const { REFERRAL_CODE_LENGTH } = require('../lib/validate');
const { requireAuth } = require('../lib/auth');
const { notify } = require('../lib/notify');

const router = express.Router();
router.use(requireAuth);

const REWARD_POINTS = 100;

function getHistory(userId) {
  return db
    .prepare('SELECT * FROM referrals WHERE user_id = ? ORDER BY id DESC')
    .all(userId)
    .map((row) => ({ code: row.code, date: formatDateTime(row.created_at), points: row.points }));
}

router.get('/', (req, res) => {
  const history = getHistory(req.user.id);
  return res.json({
    code: req.user.referral_code,
    points: req.user.points || 0,
    redeemedCount: history.length,
    history
  });
});

router.post('/redeem', (req, res) => {
  const code = String((req.body && req.body.code) || '')
    .trim()
    .toUpperCase();

  if (code.length !== REFERRAL_CODE_LENGTH) {
    return res.status(400).json({ error: 'Mã giới thiệu phải gồm đúng 6 ký tự.' });
  }
  if (code === req.user.referral_code) {
    return res.status(400).json({ error: 'Bạn không thể nhập mã giới thiệu của chính mình.' });
  }

  const owner = db.prepare('SELECT id FROM users WHERE referral_code = ?').get(code);
  if (!owner) {
    return res.status(404).json({ error: 'Mã giới thiệu không tồn tại. Vui lòng kiểm tra lại.' });
  }

  const used = db
    .prepare('SELECT 1 AS x FROM referrals WHERE user_id = ? AND code = ?')
    .get(req.user.id, code);
  if (used) {
    return res.status(409).json({ error: 'Mã này đã được bạn sử dụng trước đó.' });
  }

  db.prepare('INSERT INTO referrals (user_id, code, points, created_at) VALUES (?, ?, ?, ?)').run(
    req.user.id,
    code,
    REWARD_POINTS,
    new Date().toISOString()
  );
  db.prepare('UPDATE users SET points = points + ? WHERE id = ?').run(REWARD_POINTS, req.user.id);

  notify(req.user.id, {
    title: 'Nhập mã giới thiệu thành công',
    body: `Bạn vừa nhận được ${REWARD_POINTS} điểm từ mã ${code}.`,
    icon: 'user-plus'
  });

  const updated = db.prepare('SELECT points FROM users WHERE id = ?').get(req.user.id);
  return res.json({
    message: `Nhập mã thành công! Bạn vừa nhận được ${REWARD_POINTS} điểm.`,
    points: updated.points,
    redeemedCount: getHistory(req.user.id).length
  });
});

module.exports = router;
