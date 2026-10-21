# Triển khai GZ AFL lên production

Tài liệu này mô tả cách đưa website lên một máy chủ thật, có **HTTPS** và **JWT_SECRET riêng**.
Làm theo đúng thứ tự dưới đây là đủ; phần cuối có mục xử lý sự cố.

---

## 0. Chuẩn bị

- Máy chủ có **Node.js >= 22.13** (khuyến nghị **Node 24 LTS**).
  Lý do: backend dùng `node:sqlite`; từ Node 22.13 mới không cần cờ `--experimental-sqlite`.
  Node 22.5–22.12 vẫn chạy được nếu thêm cờ đó, nhưng không nên dùng cho production mới.
- Một tên miền đã trỏ về IP máy chủ (ví dụ `gzafl.vn`).
- Quyền quản trị máy chủ (Linux thường dùng `sudo`).

Lấy mã nguồn về máy chủ rồi cài đặt backend:

```bash
cd backend
npm install --omit=dev
```

> `--omit=dev` để không cài các gói chỉ dùng khi phát triển.

---

## 1. Tạo file `backend/.env`

```bash
cp backend/.env.example backend/.env
```

Sinh khoá ký phiên mới **riêng cho máy chủ này**:

```bash
cd backend
npm run gen-secret -- --write
```

Lệnh trên ghi `JWT_SECRET` (48 byte ngẫu nhiên) thẳng vào `backend/.env`.

Sau đó mở `backend/.env` và điền:

```ini
PORT=3000
NODE_ENV=production
WITHDRAWAL_MIN=1000
AFFILIATE_PROVIDER=mock        # đổi khi có tài khoản affiliate thật
```

### Gửi email xác thực (OTP)

Muốn bật bước **xác thực email khi đăng ký**, cho khách **tự đặt lại mật khẩu** và
**xác thực khi đăng nhập**, điền thêm máy chủ gửi thư.

> ⚠️ **Production bắt buộc xác thực email.** Đăng ký luôn bắt buộc nhập email (để nhận
> mã khôi phục mật khẩu), nên nếu không xác thực được thì ai cũng có thể đăng ký bằng
> email của người khác. Vì vậy khi `NODE_ENV=production` mà xác thực email đang tắt,
> server **từ chối khởi động** (xem mục [5](#5-vận-hành-thường-ngày)). Chỉ khi thật sự
> chưa có SMTP và đã chấp nhận rủi ro, đặt `ALLOW_UNVERIFIED_EMAIL=1`.

```ini
EMAIL_OTP=auto                      # auto | on | off (mặc định auto)
LOGIN_OTP=auto                      # auto | on | off (mặc định auto)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=ten-ban@gmail.com
SMTP_PASS=mat-khau-ung-dung-16-ky-tu
MAIL_FROM=no-reply@gzafl.vn         # bỏ trống thì lấy theo SMTP_USER
MAIL_FROM_NAME=GZ AFL
```

- **Gmail**: bật xác thực 2 lớp cho tài khoản, vào *Quản lý tài khoản Google → Bảo mật →
  Mật khẩu ứng dụng*, tạo một mật khẩu 16 ký tự rồi dùng nó cho `SMTP_PASS`
  (mật khẩu đăng nhập Gmail thường **không** dùng được). Giới hạn khoảng 500 thư/ngày.
- **Brevo** (miễn phí 300 thư/ngày, tỉ lệ vào Inbox tốt hơn): `SMTP_HOST=smtp-relay.brevo.com`,
  `SMTP_PORT=587`, `SMTP_USER`/`SMTP_PASS` lấy trong mục *SMTP & API* của Brevo.
- Gửi tên miền thật thì khai báo bản ghi **SPF/DKIM** cho tên miền đó, nếu không thư dễ
  vào Spam. Dù sao cũng nên nhắc khách kiểm tra thư rác.
- **Sau khi điền, nhớ kiểm tra lại bảng khởi động**: dòng `Gửi thư` phải hiện
  `qua smtp...`, dòng `Xác thực email (OTP)` và dòng `Xác thực khi đăng nhập` phải là `BẬT`.
- Khi bật, mã xác thực được dùng ở **4 chỗ**: đăng ký tài khoản, khách tự đặt lại
  mật khẩu, đổi email trong trang Cá nhân (mã gửi tới địa chỉ mới), và **đăng nhập**.

> ⚠️ Đặt `EMAIL_OTP=on` mà **chưa** cấu hình SMTP thì **không ai đăng ký được**; đặt
> `LOGIN_OTP=on` mà chưa cấu hình SMTP thì **không ai đăng nhập được**. Cứ để `auto`:
> có SMTP là tự bật, không có thì server không khởi động ở production (trừ khi đặt
> `ALLOW_UNVERIFIED_EMAIL=1`) — vì email đăng ký sẽ không được xác thực.

> 💡 **Hạn mức gửi thư**: mỗi lần đăng nhập tốn 1 email. Gmail cá nhân ~500 thư/ngày, Brevo
> miễn phí ~300/ngày. Nếu lượng truy cập lớn, chuyển sang dịch vụ gửi thư chuyên dụng hoặc
> đặt `LOGIN_OTP=off` để chỉ dùng mật khẩu.
>
> Khi máy chủ thư gặp sự cố (hết hạn mức, sai mật khẩu ứng dụng), cách xử lý nhanh là thêm
> `LOGIN_OTP=off` vào `backend/.env` rồi khởi động lại — khách vào được ngay bằng mật khẩu,
> sửa xong SMTP thì bật lại `auto`.

### Cảnh báo bảo mật khi đăng nhập sai

Mặc định hệ thống **không tự khóa tài khoản** khi có nhiều lần đăng nhập sai. Nó ghi
nhận và tạo cảnh báo trong **Quản trị → Bảo mật**; admin quyết định xử lý.

```env
SECURITY_ALERT_THRESHOLD=10      # số lần sai để tạo cảnh báo
SECURITY_ALERT_WINDOW_MINUTES=15 # cửa sổ đếm
SECURITY_AUTO_HOLD_HOURS=0       # 0 = chỉ cảnh báo; 24 = tự tạm giữ 24h
SECURITY_STEP_UP=on              # yêu cầu OTP bổ sung nếu có cảnh báo
SECURITY_STEP_UP_HOURS=24
```

- Admin có thể **Tạm giữ 24h** hoặc **Bỏ tạm giữ** trong tab Bảo mật. Tạm giữ chặn cả
  đăng nhập mới và các phiên đang mở; hết hạn tự mở.
- `SECURITY_AUTO_HOLD_HOURS=24` chỉ nên dùng nếu bạn thật sự muốn hệ thống tự tạm giữ;
  không áp dụng cho tài khoản admin.
- Cảnh báo không chứa mật khẩu, mã OTP hay token.

Ghi chú quan trọng:

- `backend/.env` **không** được commit lên git (đã nằm trong `.gitignore`).
- Khi `NODE_ENV=production`, server sẽ **từ chối khởi động** nếu `JWT_SECRET` trống,
  bằng khoá mặc định, hoặc ngắn hơn 32 ký tự. Đây là chủ đích — khoá yếu = ai cũng
  giả được phiên đăng nhập của người khác.

### Kiểm tra cấu hình trước khi chạy

```bash
cd backend
npm run check:deploy
```

Script kiểm tra: phiên bản Node, `NODE_ENV`, độ mạnh `JWT_SECRET`, HTTPS/`TRUST_PROXY`,
`PUBLIC_BASE_URL`, `CASHBACK_RATE`, cấu hình affiliate/postback/SMTP và quyền ghi các
thư mục `data/`, `uploads/`, `backups/`. Dòng `[LỖI]` phải sửa hết; `[CẢNH BÁO]` là
những điểm nên xem lại. Script **không** in ra giá trị bí mật và không gửi email.

---

## 2. Bật HTTPS

Có hai cách, chọn **một**.

### Cách A — Nginx/Caddy làm đầu mối HTTPS (khuyến nghị)

Reverse proxy giữ chứng chỉ SSL, Node chỉ chạy nội bộ ở cổng 3000.

`/etc/nginx/sites-available/gzafl.vn`:

```nginx
server {
    listen 80;
    server_name gzafl.vn www.gzafl.vn;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name gzafl.vn www.gzafl.vn;

    ssl_certificate     /etc/letsencrypt/live/gzafl.vn/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/gzafl.vn/privkey.pem;

    client_max_body_size 8m;   # giao diện có tải ảnh đại diện

    # Nén bổ sung ở proxy (Node đã nén gzip cho JS/CSS/JSON > 1 KB;
    # Nginx sẽ không nén lần hai response đã có Content-Encoding).
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css application/javascript application/json image/svg+xml;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Rồi trong `backend/.env` **bắt buộc** thêm:

```ini
TRUST_PROXY=1
PUBLIC_BASE_URL=https://ten-mien-cua-ban.com
```

`TRUST_PROXY` để Express tin `X-Forwarded-Proto: https`. Nếu thiếu:

- cookie phiên (đang bật `secure`) sẽ bị trình duyệt từ chối ⇒ **đăng nhập xong vẫn như chưa đăng nhập**;
- link hoàn tiền tuyệt đối sẽ bị tạo với `http://` thay vì `https://`.

> **Nhật ký truy cập và postback:** mạng affiliate thường gửi `POSTBACK_SECRET` trong
> query string. Nếu Nginx ghi `$request` (format `combined` mặc định), khoá sẽ nằm trong
> file access log. Có 2 cách xử lý:
>
> 1. **Khuyến nghị:** gửi chìa khoá bằng header `X-Postback-Secret` thay vì query string
>    (nếu mạng cho phép cấu hình header/custom request). Header không bị ghi vào access log.
> 2. Nếu buộc phải để trong URL: dùng log format chỉ ghi `$uri` (bỏ query) hoặc tắt
>    access log cho `location /api/postback/`, và định kỳ đổi `POSTBACK_SECRET`.
>
> Nhật ký trong ứng dụng (`postback_logs.query`) đã tự che tham số này.

Xin chứng chỉ miễn phí bằng Let's Encrypt:

```bash
sudo certbot --nginx -d gzafl.vn -d www.gzafl.vn
```

### Cách B — Node tự chạy HTTPS (không cần Nginx)

Trong `backend/.env`:

```ini
SSL_KEY_PATH=/etc/ssl/gzafl/privkey.pem
SSL_CERT_PATH=/etc/ssl/gzafl/fullchain.pem
```

Server sẽ tự lắng nghe HTTPS. Lúc này **không** cần `TRUST_PROXY`.

> Cách B đơn giản hơn nhưng Node phải tự lo các việc Nginx làm tốt hơn (nén, chống
> DDoS, HTTP/2, tự gia hạn chứng chỉ). Nếu có thể, hãy chọn cách A.

---

## 3. Khởi động

```bash
cd backend
npm run start:prod
```

Khi chạy đúng, màn hình in ra:

```
GZ AFL backend đang chạy tại https://localhost:3000
  Môi trường            : production
  HTTPS                 : có
  Cookie chỉ-HTTPS      : BẬT
  Tin cậy reverse proxy : 1
  Giới hạn tần suất    : SQLite (dùng chung nhiều tiến trình)
  Nhà cung cấp hoàn tiền: mock (thử nghiệm, chưa tạo hoa hồng thật)
```

Giữ chạy nền bằng PM2:

```bash
sudo npm install -g pm2
cd backend
pm2 start scripts/start-prod.js --name gzafl
pm2 save
pm2 startup     # làm theo hướng dẫn in ra để tự chạy khi reboot
```

> **Khuyến nghị chạy 1 tiến trình** (PM2 mặc định là fork mode). Nếu bạn buộc phải chạy
> nhiều instance/tiến trình, đặt `RATE_LIMIT_STORE=sqlite` trong `.env` — bộ đếm chống spam
> và hạn mức AI sẽ dùng chung qua database thay vì mỗi tiến trình một bản riêng.

Hoặc service systemd (`/etc/systemd/system/gzafl.service`):

```ini
[Unit]
Description=GZ AFL backend
After=network.target

[Service]
Type=simple
WorkingDirectory=/var/www/gzafl/backend
ExecStart=/usr/bin/node scripts/start-prod.js
Restart=always
Environment=NODE_ENV=production
User=www-data

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now gzafl
```

---

## 4. Kiểm tra sau khi lên

1. Mở `https://gzafl.vn` — trang chủ phải hiển thị, không có lỗi CSS.
2. Đăng ký một tài khoản thử ⇒ phải **nhận được email chứa mã 6 chữ số**, nhập mã rồi mới tạo được tài khoản. Sau đó **tải lại trang vẫn phải còn đăng nhập**.
   (Nếu bị đăng xuất ⇒ cookie `secure` đang lệch với thực tế HTTPS — xem mục 6.
   Nếu không thấy email ⇒ kiểm tra cả thư rác, rồi xem mục 6.)
3. `https://gzafl.vn/api/health` phải trả `{"ok":true,...}`.
4. Tạo thử một đơn hàng ⇒ link hoàn tiền phải bắt đầu bằng `https://gzafl.vn/r/...`.
5. Đăng nhập bằng tài khoản quản trị ⇒ vào được trang Quản trị.
6. Bấm **"Quên mật khẩu?"** ở màn hình đăng nhập, gửi mã cho tài khoản thử ⇒ phải nhận được thư thứ hai và đặt lại được mật khẩu.
7. Vào **Cá nhân**, sửa ô Email ⇒ phải hiện khối **Xác thực email mới**; bấm *Gửi mã*, nhập mã nhận được ở địa chỉ mới rồi bấm *Lưu thay đổi* ⇒ email mới phải được lưu.
8. **Đăng nhập 2 lớp**: đăng xuất rồi đăng nhập lại ⇒ sau khi nhập đúng mật khẩu phải hiện màn hình **Xác thực đăng nhập** và có thư chứa mã; nhập mã mới vào được. Bấm *Quay lại* ở màn đó phải trở về form đăng nhập.
9. Chạy `npm test` — toàn bộ test phải **xanh**. Test dùng database + thư mục ảnh tạm, **không đụng dữ liệu thật**.
10. Kiểm tra header bảo mật:

```bash
curl -I https://gzafl.vn/
```

Phải thấy `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy` và (khi chạy HTTPS) `Strict-Transport-Security`.

---

## 5. Vận hành thường ngày

| Việc cần làm | Lệnh |
|---|---|
| Xem danh sách người dùng | `npm run make-admin -- --list` |
| Cấp quyền quản trị | `npm run make-admin -- <email>` |
| Thu quyền quản trị | `npm run make-admin -- <email> --demote` |
| Quên mật khẩu / bị khoá | `npm run reset-password -- <email>` |
| Đặt mật khẩu cụ thể | `npm run reset-password -- <email> MatKhauMoi123` |
| Đổi JWT_SECRET | `npm run gen-secret -- --write` rồi khởi động lại |
| Sao lưu dữ liệu | `npm run backup` |

Khách quên mật khẩu thường sẽ **tự xử lý được**: bấm **"Quên mật khẩu?"** ở màn hình đăng nhập,
hệ thống gửi mã xác thực về email đã đăng ký, khách nhập mã kèm mật khẩu mới là xong.

Việc của quản trị viên chỉ còn ở đường dự phòng: khi khách **chưa có email** trong tài khoản
hoặc **không nhận được thư**, khách bấm **"Không nhận được mã?"** rồi điền cách liên hệ lại.
Yêu cầu vào hàng đợi trong **Quản trị → Khôi phục mật khẩu** (tab có huy hiệu đỏ). Bấm **Đặt lại**
hai lần để cấp mật khẩu tạm, chép rồi gửi cho khách qua Zalo/điện thoại. Lệnh
`npm run reset-password` ở trên cũng tự đóng các yêu cầu đang chờ của tài khoản đó.

Khách tự đặt lại thành công thì yêu cầu đang chờ của họ **tự chuyển sang `Đã xử lý`**.

> Không đặt lại mật khẩu cho **chính tài khoản đang đăng nhập** trong trang quản trị —
> thao tác đó huỷ phiên hiện tại ngay. Hãy dùng **Cá nhân → Đổi mật khẩu**.

**Sao lưu:** dùng script có sẵn (sao lưu "nóng", **không cần dừng server**):

```bash
cd backend
npm run backup
```

Script sẽ:
- Dùng `VACUUM INTO` để tạo bản sao database **nhất quán**, kể cả khi đang có người dùng ghi dữ liệu.
- Copy toàn bộ `backend/uploads/` (ảnh đại diện + ảnh QR nhận tiền).
- Ghi `manifest.json` (thời điểm, dung lượng, số ảnh).
- Tự xoá bản sao lưu cũ hơn `BACKUP_KEEP_DAYS` ngày (mặc định **14**).

Kết quả nằm trong `backend/backups/<thời-điểm>/`.

> Bản sao lưu chứa thông tin cá nhân (email, số tài khoản, ảnh QR) — đặt quyền truy cập
> hạn chế và nên đồng bộ thư mục `backups/` sang ổ/cloud khác (quy tắc 3-2-1: 3 bản,
> 2 loại thiết bị, 1 bản ngoài máy chủ).

Đặt lịch chạy:
- **Windows** (Task Scheduler): chương trình `node`, tham số `scripts/backup.js`,
  "Start in" = thư mục `backend`, mỗi ngày 02:00.
- **Linux** (cron):
  ```bash
  0 2 * * * cd /var/www/gzafl/backend && node scripts/backup.js >> backups/backup.log 2>&1
  ```

**Phục hồi từ bản sao lưu:**
1. Dừng server (`pm2 stop gzafl` hoặc `sudo systemctl stop gzafl`).
2. Giữ lại file hiện tại để có thể quay lại nếu bản backup bị lỗi.
3. Chép `gzafl.sqlite` từ thư mục backup vào `backend/data/gzafl.sqlite`.
4. Chép thư mục `uploads/` từ backup vào `backend/uploads/`.
5. Phân quyền lại (Linux): `chown -R www-data backend/data backend/uploads`.
6. Khởi động lại và mở `/api/health` để kiểm tra.

> Đổi `JWT_SECRET` làm **mọi phiên đăng nhập hiện tại hết hiệu lực**. Người dùng chỉ
> cần đăng nhập lại; nếu ai đó quên mật khẩu thì dùng `npm run reset-password`.

---

## 6. Xử lý sự cố

**Đăng nhập xong, tải lại trang lại thành chưa đăng nhập.**
Cookie phiên đang bật cờ `secure` nhưng trình duyệt thấy kết nối là HTTP.
- Nếu chạy sau Nginx/Caddy ⇒ thêm `TRUST_PROXY=1` vào `.env` và khởi động lại.
- Nếu chạy Node trực tiếp ⇒ đặt `SSL_KEY_PATH` + `SSL_CERT_PATH`.
- Chỉ khi bạn thật sự chạy HTTP thuần (không khuyến nghị) mới đặt `COOKIE_SECURE=false`.

**Server báo `LỖI: Chưa đặt JWT_SECRET ...` rồi thoát.**
Đúng như thiết kế. Chạy `npm run gen-secret -- --write` rồi khởi động lại.

**Server báo `LỖI: Không đọc được chứng chỉ HTTPS`.**
Sai đường dẫn trong `SSL_KEY_PATH` / `SSL_CERT_PATH`, hoặc tài khoản chạy service
không có quyền đọc file chứng chỉ.

**Link hoàn tiền bị sai tên miền (`http://localhost:3000/...`).**
Thiếu `TRUST_PROXY` khi chạy sau proxy. Link mock được tạo từ `req.protocol` + `req.get('host')`; có thể đặt `PUBLIC_BASE_URL=https://ten-mien-cua-ban.com` để cố định tên miền công khai.

**Ảnh đại diện không lưu được.**
Thư mục `backend/uploads/` phải ghi được bởi tài khoản chạy service (`chown -R www-data backend/uploads`).

**Khách không nhận được email chứa mã xác thực.**
1. Xem bảng khởi động của server: dòng `Gửi thư` phải ghi `qua smtp...`. Nếu ghi
   `CHƯA cấu hình SMTP` thì `.env` chưa được đọc hoặc thiếu `SMTP_HOST`/`MAIL_FROM`.
2. Nếu server **không khởi động** và báo `production đang TẮT xác thực email` ⇒ chưa cấu
   hình SMTP (hoặc đang đặt `EMAIL_OTP=off`). Điền `SMTP_*` + `MAIL_FROM`, hoặc đặt
   `EMAIL_OTP=auto`. Chỉ khi chấp nhận rủi ro mới dùng `ALLOW_UNVERIFIED_EMAIL=1`.
   Dòng `Xác thực khi đăng nhập` ghi `tắt` cũng do chưa gửi được thư: muốn bật thì phải
   gửi được thư (hoặc đặt `LOGIN_OTP=on`, nhưng khi đó **không ai đăng nhập được** nếu chưa có SMTP).
3. Xem log server: lỗi gửi thư được in ra kèm lý do (`Invalid login`, `Connection timeout`...).
   - `Invalid login: 535` với Gmail ⇒ `SMTP_PASS` phải là **Mật khẩu ứng dụng**, không phải
     mật khẩu đăng nhập Gmail.
   - `Connection timeout` ⇒ nhà cung cấp VPS thường chặn cổng `587`; thử `SMTP_PORT=465`
     (khi đó bỏ trống `SMTP_SECURE`, hệ thống tự đặt `true`).
4. Thư vào **Spam** ⇒ khai báo SPF/DKIM cho tên miền gửi, hoặc chuyển sang Brevo.
5. Khách vẫn không nhận được ⇒ bảo khách dùng **"Không nhận được mã?"** trong màn hình
   quên mật khẩu để nhờ quản trị viên cấp lại (mục 5).
6. Nếu khách báo **"Vui lòng chờ N giây"** ⇒ đang trong thời gian chờ 60 giây giữa hai lần
   yêu cầu mã. Mã cũ vẫn còn hiệu lực, không cần gửi lại.

**Không ai đăng nhập được (báo "Không gửi được email xác thực").**
1. Đang bật xác thực khi đăng nhập mà máy chủ thư lại lỗi (hết hạn mức, sai mật khẩu ứng
   dụng, VPS chặn cổng). Xử lý nhanh: thêm `LOGIN_OTP=off` vào `backend/.env` rồi khởi
   động lại — khách vào được ngay bằng mật khẩu.
2. Sửa xong SMTP (xem lỗi ở log), đổi lại `LOGIN_OTP=auto` rồi khởi động lại.
3. **Trước khi bật**, kiểm tra tài khoản quản trị đã có **email thật đọc được** chưa: nếu
   email tài khoản là địa chỉ không tồn tại thì bạn sẽ tự khoá mình khỏi trang quản trị.
   Vào **Cá nhân** đổi email khi `LOGIN_OTP=off`, sau đó mới bật lại.

---

## 7. Danh sách biến môi trường

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `PORT` | `3000` | Cổng lắng nghe |
| `NODE_ENV` | `development` | `production` bật kiểm tra bảo mật nghiêm ngặt |
| `JWT_SECRET` | (khoá dev) | **Bắt buộc** ở production, >= 32 ký tự |
| `SSL_KEY_PATH` | – | Khoá riêng TLS (chỉ dùng cho Cách B) |
| `SSL_CERT_PATH` | – | Chứng chỉ TLS (chỉ dùng cho Cách B) |
| `TRUST_PROXY` | – | `1` / `true` / danh sách IP — bật khi chạy sau reverse proxy |
| `PUBLIC_BASE_URL` | – | URL công khai đầy đủ, ví dụ `https://ten-mien-cua-ban.com`; dùng cho link mock và hướng dẫn postback |
| `COOKIE_SECURE` | theo `NODE_ENV` | Ghi đè cờ `secure` của cookie phiên |
| `RATE_LIMIT_STORE` | `memory` | `memory` / `sqlite` — dùng `sqlite` khi chạy nhiều tiến trình/instance |
| `UPLOAD_DIR` | `backend/uploads` | Thư mục ảnh đại diện + ảnh QR (đường dẫn tương đối tính từ `backend/`) |
| `BACKUP_DIR` | `backend/backups` | Nơi lưu bản sao lưu (`npm run backup`) |
| `BACKUP_KEEP_DAYS` | `14` | Số ngày giữ bản sao lưu trước khi tự xoá |
| `EMAIL_OTP` | `auto` | Bật xác thực email (đăng ký / quên mật khẩu / đổi email): `auto` / `on` / `off`. Ở production, tắt xác thực email ⇒ server không khởi động |
| `ALLOW_UNVERIFIED_EMAIL` | – | `1` = cho phép production chạy dù email đăng ký không được xác thực (chỉ dùng khi chưa có SMTP, chấp nhận rủi ro) |
| `LOGIN_OTP` | `auto` | Bật xác thực khi đăng nhập: `auto` / `on` / `off` |
| `SECURITY_ALERT_THRESHOLD` | `10` | Số lần đăng nhập sai trong cửa sổ để tạo cảnh báo cho admin; **không tự khóa tài khoản** |
| `SECURITY_ALERT_WINDOW_MINUTES` | `15` | Cửa sổ đếm lần đăng nhập sai (phút) |
| `SECURITY_AUTO_HOLD_HOURS` | `0` | `0` = chỉ cảnh báo (khuyến nghị); `24` = tự tạm giữ 24h sau ngưỡng, admin vẫn bỏ được |
| `SECURITY_STEP_UP` | `on` | Yêu cầu OTP bổ sung khi tài khoản có cảnh báo chưa xử lý (nếu gửi được thư) |
| `SECURITY_STEP_UP_HOURS` | `24` | Cảnh báo còn hiệu lực bao lâu thì vẫn yêu cầu OTP bổ sung |
| `SMTP_HOST`, `SMTP_PORT` | – | Máy chủ gửi thư (mặc định cổng `587`) |
| `SMTP_SECURE` | theo cổng | `true` khi cổng `465`; để trống thì tự suy ra |
| `SMTP_USER`, `SMTP_PASS` | – | Tài khoản gửi thư (Gmail dùng mật khẩu ứng dụng) |
| `MAIL_FROM` | theo `SMTP_USER` | Địa chỉ người gửi |
| `MAIL_FROM_NAME` | `GZ AFL` | Tên người gửi hiện trên thư |
| `WITHDRAWAL_MIN` | `1000` | Số dư tối thiểu được rút (đồng) |
| `TEMP_PASSWORD_TTL_HOURS` | `24` | Số giờ mật khẩu tạm do quản trị viên cấp còn hiệu lực |
| `AFFILIATE_PROVIDER` | `mock` | `mock` / `accesstrade` / `shopee` |
| `AFFILIATE_LIVE_PLATFORMS` | tất cả | Giới hạn sàn dùng API thật (ví dụ `TikTok Shop`); sàn khác tạm dùng link thử nghiệm |
| `AFFILIATE_SUB_ID_PREFIX` | `gzafl` | Tiền tố `sub_id` gửi sang nhà cung cấp |
| `ACCESSTRADE_API_KEY`, `ACCESSTRADE_CAMPAIGN_SHOPEE` / `_TIKTOK` / `_TIKI` / `_LAZADA` | – | Khi `AFFILIATE_PROVIDER=accesstrade` (`ACCESSTRADE_CAMPAIGN_ID` là mặc định chung, tuỳ chọn) |
| `SHOPEE_AFFILIATE_APP_ID`, `SHOPEE_AFFILIATE_SECRET` | – | Khi `AFFILIATE_PROVIDER=shopee` |
| `POSTBACK_SECRET` | – | Khoá xác thực postback do mạng gửi kèm. **Bắt buộc** để nhận chuyển đổi; thiếu thì mọi postback bị từ chối (503) |
| `POSTBACK_PARAM_*` | tự dò | Ép tên tham số postback (ví dụ `POSTBACK_PARAM_TRANSACTION=transaction_id`) |
| `CASHBACK_RATE` | `1` | Tỷ lệ hoa hồng trả cho người dùng (0–1) |
| `SUPPORT_EMAIL`, `SUPPORT_ZALO` | – | Thông tin liên hệ hiển thị ở trang Trợ giúp + nút "Liên hệ hỗ trợ" của khung chat |
| `AI_API_KEY` | – | Khoá API cho trợ lý hỗ trợ. Bỏ trống thì trợ lý trả lời theo kịch bản có sẵn (xem mục 8) |
| `AI_BASE_URL`, `AI_MODEL` | tự đoán theo khoá | Địa chỉ API + tên model (chuẩn OpenAI) |
| `AI_ENABLED` | `true` | `off` để tạm tắt AI mà vẫn giữ khoá |
| `AI_TIMEOUT_MS`, `AI_MAX_TOKENS`, `AI_TEMPERATURE` | `25000`, `2048`, `0.4` | Thời gian chờ, độ dài và độ "sáng tạo" của câu trả lời (Gemini 2.5 dùng thêm token "suy nghĩ" trong trần này) |
| `AI_DAILY_LIMIT` | `800` | Trần tổng số lượt gọi AI mỗi ngày (mọi IP cộng lại); vượt trần thì trả lời bằng kịch bản có sẵn. `0` = không giới hạn. Bộ đếm lưu trong SQLite nên nhiều tiến trình dùng chung |
| `DB_PATH` | `backend/data/gzafl.sqlite` | Đường dẫn file database |

---

## 8. Trợ lý hỗ trợ (chatbot)

Khung chat ở góc phải-dưới **chạy được ngay khi vừa triển khai**, không cần cấu hình gì thêm: khi chưa có `AI_API_KEY`, trợ lý trả lời theo kịch bản có sẵn trong `backend/lib/supportKnowledge.js` (khớp từ khoá, có dấu hay không dấu đều được) dựa trên thông tin liên hệ ở `SUPPORT_EMAIL` / `SUPPORT_ZALO`.

Muốn trợ lý trả lời linh hoạt hơn, thêm khoá API miễn phí (Google Gemini là dễ nhất) vào `backend/.env`:

```bash
AI_API_KEY=AIza...        # hoặc khoá dạng mới AQ....
AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
AI_MODEL=gemini-3.5-flash-lite   # nhanh; đổi sang gemini-3.5-flash nếu cần chất lượng cao hơn
```

Khởi động lại rồi kiểm tra:

```bash
curl http://127.0.0.1:3000/api/support/status
# {"ai":true,"dailyLimit":800,"usedToday":0,"remainingToday":800,"suggestions":8}
```

Lưu ý khi vận hành:

- Khoá API **chỉ nằm ở server** (không lộ xuống trình duyệt). Đặt **hạn mức chi tiêu** ở phía nhà cung cấp để tránh phát sinh ngoài ý muốn.
- Mỗi IP bị giới hạn **30 tin nhắn / 10 phút**; nếu AI lỗi hoặc hết hạn mức, trợ lý **tự lùi về chế độ kịch bản** nên khách vẫn được trả lời.
- Tổng số lượt gọi AI mỗi ngày bị chặn bởi `AI_DAILY_LIMIT`; bộ đếm lưu trong SQLite nên chạy nhiều tiến trình vẫn không vượt trần.
- Hội thoại lưu ở `localStorage` của trình duyệt, server **không lưu** nội dung chat.
- Muốn sửa nội dung trả lời: sửa `backend/lib/supportKnowledge.js` (nguồn duy nhất cho cả hai chế độ). Sau khi sửa **không cần build CSS**, chỉ cần khởi động lại server.

Xem thêm: [`docs/affiliate-integration.md`](./affiliate-integration.md) để nối nhà cung cấp hoàn tiền thật.
