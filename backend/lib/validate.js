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

function generateOrderCode() {
  return 'GZ' + randomDigits(6);
}

function generateWithdrawalCode() {
  return 'WD' + randomDigits(6);
}

function detectPlatform(link) {
  if (/tiktok/i.test(link)) return 'TikTok Shop';
  if (/lazada/i.test(link)) return 'Lazada';
  if (/(shopee\.vn|shp\.ee)/i.test(link)) return 'Shopee';
  return null;
}

module.exports = {
  EMAIL_REGEX,
  PHONE_REGEX,
  REFERRAL_CODE_LENGTH,
  isValidEmail,
  isValidPhone,
  isValidUsername,
  generateReferralCode,
  generateOrderCode,
  generateWithdrawalCode,
  detectPlatform
};
