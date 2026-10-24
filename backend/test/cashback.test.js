'use strict';

/**
 * Tỷ lệ hoàn tiền cho người dùng phải mặc định là 80% (0.8).
 * Một bài test nhỏ để không vô tình quay lại mức 100% khi thiếu biến môi trường.
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gzafl-cashback-'));
process.env.DB_PATH = path.join(TMP_DIR, 'test.sqlite');
process.env.GZAFL_ENV_FILE = path.join(TMP_DIR, 'empty.env');
fs.writeFileSync(process.env.GZAFL_ENV_FILE, '');

const { cashbackRate } = require('../lib/postback');

after(() => {
  try {
    fs.rmSync(TMP_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (err) {
    // Windows đôi khi còn giữ file SQLite một lúc; không làm hỏng kết quả test.
  }
});

test('CASHBACK_RATE mặc định 0.8 và chỉ nhận giá trị từ 0 đến 1', () => {
  const original = process.env.CASHBACK_RATE;

  delete process.env.CASHBACK_RATE;
  assert.equal(cashbackRate(), 0.8, 'Không đặt biến môi trường thì hoàn 80%');

  process.env.CASHBACK_RATE = '0.7';
  assert.equal(cashbackRate(), 0.7);

  process.env.CASHBACK_RATE = '0';
  assert.equal(cashbackRate(), 0, 'Cho phép 0 (nền tảng giữ toàn bộ)');

  process.env.CASHBACK_RATE = '2';
  assert.equal(cashbackRate(), 1, 'Giá trị > 1 bị kẹp về 1');

  process.env.CASHBACK_RATE = 'abc';
  assert.equal(cashbackRate(), 0.8, 'Giá trị không phải số thì dùng mặc định');

  if (original === undefined) delete process.env.CASHBACK_RATE;
  else process.env.CASHBACK_RATE = original;
});
