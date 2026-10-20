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

  await t.test('chặn link sàn giả, nhận link Shopee hợp lệ', async () => {
    const fakeDomain = await json('/api/orders', {
      method: 'POST',
      cookie: user.cookie,
      body: { link: 'https://shopee.vn.evil.example/x' }
    });
    assert.equal(fakeDomain.res.status, 400);

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
