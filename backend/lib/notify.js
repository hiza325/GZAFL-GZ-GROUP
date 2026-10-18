'use strict';

const db = require('../db');

/**
 * Ghi một thông báo cho người dùng.
 *
 * Cố tình không ném lỗi ra ngoài: thông báo chỉ là phần phụ, không được phép
 * làm hỏng nghiệp vụ chính (tạo đơn, rút tiền, duyệt đơn...).
 */
function notify(userId, { title, body = '', icon = 'bell' }) {
  try {
    db.prepare(
      'INSERT INTO notifications (user_id, title, body, icon, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(Number(userId), String(title), String(body), String(icon), new Date().toISOString());
  } catch (err) {
    console.error('Không ghi được thông báo:', err.message);
  }
}

module.exports = { notify };
