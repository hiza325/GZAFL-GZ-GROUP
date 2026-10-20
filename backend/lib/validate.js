'use strict';

const { randomInt } = require('node:crypto');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// SĐT Việt Nam: 0 hoặc +84/84, đầu số 3/5/7/8/9, tổng 10 chữ số
const PHONE_REGEX = /^(?:\+?84|0)(?:3|5|7|8|9)\d{8}$/;

const REFERRAL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const REFERRAL_CODE_LENGTH = 6;

function isValidEmail(input) {
  return EMAIL_REGEX.test(String(input || '').trim());
}

function isValidPhone(input) {
  return PHONE_REGEX.test(String(input || '').trim().replace(/[\s.-]/g, ''));
}

function isValidUsername(input) {
  return isValidEmail(input) || isValidPhone(input);
}

function randomChars(length) {
  let out = '';
  for (let i = 0; i < length; i++) out += REFERRAL_ALPHABET[randomInt(REFERRAL_ALPHABET.length)];
  return out;
}

function randomDigits(length) {
  let out = '';
  for (let i = 0; i < length; i++) out += String(randomInt(10));
  return out;
}

// Sinh mã giới thiệu 6 ký tự chưa tồn tại trong DB
function generateReferralCode(db) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const code = randomChars(REFERRAL_CODE_LENGTH);
    const exists = db.prepare('SELECT 1 AS x FROM users WHERE referral_code = ?').get(code);
    if (!exists) return code;
  }
  throw new Error('Không sinh được mã giới thiệu duy nhất.');
}

// Mật khẩu tạm khi quản trị viên đặt lại mật khẩu hộ người dùng.
// Bỏ các ký tự dễ nhầm khi đọc lại qua điện thoại (0/O, 1/l/I).
const TEMP_PASSWORD_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const TEMP_PASSWORD_LENGTH = 10;

function generateTempPassword() {
  let out = '';
  for (let i = 0; i < TEMP_PASSWORD_LENGTH; i++) {
    out += TEMP_PASSWORD_ALPHABET[randomInt(TEMP_PASSWORD_ALPHABET.length)];
  }
  return out;
}

function generateOrderCode() {
  return 'GZ' + randomDigits(6);
}

function generateWithdrawalCode() {
  return 'WD' + randomDigits(6);
}

// Độ dài tối đa cho link sản phẩm người dùng dán vào
const MAX_ORDER_LINK_LENGTH = 2048;

// Chỉ chấp nhận link thuộc đúng các tên miền của sàn. Khớp theo hậu tố tên miền
// để vẫn nhận tên miền con (vt.tiktok.com, s.shopee.vn...).
const ORDER_LINK_RULES = [
  { platform: 'TikTok Shop', suffixes: ['tiktok.com', 'tiktokshop.com'] },
  { platform: 'Shopee', suffixes: ['shopee.vn', 'shp.ee'] },
  { platform: 'Lazada', suffixes: ['lazada.vn'] }
];

function hostMatchesSuffix(host, suffix) {
  return host === suffix || host.endsWith('.' + suffix);
}

/**
 * Kiểm tra link sản phẩm NGƯỜI DÙNG gửi lên.
 *
 * QUAN TRỌNG: phải parse URL thật rồi kiểm tra giao thức + tên miền.
 * Trước đây chỉ dùng regex "có chứa chữ tiktok/shopee" nên link dạng
 * `javascript:alert(1)//tiktok` cũng lọt qua và bị lưu thành href -> XSS.
 *
 * @returns {{platform: string, url: string} | null}
 */
function parseOrderLink(raw) {
  let text = String(raw == null ? '' : raw).trim();
  if (!text || text.length > MAX_ORDER_LINK_LENGTH) return null;
  if (text.includes('\n') || text.includes('\r')) return null;

  // Người dùng thường dán thiếu "https://" -> tự thêm, nhưng vẫn phải kiểm tra giao thức.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) text = 'https://' + text;

  let url;
  try {
    url = new URL(text);
  } catch (err) {
    return null;
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password) return null;

  const host = url.hostname.toLowerCase();
  for (const rule of ORDER_LINK_RULES) {
    if (rule.suffixes.some((suffix) => hostMatchesSuffix(host, suffix))) {
      return { platform: rule.platform, url: url.toString() };
    }
  }
  return null;
}

module.exports = {
  EMAIL_REGEX,
  PHONE_REGEX,
  REFERRAL_CODE_LENGTH,
  MAX_ORDER_LINK_LENGTH,
  isValidEmail,
  isValidPhone,
  isValidUsername,
  generateReferralCode,
  generateOrderCode,
  generateWithdrawalCode,
  generateTempPassword,
  parseOrderLink
};
