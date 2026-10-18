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
    created_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS orders (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    code       TEXT NOT NULL UNIQUE,
    link       TEXT NOT NULL,
    platform   TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'Đang xử lý',
    commission INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
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

  CREATE INDEX IF NOT EXISTS idx_orders_user      ON orders (user_id);
  CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON withdrawals (user_id);
  CREATE INDEX IF NOT EXISTS idx_referrals_user   ON referrals (user_id);
`);

module.exports = db;
