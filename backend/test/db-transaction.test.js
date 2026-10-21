'use strict';

/**
 * Test helper transaction() trong db.js.
 *
 * Mỗi file test chạy trong tiến trình riêng, nên đặt DB_PATH vào thư mục tạm
 * TRƯỚC khi require db.js để không đụng database thật.
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gzafl-tx-'));
process.env.DB_PATH = path.join(TMP_DIR, 'test.sqlite');

const db = require('../db');

after(() => {
  try {
    db.close();
  } catch (err) {
    /* bỏ qua */
  }
  fs.rmSync(TMP_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

let seq = 0;
function insertUser(name = 'Người dùng') {
  seq += 1;
  const username = `tx${seq}@test.local`;
  db.prepare(
    `INSERT INTO users (username, password_hash, name, email, referral_code, created_at)
     VALUES (?, 'x', ?, ?, ?, ?)`
  ).run(username, name, username, `TX${seq}`, new Date().toISOString());
  return username;
}

function userExists(username) {
  return Boolean(db.prepare('SELECT 1 AS x FROM users WHERE username = ?').get(username));
}

test('transaction(): commit và trả về giá trị', () => {
  const username = insertUser('Một');
  const before = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;

  const result = db.transaction(() => {
    db.prepare('UPDATE users SET name = ? WHERE username = ?').run('Đã đổi', username);
    return 'ok';
  });

  assert.equal(result, 'ok');
  assert.equal(db.prepare('SELECT name FROM users WHERE username = ?').get(username).name, 'Đã đổi');
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM users').get().c, before);
});

test('transaction(): lỗi giữa chừng thì ROLLBACK toàn bộ', () => {
  const username = insertUser('Hai');
  const before = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;

  assert.throws(
    () =>
      db.transaction(() => {
        db.prepare('UPDATE users SET name = ? WHERE username = ?').run('Không được lưu', username);
        insertUser('Tạo dở dang');
        throw new Error('boom');
      }),
    /boom/
  );

  // Cả UPDATE lẫn INSERT đều phải bị huỷ
  assert.equal(db.prepare('SELECT name FROM users WHERE username = ?').get(username).name, 'Hai');
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM users').get().c, before);

  // Transaction vẫn dùng được sau khi rollback
  const ok = db.transaction(() => {
    insertUser('Sau rollback');
    return true;
  });
  assert.equal(ok, true);
});

test('transaction(): gọi lồng nhau không lỗi BEGIN, rollback lan ra ngoài', () => {
  const username = insertUser('Ba');

  db.transaction(() => {
    db.transaction(() => {
      db.prepare('UPDATE users SET name = ? WHERE username = ?').run('Lồng trong', username);
    });
    db.prepare('UPDATE users SET phone = ? WHERE username = ?').run('0900000000', username);
  });

  const row = db.prepare('SELECT name, phone FROM users WHERE username = ?').get(username);
  assert.equal(row.name, 'Lồng trong');
  assert.equal(row.phone, '0900000000');

  assert.throws(
    () =>
      db.transaction(() => {
        db.transaction(() => {
          db.prepare('UPDATE users SET name = ? WHERE username = ?').run('Sẽ bị huỷ', username);
          throw new Error('lỗi bên trong');
        });
      }),
    /lỗi bên trong/
  );
  assert.equal(db.prepare('SELECT name FROM users WHERE username = ?').get(username).name, 'Lồng trong');
});

test('transaction(): từ chối hàm async (tránh commit sớm)', () => {
  assert.throws(
    () => db.transaction(async () => 'promise'),
    /phải đồng bộ/
  );
});
