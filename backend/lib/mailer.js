'use strict';

/**
 * Gửi email qua SMTP (dùng cho mã OTP xác thực).
 *
 * Cấu hình trong backend/.env:
 *   SMTP_HOST=smtp.gmail.com
 *   SMTP_PORT=587
 *   SMTP_SECURE=false          (để trống thì tự suy ra: cổng 465 -> true)
 *   SMTP_USER=you@gmail.com
 *   SMTP_PASS=mat-khau-ung-dung
 *   MAIL_FROM=no-reply@gzafl.vn
 *   MAIL_FROM_NAME=GZ AFL
 *
 * CHƯA cấu hình SMTP thì hệ thống vẫn chạy bình thường:
 *   - Ở môi trường phát triển: nội dung thư (kèm mã OTP) được in ra console
 *     để test được ngay, không cần tài khoản email.
 *   - Ở production: bước xác thực OTP tự tắt để không chặn đăng ký
 *     (xem lib/otp.js -> otpEnabled()) và server in cảnh báo lúc khởi động.
 *
 * Biến môi trường được đọc MỖI LẦN GỌI (không đọc lúc nạp module) để không
 * phụ thuộc thứ tự require.
 */

const { isProduction } = require('./env');

function config() {
  const host = (process.env.SMTP_HOST || '').trim();
  const port = Number(process.env.SMTP_PORT) || 587;
  const user = (process.env.SMTP_USER || '').trim();
  const pass = process.env.SMTP_PASS || '';
  const from = (process.env.MAIL_FROM || user || '').trim();
  const fromName = (process.env.MAIL_FROM_NAME || 'GZ AFL').trim();

  const secureRaw = process.env.SMTP_SECURE;
  const secure = secureRaw != null && secureRaw !== '' ? secureRaw === 'true' : port === 465;

  return { host, port, user, pass, from, fromName, secure };
}

// Đã đủ thông tin để gửi thư thật chưa?
function isConfigured() {
  const c = config();
  if (!c.host || !c.from) return false;
  // Nếu có tài khoản thì phải có mật khẩu
  if (c.user && !c.pass) return false;
  return true;
}

// Chế độ thử nghiệm: chưa có SMTP và không phải production -> in thư ra console
function isDevDelivery() {
  return !isConfigured() && !isProduction();
}

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  const c = config();
  const nodemailer = require('nodemailer');

  transporter = nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.secure,
    auth: c.user ? { user: c.user, pass: c.pass } : undefined,
    // Đặt hạn để một máy chủ SMTP treo không giữ request quá lâu
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000
  });
  return transporter;
}

function fromHeader() {
  const c = config();
  return c.fromName ? `${c.fromName} <${c.from}>` : c.from;
}

/**
 * Gửi một thư. Ném lỗi nếu chưa cấu hình hoặc gửi thất bại.
 * Ở chế độ thử nghiệm, thư được in ra console và trả về giả lập thành công.
 */
async function send({ to, subject, text, html }) {
  if (!isConfigured()) {
    if (isDevDelivery()) {
      logToConsole({ to, subject, text });
      return { dev: true, accepted: [to] };
    }
    throw new Error('Chưa cấu hình gửi email (SMTP).');
  }

  return getTransporter().sendMail({
    from: fromHeader(),
    to,
    subject,
    text,
    html
  });
}

// In nội dung thư ra console cho môi trường phát triển
function logToConsole({ to, subject, text }) {
  const line = '='.repeat(64);
  console.log('');
  console.log(line);
  console.log('  THƯ THỬ NGHIỆM (chưa cấu hình SMTP — không gửi đi đâu cả)');
  console.log(line);
  console.log('  Tới    : ' + to);
  console.log('  Tiêu đề: ' + subject);
  console.log('');
  String(text || '')
    .split('\n')
    .forEach((row) => console.log('  ' + row));
  console.log(line);
  console.log('');
}

// Mô tả ngắn để in trong bảng tổng kết lúc khởi động
function describe() {
  const c = config();
  if (isConfigured()) {
    return { configured: true, host: c.host, port: c.port, from: c.from, dev: false };
  }
  if (isDevDelivery()) {
    return { configured: false, host: '', port: 0, from: '', dev: true };
  }
  return { configured: false, host: '', port: 0, from: '', dev: false };
}

module.exports = { isConfigured, isDevDelivery, send, describe };
