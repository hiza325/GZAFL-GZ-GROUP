'use strict';

// Chuyển dữ liệu thô trong SQLite thành JSON mà frontend đang dùng.

const { formatDate, formatDateTime } = require('./format');

function toUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    email: row.email || '',
    phone: row.phone || '',
    avatar: row.avatar_url || null,
    bank: row.bank_acc_num
      ? { bank: row.bank_bank || '', accNum: row.bank_acc_num, accName: row.bank_acc_name || '' }
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
    createdAt: row.created_at,
    date: formatDateTime(row.created_at)
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
  toAdminPasswordReset
};
