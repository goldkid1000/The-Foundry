/* The Foundry — Vaulty on-device memory (v2.20.0).
   "Vaulty remembers — on this device." A small localStorage profile of
   what THIS Tenno asks about: the frames/weapons they keep coming back
   to, the topics they care about, and their recent questions. It is used
   only to personalize (a welcome-back line, a "your usual" chip, and
   resolving "my usual" to their most-asked item).
   HONESTY RULES: this memory lives ONLY in this browser's localStorage —
   nothing is uploaded, nothing leaves the device, and it does NOT change
   the AI model's weights or what Vaulty knows about Warframe. The panel
   says exactly that, and the "What Vaulty remembers" view lets the Tenno
   see and wipe it at any time. */
(function () {
  'use strict';

  var KEY = 'tv-vaulty-memory-v1';
  var MAX_RECENT = 8;
  var MAX_ITEMS = 24;

  function esc(s) {
    if (window.TV && window.TV.esc) return window.TV.esc(s);
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function norm(s) { return String(s || '').toLowerCase().trim(); }

  /* ---------- storage ---------- */
  function blank() {
    return { items: {}, topics: {}, recent: [], exchanges: 0, firstSeen: Date.now() };
  }
  var mem = blank();
  try {
    var raw = localStorage.getItem(KEY);
    if (raw) {
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.items && parsed.topics) mem = parsed;
    }
  } catch (e) { /* private mode / corrupt value — start blank */ }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch (e) {}
  }

  /* ---------- item-name list (from the site's own search index) ---------- */
  var nameList = null;      /* [{name, key, kind}] longest-name-first */
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

  /* ---------- topics ---------- */
  var TOPIC_RES = [
    ['Builds', /\b(build|loadout|setup|one[\s-]?shot|steel\s?path|mod my|mods for)\b/],
    ['Farming', /\b(farm|where (do|can) i (get|find)|how do i (get|farm)|drop|grind)\b/],
    ['Live worldstate', /\b(baro|fissure|nightwave|sortie|event|invasion|when is|right now|today)\b/],
    ['Trading & platinum', /\b(platinum|plat|sell|trade|price|worth)\b/],
    ['Mods & arcanes', /\b(mod|arcane|aura|exilus|riven)\b/],
    ['Story & quests', /\b(quest|story|lore|who is|cinematic)\b/],
    ['Getting started', /\b(new|beginner|start|mastery rank|mr\d|first)\b/]
  ];

  /* ---------- recording ---------- */
  function recordExchange(q) {
    var text = String(q || '').trim();
    if (!text) return;
    mem.exchanges = (mem.exchanges || 0) + 1;
    /* recent questions (newest first, no back-to-back duplicates) */
    if (mem.recent[0] !== text) {
      mem.recent.unshift(text);
      if (mem.recent.length > MAX_RECENT) mem.recent.length = MAX_RECENT;
    }
    var t = norm(text);
    TOPIC_RES.forEach(function (pair) {
      if (pair[1].test(t)) mem.topics[pair[0]] = (mem.topics[pair[0]] || 0) + 1;
    });
    save();
    /* item extraction needs the name list — async, then save again */
    loadNames().then(function () {
      var found = itemsIn(text);
      if (!found.length) return;
      found.forEach(function (it) {
        var rec = mem.items[it.name] || { kind: it.kind, n: 0, last: 0 };
        rec.n += 1;
        rec.last = Date.now();
        mem.items[it.name] = rec;
      });
      /* cap the table at the most-asked items */
      var names = Object.keys(mem.items);
      if (names.length > MAX_ITEMS) {
        names.sort(function (a, b) { return mem.items[b].n - mem.items[a].n; });
        var keep = {};
        names.slice(0, MAX_ITEMS).forEach(function (n) { keep[n] = mem.items[n]; });
        mem.items = keep;
      }
      save();
    }).catch(function () {});
  }

  /* ---------- reads / personalization ---------- */
  function sortedItems() {
    return Object.keys(mem.items).map(function (name) {
      return { name: name, kind: mem.items[name].kind, n: mem.items[name].n, last: mem.items[name].last };
    }).sort(function (a, b) { return (b.n - a.n) || (b.last - a.last); });
  }

  function main() {
    var s = sortedItems();
    return s.length && s[0].n >= 2 ? s[0] : null; /* one mention isn't a "usual" yet */
  }

  /* "my usual" / "the usual" / "usual build" → "<main> build", or null */
  function resolveUsual(q) {
    var t = norm(q).replace(/\?+$/, '').trim();
    if (!/^(my |the )?usual( build| one)?$/.test(t) && !/^usual build$/.test(t)) return null;
    var m = main();
    return m ? (m.name + ' build') : null;
  }

  function welcomeBackLine() {
    var m = main();
    if (!m) return null;
    return 'Welcome back, Tenno ◈ You\'ve been working on <b>' + esc(m.name) + '</b> lately — ' +
      'there\'s a chip below for its build, or ask me anything else.';
  }

  /* ---------- the "What Vaulty remembers" view ---------- */
  function viewHtml() {
    var items = sortedItems();
    var topics = Object.keys(mem.topics).map(function (k) { return { name: k, n: mem.topics[k] }; })
      .sort(function (a, b) { return b.n - a.n; });
    var body;
    if (!items.length && !topics.length && !mem.recent.length) {
      body = '<p>Nothing yet — ask me about a frame or weapon a couple of times and I\'ll start remembering what you\'re working on.</p>';
    } else {
      body = '';
      if (items.length) {
        body += '<p><b>Your gear I hear about most:</b></p><ul>' + items.slice(0, 6).map(function (it) {
          return '<li>' + esc(it.name) + ' <span class="muted small">' + esc(it.kind) + ' · asked ' + it.n + '×</span></li>';
        }).join('') + '</ul>';
      }
      if (topics.length) {
        body += '<p><b>Topics you come back to:</b> ' + topics.slice(0, 4).map(function (tp) { return esc(tp.name); }).join(' · ') + '</p>';
      }
      if (mem.recent.length) {
        body += '<p><b>Recent questions:</b></p><ul>' + mem.recent.slice(0, 5).map(function (r) {
          return '<li>' + esc(r) + '</li>';
        }).join('') + '</ul>';
      }
    }
    return '<div id="vmem-view"><b>🧠 What Vaulty remembers</b>' + body +
      '<p class="muted small">This memory lives <b>only on this device</b> (your browser\'s local storage). ' +
      'Nothing here is uploaded, and it never changes what Vaulty knows about Warframe — just what it knows about you, ' +
      'so it can greet you properly and understand "my usual". Unanswered questions are logged anonymously ' +
      '(question text only) so Vaulty can learn the answers — never tied to you.</p>' +
      '<button type="button" class="vmem-clear btn warn">Clear memory</button></div>';
  }

  function clear() {
    mem = blank();
    try { localStorage.removeItem(KEY); } catch (e) {}
    save();
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    var btn = (t && typeof t.closest === 'function') ? t.closest('.vmem-clear') : null;
    if (!btn) return;
    clear();
    var view = btn.closest ? btn.closest('#vmem-view') : null;
    var host = view || btn.parentElement;
    if (host) {
      host.innerHTML = '<b>🧠 What Vaulty remembers</b><p>Memory cleared — this device no longer remembers your gear, topics, or recent questions. Ask me things and I\'ll start fresh.</p>';
    }
  });

  window.TVMemory = {
    recordExchange: recordExchange,
    main: main,
    resolveUsual: resolveUsual,
    welcomeBackLine: welcomeBackLine,
    viewHtml: viewHtml,
    clear: clear,
    _summary: function () { return { items: sortedItems(), topics: mem.topics, recent: mem.recent.slice(), exchanges: mem.exchanges }; },
    _ready: loadNames
  };
})();
