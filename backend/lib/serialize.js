'use strict';

// Chuyển dữ liệu thô trong SQLite thành JSON mà frontend đang dùng.

const { formatDate, formatDateTime } = require('./format');
const { redactStoredQuery } = require('./redact');

function toUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    email: row.email || '',
    phone: row.phone || '',
    avatar: row.avatar_url || null,
    // Có số tài khoản HOẶC có ảnh QR đều được coi là "đã có tài khoản nhận tiền"
    bank:
      row.bank_acc_num || row.bank_qr_url
        ? {
            bank: row.bank_bank || '',
            accNum: row.bank_acc_num || '',
            accName: row.bank_acc_name || '',
            qrUrl: row.bank_qr_url || null
          }
        : null,
    points: row.points || 0,
    role: row.role || 'user',
    referralCode: row.referral_code,
    createdAt: row.created_at
  };
}

function toOrder(row) {
  if (!row) return null;
  return {
    id: row.code,
    link: row.original_link || row.link,
    affiliateLink: row.affiliate_link || null,
    subId: row.sub_id || null,
    clicks: Number(row.click_count) || 0,
    platform: row.platform,
    status: row.status,
    commission: Number(row.commission) || 0,
    // Hoa hồng mạng affiliate báo về nhưng có thể CHƯA duyệt (xem lib/postback.js)
    networkCommission: Number(row.network_commission) || 0,
    networkStatus: row.network_status || null,
    date: formatDate(row.created_at),
    createdAt: row.created_at
  };
}

function toNotification(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    body: row.body || '',
    icon: row.icon || 'bell',
    isRead: !!row.is_read,
    createdAt: row.created_at,
    date: formatDateTime(row.created_at)
  };
}

function toWithdrawal(row) {
  if (!row) return null;
  return {
    id: row.code,
    bank: row.bank,
    accNum: row.acc_num,
    accName: row.acc_name,
    qrUrl: row.qr_url || null,
    amount: Number(row.amount) || 0,
    status: row.status,
    date: formatDateTime(row.created_at),
    createdAt: row.created_at
  };
}

/* ==========================================
   Dữ liệu dành cho trang quản trị
   (kèm thông tin người dùng, không bao giờ trả password_hash)
========================================== */

function toAdminUser(row) {
  if (!row) return null;
  const commission = Number(row.commission_total) || 0;
  const withdrawn = Number(row.withdrawn_total) || 0;
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    email: row.email || '',
    phone: row.phone || '',
    avatar: row.avatar_url || null,
    role: row.role || 'user',
    points: Number(row.points) || 0,
    referralCode: row.referral_code,
    createdAt: row.created_at,
    date: formatDateTime(row.created_at),
    orderCount: Number(row.order_count) || 0,
    pendingCount: Number(row.pending_count) || 0,
    referralCount: Number(row.referral_count) || 0,
    commission,
    withdrawn,
    balance: commission - withdrawn
  };
}

function toAdminOrder(row) {
  if (!row) return null;
  return {
    id: row.code,
    userId: row.user_id,
    user: {
      id: row.user_id,
      name: row.user_name || '(đã xoá)',
      username: row.user_username || ''
    },
    link: row.original_link || row.link,
    affiliateLink: row.affiliate_link || null,
    platform: row.platform,
    status: row.status,
    commission: Number(row.commission) || 0,
    networkOrderId: row.network_order_id || null,
    networkCommission: Number(row.network_commission) || 0,
    networkStatus: row.network_status || null,
    createdAt: row.created_at,
    date: formatDateTime(row.created_at)
  };
}

/**
 * Nhật ký postback cho trang quản trị (xem lib/postback.js).
 * `query` là tham số thô mạng gửi vào, nhưng chìa khoá/token đã được CHE (lib/redact.js).
 */
function toAdminPostback(row) {
  if (!row) return null;
  return {
    id: row.id,
    provider: row.provider || '',
    receivedAt: row.received_at,
    date: formatDateTime(row.received_at),
    lastReceivedAt: row.last_received_at,
    lastDate: formatDateTime(row.last_received_at),
    dupCount: Number(row.dup_count) || 1,
    ip: row.ip || '',
    transactionId: row.transaction_id || '',
    productId: row.product_id || '',
    conversionId: row.conversion_id || '',
    reward: Number(row.reward) || 0,
    networkStatus: row.network_status || '',
    subId: row.sub_id || '',
    userId: row.user_id || null,
    user: row.user_name
      ? { id: row.user_id, name: row.user_name, username: row.user_username || '' }
      : null,
    orderCode: row.order_code || '',
    action: row.action || '',
    note: row.note || '',
    // matched = khớp CHẮC CHẮN (theo mã giao dịch hoặc mã đơn);
    // tentative = chỉ khớp tạm theo đơn mới nhất của khách, cần người kiểm tra lại
    matched: Boolean(row.order_code && row.action !== 'Từ chối' && row.action !== 'Khớp tạm'),
    tentative: row.action === 'Khớp tạm',
    // Che chìa khoá/token trong dữ liệu CŨ (lưu trước khi có lib/redact.js)
    query: redactStoredQuery(row.query)
  };
}

function toAdminWithdrawal(row) {
  if (!row) return null;
  const commission = Number(row.commission_total) || 0;
  const withdrawn = Number(row.withdrawn_total) || 0;
  const otherWithdrawn = Number(row.other_withdrawn_total) || 0;
  return {
    id: row.code,
    userId: row.user_id,
    user: {
      id: row.user_id,
      name: row.user_name || '(đã xoá)',
      username: row.user_username || ''
    },
    bank: row.bank,
    accNum: row.acc_num,
    accName: row.acc_name,
    // Ảnh QR nhận tiền (nếu người dùng có tải lên) - quản trị viên quét để chuyển tiền
    qrUrl: row.qr_url || null,
    amount: Number(row.amount) || 0,
    status: row.status,
    createdAt: row.created_at,
    date: formatDateTime(row.created_at),
    // Số dư hiện tại của người dùng (đã trừ mọi lệnh rút không bị huỷ)
    userBalance: commission - withdrawn,
    // Số tiền tối đa có thể chi cho riêng lệnh này (không tính chính nó)
    payable: Math.max(0, commission - otherWithdrawn)
  };
}

function toAdminReferral(row) {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    points: Number(row.points) || 0,
    createdAt: row.created_at,
    date: formatDateTime(row.created_at),
    user: {
      id: row.user_id,
      name: row.user_name || '(đã xoá)',
      username: row.user_username || ''
    },
    owner: row.owner_id
      ? { id: row.owner_id, name: row.owner_name || '', username: row.owner_username || '' }
      : null
  };
}

/**
 * Một dòng nhật ký quản trị (xem lib/audit.js).
 */
function toAdminAudit(row) {
  if (!row) return null;
  return {
    id: row.id,
    actor: {
      id: row.actor_id || null,
      name: row.actor_name || '(không rõ)',
      username: row.actor_username || ''
    },
    action: row.action || '',
    targetType: row.target_type || '',
    targetId: row.target_id || '',
    detail: row.detail || '',
    ip: row.ip || '',
    createdAt: row.created_at,
    date: formatDateTime(row.created_at)
  };
}

function toAdminPasswordReset(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    status: row.status,
    note: row.note || '',
    createdAt: row.created_at,
    date: formatDateTime(row.created_at),
    resolvedAt: row.resolved_at || null,
    user: {
      id: row.user_id,
      name: row.user_name || '(đã xoá)',
      username: row.user_username || '',
      email: row.user_email || '',
      phone: row.user_phone || ''
    }
  };
}

module.exports = {
  toUser,
  toOrder,
  toWithdrawal,
  toNotification,
  toAdminUser,
  toAdminOrder,
  toAdminWithdrawal,
  toAdminReferral,
  toAdminPasswordReset,
  toAdminAudit,
  toAdminPostback
};
