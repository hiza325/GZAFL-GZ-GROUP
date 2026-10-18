'use strict';

/**
 * Giới hạn số yêu cầu đơn giản theo bộ nhớ (chống dò mật khẩu / spam).
 * Chỉ phù hợp cho một tiến trình đơn; production nên dùng Redis hoặc middleware chuẩn.
 */
function rateLimit({ windowMs = 60 * 1000, max = 30 } = {}) {
  const hits = new Map();

  return function (req, res, next) {
    const key = (req.ip || 'unknown') + ':' + req.baseUrl + req.path;
    const now = Date.now();
    const entry = hits.get(key) || { count: 0, reset: now + windowMs };

    if (now > entry.reset) {
      entry.count = 0;
      entry.reset = now + windowMs;
    }
    entry.count += 1;
    hits.set(key, entry);

    if (entry.count > max) {
      return res.status(429).json({ error: 'Quá nhiều yêu cầu. Vui lòng thử lại sau ít phút.' });
    }
    next();
  };
}

module.exports = { rateLimit };
