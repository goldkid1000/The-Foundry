/* The Foundry — community chat (Firebase Firestore).
 * Gracefully shows a "coming soon" placeholder when Firebase isn't configured.
 * Exposes window.TVChat for reuse (e.g. the slide-in chat panel). */
(function () {
  'use strict';
  var esc = function (s) { return window.TV.esc(s); };

  function placeholderHTML() {
    return '<div class="notice"><h3>💬 Chat coming soon</h3>' +
      '<p>The owner is setting up the community chat backend (free Firebase). ' +
      'Check back soon — or use the <b>Vault Guide</b> (◈ button, bottom-right) for build help right now.</p></div>';
  }

  function isConfigured() {
    return !!(window.TV_FIREBASE_READY && window.TV_FIREBASE_CONFIG &&
      window.TV_FIREBASE_CONFIG.apiKey &&
      window.TV_FIREBASE_CONFIG.apiKey.indexOf('PASTE_') !== 0);
  }

  function loadSDK(cb) {
    if (window.firebase && firebase.apps.length) return cb();
    var files = [
      'https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js',
      'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js'
    ];
    (function next(i) {
      if (i >= files.length) return cb();
      var s = document.createElement('script');
      s.src = files[i];
      s.onload = function () { next(i + 1); };
      s.onerror = function () { cb(new Error('sdk')); };
      document.head.appendChild(s);
    })(0);
  }

  /* ensureDB(cb): cb(err, db) — loads SDK + initializes Firebase once. */
  var dbPromise = null;
  function ensureDB(cb) {
    if (dbPromise) { dbPromise.then(function (db) { cb(null, db); }, function (e) { cb(e); }); return; }
    dbPromise = new Promise(function (resolve, reject) {
      if (!isConfigured()) { reject(new Error('not-configured')); return; }
      loadSDK(function (err) {
        if (err) { reject(err); return; }
        try {
          if (!firebase.apps.length) firebase.initializeApp(window.TV_FIREBASE_CONFIG);
          resolve(firebase.firestore());
        } catch (e) { reject(e); }
      });
    });
    dbPromise.then(function (db) { cb(null, db); }, function (e) { cb(e); });
  }

  function fmtTime(ts) {
    try { return new Date(ts.toDate ? ts.toDate() : ts).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}); }
    catch (e) { return ''; }
  }

  /* renderInto(box, db, opts): opts = { limit, showOnline, nameLabel } */
  function renderInto(box, db, opts) {
    opts = opts || {};
    var limit = opts.limit || 10;
    var full = !!opts.showOnline;
    var msgsStyle = full
      ? 'flex:1;min-height:120px;overflow-y:auto;border:1px solid var(--border);' +
        'border-radius:var(--radius);padding:12px;margin-bottom:10px;background:var(--card)'
      : 'max-height:320px;overflow-y:auto;border:1px solid var(--border);' +
        'border-radius:var(--radius);padding:12px;margin-bottom:10px;background:var(--card)';
    box.innerHTML =
      (full ? '<div class="tv-chat-online muted small" style="margin-bottom:8px"></div>' : '') +
      '<div class="tv-chat-msgs" style="' + msgsStyle + '"></div>' +
      '<form class="tv-chat-form" style="display:flex;gap:8px">' +
      '<input class="tv-chat-name" placeholder="Tenno name" maxlength="24" style="max-width:140px" aria-label="Your name">' +
      '<input class="tv-chat-text" placeholder="Say something kind…" maxlength="300" style="flex:1" aria-label="Message">' +
      '<button class="btn primary" type="submit">Send</button></form>' +
      '<p class="muted small" style="margin-top:6px">' + limit + ' latest messages · no account needed · keep it friendly</p>';

    var msgs = box.querySelector('.tv-chat-msgs');
    /* live online count in full mode */
    if (full) {
      var onlineEl = box.querySelector('.tv-chat-online');
      var updateOnline = function () {
        if (!document.body.contains(onlineEl)) return;
        try {
          var n = (window.TV && typeof window.TV.getOnlineCount === 'function')
            ? window.TV.getOnlineCount() : 0;
          onlineEl.innerHTML = n > 0
            ? '🟢 <b>' + n + '</b> Tenno online'
            : '🟢 <b>…</b> Tenno online';
        } catch (e) {}
      };
      updateOnline();
      setInterval(updateOnline, 30000);
    }
    var unsub = db.collection('chat').orderBy('ts', 'desc').limit(limit)
      .onSnapshot(function (snap) {
        if (!document.body.contains(msgs)) { try { unsub(); } catch (e) {} return; }
        var rows = [];
        snap.forEach(function (doc) {
          var m = doc.data();
          rows.unshift('<div class="mod-row"><div><b>' + esc(m.name || 'Tenno') + '</b> ' +
            '<span class="muted small">' + esc(fmtTime(m.ts)) + '</span>' +
            '<div>' + esc(m.text || '') + '</div></div></div>');
        });
        msgs.innerHTML = rows.join('') || '<p class="muted">No messages yet — say hi!</p>';
        msgs.scrollTop = msgs.scrollHeight;
      }, function () {
        msgs.innerHTML = '<p class="muted">Couldn\'t load messages. Try reloading.</p>';
      });

    box.querySelector('.tv-chat-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var name = box.querySelector('.tv-chat-name').value.trim().slice(0, 24) || 'Tenno';
      var text = box.querySelector('.tv-chat-text').value.trim().slice(0, 300);
      if (!text) return;
      box.querySelector('.tv-chat-text').value = '';
      db.collection('chat').add({
        name: name,
        text: text,
        ts: firebase.firestore.FieldValue.serverTimestamp()
      }).catch(function () { /* silent fail */ });
      try { localStorage.setItem('tv-chat-name', name); } catch (e2) {}
    });
    try {
      var saved = localStorage.getItem('tv-chat-name');
      if (saved) box.querySelector('.tv-chat-name').value = saved;
    } catch (e) {}
    return unsub;
  }

  window.TVChat = {
    isConfigured: isConfigured,
    ensureDB: ensureDB,
    renderInto: renderInto,
    placeholderHTML: placeholderHTML
  };

  document.addEventListener('DOMContentLoaded', function () {
    var box = document.getElementById('tv-chat');
    if (!box) return;
    if (!isConfigured()) { box.innerHTML = placeholderHTML(); return; }
    box.innerHTML = '<div class="loading">Connecting to chat…</div>';
    ensureDB(function (err, db) {
      if (err || !document.body.contains(box)) { box.innerHTML = placeholderHTML(); return; }
      var full = box.getAttribute('data-full') === '1';
      renderInto(box, db, { limit: full ? 30 : 10, showOnline: full });
    });
  });
})();
