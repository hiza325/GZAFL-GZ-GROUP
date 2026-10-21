'use strict';

/**
 * Mã OTP gửi qua email, dùng cho 4 việc:
 *   - 'register'     : xác thực email khi đăng ký tài khoản
 *   - 'reset'        : tự đặt lại mật khẩu khi quên
 *   - 'change_email' : xác nhận địa chỉ email mới khi người dùng tự đổi trong trang Cá nhân
 *   - 'login'        : xác thực 2 lớp khi đăng nhập
 *
 * Quy tắc an toàn:
 *   - Mã 6 chữ số, hiệu lực 10 phút, chỉ dùng được một lần.
 *   - Lưu dạng bcrypt hash, KHÔNG lưu mã gốc.
 *   - Sai quá 5 lần thì phải yêu cầu mã mới.
 *   - Cách 60 giây mới được yêu cầu lại, tối đa 5 mã / giờ cho mỗi email.
 *
 * Bật/tắt bằng EMAIL_OTP:
 *   auto (mặc định) - bật khi đã cấu hình SMTP, hoặc khi đang chạy development
 *                     (development chưa có SMTP thì mã được in ra console)
 *   on              - luôn bật
 *   off             - luôn tắt
 *
 * Riêng bước xác thực KHI ĐĂNG NHẬP còn một công tắc nữa là LOGIN_OTP (auto/on/off);
 * xem hàm loginOtpEnabled() bên dưới.
 */

const { randomInt } = require('node:crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');
const mailer = require('./mailer');
const { isProduction } = require('./env');

const CODE_LENGTH = 6;
const TTL_SECONDS = 10 * 60;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_SENDS_PER_WINDOW = 5;
const WINDOW_SECONDS = 60 * 60;
const BCRYPT_ROUNDS = 10;

const PURPOSES = ['register', 'reset', 'change_email', 'login'];

/** Lỗi có mã trạng thái HTTP để route trả về thẳng cho client. */
class OtpError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'OtpError';
    this.status = status;
  }
}

function otpMode() {
  const raw = String(process.env.EMAIL_OTP || 'auto').trim().toLowerCase();
  if (raw === 'on' || raw === 'off') return raw;
  return 'auto';
}

function otpEnabled() {
  const mode = otpMode();
  if (mode === 'off') return false;
  if (mode === 'on') return true;
  // auto: có SMTP thì bật; chưa có SMTP mà đang phát triển thì vẫn bật
  // (mã in ra console) để test được luồng thật.
  return mailer.isConfigured() || !isProduction();
}

/**
 * Chấp nhận chạy khi CHƯA xác thực được email?
 *
 * Mặc định KHÔNG. Lý do: đăng ký luôn bắt buộc nhập email (để nhận mã khôi phục
 * mật khẩu), nhưng khi chưa cấu hình được việc gửi thư thì không ai kiểm chứng
 * địa chỉ đó. Người dùng có thể đăng ký bằng email của người khác, giữ chỗ và
 * làm người thật không đăng ký được; sau này email đó còn bị coi là kênh khôi
 * phục mật khẩu của tài khoản.
 *
 * Chỉ bật ALLOW_UNVERIFIED_EMAIL=1 khi thật sự chưa cấu hình được SMTP và đã
 * chấp nhận rủi ro trên (ví dụ đang chạy thử nội bộ).
 */
function allowUnverifiedEmail() {
  const raw = String(process.env.ALLOW_UNVERIFIED_EMAIL || '').trim().toLowerCase();
  return raw === '1' || raw === 'true';
}

/**
 * Có gửi được thư không (thật hoặc giả lập ở môi trường phát triển)?
 * Dùng để báo lỗi rõ ràng NGAY từ đầu, thay vì để người dùng chờ vô vọng.
 */
function deliveryAvailable() {
  return mailer.isConfigured() || mailer.isDevDelivery();
}

/**
 * Bước xác thực 2 lớp khi ĐĂNG NHẬP, bật/tắt riêng bằng LOGIN_OTP:
 *   auto (mặc định) - bật khi xác thực email đang bật VÀ gửi được thư.
 *                     Chưa cấu hình SMTP thì đăng nhập vẫn chỉ cần mật khẩu,
 *                     để không khoá toàn bộ người dùng ra ngoài.
 *   on              - luôn bật (kể cả khi chưa gửi được thư)
 *   off             - luôn tắt
 */
function loginOtpEnabled() {
  const raw = String(process.env.LOGIN_OTP || 'auto').trim().toLowerCase();
  if (raw === 'off') return false;
  if (raw === 'on') return true;
  return otpEnabled() && deliveryAvailable();
}

/**
 * Thông tin mã đang có hiệu lực: còn bao nhiêu giây dùng được, và còn phải
 * chờ bao lâu mới được gửi mã mới. Trả null nếu chưa có hoặc đã hết hạn.
 */
function activeInfo(purpose, email) {
  const row = findRow(purpose, email);
  if (!row) return null;

  const secondsLeft = Math.ceil((toMs(row.expires_at) - Date.now()) / 1000);
  if (secondsLeft <= 0) return null;

  const sinceLastSend = Math.floor((Date.now() - toMs(row.last_sent_at)) / 1000);
  return {
    secondsLeft,
    resendInSeconds: Math.max(0, RESEND_COOLDOWN_SECONDS - sinceLastSend)
  };
}

function toMs(iso) {
  return new Date(iso).getTime();
}

function generateCode() {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) out += String(randomInt(10));
  return out;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function findRow(purpose, email) {
  return db.prepare('SELECT * FROM email_otps WHERE purpose = ? AND email = ?').get(purpose, normalizeEmail(email));
}

function clear(purpose, email) {
  db.prepare('DELETE FROM email_otps WHERE purpose = ? AND email = ?').run(purpose, normalizeEmail(email));
}

/**
 * Tạo mã mới (chưa gửi). Ném OtpError nếu vi phạm thời gian chờ / giới hạn.
 */
function issue({ purpose, email, username = '' }) {
  if (!PURPOSES.includes(purpose)) throw new OtpError('Mục đích xác thực không hợp lệ.');

  const cleanEmail = normalizeEmail(email);
  if (!cleanEmail) throw new OtpError('Thiếu địa chỉ email để gửi mã.');

  const now = Date.now();
  const existing = findRow(purpose, cleanEmail);

  let sends = 0;
  let windowStart = new Date(now).toISOString();

  if (existing) {
    const sinceLastSend = Math.floor((now - toMs(existing.last_sent_at)) / 1000);
    const wait = RESEND_COOLDOWN_SECONDS - sinceLastSend;
    if (wait > 0) {
      throw new OtpError(`Vui lòng chờ ${wait} giây rồi hãy yêu cầu mã mới.`, 429);
    }

    const windowEnd = toMs(existing.window_start) + WINDOW_SECONDS * 1000;
    if (now < windowEnd) {
      if (existing.sends >= MAX_SENDS_PER_WINDOW) {
        throw new OtpError('Bạn đã yêu cầu mã quá nhiều lần. Vui lòng thử lại sau.', 429);
      }
      sends = existing.sends;
      windowStart = existing.window_start;
    }
  }

  const code = generateCode();
  const codeHash = bcrypt.hashSync(code, BCRYPT_ROUNDS);
  const nowIso = new Date(now).toISOString();
  const expiresAt = new Date(now + TTL_SECONDS * 1000).toISOString();

  db.prepare(
    `INSERT INTO email_otps (purpose, email, username, code_hash, attempts, sends, window_start, last_sent_at, expires_at, created_at)
     VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
     ON CONFLICT (purpose, email) DO UPDATE SET
       username      = excluded.username,
       code_hash     = excluded.code_hash,
       attempts      = 0,
       sends         = excluded.sends,
       window_start  = excluded.window_start,
       last_sent_at  = excluded.last_sent_at,
       expires_at    = excluded.expires_at`
  ).run(purpose, cleanEmail, String(username || ''), codeHash, sends + 1, windowStart, nowIso, expiresAt, nowIso);

  return { code, expiresInSeconds: TTL_SECONDS, resendInSeconds: RESEND_COOLDOWN_SECONDS };
}

/**
 * Kiểm tra mã. Đúng thì xoá mã và trả về true, sai thì ném OtpError.
 */
function verify({ purpose, email, code }) {
  const cleanCode = String(code || '').trim().replace(/\s/g, '');
  if (!cleanCode) throw new OtpError('Vui lòng nhập mã xác thực.');

  const row = findRow(purpose, email);
  if (!row) throw new OtpError('Mã xác thực không đúng hoặc đã hết hạn. Hãy yêu cầu mã mới.');

  if (Date.now() > toMs(row.expires_at)) {
    clear(purpose, email);
    throw new OtpError('Mã xác thực đã hết hạn. Hãy yêu cầu mã mới.');
  }

  if (row.attempts >= MAX_ATTEMPTS) {
    throw new OtpError('Bạn đã nhập sai quá nhiều lần. Hãy yêu cầu mã mới.');
  }

  if (!bcrypt.compareSync(cleanCode, row.code_hash)) {
    const attempts = row.attempts + 1;
    db.prepare('UPDATE email_otps SET attempts = ? WHERE id = ?').run(attempts, row.id);
    const left = MAX_ATTEMPTS - attempts;
    if (left <= 0) throw new OtpError('Bạn đã nhập sai quá nhiều lần. Hãy yêu cầu mã mới.');
    throw new OtpError(`Mã xác thực không đúng. Bạn còn ${left} lần thử.`);
  }

  clear(purpose, email);
  return true;
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Lời thư khác nhau theo từng mục đích. */
const MAIL_COPY = {
  register: {
    subject: 'Mã xác thực đăng ký tài khoản GZ AFL',
    action: 'hoàn tất đăng ký tài khoản',
    title: 'Xác thực email'
  },
  reset: {
    subject: 'Mã đặt lại mật khẩu GZ AFL',
    action: 'đặt lại mật khẩu',
    title: 'Đặt lại mật khẩu'
  },
  change_email: {
    subject: 'Mã xác thực email mới - GZ AFL',
    action: 'xác nhận địa chỉ email mới',
    title: 'Xác nhận email mới'
  },
  login: {
    subject: 'Mã xác thực đăng nhập GZ AFL',
    action: 'đăng nhập tài khoản',
    title: 'Xác thực đăng nhập'
  }
};

/** Soạn và gửi thư chứa mã. */
async function sendOtp({ purpose, email, code, name = '' }) {
  const copy = MAIL_COPY[purpose] || MAIL_COPY.register;
  const subject = copy.subject;
  const action = copy.action;
  const title = copy.title || 'Xác thực email';
  const minutes = Math.round(TTL_SECONDS / 60);
  const greet = name ? `Xin chào ${name},` : 'Xin chào,';

  const text = [
    greet,
    '',
    `Mã xác thực để ${action} của bạn là: ${code}`,
    '',
    `Mã có hiệu lực trong ${minutes} phút và chỉ dùng được một lần.`,
    'Nếu bạn không yêu cầu mã này, hãy bỏ qua thư này.',
    '',
    'GZ AFL'
  ].join('\n');

  const html = `<!doctype html>
<html lang="vi"><body style="margin:0;padding:24px;background:#f4f6fa;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:20px;padding:32px">
    <div style="font-size:13px;font-weight:bold;letter-spacing:1px;color:#f04d4d;text-transform:uppercase">GZ AFL</div>
    <h1 style="font-size:20px;margin:16px 0 8px">${escapeHtml(title)}</h1>
    <p style="font-size:14px;line-height:1.6;color:#4b5563;margin:0 0 24px">${escapeHtml(greet)} Hãy dùng mã dưới đây để ${escapeHtml(action)}.</p>
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:14px;padding:20px;text-align:center">
      <div style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#18253f">${escapeHtml(code)}</div>
    </div>
    <p style="font-size:13px;line-height:1.6;color:#6b7280;margin:24px 0 0">Mã có hiệu lực trong ${minutes} phút và chỉ dùng được một lần.</p>
    <p style="font-size:13px;line-height:1.6;color:#6b7280;margin:8px 0 0">Nếu bạn không yêu cầu mã này, hãy bỏ qua thư này.</p>
  </div>
</body></html>`;

  await mailer.send({ to: normalizeEmail(email), subject, text, html });
}

// Chống spam thư "tài khoản đã tồn tại": mỗi email chỉ nhận 1 thư / 30 phút
const NOTICE_COOLDOWN_SECONDS = 30 * 60;

/**
 * Gửi thư báo "tài khoản đã tồn tại" khi có người thử ĐĂNG KÝ trùng.
 *
 * QUAN TRỌNG: thư chỉ gửi tới ĐÚNG địa chỉ email đã đăng ký của chủ tài khoản,
 * KHÔNG gửi tới email mà người gửi vừa nhập. Nhờ vậy kẻ dò tài khoản (nhập username
 * của người khác nhưng email của mình) không nhận được gì và không biết tài khoản
 * có tồn tại hay không.
 *
 * Trả về { sent, cooldown } — không ném lỗi vì đây chỉ là thư thông báo phụ.
 */
async function sendAccountExistsNotice({ email, name = '', username = '' }) {
  const cleanEmail = normalizeEmail(email);
  if (!cleanEmail) return { sent: false };

  const kind = 'account_exists';
  const row = db
    .prepare('SELECT last_sent_at FROM email_notices WHERE email = ? AND kind = ?')
    .get(cleanEmail, kind);

  if (row && Date.now() - toMs(row.last_sent_at) < NOTICE_COOLDOWN_SECONDS * 1000) {
    return { sent: false, cooldown: true };
  }

  const greet = name ? `Xin chào ${name},` : 'Xin chào,';
  const loginBy = username ? `bằng tài khoản ${username}` : 'bằng tài khoản của bạn';

  const text = [
    greet,
    '',
    'Ai đó (có thể là bạn) vừa thử đăng ký tài khoản GZ AFL bằng địa chỉ email này.',
    'Tài khoản đã tồn tại nên hệ thống không tạo tài khoản mới và không gửi mã đăng ký.',
    '',
    `Nếu là bạn: hãy đăng nhập ${loginBy}. Nếu quên mật khẩu, dùng chức năng "Quên mật khẩu" ở trang đăng nhập.`,
    'Nếu không phải bạn: hãy bỏ qua thư này. Tài khoản của bạn vẫn an toàn — không ai đăng nhập được nếu không có mật khẩu và mã xác thực.',
    '',
    'GZ AFL'
  ].join('\n');

  const html = `<!doctype html>
<html lang="vi"><body style="margin:0;padding:24px;background:#f4f6fa;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:20px;padding:32px">
    <div style="font-size:13px;font-weight:bold;letter-spacing:1px;color:#f04d4d;text-transform:uppercase">GZ AFL</div>
    <h1 style="font-size:20px;margin:16px 0 8px">Tài khoản đã tồn tại</h1>
    <p style="font-size:14px;line-height:1.6;color:#4b5563;margin:0 0 16px">${escapeHtml(greet)}</p>
    <p style="font-size:14px;line-height:1.6;color:#4b5563;margin:0 0 16px">Ai đó (có thể là bạn) vừa thử đăng ký tài khoản GZ AFL bằng địa chỉ email này. Tài khoản đã tồn tại nên hệ thống <b>không tạo tài khoản mới</b> và không gửi mã đăng ký.</p>
    <p style="font-size:14px;line-height:1.6;color:#4b5563;margin:0 0 16px">Nếu là bạn: hãy đăng nhập ${escapeHtml(loginBy)}. Nếu quên mật khẩu, dùng chức năng <b>Quên mật khẩu</b> ở trang đăng nhập.</p>
    <p style="font-size:13px;line-height:1.6;color:#6b7280;margin:0">Nếu không phải bạn: hãy bỏ qua thư này. Tài khoản của bạn vẫn an toàn — không ai đăng nhập được nếu không có mật khẩu và mã xác thực.</p>
  </div>
</body></html>`;

  await mailer.send({ to: cleanEmail, subject: 'Tài khoản GZ AFL đã tồn tại', text, html });

  db.prepare(
    `INSERT INTO email_notices (email, kind, last_sent_at) VALUES (?, ?, ?)
     ON CONFLICT (email, kind) DO UPDATE SET last_sent_at = excluded.last_sent_at`
  ).run(cleanEmail, kind, new Date().toISOString());

  return { sent: true };
}

/**
 * Tạo mã + gửi thư trong một bước.
 * Trả về { expiresInSeconds, resendInSeconds, devCode } — devCode chỉ có khi
 * đang ở chế độ thử nghiệm (chưa cấu hình SMTP, không phải production).
 */
async function issueAndSend({ purpose, email, username = '', name = '' }) {
  const { code, expiresInSeconds, resendInSeconds } = issue({ purpose, email, username });

  try {
    await sendOtp({ purpose, email, code, name });
  } catch (err) {
    // Không gửi được thì bỏ mã vừa tạo, để người dùng thử lại ngay
    // thay vì bị chặn bởi thời gian chờ 60 giây.
    clear(purpose, email);
    console.error('Không gửi được email xác thực:', err.message);
    throw new OtpError('Không gửi được email xác thực. Vui lòng thử lại sau.', 502);
  }

  return {
    expiresInSeconds,
    resendInSeconds,
    devCode: mailer.isDevDelivery() ? code : null
  };
}

/** Xoá các mã đã hết hạn từ hơn 1 ngày (dọn rác trong database). */
function cleanup() {
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const info = db.prepare('DELETE FROM email_otps WHERE expires_at < ?').run(cutoff);
    return info.changes || 0;
  } catch (err) {
    console.error('Không dọn được mã OTP cũ:', err.message);
    return 0;
  }
}

module.exports = {
  CODE_LENGTH,
  TTL_SECONDS,
  RESEND_COOLDOWN_SECONDS,
  OtpError,
  otpEnabled,
  otpMode,
  allowUnverifiedEmail,
  deliveryAvailable,
  loginOtpEnabled,
  activeInfo,
  issue,
  verify,
  clear,
  sendAccountExistsNotice,
  issueAndSend,
  cleanup
};
