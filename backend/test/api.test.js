'use strict';

/**
 * Test API + các lớp bảo vệ hạ tầng.
 * Chạy: npm test
 *
 * Mỗi lần chạy dùng database + thư mục ảnh TẠM, không đụng dữ liệu thật.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const BACKEND_DIR = path.join(__dirname, '..');
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gzafl-api-'));
const ENV_FILE = path.join(TMP_DIR, 'test.env');
const DB_PATH = path.join(TMP_DIR, 'test.sqlite');
const UPLOAD_DIR = path.join(TMP_DIR, 'uploads');
const JWT_SECRET = 'test-secret-' + 'x'.repeat(48);
const POSTBACK_SECRET = 'test-postback-secret';
const PASSWORD = 'Test123456!';

let child = null;
let base = '';
let logs = '';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function startServer() {
  const port = await freePort();

  fs.writeFileSync(ENV_FILE, '# file env rỗng cho test\n', 'utf8');
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  const env = {
    ...process.env,
    GZAFL_ENV_FILE: ENV_FILE,
    PORT: String(port),
    NODE_ENV: 'test',
    JWT_SECRET,
    DB_PATH,
    UPLOAD_DIR,
    EMAIL_OTP: 'off',
    LOGIN_OTP: 'off',
    AI_ENABLED: 'off',
    AI_API_KEY: '',
    AFFILIATE_PROVIDER: 'mock',
    POSTBACK_SECRET,
    COMMISSION_HOLD_DAYS: '7',
    RATE_LIMIT_STORE: 'sqlite',
    SMTP_HOST: '',
    SMTP_USER: '',
    SMTP_PASS: '',
    MAIL_FROM: ''
  };

  child = spawn(process.execPath, ['server.js'], {
    cwd: BACKEND_DIR,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    logs += chunk;
  });
  child.stderr.on('data', (chunk) => {
    logs += chunk;
  });

  base = `http://127.0.0.1:${port}`;

  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`Server thoát sớm:\n${logs}`);
    try {
      const res = await fetch(base + '/api/health');
      if (res.ok) return;
    } catch (err) {
      // Chưa lên, thử lại
    }
    await delay(100);
  }

  throw new Error(`Server không khởi động được:\n${logs}`);
}

async function stopServer() {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await Promise.race([once(child, 'exit'), delay(3000)]);
  if (child.exitCode === null) child.kill('SIGKILL');
  child = null;
}

function request(urlPath, { method = 'GET', body, cookie, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== undefined) h['content-type'] = 'application/json';
  if (cookie) h.cookie = cookie;

  return fetch(base + urlPath, {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual'
  });
}

async function json(urlPath, options) {
  const res = await request(urlPath, options);
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch (err) {
    // Không phải JSON (trang 404...)
  }
  return { res, data, text };
}

function createUser({ username, email, name, role = 'user' }) {
  const db = new DatabaseSync(DB_PATH);
  const referral = Math.random().toString(36).slice(2, 8).toUpperCase();
  const info = db
    .prepare(
      `INSERT INTO users (username, password_hash, name, email, phone, referral_code, role, points, created_at)
       VALUES (?, ?, ?, ?, '', ?, ?, 0, ?)`
    )
    .run(username, bcrypt.hashSync(PASSWORD, 10), name, email, referral, role, new Date().toISOString());
  db.close();

  const uid = Number(info.lastInsertRowid);
  const token = jwt.sign({ uid, tv: 1 }, JWT_SECRET, { expiresIn: '7d' });
  return { uid, cookie: `gz_token=${token}` };
}

test('API và hạ tầng', { timeout: 90_000 }, async (t) => {
  t.after(async () => {
    await stopServer();
    fs.rmSync(TMP_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  await startServer();

  const admin = createUser({ username: 'admin@test.local', email: 'admin@test.local', name: 'Quản trị', role: 'admin' });
  const user = createUser({ username: 'user@test.local', email: 'user@test.local', name: 'Người dùng' });
  const other = createUser({ username: 'other@test.local', email: 'other@test.local', name: 'Người khác' });

  await t.test('health + header bảo mật', async () => {
    const { res, data } = await json('/api/health');
    assert.equal(res.status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.db, 'ok');

    const csp = res.headers.get('content-security-policy') || '';
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('cache-control'), 'no-store');
  });

  await t.test('cấu hình công khai báo đúng trạng thái link', async () => {
    const { res, data } = await json('/api/config');
    assert.equal(res.status, 200);
    assert.equal(data.affiliate.isReal, false);
    assert.ok(Array.isArray(data.affiliate.livePlatforms));
  });

  await t.test('chỉ phục vụ file giao diện trong danh sách cho phép', async () => {
    const blocked = [
      '/backend/.env',
      '/backend/data/gzafl.sqlite',
      '/backend/db.js',
      '/%62ackend/.env',
      '/%2e%2e/backend/.env'
    ];
    for (const p of blocked) {
      const res = await request(p);
      assert.equal(res.status, 404, `Phải chặn ${p}`);
    }

    assert.equal((await request('/index.html')).status, 200);
    assert.equal((await request('/components/landing.html')).status, 200);
    assert.equal((await request('/LOGO.png')).status, 200);
  });

  await t.test('ảnh QR chỉ chủ sở hữu/admin xem được', async () => {
    fs.writeFileSync(path.join(UPLOAD_DIR, `qr_${user.uid}_test.webp`), 'fake-webp');
    fs.writeFileSync(path.join(UPLOAD_DIR, 'avatar_test.webp'), 'fake-avatar');

    const anon = await request(`/uploads/qr_${user.uid}_test.webp`);
    assert.equal(anon.status, 401);

    const owner = await request(`/uploads/qr_${user.uid}_test.webp`, { cookie: user.cookie });
    assert.equal(owner.status, 200);

    const stranger = await request(`/uploads/qr_${user.uid}_test.webp`, { cookie: other.cookie });
    assert.equal(stranger.status, 403);

    const boss = await request(`/uploads/qr_${user.uid}_test.webp`, { cookie: admin.cookie });
    assert.equal(boss.status, 200);

    const avatar = await request('/uploads/avatar_test.webp');
    assert.equal(avatar.status, 200);
  });

  await t.test('chặn link sàn giả, nhận link Shopee/Tiki/Lazada hợp lệ', async () => {
    const fakeDomain = await json('/api/orders', {
      method: 'POST',
      cookie: user.cookie,
      body: { link: 'https://shopee.vn.evil.example/x' }
    });
    assert.equal(fakeDomain.res.status, 400);

    const unsupported = await json('/api/orders', {
      method: 'POST',
      cookie: user.cookie,
      body: { link: 'https://example.com/product/1' }
    });
    assert.equal(unsupported.res.status, 400);

    const scriptLink = await json('/api/orders', {
      method: 'POST',
      cookie: user.cookie,
      body: { link: 'javascript:alert(1)' }
    });
    assert.equal(scriptLink.res.status, 400);

    const good = await json('/api/orders', {
      method: 'POST',
      cookie: user.cookie,
      body: { link: 'https://shopee.vn/product/1/2' }
    });
    assert.equal(good.res.status, 201);
    assert.ok(good.data.order && good.data.order.id, 'Đơn phải có mã (id)');
    assert.equal(good.data.order.platform, 'Shopee');
    assert.equal(good.data.affiliate.provider, 'mock');
    assert.equal(good.data.affiliate.isReal, false);

    const listed = await json('/api/orders', { cookie: user.cookie });
    assert.equal(listed.res.status, 200);
    const listedOrder = (listed.data.orders || []).find((o) => o.id === good.data.order.id);
    assert.ok(listedOrder, 'Đơn vừa tạo phải có trong danh sách');
    assert.equal(listedOrder.affiliate.provider, 'mock');
    assert.equal(listedOrder.affiliate.isReal, false);

    const tiki = await json('/api/orders', {
      method: 'POST',
      cookie: user.cookie,
      body: { link: 'https://tiki.vn/p/123' }
    });
    assert.equal(tiki.res.status, 201);
    assert.equal(tiki.data.order.platform, 'Tiki');

    const lazada = await json('/api/orders', {
      method: 'POST',
      cookie: user.cookie,
      body: { link: 'https://www.lazada.vn/products/1.html' }
    });
    assert.equal(lazada.res.status, 201);
    assert.equal(lazada.data.order.platform, 'Lazada');

    const adminOrders = await json('/api/admin/orders', { cookie: admin.cookie });
    assert.equal(adminOrders.res.status, 200);
    const adminOrder = (adminOrders.data.orders || []).find((o) => o.id === good.data.order.id);
    assert.ok(adminOrder, 'Quản trị viên phải thấy đơn vừa tạo');
    assert.equal(adminOrder.affiliate.isReal, false);
  });

  await t.test('không cho chiếm email làm username và chặn email trùng', async () => {
    const squat = await json('/api/auth/register', {
      method: 'POST',
      body: {
        username: 'victim@test.local',
        email: 'attacker@test.local',
        password: PASSWORD,
        name: 'Kẻ giả mạo'
      }
    });
    assert.equal(squat.res.status, 400);
    assert.match(squat.data.error, /trùng/);

    const first = await json('/api/auth/register', {
      method: 'POST',
      body: {
        username: '0901234567',
        email: 'shared@test.local',
        password: PASSWORD,
        name: 'Người thứ nhất'
      }
    });
    assert.equal(first.res.status, 201);

    const second = await json('/api/auth/register', {
      method: 'POST',
      body: {
        username: '0901234568',
        email: 'SHARED@test.local',
        password: PASSWORD,
        name: 'Người thứ hai'
      }
    });
    assert.equal(second.res.status, 409);
    assert.match(second.data.error, /Email/);
  });

  await t.test('không cho đổi email trùng tài khoản khác', async () => {
    const res = await json('/api/profile', {
      method: 'PUT',
      cookie: user.cookie,
      body: { name: 'Người dùng', email: 'other@test.local', phone: '' }
    });
    assert.equal(res.res.status, 409);
    assert.match(res.data.error, /Email/);

    const clear = await json('/api/profile', {
      method: 'PUT',
      cookie: user.cookie,
      body: { name: 'Người dùng', email: '', phone: '' }
    });
    assert.equal(clear.res.status, 400);
    assert.match(clear.data.error, /email/i);
  });

  await t.test('đăng nhập email không phân biệt hoa-thường', async () => {
    const login = await json('/api/auth/login', {
      method: 'POST',
      body: { username: 'USER@TEST.LOCAL', password: PASSWORD }
    });
    assert.equal(login.res.status, 200);
    assert.ok(login.data.user && login.data.user.username === 'user@test.local');
  });

  await t.test('logout thu hồi token cũ', async () => {
    const session = createUser({
      username: 'logout@test.local',
      email: 'logout@test.local',
      name: 'Người đăng xuất'
    });

    const meBefore = await json('/api/auth/me', { cookie: session.cookie });
    assert.equal(meBefore.res.status, 200);
    assert.ok(meBefore.data.user);

    const out = await json('/api/auth/logout', { method: 'POST', cookie: session.cookie });
    assert.equal(out.res.status, 200);

    const meAfter = await json('/api/auth/me', { cookie: session.cookie });
    assert.equal(meAfter.res.status, 200);
    assert.equal(meAfter.data.user, null);
  });

  await t.test('phân quyền quản trị', async () => {
    assert.equal((await json('/api/admin/users')).res.status, 401);
    assert.equal((await json('/api/admin/users', { cookie: user.cookie })).res.status, 403);
    assert.equal((await json('/api/admin/users', { cookie: admin.cookie })).res.status, 200);
  });

  await t.test('ghi nhật ký quản trị khi sửa người dùng', async () => {
    const patch = await json(`/api/admin/users/${other.uid}`, {
      method: 'PATCH',
      cookie: admin.cookie,
      body: { points: 50 }
    });
    assert.equal(patch.res.status, 200);

    const history = await json('/api/admin/audit-logs?limit=10', { cookie: admin.cookie });
    assert.equal(history.res.status, 200);
    assert.ok(history.data.total >= 1);
    assert.ok(
      history.data.logs.some(
        (row) => row.action === 'Cập nhật người dùng' && String(row.targetId) === 'other@test.local'
      )
    );
  });

  await t.test('postback: sai khoá bị từ chối, đúng khoá được ghi nhận', async () => {
    const bad = await request('/api/postback/mock?secret=wrong&transaction_id=TX-BAD&reward=1000');
    assert.equal(bad.status, 403);

    const good = await json(
      `/api/postback/mock?secret=${encodeURIComponent(POSTBACK_SECRET)}&transaction_id=TX-OK-1&sub1=gzafl-u${user.uid}&status=pending&reward=100000`
    );
    assert.equal(good.res.status, 200);
    assert.equal(good.data.ok, true);
    assert.equal(good.data.matched, true);
  });

  await t.test('giữ hoa hồng, cho rút sau thời gian giữ và thu hồi khi postback huỷ', async () => {
    const created = await json('/api/orders', {
      method: 'POST',
      cookie: other.cookie,
      body: { link: 'https://tiki.vn/p/hold-test' }
    });
    assert.equal(created.res.status, 201);
    const code = created.data.order.id;
    const tx = 'TX-HOLD-' + Date.now();
    const baseQuery =
      `/api/postback/mock?secret=${encodeURIComponent(POSTBACK_SECRET)}` +
      `&transaction_id=${encodeURIComponent(tx)}&product_id=P1` +
      `&sub1=gzafl-u${other.uid}&sub2=${encodeURIComponent(code)}`;

    const pending = await json(baseQuery + '&status=pending&reward=100000');
    assert.equal(pending.res.status, 200);
    assert.equal(pending.data.matched, true);

    let wallet = await json('/api/wallet', { cookie: other.cookie });
    assert.equal(wallet.res.status, 200);
    assert.equal(wallet.data.heldCommission, 0);
    assert.equal(wallet.data.balance, 0);

    const approved = await json(baseQuery + '&status=approved&reward=100000');
    assert.equal(approved.res.status, 200);
    assert.equal(approved.data.status, 'Hoàn thành');

    wallet = await json('/api/wallet', { cookie: other.cookie });
    assert.equal(wallet.data.totalCommission, 100000);
    assert.equal(wallet.data.heldCommission, 100000);
    assert.equal(wallet.data.balance, 0, 'Hoa hồng đang giữ chưa được rút');

    const orders = await json('/api/orders', { cookie: other.cookie });
    const heldOrder = (orders.data.orders || []).find((o) => o.id === code);
    assert.equal(heldOrder.commissionHeld, true);
    assert.ok(heldOrder.commissionAvailableAt, 'Phải có mốc hết thời gian giữ');

    const tooEarly = await json('/api/wallet/withdrawals', {
      method: 'POST',
      cookie: other.cookie,
      body: { mode: 'account', bank: 'Vietcombank', accNum: '123456789', accName: 'NGUYEN VAN A' }
    });
    assert.equal(tooEarly.res.status, 400, 'Chưa hết thời gian giữ thì không được rút');

    // Giả lập thời gian giữ đã qua bằng cách chỉnh mốc trong database test.
    const directDb = new DatabaseSync(DB_PATH);
    directDb
      .prepare('UPDATE orders SET commission_available_at = ? WHERE code = ?')
      .run(new Date(Date.now() - 60_000).toISOString(), code);
    directDb.close();

    wallet = await json('/api/wallet', { cookie: other.cookie });
    assert.equal(wallet.data.heldCommission, 0);
    assert.equal(wallet.data.balance, 100000);

    const withdrawal = await json('/api/wallet/withdrawals', {
      method: 'POST',
      cookie: other.cookie,
      body: { mode: 'account', bank: 'Vietcombank', accNum: '123456789', accName: 'NGUYEN VAN A' }
    });
    assert.equal(withdrawal.res.status, 201);
    assert.equal(withdrawal.data.balance, 0);

    const adminUsers = await json('/api/admin/users?q=' + encodeURIComponent('other@test.local'), {
      cookie: admin.cookie
    });
    assert.equal(adminUsers.res.status, 200);
    const adminUser = (adminUsers.data.users || []).find((u) => u.id === other.uid);
    assert.ok(adminUser);
    assert.equal(adminUser.withdrawn, 100000);

    const rejected = await json(baseQuery + '&status=rejected&reward=100000');
    assert.equal(rejected.res.status, 200);
    assert.equal(rejected.data.status, 'Đã huỷ');

    wallet = await json('/api/wallet', { cookie: other.cookie });
    assert.equal(wallet.data.totalCommission, 0);
    assert.equal(wallet.data.clawback, 100000);
    assert.equal(wallet.data.balance, -100000);
    assert.equal(wallet.data.debt, 100000);

    const after = await json('/api/orders', { cookie: other.cookie });
    const clawedOrder = (after.data.orders || []).find((o) => o.id === code);
    assert.equal(clawedOrder.status, 'Đã huỷ');
    assert.equal(clawedOrder.commission, 0);
    assert.equal(clawedOrder.reversedCommission, 100000);

    const adminOrders = await json('/api/admin/orders', { cookie: admin.cookie });
    assert.equal(adminOrders.res.status, 200);
    const adminOrder = (adminOrders.data.orders || []).find((o) => o.id === code);
    assert.equal(adminOrder.reversedCommission, 100000);

    const adminWithdrawals = await json('/api/admin/withdrawals', { cookie: admin.cookie });
    const adminWd = (adminWithdrawals.data.withdrawals || []).find((w) => w.id === withdrawal.data.withdrawal.id);
    assert.ok(adminWd);
    assert.equal(adminWd.debt, 100000);
    assert.equal(adminWd.payable, 0);
  });

  await t.test('chatbot FAQ biết tạm giữ và thu hồi hoa hồng', async () => {
    const hold = await json('/api/support/chat', {
      method: 'POST',
      body: { messages: [{ role: 'user', content: 'Hoa hồng tạm giữ bao lâu thì rút được?' }] }
    });
    assert.equal(hold.res.status, 200);
    assert.equal(hold.data.source, 'faq');
    assert.match(hold.data.reply, /tạm giữ 7 ngày/);

    const clawback = await json('/api/support/chat', {
      method: 'POST',
      body: { messages: [{ role: 'user', content: 'Hoa hồng bị thu hồi thì sao?' }] }
    });
    assert.equal(clawback.res.status, 200);
    assert.equal(clawback.data.source, 'faq');
    assert.match(clawback.data.reply, /thu hồi/);
    assert.match(clawback.data.reply, /số dư có thể âm/);
  });

  await t.test('chặn dò mật khẩu (rate limit dùng SQLite)', async () => {
    let got429 = false;
    for (let i = 0; i < 40; i++) {
      const res = await request('/api/auth/login', {
        method: 'POST',
        body: { username: 'khong-ton-tai@test.local', password: 'sai-mat-khau' }
      });
      if (res.status === 429) {
        got429 = true;
        assert.ok(res.headers.get('retry-after'), 'Phải có header Retry-After');
        break;
      }
      assert.equal(res.status, 401);
    }
    assert.equal(got429, true, 'Phải trả 429 sau khi vượt 30 lượt/phút');
  });
});
