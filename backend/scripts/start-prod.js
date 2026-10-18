'use strict';

/**
 * Khởi động server ở chế độ production (cross-platform).
 *
 * Windows không chạy được cú pháp `NODE_ENV=production node server.js` trong cmd,
 * nên dùng script này thay vì đặt biến môi trường trực tiếp trên dòng lệnh.
 *
 * Dùng: npm run start:prod
 */

require('../lib/env'); // nạp .env trước để không ghi đè cấu hình của bạn
process.env.NODE_ENV = 'production';

require('../server');
