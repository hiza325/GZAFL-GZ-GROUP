# Deploy GZ AFL — bộ file sẵn sàng chạy

Thư mục này chứa cấu hình deploy cho từng kiểu máy chủ. Chọn **một** cách bên dưới.

| Cách | Phù hợp | HTTPS | Ghi chú |
|---|---|---|---|
| **A. VPS Linux + Nginx + systemd** | Khuyến nghị cho production | Certbot (Let's Encrypt) | Script cài đặt 1 lệnh |
| **B. Linux/Windows + PM2** | Đã quen PM2, hoặc Windows | Tự cấu hình | `deploy/pm2/ecosystem.config.js` |
| **C. Docker + Caddy** | Muốn tách môi trường, HTTPS tự động | Caddy tự xin cert | `docker-compose.caddy.yml` |
| **D. Windows + Task Scheduler** | Chạy trên máy Windows | Tự cấu hình | Không cần cài thêm phần mềm |

> **Database:** không cần cài MySQL/PostgreSQL. Backend dùng SQLite, dữ liệu là file
> `backend/data/gzafl.sqlite`. Chỉ cần thư mục `data/`, `uploads/`, `backups/` ghi được
> và **sao lưu** file đó định kỳ.

---

## Chuẩn bị chung (mọi cách)

1. **Node.js >= 22.13** (khuyến nghị **24 LTS**).
2. **Tên miền** đã trỏ A record về IP máy chủ.
3. **SMTP** gửi được thư — ở `NODE_ENV=production` server **từ chối khởi động** nếu chưa
   xác thực được email (trừ khi đặt `ALLOW_UNVERIFIED_EMAIL=1`).
4. File `backend/.env` — mẫu đầy đủ ở [`deploy/.env.production.example`](.env.production.example).

Sinh `JWT_SECRET` nhanh (nếu không dùng script):

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Sinh `POSTBACK_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## A. VPS Linux + Nginx + systemd (khuyến nghị)

Áp dụng cho Ubuntu 22.04/24.04, Debian 12.

```bash
# 1) Lấy code (đừng đặt trong thư mục OneDrive/Dropbox)
sudo apt-get update && sudo apt-get install -y git
sudo git clone <repo-url> /var/www/gzafl
cd /var/www/gzafl

# 2) Cài app + service (script tự cài Node 24 nếu cần)
sudo bash deploy/scripts/install-app.sh ten-mien-cua-ban.com
```

Lần chạy đầu script sẽ tạo `backend/.env` (SMTP còn trống) nên **dừng lại** và báo lỗi.
Điền SMTP rồi chạy lại:

```bash
sudo nano /var/www/gzafl/backend/.env      # SMTP_HOST, SMTP_USER, SMTP_PASS, MAIL_FROM
sudo bash deploy/scripts/install-app.sh ten-mien-cua-ban.com
```

Script làm: `npm ci --omit=dev` → tạo `.env` + `JWT_SECRET` → phân quyền `data/uploads/backups`
→ cài `/etc/systemd/system/gzafl.service` → `check:deploy` → khởi động → gọi `/api/health`.

### Nginx + HTTPS

```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx

# Log không ghi query string (postback chứa secret) - PHẢI cài trước
sudo cp deploy/nginx/00-log-format.conf /etc/nginx/conf.d/00-gzafl-log.conf

# Bước 1: cấu hình HTTP tạm để xin chứng chỉ
sudo cp deploy/nginx/gzafl-bootstrap.conf /etc/nginx/sites-available/gzafl.conf
sudo sed -i 's/gzafl\.vn/ten-mien-cua-ban.com/g' /etc/nginx/sites-available/gzafl.conf
sudo ln -sf /etc/nginx/sites-available/gzafl.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# Bước 2: xin chứng chỉ (webroot, không sửa cấu hình)
sudo certbot certonly --webroot -w /var/www/html \
  -d ten-mien-cua-ban.com -d www.ten-mien-cua-ban.com

# Bước 3: thay bằng cấu hình HTTPS đầy đủ
sudo cp deploy/nginx/gzafl.conf /etc/nginx/sites-available/gzafl.conf
sudo sed -i 's/gzafl\.vn/ten-mien-cua-ban.com/g' /etc/nginx/sites-available/gzafl.conf
sudo nginx -t && sudo systemctl reload nginx

# Kiểm tra tự gia hạn
sudo certbot renew --dry-run
```

Nếu `certbot renew` không tự reload Nginx, thêm hook:

```bash
echo 'systemctl reload nginx' | sudo tee /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
```

Kiểm tra `backend/.env` có:

```ini
TRUST_PROXY=1
PUBLIC_BASE_URL=https://ten-mien-cua-ban.com
```

### Cấp quyền quản trị

Đăng ký một tài khoản trên web trước, sau đó:

```bash
cd /var/www/gzafl/backend
sudo npm run make-admin -- email-cua-ban@example.com
```

### Sao lưu hằng ngày

```bash
sudo cp deploy/cron/gzafl-backup /etc/cron.d/gzafl-backup
sudo sed -i 's|@APP_DIR@|/var/www/gzafl|g; s|@SERVICE_USER@|www-data|g' /etc/cron.d/gzafl-backup
sudo chmod 644 /etc/cron.d/gzafl-backup
```

### Cập nhật bản mới

```bash
cd /var/www/gzafl
sudo bash deploy/scripts/deploy.sh
```

`deploy.sh` tự sao lưu dữ liệu trước khi restart (tắt bằng `SKIP_BACKUP=1`),
chạy `check:deploy`, restart systemd/PM2 và kiểm tra `/api/health`. Nếu check lỗi,
**không restart** — web vẫn chạy bản cũ.

---

## B. PM2 (Linux/macOS/Windows)

```bash
# Trong thư mục repo
cd backend
npm ci --omit=dev
cp ../deploy/.env.production.example .env
npm run gen-secret -- --write
# sửa .env: PUBLIC_BASE_URL, SMTP_*, POSTBACK_SECRET...

npm run check:deploy          # phải không còn [LỖI]
cd ..

sudo npm install -g pm2
pm2 start deploy/pm2/ecosystem.config.js
pm2 save
pm2 startup                   # Linux: tự chạy khi reboot (làm theo hướng dẫn in ra)
```

Log:

```bash
pm2 logs gzafl
pm2 install pm2-logrotate     # xoay vòng log (khuyến nghị)
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 14
```

> Chỉ chạy **1 instance** (file cấu hình đã đặt `instances: 1`). SQLite là file cục bộ.
> Nếu buộc chạy nhiều tiến trình trên cùng máy, đặt `RATE_LIMIT_STORE=sqlite`.

> **Windows:** `pm2 startup` không dùng được. Hãy dùng cách **D** (Task Scheduler) hoặc cài
> `pm2-windows-startup`: `npm i -g pm2-windows-startup && pm2-startup install`.

---

## C. Docker

### C1. Đứng sau Nginx/Caddy có sẵn

```bash
cp deploy/.env.production.example backend/.env
nano backend/.env              # PUBLIC_BASE_URL, SMTP_*, JWT_SECRET, POSTBACK_SECRET
docker compose up -d --build
docker compose logs -f app
curl http://127.0.0.1:3000/api/health
```

Cổng chỉ mở ở `127.0.0.1:3000` (bắt buộc đi qua proxy có HTTPS). Dữ liệu nằm trong
Docker volume: `gzafl-data`, `gzafl-uploads`, `gzafl-backups`.

### C2. Docker + Caddy (HTTPS tự động, không cần Nginx)

```bash
cp deploy/.env.production.example backend/.env
nano backend/.env

DOMAIN=ten-mien-cua-ban.com docker compose -f docker-compose.caddy.yml up -d --build
docker compose -f docker-compose.caddy.yml logs -f
```

Caddy tự xin + gia hạn chứng chỉ Let's Encrypt (domain phải trỏ đúng IP, mở cổng 80/443).
Caddy mặc định **không** ghi access log nên không lộ `POSTBACK_SECRET` trong URL.

Sao lưu:

```bash
docker compose exec app npm run backup
docker cp gzafl:/app/backend/backups ./backups-$(date +%F)
```

Lưu ý: `backend/.env` bị `.dockerignore` loại khỏi image; biến được truyền qua `env_file`.

---

## D. Windows + Task Scheduler

1. Chuyển repo ra khỏi OneDrive, ví dụ `C:\gzafl`.
2. Cài **Node.js 24 LTS** (kiểm tra `node -v`).
3. Trong PowerShell:

```powershell
cd C:\gzafl\backend
npm ci --omit=dev
cd ..
powershell -ExecutionPolicy Bypass -File deploy\windows\install-task.ps1
```

Lần đầu script tạo `backend\.env` + `JWT_SECRET` rồi thoát. Sửa `backend\.env`
(`PUBLIC_BASE_URL`, `SMTP_*`), chạy lại script để đăng ký task.

```powershell
# Kiểm tra
curl.exe http://127.0.0.1:3000/api/health
Get-ScheduledTask -TaskName GZAFL | Get-ScheduledTaskInfo
# Gỡ
Unregister-ScheduledTask -TaskName GZAFL -Confirm:$false
```

Task chạy bằng `SYSTEM`, tự khởi động khi boot và tự chạy lại nếu thoát lỗi.
Muốn dùng HTTPS trên Windows: đặt `SSL_KEY_PATH` + `SSL_CERT_PATH` trong `.env`
(không cần Task Scheduler thay đổi gì).

---

## Checklist trước khi mở cho khách

- [ ] `cd backend && npm run check:deploy` — không còn dòng `[LỖI]`
- [ ] `NODE_ENV=production`, `JWT_SECRET` >= 32 ký tự (không phải khoá mặc định)
- [ ] `PUBLIC_BASE_URL=https://...` đúng tên miền
- [ ] `TRUST_PROXY=1` nếu chạy sau Nginx/Caddy/Cloudflare
- [ ] SMTP gửi được thư thật (đăng ký thử → nhận mã 6 số)
- [ ] `https://domain/api/health` trả `{"ok":true,...}`
- [ ] Đăng nhập → tải lại trang **vẫn còn đăng nhập** (cookie secure OK)
- [ ] Tạo đơn thử → link hoàn tiền bắt đầu bằng `https://domain/r/...`
- [ ] `POSTBACK_SECRET` đã đặt (nếu nhận hoa hồng từ mạng affiliate)
- [ ] Đã cấp quyền admin bằng `npm run make-admin -- <email>`
- [ ] Cron backup chạy và có file trong `backend/backups/`
- [ ] `backend/.env` **không** nằm trong git
- [ ] Không chạy source trên OneDrive/Dropbox (SQLite bị khoá file)

Sau khi lên, kiểm tra header bảo mật:

```bash
curl -I https://ten-mien-cua-ban.com/
# Phải có: Content-Security-Policy, X-Content-Type-Options, X-Frame-Options,
#          Referrer-Policy, Strict-Transport-Security
```

---

## Xử lý sự cố nhanh

| Hiện tượng | Nguyên nhân thường gặp | Cách sửa |
|---|---|---|
| Đăng nhập xong tải lại bị văng | Thiếu `TRUST_PROXY` sau proxy | Thêm `TRUST_PROXY=1`, restart |
| Server thoát, báo `Chưa đặt JWT_SECRET` | Chưa sinh khoá | `cd backend && npm run gen-secret -- --write` |
| Server thoát, báo `production đang TẮT xác thực email` | Chưa cấu hình SMTP | Điền `SMTP_*` + `MAIL_FROM`, hoặc tạm `ALLOW_UNVERIFIED_EMAIL=1` |
| `502 Bad Gateway` | App không chạy / sai cổng | `journalctl -u gzafl -n 100` hoặc `pm2 logs gzafl` |
| `unknown log format "gzafl_safe"` | Chưa cài file log format | Copy `00-log-format.conf` vào `/etc/nginx/conf.d/` |
| Link hoàn tiền ra `http://localhost:3000` | Thiếu `TRUST_PROXY` / `PUBLIC_BASE_URL` | Đặt cả hai trong `.env`, restart |
| Không lưu được avatar/QR | Sai quyền `uploads/` | `sudo chown -R www-data:www-data backend/uploads` |
| `database is locked` | Chạy nhiều máy cùng trỏ vào 1 file SQLite | Chỉ chạy 1 máy; dùng 1 tiến trình |
| Script `.sh` lỗi `bad interpreter: ^M` | File bị CRLF khi clone trên Windows | `sed -i 's/\r$//' deploy/scripts/*.sh` (repo đã có `.gitattributes`) |

Xem thêm: [`docs/deployment.md`](../docs/deployment.md) — hướng dẫn gốc đầy đủ về
Nginx, systemd, PM2, email, sao lưu/phục hồi và toàn bộ biến môi trường.
