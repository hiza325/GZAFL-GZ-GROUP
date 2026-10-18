'use strict';

const jwt = require('jsonwebtoken');
const db = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'gzafl-dev-secret-change-me';
const COOKIE_NAME = 'gz_token';
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 ngày

function signToken(user) {
  return jwt.sign({ uid: user.id }, JWT_SECRET, { expiresIn: '7d' });
}

function setAuthCookie(res, user) {
  res.cookie(COOKIE_NAME, signToken(user), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: TOKEN_TTL_MS
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
    return db.prepare('SELECT * FROM users WHERE id = ?').get(payload.uid) || null;
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
