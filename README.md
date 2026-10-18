# GZ AFL — Nền tảng Affiliate / Hoàn tiền

Ứng dụng web hoàn tiền affiliate (Shopee / TikTok Shop / Lazada) gồm 2 phần:

- **Frontend**: HTML + Tailwind (CDN) + JavaScript thuần (`index.html`, `script.js`, `style.css`, `components/`).
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

### Biến môi trường (tuỳ chọn)

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `PORT` | `3000` | Cổng của server |
| `JWT_SECRET` | `gzafl-dev-secret-change-me` | Khóa ký token phiên — **bắt buộc đổi khi triển khai thật** (server sẽ từ chối khởi động ở `NODE_ENV=production` nếu vẫn dùng khóa mặc định) |
| `DB_PATH` | `backend/data/gzafl.sqlite` | Đường dẫn file database |
| `WITHDRAWAL_MIN` | `50000` | Số dư khả dụng tối thiểu để được gửi yêu cầu rút tiền (đồng) |
| `AFFILIATE_PROVIDER` | `mock` | Nhà cung cấp chuyển đổi link: `mock` / `accesstrade` / `shopee` |
| `AFFILIATE_SUB_ID_PREFIX` | `gzafl` | Tiền tố `sub_id` gắn vào link để biết hoa hồng thuộc về ai |

Ví dụ (PowerShell):

```powershell
$env:JWT_SECRET="mot-khoa-bi-mat-that-dai"; npm start
```

---

## Cấu trúc

```
index.html                 # Khung trang + modal rút tiền
style.css                  # CSS dùng chung
script.js                  # Toàn bộ logic frontend (gọi API)
admin.js                   # Logic riêng của trang quản trị (chỉ tải khi mở trang này)
components/                # Các mảnh giao diện (landing, sidebar, header, các trang...)
  admin.html               # Giao diện trang quản trị
  guide.html               # Nội dung Trợ giúp / Điều khoản (dùng cho cả trang trong app và modal ở trang chủ)
LOGO.png
README.md
docs/                      # Tài liệu kỹ thuật
  affiliate-integration.md # Thiết kế tích hợp chuyển đổi link hoàn tiền (chi tiết + các phương án)

backend/
  server.js                # Khởi tạo Express: API + link rút gọn /r/<mã đơn> + phục vụ frontend tĩnh
  db.js                    # Kết nối SQLite + tạo bảng + tự nâng cấp cột khi có bản mới
  package.json
  scripts/
    make-admin.js          # Cấp / thu quyền quản trị từ dòng lệnh
  lib/
    auth.js                # JWT, cookie phiên, middleware requireAuth / requireAdmin
    constants.js           # Trạng thái đơn/lệnh rút, vai trò, mức rút tối thiểu
    validate.js            # Kiểm tra email/SĐT, sinh mã đơn/mã giới thiệu
    serialize.js           # Chuyển dữ liệu DB -> JSON cho frontend
    format.js              # Định dạng ngày/tiền kiểu Việt Nam
    rateLimit.js           # Giới hạn số yêu cầu cho API đăng nhập
    affiliate.js           # Chuyển link sản phẩm -> link hoàn tiền (mock / accesstrade / shopee)
    notify.js              # Ghi thông báo cho người dùng
  routes/
    auth.js                # Đăng ký / đăng nhập / đăng xuất / me
    orders.js              # Danh sách + tạo đơn hàng (kèm chuyển đổi link)
    wallet.js              # Thống kê ví + rút tiền
    referral.js            # Mã giới thiệu + nhập mã
    profile.js             # Cập nhật hồ sơ, avatar + đổi mật khẩu
    notifications.js       # Danh sách thông báo + đánh dấu đã đọc
    admin.js               # API quản trị (chỉ role = 'admin')
  data/                    # File SQLite (tự sinh, đã bỏ qua khi commit)
  uploads/                 # Ảnh đại diện người dùng tải lên
```

---

## API

Tất cả API nằm dưới `/api`, trả về JSON. Các API cần đăng nhập dùng cookie phiên.

| Method | Đường dẫn | Mô tả |
|---|---|---|
| GET | `/api/health` | Kiểm tra server sống |
| POST | `/api/auth/register` | Đăng ký `{ username, password, name }` |
| POST | `/api/auth/login` | Đăng nhập, đặt cookie phiên |
| POST | `/api/auth/logout` | Đăng xuất |
| GET | `/api/auth/me` | Người dùng hiện tại (`null` nếu chưa đăng nhập) |
| GET | `/api/orders` | Danh sách đơn hàng của mình (kèm link hoàn tiền, `sub_id`, số lượt bấm) |
| POST | `/api/orders` | Tạo đơn `{ link }` → trả về `{ order, affiliate }` với link hoàn tiền |
| GET | `/api/wallet` | Thống kê ví + lịch sử rút tiền + `minWithdraw`, `canWithdraw` |
| POST | `/api/wallet/withdrawals` | Yêu cầu rút tiền `{ bank, accNum, accName }` |
| GET | `/api/referral` | Mã giới thiệu, điểm, lịch sử đã nhập |
| POST | `/api/referral/redeem` | Nhập mã giới thiệu `{ code }` |
| GET | `/api/notifications` | Danh sách thông báo + số chưa đọc |
| POST | `/api/notifications/read-all` | Đánh dấu tất cả thông báo là đã đọc |
| PUT | `/api/profile` | Cập nhật hồ sơ `{ name, email, phone }` |
| POST | `/api/profile/avatar` | Cập nhật ảnh đại diện `{ dataUrl }` |
| PUT | `/api/profile/password` | Đổi mật khẩu `{ currentPassword, newPassword }` (tối đa 10 lần / 15 phút) |

Ngoài `/api`, server còn có một đường dẫn công khai:

| Method | Đường dẫn | Mô tả |
|---|---|---|
| GET | `/r/:code` | Link hoàn tiền rút gọn — đếm lượt bấm rồi chuyển hướng (302) sang link đích |

### API quản trị (`/api/admin`)

Tất cả API dưới đây **yêu cầu tài khoản có `role = 'admin'`**. Người chưa đăng nhập nhận `401`, người dùng thường nhận `403`.

| Method | Đường dẫn | Mô tả |
|---|---|---|
| GET | `/api/admin/overview` | Thống kê toàn hệ thống (người dùng, đơn, lệnh rút, tiền) |
| GET | `/api/admin/users` | Danh sách người dùng (`q`, `limit`, `offset`) |
| PATCH | `/api/admin/users/:id` | Đổi `{ role, points }` |
| DELETE | `/api/admin/users/:id` | Xoá người dùng (xoá kèm đơn hàng/lệnh rút/lịch sử giới thiệu) |
| GET | `/api/admin/orders` | Danh sách đơn hàng (`status`, `q`, `limit`, `offset`) |
| PATCH | `/api/admin/orders/:code` | Đổi `{ status, commission }` |
| GET | `/api/admin/withdrawals` | Danh sách lệnh rút tiền (`status`, `q`, `limit`, `offset`) |
| PATCH | `/api/admin/withdrawals/:code` | Đổi `{ status, amount }` |
| GET | `/api/admin/referrals` | Lịch sử nhập mã giới thiệu (`limit`, `offset`) |

Trạng thái hợp lệ:

- Đơn hàng: `Đang xử lý` → `Hoàn thành` → `Đã thanh toán`, hoặc `Đã huỷ`.
- Lệnh rút tiền: `Đang xử lý` → `Đã thanh toán`, hoặc `Đã huỷ`.

**Cách tiền được tính:** số dư ví của người dùng = tổng `commission` của các đơn **không bị huỷ** − tổng `amount` của các lệnh rút **không bị huỷ**. Vì vậy đánh dấu `Đã huỷ` sẽ loại đơn/lệnh đó khỏi phép tính, còn khi chuyển một lệnh rút sang `Đã thanh toán` thì phải nhập số tiền thực trả (không được vượt số dư khả dụng).

**Rút tiền:** người dùng không tự nhập số tiền — hệ thống ghi nhận **toàn bộ số dư khả dụng** tại thời điểm gửi. Nhờ vậy số tiền đó bị **giữ chỗ** ngay, không thể rút trùng. Các ràng buộc ở server (`backend/routes/wallet.js`):

- Số dư khả dụng phải đạt mức tối thiểu `WITHDRAWAL_MIN` (mặc định **50.000đ**) — chưa đủ thì trả `400` kèm số tiền còn thiếu.
- Mỗi tài khoản chỉ được có **một** lệnh rút `Đang xử lý`; gửi lệnh thứ hai nhận `409`.
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

`db.js` tự thêm các cột còn thiếu khi khởi động, nên **database cũ vẫn nâng cấp được mà không mất dữ liệu**.

---

## Trang quản trị

Mọi tài khoản đăng ký mới đều có `role = 'user'`. Muốn vào được trang quản trị, cấp quyền cho một tài khoản bằng công cụ dòng lệnh (chạy trong thư mục `backend`):

```bash
npm run make-admin -- --list                  # xem danh sách người dùng
npm run make-admin -- quantri@example.com     # cấp quyền quản trị
npm run make-admin -- quantri@example.com --demote   # thu quyền
```

`quantri@example.com` là **username dùng để đăng nhập** (Email hoặc Số điện thoại). Sau khi cấp quyền, tải lại trang — mục **Quản trị** sẽ xuất hiện ở cuối thanh menu bên trái.

Trang quản trị gồm 4 tab:

| Tab | Việc làm được |
|---|---|
| **Đơn hàng** | Tìm theo mã đơn / link / sàn / khách hàng; duyệt đơn và **chốt hoa hồng** (hoa hồng được cộng ngay vào ví khách); huỷ đơn |
| **Rút tiền** | Xem yêu cầu rút tiền kèm **số dư khả dụng** của khách; nhập số tiền thực trả rồi đánh dấu `Đã thanh toán`, hoặc `Đã huỷ` |
| **Người dùng** | Xem điểm, số đơn, hoa hồng, đã rút, số dư; sửa vai trò và điểm thưởng; xoá người dùng |
| **Giới thiệu** | Xem ai đã nhập mã của ai, nhận bao nhiêu điểm |

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

### Lưu ý khi triển khai thật

- Đổi `JWT_SECRET` (server đã **từ chối khởi động** ở `NODE_ENV=production` nếu vẫn dùng khóa mặc định) và bật HTTPS — khi đó cookie tự động được đặt `secure: true`.
- Hoa hồng chưa được lấy tự động từ các sàn — hiện do quản trị viên **chốt thủ công** ở tab Đơn hàng, và việc chi trả cũng do quản trị viên xác nhận. Khi đã có tài khoản affiliate, cấu hình `AFFILIATE_PROVIDER` + khóa API là link hoàn tiền sẽ do sàn cấp.
- Nên dùng một lớp lưu trữ phiên/rate-limit tập trung (Redis...) nếu chạy nhiều tiến trình; SQLite cũng chỉ phù hợp khi chạy **một tiến trình**.
- Tailwind hiện nạp từ CDN — chỉ nên dùng khi phát triển. Khi triển khai thật nên build Tailwind thành file CSS tĩnh.
- Nhớ thay thông tin liên hệ thật trong `components/guide.html` (email/Zalo đang là giá trị mẫu).

> 📄 Muốn biến nút **"Tạo link & kiểm tra hoa hồng"** thành chức năng chuyển đổi link thật (trả về link mua hàng có ghi nhận hoa hồng), xem thiết kế chi tiết tại **[docs/affiliate-integration.md](docs/affiliate-integration.md)**.

---

## Tài khoản

Đăng ký mới ngay trên trang chủ bằng **Email** hoặc **Số điện thoại Việt Nam** và mật khẩu tối thiểu 6 ký tự.
