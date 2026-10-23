/* The Foundry — Vaulty learns, on this device (v2.23.0).
   The grow/learn/communicate loop the owner asked for:
   - MISSES: every question Vaulty couldn't answer is kept HERE too
     (the anonymous Firestore miss log in js/vaulty-research.js is the
     other half — question text only, never tied to anyone). The local
     copy powers the "🧠 What Vaulty is learning" view.
   - FEEDBACK: 👍/👎 under synthesized, dossier and recommendation
     answers. Votes are stored on-device, keyed to the gear the answer
     was about, and they genuinely change behavior: the recommender
     re-ranks its picks with them.
   HONESTY RULES: nothing here is uploaded; no model weights change;
   "learning" means exactly this — a local record of misses + votes
   that the guide brain consults. The view and the "how do you learn?"
   answer say precisely that. */
(function () {
  'use strict';

  var KEY = 'tv-vaulty-learn-v1';
  var MAX_MISSES = 12;

  function esc(s) {
    if (window.TV && window.TV.esc) return window.TV.esc(s);
    return String(s == null ? '' : s).replace(/[&<>""]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function norm(s) { return String(s || '').toLowerCase().trim(); }

  /* ---------- storage ---------- */
  function blank() { return { fb: {}, misses: [], votes: 0 }; }
  var store = blank();
  try {
    var raw = localStorage.getItem(KEY);
    if (raw) {
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.fb) {
        store = parsed;
        if (!Array.isArray(store.misses)) store.misses = [];
        if (typeof store.votes !== 'number') store.votes = 0;
      }
    }
  } catch (e) { /* private mode — run session-only */ }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) {}
  }

  /* ---------- item-name matching (the site's own search index) ---------- */
  var nameList = null;
  var namePromise = null;
  function loadNames() {
    if (namePromise) return namePromise;
    if (!window.TV || !window.TV.getJSONParts) { nameList = []; namePromise = Promise.resolve(nameList); return namePromise; }
    namePromise = window.TV.getJSONParts('data/site/search-index', 7).then(function (idx) {
      var out = [];
      (idx || []).forEach(function (e) {
        if (!e || !e.n || !e.t) return;
        var t = norm(e.t);
        var kind = t.indexOf('warframe') !== -1 ? 'warframe' : (t.indexOf('weapon') !== -1 ? 'weapon' : null);
        if (kind) out.push({ name: e.n, key: norm(e.n), kind: kind });
      });
      out.sort(function (a, b) { return b.key.length - a.key.length; });
      nameList = out;
      return out;
    }).catch(function () { nameList = []; return nameList; });
    return namePromise;
  }
  function itemsIn(text) {
    if (!nameList) return [];
    var t = ' ' + norm(text).replace(/[^a-z0-9'& ]+/g, ' ').replace(/\s+/g, ' ') + ' ';
    var found = [];
    for (var i = 0; i < nameList.length && found.length < 3; i++) {
      var it = nameList[i];
      if (it.key.length < 4) continue;
      if (t.indexOf(' ' + it.key.replace(/[^a-z0-9'& ]+/g, ' ') + ' ') !== -1) found.push(it);
    }
    return found;
  }

  /* ---------- misses ---------- */
  function recordMiss(q) {
    var text = String(q || '').trim().replace(/\s+/g, ' ').slice(0, 200);
    if (!text) return;
    if (store.misses.length && norm(store.misses[0].q) === norm(text)) return;
    store.misses.unshift({ q: text, ts: Date.now() });
    if (store.misses.length > MAX_MISSES) store.misses.length = MAX_MISSES;
    save();
  }

  /* ---------- feedback ---------- */
  function recordFeedback(names, dir) {
    var changed = false;
    (names || []).slice(0, 3).forEach(function (n) {
      var k = norm(n);
      if (!k) return;
      var rec = store.fb[k] || { up: 0, down: 0 };
      if (dir > 0) rec.up += 1; else rec.down += 1;
      store.fb[k] = rec;
      changed = true;
    });
    if (changed) { store.votes += 1; save(); }
    return changed;
  }
  function feedbackFor(name) {
    var rec = store.fb[norm(name)];
    return rec ? { up: rec.up, down: rec.down } : { up: 0, down: 0 };
  }
  /* net pull used by the recommender: real, but bounded — a couple of
     votes can reorder close picks, never crown a bad one */
  function boostForItem(name) {
    var f = feedbackFor(name);
    var net = f.up - f.down;
    if (net === 0) return 0;
    return Math.max(-9, Math.min(12, net * 4));
  }
  function totals() {
    var up = 0, down = 0;
    Object.keys(store.fb).forEach(function (k) { up += store.fb[k].up; down += store.fb[k].down; });
    return { up: up, down: down, items: Object.keys(store.fb).length };
  }

  /* ---------- feedback UI (👍/👎 under real answers) ---------- */
  var lastCtx = '';
  function setContext(text) { lastCtx = String(text || ''); }
  function stripText(html) {
    return String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  /* Attach a vote row to a freshly-rendered bot message — but only to
     REAL answers (synthesized research, dossiers, build cards,
     recommendations, build checks), never to greetings, progress bars,
     status notes or don't-knows. ctxText is the question + answer text
     the vote should be keyed to. */
  var QUALIFY = ['vbc-', 'vai-reco', 'vai-check', 'vai-dossier', 'Researched just now', '🛠 Vaulty Original'];
  function attachFeedback(el, ctxText) {
    try {
      if (!el || el.querySelector('.vai-fb')) return;
      var html = String(el.innerHTML || '');
      if (html.length < 140) return;
      var ok = QUALIFY.some(function (mark) { return html.indexOf(mark) !== -1; });
      if (!ok) return;
      if (window.TVResearch && TVResearch.isMiss && TVResearch.isMiss(html)) return;
      var row = document.createElement('div');
      row.className = 'vai-fb';
      row.innerHTML =
        '<span class="muted small">Was this a good answer?</span> ' +
        '<button type="button" class="vai-fb-btn" data-dir="1" aria-label="Good answer">👍</button> ' +
        '<button type="button" class="vai-fb-btn" data-dir="-1" aria-label="Bad answer">👎</button>';
      row.setAttribute('data-ctx', String(ctxText || lastCtx || '').slice(0, 600));
      el.appendChild(row);
    } catch (e) {}
  }
  document.addEventListener('click', function (e) {
    var t = e.target;
    var btn = (t && typeof t.closest === 'function') ? t.closest('.vai-fb-btn') : null;
    if (!btn) return;
    var row = btn.closest('.vai-fb');
    if (!row || row.getAttribute('data-voted')) return;
    row.setAttribute('data-voted', '1');
    var dir = parseInt(btn.getAttribute('data-dir') || '0', 10);
    var ctx = row.getAttribute('data-ctx') || '';
    loadNames().then(function () {
      var found = itemsIn(ctx);
      var names = found.map(function (f) { return f.name; });
      recordFeedback(names.length ? names : [ctx.slice(0, 60)], dir);
      row.innerHTML = '<span class="muted small">' +
        (dir > 0 ? '👍 Noted — answers like this will rank higher for you, on this device.'
                 : '👎 Noted — I\'ll rank answers like this lower for you, on this device.') + '</span>';
    });
  });

  /* ---------- the learning view + the honest explanation ---------- */
  function topicsLine() {
    try {
      if (window.TVMemory && TVMemory._summary) {
        var s = TVMemory._summary();
        var tops = Object.keys(s.topics || {}).map(function (k) { return { name: k, n: s.topics[k] }; })
          .sort(function (a, b) { return b.n - a.n; }).slice(0, 4);
        if (tops.length) return tops.map(function (tp) { return esc(tp.name); }).join(' · ');
      }
    } catch (e) {}
    return '';
  }
  function viewHtml() {
    var tot = totals();
    var body = '';
    if (store.misses.length) {
      body += '<p><b>Questions I missed recently</b> <span class="muted small">(kept on this device, and sent anonymously — text only — so future updates can teach me the answers):</span></p><ul>' +
        store.misses.slice(0, 6).map(function (m) { return '<li>' + esc(m.q) + '</li>'; }).join('') + '</ul>';
    } else {
      body += '<p>No misses recorded on this device yet — when I can\'t answer something, it lands here.</p>';
    }
    var tl = topicsLine();
    if (tl) body += '<p><b>Topics you\'re teaching me you care about:</b> ' + tl + '</p>';
    body += '<p><b>Your feedback so far:</b> ' + tot.up + ' 👍 · ' + tot.down + ' 👎 across ' + tot.items +
      ' item' + (tot.items === 1 ? '' : 's') + '. Votes re-rank my recommendations on this device.</p>';
    body += '<p class="muted small">Honest version: I don\'t retrain a neural network in your browser. ' +
      'Learning here = this device remembers what you ask, what I missed, and what you rated — and my answers consult that record. ' +
      'The anonymous miss log (question text only, no identifiers) is how my built-in knowledge grows in app updates.</p>';
    return '<div id="vlearn-view"><b>🧠 What Vaulty is learning</b>' + body + '</div>';
  }
  function explainHtml() {
    var tot = totals();
    return '<p>Fair question — here\'s exactly how I learn, no marketing:</p>' +
      '<p><b>1. I remember what YOU ask about — on this device only.</b> Your frames, weapons and topics live in this browser\'s local storage. Nothing is uploaded, and it never changes what I know about Warframe — just what I know about you, so "my usual" works and recommendations fit you.</p>' +
      '<p><b>2. Questions I miss get logged anonymously.</b> If I can\'t answer something, the question text (only the text — no name, no account, no device info) goes into an anonymous log, and future updates to my built-in knowledge are written from the questions I actually missed. On this device I also keep a local list — ask me for <i>"what are you learning"</i> to see it.</p>' +
      '<p><b>3. Your 👍/👎 teach me your taste.</b> Votes are stored on this device and re-rank my recommendations — ' +
      'so far you\'ve cast ' + tot.up + ' 👍 and ' + tot.down + ' 👎 here.</p>' +
      '<p>What I <i>don\'t</i> do: retrain a model in your browser or phone home with your data. If you download the optional on-device AI, it stays exactly as downloaded — my learning lives in the guide brain and this device\'s memory.</p>';
  }

  window.TVLearn = {
    recordMiss: recordMiss,
    recordFeedback: recordFeedback,
    feedbackFor: feedbackFor,
    boostForItem: boostForItem,
    totals: totals,
    attachFeedback: attachFeedback,
    setContext: setContext,
    viewHtml: viewHtml,
    explainHtml: explainHtml,
    _itemsIn: function (text) { return loadNames().then(function () { return itemsIn(text); }); },
    _misses: function () { return store.misses.slice(); },
    _ready: loadNames
  };
})();
