'use strict';

/**
 * Cảnh báo bảo mật cho quản trị viên.
 *
 * Nguyên tắc:
 *  - Hệ thống KHÔNG tự khóa vĩnh viễn tài khoản người dùng khi có nhiều lần
 *    đăng nhập sai. Nó chỉ ghi nhận và tạo cảnh báo để admin xem xét.
 *  - Admin có thể tạm giữ tài khoản 24 giờ (hoặc số giờ tự chọn) từ trang quản trị.
 *  - Nếu muốn hệ thống tự tạm giữ sau ngưỡng cảnh báo, đặt
 *    SECURITY_AUTO_HOLD_HOURS=24. Mặc định là 0 (chỉ cảnh báo).
 *  - Khi tài khoản có cảnh báo chưa xử lý, lần đăng nhập đúng mật khẩu tiếp theo
 *    có thể bị yêu cầu thêm mã OTP (SECURITY_STEP_UP, mặc định bật) nếu tài khoản
 *    có email và hệ thống gửi được thư. Đây là xác thực bổ sung, không phải khóa.
 *
 * Dữ liệu:
 *  - login_failures: từng lần đăng nhập sai (chỉ để đếm, tự xoá sau 30 ngày).
 *  - security_alerts: cảnh báo gộp theo tài khoản/phiên, admin xử lý hoặc tạm giữ.
 */

const db = require('../db');

const FAILURE_KEEP_DAYS = 30;
const ALERT_DEDUPE_HOURS = 24;

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function envInt(name, fallback, min, max) {
  return clampInt(process.env[name], min, max, fallback);
}

function threshold() {
  return envInt('SECURITY_ALERT_THRESHOLD', 10, 1, 1000);
}

function windowMinutes() {
  return envInt('SECURITY_ALERT_WINDOW_MINUTES', 15, 1, 1440);
}

function autoHoldHours() {
  return envInt('SECURITY_AUTO_HOLD_HOURS', 0, 0, 168);
}

function stepUpHours() {
  return envInt('SECURITY_STEP_UP_HOURS', 24, 1, 168);
}

function stepUpEnabled() {
  const raw = String(process.env.SECURITY_STEP_UP || 'on').trim().toLowerCase();
  return raw !== 'off' && raw !== 'false' && raw !== '0';
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeUsername(value) {
  return String(value == null ? '' : value).trim().toLowerCase();
}

function isoBefore({ days = 0, hours = 0, minutes = 0 } = {}) {
  return new Date(Date.now() - days * 86400000 - hours * 3600000 - minutes * 60000).toISOString();
}

function isoAfterHours(hours) {
  return new Date(Date.now() + hours * 3600000).toISOString();
}

function deleteOldFailures() {
  db.prepare('DELETE FROM login_failures WHERE created_at < ?').run(isoBefore({ days: FAILURE_KEEP_DAYS }));
}

function findOpenAlert({ userId, username }) {
  const recent = isoBefore({ hours: ALERT_DEDUPE_HOURS });
  if (userId) {
    return db
      .prepare(
        `SELECT * FROM security_alerts
          WHERE status = 'new' AND user_id = ? AND last_seen_at >= ?
          ORDER BY id DESC LIMIT 1`
      )
      .get(userId, recent);
  }
  return db
    .prepare(
      `SELECT * FROM security_alerts
        WHERE status = 'new' AND user_id IS NULL AND username = ? AND last_seen_at >= ?
        ORDER BY id DESC LIMIT 1`
    )
    .get(username, recent);
}

/**
 * Ghi nhận một lần đăng nhập sai.
 * Không ném lỗi ra ngoài: người dùng vẫn phải nhận được phản hồi 401 bình thường
 * kể cả khi database đang bận.
 *
 * @returns {{count:number, alertId:number|null, heldUntil:string|null}}
 */
function recordFailure({ username, user = null, ip = '', userAgent = '' }) {
  try {
    const clean = normalizeUsername(username) || '(không rõ)';
    const at = nowIso();
    const userId = user && user.id ? Number(user.id) : null;

    db.prepare(
      `INSERT INTO login_failures (username, user_id, ip, user_agent, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(clean, userId, String(ip || '').slice(0, 200), String(userAgent || '').slice(0, 500), at);

    deleteOldFailures();

    const count =
      Number(
        db
          .prepare('SELECT COUNT(*) AS c FROM login_failures WHERE username = ? AND created_at >= ?')
          .get(clean, isoBefore({ minutes: windowMinutes() })).c
      ) || 0;

    if (count < threshold()) {
      return { count, alertId: null, heldUntil: null };
    }

    const hours = autoHoldHours();
    const canAutoHold = hours > 0 && user && user.role !== 'admin';
    let heldUntil = null;
    if (canAutoHold) {
      heldUntil = isoAfterHours(hours);
      db.prepare(
        `UPDATE users
            SET security_hold_until = CASE
                  WHEN security_hold_until IS NULL OR security_hold_until < ? THEN ?
                  ELSE security_hold_until
                END
          WHERE id = ?`
      ).run(at, heldUntil, userId);
    }

    const detail =
      `Phát hiện ${count} lần đăng nhập sai cho "${clean}" trong ${windowMinutes()} phút.` +
      (ip ? ` IP gần nhất: ${String(ip).slice(0, 100)}.` : '') +
      (heldUntil ? ` Hệ thống tự tạm giữ đến ${heldUntil}.` : '');

    const open = findOpenAlert({ userId, username: clean });
    if (open) {
      db.prepare(
        `UPDATE security_alerts
            SET event_count = event_count + 1,
                last_seen_at = ?,
                ip = ?,
                user_agent = ?,
                detail = ?,
                severity = ?
          WHERE id = ?`
      ).run(
        at,
        String(ip || '').slice(0, 200),
        String(userAgent || '').slice(0, 500),
        detail,
        heldUntil ? 'critical' : open.severity || 'warning',
        open.id
      );
      return { count, alertId: open.id, heldUntil: heldUntil || activeHold(user) };
    }

    const info = db.prepare(
      `INSERT INTO security_alerts
         (kind, severity, username, user_id, ip, user_agent, detail, event_count,
          status, created_at, last_seen_at)
       VALUES ('login_failures', ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)`
    ).run(
      heldUntil ? 'critical' : 'warning',
      clean,
      userId,
      String(ip || '').slice(0, 200),
      String(userAgent || '').slice(0, 500),
      detail,
      count,
      at,
      at
    );

    return { count, alertId: Number(info.lastInsertRowid), heldUntil };
  } catch (err) {
    console.error('Không ghi được cảnh báo đăng nhập sai:', err.message);
    return { count: 0, alertId: null, heldUntil: null };
  }
}

/** Ghi nhận đăng nhập thành công để admin biết cảnh báo đó có kèm đăng nhập đúng. */
function recordSuccess(user) {
  if (!user || !user.id) return;
  try {
    db.prepare(
      `UPDATE security_alerts
          SET last_success_at = ?
        WHERE user_id = ? AND status = 'new'`
    ).run(nowIso(), Number(user.id));
  } catch (err) {
    console.error('Không cập nhật được cảnh báo bảo mật:', err.message);
  }
}

/** Trả về ISO thời điểm hết tạm giữ, hoặc null nếu không bị tạm giữ. */
function activeHold(user) {
  if (!user || !user.security_hold_until) return null;
  const ms = Date.parse(user.security_hold_until);
  if (!Number.isFinite(ms) || ms <= Date.now()) return null;
  return new Date(ms).toISOString();
}

/** Tài khoản có cảnh báo chưa xử lý gần đây -> nên xác thực thêm bằng OTP. */
function requiresStepUp(user) {
  if (!stepUpEnabled() || !user || !user.id || !user.email) return false;
  try {
    const row = db
      .prepare(
        `SELECT 1 AS found FROM security_alerts
          WHERE user_id = ? AND status = 'new' AND last_seen_at >= ?
          LIMIT 1`
      )
      .get(Number(user.id), isoBefore({ hours: stepUpHours() }));
    return Boolean(row);
  } catch (err) {
    console.error('Không kiểm tra được cảnh báo bảo mật:', err.message);
    return false;
  }
}

function countOpen() {
  return Number(db.prepare(`SELECT COUNT(*) AS c FROM security_alerts WHERE status = 'new'`).get().c) || 0;
}

/** Admin đặt tạm giữ. Trả về ISO hết hạn, hoặc null nếu không tìm thấy user. */
function setHold(userId, hours) {
  const id = Number(userId);
  const h = clampInt(hours, 1, 168, 24);
  const row = db.prepare('SELECT id, role FROM users WHERE id = ?').get(id);
  if (!row || row.role === 'admin') return null;
  const until = isoAfterHours(h);
  db.prepare('UPDATE users SET security_hold_until = ? WHERE id = ?').run(until, id);
  return until;
}

/** Admin bỏ tạm giữ. */
function clearHold(userId) {
  const id = Number(userId);
  const info = db.prepare('UPDATE users SET security_hold_until = NULL WHERE id = ?').run(id);
  return Number(info.changes) > 0;
}

/** Admin đánh dấu cảnh báo đã xử lý. */
function resolve(id, actorId, note = '') {
  const info = db
    .prepare(
      `UPDATE security_alerts
          SET status = 'resolved', resolved_at = ?, resolved_by = ?, resolution_note = ?
        WHERE id = ? AND status = 'new'`
    )
    .run(nowIso(), actorId ? Number(actorId) : null, String(note || '').slice(0, 1000), Number(id));
  return Number(info.changes) > 0;
}

module.exports = {
  recordFailure,
  recordSuccess,
  activeHold,
  requiresStepUp,
  countOpen,
  setHold,
  clearHold,
  resolve,
  threshold,
  windowMinutes,
  autoHoldHours,
  stepUpHours,
  stepUpEnabled
};
