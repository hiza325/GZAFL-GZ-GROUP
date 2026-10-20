'use strict';

/**
 * Che các tham số nhạy cảm trước khi LƯU hoặc HIỂN THỊ.
 *
 * Postback của mạng affiliate gửi kèm chìa khoá (POSTBACK_SECRET) trong query string.
 * Nếu giữ nguyên, chìa khoá sẽ nằm trong postback_logs.query và lộ ra cả ở trang quản trị.
 */

const SENSITIVE_KEYS = new Set([
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
]);

// Thay giá trị của các key nhạy cảm trong chuỗi JSON đã lưu (kể cả JSON bị cắt ngắn).
const SENSITIVE_JSON = new RegExp(
  '("(?:' + [...SENSITIVE_KEYS].join('|') + ')"\\s*:\\s*)("(?:[^"\\\\]|\\\\.)*"|[^,}\\]]+)',
  'gi'
);

function isSensitiveKey(name) {
  return SENSITIVE_KEYS.has(String(name || '').trim().toLowerCase());
}

/** Trả về bản sao của object tham số với giá trị nhạy cảm đã bị thay bằng nhãn. */
function redactParams(params) {
  const out = {};
  if (!params || typeof params !== 'object') return out;
  for (const [key, value] of Object.entries(params)) {
    out[key] = isSensitiveKey(key) ? '[đã ẩn]' : value;
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
  return raw.replace(SENSITIVE_JSON, '$1"[đã ẩn]"');
}

module.exports = { isSensitiveKey, redactParams, redactStoredQuery };
