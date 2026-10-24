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
    // Test cũ kiểm tra số tiền tuyệt đối -> cố định tỷ lệ 100% cho dễ tính.
    // Mặc định khi không đặt biến này là 0.8 (xem backend/lib/postback.js).
    CASHBACK_RATE: '1',
    RATE_LIMIT_STORE: 'sqlite',
    SECURITY_ALERT_THRESHOLD: '3',
    SECURITY_ALERT_WINDOW_MINUTES: '15',
    SECURITY_AUTO_HOLD_HOURS: '0',
    SECURITY_STEP_UP: 'off',
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
  const token = jwt.sign({ uid, tv: 1, purpose: 'session' }, JWT_SECRET, { expiresIn: '7d' });
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
    // Script nội tuyến phải bị chặn (không còn 'unsafe-inline' trong script-src).
    assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
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
    // Ảnh QR chứa số tài khoản: không được để proxy/CDN cache dùng chung
    assert.match(owner.headers.get('cache-control') || '', /no-store/);

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

  await t.test('phiếu đăng nhập 2FA không dùng được như cookie phiên', async () => {
    const victim = createUser({
      username: 'ticket@test.local',
      email: 'ticket@test.local',
      name: 'Người bị lộ phiếu'
    });

    // Phiếu bước 1 của đăng nhập 2 lớp: cùng JWT_SECRET nhưng purpose khác.
    const ticket = jwt.sign({ uid: victim.uid, tv: 1, purpose: 'login2fa' }, JWT_SECRET, { expiresIn: '5m' });
    const ticketCookie = `gz_token=${ticket}`;

    const me = await json('/api/auth/me', { cookie: ticketCookie });
    assert.equal(me.res.status, 200);
    assert.equal(me.data.user, null, 'phiếu 2FA không được nạp thành phiên đăng nhập');

    const protectedRes = await json('/api/profile', {
      method: 'PUT',
      cookie: ticketCookie,
      body: { name: 'Chiếm tài khoản' }
    });
    assert.equal(protectedRes.res.status, 401);

    // Token không có purpose (định dạng cũ) cũng bị từ chối.
    const legacy = jwt.sign({ uid: victim.uid, tv: 1 }, JWT_SECRET, { expiresIn: '7d' });
    const legacyMe = await json('/api/auth/me', { cookie: `gz_token=${legacy}` });
    assert.equal(legacyMe.data.user, null);
  });

  await t.test('GET /auth/me không bị giới hạn theo IP (không đăng xuất oan)', async () => {
    // Nhiều người dùng chung một IP (WiFi công cộng, văn phòng, CGNAT) từng bị 429
    // và giao diện coi đó là "chưa đăng nhập".
    for (let i = 0; i < 40; i++) {
      const me = await json('/api/auth/me', { cookie: user.cookie });
      assert.equal(me.res.status, 200, `lần gọi thứ ${i + 1} không được trả 429`);
      assert.ok(me.data.user, 'vẫn phải nhận ra phiên đăng nhập');
    }
  });

  await t.test('mật khẩu tạm hết hạn không đăng nhập được', async () => {
    createUser({
      username: 'temp@test.local',
      email: 'temp@test.local',
      name: 'Người dùng mật khẩu tạm'
    });

    const db = new DatabaseSync(DB_PATH);
    db.prepare('UPDATE users SET temp_password_expires_at = ? WHERE username = ?').run(
      new Date(Date.now() - 60_000).toISOString(),
      'temp@test.local'
    );
    db.close();

    const login = await json('/api/auth/login', {
      method: 'POST',
      body: { username: 'temp@test.local', password: PASSWORD }
    });
    assert.equal(login.res.status, 401);
    assert.match(login.data.error, /hết hạn/i);
  });

  await t.test('che cả tên tham số secret tuỳ chỉnh trong nhật ký postback', () => {
    const { redactParams, redactStoredQuery } = require('../lib/redact');
    const previous = process.env.POSTBACK_PARAM_SECRET;
    process.env.POSTBACK_PARAM_SECRET = 'action_id';

    try {
      const masked = redactParams({ action_id: 'chia-khoa-that', reward: '1000' });
      assert.equal(masked.action_id, '[đã ẩn]');
      assert.equal(masked.reward, '1000');

      const stored = redactStoredQuery('{"action_id":"chia-khoa-that","reward":"1000"}');
      assert.match(stored, /\[đã ẩn\]/);
      assert.doesNotMatch(stored, /chia-khoa-that/);
    } finally {
      if (previous === undefined) delete process.env.POSTBACK_PARAM_SECRET;
      else process.env.POSTBACK_PARAM_SECRET = previous;
    }
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

  await t.test('đăng nhập sai chỉ tạo cảnh báo, không tự khóa; admin có thể tạm giữ 24h', async () => {
    const target = createUser({
      username: 'security@test.local',
      email: 'security@test.local',
      name: 'Tài khoản bảo mật'
    });

    // 3 lần sai theo ngưỡng test: vẫn chỉ 401, không bị khóa tài khoản.
    for (let i = 0; i < 3; i++) {
      const bad = await json('/api/auth/login', {
        method: 'POST',
        body: { username: 'security@test.local', password: 'sai-mat-khau' }
      });
      assert.equal(bad.res.status, 401);
    }

    // Mật khẩu đúng vẫn đăng nhập được: hệ thống không tự khóa vĩnh viễn.
    const stillAllowed = await json('/api/auth/login', {
      method: 'POST',
      body: { username: 'security@test.local', password: PASSWORD }
    });
    assert.equal(stillAllowed.res.status, 200);

    // Admin thấy cảnh báo bảo mật, không phải một tài khoản bị khóa.
    const alerts = await json(
      '/api/admin/security-alerts?status=new&q=' + encodeURIComponent('security@test.local'),
      { cookie: admin.cookie }
    );
    assert.equal(alerts.res.status, 200);
    assert.ok(alerts.data.total >= 1);
    const alert = alerts.data.alerts.find((a) => a.username === 'security@test.local');
    assert.ok(alert, 'Phải có cảnh báo cho tài khoản bị đăng nhập sai');
    assert.equal(alert.userId, target.uid);
    assert.ok(alert.eventCount >= 3);
    assert.equal(alert.securityHeld, false);

    // Admin tạm giữ 24 giờ từ cảnh báo.
    const hold = await json(`/api/admin/security-alerts/${alert.id}/hold`, {
      method: 'POST',
      cookie: admin.cookie,
      body: { hours: 24 }
    });
    assert.equal(hold.res.status, 200);
    assert.ok(hold.data.heldUntil);

    // Đăng nhập đúng mật khẩu vẫn bị chặn trong thời gian tạm giữ.
    const heldLogin = await json('/api/auth/login', {
      method: 'POST',
      body: { username: 'security@test.local', password: PASSWORD }
    });
    assert.equal(heldLogin.res.status, 423);
    assert.equal(heldLogin.data.code, 'security_hold');

    // Phiên đã đăng nhập trước đó cũng bị chặn, không chỉ chặn đăng nhập mới.
    const heldSession = await json('/api/wallet', { cookie: target.cookie });
    assert.equal(heldSession.res.status, 423);

    // /auth/me cũng phải trả 423 để frontend không mở dashboard cho tài khoản đang bị giữ.
    const heldMe = await json('/api/auth/me', { cookie: target.cookie });
    assert.equal(heldMe.res.status, 423);
    assert.equal(heldMe.data.code, 'security_hold');
    assert.ok(heldMe.data.heldUntil);

    // Admin bỏ tạm giữ -> đăng nhập lại được.
    const unlock = await json(`/api/admin/users/${target.uid}/security-hold`, {
      method: 'DELETE',
      cookie: admin.cookie
    });
    assert.equal(unlock.res.status, 200);

    const afterUnlock = await json('/api/auth/login', {
      method: 'POST',
      body: { username: 'security@test.local', password: PASSWORD }
    });
    assert.equal(afterUnlock.res.status, 200);
    assert.equal((await json('/api/wallet', { cookie: target.cookie })).res.status, 200);
    const meAfterUnlock = await json('/api/auth/me', { cookie: target.cookie });
    assert.equal(meAfterUnlock.res.status, 200);
    assert.equal(meAfterUnlock.data.user.username, 'security@test.local');

    // Admin đánh dấu cảnh báo đã xử lý.
    const resolved = await json(`/api/admin/security-alerts/${alert.id}/resolve`, {
      method: 'POST',
      cookie: admin.cookie,
      body: { note: 'Đã kiểm tra, không có dấu hiệu chiếm tài khoản.' }
    });
    assert.equal(resolved.res.status, 200);
    assert.equal(resolved.data.alert.status, 'resolved');

    const noNew = await json(
      '/api/admin/security-alerts?status=new&q=' + encodeURIComponent('security@test.local'),
      { cookie: admin.cookie }
    );
    assert.equal(noNew.data.total, 0);

    const audit = await json('/api/admin/audit-logs?limit=20', { cookie: admin.cookie });
    assert.ok(audit.data.logs.some((row) => row.action === 'Tạm giữ tài khoản'));
    assert.ok(audit.data.logs.some((row) => row.action === 'Xử lý cảnh báo bảo mật'));
  });

  await t.test('không xoá người dùng đã có giao dịch tài chính (trừ khi force)', async () => {
    const victim = createUser({
      username: 'delete-me@test.local',
      email: 'delete-me@test.local',
      name: 'Tài khoản cần xoá'
    });

    const db = new DatabaseSync(DB_PATH);
    db.prepare(
      `INSERT INTO orders (user_id, code, link, platform, status, commission, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?)`
    ).run(victim.uid, 'DELTEST01', 'https://shopee.vn/test', 'Shopee', 'Đang xử lý', new Date().toISOString());
    db.close();

    const denied = await json(`/api/admin/users/${victim.uid}`, {
      method: 'DELETE',
      cookie: admin.cookie
    });
    assert.equal(denied.res.status, 409);
    assert.match(denied.data.error, /Không thể xoá/);

    const forced = await json(`/api/admin/users/${victim.uid}?force=1`, {
      method: 'DELETE',
      cookie: admin.cookie
    });
    assert.equal(forced.res.status, 200);
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

  await t.test('postback: nhận chìa khoá qua header (không nằm trong URL)', async () => {
    const good = await json(
      `/api/postback/mock?transaction_id=TX-HEADER-1&sub1=gzafl-u${user.uid}&status=pending&reward=1000`,
      { headers: { 'X-Postback-Secret': POSTBACK_SECRET } }
    );
    assert.equal(good.res.status, 200);
    assert.equal(good.data.ok, true);

    // Header sai thì bị từ chối, kể cả khi URL có chìa khoá đúng:
    // tránh cấu hình nửa vời (tưởng dùng header nhưng thực tế vẫn dựa vào URL).
    const bad = await request(
      `/api/postback/mock?secret=${encodeURIComponent(POSTBACK_SECRET)}&transaction_id=TX-HEADER-BAD`,
      { headers: { 'X-Postback-Secret': 'sai-chia-khoa' } }
    );
    assert.equal(bad.status, 403);
  });

  await t.test('postback: gửi lại cùng payload nhưng đổi thứ tự tham số vẫn là trùng', async () => {
    const dup = createUser({ username: 'dup@test.local', email: 'dup@test.local', name: 'Người gửi trùng' });
    const created = await json('/api/orders', {
      method: 'POST',
      cookie: dup.cookie,
      body: { link: 'https://shopee.vn/p/duplicate-order-test' }
    });
    assert.equal(created.res.status, 201);
    const code = created.data.order.id;
    const tx = 'TX-DUP-' + Date.now();

    const parts = [
      `secret=${encodeURIComponent(POSTBACK_SECRET)}`,
      `transaction_id=${encodeURIComponent(tx)}`,
      `sub1=gzafl-u${dup.uid}`,
      `sub2=${encodeURIComponent(code)}`,
      'status=approved',
      'reward=100000'
    ];

    const first = await json('/api/postback/mock?' + parts.join('&'));
    assert.equal(first.res.status, 200);
    assert.equal(first.data.duplicate, undefined);

    // Cùng dữ liệu, mạng đổi thứ tự tham số (rất hay xảy ra khi họ gửi lại)
    const second = await json('/api/postback/mock?' + [...parts].reverse().join('&'));
    assert.equal(second.res.status, 200);
    assert.equal(second.data.duplicate, true, 'Đổi thứ tự tham số vẫn phải coi là cùng một payload');

    const orders = await json('/api/orders', { cookie: dup.cookie });
    const order = (orders.data.orders || []).find((o) => o.id === code);
    assert.equal(order.networkCommission, 100000, 'Không được cộng dồn thành 200.000');
  });

  await t.test('postback: mạng không gửi product_id thì sửa kết quả vẫn không cộng dồn', async () => {
    const noPid = createUser({ username: 'nopid@test.local', email: 'nopid@test.local', name: 'Thiếu product id' });
    const created = await json('/api/orders', {
      method: 'POST',
      cookie: noPid.cookie,
      body: { link: 'https://shopee.vn/p/no-product-id-test' }
    });
    assert.equal(created.res.status, 201);
    const code = created.data.order.id;

    const base =
      `/api/postback/mock?secret=${encodeURIComponent(POSTBACK_SECRET)}` +
      `&transaction_id=${encodeURIComponent('TX-NOPID-' + Date.now())}` +
      `&sub1=gzafl-u${noPid.uid}&sub2=${encodeURIComponent(code)}`;

    const approved = await json(base + '&status=approved&reward=100000');
    assert.equal(approved.data.status, 'Chờ admin duyệt');

    // Mạng đổi sang từ chối: phải thay thế kết quả cũ, không giữ 100.000
    const rejected = await json(base + '&status=rejected&reward=100000');
    assert.equal(rejected.res.status, 200);
    assert.equal(rejected.data.status, 'Đã huỷ');

    const orders = await json('/api/orders', { cookie: noPid.cookie });
    const order = (orders.data.orders || []).find((o) => o.id === code);
    assert.equal(order.networkCommission, 0);
    assert.equal(order.commission, 0);
  });

  await t.test('postback: đọc đúng số tiền định dạng Việt Nam', async () => {
    const spender = createUser({
      username: 'money@test.local',
      email: 'money@test.local',
      name: 'Người dùng số tiền'
    });

    const created = await json('/api/orders', {
      method: 'POST',
      cookie: spender.cookie,
      body: { link: 'https://shopee.vn/p/money-format-test' }
    });
    assert.equal(created.res.status, 201);
    const code = created.data.order.id;

    const send = (reward) =>
      json(
        `/api/postback/mock?secret=${encodeURIComponent(POSTBACK_SECRET)}` +
          `&transaction_id=${encodeURIComponent('TX-MONEY-' + Date.now() + '-' + reward)}` +
          `&sub1=gzafl-u${spender.uid}&sub2=${encodeURIComponent(code)}` +
          `&status=pending&reward=${encodeURIComponent(reward)}`
      );

    const vn = await send('1.250.000');
    assert.equal(vn.res.status, 200);

    const orders = await json('/api/orders', { cookie: spender.cookie });
    const order = (orders.data.orders || []).find((o) => o.id === code);
    assert.ok(order, 'Phải tìm thấy đơn vừa tạo');
    assert.equal(order.networkCommission, 1250000, '"1.250.000" là 1.250.000 đồng, không phải 1 đồng');
  });

  await t.test('postback: reward âm bị coi là 0, không đẩy hoa hồng xuống âm', async () => {
    const neg = createUser({ username: 'neg@test.local', email: 'neg@test.local', name: 'Số tiền âm' });
    const created = await json('/api/orders', {
      method: 'POST',
      cookie: neg.cookie,
      body: { link: 'https://shopee.vn/p/negative-reward-test' }
    });
    assert.equal(created.res.status, 201);
    const code = created.data.order.id;

    const sent = await json(
      `/api/postback/mock?secret=${encodeURIComponent(POSTBACK_SECRET)}` +
        `&transaction_id=${encodeURIComponent('TX-NEG-' + Date.now())}&product_id=NEG` +
        `&sub1=gzafl-u${neg.uid}&sub2=${encodeURIComponent(code)}` +
        '&status=approved&reward=-50000'
    );
    assert.equal(sent.res.status, 200);

    const orders = await json('/api/orders', { cookie: neg.cookie });
    const order = (orders.data.orders || []).find((o) => o.id === code);
    assert.equal(order.commission, 0);
    assert.ok(order.networkCommission >= 0, 'Hoa hồng mạng không được là số âm');
  });

  await t.test('postback: mã đơn trong payload thắng transaction_id của đơn khác', async () => {
    const owner = createUser({ username: 'priority@test.local', email: 'priority@test.local', name: 'Ưu tiên mã đơn' });
    const orderA = await json('/api/orders', {
      method: 'POST',
      cookie: owner.cookie,
      body: { link: 'https://shopee.vn/p/priority-order-a' }
    });
    const orderB = await json('/api/orders', {
      method: 'POST',
      cookie: owner.cookie,
      body: { link: 'https://shopee.vn/p/priority-order-b' }
    });
    assert.equal(orderA.res.status, 201);
    assert.equal(orderB.res.status, 201);
    const codeA = orderA.data.order.id;
    const codeB = orderB.data.order.id;
    const tx = 'TX-PRIORITY-' + Date.now();

    // Đơn A nhận giao dịch TX
    const first = await json(
      `/api/postback/mock?secret=${encodeURIComponent(POSTBACK_SECRET)}` +
        `&transaction_id=${encodeURIComponent(tx)}&product_id=PRIO` +
        `&sub1=gzafl-u${owner.uid}&sub2=${encodeURIComponent(codeA)}` +
        '&status=approved&reward=100000'
    );
    assert.equal(first.res.status, 200);

    // Postback ghi rõ mã đơn B nhưng lại gửi kèm giao dịch TX đã thuộc đơn A
    const second = await json(
      `/api/postback/mock?secret=${encodeURIComponent(POSTBACK_SECRET)}` +
        `&transaction_id=${encodeURIComponent(tx)}&product_id=PRIO` +
        `&sub1=gzafl-u${owner.uid}&sub2=${encodeURIComponent(codeB)}` +
        '&status=approved&reward=70000'
    );
    assert.equal(second.res.status, 200);

    const orders = await json('/api/orders', { cookie: owner.cookie });
    const a = (orders.data.orders || []).find((o) => o.id === codeA);
    const b = (orders.data.orders || []).find((o) => o.id === codeB);
    assert.equal(a.commission, 100000, 'Đơn A không được bị đổi số bởi postback của đơn B');
    assert.equal(b.commission, 0, 'Đơn B không được nhận giao dịch đã thuộc đơn A');
  });

  await t.test('postback: thiếu mọi mã định danh thì không cộng dồn mỗi lần gọi', async () => {
    const bare = createUser({ username: 'bare@test.local', email: 'bare@test.local', name: 'Không mã định danh' });
    const created = await json('/api/orders', {
      method: 'POST',
      cookie: bare.cookie,
      body: { link: 'https://shopee.vn/p/no-identity-test' }
    });
    assert.equal(created.res.status, 201);
    const code = created.data.order.id;

    const send = (ts) =>
      json(
        `/api/postback/mock?secret=${encodeURIComponent(POSTBACK_SECRET)}` +
          `&ts=${ts}` +
          `&sub1=gzafl-u${bare.uid}&sub2=${encodeURIComponent(code)}` +
          '&status=approved&reward=100000'
      );

    await send('lan-1');
    await send('lan-2');

    const orders = await json('/api/orders', { cookie: bare.cookie });
    const order = (orders.data.orders || []).find((o) => o.id === code);
    assert.equal(order.commission, 100000, 'Hai lần gọi thiếu mã định danh không được cộng thành 200.000');
  });

  await t.test('postback: nhiều lần giảm hoa hồng thì cộng dồn khoản thu hồi', async () => {
    const claw = createUser({ username: 'claw@test.local', email: 'claw@test.local', name: 'Thu hồi nhiều lần' });
    const created = await json('/api/orders', {
      method: 'POST',
      cookie: claw.cookie,
      body: { link: 'https://shopee.vn/p/cumulative-clawback-test' }
    });
    assert.equal(created.res.status, 201);
    const code = created.data.order.id;

    const baseQuery =
      `/api/postback/mock?secret=${encodeURIComponent(POSTBACK_SECRET)}` +
      `&transaction_id=${encodeURIComponent('TX-CLAW-' + Date.now())}&product_id=CLAW` +
      `&sub1=gzafl-u${claw.uid}&sub2=${encodeURIComponent(code)}`;

    const first = await json(baseQuery + '&status=approved&reward=100000');
    assert.equal(first.data.status, 'Chờ admin duyệt');

    const approved = await json('/api/admin/orders/' + encodeURIComponent(code), {
      method: 'PATCH',
      cookie: admin.cookie,
      body: { status: 'Hoàn thành', commission: 100000 }
    });
    assert.equal(approved.res.status, 200);

    // Mạng báo giảm hai lần: 100.000 -> 80.000 -> 60.000. Tổng đã thu hồi phải là 40.000.
    await json(baseQuery + '&status=approved&reward=80000');
    await json(baseQuery + '&status=approved&reward=60000');

    const orders = await json('/api/orders', { cookie: claw.cookie });
    const order = (orders.data.orders || []).find((o) => o.id === code);
    assert.equal(order.commission, 60000);
    assert.equal(order.reversedCommission, 40000, 'Phải cộng dồn cả hai lần thu hồi');
  });

  await t.test('postback: mạng duyệt đơn vào hàng chờ admin, admin duyệt mới cộng ví và thu hồi khi huỷ', async () => {
    const created = await json('/api/orders', {
      method: 'POST',
      cookie: other.cookie,
      body: { link: 'https://tiki.vn/p/approval-test' }
    });
    assert.equal(created.res.status, 201);
    const code = created.data.order.id;
    const tx = 'TX-APPROVAL-' + Date.now();
    const baseQuery =
      `/api/postback/mock?secret=${encodeURIComponent(POSTBACK_SECRET)}` +
      `&transaction_id=${encodeURIComponent(tx)}&product_id=P1` +
      `&sub1=gzafl-u${other.uid}&sub2=${encodeURIComponent(code)}`;

    const pending = await json(baseQuery + '&status=pending&reward=100000');
    assert.equal(pending.res.status, 200);
    assert.equal(pending.data.matched, true);
    assert.equal(pending.data.status, 'Chờ đối soát');

    let wallet = await json('/api/wallet', { cookie: other.cookie });
    assert.equal(wallet.res.status, 200);
    assert.equal(wallet.data.totalCommission, 0);
    assert.equal(wallet.data.balance, 0);

    // Mạng duyệt: đơn chỉ vào hàng chờ admin, chưa cộng tiền vào ví.
    const approved = await json(baseQuery + '&status=approved&reward=100000');
    assert.equal(approved.res.status, 200);
    assert.equal(approved.data.status, 'Chờ admin duyệt');

    wallet = await json('/api/wallet', { cookie: other.cookie });
    assert.equal(wallet.data.totalCommission, 0, 'Chưa admin duyệt thì chưa cộng ví');
    assert.equal(wallet.data.balance, 0);

    const orders = await json('/api/orders', { cookie: other.cookie });
    const pendingOrder = (orders.data.orders || []).find((o) => o.id === code);
    assert.equal(pendingOrder.status, 'Chờ admin duyệt');
    assert.equal(pendingOrder.commissionCredited, false);
    assert.equal(pendingOrder.commission, 100000, 'Số dự kiến để admin duyệt');
    assert.equal(pendingOrder.networkCommission, 100000);

    const tooEarly = await json('/api/wallet/withdrawals', {
      method: 'POST',
      cookie: other.cookie,
      body: { mode: 'account', bank: 'Vietcombank', accNum: '123456789', accName: 'NGUYEN VAN A' }
    });
    assert.equal(tooEarly.res.status, 400, 'Chưa admin duyệt thì không được rút');

    // Admin duyệt đơn -> lúc này mới cộng hoa hồng vào ví.
    const adminApproved = await json('/api/admin/orders/' + encodeURIComponent(code), {
      method: 'PATCH',
      cookie: admin.cookie,
      body: { status: 'Hoàn thành', commission: 100000 }
    });
    assert.equal(adminApproved.res.status, 200);
    assert.equal(adminApproved.data.order.status, 'Hoàn thành');
    assert.equal(adminApproved.data.order.commissionCredited, true);

    wallet = await json('/api/wallet', { cookie: other.cookie });
    assert.equal(wallet.data.totalCommission, 100000);
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
    assert.equal(adminUser.commission, 100000);
    assert.equal(adminUser.pendingApproval, 0);
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
    assert.equal(clawedOrder.commissionCredited, false);
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

  await t.test('ví: huỷ lệnh rút đang chờ, chặn sửa lệnh đã chi, số liệu dashboard là thật', async () => {
    const wdUser = createUser({
      username: 'withdraw@test.local',
      email: 'withdraw@test.local',
      name: 'Người rút tiền'
    });

    // Tạo sẵn 1 đơn đã được duyệt để có số dư, không phụ thuộc luồng postback
    const db = new DatabaseSync(DB_PATH);
    db.prepare(
      `INSERT INTO orders (user_id, code, link, platform, status, commission, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      wdUser.uid,
      'WD-BASE-' + Date.now(),
      'https://shopee.vn/product/1',
      'Shopee',
      'Hoàn thành',
      200000,
      new Date().toISOString()
    );
    db.close();

    // Dashboard không còn số giả: mọi con số lấy từ đơn thật của chính người dùng
    const before = await json('/api/wallet', { cookie: wdUser.cookie });
    assert.equal(before.res.status, 200);
    assert.ok(before.data.insights, 'Phải có insights cho dashboard');
    assert.equal(before.data.insights.monthly.length, 6);
    assert.equal(before.data.insights.month.commission, 200000);
    const shopee = (before.data.insights.byPlatform || []).find((p) => p.platform === 'Shopee');
    assert.ok(shopee);
    assert.equal(shopee.commission, 200000);
    assert.equal(shopee.orders, 1);

    const created = await json('/api/wallet/withdrawals', {
      method: 'POST',
      cookie: wdUser.cookie,
      body: { bank: 'Vietcombank', accNum: '0123456789', accName: 'NGUYEN VAN A' }
    });
    assert.equal(created.res.status, 201);
    const code = created.data.withdrawal.id;
    assert.equal(created.data.balance, 0);

    // Tự huỷ được, tiền về lại số dư ngay
    const cancelled = await json('/api/wallet/withdrawals/' + encodeURIComponent(code), {
      method: 'DELETE',
      cookie: wdUser.cookie
    });
    assert.equal(cancelled.res.status, 200);
    assert.equal(cancelled.data.withdrawal.status, 'Đã huỷ');
    assert.equal(cancelled.data.balance, 200000);

    // Huỷ lần hai phải bị chặn
    const again = await json('/api/wallet/withdrawals/' + encodeURIComponent(code), {
      method: 'DELETE',
      cookie: wdUser.cookie
    });
    assert.equal(again.res.status, 409);

    // Người khác không huỷ được lệnh của mình (coi như không tồn tại)
    const otherTry = await json('/api/wallet/withdrawals/' + encodeURIComponent(code), {
      method: 'DELETE',
      cookie: other.cookie
    });
    assert.equal(otherTry.res.status, 404);

    // Admin cũng không được sửa lệnh đã huỷ
    const editCancelled = await json('/api/admin/withdrawals/' + encodeURIComponent(code), {
      method: 'PATCH',
      cookie: admin.cookie,
      body: { status: 'Đang xử lý' }
    });
    assert.equal(editCancelled.res.status, 409);

    // Lệnh mới -> admin chi trả -> lịch sử chi trả bị khoá
    const second = await json('/api/wallet/withdrawals', {
      method: 'POST',
      cookie: wdUser.cookie,
      body: { bank: 'Vietcombank', accNum: '0123456789', accName: 'NGUYEN VAN A' }
    });
    assert.equal(second.res.status, 201);
    const code2 = second.data.withdrawal.id;

    const paid = await json('/api/admin/withdrawals/' + encodeURIComponent(code2), {
      method: 'PATCH',
      cookie: admin.cookie,
      body: { status: 'Đã thanh toán' }
    });
    assert.equal(paid.res.status, 200);
    assert.equal(paid.data.withdrawal.status, 'Đã thanh toán');

    const editPaid = await json('/api/admin/withdrawals/' + encodeURIComponent(code2), {
      method: 'PATCH',
      cookie: admin.cookie,
      body: { amount: 1000 }
    });
    assert.equal(editPaid.res.status, 409);
  });

  await t.test('rút theo từng đơn: chọn đơn, chống rút trùng, huỷ trả lại đơn, rút toàn bộ vẫn gồm điểm', async () => {
    const pickUser = createUser({
      username: 'pick@test.local',
      email: 'pick@test.local',
      name: 'Người rút theo đơn'
    });
    const stamp = Date.now();
    const codeA = 'PICK-A-' + stamp;
    const codeB = 'PICK-B-' + stamp;
    const otherCode = 'PICK-OTHER-' + stamp;

    const db = new DatabaseSync(DB_PATH);
    const insertOrder = db.prepare(
      `INSERT INTO orders (user_id, code, link, platform, status, commission, created_at)
       VALUES (?, ?, ?, ?, 'Hoàn thành', ?, ?)`
    );
    insertOrder.run(pickUser.uid, codeA, 'https://shopee.vn/a', 'Shopee', 100000, new Date(stamp - 2000).toISOString());
    insertOrder.run(pickUser.uid, codeB, 'https://tiki.vn/b', 'Tiki', 50000, new Date(stamp - 1000).toISOString());
    insertOrder.run(other.uid, otherCode, 'https://lazada.vn/c', 'Lazada', 70000, new Date().toISOString());
    db.prepare('UPDATE users SET points = 100 WHERE id = ?').run(pickUser.uid);
    db.close();

    // 100 điểm -> 1.000đ vào ví, để kiểm tra "rút toàn bộ" gồm cả tiền điểm
    const converted = await json('/api/referral/convert', {
      method: 'POST',
      cookie: pickUser.cookie,
      body: { points: 100 }
    });
    assert.equal(converted.res.status, 200);
    assert.equal(converted.data.amount, 1000);

    let wallet = await json('/api/wallet', { cookie: pickUser.cookie });
    assert.equal(wallet.res.status, 200);
    assert.equal(wallet.data.balance, 151000);
    assert.equal(wallet.data.withdrawableOrders.length, 2);
    assert.deepEqual(
      wallet.data.withdrawableOrders.map((order) => order.code),
      [codeA, codeB],
      'Đơn cũ phải đứng trước'
    );
    assert.deepEqual(
      wallet.data.withdrawableOrders.map((order) => order.withdrawable),
      [100000, 50000]
    );

    const body = { mode: 'account', bank: 'Vietcombank', accNum: '0123456789', accName: 'NGUYEN VAN A' };

    // Chọn riêng đơn A
    const onlyA = await json('/api/wallet/withdrawals', {
      method: 'POST',
      cookie: pickUser.cookie,
      body: { ...body, source: 'orders', orderCodes: [codeA] }
    });
    assert.equal(onlyA.res.status, 201);
    assert.equal(onlyA.data.withdrawal.amount, 100000);
    assert.equal(onlyA.data.withdrawal.orderCount, 1);
    assert.deepEqual(onlyA.data.withdrawal.orderCodes, [codeA]);
    assert.equal(onlyA.data.balance, 51000);

    wallet = await json('/api/wallet', { cookie: pickUser.cookie });
    assert.deepEqual(
      wallet.data.withdrawableOrders.map((order) => order.code),
      [codeB],
      'Đơn A đang chờ rút thì không được chọn lại'
    );
    assert.equal(wallet.data.pendingWithdrawal.code, onlyA.data.withdrawal.id);
    assert.equal(wallet.data.pendingWithdrawal.amount, 100000);
    assert.equal(wallet.data.canWithdraw, false, 'Có lệnh chờ thì không được rút tiếp');

    // Huỷ -> đơn A mở lại
    const cancelA = await json('/api/wallet/withdrawals/' + encodeURIComponent(onlyA.data.withdrawal.id), {
      method: 'DELETE',
      cookie: pickUser.cookie
    });
    assert.equal(cancelA.res.status, 200);
    assert.equal(cancelA.data.balance, 151000);

    wallet = await json('/api/wallet', { cookie: pickUser.cookie });
    assert.equal(wallet.data.withdrawableOrders.length, 2);
    assert.equal(wallet.data.pendingWithdrawal, null);
    assert.equal(wallet.data.canWithdraw, true);

    // Không được chọn đơn của người khác
    const stranger = await json('/api/wallet/withdrawals', {
      method: 'POST',
      cookie: pickUser.cookie,
      body: { ...body, source: 'orders', orderCodes: [otherCode] }
    });
    assert.equal(stranger.res.status, 400);

    // Không được gửi danh sách rỗng
    const empty = await json('/api/wallet/withdrawals', {
      method: 'POST',
      cookie: pickUser.cookie,
      body: { ...body, source: 'orders', orderCodes: [] }
    });
    assert.equal(empty.res.status, 400);

    // Chọn cả A + B -> đúng 150.000đ, còn lại 1.000đ tiền điểm
    const both = await json('/api/wallet/withdrawals', {
      method: 'POST',
      cookie: pickUser.cookie,
      body: { ...body, source: 'orders', orderCodes: [codeA, codeB] }
    });
    assert.equal(both.res.status, 201);
    assert.equal(both.data.withdrawal.amount, 150000);
    assert.equal(both.data.withdrawal.orderCount, 2);
    assert.deepEqual(both.data.withdrawal.orderCodes.sort(), [codeA, codeB].sort());
    assert.equal(both.data.balance, 1000);

    wallet = await json('/api/wallet', { cookie: pickUser.cookie });
    assert.equal(wallet.data.withdrawableOrders.length, 0, 'Cả 2 đơn đã được rút');

    // Admin sửa số tiền thực trả: phần phân bổ theo đơn phải co giãn theo
    const reduced = await json('/api/admin/withdrawals/' + encodeURIComponent(both.data.withdrawal.id), {
      method: 'PATCH',
      cookie: admin.cookie,
      body: { amount: 120000 }
    });
    assert.equal(reduced.res.status, 200);

    wallet = await json('/api/wallet', { cookie: pickUser.cookie });
    assert.equal(wallet.data.balance, 31000);
    assert.deepEqual(
      wallet.data.withdrawableOrders.map((order) => [order.code, order.withdrawable]),
      [[codeB, 30000]],
      'Giảm tiền rút phải mở lại phần hoa hồng chênh lệch'
    );

    const increased = await json('/api/admin/withdrawals/' + encodeURIComponent(both.data.withdrawal.id), {
      method: 'PATCH',
      cookie: admin.cookie,
      body: { amount: 150000 }
    });
    assert.equal(increased.res.status, 200);

    wallet = await json('/api/wallet', { cookie: pickUser.cookie });
    assert.equal(wallet.data.balance, 1000);
    assert.equal(wallet.data.withdrawableOrders.length, 0);

    // Admin thấy lệnh rút gắn với đúng 2 đơn
    let adminWithdrawals = await json('/api/admin/withdrawals', { cookie: admin.cookie });
    let adminWd = (adminWithdrawals.data.withdrawals || []).find(
      (row) => row.id === both.data.withdrawal.id
    );
    assert.ok(adminWd);
    assert.equal(adminWd.orderCount, 2);
    assert.deepEqual(adminWd.orderCodes.sort(), [codeA, codeB].sort());

    // Admin chi trả, sau đó người dùng rút nốt 1.000đ tiền điểm bằng "rút toàn bộ"
    const paid = await json('/api/admin/withdrawals/' + encodeURIComponent(both.data.withdrawal.id), {
      method: 'PATCH',
      cookie: admin.cookie,
      body: { status: 'Đã thanh toán', amount: 150000 }
    });
    assert.equal(paid.res.status, 200);

    const pointsOnly = await json('/api/wallet/withdrawals', {
      method: 'POST',
      cookie: pickUser.cookie,
      body: { ...body, source: 'all' }
    });
    assert.equal(pointsOnly.res.status, 201);
    assert.equal(pointsOnly.data.withdrawal.amount, 1000);
    assert.equal(pointsOnly.data.withdrawal.orderCount, 0);
    assert.equal(pointsOnly.data.balance, 0);

    adminWithdrawals = await json('/api/admin/withdrawals', { cookie: admin.cookie });
    adminWd = (adminWithdrawals.data.withdrawals || []).find(
      (row) => row.id === pointsOnly.data.withdrawal.id
    );
    assert.ok(adminWd);
    assert.equal(adminWd.pointsValue, 1000);
    assert.equal(adminWd.payable, 1000);
  });

  await t.test('đơn còn hoa hồng không vượt quá số dư khi khách đang nợ', async () => {
    const debtUser = createUser({
      username: 'debt@test.local',
      email: 'debt@test.local',
      name: 'Người đang nợ'
    });
    const stamp = Date.now();
    const oldCode = 'DEBT-OLD-' + stamp;
    const newCode = 'DEBT-NEW-' + stamp;
    const biggerCode = 'DEBT-BIG-' + stamp;

    const db = new DatabaseSync(DB_PATH);
    // Đơn cũ từng được rút nhưng sau đó bị huỷ -> khoản đã chi thành nợ
    db.prepare(
      `INSERT INTO orders (user_id, code, link, platform, status, commission, created_at)
       VALUES (?, ?, 'https://shopee.vn/old', 'Shopee', 'Đã huỷ', 0, ?)`
    ).run(debtUser.uid, oldCode, new Date(stamp - 4000).toISOString());
    db.prepare(
      `INSERT INTO withdrawals (user_id, code, bank, acc_num, acc_name, amount, status, items_allocated, created_at)
       VALUES (?, ?, 'Vietcombank', '0123456789', 'NGUYEN VAN A', 100000, 'Đã thanh toán', 1, ?)`
    ).run(debtUser.uid, 'DEBT-WD-' + stamp, new Date(stamp - 3000).toISOString());
    db.prepare(
      `INSERT INTO orders (user_id, code, link, platform, status, commission, created_at)
       VALUES (?, ?, 'https://tiki.vn/new', 'Tiki', 'Hoàn thành', 50000, ?)`
    ).run(debtUser.uid, newCode, new Date(stamp - 2000).toISOString());
    db.close();

    let wallet = await json('/api/wallet', { cookie: debtUser.cookie });
    assert.equal(wallet.res.status, 200);
    assert.equal(wallet.data.balance, -50000);
    assert.equal(wallet.data.debt, 50000);
    assert.equal(wallet.data.withdrawableOrders.length, 0, 'Đang nợ thì chưa được chọn đơn');

    // Thêm đơn 100.000đ: trả hết nợ 50.000đ, chỉ còn 50.000đ chọn được
    const db2 = new DatabaseSync(DB_PATH);
    db2.prepare(
      `INSERT INTO orders (user_id, code, link, platform, status, commission, created_at)
       VALUES (?, ?, 'https://lazada.vn/big', 'Lazada', 'Hoàn thành', 100000, ?)`
    ).run(debtUser.uid, biggerCode, new Date(stamp - 1000).toISOString());
    db2.close();

    wallet = await json('/api/wallet', { cookie: debtUser.cookie });
    assert.equal(wallet.data.balance, 50000);
    assert.equal(
      wallet.data.withdrawableOrders.reduce((sum, order) => sum + order.withdrawable, 0),
      50000,
      'Tổng chọn được phải bằng số dư, không phải toàn bộ hoa hồng'
    );
  });

  await t.test('điểm giới thiệu: 100 điểm = 1.000đ, đổi vào ví và chặn dữ liệu sai', async () => {
    const ptUser = createUser({
      username: 'points@test.local',
      email: 'points@test.local',
      name: 'Người đổi điểm'
    });

    const db = new DatabaseSync(DB_PATH);
    db.prepare('UPDATE users SET points = 250 WHERE id = ?').run(ptUser.uid);
    db.close();

    let referral = await json('/api/referral', { cookie: ptUser.cookie });
    assert.equal(referral.res.status, 200);
    assert.equal(referral.data.points, 250);
    assert.equal(referral.data.pointValue, 10, '1 điểm = 10đ');
    assert.equal(referral.data.minRedeemPoints, 100);
    assert.equal(referral.data.redeemStep, 100);
    assert.equal(referral.data.pointsInMoney, 2500);

    const tooFew = await json('/api/referral/convert', {
      method: 'POST',
      cookie: ptUser.cookie,
      body: { points: 50 }
    });
    assert.equal(tooFew.res.status, 400, 'Tối thiểu 100 điểm');

    const notMultiple = await json('/api/referral/convert', {
      method: 'POST',
      cookie: ptUser.cookie,
      body: { points: 150 }
    });
    assert.equal(notMultiple.res.status, 400, 'Phải là bội số của 100');

    const tooMany = await json('/api/referral/convert', {
      method: 'POST',
      cookie: ptUser.cookie,
      body: { points: 300 }
    });
    assert.equal(tooMany.res.status, 400, 'Không được đổi quá số điểm đang có');

    // Đổi 200 điểm -> 2.000đ vào ví, còn lại 50 điểm
    const converted = await json('/api/referral/convert', {
      method: 'POST',
      cookie: ptUser.cookie,
      body: { points: 200 }
    });
    assert.equal(converted.res.status, 200);
    assert.equal(converted.data.points, 50);
    assert.equal(converted.data.amount, 2000);
    assert.equal(converted.data.balance, 2000);

    referral = await json('/api/referral', { cookie: ptUser.cookie });
    assert.equal(referral.data.points, 50);
    assert.equal(referral.data.redemptions.length, 1);
    assert.equal(referral.data.redemptions[0].points, 200);
    assert.equal(referral.data.redemptions[0].amount, 2000);

    const wallet = await json('/api/wallet', { cookie: ptUser.cookie });
    assert.equal(wallet.res.status, 200);
    assert.equal(wallet.data.totalCommission, 0);
    assert.equal(wallet.data.pointsValue, 2000);
    assert.equal(wallet.data.balance, 2000);

    // Tiền từ điểm cũng rút được như hoa hồng
    const withdrawal = await json('/api/wallet/withdrawals', {
      method: 'POST',
      cookie: ptUser.cookie,
      body: { bank: 'Vietcombank', accNum: '0123456789', accName: 'NGUYEN VAN A' }
    });
    assert.equal(withdrawal.res.status, 201);
    assert.equal(withdrawal.data.balance, 0);

    // Trang quản trị phải thấy khoản này là tiền phải trả, không phải 0
    const adminWithdrawals = await json('/api/admin/withdrawals', { cookie: admin.cookie });
    const adminWd = (adminWithdrawals.data.withdrawals || []).find(
      (w) => w.id === withdrawal.data.withdrawal.id
    );
    assert.ok(adminWd);
    assert.equal(adminWd.pointsValue, 2000);
    assert.equal(adminWd.payable, 2000);
  });

  await t.test('điểm giới thiệu chỉ cộng sau khi người nhập mã có đơn hàng', async () => {
    const inviter = createUser({
      username: 'ref-inviter@test.local',
      email: 'ref-inviter@test.local',
      name: 'Người mời'
    });
    const invited = createUser({
      username: 'ref-invited@test.local',
      email: 'ref-invited@test.local',
      name: 'Người được mời'
    });

    const inviterInfo = await json('/api/referral', { cookie: inviter.cookie });
    assert.equal(inviterInfo.res.status, 200);
    const code = inviterInfo.data.code;
    assert.ok(code);

    // Nhập mã khi chưa có đơn: ghi nhận nhưng chưa cộng điểm.
    let redeemed = await json('/api/referral/redeem', {
      method: 'POST',
      cookie: invited.cookie,
      body: { code }
    });
    assert.equal(redeemed.res.status, 200);
    assert.equal(redeemed.data.pending, true);
    assert.equal(redeemed.data.points, 0);
    assert.match(redeemed.data.message, /thành công/i);
    assert.match(redeemed.data.message, /đơn hàng đầu tiên/i);

    let referral = await json('/api/referral', { cookie: invited.cookie });
    assert.equal(referral.data.points, 0);
    assert.equal(referral.data.redeemedCount, 1);
    assert.equal(referral.data.creditedCount, 0);
    assert.equal(referral.data.pendingCount, 1);
    assert.equal(referral.data.history[0].pending, true);
    assert.equal(referral.data.history[0].points, 0);

    // Chưa đủ điều kiện thì không được nhập thêm mã khác.
    const duplicate = await json('/api/referral/redeem', {
      method: 'POST',
      cookie: invited.cookie,
      body: { code }
    });
    assert.equal(duplicate.res.status, 409);

    // Tạo đơn đầu tiên -> cộng 100 điểm.
    const firstOrder = await json('/api/orders', {
      method: 'POST',
      cookie: invited.cookie,
      body: { link: 'https://shopee.vn/p/referral-reward-test' }
    });
    assert.equal(firstOrder.res.status, 201);

    referral = await json('/api/referral', { cookie: invited.cookie });
    assert.equal(referral.data.points, 100);
    assert.equal(referral.data.creditedCount, 1);
    assert.equal(referral.data.pendingCount, 0);
    assert.equal(referral.data.history[0].pending, false);
    assert.equal(referral.data.history[0].points, 100);
    assert.ok(referral.data.history[0].rewardedAt);
    assert.match(referral.data.history[0].rewardedDate, /\d/);

    // Đơn thứ hai không cộng thêm điểm.
    const secondOrder = await json('/api/orders', {
      method: 'POST',
      cookie: invited.cookie,
      body: { link: 'https://tiki.vn/p/referral-reward-test-2' }
    });
    assert.equal(secondOrder.res.status, 201);
    referral = await json('/api/referral', { cookie: invited.cookie });
    assert.equal(referral.data.points, 100, 'Mỗi lượt nhập mã chỉ cộng điểm một lần');

    // Người mời không nhận điểm; điểm thuộc về người nhập mã.
    const inviterAfter = await json('/api/referral', { cookie: inviter.cookie });
    assert.equal(inviterAfter.data.points, 0);

    // Đã có đơn trước khi nhập mã -> cộng điểm ngay.
    const existing = createUser({
      username: 'ref-existing@test.local',
      email: 'ref-existing@test.local',
      name: 'Người đã có đơn'
    });
    const existingOrder = await json('/api/orders', {
      method: 'POST',
      cookie: existing.cookie,
      body: { link: 'https://lazada.vn/p/referral-existing-order' }
    });
    assert.equal(existingOrder.res.status, 201);

    redeemed = await json('/api/referral/redeem', {
      method: 'POST',
      cookie: existing.cookie,
      body: { code }
    });
    assert.equal(redeemed.res.status, 200);
    assert.equal(redeemed.data.pending, false);
    assert.equal(redeemed.data.points, 100);
    assert.equal(redeemed.data.history[0].pending, false);

    // Đơn đã huỷ không đủ điều kiện kích hoạt điểm.
    const cancelled = createUser({
      username: 'ref-cancelled@test.local',
      email: 'ref-cancelled@test.local',
      name: 'Người có đơn huỷ'
    });
    const cancelledOrder = await json('/api/orders', {
      method: 'POST',
      cookie: cancelled.cookie,
      body: { link: 'https://shopee.vn/p/referral-cancelled-order' }
    });
    assert.equal(cancelledOrder.res.status, 201);

    const db = new DatabaseSync(DB_PATH);
    db.prepare("UPDATE orders SET status = 'Đã huỷ' WHERE user_id = ?").run(cancelled.uid);
    db.close();

    redeemed = await json('/api/referral/redeem', {
      method: 'POST',
      cookie: cancelled.cookie,
      body: { code }
    });
    assert.equal(redeemed.res.status, 200);
    assert.equal(redeemed.data.pending, true);
    assert.equal(redeemed.data.points, 0);

    const adminReferrals = await json('/api/admin/referrals', { cookie: admin.cookie });
    const pendingRow = (adminReferrals.data.referrals || []).find(
      (row) => row.user.username === 'ref-cancelled@test.local'
    );
    assert.ok(pendingRow);
    assert.equal(pendingRow.pending, true);
    assert.equal(pendingRow.points, 0);
  });

  await t.test('SEO: robots.txt, sitemap.xml và thẻ chia sẻ có URL tuyệt đối', async () => {
    const robots = await request('/robots.txt');
    assert.equal(robots.status, 200);
    assert.match(await robots.text(), /Sitemap: http:\/\/localhost:\d+\/sitemap\.xml/);

    const sitemap = await request('/sitemap.xml');
    assert.equal(sitemap.status, 200);
    assert.match(await sitemap.text(), /<urlset/);

    const home = await request('/');
    assert.equal(home.status, 200);
    const html = await home.text();
    assert.match(html, /property="og:title"/);
    assert.doesNotMatch(html, /__PUBLIC_BASE_URL__/, 'Placeholder phải được thay bằng URL thật');
  });

  await t.test('chatbot FAQ biết đơn chờ admin duyệt và thu hồi hoa hồng', async () => {
    const approval = await json('/api/support/chat', {
      method: 'POST',
      body: { messages: [{ role: 'user', content: 'Khi nào hoa hồng vào ví?' }] }
    });
    assert.equal(approval.res.status, 200);
    assert.equal(approval.data.source, 'faq');
    assert.match(approval.data.reply, /Chờ admin duyệt/);
    assert.match(approval.data.reply, /Quản trị viên/);

    const clawback = await json('/api/support/chat', {
      method: 'POST',
      body: { messages: [{ role: 'user', content: 'Hoa hồng bị thu hồi thì sao?' }] }
    });
    assert.equal(clawback.res.status, 200);
    assert.equal(clawback.data.source, 'faq');
    assert.match(clawback.data.reply, /thu hồi/);
    assert.match(clawback.data.reply, /số dư có thể âm/);
  });

  await t.test('chatbot FAQ chọn đúng chủ đề khi câu hỏi chồng từ khoá', async () => {
    // "rút tiền" + "QR": phải trả lời về ảnh QR, không phải mức rút tối thiểu
    const qr = await json('/api/support/chat', {
      method: 'POST',
      body: { messages: [{ role: 'user', content: 'Rút tiền bằng ảnh QR thế nào?' }] }
    });
    assert.equal(qr.res.status, 200);
    assert.match(qr.data.reply, /Ảnh QR/);
    assert.doesNotMatch(qr.data.reply, /Mức rút tối thiểu/);

    // Lệnh rút bị huỷ: phải nói về tiền được trả lại, không phải hướng dẫn rút chung
    const cancelled = await json('/api/support/chat', {
      method: 'POST',
      body: { messages: [{ role: 'user', content: 'Lệnh rút của tôi bị huỷ' }] }
    });
    assert.equal(cancelled.res.status, 200);
    assert.match(cancelled.data.reply, /trả lại vào số dư/);

    // "âm số dư" (đảo thứ tự chữ so với từ khoá "số dư âm") vẫn phải khớp chủ đề thu hồi
    const negative = await json('/api/support/chat', {
      method: 'POST',
      body: { messages: [{ role: 'user', content: 'Tôi bị âm số dư thì phải làm sao?' }] }
    });
    assert.equal(negative.res.status, 200);
    assert.match(negative.data.reply, /thu hồi/);

    // Câu ngoài phạm vi vẫn rơi về câu trả lời mặc định
    const outside = await json('/api/support/chat', {
      method: 'POST',
      body: { messages: [{ role: 'user', content: 'Giá vàng hôm nay bao nhiêu?' }] }
    });
    assert.equal(outside.res.status, 200);
    assert.match(outside.data.reply, /chưa chắc chắn/);
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
