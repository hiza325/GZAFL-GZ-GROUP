'use strict';

/**
 * Test migration: phân bổ các lệnh rút CŨ (items_allocated = 0) cho các đơn
 * hoa hồng khi khởi động lại server.
 *
 * Test dùng database tạm riêng, không đụng dữ liệu thật.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gzafl-backfill-'));
const DB_PATH = path.join(TMP_DIR, 'test.sqlite');
process.env.DB_PATH = DB_PATH;

function loadDb() {
  const id = require.resolve('../db');
  delete require.cache[id];
  return require(id);
}

test('backfill lệnh rút cũ theo đơn, bỏ qua lệnh huỷ và không chạy trùng', (t) => {
  let db = loadDb();

  t.after(() => {
    try {
      db.close();
    } catch (err) {
      // Database đã đóng ở giữa test.
    }
    fs.rmSync(TMP_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  // Lần khởi động đầu tiên trên database rỗng.
  assert.equal(
    Number(db.prepare('SELECT COUNT(*) AS c FROM withdrawal_items').get().c) || 0,
    0
  );

  const now = new Date().toISOString();
  const insertUser = db.prepare(
    `INSERT INTO users
       (username, password_hash, name, email, phone, referral_code, role, points, created_at)
     VALUES (?, 'x', ?, ?, '', ?, 'user', 0, ?)`
  );
  const user = insertUser.run('legacy@test.local', 'Legacy', 'legacy@test.local', 'LEGACY', now);
  const other = insertUser.run('other-legacy@test.local', 'Other', 'other@test.local', 'OTHERLEGACY', now);
  const userId = Number(user.lastInsertRowid);
  const otherId = Number(other.lastInsertRowid);

  const insertOrder = db.prepare(
    `INSERT INTO orders (user_id, code, link, platform, status, commission, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const at = (offset) => new Date(Date.now() - offset).toISOString();
  insertOrder.run(userId, 'LEG-A', 'https://shopee.vn/a', 'Shopee', 'Hoàn thành', 100000, at(9000));
  insertOrder.run(userId, 'LEG-B', 'https://tiki.vn/b', 'Tiki', 'Đã thanh toán', 50000, at(8000));
  insertOrder.run(userId, 'LEG-C', 'https://lazada.vn/c', 'Lazada', 'Hoàn thành', 70000, at(7000));
  insertOrder.run(userId, 'LEG-PENDING', 'https://shopee.vn/d', 'Shopee', 'Chờ admin duyệt', 80000, at(6000));
  insertOrder.run(userId, 'LEG-CANCELLED', 'https://shopee.vn/e', 'Shopee', 'Đã huỷ', 90000, at(5000));
  insertOrder.run(otherId, 'OTHER-A', 'https://shopee.vn/other', 'Shopee', 'Hoàn thành', 999000, at(4000));

  const insertWithdrawal = db.prepare(
    `INSERT INTO withdrawals
       (user_id, code, bank, acc_num, acc_name, amount, status, created_at)
     VALUES (?, ?, 'Vietcombank', '0123456789', 'NGUYEN VAN A', ?, ?, ?)`
  );
  insertWithdrawal.run(userId, 'WD-OLD-PAID', 120000, 'Đã thanh toán', at(3500));
  insertWithdrawal.run(userId, 'WD-OLD-CANCELLED', 80000, 'Đã huỷ', at(3400));
  insertWithdrawal.run(userId, 'WD-OLD-PENDING', 100000, 'Đang xử lý', at(3300));
  insertWithdrawal.run(userId, 'WD-OLD-POINTS', 50000, 'Đã thanh toán', at(3200));

  // Giả lập khởi động lại server: đóng kết nối và nạp lại module db.js.
  db.close();
  db = loadDb();

  const items = db
    .prepare(
      `SELECT w.code AS withdrawal_code, o.code AS order_code, wi.amount
       FROM withdrawal_items wi
       JOIN withdrawals w ON w.id = wi.withdrawal_id
       JOIN orders o ON o.id = wi.order_id
       ORDER BY wi.id ASC`
    )
    .all()
    .map((row) => ({
      withdrawal: row.withdrawal_code,
      order: row.order_code,
      amount: Number(row.amount)
    }));

  assert.deepEqual(items, [
    { withdrawal: 'WD-OLD-PAID', order: 'LEG-A', amount: 100000 },
    { withdrawal: 'WD-OLD-PAID', order: 'LEG-B', amount: 20000 },
    { withdrawal: 'WD-OLD-PENDING', order: 'LEG-B', amount: 30000 },
    { withdrawal: 'WD-OLD-PENDING', order: 'LEG-C', amount: 70000 }
  ]);

  // Lệnh huỷ và phần vượt quá hoa hồng (coi là tiền điểm) không tạo item.
  assert.equal(
    db.prepare("SELECT COUNT(*) AS c FROM withdrawal_items wi JOIN withdrawals w ON w.id = wi.withdrawal_id WHERE w.code = 'WD-OLD-CANCELLED'").get().c,
    0
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS c FROM withdrawal_items wi JOIN withdrawals w ON w.id = wi.withdrawal_id WHERE w.code = 'WD-OLD-POINTS'").get().c,
    0
  );

  // Không được phân bổ sang đơn của người khác, đơn chờ duyệt hoặc đơn huỷ.
  assert.equal(
    db.prepare("SELECT COUNT(*) AS c FROM withdrawal_items wi JOIN orders o ON o.id = wi.order_id WHERE o.code IN ('OTHER-A', 'LEG-PENDING', 'LEG-CANCELLED')").get().c,
    0
  );

  assert.deepEqual(
    db.prepare('SELECT code, items_allocated FROM withdrawals ORDER BY id ASC').all().map((row) => ({
      code: row.code,
      allocated: Number(row.items_allocated)
    })),
    [
      { code: 'WD-OLD-PAID', allocated: 1 },
      { code: 'WD-OLD-CANCELLED', allocated: 1 },
      { code: 'WD-OLD-PENDING', allocated: 1 },
      { code: 'WD-OLD-POINTS', allocated: 1 }
    ]
  );

  // Khởi động lại lần nữa: items_allocated đã bằng 1 nên không được nhân đôi.
  const itemCount = Number(db.prepare('SELECT COUNT(*) AS c FROM withdrawal_items').get().c) || 0;
  db.close();
  db = loadDb();
  assert.equal(Number(db.prepare('SELECT COUNT(*) AS c FROM withdrawal_items').get().c) || 0, itemCount);
});
