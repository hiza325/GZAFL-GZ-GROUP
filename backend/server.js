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

const db = require('./db'); // khởi tạo database + bảng

// Không cho chạy production với khoá ký mặc định
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  console.error('LỖI: Chưa đặt JWT_SECRET nhưng đang chạy NODE_ENV=production. Dừng khởi động.');
  process.exit(1);
}
if (!process.env.JWT_SECRET) {
  console.warn('CẢNH BÁO: Đang dùng JWT_SECRET mặc định. Chỉ dùng cho môi trường phát triển.');
}

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

/* ==========================================
   Link hoàn tiền rút gọn: /r/<mã đơn>
   Ghi nhận lượt bấm rồi chuyển hướng sang link đích.

   Dùng link trung gian (thay vì đưa thẳng link affiliate cho người dùng) để:
   - đếm được số lượt bấm
   - sau này đổi nhà cung cấp affiliate mà link đã phát cho người dùng không hỏng
   ========================================== */
app.get('/r/:code', (req, res) => {
  const code = String(req.params.code || '').trim().toUpperCase();
  const row = db.prepare('SELECT * FROM orders WHERE code = ?').get(code);
  if (!row) return res.status(404).send('Không tìm thấy link hoàn tiền.');

  db.prepare('UPDATE orders SET click_count = click_count + 1 WHERE id = ?').run(row.id);

  let target = row.affiliate_link || row.original_link || row.link;
  try {
    // Ở chế độ thử nghiệm, link hoàn tiền chính là link nội bộ này -> đích thật là link gốc
    if (new URL(target).pathname.startsWith('/r/')) {
      target = row.original_link || row.link;
    }
  } catch (err) {
    target = row.original_link || row.link;
  }

  return res.redirect(302, target);
});

// API
app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/wallet', require('./routes/wallet'));
app.use('/api/referral', require('./routes/referral'));
app.use('/api/profile', require('./routes/profile'));
app.use('/api/notifications', require('./routes/notifications'));
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
