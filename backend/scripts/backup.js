'use strict';

/**
 * Sao lưu "nóng" (không cần dừng server):
 *   - Database: dùng VACUUM INTO để SQLite tự tạo bản sao nhất quán
 *     (kể cả khi đang có người dùng ghi dữ liệu).
 *   - Ảnh: copy nguyên thư mục uploads/ (avatar + ảnh QR).
 *   - Tự xoá bản sao lưu cũ hơn BACKUP_KEEP_DAYS ngày.
 *
 * Dùng:
 *   npm run backup
 *
 * Biến môi trường (đọc từ backend/.env):
 *   DB_PATH            mặc định backend/data/gzafl.sqlite
 *   UPLOAD_DIR         mặc định backend/uploads
 *   BACKUP_DIR         mặc định backend/backups
 *   BACKUP_KEEP_DAYS   mặc định 14
 *
 * Ví dụ đặt lịch:
 *   - Windows Task Scheduler: chạy `node scripts/backup.js`, mỗi ngày 02:00
 *   - Linux cron: 0 2 * * * cd /srv/gzafl/backend && node scripts/backup.js
 */

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

require('../lib/env');

const BACKEND_DIR = path.join(__dirname, '..');
const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(BACKEND_DIR, 'data', 'gzafl.sqlite');
const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(BACKEND_DIR, process.env.UPLOAD_DIR)
  : path.join(BACKEND_DIR, 'uploads');
const BACKUP_DIR = process.env.BACKUP_DIR
  ? path.resolve(BACKEND_DIR, process.env.BACKUP_DIR)
  : path.join(BACKEND_DIR, 'backups');
const KEEP_DAYS = Number.isFinite(Number(process.env.BACKUP_KEEP_DAYS))
  ? Math.max(1, Math.floor(Number(process.env.BACKUP_KEEP_DAYS)))
  : 14;

function fail(message) {
  console.error(`LỖI: ${message}`);
  process.exit(1);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function countFiles(dir) {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) total += countFiles(path.join(dir, entry.name));
    else if (entry.isFile()) total += 1;
  }
  return total;
}

function main() {
  if (!fs.existsSync(DB_PATH)) fail(`Không thấy database tại ${DB_PATH}`);

  // Tên thư mục: 2026-10-20T02-00-00-000Z (không có ký tự ':' để dùng được trên Windows)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.join(BACKUP_DIR, stamp);
  fs.mkdirSync(outDir, { recursive: true });

  const dbOut = path.join(outDir, 'gzafl.sqlite');
  const db = new DatabaseSync(DB_PATH);
  try {
    // Tham số hoá đường dẫn: an toàn với dấu cách, dấu nháy, ký tự Unicode
    db.prepare('VACUUM INTO ?').run(dbOut);
  } catch (err) {
    db.close();
    fail(`Không sao lưu được database: ${err.message}`);
  }
  db.close();

  // Copy ảnh (nếu có). Giữ nguyên tên file vì tên QR chứa id người dùng.
  let uploadFiles = 0;
  if (fs.existsSync(UPLOAD_DIR)) {
    fs.cpSync(UPLOAD_DIR, path.join(outDir, 'uploads'), { recursive: true });
    uploadFiles = countFiles(path.join(outDir, 'uploads'));
  }

  const manifest = {
    created_at: new Date().toISOString(),
    database: 'gzafl.sqlite',
    database_bytes: fs.statSync(dbOut).size,
    uploads: 'uploads/',
    upload_files: uploadFiles,
    keep_days: KEEP_DAYS
  };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  // Dọn bản sao lưu cũ (chỉ xoá thư mục do script này tạo)
  let removed = 0;
  const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
  if (fs.existsSync(BACKUP_DIR)) {
    for (const entry of fs.readdirSync(BACKUP_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^\d{4}-\d{2}-\d{2}T/.test(entry.name)) continue;
      const full = path.join(BACKUP_DIR, entry.name);
      try {
        if (fs.statSync(full).mtimeMs < cutoff) {
          fs.rmSync(full, { recursive: true, force: true });
          removed += 1;
        }
      } catch (err) {
        console.warn(`Không xoá được bản sao lưu cũ ${entry.name}: ${err.message}`);
      }
    }
  }

  console.log('Đã sao lưu xong:');
  console.log(`  Thư mục : ${outDir}`);
  console.log(`  Database: gzafl.sqlite (${formatBytes(manifest.database_bytes)})`);
  console.log(`  Ảnh     : ${uploadFiles} file`);
  console.log(`  Giữ lại : ${KEEP_DAYS} ngày${removed ? ` (đã xoá ${removed} bản cũ)` : ''}`);
}

try {
  main();
} catch (err) {
  fail(err.message);
}
