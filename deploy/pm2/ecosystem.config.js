'use strict';

/**
 * GZ AFL - cấu hình PM2 (Linux, macOS, Windows).
 *
 * Dùng:
 *   cd <thư-mục-repo>
 *   pm2 start deploy/pm2/ecosystem.config.js
 *   pm2 save
 *   pm2 startup            # Linux: tự chạy khi reboot
 *
 * QUAN TRỌNG: chỉ chạy 1 instance (fork mode). SQLite là file cục bộ, không
 * dùng chung giữa nhiều máy. Nếu buộc phải chạy nhiều tiến trình trên cùng
 * máy, đặt RATE_LIMIT_STORE=sqlite trong backend/.env.
 */

const path = require('node:path');

const BACKEND_DIR = path.join(__dirname, '..', '..', 'backend');
const LOG_DIR = path.join(BACKEND_DIR, 'logs');

module.exports = {
  apps: [
    {
      name: 'gzafl',
      cwd: BACKEND_DIR,
      script: 'scripts/start-prod.js',
      interpreter: 'node',

      instances: 1,
      exec_mode: 'fork',

      autorestart: true,
      max_restarts: 20,
      min_uptime: '10s',
      restart_delay: 3000,
      max_memory_restart: '512M',

      env: {
        NODE_ENV: 'production'
      },

      time: true,
      merge_logs: true,
      out_file: path.join(LOG_DIR, 'out.log'),
      error_file: path.join(LOG_DIR, 'error.log'),
      // Tự xoay vòng log khi > 10MB (cần pm2-logrotate cho xoay theo ngày;
      // xem deploy/README.md)
      max_size: '10M'
    }
  ]
};
