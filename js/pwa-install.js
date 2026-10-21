/* The Foundry — smart PWA install UX.
   - Shows a dismissible install banner in #tv-install-slot (homepage hero)
   - Shows a subtle install icon-button in the site header (all pages)
   - Only when the app is NOT already installed
   - iOS (no beforeinstallprompt): shows Share → Add to Home Screen instructions
   - Dismissal remembered in localStorage
   Vanilla JS, no dependencies. */
(function () {
  'use strict';

  var DISMISS_KEY = 'tv-install-dismissed';
  var INSTALLED_KEY = 'tv-installed';
  var deferredPrompt = null;

  function isInstalled() {
    try {
      if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
      if (window.matchMedia && window.matchMedia('(display-mode: fullscreen)').matches) return true;
      if (window.navigator.standalone === true) return true; /* iOS Safari */
      if (document.referrer && document.referrer.indexOf('android-app://') === 0) return true;
      if (localStorage.getItem(INSTALLED_KEY) === '1') return true;
    } catch (e) { /* ignore */ }
    return false;
  }

  function isIOS() {
    var ua = navigator.userAgent || '';
    return /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function isDismissed() {
    try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch (e) { return false; }
  }

  function markInstalled() {
    try { localStorage.setItem(INSTALLED_KEY, '1'); } catch (e) {}
    hideAll();
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* ---------- install modal (instructions) ---------- */
  function ensureModal() {
    var m = document.getElementById('tv-install-modal');
    if (m) return m;
    var ios = isIOS();
    var steps = ios
      ? '<li>Tap the <b>Share</b> button in Safari <span class="tv-share-ico">⎙</span></li>' +
        '<li>Scroll down and tap <b>Add to Home Screen</b></li>' +
        '<li>Tap <b>Add</b> — the Vault lands on your home screen</li>'
      : '<li>Open your browser menu <b>⋮</b></li>' +
        '<li>Tap <b>Install app</b> / <b>Add to Home Screen</b></li>' +
        '<li>Confirm — the Vault lands on your home screen</li>';
    m = document.createElement('div');
    m.id = 'tv-install-modal';
    m.className = 'tv-modal';
    m.setAttribute('hidden', '');
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-label', 'Install The Foundry');
    m.innerHTML =
      '<div class="tv-modal-card holo">' +
        '<h3>📲 Install The Foundry</h3>' +
        '<p class="muted small">Get the app icon on your home screen for one-tap access.</p>' +
        '<ol>' + steps + '</ol>' +
        '<button class="btn primary" id="tv-install-modal-close" style="width:100%;min-height:44px">Got it</button>' +
      '</div>';
    document.body.appendChild(m);
    m.addEventListener('click', function (e) {
      if (e.target === m || e.target.id === 'tv-install-modal-close') hideModal();
    });
    return m;
  }
  function showModal() {
    var m = ensureModal();
    m.removeAttribute('hidden');
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { m.classList.add('open'); });
    });
  }
  function hideModal() {
    var m = document.getElementById('tv-install-modal');
    if (!m) return;
    m.classList.remove('open');
    setTimeout(function () {
      if (!m.classList.contains('open')) m.setAttribute('hidden', '');
    }, 260);
  }

  /* ---------- install action ---------- */
  function doInstall() {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function (choice) {
        if (choice && choice.outcome === 'accepted') markInstalled();
        deferredPrompt = null;
      }).catch(function () { deferredPrompt = null; });
    } else {
      showModal();
    }
  }
  /* compat shim for any lingering onclick="triggerPwaInstall()" */
  window.triggerPwaInstall = doInstall;

  /* ---------- banner (homepage hero slot) ---------- */
  function renderBanner() {
    var slot = document.getElementById('tv-install-slot');
    if (!slot || isDismissed()) return;
    slot.innerHTML =
      '<div class="tv-install-banner" role="complementary" aria-label="Install The Foundry app">' +
        '<div class="tv-install-icon" aria-hidden="true">📲</div>' +
        '<div class="tv-install-text"><b>Get The Foundry app</b>' +
        '<span>One tap from your home screen. Works offline.</span></div>' +
        '<button class="btn primary" id="tv-install-go">Install</button>' +
        '<button class="tv-install-x" id="tv-install-dismiss" aria-label="Dismiss install prompt">✕</button>' +
      '</div>';
    document.getElementById('tv-install-go').addEventListener('click', doInstall);
    document.getElementById('tv-install-dismiss').addEventListener('click', function () {
      try { localStorage.setItem(DISMISS_KEY, '1'); } catch (e) {}
      var b = slot.querySelector('.tv-install-banner');
      if (b) b.remove();
    });
  }

  /* ---------- header button (all pages) ---------- */
  function renderHeaderButton() {
    var inner = document.querySelector('#site-header .header-inner');
    if (!inner || document.getElementById('tv-hinstall')) return;
    var btn = document.createElement('button');
    btn.id = 'tv-hinstall';
    btn.className = 'tv-hinstall show';
    btn.setAttribute('aria-label', 'Install The Foundry app');
    btn.setAttribute('title', 'Install app');
    btn.innerHTML = '📲';
    btn.addEventListener('click', doInstall);
    var donate = inner.querySelector('.donate-btn');
    if (donate) inner.insertBefore(btn, donate);
    else inner.appendChild(btn);
  }

  function hideAll() {
    var b = document.querySelector('.tv-install-banner');
    if (b) b.remove();
    var h = document.getElementById('tv-hinstall');
    if (h) h.remove();
    hideModal();
  }

  /* ---------- events ---------- */
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
  });
  window.addEventListener('appinstalled', markInstalled);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') hideModal();
  });

  /* ---------- init ---------- */
  function init() {
    if (isInstalled()) return; /* already an app — nothing to show */
    renderHeaderButton();
    renderBanner();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
