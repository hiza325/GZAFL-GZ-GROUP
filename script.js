/* ==========================================
   PHẦN 1: TẢI GIAO DIỆN & XỬ LÝ AUTH (ĐĂNG NHẬP/ĐĂNG KÝ)
========================================== */

let isLoginMode = true; 

async function loadComponent(elementId, filePath) {
  try {
    const response = await fetch(filePath);
    if (!response.ok) throw new Error('Không thể tải file ' + filePath);
    
    const html = await response.text();
    document.getElementById(elementId).innerHTML = html;
    
    if (typeof lucide !== 'undefined') lucide.createIcons();
    
    // Nạp dữ liệu động tuỳ theo trang
    if (filePath.includes('wallet.html')) updateWalletData();
    else if (filePath.includes('orders.html')) updateOrdersData();
    else if (filePath.includes('referral.html')) initReferralPage();
  } catch (error) {
    console.error('Lỗi khi tải component:', error);
  }
}

async function checkAuth() {
  const isLoggedIn = localStorage.getItem('isLoggedIn') === 'true';
  const appRoot = document.getElementById('app-root');
  const landingRoot = document.getElementById('landing-root');
  
  if (isLoggedIn) {
    landingRoot.classList.add('hidden');
    appRoot.classList.remove('hidden');
    
    await loadComponent('sidebar-container', 'components/sidebar.html');
    await loadComponent('header-container', 'components/header.html');
    await loadComponent('main-content-container', 'components/dashboard-content.html');
    
    const currentUser = JSON.parse(localStorage.getItem('currentUser'));
    if(currentUser) {
      const nameElement = document.getElementById('header-username');
      const avatarElement = document.getElementById('header-avatar');
      
      if(nameElement && avatarElement) {
        nameElement.innerText = currentUser.name || "Khách";
        
        // Kiểm tra xem user có avatar upload chưa
        if(currentUser.avatar) {
          avatarElement.innerHTML = `<img src="${currentUser.avatar}" class="w-full h-full object-cover rounded-full" />`;
        } else {
          const initials = (currentUser.name || "KH").substring(0, 2).toUpperCase();
          avatarElement.innerText = initials;
        }
      }
    }
  } else {
    appRoot.classList.add('hidden');
    landingRoot.classList.remove('hidden');
    await loadComponent('landing-root', 'components/landing.html');
  }
}

window.logoutUser = function() {
  localStorage.setItem('isLoggedIn', 'false');
  localStorage.removeItem('currentUser');
  checkAuth();
};

document.addEventListener("DOMContentLoaded", () => {
  checkAuth();
});

window.openAuthModal = function(loginMode = true) {
  isLoginMode = loginMode;
  updateAuthUI();
  
  const modal = document.getElementById('auth-modal');
  const content = document.getElementById('auth-modal-content');
  modal.classList.remove('hidden');
  
  setTimeout(() => {
    modal.classList.remove('opacity-0');
    content.classList.remove('scale-95');
  }, 10);
};

window.closeAuthModal = function() {
  const modal = document.getElementById('auth-modal');
  const content = document.getElementById('auth-modal-content');
  
  modal.classList.add('opacity-0');
  content.classList.add('scale-95');
  
  setTimeout(() => {
    modal.classList.add('hidden');
    document.getElementById('auth-form').reset();
    document.getElementById('auth-error').classList.add('hidden');
  }, 300);
};

window.toggleAuthMode = function() {
  isLoginMode = !isLoginMode;
  document.getElementById('auth-error').classList.add('hidden');
  updateAuthUI();
};

function updateAuthUI() {
  const title = document.getElementById('auth-title');
  const subtitle = document.getElementById('auth-subtitle');
  const nameGroup = document.getElementById('auth-name-group');
  const submitBtn = document.getElementById('auth-submit-btn');
  const toggleText = document.getElementById('auth-toggle-text');
  const toggleBtn = document.getElementById('auth-toggle-btn');
  
  if (isLoginMode) {
    title.innerText = "Đăng nhập";
    subtitle.innerText = "Vui lòng đăng nhập để theo dõi và nhận hoa hồng.";
    nameGroup.classList.add('hidden');
    submitBtn.innerHTML = `<span>Đăng nhập</span> <i data-lucide="arrow-right" class="w-4 h-4 inline-block"></i>`;
    toggleText.innerText = "Chưa có tài khoản?";
    toggleBtn.innerText = "Đăng ký ngay";
  } else {
    title.innerText = "Đăng ký tài khoản";
    subtitle.innerText = "Tạo tài khoản mới bằng Email hoặc Số điện thoại.";
    nameGroup.classList.remove('hidden');
    submitBtn.innerHTML = `<span>Tạo tài khoản</span> <i data-lucide="arrow-right" class="w-4 h-4 inline-block"></i>`;
    toggleText.innerText = "Đã có tài khoản?";
    toggleBtn.innerText = "Đăng nhập ngay";
  }
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function validateUsername(input) {
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input);
  const isPhone = /^(84|0[3|5|7|8|9])+([0-9]{8})\b$/.test(input);
  return isEmail || isPhone;
}

function showAuthMessage(message, isSuccess = false) {
  const errorBox = document.getElementById('auth-error');
  const icon = document.getElementById('auth-error-icon');
  
  document.getElementById('auth-error-text').innerText = message;
  errorBox.classList.remove('hidden');

  if(isSuccess) {
    errorBox.classList.remove('bg-red-50', 'text-red-500', 'border-red-100');
    errorBox.classList.add('bg-emerald-50', 'text-emerald-600', 'border-emerald-100');
    icon.setAttribute('data-lucide', 'check-circle-2');
  } else {
    errorBox.classList.remove('bg-emerald-50', 'text-emerald-600', 'border-emerald-100');
    errorBox.classList.add('bg-red-50', 'text-red-500', 'border-red-100');
    icon.setAttribute('data-lucide', 'alert-circle');
  }
  lucide.createIcons();
}

window.handleAuthSubmit = function(event) {
  event.preventDefault(); 
  document.getElementById('auth-error').classList.add('hidden');
  
  const usernameInput = document.getElementById('auth-username').value.trim();
  const passwordInput = document.getElementById('auth-password').value.trim();
  const nameInput = document.getElementById('auth-name').value.trim();

  if(!usernameInput || !passwordInput) {
    return showAuthMessage("Vui lòng điền đầy đủ thông tin.");
  }

  if (!validateUsername(usernameInput)) {
    return showAuthMessage("Định dạng không hợp lệ. Vui lòng nhập đúng Email hoặc Số điện thoại.");
  }

  let usersDB = JSON.parse(localStorage.getItem('gz_users')) || [];

  if (isLoginMode) {
    const user = usersDB.find(u => u.username === usernameInput);
    
    if (!user) {
      return showAuthMessage("Tài khoản này chưa được đăng ký.");
    }
    if (user.password !== passwordInput) {
      return showAuthMessage("Mật khẩu không chính xác.");
    }

    localStorage.setItem('isLoggedIn', 'true');
    localStorage.setItem('currentUser', JSON.stringify(user));
    closeAuthModal();
    checkAuth(); 

  } else {
    if(!nameInput) return showAuthMessage("Vui lòng nhập tên hiển thị.");
    if(passwordInput.length < 6) return showAuthMessage("Mật khẩu phải có ít nhất 6 ký tự.");

    const isExist = usersDB.some(u => u.username === usernameInput);
    if (isExist) {
      return showAuthMessage("Email hoặc Số điện thoại này đã được đăng ký.");
    }

    const newUser = {
      username: usernameInput,
      password: passwordInput,
      name: nameInput
    };
    usersDB.push(newUser);
    localStorage.setItem('gz_users', JSON.stringify(usersDB));

    toggleAuthMode();
    document.getElementById('auth-password').value = "";
    showAuthMessage("Tạo tài khoản thành công! Vui lòng đăng nhập lại.", true);
  }
};


/* ==========================================
   PHẦN 2: XỬ LÝ CHUYỂN TRANG (NAVIGATION) VÀ SỰ KIỆN RÚT TIỀN
========================================== */

document.addEventListener('click', function(event) {
  
  // 1. Chặn bắt nút Rút tiền ở BẤT CỨ ĐÂU
  const btnWithdraw = event.target.closest('button');
  if (btnWithdraw && (btnWithdraw.innerText.toLowerCase().includes('rút tiền'))) {
    event.preventDefault();
    openWithdrawModal(); // Gọi Modal Rút tiền
    return;
  }

  // 2. Click Logo
  const logoBtn = event.target.closest('#logo-home-btn');
  if (logoBtn) {
    event.preventDefault();
    loadComponent('main-content-container', 'components/dashboard-content.html');
    const sidebarLinks = document.querySelectorAll('#sidebar-container nav a');
    sidebarLinks.forEach(link => { if(link.innerText.trim() === 'Tổng quan') updateActiveMenu(link); });
    return;
  }

  // 3. Click Sidebar
  const targetLink = event.target.closest('a');
  if (targetLink && targetLink.closest('#sidebar-container')) {
    const linkText = targetLink.innerText.trim();
    if (linkText === 'Tổng quan') {
      event.preventDefault();
      loadComponent('main-content-container', 'components/dashboard-content.html');
      updateActiveMenu(targetLink);
    } else if (linkText === 'Tạo đơn hàng') {
      event.preventDefault();
      loadComponent('main-content-container', 'components/create-order.html');
      updateActiveMenu(targetLink);
    } else if (linkText === 'Thông báo') {
      event.preventDefault();
      loadComponent('main-content-container', 'components/notifications.html');
      updateActiveMenu(targetLink);
    } else if (linkText === 'Đơn hàng đã đặt') {
      event.preventDefault();
      loadComponent('main-content-container', 'components/orders.html');
      updateActiveMenu(targetLink);
    } else if (linkText === 'Ví hoàn tiền') {
      event.preventDefault();
      loadComponent('main-content-container', 'components/wallet.html');
      updateActiveMenu(targetLink);
    } else if (linkText === 'Mời bạn bè') {
      event.preventDefault();
      loadComponent('main-content-container', 'components/referral.html');
      updateActiveMenu(targetLink);
    } else if (linkText === 'Cá nhân') {
      event.preventDefault();
      loadComponent('main-content-container', 'components/profile.html').then(() => {
        initProfilePage(); 
      });
      updateActiveMenu(targetLink);
    }
  }

  // 4. Click nút Tạo đơn ở trang khác
  const btnCreate = event.target.closest('button');
  if (btnCreate && (btnCreate.innerText.includes('Tạo đơn hàng') || btnCreate.id === 'btn-go-to-create')) {
    loadComponent('main-content-container', 'components/create-order.html');
    const sidebarLinks = document.querySelectorAll('#sidebar-container nav a');
    sidebarLinks.forEach(link => { if(link.innerText.trim() === 'Tạo đơn hàng') updateActiveMenu(link); });
  }
});

function updateActiveMenu(activeElement) {
  const allLinks = document.querySelectorAll('#sidebar-container nav a');
  allLinks.forEach(link => {
    link.className = "flex items-center gap-4 px-3 py-3 text-slate-500 hover:bg-slate-50 hover:text-slate-800 rounded-xl font-medium text-sm transition-colors overflow-hidden";
  });
  activeElement.className = "flex items-center gap-4 px-3 py-3 bg-[#18253f] text-white rounded-xl font-medium text-sm shadow-sm overflow-hidden";
}


/* ==========================================
   PHẦN 3: XỬ LÝ TẠO ĐƠN & LƯU TRỮ VÀO LOCALSTORAGE
========================================== */

document.addEventListener('click', function(event) {
  if (event.target.closest('#btn-create-link')) {
    const inputElement = document.getElementById('link-input');
    const errorBox = document.getElementById('link-error');
    if (!inputElement) return; 
    
    const inputValue = inputElement.value.trim(); 
    const shopeeRegex = /(shopee\.vn|shp\.ee)/i;
    const tiktokRegex = /(tiktok\.com|vt\.tiktok\.com)/i;
    const lazadaRegex = /(lazada\.vn|c\.lazada\.vn)/i;

    errorBox.classList.add('hidden');
    inputElement.classList.remove('border-red-500', 'bg-red-50/50');
    
    if (inputValue === "") {
      showError("Vui lòng dán link sản phẩm trước khi tiếp tục.");
      return;
    }

    const links = inputValue.split('\n').filter(link => link.trim() !== '');
    if (links.length > 1) {
      showError("Chỉ cho phép nhập đúng 1 link. Vui lòng không nhập nhiều link cùng lúc!");
      return;
    }

    const singleLink = links[0];
    if (shopeeRegex.test(singleLink) || tiktokRegex.test(singleLink) || lazadaRegex.test(singleLink)) {
      const btn = event.target.closest('#btn-create-link');
      const originalHTML = btn.innerHTML;
      btn.innerHTML = `<i data-lucide="loader-2" class="w-5 h-5 text-white animate-spin"></i> <span>Đang tạo link...</span>`;
      lucide.createIcons();
      
      setTimeout(() => {
        saveNewOrder(singleLink); 
        alert("🎉 Chúc mừng! Tạo link hoàn tiền thành công và đơn hàng đã được ghi nhận vào hệ thống.");
        btn.innerHTML = originalHTML;
        lucide.createIcons();
        inputElement.value = ""; 
      }, 1500);
    } else {
      showError("Phát hiện link không hợp lệ! Vui lòng chỉ nhập link Shopee, TikTok hoặc Lazada.");
    }

    function showError(message) {
      errorBox.querySelector('span').innerText = message;
      errorBox.classList.remove('hidden');
      inputElement.classList.add('border-red-500', 'bg-red-50/50');
      inputElement.focus();
    }
  }
});

function saveNewOrder(linkUrl) {
  let orders = JSON.parse(localStorage.getItem('user_orders')) || [];
  let platform = "Shopee";
  if (/tiktok/i.test(linkUrl)) platform = "TikTok Shop";
  else if (/lazada/i.test(linkUrl)) platform = "Lazada";

  const newOrder = {
    id: "GZ" + Math.floor(100000 + Math.random() * 900000),
    link: linkUrl,
    platform: platform,
    date: new Date().toLocaleDateString('vi-VN'),
    status: "Đang xử lý",
    commission: "đ0"
  };

  orders.unshift(newOrder);
  localStorage.setItem('user_orders', JSON.stringify(orders));
}


/* ==========================================
   PHẦN 4: HIỂN THỊ DỮ LIỆU ĐỘNG CHO TRANG VÍ & ĐƠN HÀNG
========================================== */

function updateWalletData() {
  const orders = JSON.parse(localStorage.getItem('user_orders')) || [];
  const total = orders.length;
  const pending = orders.filter(o => o.status === "Đang xử lý").length;
  const completed = orders.filter(o => o.status === "Hoàn thành").length;
  const paid = orders.filter(o => o.status === "Đã thanh toán").length;

  if (document.getElementById('stat-total-orders')) {
    document.getElementById('stat-total-orders').innerText = total;
    document.getElementById('stat-pending-orders').innerText = pending;
    document.getElementById('stat-completed-orders').innerText = completed;
    document.getElementById('stat-paid-orders').innerText = paid;
  }
}

function updateOrdersData() {
  const orders = JSON.parse(localStorage.getItem('user_orders')) || [];
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
        <button id="btn-go-to-create" class="bg-[#f04d4d] hover:bg-red-600 text-white font-medium px-6 py-3 rounded-xl shadow-md transition-all flex items-center gap-2 transform active:scale-[0.98]">
          <i data-lucide="plus" class="w-4 h-4"></i>
          <span>Tạo đơn hàng ngay</span>
        </button>
      </div>
    `;
  } else {
    if (badge) {
      badge.innerText = orders.length + " đơn hàng";
      badge.classList.remove('hidden');
    }
    let htmlList = `<div class="space-y-4">`;
    orders.forEach(order => {
      htmlList += `
        <div class="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div class="flex items-start gap-4">
            <div class="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-xs flex-shrink-0">
              <i data-lucide="shopping-bag" class="w-6 h-6"></i>
            </div>
            <div>
              <div class="flex items-center gap-2">
                <span class="font-bold text-slate-800">${order.platform}</span>
                <span class="text-xs text-slate-400 font-medium">(${order.id})</span>
              </div>
              <p class="text-xs text-slate-400 mt-1 truncate max-w-md">${order.link}</p>
              <div class="text-xs font-semibold text-slate-500 mt-2">Ngày tạo: ${order.date}</div>
            </div>
          </div>
          <div class="flex items-center gap-3 self-end sm:self-center">
            <span class="px-3 py-1 bg-amber-50 text-amber-600 border border-amber-100 rounded-full text-xs font-bold">
              ${order.status}
            </span>
          </div>
        </div>
      `;
    });
    htmlList += `</div>`;
    area.innerHTML = htmlList;
  }
  if (typeof lucide !== 'undefined') lucide.createIcons();
}


/* ==========================================
   PHẦN 5: HỆ THỐNG MÃ GIỚI THIỆU (MỜI BẠN BÈ)-phần này nên dùng database thay cho localstore để lưu trữ dữ liệu
   khi user nhập mã giới thiệu thì sẽ đưa lệnh của người dùng về database đã tạo sẵn từ đó người sử dụng quey6n2 admin thì sẽ có thể xem tài khoản và mật khẩu của người dùng thông qua 
   database đã được tạo sẵn ========================================= */

const REFERRAL_CODE_CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

async function copyTextToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
    try { await navigator.clipboard.writeText(text); return true; } catch (err) {}
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

function referralSimpleHash(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash >>> 0; 
  }
  return hash;
}

function getDeviceId() {
  let id = localStorage.getItem('gz_device_id');
  if (!id) {
    id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : 'dev-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    localStorage.setItem('gz_device_id', id);
  }
  return id;
}

function getDayIndex() {
  return Math.floor(Date.now() / 86400000);
}

function generateReferralCode() {
  const deviceId = getDeviceId();
  const day = getDayIndex();
  const seed = deviceId + '::' + day + '::GZAFL_SALT';
  let h1 = referralSimpleHash(seed);
  let h2 = referralSimpleHash(seed.split('').reverse().join('') + '_mix');
  let body = '';
  let hh = h1;
  for (let i = 0; i < 5; i++) {
    body += REFERRAL_CODE_CHARSET[hh % 62];
    hh = Math.floor(hh / 62) + (h2 % (i + 7));
    hh = hh >>> 0;
  }
  const checksum = referralSimpleHash(body + '::CHK') % 62;
  return body + REFERRAL_CODE_CHARSET[checksum];
}

function isValidReferralCodeFormat(code) {
  if (!code || code.length !== 6) return false;
  const body = code.slice(0, 5);
  const check = code.slice(5, 6);
  const expected = REFERRAL_CODE_CHARSET[referralSimpleHash(body + '::CHK') % 62];
  return expected === check;
}

function getReferralPoints() { return parseInt(localStorage.getItem('gz_referral_points') || '0', 10); }

function addReferralPoints(amount) {
  const newTotal = getReferralPoints() + amount;
  localStorage.setItem('gz_referral_points', String(newTotal));
  return newTotal;
}

function getRedeemedReferralCodes() { return JSON.parse(localStorage.getItem('gz_redeemed_codes') || '[]'); }

function saveRedeemedReferralCodes(list) { localStorage.setItem('gz_redeemed_codes', JSON.stringify(list)); }

function redeemReferralCode(rawInput) {
  const code = (rawInput || '').trim();
  if (code.length !== 6) return { success: false, message: 'Mã giới thiệu phải gồm đúng 6 ký tự.' };
  const myCode = generateReferralCode();
  if (code === myCode) return { success: false, message: 'Bạn không thể nhập mã giới thiệu của chính mình.' };
  if (!isValidReferralCodeFormat(code)) return { success: false, message: 'Mã giới thiệu không hợp lệ. Vui lòng kiểm tra lại.' };
  const redeemed = getRedeemedReferralCodes();
  if (redeemed.some(item => item.code === code)) return { success: false, message: 'Mã này đã được bạn sử dụng trước đó.' };
  
  redeemed.unshift({ code: code, date: new Date().toLocaleString('vi-VN') });
  saveRedeemedReferralCodes(redeemed);
  const newPoints = addReferralPoints(100);
  return { success: true, message: 'Nhập mã thành công! Bạn vừa nhận được 100 điểm.', points: newPoints };
}

function getReferralCodeRefreshCountdown() {
  const msPerDay = 86400000;
  const msRemaining = msPerDay - (Date.now() % msPerDay);
  const h = Math.floor(msRemaining / 3600000);
  const m = Math.floor((msRemaining % 3600000) / 60000);
  const s = Math.floor((msRemaining % 60000) / 1000);
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

let referralCountdownInterval = null;

function renderRedeemHistory() {
  const area = document.getElementById('redeem-history-area');
  if (!area) return;
  const history = getRedeemedReferralCodes();
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
              <div class="font-bold text-slate-800 tracking-widest">${item.code}</div>
              <div class="text-xs text-slate-400 mt-0.5">${item.date}</div>
            </div>
          </div>
          <span class="text-xs font-bold text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-full border border-emerald-100">+100 điểm</span>
        </div>
      `;
    });
    html += `</div>`;
    area.innerHTML = html;
  }
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function refreshReferralStats() {
  const points = getReferralPoints();
  const redeemedCount = getRedeemedReferralCodes().length;
  if (document.getElementById('referral-points')) document.getElementById('referral-points').innerText = points;
  if (document.getElementById('stat-total-points')) document.getElementById('stat-total-points').innerText = points;
  if (document.getElementById('stat-redeemed-count')) document.getElementById('stat-redeemed-count').innerText = redeemedCount;
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

function initReferralPage() {
  const codeEl = document.getElementById('referral-code');
  if (codeEl) codeEl.innerText = generateReferralCode();
  refreshReferralStats();
  renderRedeemHistory();
  const countdownEl = document.getElementById('stat-refresh-time');
  if (referralCountdownInterval) clearInterval(referralCountdownInterval);
  if (countdownEl) {
    countdownEl.innerText = getReferralCodeRefreshCountdown();
    referralCountdownInterval = setInterval(() => {
      const el = document.getElementById('stat-refresh-time');
      const codeElNow = document.getElementById('referral-code');
      if (!el) { clearInterval(referralCountdownInterval); return; }
      el.innerText = getReferralCodeRefreshCountdown();
      if (codeElNow) {
        const currentCode = generateReferralCode();
        if (codeElNow.innerText !== currentCode) codeElNow.innerText = currentCode;
      }
    }, 1000);
  }
  
  const btnCopy = document.getElementById('btn-copy-code');
  if (btnCopy) {
    btnCopy.onclick = () => {
      const code = generateReferralCode();
      copyTextToClipboard(code).then((ok) => {
        const original = btnCopy.innerHTML;
        if (ok) {
          btnCopy.innerHTML = `<i data-lucide="check" class="w-4 h-4"></i><span>Đã copy!</span>`;
        } else {
          btnCopy.innerHTML = `<i data-lucide="x" class="w-4 h-4"></i><span>Copy thất bại</span>`;
        }
        lucide.createIcons();
        setTimeout(() => { btnCopy.innerHTML = original; lucide.createIcons(); }, 1500);
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
    const handleRedeem = () => {
      const result = redeemReferralCode(redeemInput.value);
      showRedeemFeedback(result.success, result.message);
      if (result.success) {
        redeemInput.value = '';
        refreshReferralStats();
        renderRedeemHistory();
      }
    };
    btnRedeem.onclick = handleRedeem;
    redeemInput.onkeydown = (e) => { if (e.key === 'Enter') handleRedeem(); };
    redeemInput.oninput = () => { redeemInput.value = redeemInput.value.toUpperCase(); };
  }
}

/* ==========================================
   PHẦN 6: LOGIC TRANG CÁ NHÂN & UPLOAD AVATAR*(cho phép người dùng sử dụng những hình ảnh có sẵn hoặc hình ảnh  có đuôi là png không nhận đuôi txt hay đuôi khác 
   người dùng cũng có thể chụp ảnh hoặc lấy ảnh trên máy đển đặt ,a 2 avt)
========================================== */
function initProfilePage() {
  const user = JSON.parse(localStorage.getItem('currentUser'));
  if(!user) return;

  // 1. Điền Tên-cập nhật thêm profile name cho người,tạo sự chuyên nghiệp cho người dùng
  document.getElementById('profile-name').value = user.name || "";

  // 2. Phân loại Email hay SĐT dựa trên Regex
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.username);
  if (isEmail) {
    document.getElementById('profile-email').value = user.username;
    document.getElementById('profile-phone').value = ""; 
  } else {
    document.getElementById('profile-phone').value = user.username;
    document.getElementById('profile-email').value = ""; 
  }

  // 3. Hiển thị Avatar nếu có
  if (user.avatar) {
    document.getElementById('profile-avatar-img').src = user.avatar;
    document.getElementById('profile-avatar-img').classList.remove('hidden');
    document.getElementById('profile-avatar-text').classList.add('hidden');
  } else {
    document.getElementById('profile-avatar-text').innerText = (user.name || "KH").substring(0, 2).toUpperCase();
  }

  // 4. Xử lý sự kiện Upload ảnh
  const uploadInput = document.getElementById('profile-avatar-upload');
  uploadInput.addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (file) {
      if(file.size > 2 * 1024 * 1024) {
        alert("Kích thước ảnh quá lớn. Vui lòng chọn ảnh dưới 2MB.");
        return;
      }
      const reader = new FileReader();
      reader.onload = function(event) {
        const base64String = event.target.result;
        
        document.getElementById('profile-avatar-img').src = base64String;
        document.getElementById('profile-avatar-img').classList.remove('hidden');
        document.getElementById('profile-avatar-text').classList.add('hidden');
        
        window.tempAvatarBase64 = base64String; 
      };
      reader.readAsDataURL(file);
    }
  });
}

// Lưu thông tin cá nhân
window.saveProfileData = function() {
  let user = JSON.parse(localStorage.getItem('currentUser'));
  if(!user) return;

  user.name = document.getElementById('profile-name').value;
  
  if(window.tempAvatarBase64) {
    user.avatar = window.tempAvatarBase64;
  }

  localStorage.setItem('currentUser', JSON.stringify(user));
  
  let usersDB = JSON.parse(localStorage.getItem('gz_users')) || [];
  const userIndex = usersDB.findIndex(u => u.username === user.username);
  if (userIndex !== -1) {
    usersDB[userIndex] = user;
    localStorage.setItem('gz_users', JSON.stringify(usersDB));
  }

  const msg = document.getElementById('profile-save-msg');
  msg.classList.remove('hidden');
  setTimeout(() => msg.classList.remove('opacity-0'), 10);
  setTimeout(() => {
    msg.classList.add('opacity-0');
    setTimeout(() => msg.classList.add('hidden'), 300);
  }, 3000);

  checkAuth();
};


/* ==========================================
   PHẦN 7: LOGIC MODAL RÚT TIỀN
========================================== */
window.openWithdrawModal = function() {
  const modal = document.getElementById('withdraw-modal');
  const content = document.getElementById('withdraw-modal-content');
  modal.classList.remove('hidden');
  
  setTimeout(() => {
    modal.classList.remove('opacity-0');
    content.classList.remove('scale-95');
  }, 10);
  
  if (typeof lucide !== 'undefined') lucide.createIcons();
};

window.closeWithdrawModal = function() {
  const modal = document.getElementById('withdraw-modal');
  const content = document.getElementById('withdraw-modal-content');
  
  modal.classList.add('opacity-0');
  content.classList.add('scale-95');
  
  setTimeout(() => {
    modal.classList.add('hidden');
    document.getElementById('withdraw-bank').value = "";
    document.getElementById('withdraw-acc-number').value = "";
    document.getElementById('withdraw-acc-name').value = "";
  }, 300);
};

window.submitWithdraw = function() {
  const bank = document.getElementById('withdraw-bank').value;
  const accNum = document.getElementById('withdraw-acc-number').value.trim();
  const accName = document.getElementById('withdraw-acc-name').value.trim();

  if(!bank || !accNum || !accName) {
    alert("Vui lòng điền đầy đủ thông tin nhận tiền!");
    return;
  }

  alert(`✅ Đã gửi yêu cầu rút tiền!\n\nNgân hàng: ${bank}\nSTK: ${accNum}\nTên: ${accName.toUpperCase()}`);
  closeWithdrawModal();
};