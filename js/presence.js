/* The Foundry — live presence + page-view analytics (Firebase Firestore).
 * No login, no cookies, no cross-session tracking.
 * Gracefully does nothing when Firebase isn't configured. */
(function () {
  'use strict';

  var PAGE_NAMES = {
    'index.html': 'Home',
    'warframes.html': 'Warframes',
    'weapons.html': 'Weapons',
    'mods.html': 'Mods',
    'arcanes.html': 'Arcanes',
    'relics.html': 'Relics',
    'amps.html': 'Amps',
    'operators.html': 'Operators',
    'builds.html': 'Builds',
    'farming.html': 'Farming Hub',
    'trading.html': 'Trading',
    'marketplace.html': 'Market Board',
    'live.html': 'Live',
    'videos.html': 'Videos',
    'guides.html': 'Guides',
    'donate.html': 'Donate'
  };

  function pageName() {
    var p = location.pathname.split('/').pop() || 'index.html';
    return p.split('?')[0].split('#')[0] || 'index.html';
  }

  function friendlyName(p) {
    return PAGE_NAMES[p] || p.replace('.html', '').replace(/-/g, ' ');
  }

  function firebaseReady() {
    return !!(window.TV_FIREBASE_READY && window.TV_FIREBASE_CONFIG &&
      window.TV_FIREBASE_CONFIG.apiKey &&
      window.TV_FIREBASE_CONFIG.apiKey.indexOf('PASTE_') !== 0);
  }

  function loadSDK(cb) {
    if (window.firebase && firebase.apps.length) return cb();
    if (window._tvFbLoading) {
      var t = setInterval(function () {
        if (window.firebase && firebase.apps.length) { clearInterval(t); cb(); }
      }, 300);
      setTimeout(function () { clearInterval(t); }, 8000);
      return;
    }
    window._tvFbLoading = true;
    var files = [
      'https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js',
      'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js'
    ];
    (function next(i) {
      if (i >= files.length) {
        window._tvFbLoading = false;
        try {
          if (!firebase.apps.length) firebase.initializeApp(window.TV_FIREBASE_CONFIG);
        } catch (e) { return; }
        return cb();
      }
      var s = document.createElement('script');
      s.src = files[i];
      s.onload = function () { next(i + 1); };
      s.onerror = function () { window._tvFbLoading = false; };
      document.head.appendChild(s);
    })(0);
  }

  function visitorId() {
    try {
      var id = sessionStorage.getItem('tv-visitor');
      if (!id) {
        id = 'v' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
        sessionStorage.setItem('tv-visitor', id);
      }
      return id;
    } catch (e) {
      return 'v' + Math.random().toString(36).slice(2, 12);
    }
  }

  function init(db) {
    var id = visitorId();
    var ref = db.collection('presence').doc(id);

    function heartbeat() {
      try {
        ref.set({ ts: firebase.firestore.FieldValue.serverTimestamp() }).catch(function () {});
      } catch (e) {}
    }
    heartbeat();
    setInterval(heartbeat, 30000);

    /* remove our doc when the tab closes */
    function bye() {
      try { ref.delete().catch(function () {}); } catch (e) {}
    }
    window.addEventListener('pagehide', bye);
    window.addEventListener('beforeunload', bye);

    /* count this page view */
    try {
      db.collection('pageViews').doc(pageName()).set({
        count: firebase.firestore.FieldValue.increment(1),
        name: friendlyName(pageName())
      }, { merge: true }).catch(function () {});
    } catch (e) {}

    /* live headcount in the header */
    var el = document.getElementById('tv-online');
    if (el) {
      try {
        db.collection('presence').onSnapshot(function (snap) {
          var cutoff = Date.now() - 90000;
          var n = 0;
          snap.forEach(function (doc) {
            var d = doc.data();
            try {
              var t = d.ts && d.ts.toDate ? d.ts.toDate().getTime() : 0;
              if (t > cutoff) n++;
            } catch (e2) {}
          });
          el.textContent = '🟢 ' + n + (n === 1 ? ' Tenno online' : ' Tenno online');
          el.style.display = '';
          window.TV = window.TV || {};
          window.TV._onlineCount = n;
          /* notify live listeners (mentor badge, chat header) instantly */
          try {
            var evt = new CustomEvent('tv-online-count', { detail: { count: n } });
            document.dispatchEvent(evt);
          } catch (e2) {}
        }, function () { el.style.display = 'none'; });
      } catch (e) { el.style.display = 'none'; }
    }

    /* expose live count for the mentor character */
    window.TV = window.TV || {};
    window.TV.getOnlineCount = function () { return window.TV._onlineCount || 0; };
  }

  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* expose page-name helper for other scripts */
  window.TVPresence = { pageName: pageName, friendlyName: friendlyName };

  document.addEventListener('DOMContentLoaded', function () {
    if (!firebaseReady()) return; /* silent — no placeholder needed, features just stay hidden */
    loadSDK(function () {
      try { init(firebase.firestore()); } catch (e) {}
    });
  });
})();
