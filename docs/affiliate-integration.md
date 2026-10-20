# Tích hợp chuyển đổi link hoàn tiền (Affiliate)

> Tài liệu này mô tả **cách làm** để khi người dùng dán link Shopee/TikTok/Lazada,
> hệ thống trả về một **link mua hàng có ghi nhận hoa hồng** thay vì link gốc.
>
> **Trạng thái hiện tại:** phần khung đã **triển khai xong** (`backend/lib/affiliate.js`,
> link rút gọn `/r/<mã đơn>`, đơn hàng lưu `original_link` / `affiliate_link` / `sub_id`,
> giao diện trả link hoàn tiền kèm nút Copy và Mua ngay).
>
> Đang chạy ở nhà cung cấp `mock` — chạy được toàn bộ luồng nhưng **chưa tạo hoa hồng thật**.
> Việc còn lại là đăng ký tài khoản affiliate, điền khóa API và chọn
> `AFFILIATE_PROVIDER=accesstrade` (hoặc `shopee`). Xem mục 7 để biết việc cần làm.

---

## 1. Kết luận quan trọng trước khi bắt tay

**Không thể tạo link hoàn tiền bằng cách thêm tham số vào URL.**

Ví dụ `https://shopee.vn/...?ref=gzafl` hay `?aff_id=123` **không có tác dụng** — Shopee bỏ qua các tham số lạ. Muốn có ghi nhận hoa hồng, bắt buộc phải:

1. Có tài khoản **affiliate đã được duyệt** (Shopee Affiliate Program, hoặc mạng trung gian như AccessTrade / MAS / Adpia).
2. **Gọi API của họ** để sinh link tracking — link này do họ tạo, không phải mình ghép.
3. **Nhận báo cáo chuyển đổi** (postback/webhook) từ họ để biết đơn nào ra bao nhiêu tiền.

Ba việc trên phải làm cùng nhau. Làm lẻ một việc thì tính năng chỉ là trang trí.

---

## 2. Kiến trúc luồng

```
① Người dùng dán link Shopee
        │
        ▼
② POST /api/orders                      ← đã có
        │   - parseOrderLink(link)  → { platform: 'Shopee', url }  (kiểm tra giao thức + tên miền)
        │   - subId = "gzafl-u{userId}"          (mã định danh người dùng)
        │   - GỌI PROVIDER để đổi link
        ▼
③ backend/lib/affiliate.js              ← đã có (mock + AccessTrade; Shopee còn khung)
        │   convert({ url, platform, subId })
        │     ├─ provider "mock"        → link nội bộ /r/<mã>
        │     ├─ provider "accesstrade" → gọi API AccessTrade
        │     └─ provider "shopee"      → gọi Shopee Affiliate Open API
        ▼
④ Lưu đơn: original_link + affiliate_link + sub_id
        │
        ▼
⑤ Trả link hoàn tiền về giao diện → người dùng COPY và mua hàng
        │
        ▼
⑥ Người dùng mua hàng trên Shopee
        │
        ▼
⑦ Shopee/AccessTrade gọi POSTBACK về server  ← đã có (backend/routes/postback.js)
        │   "sub_id = gzafl-u7, hoa hồng = 75.000đ"
        ▼
⑧ Hệ thống tra sub_id → ra user 7 → cộng tiền vào ví
```

**`sub_id` là mấu chốt.** Không có nó thì mọi người dùng dùng chung một link và bạn không biết ai đáng được trả tiền.

---

## 3. Chi tiết từng phần cần sửa

### 3.1. Database — `backend/db.js`

Bảng `orders` cần thêm 4 cột. Vì `CREATE TABLE IF NOT EXISTS` **không** sửa được bảng đã tồn tại, phải viết migration chạy lúc khởi động:

```js
// Thêm cột nếu chưa có (SQLite không có ADD COLUMN IF NOT EXISTS)
const cols = db.prepare("SELECT name FROM pragma_table_info('orders')").all().map(c => c.name);
const needed = {
  original_link:   'TEXT',
  affiliate_link:  'TEXT',
  sub_id:          'TEXT',
  network_order_id:'TEXT'   // mã đơn phía sàn — dùng để chống cộng tiền 2 lần
};
for (const [name, type] of Object.entries(needed)) {
  if (!cols.includes(name)) db.exec(`ALTER TABLE orders ADD COLUMN ${name} ${type}`);
}
```

Thêm index cho postback tra cứu:

```sql
CREATE INDEX IF NOT EXISTS idx_orders_sub_id ON orders (sub_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_network ON orders (network_order_id)
  WHERE network_order_id IS NOT NULL;
```

> Nên thêm một bảng `postback_logs` (payload thô, thời gian, đã xử lý hay chưa) để **đối soát** khi có khiếu nại. Log thô rất quan trọng vì mạng affiliate có thể gửi lại postback.

### 3.2. Module provider — `backend/lib/affiliate.js` *(file mới)*

Ba provider dùng **cùng một interface** để sau này đổi bằng biến môi trường, không sửa chỗ gọi:

```js
/**
 * @param {{ url: string, platform: string, subId: string }} input
 * @returns {Promise<{ affiliateLink: string, provider: string, subId: string, raw?: unknown }>}
 * @throws {Error} khi không đổi được link
 */
async function convert(input) { /* chọn provider theo process.env.AFFILIATE_PROVIDER */ }
```

**Provider `mock`** (chạy được ngay, không cần tài khoản):

Sinh link nội bộ `/r/<mã>` → khi mở sẽ ghi nhận lượt click rồi 302 sang link gốc. Mục đích là để test trọn luồng giao diện, **không** tạo ra hoa hồng thật:

```
https://shopee.vn/product/111
  → https://your-domain/r/GZ102218
```

**Provider `accesstrade`** (REST) — ✅ đã đối chiếu tài liệu chính thức và cài đặt:

- Cần: `ACCESSTRADE_API_KEY`, và campaign ID riêng cho từng sàn:
  `ACCESSTRADE_CAMPAIGN_SHOPEE`, `ACCESSTRADE_CAMPAIGN_TIKTOK`, `ACCESSTRADE_CAMPAIGN_LAZADA`
  (`ACCESSTRADE_CAMPAIGN_ID` là mặc định chung nếu một sàn chưa có biến riêng)
- `POST https://api.accesstrade.vn/v1/product_link/create`, header `Authorization: token <API_KEY>`
- Body: `campaign_id` (**chuỗi**, không phải Number), `urls: [url]`, `url_enc: true`, `sub1`, `sub2`
- Nhận về `data.success_link[0].aff_link` (hoặc `short_link`); lỗi nằm ở `data.error_link`
- Tài liệu: <https://developers.accesstrade.vn/api-publisher-vietnamese/tao-tracking-link.md>
- `sub1 = gzafl-u<id>` (người dùng), `sub2 = <mã đơn>` (đơn hàng) — xem mục 3.6.3

**Provider `shopee`** (Shopee Affiliate Open API — **API chính thức của sàn**, không qua trung gian):

- Endpoint **đã kiểm chứng được**: `https://open-api.affiliate.shopee.vn/graphql`
  Gọi thử không kèm header sẽ trả về `error [10020]: Invalid Authorization Header`
  → xác nhận đây là **GraphQL API thật** và **bắt buộc** có header `Authorization`.
- Cần: `SHOPEE_AFFILIATE_APP_ID`, `SHOPEE_AFFILIATE_SECRET`
- Request phải có **chữ ký**, dạng `SHA256(appId + timestamp + payload + secret)`
  ⚠️ Đối chiếu lại thứ tự chuỗi ký trong tài liệu chính thức khi đã có tài khoản — **không đoán**.
- Mutation sinh link: `generateShortLink`
- ⚠️ Phải được duyệt làm affiliate **và** được cấp quyền gọi API (duyệt riêng)
- ⚠️ Chỉ phủ **Shopee** — không có TikTok/Lazada. Xem **phụ lục A** trước khi chọn hướng này.

**Biến môi trường** (thêm vào README):

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `AFFILIATE_PROVIDER` | `mock` | `mock` \| `accesstrade` \| `shopee` |
| `AFFILIATE_LIVE_PLATFORMS` | tất cả | Giới hạn sàn dùng API thật (ví dụ `TikTok Shop`); sàn khác tạm dùng link thử nghiệm |
| `AFFILIATE_SUB_ID_PREFIX` | `gzafl` | Tiền tố `sub_id`, tránh trùng với hệ thống khác |
| `ACCESSTRADE_API_KEY` | — | Token do AccessTrade cấp |
| `ACCESSTRADE_CAMPAIGN_SHOPEE` / `_TIKTOK` / `_LAZADA` | — | Campaign ID riêng từng sàn (giữ dạng chuỗi) |
| `ACCESSTRADE_CAMPAIGN_ID` | — | Tuỳ chọn: campaign mặc định chung |
| `ACCESSTRADE_SHORT_DOMAIN` | — | Tuỳ chọn: domain rút gọn riêng của bạn |
| `SHOPEE_AFFILIATE_APP_ID` / `_SECRET` | — | Do Shopee cấp |
| `POSTBACK_SECRET` | — | Chuỗi bí mật để xác thực postback |
| `POSTBACK_PARAM_*` | — | Ép tên tham số mạng gửi về (xem mục 3.6.2) |
| `CASHBACK_RATE` | `1` | Tỷ lệ hoàn cho người dùng (0.7 = 70%) |

Nếu thiếu key thì **chỉ đơn hàng đó rơi về link gốc** (người dùng vẫn mua được, hệ thống ghi log lỗi) —
cố ý không làm sập luồng tạo đơn vì một API bên ngoài đang lỗi.

### 3.3. Đổi link khi tạo đơn — `backend/routes/orders.js`

Sửa handler `POST /`:

```js
const subId = `${process.env.AFFILIATE_SUB_ID_PREFIX || 'gzafl'}-u${req.user.id}`;

let converted;
try {
  converted = await affiliate.convert({ url: link, platform, subId });
} catch (err) {
  // Không chặn người dùng: vẫn tạo đơn với link gốc, chỉ là chưa ghi nhận được
  converted = { affiliateLink: link, provider: 'raw', subId: null };
}

// INSERT ... thêm original_link, affiliate_link, sub_id
// response thêm affiliateLink để giao diện hiển thị
```

⚠️ **Lưu ý kỹ thuật:** handler hiện tại là **hàm đồng bộ**, gọi `fetch` sẽ thành **bất đồng bộ**. Express 4 **không** tự bắt lỗi của handler `async` — phải bọc `try/catch` và `next(err)` thủ công, nếu không server sẽ treo request.

### 3.4. Trả dữ liệu ra giao diện — `backend/lib/serialize.js`

`toOrder()` thêm `affiliateLink: row.affiliate_link || row.link` và `subId: row.sub_id`.

### 3.5. Giao diện — `components/create-order.html` + `script.js`

Hiện tại nút **"Tạo link & kiểm tra hoa hồng"** chỉ hiện `showToast('Tạo link hoàn tiền thành công!')` — **không trả link nào cho người dùng**. Đây chính là chỗ cần sửa để "trả về 1 link khác".

Thêm một khối kết quả (mặc định ẩn) dưới nút:

```
┌─────────────────────────────────────────────────┐
│  ✅ Link hoàn tiền đã sẵn sàng                   │
│                                                 │
│  https://shope.ee/abc123          [Copy]        │
│                                                 │
│  [ 🛒 Mua ngay trên Shopee ]                    │
│                                                 │
│  ⚠️ Chỉ mua sau khi bấm link này. Đơn mã GZ102218│
└─────────────────────────────────────────────────┘
```

Trong `script.js`, hàm xử lý `#btn-create-link`:
- nhận `order.affiliateLink` từ response
- render khối trên, nút **Copy** dùng lại `copyTextToClipboard()` đã có sẵn
- nút **Mua ngay** mở `target="_blank"` (dùng `rel="noopener"`)

Trang **Đơn hàng đã đặt** (`updateOrdersData`) nên thêm nút copy lại link hoàn tiền, vì người dùng thường tạo xong rồi mới mua.

### 3.6. Nhận báo cáo chuyển đổi — postback **hoặc** đồng bộ định kỳ

Có **hai cơ chế khác nhau tuỳ nhà cung cấp** — kiến trúc khác nhau hẳn:

| Cơ chế | Ai dùng | Cách làm | Trạng thái trong repo |
|---|---|---|---|
| **Postback (webhook)** — mạng chủ động gọi server bạn | AccessTrade, MAS, Ecomobi | Endpoint công khai, xử lý ngay khi có dữ liệu | ✅ **đã làm** (`backend/routes/postback.js` + `backend/lib/postback.js`) |
| **Truy vấn báo cáo (polling)** — bạn chủ động gọi API hỏi | Shopee Affiliate Open API | **Cron** chạy mỗi 1–6 giờ kéo báo cáo về | ⬜ chưa làm (chỉ cần nếu đi thẳng với Shopee) |

Nếu chọn Shopee trực tiếp thì **không dùng postback** — thay vào đó là một job chạy nền:

```
Cron (mỗi 2 giờ)
   └─ Gọi API lấy báo cáo chuyển đổi trong khoảng thời gian vừa qua
        └─ Với mỗi dòng: tra sub_id → user, network_order_id → đơn
             ├─ Đơn chưa có  → tạo/cập nhật
             └─ Đơn đã có    → chỉ cập nhật nếu trạng thái/hoa hồng thay đổi
```

Cần lưu **mốc thời gian đồng bộ lần cuối** để lần sau chỉ hỏi phần mới. Cũng vẫn cần chống trùng y như postback.

#### 3.6.1. Postback đã cài đặt — đường đi của một lần báo hoa hồng

```
AccessTrade --GET--> /api/postback/accesstrade?secret=...&transaction_id=...&reward=...
   ├─ 1. Kiểm tra POSTBACK_SECRET (hash SHA-256 rồi timingSafeEqual)  → sai: 403 + ghi log "Từ chối"
   ├─ 2. Ghi NGUYÊN tham số vào postback_logs (kể cả lần gọi sai)      → có log mới đối soát được
   ├─ 3. Chống trùng theo payload_hash                                 → trùng: chỉ tăng dup_count, trả 200
   ├─ 4. Đọc sub1 = gzafl-u<id> → người dùng;  sub2 = <mã đơn> → đúng đơn
   ├─ 5. Cộng dồn MỌI lần postback của cùng giao dịch (mạng gửi mỗi sản phẩm 1 lần)
   └─ 6. Cập nhật đơn: chờ duyệt → "Chờ đối soát"; đã duyệt → "Hoàn thành" + cộng tiền; huỷ → "Đã huỷ"
```

Chi tiết đáng nhớ:

- **Mạng gửi mỗi sản phẩm một lần gọi.** Một đơn 3 món = 3 lần postback cùng `transaction_id`. Vì vậy tổng hoa hồng được **cộng dồn theo đơn** (`postback_logs.order_code`), không lấy từng lần gọi.
- **Chống trùng bằng `payload_hash`** (băm tham số đã sắp xếp) chứ không chỉ theo `transaction_id` — nhờ vậy 3 lần gọi khác sản phẩm vẫn được tính đủ, mà lần gọi lại y hệt thì không cộng tiền hai lần.
- **Tiền chưa duyệt KHÔNG vào số dư.** Nằm ở cột riêng `orders.network_commission`; chỉ khi mạng báo `approved` mới ghi `orders.commission` (tiền thật của người dùng). Nhờ vậy không phải sửa lại mọi câu SQL tính số dư.
- **Đơn đã ở trạng thái "Đã thanh toán" thì hệ thống không tự đổi** — tránh trường hợp đã chi tiền cho khách rồi mà mạng báo huỷ lại âm ví. Log ghi rõ để admin xử lý tay.
- **Postback không khớp được đơn nào** (về trước khi đơn tồn tại, hoặc sai tên tham số) vẫn được lưu và hiện ở tab **Đối soát** với nút **Xử lý lại**.
- **Luôn trả `200` nhanh** để mạng không gửi lại liên tục (AccessTrade chỉ gửi lại tối đa 3 lần).

#### 3.6.2. Khai báo bên AccessTrade (phần bạn phải làm trong dashboard)

Tài liệu: <https://support.accesstrade.global/system-integration/what-is-postback-and-how-to-use.html>

1. Đặt `POSTBACK_SECRET` trong `backend/.env` thành một chuỗi ngẫu nhiên khó đoán.
2. Vào **Account Settings → Properties → Postback**, khai URL:
   `https://ten-mien-cua-ban/api/postback/accesstrade`
3. Thêm một tham số có giá trị **cố định** đúng bằng `POSTBACK_SECRET` (AccessTrade gọi là *Action ID*), ví dụ tên tham số `secret`.
4. Thêm các tham số dữ liệu: **Transaction ID**, **Product ID**, **Reward** (hoa hồng), **Conversion Status**, và các **sub id** (sub id luôn được gửi kèm tự động).

Tên tham số do **người dùng tự đặt**, nên code không hard-code một tên duy nhất: nó dò lần lượt các tên thông dụng (`transaction_id`, `product_id`, `reward`, `status`, `sub1`…) và **quét mọi giá trị** để tìm mã dạng `gzafl-u<id>` hoặc mã đơn `GZ…`. Nếu tên của bạn khác hẳn, ép lại bằng biến môi trường:

```
POSTBACK_PARAM_SECRET / POSTBACK_PARAM_TRANSACTION / POSTBACK_PARAM_PRODUCT
POSTBACK_PARAM_CONVERSION / POSTBACK_PARAM_REWARD / POSTBACK_PARAM_STATUS / POSTBACK_PARAM_SUB
```

Xem toàn bộ tham số thô đã nhận ở **trang quản trị → tab Đối soát → nút "Thô"**.

#### 3.6.3. Gắn mã vào link khi tạo (đã làm)

`convertAccessTrade()` gửi lên API tạo link của AccessTrade:

| Tham số | Giá trị | Vì sao |
|---|---|---|
| `sub1` | `gzafl-u<id>` | biết hoa hồng thuộc về ai |
| `sub2` | `<mã đơn GZ…>` | biết hoa hồng thuộc **đơn nào** → đối soát tự động được |
| `urls`, `url_enc` | link sản phẩm | bắt buộc |

Endpoint chính thức: `POST https://api.accesstrade.vn/v1/product_link/create`, header `Authorization: token <API_KEY>`.
⚠️ `campaign_id` là số 19 chữ số → **phải giữ dạng chuỗi**, chuyển sang `Number` sẽ mất chữ số cuối và tạo link sai campaign.

### 3.7. Trạng thái mới & tỷ lệ hoàn tiền ✅ (đã làm)

**Thời gian chốt hoa hồng:** Shopee thường giữ tiền **7–30 ngày** để chờ đối soát và xử lý hoàn hàng. Vì vậy không nhảy thẳng từ "Đang xử lý" sang "Hoàn thành". Trạng thái đã thêm:

```
Đang xử lý  →  Chờ đối soát  →  Hoàn thành  →  Đã thanh toán
                     └──────→  Đã huỷ (hoàn hàng / không hợp lệ)
```

Đã cập nhật đồng bộ: `backend/lib/constants.js` (`ORDER_STATUSES` + `AWAITING_RECONCILE`),
`script.js` (`statusBadgeClass` rơi vào màu vàng mặc định, thẻ "đơn đang chờ" gộp cả 2 trạng thái),
`components/admin.html` + `admin.js` (ô lọc trạng thái, modal xử lý đơn, tab Đối soát).

**Tỷ lệ hoàn tiền (revenue share):** đã tự động hoá bằng `CASHBACK_RATE` (biến môi trường toàn hệ thống):

```
commission_ghi_cho_user = tổng hoa hồng mạng ĐÃ DUYỆT × CASHBACK_RATE
```

- `CASHBACK_RATE=0.7` → hoàn 70%, giữ lại 30%.
- **Bỏ trống = `1` (hoàn 100%).** Con số này được in ra lúc khởi động:
  `Tỷ lệ hoàn cho người dùng: 70% (CASHBACK_RATE)` — nhớ kiểm tra trước khi chạy thật.
- Chỉ áp dụng cho tiền do **mạng báo về tự động**; admin vẫn chốt tay được hoa hồng ở modal xử lý đơn như trước.
- Muốn tỷ lệ riêng cho từng người (VIP, đối tác) thì bước tiếp theo là thêm cột `users.cashback_rate` và ưu tiên nó trước biến môi trường.


---

## 4. Checklist — cần xin những gì

| Việc | Ai làm | Trạng thái |
|---|---|---|
| Đăng ký + được duyệt affiliate (publisher) | Bạn | ⬜ quyết định tiến độ, có thể mất vài ngày |
| Lấy API key / campaign id | Bạn | ⬜ **không** commit vào git, chỉ để trong `.env` |
| Xác nhận giới hạn `sub_id` (số ký tự, số lượng) | Bạn | ⬜ ảnh hưởng cách đặt mã — code đang dùng `sub1`, `sub2` |
| Đăng ký URL postback + tham số chứa chìa khoá | Bạn | ⬜ xem mục 3.6.2 |
| Hỏi điều khoản có cho phép mô hình hoàn tiền lại không | Bạn | ⬜ xem mục 5 |
| `lib/affiliate.js` + cột/bảng trong DB | Dev | ✅ xong (3.1, 3.2) |
| `routes/orders.js` + giao diện trả link | Dev | ✅ xong (3.3 – 3.5) |
| `routes/postback.js` + `postback_logs` + chống trùng + tab Đối soát | Dev | ✅ xong (3.6) |
| Trạng thái "Chờ đối soát" + tỷ lệ hoàn tiền | Dev | ✅ xong (3.7) |
| Chốt `CASHBACK_RATE` (mặc định đang là 1 = hoàn 100%) | Bạn | ⬜ **nhớ đặt trước khi chạy thật** |
| Test bằng **một đơn thật nhỏ** rồi đối chiếu hoa hồng | Cả hai | ⬜ chốt chặn cuối cùng trước khi trả tiền cho khách |

---

## 5. Ba điều cần lưu ý

**Một — điều khoản của sàn.** Nhiều chương trình affiliate **cấm** việc tự ý hoàn tiền lại cho người mua (coi là hành vi thao túng hoa hồng) và có thể khoá tài khoản, thu hồi tiền đã trả. Hãy đọc kỹ điều khoản của chương trình bạn tham gia **trước khi** làm, đừng để mất tiền oan sau khi đã trả cho người dùng.

**Hai — không tin dữ liệu postback ngoài secret.** Postback là endpoint công khai. Không có secret thì bất kỳ ai cũng có thể tự gửi "hoa hồng 10 triệu cho user 7". Và tuyệt đối **không để người dùng tự đặt `sub_id`** — họ sẽ gán đơn của người khác cho mình.

**Ba — mock không phải tiền thật.** Ở chế độ `mock`, link trả về chỉ để test luồng. Tiền trong ví vẫn do admin chốt tay như hiện nay. Đừng để giao diện ngụ ý rằng hệ thống đã tự ghi nhận hoa hồng khi thực tế chưa có kết nối nào.

---

## 6. Ước lượng khối lượng

| Giai đoạn | Nội dung | Công | Trạng thái |
|---|---|---|---|
| A | Provider `mock` + migration DB + đổi giao diện để trả link | ~1 ngày | ✅ xong |
| B | Nhận postback + bảng log + chống trùng + tab Đối soát | ~1 ngày | ✅ xong |
| C | Cắm provider thật (`accesstrade` viết xong theo tài liệu, **chờ key để test đơn thật**) | ~1 ngày | 🟡 chờ key |
| D | Tỷ lệ hoàn tiền + trạng thái "Chờ đối soát" | ~0,5 ngày | ✅ xong |

Còn lại đúng **một việc phụ thuộc bạn**: có tài khoản AccessTrade → điền `.env` → **test bằng 1 đơn thật nhỏ** rồi đối chiếu `sub1`/`sub2` xem hoa hồng có về đúng người và đúng đơn không.

---

## 7. Phụ lục A — Dùng API trực tiếp của sàn hay qua mạng trung gian?

**Trả lời ngắn: dùng API chính thức của Shopee được, không bắt buộc phải qua AccessTrade.** Nhưng có mấy điều phải biết trước.

### 7.1. Shopee có **hai** API khác nhau — đừng nhầm

Đây là chỗ nhầm lẫn phổ biến nhất, chọn sai thì mất hàng tuần mà không làm được gì.

| | Shopee Open Platform | **Shopee Affiliate Open API** |
|---|---|---|
| Dành cho | **Người bán** — quản lý shop của chính mình | **Người tiếp thị** — tạo link, lấy hoa hồng |
| Làm được gì | Sản phẩm, đơn hàng, tồn kho, vận chuyển của shop bạn | Sinh link tracking, tra cứu hoa hồng phát sinh |
| Dùng cho hoàn tiền? | ❌ **Không** — bạn chỉ thấy đơn của shop bạn, không thấy đơn người dùng mua ở shop khác | ✅ **Đây mới là cái cần** |
| Endpoint | `open.shopee.com` | `open-api.affiliate.shopee.vn/graphql` |

Nhiều người đăng ký Open Platform rồi tưởng mình đã có API để làm hoàn tiền — không phải.

### 7.2. So sánh hai hướng

| Tiêu chí | **Shopee trực tiếp** | **Qua AccessTrade / MAS** |
|---|---|---|
| Quan hệ | Bạn là affiliate của Shopee | Bạn là publisher của AccessTrade; AccessTrade mới là affiliate của Shopee |
| Hoa hồng nhận được | Cao hơn — Shopee trả thẳng | Thấp hơn — mạng giữ một phần |
| Phủ sàn | Chỉ **Shopee** | Shopee + Lazada + TikTok Shop + nhiều sàn khác |
| Số tích hợp phải làm | Mỗi sàn một bộ API riêng | **Một** tích hợp dùng cho tất cả |
| Xác thực | GraphQL + chữ ký SHA256 (tự viết, dễ sai) | REST + token (đơn giản hơn) |
| Nhận chuyển đổi | **Truy vấn báo cáo định kỳ** (cron) | **Postback** đẩy về (realtime) |
| Duyệt | Duyệt affiliate **+** duyệt quyền gọi API | Chỉ cần tài khoản publisher |
| Rủi ro | Tự chịu nếu sai sót kỹ thuật | Phụ thuộc tỷ lệ cắt của mạng |

### 7.3. Vấn đề lớn nhất với **app này cụ thể**

Giao diện hiện tại đang quảng cáo **3 sàn: Shopee, TikTok, Lazada** (`components/create-order.html`).

API Shopee chỉ phủ Shopee. Nếu đi hướng trực tiếp, muốn đủ 3 sàn bạn phải xin **3 chương trình độc lập**, mỗi cái một bộ API, một quy trình duyệt, một định dạng báo cáo chuyển đổi khác nhau — và mỗi cái đều có thể từ chối bạn.

Đó chính xác là lý do các mạng trung gian tồn tại.

**Gợi ý thực tế:** dùng **một mạng trung gian** cho cả 3 sàn (một tích hợp, một postback, một bảng đối soát), rồi **sau này** khi Shopee đã chiếm phần lớn doanh thu mới tách riêng Shopee ra đi trực tiếp để ăn phần hoa hồng mà mạng đang cắt. Kiến trúc provider đa hình ở mục 3.2 được thiết kế đúng cho lộ trình này: đổi `AFFILIATE_PROVIDER` trong `.env`, không phải viết lại gì.

### 7.4. Nếu vẫn muốn đi thẳng với Shopee

Trình tự:

1. Đăng ký chương trình affiliate tại `affiliate.shopee.vn`, chờ được duyệt.
2. Trong trang affiliate, tìm mục **API / Tools** để lấy **App ID** và **Secret** (đây là bước duyệt riêng, không phải cứ là affiliate là có).
3. Gọi thử `generateShortLink` bằng Postman với chữ ký đúng để chắc chắn quyền đã thông.
4. Xác nhận **cách lấy báo cáo chuyển đổi** (query nào, khoảng thời gian tối đa, có postback hay không).
5. Xác nhận **giới hạn `sub_id`** (số ký tự, số lượng) để đặt mã cho vừa.
6. Rồi mới bắt tay code provider.

---

## 8. Phụ lục B — Các cách chuyển đổi link Shopee thành link affiliate

Toàn bộ các cách đang có trên thực tế, xếp theo mức độ tự động hoá.

> Tình trạng các mạng bên dưới đã **kiểm tra tháng 10/2026** — nhưng ngành này thay đổi nhanh,
> bạn nên tự vào lại xác nhận trước khi đăng ký.

### 8.1. Bảng tổng hợp

| # | Cách | Tự động hoá | Cần gì để bắt đầu | Phủ sàn |
|---|---|---|---|---|
| 1 | Tạo link tay trên dashboard Shopee Affiliate | ❌ Làm tay từng link | Được duyệt làm affiliate | Chỉ Shopee |
| 2 | **Shopee Affiliate Open API** (`generateShortLink`) | ✅ Hoàn toàn | Duyệt affiliate **+** App ID & Secret | Chỉ Shopee |
| 3 | **API mạng trung gian** (AccessTrade / Adpia / Ecomobi / MAS) | ✅ Hoàn toàn | Tài khoản publisher + API key + campaign id | Shopee, Lazada, TikTok, nhiều sàn khác |
| 4 | Tạo link hàng loạt trên dashboard mạng trung gian | ⚠️ Bán tự động (nhập tay, xuất file) | Tài khoản publisher | Nhiều sàn |
| 5 | Extension / bookmarklet của mạng | ❌ Làm tay từng link | Cài extension vào trình duyệt | Nhiều sàn |
| 6 | Bọc link riêng `/r/<mã>` rồi chuyển tiếp | — | — | **Không tự tạo hoa hồng** — chỉ là lớp vỏ, xem 8.5 |

### 8.2. Chi tiết

**Cách 1 — Tạo link tay trên dashboard Shopee Affiliate.** Sau khi được duyệt vào `affiliate.shopee.vn`, có sẵn công cụ nhập link sản phẩm → trả về link hoàn tiền. Dùng được ngay, không cần code, nhưng **không thể đưa vào hệ thống tự động** — mỗi đơn phải làm tay một lần. Chỉ phù hợp để kiểm tra luồng hoạt động thế nào.

**Cách 2 — Shopee Affiliate Open API.** Đây là cách "chính chủ", hoa hồng cao nhất vì không qua trung gian. Endpoint đã kiểm chứng ở mục 3.2. Nhược điểm: chỉ phủ Shopee, và phải tự viết chữ ký SHA256.

**Cách 3 — API mạng trung gian.** Một tích hợp dùng cho nhiều sàn. Các mạng ở Việt Nam (đã kiểm tra còn hoạt động):

| Mạng | Trang | Ghi chú |
|---|---|---|
| **AccessTrade** | `accesstrade.vn` | Lớn nhất VN. Có nhiều nhánh publisher (Affiliate, Mobile, KOC, D2C). Có postback. |
| **Adpia** | `adpia.vn` | Có nhánh affiliate publisher riêng, hỗ trợ cả Lazada/TikTok |
| **Ecomobi** | `ecomobi.com` | Mục **API Overview** dành riêng cho publisher, có "tạo nhiều tracking link cho campaign" — đúng thứ cần |
| **MAS** (trước là Masoffer) | `mas.vn` | Trang dựng bằng JS, cần mở bằng trình duyệt để xem đầy đủ |
| ~~VoiBan~~ | `voiban.vn` | **Không truy cập được** khi kiểm tra — nhiều khả năng đã ngừng hoạt động |

Các mạng này về bản chất **đều là affiliate của Shopee**, chỉ khác ở chỗ họ gom nhiều sàn vào một API và ăn một phần hoa hồng.

**Cách 4 — Tạo link hàng loạt trên dashboard.** Nhiều mạng cho dán một danh sách link rồi xuất ra danh sách link hoàn tiền. Không phải API nhưng đỡ tay hơn cách 1. Có thể dùng làm phương án chữa cháy khi API trục trặc.

**Cách 5 — Extension / bookmarklet.** Nhiều mạng phát hành extension trình duyệt: bấm một nút là link hiện tại trên tab được đổi thành link hoàn tiền. Rất tiện cho **người dùng của bạn**, nhưng **không tự động hoá được vào backend** — không thể gọi từ server.

### 8.3. Bốn cách **KHÔNG** hoạt động — đừng mất thời gian

| Cách tưởng là được | Thực tế |
|---|---|
| Thêm `?ref=gzafl`, `?aff_id=123`, `?utm_source=...` vào link Shopee | ❌ Shopee **bỏ qua** mọi tham số lạ. Không sinh hoa hồng. |
| Rút gọn link bằng bit.ly / tinyurl | ❌ Chỉ là rút gọn. Đích vẫn là link thường, không có ghi nhận. |
| Tự sửa `sub_id` trong một link affiliate có sẵn | ❌ `sub_id` phải do **tài khoản affiliate của bạn** phát ra. Sửa chuỗi trong link người khác không tạo ra quyền ghi nhận. |
| Dùng link affiliate của người khác rồi tự tính tiền cho user | ❌ Hoa hồng sẽ về tài khoản của người đó, không phải bạn. Không có dữ liệu chuyển đổi để đối chiếu. |

### 8.4. Ba thứ **bắt buộc** phải có, dù chọn cách nào

1. **Tài khoản affiliate đã được duyệt** — không có đường vòng. Đây là bước chặn tiến độ, và là việc chỉ bạn làm được.
2. **`sub_id`** — mã định danh người dùng trong link. Không có nó thì mọi user dùng chung một link và bạn không biết trả tiền cho ai.
3. **Nguồn dữ liệu chuyển đổi** — postback (mạng đẩy về) hoặc truy vấn báo cáo định kỳ (mình tự hỏi). Xem mục 3.6.

### 8.5. Kỹ thuật bọc link và vì sao vẫn nên làm

Cách 6 ở bảng trên — trả về `/r/<mã>` rồi server 302 sang link affiliate thật — **không tự sinh ra hoa hồng**. Nhưng vẫn nên làm, vì:

| Lợi ích | Giải thích |
|---|---|
| Đếm được lượt click | Biết bao nhiêu người thực sự bấm, tỷ lệ tạo link → mua hàng |
| **Đổi nhà cung cấp không hỏng link cũ** | Đây là lý do quan trọng nhất. Link đã phát cho người dùng vẫn là `/r/GZ102218`; ngày mai chuyển từ AccessTrade sang Shopee trực tiếp thì chỉ sửa logic chuyển hướng, **link trong tay người dùng không đổi** |
| Gắn `sub_id` muộn | Link cũ phát trước khi có tài khoản affiliate vẫn dùng lại được |
| Che link affiliate | Người dùng không thấy link gốc để tự ý mua qua đường khác |

⚠️ **Lưu ý mobile:** trên điện thoại, link affiliate Shopee thường có dạng mở app. Bọc qua `/r/` phải chuyển hướng đúng cách, nếu không app Shopee sẽ không tự bật lên và người dùng mất phiên ghi nhận. Đây là lỗi rất hay gặp — phải test trên điện thoại thật, không chỉ trên máy tính.

### 8.6. Khuyến nghị cho app này

| Giai đoạn | Làm gì | Vì sao |
|---|---|---|
| **1. Ngay bây giờ** | Provider `mock` + bọc link `/r/<mã>` + sửa giao diện trả link kèm nút Copy | Hoàn thiện toàn bộ luồng, **không cần chờ ai duyệt** |
| **2. Khi có tài khoản** | Cắm **một** mạng trung gian (AccessTrade hoặc Ecomobi) cho cả 3 sàn | Một tích hợp phủ hết Shopee + TikTok + Lazada |
| **3. Khi Shopee đủ lớn** | Tách Shopee ra gọi thẳng Open API | Ăn phần hoa hồng mà mạng đang cắt |

Nhờ kiến trúc provider đa hình ở mục 3.2, cả 3 giai đoạn chỉ là **đổi một dòng `.env`** — không phải viết lại gì.
