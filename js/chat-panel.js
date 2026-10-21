/* The Foundry — slide-in community chat panel.
 * Floating 💬 button on the right edge opens a drawer from the right.
 * Unread badge counts messages newer than the last time the panel was opened.
 * Pages that already host a full chat (#tv-chat) are skipped — no double subscriptions. */
(function () {
  'use strict';

  var LS_SEEN = 'tv-chat-last-seen';
  var rendered = false;
  var panelOpen = false;
  var els = {};
  var reducedMotion = false;

  function lastSeen() {
    try {
      var v = parseInt(localStorage.getItem(LS_SEEN) || '0', 10);
      return isNaN(v) ? 0 : v;
    } catch (e) { return 0; }
  }
  function markSeen() {
    try { localStorage.setItem(LS_SEEN, String(Date.now())); } catch (e) {}
  }

  function build() {
    if (document.getElementById('tv-chat-fab')) return;
    /* floating button */
    var fab = document.createElement('button');
    fab.id = 'tv-chat-fab';
    fab.setAttribute('aria-label', 'Open community chat');
    fab.title = 'Community chat';
    fab.innerHTML = '<span class="tv-chat-fab-icon">💬</span>' +
      '<span id="tv-chat-badge" class="tv-chat-badge" hidden></span>';
    /* backdrop (mobile) */
    var backdrop = document.createElement('div');
    backdrop.id = 'tv-chat-backdrop';
    backdrop.hidden = true;
    /* panel */
    var panel = document.createElement('aside');
    panel.id = 'tv-chat-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Community chat');
    panel.innerHTML =
      '<div class="tv-chat-panel-head">' +
        '<h2>💬 Community chat</h2>' +
        '<button id="tv-chat-close" aria-label="Close chat">⌄</button>' +
      '</div>' +
      '<div id="tv-chat-panel-body" class="tv-chat-panel-body">' +
        '<div class="loading">Connecting to chat…</div>' +
      '</div>';
    document.body.appendChild(fab);
    document.body.appendChild(backdrop);
    document.body.appendChild(panel);
    els.fab = fab; els.badge = fab.querySelector('#tv-chat-badge');
    els.backdrop = backdrop; els.panel = panel;
    els.body = panel.querySelector('#tv-chat-panel-body');

    fab.addEventListener('click', function () { panelOpen ? close() : open(); });
    panel.querySelector('#tv-chat-close').addEventListener('click', close);
    backdrop.addEventListener('click', close);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && panelOpen) close();
    });
  }

  function open() {
    build();
    panelOpen = true;
    els.panel.classList.add('open');
    els.backdrop.hidden = false;
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { els.backdrop.classList.add('show'); });
    });
    document.body.classList.add('tv-chat-lock');
    /* clear unread */
    els.badge.hidden = true;
    els.badge.textContent = '';
    markSeen();
    /* render chat once */
    if (!rendered && window.TVChat) {
      if (!window.TVChat.isConfigured()) {
        els.body.innerHTML = window.TVChat.placeholderHTML();
        rendered = true;
      } else {
        window.TVChat.ensureDB(function (err, db) {
          if (err || !document.body.contains(els.body)) return;
          window.TVChat.renderInto(els.body, db, { limit: 30, showOnline: true });
          rendered = true;
        });
      }
    }
  }

  function close() {
    if (!els.panel) return;
    panelOpen = false;
    els.panel.classList.remove('open');
    els.backdrop.classList.remove('show');
    setTimeout(function () {
      if (!panelOpen && els.backdrop) els.backdrop.hidden = true;
    }, reducedMotion ? 0 : 300);
    document.body.classList.remove('tv-chat-lock');
    markSeen();
  }

  /* unread badge: count messages newer than lastSeen while panel is closed */
  function watchUnread() {
    if (!window.TVChat || !window.TVChat.isConfigured()) return;
    if (!lastSeen()) markSeen(); /* first run: don't count backlog */
    window.TVChat.ensureDB(function (err, db) {
      if (err) return;
      db.collection('chat').orderBy('ts', 'desc').limit(30)
        .onSnapshot(function (snap) {
          if (panelOpen || !els.badge) return;
          var seen = lastSeen();
          var n = 0;
          snap.forEach(function (doc) {
            try {
              var d = doc.data();
              var t = d.ts && d.ts.toDate ? d.ts.toDate().getTime() : 0;
              if (t > seen) n++;
            } catch (e) {}
          });
          if (n > 0) {
            els.badge.textContent = n > 99 ? '99+' : String(n);
            els.badge.hidden = false;
          } else {
            els.badge.hidden = true;
          }
        }, function () { /* silent */ });
    });
  }

  function init() {
    try {
      reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) { reducedMotion = false; }
    /* pages with their own chat don't need the panel */
    if (document.getElementById('tv-chat')) return;
    if (!window.TVChat) return;
    build();
    watchUnread();
    window.TV = window.TV || {};
    window.TV.chatPanel = { open: open, close: close };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
