/* ==========================================
   PHẦN 1: TIỆN ÍCH & XỬ LÝ AUTH (ĐĂNG NHẬP/ĐĂNG KÝ)
========================================== */

let isLoginMode = true;
let currentUser = null;

/* ==========================================
   TIỆN ÍCH DÙNG CHUNG
========================================== */

// Gọi API backend. Tự gửi cookie phiên (credentials: same-origin).
async function api(path, options = {}) {
  const { method = 'GET', body } = options;
  const fetchOptions = { method, credentials: 'same-origin', headers: {} };
  if (body !== undefined) {
    fetchOptions.headers['Content-Type'] = 'application/json';
    fetchOptions.body = JSON.stringify(body);
  }

  const res = await fetch('/api' + path, fetchOptions);
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

// Gán text cho element theo id (bỏ qua nếu không tồn tại)
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.innerText = text;
}

// Định dạng tiền Việt Nam
function formatCurrency(amount) {
  const n = Number(amount) || 0;
  return 'đ' + n.toLocaleString('vi-VN');
}

// Màu badge theo trạng thái đơn hàng / lệnh rút
function statusBadgeClass(status) {
  if (status === 'Hoàn thành' || status === 'Đã thanh toán') {
    return 'bg-emerald-50 text-emerald-600 border-emerald-100';
  }
  if (status === 'Đã huỷ') {
    return 'bg-slate-100 text-slate-500 border-slate-200';
  }
  return 'bg-amber-50 text-amber-600 border-amber-100';
}

// Đọc giá trị hoa hồng (số hoặc chuỗi "đ0") thành số
function parseCommissionValue(value) {
  const n = parseInt(String(value == null ? '' : value).replace(/[^0-9-]/g, ''), 10);
  return isNaN(n) ? 0 : n;
}

// Thông báo toast thay cho alert()
function showToast(message, type = 'info') {
  let host = document.getElementById('toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toast-host';
    host.className = 'fixed top-5 right-5 z-[200] flex flex-col gap-3 pointer-events-none px-2';
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


async function loadComponent(elementId, filePath) {
  try {
    const response = await fetch(filePath);
    if (!response.ok) throw new Error('Không thể tải file ' + filePath);

    const html = await response.text();
    document.getElementById(elementId).innerHTML = html;

    if (typeof lucide !== 'undefined') lucide.createIcons();

    // Nạp dữ liệu động tuỳ theo trang
    if (filePath.includes('dashboard-content.html')) updateDashboardData();
    else if (filePath.includes('wallet.html')) updateWalletData();
    else if (filePath.includes('orders.html')) updateOrdersData();
    else if (filePath.includes('referral.html')) initReferralPage();
    else if (filePath.includes('notifications.html')) updateNotificationsData();
  } catch (error) {
    console.error('Lỗi khi tải component:', error);
  }
}

async function checkAuth() {
  const appRoot = document.getElementById('app-root');
  const landingRoot = document.getElementById('landing-root');

  let user = null;
  try {
    const data = await api('/auth/me');
    user = data.user || null;
  } catch (err) {
    user = null;
  }
  currentUser = user;

  if (user) {
    landingRoot.classList.add('hidden');
    appRoot.classList.remove('hidden');

    await loadComponent('sidebar-container', 'components/sidebar.html');
    await loadComponent('header-container', 'components/header.html');
    await loadComponent('main-content-container', 'components/dashboard-content.html');

    setHeaderTitle('Tổng quan');
    updateActiveMenu('dashboard');
    renderHeaderUser(user);
    applyAdminVisibility(user);

    // Nếu người dùng vừa dán link ở trang chủ rồi mới đăng nhập,
    // đưa họ thẳng tới trang Tạo đơn với link đã điền sẵn.
    await handlePendingLandingLink();
  } else {
    appRoot.classList.add('hidden');
    landingRoot.classList.remove('hidden');
    await loadComponent('landing-root', 'components/landing.html');
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
  updateAuthUI();

  const modal = document.getElementById('auth-modal');
  const content = document.getElementById('auth-modal-content');
  if (!modal || !content) return;

  modal.classList.remove('hidden');

  setTimeout(() => {
    modal.classList.remove('opacity-0');
    content.classList.remove('scale-95');
  }, 10);
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
  }, 300);
};

window.toggleAuthMode = function() {
  isLoginMode = !isLoginMode;
  const errorBox = document.getElementById('auth-error');
  if (errorBox) errorBox.classList.add('hidden');
  updateAuthUI();
};

function updateAuthUI() {
  const title = document.getElementById('auth-title');
  const subtitle = document.getElementById('auth-subtitle');
  const nameGroup = document.getElementById('auth-name-group');
  const confirmGroup = document.getElementById('auth-confirm-group');
  const submitBtn = document.getElementById('auth-submit-btn');
  const toggleText = document.getElementById('auth-toggle-text');
  const toggleBtn = document.getElementById('auth-toggle-btn');
  if (!title || !subtitle || !nameGroup || !submitBtn) return;

  if (isLoginMode) {
    title.innerText = 'Đăng nhập';
    subtitle.innerText = 'Vui lòng đăng nhập để theo dõi và nhận hoa hồng.';
    nameGroup.classList.add('hidden');
    if (confirmGroup) confirmGroup.classList.add('hidden');
    submitBtn.innerHTML = `<span>Đăng nhập</span> <i data-lucide="arrow-right" class="w-4 h-4 inline-block"></i>`;
    toggleText.innerText = 'Chưa có tài khoản?';
    toggleBtn.innerText = 'Đăng ký ngay';
  } else {
    title.innerText = 'Đăng ký tài khoản';
    subtitle.innerText = 'Tạo tài khoản mới bằng Email hoặc Số điện thoại.';
    nameGroup.classList.remove('hidden');
    if (confirmGroup) confirmGroup.classList.remove('hidden');
    submitBtn.innerHTML = `<span>Tạo tài khoản</span> <i data-lucide="arrow-right" class="w-4 h-4 inline-block"></i>`;
    toggleText.innerText = 'Đã có tài khoản?';
    toggleBtn.innerText = 'Đăng nhập ngay';
  }
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

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

  if (!usernameInput || !passwordInput) {
    return showAuthMessage('Vui lòng điền đầy đủ thông tin.');
  }
  if (!validateUsername(usernameInput)) {
    return showAuthMessage('Định dạng không hợp lệ. Vui lòng nhập đúng Email hoặc Số điện thoại.');
  }
  if (!isLoginMode) {
    if (!nameInput) return showAuthMessage('Vui lòng nhập tên hiển thị.');
    if (passwordInput.length < 6) return showAuthMessage('Mật khẩu phải có ít nhất 6 ký tự.');
    const confirmEl = document.getElementById('auth-confirm-password');
    const confirmInput = confirmEl ? confirmEl.value.trim() : '';
    if (confirmInput !== passwordInput) return showAuthMessage('Mật khẩu xác nhận không khớp.');
  }

  const submitBtn = document.getElementById('auth-submit-btn');
  const originalHTML = submitBtn ? submitBtn.innerHTML : '';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.classList.add('opacity-70');
    submitBtn.innerText = 'Đang xử lý...';
  }

  try {
    if (isLoginMode) {
      const data = await api('/auth/login', {
        method: 'POST',
        body: { username: usernameInput, password: passwordInput }
      });
      currentUser = data.user || null;
      closeAuthModal();
      await checkAuth();
    } else {
      await api('/auth/register', {
        method: 'POST',
        body: { username: usernameInput, password: passwordInput, name: nameInput }
      });
      toggleAuthMode();
      passwordEl.value = '';
      showAuthMessage('Tạo tài khoản thành công! Vui lòng đăng nhập lại.', true);
    }
  } catch (err) {
    showAuthMessage(err.message);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.classList.remove('opacity-70');
      if (isLoginMode) {
        updateAuthUI();
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

async function navigateTo(page) {
  const route = PAGE_ROUTES[page];
  if (!route) return;

  // Chặn xem trước ở phía giao diện (server vẫn là nơi quyết định thật)
  if (page === 'admin' && (!currentUser || currentUser.role !== 'admin')) {
    showToast('Bạn không có quyền truy cập trang quản trị.', 'error');
    return;
  }

  await loadComponent('main-content-container', route.file);
  setHeaderTitle(route.title);
  updateActiveMenu(page);

  if (page === 'profile') initProfilePage();

  if (page === 'admin') {
    try {
      await ensureAdminScript();
      if (typeof window.initAdminPage === 'function') window.initAdminPage();
    } catch (err) {
      showToast('Không tải được trang quản trị. Vui lòng thử lại.', 'error');
    }
  }
}

document.addEventListener('click', async function(event) {
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

  // 3. Copy link hoàn tiền (trang Đơn hàng)
  const copyLinkBtn = event.target.closest('[data-action="copy-link"]');
  if (copyLinkBtn) {
    event.preventDefault();
    copyTextToClipboard(copyLinkBtn.dataset.link || '').then((ok) => {
      showToast(
        ok ? 'Đã copy link hoàn tiền.' : 'Không copy được. Hãy bôi đen link và copy thủ công.',
        ok ? 'success' : 'error'
      );
    });
    return;
  }

  // 4. Điều hướng (menu, logo, nút cùng trang) — đánh dấu bằng data-page
  const navEl = event.target.closest('[data-page]');
  if (navEl) {
    event.preventDefault();
    navigateTo(navEl.dataset.page);
  }
});

function updateActiveMenu(page) {
  const allLinks = document.querySelectorAll('#sidebar-container nav a[data-page]');
  allLinks.forEach(link => {
    const isActive = link.dataset.page === page;
    link.className = isActive
      ? 'flex items-center gap-4 px-3 py-3 bg-[#18253f] text-white rounded-xl font-medium text-sm shadow-sm overflow-hidden'
      : 'flex items-center gap-4 px-3 py-3 text-slate-500 hover:bg-slate-50 hover:text-slate-800 rounded-xl font-medium text-sm transition-colors overflow-hidden';
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
  if (!(shopeeRegex.test(singleLink) || tiktokRegex.test(singleLink) || lazadaRegex.test(singleLink))) {
    showError('Phát hiện link không hợp lệ! Vui lòng chỉ nhập link Shopee, TikTok hoặc Lazada.');
    return;
  }

  const originalHTML = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<i data-lucide="loader-2" class="w-5 h-5 text-white animate-spin"></i> <span>Đang tạo link...</span>`;
  if (typeof lucide !== 'undefined') lucide.createIcons();

  try {
    const data = await api('/orders', { method: 'POST', body: { link: singleLink } });
    showToast('Tạo link hoàn tiền thành công! Đơn hàng đã được ghi nhận.', 'success');
    inputElement.value = '';
    renderLinkResult(data.order, data.affiliate);
    if (document.getElementById('dash-recent-orders')) updateDashboardData();
  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHTML;
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }
});

// Hiển thị link hoàn tiền vừa tạo kèm nút Copy và Mua ngay
function renderLinkResult(order, affiliate) {
  const box = document.getElementById('link-result');
  if (!box || !order) return;

  const link = order.affiliateLink || order.link;
  const isReal = !!(affiliate && affiliate.isReal);

  setText('link-result-code', order.id);

  const urlInput = document.getElementById('link-result-url');
  if (urlInput) urlInput.value = link;

  const openLink = document.getElementById('link-result-open');
  if (openLink) openLink.href = link;

  const note = document.getElementById('link-result-note');
  if (note) {
    note.innerText = isReal
      ? 'Link hoàn tiền đã sẵn sàng. Hãy mua hàng qua đúng link này để đơn được ghi nhận.'
      : 'Hệ thống chưa kết nối API của sàn nên chưa ghi nhận hoa hồng tự động. Bạn vẫn mua hàng bình thường, quản trị viên sẽ chốt hoa hồng cho đơn này.';
  }

  const copyBtn = document.getElementById('btn-copy-affiliate');
  if (copyBtn) {
    copyBtn.onclick = () => {
      copyTextToClipboard(link).then((ok) => {
        showToast(
          ok ? 'Đã copy link hoàn tiền.' : 'Không copy được. Hãy bôi đen link và copy thủ công.',
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
    return data.orders || [];
  } catch (err) {
    return [];
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

async function updateDashboardData() {
  const orders = await fetchOrders();
  const wallet = await fetchWallet();
  const user = currentUser;
  const total = orders.length;
  const pending = orders.filter(o => o.status === 'Đang xử lý').length;
  const completed = orders.filter(o => o.status === 'Hoàn thành').length;
  // Đơn đã huỷ không được tính vào hoa hồng
  const commission = wallet
    ? Number(wallet.totalCommission) || 0
    : orders.filter(o => o.status !== 'Đã huỷ').reduce((sum, o) => sum + parseCommissionValue(o.commission), 0);
  const balance = wallet ? Number(wallet.balance) || 0 : commission;

  setText('dashboard-username', (user && user.name) ? user.name : 'bạn');
  setText('dash-commission', formatCurrency(commission));
  setText('dash-completed-note', completed + ' đơn hoàn thành');
  setText('dash-order-count', total);
  setText('dash-pending-note', pending > 0 ? (pending + ' đơn đang chờ') : 'Không có đơn chờ');
  setText('dash-balance', formatCurrency(balance));
  setText('dash-total-commission', formatCurrency(commission));
  setText('dash-total-note', total + ' đơn tất cả');
  setText('dash-card-balance', formatCurrency(balance));
  setHeaderBalance(balance);

  renderDashboardRecentOrders(orders);
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
    return;
  }

  setText('stat-total-orders', data.stats.total);
  setText('stat-pending-orders', data.stats.pending);
  setText('stat-completed-orders', data.stats.completed);
  setText('stat-paid-orders', data.stats.paid);
  setText('wallet-balance', formatCurrency(data.balance));
  setHeaderBalance(data.balance);

  renderWithdrawHistory(data.withdrawals || []);
}

function renderWithdrawHistory(list = []) {
  const container = document.getElementById('tx-container');
  const countEl = document.getElementById('tx-count');
  if (!container) return;

  if (countEl) countEl.innerText = list.length + ' giao dịch';

  if (list.length === 0) {
    container.innerHTML = `
      <div class="py-12 flex flex-col items-center justify-center text-center">
        <div class="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-5 shadow-inner border border-slate-100">
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
      html += `
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl border border-slate-100 bg-slate-50/50">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-blue-50 text-blue-500 flex items-center justify-center flex-shrink-0">
              <i data-lucide="landmark" class="w-5 h-5"></i>
            </div>
            <div>
              <div class="font-bold text-slate-800 text-sm">${escapeHtml(tx.bank)} ****${escapeHtml(String(tx.accNum || '').slice(-4))}</div>
              <div class="text-xs text-slate-400 mt-0.5">${escapeHtml((tx.accName || '').toUpperCase())} • ${escapeHtml(tx.date)}</div>
            </div>
          </div>
          <div class="flex items-center gap-3 self-start sm:self-center">
            ${tx.amount > 0 ? `<span class="text-sm font-bold text-slate-800">${formatCurrency(tx.amount)}</span>` : ''}
            <span class="text-xs font-bold px-3 py-1.5 rounded-full border ${statusBadgeClass(tx.status)}">${escapeHtml(tx.status)}</span>
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

  if (orders.length === 0) {
    if (badge) badge.classList.add('hidden');
    area.innerHTML = `
      <div class="bg-white p-12 rounded-3xl border border-slate-100 shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex flex-col items-center justify-center text-center min-h-[400px]">
        <div class="w-24 h-24 bg-slate-50 rounded-full flex items-center justify-center mb-6 shadow-inner border border-slate-100">
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
      const hasTrackedLink = !!(order.affiliateLink && order.affiliateLink !== order.link);
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
                  ${order.clicks > 0 ? `<span class="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">${Number(order.clicks) || 0} lượt bấm</span>` : ''}
                </div>
                <a href="${escapeHtml(order.link)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(order.link)}" class="text-xs text-slate-400 hover:text-red-500 mt-1 block truncate max-w-md transition">${escapeHtml(order.link)}</a>
                <div class="text-xs font-semibold text-slate-500 mt-2">Ngày tạo: ${escapeHtml(order.date)}</div>
              </div>
            </div>
            <div class="flex items-center gap-3 self-end sm:self-start flex-shrink-0">
              <span class="text-sm font-bold text-slate-800">${formatCurrency(order.commission)}</span>
              <span class="px-3 py-1 border rounded-full text-xs font-bold ${statusBadgeClass(order.status)}">${escapeHtml(order.status)}</span>
            </div>
          </div>
          ${hasTrackedLink ? `
          <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-4 border-t border-slate-50">
            <span class="flex items-center gap-1.5 text-[11px] font-bold text-emerald-600 uppercase tracking-wider flex-shrink-0">
              <i data-lucide="link-2" class="w-3.5 h-3.5"></i> Link hoàn tiền
            </span>
            <input readonly value="${escapeHtml(order.affiliateLink)}" class="flex-1 min-w-0 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2 text-xs text-slate-600 focus:outline-none">
            <button data-action="copy-link" data-link="${escapeHtml(order.affiliateLink)}" class="flex items-center justify-center gap-1.5 px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl font-bold text-xs transition whitespace-nowrap">
              <i data-lucide="copy" class="w-3.5 h-3.5"></i> Copy
            </button>
            <a href="${escapeHtml(order.affiliateLink)}" target="_blank" rel="noopener noreferrer" class="flex items-center justify-center gap-1.5 px-3 py-2 bg-[#f04d4d] hover:bg-red-600 text-white rounded-xl font-bold text-xs transition whitespace-nowrap">
              <i data-lucide="external-link" class="w-3.5 h-3.5"></i> Mua ngay
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

let referralState = { code: '', points: 0, redeemedCount: 0, history: [] };

function renderRedeemHistory() {
  const area = document.getElementById('redeem-history-area');
  if (!area) return;
  const history = referralState.history || [];

  if (history.length === 0) {
    area.innerHTML = `
      <div class="flex flex-col items-center justify-center text-center py-10">
        <div class="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4 shadow-inner border border-slate-100">
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
  renderRedeemHistory();

  const btnCopy = document.getElementById('btn-copy-code');
  if (btnCopy) {
    btnCopy.onclick = () => {
      copyTextToClipboard(referralState.code).then((ok) => {
        const original = btnCopy.innerHTML;
        if (ok) {
          btnCopy.innerHTML = `<i data-lucide="check" class="w-4 h-4"></i><span>Đã copy!</span>`;
        } else {
          btnCopy.innerHTML = `<i data-lucide="x" class="w-4 h-4"></i><span>Copy thất bại</span>`;
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
        refreshReferralStats();
        renderRedeemHistory();
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
  if (!nameEl || !ownerEl) return;

  if (bank && bank.accNum) {
    const last4 = String(bank.accNum).slice(-4);
    nameEl.innerText = bank.bank + ' ****' + last4;
    ownerEl.innerText = (bank.accName || '').toUpperCase();
    if (badgeEl) badgeEl.classList.remove('hidden');
  } else {
    nameEl.innerText = 'Chưa liên kết';
    ownerEl.innerText = 'Thêm tài khoản khi rút tiền';
    if (badgeEl) badgeEl.classList.add('hidden');
  }
}

function renderProfileZalo(zalo) {
  const idEl = document.getElementById('profile-zalo-id');
  const badgeEl = document.getElementById('profile-zalo-badge');
  if (!idEl) return;

  const connected = !!(zalo && zalo.id);
  idEl.innerText = connected ? ('ID: ' + zalo.id) : 'Chưa kết nối';

  if (badgeEl) {
    badgeEl.classList.remove('bg-emerald-50', 'text-emerald-500', 'border-emerald-100', 'bg-slate-100', 'text-slate-500', 'border-slate-200');
    if (connected) {
      badgeEl.classList.add('bg-emerald-50', 'text-emerald-500', 'border-emerald-100');
      badgeEl.innerHTML = '<i data-lucide="check-circle-2" class="w-3.5 h-3.5"></i> Đã kết nối';
    } else {
      badgeEl.classList.add('bg-slate-100', 'text-slate-500', 'border-slate-200');
      badgeEl.innerText = 'Chưa kết nối';
    }
    if (typeof lucide !== 'undefined') lucide.createIcons();
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

  // 3b. Tài khoản nhận tiền & liên kết
  renderProfileBank(user.bank);
  renderProfileZalo(user.zalo);

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

  try {
    const data = await api('/profile', {
      method: 'PUT',
      body: { name: nameValue, email: emailValue, phone: phoneValue }
    });
    currentUser = data.user || currentUser;
    renderHeaderUser(currentUser);

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
  if (newPassword.length < 6) {
    showToast('Mật khẩu mới phải có ít nhất 6 ký tự.', 'error');
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
window.openWithdrawModal = async function() {
  const modal = document.getElementById('withdraw-modal');
  const content = document.getElementById('withdraw-modal-content');
  if (!modal || !content) return;

  // Điền sẵn thông tin nhận tiền đã lưu (nếu có)
  if (currentUser && currentUser.bank) {
    const bankEl = document.getElementById('withdraw-bank');
    const numEl = document.getElementById('withdraw-acc-number');
    const nameEl = document.getElementById('withdraw-acc-name');
    if (bankEl && currentUser.bank.bank) bankEl.value = currentUser.bank.bank;
    if (numEl && currentUser.bank.accNum) numEl.value = currentUser.bank.accNum;
    if (nameEl && currentUser.bank.accName) nameEl.value = currentUser.bank.accName;
  }

  modal.classList.remove('hidden');

  setTimeout(() => {
    modal.classList.remove('opacity-0');
    content.classList.remove('scale-95');
  }, 10);

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

  availableEl.innerText = formatCurrency(balance);

  if (balance < min) {
    noteEl.innerText =
      'Mức rút tối thiểu là ' + formatCurrency(min) + '. ' +
      (balance > 0
        ? 'Bạn còn thiếu ' + formatCurrency(min - balance) + '.'
        : 'Bạn chưa có hoa hồng khả dụng để rút.');
    btn.disabled = true;
    btn.title = 'Số dư chưa đủ để rút';
  } else {
    noteEl.innerText =
      'Hệ thống sẽ rút toàn bộ ' + formatCurrency(balance) + ' đang có. ' +
      'Mức tối thiểu: ' + formatCurrency(min) + '.';
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

  setTimeout(() => modal.classList.add('hidden'), 300);
};

window.submitWithdraw = async function() {
  const bankEl = document.getElementById('withdraw-bank');
  const numEl = document.getElementById('withdraw-acc-number');
  const nameEl = document.getElementById('withdraw-acc-name');
  const btn = document.getElementById('withdraw-submit-btn');
  if (!bankEl || !numEl || !nameEl) return;

  const bank = bankEl.value;
  const accNum = numEl.value.trim();
  const accName = nameEl.value.trim();

  if (!bank || !accNum || !accName) {
    showToast('Vui lòng điền đầy đủ thông tin nhận tiền!', 'error');
    return;
  }
  if (!/^[0-9]{6,20}$/.test(accNum)) {
    showToast('Số tài khoản/số điện thoại ví phải là 6-20 chữ số.', 'error');
    return;
  }

  const originalHTML = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Đang gửi...';
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  try {
    const data = await api('/wallet/withdrawals', {
      method: 'POST',
      body: { bank, accNum, accName }
    });

    currentUser = data.user || currentUser;
    renderProfileBank(currentUser && currentUser.bank);

    if (document.getElementById('tx-container')) {
      await updateWalletData();
    } else if (document.getElementById('dash-recent-orders')) {
      await updateDashboardData();
    }

    const amount = (data.withdrawal && data.withdrawal.amount) || 0;
    showToast(
      `✅ Đã gửi yêu cầu rút ${formatCurrency(amount)}!\nNgân hàng: ${bank}\nSTK: ${accNum}\nTên: ${accName.toUpperCase()}`,
      'success'
    );
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
        <div class="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-5 shadow-inner border border-slate-100">
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

const LANDING_LINK_REGEX = /(shopee\.vn|shp\.ee|tiktok\.com|vt\.tiktok\.com|lazada\.vn|c\.lazada\.vn)/i;

window.convertLandingLink = function() {
  const input = document.getElementById('landing-link-input');
  const value = input ? input.value.trim() : '';

  if (!value) {
    showToast('Vui lòng dán link sản phẩm trước khi chuyển đổi.', 'error');
    if (input) input.focus();
    return;
  }
  if (!LANDING_LINK_REGEX.test(value)) {
    showToast('Link không hợp lệ. Vui lòng dán link Shopee, TikTok hoặc Lazada.', 'error');
    if (input) input.focus();
    return;
  }

  pendingLandingLink = value;
  showToast('Đăng nhập để tạo link hoàn tiền cho sản phẩm này.', 'info');
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
  showToast('Đã điền sẵn link của bạn. Bấm "Tạo link" để tiếp tục.', 'info');
}

// Modal hướng dẫn ở trang chủ — nạp chung nội dung với trang Trợ giúp
window.openGuideModal = async function() {
  const modal = document.getElementById('guide-modal');
  const content = document.getElementById('guide-modal-content');
  const body = document.getElementById('guide-modal-body');
  if (!modal || !content || !body) return;

  modal.classList.remove('hidden');

  setTimeout(() => {
    modal.classList.remove('opacity-0');
    content.classList.remove('scale-95');
  }, 10);

  if (body.dataset.loaded === '1') return;

  try {
    const res = await fetch('components/guide.html');
    body.innerHTML = res.ok
      ? await res.text()
      : '<div class="p-8 text-sm text-slate-500">Không tải được nội dung hướng dẫn.</div>';
    body.dataset.loaded = '1';
  } catch (err) {
    body.innerHTML = '<div class="p-8 text-sm text-slate-500">Không tải được nội dung hướng dẫn.</div>';
  }

  if (typeof lucide !== 'undefined') lucide.createIcons();
};

window.closeGuideModal = function() {
  const modal = document.getElementById('guide-modal');
  const content = document.getElementById('guide-modal-content');
  if (!modal || !content) return;

  modal.classList.add('opacity-0');
  content.classList.add('scale-95');

  setTimeout(() => modal.classList.add('hidden'), 300);
};
