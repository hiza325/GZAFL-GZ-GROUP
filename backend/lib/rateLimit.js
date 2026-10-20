'use strict';

/**
 * Giới hạn số yêu cầu (chống dò mật khẩu / spam).
 *
 * Có 2 nơi lưu bộ đếm, chọn bằng RATE_LIMIT_STORE:
 *
 *   memory (mặc định)
 *     Nhanh, không ghi đĩa. Nhưng MỖI TIẾN TRÌNH có bộ đếm riêng, nên chỉ đúng
 *     khi chạy đúng 1 tiến trình (PM2 fork mode, không dùng cluster).
 *
 *   sqlite
 *     Dùng bảng `rate_limits` trong cùng file database, nên nhiều tiến trình /
 *     nhiều instance trên cùng máy dùng chung một bộ đếm. Chậm hơn memory một
 *     chút (mỗi lượt là một UPSERT) nhưng đúng khi scale.
 *
 * Khi SQLite gặp lỗi (ổ đĩa đầy, DB khoá...), tự lùi về bộ nhớ và chỉ cảnh báo
 * một lần, để việc chống spam không làm sập cả web.
 */

const MAX_ENTRIES = 10000;
const SQLITE_CLEAN_EVERY_MS = 60 * 1000;
const SQLITE_KEEP_EXPIRED_MS = 60 * 60 * 1000;

/** Tên kho đang dùng (để log lúc khởi động). */
function storeName() {
  return String(process.env.RATE_LIMIT_STORE || 'memory').trim().toLowerCase();
}

/** Khoá của một lượt gọi: ưu tiên hàm key() do nơi gọi truyền vào. */
function identify(req, key) {
  if (typeof key === 'function') return String(key(req));
  return (req.ip || 'unknown') + ':' + (req.baseUrl || '');
}

/** Gắn header để client biết còn bao nhiêu lượt (và khi nào thử lại). */
function applyHeaders(res, max, count, resetAt) {
  res.setHeader('X-RateLimit-Limit', String(max));
  res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - count)));
  if (count > max) {
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))));
  }
}

function tooMany(res) {
  return res.status(429).json({ error: 'Quá nhiều yêu cầu. Vui lòng thử lại sau ít phút.' });
}

/* ==========================================
   Bộ đếm trong bộ nhớ
   ========================================== */

function memoryLimiter({ windowMs = 60 * 1000, max = 30, key } = {}) {
  const hits = new Map();
  let lastSweep = 0;

  function sweep(now) {
    if (now - lastSweep < windowMs && hits.size <= MAX_ENTRIES) return;
    lastSweep = now;
    for (const [k, entry] of hits) {
      if (entry.reset < now) hits.delete(k);
    }
    // Vẫn quá nhiều (bị dội khoá rác): bỏ bớt khoá cũ nhất.
    if (hits.size > MAX_ENTRIES) {
      let excess = hits.size - MAX_ENTRIES;
      for (const k of hits.keys()) {
        hits.delete(k);
        if (--excess <= 0) break;
      }
    }
  }

  return function rateLimitMemory(req, res, next) {
    const now = Date.now();
    sweep(now);

    const id = identify(req, key);
    let entry = hits.get(id);
    if (!entry || now > entry.reset) entry = { count: 0, reset: now + windowMs };

    entry.count += 1;
    hits.set(id, entry);

    applyHeaders(res, max, entry.count, entry.reset);
    if (entry.count > max) return tooMany(res);
    next();
  };
}

/* ==========================================
   Bộ đếm dùng chung trong SQLite
   ========================================== */

function sqliteLimiter({ windowMs = 60 * 1000, max = 30, key, name } = {}) {
  const db = require('../db'); // nạp muộn: module này không cần DB khi dùng memory

  // Tên bộ đếm phải khác nhau giữa các route, nếu không hai route sẽ dùng
  // chung một bộ đếm và vô tình siết chặt lẫn nhau.
  const prefix = String(name || 'default');

  const hitStmt = db.prepare(`
    INSERT INTO rate_limits (key, count, reset_at) VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET
      count    = CASE WHEN reset_at <= ? THEN 1 ELSE count + 1 END,
      reset_at = CASE WHEN reset_at <= ? THEN ? ELSE reset_at END
    RETURNING count, reset_at
  `);
  const cleanStmt = db.prepare('DELETE FROM rate_limits WHERE reset_at < ?');

  const fallback = memoryLimiter({ windowMs, max, key });
  let lastClean = 0;
  let warned = false;

  return function rateLimitSqlite(req, res, next) {
    const now = Date.now();

    if (now - lastClean > SQLITE_CLEAN_EVERY_MS) {
      lastClean = now;
      try {
        cleanStmt.run(now - SQLITE_KEEP_EXPIRED_MS);
      } catch (err) {
        // Dọn dẹp lỗi không ảnh hưởng việc chặn spam
      }
    }

    let row;
    try {
      row = hitStmt.get(`${prefix}:${identify(req, key)}`, now + windowMs, now, now, now + windowMs);
    } catch (err) {
      if (!warned) {
        console.error(`Lỗi bộ đếm SQLite (${err.message}). Tạm dùng bộ nhớ cho tới khi khởi động lại.`);
        warned = true;
      }
      return fallback(req, res, next);
    }

    const count = Number(row && row.count) || 0;
    const resetAt = Number(row && row.reset_at) || now + windowMs;

    applyHeaders(res, max, count, resetAt);
    if (count > max) return tooMany(res);
    next();
  };
}

/* ==========================================
   Chọn kho
   ========================================== */

function rateLimit(options = {}) {
  const store = String(options.store || storeName()).trim().toLowerCase();

  if (store === 'sqlite') {
    try {
      return sqliteLimiter(options);
    } catch (err) {
      console.warn(`Không dùng được rate limit SQLite (${err.message}). Chuyển sang bộ nhớ.`);
    }
  }
  return memoryLimiter(options);
}

module.exports = { rateLimit, storeName };
