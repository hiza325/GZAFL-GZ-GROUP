'use strict';

const express = require('express');
const db = require('../db');
const { toWithdrawal, toUser } = require('../lib/serialize');
const { generateWithdrawalCode } = require('../lib/validate');
const { requireAuth } = require('../lib/auth');
const { CANCELLED } = require('../lib/constants');

const router = express.Router();
router.use(requireAuth);

// Số dư = tổng hoa hồng của các đơn KHÔNG bị huỷ − tổng tiền các lệnh rút KHÔNG bị huỷ
function computeBalance(userId) {
  const orderRow = db
    .prepare('SELECT COALESCE(SUM(commission), 0) AS total FROM orders WHERE user_id = ? AND status != ?')
    .get(userId, CANCELLED);
  const totalCommission = Number(orderRow.total) || 0;

  const wdRow = db
    .prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM withdrawals WHERE user_id = ? AND status != ?')
    .get(userId, CANCELLED);
  const withdrawn = Number(wdRow.total) || 0;

  return { totalCommission, withdrawn, balance: totalCommission - withdrawn };
}

router.get('/', (req, res) => {
  const userId = req.user.id;

  const stats = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'Đang xử lý'    THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN status = 'Hoàn thành'    THEN 1 ELSE 0 END) AS completed,
         SUM(CASE WHEN status = 'Đã thanh toán' THEN 1 ELSE 0 END) AS paid
       FROM orders WHERE user_id = ?`
    )
    .get(userId);

  const withdrawals = db.prepare('SELECT * FROM withdrawals WHERE user_id = ? ORDER BY id DESC').all(userId);
  const money = computeBalance(userId);

  return res.json({
    stats: {
      total: Number(stats.total) || 0,
      pending: Number(stats.pending) || 0,
      completed: Number(stats.completed) || 0,
      paid: Number(stats.paid) || 0
    },
    balance: money.balance,
    totalCommission: money.totalCommission,
    withdrawn: money.withdrawn,
    withdrawals: withdrawals.map(toWithdrawal)
  });
});

router.post('/withdrawals', (req, res) => {
  const bank = String((req.body && req.body.bank) || '').trim();
  const accNum = String((req.body && req.body.accNum) || '').trim();
  const accName = String((req.body && req.body.accName) || '').trim();

  if (!bank || !accNum || !accName) {
    return res.status(400).json({ error: 'Vui lòng điền đầy đủ thông tin nhận tiền!' });
  }
  if (!/^[0-9]{6,20}$/.test(accNum)) {
    return res.status(400).json({ error: 'Số tài khoản/số điện thoại ví phải là 6-20 chữ số.' });
  }

  let code = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = generateWithdrawalCode();
    if (!db.prepare('SELECT 1 AS x FROM withdrawals WHERE code = ?').get(candidate)) {
      code = candidate;
      break;
    }
  }
  if (!code) return res.status(500).json({ error: 'Không tạo được mã giao dịch.' });

  const info = db
    .prepare(
      `INSERT INTO withdrawals (user_id, code, bank, acc_num, acc_name, amount, status, created_at)
       VALUES (?, ?, ?, ?, ?, 0, 'Đang xử lý', ?)`
    )
    .run(req.user.id, code, bank, accNum, accName, new Date().toISOString());

  // Lưu làm thông tin nhận tiền mặc định để hiển thị ở trang Cá nhân
  db.prepare('UPDATE users SET bank_bank = ?, bank_acc_num = ?, bank_acc_name = ? WHERE id = ?').run(
    bank,
    accNum,
    accName,
    req.user.id
  );

  const row = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(Number(info.lastInsertRowid));
  const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

  return res.status(201).json({ withdrawal: toWithdrawal(row), user: toUser(userRow) });
});

module.exports = router;
