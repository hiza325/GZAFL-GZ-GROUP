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
// Chờ tối đa 5 giây khi tiến trình khác đang ghi (tránh lỗi SQLITE_BUSY khi
// chạy nhiều instance hoặc khi vừa backup vừa có người dùng thao tác).
db.exec('PRAGMA busy_timeout = 5000;');

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

  CREATE TABLE IF NOT EXISTS password_resets (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    status      TEXT NOT NULL DEFAULT 'Chờ xử lý',
    note        TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL,
    resolved_at TEXT,
    resolved_by INTEGER,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  );

  -- Mã OTP gửi qua email (xác thực đăng ký + tự đặt lại mật khẩu).
  -- Lưu bcrypt hash của mã, không lưu mã gốc.
  CREATE TABLE IF NOT EXISTS email_otps (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    purpose      TEXT NOT NULL,
    email        TEXT NOT NULL,
    username     TEXT NOT NULL DEFAULT '',
    code_hash    TEXT NOT NULL,
    attempts     INTEGER NOT NULL DEFAULT 0,
    sends        INTEGER NOT NULL DEFAULT 0,
    window_start TEXT NOT NULL,
    last_sent_at TEXT NOT NULL,
    expires_at   TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    UNIQUE (purpose, email)
  );

  -- Chống spam thư thông báo (ví dụ "tài khoản đã tồn tại"): mỗi email chỉ nhận
  -- một thư cùng loại trong một khoảng thời gian.
  CREATE TABLE IF NOT EXISTS email_notices (
    email        TEXT NOT NULL,
    kind         TEXT NOT NULL,
    last_sent_at TEXT NOT NULL,
    PRIMARY KEY (email, kind)
  );

  -- Nhật ký postback: mạng affiliate gọi vào mỗi khi có chuyển đổi.
  -- Ghi NGUYÊN tham số nhận được TRƯỚC khi xử lý, để còn đối soát khi có khiếu nại.
  -- payload_hash dùng để chống xử lý trùng: mạng gửi lại y hệt thì chỉ tăng dup_count.
  CREATE TABLE IF NOT EXISTS postback_logs (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    provider         TEXT NOT NULL DEFAULT '',
    payload_hash     TEXT NOT NULL,
    received_at      TEXT NOT NULL,
    last_received_at TEXT NOT NULL,
    dup_count        INTEGER NOT NULL DEFAULT 1,
    ip               TEXT NOT NULL DEFAULT '',
    query            TEXT NOT NULL DEFAULT '',
    transaction_id   TEXT NOT NULL DEFAULT '',
    product_id       TEXT NOT NULL DEFAULT '',
    conversion_id    TEXT NOT NULL DEFAULT '',
    reward           INTEGER NOT NULL DEFAULT 0,
    network_status   TEXT NOT NULL DEFAULT '',
    sub_id           TEXT NOT NULL DEFAULT '',
    user_id          INTEGER,
    order_code       TEXT NOT NULL DEFAULT '',
    action           TEXT NOT NULL DEFAULT '',
    note             TEXT NOT NULL DEFAULT ''
  );

  -- Nhật ký thao tác của quản trị viên (ai đổi gì, khi nào).
  -- CỐ Ý không dùng khoá ngoại tới users: xoá người dùng vẫn phải giữ lại nhật ký.
  CREATE TABLE IF NOT EXISTS admin_audit_logs (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id       INTEGER,
    actor_name     TEXT NOT NULL DEFAULT '',
    actor_username TEXT NOT NULL DEFAULT '',
    action         TEXT NOT NULL,
    target_type    TEXT NOT NULL DEFAULT '',
    target_id      TEXT NOT NULL DEFAULT '',
    detail         TEXT NOT NULL DEFAULT '',
    ip             TEXT NOT NULL DEFAULT '',
    created_at     TEXT NOT NULL
  );

  -- Bộ đếm giới hạn tần suất dùng chung khi chạy nhiều tiến trình
  -- (RATE_LIMIT_STORE=sqlite). Khoá gồm tên bộ đếm + IP/người dùng.
  CREATE TABLE IF NOT EXISTS rate_limits (
    key      TEXT PRIMARY KEY,
    count    INTEGER NOT NULL DEFAULT 0,
    reset_at INTEGER NOT NULL
  );

  -- Hạn mức gọi AI theo ngày, dùng chung giữa nhiều tiến trình.
  -- Nhờ vậy chạy 2-4 instance vẫn không vượt AI_DAILY_LIMIT.
  CREATE TABLE IF NOT EXISTS ai_usage (
    day   TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 0
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

// Hoa hồng do MẠNG AFFILIATE báo về (qua postback), tách riêng khỏi `commission`
// là tiền thực sự ghi cho người dùng. Nhờ vậy tiền chưa được mạng duyệt
// (đang chờ đối soát) không bị tính vào số dư khả dụng.
ensureColumn('orders', 'network_commission', 'INTEGER NOT NULL DEFAULT 0');
// Trạng thái chuyển đổi bên mạng: pending | approved | rejected
ensureColumn('orders', 'network_status', 'TEXT');
ensureColumn('orders', 'network_updated_at', 'TEXT');

// Đổi / thu hồi mật khẩu sẽ tăng số này để vô hiệu hoá mọi phiên đăng nhập cũ
ensureColumn('users', 'token_version', 'INTEGER NOT NULL DEFAULT 1');

// Ảnh QR nhận tiền (VietQR...) do người dùng tải lên ở hộp thoại rút tiền
ensureColumn('users', 'bank_qr_url', 'TEXT');

// Lệnh rút chụp lại ảnh QR tại thời điểm gửi: người dùng đổi ảnh sau này
// cũng không làm thay đổi ảnh mà quản trị viên đang dùng để chuyển tiền.
ensureColumn('withdrawals', 'qr_url', 'TEXT');

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_orders_user        ON orders (user_id);
  CREATE INDEX IF NOT EXISTS idx_orders_sub_id      ON orders (sub_id);
  CREATE INDEX IF NOT EXISTS idx_withdrawals_user   ON withdrawals (user_id);
  CREATE INDEX IF NOT EXISTS idx_referrals_user     ON referrals (user_id);
  CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, is_read);
  CREATE INDEX IF NOT EXISTS idx_pwd_resets_status   ON password_resets (status, created_at);
  CREATE INDEX IF NOT EXISTS idx_postback_tx        ON postback_logs (transaction_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_postback_hash ON postback_logs (payload_hash);
  CREATE INDEX IF NOT EXISTS idx_audit_created       ON admin_audit_logs (created_at);
  CREATE INDEX IF NOT EXISTS idx_rate_limits_reset   ON rate_limits (reset_at);
`);

// Chống 2 đơn cùng nhận một giao dịch của mạng. Dùng chỉ mục một phần (chỉ áp dụng
// khi network_order_id khác NULL) nên các đơn cũ chưa có mã giao dịch không bị ảnh hưởng.
// Bọc try/catch: nếu dữ liệu cũ đã có trùng thì KHÔNG được làm server không khởi động được.
try {
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_network
       ON orders (network_order_id) WHERE network_order_id IS NOT NULL`
  );
} catch (err) {
  console.warn(`CẢNH BÁO: chưa tạo được chỉ mục chống trùng giao dịch (${err.message}).`);
}

module.exports = db;
