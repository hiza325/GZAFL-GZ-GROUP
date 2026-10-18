'use strict';

/**
 * Nạp biến môi trường từ file backend/.env (nếu có).
 *
 * Dùng process.loadEnvFile() của Node (>= 20.12) nên không cần thêm thư viện dotenv.
 *
 * QUAN TRỌNG: module này phải được require TRƯỚC db.js, lib/auth.js, lib/constants.js,
 * lib/affiliate.js... vì các module đó đọc process.env ngay tại thời điểm nạp.
 */

const fs = require('node:fs');
const path = require('node:path');

// Cho phép chỉ định file env khác qua biến GZAFL_ENV_FILE (tiện cho Docker/systemd)
const ENV_PATH = process.env.GZAFL_ENV_FILE || path.join(__dirname, '..', '.env');

if (fs.existsSync(ENV_PATH)) {
  try {
    process.loadEnvFile(ENV_PATH);
  } catch (err) {
    console.warn(`CẢNH BÁO: Không đọc được file ${ENV_PATH}: ${err.message}`);
  }
}

// Có đang chạy production không?
function isProduction() {
  return process.env.NODE_ENV === 'production';
}

/**
 * Cookie phiên có bắt buộc HTTPS không?
 * Mặc định: bật khi NODE_ENV=production.
 * Ghi đè bằng COOKIE_SECURE=true|false khi cần (ví dụ production sau proxy TLS).
 */
function cookieSecure() {
  const raw = process.env.COOKIE_SECURE;
  if (raw != null && raw !== '') return raw === 'true';
  return isProduction();
}

module.exports = { ENV_PATH, isProduction, cookieSecure };
