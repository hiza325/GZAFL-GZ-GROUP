'use strict';

/**
 * Một nguồn duy nhất cho thư mục ảnh tải lên.
 *
 * Trước đây server.js đọc UPLOAD_DIR nhưng profile.js/admin.js lại hard-code
 * backend/uploads. Nếu đổi UPLOAD_DIR (ổ đĩa riêng, test...) thì ảnh ghi vào một
 * nơi nhưng server lại phục vụ ở nơi khác. Tất cả route phải dùng module này.
 */

const fs = require('node:fs');
const path = require('node:path');

const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(__dirname, '..', process.env.UPLOAD_DIR)
  : path.join(__dirname, '..', 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

module.exports = { UPLOAD_DIR };
