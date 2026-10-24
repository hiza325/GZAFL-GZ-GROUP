/* ==========================================
   PHẦN 1: TIỆN ÍCH & XỬ LÝ AUTH (ĐĂNG NHẬP/ĐĂNG KÝ)
========================================== */

let isLoginMode = true;
let currentUser = null;

// Thông tin form đăng ký đang chờ mã xác thực (chỉ dùng khi bật xác thực email)
let pendingRegister = null;
// Phiếu đăng nhập đang chờ mã xác thực (chỉ dùng khi bật xác thực khi đăng nhập)
let pendingLogin = null;
// Bộ đếm ngược cho nút "Gửi lại mã" của các luồng: đăng ký, đăng nhập, quên mật khẩu và đổi email
let otpTimers = { register: null, login: null, reset: null, profile: null };

// Dịch chuỗi giao diện theo ngôn ngữ đang chọn (i18n.js được nạp trước script.js)
const tr = (key, vars) => (window.GZ_I18N ? window.GZ_I18N.t(key, vars) : key);

/* ==========================================
   TIỆN ÍCH DÙNG CHUNG
========================================== */

// Gọi API backend. Tự gửi cookie phiên (credentials: same-origin).
//
// Có timeout: trước đây nếu server treo (mất mạng, SQLite bị khoá, deploy dở)
// thì fetch chờ vô hạn và giao diện quay mãi không báo gì cho người dùng.
const API_TIMEOUT_MS = 20000;

async function api(path, options = {}) {
  const { method = 'GET', body, timeout = API_TIMEOUT_MS } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  const fetchOptions = {
    method,
    credentials: 'same-origin',
    headers: {},
    signal: controller.signal
  };
  if (body !== undefined) {
    fetchOptions.headers['Content-Type'] = 'application/json';
    fetchOptions.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch('/api' + path, fetchOptions);
  } catch (err) {
    if (err && err.name === 'AbortError') {
      const timeoutError = new Error('Máy chủ phản hồi quá lâu. Vui lòng kiểm tra kết nối rồi thử lại.');
      timeoutError.status = 0;
      timeoutError.code = 'TIMEOUT';
      throw timeoutError;
    }
    const networkError = new Error('Không kết nối được máy chủ. Vui lòng kiểm tra mạng rồi thử lại.');
    networkError.status = 0;
    networkError.code = 'NETWORK';
    throw networkError;
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch (e) { data = null; }
  }

  if (!res.ok) {
    const error = new Error((data && data.error) || 'Có lỗi xảy ra, vui lòng thử lại.');
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data || {};
}

// Thoát ký tự HTML để chèn an toàn vào innerHTML
function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Chỉ trả về URL http(s) an toàn, tránh javascript:/data: khi gán vào href
function safeHttpUrl(url) {
  try {
    const u = new URL(String(url == null ? '' : url), window.location.origin);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
  } catch (err) {
    /* bỏ qua */
  }
  return '';
}

// Gán text cho element theo id (bỏ qua nếu không tồn tại)
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.innerText = text;
}

/* ==========================================
   TIỆN ÍCH MODAL: khoá cuộn nền + quản lý focus

   - Khi mở modal: khoá cuộn trang nền, ghi nhớ phần tử đang focus, chuyển
     focus vào field đầu tiên.
   - Giữ phím Tab/Shift+Tab luẩn quẩn trong modal đang mở.
   - Khi đóng: trả focus về nút đã mở modal.
   ========================================== */
const modalStack = [];

function modalFocusables(modal) {
  if (!modal) return [];
  return Array.from(modal.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), ' +
    'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter(function (el) {
    return el.getClientRects().length > 0;
  });
}

function lockModal(modal) {
  if (!modal || modalStack.indexOf(modal) !== -1) return;

  // Ghi nhớ phần tử đang focus để trả lại sau khi đóng
  const active = document.activeElement;
  if (active && active !== document.body && !modal.contains(active)) {
    modal._returnFocus = active;
  }

  modalStack.push(modal);
  document.body.classList.add('modal-open');
}

function unlockModal(modal) {
  const index = modalStack.indexOf(modal);
  if (index !== -1) modalStack.splice(index, 1);
  if (!modalStack.length) document.body.classList.remove('modal-open');

  const target = modal && modal._returnFocus;
  if (modal) modal._returnFocus = null;
  if (target && document.contains(target)) target.focus({ preventScroll: true });
}

// Đưa focus vào field/selector ưu tiên, hoặc phần tử đầu tiên có thể focus
function focusInModal(modal, selector) {
  if (!modal) return;
  const preferred = selector ? modal.querySelector(selector) : null;
  const target = preferred || modalFocusables(modal)[0];
  if (target) target.focus({ preventScroll: true });
}

// Giữ Tab/Shift+Tab trong modal trên cùng của chồng modal
document.addEventListener('keydown', function (event) {
  if (event.key !== 'Tab' || !modalStack.length) return;

  const modal = modalStack[modalStack.length - 1];
  const items = modalFocusables(modal);
  if (!items.length) return;

  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;

  if (event.shiftKey && (active === first || !modal.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !modal.contains(active))) {
    event.preventDefault();
    first.focus();
  }
});

// Định dạng tiền Việt Nam
function formatCurrency(amount) {
  const n = Number(amount) || 0;
  return 'đ' + n.toLocaleString('vi-VN');
}

function formatShortDate(value) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('vi-VN');
}

// Màu badge theo trạng thái đơn hàng / lệnh rút / yêu cầu khôi phục mật khẩu
function statusBadgeClass(status) {
  if (status === 'Hoàn thành' || status === 'Đã thanh toán' || status === 'Đã xử lý') {
    return 'bg-emerald-50 text-emerald-600 border-emerald-100';
  }
  if (status === 'Đã huỷ') {
    return 'bg-slate-100 text-slate-500 border-slate-200';
  }
  return 'bg-amber-50 text-amber-600 border-amber-100';
}

// Thông báo toast thay cho alert()
function showToast(message, type = 'info') {
  let host = document.getElementById('toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toast-host';
    host.className = 'fixed top-5 right-5 z-[200] flex flex-col gap-3 pointer-events-none px-2';
    // Trình đọc màn hình phải đọc được thông báo (trước đây toast chỉ hiện hình).
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    host.setAttribute('aria-atomic', 'false');
    document.body.appendChild(host);
  }

  const palettes = {
    success: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    error: 'bg-red-50 text-red-600 border-red-100',
    info: 'bg-white text-slate-700 border-slate-200'
  };
  const icons = { success: 'check-circle-2', error: 'alert-circle', info: 'info' };
  const palette = palettes[type] || palettes.info;
  const icon = icons[type] || icons.info;

  const toast = document.createElement('div');
  toast.className = 'pointer-events-auto flex items-start gap-2 max-w-sm px-4 py-3 rounded-2xl border shadow-lg text-sm font-medium translate-x-4 opacity-0 transition-all duration-300 ' + palette;
  const iconEl = document.createElement('i');
  iconEl.setAttribute('data-lucide', icon);
  iconEl.className = 'w-4 h-4 flex-shrink-0 mt-0.5';
  const span = document.createElement('span');
  span.className = 'whitespace-pre-line';
  span.innerText = message;
  toast.appendChild(iconEl);
  toast.appendChild(span);
  host.appendChild(toast);

  if (typeof lucide !== 'undefined') lucide.createIcons();
  requestAnimationFrame(() => toast.classList.remove('translate-x-4', 'opacity-0'));

  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-x-4');
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}


// Thông tin liên hệ hỗ trợ lấy từ server (SUPPORT_EMAIL / SUPPORT_ZALO trong backend/.env).
// Nếu server không cấu hình thì giữ nguyên giá trị mặc định ghi trong components/guide.html.
let appConfigPromise = null;

// Cấu hình công khai của server (xem backend/server.js -> GET /api/config)
function fetchAppConfig() {
  if (!appConfigPromise) {
    appConfigPromise = api('/config').catch(() => null);
  }
  return appConfigPromise;
}

// Bước xác thực email do SERVER quyết định (xem backend/lib/otp.js -> otpEnabled).
// Giao diện chỉ hiện ô nhập mã khi server báo có bật.
let otpConfig = { enabled: false, delivery: false, length: 6, ttlSeconds: 600, resendSeconds: 60, loginRequired: false };

// Cấu hình công khai đã tải về (hỗ trợ, OTP, danh sách ngân hàng...)
let appConfig = null;
let affiliateConfig = null;

function applyAffiliateStatus() {
  const el = document.getElementById('landing-affiliate-status');
  if (!el || !affiliateConfig) return;

  const all = ['Shopee', 'TikTok Shop', 'Tiki', 'Lazada'];
  const liveRaw = Array.isArray(affiliateConfig.livePlatforms) ? affiliateConfig.livePlatforms : [];
  const live = all.filter((name) => liveRaw.some((item) => String(item).trim().toLowerCase() === name.toLowerCase()));
  // Danh sách rỗng = bật API thật cho mọi sàn; có danh sách = các sàn còn lại đang thử nghiệm.
  const restricted = liveRaw.length > 0;
  const missing = restricted ? all.filter((name) => !live.includes(name)) : [];

  let text;
  if (!affiliateConfig.isReal) {
    text = tr('hero.status.mock');
  } else if (restricted) {
    text = live.length
      ? tr('hero.status.live', { list: live.join(', ') })
      : tr('hero.status.liveSome');
    if (missing.length) text += ' ' + tr('hero.status.experimental', { list: missing.join(', ') });
  } else {
    text = tr('hero.status.liveAll');
  }

  el.textContent = text;
  el.classList.remove('hidden', 'text-slate-400', 'text-amber-700', 'text-emerald-600');
  el.classList.add(!affiliateConfig.isReal || missing.length ? 'text-amber-700' : 'text-emerald-600');
}

fetchAppConfig().then((cfg) => {
  appConfig = cfg;
  if (cfg && cfg.otp) otpConfig = Object.assign({}, otpConfig, cfg.otp);
  if (cfg && cfg.affiliate) {
    affiliateConfig = cfg.affiliate;
    applyAffiliateStatus();
  }
  if (typeof populateBankOptions === 'function') populateBankOptions();
  if (typeof updateAuthUI === 'function') updateAuthUI();
});

// Đổi ngôn ngữ: cập nhật lại các đoạn chữ do JS sinh ra
window.addEventListener('languagechange', () => {
  applyAffiliateStatus();
  const form = document.getElementById('auth-form');
  if (form && !form.classList.contains('hidden')) updateAuthUI();
});

async function fetchSupportContact() {
  const cfg = await fetchAppConfig();
  return (cfg && cfg.support) || null;
}

async function applySupportContact(root) {
  const scope = root || document;
  const emailEl = scope.querySelector('#support-email');
  const zaloEl = scope.querySelector('#support-zalo');
  if (!emailEl && !zaloEl) return;

  const support = await fetchSupportContact();
  if (!support) return;

  if (emailEl && support.email) emailEl.textContent = support.email;
  if (zaloEl && support.zalo) zaloEl.textContent = 'Zalo: ' + support.zalo;
}

// Chống "đua" khi bấm menu liên tiếp: chỉ yêu cầu MỚI NHẤT được ghi vào DOM.
// Nếu không có bước này, phản hồi chậm của trang cũ có thể đè lên trang mới.
const componentLoadTokens = new Map();

async function loadComponent(elementId, filePath) {
  const token = (componentLoadTokens.get(elementId) || 0) + 1;
  componentLoadTokens.set(elementId, token);

  try {
    const response = await fetch(filePath);
    if (!response.ok) throw new Error('Không thể tải file ' + filePath);

    const html = await response.text();
    if (componentLoadTokens.get(elementId) !== token) return false;

    const container = document.getElementById(elementId);
    if (!container) return false;
    container.innerHTML = html;

    // Dịch các nhãn tĩnh ngay sau khi chèn component (trang chủ, hướng dẫn...)
    if (window.GZ_I18N) {
      window.GZ_I18N.applyTranslations(container);
      window.GZ_I18N.updateLangSwitcher();
    }

    // Đồng bộ nhãn/trạng thái nút sáng-tối sau khi component được chèn.
    if (window.GZ_THEME) window.GZ_THEME.updateButtons();

    if (typeof lucide !== 'undefined') lucide.createIcons();

    // Nạp dữ liệu động tuỳ theo trang
    if (filePath.includes('dashboard-content.html')) updateDashboardData();
    else if (filePath.includes('wallet.html')) updateWalletData();
    else if (filePath.includes('orders.html')) updateOrdersData();
    else if (filePath.includes('referral.html')) initReferralPage();
    else if (filePath.includes('notifications.html')) updateNotificationsData();
    else if (filePath.includes('guide.html')) applySupportContact(document.getElementById(elementId));
    else if (filePath.includes('landing.html')) applyAffiliateStatus();

    return true;
  } catch (error) {
    console.error('Lỗi khi tải component:', error);
    if (componentLoadTokens.get(elementId) !== token) return false;

    const container = document.getElementById(elementId);
    if (container) {
      container.innerHTML = `
        <div class="p-8">
          <div class="bg-white p-10 rounded-3xl border border-slate-100 text-center">
            <div class="w-16 h-16 mx-auto rounded-full bg-red-50 text-red-500 flex items-center justify-center mb-4">
              <i data-lucide="wifi-off" class="w-7 h-7"></i>
            </div>
            <h3 class="text-lg font-bold text-slate-800 mb-1">Không tải được nội dung trang</h3>
            <p class="text-sm text-slate-500 mb-6">Kết nối có thể bị gián đoạn. Vui lòng thử lại.</p>
            <button data-action="reload-page" class="bg-[#f04d4d] hover:bg-red-600 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition">
              Tải lại trang
            </button>
          </div>
        </div>`;
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }
    return false;
  }
}

async function checkAuth() {
  const appRoot = document.getElementById('app-root');
  const landingRoot = document.getElementById('landing-root');

  let user = null;
  let securityHoldMessage = '';
  try {
    const data = await api('/auth/me');
    user = data.user || null;
  } catch (err) {
    const status = err && err.status;
    if (status === 423) {
      // Tài khoản đang bị admin tạm giữ: không mở dashboard, hiện lý do ở màn đăng nhập.
      securityHoldMessage = err.message || 'Tài khoản đang tạm giữ để quản trị viên xem xét.';
    } else if (status !== 401 && currentUser) {
      // Lỗi mạng / 429 / 5xx KHÔNG có nghĩa là phiên đã hết hạn.
      // Giữ nguyên dashboard đang mở thay vì đẩy người dùng ra màn đăng nhập.
      return;
    }
    user = null;
  }
  currentUser = user;

  if (user) {
    landingRoot.classList.add('hidden');
    appRoot.classList.remove('hidden');

    await loadComponent('sidebar-container', 'components/sidebar.html');
    await loadComponent('header-container', 'components/header.html');
    await loadComponent('main-content-container', 'components/dashboard-content.html');

    closeSidebar();
    setHeaderTitle('Tổng quan');
    document.title = 'Tổng quan - GZ AFL';
    updateActiveMenu('dashboard');
    renderHeaderUser(user);
    applyAdminVisibility(user);

    // Mở đúng trang khi người dùng F5 hoặc dán link dạng #/wallet
    const deepLink = pageFromHash();
    if (deepLink && deepLink !== 'dashboard') {
      await navigateTo(deepLink, { push: false });
    }

    // Nếu người dùng vừa dán link ở trang chủ rồi mới đăng nhập,
    // đưa họ thẳng tới trang Tạo đơn với link đã điền sẵn.
    await handlePendingLandingLink();
  } else {
    closeSidebar();
    appRoot.classList.add('hidden');
    landingRoot.classList.remove('hidden');
    await loadComponent('landing-root', 'components/landing.html');
    if (securityHoldMessage) {
      window.openAuthModal(true);
      showAuthMessage(securityHoldMessage);
    }
  }
}

// Cập nhật tên + avatar trên header một cách an toàn (không dùng innerHTML với dữ liệu người dùng)
function renderHeaderUser(user) {
  if (!user) return;

  const nameElement = document.getElementById('header-username');
  const avatarElement = document.getElementById('header-avatar');

  if (nameElement) nameElement.innerText = user.name || 'Khách';

  if (avatarElement) {
    avatarElement.innerText = '';
    if (user.avatar) {
      const img = document.createElement('img');
      img.src = user.avatar;
      img.alt = 'Avatar';
      img.className = 'w-full h-full object-cover rounded-full';
      avatarElement.appendChild(img);
    } else {
      avatarElement.innerText = (user.name || 'KH').substring(0, 2).toUpperCase();
    }
  }
}

// Đổi tiêu đề trang trên header cho khớp với trang đang xem
function setHeaderTitle(title) {
  const el = document.getElementById('header-title');
  if (el) el.innerText = title;
}

// Chỉ hiện mục "Quản trị" trong menu với tài khoản có role = 'admin'
function applyAdminVisibility(user) {
  const nav = document.getElementById('admin-nav');
  if (!nav) return;
  const isAdmin = !!(user && user.role === 'admin');
  nav.classList.toggle('hidden', !isAdmin);
  if (isAdmin && typeof lucide !== 'undefined') lucide.createIcons();
}

window.logoutUser = async function() {
  try {
    await api('/auth/logout', { method: 'POST' });
  } catch (err) {
    /* dù lỗi vẫn đưa về trạng thái chưa đăng nhập */
  }
  currentUser = null;
  // Xoá hash (#/admin, #/wallet) để lần đăng nhập sau không mở lại trang cũ
  window.history.replaceState(null, '', window.location.pathname);
  await checkAuth();
};

document.addEventListener('DOMContentLoaded', () => {
  checkAuth();
});

// Đóng modal đang mở bằng phím Esc
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  const authModal = document.getElementById('auth-modal');
  const withdrawModal = document.getElementById('withdraw-modal');
  const guideModal = document.getElementById('guide-modal');
  if (authModal && !authModal.classList.contains('hidden')) { closeAuthModal(); return; }
  if (withdrawModal && !withdrawModal.classList.contains('hidden')) { closeWithdrawModal(); return; }
  if (guideModal && !guideModal.classList.contains('hidden')) { closeGuideModal(); }
});

window.openAuthModal = function(loginMode = true) {
  isLoginMode = loginMode;
  resetAuthPanels();
  updateAuthUI();

  const modal = document.getElementById('auth-modal');
  const content = document.getElementById('auth-modal-content');
  if (!modal || !content) return;

  modal.classList.remove('hidden');
  lockModal(modal);

  setTimeout(() => {
    modal.classList.remove('opacity-0');
    content.classList.remove('scale-95');
  }, 10);

  // Đưa focus vào ô đầu tiên đang hiển thị (đăng ký: tên, đăng nhập: tài khoản)
  focusInModal(modal, isLoginMode ? '#auth-username' : '#auth-name');
};

window.closeAuthModal = function() {
  const modal = document.getElementById('auth-modal');
  const content = document.getElementById('auth-modal-content');
  if (!modal || !content) return;

  modal.classList.add('opacity-0');
  content.classList.add('scale-95');

  setTimeout(() => {
    modal.classList.add('hidden');
    const form = document.getElementById('auth-form');
    if (form) form.reset();
    const errorBox = document.getElementById('auth-error');
    if (errorBox) errorBox.classList.add('hidden');
    resetAuthPanels();
    unlockModal(modal);
  }, 300);
};

// Luôn đưa modal về trạng thái đăng nhập/đăng ký (thoát khỏi màn nhập mã / quên mật khẩu)
function resetAuthPanels() {
  const form = document.getElementById('auth-form');
  const otpPanel = document.getElementById('auth-otp-panel');
  const forgotPanel = document.getElementById('auth-forgot-panel');
  const resetPanel = document.getElementById('auth-reset-panel');
  const toggleBlock = document.getElementById('auth-toggle-block');
  if (otpPanel) otpPanel.classList.add('hidden');
  if (forgotPanel) forgotPanel.classList.add('hidden');
  if (resetPanel) resetPanel.classList.add('hidden');
  if (form) form.classList.remove('hidden');
  if (toggleBlock) toggleBlock.classList.remove('hidden');

  ['auth-otp', 'forgot-note', 'reset-otp', 'reset-password', 'reset-confirm'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  hideForgotAdminBlock();
  setDevCode('auth-otp-dev', 'auth-otp-devcode', '');
  setDevCode('reset-dev', 'reset-devcode', '');
  clearInterval(otpTimers.register);
  clearInterval(otpTimers.login);
  clearInterval(otpTimers.reset);
  otpTimers.register = null;
  otpTimers.login = null;
  otpTimers.reset = null;
  pendingRegister = null;
  pendingLogin = null;
}

window.toggleAuthMode = function() {
  isLoginMode = !isLoginMode;
  const errorBox = document.getElementById('auth-error');
  if (errorBox) errorBox.classList.add('hidden');
  resetAuthPanels();
  updateAuthUI();
};

function updateAuthUI() {
  const title = document.getElementById('auth-title');
  const subtitle = document.getElementById('auth-subtitle');
  const nameGroup = document.getElementById('auth-name-group');
  const confirmGroup = document.getElementById('auth-confirm-group');
  const emailGroup = document.getElementById('auth-email-group');
  const submitBtn = document.getElementById('auth-submit-btn');
  const toggleText = document.getElementById('auth-toggle-text');
  const toggleBtn = document.getElementById('auth-toggle-btn');
  const forgotRow = document.getElementById('auth-forgot-row');
  if (!title || !subtitle || !nameGroup || !submitBtn) return;

  if (isLoginMode) {
    title.innerText = tr('auth.login.title');
    subtitle.innerText = otpConfig.loginRequired
      ? tr('auth.login.subtitle.otp')
      : tr('auth.login.subtitle.default');
    nameGroup.classList.add('hidden');
    if (confirmGroup) confirmGroup.classList.add('hidden');
    if (emailGroup) emailGroup.classList.add('hidden');
    submitBtn.innerHTML = `<span>${tr('auth.submit.login')}</span> <i data-lucide="arrow-right" class="w-4 h-4 inline-block"></i>`;
    toggleText.innerText = tr('auth.toggle.noAccount');
    toggleBtn.innerText = tr('auth.toggle.register');
    if (forgotRow) forgotRow.classList.remove('hidden');
  } else {
    title.innerText = tr('auth.register.title');
    subtitle.innerText = otpConfig.enabled
      ? tr('auth.register.subtitle.otp')
      : tr('auth.register.subtitle.noOtp');
    nameGroup.classList.remove('hidden');
    if (confirmGroup) confirmGroup.classList.remove('hidden');
    submitBtn.innerHTML = `<span>${tr('auth.submit.register')}</span> <i data-lucide="arrow-right" class="w-4 h-4 inline-block"></i>`;
    toggleText.innerText = tr('auth.toggle.hasAccount');
    toggleBtn.innerText = tr('auth.toggle.login');
    if (forgotRow) forgotRow.classList.add('hidden');

    // Ô email chỉ cần khi đăng ký. Nếu tên đăng nhập đã là email thì điền sẵn cho tiện.
    if (emailGroup) {
      emailGroup.classList.remove('hidden');
      const usernameEl = document.getElementById('auth-username');
      const emailEl = document.getElementById('auth-email');
      if (emailEl && !emailEl.value.trim() && usernameEl && isValidEmail(usernameEl.value)) {
        emailEl.value = usernameEl.value.trim();
      }
      const label = document.getElementById('auth-email-label');
      const hint = document.getElementById('auth-email-hint');
      if (label) label.innerText = otpConfig.enabled ? tr('auth.email.label.otp') : tr('auth.email.label.contact');
      if (hint) {
        hint.innerText = otpConfig.enabled
          ? tr('auth.email.hint.otp', { n: otpConfig.length })
          : tr('auth.email.hint.contact');
      }
    }
  }

  // Cùng một ô mật khẩu dùng cho 2 chế độ: đăng nhập (điền mật khẩu đã lưu)
  // và đăng ký (gợi ý mật khẩu mới) — đổi autocomplete để password manager
  // không điền nhầm.
  const passwordEl = document.getElementById('auth-password');
  if (passwordEl) {
    passwordEl.setAttribute('autocomplete', isLoginMode ? 'current-password' : 'new-password');
  }

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

/* ==========================================
   Quên mật khẩu

   Có 2 đường:

   1. TỰ ĐẶT LẠI QUA EMAIL (mặc định): nhập tài khoản -> server gửi mã 6 số
      tới email đã đăng ký -> nhập mã kèm mật khẩu mới.
   2. NHỜ QUẢN TRỊ VIÊN: dự phòng cho tài khoản chưa có email, hoặc khi hệ
      thống chưa cấu hình được việc gửi thư. Yêu cầu vào tab "Khôi phục mật
      khẩu" của trang quản trị.
========================================== */

// Ẩn phần "nhờ quản trị viên" và trả nhãn nút về mặc định
function hideForgotAdminBlock() {
  const block = document.getElementById('forgot-admin-block');
  const toggle = document.getElementById('forgot-admin-toggle');
  if (block) block.classList.add('hidden');
  if (toggle) toggle.innerText = tr('auth.forgot.toggle');
}

window.toggleForgotAdmin = function() {
  const block = document.getElementById('forgot-admin-block');
  const toggle = document.getElementById('forgot-admin-toggle');
  if (!block) return;
  const showing = !block.classList.toggle('hidden');
  if (toggle) toggle.innerText = showing ? tr('auth.forgot.toggleHide') : tr('auth.forgot.toggle');
};

// Hiện mã thử nghiệm — chỉ có khi server chưa cấu hình gửi thư và đang ở dev
function setDevCode(boxId, codeId, code) {
  const box = document.getElementById(boxId);
  const el = document.getElementById(codeId);
  if (!box || !el) return;
  if (code) {
    el.innerText = code;
    box.classList.remove('hidden');
  } else {
    el.innerText = '';
    box.classList.add('hidden');
  }
}

// Đếm ngược nút "Gửi lại mã" (kind = 'register' | 'login' | 'reset' | 'profile')
// 'register' và 'login' dùng chung một nút vì cùng nằm trong màn nhập mã của modal.
const RESEND_BUTTONS = {
  register: 'auth-otp-resend-btn',
  login: 'auth-otp-resend-btn',
  reset: 'reset-resend-btn',
  profile: 'profile-email-otp-btn'
};

function startResendCountdown(kind, seconds) {
  const btn = document.getElementById(RESEND_BUTTONS[kind] || '');
  clearInterval(otpTimers[kind]);
  otpTimers[kind] = null;
  if (!btn) return;

  let left = Math.max(0, Number(seconds) || 0);
  const paint = () => {
    if (left <= 0) {
      clearInterval(otpTimers[kind]);
      otpTimers[kind] = null;
      btn.disabled = false;
      btn.innerText = tr('auth.otp.resend');
      return;
    }
    btn.disabled = true;
    btn.innerText = tr('auth.otp.resendCountdown', { s: left });
    left -= 1;
  };
  paint();
  // paint() đã tự tắt nút khi hết giờ, nên chỉ hẹn giờ khi nút còn bị khoá
  if (btn.disabled) otpTimers[kind] = setInterval(paint, 1000);
}

// Đưa nút về trạng thái "đang xử lý", trả về hàm khôi phục
function busyButton(btn, text) {
  if (!btn) return () => {};
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.classList.add('opacity-70');
  btn.innerText = text;
  return () => {
    btn.disabled = false;
    btn.classList.remove('opacity-70');
    btn.innerHTML = original;
    if (typeof lucide !== 'undefined') lucide.createIcons();
  };
}

function isValidOtpCode(code) {
  return String(code || '').length === otpConfig.length && !/\D/.test(String(code || ''));
}

function showAuthErrorHidden() {
  const errorBox = document.getElementById('auth-error');
  if (errorBox) errorBox.classList.add('hidden');
}

// Modal đang ở màn nhập mã xác thực hay không
function isOtpPanelOpen() {
  const panel = document.getElementById('auth-otp-panel');
  return !!panel && !panel.classList.contains('hidden');
}

/* ---------- Bước nhập mã xác thực (dùng chung cho ĐĂNG KÝ và ĐĂNG NHẬP) ---------- */

/**
 * purpose: 'register' (mặc định) hoặc 'login'.
 * note: câu phụ đề riêng (chỉ dùng cho đăng nhập, ví dụ khi mã cũ còn hiệu lực).
 */
function showOtpPanel(email, devCode, resendSeconds, purpose, note) {
  const kind = purpose === 'login' ? 'login' : 'register';
  const form = document.getElementById('auth-form');
  const panel = document.getElementById('auth-otp-panel');
  const toggleBlock = document.getElementById('auth-toggle-block');
  const forgotRow = document.getElementById('auth-forgot-row');
  const title = document.getElementById('auth-title');
  const subtitle = document.getElementById('auth-subtitle');
  if (!panel) return;

  if (form) form.classList.add('hidden');
  if (toggleBlock) toggleBlock.classList.add('hidden');
  if (forgotRow) forgotRow.classList.add('hidden');
  panel.classList.remove('hidden');

  if (title) title.innerText = kind === 'login' ? tr('auth.otp.title.login') : tr('auth.otp.title.register');
  if (subtitle) {
    subtitle.innerText = kind === 'login'
      ? ((note && (!window.GZ_I18N || window.GZ_I18N.getLanguage() === 'vi')) ? note : tr('auth.otp.subtitle.login.default'))
      : tr('auth.otp.subtitle.register');
  }

  const tail = document.getElementById('auth-otp-tail');
  if (tail) {
    tail.innerText = kind === 'login'
      ? tr('auth.otp.tail.login')
      : tr('auth.otp.tail.register');
  }

  const submitBtn = document.getElementById('auth-otp-submit-btn');
  if (submitBtn) {
    submitBtn.innerText = kind === 'login' ? tr('auth.otp.submit.login') : tr('auth.otp.submit.register');
  }

  const emailEl = document.getElementById('auth-otp-email');
  if (emailEl) emailEl.innerText = email || '';
  setDevCode('auth-otp-dev', 'auth-otp-devcode', devCode);
  startResendCountdown(kind, resendSeconds);

  showAuthErrorHidden();
  const otpEl = document.getElementById('auth-otp');
  if (otpEl) {
    otpEl.value = '';
    otpEl.focus();
  }
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

window.backToAuthForm = function() {
  const panel = document.getElementById('auth-otp-panel');
  const form = document.getElementById('auth-form');
  const toggleBlock = document.getElementById('auth-toggle-block');
  if (panel) panel.classList.add('hidden');
  if (form) form.classList.remove('hidden');
  if (toggleBlock) toggleBlock.classList.remove('hidden');
  clearInterval(otpTimers.register);
  clearInterval(otpTimers.login);
  otpTimers.register = null;
  otpTimers.login = null;
  pendingRegister = null;
  pendingLogin = null;
  showAuthErrorHidden();
  updateAuthUI();
};

// Nút "Xác nhận" trong màn nhập mã: rẽ nhánh theo luồng đang chờ
window.submitAuthOtp = function() {
  if (pendingLogin) return submitLoginOtp();
  return submitRegisterOtp();
};

// Nút "Gửi lại mã" trong màn nhập mã: rẽ nhánh theo luồng đang chờ
window.resendAuthOtp = function() {
  if (pendingLogin) return resendLoginOtp();
  return resendRegisterOtp();
};

window.submitRegisterOtp = async function() {
  const otpEl = document.getElementById('auth-otp');
  const btn = document.getElementById('auth-otp-submit-btn');
  showAuthErrorHidden();

  if (!pendingRegister) {
    return showAuthMessage(tr('auth.error.infoExpired'));
  }

  const code = otpEl ? otpEl.value.trim() : '';
  if (!isValidOtpCode(code)) {
    return showAuthMessage(tr('auth.error.otpLength', { n: otpConfig.length }));
  }

  const restore = busyButton(btn, tr('auth.busy.verifying'));
  try {
    await api('/auth/register', {
      method: 'POST',
      body: Object.assign({}, pendingRegister, { otp: code })
    });
    pendingRegister = null;
    clearInterval(otpTimers.register);
    otpTimers.register = null;
    toggleAuthMode(); // trở về form đăng nhập
    const passwordEl = document.getElementById('auth-password');
    if (passwordEl) passwordEl.value = '';
    showAuthMessage(tr('auth.success.registered'), true);
  } catch (err) {
    showAuthMessage(err.message);
  } finally {
    restore();
  }
};

window.resendRegisterOtp = async function() {
  const btn = document.getElementById('auth-otp-resend-btn');
  if (!pendingRegister) return;
  if (btn) btn.disabled = true;

  try {
    const data = await api('/auth/register/otp', {
      method: 'POST',
      body: {
        username: pendingRegister.username,
        name: pendingRegister.name,
        email: pendingRegister.email
      }
    });
    // Trong thời gian chờ 60 giây, server trả thông báo chung và không có mã mới
    // -> giữ nguyên mã cũ đang hiện để không xoá trắng ô thử nghiệm
    if (data.devCode) setDevCode('auth-otp-dev', 'auth-otp-devcode', data.devCode);
    startResendCountdown('register', data.resendInSeconds);
    showAuthMessage(tr('auth.success.resend'), true);
  } catch (err) {
    showAuthMessage(err.message);
    if (err.status === 429) startResendCountdown('register', otpConfig.resendSeconds);
  } finally {
    if (btn && !otpTimers.register) btn.disabled = false;
  }
};

/* ---------- Đăng nhập: bước nhập mã xác thực ---------- */

window.submitLoginOtp = async function() {
  const otpEl = document.getElementById('auth-otp');
  const btn = document.getElementById('auth-otp-submit-btn');
  showAuthErrorHidden();

  if (!pendingLogin) {
    return showAuthMessage(tr('auth.error.loginExpired'));
  }

  const code = otpEl ? otpEl.value.trim() : '';
  if (!isValidOtpCode(code)) {
    return showAuthMessage(tr('auth.error.otpLength', { n: otpConfig.length }));
  }

  const restore = busyButton(btn, tr('auth.busy.verifying'));
  try {
    const data = await api('/auth/login/otp', {
      method: 'POST',
      body: { ticket: pendingLogin.ticket, otp: code }
    });
    pendingLogin = null;
    clearInterval(otpTimers.login);
    otpTimers.login = null;
    currentUser = data.user || null;
    closeAuthModal();
    await checkAuth();
  } catch (err) {
    showAuthMessage(err.message);
    // Phiếu đăng nhập chỉ sống 5 phút: hết hạn thì đưa về form để đăng nhập lại
    if (err.status === 401 && /Phiên đăng nhập đã hết/.test(err.message || '')) {
      backToAuthForm();
      showAuthMessage(err.message);
    }
  } finally {
    restore();
  }
};

window.resendLoginOtp = async function() {
  const btn = document.getElementById('auth-otp-resend-btn');
  if (!pendingLogin) return;
  if (btn) btn.disabled = true;

  try {
    const data = await api('/auth/login/otp/resend', {
      method: 'POST',
      body: { ticket: pendingLogin.ticket }
    });
    if (data.devCode) setDevCode('auth-otp-dev', 'auth-otp-devcode', data.devCode);
    startResendCountdown('login', data.resendInSeconds);
    showAuthMessage(tr('auth.success.resend'), true);
  } catch (err) {
    showAuthMessage(err.message);
    if (err.status === 429) startResendCountdown('login', otpConfig.resendSeconds);
    if (err.status === 401) {
      pendingLogin = null;
      backToAuthForm();
      showAuthMessage(err.message);
    }
  } finally {
    if (btn && !otpTimers.login) btn.disabled = false;
  }
};

/* ---------- Quên mật khẩu ---------- */

window.showForgotPassword = function() {
  const form = document.getElementById('auth-form');
  const panel = document.getElementById('auth-forgot-panel');
  const toggleBlock = document.getElementById('auth-toggle-block');
  const forgotRow = document.getElementById('auth-forgot-row');
  const title = document.getElementById('auth-title');
  const subtitle = document.getElementById('auth-subtitle');
  const submitBtn = document.getElementById('forgot-submit-btn');
  const toggleRow = document.getElementById('forgot-admin-toggle-row');
  const adminBlock = document.getElementById('forgot-admin-block');
  if (!panel) return;

  // Điền sẵn tài khoản người dùng vừa gõ ở form đăng nhập
  const usernameEl = document.getElementById('auth-username');
  const forgotUsername = document.getElementById('forgot-username');
  if (usernameEl && forgotUsername && !forgotUsername.value) {
    forgotUsername.value = usernameEl.value.trim();
  }

  if (form) form.classList.add('hidden');
  if (toggleBlock) toggleBlock.classList.add('hidden');
  if (forgotRow) forgotRow.classList.add('hidden');
  panel.classList.remove('hidden');
  if (title) title.innerText = tr('auth.forgot.title');

  if (otpConfig.enabled && otpConfig.delivery) {
    if (subtitle) subtitle.innerText = tr('auth.forgot.subtitle.sent');
    if (submitBtn) submitBtn.classList.remove('hidden');
    if (toggleRow) toggleRow.classList.remove('hidden');
    if (adminBlock) adminBlock.classList.add('hidden');
  } else {
    // Chưa gửi được email -> chỉ còn đường nhờ quản trị viên
    if (subtitle) subtitle.innerText = tr('auth.forgot.subtitle.noEmail');
    if (submitBtn) submitBtn.classList.add('hidden');
    if (toggleRow) toggleRow.classList.add('hidden');
    if (adminBlock) adminBlock.classList.remove('hidden');
  }

  showAuthErrorHidden();
  if (typeof lucide !== 'undefined') lucide.createIcons();
};

window.hideForgotPassword = function() {
  resetAuthPanels();
  showAuthErrorHidden();
  updateAuthUI();
};

// Bước 1: yêu cầu server gửi mã xác thực
window.submitForgotPassword = async function() {
  const usernameEl = document.getElementById('forgot-username');
  const btn = document.getElementById('forgot-submit-btn');
  showAuthErrorHidden();
  if (!usernameEl) return;

  const username = usernameEl.value.trim();
  if (!username) return showAuthMessage(tr('auth.error.usernameRequired'));
  if (!validateUsername(username)) {
    return showAuthMessage(tr('auth.error.usernameInvalid'));
  }

  const restore = busyButton(btn, tr('auth.busy.sending'));
  try {
    const data = await api('/auth/forgot-password/otp', { method: 'POST', body: { username } });
    showResetPanel(data);
  } catch (err) {
    showAuthMessage(err.message || tr('auth.error.otpSend'));
  } finally {
    restore();
  }
};

// Chuyển sang bước nhập mã + mật khẩu mới
function showResetPanel(data) {
  const forgotPanel = document.getElementById('auth-forgot-panel');
  const panel = document.getElementById('auth-reset-panel');
  const title = document.getElementById('auth-title');
  const subtitle = document.getElementById('auth-subtitle');
  if (!panel) return;

  if (forgotPanel) forgotPanel.classList.add('hidden');
  panel.classList.remove('hidden');
  if (title) title.innerText = tr('auth.reset.title');
  if (subtitle) subtitle.innerText = tr('auth.reset.subtitle2');

  setDevCode('reset-dev', 'reset-devcode', data && data.devCode);
  startResendCountdown('reset', (data && data.resendInSeconds) || otpConfig.resendSeconds);
  showAuthErrorHidden();
  const resetSentMessage = (data && data.message && (!window.GZ_I18N || window.GZ_I18N.getLanguage() === 'vi'))
    ? data.message
    : tr('auth.info.resetSent');
  showAuthMessage(resetSentMessage, true);

  const otpEl = document.getElementById('reset-otp');
  if (otpEl) {
    otpEl.value = '';
    otpEl.focus();
  }
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

window.backToForgotPanel = function() {
  const resetPanel = document.getElementById('auth-reset-panel');
  const forgotPanel = document.getElementById('auth-forgot-panel');
  if (resetPanel) resetPanel.classList.add('hidden');
  if (forgotPanel) forgotPanel.classList.remove('hidden');
  clearInterval(otpTimers.reset);
  otpTimers.reset = null;
  setDevCode('reset-dev', 'reset-devcode', '');
  setText('auth-title', tr('auth.forgot.title'));
  setText('auth-subtitle', tr('auth.forgot.subtitle.sent'));
  showAuthErrorHidden();
  ['reset-otp', 'reset-password', 'reset-confirm'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
};

// Bước 2: mã đúng thì đổi mật khẩu
window.submitPasswordReset = async function() {
  const usernameEl = document.getElementById('forgot-username');
  const otpEl = document.getElementById('reset-otp');
  const pwEl = document.getElementById('reset-password');
  const cfEl = document.getElementById('reset-confirm');
  const btn = document.getElementById('reset-submit-btn');
  showAuthErrorHidden();

  const username = usernameEl ? usernameEl.value.trim() : '';
  const code = otpEl ? otpEl.value.trim() : '';
  const password = pwEl ? pwEl.value.trim() : '';
  const confirm = cfEl ? cfEl.value.trim() : '';

  if (!isValidOtpCode(code)) {
    return showAuthMessage(tr('auth.error.otpLength', { n: otpConfig.length }));
  }
  if (password.length < 8) return showAuthMessage(tr('auth.error.newPasswordShort'));
  if (confirm !== password) return showAuthMessage(tr('auth.error.passwordMismatch'));

  const restore = busyButton(btn, tr('auth.busy.processing'));
  try {
    const data = await api('/auth/forgot-password/confirm', {
      method: 'POST',
      body: { username, otp: code, newPassword: password }
    });
    resetAuthPanels();
    isLoginMode = true;
    updateAuthUI();
    const resetDoneMessage = (data && data.message && (!window.GZ_I18N || window.GZ_I18N.getLanguage() === 'vi'))
      ? data.message
      : tr('auth.success.reset');
    showAuthMessage(resetDoneMessage, true);
  } catch (err) {
    showAuthMessage(err.message || tr('auth.error.reset'));
  } finally {
    restore();
  }
};

window.resendResetOtp = async function() {
  const usernameEl = document.getElementById('forgot-username');
  const btn = document.getElementById('reset-resend-btn');
  const username = usernameEl ? usernameEl.value.trim() : '';
  if (!username) return;
  if (btn) btn.disabled = true;

  try {
    const data = await api('/auth/forgot-password/otp', { method: 'POST', body: { username } });
    // Trong thời gian chờ 60 giây, server trả thông báo chung và không có mã mới
    // -> giữ nguyên mã cũ đang hiện để không xoá trắng ô thử nghiệm
    if (data.devCode) setDevCode('reset-dev', 'reset-devcode', data.devCode);
    startResendCountdown('reset', data.resendInSeconds);
    showAuthMessage(tr('auth.success.resend'), true);
  } catch (err) {
    showAuthMessage(err.message);
    if (err.status === 429) startResendCountdown('reset', otpConfig.resendSeconds);
  } finally {
    if (btn && !otpTimers.reset) btn.disabled = false;
  }
};

// Đường dự phòng: nhờ quản trị viên cấp lại mật khẩu
window.submitForgotPasswordAdmin = async function() {
  const usernameEl = document.getElementById('forgot-username');
  const noteEl = document.getElementById('forgot-note');
  const btn = document.getElementById('forgot-admin-btn');
  showAuthErrorHidden();
  if (!usernameEl) return;

  const username = usernameEl.value.trim();
  const note = noteEl ? noteEl.value.trim() : '';

  if (!username) return showAuthMessage(tr('auth.error.usernameRequired'));
  if (!validateUsername(username)) {
    return showAuthMessage(tr('auth.error.usernameInvalid'));
  }
  if (!note) {
    return showAuthMessage(tr('auth.error.contactRequired'));
  }

  const restore = busyButton(btn, tr('auth.busy.sending'));
  try {
    const data = await api('/auth/forgot-password', {
      method: 'POST',
      body: { username, note }
    });
    const requestSentMessage = (data && data.message && (!window.GZ_I18N || window.GZ_I18N.getLanguage() === 'vi'))
      ? data.message
      : tr('auth.success.requestSent');
    showAuthMessage(requestSentMessage, true);
  } catch (err) {
    showAuthMessage(err.message || tr('auth.error.request'));
  } finally {
    restore();
  }
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// SĐT Việt Nam: 0 hoặc +84/84, đầu số 3/5/7/8/9, tổng 10 chữ số
const PHONE_REGEX = /^(?:\+?84|0)(?:3|5|7|8|9)\d{8}$/;

function isValidEmail(input) {
  return EMAIL_REGEX.test((input || '').trim());
}

function isValidPhone(input) {
  return PHONE_REGEX.test((input || '').trim().replace(/[\s.-]/g, ''));
}

function validateUsername(input) {
  return isValidEmail(input) || isValidPhone(input);
}

function showAuthMessage(message, isSuccess = false) {
  const errorBox = document.getElementById('auth-error');
  const icon = document.getElementById('auth-error-icon');
  const textEl = document.getElementById('auth-error-text');

  if (!errorBox || !icon || !textEl) {
    showToast(message, isSuccess ? 'success' : 'error');
    return;
  }

  textEl.innerText = message;
  errorBox.classList.remove('hidden');

  if (isSuccess) {
    errorBox.classList.remove('bg-red-50', 'text-red-500', 'border-red-100');
    errorBox.classList.add('bg-emerald-50', 'text-emerald-600', 'border-emerald-100');
    icon.setAttribute('data-lucide', 'check-circle-2');
  } else {
    errorBox.classList.remove('bg-emerald-50', 'text-emerald-600', 'border-emerald-100');
    errorBox.classList.add('bg-red-50', 'text-red-500', 'border-red-100');
    icon.setAttribute('data-lucide', 'alert-circle');
  }
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

window.handleAuthSubmit = async function(event) {
  event.preventDefault();
  const errorEl = document.getElementById('auth-error');
  if (errorEl) errorEl.classList.add('hidden');

  const usernameEl = document.getElementById('auth-username');
  const passwordEl = document.getElementById('auth-password');
  const nameEl = document.getElementById('auth-name');
  if (!usernameEl || !passwordEl) return;

  const usernameInput = usernameEl.value.trim();
  const passwordInput = passwordEl.value.trim();
  const nameInput = nameEl ? nameEl.value.trim() : '';
  let registerEmail = '';

  if (!usernameInput || !passwordInput) {
    return showAuthMessage(tr('auth.error.fillAll'));
  }
  if (!validateUsername(usernameInput)) {
    return showAuthMessage(tr('auth.error.usernameInvalid'));
  }
  if (!isLoginMode) {
    if (!nameInput) return showAuthMessage(tr('auth.error.nameRequired'));
    if (passwordInput.length < 8) return showAuthMessage(tr('auth.error.passwordShort'));
    const confirmEl = document.getElementById('auth-confirm-password');
    const confirmInput = confirmEl ? confirmEl.value.trim() : '';
    if (confirmInput !== passwordInput) return showAuthMessage(tr('auth.error.passwordMismatch'));

    const emailEl = document.getElementById('auth-email');
    const emailInput = emailEl ? emailEl.value.trim() : '';
    // Chưa nhập gì mà tên đăng nhập đã là email thì dùng luôn email đó
    registerEmail = emailInput || (isValidEmail(usernameInput) ? usernameInput : '');
    if (!isValidEmail(registerEmail)) {
      return showAuthMessage(tr('auth.error.emailRequired'));
    }
  }

  const submitBtn = document.getElementById('auth-submit-btn');
  const originalHTML = submitBtn ? submitBtn.innerHTML : '';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.classList.add('opacity-70');
    submitBtn.innerText = tr('auth.busy.processing');
  }

  try {
    if (isLoginMode) {
      const data = await api('/auth/login', {
        method: 'POST',
        body: { username: usernameInput, password: passwordInput }
      });

      if (data.otpRequired) {
        // Đăng nhập 2 bước: mật khẩu đúng, giờ chờ mã xác thực gửi tới email
        pendingRegister = null;
        pendingLogin = { ticket: data.ticket, username: usernameInput };
        showOtpPanel(data.email, data.devCode, data.resendInSeconds, 'login', data.message);
      } else {
        currentUser = data.user || null;
        closeAuthModal();
        await checkAuth();
      }
    } else {
      // Bảo đảm đã có cấu hình OTP của server trước khi chọn luồng đăng ký
      await fetchAppConfig();

      if (!otpConfig.enabled) {
        // Server đang tắt xác thực email -> đăng ký một bước như trước
        await api('/auth/register', {
          method: 'POST',
          body: {
            username: usernameInput,
            password: passwordInput,
            name: nameInput,
            email: registerEmail
          }
        });
        toggleAuthMode();
        passwordEl.value = '';
        showAuthMessage(tr('auth.success.registered'), true);
      } else {
        // Bước 1: xin mã xác thực rồi chuyển sang màn nhập mã
        const data = await api('/auth/register/otp', {
          method: 'POST',
          body: { username: usernameInput, name: nameInput, email: registerEmail }
        });
        pendingRegister = {
          username: usernameInput,
          password: passwordInput,
          name: nameInput,
          email: registerEmail
        };
        showOtpPanel(registerEmail, data.devCode, data.resendInSeconds);
      }
    }
  } catch (err) {
    showAuthMessage(err.message);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.classList.remove('opacity-70');
      if (isLoginMode) {
        // Đang ở màn nhập mã thì chỉ khôi phục nút, không ghi đè tiêu đề của màn đó
        if (isOtpPanelOpen()) {
          submitBtn.innerHTML = originalHTML;
          if (typeof lucide !== 'undefined') lucide.createIcons();
        } else {
          updateAuthUI();
        }
      } else {
        // giữ nguyên trạng thái đăng ký nếu còn ở chế độ đăng ký
        submitBtn.innerHTML = originalHTML;
        if (typeof lucide !== 'undefined') lucide.createIcons();
      }
    }
  }
};


/* ==========================================
   PHẦN 2: XỬ LÝ CHUYỂN TRANG (NAVIGATION) VÀ SỰ KIỆN RÚT TIỀN
========================================== */

const PAGE_ROUTES = {
  dashboard: { file: 'components/dashboard-content.html', title: 'Tổng quan' },
  'create-order': { file: 'components/create-order.html', title: 'Tạo đơn hàng' },
  notifications: { file: 'components/notifications.html', title: 'Thông báo' },
  orders: { file: 'components/orders.html', title: 'Đơn hàng đã đặt' },
  wallet: { file: 'components/wallet.html', title: 'Ví hoàn tiền' },
  referral: { file: 'components/referral.html', title: 'Mời bạn bè' },
  profile: { file: 'components/profile.html', title: 'Cá nhân' },
  guide: { file: 'components/guide.html', title: 'Trợ giúp' },
  admin: { file: 'components/admin.html', title: 'Trang quản trị' }
};

// admin.js chỉ được tải một lần, và chỉ khi thực sự mở trang quản trị
let adminScriptPromise = null;

function ensureAdminScript() {
  if (!adminScriptPromise) {
    adminScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'admin.js';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        adminScriptPromise = null;
        reject(new Error('Không tải được admin.js'));
      };
      document.body.appendChild(script);
    });
  }
  return adminScriptPromise;
}

/* ==========================================
   SIDEBAR: drawer trên mobile, thu gọn trên desktop
========================================== */

function isDesktopLayout() {
  return window.matchMedia('(min-width: 1024px)').matches;
}

function setSidebarOpen(open) {
  const sidebar = document.getElementById('app-sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  const toggle = document.getElementById('sidebar-toggle');
  if (!sidebar) return;

  sidebar.classList.toggle('sidebar-open', !!open);
  if (overlay) overlay.classList.toggle('sidebar-open', !!open);
  if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  document.body.classList.toggle('sidebar-open', !!open && !isDesktopLayout());
}

function openSidebar() {
  if (isDesktopLayout()) return;
  setSidebarOpen(true);
}

function closeSidebar() {
  setSidebarOpen(false);
}

async function navigateTo(page, options = {}) {
  const route = PAGE_ROUTES[page];
  if (!route) return false;

  // Chặn xem trước ở phía giao diện (server vẫn là nơi quyết định thật)
  if (page === 'admin' && (!currentUser || currentUser.role !== 'admin')) {
    showToast('Bạn không có quyền truy cập trang quản trị.', 'error');
    return false;
  }

  const loaded = await loadComponent('main-content-container', route.file);
  if (!loaded) return false;

  setHeaderTitle(route.title);
  updateActiveMenu(page);

  // URL phản ánh trang đang xem: F5 giữ nguyên trang, Back/Forward hoạt động.
  // Dùng hash (#/wallet) để nginx/Express không cần cấu hình rewrite.
  if (options.push !== false && pageFromHash() !== page) {
    window.history.pushState({ page }, '', '#/' + page);
  }
  document.title = route.title + ' - GZ AFL';
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' });

  if (page === 'profile') initProfilePage();

  if (page === 'admin') {
    try {
      await ensureAdminScript();
      if (typeof window.initAdminPage === 'function') window.initAdminPage();
    } catch (err) {
      showToast('Không tải được trang quản trị. Vui lòng thử lại.', 'error');
    }
  }

  return true;
}

// Đọc trang từ hash. Chỉ nhận tên trang có trong PAGE_ROUTES (tránh chèn nội dung lạ).
function pageFromHash() {
  const raw = String(window.location.hash || '')
    .replace(/^#\/?/, '')
    .trim();
  return Object.prototype.hasOwnProperty.call(PAGE_ROUTES, raw) ? raw : null;
}

window.addEventListener('popstate', function () {
  if (!currentUser) return;
  navigateTo(pageFromHash() || 'dashboard', { push: false });
});

document.addEventListener('click', async function(event) {
  // 0. Mở/đóng sidebar trên mobile
  if (event.target.closest('#sidebar-toggle')) {
    event.preventDefault();
    openSidebar();
    return;
  }
  if (event.target.closest('#sidebar-close') || event.target.closest('#sidebar-overlay')) {
    event.preventDefault();
    closeSidebar();
    return;
  }

  // 1. Nút Rút tiền (đánh dấu bằng data-action)
  const withdrawBtn = event.target.closest('[data-action="withdraw"]');
  if (withdrawBtn) {
    event.preventDefault();
    openWithdrawModal();
    return;
  }

  // 2. Đánh dấu tất cả thông báo đã đọc (gọi API thật, không chỉ ẩn chấm đỏ)
  const markReadBtn = event.target.closest('[data-action="mark-read"]');
  if (markReadBtn) {
    event.preventDefault();
    if (notificationsState.unreadCount === 0) {
      showToast('Không có thông báo chưa đọc.', 'info');
      return;
    }
    markReadBtn.disabled = true;
    try {
      await api('/notifications/read-all', { method: 'POST' });
      await updateNotificationsData();
      showToast('Đã đánh dấu tất cả thông báo là đã đọc.', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      markReadBtn.disabled = false;
    }
    return;
  }

  // 3. Sao chép link hoàn tiền (trang Đơn hàng)
  const copyLinkBtn = event.target.closest('[data-action="copy-link"]');
  if (copyLinkBtn) {
    event.preventDefault();
    copyTextToClipboard(copyLinkBtn.dataset.link || '').then((ok) => {
      showToast(
        ok ? 'Đã sao chép link hoàn tiền.' : 'Không sao chép được. Hãy bôi đen link và sao chép thủ công.',
        ok ? 'success' : 'error'
      );
    });
    return;
  }

  // 4. Điều hướng (menu, logo, nút cùng trang) — đánh dấu bằng data-page
  const navEl = event.target.closest('[data-page]');
  if (navEl) {
    event.preventDefault();
    closeSidebar();
    navigateTo(navEl.dataset.page);
  }
});

document.addEventListener('keydown', function(event) {
  if (event.key === 'Escape') closeSidebar();
});

window.addEventListener('resize', function() {
  if (isDesktopLayout()) setSidebarOpen(false);
});

function updateActiveMenu(page) {
  const allLinks = document.querySelectorAll('#sidebar-container nav a[data-page]');
  allLinks.forEach(link => {
    const isActive = link.dataset.page === page;
    link.className = isActive
      ? 'nav-item nav-item-active flex items-center gap-4 px-3 py-3 bg-[#18253f] text-white rounded-xl font-medium text-sm shadow-sm overflow-hidden'
      : 'nav-item flex items-center gap-4 px-3 py-3 text-slate-500 hover:bg-slate-50 hover:text-slate-800 rounded-xl font-medium text-sm transition-colors overflow-hidden';
  });
}


/* ==========================================
   PHẦN 3: XỬ LÝ TẠO ĐƠN HÀNG
========================================== */

document.addEventListener('click', async function(event) {
  const btn = event.target.closest('#btn-create-link');
  if (!btn) return;

  const inputElement = document.getElementById('link-input');
  const errorBox = document.getElementById('link-error');
  if (!inputElement) return;

  const inputValue = inputElement.value.trim();
  const shopeeRegex = /(shopee\.vn|shp\.ee)/i;
  const tiktokRegex = /(tiktok\.com|vt\.tiktok\.com)/i;
  const tikiRegex = /(tiki\.vn)/i;
  const lazadaRegex = /(lazada\.vn|c\.lazada\.vn)/i;

  errorBox && errorBox.classList.add('hidden');
  inputElement.classList.remove('border-red-500', 'bg-red-50/50');

  function showError(message) {
    if (errorBox) {
      const span = errorBox.querySelector('span');
      if (span) span.innerText = message;
      errorBox.classList.remove('hidden');
    } else {
      showToast(message, 'error');
    }
    inputElement.classList.add('border-red-500', 'bg-red-50/50');
    inputElement.focus();
  }

  if (inputValue === '') {
    showError('Vui lòng dán link sản phẩm trước khi tiếp tục.');
    return;
  }

  const links = inputValue.split('\n').filter(link => link.trim() !== '');
  if (links.length > 1) {
    showError('Chỉ cho phép nhập đúng 1 link. Vui lòng không nhập nhiều link cùng lúc!');
    return;
  }

  const singleLink = links[0];
  if (!(shopeeRegex.test(singleLink) || tiktokRegex.test(singleLink) || tikiRegex.test(singleLink) || lazadaRegex.test(singleLink))) {
    showError('Phát hiện link không hợp lệ! Vui lòng chỉ nhập link Shopee, TikTok, Tiki hoặc Lazada.');
    return;
  }

  const originalHTML = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<i data-lucide="loader-2" class="w-5 h-5 text-white animate-spin"></i> <span>Đang tạo link...</span>`;
  if (typeof lucide !== 'undefined') lucide.createIcons();

  try {
    const data = await api('/orders', { method: 'POST', body: { link: singleLink } });
    const affiliate = data.affiliate || (data.order && data.order.affiliate) || {};
    showToast(
      affiliate.isReal
        ? 'Đã tạo link hoàn tiền. Hãy mua hàng qua link này để được ghi nhận hoa hồng.'
        : 'Đã tạo đơn. Link này chưa gắn hoa hồng tự động, quản trị viên sẽ kiểm tra và chốt.',
      affiliate.isReal ? 'success' : 'info'
    );
    inputElement.value = '';
    renderLinkResult(data.order, affiliate);
    if (document.getElementById('dash-recent-orders')) updateDashboardData();
  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHTML;
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }
});

// Hiển thị link hoàn tiền vừa tạo kèm nút Sao chép và Mua ngay
function renderLinkResult(order, affiliate) {
  const box = document.getElementById('link-result');
  if (!box || !order) return;

  const link = order.affiliateLink || order.link;
  const meta = affiliate || order.affiliate || {};
  const isReal = meta.isReal === true;

  setText('link-result-title', isReal ? 'Đã tạo link hoàn tiền' : 'Đã tạo đơn hàng');
  setText('link-result-code', order.id);
  setText('link-result-open-label', isReal ? 'Mua ngay' : 'Mở sản phẩm');

  const urlInput = document.getElementById('link-result-url');
  if (urlInput) urlInput.value = link;

  const openLink = document.getElementById('link-result-open');
  if (openLink) openLink.href = safeHttpUrl(link) || '#';

  const note = document.getElementById('link-result-note');
  if (note) {
    if (isReal) {
      note.innerText = 'Link hoàn tiền đã sẵn sàng. Hãy mua hàng qua đúng link này để đơn được ghi nhận.';
    } else if (meta.error) {
      note.innerText =
        'Chưa tạo được link hoàn tiền tự động cho đơn này. Bạn vẫn mua hàng bình thường; quản trị viên sẽ kiểm tra và chốt hoa hồng thủ công.';
    } else {
      note.innerText =
        'Sàn này chưa được bật API hoa hồng thật. Bạn vẫn mua hàng bình thường; quản trị viên sẽ kiểm tra và chốt hoa hồng cho đơn này.';
    }
  }

  const footnote = document.getElementById('link-result-footnote');
  if (footnote) {
    footnote.innerText = isReal
      ? 'Hãy mua hàng qua đúng link này để đơn được ghi nhận hoa hồng.'
      : 'Link này chỉ mở đúng sản phẩm; đơn chưa được gắn hoa hồng tự động.';
  }

  const copyBtn = document.getElementById('btn-copy-affiliate');
  if (copyBtn) {
    copyBtn.onclick = () => {
      copyTextToClipboard(link).then((ok) => {
        showToast(
          ok ? 'Đã sao chép link hoàn tiền.' : 'Không sao chép được. Hãy bôi đen link và sao chép thủ công.',
          ok ? 'success' : 'error'
        );
      });
    };
  }

  box.classList.remove('hidden');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}


/* ==========================================
   PHẦN 4: HIỂN THỊ DỮ LIỆU ĐỘNG CHO DASHBOARD, VÍ & ĐƠN HÀNG
========================================== */

async function fetchOrders() {
  try {
    const data = await api('/orders');
    return Array.isArray(data.orders) ? data.orders : [];
  } catch (err) {
    // Trả null để nơi gọi phân biệt "không có đơn" với "không tải được".
    console.warn('Không tải được danh sách đơn hàng:', err);
    return null;
  }
}

// Lấy số dư thật (đã trừ các lệnh rút) — dùng cho header và thẻ số dư
async function fetchWallet() {
  try {
    return await api('/wallet');
  } catch (err) {
    return null;
  }
}

function setHeaderBalance(balance) {
  setText('header-balance', formatCurrency(balance));
}

const PLATFORM_STYLES = {
  shopee: { cls: 'bg-orange-500', icon: 'shopping-bag' },
  'tiktok shop': { cls: 'bg-black', icon: 'video' },
  tiki: { cls: 'bg-blue-600', icon: 'heart' },
  lazada: { cls: 'bg-indigo-600', icon: 'shopping-cart' }
};

function renderCommissionChart(monthly) {
  const chart = document.getElementById('dash-chart');
  const labels = document.getElementById('dash-chart-labels');
  const totalEl = document.getElementById('dash-chart-total');
  if (!chart || !labels) return;

  const months = Array.isArray(monthly) ? monthly : [];
  if (months.length === 0) {
    chart.innerHTML = `<div class="h-full w-full flex items-center justify-center text-xs text-slate-300">Không tải được số liệu</div>`;
    labels.innerHTML = '';
    if (totalEl) totalEl.textContent = 'Tổng: —';
    return;
  }

  const total = months.reduce((sum, m) => sum + (Number(m.commission) || 0), 0);
  if (totalEl) totalEl.textContent = 'Tổng: ' + formatCurrency(total);

  const labelsHtml = months
    .map((m, i) => {
      const isLast = i === months.length - 1;
      return `<div class="flex-1 text-center text-[11px] font-semibold ${isLast ? 'text-slate-700' : 'text-slate-400'}">${escapeHtml(m.label)}</div>`;
    })
    .join('');

  const max = Math.max(...months.map((m) => Number(m.commission) || 0), 0);
  if (max <= 0) {
    chart.innerHTML = `<div class="h-full w-full flex items-center justify-center text-xs text-slate-300">Chưa có hoa hồng được duyệt</div>`;
    labels.innerHTML = labelsHtml;
    return;
  }

  chart.innerHTML = months
    .map((m, i) => {
      const value = Number(m.commission) || 0;
      // Cao tối thiểu 4% để tháng có hoa hồng nhỏ vẫn nhìn thấy
      const height = value > 0 ? Math.max(4, Math.round((value / max) * 100)) : 0;
      const isLast = i === months.length - 1;
      return `<div class="flex-1 h-full flex items-end" title="${escapeHtml(m.label)}: ${formatCurrency(value)}">
        <div class="w-full rounded-t-lg transition-all ${isLast ? 'bg-[#f04d4d] shadow-sm' : 'bg-red-100 hover:bg-red-200'}" style="height:${height}%"></div>
      </div>`;
    })
    .join('');
  labels.innerHTML = labelsHtml;
}

function renderPlatformCommissions(byPlatform) {
  const area = document.getElementById('dash-platforms');
  if (!area) return;

  const list = Array.isArray(byPlatform) ? byPlatform : [];
  if (list.length === 0) {
    area.innerHTML = `<div class="text-xs text-slate-400 py-6 text-center">Chưa có đơn hàng nào.</div>`;
    return;
  }

  area.innerHTML = list
    .slice(0, 8)
    .map((p) => {
      const key = String(p.platform || '').toLowerCase();
      const style = PLATFORM_STYLES[key] || { cls: 'bg-slate-500', icon: 'store' };
      return `<div class="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-8 h-8 rounded-lg ${style.cls} text-white flex items-center justify-center font-bold text-xs shadow-sm flex-shrink-0">
            <i data-lucide="${style.icon}" class="w-4 h-4"></i>
          </div>
          <div class="min-w-0">
            <div class="font-medium text-sm text-slate-700 truncate">${escapeHtml(p.platform)}</div>
            <div class="text-[11px] text-slate-400">${Number(p.orders) || 0} đơn</div>
          </div>
        </div>
        <span class="font-bold text-xs text-red-500 flex-shrink-0">${formatCurrency(p.commission)}</span>
      </div>`;
    })
    .join('');

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function renderDashboardError() {
  const area = document.getElementById('dash-recent-orders');
  if (!area) return;
  area.innerHTML = `
    <div class="py-10 flex flex-col items-center text-center">
      <div class="w-12 h-12 rounded-full bg-amber-50 text-amber-500 flex items-center justify-center mb-3">
        <i data-lucide="cloud-off" class="w-5 h-5"></i>
      </div>
      <div class="font-bold text-slate-800 text-sm">Không tải được dữ liệu</div>
      <div class="text-xs text-slate-400 mt-1 mb-4">Kết nối tới máy chủ bị gián đoạn hoặc phản hồi quá chậm.</div>
      <button type="button" data-action="retry-dashboard" class="bg-[#f04d4d] hover:bg-red-600 text-white text-xs font-semibold px-4 py-2 rounded-xl transition">
        Thử lại
      </button>
    </div>`;
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

async function updateDashboardData() {
  const [orders, wallet] = await Promise.all([fetchOrders(), fetchWallet()]);
  const user = currentUser;

  const ordersOk = Array.isArray(orders);
  const stats = (wallet && wallet.stats) || {};
  const insights = (wallet && wallet.insights) || null;

  const total = ordersOk ? orders.length : Number(stats.total) || 0;
  const pending = ordersOk
    ? orders.filter((o) => o.status === 'Đang xử lý' || o.status === 'Chờ đối soát' || o.status === 'Chờ admin duyệt').length
    : Number(stats.pending) || 0;

  const monthCommission = insights ? Number(insights.month.commission) || 0 : null;
  const monthOrders = insights ? Number(insights.month.orders) || 0 : null;
  const totalCommission = wallet ? Number(wallet.totalCommission) || 0 : null;
  const balance = wallet ? Number(wallet.balance) || 0 : null;

  setText('dashboard-username', (user && user.name) ? user.name : 'bạn');

  // "Hoa hồng tháng này" = hoa hồng đã được admin duyệt của các đơn TẠO trong tháng.
  // Trước đây ô này hiển thị tổng hoa hồng mọi thời kỳ nên số liệu bị sai.
  setText('dash-commission', monthCommission === null ? '—' : formatCurrency(monthCommission));
  setText('dash-completed-note', insights ? monthOrders + ' đơn trong tháng' : 'Không tải được số liệu');

  setText('dash-order-count', monthOrders === null ? '—' : monthOrders);
  setText('dash-pending-note', pending > 0 ? pending + ' đơn đang chờ' : 'Không có đơn chờ');

  setText('dash-balance', balance === null ? '—' : formatCurrency(balance));
  setText('dash-total-commission', totalCommission === null ? '—' : formatCurrency(totalCommission));
  setText('dash-total-note', total + ' đơn tất cả');
  setText('dash-card-balance', balance === null ? '—' : formatCurrency(balance));
  if (balance !== null) setHeaderBalance(balance);

  renderCommissionChart(insights ? insights.monthly : null);
  renderPlatformCommissions(insights ? insights.byPlatform : null);

  if (!wallet || !ordersOk) {
    renderDashboardError();
  } else {
    renderDashboardRecentOrders(orders);
  }

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function renderDashboardRecentOrders(orders) {
  const area = document.getElementById('dash-recent-orders');
  if (!area) return;

  if (orders.length === 0) {
    area.innerHTML = `
      <div class="py-8 flex items-center gap-4">
        <div class="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center text-red-400 flex-shrink-0">
          <i data-lucide="shopping-cart" class="w-5 h-5"></i>
        </div>
        <div>
          <div class="font-bold text-slate-800 text-sm">Chưa có đơn hàng</div>
          <div class="text-xs text-slate-400 mt-0.5">Các đơn hàng hoàn tiền của bạn sẽ xuất hiện tại đây.</div>
        </div>
      </div>
    `;
    return;
  }

  let html = '';
  orders.slice(0, 5).forEach(order => {
    html += `
      <div class="py-4 flex items-center gap-4 border-b border-slate-50 last:border-0">
        <div class="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center text-red-400 flex-shrink-0">
          <i data-lucide="shopping-bag" class="w-5 h-5"></i>
        </div>
        <div class="min-w-0 flex-1">
          <div class="font-bold text-slate-800 text-sm truncate">${escapeHtml(order.platform)} <span class="text-xs text-slate-400 font-medium">(${escapeHtml(order.id)})</span></div>
          <div class="text-xs text-slate-400 mt-0.5">${escapeHtml(order.date)}</div>
        </div>
        <span class="px-3 py-1 border rounded-full text-xs font-bold flex-shrink-0 ${statusBadgeClass(order.status)}">${escapeHtml(order.status)}</span>
      </div>
    `;
  });
  area.innerHTML = html;
}

async function updateWalletData() {
  let data;
  try {
    data = await api('/wallet');
  } catch (err) {
    console.warn('Không tải được ví:', err);
    const container = document.getElementById('tx-container');
    if (container) {
      container.innerHTML = `
        <div class="py-12 flex flex-col items-center justify-center text-center">
          <div class="w-16 h-16 rounded-full bg-amber-50 text-amber-500 flex items-center justify-center mb-4">
            <i data-lucide="cloud-off" class="w-7 h-7"></i>
          </div>
          <h4 class="text-lg font-bold text-slate-800 mb-1">Không tải được dữ liệu ví</h4>
          <p class="text-slate-500 text-sm mb-5">${escapeHtml(err.message || 'Vui lòng kiểm tra kết nối rồi thử lại.')}</p>
          <button type="button" data-action="retry-wallet" class="bg-[#f04d4d] hover:bg-red-600 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition">
            Thử lại
          </button>
        </div>`;
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }
    setText('wallet-balance', '—');
    return;
  }

  setText('stat-total-orders', data.stats.total);
  setText('stat-pending-orders', data.stats.pending);
  setText('stat-completed-orders', data.stats.completed);
  setText('stat-paid-orders', data.stats.paid);
  setText('wallet-balance', formatCurrency(data.balance));
  setHeaderBalance(data.balance);

  const debt = Number(data.debt) || 0;
  const debtEl = document.getElementById('wallet-debt-note');
  if (debtEl) {
    debtEl.textContent = debt > 0 ? `Cần hoàn lại: ${formatCurrency(debt)}` : '';
    debtEl.classList.toggle('hidden', debt <= 0);
  }

  const pointsValue = Number(data.pointsValue) || 0;
  const pointsEl = document.getElementById('wallet-points-note');
  if (pointsEl) {
    pointsEl.textContent = pointsValue > 0 ? `Điểm thưởng đã đổi: ${formatCurrency(pointsValue)}` : '';
    pointsEl.classList.toggle('hidden', pointsValue <= 0);
  }

  renderWithdrawHistory(data.withdrawals || []);
}

// Huỷ lệnh rút đang chờ. Tiền trả lại số dư khả dụng ngay (không cần admin duyệt).
async function cancelWithdrawal(code) {
  if (!code) return;
  const confirmed = window.confirm(`Huỷ lệnh rút ${code}?\nSố tiền sẽ trở lại số dư khả dụng ngay.`);
  if (!confirmed) return;

  try {
    const data = await api('/wallet/withdrawals/' + encodeURIComponent(code), { method: 'DELETE' });
    showToast(`Đã huỷ lệnh rút ${code}. Số dư khả dụng: ${formatCurrency(Number(data.balance) || 0)}.`, 'success');
    if (document.getElementById('tx-container')) await updateWalletData();
    if (document.getElementById('dash-recent-orders')) await updateDashboardData();
  } catch (err) {
    showToast(err.message || 'Không huỷ được lệnh rút.', 'error');
  }
}

function renderWithdrawHistory(list = []) {
  const container = document.getElementById('tx-container');
  const countEl = document.getElementById('tx-count');
  if (!container) return;

  if (countEl) countEl.innerText = list.length + ' giao dịch';

  if (list.length === 0) {
    container.innerHTML = `
      <div class="py-12 flex flex-col items-center justify-center text-center">
        <div class="w-20 h-20 empty-orb bg-slate-50 rounded-full flex items-center justify-center mb-5 shadow-inner border border-slate-100">
          <i data-lucide="receipt" class="w-10 h-10 text-slate-300"></i>
        </div>
        <h4 class="text-lg font-bold text-slate-800 mb-2">Chưa có lịch sử giao dịch</h4>
        <p class="text-slate-500 text-sm max-w-sm leading-relaxed">
          Bạn chưa thực hiện lệnh rút tiền nào. Các giao dịch rút tiền của bạn sẽ được hiển thị chi tiết tại đây.
        </p>
      </div>
    `;
  } else {
    let html = '<div class="space-y-4">';
    list.forEach(tx => {
      const hasQr = !!tx.qrUrl;
      // Không nhập số tài khoản (chỉ tải ảnh QR) thì ghi rõ để người dùng dễ hiểu
      const accountLabel = tx.accNum
        ? `${escapeHtml(tx.bank)} ****${escapeHtml(String(tx.accNum).slice(-4))}`
        : `${tx.bank ? escapeHtml(tx.bank) + ' • ' : ''}nhận qua ảnh QR`;
      const ownerLabel = escapeHtml((tx.accName || '').toUpperCase()) || (hasQr ? 'Ảnh QR nhận tiền' : '');
      const meta = [ownerLabel, escapeHtml(tx.date)].filter(Boolean).join(' • ');
      html += `
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl border border-slate-100 bg-slate-50/50">
          <div class="flex items-center gap-3">
            ${hasQr
              ? `<img src="${escapeHtml(tx.qrUrl)}" alt="Ảnh QR nhận tiền" class="w-10 h-10 rounded-xl border border-slate-200 bg-white object-contain flex-shrink-0">`
              : `<div class="w-10 h-10 rounded-xl bg-blue-50 text-blue-500 flex items-center justify-center flex-shrink-0">
                  <i data-lucide="landmark" class="w-5 h-5"></i>
                </div>`}
            <div>
              <div class="font-bold text-slate-800 text-sm">${accountLabel}</div>
              <div class="text-xs text-slate-400 mt-0.5">${meta}</div>
            </div>
          </div>
          <div class="flex items-center gap-3 self-start sm:self-center">
            ${tx.amount > 0 ? `<span class="text-sm font-bold text-slate-800">${formatCurrency(tx.amount)}</span>` : ''}
            <span class="text-xs font-bold px-3 py-1.5 rounded-full border ${statusBadgeClass(tx.status)}">${escapeHtml(tx.status)}</span>
            ${tx.status === 'Đang xử lý'
              ? `<button type="button" data-action="cancel-withdrawal" data-id="${escapeHtml(tx.id)}"
                   aria-label="Huỷ lệnh rút ${escapeHtml(tx.id)}"
                   class="text-xs font-semibold text-slate-400 hover:text-red-500 px-2 py-1.5 rounded-lg hover:bg-red-50 transition">Huỷ</button>`
              : ''}
          </div>
        </div>
      `;
    });
    html += '</div>';
    container.innerHTML = html;
  }
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

async function updateOrdersData() {
  const orders = await fetchOrders();
  const area = document.getElementById('orders-display-area');
  const badge = document.getElementById('order-count-badge');
  if (!area) return;

  if (orders === null) {
    if (badge) badge.classList.add('hidden');
    area.innerHTML = `
      <div class="bg-white p-12 rounded-3xl border border-slate-100 flex flex-col items-center justify-center text-center min-h-[400px]">
        <div class="w-20 h-20 bg-amber-50 text-amber-500 rounded-full flex items-center justify-center mb-5">
          <i data-lucide="cloud-off" class="w-9 h-9"></i>
        </div>
        <h3 class="text-xl font-bold text-slate-800 mb-2">Không tải được đơn hàng</h3>
        <p class="text-slate-500 max-w-md mx-auto mb-8">Kết nối bị gián đoạn hoặc máy chủ phản hồi quá chậm. Đơn hàng của bạn vẫn an toàn.</p>
        <button type="button" data-action="retry-orders" class="bg-[#f04d4d] hover:bg-red-600 text-white font-medium px-6 py-3 rounded-xl shadow-md transition-all">
          Thử lại
        </button>
      </div>`;
    if (typeof lucide !== 'undefined') lucide.createIcons();
    return;
  }

  if (orders.length === 0) {
    if (badge) badge.classList.add('hidden');
    area.innerHTML = `
      <div class="bg-white p-12 rounded-3xl border border-slate-100 shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex flex-col items-center justify-center text-center min-h-[400px]">
        <div class="w-24 h-24 empty-orb bg-slate-50 rounded-full flex items-center justify-center mb-6 shadow-inner border border-slate-100">
          <i data-lucide="package-open" class="w-12 h-12 text-slate-300"></i>
        </div>
        <h3 class="text-xl font-bold text-slate-800 mb-2">Chưa có đơn hàng nào</h3>
        <p class="text-slate-500 max-w-md mx-auto mb-8 leading-relaxed">
          Các đơn hàng mà bạn dán link và mua sắm thành công sẽ xuất hiện tại đây. Hiện tại bạn chưa có đơn hàng nào được ghi nhận.
        </p>
        <button id="btn-go-to-create" data-page="create-order" class="bg-[#f04d4d] hover:bg-red-600 text-white font-medium px-6 py-3 rounded-xl shadow-md transition-all flex items-center gap-2 transform active:scale-[0.98]">
          <i data-lucide="plus" class="w-4 h-4"></i>
          <span>Tạo đơn hàng ngay</span>
        </button>
      </div>
    `;
  } else {
    if (badge) {
      badge.innerText = orders.length + ' đơn hàng';
      badge.classList.remove('hidden');
    }
    let htmlList = `<div class="space-y-4">`;
    orders.forEach(order => {
      const affiliate = order.affiliate || {};
      const hasTrackedLink = !!(order.affiliateLink && order.affiliateLink !== order.link);
      const isRealLink = affiliate.isReal === true;
      const isMockLink = affiliate.isReal === false;
      // Sàn đã ghi nhận chuyển đổi nhưng CHƯA duyệt: tiền chưa vào số dư (xem lib/postback.js)
      const waitingReconcile =
        order.status === 'Chờ đối soát' && (Number(order.networkCommission) || 0) > 0;
      // Sàn đã duyệt, đơn đang chờ quản trị viên chốt hoa hồng
      const pendingApproval = order.status === 'Chờ admin duyệt';
      const reversedCommission = Number(order.reversedCommission) || 0;
      htmlList += `
        <div class="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-4">
          <div class="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div class="flex items-start gap-4 min-w-0">
              <div class="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center flex-shrink-0">
                <i data-lucide="shopping-bag" class="w-6 h-6"></i>
              </div>
              <div class="min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="font-bold text-slate-800">${escapeHtml(order.platform)}</span>
                  <span class="text-xs text-slate-400 font-medium">(${escapeHtml(order.id)})</span>
                  ${isRealLink
                    ? '<span class="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">Link thật</span>'
                    : isMockLink
                      ? '<span class="text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">Chưa gắn hoa hồng</span>'
                      : ''}
                  ${order.clicks > 0 ? `<span class="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">${Number(order.clicks) || 0} lượt bấm</span>` : ''}
                </div>
                <a href="${escapeHtml(safeHttpUrl(order.link))}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(order.link)}" class="text-xs text-slate-400 hover:text-red-500 mt-1 block truncate max-w-md transition">${escapeHtml(order.link)}</a>
                <div class="text-xs font-semibold text-slate-500 mt-2">Ngày tạo: ${escapeHtml(order.date)}</div>
              </div>
            </div>
            <div class="flex items-center gap-3 self-end sm:self-start flex-shrink-0">
              <span class="text-sm font-bold text-slate-800">${formatCurrency(order.commission)}</span>
              <span class="px-3 py-1 border rounded-full text-xs font-bold ${statusBadgeClass(order.status)}">${escapeHtml(order.status)}</span>
            </div>
          </div>
          ${waitingReconcile ? `
          <div class="flex items-center gap-2 text-[11px] font-semibold text-amber-700 ${hasTrackedLink ? 'pt-1' : 'pt-4 border-t border-slate-50'}">
            <i data-lucide="clock" class="w-3.5 h-3.5"></i>
            Sàn đã ghi nhận ${formatCurrency(order.networkCommission)} nhưng chưa duyệt. Tiền sẽ vào số dư khi được duyệt.
          </div>` : ''}
          ${pendingApproval ? `
          <div class="flex items-center gap-2 text-[11px] font-semibold text-amber-700 pt-1">
            <i data-lucide="shield-check" class="w-3.5 h-3.5"></i>
            Sàn đã ghi nhận ${formatCurrency(order.networkCommission)}. Đơn đang chờ quản trị viên duyệt; hoa hồng ${formatCurrency(order.commission)} sẽ vào ví sau khi được duyệt.
          </div>` : ''}
          ${reversedCommission > 0 ? `
          <div class="flex items-center gap-2 text-[11px] font-semibold text-rose-600 pt-1">
            <i data-lucide="rotate-ccw" class="w-3.5 h-3.5"></i>
            Hoa hồng ${formatCurrency(reversedCommission)} đã bị thu hồi do đơn bị huỷ/hoàn trả.
          </div>` : ''}
          ${affiliate.error ? `
          <div class="flex items-center gap-2 text-[11px] font-semibold text-amber-700 pt-1">
            <i data-lucide="triangle-alert" class="w-3.5 h-3.5"></i>
            Chưa tạo được link hoàn tiền tự động. Quản trị viên sẽ kiểm tra và chốt hoa hồng cho đơn này.
          </div>` : ''}
          ${hasTrackedLink ? `
          <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-4 border-t border-slate-50">
            <span class="flex items-center gap-1.5 text-[11px] font-bold ${isRealLink ? 'text-emerald-600' : 'text-amber-700'} uppercase tracking-wider flex-shrink-0">
              <i data-lucide="link-2" class="w-3.5 h-3.5"></i> ${isRealLink ? 'Link hoàn tiền' : isMockLink ? 'Link chưa gắn hoa hồng' : 'Link đơn hàng'}
            </span>
            <input readonly value="${escapeHtml(order.affiliateLink)}" class="flex-1 min-w-0 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2 text-xs text-slate-600 focus:outline-none">
            <button data-action="copy-link" data-link="${escapeHtml(order.affiliateLink)}" class="flex items-center justify-center gap-1.5 px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl font-bold text-xs transition whitespace-nowrap">
              <i data-lucide="copy" class="w-3.5 h-3.5"></i> Sao chép
            </button>
            <a href="${escapeHtml(safeHttpUrl(order.affiliateLink))}" target="_blank" rel="noopener noreferrer" class="flex items-center justify-center gap-1.5 px-3 py-2 bg-[#f04d4d] hover:bg-red-600 text-white rounded-xl font-bold text-xs transition whitespace-nowrap">
              <i data-lucide="external-link" class="w-3.5 h-3.5"></i> ${isRealLink ? 'Mua ngay' : 'Mở sản phẩm'}
            </a>
          </div>` : ''}
        </div>
      `;
    });
    htmlList += `</div>`;
    area.innerHTML = htmlList;
  }
  if (typeof lucide !== 'undefined') lucide.createIcons();
}


/* ==========================================
   PHẦN 5: HỆ THỐNG MÃ GIỚI THIỆU (MỜI BẠN BÈ)
   Dữ liệu được quản lý ở backend (bảng referrals trong SQLite)
========================================== */

async function copyTextToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
    try { await navigator.clipboard.writeText(text); return true; } catch (err) { /* thử cách khác */ }
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.left = '-9999px';
    textarea.setAttribute('readonly', '');
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    const successful = document.execCommand('copy');
    document.body.removeChild(textarea);
    return successful;
  } catch (err) {
    return false;
  }
}

let referralState = {
  code: '',
  points: 0,
  redeemedCount: 0,
  history: [],
  pointValue: 10,
  minRedeemPoints: 100,
  redeemStep: 100,
  pointsInMoney: 0,
  redemptions: []
};

function renderRedeemHistory() {
  const area = document.getElementById('redeem-history-area');
  if (!area) return;
  const history = referralState.history || [];

  if (history.length === 0) {
    area.innerHTML = `
      <div class="flex flex-col items-center justify-center text-center py-10">
        <div class="w-16 h-16 empty-orb bg-slate-50 rounded-full flex items-center justify-center mb-4 shadow-inner border border-slate-100">
          <i data-lucide="ticket" class="w-8 h-8 text-slate-300"></i>
        </div>
        <p class="text-slate-500 text-sm max-w-sm leading-relaxed">Bạn chưa nhập mã giới thiệu nào.</p>
      </div>
    `;
  } else {
    let html = `<div class="space-y-3">`;
    history.forEach(item => {
      html += `
        <div class="flex items-center justify-between gap-4 p-4 rounded-2xl border border-slate-100 bg-slate-50/50">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-500 flex items-center justify-center flex-shrink-0">
              <i data-lucide="check-circle-2" class="w-5 h-5"></i>
            </div>
            <div>
              <div class="font-bold text-slate-800 tracking-widest">${escapeHtml(item.code)}</div>
              <div class="text-xs text-slate-400 mt-0.5">${escapeHtml(item.date)}</div>
            </div>
          </div>
          <span class="text-xs font-bold text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-full border border-emerald-100">+${Number(item.points) || 0} điểm</span>
        </div>
      `;
    });
    html += `</div>`;
    area.innerHTML = html;
  }
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function refreshReferralStats() {
  setText('referral-points', referralState.points);
  setText('stat-total-points', referralState.points);
  setText('stat-redeemed-count', referralState.redeemedCount);
}

/**
 * Cập nhật phần "Đổi điểm sang ví": số tiền tương ứng và nút đổi.
 * Quy tắc lấy từ backend: 1 điểm = pointValue đồng (mặc định 10đ), tối thiểu
 * minRedeemPoints điểm và đổi theo bội số redeemStep (mặc định 100 điểm).
 */
function refreshReferralExchange() {
  const pointValue = Number(referralState.pointValue) || 10;
  const minPoints = Number(referralState.minRedeemPoints) || 100;
  const step = Number(referralState.redeemStep) || 100;
  const points = Number(referralState.points) || 0;

  setText('referral-points-value', formatCurrency(points * pointValue));

  const btn = document.getElementById('btn-convert-points');
  const label = document.getElementById('btn-convert-points-label');
  if (!btn) return;

  // Chỉ đổi phần điểm tròn bội số của step, phần lẻ giữ lại cho lần sau.
  const convertible = Math.floor(points / step) * step;
  const canConvert = convertible >= minPoints;

  btn.disabled = !canConvert;
  if (label) {
    label.innerText = canConvert
      ? `Đổi ${convertible} điểm → ${formatCurrency(convertible * pointValue)}`
      : 'Chưa đủ điểm';
  }
  btn.title = canConvert
    ? `Đổi ${convertible} điểm thành ${formatCurrency(convertible * pointValue)} vào ví`
    : `Cần tối thiểu ${minPoints} điểm (${formatCurrency(minPoints * pointValue)}) để đổi.`;
}

/** Lịch sử các lần đổi điểm sang ví (mới nhất trước). */
function renderPointRedemptions() {
  const card = document.getElementById('point-redemption-card');
  const area = document.getElementById('point-redemption-history');
  if (!card || !area) return;

  const list = referralState.redemptions || [];
  card.classList.toggle('hidden', list.length === 0);
  if (list.length === 0) {
    area.innerHTML = '';
    return;
  }

  area.innerHTML = `<div class="space-y-3">${list
    .map(
      (item) => `
        <div class="flex items-center justify-between gap-4 p-4 rounded-2xl border border-slate-100 bg-slate-50/50">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-amber-50 text-amber-500 flex items-center justify-center flex-shrink-0">
              <i data-lucide="coins" class="w-5 h-5"></i>
            </div>
            <div>
              <div class="font-bold text-slate-800">${Number(item.points) || 0} điểm → ${formatCurrency(item.amount)}</div>
              <div class="text-xs text-slate-400 mt-0.5">${escapeHtml(item.date)}</div>
            </div>
          </div>
          <span class="text-xs font-bold text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-full border border-emerald-100">+${formatCurrency(item.amount)}</span>
        </div>
      `
    )
    .join('')}</div>`;

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function renderReferralPage() {
  setText('referral-code', referralState.code);
  refreshReferralStats();
  refreshReferralExchange();
  renderRedeemHistory();
  renderPointRedemptions();
}

function showRedeemFeedback(success, message) {
  const box = document.getElementById('redeem-feedback');
  const icon = document.getElementById('redeem-feedback-icon');
  const text = document.getElementById('redeem-feedback-text');
  if (!box || !icon || !text) return;
  box.classList.remove('hidden', 'bg-emerald-50', 'text-emerald-700', 'bg-red-50', 'text-red-500');
  if (success) {
    box.classList.add('bg-emerald-50', 'text-emerald-700');
    icon.setAttribute('data-lucide', 'check-circle-2');
  } else {
    box.classList.add('bg-red-50', 'text-red-500');
    icon.setAttribute('data-lucide', 'alert-circle');
  }
  text.innerText = message;
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

async function initReferralPage() {
  try {
    referralState = await api('/referral');
  } catch (err) {
    return;
  }

  setText('referral-code', referralState.code);
  refreshReferralStats();
  refreshReferralExchange();
  renderRedeemHistory();
  renderPointRedemptions();

  const btnCopy = document.getElementById('btn-copy-code');
  if (btnCopy) {
    btnCopy.onclick = () => {
      copyTextToClipboard(referralState.code).then((ok) => {
        const original = btnCopy.innerHTML;
        if (ok) {
          btnCopy.innerHTML = `<i data-lucide="check" class="w-4 h-4"></i><span>Đã sao chép!</span>`;
        } else {
          btnCopy.innerHTML = `<i data-lucide="x" class="w-4 h-4"></i><span>Sao chép thất bại</span>`;
        }
        if (typeof lucide !== 'undefined') lucide.createIcons();
        setTimeout(() => { btnCopy.innerHTML = original; if (typeof lucide !== 'undefined') lucide.createIcons(); }, 1500);
      });
    };
  }

  const toggleBtn = document.getElementById('redeem-toggle');
  const panel = document.getElementById('redeem-panel');
  const chevron = document.getElementById('redeem-chevron');
  if (toggleBtn && panel && chevron) {
    toggleBtn.onclick = () => {
      const isHidden = panel.classList.contains('hidden');
      if (isHidden) {
        panel.classList.remove('hidden');
        chevron.style.transform = 'rotate(180deg)';
      } else {
        panel.classList.add('hidden');
        chevron.style.transform = 'rotate(0deg)';
      }
    };
  }

  const btnRedeem = document.getElementById('btn-redeem-code');
  const redeemInput = document.getElementById('redeem-input');
  if (btnRedeem && redeemInput) {
    const handleRedeem = async () => {
      const code = redeemInput.value.trim();
      btnRedeem.disabled = true;
      try {
        const result = await api('/referral/redeem', { method: 'POST', body: { code } });
        showRedeemFeedback(true, result.message);
        redeemInput.value = '';
        referralState = await api('/referral');
        renderReferralPage();
      } catch (err) {
        showRedeemFeedback(false, err.message);
      } finally {
        btnRedeem.disabled = false;
      }
    };
    btnRedeem.onclick = handleRedeem;
    redeemInput.onkeydown = (e) => { if (e.key === 'Enter') handleRedeem(); };
    redeemInput.oninput = () => { redeemInput.value = redeemInput.value.toUpperCase(); };
  }

  const btnConvert = document.getElementById('btn-convert-points');
  if (btnConvert) {
    btnConvert.onclick = async () => {
      const pointValue = Number(referralState.pointValue) || 10;
      const minPoints = Number(referralState.minRedeemPoints) || 100;
      const step = Number(referralState.redeemStep) || 100;
      const points = Math.floor((Number(referralState.points) || 0) / step) * step;
      if (points < minPoints) return;

      const amount = points * pointValue;
      if (!window.confirm(`Đổi ${points} điểm thành ${formatCurrency(amount)} vào ví?`)) return;

      btnConvert.disabled = true;
      try {
        const result = await api('/referral/convert', {
          method: 'POST',
          body: { points }
        });
        showToast(result.message || `Đã đổi ${points} điểm thành ${formatCurrency(amount)}.`, 'success');
        if (typeof result.balance === 'number') setHeaderBalance(result.balance);
        referralState = await api('/referral');
        renderReferralPage();
      } catch (err) {
        showToast(err.message || 'Không đổi được điểm. Vui lòng thử lại.', 'error');
      } finally {
        refreshReferralExchange();
      }
    };
  }
}


/* ==========================================
   PHẦN 6: LOGIC TRANG CÁ NHÂN & UPLOAD AVATAR
========================================== */
const AVATAR_ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const AVATAR_MAX_SIZE = 2 * 1024 * 1024; // 2MB

function renderProfileBank(bank) {
  const nameEl = document.getElementById('profile-bank-name');
  const ownerEl = document.getElementById('profile-bank-owner');
  const badgeEl = document.getElementById('profile-bank-badge');
  const qrEl = document.getElementById('profile-bank-qr');
  const qrWrapEl = document.getElementById('profile-bank-qr-wrap');
  const qrEmptyEl = document.getElementById('profile-bank-qr-empty');
  if (!nameEl || !ownerEl) return;

  const hasQr = !!(bank && bank.qrUrl);

  if (hasQr) {
    if (qrEl) qrEl.src = bank.qrUrl;
    if (qrWrapEl) qrWrapEl.href = bank.qrUrl;
  } else if (qrEl) {
    qrEl.removeAttribute('src');
  }
  if (qrWrapEl) qrWrapEl.classList.toggle('hidden', !hasQr);
  if (qrEmptyEl) qrEmptyEl.classList.toggle('hidden', hasQr);

  if (bank && (bank.accNum || hasQr)) {
    if (bank.accNum) {
      nameEl.innerText = bank.bank + ' ****' + String(bank.accNum).slice(-4);
    } else {
      // Chỉ có ảnh QR, không nhập số tài khoản
      nameEl.innerText = bank.bank || 'Nhận tiền qua ảnh QR';
    }
    ownerEl.innerText = (bank.accName || '').toUpperCase() || 'Nhận tiền qua ảnh QR';
    if (badgeEl) badgeEl.classList.remove('hidden');
  } else {
    nameEl.innerText = 'Chưa liên kết';
    ownerEl.innerText = 'Thêm tài khoản khi rút tiền';
    if (badgeEl) badgeEl.classList.add('hidden');
  }
}

function initProfilePage() {
  const user = currentUser;
  if (!user) return;

  const nameInput = document.getElementById('profile-name');
  const emailInput = document.getElementById('profile-email');
  const phoneInput = document.getElementById('profile-phone');
  if (!nameInput || !emailInput || !phoneInput) return;

  // 1. Điền tên hiển thị
  nameInput.value = user.name || '';

  // 2. Điền Email và SĐT (ưu tiên dữ liệu đã lưu, nếu chưa có thì suy ra từ username)
  const usernameIsEmail = isValidEmail(user.username);
  emailInput.value = user.email || (usernameIsEmail ? user.username : '');
  phoneInput.value = user.phone || (!usernameIsEmail ? user.username : '');

  // 2b. Đổi email thì phải xác thực địa chỉ mới -> theo dõi ô email và dọn khối xác thực
  profileEmailOriginal = emailInput.value.trim();
  emailInput.oninput = function() {
    updateProfileEmailOtpVisibility();
  };
  resetProfileEmailOtp();

  // 3. Hiển thị Avatar nếu có
  const avatarImg = document.getElementById('profile-avatar-img');
  const avatarText = document.getElementById('profile-avatar-text');
  if (avatarImg && avatarText) {
    if (user.avatar) {
      avatarImg.src = user.avatar;
      avatarImg.classList.remove('hidden');
      avatarText.classList.add('hidden');
    } else {
      avatarImg.removeAttribute('src');
      avatarImg.classList.add('hidden');
      avatarText.classList.remove('hidden');
      avatarText.innerText = (user.name || 'KH').substring(0, 2).toUpperCase();
    }
  }

  // 3b. Tài khoản nhận tiền
  renderProfileBank(user.bank);

  // 4. Xử lý sự kiện Upload ảnh (tải lên ngay, lưu ở backend)
  const uploadInput = document.getElementById('profile-avatar-upload');
  if (!uploadInput) return;

  uploadInput.onchange = function(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (!AVATAR_ALLOWED_TYPES.includes(file.type)) {
      showToast('Chỉ hỗ trợ ảnh định dạng JPG, PNG hoặc WEBP.', 'error');
      e.target.value = '';
      return;
    }
    if (file.size > AVATAR_MAX_SIZE) {
      showToast('Kích thước ảnh quá lớn. Vui lòng chọn ảnh dưới 2MB.', 'error');
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = async function(evt) {
      const base64String = evt.target.result;
      try {
        const data = await api('/profile/avatar', { method: 'POST', body: { dataUrl: base64String } });
        currentUser = data.user || currentUser;
        if (avatarImg && avatarText) {
          avatarImg.src = currentUser.avatar;
          avatarImg.classList.remove('hidden');
          avatarText.classList.add('hidden');
        }
        renderHeaderUser(currentUser);
        showToast('Cập nhật ảnh đại diện thành công.', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        e.target.value = '';
      }
    };
    reader.readAsDataURL(file);
  };
}

// Địa chỉ email lúc mở trang, dùng để biết người dùng có đổi email hay không
let profileEmailOriginal = '';

function profileEmailChanged() {
  const el = document.getElementById('profile-email');
  if (!el) return false;
  return el.value.trim().toLowerCase() !== String(profileEmailOriginal || '').toLowerCase();
}

/**
 * Hiện khối "Xác thực email mới" khi: server đang bật xác thực email
 * VÀ người dùng đã sửa ô email khác với địa chỉ đang lưu.
 */
function updateProfileEmailOtpVisibility(reset) {
  const block = document.getElementById('profile-email-otp-block');
  if (!block) return;

  if (reset) {
    block.classList.add('hidden');
    return;
  }

  const emailEl = document.getElementById('profile-email');
  const shouldShow = otpConfig.enabled && profileEmailChanged();

  if (shouldShow) {
    block.classList.remove('hidden');
    setText('profile-email-otp-target', (emailEl ? emailEl.value.trim() : '') || 'email mới');
    setText('profile-email-otp-length', String(otpConfig.length || 6));
    const hint = document.getElementById('profile-email-otp-hint');
    if (hint) {
      hint.innerText = otpConfig.delivery
        ? 'Mã có hiệu lực ' + Math.round((otpConfig.ttlSeconds || 600) / 60) + ' phút và chỉ dùng được một lần.'
        : 'Hệ thống chưa cấu hình gửi thư. Vui lòng liên hệ quản trị viên để đổi email.';
    }
  } else {
    block.classList.add('hidden');
  }
}

// Gửi mã xác thực tới địa chỉ email mới
window.sendProfileEmailOtp = async function() {
  const emailEl = document.getElementById('profile-email');
  const btn = document.getElementById('profile-email-otp-btn');
  const input = document.getElementById('profile-email-otp-input');
  if (!emailEl) return;

  const email = emailEl.value.trim();
  if (!email) return showToast('Vui lòng nhập email mới trước khi lấy mã.', 'error');
  if (!isValidEmail(email)) return showToast('Email không hợp lệ. Vui lòng kiểm tra lại.', 'error');

  let data = null;
  const restore = busyButton(btn, tr('auth.busy.sending'));
  try {
    data = await api('/profile/email/otp', { method: 'POST', body: { email } });
  } catch (err) {
    showToast(err.message || 'Không gửi được mã xác thực. Vui lòng thử lại.', 'error');
    if (err.status === 429) startResendCountdown('profile', otpConfig.resendSeconds);
  } finally {
    restore();
  }

  if (!data) return;

  // Không xoá ô mã thử nghiệm cũ nếu lần này không có mã mới (đang trong thời gian chờ)
  if (data.devCode) setDevCode('profile-email-otp-dev', 'profile-email-otp-devcode', data.devCode);
  startResendCountdown('profile', data.resendInSeconds);
  showToast('Đã gửi mã xác thực tới ' + email + '. Nhớ kiểm tra cả thư rác (Spam).', 'success');
  if (input) input.focus();
};

// Dọn khối xác thực sau khi lưu thành công hoặc khi tải lại trang
function resetProfileEmailOtp() {
  updateProfileEmailOtpVisibility(true);
  setDevCode('profile-email-otp-dev', 'profile-email-otp-devcode', '');
  const input = document.getElementById('profile-email-otp-input');
  if (input) input.value = '';
  const btn = document.getElementById('profile-email-otp-btn');
  if (btn) {
    btn.disabled = false;
    btn.innerText = 'Gửi mã';
  }
  clearInterval(otpTimers.profile);
  otpTimers.profile = null;
}

// Lưu thông tin cá nhân
window.saveProfileData = async function() {
  if (!currentUser) return;

  const nameInput = document.getElementById('profile-name');
  const emailInput = document.getElementById('profile-email');
  const phoneInput = document.getElementById('profile-phone');
  if (!nameInput || !emailInput || !phoneInput) return;

  const nameValue = nameInput.value.trim();
  const emailValue = emailInput.value.trim();
  const phoneValue = phoneInput.value.trim();

  if (!nameValue) {
    showToast('Vui lòng nhập họ và tên.', 'error');
    return;
  }
  if (emailValue && !isValidEmail(emailValue)) {
    showToast('Email không hợp lệ. Vui lòng kiểm tra lại.', 'error');
    return;
  }
  if (phoneValue && !isValidPhone(phoneValue)) {
    showToast('Số điện thoại không hợp lệ. Vui lòng kiểm tra lại.', 'error');
    return;
  }

  // Đổi email -> bắt buộc kèm mã xác thực đã gửi tới địa chỉ mới
  const body = { name: nameValue, email: emailValue, phone: phoneValue };
  if (otpConfig.enabled && profileEmailChanged()) {
    const codeEl = document.getElementById('profile-email-otp-input');
    const code = codeEl ? codeEl.value.trim() : '';
    if (!isValidOtpCode(code)) {
      updateProfileEmailOtpVisibility();
      showToast('Vui lòng lấy mã và nhập mã xác thực gồm ' + otpConfig.length + ' chữ số gửi tới email mới.', 'error');
      return;
    }
    body.emailOtp = code;
  }

  try {
    const data = await api('/profile', { method: 'PUT', body });
    currentUser = data.user || currentUser;
    renderHeaderUser(currentUser);

    // Địa chỉ mới đã được xác thực -> cập nhật mốc so sánh và dọn khối xác thực
    profileEmailOriginal = (currentUser.email || '').trim();
    resetProfileEmailOtp();

    const msg = document.getElementById('profile-save-msg');
    if (msg) {
      msg.classList.remove('hidden');
      setTimeout(() => msg.classList.remove('opacity-0'), 10);
      setTimeout(() => {
        msg.classList.add('opacity-0');
        setTimeout(() => msg.classList.add('hidden'), 300);
      }, 3000);
    }
  } catch (err) {
    // Sai mã / mã hết hạn: hiện lại khối xác thực để người dùng thử lại
    updateProfileEmailOtpVisibility();
    showToast(err.message, 'error');
  }
};

// Đổi mật khẩu đăng nhập
window.changePassword = async function() {
  if (!currentUser) return;

  const currentEl = document.getElementById('pwd-current');
  const newEl = document.getElementById('pwd-new');
  const confirmEl = document.getElementById('pwd-confirm');
  const btn = document.getElementById('pwd-submit-btn');
  if (!currentEl || !newEl || !confirmEl) return;

  const currentPassword = currentEl.value.trim();
  const newPassword = newEl.value.trim();
  const confirmPassword = confirmEl.value.trim();

  if (!currentPassword || !newPassword || !confirmPassword) {
    showToast('Vui lòng điền đầy đủ cả 3 ô mật khẩu.', 'error');
    return;
  }
  if (newPassword.length < 8) {
    showToast('Mật khẩu mới phải có ít nhất 8 ký tự.', 'error');
    return;
  }
  if (newPassword !== confirmPassword) {
    showToast('Mật khẩu nhập lại không khớp.', 'error');
    return;
  }
  if (newPassword === currentPassword) {
    showToast('Mật khẩu mới phải khác mật khẩu hiện tại.', 'error');
    return;
  }

  const originalHTML = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.classList.add('opacity-70');
    btn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Đang xử lý...';
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  try {
    await api('/profile/password', {
      method: 'PUT',
      body: { currentPassword, newPassword }
    });
    currentEl.value = '';
    newEl.value = '';
    confirmEl.value = '';
    showToast('Đổi mật khẩu thành công. Lần đăng nhập sau hãy dùng mật khẩu mới.', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('opacity-70');
      btn.innerHTML = originalHTML;
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }
  }
};


/* ==========================================
   PHẦN 7: LOGIC MODAL RÚT TIỀN
========================================== */

// Giá trị của option "Ngân hàng khác (tự ghi tên)" trong dropdown
const BANK_OTHER_VALUE = '__other__';

// Ảnh QR nhận tiền: chỉ nhận PNG/JPG, tối đa 2MB (server kiểm tra lại lần nữa)
const BANK_QR_ALLOWED_TYPES = ['image/png', 'image/jpeg'];
const BANK_QR_MAX_SIZE = 2 * 1024 * 1024; // 2MB

// Cách nhận tiền khi rút: 'account' = nhập số tài khoản, 'qr' = tải ảnh QR.
// Người dùng chỉ cần chọn 1 trong 2 cách (xem index.html -> #withdraw-method-*).
let withdrawMode = 'account';

// Đổi giữa 2 cách nhận tiền
window.setWithdrawMode = function(mode) {
  withdrawMode = mode === 'qr' ? 'qr' : 'account';

  const accountBox = document.getElementById('withdraw-fields-account');
  const qrBox = document.getElementById('withdraw-fields-qr');
  if (accountBox) accountBox.classList.toggle('hidden', withdrawMode !== 'account');
  if (qrBox) qrBox.classList.toggle('hidden', withdrawMode !== 'qr');

  // Tô đậm nút đang được chọn
  const onClasses = ['bg-[#18253f]', 'text-white', 'border-[#18253f]', 'wd-mode-on'];
  const offClasses = ['bg-white', 'text-slate-600', 'border-slate-200', 'hover:bg-slate-50'];
  [
    [document.getElementById('withdraw-method-account'), withdrawMode === 'account'],
    [document.getElementById('withdraw-method-qr'), withdrawMode === 'qr']
  ].forEach(function(item) {
    const btn = item[0];
    if (!btn) return;
    onClasses.concat(offClasses).forEach(function(cls) {
      btn.classList.remove(cls);
    });
    (item[1] ? onClasses : offClasses).forEach(function(cls) {
      btn.classList.add(cls);
    });
    // aria-pressed để trình đọc màn hình biết nút nào đang được chọn
    btn.setAttribute('aria-pressed', item[1] ? 'true' : 'false');
  });

  updateWithdrawQrNote();
};

// Nhắc người dùng tải ảnh QR khi đang chọn cách "Ảnh QR" mà chưa có ảnh nào
function updateWithdrawQrNote() {
  const note = document.getElementById('withdraw-qr-missing');
  if (!note) return;
  const hasQr = !!(currentUser && currentUser.bank && currentUser.bank.qrUrl);
  note.classList.toggle('hidden', !(withdrawMode === 'qr' && !hasQr));
}

// Nạp danh sách ngân hàng/ví từ /api/config (xem backend/lib/banks.js).
// Nếu không gọi được API thì giữ nguyên vài lựa chọn ghi sẵn trong index.html.
function populateBankOptions() {
  const sel = document.getElementById('withdraw-bank');
  if (!sel) return;

  const groups = appConfig && Array.isArray(appConfig.banks) ? appConfig.banks : null;
  if (!groups || !groups.length) return;

  const current = sel.value;
  sel.innerHTML = '';

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.disabled = true;
  placeholder.innerText = '-- Chọn phương thức nhận tiền --';
  sel.appendChild(placeholder);

  groups.forEach((group) => {
    const optgroup = document.createElement('optgroup');
    optgroup.label = group.label || '';
    (group.banks || []).forEach((item) => {
      const option = document.createElement('option');
      option.value = item.value;
      option.innerText = item.label || item.value;
      optgroup.appendChild(option);
    });
    if (optgroup.children.length) sel.appendChild(optgroup);
  });

  const other = document.createElement('option');
  other.value = BANK_OTHER_VALUE;
  other.innerText = 'Ngân hàng khác (tự ghi tên)';
  sel.appendChild(other);

  // Giữ lại lựa chọn đang có nếu nó vẫn nằm trong danh sách mới
  if (current && current !== BANK_OTHER_VALUE) {
    const found = Array.from(sel.options).some((o) => o.value === current);
    sel.value = found ? current : BANK_OTHER_VALUE;
  }
  toggleOtherBankInput();
}

// Hiện/ẩn ô tự ghi tên ngân hàng khi chọn "Ngân hàng khác"
function toggleOtherBankInput() {
  const sel = document.getElementById('withdraw-bank');
  const input = document.getElementById('withdraw-bank-other');
  if (!sel || !input) return;

  const isOther = sel.value === BANK_OTHER_VALUE;
  input.classList.toggle('hidden', !isOther);
  if (!isOther) input.value = '';
}

// Tên ngân hàng người dùng đang chọn (hoặc tự ghi)
function currentBankName() {
  const sel = document.getElementById('withdraw-bank');
  const input = document.getElementById('withdraw-bank-other');
  if (!sel) return '';
  if (sel.value === BANK_OTHER_VALUE) return input ? input.value.trim() : '';
  return sel.value;
}

// Điền sẵn thông tin nhận tiền đã lưu vào hộp thoại rút tiền
function fillWithdrawBankFields() {
  const sel = document.getElementById('withdraw-bank');
  const numEl = document.getElementById('withdraw-acc-number');
  const nameEl = document.getElementById('withdraw-acc-name');
  const otherEl = document.getElementById('withdraw-bank-other');
  if (!sel || !currentUser || !currentUser.bank) return;

  const savedBank = String(currentUser.bank.bank || '');
  const inList = Array.from(sel.options).some((o) => o.value === savedBank && o.value !== BANK_OTHER_VALUE);

  if (inList) {
    sel.value = savedBank;
  } else if (savedBank) {
    // Ngân hàng không có trong danh sách (người dùng đã tự ghi tên lần trước)
    sel.value = BANK_OTHER_VALUE;
    if (otherEl) otherEl.value = savedBank;
  }
  if (numEl && currentUser.bank.accNum) numEl.value = currentUser.bank.accNum;
  if (nameEl && currentUser.bank.accName) nameEl.value = currentUser.bank.accName;

  toggleOtherBankInput();
}

// Đọc file thành data URL base64 (dùng cho ảnh QR)
function readFileAsDataUrl(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (evt) => resolve(evt.target.result || '');
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });
}

// Hiện ảnh QR đã lưu trong hộp thoại rút tiền
function renderWithdrawQr(qrUrl) {
  const img = document.getElementById('withdraw-qr-preview');
  const removeBtn = document.getElementById('withdraw-qr-remove');
  const label = document.getElementById('withdraw-qr-label');
  if (!img) return;

  if (qrUrl) {
    img.src = qrUrl;
    img.classList.remove('hidden');
  } else {
    img.removeAttribute('src');
    img.classList.add('hidden');
  }
  if (removeBtn) removeBtn.classList.toggle('hidden', !qrUrl);
  if (label) label.innerText = qrUrl ? 'Đổi ảnh QR khác' : 'Tải ảnh QR lên';

  // Có ảnh QR rồi thì không cần nhắc tải nữa
  updateWithdrawQrNote();
}

// Gắn sự kiện chọn file cho ô tải ảnh QR.
// Dùng onchange (không phải addEventListener) nên mở lại hộp thoại nhiều lần cũng không trùng sự kiện.
function initWithdrawQr() {
  const input = document.getElementById('withdraw-qr-upload');
  if (!input) return;

  input.onchange = async function(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (!BANK_QR_ALLOWED_TYPES.includes(file.type)) {
      showToast('Chỉ nhận ảnh QR định dạng PNG hoặc JPG.', 'error');
      e.target.value = '';
      return;
    }
    if (file.size > BANK_QR_MAX_SIZE) {
      showToast('Ảnh QR quá lớn. Vui lòng chọn ảnh dưới 2MB.', 'error');
      e.target.value = '';
      return;
    }

    const dataUrl = await readFileAsDataUrl(file);
    if (!dataUrl) {
      showToast('Không đọc được file ảnh. Vui lòng thử lại.', 'error');
      e.target.value = '';
      return;
    }

    try {
      const data = await api('/profile/bank-qr', { method: 'POST', body: { dataUrl } });
      currentUser = data.user || currentUser;
      renderWithdrawQr(currentUser && currentUser.bank ? currentUser.bank.qrUrl : null);
      renderProfileBank(currentUser && currentUser.bank);
      showToast('Đã lưu ảnh QR nhận tiền.', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      e.target.value = '';
    }
  };
}

// Xoá ảnh QR nhận tiền đã lưu
window.removeBankQr = async function() {
  try {
    const data = await api('/profile/bank-qr', { method: 'DELETE' });
    currentUser = data.user || currentUser;
    renderWithdrawQr(null);
    renderProfileBank(currentUser && currentUser.bank);
    showToast('Đã xoá ảnh QR nhận tiền.', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
};

window.openWithdrawModal = async function() {
  const modal = document.getElementById('withdraw-modal');
  const content = document.getElementById('withdraw-modal-content');
  if (!modal || !content) return;

  // Nạp danh sách ngân hàng đầy đủ rồi điền sẵn thông tin nhận tiền đã lưu (nếu có)
  populateBankOptions();
  fillWithdrawBankFields();

  // Ảnh QR nhận tiền đã lưu (nếu có)
  initWithdrawQr();
  renderWithdrawQr(currentUser && currentUser.bank ? currentUser.bank.qrUrl : null);

  // Mở đúng cách người dùng đã dùng: có số tài khoản thì mở cách nhập số tài khoản,
  // chỉ có ảnh QR thì mở cách ảnh QR (người dùng mới thì mặc định nhập số tài khoản).
  const savedBank = (currentUser && currentUser.bank) || {};
  setWithdrawMode(savedBank.accNum ? 'account' : savedBank.qrUrl ? 'qr' : 'account');

  modal.classList.remove('hidden');
  lockModal(modal);

  // Luôn mở ở đầu hộp thoại (khi màn hình thấp, hộp thoại sẽ cuộn bên trong)
  content.scrollTop = 0;

  setTimeout(() => {
    modal.classList.remove('opacity-0');
    content.classList.remove('scale-95');
  }, 10);

  focusInModal(modal, withdrawMode === 'qr' ? '[data-action="pick-withdraw-qr"]' : '#withdraw-acc-number');

  if (typeof lucide !== 'undefined') lucide.createIcons();

  await refreshWithdrawBalance();
};

// Nạp số dư + mức rút tối thiểu vào modal và chặn gửi nếu chưa đủ tiền.
// Việc chặn thật vẫn do server quyết định (backend/routes/wallet.js).
async function refreshWithdrawBalance() {
  const availableEl = document.getElementById('withdraw-available');
  const noteEl = document.getElementById('withdraw-note');
  const btn = document.getElementById('withdraw-submit-btn');
  if (!availableEl || !noteEl || !btn) return;

  let data;
  try {
    data = await api('/wallet');
  } catch (err) {
    availableEl.innerText = '--';
    noteEl.innerText = 'Không tải được số dư. Vui lòng đóng hộp thoại và thử lại.';
    btn.disabled = true;
    return;
  }

  const balance = Number(data.balance) || 0;
  const min = Number(data.minWithdraw) || 0;
  const debt = Number(data.debt) || 0;

  availableEl.innerText = formatCurrency(balance);

  let extra = '';
  if (debt > 0) extra += ' Bạn đang cần hoàn lại ' + formatCurrency(debt) + ' do hoa hồng bị thu hồi.';

  if (balance < min) {
    noteEl.innerText =
      'Mức rút tối thiểu là ' + formatCurrency(min) + '. ' +
      (balance > 0
        ? 'Bạn còn thiếu ' + formatCurrency(min - balance) + '.'
        : 'Bạn chưa có hoa hồng khả dụng để rút.') +
      extra;
    btn.disabled = true;
    btn.title = 'Số dư chưa đủ để rút';
  } else {
    noteEl.innerText =
      'Hệ thống sẽ rút toàn bộ ' + formatCurrency(balance) + ' đang có. ' +
      'Mức tối thiểu: ' + formatCurrency(min) + '.' + extra;
    btn.disabled = false;
    btn.title = '';
  }
}

window.closeWithdrawModal = function() {
  const modal = document.getElementById('withdraw-modal');
  const content = document.getElementById('withdraw-modal-content');
  if (!modal || !content) return;

  modal.classList.add('opacity-0');
  content.classList.add('scale-95');

  setTimeout(() => {
    modal.classList.add('hidden');
    unlockModal(modal);
  }, 300);
};

window.submitWithdraw = async function() {
  const numEl = document.getElementById('withdraw-acc-number');
  const nameEl = document.getElementById('withdraw-acc-name');
  const btn = document.getElementById('withdraw-submit-btn');
  if (!numEl || !nameEl) return;

  const bank = currentBankName();
  const accNum = numEl.value.trim();
  const accName = nameEl.value.trim();

  // Người dùng chỉ cần chọn 1 trong 2: nhập số tài khoản HOẶC tải ảnh QR
  const isQrMode = withdrawMode === 'qr';
  const hasQr = !!(currentUser && currentUser.bank && currentUser.bank.qrUrl);

  if (isQrMode) {
    if (!hasQr) {
      showToast('Bạn chưa tải lên ảnh QR nhận tiền. Vui lòng tải ảnh QR lên, hoặc chuyển sang cách nhập số tài khoản.', 'error');
      return;
    }
  } else {
    if (!bank) {
      showToast('Vui lòng chọn ngân hàng/ví điện tử nhận tiền (hoặc ghi rõ tên ngân hàng khác).', 'error');
      return;
    }
    if (!accNum || !accName) {
      showToast('Vui lòng nhập đầy đủ số tài khoản và tên chủ tài khoản, hoặc chuyển sang cách tải ảnh QR.', 'error');
      return;
    }
    if (!/^[0-9]{6,20}$/.test(accNum)) {
      showToast('Số tài khoản/số điện thoại ví phải là 6-20 chữ số.', 'error');
      return;
    }
  }

  const originalHTML = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Đang gửi...';
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  try {
    // Cách "Ảnh QR" thì không gửi kèm thông tin ngân hàng/STK vì ảnh QR đã có sẵn
    const data = await api('/wallet/withdrawals', {
      method: 'POST',
      body: isQrMode
        ? { mode: 'qr', bank: '', accNum: '', accName: '' }
        : { mode: 'account', bank, accNum, accName }
    });

    currentUser = data.user || currentUser;
    renderProfileBank(currentUser && currentUser.bank);

    if (document.getElementById('tx-container')) {
      await updateWalletData();
    } else if (document.getElementById('dash-recent-orders')) {
      await updateDashboardData();
    }

    const amount = (data.withdrawal && data.withdrawal.amount) || 0;
    const detail = isQrMode
      ? 'Nhận tiền qua ảnh QR'
      : `Ngân hàng: ${bank}\nSTK: ${accNum}\nTên: ${accName.toUpperCase()}`;
    showToast(`✅ Đã gửi yêu cầu rút ${formatCurrency(amount)}!\n${detail}`, 'success');
    closeWithdrawModal();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (btn) {
      btn.innerHTML = originalHTML;
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }
    // Nạp lại số dư: nếu vừa gửi thành công thì nút sẽ tự bị khoá
    await refreshWithdrawBalance();
  }
};


/* ==========================================
   PHẦN 8: THÔNG BÁO (bảng notifications trong SQLite)
========================================== */

let notificationsState = { items: [], unreadCount: 0 };

const NOTIFICATION_ICON_STYLE = {
  'shopping-cart': 'bg-red-50 text-red-500',
  banknote: 'bg-blue-50 text-blue-500',
  'file-text': 'bg-indigo-50 text-indigo-500',
  'user-plus': 'bg-emerald-50 text-emerald-500',
  bell: 'bg-slate-100 text-slate-500'
};

async function updateNotificationsData() {
  const area = document.getElementById('notifications-list');
  if (!area) return;

  let data;
  try {
    data = await api('/notifications');
  } catch (err) {
    area.innerHTML = `
      <div class="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm text-center text-sm text-slate-500">
        Không tải được thông báo. Vui lòng thử lại sau.
      </div>
    `;
    return;
  }

  notificationsState.items = (data && data.notifications) || [];
  notificationsState.unreadCount = Number(data && data.unreadCount) || 0;
  renderNotifications();
}

function renderNotifications() {
  const area = document.getElementById('notifications-list');
  if (!area) return;

  const badge = document.getElementById('noti-unread-badge');
  if (badge) {
    if (notificationsState.unreadCount > 0) {
      badge.innerText = notificationsState.unreadCount + ' chưa đọc';
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }

  const list = notificationsState.items;

  if (list.length === 0) {
    area.innerHTML = `
      <div class="bg-white p-12 rounded-3xl border border-slate-100 shadow-sm flex flex-col items-center justify-center text-center">
        <div class="w-20 h-20 empty-orb bg-slate-50 rounded-full flex items-center justify-center mb-5 shadow-inner border border-slate-100">
          <i data-lucide="bell-off" class="w-10 h-10 text-slate-300"></i>
        </div>
        <h4 class="text-lg font-bold text-slate-800 mb-2">Chưa có thông báo nào</h4>
        <p class="text-slate-500 text-sm max-w-sm leading-relaxed">
          Khi bạn tạo đơn hàng, rút tiền hoặc đơn hàng được cập nhật, thông báo sẽ xuất hiện tại đây.
        </p>
      </div>
    `;
  } else {
    let html = '';
    list.forEach((item) => {
      const style = NOTIFICATION_ICON_STYLE[item.icon] || NOTIFICATION_ICON_STYLE.bell;
      html += `
        <div class="bg-white p-6 rounded-3xl border ${item.isRead ? 'border-slate-100' : 'border-red-100'} shadow-sm flex items-start gap-4">
          <div class="w-12 h-12 rounded-2xl ${style} flex items-center justify-center flex-shrink-0 mt-1">
            <i data-lucide="${escapeHtml(item.icon || 'bell')}" class="w-6 h-6"></i>
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <h3 class="font-bold text-slate-800">${escapeHtml(item.title)}</h3>
              ${item.isRead ? '' : '<span class="notification-dot w-2 h-2 rounded-full bg-red-500 flex-shrink-0"></span>'}
            </div>
            <p class="text-slate-500 text-sm mt-2 leading-relaxed">${escapeHtml(item.body)}</p>
            <div class="text-xs font-semibold text-slate-400 mt-4">${escapeHtml(item.date)}</div>
          </div>
        </div>
      `;
    });
    area.innerHTML = html;
  }

  if (typeof lucide !== 'undefined') lucide.createIcons();
}


/* ==========================================
   PHẦN 9: TRANG CHỦ (LANDING) — CHUYỂN LINK & HƯỚNG DẪN
========================================== */

// Link người dùng dán ở trang chủ, giữ lại để điền sẵn sau khi đăng nhập xong
let pendingLandingLink = null;

const LANDING_LINK_REGEX = /(shopee\.vn|shp\.ee|tiktok\.com|vt\.tiktok\.com|tiki\.vn|lazada\.vn|c\.lazada\.vn)/i;

window.convertLandingLink = function() {
  const input = document.getElementById('landing-link-input');
  const value = input ? input.value.trim() : '';

  if (!value) {
    showToast(tr('landing.error.empty'), 'error');
    if (input) input.focus();
    return;
  }
  if (!LANDING_LINK_REGEX.test(value)) {
    showToast(tr('landing.error.invalid'), 'error');
    if (input) input.focus();
    return;
  }

  pendingLandingLink = value;
  showToast(tr('landing.info.loginToConvert'), 'info');
  openAuthModal(false);
};

// Sau khi đăng nhập, tự chuyển sang trang Tạo đơn với link người dùng đã dán
async function handlePendingLandingLink() {
  if (!pendingLandingLink) return;

  const link = pendingLandingLink;
  pendingLandingLink = null;

  await navigateTo('create-order');

  const input = document.getElementById('link-input');
  if (input) {
    input.value = link;
    input.focus();
  }
  showToast(tr('landing.info.linkFilled'), 'info');
}

// Modal hướng dẫn ở trang chủ — nạp chung nội dung với trang Trợ giúp
window.openGuideModal = async function() {
  const modal = document.getElementById('guide-modal');
  const content = document.getElementById('guide-modal-content');
  const body = document.getElementById('guide-modal-body');
  if (!modal || !content || !body) return;

  modal.classList.remove('hidden');
  lockModal(modal);

  setTimeout(() => {
    modal.classList.remove('opacity-0');
    content.classList.remove('scale-95');
  }, 10);

  focusInModal(modal, '[data-action="close-guide"]');

  if (body.dataset.loaded === '1') return;

  const loadErrorHtml = '<div class="p-8 text-sm text-slate-500" data-i18n="guide.loadError">Không tải được nội dung hướng dẫn.</div>';
  try {
    const res = await fetch('components/guide.html');
    body.innerHTML = res.ok ? await res.text() : loadErrorHtml;
    body.dataset.loaded = '1';
  } catch (err) {
    body.innerHTML = loadErrorHtml;
  }

  if (window.GZ_I18N) window.GZ_I18N.applyTranslations(body);
  applySupportContact(body);
  if (typeof lucide !== 'undefined') lucide.createIcons();
};

window.closeGuideModal = function() {
  const modal = document.getElementById('guide-modal');
  const content = document.getElementById('guide-modal-content');
  if (!modal || !content) return;

  modal.classList.add('opacity-0');
  content.classList.add('scale-95');

  setTimeout(() => {
    modal.classList.add('hidden');
    unlockModal(modal);
  }, 300);
};

/* ==========================================
   Bộ điều phối hành động giao diện

   Trước đây các file HTML dùng onclick="..." / onsubmit="..." (37 chỗ).
   Cách đó buộc CSP phải bật 'unsafe-inline' cho script, làm giảm đáng kể
   khả năng chặn XSS. Nay HTML chỉ khai báo data-action / data-change-action /
   data-submit-action / data-enter-action, còn phần xử lý nằm ở đây.

   Ưu điểm:
   - CSP có thể bỏ 'unsafe-inline' (xem backend/server.js).
   - Component nạp động (innerHTML) vẫn hoạt động vì nghe sự kiện ở document.
   ========================================== */

async function pasteClipboardInto(inputId) {
  const input = document.getElementById(inputId);
  if (!input) return;
  try {
    input.value = await navigator.clipboard.readText();
    input.focus();
  } catch (err) {
    // Trình duyệt chặn clipboard (không phải HTTPS hoặc người dùng từ chối).
    // Giữ nguyên hành vi cũ: không làm gì.
  }
}

const UI_ACTIONS = {
  // Hộp thoại rút tiền
  'close-withdraw-modal': () => closeWithdrawModal(),
  'withdraw-mode': (el) => setWithdrawMode(el.dataset.mode),
  'toggle-other-bank': () => toggleOtherBankInput(),
  'pick-withdraw-qr': () => document.getElementById('withdraw-qr-upload')?.click(),
  'remove-bank-qr': () => removeBankQr(),
  'submit-withdraw': () => submitWithdraw(),
  'cancel-withdrawal': (el) => cancelWithdrawal(el.dataset.id),

  // Tải lại dữ liệu khi mất kết nối
  'retry-dashboard': () => updateDashboardData(),
  'retry-orders': () => updateOrdersData(),
  'retry-wallet': () => updateWalletData(),
  'reload-page': () => window.location.reload(),

  // Đăng nhập / đăng ký / quên mật khẩu
  'open-auth': () => openAuthModal(true),
  'close-auth': () => closeAuthModal(),
  'auth-submit': (el, event) => handleAuthSubmit(event),
  'auth-otp-submit': () => submitAuthOtp(),
  'auth-otp-resend': () => resendAuthOtp(),
  'auth-back': () => backToAuthForm(),
  'forgot-show': () => showForgotPassword(),
  'forgot-submit': () => submitForgotPassword(),
  'forgot-admin-submit': () => submitForgotPasswordAdmin(),
  'forgot-admin-toggle': () => toggleForgotAdmin(),
  'forgot-hide': () => hideForgotPassword(),
  'reset-submit': () => submitPasswordReset(),
  'reset-resend': () => resendResetOtp(),
  'reset-back': () => backToForgotPanel(),
  'auth-toggle': () => toggleAuthMode(),

  // Trang chủ / hướng dẫn
  'open-guide': () => openGuideModal(),
  'close-guide': () => closeGuideModal(),
  'guide-backdrop': (el, event) => {
    if (event.target === el) closeGuideModal();
  },
  'paste-landing-link': () => pasteClipboardInto('landing-link-input'),
  'convert-landing-link': () => convertLandingLink(),

  // Chuyển đổi ngôn ngữ VI / EN
  'toggle-lang-menu': () => window.GZ_I18N && window.GZ_I18N.toggleLangMenu(),
  'set-lang': (el) => window.GZ_I18N && window.GZ_I18N.setLanguage(el.dataset.lang),

  // Chuyển đổi giao diện sáng / tối
  'toggle-theme': () => window.GZ_THEME && window.GZ_THEME.toggle(),

  // Tạo đơn
  'paste-order-link': () => pasteClipboardInto('link-input'),

  // Điều hướng / tài khoản
  logout: () => logoutUser(),
  'navigate-guide': () => navigateTo('guide'),
  'change-password': () => changePassword(),
  'pick-avatar': () => document.getElementById('profile-avatar-upload')?.click(),
  'send-profile-email-otp': () => sendProfileEmailOtp(),
  'save-profile': () => saveProfileData()
};

function runUiAction(el, event) {
  const name =
    el.dataset.action ||
    el.dataset.changeAction ||
    el.dataset.submitAction ||
    el.dataset.enterAction;
  const handler = name ? UI_ACTIONS[name] : null;
  if (!handler) {
    console.warn('[GZ AFL] Hành động giao diện không xác định:', name);
    return;
  }
  handler(el, event);
}

document.addEventListener('click', (event) => {
  const el = event.target instanceof Element ? event.target.closest('[data-action]') : null;
  if (!el) return;
  event.preventDefault();
  runUiAction(el, event);
});

document.addEventListener('change', (event) => {
  const el = event.target instanceof Element ? event.target.closest('[data-change-action]') : null;
  if (!el) return;
  runUiAction(el, event);
});

document.addEventListener('submit', (event) => {
  const el = event.target instanceof Element ? event.target.closest('[data-submit-action]') : null;
  if (!el) return;
  event.preventDefault();
  runUiAction(el, event);
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  const el = event.target instanceof Element ? event.target.closest('[data-enter-action]') : null;
  if (!el) return;
  event.preventDefault();
  runUiAction(el, event);
});
