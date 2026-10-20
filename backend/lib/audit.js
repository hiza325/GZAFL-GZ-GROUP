'use strict';

/**
 * Nhật ký thao tác quản trị (audit log).
 *
 * Mục đích: biết CHÍNH XÁC ai đã đổi gì và khi nào — nhất là các thao tác ảnh hưởng
 * tiền (sửa hoa hồng đơn, sửa/chi lệnh rút, đặt lại mật khẩu, đổi vai trò...).
 *
 * Nguyên tắc: ghi nhật ký KHÔNG được làm hỏng thao tác chính, nên mọi lỗi đều bị nuốt
 * và chỉ ghi ra console.
 */

const db = require('../db');

/**
 * @param {import('express').Request} req  request đang xử lý (lấy người thao tác + IP)
 * @param {string} action       ví dụ 'Cập nhật lệnh rút'
 * @param {string} targetType   ví dụ 'withdrawal' | 'user' | 'order' | 'postback'
 * @param {string|number} targetId  mã đối tượng (mã lệnh rút, id người dùng...)
 * @param {string} detail       mô tả ngắn (giá trị trước -> sau)
 */
function logAudit(req, action, targetType, targetId, detail) {
  try {
    const actor = req && req.user ? req.user : null;
    db.prepare(
      `INSERT INTO admin_audit_logs
         (actor_id, actor_name, actor_username, action, target_type, target_id, detail, ip, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      actor ? actor.id : null,
      actor ? String(actor.name || '') : '',
      actor ? String(actor.username || '') : '',
      String(action || '').slice(0, 120),
      String(targetType || '').slice(0, 60),
      String(targetId == null ? '' : targetId).slice(0, 120),
      String(detail == null ? '' : detail).slice(0, 500),
      String((req && req.ip) || '').slice(0, 60),
      new Date().toISOString()
    );
  } catch (err) {
    console.error('Không ghi được nhật ký quản trị:', err.message);
  }
}

module.exports = { logAudit };
