'use strict';

/**
 * GZ AFL backend
 * - Phục vụ API dưới /api/*
 * - Phục vụ luôn frontend tĩnh (cùng origin) để cookie phiên hoạt động, không cần CORS
 */

const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const cookieParser = require('cookie-parser');

require('./db'); // khởi tạo database + bảng

const ROOT = path.join(__dirname, '..');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '6mb' })); // đủ cho avatar base64 tối đa 2MB
app.use(cookieParser());

// Không cho truy cập tài nguyên nội bộ của backend qua đường dẫn tĩnh
const BLOCKED_PREFIXES = ['/backend', '/node_modules', '/data', '/.git'];
const BLOCKED_FILES = ['/package.json', '/package-lock.json'];
app.use((req, res, next) => {
  const p = req.path.toLowerCase();
  const blocked =
    BLOCKED_PREFIXES.some((prefix) => p === prefix || p.startsWith(prefix + '/')) ||
    BLOCKED_FILES.includes(p);
  if (blocked) return res.status(404).send('Not found');
  next();
});

// Ảnh avatar
app.use('/uploads', express.static(UPLOAD_DIR));

// API
app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/wallet', require('./routes/wallet'));
app.use('/api/referral', require('./routes/referral'));
app.use('/api/profile', require('./routes/profile'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Không tìm thấy API.' }));

// Frontend tĩnh
app.use(express.static(ROOT));

// Xử lý lỗi tập trung
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Dữ liệu gửi lên quá lớn.' });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Dữ liệu gửi lên không hợp lệ.' });
  }
  console.error(err);
  res.status(500).json({ error: 'Lỗi máy chủ. Vui lòng thử lại sau.' });
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`GZ AFL backend đang chạy tại http://localhost:${PORT}`);
});
