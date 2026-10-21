'use strict';

/**
 * Kiểm tra cấu hình trước khi đưa web lên production.
 *
 * Chạy:
 *   cd backend
 *   npm run check:deploy
 *
 * Script chỉ ĐỌC cấu hình và kiểm tra quyền ghi thư mục, KHÔNG kết nối mạng,
 * KHÔNG gửi email, KHÔNG in ra giá trị bí mật.
 *
 * Mã thoát:
 *   0 = không có lỗi chặn (có thể còn cảnh báo)
 *   1 = có ít nhất một lỗi phải sửa trước khi chạy production
 */

require('../lib/env'); // nạp backend/.env trước khi đọc process.env

const fs = require('node:fs');
const path = require('node:path');

const BACKEND_DIR = path.join(__dirname, '..');
const DATA_DIR = process.env.DB_PATH ? path.dirname(path.resolve(BACKEND_DIR, process.env.DB_PATH)) : path.join(BACKEND_DIR, 'data');
const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(BACKEND_DIR, process.env.UPLOAD_DIR)
  : path.join(BACKEND_DIR, 'uploads');
const BACKUP_DIR = process.env.BACKUP_DIR
  ? path.resolve(BACKEND_DIR, process.env.BACKUP_DIR)
  : path.join(BACKEND_DIR, 'backups');

const errors = [];
const warnings = [];
const oks = [];

function pass(message) {
  oks.push(message);
}

function warn(message) {
  warnings.push(message);
}

function fail(message) {
  errors.push(message);
}

function envText(name) {
  return String(process.env[name] || '').trim();
}

function isTruthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

/* ==========================================
   1. Phiên bản Node
   node:sqlite chỉ bỏ cờ --experimental-sqlite từ Node 22.13 / 23.4.
   ========================================== */
(function checkNode() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major > 22 || (major === 22 && minor >= 13)) {
    pass(`Node.js ${process.versions.node} (node:sqlite dùng được không cần cờ)`);
  } else {
    fail(
      `Node.js ${process.versions.node} quá cũ: node:sqlite cần Node >= 22.13 ` +
        '(hoặc chạy kèm --experimental-sqlite trên 22.5–22.12). Khuyến nghị Node 24 LTS.'
    );
  }
})();

/* ==========================================
   2. Môi trường & khoá ký phiên
   ========================================== */
(function checkEnvironment() {
  const nodeEnv = envText('NODE_ENV');
  if (nodeEnv === 'production') {
    pass('NODE_ENV=production');
  } else {
    fail(`NODE_ENV đang là "${nodeEnv || 'development'}" — production phải là "production".`);
  }

  const secret = envText('JWT_SECRET');
  if (!secret || secret === 'gzafl-dev-secret-change-me') {
    fail('JWT_SECRET chưa đặt hoặc vẫn dùng khoá mặc định. Chạy: npm run gen-secret -- --write');
  } else if (secret.length < 32) {
    fail(`JWT_SECRET quá ngắn (${secret.length} ký tự, cần >= 32).`);
  } else {
    pass(`JWT_SECRET đã đặt (${secret.length} ký tự)`);
  }
})();

/* ==========================================
   2b. Cảnh báo bảo mật / tạm giữ tài khoản
   ========================================== */
(function checkSecurityAlerts() {
  const threshold = Number(envText('SECURITY_ALERT_THRESHOLD') || 10);
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > 1000) {
    fail('SECURITY_ALERT_THRESHOLD phải là số nguyên từ 1 đến 1000.');
  } else {
    pass(`Cảnh báo sau ${threshold} lần đăng nhập sai`);
  }

  const windowMinutes = Number(envText('SECURITY_ALERT_WINDOW_MINUTES') || 15);
  if (!Number.isInteger(windowMinutes) || windowMinutes < 1 || windowMinutes > 1440) {
    fail('SECURITY_ALERT_WINDOW_MINUTES phải là số nguyên từ 1 đến 1440.');
  } else {
    pass(`Cửa sổ cảnh báo ${windowMinutes} phút`);
  }

  const autoHold = Number(envText('SECURITY_AUTO_HOLD_HOURS') || 0);
  if (!Number.isInteger(autoHold) || autoHold < 0 || autoHold > 168) {
    fail('SECURITY_AUTO_HOLD_HOURS phải là số nguyên từ 0 đến 168.');
  } else if (autoHold === 0) {
    pass('Không tự khóa tài khoản: chỉ cảnh báo admin xem xét');
  } else {
    warn(`SECURITY_AUTO_HOLD_HOURS=${autoHold}: hệ thống tự tạm giữ tài khoản sau ngưỡng cảnh báo.`);
  }

  const stepUp = (envText('SECURITY_STEP_UP') || 'on').toLowerCase();
  if (stepUp === 'off' || stepUp === 'false' || stepUp === '0') {
    warn('SECURITY_STEP_UP=off: không yêu cầu OTP bổ sung khi tài khoản có cảnh báo bảo mật.');
  } else {
    pass('Cảnh báo bảo mật sẽ yêu cầu OTP bổ sung ở lần đăng nhập tiếp theo (nếu gửi được thư)');
  }
})();

/* ==========================================
   3. HTTPS / reverse proxy
   ========================================== */
(function checkHttps() {
  const hasCert = envText('SSL_KEY_PATH') && envText('SSL_CERT_PATH');
  const trustProxy = envText('TRUST_PROXY');

  if (hasCert) {
    pass('HTTPS do Node tự chạy (SSL_KEY_PATH + SSL_CERT_PATH)');
  } else if (trustProxy) {
    pass(`Chạy sau reverse proxy (TRUST_PROXY=${trustProxy})`);
  } else {
    fail(
      'Chưa có HTTPS: đặt SSL_KEY_PATH + SSL_CERT_PATH, hoặc TRUST_PROXY=1 nếu dùng Nginx/Caddy/Cloudflare. ' +
        'Thiếu cả hai thì cookie secure bị trình duyệt từ chối và đăng nhập sẽ lỗi.'
    );
  }

  if (String(envText('COOKIE_SECURE')).toLowerCase() === 'false') {
    warn('COOKIE_SECURE=false: cookie phiên sẽ gửi cả qua HTTP. Chỉ dùng khi thật sự chạy HTTP nội bộ.');
  }

  const base = envText('PUBLIC_BASE_URL').replace(/\/+$/, '');
  if (!base) {
    warn(
      'Chưa đặt PUBLIC_BASE_URL: link hoàn tiền mock và URL postback sẽ lấy theo request, ' +
        'sau proxy có thể bị "http://". Nên đặt ví dụ https://ten-mien-cua-ban.com'
    );
  } else if (!/^https:\/\//i.test(base)) {
    warn(`PUBLIC_BASE_URL không phải https:// (${base}). Link công khai có thể bị sai scheme.`);
  } else {
    pass(`PUBLIC_BASE_URL=${base}`);
  }
})();

/* ==========================================
   4. Tỷ lệ hoàn & affiliate
   ========================================== */
(function checkMoneyAndAffiliate() {
  const raw = envText('CASHBACK_RATE');
  if (!raw) {
    warn(
      'Chưa đặt CASHBACK_RATE — mặc định đang hoàn 100% cho người dùng (nền tảng không giữ lại doanh thu). ' +
        'Ví dụ đặt CASHBACK_RATE=0.8 để hoàn 80%.'
    );
  } else {
    const rate = Number(raw);
    if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
      fail(`CASHBACK_RATE="${raw}" không hợp lệ: phải là số từ 0 đến 1 (ví dụ 0.8).`);
    } else if (rate >= 1) {
      warn('CASHBACK_RATE=1: đang hoàn 100% hoa hồng cho người dùng.');
    } else {
      pass(`CASHBACK_RATE=${rate} (hoàn ${Math.round(rate * 100)}%)`);
    }
  }

  const provider = (envText('AFFILIATE_PROVIDER') || 'mock').toLowerCase();
  if (provider === 'mock') {
    warn('AFFILIATE_PROVIDER=mock: link chỉ để thử nghiệm, KHÔNG tạo hoa hồng thật.');
  } else if (provider === 'accesstrade') {
    if (!envText('ACCESSTRADE_API_KEY')) {
      fail('AFFILIATE_PROVIDER=accesstrade nhưng thiếu ACCESSTRADE_API_KEY.');
    } else {
      pass('AccessTrade: đã có API key');
    }
    const live = envText('AFFILIATE_LIVE_PLATFORMS');
    if (!live) {
      warn('AFFILIATE_LIVE_PLATFORMS trống: mọi sàn sẽ gọi API thật, kể cả sàn chưa được duyệt campaign.');
    } else {
      pass(`Sàn dùng API thật: ${live}`);
    }
  } else if (provider === 'shopee') {
    fail('AFFILIATE_PROVIDER=shopee chưa được cài đặt trong bản này (xem docs/affiliate-integration.md).');
  } else {
    fail(`AFFILIATE_PROVIDER="${provider}" không hợp lệ (mock | accesstrade | shopee).`);
  }
})();

/* ==========================================
   5. Postback
   ========================================== */
(function checkPostback() {
  const secret = envText('POSTBACK_SECRET');
  if (!secret) {
    warn('Chưa đặt POSTBACK_SECRET: mọi postback từ mạng affiliate sẽ bị từ chối (503).');
  } else if (secret.length < 16) {
    warn(`POSTBACK_SECRET chỉ ${secret.length} ký tự — nên dùng chuỗi ngẫu nhiên dài >= 32.`);
  } else {
    pass('POSTBACK_SECRET đã đặt');
  }
})();

/* ==========================================
   6. Gửi email
   ========================================== */
(function checkMail() {
  const otpMode = (envText('EMAIL_OTP') || 'auto').toLowerCase();
  const loginMode = (envText('LOGIN_OTP') || 'auto').toLowerCase();
  const hasSmtp = Boolean(envText('SMTP_HOST') && (envText('MAIL_FROM') || envText('SMTP_USER')));
  const allowUnverified = isTruthy(envText('ALLOW_UNVERIFIED_EMAIL'));

  // Đăng ký luôn bắt buộc email. Không xác thực được email nghĩa là ai cũng có thể
  // đăng ký bằng địa chỉ của người khác -> mặc định coi là LỖI chặn deploy.
  if (!hasSmtp) {
    if (otpMode === 'on' || loginMode === 'on') {
      fail('EMAIL_OTP/LOGIN_OTP=on nhưng chưa cấu hình SMTP — sẽ không ai đăng ký/đăng nhập được.');
    } else if (!allowUnverified) {
      fail(
        'Chưa cấu hình SMTP nên email đăng ký sẽ KHÔNG được xác thực (ai cũng có thể dùng email người khác). ' +
          'Điền SMTP_* + MAIL_FROM, hoặc đặt ALLOW_UNVERIFIED_EMAIL=1 nếu chấp nhận rủi ro.'
      );
    } else {
      warn('ALLOW_UNVERIFIED_EMAIL=1: đăng ký không xác thực email — chỉ dùng tạm khi chưa có SMTP.');
    }
    return;
  }

  pass(`SMTP: ${envText('SMTP_HOST')}:${envText('SMTP_PORT') || '587'}`);
  if (otpMode === 'off') {
    if (allowUnverified) {
      warn('EMAIL_OTP=off: đăng ký không xác thực email (đã cho phép bằng ALLOW_UNVERIFIED_EMAIL=1).');
    } else {
      fail(
        'EMAIL_OTP=off: đăng ký vẫn bắt buộc email nhưng không xác thực — ' +
          'đặt EMAIL_OTP=auto/on (đã có SMTP), hoặc ALLOW_UNVERIFIED_EMAIL=1 nếu chấp nhận rủi ro.'
      );
    }
  }
  if (!envText('MAIL_FROM')) {
    warn('Chưa đặt MAIL_FROM: đang dùng SMTP_USER làm người gửi, dễ vào Spam. Nên dùng địa chỉ thuộc tên miền của bạn.');
  }
})();

/* ==========================================
   7. Thư mục ghi được
   ========================================== */
(function checkDirectories() {
  for (const [label, dir] of [
    ['database', DATA_DIR],
    ['uploads', UPLOAD_DIR],
    ['backups', BACKUP_DIR]
  ]) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
      pass(`Thư mục ${label} ghi được: ${dir}`);
    } catch (err) {
      fail(`Không ghi được thư mục ${label} (${dir}): ${err.message}`);
    }
  }
})();

/* ==========================================
   8. Bộ đếm chống spam
   ========================================== */
(function checkRateLimitStore() {
  const store = (envText('RATE_LIMIT_STORE') || 'memory').toLowerCase();
  if (store === 'sqlite') {
    pass('RATE_LIMIT_STORE=sqlite (dùng chung khi chạy nhiều tiến trình)');
  } else {
    warn('RATE_LIMIT_STORE=memory: chỉ đúng khi chạy đúng 1 tiến trình. Nên đặt sqlite nếu dùng PM2 cluster/nhiều instance.');
  }
})();

/* ==========================================
   In kết quả
   ========================================== */
console.log('');
console.log('=== KIỂM TRA CẤU HÌNH TRIỂN KHAI GZ AFL ===');
console.log('');

for (const line of oks) console.log('  [OK]   ' + line);
for (const line of warnings) console.log('  [CẢNH BÁO] ' + line);
for (const line of errors) console.log('  [LỖI]  ' + line);

console.log('');
if (errors.length) {
  console.log(`Kết quả: ${errors.length} lỗi, ${warnings.length} cảnh báo. PHẢI SỬA trước khi chạy production.`);
  process.exit(1);
}
console.log(`Kết quả: không có lỗi chặn, ${warnings.length} cảnh báo. Có thể khởi động production.`);
