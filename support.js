/* ==========================================
   TRỢ LÝ HỖ TRỢ (chatbot) — khung chat ở góc phải-dưới mọi trang
   - Nạp components/support-widget.html rồi gắn sự kiện
   - Lịch sử hội thoại lưu ở localStorage (tải lại trang không mất)
   - Câu trả lời lấy từ POST /api/support/chat (xem backend/routes/support.js)
========================================== */

const SUPPORT_LS_KEY = 'gzafl_support_chat_v1';

const SUPPORT_MAX_STORED = 60;   // số tin nhắn lưu lại trong máy
const SUPPORT_SEND_HISTORY = 10; // số tin nhắn gửi kèm mỗi lần hỏi (tiết kiệm token)
const SUPPORT_MAX_MESSAGE_CHARS = 20000; // đủ cho câu trả lời AI dài, tránh bị cắt khi tải lại trang

// Dùng khi không gọi được /api/config (bình thường các giá trị này lấy từ server)
const SUPPORT_DEFAULT_SUGGESTIONS = [
  'Làm sao tạo đơn hoàn tiền?',
  'Khi nào hoa hồng vào ví?',
  'Rút tiền thế nào?',
  'Không nhận được mã OTP?'
];
const SUPPORT_DEFAULT_WELCOME =
  'Xin chào 👋 Mình là trợ lý ảo của GZ AFL. Bạn cần hỗ trợ gì?\n' +
  'Bạn có thể bấm một gợi ý bên dưới hoặc nhập câu hỏi của mình.';
// Dùng khi không gọi được /api/config. KHÔNG hard-code thông tin liên hệ cá nhân
// ở đây: thông tin thật lấy từ SUPPORT_EMAIL / SUPPORT_ZALO trong backend/.env.
const SUPPORT_DEFAULT_CONTACT = { email: '', zalo: '' };

let supportReady = false;      // đã nạp xong khung chat
let supportSending = false;    // đang chờ server trả lời
let supportClearArmed = false; // nút "Xoá hội thoại" đã được bấm lần đầu
let supportSeen = false;       // người dùng đã từng mở khung chat (để không nhấp nháy nút nữa)

let supportConfig = {
  ai: false,
  suggestions: SUPPORT_DEFAULT_SUGGESTIONS.slice(),
  welcome: SUPPORT_DEFAULT_WELCOME,
  contact: Object.assign({}, SUPPORT_DEFAULT_CONTACT)
};

let supportState = { open: false, messages: [] };

/* ==========================================
   TIỆN ÍCH RIÊNG CỦA KHUNG CHAT
========================================== */

function supportEl(id) {
  return document.getElementById(id);
}

// Bôi đậm **chữ** cho câu trả lời của trợ lý (đã escape HTML trước khi thay thế)
function supportBotTextHtml(text) {
  return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

// Lời chào đầu tiên (không lưu vào lịch sử gửi lên server)
function supportWelcomeMessage() {
  return { role: 'assistant', kind: 'welcome', content: supportConfig.welcome };
}

function supportContactMessage() {
  return { role: 'assistant', kind: 'contact', content: '' };
}

function supportLoadState() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(SUPPORT_LS_KEY) || 'null');
  } catch (err) {
    saved = null;
  }

  if (saved && Array.isArray(saved.messages) && saved.messages.length) {
    supportState = {
      open: Boolean(saved.open),
      messages: saved.messages
        .filter((msg) => msg && (msg.role === 'user' || msg.role === 'assistant'))
        .slice(-SUPPORT_MAX_STORED)
        .map((msg) => ({
          role: msg.role === 'user' ? 'user' : 'assistant',
          kind: msg.kind === 'contact' ? 'contact' : msg.kind === 'welcome' ? 'welcome' : 'text',
          content: String(msg.content == null ? '' : msg.content).slice(0, SUPPORT_MAX_MESSAGE_CHARS)
        }))
    };
    supportSeen = true;
    return;
  }

  supportState = { open: false, messages: [supportWelcomeMessage()] };
}

function supportSaveState() {
  try {
    localStorage.setItem(SUPPORT_LS_KEY, JSON.stringify({
      open: supportState.open,
      messages: supportState.messages.slice(-SUPPORT_MAX_STORED)
    }));
  } catch (err) {
    /* trình duyệt chặn localStorage (chế độ riêng tư) — bỏ qua, chat vẫn dùng được */
  }
}

// Danh sách tin nhắn gửi lên server: bỏ lời chào và thẻ liên hệ, chỉ lấy phần hội thoại thật
function supportPayload() {
  return supportState.messages
    .filter((msg) => msg.kind === 'text')
    .map((msg) => ({ role: msg.role, content: msg.content }))
    .slice(-SUPPORT_SEND_HISTORY);
}

/* ==========================================
   HIỂN THỊ
========================================== */

function supportMessageHtml(msg) {
  if (msg.kind === 'contact') return supportContactHtml();

  const isUser = msg.role === 'user';
  const bubble = isUser
    ? 'bg-[#18253f] text-white rounded-2xl rounded-br-md'
    : 'bg-white text-slate-700 border border-slate-100 rounded-2xl rounded-bl-md shadow-sm';

  const body = isUser ? escapeHtml(msg.content) : supportBotTextHtml(msg.content);

  return `
    <div class="flex ${isUser ? 'justify-end' : 'justify-start'}">
      <div class="max-w-[85%] px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-line ${bubble}">${body}</div>
    </div>`;
}

// Thẻ liên hệ hỗ trợ (nút copy nhanh) — hiện khi bấm "Liên hệ hỗ trợ"
function supportContactHtml() {
  const rows = [];

  if (supportConfig.contact.zalo) {
    rows.push(`
      <div class="flex items-center gap-2">
        <i data-lucide="headphones" class="w-4 h-4 text-red-500 flex-shrink-0"></i>
        <span class="flex-1 min-w-0 text-slate-700">Điện thoại / Zalo: <b>${escapeHtml(supportConfig.contact.zalo)}</b></span>
        <button type="button" data-support-copy="${escapeHtml(supportConfig.contact.zalo)}" class="text-[11px] font-semibold text-[#18253f] hover:text-red-500 transition flex-shrink-0">Sao chép</button>
      </div>`);
  }

  if (supportConfig.contact.email) {
    rows.push(`
      <div class="flex items-center gap-2">
        <i data-lucide="mail" class="w-4 h-4 text-red-500 flex-shrink-0"></i>
        <span class="flex-1 min-w-0 text-slate-700 break-all">Email: <b>${escapeHtml(supportConfig.contact.email)}</b></span>
        <button type="button" data-support-copy="${escapeHtml(supportConfig.contact.email)}" class="text-[11px] font-semibold text-[#18253f] hover:text-red-500 transition flex-shrink-0">Sao chép</button>
      </div>`);
  }

  if (!rows.length) {
    return `
      <div class="flex justify-start">
        <div class="max-w-[90%] w-full bg-white border border-slate-100 rounded-2xl rounded-bl-md shadow-sm px-3.5 py-3">
          <p class="text-sm text-slate-600">Chưa tải được thông tin liên hệ. Bạn thử lại sau ít phút, hoặc gửi câu hỏi ngay trong khung chat này nhé.</p>
        </div>
      </div>`;
  }

  return `
    <div class="flex justify-start">
      <div class="max-w-[90%] w-full bg-white border border-slate-100 rounded-2xl rounded-bl-md shadow-sm px-3.5 py-3 space-y-2.5">
        <p class="text-sm font-semibold text-slate-800">Liên hệ hỗ trợ trực tiếp</p>
        <div class="space-y-2 text-sm">${rows.join('')}</div>
        <p class="text-[11px] text-slate-400 leading-relaxed">Khi liên hệ, bạn gửi kèm tên đăng nhập và mã đơn (ví dụ GZ346578) để được kiểm tra nhanh hơn.</p>
      </div>
    </div>`;
}

function supportTypingHtml() {
  return `
    <div id="support-typing" class="flex justify-start">
      <div class="bg-white border border-slate-100 rounded-2xl rounded-bl-md shadow-sm px-4 py-3 flex items-center gap-1">
        <span class="w-1.5 h-1.5 rounded-full bg-slate-300 animate-bounce"></span>
        <span class="w-1.5 h-1.5 rounded-full bg-slate-300 animate-bounce" style="animation-delay:150ms"></span>
        <span class="w-1.5 h-1.5 rounded-full bg-slate-300 animate-bounce" style="animation-delay:300ms"></span>
      </div>
    </div>`;
}

function supportScrollToEnd() {
  const box = supportEl('support-messages');
  if (box) box.scrollTop = box.scrollHeight;
}

function supportRenderMessages() {
  const box = supportEl('support-messages');
  if (!box) return;
  box.innerHTML = supportState.messages.map(supportMessageHtml).join('');
  if (typeof lucide !== 'undefined') lucide.createIcons();
  supportScrollToEnd();
}

function supportRenderSuggestions() {
  const box = supportEl('support-suggestions');
  if (!box) return;

  box.innerHTML = supportConfig.suggestions
    .map((question) => `<button type="button" data-support-ask="${escapeHtml(question)}" class="flex-shrink-0 whitespace-nowrap text-xs font-medium bg-slate-50 border border-slate-200 hover:border-red-200 hover:bg-red-50 hover:text-red-500 text-slate-600 px-3 py-1.5 rounded-full transition">${escapeHtml(question)}</button>`)
    .join('');
}

function supportShowTyping() {
  const box = supportEl('support-messages');
  if (!box || supportEl('support-typing')) return;
  box.insertAdjacentHTML('beforeend', supportTypingHtml());
  supportScrollToEnd();
}

function supportHideTyping() {
  const typing = supportEl('support-typing');
  if (typing) typing.remove();
}

function supportSetSending(sending) {
  supportSending = sending;
  const send = supportEl('support-send');
  if (send) send.disabled = sending;
}

function supportPushMessage(message) {
  supportState.messages.push(message);
  supportState.messages = supportState.messages.slice(-SUPPORT_MAX_STORED);
  supportSaveState();
  supportRenderMessages();
}

function supportMarkSeen() {
  supportSeen = true;
  const dot = supportEl('support-fab-dot');
  if (dot) dot.classList.add('hidden');
}

/* ==========================================
   MỞ / ĐÓNG KHUNG CHAT
========================================== */

function supportTogglePanel(force) {
  const panel = supportEl('support-panel');
  const fab = supportEl('support-fab');
  if (!panel || !fab) return;

  const open = typeof force === 'boolean' ? force : panel.classList.contains('hidden');
  supportState.open = open;
  supportSaveState();

  if (open) {
    panel.classList.remove('hidden');
    panel.classList.add('flex');
    requestAnimationFrame(() => panel.classList.remove('opacity-0', 'translate-y-2', 'scale-95'));
    fab.setAttribute('aria-expanded', 'true');
    supportMarkSeen();
    supportScrollToEnd();
    const input = supportEl('support-input');
    if (input && window.innerWidth >= 640) input.focus();
  } else {
    panel.classList.add('opacity-0', 'translate-y-2', 'scale-95');
    fab.setAttribute('aria-expanded', 'false');
    setTimeout(() => {
      if (!supportState.open) {
        panel.classList.add('hidden');
        panel.classList.remove('flex');
      }
    }, 200);
  }
}

/* ==========================================
   GỬI CÂU HỎI
========================================== */

async function supportSendMessage(text) {
  const content = String(text == null ? '' : text).trim();
  if (!content || supportSending) return;

  const input = supportEl('support-input');
  if (input) {
    input.value = '';
    input.style.height = 'auto';
  }

  supportPushMessage({ role: 'user', kind: 'text', content });
  supportSetSending(true);
  supportShowTyping();

  try {
    const data = await api('/support/chat', {
      method: 'POST',
      body: { messages: supportPayload() }
    });

    supportHideTyping();

    let reply = String((data && data.reply) || '').trim();
    if (!reply) reply = 'Xin lỗi, mình chưa có câu trả lời cho câu hỏi này. Bạn thử hỏi lại hoặc bấm "Liên hệ hỗ trợ" nhé.';
    if (data && data.notice) reply += `\n\n(${data.notice})`;

    supportPushMessage({ role: 'assistant', kind: 'text', content: reply });
  } catch (err) {
    supportHideTyping();
    const message = (err && err.message) || 'Không gửi được câu hỏi.';
    supportPushMessage({
      role: 'assistant',
      kind: 'text',
      content: `${message}\n\nBạn thử lại sau ít phút, hoặc bấm "Liên hệ hỗ trợ" ở dưới để được giúp trực tiếp.`
    });
    if (typeof showToast === 'function') showToast(message, 'error');
  } finally {
    supportSetSending(false);
  }
}

/* ==========================================
   SAO CHÉP THÔNG TIN LIÊN HỆ
========================================== */

// Cách dự phòng cho trang chạy http thường (navigator.clipboard chỉ có ở https/localhost)
function supportCopyFallback(value) {
  const area = document.createElement('textarea');
  area.value = value;
  area.setAttribute('readonly', 'readonly');
  area.style.position = 'fixed';
  area.style.top = '-1000px';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();

  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch (err) {
    ok = false;
  }

  area.remove();
  return ok;
}

async function supportCopy(value, label) {
  let ok = false;

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      ok = true;
    } else {
      ok = supportCopyFallback(value);
    }
  } catch (err) {
    ok = supportCopyFallback(value);
  }

  if (typeof showToast !== 'function') return;
  if (ok) showToast(`Đã sao chép ${label}: ${value}`, 'success');
  else showToast(`Không sao chép tự động được. ${label}: ${value}`, 'error');
}

/* ==========================================
   XOÁ HỘI THOẠI (bấm 2 lần cho khỏi mất nhầm)
========================================== */

function supportClearChat() {
  if (!supportClearArmed) {
    supportClearArmed = true;
    if (typeof showToast === 'function') showToast('Bấm thêm 1 lần để xoá toàn bộ hội thoại.', 'info');
    setTimeout(() => { supportClearArmed = false; }, 4000);
    return;
  }

  supportClearArmed = false;
  supportState.messages = [supportWelcomeMessage()];
  supportSaveState();
  supportRenderMessages();
  if (typeof showToast === 'function') showToast('Đã xoá hội thoại.', 'success');
}

/* ==========================================
   GẮN SỰ KIỆN + KHỞI TẠO
========================================== */

function supportAutoGrow(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 112) + 'px';
}

function supportBindEvents() {
  const fab = supportEl('support-fab');
  const close = supportEl('support-close');
  const clear = supportEl('support-clear');
  const input = supportEl('support-input');
  const send = supportEl('support-send');
  const contact = supportEl('support-contact-btn');
  const suggestions = supportEl('support-suggestions');
  const messages = supportEl('support-messages');

  if (fab) fab.addEventListener('click', () => supportTogglePanel());
  if (close) close.addEventListener('click', () => supportTogglePanel(false));
  if (clear) clear.addEventListener('click', supportClearChat);

  if (send) {
    send.addEventListener('click', () => supportSendMessage(input ? input.value : ''));
  }

  if (input) {
    input.addEventListener('input', () => supportAutoGrow(input));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        supportSendMessage(input.value);
      }
    });
  }

  if (contact) {
    contact.addEventListener('click', () => {
      const last = supportState.messages[supportState.messages.length - 1];
      if (!last || last.kind !== 'contact') supportPushMessage(supportContactMessage());
      supportScrollToEnd();
    });
  }

  // Bấm vào gợi ý -> hỏi luôn câu đó
  if (suggestions) {
    suggestions.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-support-ask]');
      if (!btn) return;
      supportSendMessage(btn.dataset.supportAsk);
    });
  }

  // Nút copy trong thẻ liên hệ
  if (messages) {
    messages.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-support-copy]');
      if (!btn) return;
      supportCopy(btn.dataset.supportCopy, 'số liên hệ');
    });
  }

  // Esc để đóng khung chat
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const panel = supportEl('support-panel');
    if (panel && !panel.classList.contains('hidden')) supportTogglePanel(false);
  });
}

async function initSupportWidget() {
  if (supportReady || !supportEl('support-widget')) return;
  supportReady = true;

  // Lấy cấu hình công khai (câu hỏi gợi ý, lời chào, thông tin liên hệ, có AI hay không)
  try {
    const cfg = typeof fetchAppConfig === 'function' ? await fetchAppConfig() : null;
    const support = (cfg && cfg.support) || {};
    supportConfig = {
      ai: Boolean(support.ai),
      suggestions: Array.isArray(support.suggestions) && support.suggestions.length
        ? support.suggestions
        : SUPPORT_DEFAULT_SUGGESTIONS.slice(),
      welcome: support.welcome || SUPPORT_DEFAULT_WELCOME,
      contact: {
        email: support.email || SUPPORT_DEFAULT_CONTACT.email,
        zalo: support.zalo || SUPPORT_DEFAULT_CONTACT.zalo
      }
    };
  } catch (err) {
    /* giữ giá trị mặc định */
  }

  const badge = supportEl('support-badge');
  if (badge && supportConfig.ai) badge.classList.remove('hidden');

  supportLoadState();
  supportRenderMessages();
  supportRenderSuggestions();
  supportBindEvents();

  if (supportState.open) supportTogglePanel(true);

  // Nhấp nháy chấm đỏ mời mở chat (chỉ khi người dùng chưa từng mở lần nào)
  if (!supportSeen) {
    setTimeout(() => {
      const dot = supportEl('support-fab-dot');
      if (dot && !supportState.open) dot.classList.remove('hidden');
    }, 4000);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const host = document.getElementById('support-container');
  if (!host) return;

  try {
    if (typeof loadComponent === 'function') {
      await loadComponent('support-container', 'components/support-widget.html');
    } else {
      const res = await fetch('components/support-widget.html');
      host.innerHTML = await res.text();
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }
  } catch (err) {
    console.error('Không nạp được khung trợ lý hỗ trợ:', err);
    return;
  }

  await initSupportWidget();
});
