# Triển khai GZ AFL lên production

Tài liệu này mô tả cách đưa website lên một máy chủ thật, có **HTTPS** và **JWT_SECRET riêng**.
Làm theo đúng thứ tự dưới đây là đủ; phần cuối có mục xử lý sự cố.

---

## 0. Chuẩn bị

- Máy chủ có **Node.js >= 22.5** (khuyến nghị 22 LTS hoặc 24).
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
**xác thực khi đăng nhập**, điền thêm máy chủ gửi thư. Chưa điền cũng chạy bình thường —
chỉ là bước xác thực tắt đi (và server in cảnh báo lúc khởi động, xem mục
[5](#5-vận-hành-thường-ngày)).

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
> có SMTP là tự bật, không có thì tự tắt.

> 💡 **Hạn mức gửi thư**: mỗi lần đăng nhập tốn 1 email. Gmail cá nhân ~500 thư/ngày, Brevo
> miễn phí ~300/ngày. Nếu lượng truy cập lớn, chuyển sang dịch vụ gửi thư chuyên dụng hoặc
> đặt `LOGIN_OTP=off` để chỉ dùng mật khẩu.
>
> Khi máy chủ thư gặp sự cố (hết hạn mức, sai mật khẩu ứng dụng), cách xử lý nhanh là thêm
> `LOGIN_OTP=off` vào `backend/.env` rồi khởi động lại — khách vào được ngay bằng mật khẩu,
> sửa xong SMTP thì bật lại `auto`.

Ghi chú quan trọng:

- `backend/.env` **không** được commit lên git (đã nằm trong `.gitignore`).
- Khi `NODE_ENV=production`, server sẽ **từ chối khởi động** nếu `JWT_SECRET` trống,
  bằng khoá mặc định, hoặc ngắn hơn 32 ký tự. Đây là chủ đích — khoá yếu = ai cũng
  giả được phiên đăng nhập của người khác.

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
```

`TRUST_PROXY` để Express tin `X-Forwarded-Proto: https`. Nếu thiếu:

- cookie phiên (đang bật `secure`) sẽ bị trình duyệt từ chối ⇒ **đăng nhập xong vẫn như chưa đăng nhập**;
- link hoàn tiền tuyệt đối sẽ bị tạo với `http://` thay vì `https://`.

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
| Sao lưu dữ liệu | copy file `backend/data/gzafl.sqlite` |

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

**Sao lưu:** toàn bộ dữ liệu nằm trong một file `backend/data/gzafl.sqlite`.
Muốn backup thì dừng server (hoặc dùng `sqlite3 gzafl.sqlite ".backup ..."`) rồi copy file đi.
Ảnh đại diện **và ảnh QR nhận tiền** nằm trong `backend/uploads/` — cũng cần backup.

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
Thiếu `TRUST_PROXY` khi chạy sau proxy. Link được tạo từ `req.protocol` + `req.get('host')`.

**Ảnh đại diện không lưu được.**
Thư mục `backend/uploads/` phải ghi được bởi tài khoản chạy service (`chown -R www-data backend/uploads`).

**Khách không nhận được email chứa mã xác thực.**
1. Xem bảng khởi động của server: dòng `Gửi thư` phải ghi `qua smtp...`. Nếu ghi
   `CHƯA cấu hình SMTP` thì `.env` chưa được đọc hoặc thiếu `SMTP_HOST`/`MAIL_FROM`.
2. Nếu dòng `Xác thực email (OTP)` ghi `tắt` ⇒ đang là `EMAIL_OTP=auto` mà chưa có SMTP.
   Dòng `Xác thực khi đăng nhập` ghi `tắt` cùng nguyên nhân: muốn bật thì phải gửi được
   thư (hoặc đặt `LOGIN_OTP=on`, nhưng khi đó **không ai đăng nhập được** nếu chưa có SMTP).
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
| `COOKIE_SECURE` | theo `NODE_ENV` | Ghi đè cờ `secure` của cookie phiên |
| `EMAIL_OTP` | `auto` | Bật xác thực email (đăng ký / quên mật khẩu / đổi email): `auto` / `on` / `off` |
| `LOGIN_OTP` | `auto` | Bật xác thực khi đăng nhập: `auto` / `on` / `off` |
| `SMTP_HOST`, `SMTP_PORT` | – | Máy chủ gửi thư (mặc định cổng `587`) |
| `SMTP_SECURE` | theo cổng | `true` khi cổng `465`; để trống thì tự suy ra |
| `SMTP_USER`, `SMTP_PASS` | – | Tài khoản gửi thư (Gmail dùng mật khẩu ứng dụng) |
| `MAIL_FROM` | theo `SMTP_USER` | Địa chỉ người gửi |
| `MAIL_FROM_NAME` | `GZ AFL` | Tên người gửi hiện trên thư |
| `WITHDRAWAL_MIN` | `1000` | Số dư tối thiểu được rút (đồng) |
| `AFFILIATE_PROVIDER` | `mock` | `mock` / `accesstrade` / `shopee` |
| `AFFILIATE_SUB_ID_PREFIX` | `gzafl` | Tiền tố `sub_id` gửi sang nhà cung cấp |
| `ACCESSTRADE_API_KEY`, `ACCESSTRADE_CAMPAIGN_ID` | – | Khi `AFFILIATE_PROVIDER=accesstrade` |
| `SHOPEE_AFFILIATE_APP_ID`, `SHOPEE_AFFILIATE_SECRET` | – | Khi `AFFILIATE_PROVIDER=shopee` |
| `SUPPORT_EMAIL`, `SUPPORT_ZALO` | – | Thông tin liên hệ hiển thị ở trang Trợ giúp + nút "Liên hệ hỗ trợ" của khung chat |
| `AI_API_KEY` | – | Khoá API cho trợ lý hỗ trợ. Bỏ trống thì trợ lý trả lời theo kịch bản có sẵn (xem mục 8) |
| `AI_BASE_URL`, `AI_MODEL` | tự đoán theo khoá | Địa chỉ API + tên model (chuẩn OpenAI) |
| `AI_ENABLED` | `true` | `off` để tạm tắt AI mà vẫn giữ khoá |
| `AI_TIMEOUT_MS`, `AI_MAX_TOKENS`, `AI_TEMPERATURE` | `25000`, `600`, `0.4` | Thời gian chờ, độ dài và độ "sáng tạo" của câu trả lời |
| `DB_PATH` | `backend/data/gzafl.sqlite` | Đường dẫn file database |

---

## 8. Trợ lý hỗ trợ (chatbot)

Khung chat ở góc phải-dưới **chạy được ngay khi vừa triển khai**, không cần cấu hình gì thêm: khi chưa có `AI_API_KEY`, trợ lý trả lời theo kịch bản có sẵn trong `backend/lib/supportKnowledge.js` (khớp từ khoá, có dấu hay không dấu đều được) dựa trên thông tin liên hệ ở `SUPPORT_EMAIL` / `SUPPORT_ZALO`.

Muốn trợ lý trả lời linh hoạt hơn, thêm khoá API miễn phí (Google Gemini là dễ nhất) vào `backend/.env`:

```bash
AI_API_KEY=AIza...
AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
AI_MODEL=gemini-2.5-flash
```

Khởi động lại rồi kiểm tra:

```bash
curl http://127.0.0.1:3000/api/support/status
# {"ai":true,"provider":"Google Gemini","model":"gemini-2.5-flash","suggestions":7}
```

Lưu ý khi vận hành:

- Khoá API **chỉ nằm ở server** (không lộ xuống trình duyệt). Đặt **hạn mức chi tiêu** ở phía nhà cung cấp để tránh phát sinh ngoài ý muốn.
- Mỗi IP bị giới hạn **30 tin nhắn / 10 phút**; nếu AI lỗi hoặc hết hạn mức, trợ lý **tự lùi về chế độ kịch bản** nên khách vẫn được trả lời.
- Hội thoại lưu ở `localStorage` của trình duyệt, server **không lưu** nội dung chat.
- Muốn sửa nội dung trả lời: sửa `backend/lib/supportKnowledge.js` (nguồn duy nhất cho cả hai chế độ). Sau khi sửa **không cần build CSS**, chỉ cần khởi động lại server.

Xem thêm: [`docs/affiliate-integration.md`](./affiliate-integration.md) để nối nhà cung cấp hoàn tiền thật.
