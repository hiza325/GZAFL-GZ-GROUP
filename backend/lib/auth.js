'use strict';

const jwt = require('jsonwebtoken');
const db = require('../db');
const { cookieSecure } = require('./env');

const JWT_SECRET = process.env.JWT_SECRET || 'gzafl-dev-secret-change-me';
const COOKIE_NAME = 'gz_token';
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 ngày

function signToken(user) {
  return jwt.sign({ uid: user.id, tv: Number(user.token_version) || 1 }, JWT_SECRET, { expiresIn: '7d' });
}

function setAuthCookie(res, user) {
  res.cookie(COOKIE_NAME, signToken(user), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: TOKEN_TTL_MS,
    // Chỉ gửi cookie qua HTTPS khi chạy production (đổi bằng COOKIE_SECURE trong .env)
    secure: cookieSecure()
  });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

// ------------------------------------------------------------------
// Phiếu đăng nhập tạm (bước 1 -> bước 2 của đăng nhập có xác thực 2 lớp).
// Sau khi kiểm tra ĐÚNG mật khẩu, server phát một phiếu sống 5 phút; client
// gửi kèm mã OTP ở bước 2. Nhờ vậy bước 2 không cần gửi lại mật khẩu, và
// người chỉ biết tên tài khoản cũng không gọi được bước 2.
// ------------------------------------------------------------------
const LOGIN_TICKET_PURPOSE = 'login2fa';

function signLoginTicket(user) {
  return jwt.sign(
    { uid: user.id, tv: Number(user.token_version) || 1, purpose: LOGIN_TICKET_PURPOSE },
    JWT_SECRET,
    { expiresIn: '5m' }
  );
}

/** Kiểm tra phiếu đăng nhập, trả về user mới nhất từ DB (ném lỗi nếu phiếu sai/hết hạn). */
function verifyLoginTicket(ticket) {
  const payload = jwt.verify(String(ticket || ''), JWT_SECRET);
  if (payload.purpose !== LOGIN_TICKET_PURPOSE) throw new Error('Sai loại phiếu đăng nhập.');

  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.uid);
  if (!row) throw new Error('Không tìm thấy tài khoản.');
  if ((Number(payload.tv) || 1) !== (Number(row.token_version) || 1)) {
    throw new Error('Phiếu đăng nhập đã hết hiệu lực.');
  }
  return row;
}

// Đọc user hiện tại từ cookie (trả null nếu chưa đăng nhập / token sai)
function loadUser(req) {
  const token = req.cookies ? req.cookies[COOKIE_NAME] : null;
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.uid);
    if (!row) return null;

    // Đổi mật khẩu sẽ tăng token_version -> mọi phiên cũ trở nên vô hiệu
    if ((Number(payload.tv) || 1) !== (Number(row.token_version) || 1)) return null;

    return row;
  } catch (err) {
    return null;
  }
}

// Bắt buộc đăng nhập: xác thực JWT trong cookie và nạp user mới nhất từ DB
function requireAuth(req, res, next) {
  const token = req.cookies ? req.cookies[COOKIE_NAME] : null;
  if (!token) return res.status(401).json({ error: 'Bạn chưa đăng nhập.' });

  const row = loadUser(req);
  if (!row) return res.status(401).json({ error: 'Phiên đăng nhập đã hết hạn.' });

  // Tài khoản đang bị admin tạm giữ để xem xét cảnh báo bảo mật:
  // chặn cả phiên đã đăng nhập trước đó, không chỉ chặn đăng nhập mới.
  const holdMs = row.security_hold_until ? Date.parse(row.security_hold_until) : NaN;
  if (Number.isFinite(holdMs) && holdMs > Date.now()) {
    return res.status(423).json({
      error:
        'Tài khoản đang tạm giữ để quản trị viên xem xét đến ' +
        new Date(holdMs).toLocaleString('vi-VN') +
        '. Vui lòng liên hệ bộ phận hỗ trợ.',
      code: 'security_hold',
      heldUntil: new Date(holdMs).toISOString()
    });
  }

  req.user = row;
  next();
}

// Bắt buộc là quản trị viên (dùng cho các API dưới /api/admin)
function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Bạn không có quyền truy cập chức năng quản trị.' });
    }
    next();
  });
}

module.exports = {
  COOKIE_NAME,
  signToken,
  setAuthCookie,
  clearAuthCookie,
  signLoginTicket,
  verifyLoginTicket,
  loadUser,
  requireAuth,
  requireAdmin
};
