'use strict';

/**
 * Tính tiền hoa hồng của người dùng.
 *
 * Có 3 khái niệm tách biệt:
 *  - commission  : tiền hoa hồng đã được ghi cho người dùng (mạng đã duyệt hoặc admin chốt).
 *  - tạm giữ      : phần hoa hồng đã ghi nhưng CHƯA được phép rút (chờ đối soát hoặc còn
 *                   trong thời gian giữ COMMISSION_HOLD_DAYS).
 *  - đã rút       : tổng các lệnh rút không bị huỷ.
 *
 * Số dư khả dụng = commission - tạm giữ - đã rút.
 * Nếu âm (ví dụ mạng báo huỷ sau khi khách đã rút), phần âm là khoản khách còn nợ lại;
 * các hoa hồng sau này sẽ tự trừ vào khoản nợ đó.
 */

const db = require('../db');
const { CANCELLED, AWAITING_RECONCILE } = require('./constants');

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_HOLD_DAYS = 7;
const ONGOING = 'Hoàn thành';
const SETTLED = 'Đã thanh toán';

// SQLite lưu thời gian dạng ISO (2026-10-20T11:00:27.466Z).
// Dùng đúng định dạng đó để so sánh chuỗi vẫn đúng thứ tự thời gian.
const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

/** Số ngày giữ hoa hồng sau khi mạng duyệt. 0 = không giữ (trả ngay). */
function holdDays() {
  const raw = Number(process.env.COMMISSION_HOLD_DAYS);
  if (!Number.isFinite(raw)) return DEFAULT_HOLD_DAYS;
  return Math.min(365, Math.max(0, Math.floor(raw)));
}

/** Thời điểm sớm nhất có thể rút khoản hoa hồng vừa được duyệt. */
function releaseAt(from = Date.now()) {
  const days = holdDays();
  if (days <= 0) return new Date(from).toISOString();
  return new Date(from + days * DAY_MS).toISOString();
}

/**
 * Biểu thức SQL trả về phần hoa hồng đang tạm giữ của một đơn.
 * Dùng chung cho API người dùng, API quản trị và các câu tổng hợp.
 */
function heldExpr(alias = '') {
  const p = alias ? alias + '.' : '';
  return `CASE
    WHEN ${p}status IN ('${CANCELLED}', '${SETTLED}') THEN 0
    WHEN ${p}status = '${AWAITING_RECONCILE}' THEN ${p}commission
    WHEN ${p}status != '${ONGOING}' THEN ${p}commission
    WHEN ${p}commission_available_at IS NOT NULL
         AND ${p}commission_available_at > ${NOW_SQL} THEN ${p}commission
    ELSE 0
  END`;
}

/** Biểu thức SQL trả về số hoa hồng đã bị thu hồi (đơn bị huỷ/hoàn trả). */
function reversedExpr(alias = '') {
  const p = alias ? alias + '.' : '';
  return `CASE WHEN ${p}status = '${CANCELLED}' THEN COALESCE(${p}commission_reversed, 0) ELSE 0 END`;
}

/** Một đơn có đang bị giữ tiền hay không (dùng cho giao diện). */
function isHeld(row, now = Date.now()) {
  if (!row) return false;
  const commission = Number(row.commission) || 0;
  if (commission <= 0) return false;
  if (row.status === CANCELLED || row.status === SETTLED) return false;
  if (row.status !== ONGOING) return true;
  if (!row.commission_available_at) return false;
  const release = new Date(row.commission_available_at).getTime();
  return Number.isFinite(release) && release > now;
}

/** Tính toàn bộ số dư của một người dùng. */
function computeUserMoney(userId) {
  const order = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN status != ? THEN commission ELSE 0 END), 0) AS commission_total,
         COALESCE(SUM(${heldExpr()}), 0) AS held_total,
         COALESCE(SUM(${reversedExpr()}), 0) AS clawback_total
       FROM orders
       WHERE user_id = ?`
    )
    .get(CANCELLED, userId);

  const wd = db
    .prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM withdrawals WHERE user_id = ? AND status != ?')
    .get(userId, CANCELLED);

  const totalCommission = Number(order.commission_total) || 0;
  const heldCommission = Number(order.held_total) || 0;
  const withdrawn = Number(wd.total) || 0;
  const balance = totalCommission - heldCommission - withdrawn;

  return {
    totalCommission,
    heldCommission,
    withdrawn,
    balance,
    debt: Math.max(0, -balance),
    clawback: Number(order.clawback_total) || 0
  };
}

module.exports = {
  holdDays,
  releaseAt,
  heldExpr,
  reversedExpr,
  isHeld,
  computeUserMoney,
  NOW_SQL,
  SETTLED,
  ONGOING,
  DEFAULT_HOLD_DAYS
};
