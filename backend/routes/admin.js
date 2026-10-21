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
 *  GET    /api/admin/postbacks           Nhật ký postback từ mạng affiliate (q, status, only, limit, offset)
 *  POST   /api/admin/postbacks/:id/reapply  Xử lý lại một log postback
 *  GET    /api/admin/audit-logs          Nhật ký thao tác của quản trị viên (limit, offset)
 *  GET    /api/admin/security-alerts     Cảnh báo bảo mật (status, q, limit, offset)
 *  POST   /api/admin/security-alerts/:id/resolve  Đánh dấu cảnh báo đã xử lý
 *  POST   /api/admin/security-alerts/:id/hold     Tạm giữ tài khoản liên quan
 *  POST   /api/admin/users/:id/security-hold      Tạm giữ tài khoản trực tiếp
 *  DELETE /api/admin/users/:id/security-hold      Bỏ tạm giữ
 */

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const db = require('../db');
const bcrypt = require('bcryptjs');
const {
  toAdminUser,
  toAdminOrder,
  toAdminWithdrawal,
  toAdminReferral,
  toAdminPasswordReset,
  toAdminAudit,
  toAdminPostback,
  toAdminSecurityAlert
} = require('../lib/serialize');
const { formatMoney } = require('../lib/format');
const {
  ORDER_STATUSES,
  WITHDRAWAL_STATUSES,
  ROLES,
  CANCELLED,
  PENDING_APPROVAL,
  RESET_PENDING,
  RESET_STATUSES
} = require('../lib/constants');
const { requireAdmin } = require('../lib/auth');
const { notify } = require('../lib/notify');
const { logAudit } = require('../lib/audit');
const { UPLOAD_DIR } = require('../lib/uploads');
const postback = require('../lib/postback');
const { generateTempPassword } = require('../lib/validate');
const { creditedCondition, reversedExpr, isCredited, computeUserMoney } = require('../lib/money');
const securityAlerts = require('../lib/securityAlerts');

const router = express.Router();
router.use(requireAdmin);

// Mật khẩu tạm do quản trị viên cấp chỉ sống trong khoảng này (giờ).
// Hết hạn thì khách phải yêu cầu cấp lại — tránh mật khẩu lộ trong Zalo/tin nhắn
// vẫn dùng được mãi về sau.
const TEMP_PASSWORD_TTL_HOURS = Number(process.env.TEMP_PASSWORD_TTL_HOURS) || 24;

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
  (SELECT COUNT(*) FROM orders o
     WHERE o.user_id = u.id AND o.status IN ('Đang xử lý', 'Chờ đối soát', '${PENDING_APPROVAL}')) AS pending_count,
  (SELECT COALESCE(SUM(o.commission), 0) FROM orders o
     WHERE o.user_id = u.id AND ${creditedCondition('o')}) AS commission_total,
  (SELECT COALESCE(SUM(o.commission), 0) FROM orders o
     WHERE o.user_id = u.id AND o.status = '${PENDING_APPROVAL}') AS pending_approval_total,
  (SELECT COALESCE(SUM(${reversedExpr('o')}), 0) FROM orders o WHERE o.user_id = u.id) AS clawback_total,
  (SELECT COALESCE(SUM(w.amount), 0) FROM withdrawals w WHERE w.user_id = u.id AND w.status != '${CANCELLED}') AS withdrawn_total,
  (SELECT COUNT(*) FROM referrals r WHERE r.user_id = u.id) AS referral_count
`;

// Số dư của một người dùng (đơn huỷ không tính, tiền đang giữ không được rút).
function getUserMoney(userId) {
  return computeUserMoney(userId);
}

// Số tiền tối đa có thể chi cho một lệnh rút: hoa hồng đã được admin duyệt trừ
// các lệnh rút KHÁC (không tính chính lệnh đang xét, bỏ qua đơn/lệnh đã huỷ).
function payableForWithdrawal(row) {
  const money = getUserMoney(row.user_id);
  const selfCounted = row.status === CANCELLED ? 0 : Number(row.amount) || 0;
  return Math.max(0, money.totalCommission - (money.withdrawn - selfCounted));
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
           WHERE o.user_id = w.user_id AND ${creditedCondition('o')}) AS commission_total,
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
              COALESCE(SUM(CASE WHEN status IN ('Đang xử lý', 'Chờ đối soát', '${PENDING_APPROVAL}')
                                THEN 1 ELSE 0 END), 0) AS pending,
              COALESCE(SUM(CASE WHEN status = '${PENDING_APPROVAL}' THEN 1 ELSE 0 END), 0) AS awaiting_approval,
              COALESCE(SUM(CASE WHEN status = 'Hoàn thành'    THEN 1 ELSE 0 END), 0) AS completed,
              COALESCE(SUM(CASE WHEN status = 'Đã thanh toán' THEN 1 ELSE 0 END), 0) AS paid,
              COALESCE(SUM(CASE WHEN status = '${CANCELLED}'  THEN 1 ELSE 0 END), 0) AS cancelled,
              COALESCE(SUM(CASE WHEN ${creditedCondition()} THEN commission ELSE 0 END), 0) AS commission,
              COALESCE(SUM(${reversedExpr()}), 0) AS clawback
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

  const passwordResets = db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN status = ? THEN 1 ELSE 0 END), 0) AS pending
       FROM password_resets`
    )
    .get(RESET_PENDING);

  // Nhật ký postback: đếm số lần nhận được và số lần CẦN NGƯỜI XEM LẠI
  // (chưa khớp được đơn nào, hoặc chỉ khớp tạm) — hiện huy hiệu trên tab "Đối soát".
  const postbacks = db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN (order_code = '' AND action != 'Từ chối') OR action = 'Khớp tạm' THEN 1 ELSE 0 END), 0) AS unmatched,
              COALESCE(SUM(CASE WHEN action != 'Từ chối' AND network_status = 'pending' THEN reward ELSE 0 END), 0) AS pending_amount
       FROM postback_logs`
    )
    .get();

  const security = db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END), 0) AS open
       FROM security_alerts`
    )
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
      awaitingApproval: Number(orders.awaiting_approval) || 0,
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
    passwordResets: {
      total: Number(passwordResets.total) || 0,
      pending: Number(passwordResets.pending) || 0
    },
    postbacks: {
      total: Number(postbacks.total) || 0,
      unmatched: Number(postbacks.unmatched) || 0,
      pendingAmount: Number(postbacks.pending_amount) || 0
    },
    securityAlerts: {
      total: Number(security.total) || 0,
      open: Number(security.open) || 0
    },
    money: {
      totalCommission,
      clawback: Number(orders.clawback) || 0,
      totalPaidOut: Number(withdrawals.paid_amount) || 0,
      // Tổng hoa hồng đã được admin duyệt còn phải trả cho người dùng
      systemBalance: totalCommission - committed,
      availableSystemBalance: totalCommission - committed
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

  const changes = [];
  if (body.role !== undefined) changes.push(`vai trò ${target.role} → ${String(body.role)}`);
  if (body.points !== undefined) changes.push(`điểm ${Number(target.points) || 0} → ${Number(body.points)}`);
  logAudit(req, 'Cập nhật người dùng', 'user', target.username || id, changes.join('; '));

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

  // Xoá người dùng sẽ CASCADE xoá luôn orders / withdrawals. Với tài khoản đã
  // phát sinh giao dịch, việc này làm mất lịch sử tài chính dùng để đối soát.
  // Mặc định CHẶN; chỉ xoá khi quản trị viên thật sự muốn (force=1).
  const force = String(req.query.force || '') === '1';
  if (!force) {
    const orderCount = Number(db.prepare('SELECT COUNT(*) AS c FROM orders WHERE user_id = ?').get(id).c) || 0;
    const withdrawCount =
      Number(db.prepare('SELECT COUNT(*) AS c FROM withdrawals WHERE user_id = ?').get(id).c) || 0;
    if (orderCount > 0 || withdrawCount > 0) {
      return res.status(409).json({
        error:
          `Không thể xoá: tài khoản đã có ${orderCount} đơn hàng và ${withdrawCount} lệnh rút tiền. ` +
          'Xoá sẽ làm mất lịch sử tài chính. Hãy giữ tài khoản để bảo toàn đối soát; ' +
          'nếu thật sự cần xoá, gọi lại API với ?force=1.'
      });
    }
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(id);

  // Xoá các file ảnh do hệ thống lưu (nếu có): avatar + ảnh QR nhận tiền.
  // Lệnh rút của người này đã bị xoá theo, nên ảnh QR không còn ai dùng.
  for (const url of [target.avatar_url, target.bank_qr_url]) {
    if (!url || !String(url).startsWith('/uploads/')) continue;
    try {
      const filePath = path.join(UPLOAD_DIR, path.basename(url));
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (err) {
      /* bỏ qua lỗi xoá file */
    }
  }

  logAudit(req, 'Xoá người dùng', 'user', target.username || id, `${target.name || ''} (${target.role})`);

  return res.json({ ok: true, id });
});

/* ==========================================
   Cảnh báo bảo mật

   Hệ thống KHÔNG tự khóa tài khoản khi có nhiều lần đăng nhập sai.
   Nó chỉ ghi cảnh báo để admin xem xét. Admin có thể:
     - Đánh dấu cảnh báo đã xử lý.
     - Tạm giữ tài khoản 24 giờ (hoặc số giờ tự chọn) nếu thấy đáng ngờ.
     - Bỏ tạm giữ bất cứ lúc nào.
========================================== */

const SECURITY_ALERT_STATUSES = ['new', 'resolved', 'all'];

function findSecurityAlertById(id) {
  return db
    .prepare(
      `SELECT a.*, u.name AS user_name, u.username AS user_username,
              u.email AS user_email, u.role AS user_role, u.security_hold_until
         FROM security_alerts a
         LEFT JOIN users u ON u.id = a.user_id
        WHERE a.id = ?`
    )
    .get(id);
}

router.get('/security-alerts', (req, res) => {
  const status = String(req.query.status || 'new').trim().toLowerCase();
  const q = String(req.query.q || '').trim();
  const { limit, offset } = readPaging(req.query);

  if (!SECURITY_ALERT_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Trạng thái cảnh báo không hợp lệ.' });
  }

  const conditions = [];
  const params = [];
  if (status !== 'all') {
    conditions.push('a.status = ?');
    params.push(status);
  }
  if (q) {
    const like = '%' + q + '%';
    conditions.push(
      '(a.username LIKE ? OR a.ip LIKE ? OR a.detail LIKE ? OR u.name LIKE ? OR u.username LIKE ?)'
    );
    params.push(like, like, like, like, like);
  }

  const whereSql = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const joinSql = 'FROM security_alerts a LEFT JOIN users u ON u.id = a.user_id';

  const total = Number(db.prepare(`SELECT COUNT(*) AS c ${joinSql} ${whereSql}`).get(...params).c) || 0;
  const stats = db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END), 0) AS open
         FROM security_alerts`
    )
    .get();

  const rows = db
    .prepare(
      `SELECT a.*, u.name AS user_name, u.username AS user_username,
              u.email AS user_email, u.role AS user_role, u.security_hold_until
         ${joinSql}
         ${whereSql}
         ORDER BY CASE WHEN a.status = 'new' THEN 0 ELSE 1 END, a.last_seen_at DESC
         LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);

  return res.json({
    total,
    limit,
    offset,
    stats: {
      total: Number(stats.total) || 0,
      open: Number(stats.open) || 0
    },
    alerts: rows.map(toAdminSecurityAlert)
  });
});

router.post('/security-alerts/:id/resolve', (req, res) => {
  const id = Number(req.params.id);
  const alert = findSecurityAlertById(id);
  if (!alert) return res.status(404).json({ error: 'Không tìm thấy cảnh báo.' });
  if (alert.status === 'resolved') {
    return res.status(409).json({ error: 'Cảnh báo này đã được xử lý trước đó.' });
  }

  const note = String((req.body && req.body.note) || '').trim();
  securityAlerts.resolve(id, req.user.id, note);
  logAudit(
    req,
    'Xử lý cảnh báo bảo mật',
    'security-alert',
    id,
    note || `tài khoản ${alert.username || '#' + (alert.user_id || '?')}`
  );

  return res.json({ ok: true, alert: toAdminSecurityAlert(findSecurityAlertById(id)) });
});

// Tạm giữ một tài khoản (mặc định 24 giờ). Chỉ admin gọi được.
function applySecurityHold(req, res, userId, hours) {
  const id = Number(userId);
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'Không tìm thấy người dùng.' });
  if (target.id === req.user.id) {
    return res.status(400).json({ error: 'Bạn không thể tự tạm giữ tài khoản của chính mình.' });
  }
  if (target.role === 'admin') {
    return res.status(400).json({ error: 'Không tạm giữ tài khoản quản trị viên. Hãy đổi quyền trước nếu cần.' });
  }

  const heldUntil = securityAlerts.setHold(id, hours);
  if (!heldUntil) return res.status(400).json({ error: 'Không đặt được tạm giữ cho tài khoản này.' });

  logAudit(
    req,
    'Tạm giữ tài khoản',
    'user',
    target.username || id,
    `đến ${new Date(heldUntil).toLocaleString('vi-VN')}`
  );

  return res.json({ ok: true, userId: id, heldUntil });
}

router.post('/security-alerts/:id/hold', (req, res) => {
  const id = Number(req.params.id);
  const alert = findSecurityAlertById(id);
  if (!alert) return res.status(404).json({ error: 'Không tìm thấy cảnh báo.' });
  if (!alert.user_id) {
    return res.status(400).json({
      error: 'Cảnh báo này không gắn với tài khoản nào (có thể tên đăng nhập không tồn tại), nên không thể tạm giữ.'
    });
  }
  const hours = (req.body && req.body.hours) || 24;
  return applySecurityHold(req, res, alert.user_id, hours);
});

router.post('/users/:id/security-hold', (req, res) => {
  const hours = (req.body && req.body.hours) || 24;
  return applySecurityHold(req, res, req.params.id, hours);
});

router.delete('/users/:id/security-hold', (req, res) => {
  const id = Number(req.params.id);
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'Không tìm thấy người dùng.' });

  securityAlerts.clearHold(id);
  logAudit(req, 'Bỏ tạm giữ tài khoản', 'user', target.username || id, '');

  return res.json({ ok: true, userId: id });
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
  const before = db.prepare('SELECT * FROM orders WHERE code = ?').get(code);
  if (!before) {
    return res.status(404).json({ error: 'Không tìm thấy đơn hàng.' });
  }

  const body = req.body || {};

  if (body.status !== undefined && !ORDER_STATUSES.includes(String(body.status))) {
    return res.status(400).json({ error: 'Trạng thái đơn hàng không hợp lệ.' });
  }
  if (body.commission !== undefined && !isMoney(Number(body.commission))) {
    return res.status(400).json({ error: 'Hoa hồng không hợp lệ.' });
  }
  if (body.status === undefined && body.commission === undefined) {
    return res.status(400).json({ error: 'Không có thông tin nào để cập nhật.' });
  }

  const prevStatus = before.status;
  const prevCommission = Number(before.commission) || 0;
  const prevReversed = Number(before.commission_reversed) || 0;
  const prevCredited = isCredited(before);
  const nextStatus = body.status !== undefined ? String(body.status) : prevStatus;
  const nextCredited = isCredited({ status: nextStatus });
  let nextCommission = body.commission !== undefined ? Number(body.commission) : prevCommission;
  let nextReversed = prevReversed;
  let nextReversedAt = before.commission_reversed_at || null;
  const now = new Date().toISOString();

  if (nextStatus === CANCELLED) {
    // Huỷ/hoàn trả: chỉ ghi thu hồi nếu khoản này từng được admin duyệt và
    // đã cộng vào ví. Đơn còn chờ duyệt thì chỉ cần đưa hoa hồng về 0.
    if (prevCredited && prevCommission > 0) {
      nextReversed = prevCommission;
      nextReversedAt = now;
    }
    nextCommission = 0;
  } else if (nextCredited) {
    // Admin duyệt/chốt hoa hồng: khoản tiền mới được tính vào ví.
    // Nếu đơn được khôi phục sau khi từng bị thu hồi, xoá khoản thu hồi cũ.
    if (nextCommission > 0 && (prevStatus === CANCELLED || !prevCredited)) {
      nextReversed = 0;
      nextReversedAt = null;
    }
    if (prevCredited && nextCommission < prevCommission) {
      nextReversed = prevCommission - nextCommission;
      nextReversedAt = now;
    }
  } else {
    // Đang xử lý / chờ đối soát / chờ admin duyệt: chưa cộng vào ví.
    if (prevCredited && nextCommission < prevCommission) {
      // Admin hạ hoa hồng của đơn đã cộng ví -> thu hồi phần chênh lệch.
      nextReversed = prevCommission - nextCommission;
      nextReversedAt = now;
    } else if (nextCommission > 0 && prevStatus === CANCELLED) {
      // Đơn được khôi phục về hàng chờ: khoản thu hồi cũ không còn hiệu lực.
      nextReversed = 0;
      nextReversedAt = null;
    }
  }

  const updates = [];
  const values = [];
  const set = (column, value) => {
    updates.push(`${column} = ?`);
    values.push(value);
  };

  if (body.status !== undefined) set('status', nextStatus);
  set('commission', nextCommission);
  if (nextReversed !== prevReversed) set('commission_reversed', nextReversed);
  if (nextReversedAt !== (before.commission_reversed_at || null)) set('commission_reversed_at', nextReversedAt);

  db.prepare(`UPDATE orders SET ${updates.join(', ')} WHERE code = ?`).run(...values, code);

  const after = findOrderByCode(code);

  // Báo cho người dùng biết đơn của họ vừa thay đổi
  const statusChanged = after.status !== before.status;
  const commissionChanged = Number(after.commission) !== Number(before.commission);
  const reversedChanged = Number(after.commission_reversed) !== prevReversed;

  if (statusChanged || commissionChanged || reversedChanged) {
    const parts = [];
    if (statusChanged) parts.push(`trạng thái: ${after.status}`);
    if (commissionChanged) parts.push(`hoa hồng: ${formatMoney(after.commission)}`);
    if (reversedChanged && after.commission_reversed > 0) {
      parts.push(`thu hồi: ${formatMoney(after.commission_reversed)}`);
    }
    const approvedNow = !isCredited(before) && isCredited(after) && Number(after.commission) > 0;
    notify(before.user_id, {
      title: approvedNow ? `Hoa hồng đơn ${code} đã được duyệt` : `Đơn ${code} đã được cập nhật`,
      body: approvedNow
        ? `Quản trị viên đã duyệt ${formatMoney(after.commission)} hoa hồng cho đơn ${code}. Khoản tiền đã được cộng vào ví.`
        : `Quản trị viên vừa cập nhật ${parts.join(', ')}.`,
      icon: 'file-text'
    });
  }

  const changes = [];
  if (statusChanged) changes.push(`trạng thái ${before.status} → ${after.status}`);
  if (commissionChanged) changes.push(`hoa hồng ${formatMoney(before.commission)} → ${formatMoney(after.commission)}`);
  if (reversedChanged) changes.push(`thu hồi ${formatMoney(after.commission_reversed)}`);
  if (changes.length) logAudit(req, 'Cập nhật đơn hàng', 'order', code, changes.join('; '));

  return res.json({ order: toAdminOrder(after) });
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
           WHERE o.user_id = w.user_id AND ${creditedCondition('o')}) AS commission_total,
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

  // Không cho chi nhiều hơn số dư khả dụng (không tính chính lệnh này).
  // Áp dụng cho MỌI thay đổi (kể cả chỉ sửa số tiền của lệnh đang chờ), tránh âm số dư.
  if (nextStatus !== CANCELLED) {
    if (nextStatus === 'Đã thanh toán' && nextAmount <= 0) {
      return res.status(400).json({ error: 'Vui lòng nhập số tiền thực chi trả trước khi đánh dấu đã thanh toán.' });
    }
    const payable = payableForWithdrawal(row);
    if (nextAmount > payable) {
      return res.status(400).json({
        error: `Số tiền vượt quá số dư khả dụng của người dùng (${formatMoney(payable)}).`
      });
    }
  }

  db.prepare(`UPDATE withdrawals SET ${updates.join(', ')} WHERE code = ?`).run(...values, code);

  // Báo cho người dùng biết lệnh rút của họ vừa thay đổi
  const amountChanged = nextAmount !== (Number(row.amount) || 0);
  if (nextStatus !== row.status || amountChanged) {
    let title = `Lệnh rút ${code} đã được cập nhật`;
    let body = 'Quản trị viên vừa cập nhật lệnh rút tiền của bạn.';

    if (nextStatus === 'Đã thanh toán') {
      title = `Lệnh rút ${code} đã được thanh toán`;
      body = `${formatMoney(nextAmount)} đã được chuyển tới ${row.bank} - ${row.acc_num}.`;
    } else if (nextStatus === CANCELLED) {
      title = `Lệnh rút ${code} đã bị huỷ`;
      body = `Số tiền ${formatMoney(Number(row.amount) || 0)} đã được trả lại vào số dư khả dụng của bạn.`;
    }

    notify(row.user_id, { title, body, icon: 'banknote' });
  }

  const wdChanges = [];
  if (nextStatus !== row.status) wdChanges.push(`trạng thái ${row.status} → ${nextStatus}`);
  if (amountChanged) wdChanges.push(`số tiền ${formatMoney(Number(row.amount) || 0)} → ${formatMoney(nextAmount)}`);
  if (wdChanges.length) {
    logAudit(
      req,
      'Cập nhật lệnh rút',
      'withdrawal',
      code,
      `${row.user_id ? 'người dùng #' + row.user_id + ' — ' : ''}${wdChanges.join('; ')}`
    );
  }

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

/* ==========================================
   Yêu cầu khôi phục mật khẩu

   Người dùng gửi yêu cầu ở trang chủ (POST /api/auth/forgot-password).
   Quản trị viên xem hàng đợi ở đây, đặt lại mật khẩu rồi gửi mật khẩu tạm
   cho người dùng qua Zalo/điện thoại. Mật khẩu tạm CHỈ trả về một lần
   trong phản hồi, không lưu vào database.
========================================== */

router.get('/password-resets', (req, res) => {
  const status = String(req.query.status || '').trim();
  const { limit, offset } = readPaging(req.query);

  const params = [];
  let whereSql = '';
  if (status) {
    if (!RESET_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Trạng thái không hợp lệ.' });
    }
    whereSql = 'WHERE p.status = ?';
    params.push(status);
  }

  const total =
    Number(db.prepare(`SELECT COUNT(*) AS c FROM password_resets p ${whereSql}`).get(...params).c) || 0;

  const rows = db
    .prepare(
      `SELECT p.*, u.name AS user_name, u.username AS user_username,
              u.email AS user_email, u.phone AS user_phone
       FROM password_resets p
       LEFT JOIN users u ON u.id = p.user_id
       ${whereSql}
       ORDER BY CASE WHEN p.status = '${RESET_PENDING}' THEN 0 ELSE 1 END, p.created_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);

  return res.json({ total, limit, offset, resets: rows.map(toAdminPasswordReset) });
});

// Đặt lại mật khẩu: sinh mật khẩu tạm, trả về đúng một lần cho quản trị viên
router.post('/password-resets/:id/reset', (req, res) => {
  const id = Number(req.params.id);
  const request = db.prepare('SELECT * FROM password_resets WHERE id = ?').get(id);
  if (!request) return res.status(404).json({ error: 'Không tìm thấy yêu cầu.' });
  if (request.status !== RESET_PENDING) {
    return res.status(409).json({ error: 'Yêu cầu này đã được xử lý trước đó.' });
  }

  const user = findUserById(request.user_id);
  if (!user) return res.status(404).json({ error: 'Tài khoản của yêu cầu này không còn tồn tại.' });

  const tempPassword = generateTempPassword();
  const hash = bcrypt.hashSync(tempPassword, 10);
  const now = new Date().toISOString();
  const tempPasswordExpiresAt = new Date(
    Date.now() + TEMP_PASSWORD_TTL_HOURS * 60 * 60 * 1000
  ).toISOString();

  // token_version + 1: mọi phiên đăng nhập cũ của tài khoản bị vô hiệu hoá.
  // temp_password_expires_at: mật khẩu tạm hết hạn sau TEMP_PASSWORD_TTL_HOURS giờ.
  db.prepare(
    `UPDATE users
        SET password_hash = ?, token_version = token_version + 1, temp_password_expires_at = ?
      WHERE id = ?`
  ).run(hash, tempPasswordExpiresAt, user.id);
  db.prepare(
    'UPDATE password_resets SET status = ?, resolved_at = ?, resolved_by = ? WHERE id = ?'
  ).run('Đã xử lý', now, req.user.id, id);

  notify(user.id, {
    title: 'Mật khẩu đã được đặt lại',
    body: `Quản trị viên vừa cấp mật khẩu tạm cho tài khoản của bạn. Mật khẩu này chỉ dùng được đến ${new Date(
      tempPasswordExpiresAt
    ).toLocaleString('vi-VN')}. Hãy đổi mật khẩu mới ngay sau khi đăng nhập.`,
    icon: 'key-round'
  });

  // KHÔNG ghi mật khẩu tạm vào nhật ký, chỉ ghi việc đã đặt lại cho ai.
  logAudit(req, 'Đặt lại mật khẩu', 'user', user.username || user.id, `yêu cầu #${id}`);

  return res.json({
    ok: true,
    tempPassword,
    expiresAt: tempPasswordExpiresAt,
    ttlHours: TEMP_PASSWORD_TTL_HOURS,
    user: { id: user.id, name: user.name, username: user.username }
  });
});

// Từ chối yêu cầu (người dùng không xác minh được, hoặc tự nhớ ra mật khẩu)
router.post('/password-resets/:id/cancel', (req, res) => {
  const id = Number(req.params.id);
  const request = db.prepare('SELECT * FROM password_resets WHERE id = ?').get(id);
  if (!request) return res.status(404).json({ error: 'Không tìm thấy yêu cầu.' });
  if (request.status !== RESET_PENDING) {
    return res.status(409).json({ error: 'Yêu cầu này đã được xử lý trước đó.' });
  }

  db.prepare(
    'UPDATE password_resets SET status = ?, resolved_at = ?, resolved_by = ? WHERE id = ?'
  ).run(CANCELLED, new Date().toISOString(), req.user.id, id);

  logAudit(req, 'Từ chối yêu cầu đặt lại mật khẩu', 'password-reset', id, `người dùng #${request.user_id}`);

  return res.json({ ok: true });
});

/* ==========================================
   Đối soát postback (xem lib/postback.js)

   Mạng affiliate gọi vào POST /api/postback/<tên-mạng> mỗi khi có chuyển đổi.
   Mọi lần gọi đều được ghi nguyên tham số vào postback_logs trước khi xử lý,
   nên ở đây xem được cả những lần KHÔNG khớp được đơn nào.
========================================== */

const NETWORK_STATUSES = ['pending', 'approved', 'rejected'];

router.get('/postbacks', (req, res) => {
  const q = String(req.query.q || '').trim();
  const status = String(req.query.status || '').trim().toLowerCase();
  const only = String(req.query.only || '').trim().toLowerCase(); // matched | unmatched | rejected
  const { limit, offset } = readPaging(req.query);

  if (status && status !== 'all' && !NETWORK_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Trạng thái chuyển đổi không hợp lệ.' });
  }

  const conditions = [];
  const params = [];

  if (status && status !== 'all') {
    conditions.push('p.network_status = ?');
    params.push(status);
  }
  if (only === 'matched') conditions.push("p.order_code != '' AND p.action NOT IN ('Từ chối', 'Khớp tạm')");
  if (only === 'unmatched') {
    conditions.push("((p.order_code = '' AND p.action != 'Từ chối') OR p.action = 'Khớp tạm')");
  }
  if (only === 'refused') conditions.push("p.action = 'Từ chối'");
  if (only === 'fallback') conditions.push("p.action = 'Khớp tạm'");
  if (q) {
    const like = '%' + q + '%';
    conditions.push(
      '(p.transaction_id LIKE ? OR p.product_id LIKE ? OR p.order_code LIKE ? OR p.sub_id LIKE ? OR u.name LIKE ?)'
    );
    params.push(like, like, like, like, like);
  }

  const whereSql = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const joinSql = 'FROM postback_logs p LEFT JOIN users u ON u.id = p.user_id';

  const total = Number(db.prepare(`SELECT COUNT(*) AS c ${joinSql} ${whereSql}`).get(...params).c) || 0;

  const rows = db
    .prepare(
      `SELECT p.*, u.name AS user_name, u.username AS user_username
       ${joinSql}
       ${whereSql}
       ORDER BY p.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);

  const stats = db
    .prepare(
      `SELECT
         COUNT(*)                                                                  AS total,
         SUM(CASE WHEN order_code != '' AND action NOT IN ('Từ chối', 'Khớp tạm') THEN 1 ELSE 0 END) AS matched,
         SUM(CASE WHEN (order_code = '' AND action != 'Từ chối') OR action = 'Khớp tạm' THEN 1 ELSE 0 END) AS unmatched,
         SUM(CASE WHEN action = 'Từ chối' THEN 1 ELSE 0 END)                        AS refused,
         -- KHÔNG tính tiền của những lần gọi sai chìa khoá vào thống kê hoa hồng
         COALESCE(SUM(CASE WHEN action != 'Từ chối' THEN reward ELSE 0 END), 0)     AS reward_total,
         COALESCE(SUM(CASE WHEN action != 'Từ chối' AND network_status = 'approved' THEN reward ELSE 0 END), 0) AS approved_total,
         COALESCE(SUM(CASE WHEN action != 'Từ chối' AND network_status = 'pending'  THEN reward ELSE 0 END), 0) AS pending_total
       FROM postback_logs`
    )
    .get();

  return res.json({
    total,
    limit,
    offset,
    stats: {
      total: Number(stats.total) || 0,
      matched: Number(stats.matched) || 0,
      unmatched: Number(stats.unmatched) || 0,
      refused: Number(stats.refused) || 0,
      rewardTotal: Number(stats.reward_total) || 0,
      approvedTotal: Number(stats.approved_total) || 0,
      pendingTotal: Number(stats.pending_total) || 0
    },
    postbacks: rows.map(toAdminPostback)
  });
});

/** Xử lý lại một log cũ — dùng khi postback về trước lúc người dùng tạo đơn. */
router.post('/postbacks/:id/reapply', (req, res) => {
  const id = Number(req.params.id);
  const log = db.prepare('SELECT * FROM postback_logs WHERE id = ?').get(id);
  if (!log) return res.status(404).json({ error: 'Không tìm thấy bản ghi postback.' });

  const result = postback.reapply(id);
  if (!result.ok) return res.status(400).json({ error: result.error || 'Không xử lý lại được.' });

  logAudit(
    req,
    'Xử lý lại postback',
    'postback',
    id,
    result.matched ? `đã khớp${log.order_code ? ' đơn ' + log.order_code : ''}` : 'không khớp đơn nào'
  );

  const after = db
    .prepare(
      `SELECT p.*, u.name AS user_name, u.username AS user_username
       FROM postback_logs p LEFT JOIN users u ON u.id = p.user_id WHERE p.id = ?`
    )
    .get(id);

  return res.json({ ok: true, matched: Boolean(result.matched), postback: toAdminPostback(after) });
});

/* ==========================================
   Nhật ký quản trị
   ========================================== */

router.get('/audit-logs', (req, res) => {
  const { limit, offset } = readPaging(req.query);
  const q = String(req.query.q || '').trim();

  let where = '';
  const params = [];
  if (q) {
    where = 'WHERE (action LIKE ? OR target_id LIKE ? OR actor_username LIKE ? OR detail LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }

  const total = Number(db.prepare(`SELECT COUNT(*) AS c FROM admin_audit_logs ${where}`).get(...params).c) || 0;
  const rows = db
    .prepare(`SELECT * FROM admin_audit_logs ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);

  return res.json({ total, limit, offset, logs: rows.map(toAdminAudit) });
});

module.exports = router;
