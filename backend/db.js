'use strict';

/**
 * Kết nối SQLite (dùng module built-in `node:sqlite`, không cần cài native module).
 * File dữ liệu được lưu ở backend/data/gzafl.sqlite
 */

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'gzafl.sqlite');
const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL DEFAULT '',
    phone         TEXT NOT NULL DEFAULT '',
    avatar_url    TEXT,
    bank_bank     TEXT,
    bank_acc_num  TEXT,
    bank_acc_name TEXT,
    referral_code TEXT NOT NULL UNIQUE,
    points        INTEGER NOT NULL DEFAULT 0,
    role          TEXT NOT NULL DEFAULT 'user',
    token_version INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS orders (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL,
    code         TEXT NOT NULL UNIQUE,
    link         TEXT NOT NULL,
    platform     TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'Đang xử lý',
    commission   INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS withdrawals (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    code       TEXT NOT NULL UNIQUE,
    bank       TEXT NOT NULL,
    acc_num    TEXT NOT NULL,
    acc_name   TEXT NOT NULL,
    amount     INTEGER NOT NULL DEFAULT 0,
    status     TEXT NOT NULL DEFAULT 'Đang xử lý',
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS referrals (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    code       TEXT NOT NULL,
    points     INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    UNIQUE (user_id, code)
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    title      TEXT NOT NULL,
    body       TEXT NOT NULL DEFAULT '',
    icon       TEXT NOT NULL DEFAULT 'bell',
    is_read    INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  );
`);

/**
 * Thêm cột vào bảng đã tồn tại.
 * SQLite không hỗ trợ `ADD COLUMN IF NOT EXISTS`, nên phải tự kiểm tra trước.
 * Nhờ vậy database cũ vẫn nâng cấp được mà không mất dữ liệu.
 *
 * Phải chạy TRƯỚC khi tạo chỉ mục, vì chỉ mục có thể tham chiếu cột vừa thêm.
 */
function ensureColumn(table, column, definition) {
  const columns = db
    .prepare(`SELECT name FROM pragma_table_info('${table}')`)
    .all()
    .map((row) => row.name);
  if (!columns.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

// Thông tin phục vụ chuyển đổi link hoàn tiền (xem docs/affiliate-integration.md)
ensureColumn('orders', 'original_link', 'TEXT');
ensureColumn('orders', 'affiliate_link', 'TEXT');
ensureColumn('orders', 'sub_id', 'TEXT');
ensureColumn('orders', 'network_order_id', 'TEXT');
ensureColumn('orders', 'click_count', 'INTEGER NOT NULL DEFAULT 0');

// Đổi / thu hồi mật khẩu sẽ tăng số này để vô hiệu hoá mọi phiên đăng nhập cũ
ensureColumn('users', 'token_version', 'INTEGER NOT NULL DEFAULT 1');

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_orders_user        ON orders (user_id);
  CREATE INDEX IF NOT EXISTS idx_orders_sub_id      ON orders (sub_id);
  CREATE INDEX IF NOT EXISTS idx_withdrawals_user   ON withdrawals (user_id);
  CREATE INDEX IF NOT EXISTS idx_referrals_user     ON referrals (user_id);
  CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, is_read);
`);

module.exports = db;
