/* ==========================================
   TRANG QUẢN TRỊ — logic riêng
   File này chỉ được nạp khi người dùng mở trang "Quản trị"
   (xem ensureAdminScript() trong script.js).
   Dùng lại các hàm dùng chung của script.js: api, showToast, setText,
   escapeHtml, formatCurrency, statusBadgeClass.
========================================== */

(function () {
  'use strict';

  const PAGE_SIZE = 50;
  const TABS = ['orders', 'withdrawals', 'users', 'security', 'referrals', 'password-resets', 'postbacks', 'audit'];
  const RESET_PENDING = 'Chờ xử lý';

  const state = {
    tab: 'orders',
    orders: { items: [], total: 0, q: '', status: '', offset: 0, loading: false },
    withdrawals: { items: [], total: 0, q: '', status: '', offset: 0, loading: false },
    users: { items: [], total: 0, q: '', offset: 0, loading: false },
    security: {
      items: [],
      total: 0,
      q: '',
      status: 'new',
      offset: 0,
      loading: false,
      stats: { total: 0, open: 0 }
    },
    referrals: { items: [], total: 0, offset: 0, loading: false },
    resets: { items: [], total: 0, status: RESET_PENDING, offset: 0, loading: false },
    postbacks: {
      items: [],
      total: 0,
      q: '',
      status: '',
      only: '',
      offset: 0,
      loading: false,
      stats: { total: 0, matched: 0, unmatched: 0, refused: 0, rewardTotal: 0, approvedTotal: 0, pendingTotal: 0 }
    },
    audit: { items: [], total: 0, q: '', offset: 0, loading: false },
    editing: { order: null, withdrawal: null, user: null }
  };

  let listenersBound = false;
  let searchTimer = null;
  // Nút "Đặt lại" phải bấm 2 lần (giống nút xoá người dùng) để tránh bấm nhầm
  let resetArmed = null;
  let resetArmTimer = null;

  /* ==========================================
     Tiện ích
  ========================================== */

  function badge(status) {
    return `<span class="inline-block px-2.5 py-1 rounded-full text-[11px] font-bold border ${statusBadgeClass(status)}">${escapeHtml(status)}</span>`;
  }

  function roleBadge(role) {
    return role === 'admin'
      ? '<span class="inline-block px-2.5 py-1 rounded-full text-[11px] font-bold border bg-indigo-50 text-indigo-600 border-indigo-100">Quản trị</span>'
      : '<span class="inline-block px-2.5 py-1 rounded-full text-[11px] font-bold border bg-slate-100 text-slate-500 border-slate-200">Người dùng</span>';
  }

  function actionButton(attr, value, label, extraClass) {
    return `<button ${attr}="${escapeHtml(value)}" class="text-xs font-bold px-3 py-1.5 rounded-lg transition ${extraClass || 'text-blue-600 bg-blue-50 hover:bg-blue-100'}">${escapeHtml(label)}</button>`;
  }

  function setBusy(button, busy) {
    if (!button) return;
    button.disabled = busy;
    button.classList.toggle('opacity-60', busy);
  }

  function toggleEmpty(emptyId, isEmpty, display) {
    const el = document.getElementById(emptyId);
    if (!el) return;
    el.classList.toggle('hidden', !isEmpty);
    el.classList.toggle('flex', isEmpty && display !== false);
  }

  function toggleMore(buttonId, shown) {
    const el = document.getElementById(buttonId);
    if (el) el.classList.toggle('hidden', !shown);
  }

  function openModal(id) {
    const modal = document.getElementById(id);
    const content = document.getElementById(id + '-content');
    if (!modal || !content) return;
    modal.classList.remove('hidden');
    setTimeout(() => {
      modal.classList.remove('opacity-0');
      content.classList.remove('scale-95');
    }, 10);
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  function closeModal(id) {
    const modal = document.getElementById(id);
    const content = document.getElementById(id + '-content');
    if (!modal || !content) return;
    modal.classList.add('opacity-0');
    content.classList.add('scale-95');
    setTimeout(() => modal.classList.add('hidden'), 300);
  }

  function normalizeNumberInput(value) {
    const raw = String(value == null ? '' : value).trim();
    if (raw === '') return 0;
    const n = Number(raw);
    return Number.isFinite(n) ? n : NaN;
  }

  function formatDay(value) {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('vi-VN');
  }

  // Một chỗ duy nhất xử lý lỗi gọi API ở trang quản trị.
  // 401 = phiên đăng nhập đã hết hiệu lực (hết hạn, hoặc mật khẩu vừa bị đổi),
  // phải đưa về màn hình đăng nhập thay vì chỉ hiện toast rồi để bảng "đứng".
  function handleApiError(err) {
    if (err && err.status === 401) {
      showToast('Phiên đăng nhập đã hết hiệu lực. Vui lòng đăng nhập lại.', 'error');
      if (typeof window.logoutUser === 'function') window.logoutUser();
      return;
    }
    showToast((err && err.message) || 'Có lỗi xảy ra.', 'error');
  }

  /* ==========================================
     Tổng quan
  ========================================== */

  async function loadOverview() {
    let data;
    try {
      data = await api('/admin/overview');
    } catch (err) {
      return;
    }

    setText('adm-stat-users', data.users.total);
    setText('adm-stat-users-note', data.users.admins + ' quản trị viên');
    setText('adm-stat-orders', data.orders.total);
    setText('adm-stat-orders-note', data.orders.completed + ' đơn hoàn thành');
    setText('adm-stat-pending', data.orders.pending);
    setText(
      'adm-stat-pending-note',
      (data.orders.awaitingApproval || 0) + ' chờ admin duyệt • ' + data.orders.paid + ' đã thanh toán'
    );
    setText('adm-stat-wd-pending', data.withdrawals.pending);
    setText('adm-stat-wd-note', data.withdrawals.total + ' lệnh rút');
    setText('adm-stat-commission', formatCurrency(data.money.totalCommission));
    const availableMoney =
      data.money.availableSystemBalance == null ? data.money.systemBalance : data.money.availableSystemBalance;
    setText('adm-stat-commission-note', `Khả dụng ${formatCurrency(availableMoney)}`);
    setText('adm-stat-paid', formatCurrency(data.money.totalPaidOut));
    setText('adm-stat-paid-note', data.referrals.points + ' điểm giới thiệu');

    renderResetBadge(data.passwordResets ? data.passwordResets.pending : 0);
    renderPostbackBadge(data.postbacks ? data.postbacks.unmatched : 0);
    renderSecurityBadge(data.securityAlerts ? data.securityAlerts.open : 0);
  }

  // Huy hiệu đỏ trên tab "Bảo mật" khi còn cảnh báo chưa xử lý
  function renderSecurityBadge(open) {
    const badge = document.getElementById('adm-security-badge');
    if (!badge) return;
    const count = Number(open) || 0;
    badge.innerText = String(count);
    badge.classList.toggle('hidden', count === 0);
    badge.classList.toggle('flex', count > 0);
  }

  // Huy hiệu đỏ trên tab "Khôi phục mật khẩu" khi còn yêu cầu chờ xử lý
  function renderResetBadge(pending) {
    const badge = document.getElementById('adm-reset-badge');
    if (!badge) return;
    const count = Number(pending) || 0;
    badge.innerText = String(count);
    badge.classList.toggle('hidden', count === 0);
    badge.classList.toggle('flex', count > 0);
  }

  /* ==========================================
     Đơn hàng
  ========================================== */

  async function loadOrders({ reset = false } = {}) {
    const s = state.orders;
    if (s.loading) return;
    if (reset) {
      s.offset = 0;
      s.items = [];
    }
    s.loading = true;

    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(s.offset) });
    if (s.q) params.set('q', s.q);
    if (s.status) params.set('status', s.status);

    try {
      const data = await api('/admin/orders?' + params.toString());
      s.total = data.total || 0;
      s.items = reset ? data.orders || [] : s.items.concat(data.orders || []);
      s.offset = s.items.length;
      renderOrders();
    } catch (err) {
      handleApiError(err);
    } finally {
      s.loading = false;
    }
  }

  function renderOrders() {
    const tbody = document.getElementById('adm-orders-body');
    if (!tbody) return;
    const { items, total } = state.orders;

    tbody.innerHTML = items
      .map(
        (o) => `
      <tr class="border-b border-slate-50 hover:bg-slate-50/60">
        <td class="px-3 py-3">
          <div class="font-bold text-slate-700">${escapeHtml(o.id)}</div>
          <a href="${escapeHtml(safeHttpUrl(o.link))}" target="_blank" rel="noopener" class="text-[11px] text-red-500 hover:underline break-all">Xem link sản phẩm</a>
        </td>
        <td class="px-3 py-3">
          <div class="font-semibold text-slate-700">${escapeHtml(o.user.name)}</div>
          <div class="text-xs text-slate-400">${escapeHtml(o.user.username)}</div>
        </td>
        <td class="px-3 py-3 text-slate-600">
          <div>${escapeHtml(o.platform)}</div>
          ${
            o.affiliate && o.affiliate.isReal === true
              ? '<div class="text-[10px] font-bold text-emerald-600">Link thật</div>'
              : o.affiliate && o.affiliate.isReal === false
                ? '<div class="text-[10px] font-bold text-amber-700">Chưa gắn hoa hồng</div>'
                : ''
          }
        </td>
        <td class="px-3 py-3">
          <div class="font-semibold ${o.commissionCredited ? 'text-emerald-600' : 'text-amber-600'}">${formatCurrency(o.commission)}</div>
          ${
            o.status === 'Chờ admin duyệt'
              ? '<div class="text-[10px] font-bold text-amber-600">Chờ admin duyệt</div>'
              : o.commissionCredited
                ? '<div class="text-[10px] font-bold text-emerald-600">Đã cộng ví</div>'
                : ''
          }
          ${
            o.reversedCommission > 0
              ? `<div class="text-[10px] font-bold text-rose-600">Đã thu hồi ${formatCurrency(o.reversedCommission)}</div>`
              : ''
          }
        </td>
        <td class="px-3 py-3">${badge(o.status)}</td>
        <td class="px-3 py-3 text-xs text-slate-400">${escapeHtml(o.date)}</td>
        <td class="px-3 py-3 text-right">${actionButton('data-adm-edit-order', o.id, 'Xử lý')}</td>
      </tr>`
      )
      .join('');

    toggleEmpty('adm-orders-empty', items.length === 0);
    setText('adm-orders-count', total + ' đơn hàng');
    toggleMore('adm-orders-more', items.length < total);
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  function openOrderModal(code) {
    const order = state.orders.items.find((o) => o.id === code);
    if (!order) return;
    state.editing.order = order;

    const affiliate = order.affiliate || {};
    const affiliateLabel =
      affiliate.isReal === true
        ? 'link hoàn tiền thật'
        : affiliate.isReal === false
          ? 'link chưa gắn hoa hồng'
          : 'chưa rõ trạng thái link';
    setText(
      'adm-order-info',
      `${order.user.name} (${order.user.username}) — ${order.platform} — ${affiliateLabel}`
    );
    const link = document.getElementById('adm-order-link');
    if (link) {
      link.href = safeHttpUrl(order.link) || '#';
      link.innerText = order.link;
      link.classList.remove('hidden');
    }

    const statusEl = document.getElementById('adm-order-status');
    const commissionEl = document.getElementById('adm-order-commission');
    if (statusEl) statusEl.value = order.status;
    if (commissionEl) commissionEl.value = String(order.commission || 0);

    const holdEl = document.getElementById('adm-order-hold');
    if (holdEl) {
      if (order.reversedCommission > 0) {
        holdEl.textContent =
          `Đã thu hồi ${formatCurrency(order.reversedCommission)}` +
          (order.reversedAt ? ` lúc ${formatDay(order.reversedAt)}` : '') +
          '. Nếu khách đã rút trước đó, số dư sẽ âm và được trừ vào hoa hồng sau.';
        holdEl.className = 'text-[11px] font-semibold text-rose-600 mt-2';
      } else if (order.status === 'Chờ admin duyệt') {
        holdEl.textContent =
          `Sàn đã ghi nhận ${formatCurrency(order.networkCommission)}. ` +
          `Khoản ${formatCurrency(order.commission)} đang chờ admin duyệt; bấm Lưu với trạng thái "Hoàn thành" để cộng vào ví.`;
        holdEl.className = 'text-[11px] font-semibold text-amber-600 mt-2';
      } else if (order.commissionCredited && order.commission > 0) {
        holdEl.textContent = 'Hoa hồng đã được duyệt và cộng vào ví.';
        holdEl.className = 'text-[11px] font-semibold text-emerald-600 mt-2';
      } else {
        holdEl.textContent = 'Đơn chưa có hoa hồng.';
        holdEl.className = 'text-[11px] font-semibold text-slate-400 mt-2';
      }
    }

    openModal('adm-order-modal');
  }

  async function saveOrder() {
    const order = state.editing.order;
    if (!order) return;

    const statusEl = document.getElementById('adm-order-status');
    const commissionEl = document.getElementById('adm-order-commission');
    const status = statusEl ? statusEl.value : order.status;
    const commission = normalizeNumberInput(commissionEl ? commissionEl.value : 0);

    if (!Number.isInteger(commission) || commission < 0) {
      return showToast('Hoa hồng phải là số nguyên không âm.', 'error');
    }

    const button = document.getElementById('adm-order-save');
    setBusy(button, true);
    try {
      await api('/admin/orders/' + encodeURIComponent(order.id), {
        method: 'PATCH',
        body: { status, commission }
      });
      showToast('Đã cập nhật đơn ' + order.id + '.', 'success');
      closeModal('adm-order-modal');
      await Promise.all([loadOrders({ reset: true }), loadOverview()]);
    } catch (err) {
      handleApiError(err);
    } finally {
      setBusy(button, false);
    }
  }

  /* ==========================================
     Rút tiền
  ========================================== */

  async function loadWithdrawals({ reset = false } = {}) {
    const s = state.withdrawals;
    if (s.loading) return;
    if (reset) {
      s.offset = 0;
      s.items = [];
    }
    s.loading = true;

    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(s.offset) });
    if (s.q) params.set('q', s.q);
    if (s.status) params.set('status', s.status);

    try {
      const data = await api('/admin/withdrawals?' + params.toString());
      s.total = data.total || 0;
      s.items = reset ? data.withdrawals || [] : s.items.concat(data.withdrawals || []);
      s.offset = s.items.length;
      renderWithdrawals();
    } catch (err) {
      handleApiError(err);
    } finally {
      s.loading = false;
    }
  }

  function renderWithdrawals() {
    const tbody = document.getElementById('adm-wd-body');
    if (!tbody) return;
    const { items, total } = state.withdrawals;

    tbody.innerHTML = items
      .map((w) => {
        // Lệnh rút chỉ có ảnh QR (không nhập số tài khoản) thì ghi rõ thay vì để trống
        const accLine =
          [
            w.accNum ? escapeHtml(w.accNum) : '',
            w.accName ? escapeHtml(String(w.accName).toUpperCase()) : ''
          ]
            .filter(Boolean)
            .join(' — ') || 'Nhận qua ảnh QR';

        return `
      <tr class="border-b border-slate-50 hover:bg-slate-50/60">
        <td class="px-3 py-3 font-bold text-slate-700">${escapeHtml(w.id)}</td>
        <td class="px-3 py-3">
          <div class="font-semibold text-slate-700">${escapeHtml(w.user.name)}</div>
          <div class="text-xs text-slate-400">${escapeHtml(w.user.username)}</div>
        </td>
        <td class="px-3 py-3">
          <div class="flex items-center gap-2">
            ${
              w.qrUrl
                ? `<img src="${escapeHtml(w.qrUrl)}" alt="Ảnh QR nhận tiền" class="w-9 h-9 rounded-lg border border-slate-200 bg-white object-contain flex-shrink-0">`
                : ''
            }
            <div class="min-w-0">
              <div class="font-semibold text-slate-700 truncate">${escapeHtml(w.bank || 'Qua ảnh QR')}</div>
              <div class="text-xs text-slate-400 truncate">${accLine}</div>
            </div>
          </div>
        </td>
        <td class="px-3 py-3 font-semibold text-slate-700">${formatCurrency(w.amount)}</td>
        <td class="px-3 py-3 text-slate-600">
          <div>${formatCurrency(w.payable)}</div>
          ${w.debt > 0 ? `<div class="text-[10px] font-bold text-rose-600">Khách nợ ${formatCurrency(w.debt)}</div>` : ''}
        </td>
        <td class="px-3 py-3">${badge(w.status)}</td>
        <td class="px-3 py-3 text-xs text-slate-400">${escapeHtml(w.date)}</td>
        <td class="px-3 py-3 text-right">${actionButton('data-adm-edit-wd', w.id, 'Xử lý', 'text-emerald-600 bg-emerald-50 hover:bg-emerald-100')}</td>
      </tr>`;
      })
      .join('');

    toggleEmpty('adm-wd-empty', items.length === 0);
    setText('adm-wd-count', total + ' lệnh rút');
    toggleMore('adm-wd-more', items.length < total);
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  function openWithdrawalModal(code) {
    const wd = state.withdrawals.items.find((w) => w.id === code);
    if (!wd) return;
    state.editing.withdrawal = wd;

    const accountText = wd.accNum
      ? `${wd.bank} ${wd.accNum}`
      : `nhận qua ảnh QR${wd.bank ? ' (' + wd.bank + ')' : ''}`;
    setText('adm-wd-info', `${wd.user.name} (${wd.user.username}) — ${accountText}`);

    // Ảnh QR nhận tiền (nếu khách có tải lên): hiện để quét khi chuyển khoản
    const qrWrap = document.getElementById('adm-wd-qr-wrap');
    const qrImg = document.getElementById('adm-wd-qr');
    if (qrWrap && qrImg) {
      if (wd.qrUrl) {
        qrImg.src = wd.qrUrl;
        qrWrap.href = wd.qrUrl;
        qrWrap.classList.remove('hidden');
      } else {
        qrImg.removeAttribute('src');
        qrWrap.classList.add('hidden');
      }
    }

    const statusEl = document.getElementById('adm-wd-status');
    const amountEl = document.getElementById('adm-wd-amount');
    if (statusEl) statusEl.value = wd.status;
    if (amountEl) amountEl.value = String(wd.amount > 0 ? wd.amount : wd.payable);
    setText(
      'adm-wd-payable',
      'Có thể chi: ' +
        formatCurrency(wd.payable) +
        (wd.debt > 0 ? ' • Khách đang nợ: ' + formatCurrency(wd.debt) : '')
    );

    openModal('adm-wd-modal');
  }

  async function saveWithdrawal() {
    const wd = state.editing.withdrawal;
    if (!wd) return;

    const statusEl = document.getElementById('adm-wd-status');
    const amountEl = document.getElementById('adm-wd-amount');
    const status = statusEl ? statusEl.value : wd.status;
    const amount = normalizeNumberInput(amountEl ? amountEl.value : 0);

    if (!Number.isInteger(amount) || amount < 0) {
      return showToast('Số tiền phải là số nguyên không âm.', 'error');
    }
    if (status === 'Đã thanh toán' && amount <= 0) {
      return showToast('Vui lòng nhập số tiền thực trả trước khi đánh dấu đã thanh toán.', 'error');
    }

    const button = document.getElementById('adm-wd-save');
    setBusy(button, true);
    try {
      await api('/admin/withdrawals/' + encodeURIComponent(wd.id), {
        method: 'PATCH',
        body: { status, amount }
      });
      showToast('Đã cập nhật lệnh rút ' + wd.id + '.', 'success');
      closeModal('adm-wd-modal');
      await Promise.all([loadWithdrawals({ reset: true }), loadOverview()]);
    } catch (err) {
      handleApiError(err);
    } finally {
      setBusy(button, false);
    }
  }

  /* ==========================================
     Người dùng
  ========================================== */

  async function loadUsers({ reset = false } = {}) {
    const s = state.users;
    if (s.loading) return;
    if (reset) {
      s.offset = 0;
      s.items = [];
    }
    s.loading = true;

    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(s.offset) });
    if (s.q) params.set('q', s.q);

    try {
      const data = await api('/admin/users?' + params.toString());
      s.total = data.total || 0;
      s.items = reset ? data.users || [] : s.items.concat(data.users || []);
      s.offset = s.items.length;
      renderUsers();
    } catch (err) {
      handleApiError(err);
    } finally {
      s.loading = false;
    }
  }

  function renderUsers() {
    const tbody = document.getElementById('adm-users-body');
    if (!tbody) return;
    const { items, total } = state.users;

    tbody.innerHTML = items
      .map((u) => {
        const initial = escapeHtml((u.name || 'KH').substring(0, 2).toUpperCase());
        const avatar = u.avatar
          ? `<img src="${escapeHtml(u.avatar)}" alt="" class="w-9 h-9 rounded-full object-cover flex-shrink-0">`
          : `<div class="w-9 h-9 rounded-full bg-[#18253f] text-white text-xs font-bold flex items-center justify-center flex-shrink-0">${initial}</div>`;
        return `
      <tr class="border-b border-slate-50 hover:bg-slate-50/60">
        <td class="px-3 py-3">
          <div class="flex items-center gap-3">
            ${avatar}
            <div class="min-w-0">
              <div class="font-semibold text-slate-700 truncate">${escapeHtml(u.name)}</div>
              <div class="text-xs text-slate-400 truncate">${escapeHtml(u.email || u.phone || u.username)}</div>
            </div>
          </div>
        </td>
        <td class="px-3 py-3">
          ${roleBadge(u.role)}
          ${
            u.securityHeld
              ? '<div class="mt-1"><span class="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-600 border border-rose-100">Tạm giữ</span></div>'
              : ''
          }
        </td>
        <td class="px-3 py-3 font-semibold text-slate-700">${u.points}</td>
        <td class="px-3 py-3 text-slate-600">${u.orderCount} <span class="text-xs text-slate-400">(${u.pendingCount} chờ)</span></td>
        <td class="px-3 py-3 font-semibold text-emerald-600">${formatCurrency(u.commission)}</td>
        <td class="px-3 py-3 font-semibold text-amber-600">${formatCurrency(u.pendingApproval)}</td>
        <td class="px-3 py-3 text-slate-600">${formatCurrency(u.withdrawn)}</td>
        <td class="px-3 py-3">
          <div class="font-bold ${u.balance < 0 ? 'text-rose-600' : 'text-slate-800'}">${formatCurrency(u.balance)}</div>
          ${u.debt > 0 ? `<div class="text-[10px] font-bold text-rose-600">Nợ ${formatCurrency(u.debt)}</div>` : ''}
        </td>
        <td class="px-3 py-3 text-right">${actionButton('data-adm-edit-user', String(u.id), 'Sửa', 'text-indigo-600 bg-indigo-50 hover:bg-indigo-100')}</td>
      </tr>`;
      })
      .join('');

    toggleEmpty('adm-users-empty', items.length === 0);
    setText('adm-users-count', total + ' người dùng');
    toggleMore('adm-users-more', items.length < total);
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  function openUserModal(id) {
    const user = state.users.items.find((u) => String(u.id) === String(id));
    if (!user) return;
    state.editing.user = user;

    setText('adm-user-info', `${user.name} — ${user.username}`);
    const roleEl = document.getElementById('adm-user-role');
    const pointsEl = document.getElementById('adm-user-points');
    if (roleEl) roleEl.value = user.role;
    if (pointsEl) pointsEl.value = String(user.points || 0);

    disarmDelete();
    openModal('adm-user-modal');
  }

  async function saveUser() {
    const user = state.editing.user;
    if (!user) return;

    const roleEl = document.getElementById('adm-user-role');
    const pointsEl = document.getElementById('adm-user-points');
    const role = roleEl ? roleEl.value : user.role;
    const points = normalizeNumberInput(pointsEl ? pointsEl.value : 0);

    if (!Number.isInteger(points) || points < 0) {
      return showToast('Điểm thưởng phải là số nguyên không âm.', 'error');
    }

    const button = document.getElementById('adm-user-save');
    setBusy(button, true);
    try {
      await api('/admin/users/' + encodeURIComponent(user.id), {
        method: 'PATCH',
        body: { role, points }
      });
      showToast('Đã cập nhật người dùng ' + user.name + '.', 'success');
      closeModal('adm-user-modal');
      await Promise.all([loadUsers({ reset: true }), loadOverview()]);
    } catch (err) {
      handleApiError(err);
    } finally {
      setBusy(button, false);
    }
  }

  // Hai bước: bấm lần 1 để "lên đạn", bấm lần 2 mới xoá thật
  let deleteArmTimer = null;

  function disarmDelete() {
    const button = document.getElementById('adm-user-delete');
    if (!button) return;
    clearTimeout(deleteArmTimer);
    button.dataset.armed = '0';
    button.innerHTML = '<i data-lucide="trash-2" class="w-4 h-4"></i>';
    button.className = 'bg-red-50 hover:bg-red-100 text-red-600 font-bold px-4 py-3.5 rounded-xl transition flex items-center justify-center gap-2';
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  function handleDeleteClick() {
    const button = document.getElementById('adm-user-delete');
    if (!button) return;

    if (button.dataset.armed !== '1') {
      button.dataset.armed = '1';
      button.innerHTML = '<i data-lucide="alert-circle" class="w-4 h-4"></i><span>Chắc chắn xoá?</span>';
      button.className = 'bg-red-600 hover:bg-red-700 text-white font-bold px-4 py-3.5 rounded-xl transition flex items-center justify-center gap-2';
      if (typeof lucide !== 'undefined') lucide.createIcons();
      clearTimeout(deleteArmTimer);
      deleteArmTimer = setTimeout(disarmDelete, 4000);
      return;
    }

    deleteUser();
  }

  async function deleteUser() {
    const user = state.editing.user;
    if (!user) return;

    try {
      await api('/admin/users/' + encodeURIComponent(user.id), { method: 'DELETE' });
      showToast('Đã xoá người dùng ' + user.name + '.', 'success');
      disarmDelete();
      closeModal('adm-user-modal');
      await Promise.all([loadUsers({ reset: true }), loadOverview()]);
    } catch (err) {
      handleApiError(err);
      disarmDelete();
    }
  }

  /* ==========================================
     Giới thiệu
  ========================================== */

  async function loadReferrals({ reset = false } = {}) {
    const s = state.referrals;
    if (s.loading) return;
    if (reset) {
      s.offset = 0;
      s.items = [];
    }
    s.loading = true;

    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(s.offset) });

    try {
      const data = await api('/admin/referrals?' + params.toString());
      s.total = data.total || 0;
      s.items = reset ? data.referrals || [] : s.items.concat(data.referrals || []);
      s.offset = s.items.length;
      renderReferrals();
    } catch (err) {
      handleApiError(err);
    } finally {
      s.loading = false;
    }
  }

  function renderReferrals() {
    const tbody = document.getElementById('adm-ref-body');
    if (!tbody) return;
    const { items, total } = state.referrals;

    tbody.innerHTML = items
      .map(
        (r) => `
      <tr class="border-b border-slate-50 hover:bg-slate-50/60">
        <td class="px-3 py-3 font-bold tracking-widest text-slate-700">${escapeHtml(r.code)}</td>
        <td class="px-3 py-3">
          <div class="font-semibold text-slate-700">${escapeHtml(r.user.name)}</div>
          <div class="text-xs text-slate-400">${escapeHtml(r.user.username)}</div>
        </td>
        <td class="px-3 py-3">${
          r.owner
            ? `<div class="font-semibold text-slate-700">${escapeHtml(r.owner.name)}</div><div class="text-xs text-slate-400">${escapeHtml(r.owner.username)}</div>`
            : '<span class="text-xs text-slate-400">Không xác định</span>'
        }</td>
        <td class="px-3 py-3 font-semibold text-emerald-600">+${r.points}</td>
        <td class="px-3 py-3 text-xs text-slate-400">${escapeHtml(r.date)}</td>
      </tr>`
      )
      .join('');

    toggleEmpty('adm-ref-empty', items.length === 0);
    setText('adm-ref-count', total + ' lượt');
    toggleMore('adm-ref-more', items.length < total);
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  /* ==========================================
     Khôi phục mật khẩu

     Khách gửi yêu cầu ở trang chủ (xem showForgotPassword trong script.js).
     Quản trị viên bấm "Đặt lại" -> server sinh mật khẩu tạm và trả về đúng
     một lần; mật khẩu tạm KHÔNG được lưu trong database.
  ========================================== */

  async function loadResets({ reset = false } = {}) {
    const s = state.resets;
    if (s.loading) return;
    if (reset) {
      s.offset = 0;
      s.items = [];
    }
    s.loading = true;

    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(s.offset) });
    if (s.status) params.set('status', s.status);

    try {
      const data = await api('/admin/password-resets?' + params.toString());
      s.total = data.total || 0;
      s.items = reset ? data.resets || [] : s.items.concat(data.resets || []);
      s.offset = s.items.length;
      renderResets();
    } catch (err) {
      handleApiError(err);
    } finally {
      s.loading = false;
    }
  }

  function resetActionButton(item) {
    if (item.status !== RESET_PENDING) {
      return '<span class="text-xs text-slate-300 font-semibold">—</span>';
    }
    const armed = resetArmed === String(item.id);
    const cls = armed
      ? 'bg-red-600 hover:bg-red-700 text-white'
      : 'text-blue-600 bg-blue-50 hover:bg-blue-100';
    return (
      `<button data-adm-reset="${escapeHtml(item.id)}" class="text-xs font-bold px-3 py-1.5 rounded-lg transition ${cls}">` +
      (armed ? 'Chắc chắn?' : 'Đặt lại') +
      '</button>' +
      `<button data-adm-cancel-reset="${escapeHtml(item.id)}" class="ml-2 text-xs font-bold px-3 py-1.5 rounded-lg text-slate-500 bg-slate-100 hover:bg-slate-200 transition">Từ chối</button>`
    );
  }

  function renderResets() {
    const tbody = document.getElementById('adm-reset-body');
    if (!tbody) return;
    const { items, total } = state.resets;

    tbody.innerHTML = items
      .map((r) => {
        const contact = r.note
          ? `<div class="text-slate-600 break-all">${escapeHtml(r.note)}</div>`
          : '<div class="text-slate-300">Không ghi</div>';
        return `
      <tr class="border-b border-slate-50 hover:bg-slate-50/60">
        <td class="px-3 py-3">
          <div class="font-semibold text-slate-700">${escapeHtml(r.user.name)}</div>
          <div class="text-xs text-slate-400">${escapeHtml(r.user.username)}</div>
        </td>
        <td class="px-3 py-3 text-xs">${contact}</td>
        <td class="px-3 py-3">${badge(r.status)}</td>
        <td class="px-3 py-3 text-xs text-slate-400">${escapeHtml(r.date || '')}</td>
        <td class="px-3 py-3 text-right whitespace-nowrap">${resetActionButton(r)}</td>
      </tr>`;
      })
      .join('');

    toggleEmpty('adm-reset-empty', items.length === 0);
    setText('adm-reset-count', total + ' yêu cầu');
    toggleMore('adm-reset-more', items.length < total);
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  function findReset(id) {
    return state.resets.items.find((r) => String(r.id) === String(id)) || null;
  }

  // Yêu cầu của chính quản trị viên đang đăng nhập. Đặt lại mật khẩu sẽ huỷ
  // luôn phiên hiện tại, làm bảng quản trị "đứng" -> chặn và chỉ sang mục khác.
  function isSelfReset(item) {
    return (
      item &&
      item.user &&
      typeof currentUser !== 'undefined' &&
      currentUser &&
      item.user.id === currentUser.id
    );
  }

  function confirmReset(id) {
    const item = findReset(id);
    if (isSelfReset(item)) {
      showToast('Đây là tài khoản của chính bạn. Hãy dùng Cá nhân → Đổi mật khẩu.', 'error');
      return;
    }

    if (resetArmed !== String(id)) {
      resetArmed = String(id);
      renderResets();
      clearTimeout(resetArmTimer);
      resetArmTimer = setTimeout(() => {
        resetArmed = null;
        renderResets();
      }, 4000);
      return;
    }

    resetArmed = null;
    clearTimeout(resetArmTimer);
    resetPassword(id);
  }

  async function resetPassword(id) {
    // Đánh dấu đang xử lý để không bấm lại nhiều lần
    const button = document.querySelector('[data-adm-reset="' + id + '"]');
    setBusy(button, true);

    try {
      const data = await api('/admin/password-resets/' + encodeURIComponent(id) + '/reset', {
        method: 'POST'
      });
      const user = data.user || {};
      const expires = data.expiresAt ? new Date(data.expiresAt).toLocaleString('vi-VN') : '';
      setText(
        'adm-reset-info',
        `${user.name || ''} (${user.username || ''})${expires ? ' — mật khẩu tạm hết hạn lúc ' + expires : ''}`
      );
      setText('adm-reset-password', data.tempPassword || '');
      openModal('adm-reset-modal');
      await Promise.all([loadResets({ reset: true }), loadOverview()]);
    } catch (err) {
      handleApiError(err);
      await loadResets({ reset: true });
    } finally {
      setBusy(button, false);
    }
  }

  async function cancelReset(id) {
    const button = document.querySelector('[data-adm-cancel-reset="' + id + '"]');
    setBusy(button, true);

    try {
      await api('/admin/password-resets/' + encodeURIComponent(id) + '/cancel', { method: 'POST' });
      showToast('Đã từ chối yêu cầu.', 'success');
      await Promise.all([loadResets({ reset: true }), loadOverview()]);
    } catch (err) {
      handleApiError(err);
      await loadResets({ reset: true });
    } finally {
      setBusy(button, false);
    }
  }

  function copyTempPassword() {
    const el = document.getElementById('adm-reset-password');
    const value = el ? el.innerText.trim() : '';
    if (!value || value === '—') return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(
        () => showToast('Đã chép mật khẩu tạm.', 'success'),
        () => showToast('Không chép được. Hãy bôi đen và chép tay.', 'error')
      );
    } else {
      showToast('Trình duyệt không hỗ trợ chép tự động. Hãy bôi đen và chép tay.', 'error');
    }
  }

  /* ==========================================
     Đối soát postback (nhật ký mạng affiliate gọi vào)
  ========================================== */

  // Nhãn trạng thái chuyển đổi bên mạng
  function networkBadge(status) {
    const map = {
      pending: ['Chờ duyệt', 'bg-amber-50 text-amber-600 border-amber-100'],
      approved: ['Đã duyệt', 'bg-emerald-50 text-emerald-600 border-emerald-100'],
      rejected: ['Đã huỷ', 'bg-slate-100 text-slate-500 border-slate-200']
    };
    const item = map[status] || ['Không rõ', 'bg-slate-100 text-slate-500 border-slate-200'];
    return `<span class="inline-block px-2.5 py-1 rounded-full text-[11px] font-bold border ${item[1]}">${escapeHtml(item[0])}</span>`;
  }

  async function loadPostbacks({ reset = false } = {}) {
    const s = state.postbacks;
    if (s.loading) return;
    if (reset) {
      s.offset = 0;
      s.items = [];
    }
    s.loading = true;

    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(s.offset) });
    if (s.q) params.set('q', s.q);
    if (s.status) params.set('status', s.status);
    if (s.only) params.set('only', s.only);

    try {
      const data = await api('/admin/postbacks?' + params.toString());
      s.total = data.total || 0;
      s.stats = data.stats || s.stats;
      s.items = reset ? data.postbacks || [] : s.items.concat(data.postbacks || []);
      s.offset = s.items.length;
      renderPostbacks();
      // Còn log chưa khớp đơn thì nhắc trên tab
      renderPostbackBadge(s.stats.unmatched);
    } catch (err) {
      handleApiError(err);
    } finally {
      s.loading = false;
    }
  }

  function renderPostbackBadge(unmatched) {
    const badge = document.getElementById('adm-pb-badge');
    if (!badge) return;
    const count = Number(unmatched) || 0;
    badge.innerText = String(count);
    badge.classList.toggle('hidden', count === 0);
    badge.classList.toggle('flex', count > 0);
  }

  function renderPostbacks() {
    const tbody = document.getElementById('adm-pb-body');
    if (!tbody) return;
    const { items, total, stats } = state.postbacks;

    setText('adm-pb-stat-total', stats.total);
    setText('adm-pb-stat-matched', stats.matched);
    setText('adm-pb-stat-unmatched', stats.unmatched);
    setText('adm-pb-stat-reward', formatCurrency(stats.rewardTotal));
    setText('adm-pb-stat-reward-note', 'Chưa duyệt ' + formatCurrency(stats.pendingTotal));

    tbody.innerHTML = items
      .map((p) => {
        const refused = p.action === 'Từ chối';
        const when =
          escapeHtml(p.date || '') +
          (p.dupCount > 1
            ? `<div class="text-[10px] text-amber-600 font-semibold">nhận lại ${p.dupCount - 1} lần</div>`
            : '');

        const transaction = p.transactionId
          ? `<div class="font-semibold text-slate-700 text-xs">${escapeHtml(p.transactionId)}</div>`
          : '<div class="text-xs text-slate-300">—</div>';
        const product = p.productId
          ? `<div class="text-[11px] text-slate-400">SP ${escapeHtml(p.productId)}</div>`
          : '';

        const user = p.user
          ? `<div class="text-xs font-semibold text-slate-600">${escapeHtml(p.user.name)}</div>
             <div class="text-[11px] text-slate-400">${escapeHtml(p.subId || '')}</div>`
          : `<div class="text-[11px] text-slate-400">${escapeHtml(p.subId || '—')}</div>`;

        const result = refused
          ? `<span class="inline-block px-2.5 py-1 rounded-full text-[11px] font-bold border bg-red-50 text-red-600 border-red-100">Bị từ chối</span>
             <div class="text-[11px] text-slate-400 mt-1">${escapeHtml(p.note || '')}</div>`
          : `<div class="text-xs font-semibold flex items-center gap-1.5 ${p.tentative ? 'text-amber-600' : 'text-slate-600'}">
               ${p.tentative ? '<i data-lucide="alert-triangle" class="w-3.5 h-3.5"></i>' : ''}${escapeHtml(p.action || '')}
             </div>
             ${p.note ? `<div class="text-[11px] text-slate-400 mt-0.5 max-w-[240px]">${escapeHtml(p.note)}</div>` : ''}`;

        const actions = [
          actionButton('data-adm-pb-raw', p.id, 'Thô', 'text-slate-600 bg-slate-100 hover:bg-slate-200'),
          !refused && !p.matched ? actionButton('data-adm-pb-reapply', p.id, 'Xử lý lại') : ''
        ]
          .filter(Boolean)
          .join(' ');

        return `
      <tr class="border-b border-slate-50 hover:bg-slate-50/50 transition">
        <td class="px-3 py-4 text-xs text-slate-500 whitespace-nowrap">${when}</td>
        <td class="px-3 py-4">${transaction}${product}</td>
        <td class="px-3 py-4 text-xs font-bold text-slate-700">${escapeHtml(p.orderCode || '—')}</td>
        <td class="px-3 py-4">${user}</td>
        <td class="px-3 py-4 font-bold text-emerald-600 whitespace-nowrap">${formatCurrency(p.reward)}</td>
        <td class="px-3 py-4">${networkBadge(p.networkStatus)}</td>
        <td class="px-3 py-4">${result}</td>
        <td class="px-3 py-4 text-right whitespace-nowrap">${actions}</td>
      </tr>`;
      })
      .join('');

    toggleEmpty('adm-pb-empty', items.length === 0);
    setText('adm-pb-count', `${total} lần nhận`);
    toggleMore('adm-pb-more', items.length < total);
  }

  /** Mở hộp xem tham số thô mạng gửi vào (đối chiếu khi hoa hồng sai). */
  function openPostbackRaw(id) {
    const item = state.postbacks.items.find((p) => String(p.id) === String(id));
    if (!item) return;

    let pretty = item.query || '';
    try {
      pretty = JSON.stringify(JSON.parse(pretty), null, 2);
    } catch (err) {
      // Tham số thô không phải JSON hợp lệ thì hiện nguyên văn
    }

    setText(
      'adm-pb-info',
      `#${item.id} · ${item.date} · ${item.provider || 'không rõ mạng'} · IP ${item.ip || '—'}`
    );
    const pre = document.getElementById('adm-pb-raw');
    if (pre) pre.innerText = pretty || '(không có tham số)';
    openModal('adm-pb-modal');
  }

  /** Cho hệ thống khớp lại một log cũ (postback về trước khi đơn được tạo). */
  async function reapplyPostback(id, button) {
    setBusy(button, true);
    try {
      const data = await api(`/admin/postbacks/${encodeURIComponent(id)}/reapply`, { method: 'POST' });
      showToast(
        data.matched
          ? `Đã khớp lại với đơn ${data.postback.orderCode}.`
          : 'Vẫn chưa khớp được đơn nào. Kiểm tra mã đơn/mã người dùng trong tham số thô.',
        data.matched ? 'success' : 'error'
      );
      await loadPostbacks({ reset: true });
      // Đơn hàng vừa đổi trạng thái -> tải lại cả tab đơn hàng và số liệu tổng quan
      state.orders = { items: [], total: 0, q: '', status: '', offset: 0, loading: false };
      loadOrders({ reset: true });
      loadOverview();
    } catch (err) {
      handleApiError(err);
    } finally {
      setBusy(button, false);
    }
  }

  /* ==========================================
     Nhật ký quản trị

     Ai đã đổi gì, khi nào — server ghi ở lib/audit.js.
     Chỉ quản trị viên xem được (GET /api/admin/audit-logs).
     Mật khẩu tạm KHÔNG bao giờ được ghi vào nhật ký.
  ========================================== */

  async function loadAuditLogs({ reset = false } = {}) {
    const s = state.audit;
    if (s.loading) return;
    if (reset) {
      s.offset = 0;
      s.items = [];
    }
    s.loading = true;

    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(s.offset) });
    if (s.q) params.set('q', s.q);

    try {
      const data = await api('/admin/audit-logs?' + params.toString());
      s.total = data.total || 0;
      s.items = reset ? data.logs || [] : s.items.concat(data.logs || []);
      s.offset = s.items.length;
      renderAuditLogs();
    } catch (err) {
      handleApiError(err);
    } finally {
      s.loading = false;
    }
  }

  function auditTargetLabel(item) {
    const label =
      {
        user: 'Người dùng',
        order: 'Đơn hàng',
        withdrawal: 'Lệnh rút',
        postback: 'Postback',
        'password-reset': 'Yêu cầu khôi phục'
      }[item.targetType] || item.targetType;
    return label ? `${label} ${item.targetId}` : '';
  }

  function renderAuditLogs() {
    const box = document.getElementById('adm-audit-list');
    if (!box) return;
    const { items, total } = state.audit;

    if (items.length === 0) {
      box.innerHTML = `
        <div class="py-10 text-center">
          <div class="w-12 h-12 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center mx-auto mb-3">
            <i data-lucide="history" class="w-6 h-6 text-slate-300"></i>
          </div>
          <p class="text-slate-500 text-sm">Chưa có thao tác nào được ghi lại.</p>
        </div>`;
    } else {
      box.innerHTML = items
        .map((item) => {
          const target = auditTargetLabel(item);
          const actor = item.actor && (item.actor.username || item.actor.name);
          return `
      <div class="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4 p-4 rounded-2xl border border-slate-100 bg-slate-50/40">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="font-bold text-slate-700">${escapeHtml(item.action)}</span>
            ${
              target
                ? `<span class="text-[11px] font-semibold text-slate-500 bg-white border border-slate-200 px-2 py-0.5 rounded-full">${escapeHtml(target)}</span>`
                : ''
            }
          </div>
          ${item.detail ? `<div class="text-sm text-slate-500 mt-1 break-words">${escapeHtml(item.detail)}</div>` : ''}
        </div>
        <div class="sm:text-right shrink-0">
          <div class="text-xs font-semibold text-slate-600">${escapeHtml(actor || 'Hệ thống')}</div>
          <div class="text-xs text-slate-400">${escapeHtml(item.date)}</div>
        </div>
      </div>`;
        })
        .join('');
    }

    setText('adm-audit-count', total + ' thao tác');
    toggleMore('adm-audit-more', items.length < total);
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  /* ==========================================
     Cảnh báo bảo mật

     Hệ thống chỉ cảnh báo khi có nhiều lần đăng nhập sai; KHÔNG tự khóa
     vĩnh viễn tài khoản. Admin có thể đánh dấu đã xử lý, tạm giữ 24 giờ
     hoặc bỏ tạm giữ.
  ========================================== */

  async function loadSecurityAlerts({ reset = false } = {}) {
    const s = state.security;
    if (s.loading) return;
    if (reset) {
      s.offset = 0;
      s.items = [];
    }
    s.loading = true;

    const params = new URLSearchParams({
      status: s.status || 'new',
      limit: String(PAGE_SIZE),
      offset: String(s.offset)
    });
    if (s.q) params.set('q', s.q);

    try {
      const data = await api('/admin/security-alerts?' + params.toString());
      s.total = data.total || 0;
      s.items = reset ? data.alerts || [] : s.items.concat(data.alerts || []);
      s.offset = s.items.length;
      s.stats = data.stats || { total: 0, open: 0 };
      renderSecurityAlerts();
      renderSecurityBadge(s.stats.open);
    } catch (err) {
      handleApiError(err);
    } finally {
      s.loading = false;
    }
  }

  function securitySeverityBadge(severity) {
    return severity === 'critical'
      ? '<span class="inline-block px-2.5 py-1 rounded-full text-[11px] font-bold border bg-rose-50 text-rose-600 border-rose-100">Nghiêm trọng</span>'
      : '<span class="inline-block px-2.5 py-1 rounded-full text-[11px] font-bold border bg-amber-50 text-amber-700 border-amber-100">Cần xem xét</span>';
  }

  function securityHoldText(value) {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('vi-VN');
  }

  function renderSecurityAlerts() {
    const box = document.getElementById('adm-security-list');
    if (!box) return;
    const { items, total, stats } = state.security;

    box.innerHTML = items
      .map((a) => {
        const userLine = a.user
          ? `<div class="font-semibold text-slate-700">${escapeHtml(a.user.name)}
               <span class="text-xs font-normal text-slate-400">${escapeHtml(a.user.username || a.user.email || '')}</span>
             </div>`
          : `<div class="font-semibold text-slate-600">${escapeHtml(a.username || 'Không rõ')}</div>
             <div class="text-[11px] text-slate-400">Tên đăng nhập không tồn tại hoặc tài khoản đã bị xoá</div>`;

        const held = a.securityHeld
          ? `<span class="inline-flex items-center gap-1 text-[11px] font-bold text-rose-600 bg-rose-50 border border-rose-100 px-2 py-0.5 rounded-full">
               <i data-lucide="lock" class="w-3 h-3"></i> Tạm giữ đến ${escapeHtml(securityHoldText(a.securityHoldUntil))}
             </span>`
          : '';

        const statusBadge =
          a.status === 'new'
            ? '<span class="inline-block px-2.5 py-1 rounded-full text-[11px] font-bold border bg-amber-50 text-amber-700 border-amber-100">Chưa xử lý</span>'
            : '<span class="inline-block px-2.5 py-1 rounded-full text-[11px] font-bold border bg-emerald-50 text-emerald-600 border-emerald-100">Đã xử lý</span>';

        const successLine = a.lastSuccessDate
          ? `<div class="text-[11px] text-emerald-600 mt-1">Có đăng nhập đúng mật khẩu lúc ${escapeHtml(a.lastSuccessDate)}</div>`
          : '';

        const resolvedLine = a.resolvedDate
          ? `<div class="text-[11px] text-slate-400 mt-1">Xử lý lúc ${escapeHtml(a.resolvedDate)}${
              a.resolutionNote ? ` — ${escapeHtml(a.resolutionNote)}` : ''
            }</div>`
          : '';

        const actions = [];
        if (a.status === 'new') {
          actions.push(
            actionButton('data-adm-security-resolve', a.id, 'Đã xử lý', 'text-emerald-600 bg-emerald-50 hover:bg-emerald-100')
          );
        }
        if (a.userId && !a.securityHeld && (!a.user || a.user.role !== 'admin')) {
          actions.push(
            actionButton('data-adm-security-hold', a.id, 'Tạm giữ 24h', 'text-amber-700 bg-amber-50 hover:bg-amber-100')
          );
        }
        if (a.userId && a.securityHeld) {
          actions.push(
            actionButton('data-adm-security-unlock', a.userId, 'Bỏ tạm giữ', 'text-slate-600 bg-slate-100 hover:bg-slate-200')
          );
        }

        return `
      <div class="p-4 rounded-2xl border border-slate-100 bg-slate-50/40">
        <div class="flex flex-col sm:flex-row sm:items-start gap-3">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              ${securitySeverityBadge(a.severity)}
              ${statusBadge}
              ${held}
            </div>
            <div class="mt-2">${userLine}</div>
            <div class="text-sm text-slate-600 mt-1 break-words">${escapeHtml(a.detail || '')}</div>
            <div class="text-[11px] text-slate-400 mt-1">
              ${a.eventCount > 1 ? `Gộp ${a.eventCount} lần • ` : ''}
              Gần nhất ${escapeHtml(a.lastSeenDate || a.date || '')}
              ${a.ip ? ` • IP ${escapeHtml(a.ip)}` : ''}
            </div>
            ${successLine}
            ${resolvedLine}
          </div>
          <div class="flex sm:flex-col items-center sm:items-end gap-2 shrink-0 flex-wrap">
            ${actions.join(' ')}
          </div>
        </div>
      </div>`;
      })
      .join('');

    toggleEmpty('adm-security-empty', items.length === 0);
    const openText = stats && stats.open ? ` • ${stats.open} chưa xử lý` : '';
    setText('adm-security-count', `${total} cảnh báo${openText}`);
    toggleMore('adm-security-more', items.length < total);
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  async function resolveSecurityAlert(id, button) {
    if (!window.confirm('Đánh dấu cảnh báo bảo mật này là đã xử lý?')) return;
    setBusy(button, true);
    try {
      await api(`/admin/security-alerts/${encodeURIComponent(id)}/resolve`, {
        method: 'POST',
        body: { note: '' }
      });
      showToast('Đã đánh dấu cảnh báo là đã xử lý.', 'success');
      await Promise.all([loadSecurityAlerts({ reset: true }), loadOverview()]);
    } catch (err) {
      handleApiError(err);
    } finally {
      setBusy(button, false);
    }
  }

  async function holdSecurityAlert(id, button) {
    if (!window.confirm('Tạm giữ tài khoản này 24 giờ để xem xét? Người dùng sẽ không đăng nhập được trong thời gian đó.')) {
      return;
    }
    setBusy(button, true);
    try {
      const data = await api(`/admin/security-alerts/${encodeURIComponent(id)}/hold`, {
        method: 'POST',
        body: { hours: 24 }
      });
      showToast('Đã tạm giữ tài khoản đến ' + securityHoldText(data.heldUntil) + '.', 'success');
      await Promise.all([loadSecurityAlerts({ reset: true }), loadOverview()]);
      if (state.users.items.length) loadUsers({ reset: true });
    } catch (err) {
      handleApiError(err);
    } finally {
      setBusy(button, false);
    }
  }

  async function unlockSecurityUser(userId, button) {
    if (!window.confirm('Bỏ tạm giữ cho tài khoản này?')) return;
    setBusy(button, true);
    try {
      await api(`/admin/users/${encodeURIComponent(userId)}/security-hold`, { method: 'DELETE' });
      showToast('Đã bỏ tạm giữ tài khoản.', 'success');
      await Promise.all([loadSecurityAlerts({ reset: true }), loadOverview()]);
      if (state.users.items.length) loadUsers({ reset: true });
    } catch (err) {
      handleApiError(err);
    } finally {
      setBusy(button, false);
    }
  }

  /* ==========================================
     Tab
  ========================================== */

  function setTab(tab, { reload = false } = {}) {
    if (!TABS.includes(tab)) tab = 'orders';
    state.tab = tab;

    document.querySelectorAll('.adm-tab').forEach((button) => {
      const active = button.dataset.admTab === tab;
      button.className =
        'adm-tab flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold whitespace-nowrap transition ' +
        (active ? 'bg-[#18253f] text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800');
    });

    TABS.forEach((name) => {
      const panel = document.getElementById('adm-panel-' + name);
      if (panel) panel.classList.toggle('hidden', name !== tab);
    });

    if (typeof lucide !== 'undefined') lucide.createIcons();

    if (reload) {
      if (tab === 'orders' && state.orders.items.length === 0) loadOrders({ reset: true });
      else if (tab === 'withdrawals' && state.withdrawals.items.length === 0) loadWithdrawals({ reset: true });
      else if (tab === 'users' && state.users.items.length === 0) loadUsers({ reset: true });
      else if (tab === 'security' && state.security.items.length === 0) loadSecurityAlerts({ reset: true });
      else if (tab === 'referrals' && state.referrals.items.length === 0) loadReferrals({ reset: true });
      else if (tab === 'password-resets' && state.resets.items.length === 0) loadResets({ reset: true });
      else if (tab === 'postbacks' && state.postbacks.items.length === 0) loadPostbacks({ reset: true });
      else if (tab === 'audit' && state.audit.items.length === 0) loadAuditLogs({ reset: true });
    }
  }

  /* ==========================================
     Gắn sự kiện (chỉ một lần cho cả phiên)
  ========================================== */

  function bindEvents() {
    if (listenersBound) return;
    listenersBound = true;

    // Click
    document.addEventListener('click', (event) => {
      const tabBtn = event.target.closest('[data-adm-tab]');
      if (tabBtn) {
        event.preventDefault();
        setTab(tabBtn.dataset.admTab, { reload: true });
        return;
      }

      const closeBtn = event.target.closest('[data-adm-close]');
      if (closeBtn) {
        event.preventDefault();
        closeModal('adm-' + closeBtn.dataset.admClose + '-modal');
        return;
      }

      const editOrder = event.target.closest('[data-adm-edit-order]');
      if (editOrder) {
        event.preventDefault();
        openOrderModal(editOrder.dataset.admEditOrder);
        return;
      }

      const editWd = event.target.closest('[data-adm-edit-wd]');
      if (editWd) {
        event.preventDefault();
        openWithdrawalModal(editWd.dataset.admEditWd);
        return;
      }

      const editUser = event.target.closest('[data-adm-edit-user]');
      if (editUser) {
        event.preventDefault();
        openUserModal(editUser.dataset.admEditUser);
        return;
      }

      const resetBtn = event.target.closest('[data-adm-reset]');
      if (resetBtn) {
        event.preventDefault();
        confirmReset(resetBtn.dataset.admReset);
        return;
      }

      const cancelResetBtn = event.target.closest('[data-adm-cancel-reset]');
      if (cancelResetBtn) {
        event.preventDefault();
        cancelReset(cancelResetBtn.dataset.admCancelReset);
        return;
      }

      const resolveSecurityBtn = event.target.closest('[data-adm-security-resolve]');
      if (resolveSecurityBtn) {
        event.preventDefault();
        resolveSecurityAlert(resolveSecurityBtn.dataset.admSecurityResolve, resolveSecurityBtn);
        return;
      }

      const holdSecurityBtn = event.target.closest('[data-adm-security-hold]');
      if (holdSecurityBtn) {
        event.preventDefault();
        holdSecurityAlert(holdSecurityBtn.dataset.admSecurityHold, holdSecurityBtn);
        return;
      }

      const unlockSecurityBtn = event.target.closest('[data-adm-security-unlock]');
      if (unlockSecurityBtn) {
        event.preventDefault();
        unlockSecurityUser(unlockSecurityBtn.dataset.admSecurityUnlock, unlockSecurityBtn);
        return;
      }

      const rawBtn = event.target.closest('[data-adm-pb-raw]');
      if (rawBtn) {
        event.preventDefault();
        openPostbackRaw(rawBtn.dataset.admPbRaw);
        return;
      }

      const reapplyBtn = event.target.closest('[data-adm-pb-reapply]');
      if (reapplyBtn) {
        event.preventDefault();
        reapplyPostback(reapplyBtn.dataset.admPbReapply, reapplyBtn);
        return;
      }

      if (event.target.closest('#adm-reload')) {
        event.preventDefault();
        return reloadAll();
      }
      if (event.target.closest('#adm-orders-more')) return loadOrders();
      if (event.target.closest('#adm-wd-more')) return loadWithdrawals();
      if (event.target.closest('#adm-users-more')) return loadUsers();
      if (event.target.closest('#adm-security-more')) return loadSecurityAlerts();
      if (event.target.closest('#adm-ref-more')) return loadReferrals();
      if (event.target.closest('#adm-reset-more')) return loadResets();
      if (event.target.closest('#adm-pb-more')) return loadPostbacks();
      if (event.target.closest('#adm-audit-more')) return loadAuditLogs();
      if (event.target.closest('#adm-order-save')) return saveOrder();
      if (event.target.closest('#adm-wd-save')) return saveWithdrawal();
      if (event.target.closest('#adm-user-save')) return saveUser();
      if (event.target.closest('#adm-user-delete')) return handleDeleteClick();
      if (event.target.closest('#adm-reset-copy')) return copyTempPassword();
    });

    // Gõ tìm kiếm (chờ 350ms sau lần gõ cuối)
    document.addEventListener('input', (event) => {
      const id = event.target && event.target.id;
      const targets = {
        'adm-orders-search': ['orders', 'q'],
        'adm-wd-search': ['withdrawals', 'q'],
        'adm-users-search': ['users', 'q'],
        'adm-security-search': ['security', 'q'],
        'adm-pb-search': ['postbacks', 'q'],
        'adm-audit-search': ['audit', 'q']
      };
      const target = targets[id];
      if (!target) return;

      const [bucket, field] = target;
      state[bucket][field] = event.target.value.trim();

      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        if (bucket === 'orders') loadOrders({ reset: true });
        else if (bucket === 'withdrawals') loadWithdrawals({ reset: true });
        else if (bucket === 'security') loadSecurityAlerts({ reset: true });
        else if (bucket === 'postbacks') loadPostbacks({ reset: true });
        else if (bucket === 'audit') loadAuditLogs({ reset: true });
        else loadUsers({ reset: true });
      }, 350);
    });

    // Đổi bộ lọc trạng thái
    document.addEventListener('change', (event) => {
      const id = event.target && event.target.id;
      if (id === 'adm-orders-status') {
        state.orders.status = event.target.value;
        loadOrders({ reset: true });
      } else if (id === 'adm-wd-status') {
        state.withdrawals.status = event.target.value;
        loadWithdrawals({ reset: true });
      } else if (id === 'adm-reset-status') {
        state.resets.status = event.target.value;
        resetArmed = null;
        loadResets({ reset: true });
      } else if (id === 'adm-security-status') {
        state.security.status = event.target.value;
        loadSecurityAlerts({ reset: true });
      } else if (id === 'adm-pb-status') {
        state.postbacks.status = event.target.value;
        loadPostbacks({ reset: true });
      } else if (id === 'adm-pb-only') {
        state.postbacks.only = event.target.value;
        loadPostbacks({ reset: true });
      }
    });

    // Đóng modal bằng Esc
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      ['adm-order-modal', 'adm-wd-modal', 'adm-user-modal', 'adm-reset-modal', 'adm-pb-modal'].forEach((id) => {
        const modal = document.getElementById(id);
        if (modal && !modal.classList.contains('hidden')) closeModal(id);
      });
    });
  }

  async function reloadAll() {
    state.orders = { items: [], total: 0, q: '', status: '', offset: 0, loading: false };
    state.withdrawals = { items: [], total: 0, q: '', status: '', offset: 0, loading: false };
    state.users = { items: [], total: 0, q: '', offset: 0, loading: false };
    state.security = {
      items: [],
      total: 0,
      q: '',
      status: 'new',
      offset: 0,
      loading: false,
      stats: { total: 0, open: 0 }
    };
    state.referrals = { items: [], total: 0, offset: 0, loading: false };
    state.resets = { items: [], total: 0, status: RESET_PENDING, offset: 0, loading: false };
    state.postbacks = {
      items: [],
      total: 0,
      q: '',
      status: '',
      only: '',
      offset: 0,
      loading: false,
      stats: { total: 0, matched: 0, unmatched: 0, refused: 0, rewardTotal: 0, approvedTotal: 0, pendingTotal: 0 }
    };
    state.audit = { items: [], total: 0, q: '', offset: 0, loading: false };
    resetArmed = null;

    const ordersSearch = document.getElementById('adm-orders-search');
    const ordersStatus = document.getElementById('adm-orders-status');
    const wdSearch = document.getElementById('adm-wd-search');
    const wdStatus = document.getElementById('adm-wd-status');
    const usersSearch = document.getElementById('adm-users-search');
    const securitySearch = document.getElementById('adm-security-search');
    const securityStatus = document.getElementById('adm-security-status');
    const resetStatus = document.getElementById('adm-reset-status');
    const pbSearch = document.getElementById('adm-pb-search');
    const pbStatus = document.getElementById('adm-pb-status');
    const pbOnly = document.getElementById('adm-pb-only');
    const auditSearch = document.getElementById('adm-audit-search');
    if (ordersSearch) ordersSearch.value = '';
    if (ordersStatus) ordersStatus.value = '';
    if (wdSearch) wdSearch.value = '';
    if (wdStatus) wdStatus.value = '';
    if (usersSearch) usersSearch.value = '';
    if (securitySearch) securitySearch.value = '';
    if (securityStatus) securityStatus.value = 'new';
    if (resetStatus) resetStatus.value = RESET_PENDING;
    if (pbSearch) pbSearch.value = '';
    if (pbStatus) pbStatus.value = '';
    if (pbOnly) pbOnly.value = '';
    if (auditSearch) auditSearch.value = '';

    await Promise.all([
      loadOverview(),
      loadOrders({ reset: true }),
      loadWithdrawals({ reset: true }),
      loadUsers({ reset: true }),
      loadSecurityAlerts({ reset: true }),
      loadReferrals({ reset: true }),
      loadResets({ reset: true }),
      loadPostbacks({ reset: true }),
      loadAuditLogs({ reset: true })
    ]);
  }

  /* ==========================================
     Điểm vào — được script.js gọi mỗi lần mở trang
  ========================================== */

  window.initAdminPage = function () {
    bindEvents();
    setTab('orders');

    state.orders = { items: [], total: 0, q: '', status: '', offset: 0, loading: false };
    state.withdrawals = { items: [], total: 0, q: '', status: '', offset: 0, loading: false };
    state.users = { items: [], total: 0, q: '', offset: 0, loading: false };
    state.security = {
      items: [],
      total: 0,
      q: '',
      status: 'new',
      offset: 0,
      loading: false,
      stats: { total: 0, open: 0 }
    };
    state.referrals = { items: [], total: 0, offset: 0, loading: false };
    state.resets = { items: [], total: 0, status: RESET_PENDING, offset: 0, loading: false };
    state.postbacks = {
      items: [],
      total: 0,
      q: '',
      status: '',
      only: '',
      offset: 0,
      loading: false,
      stats: { total: 0, matched: 0, unmatched: 0, refused: 0, rewardTotal: 0, approvedTotal: 0, pendingTotal: 0 }
    };
    state.editing = { order: null, withdrawal: null, user: null };
    state.audit = { items: [], total: 0, q: '', offset: 0, loading: false };
    resetArmed = null;

    // Tab đang hiển thị tải ngay, các tab khác tải khi bấm vào (xem setTab)
    loadOverview();
    loadOrders({ reset: true });

    if (typeof lucide !== 'undefined') lucide.createIcons();
  };
})();
