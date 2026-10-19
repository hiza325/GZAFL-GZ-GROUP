'use strict';

/**
 * GZ AFL backend
 * - Phục vụ API dưới /api/*
 * - Phục vụ luôn frontend tĩnh (cùng origin) để cookie phiên hoạt động, không cần CORS
 */

// NẠP .env TRƯỚC TIÊN: db.js và các module trong lib/ đọc process.env ngay khi require
const { cookieSecure, isProduction } = require('./lib/env');

const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const express = require('express');
const cookieParser = require('cookie-parser');

const db = require('./db'); // khởi tạo database + bảng

const IS_PRODUCTION = isProduction();
const DEV_SECRET = 'gzafl-dev-secret-change-me';

// Không cho chạy production với khoá ký mặc định hoặc quá yếu
if (IS_PRODUCTION) {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === DEV_SECRET) {
    console.error('LỖI: Chưa đặt JWT_SECRET (hoặc vẫn dùng khoá mặc định) nhưng đang chạy NODE_ENV=production.');
    console.error('      Tạo khoá mới:  npm run gen-secret');
    console.error('      Ghi vào .env:  npm run gen-secret -- --write');
    process.exit(1);
  }
  if (process.env.JWT_SECRET.length < 32) {
    console.error('LỖI: JWT_SECRET ở production phải dài ít nhất 32 ký tự. Dừng khởi động.');
    process.exit(1);
  }
} else if (!process.env.JWT_SECRET) {
  console.warn('CẢNH BÁO: Đang dùng JWT_SECRET mặc định. Chỉ dùng cho môi trường phát triển.');
}

const PORT = Number(process.env.PORT) || 3000;

/* ==========================================
   HTTPS (tuỳ chọn)
   Điền SSL_KEY_PATH + SSL_CERT_PATH trong .env thì server tự chạy HTTPS.
   Nếu đã có reverse proxy (Nginx/Caddy/Cloudflare) thì để trống và bật TRUST_PROXY.
   ========================================== */
const SSL_KEY_PATH = process.env.SSL_KEY_PATH;
const SSL_CERT_PATH = process.env.SSL_CERT_PATH;
const USE_HTTPS = Boolean(SSL_KEY_PATH && SSL_CERT_PATH);

// Chạy sau reverse proxy -> bật để req.protocol trả về https (ảnh hưởng link hoàn tiền
// dạng tuyệt đối) và để cookie secure hoạt động đúng.
const TRUST_PROXY = process.env.TRUST_PROXY;

// Cảnh báo cấu hình sai dễ gây lỗi "đăng nhập xong vẫn như chưa đăng nhập"
if (IS_PRODUCTION && cookieSecure() && !USE_HTTPS && !TRUST_PROXY) {
  console.warn('CẢNH BÁO: production đang bật cookie chỉ-HTTPS nhưng chưa cấu hình HTTPS.');
  console.warn('      Hãy đặt SSL_KEY_PATH + SSL_CERT_PATH, hoặc bật TRUST_PROXY nếu có reverse proxy.');
  console.warn('      Nếu bạn thật sự chạy HTTP thuần, đặt COOKIE_SECURE=false (không khuyến khích).');
  console.warn('      Chi tiết: docs/deployment.md');
}

const ROOT = path.join(__dirname, '..');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
app.disable('x-powered-by');

if (TRUST_PROXY) {
  app.set(
    'trust proxy',
    /^\d+$/.test(TRUST_PROXY) ? Number(TRUST_PROXY) : TRUST_PROXY === 'true' ? true : TRUST_PROXY
  );
}

app.use(express.json({ limit: '6mb' })); // đủ cho avatar base64 tối đa 2MB
app.use(cookieParser());

// Không cho truy cập tài nguyên nội bộ của backend qua đường dẫn tĩnh
const BLOCKED_PREFIXES = ['/backend', '/node_modules', '/data', '/.git'];
const BLOCKED_FILES = ['/package.json', '/package-lock.json'];
app.use((req, res, next) => {
  const p = req.path.toLowerCase();
  const blocked =
    BLOCKED_PREFIXES.some((prefix) => p === prefix || p.startsWith(prefix + '/')) ||
    BLOCKED_FILES.includes(p);
  if (blocked) return res.status(404).send('Not found');
  next();
});

// Ảnh avatar
app.use('/uploads', express.static(UPLOAD_DIR));

/* ==========================================
   Link hoàn tiền rút gọn: /r/<mã đơn>
   Ghi nhận lượt bấm rồi chuyển hướng sang link đích.

   Dùng link trung gian (thay vì đưa thẳng link affiliate cho người dùng) để:
   - đếm được số lượt bấm
   - sau này đổi nhà cung cấp affiliate mà link đã phát cho người dùng không hỏng
   ========================================== */
app.get('/r/:code', (req, res) => {
  const code = String(req.params.code || '').trim().toUpperCase();
  const row = db.prepare('SELECT * FROM orders WHERE code = ?').get(code);
  if (!row) return res.status(404).send('Không tìm thấy link hoàn tiền.');

  db.prepare('UPDATE orders SET click_count = click_count + 1 WHERE id = ?').run(row.id);

  let target = row.affiliate_link || row.original_link || row.link;
  try {
    // Ở chế độ thử nghiệm, link hoàn tiền chính là link nội bộ này -> đích thật là link gốc
    if (new URL(target).pathname.startsWith('/r/')) {
      target = row.original_link || row.link;
    }
  } catch (err) {
    target = row.original_link || row.link;
  }

  return res.redirect(302, target);
});

// API
app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// Cấu hình công khai cho giao diện (KHÔNG chứa bí mật nào)
app.get('/api/config', (req, res) => {
  const otp = require('./lib/otp');
  const { BANK_GROUPS } = require('./lib/banks');
  const ai = require('./lib/ai');
  const knowledge = require('./lib/supportKnowledge');
  res.json({
    support: {
      email: process.env.SUPPORT_EMAIL || '',
      zalo: process.env.SUPPORT_ZALO || '',
      // Trợ lý hỗ trợ: có dùng AI hay chỉ trả lời theo kịch bản (xem lib/ai.js)
      ai: ai.isConfigured(),
      // Câu hỏi gợi ý + lời chào hiện trong khung chat (lib/supportKnowledge.js)
      suggestions: knowledge.SUGGESTIONS,
      welcome: knowledge.WELCOME
    },
    // Danh sách ngân hàng/ví cho dropdown ở hộp thoại rút tiền (xem lib/banks.js)
    banks: BANK_GROUPS,
    // Giao diện dựa vào đây để biết có cần hiện bước nhập mã xác thực không
    otp: {
      enabled: otp.otpEnabled(),
      delivery: otp.deliveryAvailable(),
      length: otp.CODE_LENGTH,
      ttlSeconds: otp.TTL_SECONDS,
      resendSeconds: otp.RESEND_COOLDOWN_SECONDS,
      // Đăng nhập có bắt buộc nhập mã không (xem LOGIN_OTP trong .env)
      loginRequired: otp.loginOtpEnabled()
    }
  });
});
app.use('/api/auth', require('./routes/auth'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/wallet', require('./routes/wallet'));
app.use('/api/referral', require('./routes/referral'));
app.use('/api/profile', require('./routes/profile'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/support', require('./routes/support'));
// Điểm nhận báo cáo chuyển đổi từ mạng affiliate (không dùng cookie phiên)
app.use('/api/postback', require('./routes/postback'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Không tìm thấy API.' }));

// Frontend tĩnh
app.use(express.static(ROOT));

// Xử lý lỗi tập trung
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Dữ liệu gửi lên quá lớn.' });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Dữ liệu gửi lên không hợp lệ.' });
  }
  console.error(err);
  res.status(500).json({ error: 'Lỗi máy chủ. Vui lòng thử lại sau.' });
});

let server;
if (USE_HTTPS) {
  let credentials;
  try {
    credentials = {
      key: fs.readFileSync(SSL_KEY_PATH),
      cert: fs.readFileSync(SSL_CERT_PATH)
    };
  } catch (err) {
    console.error(`LỖI: Không đọc được chứng chỉ HTTPS: ${err.message}`);
    process.exit(1);
  }
  server = https.createServer(credentials, app);
} else {
  server = http.createServer(app);
}

server.listen(PORT, () => {
  const scheme = USE_HTTPS ? 'https' : 'http';
  console.log(`GZ AFL backend đang chạy tại ${scheme}://localhost:${PORT}`);
  console.log(`  Môi trường            : ${process.env.NODE_ENV || 'development'}`);
  console.log(`  HTTPS                 : ${USE_HTTPS ? 'có' : 'không'}`);
  console.log(`  Cookie chỉ-HTTPS      : ${cookieSecure() ? 'BẬT' : 'tắt'}`);
  console.log(`  Tin cậy reverse proxy : ${TRUST_PROXY || 'không'}`);
  const affiliate = require('./lib/affiliate').describe();
  console.log(`  Nhà cung cấp hoàn tiền: ${affiliate.provider}${affiliate.isReal ? '' : ' (thử nghiệm, chưa tạo hoa hồng thật)'}`);

  const postback = require('./lib/postback').describe();
  const postbackHost = `http://localhost:${PORT}`;
  if (postback.configured) {
    console.log(`  Nhận báo cáo chuyển đổi: BẬT - khai với mạng URL ${postbackHost}${postback.url}`);
    console.log(
      `                          Tỷ lệ hoàn cho người dùng: ${Math.round(postback.cashbackRate * 100)}% (CASHBACK_RATE)`
    );
  } else {
    console.log('  Nhận báo cáo chuyển đổi: CHƯA cấu hình POSTBACK_SECRET - mạng gọi vào sẽ bị từ chối');
    console.log(`                          Khai URL: ${postbackHost}${postback.url}`);
  }

  const otp = require('./lib/otp');
  const mail = require('./lib/mailer').describe();
  console.log(`  Xác thực email (OTP)  : ${otp.otpEnabled() ? 'BẬT' : 'tắt'} (EMAIL_OTP=${otp.otpMode()})`);
  console.log(`  Xác thực khi đăng nhập: ${otp.loginOtpEnabled() ? 'BẬT' : 'tắt'} (LOGIN_OTP=${(process.env.LOGIN_OTP || 'auto').trim().toLowerCase()})`);
  if (mail.configured) {
    console.log(`  Gửi thư               : qua ${mail.host}:${mail.port}, người gửi ${mail.from}`);
  } else if (mail.dev) {
    console.log('  Gửi thư               : CHƯA cấu hình SMTP - thư được in ra console (chỉ để thử nghiệm)');
  } else {
    console.log('  Gửi thư               : CHƯA cấu hình SMTP - KHÔNG gửi được email nào');
  }

  const ai = require('./lib/ai').describe();
  if (ai.configured) {
    console.log(`  Trợ lý hỗ trợ (AI)    : BẬT - ${ai.provider} / ${ai.model}`);
    console.log(`                          API: ${ai.baseUrl}`);
  } else if (ai.hasKey && !ai.enabled) {
    console.log('  Trợ lý hỗ trợ (AI)    : tắt (AI_ENABLED=off) - trả lời theo kịch bản có sẵn');
  } else {
    console.log('  Trợ lý hỗ trợ (AI)    : CHƯA cấu hình AI_API_KEY - trả lời theo kịch bản có sẵn');
    console.log('                          Muốn dùng AI: điền AI_* trong backend/.env rồi khởi động lại.');
  }

  if (!otp.otpEnabled() && otp.otpMode() === 'auto' && process.env.NODE_ENV === 'production') {
    console.log('');
    console.log('  LƯU Ý: chưa cấu hình SMTP nên bước xác thực email khi đăng ký đang TẮT.');
    console.log('         Muốn bật, điền SMTP_* và MAIL_FROM trong backend/.env rồi khởi động lại.');
  }
  if (otp.otpEnabled() && otp.otpMode() === 'on' && !otp.deliveryAvailable()) {
    console.log('');
    console.log('  CẢNH BÁO: EMAIL_OTP=on nhưng chưa cấu hình SMTP -> KHÔNG AI ĐĂNG KÝ ĐƯỢC.');
    console.log('            Điền SMTP_* và MAIL_FROM trong backend/.env, hoặc đặt EMAIL_OTP=auto.');
  }
  if (otp.loginOtpEnabled() && !otp.deliveryAvailable()) {
    console.log('');
    console.log('  CẢNH BÁO: LOGIN_OTP=on nhưng chưa cấu hình SMTP -> KHÔNG AI ĐĂNG NHẬP ĐƯỢC.');
    console.log('            Điền SMTP_* trong backend/.env, hoặc đặt LOGIN_OTP=auto.');
  }

  const cleaned = otp.cleanup();
  if (cleaned) console.log(`  Đã dọn ${cleaned} mã xác thực hết hạn.`);
});
