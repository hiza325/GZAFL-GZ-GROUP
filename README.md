# GZ AFL — Nền tảng Affiliate / Hoàn tiền

Ứng dụng web hoàn tiền affiliate (Shopee / TikTok Shop / Tiki / Lazada) gồm 2 phần:

- **Frontend**: HTML + Tailwind CSS + JavaScript thuần (`index.html`, `script.js`, `style.css`, `components/`). Tailwind được **build sẵn thành file `tailwind.build.css`** — không phụ thuộc CDN, không cần Internet khi chạy.
- **Backend**: Node.js + Express + SQLite (`backend/`) — quản lý tài khoản, đơn hàng, ví, rút tiền và mã giới thiệu.

Backend phục vụ luôn frontend nên cả hai chạy **cùng một địa chỉ** (`http://localhost:3000`). Nhờ vậy phiên đăng nhập dùng cookie `httpOnly` và không cần cấu hình CORS.

---

## Yêu cầu

- **Node.js >= 22.5** (backend dùng module `node:sqlite` có sẵn, không cần cài native module).
- Không cần cài database riêng — SQLite lưu thành file.

Kiểm tra phiên bản:

```bash
node -v
```

---

## Cách chạy

```bash
cd backend
npm install
npm start
```

Sau đó mở: **http://localhost:3000**

> ⚠️ **Không mở trực tiếp `index.html` bằng `file://`** — giao diện được tải qua `fetch()` và cần backend, mở kiểu file sẽ bị trắng trang.

Chạy chế độ tự nạp lại khi sửa code:

```bash
npm run dev
```

> Cấu hình (cổng, khoá bí mật, nhà cung cấp hoàn tiền...) đọc từ file **`backend/.env`**.
> Sao chép `backend/.env.example` thành `backend/.env` rồi sửa. File này đã được bỏ qua khi commit.

### Giao diện (Tailwind CSS)

CSS đã được build sẵn thành `tailwind.build.css` và commit vào repo, nên **chạy web không cần bước build nào**.

Chỉ khi bạn **thêm/sửa class Tailwind** trong `index.html`, `script.js`, `admin.js` hoặc `components/*.html` thì mới phải build lại:

```bash
npm install        # chỉ lần đầu (cài Tailwind cho phần giao diện)
npm run build:css  # build lại tailwind.build.css
```

Khi đang sửa giao diện, có thể để nó tự build lại mỗi lần lưu file:

```bash
npm run watch:css
```

> Quên build lại thì class mới sẽ **không có tác dụng** (giao diện thiếu định dạng) — đây là đánh đổi để bỏ được CDN.

### Biến môi trường (tuỳ chọn)

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `PORT` | `3000` | Cổng của server |
| `NODE_ENV` | `development` | Đặt `production` để bật kiểm tra bảo mật nghiêm ngặt |
| `JWT_SECRET` | `gzafl-dev-secret-change-me` | Khóa ký token phiên — **bắt buộc đổi khi triển khai thật**. Ở `NODE_ENV=production` server **từ chối khởi động** nếu khoá trống, vẫn là khoá mặc định, hoặc ngắn hơn 32 ký tự |
| `SSL_KEY_PATH`, `SSL_CERT_PATH` | – | Điền vào để server tự chạy HTTPS (không cần nếu đã có Nginx/Caddy) |
| `TRUST_PROXY` | – | Bật khi chạy sau reverse proxy (`1` / `true` / danh sách IP) — cần để cookie `secure` và link hoàn tiền dùng đúng `https` |
| `PUBLIC_BASE_URL` | – | URL công khai đầy đủ, ví dụ `https://gzafl.example.com`. Dùng cho link mock và dòng hướng dẫn postback lúc khởi động; nên đặt khi chạy sau proxy |
| `COOKIE_SECURE` | theo `NODE_ENV` | Ghi đè cờ `secure` của cookie phiên |
| `DB_PATH` | `backend/data/gzafl.sqlite` | Đường dẫn file database |
| `WITHDRAWAL_MIN` | `1000` | Số dư khả dụng tối thiểu để được gửi yêu cầu rút tiền (đồng) |
| `AFFILIATE_PROVIDER` | `mock` | Nhà cung cấp chuyển đổi link: `mock` / `accesstrade` / `shopee` |
| `AFFILIATE_LIVE_PLATFORMS` | tất cả | Giới hạn sàn dùng API thật, ví dụ `TikTok Shop, Tiki`. Các sàn còn lại tạm dùng link thử nghiệm; mỗi đơn lưu `affiliate.isReal` để giao diện hiển thị rõ **link thật** hay **chưa gắn hoa hồng** |
| `AFFILIATE_SUB_ID_PREFIX` | `gzafl` | Tiền tố `sub_id` gắn vào link để biết hoa hồng thuộc về ai |
| `CASHBACK_RATE` | `1` | Tỷ lệ hoàn tiền cho người dùng so với hoa hồng **mạng đã duyệt** (`0.7` = hoàn 70%, giữ 30%). Chỉ áp dụng cho tiền do mạng báo về tự động; con số này được in ra lúc khởi động nên nhớ kiểm tra trước khi chạy thật |
| `ACCESSTRADE_API_KEY` | – | Token API của AccessTrade |
| `ACCESSTRADE_CAMPAIGN_SHOPEE` / `_TIKTOK` / `_TIKI` / `_LAZADA` | – | Campaign ID riêng cho từng sàn (giữ **dạng chuỗi**) |
| `ACCESSTRADE_CAMPAIGN_ID` | – | Tuỳ chọn: campaign mặc định nếu sàn chưa có biến riêng |
| `ACCESSTRADE_SHORT_DOMAIN` | – | Tuỳ chọn: domain rút gọn riêng đã đăng ký với AccessTrade |
| `POSTBACK_SECRET` | – | Chìa khoá xác thực báo cáo chuyển đổi (postback). **Bỏ trống thì mọi postback bị từ chối** (xem mục [Nhận hoa hồng về](#nhận-hoa-hồng-về--đối-soát-postback)) |
| `POSTBACK_PARAM_*` | dò tự động | Ép tên tham số mạng gửi về: `_SECRET`, `_TRANSACTION`, `_PRODUCT`, `_CONVERSION`, `_REWARD`, `_STATUS`, `_SUB` |
| `EMAIL_OTP` | `auto` | Bước xác thực email: `auto` (bật khi đã cấu hình SMTP, hoặc khi chạy `development`) / `on` / `off`. Áp dụng cho **đăng ký**, **quên mật khẩu** và **đổi email** |
| `LOGIN_OTP` | `auto` | Bước xác thực khi **đăng nhập**: `auto` (bật khi `EMAIL_OTP` đang bật **và** gửi được thư) / `on` (luôn bắt buộc) / `off` (đăng nhập chỉ cần mật khẩu). Công tắc "cứu hộ" khi máy chủ thư gặp sự cố |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` | – | Máy chủ gửi thư dùng cho mã xác thực. Bỏ trống `SMTP_SECURE` thì tự suy ra (`true` khi cổng `465`) |
| `SMTP_USER`, `SMTP_PASS` | – | Tài khoản gửi thư (Gmail thì dùng *Mật khẩu ứng dụng* 16 ký tự) |
| `MAIL_FROM`, `MAIL_FROM_NAME` | theo `SMTP_USER`, tên `GZ AFL` | Địa chỉ và tên người gửi hiện trên thư |
| `SUPPORT_EMAIL`, `SUPPORT_ZALO` | – | Thông tin liên hệ hiển thị ở trang Trợ giúp (bỏ trống thì dùng giá trị mặc định trong `components/guide.html`) |
| `AI_API_KEY` | – | Khoá API cho **trợ lý hỗ trợ (chatbot)**. Bỏ trống thì trợ lý trả lời theo kịch bản có sẵn trong `backend/lib/supportKnowledge.js`. Điền khoá là trợ lý trả lời bằng AI (xem mục [Trợ lý hỗ trợ (chatbot)](#trợ-lý-hỗ-trợ-chatbot)) |
| `AI_BASE_URL`, `AI_MODEL` | tự đoán theo khoá | Địa chỉ API và tên model (chuẩn OpenAI). Chỉ cần khi muốn chỉ định rõ nhà cung cấp |
| `AI_ENABLED` | `true` | `off` để tạm tắt AI (vẫn giữ khoá) mà không phải xoá cấu hình |
| `AI_TIMEOUT_MS`, `AI_MAX_TOKENS`, `AI_TEMPERATURE` | `25000`, `2048`, `0.4` | Thời gian chờ tối đa, độ dài và độ "sáng tạo" của câu trả lời (Gemini 2.5 dùng thêm token "suy nghĩ" trong trần này) |
| `AI_DAILY_LIMIT` | `800` | Trần **tổng** số lượt gọi AI mỗi ngày (mọi IP cộng lại). Vượt trần thì trợ lý vẫn trả lời nhưng bằng kịch bản có sẵn. `0` = không giới hạn |

> **Chưa có tài khoản email?** Cứ để trống. Khi chạy `development`, bước xác thực vẫn bật nhưng **thư chỉ được in ra màn hình console** của server (mã cũng được trả về trong API) để bạn thử ngay — xem mục [Xác thực email (OTP)](#xác-thực-email-otp).

Tạo khoá `JWT_SECRET` ngẫu nhiên:

```bash
cd backend
npm run gen-secret              # chỉ in ra màn hình
npm run gen-secret -- --write   # ghi thẳng vào backend/.env
```

> Đổi `JWT_SECRET` làm mọi phiên đăng nhập hiện tại hết hiệu lực — mọi người chỉ cần đăng nhập lại.

---

## Cấu trúc

```
index.html                 # Khung trang + modal rút tiền
style.css                  # CSS viết tay dùng chung
tailwind.build.css         # CSS Tailwind đã build (KHÔNG sửa tay - xem mục "Giao diện")
package.json               # Công cụ build CSS (không phải gói chạy server)
tailwind.config.js         # Cấu hình Tailwind: nơi Tailwind quét tên class
styles/tailwind.css        # File nguồn của Tailwind
script.js                  # Toàn bộ logic frontend (gọi API)
admin.js                   # Logic riêng của trang quản trị (chỉ tải khi mở trang này)
support.js                 # Logic khung trợ lý hỗ trợ (chatbot) ở góc phải-dưới
components/                # Các mảnh giao diện (landing, sidebar, header, các trang...)
  admin.html               # Giao diện trang quản trị
  support-widget.html      # Khung chat + nút tròn của trợ lý hỗ trợ
  guide.html               # Nội dung Trợ giúp / Điều khoản (dùng cho cả trang trong app và modal ở trang chủ)
LOGO.png                   # Logo thương hiệu (menu trái + thanh trên trang chủ + favicon)
CHATBOT.png                # Logo của trợ lý hỗ trợ (nút tròn + ô đầu khung chat)
README.md
docs/                      # Tài liệu kỹ thuật
  affiliate-integration.md # Thiết kế tích hợp chuyển đổi link hoàn tiền (chi tiết + các phương án)
  deployment.md            # Hướng dẫn đưa lên production (HTTPS, JWT_SECRET, Nginx, PM2...)

backend/
  server.js                # Khởi tạo Express: API + link rút gọn /r/<mã đơn> + phục vụ frontend tĩnh
  db.js                    # Kết nối SQLite + tạo bảng + tự nâng cấp cột khi có bản mới
  package.json
  .env.example             # Mẫu cấu hình - sao chép thành .env rồi điền
  scripts/
    make-admin.js          # Cấp / thu quyền quản trị từ dòng lệnh
    reset-password.js      # Đặt lại mật khẩu khi quên / bị khoá tài khoản
    generate-secret.js     # Sinh JWT_SECRET ngẫu nhiên
    start-prod.js          # Khởi động ở chế độ production (chạy được trên Windows)
  lib/
    env.js                 # Nạp backend/.env + các cờ cấu hình dùng chung
    auth.js                # JWT, cookie phiên, middleware requireAuth / requireAdmin
    constants.js           # Trạng thái đơn/lệnh rút, vai trò, mức rút tối thiểu
    validate.js            # Kiểm tra email/SĐT, sinh mã đơn/mã giới thiệu
    serialize.js           # Chuyển dữ liệu DB -> JSON cho frontend
    format.js              # Định dạng ngày/tiền kiểu Việt Nam
    rateLimit.js           # Giới hạn số yêu cầu cho API đăng nhập
    banks.js               # Danh sách ngân hàng / ví điện tử cho dropdown rút tiền
    affiliate.js           # Chuyển link sản phẩm -> link hoàn tiền (mock / accesstrade / shopee)
    postback.js            # Nhận & xử lý báo cáo chuyển đổi từ mạng affiliate (chống trùng, cộng dồn theo đơn)
    mailer.js              # Gửi email qua SMTP (in ra console khi chưa cấu hình ở môi trường dev)
    otp.js                 # Sinh / kiểm tra mã xác thực email (OTP) cho đăng ký và quên mật khẩu
    notify.js              # Ghi thông báo cho người dùng
    supportKnowledge.js    # Kiến thức nền của trợ lý hỗ trợ (dùng cho cả chế độ AI và chế độ kịch bản)
    ai.js                  # Gọi API AI chuẩn OpenAI (Gemini / Groq / OpenRouter / OpenAI...)
  routes/
    auth.js                # Đăng ký (2 bước kèm mã xác thực) / đăng nhập / đăng xuất / me / quên mật khẩu
    orders.js              # Danh sách + tạo đơn hàng (kèm chuyển đổi link)
    wallet.js              # Thống kê ví + rút tiền
    referral.js            # Mã giới thiệu + nhập mã
    profile.js             # Cập nhật hồ sơ, avatar, ảnh QR nhận tiền + đổi mật khẩu
    notifications.js       # Danh sách thông báo + đánh dấu đã đọc
    support.js             # Trợ lý hỗ trợ: nhận câu hỏi, trả lời bằng AI hoặc theo kịch bản
    admin.js               # API quản trị (chỉ role = 'admin')
  data/                    # File SQLite (tự sinh, đã bỏ qua khi commit)
  uploads/                 # Ảnh đại diện + ảnh QR nhận tiền do người dùng tải lên
```

---

## Xác thực email (OTP)

Khi đăng ký, hệ thống gửi một **mã 6 chữ số** tới email người dùng nhập; nhập đúng mã mới tạo được tài khoản. Cùng cơ chế đó cho phép khách **tự đặt lại mật khẩu** khi quên, và dùng làm **xác thực 2 lớp khi đăng nhập**.

- **Email là bắt buộc khi đăng ký**, kể cả khi đăng nhập bằng số điện thoại.
- **Email dùng làm tên đăng nhập phải trùng đúng email nhận mã xác thực.** Nếu không, người khác có thể “giữ chỗ” email của bạn bằng một email khác. Email cũng được chuẩn hoá lowercase và **không thể dùng cho hai tài khoản**.
- **Đổi email trong trang Cá nhân cũng phải xác thực**: mã được gửi tới *địa chỉ mới* rồi mới lưu, nên email khôi phục luôn là địa chỉ thật. Chỉ đổi tên/số điện thoại thì không cần mã.
- **Đăng nhập 2 bước** (khi `LOGIN_OTP` bật): mật khẩu đúng thì server mới gửi mã, sau đó mới cấp phiên. Mã còn hiệu lực thì **dùng lại mã cũ** — đăng xuất rồi đăng nhập lại ngay không tốn thêm thư.
- Mã có hiệu lực **10 phút**, chỉ dùng được **một lần**, lưu dưới dạng **bcrypt hash** (không lưu mã gốc). Mã của luồng này **không dùng được** cho luồng khác.
- Nhập sai quá **5 lần** thì phải yêu cầu mã mới; mỗi lần yêu cầu lại phải chờ **60 giây**, tối đa **5 mã/giờ** cho mỗi email.
- Mỗi IP chỉ được yêu cầu gửi mã **10 lần / 15 phút** (đăng ký & khôi phục mật khẩu) và **40 lần / 15 phút** (đăng nhập).
- Bước yêu cầu gửi mã **luôn trả về cùng một thông báo** dù tài khoản có tồn tại hay không — người ngoài không dò được danh sách tài khoản.
- Nếu ai đó thử **đăng ký trùng** email/tài khoản đã có: hệ thống **không gửi mã đăng ký** và **không tạo tài khoản mới**, nhưng gửi một thư báo *"tài khoản đã tồn tại — hãy đăng nhập hoặc dùng Quên mật khẩu"* tới **đúng email đã đăng ký của chủ tài khoản** (không gửi tới email người lạ vừa nhập), tối đa **1 thư / 30 phút**. Nhờ vậy chủ tài khoản biết chuyện, còn người dò tài khoản vẫn không nhận được thông tin gì.

### Chưa có tài khoản email?

`EMAIL_OTP=auto` (mặc định) xử lý như sau:

| Tình huống | Kết quả |
|---|---|
| `development`, chưa cấu hình SMTP | Bước xác thực **vẫn bật**, nhưng thư chỉ được **in ra console** của server; mã cũng trả về ở trường `devCode` nên hiện luôn trong ô vàng "mã thử nghiệm" ngay trên giao diện để bạn thử |
| `production`, chưa cấu hình SMTP | Bước xác thực **tự tắt** kèm cảnh báo lúc khởi động, để không chặn mất việc đăng ký |
| Đã điền `SMTP_*` + `MAIL_FROM` | Gửi thư thật |

Muốn tự quyết định thì đặt `EMAIL_OTP=on` (luôn bật) hoặc `EMAIL_OTP=off` (luôn tắt).

Riêng bước xác thực **khi đăng nhập** có công tắc riêng là `LOGIN_OTP`:

| `LOGIN_OTP` | Kết quả |
|---|---|
| `auto` *(mặc định)* | Bật khi `EMAIL_OTP` đang bật **và** gửi được thư. Chưa cấu hình SMTP thì đăng nhập vẫn chỉ cần mật khẩu — **tránh khoá toàn bộ người dùng ra ngoài** |
| `on` | Luôn bắt buộc mã. CẢNH BÁO: chưa cấu hình SMTP thì **không ai đăng nhập được** |
| `off` | Đăng nhập chỉ cần mật khẩu. Dùng khi máy chủ thư gặp sự cố |

> **Lưu ý về hạn mức gửi thư**: mỗi lần đăng nhập tốn 1 email. Gmail cá nhân chỉ cho ~**500 thư/ngày** (Brevo miễn phí ~300/ngày). Nếu số lượt đăng nhập mỗi ngày lớn, hãy chuyển sang dịch vụ gửi thư chuyên dụng hoặc đặt `LOGIN_OTP=off`.

### Cấu hình gửi thư

Điền vào `backend/.env` — mẫu có sẵn trong `backend/.env.example`. Với Gmail: bật xác thực 2 lớp rồi tạo **Mật khẩu ứng dụng** 16 ký tự và dùng nó làm `SMTP_PASS`.

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=ten-ban@gmail.com
SMTP_PASS=abcd efgh ijkl mnop
MAIL_FROM=ten-ban@gmail.com
MAIL_FROM_NAME=GZ AFL
```

Cần tỉ lệ vào Inbox tốt hơn Gmail thì dùng Brevo (`smtp-relay.brevo.com`, miễn phí 300 thư/ngày).

### Quên mật khẩu có 2 đường

1. **Tự đặt lại (mặc định)**: khách bấm **"Quên mật khẩu?"** → nhận mã qua email → nhập mã kèm mật khẩu mới. Xong ngay, không cần quản trị viên.
2. **Nhờ quản trị viên (dự phòng)**: dùng khi tài khoản **chưa có email**, khi hệ thống chưa gửi được thư, hoặc khi khách không nhận được mail. Yêu cầu vào tab **Khôi phục mật khẩu** của trang quản trị.

Đặt lại mật khẩu thành công bằng đường nào cũng **tự đóng** yêu cầu đang chờ của đường kia, và làm **mọi phiên đăng nhập cũ hết hiệu lực**.

---

## Trợ lý hỗ trợ (chatbot)

Góc phải-dưới của **mọi trang** (kể cả trang chủ với khách chưa đăng nhập) có một nút tròn mở khung chat hỗ trợ:

- Trả lời các câu hỏi thường gặp: tạo đơn/lấy link hoàn tiền, thời gian ghi nhận hoa hồng, rút tiền (mức tối thiểu, ảnh QR), mã OTP, mời bạn bè, bảo mật...
- Nút **"Liên hệ hỗ trợ"** ngay trong khung chat: hiện số điện thoại/Zalo và email (lấy từ `SUPPORT_ZALO`, `SUPPORT_EMAIL`) kèm nút copy.
- **Gợi ý câu hỏi** sẵn ở trên ô nhập — bấm là hỏi luôn.
- **Nhớ hội thoại**: lịch sử chat lưu trong trình duyệt (`localStorage`), tải lại trang không mất. Server **không lưu** nội dung chat.
- Muốn đổi ảnh của trợ lý: thay file `CHATBOT.png` ở thư mục gốc (ảnh vuông, nền tối) — dùng cho cả nút tròn lẫn ô logo ở đầu khung chat.

### Hai chế độ hoạt động

| Chế độ | Khi nào | Trả lời thế nào |
|---|---|---|
| **Theo kịch bản** | Chưa đặt `AI_API_KEY` | Khớp từ khoá trong câu hỏi (gõ có dấu hay không dấu đều được) với bộ kiến thức trong `backend/lib/supportKnowledge.js`. Miễn phí, không cần Internet |
| **Dùng AI** | Đã đặt `AI_API_KEY` | Gọi API AI chuẩn OpenAI, kèm `system prompt` chứa đúng bộ kiến thức trên nên không bịa thêm chính sách |

Nếu AI gặp lỗi (sai khoá, hết hạn mức, mất mạng), trợ lý **tự lùi về chế độ kịch bản** để khách vẫn nhận được câu trả lời.

### Bật trợ lý AI (chọn 1 nhà cung cấp)

Chỉ cần điền `AI_API_KEY` vào `backend/.env` rồi **khởi động lại server** — hệ thống tự đoán nhà cung cấp theo tiền tố khoá và in ra lúc khởi động. Muốn chắc chắn thì điền thêm `AI_BASE_URL` + `AI_MODEL`:

| Nhà cung cấp | `AI_BASE_URL` | `AI_MODEL` gợi ý | Ghi chú |
|---|---|---|---|
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-3.5-flash-lite` | Có gói miễn phí — [aistudio.google.com/apikey](https://aistudio.google.com/apikey) (khoá dạng `AIza...` hoặc `AQ....` đều dùng được). Dùng `gemini-3.5-flash` nếu cần chất lượng cao hơn |
| Groq | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` | Có gói miễn phí — [console.groq.com/keys](https://console.groq.com/keys) |
| OpenRouter | `https://openrouter.ai/api/v1` | `meta-llama/llama-3.3-70b-instruct:free` | Có model miễn phí — [openrouter.ai/keys](https://openrouter.ai/keys) |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` | Trả phí |

Kiểm tra nhanh sau khi khởi động lại:

```bash
curl http://localhost:3000/api/support/status
# {"ai":true,"provider":"Google Gemini","model":"gemini-3.5-flash-lite","maxTokens":2048,"dailyLimit":800,"usedToday":0}
```

> Khoá API **chỉ nằm ở server**, không bao giờ gửi xuống trình duyệt. Mỗi IP được hỏi tối đa **30 tin nhắn / 10 phút** (chống spam, tránh cháy hạn mức khoá API). Muốn tạm tắt AI mà vẫn giữ khoá: đặt `AI_ENABLED=off`.

### Muốn trợ lý trả lời đúng hơn?

Sửa nội dung trong `backend/lib/supportKnowledge.js` — file đó là **nguồn duy nhất** cho cả 2 chế độ (chế độ AI đọc nó trong `system prompt`, chế độ kịch bản khớp từ khoá với nó). Thêm câu hỏi vào `SUGGESTIONS` là khung chat có thêm nút gợi ý.

---

## API

Tất cả API nằm dưới `/api`, trả về JSON. Các API cần đăng nhập dùng cookie phiên.

| Method | Đường dẫn | Mô tả |
|---|---|---|
| GET | `/api/health` | Kiểm tra server sống |
| GET | `/api/config` | Cấu hình công khai cho giao diện (thông tin liên hệ hỗ trợ, có bật xác thực email hay không, câu hỏi gợi ý của trợ lý) |
| POST | `/api/auth/register/otp` | Bước 1 khi đăng ký: gửi mã xác thực `{ username, name, email }` (giới hạn 10 lần / 15 phút) |
| POST | `/api/auth/register` | Bước 2: tạo tài khoản `{ username, password, name, email, otp }` |
| POST | `/api/auth/login` | Đăng nhập. Nếu bật xác thực khi đăng nhập thì trả về `{ otpRequired: true, ticket, email, resendInSeconds, devCode }` thay vì đặt cookie |
| POST | `/api/auth/login/otp` | Bước 2 của đăng nhập: `{ ticket, otp }` → đặt cookie phiên (giới hạn 40 lần / 15 phút) |
| POST | `/api/auth/login/otp/resend` | Gửi lại mã đăng nhập `{ ticket }` (không cần nhập lại mật khẩu) |
| POST | `/api/auth/logout` | Đăng xuất |
| GET | `/api/auth/me` | Người dùng hiện tại (`null` nếu chưa đăng nhập) |
| POST | `/api/auth/forgot-password/otp` | Quên mật khẩu bước 1: gửi mã xác thực `{ username }` |
| POST | `/api/auth/forgot-password/confirm` | Quên mật khẩu bước 2: `{ username, otp, newPassword }` |
| POST | `/api/auth/forgot-password` | Đường dự phòng: gửi yêu cầu cho quản trị viên `{ username, note }` |
| GET | `/api/orders` | Danh sách đơn hàng của mình (kèm link hoàn tiền, `sub_id`, số lượt bấm) |
| POST | `/api/orders` | Tạo đơn `{ link }` → trả về `{ order, affiliate }` với link hoàn tiền |
| GET | `/api/wallet` | Thống kê ví + lịch sử rút tiền + `minWithdraw`, `canWithdraw` |
| POST | `/api/wallet/withdrawals` | Yêu cầu rút tiền. Chọn 1 trong 2: `{ mode: 'account', bank, accNum, accName }` hoặc `{ mode: 'qr' }` (dùng ảnh QR đã tải lên, không cần ngân hàng/STK) |
| GET | `/api/referral` | Mã giới thiệu, điểm, lịch sử đã nhập |
| POST | `/api/referral/redeem` | Nhập mã giới thiệu `{ code }` |
| GET | `/api/notifications` | Danh sách thông báo + số chưa đọc |
| POST | `/api/notifications/read-all` | Đánh dấu tất cả thông báo là đã đọc |
| POST | `/api/support/chat` | Hỏi trợ lý hỗ trợ `{ messages: [{ role: 'user'\|'assistant', content }] }` → `{ reply, source: 'ai'\|'faq', notice? }`. Không cần đăng nhập, giới hạn 30 lần / 10 phút mỗi IP |
| GET | `/api/support/status` | Kiểm tra trợ lý đang ở chế độ AI hay kịch bản (dùng khi cấu hình `AI_*` trong `.env`) |
| PUT | `/api/profile` | Cập nhật hồ sơ `{ name, email, phone }`. Nếu **đổi email** và đang bật xác thực thì phải kèm `emailOtp` |
| POST | `/api/profile/email/otp` | Gửi mã xác thực tới **email mới** khi đổi email `{ email }` (giới hạn 10 lần / 15 phút) |
| POST | `/api/profile/avatar` | Cập nhật ảnh đại diện `{ dataUrl }` |
| POST | `/api/profile/bank-qr` | Lưu **ảnh QR nhận tiền** `{ dataUrl }` — chỉ nhận ảnh PNG/JPG, tối đa 2MB (server kiểm tra cả chữ ký byte đầu file) |
| DELETE | `/api/profile/bank-qr` | Xoá ảnh QR nhận tiền đã lưu |
| PUT | `/api/profile/password` | Đổi mật khẩu `{ currentPassword, newPassword }` (tối đa 10 lần / 15 phút) |

Ngoài `/api`, server còn có một đường dẫn công khai:

| Method | Đường dẫn | Mô tả |
|---|---|---|
| GET | `/r/:code` | Link hoàn tiền rút gọn — đếm lượt bấm rồi chuyển hướng (302) sang link đích |
| GET/POST | `/api/postback/:provider` | **Điểm nhận báo cáo chuyển đổi** từ mạng affiliate (AccessTrade gọi GET). Không dùng cookie phiên; xác thực bằng `POSTBACK_SECRET`. Trả `403` khi sai chìa khoá, `503` khi chưa cấu hình, `200` khi đã ghi nhận (kể cả lần gọi trùng) |

### API quản trị (`/api/admin`)

Tất cả API dưới đây **yêu cầu tài khoản có `role = 'admin'`**. Người chưa đăng nhập nhận `401`, người dùng thường nhận `403`.

| Method | Đường dẫn | Mô tả |
|---|---|---|
| GET | `/api/admin/overview` | Thống kê toàn hệ thống (người dùng, đơn, lệnh rút, tiền, yêu cầu khôi phục mật khẩu đang chờ) |
| GET | `/api/admin/users` | Danh sách người dùng (`q`, `limit`, `offset`) |
| PATCH | `/api/admin/users/:id` | Đổi `{ role, points }` |
| DELETE | `/api/admin/users/:id` | Xoá người dùng (xoá kèm đơn hàng/lệnh rút/lịch sử giới thiệu) |
| GET | `/api/admin/orders` | Danh sách đơn hàng (`status`, `q`, `limit`, `offset`) |
| PATCH | `/api/admin/orders/:code` | Đổi `{ status, commission }` |
| GET | `/api/admin/withdrawals` | Danh sách lệnh rút tiền (`status`, `q`, `limit`, `offset`) |
| PATCH | `/api/admin/withdrawals/:code` | Đổi `{ status, amount }` |
| GET | `/api/admin/referrals` | Lịch sử nhập mã giới thiệu (`limit`, `offset`) |
| GET | `/api/admin/postbacks` | **Nhật ký đối soát**: các lần mạng gọi postback (`q`, `status` = `pending`/`approved`/`rejected`, `only` = `matched`/`unmatched`/`refused`, `limit`, `offset`) + thống kê tổng |
| POST | `/api/admin/postbacks/:id/reapply` | Xử lý lại một log cũ (dùng khi postback về trước lúc đơn được tạo) |
| GET | `/api/admin/password-resets` | Hàng đợi yêu cầu khôi phục mật khẩu (`status`, `limit`, `offset`) |
| POST | `/api/admin/password-resets/:id/reset` | Đặt lại mật khẩu, trả về `tempPassword` **đúng một lần** (không lưu vào DB) |
| POST | `/api/admin/password-resets/:id/cancel` | Từ chối yêu cầu khôi phục |

Trạng thái hợp lệ:

- Đơn hàng: `Đang xử lý` → `Chờ đối soát` → `Hoàn thành` → `Đã thanh toán`, hoặc `Đã huỷ`.
- Lệnh rút tiền: `Đang xử lý` → `Đã thanh toán`, hoặc `Đã huỷ`.

> `Chờ đối soát` = mạng affiliate **đã ghi nhận** chuyển đổi nhưng chưa duyệt. Tiền của đơn nằm ở cột `network_commission` và **chưa được tính vào số dư** của người dùng — chỉ khi mạng báo đã duyệt mới ghi vào `commission`.

**Cách tiền được tính:** số dư ví của người dùng = tổng `commission` của các đơn **không bị huỷ** − tổng `amount` của các lệnh rút **không bị huỷ**. Vì vậy đánh dấu `Đã huỷ` sẽ loại đơn/lệnh đó khỏi phép tính, còn khi chuyển một lệnh rút sang `Đã thanh toán` thì phải nhập số tiền thực trả (không được vượt số dư khả dụng).

**Rút tiền:** người dùng không tự nhập số tiền — hệ thống ghi nhận **toàn bộ số dư khả dụng** tại thời điểm gửi. Nhờ vậy số tiền đó bị **giữ chỗ** ngay, không thể rút trùng. Các ràng buộc ở server (`backend/routes/wallet.js`):

- Số dư khả dụng phải đạt mức tối thiểu `WITHDRAWAL_MIN` (mặc định **1.000đ**) — chưa đủ thì trả `400` kèm số tiền còn thiếu.
- Mỗi tài khoản chỉ được có **một** lệnh rút `Đang xử lý`; gửi lệnh thứ hai nhận `409`.
- Ngân hàng/ví được chọn từ danh sách trong `backend/lib/banks.js` (khoảng 50 ngân hàng và ví điện tử, hiện ở dropdown và ở `GET /api/config`). Người dùng cũng có thể chọn **"Ngân hàng khác"** rồi tự ghi tên (tối đa 60 ký tự).
- Người dùng **chọn 1 trong 2** cách nhận tiền, không cần làm cả hai:
  - **Nhập số tài khoản**: bắt buộc có ngân hàng/ví + `accNum` + `accName`.
  - **Ảnh QR nhận tiền**: chỉ cần ảnh QR (chỉ nhận **PNG/JPG**, tối đa 2MB) — không cần nhập ngân hàng, số tài khoản hay tên chủ tài khoản vì QR đã có sẵn. Quản trị viên quét mã QR để chuyển tiền.
  - Ảnh QR được **chụp lại** vào lệnh rút lúc gửi, nên đổi ảnh sau này không làm thay đổi lệnh cũ; file ảnh chỉ bị xoá khi **không còn lệnh rút nào** dùng nó.
- Huỷ lệnh rút (`Đã huỷ`) sẽ **trả lại** số tiền vào số dư khả dụng.
- Quản trị viên có thể sửa số tiền thực trả khi đánh dấu `Đã thanh toán`, nhưng không được vượt số dư khả dụng.

### Chuyển đổi link hoàn tiền

Khi người dùng tạo đơn, server gọi `backend/lib/affiliate.js` để đổi link sản phẩm thành link mua hàng **có gắn `sub_id` của người dùng** (mấu chốt để biết hoa hồng thuộc về ai), rồi lưu cả link gốc và link hoàn tiền vào đơn.

Chọn nhà cung cấp bằng biến `AFFILIATE_PROVIDER`:

| Giá trị | Trạng thái | Ghi chú |
|---|---|---|
| `mock` (mặc định) | ✅ chạy được ngay | Trả về link nội bộ `http://localhost:3000/r/<mã đơn>`. Bấm vào sẽ được đếm lượt và chuyển hướng sang link gốc. **Không tạo ra hoa hồng thật** — hoa hồng vẫn do quản trị viên chốt tay. |
| `accesstrade` | ✅ TikTok Shop và Tiki đang chạy thật; Shopee/Lazada chờ duyệt campaign | Cần `ACCESSTRADE_API_KEY` + campaign ID từng sàn (`ACCESSTRADE_CAMPAIGN_SHOPEE` / `_TIKTOK` / `_TIKI` / `_LAZADA`). Đã viết theo tài liệu chính thức (`POST /v1/product_link/create`), gắn `sub1 = gzafl-u<id>` (người dùng) và `sub2 = <mã đơn>` (đơn hàng). |
| `shopee` | ⛔ chưa cài đặt | Cần `SHOPEE_AFFILIATE_APP_ID` + `SHOPEE_AFFILIATE_SECRET`, và phải đối chiếu tài liệu chính thức về cách ký request trước khi dùng. |

> ⚠️ **Không thể tạo hoa hồng bằng cách tự thêm tham số vào link.** Muốn có ghi nhận thật, bắt buộc phải có tài khoản affiliate đã được duyệt rồi gọi API do họ cấp. Xem phân tích đầy đủ ở **[docs/affiliate-integration.md](docs/affiliate-integration.md)**.

Nếu gọi nhà cung cấp thất bại, đơn **vẫn được tạo** với link gốc (người dùng không bị chặn) — chỉ là chưa ghi nhận được hoa hồng.

### Nhận hoa hồng về — đối soát postback

Khi mạng affiliate báo có người mua hàng, họ gọi vào:

```
GET /api/postback/accesstrade    ← khai URL này trong dashboard của mạng
```

Quy trình (mã nguồn: `backend/routes/postback.js` + `backend/lib/postback.js`):

1. **Xác thực** `POSTBACK_SECRET` (băm SHA-256 rồi so sánh bằng `timingSafeEqual`). Sai → `403` và **vẫn ghi vào nhật ký**. Chưa cấu hình secret → `503` (không nhận dữ liệu không rõ nguồn).
2. **Ghi tham số nhận được** vào bảng `postback_logs` **trước khi** xử lý — có log mới đối soát được khi có khiếu nại. `POSTBACK_SECRET` và các tham số nhạy cảm (`token`, `signature`…) được **che** trước khi lưu và trước khi hiển thị ở trang quản trị.
3. **Chống trùng** theo `payload_hash`: mạng gửi lại y hệt thì chỉ tăng số lần nhận, **không cộng tiền lần hai**.
4. **Tra đơn**: `sub1 = gzafl-u<id>` → người dùng; `sub2 = <mã đơn GZ…>` → đúng đơn; nếu thiếu thì tra theo mã giao dịch đã lưu, cuối cùng mới lấy đơn gần nhất của người dùng đó.
5. **Cộng dồn theo đơn** rồi cập nhật trạng thái:
   - mạng báo **chưa duyệt** → đơn chuyển **"Chờ đối soát"**, tiền nằm ở `network_commission`, **chưa vào số dư**;
   - mạng báo **đã duyệt** → đơn **"Hoàn thành"**, cộng `commission = tiền đã duyệt × CASHBACK_RATE`;
   - mạng báo **huỷ** → đơn **"Đã huỷ"**, hoa hồng về 0.
6. **Luôn trả `200` nhanh** (mạng chỉ gửi lại tối đa 3 lần) và **không bao giờ tự đổi trạng thái của đơn đã ở "Đã thanh toán"** — tránh việc đã chi tiền cho khách rồi mà mạng báo huỷ.

> AccessTrade gửi **mỗi sản phẩm một lần gọi** (đơn 3 món = 3 postback cùng mã giao dịch), nên tổng hoa hồng được cộng dồn theo đơn.

Tên tham số do người dùng tự đặt trong dashboard của mạng nên hệ thống **dò tự động** (`transaction_id`, `product_id`, `reward`, `status`, `sub1`…) và còn **quét mọi giá trị** để tìm mã dạng `gzafl-u<id>` / `GZ…`. Khác hẳn thì ép lại bằng `POSTBACK_PARAM_*` trong `.env`.

Xem toàn bộ lần gọi (kể cả lần sai chìa khoá, lần không khớp được đơn) và bấm **Xử lý lại** ở **trang quản trị → tab Đối soát**. Log đã bị từ chối (sai chìa khoá) **không** xử lý lại được, và tổng hoa hồng của một đơn chỉ cộng các log khớp **mã giao dịch** của đơn đó (khi đơn chưa có mã giao dịch thì cộng các log không mang mã giao dịch).

Điều kiện tiên quyết, đừng bỏ qua: **hỏi mạng trung gian xem điều khoản của họ có cho phép mô hình hoàn tiền lại cho người mua hay không** — nhiều chương trình affiliate cấm và có thể khoá tài khoản, thu hồi tiền đã trả.

### Bảng dữ liệu

| Bảng | Nội dung |
|---|---|
| `users` | Tài khoản: `username`, `password_hash` (bcrypt), thông tin cá nhân, mã giới thiệu, điểm, `role` (`user`/`admin`), `token_version`, thông tin nhận tiền |
| `orders` | Đơn hàng theo người dùng: mã `GZ...`, `link`/`original_link`, `affiliate_link`, `sub_id`, `platform`, trạng thái, hoa hồng, `click_count`, `network_order_id` (mã giao dịch bên mạng), `network_commission` (tiền mạng báo, có thể chưa duyệt), `network_status` |
| `withdrawals` | Lệnh rút tiền theo người dùng: mã `WD...`, ngân hàng, số tài khoản, số tiền, trạng thái |
| `referrals` | Lịch sử nhập mã giới thiệu của từng người dùng |
| `notifications` | Thông báo của từng người dùng: tiêu đề, nội dung, icon, đã đọc hay chưa |
| `password_resets` | Yêu cầu khôi phục mật khẩu gửi cho quản trị viên (đường dự phòng): người gửi, cách liên hệ lại, trạng thái (`Chờ xử lý` / `Đã xử lý` / `Đã huỷ`), ai xử lý và lúc nào |
| `email_otps` | Mã xác thực gửi qua email: mục đích (`register` / `reset` / `change_email` / `login`), email nhận, **bcrypt hash của mã** (không lưu mã gốc), số lần nhập sai, số lần đã gửi trong giờ, thời điểm hết hạn. Mã hết hạn từ hơn 1 ngày bị xoá tự động khi server khởi động |
| `postback_logs` | **Nhật ký báo cáo chuyển đổi** từ mạng affiliate: lưu **nguyên tham số thô** trước khi xử lý, mã giao dịch/sản phẩm, hoa hồng mạng báo, trạng thái bên mạng, `sub_id`, người dùng/đơn đã khớp, kết quả xử lý, số lần mạng gửi lại (`dup_count`), IP. Có khoá duy nhất trên `payload_hash` để chống xử lý trùng |

`db.js` tự thêm các cột còn thiếu khi khởi động, nên **database cũ vẫn nâng cấp được mà không mất dữ liệu**.

---

## Trang quản trị

Mọi tài khoản đăng ký mới đều có `role = 'user'`. Muốn vào được trang quản trị, cấp quyền cho một tài khoản bằng công cụ dòng lệnh (chạy trong thư mục `backend`):

```bash
npm run make-admin -- --list                  # xem danh sách người dùng
npm run make-admin -- quantri@example.com     # cấp quyền quản trị
npm run make-admin -- quantri@example.com --demote   # thu quyền
```

Quên mật khẩu (hoặc bị khoá tài khoản khỏi hệ thống):

```bash
npm run reset-password -- --list                       # xem danh sách người dùng
npm run reset-password -- quantri@example.com           # sinh mật khẩu ngẫu nhiên và in ra
npm run reset-password -- quantri@example.com MatKhauMoi123   # đặt mật khẩu cụ thể
```

Đổi mật khẩu bằng công cụ này cũng làm **mọi phiên đăng nhập cũ hết hiệu lực**, và tự đóng mọi yêu cầu khôi phục đang chờ của tài khoản đó trong trang quản trị.

Nếu khách **chưa có email trong tài khoản**, hoặc email sai, hoặc hệ thống chưa cấu hình gửi thư, khách có thể bấm **"Không nhận được mã?"** ở màn hình quên mật khẩu để đưa yêu cầu vào hàng đợi quản trị viên — xem tab **Khôi phục mật khẩu** bên dưới. Cách làm này **không tiết lộ** tài khoản nào có tồn tại hay không.

`quantri@example.com` là **username dùng để đăng nhập** (Email hoặc Số điện thoại). Sau khi cấp quyền, tải lại trang — mục **Quản trị** sẽ xuất hiện ở cuối thanh menu bên trái.

Trang quản trị gồm 6 tab:

| Tab | Việc làm được |
|---|---|
| **Đơn hàng** | Tìm theo mã đơn / link / sàn / khách hàng; duyệt đơn và **chốt hoa hồng** (hoa hồng được cộng ngay vào ví khách); huỷ đơn |
| **Rút tiền** | Xem yêu cầu rút tiền kèm **số dư khả dụng** của khách và **ảnh QR nhận tiền** (nếu khách có tải lên — bấm vào ảnh để mở lớn rồi quét bằng ứng dụng ngân hàng); nhập số tiền thực trả rồi đánh dấu `Đã thanh toán`, hoặc `Đã huỷ` |
| **Người dùng** | Xem điểm, số đơn, hoa hồng, đã rút, số dư; sửa vai trò và điểm thưởng; xoá người dùng |
| **Giới thiệu** | Xem ai đã nhập mã của ai, nhận bao nhiêu điểm |
| **Khôi phục mật khẩu** | Hàng đợi dự phòng: xem yêu cầu quên mật khẩu kèm cách liên hệ lại; bấm **Đặt lại** (bấm 2 lần cho chắc) để cấp **mật khẩu tạm**, hoặc **Từ chối** |
| **Đối soát** | Nhật ký mọi lần mạng affiliate báo chuyển đổi: lọc theo trạng thái mạng (`Chờ duyệt` / `Đã duyệt` / `Đã huỷ`) và theo kết quả (`đã khớp đơn` / `chưa hoặc chỉ khớp tạm` / `bị từ chối`); xem **tham số thô** mạng gửi (nút **Thô**) và bấm **Xử lý lại** cho log về trước lúc đơn được tạo. Huy hiệu số trên tab là số lần postback **cần người xem lại** (chưa khớp được đơn, hoặc chỉ khớp tạm). Tiền của các lần gọi sai chìa khoá **không** được tính vào thống kê hoa hồng |

### Cấp lại mật khẩu cho khách

Khách thường **tự đặt lại được** bằng mã xác thực gửi qua email (xem [Xác thực email (OTP)](#xác-thực-email-otp)). Phần dưới đây là **đường dự phòng**, dùng khi khách không có email trong tài khoản hoặc không nhận được thư:

1. Khách bấm **"Quên mật khẩu?"** ở màn hình đăng nhập, nhập tài khoản, rồi bấm **"Không nhận được mã?"** và điền cách liên hệ lại.
2. Vào **Quản trị → Khôi phục mật khẩu** (tab có **huy hiệu đỏ** đếm số yêu cầu đang chờ).
3. Bấm **Đặt lại** hai lần → hệ thống hiện **mật khẩu tạm**.
4. Chép mật khẩu rồi gửi cho khách qua Zalo/điện thoại, nhắc khách đổi mật khẩu sau khi đăng nhập.

Nếu khách đã tự đặt lại thành công thì yêu cầu của họ trong tab này **tự chuyển sang `Đã xử lý`**, không cần làm gì thêm.

Mật khẩu tạm **chỉ hiện đúng một lần**, không được lưu vào database. Sau khi đặt lại, **mọi phiên đăng nhập cũ của khách hết hiệu lực** và khách nhận được một thông báo.

Không thể đặt lại mật khẩu cho **chính tài khoản đang đăng nhập** (sẽ tự văng ra ngay giữa lúc làm việc) — hãy dùng **Cá nhân → Đổi mật khẩu**.

Một vài ràng buộc an toàn đã được chặn ở server:

- Quản trị viên **không thể tự hạ quyền** hoặc **tự xoá** chính mình.
- Luôn phải còn **ít nhất một** quản trị viên trong hệ thống.
- Không thể chi trả nhiều hơn số dư khả dụng của người dùng.

Mỗi thao tác ảnh hưởng tới tiền đều **tự động gửi thông báo cho khách hàng**: tạo đơn, quản trị viên chốt/đổi hoa hồng, đổi trạng thái đơn, gửi yêu cầu rút tiền, chi trả hoặc huỷ lệnh rút, và nhập mã giới thiệu.

---

## Kiểm thử và sao lưu

**Chạy test tự động** (dùng database + thư mục ảnh tạm, không đụng dữ liệu thật):

```bash
cd backend
npm test
```

Bộ test kiểm tra: health, header bảo mật, chặn tải file nội bộ, quyền xem ảnh QR,
chặn link sàn giả, phân quyền quản trị, nhật ký quản trị, postback, rate limit dùng SQLite
và script sao lưu.

**Sao lưu nóng** (không cần dừng server):

```bash
cd backend
npm run backup
```

Bản sao lưu nằm trong `backend/backups/<thời-điểm>/`, gồm database, thư mục `uploads/`
và `manifest.json`; tự xoá bản cũ hơn `BACKUP_KEEP_DAYS` ngày (mặc định 14).
Cách đặt lịch và phục hồi: xem [docs/deployment.md](docs/deployment.md#5-vận-hành-thường-ngày).

---


## Bảo mật

- Mật khẩu lưu dạng **bcrypt hash**, không lưu văn bản thường.
- Phiên đăng nhập là **JWT trong cookie `httpOnly`** (`sameSite=lax`), hết hạn sau 7 ngày.
- Mỗi tài khoản có `token_version`; **đổi mật khẩu hoặc đăng xuất sẽ tăng số này** nên token cũ (kể cả token bị đánh cắp) mất hiệu lực ngay, không phải chờ hết hạn 7 ngày. Đổi mật khẩu sẽ cấp lại cookie mới cho phiên đang thao tác; đăng xuất là đăng xuất **toàn bộ thiết bị**.
- Frontend **không thể sửa** dữ liệu đơn hàng/ví/điểm — tất cả kiểm tra ở server.
- Mọi truy vấn theo `user_id` lấy từ token, người dùng chỉ thấy dữ liệu của mình.
- API quản trị kiểm tra `role` ở **server**, không tin vào việc ẩn/hiện menu ở frontend.
- Chỉ **danh sách file giao diện đã biết** (index.html, script.js, admin.js, support.js, CSS, ảnh logo, components/, styles/) được phục vụ qua HTTP. Mọi đường dẫn khác trả `404`, kể cả khi bị mã hoá kiểu `/%62ackend/data/...` — không thể tải `backend/`, `data/`, `node_modules/` hay `package.json`.
- Có giới hạn số lần gọi API đăng nhập/đăng ký để tránh dò mật khẩu.
- Yêu cầu **quên mật khẩu** luôn trả về **cùng một thông báo** dù tài khoản có tồn tại hay không, nên người ngoài không dò được danh sách tài khoản. Bước yêu cầu gửi mã xác thực cũng vậy.
- **Mã xác thực email (OTP)** chỉ có hiệu lực 10 phút, dùng một lần, lưu dạng **bcrypt hash**; sai quá 5 lần phải xin mã mới; mỗi email chỉ được yêu cầu lại sau 60 giây và tối đa 5 mã/giờ. Mã của luồng này **không dùng được** cho luồng khác (đăng ký / đặt lại mật khẩu / đổi email / đăng nhập tách biệt nhau).
- **Xác thực khi đăng nhập**: mã chỉ được gửi **sau khi mật khẩu đã đúng**, nên người không biết mật khẩu không làm tốn thư trong hộp của người khác. Bước 2 dùng một **phiếu đăng nhập** ký sẵn (sống 5 phút) thay cho việc gửi lại mật khẩu, và phiếu tự hết hiệu lực khi mật khẩu bị đổi.
- **Mật khẩu tạm** do quản trị viên cấp không được lưu dưới dạng văn bản thường — chỉ hiện một lần cho quản trị viên rồi thôi.
- Mọi response có **header bảo mật**: `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`; khi chạy HTTPS có thêm `Strict-Transport-Security`. API trả `Cache-Control: no-store` để không lưu đệm dữ liệu ví/đơn.
- **Postback** từ mạng affiliate phải kèm `POSTBACK_SECRET`; thiếu hoặc sai khoá đều bị từ chối (503/403) và được ghi nhật ký.

### Lưu ý khi triển khai thật

> 📘 Hướng dẫn từng bước (HTTPS, `.env`, Nginx/Caddy, PM2/systemd, xử lý sự cố): **[docs/deployment.md](docs/deployment.md)**.

- Đổi `JWT_SECRET` và bật HTTPS — khi đó cookie tự động được đặt `secure: true`. Server đã **từ chối khởi động** ở `NODE_ENV=production` nếu khoá trống, vẫn là khoá mặc định, hoặc ngắn hơn 32 ký tự.
- Nếu chạy sau Nginx/Caddy/Cloudflare thì **phải** đặt `TRUST_PROXY` — thiếu biến này cookie `secure` sẽ bị trình duyệt từ chối (đăng nhập xong vẫn như chưa đăng nhập) và link hoàn tiền sẽ bị tạo với `http://`.
- Hoa hồng chưa được lấy tự động từ các sàn — hiện do quản trị viên **chốt thủ công** ở tab Đơn hàng, và việc chi trả cũng do quản trị viên xác nhận. Khi đã có tài khoản affiliate, cấu hình `AFFILIATE_PROVIDER` + khóa API là link hoàn tiền sẽ do sàn cấp.
- Nếu chạy nhiều tiến trình/instance, đặt `RATE_LIMIT_STORE=sqlite` để bộ đếm chống spam và hạn mức AI dùng chung qua database (khuyến nghị vẫn chạy **một tiến trình**). Sao lưu định kỳ bằng `npm run backup` — script sao lưu cả database và ảnh, tự dọn bản cũ.
- Muốn đổi thông tin liên hệ hiển thị ở trang Trợ giúp thì đặt `SUPPORT_EMAIL` / `SUPPORT_ZALO` trong `.env` — không cần sửa HTML. Trợ lý hỗ trợ cũng lấy hai giá trị này cho nút **"Liên hệ hỗ trợ"** trong khung chat.
- **Trợ lý hỗ trợ chạy được ngay, không cần cấu hình** (chế độ kịch bản). Nếu đặt `AI_API_KEY` thì mỗi câu hỏi của khách là một lượt gọi API tính vào hạn mức/chi phí của khoá đó — nên đặt **hạn mức chi tiêu** ở phía nhà cung cấp, giữ giới hạn 30 tin nhắn/10 phút mỗi IP và chỉnh trần **`AI_DAILY_LIMIT`** (mặc định 800 lượt/ngày cho toàn hệ thống; vượt trần thì trợ lý tự trả lời bằng kịch bản có sẵn).
- **Trước khi dùng xác thực khi đăng nhập** (`LOGIN_OTP=auto` sẽ tự bật khi đã có SMTP): phải chắc chắn tài khoản quản trị có **email thật đọc được**, nếu không bạn sẽ tự khoá mình khỏi trang quản trị. Cách làm an toàn: để `LOGIN_OTP=off`, đăng nhập, đổi email ở trang **Cá nhân**, rồi bỏ dòng đó đi. Nếu máy chủ thư gặp sự cố (hết hạn mức/sai mật khẩu ứng dụng), thêm `LOGIN_OTP=off` rồi khởi động lại là mọi người vào được ngay bằng mật khẩu.

> 📄 Muốn biến nút **"Tạo link & kiểm tra hoa hồng"** thành chức năng chuyển đổi link thật (trả về link mua hàng có ghi nhận hoa hồng), xem thiết kế chi tiết tại **[docs/affiliate-integration.md](docs/affiliate-integration.md)**.

---

## Tài khoản

Đăng ký mới ngay trên trang chủ bằng **Email** hoặc **Số điện thoại Việt Nam**, mật khẩu tối thiểu 8 ký tự, kèm **một địa chỉ email để nhận mã xác thực** — email này là bắt buộc kể cả khi bạn đăng nhập bằng số điện thoại, vì đó là nơi nhận mã khi quên mật khẩu. Mỗi email chỉ dùng được cho một tài khoản.

Khi đăng nhập, nếu hệ thống bật xác thực 2 lớp, sau khi nhập đúng mật khẩu bạn sẽ nhận thêm **mã 6 số** qua email và nhập vào ô xác thực để hoàn tất. Nếu đã có mã còn hiệu lực thì hệ thống dùng lại mã đó (không gửi thêm thư).
