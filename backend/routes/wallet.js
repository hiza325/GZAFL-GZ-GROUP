'use strict';

const express = require('express');
const db = require('../db');
const { toWithdrawal, toUser } = require('../lib/serialize');
const { generateWithdrawalCode } = require('../lib/validate');
const { requireAuth } = require('../lib/auth');
const { notify } = require('../lib/notify');
const { formatMoney } = require('../lib/format');
const { WITHDRAWAL_MIN, CANCELLED } = require('../lib/constants');
const { isValidBankName } = require('../lib/banks');
const { computeUserMoney, creditedCondition } = require('../lib/money');

const router = express.Router();
router.use(requireAuth);

function computeBalance(userId) {
  return computeUserMoney(userId);
}

/* ==========================================
   Số liệu cho dashboard.
   Trước đây dashboard tự vẽ biểu đồ bằng HTML tĩnh nên hiển thị số giả.
   Giờ mọi con số đều tính từ bảng orders của chính người dùng.
   ========================================== */
function monthKey(date) {
  return date.toISOString().slice(0, 7);
}

function monthLabel(key) {
  const parts = String(key).split('-');
  return `T${Number(parts[1])}/${String(parts[0]).slice(2)}`;
}

function computeInsights(userId) {
  const now = new Date();
  const thisMonth = monthKey(now);

  const monthRow = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN ${creditedCondition()} THEN commission ELSE 0 END), 0) AS commission,
         COUNT(*) AS orders
       FROM orders WHERE user_id = ? AND substr(created_at, 1, 7) = ?`
    )
    .get(userId, thisMonth);

  const byPlatform = db
    .prepare(
      `SELECT platform,
              COALESCE(SUM(CASE WHEN ${creditedCondition()} THEN commission ELSE 0 END), 0) AS commission,
              COUNT(*) AS orders
       FROM orders WHERE user_id = ?
       GROUP BY platform
       ORDER BY commission DESC, orders DESC`
    )
    .all(userId)
    .map((row) => ({
      platform: String(row.platform || 'Khác'),
      commission: Number(row.commission) || 0,
      orders: Number(row.orders) || 0
    }));

  // 6 tháng gần nhất, tháng nào không có đơn thì trả 0 (biểu đồ không bị lệch)
  const keys = [];
  for (let i = 5; i >= 0; i -= 1) {
    keys.push(monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))));
  }
  const rows = db
    .prepare(
      `SELECT substr(created_at, 1, 7) AS m,
              COALESCE(SUM(commission), 0) AS commission
       FROM orders
       WHERE user_id = ? AND ${creditedCondition()} AND substr(created_at, 1, 7) >= ?
       GROUP BY m`
    )
    .all(userId, keys[0]);

  const monthlyMap = new Map(rows.map((row) => [row.m, Number(row.commission) || 0]));
  const monthly = keys.map((key) => ({
    key,
    label: monthLabel(key),
    commission: monthlyMap.get(key) || 0
  }));

  return {
    month: {
      key: thisMonth,
      commission: Number(monthRow.commission) || 0,
      orders: Number(monthRow.orders) || 0
    },
    byPlatform,
    monthly
  };
}

/** Lỗi có mã HTTP để ném ra từ bên trong transaction rồi trả về cho client. */
function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

router.get('/', (req, res) => {
  const userId = req.user.id;

  const stats = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status IN ('Đang xử lý', 'Chờ đối soát', 'Chờ admin duyệt') THEN 1 ELSE 0 END) AS pending,
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
    insights: computeInsights(userId),
    balance: money.balance,
    totalCommission: money.totalCommission,
    // Tiền đã cộng vào ví từ việc đổi điểm giới thiệu (100 điểm = 1.000đ)
    pointsValue: money.pointsValue,
    withdrawn: money.withdrawn,
    debt: money.debt,
    clawback: money.clawback,
    minWithdraw: WITHDRAWAL_MIN,
    canWithdraw: money.balance >= WITHDRAWAL_MIN,
    withdrawals: withdrawals.map(toWithdrawal)
  });
});

router.post('/withdrawals', (req, res) => {
  const bank = String((req.body && req.body.bank) || '').trim();
  const accNum = String((req.body && req.body.accNum) || '').trim();
  const accName = String((req.body && req.body.accName) || '').trim();

  // Ảnh QR nhận tiền người dùng đã tải lên (xem routes/profile.js -> POST /bank-qr).
  const qrUrl = req.user.bank_qr_url || null;

  // Người dùng chỉ cần chọn 1 trong 2 cách nhận tiền:
  //   'account' = nhập số tài khoản, 'qr' = chỉ tải ảnh QR (ảnh QR đã có sẵn số tài khoản).
  // Không gửi kèm `mode` (ví dụ gọi API trực tiếp) thì tự suy ra từ dữ liệu gửi lên.
  let mode = String((req.body && req.body.mode) || '').trim();
  if (mode !== 'qr' && mode !== 'account') {
    mode = qrUrl && !accNum && !accName ? 'qr' : 'account';
  }

  if (mode === 'qr') {
    if (!qrUrl) {
      return res.status(400).json({
        error: 'Bạn chưa tải lên ảnh QR nhận tiền. Vui lòng tải ảnh QR lên, hoặc chuyển sang cách nhập số tài khoản.'
      });
    }
    // Nhận tiền bằng ảnh QR thì không cần ngân hàng / số tài khoản / tên chủ tài khoản
  } else {
    if (!isValidBankName(bank)) {
      return res.status(400).json({ error: 'Vui lòng chọn ngân hàng/ví điện tử nhận tiền (hoặc ghi rõ tên ngân hàng khác).' });
    }
    if (!accNum || !accName) {
      return res.status(400).json({
        error: 'Vui lòng điền đầy đủ số tài khoản và tên chủ tài khoản, hoặc tải lên ảnh QR nhận tiền!'
      });
    }
  }

  if (accNum && !/^[0-9]{6,20}$/.test(accNum)) {
    return res.status(400).json({ error: 'Số tài khoản/số điện thoại ví phải là 6-20 chữ số.' });
  }
  if (accName.length > 60) {
    return res.status(400).json({ error: 'Tên chủ tài khoản quá dài (tối đa 60 ký tự).' });
  }

  // Kiểm tra + ghi nằm trong CÙNG một transaction: khi chạy nhiều tiến trình,
  // hai yêu cầu đồng thời không thể cùng đọc "chưa có lệnh chờ" rồi cùng tạo lệnh.
  let created;
  try {
    created = db.transaction(() => {
      // Mỗi người chỉ được có 1 lệnh chờ xử lý, tránh bấm gửi liên tục
      const pending = db
        .prepare("SELECT code FROM withdrawals WHERE user_id = ? AND status = 'Đang xử lý'")
        .get(req.user.id);
      if (pending) {
        throw httpError(
          409,
          `Bạn đang có lệnh rút ${pending.code} chờ xử lý. Vui lòng đợi quản trị viên xử lý xong rồi gửi lệnh mới.`
        );
      }

      // Không có đủ tiền thì không cho gửi yêu cầu (trước đây số dư 0đ vẫn gửi được)
      const money = computeBalance(req.user.id);
      if (money.balance < WITHDRAWAL_MIN) {
        const debtText = money.debt > 0 ? ` Bạn đang cần hoàn lại: ${formatMoney(money.debt)}.` : '';
        throw httpError(
          400,
          `Số dư khả dụng tối thiểu để rút là ${formatMoney(WITHDRAWAL_MIN)}. ` +
            `Số dư hiện tại của bạn: ${formatMoney(money.balance)}.` +
            debtText
        );
      }

      let code = null;
      for (let attempt = 0; attempt < 20; attempt++) {
        const candidate = generateWithdrawalCode();
        if (!db.prepare('SELECT 1 AS x FROM withdrawals WHERE code = ?').get(candidate)) {
          code = candidate;
          break;
        }
      }
      if (!code) throw httpError(500, 'Không tạo được mã giao dịch.');

      // Ghi nhận luôn số tiền = toàn bộ số dư khả dụng tại thời điểm gửi.
      // Nhờ vậy số tiền này được giữ chỗ ngay, không thể rút trùng.
      const amount = money.balance;

      const info = db
        .prepare(
          `INSERT INTO withdrawals (user_id, code, bank, acc_num, acc_name, qr_url, amount, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'Đang xử lý', ?)`
        )
        .run(req.user.id, code, bank, accNum, accName, qrUrl, amount, new Date().toISOString());

      // Chỉ lưu làm thông tin nhận tiền mặc định khi người dùng nhập số tài khoản.
      // Chọn cách "ảnh QR" thì giữ nguyên thông tin ngân hàng đã lưu trước đó (không xoá).
      if (mode === 'account') {
        db.prepare('UPDATE users SET bank_bank = ?, bank_acc_num = ?, bank_acc_name = ? WHERE id = ?').run(
          bank,
          accNum,
          accName,
          req.user.id
        );
      }

      // Nội dung thông báo: nhập số tài khoản thì ghi rõ, dùng ảnh QR thì ghi là qua ảnh QR
      const target = accNum
        ? `${bank} - ${accNum}`
        : `qua ảnh QR nhận tiền${bank ? ' (' + bank + ')' : ''}`;

      notify(req.user.id, {
        title: `Đã gửi yêu cầu rút ${code}`,
        body: `Số tiền ${formatMoney(amount)} về ${target}. Quản trị viên sẽ xử lý trong thời gian sớm nhất.`,
        icon: 'banknote'
      });

      return { info, amount };
    });
  } catch (err) {
    if (err && err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }

  const row = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(Number(created.info.lastInsertRowid));
  const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

  return res.status(201).json({
    withdrawal: toWithdrawal(row),
    user: toUser(userRow),
    balance: computeBalance(req.user.id).balance
  });
});

/**
 * Người dùng tự huỷ lệnh rút đang chờ.
 * Trước đây mỗi tài khoản chỉ được có 1 lệnh chờ: nếu khách gửi sai thông tin
 * thì bị chặn rút cho tới khi admin xử lý. Huỷ được thì số tiền trả lại ngay
 * vào số dư khả dụng (vì số dư = hoa hồng đã duyệt - lệnh rút không bị huỷ).
 */
router.delete('/withdrawals/:code', (req, res) => {
  const code = String(req.params.code || '').trim().toUpperCase();

  let updated;
  try {
    updated = db.transaction(() => {
      const row = db
        .prepare('SELECT * FROM withdrawals WHERE code = ? AND user_id = ?')
        .get(code, req.user.id);
      if (!row) throw httpError(404, 'Không tìm thấy lệnh rút tiền.');
      if (row.status !== 'Đang xử lý') {
        throw httpError(
          409,
          `Lệnh rút ${code} đang ở trạng thái "${row.status}" nên không thể huỷ.`
        );
      }

      db.prepare('UPDATE withdrawals SET status = ? WHERE id = ?').run(CANCELLED, row.id);

      notify(req.user.id, {
        title: `Đã huỷ lệnh rút ${code}`,
        body: `Số tiền ${formatMoney(Number(row.amount) || 0)} đã được trả lại vào số dư khả dụng.`,
        icon: 'rotate-ccw'
      });

      return db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(row.id);
    });
  } catch (err) {
    if (err && err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }

  return res.json({
    withdrawal: toWithdrawal(updated),
    balance: computeBalance(req.user.id).balance
  });
});

module.exports = router;
