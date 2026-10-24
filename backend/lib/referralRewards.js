'use strict';

/**
 * Cộng điểm thưởng cho NGƯỜI NHẬP mã giới thiệu.
 *
 * Quy tắc:
 *  - Nhập mã chỉ ghi nhận lượt nhập; chưa cộng điểm ngay.
 *  - Khi người nhập mã có ít nhất một đơn hàng không bị huỷ thì mới cộng 100 điểm.
 *  - Nếu người đó đã có đơn hàng TRƯỚC khi nhập mã, cộng điểm ngay lúc nhập.
 *  - Mỗi lượt nhập chỉ cộng một lần. Transaction + điều kiện rewarded_at IS NULL
 *    bảo đảm hai đơn tạo đồng thời không cộng trùng.
 */

const db = require('../db');
const { notify } = require('./notify');
const { CANCELLED, REFERRAL_REWARD_POINTS } = require('./constants');

/** Tìm một đơn đủ điều kiện của người dùng (bỏ qua đơn đã huỷ). */
function findQualifyingOrder(userId, orderId = null) {
  if (orderId) {
    return (
      db
        .prepare(
          `SELECT id, code FROM orders
           WHERE id = ? AND user_id = ? AND status != ?
           LIMIT 1`
        )
        .get(orderId, userId, CANCELLED) || null
    );
  }

  return (
    db
      .prepare(
        `SELECT id, code FROM orders
         WHERE user_id = ? AND status != ?
         ORDER BY id ASC
         LIMIT 1`
      )
      .get(userId, CANCELLED) || null
  );
}

/**
 * Cộng điểm cho lượt nhập mã đang chờ của người dùng, nếu đã có đơn hợp lệ.
 *
 * @param {number} userId Người đã nhập mã (người nhận điểm).
 * @param {number|null} orderId Đơn vừa tạo, nếu hàm được gọi từ luồng tạo đơn.
 * @returns {{points:number, code:string, orderId:number, orderCode:string}|null}
 */
function awardReferralIfEligible(userId, orderId = null) {
  return db.transaction(() => {
    const pending = db
      .prepare(
        `SELECT id, code FROM referrals
         WHERE user_id = ? AND rewarded_at IS NULL
         ORDER BY id DESC
         LIMIT 1`
      )
      .get(userId);

    if (!pending) return null;

    const order = findQualifyingOrder(userId, orderId);
    if (!order) return null;

    const updated = db
      .prepare(
        `UPDATE referrals
         SET points = ?, rewarded_at = ?, rewarded_order_id = ?
         WHERE id = ? AND rewarded_at IS NULL`
      )
      .run(REFERRAL_REWARD_POINTS, new Date().toISOString(), order.id, pending.id);

    if (!updated.changes) return null;

    db.prepare('UPDATE users SET points = points + ? WHERE id = ?').run(
      REFERRAL_REWARD_POINTS,
      userId
    );

    notify(userId, {
      title: 'Đã cộng điểm giới thiệu',
      body: `Bạn vừa nhận ${REFERRAL_REWARD_POINTS} điểm từ mã ${pending.code} sau khi có đơn hàng ${order.code}.`,
      icon: 'gift'
    });

    return {
      points: REFERRAL_REWARD_POINTS,
      code: pending.code,
      orderId: order.id,
      orderCode: order.code
    };
  });
}

module.exports = { awardReferralIfEligible };
