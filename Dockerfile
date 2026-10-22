# ---------------------------------------------------------------
# GZ AFL - Docker image (Node 24 + SQLite, không cần DB riêng)
#
# Build:  docker build -t gzafl .
# Chạy :  docker compose up -d --build
# ---------------------------------------------------------------
FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

# Cài dependency production trước để tận dụng cache layer
COPY backend/package.json backend/package-lock.json ./backend/
RUN npm ci --omit=dev --prefix backend --no-audit --no-fund \
 && npm cache clean --force

# Copy toàn bộ mã nguồn (frontend + backend)
COPY . .

# Thư mục dữ liệu ghi được bởi user 'node'
RUN mkdir -p backend/data backend/uploads backend/backups backend/logs \
 && chown -R node:node /app/backend/data /app/backend/uploads \
                         /app/backend/backups /app/backend/logs

USER node
WORKDIR /app/backend

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "scripts/start-prod.js"]
