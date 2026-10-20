'use strict';

/**
 * Giới hạn số yêu cầu đơn giản theo bộ nhớ (chống dò mật khẩu / spam).
 * Chỉ phù hợp cho một tiến trình đơn; production nên dùng Redis hoặc middleware chuẩn.
 */

// Trần số khoá lưu trong bộ nhớ. Vượt trần thì dọn khoá hết hạn / khoá cũ nhất,
// tránh kẻ xấu gọi vào đường dẫn ngẫu nhiên làm phình bộ nhớ (DoS).
const MAX_ENTRIES = 10000;

function rateLimit({ windowMs = 60 * 1000, max = 30, key } = {}) {
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

  return function (req, res, next) {
    const now = Date.now();
    sweep(now);

    // Mặc định khoá theo IP + router đang gắn (KHÔNG theo req.path, vì path do
    // người gọi tự chọn nên có thể sinh vô hạn khoá khác nhau).
    const id =
      typeof key === 'function'
        ? String(key(req))
        : (req.ip || 'unknown') + ':' + (req.baseUrl || '');
    const entry = hits.get(id) || { count: 0, reset: now + windowMs };

    if (now > entry.reset) {
      entry.count = 0;
      entry.reset = now + windowMs;
    }
    entry.count += 1;
    hits.set(id, entry);

    if (entry.count > max) {
      return res.status(429).json({ error: 'Quá nhiều yêu cầu. Vui lòng thử lại sau ít phút.' });
    }
    next();
  };
}

module.exports = { rateLimit };
