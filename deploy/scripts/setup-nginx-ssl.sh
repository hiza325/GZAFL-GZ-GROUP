#!/usr/bin/env bash
# ---------------------------------------------------------------
# GZ AFL - cài Nginx + HTTPS (Let's Encrypt) trong 1 lệnh
#
# Dùng:
#   sudo bash deploy/scripts/setup-nginx-ssl.sh gzafl.example.com you@example.com
#
# Điều kiện:
#   - Domain đã trỏ A record về IP máy chủ này (kiểm tra: dig +short domain)
#   - Cổng 80 và 443 đã mở
#   - Backend đã chạy trên 127.0.0.1:PORT (chạy install-app.sh trước)
#
# Script làm:
#   1. Cài nginx + certbot
#   2. Cài log format không ghi query string
#   3. Bật cấu hình HTTP tạm + xin chứng chỉ bằng webroot
#   4. Thay bằng cấu hình HTTPS đầy đủ
#   5. Thêm hook reload nginx khi cert tự gia hạn
#   6. Kiểm tra https://domain/api/health
# ---------------------------------------------------------------
set -euo pipefail

DOMAIN="${1:-${DOMAIN:-}}"
EMAIL="${2:-${LETSENCRYPT_EMAIL:-}}"
APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
SERVICE_NAME="${SERVICE_NAME:-gzafl}"

step() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[!] %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m[LỖI] %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Phải chạy bằng root/sudo."
[ -n "$DOMAIN" ] || die "Thiếu domain. Dùng: sudo bash deploy/scripts/setup-nginx-ssl.sh ten-mien.com email@example.com"
[ -n "$EMAIL" ] || die "Thiếu email cho Let's Encrypt: sudo bash deploy/scripts/setup-nginx-ssl.sh ten-mien.com email@example.com"
command -v apt-get >/dev/null 2>&1 || die "Script này dành cho Ubuntu/Debian."
[ -f "$APP_DIR/deploy/nginx/gzafl.conf" ] || die "Không tìm thấy deploy/nginx/gzafl.conf trong $APP_DIR"

# Bỏ http(s):// và path nếu người dùng nhập cả URL
DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN%%/*}"

step "Domain: $DOMAIN"
step "Email : $EMAIL"

# --- 1. Gói cần thiết ------------------------------------------
step "Cài nginx + certbot"
apt-get update -y
apt-get install -y nginx certbot python3-certbot-nginx curl dnsutils
systemctl enable nginx >/dev/null
systemctl start nginx

# --- 2. Log format an toàn -------------------------------------
step "Cài log format (không ghi query string)"
install -m 644 "$APP_DIR/deploy/nginx/00-log-format.conf" /etc/nginx/conf.d/00-gzafl-log.conf

# --- 3. Cấu hình HTTP tạm + xin chứng chỉ ----------------------
SITE=/etc/nginx/sites-available/${SERVICE_NAME}.conf
step "Bật cấu hình HTTP tạm"
sed "s/gzafl\.vn/${DOMAIN}/g" "$APP_DIR/deploy/nginx/gzafl-bootstrap.conf" > "$SITE"
ln -sf "$SITE" "/etc/nginx/sites-enabled/${SERVICE_NAME}.conf"

# Tắt site mặc định nếu nó chiếm default_server (không xoá file gốc)
if [ -e /etc/nginx/sites-enabled/default ]; then
  rm -f /etc/nginx/sites-enabled/default
  warn "Đã tắt site mặc định của nginx (/etc/nginx/sites-enabled/default)."
fi

nginx -t
systemctl reload nginx

# Kiểm tra DNS trước khi xin cert để báo lỗi dễ hiểu
resolved="$(getent hosts "$DOMAIN" | awk '{print $1}' | head -1 || true)"
if [ -z "$resolved" ]; then
  die "Domain $DOMAIN chưa phân giải được. Kiểm tra A record rồi chạy lại."
fi
step "DNS $DOMAIN -> $resolved"

step "Xin chứng chỉ Let's Encrypt"
certbot certonly --webroot -w /var/www/html \
  --non-interactive --agree-tos -m "$EMAIL" \
  -d "$DOMAIN" \
  || die "Không xin được chứng chỉ. Kiểm tra: domain đã trỏ đúng IP, cổng 80 mở, và thử lại."

# --- 4. Cấu hình HTTPS đầy đủ ----------------------------------
step "Bật cấu hình HTTPS đầy đủ"
sed "s/gzafl\.vn/${DOMAIN}/g" "$APP_DIR/deploy/nginx/gzafl.conf" > "$SITE"
nginx -t
systemctl reload nginx

# --- 5. Tự reload nginx khi cert gia hạn ------------------------
step "Thêm hook reload nginx khi cert tự gia hạn"
mkdir -p /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh <<'HOOK'
#!/bin/sh
systemctl reload nginx
HOOK
chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh

step "Kiểm tra gia hạn tự động (dry-run)"
certbot renew --dry-run || warn "Dry-run thất bại - kiểm tra lại certbot sau."

# --- 6. Kiểm tra -----------------------------------------------
step "Kiểm tra https://${DOMAIN}/api/health"
if curl -fsS --max-time 15 "https://${DOMAIN}/api/health"; then
  echo
  step "HTTPS đã hoạt động."
else
  warn "Chưa gọi được https://${DOMAIN}/api/health"
  warn "Xem log: journalctl -u ${SERVICE_NAME} -n 80 --no-pager"
  warn "         tail -n 80 /var/log/nginx/error.log"
  exit 1
fi

cat <<EOF

===============================================================
 Nginx + HTTPS đã cấu hình cho https://${DOMAIN}

 Kiểm tra thêm:
   curl -I https://${DOMAIN}/          # phải có HSTS, CSP...
   systemctl status ${SERVICE_NAME}
   certbot certificates

 Nhắc lại: backend/.env phải có
   PUBLIC_BASE_URL=https://${DOMAIN}
   TRUST_PROXY=1
 rồi khởi động lại: sudo systemctl restart ${SERVICE_NAME}
===============================================================

EOF
