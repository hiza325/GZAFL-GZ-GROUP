'use strict';

/**
 * Các giá trị dùng chung giữa API người dùng và API quản trị.
 * Lưu ý: các chuỗi trạng thái này được lưu thẳng trong database,
 * nên đổi ở đây phải đổi cả dữ liệu cũ.
 */

const ORDER_STATUSES = ['Đang xử lý', 'Hoàn thành', 'Đã thanh toán', 'Đã huỷ'];
const WITHDRAWAL_STATUSES = ['Đang xử lý', 'Đã thanh toán', 'Đã huỷ'];
const ROLES = ['user', 'admin'];

// Trạng thái "huỷ" — đơn/phiếu bị huỷ sẽ không được tính vào số dư
const CANCELLED = 'Đã huỷ';

// Số dư khả dụng tối thiểu để được gửi yêu cầu rút tiền (đồng)
const WITHDRAWAL_MIN = Number(process.env.WITHDRAWAL_MIN) || 50000;

module.exports = { ORDER_STATUSES, WITHDRAWAL_STATUSES, ROLES, CANCELLED, WITHDRAWAL_MIN };
