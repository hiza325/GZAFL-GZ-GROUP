'use strict';

/**
 * Tính tiền hoa hồng của người dùng.
 *
 * Quy tắc hiện tại:
 *  - Mạng affiliate báo "đã duyệt" -> đơn chỉ chuyển sang "Chờ admin duyệt".
 *    Khoản `commission` lúc này là số DỰ KIẾN, CHƯA cộng vào ví.
 *  - Quản trị viên duyệt đơn (chuyển "Hoàn thành"/"Đã thanh toán") thì khoản đó
 *    mới được tính vào số dư khả dụng.
 *  - Không còn cơ chế tạm giữ theo số ngày.
 *  - Số dư khả dụng = hoa hồng đã được admin duyệt - tiền đã rút + tiền đổi từ điểm.
 *  - Điểm giới thiệu đổi sang tiền theo POINT_VALUE (100 điểm = 1.000đ), ghi vào
 *    bảng point_redemptions để không mất dấu khi đối soát.
 *  - Nếu mạng báo huỷ sau khi đã duyệt/đã chi trả, khoản chênh lệch được ghi
 *    vào `commission_reversed`; số dư có thể âm (khoản khách cần hoàn lại) và
 *    sẽ tự trừ vào các hoa hồng sau.
 */

const db = require('../db');
const { CANCELLED } = require('./constants');

const ONGOING = 'Hoàn thành';
const SETTLED = 'Đã thanh toán';
const CREDITED_STATUSES = [ONGOING, SETTLED];

/** Đơn đã được admin duyệt và đang được tính vào số dư. */
function isCredited(row) {
  return Boolean(row && CREDITED_STATUSES.includes(row.status));
}

/** Điều kiện SQL: đơn đã được admin duyệt. */
function creditedCondition(alias = '') {
  const p = alias ? alias + '.' : '';
  return `${p}status IN ('${ONGOING}', '${SETTLED}')`;
}

/** Biểu thức SQL trả về số hoa hồng đã bị thu hồi (đơn bị huỷ/hoàn trả). */
function reversedExpr(alias = '') {
  const p = alias ? alias + '.' : '';
  return `COALESCE(${p}commission_reversed, 0)`;
}

/** Tính toàn bộ số dư của một người dùng. */
function computeUserMoney(userId) {
  const order = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN ${creditedCondition()} THEN commission ELSE 0 END), 0) AS commission_total,
         COALESCE(SUM(${reversedExpr()}), 0) AS clawback_total
       FROM orders
       WHERE user_id = ?`
    )
    .get(userId);

  const wd = db
    .prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM withdrawals WHERE user_id = ? AND status != ?')
    .get(userId, CANCELLED);

  const redeemed = db
    .prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM point_redemptions WHERE user_id = ?')
    .get(userId);

  const totalCommission = Number(order.commission_total) || 0;
  const withdrawn = Number(wd.total) || 0;
  const pointsValue = Number(redeemed.total) || 0;
  const balance = totalCommission - withdrawn + pointsValue;

  return {
    totalCommission,
    withdrawn,
    pointsValue,
    balance,
    debt: Math.max(0, -balance),
    clawback: Number(order.clawback_total) || 0
  };
}

module.exports = {
  creditedCondition,
  reversedExpr,
  isCredited,
  computeUserMoney,
  CREDITED_STATUSES,
  SETTLED,
  ONGOING
};
