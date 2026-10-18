'use strict';

/**
 * Đặt lại mật khẩu cho một tài khoản (dùng khi quên mật khẩu / bị khoá).
 *
 *   node scripts/reset-password.js <username>
 *   node scripts/reset-password.js <username> MatKhauMoi123
 *   node scripts/reset-password.js --list
 *
 * `username` là Email hoặc Số điện thoại dùng để đăng nhập.
 * Nếu không truyền mật khẩu mới, script sẽ sinh một mật khẩu ngẫu nhiên và in ra.
 *
 * Việc đổi mật khẩu cũng tăng token_version -> mọi phiên đăng nhập cũ hết hiệu lực.
 * Chạy trong thư mục `backend`.
 */

require('../lib/env');

const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');

const BCRYPT_ROUNDS = 10;

const args = process.argv.slice(2);

function listUsers() {
  const rows = db
    .prepare('SELECT id, username, name, role FROM users ORDER BY id ASC')
    .all();

  if (!rows.length) {
    console.log('Chưa có người dùng nào trong database.');
    return;
  }

  console.log('Danh sách người dùng:');
  rows.forEach((row) => {
    console.log(`  #${row.id}  ${row.username}  —  ${row.name}  [${row.role}]`);
  });
}

function makeRandomPassword() {
  // 12 ký tự, bỏ các ký tự dễ nhầm (0/O, 1/l/I)
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

if (!args.length || args[0] === '--list' || args[0] === '-l') {
  listUsers();
  console.log('');
  console.log('Đặt lại mật khẩu: node scripts/reset-password.js <username> [mật khẩu mới]');
  process.exit(0);
}

const username = String(args[0]).trim();
const provided = args[1];

if (!provided && args.length > 1) {
  console.error('LỖI: Mật khẩu mới không được để trống.');
  process.exit(1);
}

const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
if (!row) {
  console.error(`Không tìm thấy người dùng có username: ${username}`);
  process.exit(1);
}

const newPassword = provided || makeRandomPassword();

if (newPassword.length < 6) {
  console.error('LỖI: Mật khẩu phải có ít nhất 6 ký tự.');
  process.exit(1);
}

const hash = bcrypt.hashSync(newPassword, BCRYPT_ROUNDS);
db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?').run(
  hash,
  row.id
);

// Đóng luôn mọi yêu cầu khôi phục đang chờ của tài khoản này (nếu có),
// để hàng đợi trong trang quản trị không còn hiện việc đã làm xong.
const { RESET_PENDING } = require('../lib/constants');
const closed = db
  .prepare('UPDATE password_resets SET status = ?, resolved_at = ? WHERE user_id = ? AND status = ?')
  .run('Đã xử lý', new Date().toISOString(), row.id, RESET_PENDING);

console.log('');
console.log(`Đã đặt lại mật khẩu cho "${row.username}" (${row.name}).`);
console.log(`  Mật khẩu mới: ${newPassword}`);
if (closed.changes) {
  console.log(`  Đã đóng ${closed.changes} yêu cầu khôi phục mật khẩu đang chờ trong trang quản trị.`);
}
console.log('');
console.log('Mọi phiên đăng nhập cũ đã hết hiệu lực. Hãy đăng nhập lại rồi đổi mật khẩu nếu muốn.');
