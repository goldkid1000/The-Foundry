/* The Foundry — Vaulty research mode + anonymous miss log (v2.20.0).
   When the guide brain doesn't know, Vaulty no longer dead-ends: it
   RESEARCHES, in the open, with a staged progress bar the Tenno can
   stop — live game data (warframestat.us) → the Warframe Wiki → a
   Wikipedia backstop. Findings are quoted from the source and cited;
   nothing is paraphrased into existence, and build-shaped results are
   never presented as builds (builds still come only from the verified
   library — see the v2.19.5 router in js/ai.js).

   Misses are logged ANONYMOUSLY to the tenno-vault Firebase project
   (collection: vaulty-misses) — question text only, plus a timestamp
   and the app version. No identifiers, no IP, no account, no device
   info. That log is the training signal: future guide updates are
   written from the questions Vaulty actually missed. */
(function () {
  'use strict';

  var APP_VERSION = '2.20.0';

  function esc(s) {
    if (window.TV && window.TV.esc) return window.TV.esc(s);
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function norm(s) { return String(s || '').toLowerCase().trim(); }

  /* ---------- don't-know detection ----------
     Signatures of the guide brain's honest dead-ends (js/ai-fallback.js).
     If the answer HTML carries one of these, the question counts as a
     miss: it gets logged and researched. */
  var MISS_RES = [
    /Straight up: I don'?t know that one/,
    /don'?t know a mod or arcane called/,
    /couldn'?t pin down which item/,
    /couldn'?t find a farm spot for/,
    /isn'?t in the Vault'?s data/
  ];
  function isMiss(html) {
    var s = String(html == null ? '' : html);
    for (var i = 0; i < MISS_RES.length; i++) if (MISS_RES[i].test(s)) return true;
    return false;
  }

  /* ---------- anonymous miss log ---------- */
  var missSent = {};
  var fbPromise = null;

  function loadFirestore() {
    if (fbPromise) return fbPromise;
    fbPromise = new Promise(function (resolve) {
      function done(db) { resolve(db || null); }
      try {
        if (window.firebase && firebase.apps && firebase.apps.length) { done(firebase.firestore()); return; }
      } catch (e) {}
      if (!window.TV_FIREBASE_CONFIG) { done(null); return; }
      function loadScript(src) {
        return new Promise(function (res, rej) {
          var s = document.createElement('script');
          s.src = src; s.onload = res; s.onerror = rej;
          document.head.appendChild(s);
        });
      }
      var chain = window.firebase ? Promise.resolve()
        : loadScript('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
      chain.then(function () {
        return loadScript('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js');
      }).then(function () {
        try {
          if (!firebase.apps.length) firebase.initializeApp(window.TV_FIREBASE_CONFIG);
          done(firebase.firestore());
        } catch (e) { done(null); }
      }).catch(function () { done(null); });
    });
    return fbPromise;
  }

  /* Fire-and-forget, once per question per session, silent on failure
     (offline, rules not yet deployed, blocked SDK — research continues
     regardless). Question TEXT ONLY by design. */
  function logMiss(q) {
    var text = String(q || '').trim().replace(/\s+/g, ' ').slice(0, 300);
    if (!text) return;
    var key = norm(text);
    if (missSent[key]) return;
    missSent[key] = 1;
    loadFirestore().then(function (db) {
      if (!db) return;
      try {
        db.collection('vaulty-misses').add({
          q: text,
          ts: new Date().toISOString(),
          v: APP_VERSION
        }).catch(function () {});
      } catch (e) {}
    }).catch(function () {});
  }

  /* ---------- fetch helpers ---------- */
  function fetchJSON(url, ms) {
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, ms || 7000) : null;
    return fetch(url, ctrl ? { signal: ctrl.signal } : {}).then(function (r) {
      if (timer) clearTimeout(timer);
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    }).catch(function (e) { if (timer) clearTimeout(timer); throw e; });
  }

  /* ---------- subject extraction ----------
     Strip question scaffolding so searches hit the actual topic:
     "where do i farm argon crystals" → "argon crystals",
     "make me a nokko build" → "nokko". */
  function subjectOf(q) {
    var t = norm(q).replace(/\?+$/, '').trim();
    t = t.replace(/^(please\s+)?(tell me about|what is|what'?s|who is|where (do|can) i (farm|get|find|hunt|grind)|where to (farm|get|find|hunt|grind)|how do i (get|farm|obtain|find|unlock|join|start|use)|how to (get|farm|obtain|find|unlock|join|start|use)|can you (make|build)( me)?( a)?|make( me)?( a)?|build( me)?( a)?|farm|get|find)\s+/, '');
    /* "how do incarnon weapons work" style scaffolding */
    t = t.replace(/^how (do|does|can) /, '');
    t = t.replace(/\s+works?$/, '');
    t = t.replace(/\b(build|loadout|setup|steel\s?path|one[\s-]?shot)\b/g, ' ');
    t = t.replace(/^(the|a|an)\s+/, '');
    t = t.replace(/\s+/g, ' ').trim();
    return t || norm(q);
  }

  function firstSentences(text, maxChars) {
    var s = String(text || '').replace(/\s+/g, ' ').trim();
    if (!s) return '';
    var parts = s.split(/(?<=[.!?])\s+/);
    var out = '';
    for (var i = 0; i < parts.length && out.length < (maxChars || 520); i++) {
      if (out && (out + ' ' + parts[i]).length > (maxChars || 520)) break;
      out = out ? out + ' ' + parts[i] : parts[i];
    }
    return out || s.slice(0, maxChars || 520);
  }

  function citeLine(sourceName, url) {
    return '<p class="muted small">📖 From ' + esc(sourceName) +
      (url ? ' — <a href="' + esc(url) + '" target="_blank" rel="noopener">read more</a>' : '') +
      '. Researched live just now; the Vault\'s verified answers still come first.</p>';
  }

  /* ---------- stage 1: live game data (warframestat.us) ---------- */
  function stageLiveData(subj) {
    var url = 'https://api.warframestat.us/items/search/' + encodeURIComponent(subj) + '?language=en';
    return fetchJSON(url, 7000).then(function (arr) {
      if (!arr || !arr.length) return null;
      var want = norm(subj);
      var best = null;
      for (var i = 0; i < arr.length; i++) {
        var nm = norm(arr[i] && arr[i].name);
        if (!nm) continue;
        if (nm === want) { best = arr[i]; break; }
        if (!best && (nm.indexOf(want) === 0 || want.indexOf(nm) === 0) && Math.min(nm.length, want.length) >= 4) best = arr[i];
      }
      if (!best) return null;
      var text = firstSentences(best.description || '', 460);
      var dropTxt = '';
      if (best.drops && best.drops.length) {
        dropTxt = best.drops.slice(0, 4).map(function (d) {
          if (typeof d === 'string') return d;
          if (d && d.location) return d.location + (d.chance != null ? ' (' + d.chance + '%)' : '');
          return '';
        }).filter(Boolean).join('; ');
      }
      /* substance gate: the DESCRIPTION must carry the answer. A flavor
         line + a drop table (e.g. the Stalker enemy entry answering a
         "who is…" question) is not an answer — fall through to the Wiki. */
      if (text.length < 40) return null;
      var html = '<p><b>' + esc(best.name) + '</b></p>' +
        '<p>' + esc(text) + '</p>' +
        (dropTxt ? '<p><b>📍 Drops:</b> ' + esc(dropTxt) + '</p>' : '') +
        citeLine('live game data (warframestat.us)',
          'https://wiki.warframe.com/w/Special:Search?search=' + encodeURIComponent(best.name));
      return { html: html, source: 'Live game data (warframestat.us)', text: dropTxt ? text + ' Drops: ' + dropTxt : text };
    }).catch(function () { return null; });
  }

  /* ---------- stage 2: Warframe Wiki (MediaWiki API) ---------- */
  function wikiExtract(apiBase, subj) {
    var open = apiBase + '?action=opensearch&search=' + encodeURIComponent(subj) +
      '&limit=3&namespace=0&format=json&origin=*';
    return fetchJSON(open, 7000).then(function (res) {
      var titles = (res && res[1]) || [];
      var urls = (res && res[3]) || [];
      if (!titles.length) return null;
      var title = titles[0];
      var pageUrl = urls[0] || '';
      var q = apiBase + '?action=query&prop=extracts&exintro=1&explaintext=1&redirects=1&titles=' +
        encodeURIComponent(title) + '&format=json&origin=*';
      return fetchJSON(q, 7000).then(function (data) {
        var pages = data && data.query && data.query.pages;
        if (!pages) return null;
        var keys = Object.keys(pages);
        if (!keys.length || keys[0] === '-1') return null;
        var extract = pages[keys[0]].extract || '';
        /* wiki intros often open with a "Release Date:" line — skip it */
        extract = extract.replace(/^Release Date:[^\n]*\n?/i, '');
        var text = firstSentences(extract, 560);
        if (!text) return null;
        return { title: title, url: pageUrl, text: text };
      });
    }).catch(function () { return null; });
  }

  function stageWarframeWiki(subj) {
    return wikiExtract('https://wiki.warframe.com/api.php', subj).then(function (hit) {
      if (!hit) return null;
      var html = '<p><b>' + esc(hit.title) + '</b></p><p>' + esc(hit.text) + '</p>' +
        citeLine('the Warframe Wiki', hit.url);
      return { html: html, source: 'Warframe Wiki', text: hit.text };
    });
  }

  /* ---------- stage 3: Wikipedia backstop ----------
     Only accepted when the result is actually about Warframe / DE —
     a general encyclopedia hit about something else entirely would be
     worse than an honest don't-know. */
  function stageWikipedia(subj) {
    return wikiExtract('https://en.wikipedia.org/w/api.php', subj).then(function (hit) {
      if (!hit) return null;
      var hay = (hit.title + ' ' + hit.text).toLowerCase();
      if (hay.indexOf('warframe') === -1 && hay.indexOf('digital extremes') === -1) return null;
      var html = '<p><b>' + esc(hit.title) + '</b></p><p>' + esc(hit.text) + '</p>' +
        citeLine('Wikipedia', hit.url);
      return { html: html, source: 'Wikipedia', text: hit.text };
    });
  }

  /* ---------- the chain ---------- */
  var STAGE_NAMES = ['Checking the guide', 'Live game data', 'Warframe Wiki', 'Wikipedia', 'Composing answer'];

  /* hooks: { token: {cancelled}, onStage: function(idx) } */
  function run(q, hooks) {
    hooks = hooks || {};
    var token = hooks.token || { cancelled: false };
    var onStage = hooks.onStage || function () {};
    var subj = subjectOf(q);
    function cancelled() { return token.cancelled; }
    onStage(0);
    return Promise.resolve()
      .then(function () { if (cancelled()) throw new Error('cancelled'); onStage(1); return stageLiveData(subj); })
      .then(function (hit) {
        if (hit || cancelled()) return hit;
        onStage(2); return stageWarframeWiki(subj);
      })
      .then(function (hit) {
        if (hit || cancelled()) return hit;
        onStage(3); return stageWikipedia(subj);
      })
      .then(function (hit) {
        if (!hit) return null;
        onStage(4);
        return {
          html: '<p>That one wasn\'t in the Vault\'s own data, so I looked it up for you:</p>' + hit.html,
          source: hit.source,
          text: hit.text
        };
      })
      .catch(function () { return null; });
  }

  /* ---------- progress UI + orchestration ----------
     Appends a "Researching…" bot message with a staged progress bar and
     a Stop button (text button — no × glyph). On completion the progress
     message is removed and render(html) is called with either the
     researched answer or the original miss HTML as the last resort. */
  function handleMiss(q, missHtml, msgsEl, render) {
    logMiss(q);
    var token = { cancelled: false };
    var pel = document.createElement('div');
    pel.className = 'vai-msg bot vres-progress';
    pel.innerHTML =
      '<div class="vres-title">🔎 Researching…</div>' +
      '<div class="vres-barwrap"><div class="vres-bar" style="width:4%"></div></div>' +
      '<div class="vres-stage muted small">Checking the guide</div>' +
      '<button type="button" class="vres-stop">Stop</button>';
    if (msgsEl) {
      msgsEl.appendChild(pel);
      msgsEl.scrollTop = msgsEl.scrollHeight;
    }
    var bar = pel.querySelector('.vres-bar');
    var stageEl = pel.querySelector('.vres-stage');
    var stopBtn = pel.querySelector('.vres-stop');
    if (stopBtn) stopBtn.addEventListener('click', function () { token.cancelled = true; finish(null); });
    var done = false;
    function finish(res) {
      if (done) return;
      done = true;
      if (pel.parentNode) pel.parentNode.removeChild(pel);
      render(res && !token.cancelled ? res.html : missHtml);
    }
    run(q, {
      token: token,
      onStage: function (idx) {
        if (stageEl) stageEl.textContent = STAGE_NAMES[idx] + '…';
        if (bar) bar.style.width = Math.min(96, 8 + idx * 24) + '%';
        if (msgsEl) msgsEl.scrollTop = msgsEl.scrollHeight;
      }
    }).then(finish).catch(function () { finish(null); });
  }

  window.TVResearch = {
    isMiss: isMiss,
    logMiss: logMiss,
    run: run,
    handleMiss: handleMiss,
    subjectOf: subjectOf,
    stages: STAGE_NAMES.slice(),
    /* test hook: run the chain without UI, resolve {source, text} | null */
    _probe: function (q) {
      return run(q, {}).then(function (res) {
        return res ? { source: res.source, text: res.text } : null;
      });
    }
  };
})();
