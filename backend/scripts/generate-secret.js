'use strict';

/**
 * Sinh một JWT_SECRET ngẫu nhiên đủ mạnh.
 *
 *   npm run gen-secret            -> chỉ in ra màn hình
 *   npm run gen-secret -- --write -> ghi luôn vào backend/.env (tạo nếu chưa có)
 *
 * LƯU Ý: đổi JWT_SECRET sẽ làm MỌI phiên đăng nhập hiện tại hết hiệu lực
 * (người dùng phải đăng nhập lại).
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const secret = crypto.randomBytes(48).toString('base64url');
const envPath = path.join(__dirname, '..', '.env');
const shouldWrite = process.argv.includes('--write');

if (!shouldWrite) {
  console.log('');
  console.log('JWT_SECRET mới:');
  console.log(secret);
  console.log('');
  console.log('Thêm dòng sau vào backend/.env:');
  console.log(`JWT_SECRET=${secret}`);
  console.log('');
  console.log('(Hoặc chạy: npm run gen-secret -- --write  để ghi tự động)');
  process.exit(0);
}

let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
const line = `JWT_SECRET=${secret}`;

if (/^\s*JWT_SECRET\s*=.*$/m.test(content)) {
  content = content.replace(/^\s*JWT_SECRET\s*=.*$/m, line);
} else {
  if (content && !content.endsWith('\n')) content += '\n';
  content += line + '\n';
}

fs.writeFileSync(envPath, content, 'utf8');
console.log(`Đã ghi JWT_SECRET mới vào ${envPath}`);
console.log('Hãy khởi động lại server. Mọi phiên đăng nhập cũ đã hết hiệu lực.');
