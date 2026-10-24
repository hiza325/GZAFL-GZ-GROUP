'use strict';

/**
 * Phân bổ lệnh rút tiền cho từng đơn hoa hồng.
 *
 * Vì sao cần: số dư của người dùng là tổng của nhiều đơn, nhưng nếu chỉ lưu
 * tổng tiền thì không biết đơn nào đã được rút. Người dùng có thể chọn rút
 * hoa hồng của một vài đơn, rồi lại chọn đúng đơn đó lần nữa -> rút trùng.
 * Bảng withdrawal_items ghi lại từng phần tiền đã rút của mỗi đơn để chặn việc
 * này. Tiền đổi từ điểm giới thiệu không gắn với đơn nào nên không có dòng
 * tương ứng; phần chênh lệch đó nằm ở chính lệnh rút.
 */

const db = require('../db');
const { CANCELLED } = require('./constants');
const { creditedCondition, computeUserMoney } = require('./money');
const { formatDate } = require('./format');

/**
 * Các đơn đã được admin duyệt và còn hoa hồng chưa rút.
 * Trả về số tiền còn rút được của từng đơn (đã trừ các lệnh rút không bị huỷ).
 */
function listWithdrawableOrders(userId, options = {}) {
  const skipBalanceCap = Boolean(options.skipBalanceCap);
  const rows = db
    .prepare(
      `SELECT o.id, o.code, o.platform, o.commission, o.created_at,
              COALESCE((
                SELECT SUM(wi.amount)
                FROM withdrawal_items wi
                JOIN withdrawals w ON w.id = wi.withdrawal_id
                WHERE wi.order_id = o.id AND w.status != '${CANCELLED}'
              ), 0) AS withdrawn
       FROM orders o
       WHERE o.user_id = ? AND ${creditedCondition('o')}
       ORDER BY o.created_at ASC, o.id ASC`
    )
    .all(userId);

  const orders = rows
    .map((row) => {
      const commission = Number(row.commission) || 0;
      const withdrawn = Number(row.withdrawn) || 0;
      return {
        id: row.id,
        code: row.code,
        platform: row.platform,
        commission,
        withdrawn,
        withdrawable: Math.max(0, commission - withdrawn),
        date: formatDate(row.created_at),
        createdAt: row.created_at
      };
    })
    .filter((row) => row.withdrawable > 0);

  // Số dư tổng có thể thấp hơn tổng hoa hồng còn lại của các đơn khi khách đang
  // nợ do hoa hồng cũ bị thu hồi (hoặc lệnh rút cũ chưa phân bổ hết). Giới hạn
  // lại để không hiển thị/chọn một đơn vượt quá số dư thực tế; khoản nợ trừ vào
  // các đơn cũ trước.
  if (skipBalanceCap) return orders;

  const rawTotal = orders.reduce((sum, order) => sum + order.withdrawable, 0);
  const balance = Math.max(0, Number(computeUserMoney(userId).balance) || 0);
  let left = Math.min(rawTotal, balance);

  return orders
    .map((order) => {
      const withdrawable = Math.min(order.withdrawable, left);
      left -= withdrawable;
      return { ...order, withdrawable };
    })
    .filter((order) => order.withdrawable > 0);
}

/**
 * Gán `amount` đồng của một lệnh rút cho các đơn còn hoa hồng, ưu tiên đơn cũ.
 * Trả về danh sách đơn đã gán để hiển thị lại cho người dùng.
 *
 * Lưu ý: nếu tổng hoa hồng còn lại ít hơn `amount` (phần còn lại là tiền đổi
 * điểm), hàm vẫn chạy bình thường và chỉ gán được phần hoa hồng.
 */
function allocateWithdrawalItems(withdrawalId, userId, amount, createdAt) {
  let remaining = Math.max(0, Number(amount) || 0);
  if (remaining <= 0) return [];

  const findItem = db.prepare(
    'SELECT id, amount FROM withdrawal_items WHERE withdrawal_id = ? AND order_id = ?'
  );
  const insertItem = db.prepare(
    `INSERT INTO withdrawal_items (withdrawal_id, order_id, amount, created_at)
     VALUES (?, ?, ?, ?)`
  );
  const addItem = db.prepare('UPDATE withdrawal_items SET amount = amount + ? WHERE id = ?');

  const allocations = [];
  for (const order of listWithdrawableOrders(userId, { skipBalanceCap: true })) {
    if (remaining <= 0) break;
    const take = Math.min(order.withdrawable, remaining);
    if (take <= 0) continue;

    const existing = findItem.get(withdrawalId, order.id);
    if (existing) addItem.run(take, existing.id);
    else insertItem.run(withdrawalId, order.id, take, createdAt);

    allocations.push({ code: order.code, amount: take });
    remaining -= take;
  }
  return allocations;
}

/**
 * Khi quản trị viên sửa số tiền thực trả của một lệnh rút, giữ cho phần phân bổ
 * theo đơn khớp với số tiền mới: giảm thì cắt bớt các dòng cuối, tăng thì gán
 * thêm vào các đơn còn hoa hồng.
 */
function resizeWithdrawalItems(withdrawalId, userId, oldAmount, newAmount, createdAt) {
  const oldValue = Math.max(0, Number(oldAmount) || 0);
  const newValue = Math.max(0, Number(newAmount) || 0);
  if (oldValue === newValue) return;

  if (newValue > oldValue) {
    allocateWithdrawalItems(withdrawalId, userId, newValue - oldValue, createdAt);
    return;
  }

  let remaining = oldValue - newValue;
  const items = db
    .prepare('SELECT id, amount FROM withdrawal_items WHERE withdrawal_id = ? ORDER BY id DESC')
    .all(withdrawalId);
  const updateItem = db.prepare('UPDATE withdrawal_items SET amount = ? WHERE id = ?');
  const deleteItem = db.prepare('DELETE FROM withdrawal_items WHERE id = ?');

  for (const item of items) {
    if (remaining <= 0) break;
    const amount = Number(item.amount) || 0;
    if (amount <= remaining) {
      deleteItem.run(item.id);
      remaining -= amount;
    } else {
      updateItem.run(amount - remaining, item.id);
      remaining = 0;
    }
  }
}

module.exports = {
  listWithdrawableOrders,
  allocateWithdrawalItems,
  resizeWithdrawalItems
};
