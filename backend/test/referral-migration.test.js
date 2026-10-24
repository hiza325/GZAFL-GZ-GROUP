'use strict';

/**
 * Test migration: các lượt nhập mã giới thiệu CŨ (đã cộng điểm ngay) phải được
 * đánh dấu là đã thưởng khi nâng cấp, còn lượt đang chờ (points = 0) giữ nguyên.
 *
 * Test dùng database tạm riêng, không đụng dữ liệu thật.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gzafl-referral-migration-'));
const DB_PATH = path.join(TMP_DIR, 'test.sqlite');
process.env.DB_PATH = DB_PATH;

function loadDb() {
  const id = require.resolve('../db');
  delete require.cache[id];
  return require(id);
}

test('backfill referrals: lượt cũ đã cộng điểm được đánh dấu đã thưởng', (t) => {
  let db = loadDb();

  t.after(() => {
    try {
      db.close();
    } catch (err) {
      // Database đã đóng ở giữa test.
    }
    fs.rmSync(TMP_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  const now = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO users
         (username, password_hash, name, email, phone, referral_code, role, points, created_at)
       VALUES (?, 'x', ?, ?, '', ?, 'user', 0, ?)`
    )
    .run('legacy-referral@test.local', 'Legacy', 'legacy-referral@test.local', 'LEGACYREF', now);
  const userId = Number(info.lastInsertRowid);

  // Mô phỏng dữ liệu trước khi nâng cấp: cột rewarded_at chưa được set.
  db.prepare(
    `INSERT INTO referrals (user_id, code, points, created_at)
     VALUES (?, 'LEGACY', 100, ?)`
  ).run(userId, now);
  db.prepare(
    `INSERT INTO referrals (user_id, code, points, created_at)
     VALUES (?, 'PENDING', 0, ?)`
  ).run(userId, now);

  // Khởi động lại server -> db.js chạy phần backfill.
  db.close();
  db = loadDb();

  const legacy = db
    .prepare("SELECT points, rewarded_at, rewarded_order_id FROM referrals WHERE code = 'LEGACY'")
    .get();
  assert.equal(Number(legacy.points), 100);
  assert.equal(legacy.rewarded_at, now);
  assert.equal(legacy.rewarded_order_id, null);

  const pending = db
    .prepare("SELECT points, rewarded_at FROM referrals WHERE code = 'PENDING'")
    .get();
  assert.equal(Number(pending.points), 0);
  assert.equal(pending.rewarded_at, null, 'Lượt chờ không được tự đánh dấu đã thưởng');
});
