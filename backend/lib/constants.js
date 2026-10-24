'use strict';

/**
 * Các giá trị dùng chung giữa API người dùng và API quản trị.
 * Lưu ý: các chuỗi trạng thái này được lưu thẳng trong database,
 * nên đổi ở đây phải đổi cả dữ liệu cũ.
 */

const ORDER_STATUSES = ['Đang xử lý', 'Chờ đối soát', 'Chờ admin duyệt', 'Hoàn thành', 'Đã thanh toán', 'Đã huỷ'];
const WITHDRAWAL_STATUSES = ['Đang xử lý', 'Đã thanh toán', 'Đã huỷ'];
const ROLES = ['user', 'admin'];

// Trạng thái "huỷ" — đơn/phiếu bị huỷ sẽ không được tính vào số dư
const CANCELLED = 'Đã huỷ';

// Mạng affiliate đã ghi nhận chuyển đổi nhưng CHƯA duyệt (còn chờ đối soát).
// Tiền của đơn ở trạng thái này nằm ở cột `network_commission`, KHÔNG cộng vào số dư.
const AWAITING_RECONCILE = 'Chờ đối soát';

// Mạng đã duyệt nhưng đơn đang chờ quản trị viên chốt hoa hồng.
// `commission` lúc này chỉ là số dự kiến, CHƯA cộng vào ví.
const PENDING_APPROVAL = 'Chờ admin duyệt';

// Yêu cầu khôi phục mật khẩu (xem routes/auth.js + routes/admin.js)
const RESET_STATUSES = ['Chờ xử lý', 'Đã xử lý', 'Đã huỷ'];
const RESET_PENDING = 'Chờ xử lý';
const RESET_RESOLVED = 'Đã xử lý';

// Số dư khả dụng tối thiểu để được gửi yêu cầu rút tiền (đồng)
const WITHDRAWAL_MIN = Number(process.env.WITHDRAWAL_MIN) || 1000;

// Quy đổi điểm giới thiệu sang tiền trong ví: 100 điểm = 1.000đ (1 điểm = 10đ).
// Chỉ đổi được bội số của 100 điểm và tối thiểu 100 điểm, để số tiền luôn chẵn nghìn.
const POINT_VALUE = 10; // đồng cho mỗi điểm
const POINT_REDEEM_MIN = 100; // số điểm tối thiểu mỗi lần đổi
const POINT_REDEEM_STEP = 100; // số điểm mỗi bước đổi

// Điểm thưởng cho người nhập mã giới thiệu. Chỉ cộng sau khi người đó có ít nhất
// một đơn hàng không bị huỷ (xem lib/referralRewards.js).
const REFERRAL_REWARD_POINTS = 100;

module.exports = {
  ORDER_STATUSES,
  WITHDRAWAL_STATUSES,
  ROLES,
  CANCELLED,
  AWAITING_RECONCILE,
  PENDING_APPROVAL,
  RESET_STATUSES,
  RESET_PENDING,
  RESET_RESOLVED,
  WITHDRAWAL_MIN,
  POINT_VALUE,
  POINT_REDEEM_MIN,
  POINT_REDEEM_STEP,
  REFERRAL_REWARD_POINTS
};
