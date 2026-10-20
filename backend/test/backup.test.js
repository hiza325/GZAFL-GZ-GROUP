'use strict';

/**
 * Test script sao lưu: database + ảnh + tự dọn bản cũ.
 * Chạy: npm test
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const BACKEND_DIR = path.join(__dirname, '..');
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gzafl-backup-'));
const DB_PATH = path.join(TMP_DIR, 'src.sqlite');
const UPLOAD_DIR = path.join(TMP_DIR, 'uploads');
const BACKUP_DIR = path.join(TMP_DIR, 'backups');
const ENV_FILE = path.join(TMP_DIR, 'empty.env');

function runBackup(extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/backup.js'], {
      cwd: BACKEND_DIR,
      env: {
        ...process.env,
        GZAFL_ENV_FILE: ENV_FILE,
        DB_PATH,
        UPLOAD_DIR,
        BACKUP_DIR,
        BACKUP_KEEP_DAYS: '14',
        ...extraEnv
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });

    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`backup.js thoát với mã ${code}:\n${output}`));
    });
  });
}

test('sao lưu database + ảnh, tự dọn bản cũ', { timeout: 30_000 }, async (t) => {
  t.after(() => {
    fs.rmSync(TMP_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  fs.writeFileSync(ENV_FILE, '# test\n', 'utf8');
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOAD_DIR, 'avatar_test.webp'), 'x');

  const db = new DatabaseSync(DB_PATH);
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT)');
  db.exec("INSERT INTO users (username) VALUES ('alice')");
  db.close();

  // Bản sao lưu "cũ" 30 ngày để kiểm tra tự dọn
  const oldDir = path.join(BACKUP_DIR, '2020-01-01T00-00-00-000Z');
  fs.mkdirSync(oldDir, { recursive: true });
  const oldTime = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  fs.utimesSync(oldDir, oldTime, oldTime);

  const output = await runBackup();
  assert.match(output, /Đã sao lưu xong/);

  const dirs = fs
    .readdirSync(BACKUP_DIR)
    .filter((name) => /^\d{4}-\d{2}-\d{2}T/.test(name) && name !== '2020-01-01T00-00-00-000Z');
  assert.equal(dirs.length, 1, 'Phải tạo đúng 1 thư mục sao lưu mới');

  assert.equal(fs.existsSync(oldDir), false, 'Bản sao lưu cũ phải bị xoá');

  const newDir = path.join(BACKUP_DIR, dirs[0]);
  const backupDb = path.join(newDir, 'gzafl.sqlite');
  assert.ok(fs.existsSync(backupDb), 'Phải có file database sao lưu');

  const copy = new DatabaseSync(backupDb);
  const row = copy.prepare('SELECT COUNT(*) AS c FROM users').get();
  copy.close();
  assert.equal(Number(row.c), 1, 'Database sao lưu phải có đủ dữ liệu');

  const copiedUpload = path.join(newDir, 'uploads', 'avatar_test.webp');
  assert.equal(fs.readFileSync(copiedUpload, 'utf8'), 'x');
  assert.ok(fs.existsSync(path.join(newDir, 'manifest.json')));
});
