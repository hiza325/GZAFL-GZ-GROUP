'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { toUser } = require('../lib/serialize');
const {
  isValidUsername,
  isValidEmail,
  normalizeEmail,
  normalizeUsername,
  generateReferralCode
} = require('../lib/validate');
const { setAuthCookie, clearAuthCookie, loadUser, signLoginTicket, verifyLoginTicket } = require('../lib/auth');
const { rateLimit } = require('../lib/rateLimit');
const { RESET_PENDING, RESET_RESOLVED } = require('../lib/constants');
const { notify } = require('../lib/notify');
const otp = require('../lib/otp');

const router = express.Router();

// Chống dò mật khẩu: tối đa 30 lần / phút / IP cho các endpoint đăng nhập-đăng ký
router.use(rateLimit({ windowMs: 60 * 1000, max: 30, name: 'auth' }));

// Chống dò mật khẩu PHÂN TÁN (nhiều IP cùng nhắm một tài khoản).
// Giới hạn theo IP ở trên không chặn được kẻ dùng proxy xoay IP, nên thêm một
// bộ đếm theo TÊN ĐĂNG NHẬP. Đây là đánh đổi có chủ đích: 30 lần / 15 phút cho
// mỗi tài khoản là đủ rộng cho người dùng thật, nhưng chặn được dò diện rộng.
const loginAccountRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  name: 'login-account',
  key: (req) => {
    const username = normalizeUsername((req.body && req.body.username) || '');
    return username ? 'acct:' + username.toLowerCase() : 'ip:' + (req.ip || 'unknown');
  }
});

// Riêng việc GỬI mã OTP khi ĐĂNG KÝ / KHÔI PHỤC MẬT KHẨU thì chặt hơn:
// 10 lần / 15 phút / IP (dùng chung một bộ đếm cho các endpoint này).
// (Ngoài ra lib/otp.js còn giới hạn theo từng email: cách 60 giây, tối đa 5 mã/giờ.)
const otpRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, name: 'otp-send' });

// Mã xác thực khi ĐĂNG NHẬP dùng bộ đếm riêng và rộng hơn (40 lần / 15 phút / IP),
// vì mỗi lần đăng nhập đều tốn 1-2 lượt (nhập sai vài lần là hết hạn mức 10).
// Chống dò mã vẫn nhờ lib/otp.js: mỗi mã chỉ cho sai tối đa 5 lần, và mã chỉ
// được phát ra SAU KHI mật khẩu đã đúng.
const loginOtpRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 40, name: 'login-otp' });

const BCRYPT_ROUNDS = 10;
const MIN_PASSWORD_LENGTH = 8;

// Tìm tài khoản không phân biệt hoa-thường. Email được lưu lowercase; username dạng
// email cũng vậy, còn số điện thoại giữ nguyên.
function findUserByUsername(input) {
  const value = normalizeUsername(input);
  if (!value) return null;
  return db.prepare('SELECT * FROM users WHERE lower(trim(username)) = ?').get(value.toLowerCase());
}

function findUserByEmail(input) {
  const email = normalizeEmail(input);
  if (!email) return null;
  return db.prepare('SELECT * FROM users WHERE lower(trim(email)) = ?').get(email);
}

// Hash giả dùng khi tài khoản không tồn tại: vẫn tốn thời gian bcrypt như thật,
// để kẻ dò không phân biệt được "sai tài khoản" và "sai mật khẩu".
const DUMMY_HASH = bcrypt.hashSync('gzafl-dummy-password', BCRYPT_ROUNDS);

/**
 * Chạy hàm xử lý và tự trả về đúng mã lỗi của OtpError (400/429/502...).
 */
function handleOtpError(res, err) {
  if (err instanceof otp.OtpError) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  console.error('Lỗi gửi mã xác thực:', err);
  return res.status(500).json({ error: 'Có lỗi xảy ra. Vui lòng thử lại sau.' });
}

/** Che bot dia chi email: nguyen.van.a@gmail.com -> ngu***@gmail.com */
function maskEmail(email) {
  const value = String(email || '');
  const at = value.indexOf('@');
  if (at <= 0) return value;
  const name = value.slice(0, at);
  const domain = value.slice(at);
  return name.slice(0, Math.min(3, name.length)) + '***' + domain;
}

/* ==========================================
   Đăng ký tài khoản

   Mọi tài khoản đều phải có email (kể cả khi đăng nhập bằng số điện thoại),
   vì email là nơi nhận mã xác thực.

   Khi bật xác thực email (EMAIL_OTP — xem lib/otp.js), đăng ký gồm 2 bước:
     1. POST /register/otp  -> kiểm tra thông tin rồi gửi mã về email
     2. POST /register      -> kèm otp, mã đúng mới tạo tài khoản

   Chưa cấu hình SMTP mà đang chạy development thì mã được trả về ở trường
   devCode (và in ra console) để test được ngay, không cần tài khoản email.
   ========================================== */

// Bước 1: gửi mã xác thực về email
router.post('/register/otp', otpRateLimit, async (req, res) => {
  const username = normalizeUsername((req.body && req.body.username) || '');
  const name = String((req.body && req.body.name) || '').trim();
  const email = normalizeEmail((req.body && req.body.email) || '');

  if (!otp.otpEnabled()) {
    return res.status(400).json({ error: 'Bước xác thực email đang tắt.' });
  }
  if (!otp.deliveryAvailable()) {
    return res.status(503).json({ error: 'Hệ thống chưa cấu hình gửi email. Vui lòng liên hệ quản trị viên.' });
  }
  if (!username) return res.status(400).json({ error: 'Vui lòng nhập Email hoặc Số điện thoại đăng nhập.' });
  if (!isValidUsername(username)) {
    return res.status(400).json({ error: 'Định dạng không hợp lệ. Vui lòng nhập đúng Email hoặc Số điện thoại.' });
  }
  if (!name) return res.status(400).json({ error: 'Vui lòng nhập tên hiển thị.' });
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Vui lòng nhập địa chỉ email hợp lệ để nhận mã xác thực.' });
  }

  // Nếu dùng email làm tên đăng nhập thì email nhận mã PHẢI là chính email đó.
  // Nếu không, người khác có thể "giữ chỗ" email của người khác bằng email của mình.
  if (isValidEmail(username) && username !== email) {
    return res.status(400).json({
      error: 'Vì bạn dùng email làm tên đăng nhập, email nhận mã phải trùng với email đó.'
    });
  }

  const existing = findUserByUsername(username);
  const emailOwner = findUserByEmail(email);
  const conflict = existing || emailOwner;
  if (conflict) {
    // Không phát mã đăng ký (không thể tạo trùng tài khoản). Thay vào đó gửi thư báo
    // tới ĐÚNG email đã đăng ký của chủ tài khoản — KHÔNG gửi tới email mà người gửi
    // vừa nhập, nên kẻ dò tài khoản (dùng username người khác + email của mình)
    // không nhận được gì và không biết tài khoản có tồn tại hay không.
    // Phản hồi vẫn GIỐNG HỆT trường hợp đăng ký bình thường.
    if (conflict.email) {
      try {
        await otp.sendAccountExistsNotice({
          email: conflict.email,
          name: conflict.name,
          username
        });
      } catch (err) {
        // Thư thông báo chỉ là phụ — lỗi gửi không được làm lộ thông tin hay chặn người dùng.
        console.error('Không gửi được thư báo tài khoản đã tồn tại:', err.message);
      }
    } else {
      console.warn(`Bỏ qua gửi OTP đăng ký: tài khoản đã tồn tại nhưng chưa có email (${username}).`);
    }

    return res.json({
      ok: true,
      email,
      expiresInSeconds: otp.TTL_SECONDS,
      resendInSeconds: otp.RESEND_COOLDOWN_SECONDS
    });
  }

  try {
    const sent = await otp.issueAndSend({ purpose: 'register', email, username, name });
    return res.json({
      ok: true,
      email,
      expiresInSeconds: sent.expiresInSeconds,
      resendInSeconds: sent.resendInSeconds,
      // Chỉ có giá trị khi chưa cấu hình SMTP và đang ở môi trường phát triển
      devCode: sent.devCode
    });
  } catch (err) {
    return handleOtpError(res, err);
  }
});

// Bước 2: kiểm tra mã rồi tạo tài khoản
router.post('/register', async (req, res) => {
  const username = normalizeUsername((req.body && req.body.username) || '');
  const password = String((req.body && req.body.password) || '').trim();
  const name = String((req.body && req.body.name) || '').trim();
  const email = normalizeEmail((req.body && req.body.email) || '');
  const code = String((req.body && req.body.otp) || '').trim();

  if (!username || !password) return res.status(400).json({ error: 'Vui lòng điền đầy đủ thông tin.' });
  if (!name) return res.status(400).json({ error: 'Vui lòng nhập tên hiển thị.' });
  if (!isValidUsername(username)) {
    return res.status(400).json({ error: 'Định dạng không hợp lệ. Vui lòng nhập đúng Email hoặc Số điện thoại.' });
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Mật khẩu phải có ít nhất ${MIN_PASSWORD_LENGTH} ký tự.` });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Vui lòng nhập địa chỉ email hợp lệ để nhận mã xác thực.' });
  }
  if (isValidEmail(username) && username !== email) {
    return res.status(400).json({
      error: 'Vì bạn dùng email làm tên đăng nhập, email nhận mã phải trùng với email đó.'
    });
  }

  // Kiểm tra mã TRƯỚC khi kiểm tra trùng tài khoản, để không lộ tài khoản đã tồn tại
  if (otp.otpEnabled()) {
    if (!code) return res.status(400).json({ error: 'Vui lòng nhập mã xác thực đã gửi tới email của bạn.' });
    try {
      otp.verify({ purpose: 'register', email, code });
    } catch (err) {
      return handleOtpError(res, err);
    }
  }

  if (findUserByUsername(username)) {
    return res.status(409).json({ error: 'Email hoặc Số điện thoại này đã được đăng ký.' });
  }
  if (findUserByEmail(email)) {
    return res.status(409).json({ error: 'Email này đã được dùng cho một tài khoản khác.' });
  }

  const passwordHash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
  const referralCode = generateReferralCode(db);
  const isEmailLogin = isValidEmail(username);

  let info;
  try {
    info = db
      .prepare(
        `INSERT INTO users (username, password_hash, name, email, phone, referral_code, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        username,
        passwordHash,
        name,
        email,
        isEmailLogin ? '' : username,
        referralCode,
        new Date().toISOString()
      );
  } catch (err) {
    // Hai request đăng ký cùng lúc có thể vượt qua kiểm tra phía trên; chỉ mục UNIQUE
    // trong database mới là chốt chặn cuối.
    if (/UNIQUE|constraint/i.test(String(err.message))) {
      return res.status(409).json({ error: 'Email, tên đăng nhập hoặc số điện thoại này đã được đăng ký.' });
    }
    throw err;
  }

  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(info.lastInsertRowid));

  notify(row.id, {
    title: 'Chào mừng bạn đến với GZ AFL',
    body: 'Tài khoản đã được xác thực qua email. Hãy tạo đơn đầu tiên để bắt đầu nhận hoàn tiền.',
    icon: 'party-popper'
  });

  return res.status(201).json({ user: toUser(row) });
});

/* ==========================================
   Đăng nhập

   Khi bật xác thực khi đăng nhập (LOGIN_OTP — xem lib/otp.js), đăng nhập gồm 2 bước:
     1. POST /login      -> kiểm tra mật khẩu, gửi mã, trả về "phiếu đăng nhập" 5 phút
     2. POST /login/otp  -> phiếu + mã đúng thì mới cấp cookie phiên

   Mã CHỈ được gửi sau khi mật khẩu đúng, nên người không biết mật khẩu không
   làm tốn thư trong hộp của người khác.
   ========================================== */

router.post('/login', loginAccountRateLimit, async (req, res) => {
  const username = normalizeUsername((req.body && req.body.username) || '');
  const password = String((req.body && req.body.password) || '').trim();

  if (!username || !password) return res.status(400).json({ error: 'Vui lòng điền đầy đủ thông tin.' });

  const row = findUserByUsername(username);
  // Trả CÙNG một thông báo dù sai tài khoản hay sai mật khẩu (tránh dò tài khoản).
  // Vẫn chạy bcrypt khi không có tài khoản để thời gian phản hồi không khác biệt.
  const passwordOk = bcrypt.compareSync(password, row ? row.password_hash : DUMMY_HASH);
  if (!row || !passwordOk) {
    return res.status(401).json({ error: 'Tài khoản hoặc mật khẩu không đúng.' });
  }

  // Mật khẩu tạm do quản trị viên cấp chỉ có hiệu lực trong thời gian giới hạn.
  if (row.temp_password_expires_at && Date.now() > new Date(row.temp_password_expires_at).getTime()) {
    return res.status(401).json({
      error: 'Mật khẩu tạm đã hết hạn. Vui lòng liên hệ quản trị viên để được cấp lại.'
    });
  }

  // Tài khoản chưa có email thì không thể xác thực qua email -> cho vào luôn,
  // tránh tự khoá mình ra ngoài (chỉ xảy ra với tài khoản cũ).
  if (!otp.loginOtpEnabled() || !row.email) {
    setAuthCookie(res, row);
    return res.json({ user: toUser(row) });
  }

  // Vừa đăng xuất rồi đăng nhập lại: mã cũ còn hiệu lực thì dùng lại,
  // không gửi thêm thư và không bắt người dùng chờ 60 giây.
  const active = otp.activeInfo('login', row.email);
  let sent = null;
  if (!active) {
    try {
      sent = await otp.issueAndSend({
        purpose: 'login',
        email: row.email,
        username: row.username,
        name: row.name
      });
    } catch (err) {
      return handleOtpError(res, err);
    }
  }

  return res.json({
    otpRequired: true,
    ticket: signLoginTicket(row),
    email: maskEmail(row.email),
    message: active
      ? 'Mã xác thực đã được gửi trước đó và còn hiệu lực. Bạn hãy dùng mã trong email đó.'
      : 'Mã xác thực đã được gửi tới email của bạn. Nhớ kiểm tra cả thư rác (Spam).',
    expiresInSeconds: otp.TTL_SECONDS,
    resendInSeconds: active ? active.resendInSeconds : otp.RESEND_COOLDOWN_SECONDS,
    // Chỉ có giá trị khi chưa cấu hình SMTP và đang ở môi trường phát triển
    devCode: sent ? sent.devCode : null
  });
});

// Bước 2 của đăng nhập: phiếu đăng nhập + mã xác thực -> cấp cookie phiên
router.post('/login/otp', loginOtpRateLimit, (req, res) => {
  const ticket = String((req.body && req.body.ticket) || '').trim();
  const code = String((req.body && req.body.otp) || '').trim();

  if (!ticket) return res.status(400).json({ error: 'Phiên đăng nhập đã hết. Vui lòng đăng nhập lại.' });
  if (!code) return res.status(400).json({ error: 'Vui lòng nhập mã xác thực.' });

  let row = null;
  try {
    row = verifyLoginTicket(ticket);
  } catch (err) {
    return res.status(401).json({ error: 'Phiên đăng nhập đã hết (phiếu chỉ sống 5 phút). Vui lòng đăng nhập lại.' });
  }

  if (!row.email) return res.status(400).json({ error: 'Tài khoản chưa có email để nhận mã xác thực.' });

  try {
    otp.verify({ purpose: 'login', email: row.email, code });
  } catch (err) {
    return handleOtpError(res, err);
  }

  setAuthCookie(res, row);
  return res.json({ user: toUser(row) });
});

// Gửi lại mã đăng nhập: dùng phiếu đăng nhập nên không phải nhập lại mật khẩu
router.post('/login/otp/resend', loginOtpRateLimit, async (req, res) => {
  const ticket = String((req.body && req.body.ticket) || '').trim();
  if (!ticket) return res.status(400).json({ error: 'Phiên đăng nhập đã hết. Vui lòng đăng nhập lại.' });

  let row = null;
  try {
    row = verifyLoginTicket(ticket);
  } catch (err) {
    return res.status(401).json({ error: 'Phiên đăng nhập đã hết (phiếu chỉ sống 5 phút). Vui lòng đăng nhập lại.' });
  }

  if (!row.email) return res.status(400).json({ error: 'Tài khoản chưa có email để nhận mã xác thực.' });

  try {
    const sent = await otp.issueAndSend({
      purpose: 'login',
      email: row.email,
      username: row.username,
      name: row.name
    });
    return res.json({
      ok: true,
      email: maskEmail(row.email),
      expiresInSeconds: sent.expiresInSeconds,
      resendInSeconds: sent.resendInSeconds,
      devCode: sent.devCode
    });
  } catch (err) {
    return handleOtpError(res, err);
  }
});

router.post('/logout', (req, res) => {
  // Tăng token_version để token đã phát (kể cả token bị đánh cắp) mất hiệu lực ngay,
  // không đợi hết hạn 7 ngày. Đây là logout toàn bộ thiết bị.
  const row = loadUser(req);
  if (row) {
    db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').run(row.id);
  }
  clearAuthCookie(res);
  return res.json({ ok: true });
});

// Trả về user hiện tại, hoặc null nếu chưa đăng nhập (không gây lỗi 401)
router.get('/me', (req, res) => {
  const row = loadUser(req);
  return res.json({ user: toUser(row) });
});

/* ==========================================
   Quên mật khẩu

   Có 2 đường:

   1. TỰ ĐẶT LẠI QUA EMAIL (dùng khi đã cấu hình gửi thư)
        POST /forgot-password/otp      -> gửi mã xác thực về email đã đăng ký
        POST /forgot-password/confirm  -> mã xác thực + mật khẩu mới

   2. NHỜ QUẢN TRỊ VIÊN (dự phòng cho tài khoản chưa có email, hoặc khi
      chưa cấu hình được việc gửi thư)
        POST /forgot-password          -> đưa yêu cầu vào hàng đợi cho admin
                                          (xem routes/admin.js -> /password-resets)

   Cả hai đường đều trả về CÙNG MỘT thông báo dù tài khoản có tồn tại hay
   không, để người ngoài không dò được danh sách tài khoản đang có.
   ========================================== */
const FORGOT_PASSWORD_MESSAGE =
  'Nếu tài khoản tồn tại, yêu cầu đã được gửi tới quản trị viên. Vui lòng liên hệ Zalo/email hỗ trợ để nhận mật khẩu mới.';

const RESET_OTP_MESSAGE =
  'Nếu tài khoản tồn tại và đã có email, mã xác thực đã được gửi tới email đó. Nhớ kiểm tra cả thư rác (Spam).';

// Bước 1 của đường tự đặt lại: gửi mã về email
router.post('/forgot-password/otp', otpRateLimit, async (req, res) => {
  const username = normalizeUsername((req.body && req.body.username) || '');

  if (!username) return res.status(400).json({ error: 'Vui lòng nhập Email hoặc Số điện thoại.' });

  if (!otp.otpEnabled() || !otp.deliveryAvailable()) {
    return res.status(503).json({
      error: 'Hệ thống chưa gửi được email. Vui lòng dùng cách nhờ quản trị viên hỗ trợ bên dưới.'
    });
  }

  const row = findUserByUsername(username);

  let devCode = null;
  let expiresInSeconds = otp.TTL_SECONDS;
  let resendInSeconds = otp.RESEND_COOLDOWN_SECONDS;

  if (row && row.email) {
    try {
      const sent = await otp.issueAndSend({
        purpose: 'reset',
        email: row.email,
        username,
        name: row.name
      });
      devCode = sent.devCode;
      expiresInSeconds = sent.expiresInSeconds;
      resendInSeconds = sent.resendInSeconds;
    } catch (err) {
      // Đang trong thời gian chờ 60 giây: mã trước đó VẪN còn hiệu lực nên
      // vẫn trả về thông báo chung, không tiết lộ tài khoản có tồn tại hay không.
      const cooling = err instanceof otp.OtpError && err.status === 429;
      if (!cooling) {
        console.error('Không gửi được mã đặt lại mật khẩu:', err.message);
        return res.status(502).json({
          error: 'Không gửi được email xác thực. Vui lòng dùng cách nhờ quản trị viên hỗ trợ bên dưới.'
        });
      }
    }
  }

  return res.json({
    ok: true,
    message: RESET_OTP_MESSAGE,
    expiresInSeconds,
    resendInSeconds,
    devCode
  });
});

// Bước 2: mã đúng thì đổi mật khẩu luôn
router.post('/forgot-password/confirm', otpRateLimit, (req, res) => {
  const username = normalizeUsername((req.body && req.body.username) || '');
  const code = String((req.body && req.body.otp) || '').trim();
  const newPassword = String((req.body && req.body.newPassword) || '').trim();

  if (!username) return res.status(400).json({ error: 'Thiếu Email hoặc Số điện thoại.' });
  if (!code) return res.status(400).json({ error: 'Vui lòng nhập mã xác thực.' });
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Mật khẩu mới phải có ít nhất ${MIN_PASSWORD_LENGTH} ký tự.` });
  }

  const row = findUserByUsername(username);

  // Không có tài khoản / tài khoản chưa có email thì trả về y hệt lỗi mã sai
  if (!row || !row.email) {
    return res.status(400).json({ error: 'Mã xác thực không đúng hoặc đã hết hạn. Hãy yêu cầu mã mới.' });
  }

  try {
    otp.verify({ purpose: 'reset', email: row.email, code });
  } catch (err) {
    return handleOtpError(res, err);
  }

  // Đổi mật khẩu + tăng token_version -> mọi phiên đăng nhập cũ hết hiệu lực.
  // Xoá luôn hạn của mật khẩu tạm: từ đây tài khoản dùng mật khẩu do chính họ đặt.
  db.prepare(
    `UPDATE users
        SET password_hash = ?, token_version = token_version + 1, temp_password_expires_at = NULL
      WHERE id = ?`
  ).run(bcrypt.hashSync(newPassword, BCRYPT_ROUNDS), row.id);

  // Người dùng đã tự xử lý xong -> đóng luôn yêu cầu đang chờ quản trị viên (nếu có)
  db.prepare(
    'UPDATE password_resets SET status = ?, resolved_at = ? WHERE user_id = ? AND status = ?'
  ).run(RESET_RESOLVED, new Date().toISOString(), row.id, RESET_PENDING);

  notify(row.id, {
    title: 'Mật khẩu đã được đặt lại',
    body: 'Bạn vừa đặt lại mật khẩu bằng mã xác thực gửi tới email. Nếu không phải bạn, hãy liên hệ hỗ trợ ngay.',
    icon: 'key-round'
  });

  return res.json({ ok: true, message: 'Đã đặt lại mật khẩu. Hãy đăng nhập bằng mật khẩu mới.' });
});

router.post('/forgot-password', (req, res) => {
  const username = normalizeUsername((req.body && req.body.username) || '');
  const note = String((req.body && req.body.note) || '').trim().slice(0, 300);

  if (!username) return res.status(400).json({ error: 'Vui lòng nhập Email hoặc Số điện thoại.' });

  const row = findUserByUsername(username);

  if (row) {
    const now = new Date().toISOString();
    const pending = db
      .prepare('SELECT id, note FROM password_resets WHERE user_id = ? AND status = ?')
      .get(row.id, RESET_PENDING);

    if (pending) {
      // Đã có yêu cầu đang chờ: cập nhật lại nội dung và đẩy lên đầu danh sách
      db.prepare('UPDATE password_resets SET note = ?, created_at = ? WHERE id = ?').run(
        note || pending.note || '',
        now,
        pending.id
      );
    } else {
      db.prepare(
        'INSERT INTO password_resets (user_id, status, note, created_at) VALUES (?, ?, ?, ?)'
      ).run(row.id, RESET_PENDING, note, now);
    }
  }

  return res.json({ ok: true, message: FORGOT_PASSWORD_MESSAGE });
});

module.exports = router;
