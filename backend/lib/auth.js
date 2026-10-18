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
  loadUser,
  requireAuth,
  requireAdmin
};
