'use strict';

/**
 * Đọc số tiền do mạng affiliate gửi về.
 *
 * Mạng có thể gửi nhiều định dạng khác nhau cho cùng một khoản:
 *   "225", "225.0", "1,250", "225.000", "1.250.000",
 *   "1.250.000,50" (kiểu Việt Nam) hoặc "1,250,000.50" (kiểu Anh/Mỹ).
 *
 * Quy tắc:
 *  - Có cả "." và ",": dấu xuất hiện SAU CÙNG là dấu thập phân,
 *    dấu còn lại là phân cách hàng nghìn.
 *  - Chỉ có một loại dấu:
 *      · nhiều lần lặp, hoặc đúng 3 chữ số sau dấu cuối -> phân cách hàng nghìn
 *      · 1-2 chữ số sau dấu                            -> dấu thập phân
 *  - Kết quả luôn là số nguyên đồng (làm tròn).
 */

/** Xử lý trường hợp chuỗi chỉ dùng một loại dấu phân cách (xem parseMoney). */
function normalizeSeparators(s, sep) {
  const parts = s.split(sep);
  const last = parts[parts.length - 1];
  // Nhiều dấu, hoặc đúng 3 chữ số ở nhóm cuối -> đây là phân cách hàng nghìn.
  if (parts.length > 2 || last.length === 3) return parts.join('');
  // Một dấu với 1-2 chữ số phía sau -> dấu thập phân.
  return parts.length === 2 ? `${parts[0]}.${last}` : parts.join('');
}

function parseMoney(value) {
  let s = String(value == null ? '' : value).replace(/[^0-9.,-]/g, '');
  if (!/[0-9]/.test(s)) return 0;

  const negative = s.trim().startsWith('-');
  s = s.replace(/-/g, '');

  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');

  let normalized;
  if (lastDot !== -1 && lastComma !== -1) {
    const decimalSep = lastDot > lastComma ? '.' : ',';
    const thousandSep = decimalSep === '.' ? ',' : '.';
    normalized = s.split(thousandSep).join('').replace(decimalSep, '.');
  } else if (lastComma !== -1) {
    normalized = normalizeSeparators(s, ',');
  } else if (lastDot !== -1) {
    normalized = normalizeSeparators(s, '.');
  } else {
    normalized = s;
  }

  const n = parseFloat(normalized);
  if (!Number.isFinite(n)) return 0;
  const rounded = Math.round(Math.abs(n)) * (negative ? -1 : 1);
  return Object.is(rounded, -0) ? 0 : rounded;
}

module.exports = { parseMoney, normalizeSeparators };
