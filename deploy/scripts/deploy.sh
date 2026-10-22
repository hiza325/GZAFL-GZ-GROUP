#!/usr/bin/env bash
# ---------------------------------------------------------------
# GZ AFL - cập nhật code trên server (deploy bản mới)
#
# Dùng:
#   sudo bash deploy/scripts/deploy.sh
#
# Script làm:
#   1. git pull --ff-only
#   2. npm ci --omit=dev
#   3. npm run check:deploy
#   4. restart service (systemd hoặc PM2)
#   5. gọi /api/health để xác nhận
#
# Nếu bước 3 báo LỖI, script DỪNG và KHÔNG restart -> web vẫn chạy bản cũ.
# ---------------------------------------------------------------
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
SERVICE_NAME="${SERVICE_NAME:-gzafl}"
SERVICE_USER="${SERVICE_USER:-www-data}"

step() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[!] %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m[LỖI] %s\033[0m\n' "$*" >&2; exit 1; }

cd "$APP_DIR"

# --- 1. Lấy code mới ------------------------------------------
if [ -d "$APP_DIR/.git" ]; then
  step "Cập nhật code (git pull --ff-only)"
  BEFORE="$(git rev-parse --short HEAD)"
  git pull --ff-only
  AFTER="$(git rev-parse --short HEAD)"
  printf '    %s -> %s\n' "$BEFORE" "$AFTER"
else
  warn "Không phải git repo - bỏ qua git pull. Hãy tự copy code mới lên server."
fi

# --- 2. Dependencies ------------------------------------------
step "Cài dependency production"
cd "$APP_DIR/backend"
npm ci --omit=dev --no-audit --no-fund

# --- 3. Kiểm tra cấu hình -------------------------------------
step "Kiểm tra cấu hình"
npm run check:deploy || die "Cấu hình chưa đạt. Không restart để giữ bản đang chạy."

# --- 4. Phân quyền thư mục dữ liệu (nếu chạy root) ------------
if [ "$(id -u)" -eq 0 ]; then
  chown -R "$SERVICE_USER:$SERVICE_USER" \
    "$APP_DIR/backend/data" \
    "$APP_DIR/backend/uploads" \
    "$APP_DIR/backend/backups"
fi

# --- 5. Sao lưu trước khi restart ------------------------------
# Tắt bằng: SKIP_BACKUP=1 bash deploy/scripts/deploy.sh
if [ "${SKIP_BACKUP:-0}" != "1" ]; then
  step "Sao lưu dữ liệu trước khi restart"
  if [ "$(id -u)" -eq 0 ] && id "$SERVICE_USER" >/dev/null 2>&1; then
    runuser -u "$SERVICE_USER" -- node scripts/backup.js || warn "Sao lưu thất bại - vẫn tiếp tục deploy."
  else
    node scripts/backup.js || warn "Sao lưu thất bại - vẫn tiếp tục deploy."
  fi
fi

# --- 6. Restart ------------------------------------------------
step "Khởi động lại"
if systemctl cat "$SERVICE_NAME" >/dev/null 2>&1; then
  systemctl restart "$SERVICE_NAME"
  RESTARTED="systemd"
elif command -v pm2 >/dev/null 2>&1 && pm2 describe "$SERVICE_NAME" >/dev/null 2>&1; then
  pm2 restart "$SERVICE_NAME" --update-env
  RESTARTED="pm2"
else
  warn "Không tìm thấy service '${SERVICE_NAME}' (systemd/PM2)."
  warn "Nếu đang chạy bằng Docker: docker compose up -d --build"
  RESTARTED=""
fi

# --- 7. Health check ------------------------------------------
PORT="$(grep -E '^PORT=' "$APP_DIR/backend/.env" 2>/dev/null | tail -1 | cut -d= -f2 | tr -d '[:space:]' || true)"
PORT="${PORT:-3000}"

if [ -n "$RESTARTED" ]; then
  step "Kiểm tra /api/health"
  for i in $(seq 1 20); do
    if curl -fsS "http://127.0.0.1:${PORT}/api/health"; then
      echo
      step "Deploy xong ($RESTARTED)."
      break
    fi
    if [ "$i" -eq 20 ]; then
      warn "Không nhận được phản hồi từ /api/health."
      warn "Xem log: journalctl -u ${SERVICE_NAME} -n 100 --no-pager"
      exit 1
    fi
    sleep 1
  done
fi
