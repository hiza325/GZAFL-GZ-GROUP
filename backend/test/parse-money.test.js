'use strict';

/**
 * Test đọc số tiền từ postback của mạng affiliate.
 * Module thuần (không đụng database) nên chạy rất nhanh.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseMoney } = require('../lib/parse-money');

test('parseMoney: số nguyên và số thập phân cơ bản', () => {
  assert.equal(parseMoney('225'), 225);
  assert.equal(parseMoney(225), 225);
  assert.equal(parseMoney('225.0'), 225);
  assert.equal(parseMoney('225.50'), 226); // 1-2 chữ số sau dấu -> thập phân
  assert.equal(parseMoney('0'), 0);
  assert.equal(parseMoney(''), 0);
  assert.equal(parseMoney(null), 0);
  assert.equal(parseMoney('không có số'), 0);
});

test('parseMoney: định dạng Việt Nam (dấu "." phân cách hàng nghìn)', () => {
  assert.equal(parseMoney('225.000'), 225_000);
  assert.equal(parseMoney('1.250.000'), 1_250_000);
  assert.equal(parseMoney('12.345.678'), 12_345_678);
  assert.equal(parseMoney('1.250.000,5'), 1_250_001); // dấu "," đứng sau -> thập phân
  assert.equal(parseMoney('1.250.000,50'), 1_250_001);
});

test('parseMoney: định dạng Anh/Mỹ (dấu "," phân cách hàng nghìn)', () => {
  assert.equal(parseMoney('1,250'), 1_250);
  assert.equal(parseMoney('1,250,000'), 1_250_000);
  assert.equal(parseMoney('1,250,000.50'), 1_250_001);
});

test('parseMoney: bỏ ký hiệu tiền tệ và khoảng trắng', () => {
  assert.equal(parseMoney(' 1.250.000 đ '), 1_250_000);
  assert.equal(parseMoney('1.250.000 VND'), 1_250_000);
  assert.equal(parseMoney('₫225,000'), 225_000);
  assert.equal(parseMoney('$1,250.75'), 1_251);
});

test('parseMoney: dấu âm và giá trị lạ không làm sập', () => {
  assert.equal(parseMoney('-225.000'), -225_000);
  assert.equal(parseMoney('-0'), 0);
  assert.equal(parseMoney('1e9'), 19); // chỉ giữ chữ số: "19"
  assert.equal(parseMoney('....'), 0);
  assert.equal(parseMoney(undefined), 0);
});
