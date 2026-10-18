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
WITHDRAWAL_MIN=50000
AFFILIATE_PROVIDER=mock        # đổi khi có tài khoản affiliate thật
```

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
2. Đăng ký một tài khoản thử ⇒ **tải lại trang vẫn phải còn đăng nhập**.
   (Nếu bị đăng xuất ⇒ cookie `secure` đang lệch với thực tế HTTPS — xem mục 6.)
3. `https://gzafl.vn/api/health` phải trả `{"ok":true,...}`.
4. Tạo thử một đơn hàng ⇒ link hoàn tiền phải bắt đầu bằng `https://gzafl.vn/r/...`.
5. Đăng nhập bằng tài khoản quản trị ⇒ vào được trang Quản trị.

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

Khách quên mật khẩu thường sẽ tự bấm **"Quên mật khẩu?"** ở màn hình đăng nhập. Yêu cầu
vào hàng đợi trong **Quản trị → Khôi phục mật khẩu** (tab có huy hiệu đỏ). Bấm **Đặt lại**
hai lần để cấp mật khẩu tạm, chép rồi gửi cho khách qua Zalo/điện thoại. Lệnh
`npm run reset-password` ở trên cũng tự đóng các yêu cầu đang chờ của tài khoản đó.

> Không đặt lại mật khẩu cho **chính tài khoản đang đăng nhập** trong trang quản trị —
> thao tác đó huỷ phiên hiện tại ngay. Hãy dùng **Cá nhân → Đổi mật khẩu**.

**Sao lưu:** toàn bộ dữ liệu nằm trong một file `backend/data/gzafl.sqlite`.
Muốn backup thì dừng server (hoặc dùng `sqlite3 gzafl.sqlite ".backup ..."`) rồi copy file đi.
Ảnh đại diện nằm trong `backend/uploads/` — cũng cần backup.

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
| `WITHDRAWAL_MIN` | `50000` | Số dư tối thiểu được rút (đồng) |
| `AFFILIATE_PROVIDER` | `mock` | `mock` / `accesstrade` / `shopee` |
| `AFFILIATE_SUB_ID_PREFIX` | `gzafl` | Tiền tố `sub_id` gửi sang nhà cung cấp |
| `ACCESSTRADE_API_KEY`, `ACCESSTRADE_CAMPAIGN_ID` | – | Khi `AFFILIATE_PROVIDER=accesstrade` |
| `SHOPEE_AFFILIATE_APP_ID`, `SHOPEE_AFFILIATE_SECRET` | – | Khi `AFFILIATE_PROVIDER=shopee` |
| `SUPPORT_EMAIL`, `SUPPORT_ZALO` | – | Thông tin liên hệ hiển thị ở trang Trợ giúp |
| `DB_PATH` | `backend/data/gzafl.sqlite` | Đường dẫn file database |

Xem thêm: [`docs/affiliate-integration.md`](./affiliate-integration.md) để nối nhà cung cấp hoàn tiền thật.
