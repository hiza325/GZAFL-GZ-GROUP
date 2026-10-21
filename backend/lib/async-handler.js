'use strict';

/**
 * Bọc handler async của Express 4.
 *
 * Express 4 KHÔNG tự bắt Promise bị reject: nếu handler async ném lỗi (kể cả lỗi
 * database ở ngoài khối try/catch), request sẽ treo và client không bao giờ nhận
 * phản hồi. Bộ xử lý lỗi tập trung ở server.js chỉ chạy khi lỗi được chuyển tới
 * `next(err)`.
 *
 * Dùng:
 *   router.post('/x', asyncHandler(async (req, res) => { ... }));
 */
function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { asyncHandler };
