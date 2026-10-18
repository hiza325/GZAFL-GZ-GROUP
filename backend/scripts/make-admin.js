'use strict';

/**
 * Công cụ dòng lệnh để cấp / thu quyền quản trị.
 *
 *   node scripts/make-admin.js --list
 *   node scripts/make-admin.js <username>
 *   node scripts/make-admin.js <username> --demote
 *
 * `username` là Email hoặc Số điện thoại dùng để đăng nhập.
 * Chạy trong thư mục `backend`.
 */

const db = require('../db');

function listUsers() {
  const rows = db
    .prepare('SELECT id, username, name, role, points FROM users ORDER BY id ASC')
    .all();

  if (rows.length === 0) {
    console.log('Chưa có người dùng nào trong database.');
    return;
  }

  console.log('Danh sách người dùng:');
  for (const row of rows) {
    const mark = row.role === 'admin' ? '[ADMIN]' : '       ';
    console.log(`  ${mark} #${row.id}  ${row.username}  —  ${row.name}  (${row.points} điểm)`);
  }
}

function setRole(username, role) {
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!row) {
    console.error(`Không tìm thấy người dùng có username: ${username}`);
    process.exitCode = 1;
    return;
  }

  if (row.role === role) {
    console.log(`Người dùng "${row.username}" đã là "${role}" rồi, không cần đổi.`);
    return;
  }

  if (role === 'user') {
    const adminCount = Number(db.prepare(`SELECT COUNT(*) AS c FROM users WHERE role = 'admin'`).get().c) || 0;
    if (adminCount <= 1) {
      console.error('Không thể hạ quyền: hệ thống phải còn ít nhất một quản trị viên.');
      process.exitCode = 1;
      return;
    }
  }

  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, row.id);

  if (role === 'admin') {
    console.log(`Đã cấp quyền quản trị cho "${row.username}" (${row.name}).`);
    console.log('Không cần đăng nhập lại: tải lại trang là mục "Quản trị" sẽ hiện ra.');
  } else {
    console.log(`Đã thu quyền quản trị của "${row.username}".`);
  }
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log('Cách dùng:');
    console.log('  node scripts/make-admin.js --list            Liệt kê người dùng');
    console.log('  node scripts/make-admin.js <username>        Cấp quyền quản trị');
    console.log('  node scripts/make-admin.js <username> --demote   Thu quyền quản trị');
    return;
  }

  if (args.includes('--list')) {
    listUsers();
    return;
  }

  const username = args.find((arg) => !arg.startsWith('--'));
  if (!username) {
    console.error('Thiếu username. Xem hướng dẫn bằng: node scripts/make-admin.js --help');
    process.exitCode = 1;
    return;
  }

  setRole(username, args.includes('--demote') ? 'user' : 'admin');
}

main();
