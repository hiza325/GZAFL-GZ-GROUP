#!/usr/bin/env bash
# ---------------------------------------------------------------
# GZ AFL - cài đặt lần đầu trên Ubuntu/Debian (VPS)
#
# Dùng:
#   sudo bash deploy/scripts/install-app.sh ten-mien-cua-ban.com
#
# Script làm:
#   1. Cài Node.js 24 (nếu chưa có / quá cũ)
#   2. npm ci --omit=dev
#   3. Tạo backend/.env từ deploy/.env.production.example + sinh JWT_SECRET
#   4. Tạo thư mục data/uploads/backups và phân quyền
#   5. Cài systemd service + bật chạy
#   6. Chạy check:deploy và kiểm tra /api/health
#
# Script KHÔNG cài Nginx/SSL và KHÔNG tạo tài khoản admin.
# Xem deploy/README.md cho các bước còn lại.
# ---------------------------------------------------------------
set -euo pipefail

DOMAIN="${1:-${DOMAIN:-}}"
APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
SERVICE_NAME="${SERVICE_NAME:-gzafl}"
SERVICE_USER="${2:-${SERVICE_USER:-www-data}}"
NODE_MAJOR="${NODE_MAJOR:-24}"

step() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[!] %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m[LỖI] %s\033[0m\n' "$*" >&2; exit 1; }

# --- 0. Kiểm tra môi trường ------------------------------------
[ "$(id -u)" -eq 0 ] || die "Phải chạy bằng root/sudo."
[ -n "$DOMAIN" ] || die "Thiếu tên miền. Dùng: sudo bash deploy/scripts/install-app.sh ten-mien-cua-ban.com"
command -v apt-get >/dev/null 2>&1 || die "Script này dành cho Ubuntu/Debian. Máy khác xem deploy/README.md (Docker/PM2)."
[ -f "$APP_DIR/backend/package.json" ] || die "Không tìm thấy backend/ trong $APP_DIR"

# Bỏ http(s):// và dấu / ở cuối nếu người dùng nhập cả URL
DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN%%/*}"

step "Thư mục ứng dụng : $APP_DIR"
step "Tên miền         : $DOMAIN"
step "User chạy service: $SERVICE_USER"

# --- 1. Node.js -------------------------------------------------
need_node=1
if command -v node >/dev/null 2>&1; then
  read -r node_major node_minor < <(node -p 'process.versions.node.split(".").slice(0,2).join(" ")')
  if [ "$node_major" -gt 22 ] || { [ "$node_major" -eq 22 ] && [ "$node_minor" -ge 13 ]; }; then
    need_node=0
  fi
fi

if [ "$need_node" -eq 1 ]; then
  step "Cài Node.js ${NODE_MAJOR}.x từ NodeSource"
  apt-get update -y
  apt-get install -y curl ca-certificates
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
else
  step "Đã có Node.js $(node -v) - bỏ qua cài đặt"
fi

node -e "require('node:sqlite')" >/dev/null 2>&1 \
  || die "Node hiện tại không có module node:sqlite. Cần Node >= 22.13 (khuyến nghị 24 LTS)."
step "Node.js $(node -v) - node:sqlite OK"

# --- 2. User chạy service --------------------------------------
if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  step "Tạo user hệ thống $SERVICE_USER"
  useradd --system --create-home --shell /usr/sbin/nologin "$SERVICE_USER"
fi

# --- 3. Dependencies -------------------------------------------
step "Cài dependency production"
cd "$APP_DIR/backend"
npm ci --omit=dev --no-audit --no-fund

# --- 4. File .env ----------------------------------------------
if [ ! -f "$APP_DIR/backend/.env" ]; then
  step "Tạo backend/.env từ mẫu production"
  cp "$APP_DIR/deploy/.env.production.example" "$APP_DIR/backend/.env"
  sed -i "s|^PUBLIC_BASE_URL=.*|PUBLIC_BASE_URL=https://${DOMAIN}|" "$APP_DIR/backend/.env"
  step "Sinh JWT_SECRET"
  npm run gen-secret -- --write
else
  warn "backend/.env đã tồn tại - giữ nguyên, không ghi đè."
  current_base="$(grep -E '^PUBLIC_BASE_URL=' "$APP_DIR/backend/.env" | tail -1 | cut -d= -f2- || true)"
  if [ -z "$current_base" ]; then
    warn "PUBLIC_BASE_URL đang trống. Thêm: PUBLIC_BASE_URL=https://${DOMAIN}"
  elif [ "$current_base" != "https://${DOMAIN}" ]; then
    warn "PUBLIC_BASE_URL hiện là '$current_base' (bạn truyền vào 'https://${DOMAIN}'). Kiểm tra lại nếu cần."
  fi
fi

# --- 5. Thư mục dữ liệu + quyền --------------------------------
step "Tạo thư mục dữ liệu và phân quyền"
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 755 \
  "$APP_DIR/backend/data" \
  "$APP_DIR/backend/uploads" \
  "$APP_DIR/backend/backups"

# .env: root đọc/ghi, service user chỉ đọc
chown "root:${SERVICE_USER}" "$APP_DIR/backend/.env"
chmod 640 "$APP_DIR/backend/.env"

# --- 6. systemd ------------------------------------------------
step "Cài systemd service /etc/systemd/system/${SERVICE_NAME}.service"
sed -e "s|@APP_DIR@|${APP_DIR}|g" \
    -e "s|@SERVICE_USER@|${SERVICE_USER}|g" \
    "$APP_DIR/deploy/systemd/gzafl.service" \
  > "/etc/systemd/system/${SERVICE_NAME}.service"

# Node có thể nằm ở /usr/local/bin (nvm) - sửa ExecStart cho đúng
NODE_BIN="$(command -v node)"
sed -i "s|^ExecStart=.*|ExecStart=${NODE_BIN} scripts/start-prod.js|" \
  "/etc/systemd/system/${SERVICE_NAME}.service"

systemctl daemon-reload

# --- 7. Kiểm tra cấu hình -------------------------------------
step "Chạy kiểm tra cấu hình production"
set +e
npm run check:deploy
CHECK_EXIT=$?
set -e

if [ "$CHECK_EXIT" -ne 0 ]; then
  warn "check:deploy còn LỖI nên service CHƯA được bật (tránh crash-loop)."
  warn "Sửa backend/.env rồi chạy lại:"
  warn "    sudo bash $APP_DIR/deploy/scripts/install-app.sh $DOMAIN"
  exit "$CHECK_EXIT"
fi

# Chỉ enable khi cấu hình đã đạt
systemctl enable "$SERVICE_NAME" >/dev/null

# --- 8. Khởi động + health check -------------------------------
step "Khởi động service"
systemctl restart "$SERVICE_NAME"

PORT="$(grep -E '^PORT=' "$APP_DIR/backend/.env" | tail -1 | cut -d= -f2 | tr -d '[:space:]' || true)"
PORT="${PORT:-3000}"

for i in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    step "OK - server trả /api/health bình thường (cổng ${PORT})"
    break
  fi
  if [ "$i" -eq 20 ]; then
    warn "Chưa thấy /api/health. Xem log: journalctl -u ${SERVICE_NAME} -n 80 --no-pager"
  fi
  sleep 1
done

cat <<EOF

===============================================================
 Đã cài xong backend. Các bước còn lại:

 1) Nginx + HTTPS:
      sudo apt-get install -y nginx certbot python3-certbot-nginx
      sudo cp $APP_DIR/deploy/nginx/00-log-format.conf /etc/nginx/conf.d/00-gzafl-log.conf

      # (a) HTTP tạm để xin chứng chỉ
      sudo cp $APP_DIR/deploy/nginx/gzafl-bootstrap.conf /etc/nginx/sites-available/${SERVICE_NAME}.conf
      sudo sed -i 's/gzafl\\.vn/${DOMAIN}/g' /etc/nginx/sites-available/${SERVICE_NAME}.conf
      sudo ln -sf /etc/nginx/sites-available/${SERVICE_NAME}.conf /etc/nginx/sites-enabled/
      sudo nginx -t && sudo systemctl reload nginx

      # (b) Xin chứng chỉ
      sudo certbot certonly --webroot -w /var/www/html -d ${DOMAIN} -d www.${DOMAIN}

      # (c) Cấu hình HTTPS đầy đủ
      sudo cp $APP_DIR/deploy/nginx/gzafl.conf /etc/nginx/sites-available/${SERVICE_NAME}.conf
      sudo sed -i 's/gzafl\\.vn/${DOMAIN}/g' /etc/nginx/sites-available/${SERVICE_NAME}.conf
      sudo nginx -t && sudo systemctl reload nginx

 2) Cấp tài khoản quản trị (đăng ký trên web trước):
      cd $APP_DIR/backend && npm run make-admin -- email-cua-ban@example.com

 3) Đặt lịch sao lưu hằng ngày:
      sudo cp $APP_DIR/deploy/cron/gzafl-backup /etc/cron.d/gzafl-backup
      sudo sed -i 's|@APP_DIR@|$APP_DIR|g; s|@SERVICE_USER@|$SERVICE_USER|g' /etc/cron.d/gzafl-backup

 4) Kiểm tra: https://${DOMAIN}/api/health
    Log:      journalctl -u ${SERVICE_NAME} -f
===============================================================

EOF
