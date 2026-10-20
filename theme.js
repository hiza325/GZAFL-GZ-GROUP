/* ============================================================
   GZ AFL — chuyển đổi giao diện sáng / tối
   - Nạp trong <head> để áp dụng class `dark` trước khi CSS vẽ,
     tránh hiện tượng nháy trắng khi tải lại trang ở chế độ tối.
   - Lưu lựa chọn vào localStorage; lần đầu theo cài đặt hệ thống.
   ============================================================ */
(function () {
  'use strict';

  const STORAGE_KEY = 'gzafl_theme';
  const root = document.documentElement;
  const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  let current = 'light';

  function normalize(theme) {
    return theme === 'dark' ? 'dark' : 'light';
  }

  function readStored() {
    try {
      const value = window.localStorage.getItem(STORAGE_KEY);
      if (value === 'dark' || value === 'light') return value;
    } catch (err) {
      /* Trình duyệt chặn localStorage: dùng cài đặt hệ thống. */
    }
    return null;
  }

  function systemTheme() {
    return media && media.matches ? 'dark' : 'light';
  }

  function labelFor(theme) {
    const key = theme === 'dark' ? 'theme.toLight' : 'theme.toDark';
    const landing = document.getElementById('landing-root');
    const landingActive = !!landing && !landing.classList.contains('hidden');

    // Trang chủ/khung đăng nhập đã có bản dịch VI/EN; các trang app hiện vẫn
    // là tiếng Việt nên giữ nhãn tiếng Việt cho đồng bộ.
    if (landingActive && window.GZ_I18N && typeof window.GZ_I18N.t === 'function') {
      return window.GZ_I18N.t(key);
    }
    return theme === 'dark' ? 'Chuyển sang chế độ sáng' : 'Chuyển sang chế độ tối';
  }

  function updateMeta(theme) {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0b1220' : '#18253f');
  }

  function updateButtons() {
    const label = labelFor(current);
    document.querySelectorAll('[data-theme-toggle]').forEach(function (button) {
      button.setAttribute('aria-pressed', current === 'dark' ? 'true' : 'false');
      button.setAttribute('aria-label', label);
      button.setAttribute('title', label);
    });
  }

  function apply(theme, options) {
    current = normalize(theme);
    root.classList.toggle('dark', current === 'dark');
    root.setAttribute('data-theme', current);
    root.style.colorScheme = current;
    updateMeta(current);
    updateButtons();

    if (!options || options.persist !== false) {
      try {
        window.localStorage.setItem(STORAGE_KEY, current);
      } catch (err) {
        /* Không lưu được: vẫn đổi giao diện trong phiên hiện tại. */
      }
    }

    if (!options || options.notify !== false) {
      window.dispatchEvent(new CustomEvent('themechange', { detail: { theme: current } }));
    }
  }

  function toggle() {
    apply(current === 'dark' ? 'light' : 'dark');
  }

  // Áp dụng ngay khi script được nạp (trước CSS) để tránh nháy màu.
  current = normalize(readStored() || systemTheme());
  root.classList.toggle('dark', current === 'dark');
  root.setAttribute('data-theme', current);
  root.style.colorScheme = current;

  function onReady() {
    updateMeta(current);
    updateButtons();

    // Nếu người dùng chưa tự chọn, theo dõi thay đổi cài đặt hệ thống.
    if (media) {
      const onChange = function (event) {
        if (readStored()) return;
        apply(event.matches ? 'dark' : 'light', { persist: false });
      };
      if (media.addEventListener) media.addEventListener('change', onChange);
      else if (media.addListener) media.addListener(onChange);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }

  // Cập nhật nhãn nút khi người dùng chuyển ngôn ngữ VI / EN.
  window.addEventListener('languagechange', updateButtons);

  // Đồng bộ khi người dùng đổi giao diện ở một tab khác của cùng trình duyệt.
  window.addEventListener('storage', function (event) {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    const saved = readStored();
    apply(saved || systemTheme(), { persist: false });
  });

  window.GZ_THEME = {
    getTheme: function () { return current; },
    setTheme: function (theme, options) { apply(theme, options); },
    toggle: toggle,
    updateButtons: updateButtons
  };
})();
