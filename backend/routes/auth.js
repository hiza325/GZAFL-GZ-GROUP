'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { toUser } = require('../lib/serialize');
const { isValidUsername, isValidEmail, generateReferralCode } = require('../lib/validate');
const { setAuthCookie, clearAuthCookie, loadUser } = require('../lib/auth');
const { rateLimit } = require('../lib/rateLimit');
const { RESET_PENDING } = require('../lib/constants');

const router = express.Router();

// Chống dò mật khẩu: tối đa 30 lần / phút / IP cho các endpoint đăng nhập-đăng ký
router.use(rateLimit({ windowMs: 60 * 1000, max: 30 }));

const BCRYPT_ROUNDS = 10;

router.post('/register', (req, res) => {
  const username = String((req.body && req.body.username) || '').trim();
  const password = String((req.body && req.body.password) || '').trim();
  const name = String((req.body && req.body.name) || '').trim();

  if (!username || !password) return res.status(400).json({ error: 'Vui lòng điền đầy đủ thông tin.' });
  if (!name) return res.status(400).json({ error: 'Vui lòng nhập tên hiển thị.' });
  if (!isValidUsername(username)) {
    return res.status(400).json({ error: 'Định dạng không hợp lệ. Vui lòng nhập đúng Email hoặc Số điện thoại.' });
  }
  if (password.length < 6) return res.status(400).json({ error: 'Mật khẩu phải có ít nhất 6 ký tự.' });

  const exists = db.prepare('SELECT 1 AS x FROM users WHERE username = ?').get(username);
  if (exists) return res.status(409).json({ error: 'Email hoặc Số điện thoại này đã được đăng ký.' });

  const passwordHash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
  const referralCode = generateReferralCode(db);
  const isEmail = isValidEmail(username);

  const info = db
    .prepare(
      `INSERT INTO users (username, password_hash, name, email, phone, referral_code, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      username,
      passwordHash,
      name,
      isEmail ? username : '',
      isEmail ? '' : username,
      referralCode,
      new Date().toISOString()
    );

  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(info.lastInsertRowid));
  return res.status(201).json({ user: toUser(row) });
});

router.post('/login', (req, res) => {
  const username = String((req.body && req.body.username) || '').trim();
  const password = String((req.body && req.body.password) || '').trim();

  if (!username || !password) return res.status(400).json({ error: 'Vui lòng điền đầy đủ thông tin.' });

  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!row) return res.status(401).json({ error: 'Tài khoản này chưa được đăng ký.' });
  if (!bcrypt.compareSync(password, row.password_hash)) {
    return res.status(401).json({ error: 'Mật khẩu không chính xác.' });
  }

  setAuthCookie(res, row);
  return res.json({ user: toUser(row) });
});

router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  return res.json({ ok: true });
});

// Trả về user hiện tại, hoặc null nếu chưa đăng nhập (không gây lỗi 401)
router.get('/me', (req, res) => {
  const row = loadUser(req);
  return res.json({ user: toUser(row) });
});

/* ==========================================
   Quên mật khẩu

   Người dùng KHÔNG thể tự đặt lại mật khẩu ngay, vì hệ thống chưa có kênh
   gửi email/SMS để xác minh danh tính. Thay vào đó yêu cầu được đưa vào
   hàng đợi cho quản trị viên (xem routes/admin.js -> /password-resets),
   quản trị viên đặt lại rồi gửi mật khẩu tạm qua kênh liên hệ.

   Luôn trả về CÙNG MỘT thông báo dù tài khoản có tồn tại hay không, để
   người ngoài không dò được danh sách tài khoản đang có.
   ========================================== */
const FORGOT_PASSWORD_MESSAGE =
  'Nếu tài khoản tồn tại, yêu cầu đã được gửi tới quản trị viên. Vui lòng liên hệ Zalo/email hỗ trợ để nhận mật khẩu mới.';

router.post('/forgot-password', (req, res) => {
  const username = String((req.body && req.body.username) || '').trim();
  const note = String((req.body && req.body.note) || '').trim().slice(0, 300);

  if (!username) return res.status(400).json({ error: 'Vui lòng nhập Email hoặc Số điện thoại.' });

  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

  if (row) {
    const now = new Date().toISOString();
    const pending = db
      .prepare('SELECT id, note FROM password_resets WHERE user_id = ? AND status = ?')
      .get(row.id, RESET_PENDING);

    if (pending) {
      // Đã có yêu cầu đang chờ: cập nhật lại nội dung và đẩy lên đầu danh sách
      db.prepare('UPDATE password_resets SET note = ?, created_at = ? WHERE id = ?').run(
        note || pending.note || '',
        now,
        pending.id
      );
    } else {
      db.prepare(
        'INSERT INTO password_resets (user_id, status, note, created_at) VALUES (?, ?, ?, ?)'
      ).run(row.id, RESET_PENDING, note, now);
    }
  }

  return res.json({ ok: true, message: FORGOT_PASSWORD_MESSAGE });
});

module.exports = router;
