/**
 * Cau hinh Tailwind CSS (ban 3.x) cho GZ AFL.
 *
 * Truoc day giao dien nap Tailwind tu CDN (https://cdn.tailwindcss.com) - vua cham
 * vua phu thuoc Internet. Nay CSS duoc build san thanh file tinh `tailwind.build.css`.
 *
 * Khi them class Tailwind moi trong bat ky file nao duoi day, PHAI chay lai:
 *   npm run build:css
 *
 * `content` phai liet ke moi noi co chua ten class Tailwind, ke ca class nam trong
 * chuoi JS (vi giao dien render HTML bang template string).
 */
module.exports = {
  content: [
    './index.html',
    './script.js',
    './i18n.js',
    './support.js',
    './admin.js',
    './components/**/*.html'
  ],
  theme: {
    extend: {
      fontFamily: {
        // Dùng cùng bộ font với style.css để tiếng Việt hiển thị đúng ở mọi độ đậm.
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif']
      }
    }
  },
  plugins: []
};
