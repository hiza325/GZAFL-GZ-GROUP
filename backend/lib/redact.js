'use strict';

/**
 * Che các tham số nhạy cảm trước khi LƯU hoặc HIỂN THỊ.
 *
 * Postback của mạng affiliate gửi kèm chìa khoá (POSTBACK_SECRET) trong query string.
 * Nếu giữ nguyên, chìa khoá sẽ nằm trong postback_logs.query và lộ ra cả ở trang quản trị.
 *
 * Lưu ý: tên tham số chứa chìa khoá có thể được đổi bằng POSTBACK_PARAM_SECRET
 * (ví dụ AccessTrade gọi là "action_id"). Vì vậy danh sách nhạy cảm phải được
 * tính lại mỗi lần dùng, không được đóng cứng lúc nạp module.
 */

const BASE_SENSITIVE_KEYS = [
  'secret',
  'key',
  'token',
  'signature',
  'sign',
  'secure',
  'hash',
  'apikey',
  'api_key',
  'password',
  'pass'
];

const BASE_SET = new Set(BASE_SENSITIVE_KEYS);

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Tất cả tên tham số cần che: danh sách mặc định + tên tuỳ chỉnh trong .env. */
function sensitiveKeys() {
  const keys = new Set(BASE_SET);
  const custom = String(process.env.POSTBACK_PARAM_SECRET || '')
    .trim()
    .toLowerCase();
  if (custom) keys.add(custom);
  return keys;
}

function isSensitiveKey(name) {
  return sensitiveKeys().has(String(name || '').trim().toLowerCase());
}

/** Trả về bản sao của object tham số với giá trị nhạy cảm đã bị thay bằng nhãn. */
function redactParams(params) {
  const out = {};
  if (!params || typeof params !== 'object') return out;
  const keys = sensitiveKeys();
  for (const [key, value] of Object.entries(params)) {
    out[key] = keys.has(String(key).trim().toLowerCase()) ? '[đã ẩn]' : value;
  }
  return out;
}

/**
 * Che tham số nhạy cảm trong chuỗi thô đã lưu trong database.
 * Dùng cho dữ liệu CŨ (lưu trước khi có tính năng che), kể cả chuỗi JSON bị cắt.
 */
function redactStoredQuery(text) {
  const raw = String(text == null ? '' : text);
  if (!raw) return '';
  const names = [...sensitiveKeys()].map(escapeRegExp).join('|');
  if (!names) return raw;
  const pattern = new RegExp(
    '("(?:' + names + ')"\\s*:\\s*)("(?:[^"\\\\]|\\\\.)*"|[^,}\\]]+)',
    'gi'
  );
  return raw.replace(pattern, '$1"[đã ẩn]"');
}

module.exports = { isSensitiveKey, redactParams, redactStoredQuery };
