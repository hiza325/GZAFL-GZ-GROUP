'use strict';

/**
 * GZ AFL backend
 * - Phục vụ API dưới /api/*
 * - Phục vụ luôn frontend tĩnh (cùng origin) để cookie phiên hoạt động, không cần CORS
 */

// NẠP .env TRƯỚC TIÊN: db.js và các module trong lib/ đọc process.env ngay khi require
const { cookieSecure, isProduction } = require('./lib/env');
const { loadUser } = require('./lib/auth');
const { UPLOAD_DIR } = require('./lib/uploads');

const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const express = require('express');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const { rateLimit } = require('./lib/rateLimit');

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

// ------------------------------------------------------------------
// Không cho chạy production khi email CHƯA được xác thực.
//
// Đăng ký luôn bắt buộc nhập email (để nhận mã khôi phục mật khẩu). Nếu chưa
// cấu hình gửi thư (hoặc đặt EMAIL_OTP=off), không ai kiểm chứng được địa chỉ:
// người ta có thể đăng ký bằng email của người khác, giữ chỗ khiến người thật
// không đăng ký được, và email đó còn bị coi là kênh khôi phục mật khẩu.
//
// Muốn chạy production mà chưa có SMTP: đặt ALLOW_UNVERIFIED_EMAIL=1 (chấp nhận
// rủi ro), hoặc cấu hình SMTP_HOST + MAIL_FROM để bật xác thực email.
// ------------------------------------------------------------------
if (IS_PRODUCTION) {
  const otp = require('./lib/otp');
  if (!otp.otpEnabled() && !otp.allowUnverifiedEmail()) {
    console.error('LỖI: production đang TẮT xác thực email nhưng đăng ký vẫn bắt buộc email.');
    console.error('      Nếu chưa cấu hình SMTP, người dùng có thể đăng ký bằng email của người khác.');
    console.error('      Cách sửa: điền SMTP_HOST + SMTP_USER + SMTP_PASS + MAIL_FROM trong backend/.env');
    console.error('                (và đặt EMAIL_OTP=auto), hoặc đặt EMAIL_OTP=on.');
    console.error('      Chỉ khi thật sự chưa có SMTP: đặt ALLOW_UNVERIFIED_EMAIL=1 để chấp nhận rủi ro.');
    process.exit(1);
  }
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

const app = express();
app.disable('x-powered-by');

/* ==========================================
   Header bảo mật (áp cho mọi response)

   Script chỉ được nạp từ chính website (lucide đã được tự host).
   KHÔNG còn 'unsafe-inline': toàn bộ onclick/onsubmit trong HTML đã được
   chuyển sang data-action + bộ điều phối ở cuối script.js, nên CSP chặn được
   cả script nội tuyến do kẻ tấn công chèn vào (XSS).
   style-src vẫn cần 'unsafe-inline' vì giao diện dùng nhiều thuộc tính style="".
   ========================================== */
const CSP_DIRECTIVES = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "frame-src 'none'"
];

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', CSP_DIRECTIVES.join('; '));

  // HSTS chỉ bật khi thật sự có HTTPS (tránh khoá cứng localhost lúc dev)
  if (IS_PRODUCTION && (req.secure || USE_HTTPS)) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  }
  next();
});

// Dữ liệu API (ví, đơn, thông tin cá nhân) không cho trình duyệt/proxy lưu đệm
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

if (TRUST_PROXY) {
  app.set(
    'trust proxy',
    /^\d+$/.test(TRUST_PROXY) ? Number(TRUST_PROXY) : TRUST_PROXY === 'true' ? true : TRUST_PROXY
  );
}

// Nén gzip/deflate cho response text/JSON/JS/CSS lớn hơn 1 KB.
// Nếu chạy sau Nginx/Caddy, có thể để proxy nén thay; nén ở đây vẫn an toàn
// (proxy thấy Content-Encoding và không nén lần hai).
app.use(compression({ threshold: 1024 }));

app.use(express.json({ limit: '6mb' })); // đủ cho avatar base64 tối đa 2MB
app.use(cookieParser());

/* ==========================================
   Frontend tĩnh: CHỈ phục vụ file giao diện đã biết.

   Trước đây dùng "danh sách chặn" (/backend, /data, /node_modules...) nhưng có thể
   bị lách bằng percent-encoding, ví dụ /%62ackend/data/gzafl.sqlite -> tải được cả
   database (express.static tự giải mã đường dẫn, còn middleware thì không).
   Chuyển sang "danh sách cho phép": đường dẫn phải khớp chính xác, không giải mã,
   nên không còn cách lách.
   ========================================== */
const PUBLIC_ROOT_FILES = new Set([
  '/index.html',
  '/theme.js',
  '/i18n.js',
  '/script.js',
  '/lucide.min.js',
  '/admin.js',
  '/support.js',
  '/style.css',
  '/tailwind.build.css',
  '/logo.png',
  '/chatbot.png'
]);
// Ảnh cờ dùng cho nút chuyển đổi ngôn ngữ
const PUBLIC_ASSET_FILES = new Set([
  '/assets/flags/vn.svg',
  '/assets/flags/gb.svg'
]);
// Chỉ cho đúng một cấp file trong thư mục con; không '%', không '..'
const PUBLIC_SUBDIR_FILE = /^\/(?:components|styles)\/[a-z0-9][a-z0-9._-]*$/;

function isPublicAssetPath(rawPath) {
  const p = String(rawPath || '').toLowerCase();
  return PUBLIC_ROOT_FILES.has(p) || PUBLIC_ASSET_FILES.has(p) || PUBLIC_SUBDIR_FILE.test(p);
}

// Cache tĩnh: CSS/JS chưa có tên kèm hash nên chỉ cache 5 phút (sau đó
// trình duyệt revalidate bằng ETag); font/ảnh ít đổi nên cache 7 ngày.
// HTML luôn revalidate để bản mới được nhận ngay sau khi deploy.
function staticCacheHeaders(res, filePath) {
  if (/\.(?:woff2?|svg|png|jpe?g|gif|webp|ico)$/i.test(filePath)) {
    res.setHeader('Cache-Control', 'public, max-age=604800, must-revalidate');
  } else if (/\.(?:css|js)$/i.test(filePath)) {
    res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
  } else {
    res.setHeader('Cache-Control', 'no-cache');
  }
}

const publicStatic = express.static(ROOT, {
  dotfiles: 'deny',
  index: false,
  redirect: false,
  setHeaders: staticCacheHeaders
});

/* ==========================================
   Ảnh trong /uploads

   - avatar_* : công khai (ảnh đại diện, không nhạy cảm).
   - qr_*     : chỉ CHỦ SỞ HỮU hoặc quản trị viên xem được, vì ảnh QR chứa số tài
                khoản ngân hàng. Tên file có dạng qr_<userId>_<random>.webp nên ta
                so được id trong tên với người đang đăng nhập.

   express.static tự giải mã percent-encoding, nên guard phải từ chối mọi đường dẫn
   còn ký tự '%' (và cả '\\', '..') — nếu không sẽ lách được kiểm tra.
   ========================================== */
const SAFE_UPLOAD_NAME = /^[a-z0-9][a-z0-9._-]*$/;
const QR_UPLOAD_NAME = /^qr_(\d+)_[a-z0-9._-]+$/;

function uploadGuard(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).end();

  const raw = String(req.path || '');
  if (!raw || raw.includes('%') || raw.includes('\\') || raw.includes('..')) {
    return res.status(404).send('Không tìm thấy.');
  }

  const name = path.posix.basename(raw).toLowerCase();
  if (!SAFE_UPLOAD_NAME.test(name)) return res.status(404).send('Không tìm thấy.');

  const qr = QR_UPLOAD_NAME.exec(name);
  if (!qr) return next(); // không phải ảnh QR -> công khai

  const user = loadUser(req);
  if (!user) return res.status(401).json({ error: 'Bạn chưa đăng nhập.' });
  if (user.role !== 'admin' && String(user.id) !== qr[1]) {
    return res.status(403).json({ error: 'Bạn không có quyền xem ảnh này.' });
  }
  return next();
}

app.use('/uploads', uploadGuard, express.static(UPLOAD_DIR, { dotfiles: 'deny', index: false, redirect: false }));

/* ==========================================
   Link hoàn tiền rút gọn: /r/<mã đơn>
   Ghi nhận lượt bấm rồi chuyển hướng sang link đích.

   Dùng link trung gian (thay vì đưa thẳng link affiliate cho người dùng) để:
   - đếm được số lượt bấm
   - sau này đổi nhà cung cấp affiliate mà link đã phát cho người dùng không hỏng
   ========================================== */
// Mỗi IP tối đa 120 lượt bấm link / phút. Người dùng thật hiếm khi vượt;
// giới hạn này chặn việc dùng script bơm click_count hoặc dội database.
const redirectRateLimit = rateLimit({ windowMs: 60 * 1000, max: 120, name: 'redirect' });

app.get('/r/:code', redirectRateLimit, (req, res) => {
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

  // Chỉ chuyển hướng tới http(s): chặn link cũ lỡ lưu javascript:, data:...
  let safeTarget = null;
  try {
    const u = new URL(target);
    if (u.protocol === 'http:' || u.protocol === 'https:') safeTarget = u.toString();
  } catch (err) {
    safeTarget = null;
  }
  if (!safeTarget) return res.status(404).send('Link hoàn tiền không hợp lệ.');

  return res.redirect(302, safeTarget);
});

// API
app.get('/api/health', (req, res) => {
  try {
    db.prepare('SELECT 1 AS ok').get();
    return res.json({ ok: true, db: 'ok', time: new Date().toISOString() });
  } catch (err) {
    console.error('Health check lỗi database:', err.message);
    return res.status(503).json({ ok: false, db: 'error', time: new Date().toISOString() });
  }
});

// Cấu hình công khai cho giao diện (KHÔNG chứa bí mật nào)
app.get('/api/config', (req, res) => {
  const otp = require('./lib/otp');
  const { BANK_GROUPS } = require('./lib/banks');
  const ai = require('./lib/ai');
  const knowledge = require('./lib/supportKnowledge');
  const affiliate = require('./lib/affiliate').describe();
  res.json({
    // Trạng thái link thật/mock để giao diện không quảng cáo sai sàn nào đã gắn hoa hồng
    affiliate: {
      isReal: affiliate.isReal,
      livePlatforms: affiliate.livePlatforms
    },
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

// Frontend tĩnh (xem danh sách cho phép ở trên)
app.get(['/', '/index.html'], (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(ROOT, 'index.html'));
});
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (!isPublicAssetPath(req.path)) return next();
  return publicStatic(req, res, next);
});

// Không khớp gì thì trả 404 gọn
app.use((req, res) => res.status(404).send('Không tìm thấy.'));

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

// Giới hạn thời gian đọc header/request: giảm rủi ro slowloris.
// requestTimeout để 5 phút (mặc định của Node) vì ảnh avatar 2MB có thể tải chậm trên 3G.
server.headersTimeout = 20_000;
server.requestTimeout = 300_000;
server.keepAliveTimeout = 65_000;

server.listen(PORT, () => {
  const scheme = USE_HTTPS ? 'https' : 'http';
  console.log(`GZ AFL backend đang chạy tại ${scheme}://localhost:${PORT}`);
  console.log(`  Môi trường            : ${process.env.NODE_ENV || 'development'}`);
  console.log(`  HTTPS                 : ${USE_HTTPS ? 'có' : 'không'}`);
  console.log(`  Cookie chỉ-HTTPS      : ${cookieSecure() ? 'BẬT' : 'tắt'}`);
  console.log(`  Tin cậy reverse proxy : ${TRUST_PROXY || 'không'}`);
  const rlStore = require('./lib/rateLimit').storeName();
  console.log(
    `  Giới hạn tần suất    : ${
      rlStore === 'sqlite' ? 'SQLite (dùng chung nhiều tiến trình)' : 'bộ nhớ (chỉ đúng khi chạy 1 tiến trình)'
    }`
  );
  if (IS_PRODUCTION && rlStore !== 'sqlite') {
    console.warn('  CẢNH BÁO: production nên đặt RATE_LIMIT_STORE=sqlite nếu chạy nhiều tiến trình/instance.');
  }
  const affiliate = require('./lib/affiliate').describe();
  console.log(`  Nhà cung cấp hoàn tiền: ${affiliate.provider}${affiliate.isReal ? '' : ' (thử nghiệm, chưa tạo hoa hồng thật)'}`);
  if (affiliate.livePlatforms && affiliate.livePlatforms.length) {
    console.log(`                          Sàn dùng API thật: ${affiliate.livePlatforms.join(', ')}`);
  }

  const postback = require('./lib/postback').describe();
  const publicBaseUrl = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  const postbackHost = publicBaseUrl || `${scheme}://localhost:${PORT}`;
  if (postback.configured) {
    console.log(`  Nhận báo cáo chuyển đổi: BẬT - khai với mạng URL ${postbackHost}${postback.url}`);
    console.log(
      `                          Tỷ lệ hoàn cho người dùng: ${Math.round(postback.cashbackRate * 100)}% (CASHBACK_RATE)`
    );
    console.log('                          Duyệt hoa hồng: quản trị viên duyệt thủ công trước khi cộng ví');
    if (postback.cashbackRate >= 1) {
      console.warn('  CẢNH BÁO: CASHBACK_RATE đang là 100% — nền tảng không giữ lại doanh thu.');
      console.warn('           Nếu không cố ý, đặt CASHBACK_RATE=0.8 (hoàn 80%) trong backend/.env rồi khởi động lại.');
    }
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

  if (!otp.otpEnabled() && otp.allowUnverifiedEmail() && process.env.NODE_ENV === 'production') {
    console.log('');
    console.log('  CẢNH BÁO: ALLOW_UNVERIFIED_EMAIL=1 - production đang chạy mà CHƯA xác thực email.');
    console.log('            Ai cũng có thể đăng ký bằng email của người khác. Hãy cấu hình SMTP sớm nhất có thể.');
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

  if (IS_PRODUCTION) {
    console.log('  Kiểm tra cấu hình     : npm run check:deploy');
    if (!String(process.env.CASHBACK_RATE || '').trim()) {
      console.warn('  CẢNH BÁO: chưa đặt CASHBACK_RATE - đang hoàn 100% hoa hồng cho người dùng.');
    }
    if (!String(process.env.PUBLIC_BASE_URL || '').trim()) {
      console.warn(
        '  CẢNH BÁO: chưa đặt PUBLIC_BASE_URL - link hoàn tiền/postback có thể bị tạo với http:// sau proxy.'
      );
    }
  }

  const cleaned = otp.cleanup();
  if (cleaned) console.log(`  Đã dọn ${cleaned} mã xác thực hết hạn.`);
});

/* ==========================================
   Dừng an toàn (systemd/PM2 gửi SIGTERM)
   - Ngừng nhận request mới
   - Chờ request đang chạy xong (tối đa 10 giây)
   - Đóng database để không hỏng file SQLite/WAL
   ========================================== */
let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\nNhận tín hiệu ${signal}, đang dừng máy chủ...`);

  const force = setTimeout(() => {
    console.error('Quá 10 giây, buộc dừng.');
    process.exit(1);
  }, 10_000);
  force.unref();

  server.close(() => {
    clearTimeout(force);
    try {
      db.close();
    } catch (err) {
      console.warn(`Không đóng được database: ${err.message}`);
    }
    console.log('Đã dừng.');
    process.exit(0);
  });

  // Đóng các kết nối keep-alive đang rảnh để không phải chờ hết timeout
  if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
