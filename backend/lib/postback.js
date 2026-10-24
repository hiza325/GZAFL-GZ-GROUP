'use strict';

/**
 * Nhận báo cáo chuyển đổi (postback) từ mạng affiliate và cập nhật đơn hàng.
 *
 * Thiết kế + lộ trình: docs/affiliate-integration.md (mục 3.6)
 *
 * Nguyên tắc bắt buộc:
 *  1. Xác thực `POSTBACK_SECRET` trước khi làm bất cứ việc gì (so sánh bằng timingSafeEqual).
 *  2. Ghi tham số nhận được vào `postback_logs` TRƯỚC khi xử lý — có log mới đối soát được.
 *     Chìa khoá (POSTBACK_SECRET) và các tham số nhạy cảm được CHE trước khi lưu (lib/redact.js).
 *  3. Chống trùng: mạng gửi lại y hệt thì chỉ tăng `dup_count`, không cộng tiền lần hai.
 *  4. Trạng thái đơn: pending -> "Chờ đối soát" (chưa vào số dư),
 *     approved -> "Chờ admin duyệt" (chưa vào số dư), rejected -> "Đã huỷ".
 *     Quản trị viên duyệt đơn thì hoa hồng mới được cộng vào ví.
 *  5. Luôn trả 200 nhanh cho mạng, tránh họ gửi lại liên tục.
 *
 * AccessTrade:
 *  - Họ gửi GET, và MỖI SẢN PHẨM trong đơn là MỘT lần gọi riêng.
 *  - Tên tham số do NGƯỜI DÙNG tự đặt trong dashboard (Account Settings -> Properties ->
 *    Postback), nên không thể hard-code một tên duy nhất: ta dò lần lượt các tên thường
 *    dùng, và có thể ép bằng `POSTBACK_PARAM_<TÊN>` trong .env.
 *  - Tài liệu: https://support.accesstrade.global/system-integration/what-is-postback-and-how-to-use.html
 */

const crypto = require('node:crypto');
const db = require('../db');
const { CANCELLED, AWAITING_RECONCILE, PENDING_APPROVAL } = require('./constants');
const { redactParams } = require('./redact');
const { isCredited } = require('./money');
const { parseMoney } = require('./parse-money');

const PROVIDER = String(process.env.AFFILIATE_PROVIDER || 'mock').toLowerCase();

// Chiều dài tối đa của phần tham số thô lưu vào log (tránh nhét cả MB vào database)
const RAW_MAX = 2000;

/**
 * Tên tham số hay dùng cho từng loại dữ liệu.
 * Thứ tự quan trọng: tên nào đứng trước thì được ưu tiên khi có nhiều tham số cùng loại.
 */
const CANDIDATES = {
  transaction: ['transaction_id', 'transactionid', 'transaction', 'order_id', 'orderid', 'transaction_code'],
  product: ['product_id', 'productid', 'item_id', 'itemid', 'product'],
  conversion: ['conversion_id', 'conversionid', 'conversion'],
  reward: ['reward', 'commission', 'publisher_reward', 'commission_amount', 'amount'],
  status: ['status', 'conversion_status', 'transaction_status', 'is_confirmed', 'confirmed'],
  sub: ['sub1', 'sub2', 'sub3', 'sub4', 'sub_id', 'subid', 'sub', 'utm_content', 'custom', 'pbid'],
  secret: ['secret', 'key', 'token', 'signature', 'sign', 'secure', 'hash']
};

/* ==========================================
   Đọc tham số
========================================== */

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

/** Tên tham số cho một loại dữ liệu: ưu tiên cấu hình trong .env, rồi tới danh sách mặc định. */
function paramNames(field) {
  const custom = process.env['POSTBACK_PARAM_' + field.toUpperCase()];
  const list = CANDIDATES[field] || [];
  return hasValue(custom) ? [String(custom).trim(), ...list] : list;
}

/** Lấy giá trị đầu tiên không rỗng trong danh sách tên tham số. */
function pick(params, field) {
  for (const name of paramNames(field)) {
    const value = params[name];
    if (hasValue(value)) return String(value).trim();
  }
  return '';
}

/** Toàn bộ giá trị tham số (đã làm phẳng mảng) — dùng để dò mã đơn / mã người dùng. */
function allValues(params) {
  const out = [];
  for (const value of Object.values(params || {})) {
    if (Array.isArray(value)) out.push(...value.map((v) => String(v)));
    else if (hasValue(value)) out.push(String(value));
  }
  return out;
}

/** Chuẩn hoá trạng thái của mạng về 3 giá trị dùng trong hệ thống. */
function normalizeStatus(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (['1', 'approved', 'approve', 'success', 'confirmed', 'complete', 'completed'].includes(s)) {
    return 'approved';
  }
  if (['2', 'rejected', 'reject', 'cancel', 'cancelled', 'canceled', 'invalid', 'fraud'].includes(s)) {
    return 'rejected';
  }
  if (['0', 'pending', 'hold', 'unapproved', 'waiting'].includes(s)) return 'pending';
  // Không có tham số trạng thái (postback chỉ báo "có chuyển đổi") -> coi là chờ duyệt.
  // Đây là lựa chọn AN TOÀN: chưa duyệt thì chưa cộng tiền cho người dùng.
  return 'pending';
}

/**
 * Đổi số tiền do mạng gửi sang số nguyên đồng.
 * Chi tiết quy tắc đọc dấu "." / ",": xem lib/parse-money.js
 */

/** Mã đơn nội bộ luôn có dạng GZ + 6 chữ số (xem generateOrderCode). */
const ORDER_CODE_RE = /^GZ\d{6}$/i;

/**
 * Tìm mã đơn nội bộ trong tham số.
 *
 * Chỉ nhận đúng định dạng mã đơn của hệ thống, không đem mọi giá trị (kể cả
 * `secret`, token) đi truy vấn database. Nếu tên tham số chứa mã đơn khác
 * thường, khai báo bằng `POSTBACK_PARAM_ORDER_CODE` trong .env.
 */
function findOrderCode(params) {
  const declared = process.env.POSTBACK_PARAM_ORDER_CODE;
  if (hasValue(declared)) {
    const value = String(params[declared.trim()] || '').trim().toUpperCase();
    if (ORDER_CODE_RE.test(value)) return value;
  }

  for (const value of allValues(params)) {
    const code = String(value || '').trim().toUpperCase();
    if (ORDER_CODE_RE.test(code)) return code;
  }
  return '';
}

/** Tìm mã người dùng (dạng "gzafl-u7") trong các tham số. */
function findSubId(params) {
  const direct = pick(params, 'sub');
  if (direct) return direct;

  const prefix = process.env.AFFILIATE_SUB_ID_PREFIX || 'gzafl';
  const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-u\\d+$`, 'i');
  for (const value of allValues(params)) {
    if (re.test(value.trim())) return value.trim();
  }
  return '';
}

/** Tách số người dùng từ sub_id. Không tách được thì trả về null. */
function userIdFromSubId(subId) {
  const match = String(subId || '').match(/u(\d+)$/i);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Kiểm tra "chìa khoá" mà mạng gửi kèm có đúng `POSTBACK_SECRET` không.
 *
 * Ưu tiên header `X-Postback-Secret` vì nó KHÔNG nằm trong URL — không bị ghi vào
 * access log của proxy/CDN hay log của mạng. Vẫn nhận tham số trong query string
 * (mặc định tên `secret`, đổi bằng `POSTBACK_PARAM_SECRET`) vì phần lớn mạng chỉ
 * cho khai một URL cố định. Nếu có header thì chỉ xét header: header sai mà query
 * đúng vẫn bị từ chối, tránh việc cấu hình nửa vời âm thầm quay về URL.
 */
function verifySecret(params, headerSecret) {
  const expected = String(process.env.POSTBACK_SECRET || '').trim();
  if (!expected) return { configured: false, ok: false };

  const fromHeader = String(headerSecret == null ? '' : headerSecret).trim();
  const given = fromHeader || pick(params, 'secret');
  // Băm trước khi so sánh để hai chuỗi luôn cùng độ dài (timingSafeEqual yêu cầu vậy)
  const a = crypto.createHash('sha256').update(expected).digest();
  const b = crypto.createHash('sha256').update(String(given)).digest();
  return { configured: true, ok: crypto.timingSafeEqual(a, b), source: fromHeader ? 'header' : 'query' };
}

/** Chuẩn hoá tham số thô thành dữ liệu dùng được (chưa đụng tới database). */
function normalize(params) {
  return {
    provider: PROVIDER,
    transactionId: pick(params, 'transaction'),
    productId: pick(params, 'product'),
    conversionId: pick(params, 'conversion'),
    reward: Math.max(0, parseMoney(pick(params, 'reward'))),
    networkStatus: normalizeStatus(pick(params, 'status')),
    subId: findSubId(params),
    orderCode: findOrderCode(params),
    values: allValues(params)
  };
}

/* ==========================================
   Khớp đơn hàng
========================================== */

/**
 * Tìm đơn hàng tương ứng với một lần postback.
 * Trả về kèm CÁCH khớp để nhật ký nói rõ đâu là khớp chắc chắn, đâu là đoán:
 *   code        — mã đơn nội bộ nằm trong tham số (chắc chắn nhất)
 *   transaction — đơn đã từng gắn đúng mã giao dịch này
 *   fallback    — không có mã đơn, tạm lấy đơn mới nhất của người dùng (CẦN NGƯỜI KIỂM TRA)
 *
 * Ưu tiên mã đơn TRƯỚC mã giao dịch: mạng có thể gửi kèm đúng sub2 nhưng
 * transaction_id lại trùng với đơn khác (gửi lại/ghép giao dịch sai). Nếu ưu tiên
 * transaction_id, log sẽ bị áp nhầm sang đơn kia và làm sai cả hai đơn.
 */
function findOrder(parsed, userId) {
  // 1) Mã đơn nội bộ (GZ...) nằm trong tham số: khớp chính xác, không đoán
  if (parsed.orderCode) {
    const row = db.prepare('SELECT * FROM orders WHERE code = ?').get(parsed.orderCode);
    if (row) return { order: row, how: 'code' };
  }

  // 2) Đơn đã từng gắn mã giao dịch này
  if (parsed.transactionId) {
    const byNetwork = db
      .prepare('SELECT * FROM orders WHERE network_order_id = ?')
      .get(parsed.transactionId);
    if (byNetwork) return { order: byNetwork, how: 'transaction' };
  }

  if (userId) {
    // Không có mã đơn: lấy đơn gần nhất chưa bị huỷ của người dùng này
    const row = db
      .prepare('SELECT * FROM orders WHERE user_id = ? AND status != ? ORDER BY id DESC LIMIT 1')
      .get(userId, CANCELLED);
    if (row) return { order: row, how: 'fallback' };
  }

  return { order: null, how: 'none' };
}

/**
 * Tổng hợp mọi lần postback của cùng một đơn.
 * AccessTrade gửi mỗi sản phẩm một lần, nên phải cộng dồn theo đơn chứ không lấy từng lần.
 */
function totalsFor(order) {
  // Gom theo ĐƠN (order_code) chứ không lọc thêm theo transaction_id: mạng có thể gửi
  // sản phẩm đầu tiên kèm mã giao dịch, các sản phẩm sau chỉ kèm mã đơn (hoặc ngược
  // lại). Lọc theo transaction_id sẽ bỏ sót những log đã gắn đúng đơn.
  //
  // Mỗi sản phẩm có thể được mạng báo nhiều lần (pending -> approved -> rejected).
  // Chỉ lấy log MỚI NHẤT của từng sản phẩm, nếu không thì một đơn bị huỷ vẫn còn
  // cộng dồn khoản approved cũ và không thể thu hồi hoa hồng.
  //
  // item_key: ưu tiên product_id/conversion_id. Khi mạng không gửi hai mã này thì
  // gom theo transaction_id, rồi tới sub_id; cuối cùng là một "món" cho cả đơn.
  // TUYỆT ĐỐI không dùng id của log làm khoá: mỗi lần mạng đổi thêm tham số (ts,
  // thứ tự...) sẽ thành một "món" mới và bị cộng tiền hai lần.
  //
  // reward âm (mạng gửi số điều chỉnh) bị coi là 0: hoa hồng không bao giờ âm.
  const row = db
    .prepare(
      `WITH relevant AS (
         SELECT id, network_status,
                CASE WHEN reward > 0 THEN reward ELSE 0 END AS reward,
                COALESCE(NULLIF(product_id, ''), NULLIF(conversion_id, ''),
                         NULLIF(transaction_id, ''), NULLIF(sub_id, ''), 'order') AS item_key
         FROM postback_logs
         WHERE order_code = ?
           AND action NOT IN ('Từ chối', 'Không ghi đè')
       ),
       latest AS (
         SELECT network_status, reward,
                ROW_NUMBER() OVER (PARTITION BY item_key ORDER BY id DESC) AS rn
         FROM relevant
       )
       SELECT
         COALESCE(SUM(CASE WHEN network_status = 'approved' THEN reward ELSE 0 END), 0) AS approved,
         COALESCE(SUM(CASE WHEN network_status = 'pending'  THEN reward ELSE 0 END), 0) AS pending,
         COALESCE(SUM(CASE WHEN network_status = 'rejected' THEN reward ELSE 0 END), 0) AS rejected
       FROM latest
       WHERE rn = 1`
    )
    .get(order.code);
  return {
    approved: Number(row.approved) || 0,
    pending: Number(row.pending) || 0,
    rejected: Number(row.rejected) || 0
  };
}

/** Tỷ lệ hoàn tiền cho người dùng (phần còn lại là doanh thu). Mặc định 1 = hoàn toàn bộ. */
function cashbackRate() {
  const raw = Number(process.env.CASHBACK_RATE);
  if (!Number.isFinite(raw) || raw < 0) return 1;
  return raw > 1 ? 1 : raw;
}

/* ==========================================
   Ghi log + cập nhật đơn
========================================== */

function hashPayload(parsed) {
  // Sắp xếp cả object LẪN mảng `values`: mạng có thể gửi lại đúng một payload
  // nhưng đổi thứ tự tham số trên query. Chỉ sắp xếp tên key là chưa đủ, vì
  // `values` giữ nguyên thứ tự tham số -> hash khác -> bị coi là postback mới
  // và cộng tiền lần hai.
  const sorted = {};
  for (const key of Object.keys(parsed).sort()) {
    const value = parsed[key];
    sorted[key] = Array.isArray(value) ? value.map((item) => String(item)).sort() : value;
  }
  return crypto.createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
}

function rawQuery(params) {
  let text;
  try {
    // Che chìa khoá/token trước khi lưu: log còn dùng để hiển thị ở trang quản trị
    text = JSON.stringify(redactParams(params));
  } catch (err) {
    text = String(params);
  }
  return text.length > RAW_MAX ? text.slice(0, RAW_MAX) + '…' : text;
}

/**
 * Xử lý một postback: ghi log rồi cập nhật đơn tương ứng.
 * @returns {{status: number, body: object}}
 */
function receive(params, meta = {}) {
  const parsed = normalize(params);
  const now = new Date().toISOString();
  const payloadHash = hashPayload(parsed);

  // Ghi log + cập nhật đơn trong CÙNG một transaction: nếu bước sau lỗi thì
  // không còn bản ghi log "nửa vời"; nếu chạy nhiều tiến trình thì hai lần gọi
  // trùng không thể cùng lọt qua bước kiểm tra payload_hash.
  return db.transaction(() => {
    const existing = db.prepare('SELECT * FROM postback_logs WHERE payload_hash = ?').get(payloadHash);
    if (existing) {
      // Mạng gửi lại y hệt (thường vì lần trước không nhận được 200): chỉ đếm, không cộng tiền lần hai
      db.prepare('UPDATE postback_logs SET dup_count = dup_count + 1, last_received_at = ? WHERE id = ?').run(
        now,
        existing.id
      );
      return {
        status: 200,
        body: { ok: true, duplicate: true, logId: existing.id, orderCode: existing.order_code || null }
      };
    }

    const userId = userIdFromSubId(parsed.subId);
    const user = userId ? db.prepare('SELECT id, name, username FROM users WHERE id = ?').get(userId) : null;

    const info = db
      .prepare(
        `INSERT INTO postback_logs
           (provider, payload_hash, received_at, last_received_at, ip, query,
            transaction_id, product_id, conversion_id, reward, network_status, sub_id, user_id, order_code, action, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, '')`
      )
      .run(
        parsed.provider,
        payloadHash,
        now,
        now,
        String(meta.ip || '').slice(0, 60),
        rawQuery(params),
        parsed.transactionId,
        parsed.productId,
        parsed.conversionId,
        parsed.reward,
        parsed.networkStatus,
        parsed.subId,
        user ? user.id : null,
        'Chưa khớp đơn'
      );

    const logId = Number(info.lastInsertRowid);
    const result = applyToOrder(logId, parsed, user);
    return { status: 200, body: { ok: true, logId, ...result } };
  });
}

/**
 * Cập nhật đơn hàng theo dữ liệu một log đã ghi.
 * Tách riêng để quản trị viên bấm "Xử lý lại" được (postback về trước khi đơn tồn tại).
 */
function applyToOrder(logId, parsed, user) {
  const userId = user ? user.id : userIdFromSubId(parsed.subId);
  const found = findOrder(parsed, userId);
  const order = found.order;

  if (!order) {
    const note = userId
      ? 'Có người dùng nhưng không tìm thấy đơn nào phù hợp.'
      : 'Không đọc được mã người dùng trong tham số.';
    db.prepare('UPDATE postback_logs SET action = ?, note = ? WHERE id = ?').run('Chưa khớp đơn', note, logId);
    return { matched: false, orderCode: null, note };
  }

  // Khớp theo kiểu "đoán" thì phải nói rõ trong nhật ký để người kiểm tra lại
  let matchNote =
    found.how === 'fallback'
      ? 'Tham số không có mã đơn nên tạm gán vào đơn mới nhất của khách — nên kiểm tra lại.'
      : '';

  // Không có product_id/conversion_id thì không thể phân biệt "sản phẩm thứ 2" với
  // "mạng sửa kết quả cũ" — ghi rõ để admin biết vì sao tổng tiền có thể thiếu.
  if (!parsed.productId && !parsed.conversionId) {
    matchNote +=
      (matchNote ? ' ' : '') +
      'Mạng không gửi product_id/conversion_id nên chỉ ghi nhận một khoản cho giao dịch này; hãy khai báo Product ID trong postback để cộng đủ từng sản phẩm.';
  }

  // Gắn mã giao dịch của mạng vào đơn (chống 2 đơn cùng nhận một giao dịch)
  if (parsed.transactionId && order.network_order_id !== parsed.transactionId) {
    try {
      db.prepare('UPDATE orders SET network_order_id = ? WHERE id = ?').run(parsed.transactionId, order.id);
      order.network_order_id = parsed.transactionId;
    } catch (err) {
      const note = `Giao dịch ${parsed.transactionId} đã gắn cho đơn khác — giữ nguyên đơn cũ.`;
      db.prepare('UPDATE postback_logs SET order_code = ?, action = ?, note = ? WHERE id = ?').run(
        order.code,
        'Không ghi đè',
        note,
        logId
      );
      return { matched: false, orderCode: order.code, note };
    }
  }

  // Gắn mã đơn vào log TRƯỚC khi tổng hợp: nếu không, chính lần gọi này
  // không được tính vào tổng (order_code còn rỗng) -> hoa hồng bị thiếu.
  db.prepare('UPDATE postback_logs SET order_code = ? WHERE id = ?').run(order.code, logId);

  const totals = totalsFor(order);
  const rate = cashbackRate();
  // Số hoa hồng mạng đã duyệt, quy đổi theo CASHBACK_RATE.
  // Khi đơn chưa được admin duyệt, đây chỉ là số DỰ KIẾN.
  const approvedCommission = Math.round(totals.approved * rate);
  const networkCommission = totals.approved + totals.pending;
  // Trạng thái gộp của cả giao dịch (một giao dịch có nhiều sản phẩm)
  const aggregateStatus =
    totals.approved > 0 ? 'approved' : totals.pending > 0 ? 'pending' : 'rejected';

  // Mạng đã duyệt -> đưa đơn vào hàng chờ quản trị viên chốt hoa hồng.
  let networkOrderStatus = AWAITING_RECONCILE;
  if (totals.approved > 0) networkOrderStatus = PENDING_APPROVAL;
  else if (totals.pending === 0 && totals.rejected > 0) networkOrderStatus = CANCELLED;

  let action = found.how === 'fallback' ? 'Khớp tạm' : 'Đã ghi nhận';
  let note = matchNote;
  const now = new Date().toISOString();
  const previousCommission = Number(order.commission) || 0;
  const previousReversed = Number(order.commission_reversed) || 0;
  const alreadyCredited = isCredited(order);
  let status = networkOrderStatus;
  let commission = approvedCommission;
  let reversedCommission = previousReversed;
  let reversedAt = order.commission_reversed_at || null;

  if (alreadyCredited) {
    // Admin đã duyệt và khoản tiền đã được tính vào ví. Không tự tăng thêm;
    // nếu mạng báo giảm/huỷ thì ghi nhận thu hồi để trừ vào số dư sau.
    status = order.status;
    commission = previousCommission;
    action = 'Đơn đã duyệt';

    if (aggregateStatus === 'pending') {
      // Mạng đang kiểm tra lại: giữ nguyên khoản admin đã duyệt, chờ kết quả cuối.
      note = 'Mạng đang kiểm tra lại chuyển đổi — giữ nguyên hoa hồng admin đã duyệt.';
    } else if (approvedCommission < previousCommission) {
      commission = approvedCommission;
      // Cộng dồn: một đơn có thể bị giảm/thu hồi nhiều lần, mỗi lần chỉ chênh lệch
      // so với mức đang ghi nhận. Ghi đè sẽ làm mất các khoản đã thu hồi trước đó.
      reversedCommission = previousReversed + Math.max(0, previousCommission - approvedCommission);
      reversedAt = now;
      if (commission <= 0 && order.status !== 'Đã thanh toán') status = CANCELLED;
      note =
        `Mạng báo huỷ/giảm hoa hồng sau khi admin đã duyệt — đã ghi nhận thu hồi ${reversedCommission}đ.`;
    } else if (approvedCommission > previousCommission) {
      note = 'Mạng báo tăng hoa hồng sau khi admin đã duyệt — không tự tăng, admin kiểm tra lại nếu cần.';
    } else {
      note = 'Đơn đã được admin duyệt; chỉ cập nhật số liệu mạng.';
    }
    if (matchNote) note += ' ' + matchNote;
  } else {
    // Chưa được admin duyệt: chỉ ghi số dự kiến và đưa đơn vào đúng hàng chờ.
    if (status === PENDING_APPROVAL) {
      note = `Mạng đã duyệt ${totals.approved}đ, hoàn dự kiến ${commission}đ — chờ admin duyệt.`;
    } else if (status === CANCELLED) {
      commission = 0;
      note = `Mạng báo huỷ, đơn chuyển sang "Đã huỷ"${reversedCommission > 0 ? `; giữ khoản thu hồi ${reversedCommission}đ` : ''}.`;
    } else {
      commission = 0;
      note = `Chờ mạng duyệt (tạm tính ${networkCommission}đ).`;
    }
    if (matchNote) note += ' ' + matchNote;
  }

  db.prepare(
    `UPDATE orders
     SET status = ?, commission = ?, commission_reversed = ?, commission_reversed_at = ?,
         network_commission = ?, network_status = ?, network_updated_at = ?
     WHERE id = ?`
  ).run(
    status,
    commission,
    reversedCommission,
    reversedAt,
    networkCommission,
    aggregateStatus,
    now,
    order.id
  );

  db.prepare('UPDATE postback_logs SET order_code = ?, action = ?, note = ? WHERE id = ?').run(
    order.code,
    action,
    note,
    logId
  );

  const clawback = Math.max(0, previousCommission - commission);
  notifyOwner(order, commission, status, clawback);

  return { matched: true, orderCode: order.code, status, commission, reversedCommission, note };
}

/** Báo cho người dùng biết đơn của họ vừa có chuyển đổi hoặc vừa bị thu hồi. */
function notifyOwner(order, commission, status, reversedCommission = 0) {
  if (commission <= 0 && reversedCommission <= 0) return;
  try {
    const now = new Date().toISOString();
    let title;
    let body;
    if (reversedCommission > 0 && commission <= 0) {
      title = 'Hoa hồng bị thu hồi';
      body = `Đơn ${order.code} bị huỷ/hoàn trả. Hệ thống đã thu hồi ${reversedCommission}đ hoa hồng. Nếu bạn đã rút trước đó, khoản này sẽ được trừ vào hoa hồng tiếp theo.`;
    } else if (status === PENDING_APPROVAL) {
      title = 'Đơn đã được sàn duyệt';
      body = `Đơn ${order.code} đã được sàn ghi nhận hoa hồng ${commission}đ và đang chờ quản trị viên duyệt. Hoa hồng sẽ vào ví sau khi được duyệt.`;
    } else {
      title = 'Đơn hàng đã được duyệt';
      body =
        `Đơn ${order.code} đã được ghi nhận hoa hồng ${commission}đ. Trạng thái: ${status}.` +
        (reversedCommission > 0 ? ` Đã điều chỉnh thu hồi ${reversedCommission}đ.` : '');
    }
    db.prepare(
      `INSERT INTO notifications (user_id, title, body, icon, is_read, created_at)
       VALUES (?, ?, ?, 'wallet', 0, ?)`
    ).run(order.user_id, title, body, now);
  } catch (err) {
    // Không để lỗi thông báo làm hỏng việc đối soát
    console.warn(`Không tạo được thông báo cho đơn ${order.code}: ${err.message}`);
  }
}

/**
 * Ghi lại một lần gọi KHÔNG hợp lệ (sai chìa khoá, lỗi xử lý) để còn truy vết.
 * Những lần này không đụng tới đơn hàng.
 *
 * Giới hạn: mỗi IP chỉ ghi tối đa REJECTED_LOG_MAX dòng / REJECTED_LOG_WINDOW_MS.
 * Endpoint postback là API công khai, không thể để người lạ bơm hàng triệu dòng
 * vào cùng file SQLite đang giữ dữ liệu tiền. Vượt giới hạn thì bỏ qua (vẫn trả 403).
 */
const REJECTED_LOG_MAX = 10;
const REJECTED_LOG_WINDOW_MS = 15 * 60 * 1000;
const REJECTED_LOG_MAX_IPS = 5000;
const rejectedLogState = new Map();

function shouldLogRejected(ip) {
  const key = String(ip || 'unknown').slice(0, 60);
  const now = Date.now();
  const entry = rejectedLogState.get(key);

  if (!entry || entry.resetAt <= now) {
    // Dọn bớt mục hết hạn để Map không phình vô hạn (bị lợi dụng bằng nhiều IP)
    if (rejectedLogState.size >= REJECTED_LOG_MAX_IPS) {
      for (const [k, v] of rejectedLogState) {
        if (v.resetAt <= now) rejectedLogState.delete(k);
      }
      if (rejectedLogState.size >= REJECTED_LOG_MAX_IPS) rejectedLogState.clear();
    }
    rejectedLogState.set(key, { count: 1, resetAt: now + REJECTED_LOG_WINDOW_MS });
    return true;
  }

  entry.count += 1;
  return entry.count <= REJECTED_LOG_MAX;
}

function receiveRejected(params, meta = {}, reason = '') {
  if (!shouldLogRejected(meta.ip)) return null;

  const now = new Date().toISOString();
  const parsed = normalize(params);
  // Băm kèm thời điểm + số ngẫu nhiên: mọi lần gọi sai đều được ghi lại (không gộp trùng)
  const payloadHash = crypto
    .createHash('sha256')
    .update(JSON.stringify({ reason, raw: params, at: now, rand: Math.random() }))
    .digest('hex');

  const info = db
    .prepare(
      `INSERT INTO postback_logs
         (provider, payload_hash, received_at, last_received_at, ip, query,
          transaction_id, product_id, conversion_id, reward, network_status, sub_id, user_id, order_code, action, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, '', ?, ?)`
    )
    .run(
      parsed.provider || String(meta.provider || ''),
      payloadHash,
      now,
      now,
      String(meta.ip || '').slice(0, 60),
      rawQuery(params),
      parsed.transactionId,
      parsed.productId,
      parsed.conversionId,
      parsed.reward,
      parsed.networkStatus,
      parsed.subId,
      'Từ chối',
      reason
    );

  return Number(info.lastInsertRowid);
}

/** Xử lý lại một log cũ (dùng khi postback về trước lúc đơn được tạo). */
function reapply(logId) {
  // Đọc log + áp vào đơn trong cùng transaction để không ghi dở dang khi lỗi.
  return db.transaction(() => {
    const log = db.prepare('SELECT * FROM postback_logs WHERE id = ?').get(logId);
    if (!log) return { ok: false, error: 'Không tìm thấy log.' };

    // Log bị từ chối (sai chìa khoá / lỗi xử lý) KHÔNG được xử lý lại thành đơn hợp lệ:
    // nó chưa từng được xác thực nguồn gửi.
    if (log.action === 'Từ chối') {
      return { ok: false, error: 'Bản ghi này đã bị từ chối (sai chìa khoá), không thể xử lý lại.' };
    }

    const user = log.user_id
      ? db.prepare('SELECT id, name, username FROM users WHERE id = ?').get(log.user_id)
      : null;
    const parsed = {
      provider: log.provider,
      transactionId: log.transaction_id,
      productId: log.product_id,
      conversionId: log.conversion_id,
      reward: Number(log.reward) || 0,
      networkStatus: log.network_status,
      subId: log.sub_id,
      orderCode: log.order_code || '',
      values: [log.sub_id].filter(Boolean)
    };

    // Thử lại cả mã đơn ghi trong log cũ (nếu lúc đó đọc được)
    if (log.order_code) parsed.values.push(log.order_code);

    const result = applyToOrder(log.id, parsed, user);
    return { ok: true, ...result };
  });
}

/** Thông tin cho log lúc khởi động + API trạng thái. */
function describe() {
  const secret = String(process.env.POSTBACK_SECRET || '').trim();
  return {
    provider: PROVIDER,
    configured: Boolean(secret),
    cashbackRate: cashbackRate(),
    approval: 'admin',
    url: '/api/postback/' + PROVIDER
  };
}

/**
 * Dọn các dòng log BỊ TỪ CHỐI cũ (sai chìa khoá / lỗi xử lý).
 * Log khớp đơn là chứng từ tài chính nên KHÔNG bao giờ tự xoá.
 * Mặc định giữ 90 ngày, đổi bằng POSTBACK_LOG_KEEP_DAYS.
 */
function pruneRejected() {
  const raw = Number(process.env.POSTBACK_LOG_KEEP_DAYS);
  const days = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 3650) : 90;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const info = db
    .prepare("DELETE FROM postback_logs WHERE action = 'Từ chối' AND received_at < ?")
    .run(cutoff);
  return Number(info.changes) || 0;
}

module.exports = {
  receive,
  receiveRejected,
  pruneRejected,
  reapply,
  describe,
  verifySecret,
  normalize,
  cashbackRate,
  CANDIDATES
};
