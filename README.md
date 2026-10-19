# GZ AFL — Nền tảng Affiliate / Hoàn tiền

Ứng dụng web hoàn tiền affiliate (Shopee / TikTok Shop / Lazada) gồm 2 phần:

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
| `COOKIE_SECURE` | theo `NODE_ENV` | Ghi đè cờ `secure` của cookie phiên |
| `DB_PATH` | `backend/data/gzafl.sqlite` | Đường dẫn file database |
| `WITHDRAWAL_MIN` | `50000` | Số dư khả dụng tối thiểu để được gửi yêu cầu rút tiền (đồng) |
| `AFFILIATE_PROVIDER` | `mock` | Nhà cung cấp chuyển đổi link: `mock` / `accesstrade` / `shopee` |
| `AFFILIATE_SUB_ID_PREFIX` | `gzafl` | Tiền tố `sub_id` gắn vào link để biết hoa hồng thuộc về ai |
| `EMAIL_OTP` | `auto` | Bước xác thực email: `auto` (bật khi đã cấu hình SMTP, hoặc khi chạy `development`) / `on` / `off`. Áp dụng cho **đăng ký**, **quên mật khẩu** và **đổi email** |
| `LOGIN_OTP` | `auto` | Bước xác thực khi **đăng nhập**: `auto` (bật khi `EMAIL_OTP` đang bật **và** gửi được thư) / `on` (luôn bắt buộc) / `off` (đăng nhập chỉ cần mật khẩu). Công tắc "cứu hộ" khi máy chủ thư gặp sự cố |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` | – | Máy chủ gửi thư dùng cho mã xác thực. Bỏ trống `SMTP_SECURE` thì tự suy ra (`true` khi cổng `465`) |
| `SMTP_USER`, `SMTP_PASS` | – | Tài khoản gửi thư (Gmail thì dùng *Mật khẩu ứng dụng* 16 ký tự) |
| `MAIL_FROM`, `MAIL_FROM_NAME` | theo `SMTP_USER`, tên `GZ AFL` | Địa chỉ và tên người gửi hiện trên thư |
| `SUPPORT_EMAIL`, `SUPPORT_ZALO` | – | Thông tin liên hệ hiển thị ở trang Trợ giúp (bỏ trống thì dùng giá trị mặc định trong `components/guide.html`) |

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
components/                # Các mảnh giao diện (landing, sidebar, header, các trang...)
  admin.html               # Giao diện trang quản trị
  guide.html               # Nội dung Trợ giúp / Điều khoản (dùng cho cả trang trong app và modal ở trang chủ)
LOGO.png
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
    mailer.js              # Gửi email qua SMTP (in ra console khi chưa cấu hình ở môi trường dev)
    otp.js                 # Sinh / kiểm tra mã xác thực email (OTP) cho đăng ký và quên mật khẩu
    notify.js              # Ghi thông báo cho người dùng
  routes/
    auth.js                # Đăng ký (2 bước kèm mã xác thực) / đăng nhập / đăng xuất / me / quên mật khẩu
    orders.js              # Danh sách + tạo đơn hàng (kèm chuyển đổi link)
    wallet.js              # Thống kê ví + rút tiền
    referral.js            # Mã giới thiệu + nhập mã
    profile.js             # Cập nhật hồ sơ, avatar, ảnh QR nhận tiền + đổi mật khẩu
    notifications.js       # Danh sách thông báo + đánh dấu đã đọc
    admin.js               # API quản trị (chỉ role = 'admin')
  data/                    # File SQLite (tự sinh, đã bỏ qua khi commit)
  uploads/                 # Ảnh đại diện + ảnh QR nhận tiền do người dùng tải lên
```

---

## Xác thực email (OTP)

Khi đăng ký, hệ thống gửi một **mã 6 chữ số** tới email người dùng nhập; nhập đúng mã mới tạo được tài khoản. Cùng cơ chế đó cho phép khách **tự đặt lại mật khẩu** khi quên, và dùng làm **xác thực 2 lớp khi đăng nhập**.

- **Email là bắt buộc khi đăng ký**, kể cả khi đăng nhập bằng số điện thoại.
- **Đổi email trong trang Cá nhân cũng phải xác thực**: mã được gửi tới *địa chỉ mới* rồi mới lưu, nên email khôi phục luôn là địa chỉ thật. Chỉ đổi tên/số điện thoại thì không cần mã.
- **Đăng nhập 2 bước** (khi `LOGIN_OTP` bật): mật khẩu đúng thì server mới gửi mã, sau đó mới cấp phiên. Mã còn hiệu lực thì **dùng lại mã cũ** — đăng xuất rồi đăng nhập lại ngay không tốn thêm thư.
- Mã có hiệu lực **10 phút**, chỉ dùng được **một lần**, lưu dưới dạng **bcrypt hash** (không lưu mã gốc). Mã của luồng này **không dùng được** cho luồng khác.
- Nhập sai quá **5 lần** thì phải yêu cầu mã mới; mỗi lần yêu cầu lại phải chờ **60 giây**, tối đa **5 mã/giờ** cho mỗi email.
- Mỗi IP chỉ được yêu cầu gửi mã **10 lần / 15 phút** (đăng ký & khôi phục mật khẩu) và **40 lần / 15 phút** (đăng nhập).
- Bước yêu cầu gửi mã **luôn trả về cùng một thông báo** dù tài khoản có tồn tại hay không — người ngoài không dò được danh sách tài khoản.

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

## API

Tất cả API nằm dưới `/api`, trả về JSON. Các API cần đăng nhập dùng cookie phiên.

| Method | Đường dẫn | Mô tả |
|---|---|---|
| GET | `/api/health` | Kiểm tra server sống |
| GET | `/api/config` | Cấu hình công khai cho giao diện (thông tin liên hệ hỗ trợ, có bật xác thực email hay không) |
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
| POST | `/api/wallet/withdrawals` | Yêu cầu rút tiền `{ bank, accNum, accName }`. Nếu tài khoản đã có **ảnh QR nhận tiền** thì `accNum`/`accName` không bắt buộc |
| GET | `/api/referral` | Mã giới thiệu, điểm, lịch sử đã nhập |
| POST | `/api/referral/redeem` | Nhập mã giới thiệu `{ code }` |
| GET | `/api/notifications` | Danh sách thông báo + số chưa đọc |
| POST | `/api/notifications/read-all` | Đánh dấu tất cả thông báo là đã đọc |
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
| GET | `/api/admin/password-resets` | Hàng đợi yêu cầu khôi phục mật khẩu (`status`, `limit`, `offset`) |
| POST | `/api/admin/password-resets/:id/reset` | Đặt lại mật khẩu, trả về `tempPassword` **đúng một lần** (không lưu vào DB) |
| POST | `/api/admin/password-resets/:id/cancel` | Từ chối yêu cầu khôi phục |

Trạng thái hợp lệ:

- Đơn hàng: `Đang xử lý` → `Hoàn thành` → `Đã thanh toán`, hoặc `Đã huỷ`.
- Lệnh rút tiền: `Đang xử lý` → `Đã thanh toán`, hoặc `Đã huỷ`.

**Cách tiền được tính:** số dư ví của người dùng = tổng `commission` của các đơn **không bị huỷ** − tổng `amount` của các lệnh rút **không bị huỷ**. Vì vậy đánh dấu `Đã huỷ` sẽ loại đơn/lệnh đó khỏi phép tính, còn khi chuyển một lệnh rút sang `Đã thanh toán` thì phải nhập số tiền thực trả (không được vượt số dư khả dụng).

**Rút tiền:** người dùng không tự nhập số tiền — hệ thống ghi nhận **toàn bộ số dư khả dụng** tại thời điểm gửi. Nhờ vậy số tiền đó bị **giữ chỗ** ngay, không thể rút trùng. Các ràng buộc ở server (`backend/routes/wallet.js`):

- Số dư khả dụng phải đạt mức tối thiểu `WITHDRAWAL_MIN` (mặc định **50.000đ**) — chưa đủ thì trả `400` kèm số tiền còn thiếu.
- Mỗi tài khoản chỉ được có **một** lệnh rút `Đang xử lý`; gửi lệnh thứ hai nhận `409`.
- Ngân hàng/ví được chọn từ danh sách trong `backend/lib/banks.js` (khoảng 50 ngân hàng và ví điện tử, hiện ở dropdown và ở `GET /api/config`). Người dùng cũng có thể chọn **"Ngân hàng khác"** rồi tự ghi tên (tối đa 60 ký tự).
- Người dùng có thể tải lên **ảnh QR nhận tiền** (chỉ **PNG/JPG**, tối đa 2MB). Khi đã có ảnh QR thì **không bắt buộc** nhập `accNum`/`accName` — quản trị viên quét mã QR để chuyển tiền. Ảnh QR được **chụp lại** vào lệnh rút lúc gửi, nên đổi ảnh sau này không làm thay đổi lệnh cũ; file ảnh chỉ bị xoá khi **không còn lệnh rút nào** dùng nó.
- Huỷ lệnh rút (`Đã huỷ`) sẽ **trả lại** số tiền vào số dư khả dụng.
- Quản trị viên có thể sửa số tiền thực trả khi đánh dấu `Đã thanh toán`, nhưng không được vượt số dư khả dụng.

### Chuyển đổi link hoàn tiền

Khi người dùng tạo đơn, server gọi `backend/lib/affiliate.js` để đổi link sản phẩm thành link mua hàng **có gắn `sub_id` của người dùng** (mấu chốt để biết hoa hồng thuộc về ai), rồi lưu cả link gốc và link hoàn tiền vào đơn.

Chọn nhà cung cấp bằng biến `AFFILIATE_PROVIDER`:

| Giá trị | Trạng thái | Ghi chú |
|---|---|---|
| `mock` (mặc định) | ✅ chạy được ngay | Trả về link nội bộ `http://localhost:3000/r/<mã đơn>`. Bấm vào sẽ được đếm lượt và chuyển hướng sang link gốc. **Không tạo ra hoa hồng thật** — hoa hồng vẫn do quản trị viên chốt tay. |
| `accesstrade` | ⚠️ cần tài khoản | Cần `ACCESSTRADE_API_KEY` + `ACCESSTRADE_CAMPAIGN_ID`. |
| `shopee` | ⛔ chưa cài đặt | Cần `SHOPEE_AFFILIATE_APP_ID` + `SHOPEE_AFFILIATE_SECRET`, và phải đối chiếu tài liệu chính thức về cách ký request trước khi dùng. |

> ⚠️ **Không thể tạo hoa hồng bằng cách tự thêm tham số vào link.** Muốn có ghi nhận thật, bắt buộc phải có tài khoản affiliate đã được duyệt rồi gọi API do họ cấp. Xem phân tích đầy đủ ở **[docs/affiliate-integration.md](docs/affiliate-integration.md)**.

Nếu gọi nhà cung cấp thất bại, đơn **vẫn được tạo** với link gốc (người dùng không bị chặn) — chỉ là chưa ghi nhận được hoa hồng.

### Bảng dữ liệu

| Bảng | Nội dung |
|---|---|
| `users` | Tài khoản: `username`, `password_hash` (bcrypt), thông tin cá nhân, mã giới thiệu, điểm, `role` (`user`/`admin`), `token_version`, thông tin nhận tiền |
| `orders` | Đơn hàng theo người dùng: mã `GZ...`, `link`/`original_link`, `affiliate_link`, `sub_id`, `platform`, trạng thái, hoa hồng, `click_count` |
| `withdrawals` | Lệnh rút tiền theo người dùng: mã `WD...`, ngân hàng, số tài khoản, số tiền, trạng thái |
| `referrals` | Lịch sử nhập mã giới thiệu của từng người dùng |
| `notifications` | Thông báo của từng người dùng: tiêu đề, nội dung, icon, đã đọc hay chưa |
| `password_resets` | Yêu cầu khôi phục mật khẩu gửi cho quản trị viên (đường dự phòng): người gửi, cách liên hệ lại, trạng thái (`Chờ xử lý` / `Đã xử lý` / `Đã huỷ`), ai xử lý và lúc nào |
| `email_otps` | Mã xác thực gửi qua email: mục đích (`register` / `reset` / `change_email` / `login`), email nhận, **bcrypt hash của mã** (không lưu mã gốc), số lần nhập sai, số lần đã gửi trong giờ, thời điểm hết hạn. Mã hết hạn từ hơn 1 ngày bị xoá tự động khi server khởi động |

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

Trang quản trị gồm 5 tab:

| Tab | Việc làm được |
|---|---|
| **Đơn hàng** | Tìm theo mã đơn / link / sàn / khách hàng; duyệt đơn và **chốt hoa hồng** (hoa hồng được cộng ngay vào ví khách); huỷ đơn |
| **Rút tiền** | Xem yêu cầu rút tiền kèm **số dư khả dụng** của khách và **ảnh QR nhận tiền** (nếu khách có tải lên — bấm vào ảnh để mở lớn rồi quét bằng ứng dụng ngân hàng); nhập số tiền thực trả rồi đánh dấu `Đã thanh toán`, hoặc `Đã huỷ` |
| **Người dùng** | Xem điểm, số đơn, hoa hồng, đã rút, số dư; sửa vai trò và điểm thưởng; xoá người dùng |
| **Giới thiệu** | Xem ai đã nhập mã của ai, nhận bao nhiêu điểm |
| **Khôi phục mật khẩu** | Hàng đợi dự phòng: xem yêu cầu quên mật khẩu kèm cách liên hệ lại; bấm **Đặt lại** (bấm 2 lần cho chắc) để cấp **mật khẩu tạm**, hoặc **Từ chối** |

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


## Bảo mật

- Mật khẩu lưu dạng **bcrypt hash**, không lưu văn bản thường.
- Phiên đăng nhập là **JWT trong cookie `httpOnly`** (`sameSite=lax`), hết hạn sau 7 ngày.
- Mỗi tài khoản có `token_version`; **đổi mật khẩu sẽ tăng số này** nên mọi phiên đăng nhập ở thiết bị khác lập tức hết hiệu lực (phiên đang thao tác được cấp lại cookie mới nên không bị văng ra).
- Frontend **không thể sửa** dữ liệu đơn hàng/ví/điểm — tất cả kiểm tra ở server.
- Mọi truy vấn theo `user_id` lấy từ token, người dùng chỉ thấy dữ liệu của mình.
- API quản trị kiểm tra `role` ở **server**, không tin vào việc ẩn/hiện menu ở frontend.
- Thư mục nội bộ (`/backend`, `/data`, `/node_modules`, `package.json`) bị chặn không cho tải qua HTTP.
- Có giới hạn số lần gọi API đăng nhập/đăng ký để tránh dò mật khẩu.
- Yêu cầu **quên mật khẩu** luôn trả về **cùng một thông báo** dù tài khoản có tồn tại hay không, nên người ngoài không dò được danh sách tài khoản. Bước yêu cầu gửi mã xác thực cũng vậy.
- **Mã xác thực email (OTP)** chỉ có hiệu lực 10 phút, dùng một lần, lưu dạng **bcrypt hash**; sai quá 5 lần phải xin mã mới; mỗi email chỉ được yêu cầu lại sau 60 giây và tối đa 5 mã/giờ. Mã của luồng này **không dùng được** cho luồng khác (đăng ký / đặt lại mật khẩu / đổi email / đăng nhập tách biệt nhau).
- **Xác thực khi đăng nhập**: mã chỉ được gửi **sau khi mật khẩu đã đúng**, nên người không biết mật khẩu không làm tốn thư trong hộp của người khác. Bước 2 dùng một **phiếu đăng nhập** ký sẵn (sống 5 phút) thay cho việc gửi lại mật khẩu, và phiếu tự hết hiệu lực khi mật khẩu bị đổi.
- **Mật khẩu tạm** do quản trị viên cấp không được lưu dưới dạng văn bản thường — chỉ hiện một lần cho quản trị viên rồi thôi.

### Lưu ý khi triển khai thật

> 📘 Hướng dẫn từng bước (HTTPS, `.env`, Nginx/Caddy, PM2/systemd, xử lý sự cố): **[docs/deployment.md](docs/deployment.md)**.

- Đổi `JWT_SECRET` và bật HTTPS — khi đó cookie tự động được đặt `secure: true`. Server đã **từ chối khởi động** ở `NODE_ENV=production` nếu khoá trống, vẫn là khoá mặc định, hoặc ngắn hơn 32 ký tự.
- Nếu chạy sau Nginx/Caddy/Cloudflare thì **phải** đặt `TRUST_PROXY` — thiếu biến này cookie `secure` sẽ bị trình duyệt từ chối (đăng nhập xong vẫn như chưa đăng nhập) và link hoàn tiền sẽ bị tạo với `http://`.
- Hoa hồng chưa được lấy tự động từ các sàn — hiện do quản trị viên **chốt thủ công** ở tab Đơn hàng, và việc chi trả cũng do quản trị viên xác nhận. Khi đã có tài khoản affiliate, cấu hình `AFFILIATE_PROVIDER` + khóa API là link hoàn tiền sẽ do sàn cấp.
- Nên dùng một lớp lưu trữ phiên/rate-limit tập trung (Redis...) nếu chạy nhiều tiến trình; SQLite cũng chỉ phù hợp khi chạy **một tiến trình**. Nhớ backup `backend/data/gzafl.sqlite` và `backend/uploads/`.
- Muốn đổi thông tin liên hệ hiển thị ở trang Trợ giúp thì đặt `SUPPORT_EMAIL` / `SUPPORT_ZALO` trong `.env` — không cần sửa HTML.
- **Trước khi dùng xác thực khi đăng nhập** (`LOGIN_OTP=auto` sẽ tự bật khi đã có SMTP): phải chắc chắn tài khoản quản trị có **email thật đọc được**, nếu không bạn sẽ tự khoá mình khỏi trang quản trị. Cách làm an toàn: để `LOGIN_OTP=off`, đăng nhập, đổi email ở trang **Cá nhân**, rồi bỏ dòng đó đi. Nếu máy chủ thư gặp sự cố (hết hạn mức/sai mật khẩu ứng dụng), thêm `LOGIN_OTP=off` rồi khởi động lại là mọi người vào được ngay bằng mật khẩu.

> 📄 Muốn biến nút **"Tạo link & kiểm tra hoa hồng"** thành chức năng chuyển đổi link thật (trả về link mua hàng có ghi nhận hoa hồng), xem thiết kế chi tiết tại **[docs/affiliate-integration.md](docs/affiliate-integration.md)**.

---

## Tài khoản

Đăng ký mới ngay trên trang chủ bằng **Email** hoặc **Số điện thoại Việt Nam**, mật khẩu tối thiểu 6 ký tự, kèm **một địa chỉ email để nhận mã xác thực** — email này là bắt buộc kể cả khi bạn đăng nhập bằng số điện thoại, vì đó là nơi nhận mã khi quên mật khẩu.

Khi đăng nhập, nếu hệ thống bật xác thực 2 lớp, sau khi nhập đúng mật khẩu bạn sẽ nhận thêm **mã 6 số** qua email và nhập vào ô xác thực để hoàn tất. Nếu đã có mã còn hiệu lực thì hệ thống dùng lại mã đó (không gửi thêm thư).
