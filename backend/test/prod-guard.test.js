'use strict';

/**
 * Chặn production chạy khi email đăng ký KHÔNG được xác thực.
 *
 * Đăng ký bắt buộc email, nên nếu không xác thực được thì ai cũng có thể dùng
 * email của người khác. Server phải TỪ CHỐI KHỞI ĐỘNG, trừ khi chủ động đặt
 * ALLOW_UNVERIFIED_EMAIL=1.
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

const BACKEND_DIR = path.join(__dirname, '..');
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gzafl-prod-'));
const ENV_FILE = path.join(TMP_DIR, 'test.env');
const DB_PATH = path.join(TMP_DIR, 'test.sqlite');
const UPLOAD_DIR = path.join(TMP_DIR, 'uploads');

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

after(() => {
  fs.rmSync(TMP_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function productionEnv(port) {
  const env = {
    ...process.env,
    GZAFL_ENV_FILE: ENV_FILE,
    PORT: String(port),
    NODE_ENV: 'production',
    JWT_SECRET: 'prod-guard-secret-' + 'x'.repeat(40),
    DB_PATH,
    UPLOAD_DIR,
    EMAIL_OTP: 'off',
    LOGIN_OTP: 'off',
    SMTP_HOST: '',
    SMTP_USER: '',
    SMTP_PASS: '',
    MAIL_FROM: '',
    AI_ENABLED: 'off',
    AI_API_KEY: '',
    AFFILIATE_PROVIDER: 'mock',
    POSTBACK_SECRET: 'test-postback-secret',
    PUBLIC_BASE_URL: 'https://gzafl.test',
    COOKIE_SECURE: 'false',
    SECURITY_STEP_UP: 'off'
  };
  delete env.ALLOW_UNVERIFIED_EMAIL;
  return env;
}

function runServer(env) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: BACKEND_DIR,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });
  return { child, output: () => output };
}

test('production + xác thực email tắt: server từ chối khởi động', async () => {
  fs.writeFileSync(ENV_FILE, '# file env rỗng cho test\n', 'utf8');
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  const port = await freePort();
  const { child, output } = runServer(productionEnv(port));
  const [code] = await Promise.race([once(child, 'exit'), new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Server không thoát sau 20 giây')), 20_000).unref();
  })]);

  assert.equal(code, 1, 'Phải thoát với mã lỗi 1');
  assert.match(output(), /production đang TẮT xác thực email/);
  assert.match(output(), /ALLOW_UNVERIFIED_EMAIL=1/);
});

test('production thiếu PUBLIC_BASE_URL: server từ chối khởi động', async () => {
  fs.writeFileSync(ENV_FILE, '# file env rỗng cho test\n', 'utf8');
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  const port = await freePort();
  const env = productionEnv(port);
  delete env.PUBLIC_BASE_URL;
  const { child, output } = runServer({ ...env, ALLOW_UNVERIFIED_EMAIL: '1' });
  const [code] = await Promise.race([once(child, 'exit'), new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Server không thoát sau 20 giây')), 20_000).unref();
  })]);

  assert.equal(code, 1, 'Phải thoát với mã lỗi 1');
  assert.match(output(), /PUBLIC_BASE_URL/);
});

test('production + ALLOW_UNVERIFIED_EMAIL=1: server vẫn chạy (có cảnh báo)', async () => {
  fs.writeFileSync(ENV_FILE, '# file env rỗng cho test\n', 'utf8');
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  const port = await freePort();
  const { child, output } = runServer({ ...productionEnv(port), ALLOW_UNVERIFIED_EMAIL: '1' });

  try {
    let healthy = false;
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) break;
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/health`);
        if (res.ok) {
          healthy = true;
          break;
        }
      } catch (err) {
        // Chưa lên, thử lại
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(healthy, true, `Server phải chạy được. Log:\n${output()}`);
    assert.match(output(), /ALLOW_UNVERIFIED_EMAIL=1 - production đang chạy mà CHƯA xác thực email/);
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await Promise.race([once(child, 'exit'), new Promise((resolve) => setTimeout(resolve, 3000))]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
  }
});
