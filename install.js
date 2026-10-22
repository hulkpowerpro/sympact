(() => {
  'use strict';
  const btn = document.getElementById('installAppBtn');
  const status = document.getElementById('installAppStatus');
  if (!btn) return;
  let deferredPrompt = null;
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const setBtn = (label, disabled=false) => {
    const span = btn.querySelector('span');
    if (span) span.textContent = label;
    btn.disabled = disabled;
  };
  if (isStandalone()) {
    setBtn('已安装', true);
    if (status) status.textContent = 'SYMPACT 已作为独立应用运行';
  }
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    setBtn('安装 SYMPACT', false);
    if (status) status.textContent = '可安装到桌面或主屏幕';
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    setBtn('已安装', true);
    if (status) status.textContent = '安装完成，可从设备桌面启动';
  });
  btn.addEventListener('click', async () => {
    if (isStandalone()) {
      window.alert('SYMPACT 已经安装在这台设备上。');
      return;
    }
    if (deferredPrompt) {
      deferredPrompt.prompt();
      try {
        const result = await deferredPrompt.userChoice;
        if (result && result.outcome === 'accepted') {
          setBtn('正在安装…', true);
          if (status) status.textContent = '请按浏览器提示完成安装';
        } else {
          if (status) status.textContent = '可以稍后再安装';
        }
      } catch (_) {}
      deferredPrompt = null;
      return;
    }
    const ua = navigator.userAgent || '';
    const ios = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const safari = /Safari/i.test(ua) && !/Chrome|CriOS|Edg|OPR|FxiOS/i.test(ua);
    if (ios) {
      window.alert('iPhone / iPad 安装方法：\n1. 使用 Safari 打开 SYMPACT 网页（需要 HTTPS 地址）。\n2. 点击“分享”按钮。\n3. 选择“添加到主屏幕”。\n4. 点击“添加”。\n\n安装后可以像普通 App 一样从主屏幕打开。');
    } else if (safari && /Macintosh/i.test(ua)) {
      window.alert('Mac Safari 安装方法：在 Safari 中打开 SYMPACT 的 HTTPS 地址，然后选择“文件 → 添加到程序坞”。也可以使用 Chrome 或 Edge 的“安装 SYMPACT”功能。');
    } else if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
      window.alert('安装式 App 需要从 HTTPS 网站打开。\n\n当前如果是直接双击 HTML 文件，计算工具仍可用，但浏览器不会启用完整的 PWA 安装与离线缓存。请先把项目发布到免费的 HTTPS 静态网站；项目包内附有 Codex 与 GitHub Pages 说明。');
    } else {
      window.alert('请使用最新版 Chrome 或 Edge，并在浏览器地址栏右侧或菜单中查找“安装 SYMPACT / 安装应用”。如果没有该选项，请先通过 HTTPS 或 localhost 打开网页，并刷新一次。');
    }
  });
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./service-worker.js', { scope: './' }).catch((err) => {
        console.warn('SYMPACT offline shell could not be registered:', err);
        if (status && !isStandalone()) status.textContent = '网页可用；离线安装需要 HTTPS 或 localhost';
      });
    });
  }
})();
