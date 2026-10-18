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
  const TABS = ['orders', 'withdrawals', 'users', 'referrals'];

  const state = {
    tab: 'orders',
    orders: { items: [], total: 0, q: '', status: '', offset: 0, loading: false },
    withdrawals: { items: [], total: 0, q: '', status: '', offset: 0, loading: false },
    users: { items: [], total: 0, q: '', offset: 0, loading: false },
    referrals: { items: [], total: 0, offset: 0, loading: false },
    editing: { order: null, withdrawal: null, user: null }
  };

  let listenersBound = false;
  let searchTimer = null;

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
    setText('adm-stat-pending-note', data.orders.paid + ' đã thanh toán');
    setText('adm-stat-wd-pending', data.withdrawals.pending);
    setText('adm-stat-wd-note', data.withdrawals.total + ' lệnh rút');
    setText('adm-stat-commission', formatCurrency(data.money.totalCommission));
    setText('adm-stat-commission-note', 'Còn phải trả ' + formatCurrency(data.money.systemBalance));
    setText('adm-stat-paid', formatCurrency(data.money.totalPaidOut));
    setText('adm-stat-paid-note', data.referrals.points + ' điểm giới thiệu');
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
      showToast(err.message, 'error');
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
          <a href="${escapeHtml(o.link)}" target="_blank" rel="noopener" class="text-[11px] text-red-500 hover:underline break-all">Xem link sản phẩm</a>
        </td>
        <td class="px-3 py-3">
          <div class="font-semibold text-slate-700">${escapeHtml(o.user.name)}</div>
          <div class="text-xs text-slate-400">${escapeHtml(o.user.username)}</div>
        </td>
        <td class="px-3 py-3 text-slate-600">${escapeHtml(o.platform)}</td>
        <td class="px-3 py-3 font-semibold text-emerald-600">${formatCurrency(o.commission)}</td>
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

    setText('adm-order-info', `${order.user.name} (${order.user.username}) — ${order.platform}`);
    const link = document.getElementById('adm-order-link');
    if (link) {
      link.href = order.link;
      link.innerText = order.link;
      link.classList.remove('hidden');
    }

    const statusEl = document.getElementById('adm-order-status');
    const commissionEl = document.getElementById('adm-order-commission');
    if (statusEl) statusEl.value = order.status;
    if (commissionEl) commissionEl.value = String(order.commission || 0);

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
      showToast(err.message, 'error');
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
      showToast(err.message, 'error');
    } finally {
      s.loading = false;
    }
  }

  function renderWithdrawals() {
    const tbody = document.getElementById('adm-wd-body');
    if (!tbody) return;
    const { items, total } = state.withdrawals;

    tbody.innerHTML = items
      .map(
        (w) => `
      <tr class="border-b border-slate-50 hover:bg-slate-50/60">
        <td class="px-3 py-3 font-bold text-slate-700">${escapeHtml(w.id)}</td>
        <td class="px-3 py-3">
          <div class="font-semibold text-slate-700">${escapeHtml(w.user.name)}</div>
          <div class="text-xs text-slate-400">${escapeHtml(w.user.username)}</div>
        </td>
        <td class="px-3 py-3">
          <div class="font-semibold text-slate-700">${escapeHtml(w.bank)}</div>
          <div class="text-xs text-slate-400">${escapeHtml(w.accNum)} — ${escapeHtml((w.accName || '').toUpperCase())}</div>
        </td>
        <td class="px-3 py-3 font-semibold text-slate-700">${formatCurrency(w.amount)}</td>
        <td class="px-3 py-3 text-slate-600">${formatCurrency(w.payable)}</td>
        <td class="px-3 py-3">${badge(w.status)}</td>
        <td class="px-3 py-3 text-xs text-slate-400">${escapeHtml(w.date)}</td>
        <td class="px-3 py-3 text-right">${actionButton('data-adm-edit-wd', w.id, 'Xử lý', 'text-emerald-600 bg-emerald-50 hover:bg-emerald-100')}</td>
      </tr>`
      )
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

    setText('adm-wd-info', `${wd.user.name} (${wd.user.username}) — ${wd.bank} ${wd.accNum}`);
    const statusEl = document.getElementById('adm-wd-status');
    const amountEl = document.getElementById('adm-wd-amount');
    if (statusEl) statusEl.value = wd.status;
    if (amountEl) amountEl.value = String(wd.amount > 0 ? wd.amount : wd.payable);
    setText('adm-wd-payable', 'Số dư khả dụng: ' + formatCurrency(wd.payable));

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
      showToast(err.message, 'error');
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
      showToast(err.message, 'error');
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
        <td class="px-3 py-3">${roleBadge(u.role)}</td>
        <td class="px-3 py-3 font-semibold text-slate-700">${u.points}</td>
        <td class="px-3 py-3 text-slate-600">${u.orderCount} <span class="text-xs text-slate-400">(${u.pendingCount} chờ)</span></td>
        <td class="px-3 py-3 font-semibold text-emerald-600">${formatCurrency(u.commission)}</td>
        <td class="px-3 py-3 text-slate-600">${formatCurrency(u.withdrawn)}</td>
        <td class="px-3 py-3 font-bold text-slate-800">${formatCurrency(u.balance)}</td>
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
      showToast(err.message, 'error');
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
      showToast(err.message, 'error');
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
      showToast(err.message, 'error');
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
      else if (tab === 'referrals' && state.referrals.items.length === 0) loadReferrals({ reset: true });
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

      if (event.target.closest('#adm-reload')) {
        event.preventDefault();
        return reloadAll();
      }
      if (event.target.closest('#adm-orders-more')) return loadOrders();
      if (event.target.closest('#adm-wd-more')) return loadWithdrawals();
      if (event.target.closest('#adm-users-more')) return loadUsers();
      if (event.target.closest('#adm-ref-more')) return loadReferrals();
      if (event.target.closest('#adm-order-save')) return saveOrder();
      if (event.target.closest('#adm-wd-save')) return saveWithdrawal();
      if (event.target.closest('#adm-user-save')) return saveUser();
      if (event.target.closest('#adm-user-delete')) return handleDeleteClick();
    });

    // Gõ tìm kiếm (chờ 350ms sau lần gõ cuối)
    document.addEventListener('input', (event) => {
      const id = event.target && event.target.id;
      const targets = {
        'adm-orders-search': ['orders', 'q'],
        'adm-wd-search': ['withdrawals', 'q'],
        'adm-users-search': ['users', 'q']
      };
      const target = targets[id];
      if (!target) return;

      const [bucket, field] = target;
      state[bucket][field] = event.target.value.trim();

      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        if (bucket === 'orders') loadOrders({ reset: true });
        else if (bucket === 'withdrawals') loadWithdrawals({ reset: true });
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
      }
    });

    // Đóng modal bằng Esc
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      ['adm-order-modal', 'adm-wd-modal', 'adm-user-modal'].forEach((id) => {
        const modal = document.getElementById(id);
        if (modal && !modal.classList.contains('hidden')) closeModal(id);
      });
    });
  }

  async function reloadAll() {
    state.orders = { items: [], total: 0, q: '', status: '', offset: 0, loading: false };
    state.withdrawals = { items: [], total: 0, q: '', status: '', offset: 0, loading: false };
    state.users = { items: [], total: 0, q: '', offset: 0, loading: false };
    state.referrals = { items: [], total: 0, offset: 0, loading: false };

    const ordersSearch = document.getElementById('adm-orders-search');
    const ordersStatus = document.getElementById('adm-orders-status');
    const wdSearch = document.getElementById('adm-wd-search');
    const wdStatus = document.getElementById('adm-wd-status');
    const usersSearch = document.getElementById('adm-users-search');
    if (ordersSearch) ordersSearch.value = '';
    if (ordersStatus) ordersStatus.value = '';
    if (wdSearch) wdSearch.value = '';
    if (wdStatus) wdStatus.value = '';
    if (usersSearch) usersSearch.value = '';

    await Promise.all([
      loadOverview(),
      loadOrders({ reset: true }),
      loadWithdrawals({ reset: true }),
      loadUsers({ reset: true }),
      loadReferrals({ reset: true })
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
    state.referrals = { items: [], total: 0, offset: 0, loading: false };
    state.editing = { order: null, withdrawal: null, user: null };

    // Tab đang hiển thị tải ngay, các tab khác tải khi bấm vào (xem setTab)
    loadOverview();
    loadOrders({ reset: true });

    if (typeof lucide !== 'undefined') lucide.createIcons();
  };
})();
