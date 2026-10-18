'use strict';

// Định dạng ngày/tiền theo chuẩn Việt Nam, khớp với hiển thị của frontend.

function formatDate(value) {
  const d = value ? new Date(value) : new Date();
  return d.toLocaleDateString('vi-VN');
}

function formatDateTime(value) {
  const d = value ? new Date(value) : new Date();
  return d.toLocaleString('vi-VN');
}

function formatMoney(amount) {
  const n = Number(amount) || 0;
  return 'đ' + n.toLocaleString('vi-VN');
}

module.exports = { formatDate, formatDateTime, formatMoney };
