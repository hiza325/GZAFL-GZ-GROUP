'use strict';

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { toUser } = require('../lib/serialize');
const { isValidEmail, isValidPhone } = require('../lib/validate');
const { requireAuth, setAuthCookie } = require('../lib/auth');
const { rateLimit } = require('../lib/rateLimit');
const otp = require('../lib/otp');

const router = express.Router();
router.use(requireAuth);

// Gửi mã xác thực để đổi email: 10 lần / 15 phút / IP.
// (Ngoài ra lib/otp.js còn giới hạn theo từng email: cách 60 giây, tối đa 5 mã/giờ.)
const emailOtpRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const ALLOWED_MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2MB
const BCRYPT_ROUNDS = 10;

// Cập nhật hồ sơ
router.put('/', (req, res) => {
  const name = String((req.body && req.body.name) || '').trim();
  const email = String((req.body && req.body.email) || '').trim();
  const phone = String((req.body && req.body.phone) || '').trim();

  if (!name) return res.status(400).json({ error: 'Vui lòng nhập họ và tên.' });
  if (email && !isValidEmail(email)) return res.status(400).json({ error: 'Email không hợp lệ. Vui lòng kiểm tra lại.' });
  if (phone && !isValidPhone(phone)) {
    return res.status(400).json({ error: 'Số điện thoại không hợp lệ. Vui lòng kiểm tra lại.' });
  }

  // Đổi email = đổi kênh nhận mã khôi phục mật khẩu, nên phải xác thực địa chỉ mới
  // (gửi mã ở POST /profile/email/otp). Email lúc đăng ký cũng đã được xác thực như vậy.
  const emailChanged = email.toLowerCase() !== String(req.user.email || '').trim().toLowerCase();
  if (emailChanged && otp.otpEnabled()) {
    const code = String((req.body && req.body.emailOtp) || '').trim();
    if (!code) {
      return res.status(400).json({ error: 'Vui lòng nhập mã xác thực đã gửi tới email mới.' });
    }
    try {
      otp.verify({ purpose: 'change_email', email, code });
    } catch (err) {
      if (err instanceof otp.OtpError) return res.status(err.status || 400).json({ error: err.message });
      console.error('Lỗi xác thực email mới:', err);
      return res.status(500).json({ error: 'Có lỗi xảy ra. Vui lòng thử lại sau.' });
    }
  }

  db.prepare('UPDATE users SET name = ?, email = ?, phone = ? WHERE id = ?').run(name, email, phone, req.user.id);
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  return res.json({ user: toUser(row) });
});

// Bước 1 khi đổi email: gửi mã xác thực tới ĐỊA CHỈ MỚI (chưa lưu gì vào hồ sơ)
router.post('/email/otp', emailOtpRateLimit, async (req, res) => {
  const email = String((req.body && req.body.email) || '').trim();

  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Email không hợp lệ. Vui lòng kiểm tra lại.' });
  }
  if (email.toLowerCase() === String(req.user.email || '').trim().toLowerCase()) {
    return res.status(400).json({ error: 'Email này đang là email của tài khoản.' });
  }
  if (!otp.otpEnabled()) {
    return res.status(400).json({ error: 'Bước xác thực email đang tắt.' });
  }
  if (!otp.deliveryAvailable()) {
    return res.status(503).json({ error: 'Hệ thống chưa cấu hình gửi email. Vui lòng liên hệ quản trị viên.' });
  }

  try {
    const sent = await otp.issueAndSend({
      purpose: 'change_email',
      email,
      username: req.user.username,
      name: req.user.name
    });
    return res.json({
      ok: true,
      email,
      expiresInSeconds: sent.expiresInSeconds,
      resendInSeconds: sent.resendInSeconds,
      // Chỉ có giá trị khi chưa cấu hình SMTP và đang ở môi trường phát triển
      devCode: sent.devCode
    });
  } catch (err) {
    if (err instanceof otp.OtpError) return res.status(err.status || 400).json({ error: err.message });
    console.error('Lỗi gửi mã xác thực email mới:', err);
    return res.status(500).json({ error: 'Có lỗi xảy ra. Vui lòng thử lại sau.' });
  }
});

// Cập nhật avatar. Frontend gửi data URL base64; server ghi thành file trong uploads/
// (không lưu base64 trong database để tránh phình dữ liệu).
router.post('/avatar', (req, res) => {
  const dataUrl = String((req.body && req.body.dataUrl) || '');
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);

  if (!match) return res.status(400).json({ error: 'Chỉ hỗ trợ ảnh định dạng JPG, PNG hoặc WEBP.' });

  const mime = match[1];
  const ext = ALLOWED_MIME[mime];
  const buffer = Buffer.from(match[2], 'base64');

  if (buffer.length > MAX_AVATAR_BYTES) {
    return res.status(400).json({ error: 'Kích thước ảnh quá lớn. Vui lòng chọn ảnh dưới 2MB.' });
  }

  const filename = `avatar_${req.user.id}_${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), buffer);

  // Xoá avatar cũ nếu là file do hệ thống lưu
  const oldUrl = req.user.avatar_url;
  if (oldUrl && oldUrl.startsWith('/uploads/')) {
    const oldPath = path.join(UPLOAD_DIR, path.basename(oldUrl));
    try {
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    } catch (err) {
      /* bỏ qua lỗi xoá file cũ */
    }
  }

  const avatarUrl = '/uploads/' + filename;
  db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run(avatarUrl, req.user.id);
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  return res.json({ user: toUser(row) });
});

// Đổi mật khẩu. Giới hạn chặt hơn để tránh dò mật khẩu hiện tại.
router.put(
  '/password',
  rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }),
  (req, res) => {
    const currentPassword = String((req.body && req.body.currentPassword) || '').trim();
    const newPassword = String((req.body && req.body.newPassword) || '').trim();

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Vui lòng nhập đầy đủ mật khẩu hiện tại và mật khẩu mới.' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Mật khẩu mới phải có ít nhất 6 ký tự.' });
    }
    if (newPassword === currentPassword) {
      return res.status(400).json({ error: 'Mật khẩu mới phải khác mật khẩu hiện tại.' });
    }

    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!row || !bcrypt.compareSync(currentPassword, row.password_hash)) {
      return res.status(401).json({ error: 'Mật khẩu hiện tại không chính xác.' });
    }

    const passwordHash = bcrypt.hashSync(newPassword, BCRYPT_ROUNDS);

    // Tăng token_version -> mọi phiên đăng nhập cũ ở thiết bị khác lập tức hết hiệu lực.
    db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?').run(
      passwordHash,
      req.user.id
    );

    // Cấp lại cookie cho chính phiên đang thao tác để người dùng không bị văng ra.
    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    setAuthCookie(res, updated);

    return res.json({ ok: true });
  }
);

module.exports = router;
