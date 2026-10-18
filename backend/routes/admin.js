'use strict';

/**
 * API quản trị — tất cả đều yêu cầu tài khoản có role = 'admin'.
 *
 *  GET    /api/admin/overview            Thống kê toàn hệ thống
 *  GET    /api/admin/users               Danh sách người dùng (q, limit, offset)
 *  PATCH  /api/admin/users/:id           Đổi vai trò / điểm thưởng
 *  DELETE /api/admin/users/:id           Xoá người dùng (kèm dữ liệu liên quan)
 *  GET    /api/admin/orders              Danh sách đơn hàng (status, q, limit, offset)
 *  PATCH  /api/admin/orders/:code        Đổi trạng thái / hoa hồng
 *  GET    /api/admin/withdrawals         Danh sách lệnh rút tiền (status, q, limit, offset)
 *  PATCH  /api/admin/withdrawals/:code   Đổi trạng thái / số tiền chi trả
 *  GET    /api/admin/referrals           Lịch sử nhập mã giới thiệu (limit, offset)
 */

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const db = require('../db');
const {
  toAdminUser,
  toAdminOrder,
  toAdminWithdrawal,
  toAdminReferral
} = require('../lib/serialize');
const { formatMoney } = require('../lib/format');
const { ORDER_STATUSES, WITHDRAWAL_STATUSES, ROLES, CANCELLED } = require('../lib/constants');
const { requireAdmin } = require('../lib/auth');

const router = express.Router();
router.use(requireAdmin);

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

const MAX_MONEY = 100000000000; // 100 tỷ — chặn giá trị vô lý
const MAX_POINTS = 1000000000;

// Đọc số nguyên an toàn, luôn nằm trong khoảng cho phép
function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function readPaging(query) {
  return {
    limit: clampInt(query.limit, 1, MAX_LIMIT, DEFAULT_LIMIT),
    offset: clampInt(query.offset, 0, 100000000, 0)
  };
}

// Kiểm tra số nguyên không âm trong khoảng
function isMoney(value) {
  return Number.isInteger(value) && value >= 0 && value <= MAX_MONEY;
}

// Các cột tổng hợp dùng chung cho danh sách người dùng
const USER_AGGREGATES = `
  (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS order_count,
  (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id AND o.status = 'Đang xử lý') AS pending_count,
  (SELECT COALESCE(SUM(o.commission), 0) FROM orders o WHERE o.user_id = u.id AND o.status != '${CANCELLED}') AS commission_total,
  (SELECT COALESCE(SUM(w.amount), 0) FROM withdrawals w WHERE w.user_id = u.id AND w.status != '${CANCELLED}') AS withdrawn_total,
  (SELECT COUNT(*) FROM referrals r WHERE r.user_id = u.id) AS referral_count
`;

// Số dư của một người dùng (đơn huỷ không tính, lệnh rút huỷ không tính)
function getUserMoney(userId) {
  const commission = Number(
    db
      .prepare(`SELECT COALESCE(SUM(commission), 0) AS t FROM orders WHERE user_id = ? AND status != ?`)
      .get(userId, CANCELLED).t
  ) || 0;
  const withdrawn = Number(
    db
      .prepare(`SELECT COALESCE(SUM(amount), 0) AS t FROM withdrawals WHERE user_id = ? AND status != ?`)
      .get(userId, CANCELLED).t
  ) || 0;
  return { commission, withdrawn, balance: commission - withdrawn };
}

// Số tiền tối đa có thể chi cho một lệnh rút: tổng hoa hồng trừ các lệnh rút KHÁC
// (không tính chính lệnh đang xét, và bỏ qua mọi đơn/lệnh đã huỷ).
function payableForWithdrawal(row) {
  const money = getUserMoney(row.user_id);
  const selfCounted = row.status === CANCELLED ? 0 : Number(row.amount) || 0;
  return Math.max(0, money.commission - (money.withdrawn - selfCounted));
}

function findUserById(id) {
  return db.prepare(`SELECT u.*, ${USER_AGGREGATES} FROM users u WHERE u.id = ?`).get(id);
}

function findOrderByCode(code) {
  return db
    .prepare(
      `SELECT o.*, u.name AS user_name, u.username AS user_username
       FROM orders o JOIN users u ON u.id = o.user_id
       WHERE o.code = ?`
    )
    .get(code);
}

function findWithdrawalByCode(code) {
  return db
    .prepare(
      `SELECT w.*, u.name AS user_name, u.username AS user_username,
         (SELECT COALESCE(SUM(o.commission), 0) FROM orders o
           WHERE o.user_id = w.user_id AND o.status != '${CANCELLED}') AS commission_total,
         (SELECT COALESCE(SUM(w2.amount), 0) FROM withdrawals w2
           WHERE w2.user_id = w.user_id AND w2.status != '${CANCELLED}') AS withdrawn_total,
         (SELECT COALESCE(SUM(w3.amount), 0) FROM withdrawals w3
           WHERE w3.user_id = w.user_id AND w3.status != '${CANCELLED}' AND w3.id != w.id) AS other_withdrawn_total
       FROM withdrawals w JOIN users u ON u.id = w.user_id
       WHERE w.code = ?`
    )
    .get(code);
}

/* ==========================================
   Tổng quan
========================================== */

router.get('/overview', (req, res) => {
  const users = db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END), 0) AS admins
       FROM users`
    )
    .get();

  const orders = db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN status = 'Đang xử lý'    THEN 1 ELSE 0 END), 0) AS pending,
              COALESCE(SUM(CASE WHEN status = 'Hoàn thành'    THEN 1 ELSE 0 END), 0) AS completed,
              COALESCE(SUM(CASE WHEN status = 'Đã thanh toán' THEN 1 ELSE 0 END), 0) AS paid,
              COALESCE(SUM(CASE WHEN status = '${CANCELLED}'  THEN 1 ELSE 0 END), 0) AS cancelled,
              COALESCE(SUM(CASE WHEN status != '${CANCELLED}' THEN commission ELSE 0 END), 0) AS commission
       FROM orders`
    )
    .get();

  const withdrawals = db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN status = 'Đang xử lý'    THEN 1 ELSE 0 END), 0) AS pending,
              COALESCE(SUM(CASE WHEN status = 'Đã thanh toán' THEN 1 ELSE 0 END), 0) AS paid,
              COALESCE(SUM(CASE WHEN status = '${CANCELLED}'  THEN 1 ELSE 0 END), 0) AS cancelled,
              COALESCE(SUM(CASE WHEN status = 'Đã thanh toán' THEN amount ELSE 0 END), 0) AS paid_amount,
              COALESCE(SUM(CASE WHEN status != '${CANCELLED}' THEN amount ELSE 0 END), 0) AS committed_amount
       FROM withdrawals`
    )
    .get();

  const referrals = db
    .prepare('SELECT COUNT(*) AS total, COALESCE(SUM(points), 0) AS points FROM referrals')
    .get();

  const totalCommission = Number(orders.commission) || 0;
  const committed = Number(withdrawals.committed_amount) || 0;

  return res.json({
    users: {
      total: Number(users.total) || 0,
      admins: Number(users.admins) || 0
    },
    orders: {
      total: Number(orders.total) || 0,
      pending: Number(orders.pending) || 0,
      completed: Number(orders.completed) || 0,
      paid: Number(orders.paid) || 0,
      cancelled: Number(orders.cancelled) || 0,
      commission: totalCommission
    },
    withdrawals: {
      total: Number(withdrawals.total) || 0,
      pending: Number(withdrawals.pending) || 0,
      paid: Number(withdrawals.paid) || 0,
      cancelled: Number(withdrawals.cancelled) || 0,
      paidAmount: Number(withdrawals.paid_amount) || 0
    },
    referrals: {
      total: Number(referrals.total) || 0,
      points: Number(referrals.points) || 0
    },
    money: {
      totalCommission,
      totalPaidOut: Number(withdrawals.paid_amount) || 0,
      // Tổng tiền hệ thống còn phải trả cho người dùng
      systemBalance: totalCommission - committed
    }
  });
});

/* ==========================================
   Người dùng
========================================== */

router.get('/users', (req, res) => {
  const q = String(req.query.q || '').trim();
  const { limit, offset } = readPaging(req.query);

  const params = [];
  let whereSql = '';
  if (q) {
    const like = '%' + q + '%';
    whereSql = `WHERE (u.name LIKE ? OR u.username LIKE ? OR u.email LIKE ? OR u.phone LIKE ? OR u.referral_code LIKE ?)`;
    params.push(like, like, like, like, '%' + q.toUpperCase() + '%');
  }

  const total = Number(db.prepare(`SELECT COUNT(*) AS c FROM users u ${whereSql}`).get(...params).c) || 0;
  const rows = db
    .prepare(
      `SELECT u.*, ${USER_AGGREGATES}
       FROM users u
       ${whereSql}
       ORDER BY u.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);

  return res.json({ total, limit, offset, users: rows.map(toAdminUser) });
});

router.patch('/users/:id', (req, res) => {
  const id = Number(req.params.id);
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'Không tìm thấy người dùng.' });

  const body = req.body || {};
  const updates = [];
  const values = [];

  if (body.role !== undefined) {
    const role = String(body.role);
    if (!ROLES.includes(role)) return res.status(400).json({ error: 'Vai trò không hợp lệ.' });

    if (role === 'user' && target.role === 'admin') {
      if (target.id === req.user.id) {
        return res.status(400).json({ error: 'Bạn không thể tự hạ quyền quản trị của chính mình.' });
      }
      const adminCount = Number(db.prepare(`SELECT COUNT(*) AS c FROM users WHERE role = 'admin'`).get().c) || 0;
      if (adminCount <= 1) {
        return res.status(400).json({ error: 'Hệ thống phải còn ít nhất một quản trị viên.' });
      }
    }

    updates.push('role = ?');
    values.push(role);
  }

  if (body.points !== undefined) {
    const points = Number(body.points);
    if (!Number.isInteger(points) || points < 0 || points > MAX_POINTS) {
      return res.status(400).json({ error: 'Điểm thưởng không hợp lệ.' });
    }
    updates.push('points = ?');
    values.push(points);
  }

  if (!updates.length) {
    return res.status(400).json({ error: 'Không có thông tin nào để cập nhật.' });
  }

  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values, id);
  return res.json({ user: toAdminUser(findUserById(id)) });
});

router.delete('/users/:id', (req, res) => {
  const id = Number(req.params.id);
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'Không tìm thấy người dùng.' });

  if (target.id === req.user.id) {
    return res.status(400).json({ error: 'Bạn không thể xoá tài khoản của chính mình.' });
  }
  if (target.role === 'admin') {
    const adminCount = Number(db.prepare(`SELECT COUNT(*) AS c FROM users WHERE role = 'admin'`).get().c) || 0;
    if (adminCount <= 1) {
      return res.status(400).json({ error: 'Hệ thống phải còn ít nhất một quản trị viên.' });
    }
  }

  // ON DELETE CASCADE sẽ xoá luôn orders / withdrawals / referrals của người này
  db.prepare('DELETE FROM users WHERE id = ?').run(id);

  // Xoá file avatar do hệ thống lưu (nếu có)
  if (target.avatar_url && target.avatar_url.startsWith('/uploads/')) {
    try {
      const filePath = path.join(UPLOAD_DIR, path.basename(target.avatar_url));
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (err) {
      /* bỏ qua lỗi xoá file */
    }
  }

  return res.json({ ok: true, id });
});

/* ==========================================
   Đơn hàng
========================================== */

router.get('/orders', (req, res) => {
  const status = String(req.query.status || '').trim();
  const q = String(req.query.q || '').trim();
  const { limit, offset } = readPaging(req.query);

  if (status && status !== 'all' && !ORDER_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Trạng thái đơn hàng không hợp lệ.' });
  }

  const conditions = [];
  const params = [];

  if (status && status !== 'all') {
    conditions.push('o.status = ?');
    params.push(status);
  }
  if (q) {
    const like = '%' + q + '%';
    conditions.push('(o.code LIKE ? OR o.link LIKE ? OR o.platform LIKE ? OR u.name LIKE ? OR u.username LIKE ?)');
    params.push(like, like, like, like, like);
  }

  const whereSql = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  const total = Number(
    db
      .prepare(`SELECT COUNT(*) AS c FROM orders o JOIN users u ON u.id = o.user_id ${whereSql}`)
      .get(...params).c
  ) || 0;

  const rows = db
    .prepare(
      `SELECT o.*, u.name AS user_name, u.username AS user_username
       FROM orders o JOIN users u ON u.id = o.user_id
       ${whereSql}
       ORDER BY o.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);

  return res.json({ total, limit, offset, orders: rows.map(toAdminOrder) });
});

router.patch('/orders/:code', (req, res) => {
  const code = String(req.params.code || '').trim();
  if (!db.prepare('SELECT 1 AS x FROM orders WHERE code = ?').get(code)) {
    return res.status(404).json({ error: 'Không tìm thấy đơn hàng.' });
  }

  const body = req.body || {};
  const updates = [];
  const values = [];

  if (body.status !== undefined) {
    const status = String(body.status);
    if (!ORDER_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Trạng thái đơn hàng không hợp lệ.' });
    }
    updates.push('status = ?');
    values.push(status);
  }

  if (body.commission !== undefined) {
    const commission = Number(body.commission);
    if (!isMoney(commission)) return res.status(400).json({ error: 'Hoa hồng không hợp lệ.' });
    updates.push('commission = ?');
    values.push(commission);
  }

  if (!updates.length) {
    return res.status(400).json({ error: 'Không có thông tin nào để cập nhật.' });
  }

  db.prepare(`UPDATE orders SET ${updates.join(', ')} WHERE code = ?`).run(...values, code);
  return res.json({ order: toAdminOrder(findOrderByCode(code)) });
});

/* ==========================================
   Rút tiền
========================================== */

router.get('/withdrawals', (req, res) => {
  const status = String(req.query.status || '').trim();
  const q = String(req.query.q || '').trim();
  const { limit, offset } = readPaging(req.query);

  if (status && status !== 'all' && !WITHDRAWAL_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Trạng thái lệnh rút không hợp lệ.' });
  }

  const conditions = [];
  const params = [];

  if (status && status !== 'all') {
    conditions.push('w.status = ?');
    params.push(status);
  }
  if (q) {
    const like = '%' + q + '%';
    conditions.push(
      '(w.code LIKE ? OR w.bank LIKE ? OR w.acc_num LIKE ? OR w.acc_name LIKE ? OR u.name LIKE ? OR u.username LIKE ?)'
    );
    params.push(like, like, like, like, like, like);
  }

  const whereSql = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  const total = Number(
    db
      .prepare(`SELECT COUNT(*) AS c FROM withdrawals w JOIN users u ON u.id = w.user_id ${whereSql}`)
      .get(...params).c
  ) || 0;

  const rows = db
    .prepare(
      `SELECT w.*, u.name AS user_name, u.username AS user_username,
         (SELECT COALESCE(SUM(o.commission), 0) FROM orders o
           WHERE o.user_id = w.user_id AND o.status != '${CANCELLED}') AS commission_total,
         (SELECT COALESCE(SUM(w2.amount), 0) FROM withdrawals w2
           WHERE w2.user_id = w.user_id AND w2.status != '${CANCELLED}') AS withdrawn_total,
         (SELECT COALESCE(SUM(w3.amount), 0) FROM withdrawals w3
           WHERE w3.user_id = w.user_id AND w3.status != '${CANCELLED}' AND w3.id != w.id) AS other_withdrawn_total
       FROM withdrawals w JOIN users u ON u.id = w.user_id
       ${whereSql}
       ORDER BY w.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);

  return res.json({ total, limit, offset, withdrawals: rows.map(toAdminWithdrawal) });
});

router.patch('/withdrawals/:code', (req, res) => {
  const code = String(req.params.code || '').trim();
  const row = db.prepare('SELECT * FROM withdrawals WHERE code = ?').get(code);
  if (!row) return res.status(404).json({ error: 'Không tìm thấy lệnh rút tiền.' });

  const body = req.body || {};
  const updates = [];
  const values = [];

  let nextStatus = row.status;
  let nextAmount = Number(row.amount) || 0;

  if (body.status !== undefined) {
    const status = String(body.status);
    if (!WITHDRAWAL_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Trạng thái lệnh rút không hợp lệ.' });
    }
    nextStatus = status;
    updates.push('status = ?');
    values.push(status);
  }

  if (body.amount !== undefined) {
    const amount = Number(body.amount);
    if (!isMoney(amount)) return res.status(400).json({ error: 'Số tiền không hợp lệ.' });
    nextAmount = amount;
    updates.push('amount = ?');
    values.push(amount);
  }

  if (!updates.length) {
    return res.status(400).json({ error: 'Không có thông tin nào để cập nhật.' });
  }

  if (nextStatus === 'Đã thanh toán') {
    if (nextAmount <= 0) {
      return res.status(400).json({ error: 'Vui lòng nhập số tiền thực chi trả trước khi đánh dấu đã thanh toán.' });
    }
    // Không cho chi nhiều hơn số dư khả dụng (không tính chính lệnh này)
    const payable = payableForWithdrawal(row);
    if (nextAmount > payable) {
      return res.status(400).json({
        error: `Số tiền vượt quá số dư khả dụng của người dùng (${formatMoney(payable)}).`
      });
    }
  }

  db.prepare(`UPDATE withdrawals SET ${updates.join(', ')} WHERE code = ?`).run(...values, code);

  return res.json({ withdrawal: toAdminWithdrawal(findWithdrawalByCode(code)) });
});

/* ==========================================
   Mã giới thiệu
========================================== */

router.get('/referrals', (req, res) => {
  const { limit, offset } = readPaging(req.query);

  const total = Number(db.prepare('SELECT COUNT(*) AS c FROM referrals').get().c) || 0;
  const rows = db
    .prepare(
      `SELECT r.*, u.name AS user_name, u.username AS user_username,
              o.id AS owner_id, o.name AS owner_name, o.username AS owner_username
       FROM referrals r
       JOIN users u ON u.id = r.user_id
       LEFT JOIN users o ON o.referral_code = r.code
       ORDER BY r.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(limit, offset);

  return res.json({ total, limit, offset, referrals: rows.map(toAdminReferral) });
});

module.exports = router;
