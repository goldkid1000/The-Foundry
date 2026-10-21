/* The Foundry — classifieds marketplace (Firestore, no login).
 * Anyone can browse and post; a display name is used instead of an account.
 * Gracefully degrades when the owner hasn't pasted their Firebase config yet. */
(function () {
  'use strict';
  var esc = function (s) { return window.TV.esc(s); };
  var db = null, configured = false;

  function myName() {
    try { return (localStorage.getItem('tv-mp-name') || '').slice(0, 24); } catch (e) { return ''; }
  }
  function saveName(n) {
    try { localStorage.setItem('tv-mp-name', n.slice(0, 24)); } catch (e) {}
  }

  function notConfiguredHTML() {
    return '<div class="notice warn"><h3>🏪 Trading board not connected yet</h3>' +
      '<p>The owner hasn\'t plugged in the marketplace backend. It runs on free Firebase — ' +
      'setup takes about 10 minutes. See <b>README.md → "Setting up the marketplace"</b> in the site repo.</p></div>';
  }

  function scamNotice() {
    return '<div class="notice danger"><h4>⚠️ Trade safe</h4>' +
      '<p class="small">The Foundry never touches your items or platinum. ' +
      '<b>Trade in-game only</b> (dojo trading post or Maroo\'s Bazaar). ' +
      '<b>Never</b> share your password, 2FA codes, or account email. ' +
      'If a deal feels wrong, walk away.</p></div>';
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
      s.onerror = function () {
        document.getElementById('mp-app').innerHTML =
          '<div class="notice"><b>Marketplace unavailable.</b> Could not load the database service. Check your connection.</div>';
      };
      document.head.appendChild(s);
    })(0);
  }

  function init() {
    var app = document.getElementById('mp-app');
    if (!app) return;
    configured = !!(window.TV_FIREBASE_READY && window.TV_FIREBASE_CONFIG &&
      window.TV_FIREBASE_CONFIG.apiKey &&
      window.TV_FIREBASE_CONFIG.apiKey.indexOf('PASTE_') !== 0);
    if (!configured) {
      app.innerHTML = notConfiguredHTML() + scamNotice();
      return;
    }
    app.innerHTML = '<div class="loading">Connecting to trading board…</div>' + scamNotice();
    loadSDK(function () {
      try {
        if (!firebase.apps.length) firebase.initializeApp(window.TV_FIREBASE_CONFIG);
        db = firebase.firestore();
        renderBoard();
      } catch (e) {
        app.innerHTML = '<div class="notice"><b>Marketplace error.</b> The backend config looks wrong. The owner should check README.md setup steps.</div>';
      }
    });
  }

  /* ---------------- board ---------------- */
  var allListings = [], filter = { q: '', cat: 'all' };

  function renderBoard() {
    var app = document.getElementById('mp-app');
    var html = scamNotice();
    html += '<div class="field" style="display:flex;gap:10px;flex-wrap:wrap">' +
      '<input id="mp-q" type="search" placeholder="Search listings…" style="flex:2;min-width:180px" value="' + esc(filter.q) + '">' +
      '<select id="mp-cat" style="flex:1;min-width:140px">' +
      ['all', 'Prime Part', 'Mod', 'Riven', 'Arcane', 'Other'].map(function (c) {
        return '<option value="' + c + '"' + (filter.cat === c ? ' selected' : '') + '>' +
          (c === 'all' ? 'All categories' : c) + '</option>';
      }).join('') + '</select>' +
      '<button class="btn primary" id="mp-new">+ Post a listing</button>' +
      '</div>';
    html += '<div id="mp-list" class="item-list"><div class="loading">Loading listings…</div></div>';
    html += '<div id="mp-detail"></div>';
    html += '<p class="muted small">No account needed — just pick a display name when you post.</p>';
    app.innerHTML = html;

    document.getElementById('mp-q').addEventListener('input', function (e) { filter.q = e.target.value; drawList(); });
    document.getElementById('mp-cat').addEventListener('change', function (e) { filter.cat = e.target.value; drawList(); });
    document.getElementById('mp-new').addEventListener('click', renderPostForm);

    db.collection('listings')
      .orderBy('createdAt', 'desc').limit(100).get()
      .then(function (snap) {
        allListings = [];
        snap.forEach(function (doc) {
          var d = doc.data(); d.id = doc.id;
          if (d.status === 'active') allListings.push(d);
        });
        drawList();
      })
      .catch(function () {
        document.getElementById('mp-list').innerHTML =
          '<div class="notice">Could not load listings. The database rules may not be published yet — the owner should deploy <code>firestore.rules</code> (see README).</div>';
      });
  }

  function drawList() {
    var box = document.getElementById('mp-list');
    var q = filter.q.toLowerCase();
    var items = allListings.filter(function (l) {
      var okCat = filter.cat === 'all' || l.category === filter.cat;
      var okQ = !q || (l.title + ' ' + l.description).toLowerCase().indexOf(q) !== -1;
      return okCat && okQ;
    });
    if (!items.length) {
      box.innerHTML = '<div class="loading">No listings match. Be the first to post one!</div>';
      return;
    }
    box.innerHTML = items.map(function (l) {
      return '<a class="list-item" href="#" data-id="' + esc(l.id) + '">' +
        '<h3>' + esc(l.title) + ' — <b>' + esc(l.price) + 'p</b></h3>' +
        '<p class="muted small">' + esc(l.category) + ' · ' + esc(l.sellerName || 'a Tenno') +
        (l.createdAt ? ' · ' + esc(new Date(l.createdAt.toDate()).toLocaleDateString()) : '') + '</p></a>';
    }).join('');
    box.querySelectorAll('a.list-item').forEach(function (a) {
      a.addEventListener('click', function (e) { e.preventDefault(); openListing(a.getAttribute('data-id')); });
    });
  }

  /* ---------------- post a listing ---------------- */
  function renderPostForm() {
    var d = document.getElementById('mp-detail');
    d.innerHTML = '<div class="detail-box"><h3>Post a listing</h3>' +
      '<div class="field"><label>Your display name</label><input id="pl-name" maxlength="24" placeholder="e.g. Burry2006" value="' + esc(myName()) + '"></div>' +
      '<div class="field"><label>Title</label><input id="pl-title" maxlength="100" placeholder="e.g. Ash Prime Systems"></div>' +
      '<div class="field"><label>Category</label><select id="pl-cat">' +
      ['Prime Part', 'Mod', 'Riven', 'Arcane', 'Other'].map(function (c) { return '<option>' + c + '</option>'; }).join('') +
      '</select></div>' +
      '<div class="field"><label>Price (platinum)</label><input id="pl-price" type="number" min="1" placeholder="e.g. 25"></div>' +
      '<div class="field"><label>Description</label><textarea id="pl-desc" maxlength="1000" placeholder="Rank, quantity, how to reach you in-game…"></textarea></div>' +
      '<button class="btn primary" id="pl-submit">Publish listing</button> ' +
      '<button class="btn" id="pl-cancel">Cancel</button></div>';
    d.scrollIntoView({ behavior: 'smooth' });
    document.getElementById('pl-cancel').addEventListener('click', function () { d.innerHTML = ''; });
    document.getElementById('pl-submit').addEventListener('click', function () {
      var name = document.getElementById('pl-name').value.trim().slice(0, 24) || 'Tenno';
      var title = document.getElementById('pl-title').value.trim().slice(0, 100);
      var price = parseInt(document.getElementById('pl-price').value, 10);
      if (!title || !price) { alert('Give your listing a title and a platinum price.'); return; }
      saveName(name);
      db.collection('listings').add({
        title: title,
        category: document.getElementById('pl-cat').value,
        price: price,
        description: document.getElementById('pl-desc').value.trim().slice(0, 1000),
        sellerName: name,
        status: 'active',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      }).then(function () { d.innerHTML = ''; renderBoard(); })
        .catch(function () { alert('Could not publish. Try again.'); });
    });
  }

  /* ---------------- listing detail + messages ---------------- */
  function openListing(id) {
    var l = allListings.find(function (x) { return x.id === id; });
    if (!l) return;
    var d = document.getElementById('mp-detail');
    d.innerHTML = '<div class="detail-box"><h3>' + esc(l.title) + ' — <b>' + esc(l.price) + 'p</b></h3>' +
      '<p class="muted small">' + esc(l.category) + ' · seller: ' + esc(l.sellerName || 'a Tenno') + '</p>' +
      (l.description ? '<p>' + esc(l.description) + '</p>' : '') +
      '<h3 style="margin-top:18px">Messages</h3>' +
      '<div id="ld-msgs"><div class="loading">Loading messages…</div></div>' +
      '<div class="field" style="display:flex;gap:8px;flex-wrap:wrap">' +
      '<input id="ld-name" placeholder="Your name" maxlength="24" style="max-width:140px" value="' + esc(myName()) + '">' +
      '<input id="ld-input" placeholder="Message the seller… (meet in-game to trade)" maxlength="500" style="flex:1;min-width:180px">' +
      '<button class="btn primary" id="ld-send">Send</button></div>' +
      '<p class="muted small">No account needed. Trade in-game only.</p>' +
      '<button class="btn small" id="ld-close" style="margin-top:10px">Close</button></div>';
    d.scrollIntoView({ behavior: 'smooth' });
    document.getElementById('ld-close').addEventListener('click', function () { d.innerHTML = ''; });

    var msgsRef = db.collection('listings').doc(id).collection('messages').orderBy('ts', 'asc').limit(50);
    msgsRef.onSnapshot(function (snap) {
      var box = document.getElementById('ld-msgs');
      if (!box) return;
      if (snap.empty) { box.innerHTML = '<p class="muted small">No messages yet. Say hi!</p>'; return; }
      box.innerHTML = snap.docs.map(function (doc) {
        var m = doc.data();
        return '<div class="mod-row"><div><b>' + esc(m.senderName || 'Tenno') + ':</b> ' + esc(m.text) + '</div></div>';
      }).join('');
    }, function () {
      var box = document.getElementById('ld-msgs');
      if (box) box.innerHTML = '<p class="muted small">Couldn\'t load messages. Try reloading.</p>';
    });
    document.getElementById('ld-send').addEventListener('click', function () {
      var name = document.getElementById('ld-name').value.trim().slice(0, 24) || 'Tenno';
      var t = document.getElementById('ld-input').value.trim().slice(0, 500);
      if (!t) return;
      saveName(name);
      msgsRef.add({
        senderName: name,
        text: t,
        ts: firebase.firestore.FieldValue.serverTimestamp()
      });
      document.getElementById('ld-input').value = '';
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (document.getElementById('mp-app')) init();
  });
})();
