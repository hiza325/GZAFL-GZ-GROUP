'use strict';

const express = require('express');
const db = require('../db');
const { formatDateTime } = require('../lib/format');
const { REFERRAL_CODE_LENGTH } = require('../lib/validate');
const { requireAuth } = require('../lib/auth');
const { notify } = require('../lib/notify');
const { formatMoney } = require('../lib/format');
const {
  POINT_VALUE,
  POINT_REDEEM_MIN,
  POINT_REDEEM_STEP,
  REFERRAL_REWARD_POINTS
} = require('../lib/constants');
const { computeUserMoney } = require('../lib/money');
const { awardReferralIfEligible } = require('../lib/referralRewards');

const router = express.Router();
router.use(requireAuth);

function getHistory(userId) {
  return db
    .prepare('SELECT * FROM referrals WHERE user_id = ? ORDER BY id DESC')
    .all(userId)
    .map((row) => {
      const rewardedAt = row.rewarded_at || null;
      return {
        code: row.code,
        date: formatDateTime(row.created_at),
        points: Number(row.points) || 0,
        rewardPoints: REFERRAL_REWARD_POINTS,
        // Mã đã được ghi nhận nhưng còn chờ người dùng tạo đơn hàng đầu tiên.
        pending: !rewardedAt,
        rewardedAt,
        rewardedDate: rewardedAt ? formatDateTime(rewardedAt) : null,
        rewardedOrderId: row.rewarded_order_id ? Number(row.rewarded_order_id) : null
      };
    });
}

/** Đếm số mã đã cộng điểm và số mã đang chờ đơn hàng. */
function countReferrals(history) {
  const credited = history.filter((item) => !item.pending).length;
  return {
    redeemedCount: history.length,
    creditedCount: credited,
    pendingCount: history.length - credited
  };
}

/** Các lần đổi điểm gần nhất, để người dùng đối chiếu với số dư ví. */
function getRedemptions(userId) {
  return db
    .prepare(
      `SELECT points, amount, created_at FROM point_redemptions
       WHERE user_id = ? ORDER BY id DESC LIMIT 20`
    )
    .all(userId)
    .map((row) => ({
      points: Number(row.points) || 0,
      amount: Number(row.amount) || 0,
      date: formatDateTime(row.created_at)
    }));
}

router.get('/', (req, res) => {
  const history = getHistory(req.user.id);
  const points = Number(req.user.points) || 0;
  const redemptions = getRedemptions(req.user.id);
  return res.json({
    code: req.user.referral_code,
    points,
    ...countReferrals(history),
    rewardPoints: REFERRAL_REWARD_POINTS,
    history,
    // Quy đổi điểm sang ví: 100 điểm = 1.000đ (1 điểm = 10đ)
    pointValue: POINT_VALUE,
    minRedeemPoints: POINT_REDEEM_MIN,
    redeemStep: POINT_REDEEM_STEP,
    pointsInMoney: points * POINT_VALUE,
    redemptions
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

  // Kiểm tra "đã nhập chưa" + ghi lịch sử + cộng điểm trong CÙNG một transaction:
  // khi chạy nhiều tiến trình, hai request đồng thời không thể cùng lọt qua bước
  // kiểm tra rồi cộng điểm hai lần.
  let result;
  try {
    result = db.transaction(() => {
      // Mỗi tài khoản chỉ được nhập mã giới thiệu MỘT lần (tránh nhập hàng loạt mã để farm điểm)
      const used = db.prepare('SELECT 1 AS x FROM referrals WHERE user_id = ?').get(req.user.id);
      if (used) throw Object.assign(new Error('Mỗi tài khoản chỉ nhập được mã giới thiệu một lần.'), { status: 409 });

      db.prepare(
        `INSERT INTO referrals (user_id, code, points, rewarded_at, rewarded_order_id, created_at)
         VALUES (?, ?, 0, NULL, NULL, ?)`
      ).run(req.user.id, code, new Date().toISOString());

      // Người dùng đã có đơn từ trước? Cộng điểm ngay. Nếu chưa, lượt nhập
      // nằm chờ và sẽ được cộng khi đơn hàng đầu tiên được tạo.
      const reward = awardReferralIfEligible(req.user.id);

      if (!reward) {
        notify(req.user.id, {
          title: 'Đã ghi nhận mã giới thiệu',
          body: `Mã ${code} đã được ghi nhận. Bạn sẽ nhận ${REFERRAL_REWARD_POINTS} điểm sau khi tạo đơn hàng đầu tiên.`,
          icon: 'user-plus'
        });
      }

      const updated = db.prepare('SELECT points FROM users WHERE id = ?').get(req.user.id);
      const history = getHistory(req.user.id);
      return {
        points: Number(updated && updated.points) || 0,
        history,
        counts: countReferrals(history),
        rewarded: !!reward,
        reward
      };
    });
  } catch (err) {
    if (err && err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }

  return res.json({
    message: result.rewarded
      ? `Nhập mã thành công! Bạn vừa nhận được ${REFERRAL_REWARD_POINTS} điểm từ mã ${code}.`
      : `Đã ghi nhận mã ${code}. Bạn sẽ nhận ${REFERRAL_REWARD_POINTS} điểm sau khi tạo đơn hàng đầu tiên.`,
    points: result.points,
    pending: !result.rewarded,
    rewardPoints: REFERRAL_REWARD_POINTS,
    reward: result.reward,
    ...result.counts,
    history: result.history
  });
});

/**
 * Đổi điểm giới thiệu sang tiền trong ví.
 * Tỷ lệ cố định: 100 điểm = 1.000đ. Chỉ nhận bội số của 100 điểm và tối thiểu 100
 * điểm, để số tiền cộng vào ví luôn chẵn nghìn và dễ đối soát.
 *
 * Điểm bị trừ và tiền được ghi nhận trong CÙNG một transaction: nếu lỗi giữa
 * chừng thì không có chuyện mất điểm mà ví không được cộng.
 */
router.post('/convert', (req, res) => {
  const points = Number(req.body && req.body.points);

  if (!Number.isInteger(points) || points <= 0) {
    return res.status(400).json({ error: 'Số điểm cần đổi không hợp lệ.' });
  }
  if (points < POINT_REDEEM_MIN) {
    return res.status(400).json({
      error: `Số điểm đổi tối thiểu là ${POINT_REDEEM_MIN} điểm (${formatMoney(POINT_REDEEM_MIN * POINT_VALUE)}).`
    });
  }
  if (points % POINT_REDEEM_STEP !== 0) {
    return res.status(400).json({
      error: `Số điểm đổi phải là bội số của ${POINT_REDEEM_STEP} điểm (ví dụ ${POINT_REDEEM_STEP}, ${POINT_REDEEM_STEP * 2}, ${POINT_REDEEM_STEP * 3}...).`
    });
  }

  const amount = points * POINT_VALUE;

  let updated;
  try {
    updated = db.transaction(() => {
      // Đọc lại số điểm bên trong transaction: hai request đồng thời không thể
      // cùng đổi vượt quá số điểm đang có.
      const row = db.prepare('SELECT points FROM users WHERE id = ?').get(req.user.id);
      const available = Number(row && row.points) || 0;
      if (available < points) {
        throw Object.assign(
          new Error(`Bạn chỉ có ${available} điểm, không đủ để đổi ${points} điểm.`),
          { status: 400 }
        );
      }

      db.prepare('UPDATE users SET points = points - ? WHERE id = ?').run(points, req.user.id);
      db.prepare(
        'INSERT INTO point_redemptions (user_id, points, amount, created_at) VALUES (?, ?, ?, ?)'
      ).run(req.user.id, points, amount, new Date().toISOString());

      notify(req.user.id, {
        title: 'Đổi điểm thành công',
        body: `${points} điểm đã được đổi thành ${formatMoney(amount)} và cộng vào số dư ví của bạn.`,
        icon: 'wallet'
      });

      return db.prepare('SELECT points FROM users WHERE id = ?').get(req.user.id);
    });
  } catch (err) {
    if (err && err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }

  return res.json({
    message: `Đã đổi ${points} điểm thành ${formatMoney(amount)} vào ví.`,
    points: Number(updated.points) || 0,
    amount,
    balance: computeUserMoney(req.user.id).balance
  });
});

module.exports = router;
