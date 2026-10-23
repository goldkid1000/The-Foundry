/* The Foundry — Vaulty research mode + anonymous miss log (v2.23.0).
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

  var APP_VERSION = '2.23.2';

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
    /* v2.23.0: the on-device copy of the miss (js/vaulty-learn.js) —
       powers the "What Vaulty is learning" view on THIS device */
    try { if (window.TVLearn && TVLearn.recordMiss) TVLearn.recordMiss(text); } catch (e) {}
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

  /* ---------- v2.22.0: deep dig + conversational synthesis ----------
     The owner's direction: "answer my general question… respond normally
     to me… look for information on the web and dig in deep." So a general
     question no longer gets a quoted extract (or a canned card): Vaulty
     DIGS — live game data → the item's Wiki page → ONE HOP into the
     linked ability / mod / mechanic pages the question actually needs →
     the Wikipedia backstop — cross-checks what the sources agree on,
     and then SYNTHESIZES a natural prose answer from the retrieved facts
     only. In AI mode the on-device model writes that prose from the
     same fact bundle (validated afterwards — see js/ai.js); in guide /
     iOS mode the composed prose below is assembled from the best-
     matching retrieved sentences, deduplicated across sources. */
  var STOPWORDS = { 'the': 1, 'a': 1, 'an': 1, 'is': 1, 'are': 1, 'do': 1, 'does': 1, 'how': 1, 'what': 1, 'who': 1, 'where': 1, 'when': 1, 'why': 1, 'which': 1, 'can': 1, 'i': 1, 'me': 1, 'my': 1, 'it': 1, 'its': 1, 'of': 1, 'to': 1, 'in': 1, 'on': 1, 'for': 1, 'and': 1, 'or': 1, 'vs': 1, 'versus': 1, 'warframe': 1, 'about': 1, 'tell': 1, 'get': 1, 'with': 1, 'from': 1, 'this': 1, 'that': 1, 'you': 1, 'your': 1, 'make': 1, 'use': 1, 'using': 1, 'should': 1 };
  function contentTokens(s) {
    var seen = {}, out = [];
    norm(s).replace(/[^a-z0-9\s'-]/g, ' ').split(/\s+/).forEach(function (w) {
      if (w.length >= 3 && !STOPWORDS[w] && !seen[w]) { seen[w] = 1; out.push(w); }
    });
    return out;
  }
  var SIDE_FILLER = { which: 1, what: 1, is: 1, are: 1, the: 1, a: 1, an: 1, better: 1, best: 1, should: 1, i: 1, use: 1, for: 1, in: 1, on: 1, survival: 1, damage: 1, and: 1, or: 1, pick: 1, choose: 1, between: 1 };
  function cleanSide(s) {
    var words = norm(s).replace(/[^a-z0-9\s'-]/g, ' ').split(/\s+/).filter(Boolean);
    while (words.length > 1 && SIDE_FILLER[words[0]]) words.shift();
    while (words.length > 1 && SIDE_FILLER[words[words.length - 1]]) words.pop();
    return words.join(' ');
  }
  function compareSubjects(q) {
    var t = norm(q).replace(/\?+$/, '');
    var m = t.match(/(.+?)\s+(?:vs\.?|versus)\s+(.+)/);
    if (!m && /\b(better|difference|compare|which)\b/.test(t)) m = t.match(/(.+?)\s+or\s+(.+)/);
    if (!m) return null;
    var a = cleanSide(m[1]), b = cleanSide(m[2]);
    if (!a || !b || a === b) return null;
    return [a, b];
  }
  function wikiLinks(title) {
    var url = 'https://wiki.warframe.com/api.php?action=query&prop=links&titles=' +
      encodeURIComponent(title) + '&pllimit=60&plnamespace=0&format=json&origin=*';
    return fetchJSON(url, 7000).then(function (data) {
      var pages = data && data.query && data.query.pages;
      if (!pages) return [];
      var keys = Object.keys(pages);
      var links = (pages[keys[0]] && pages[keys[0]].links) || [];
      return links.map(function (l) { return l.title; }).filter(Boolean);
    }).catch(function () { return []; });
  }
  var HOP_TERMS = ['ability', 'damage', 'status', 'augment', 'helminth', 'armor', 'energy', 'critical', 'scaling', 'proc', 'buff'];
  function digSubject(subj, qtokens, hooks) {
    var facts = [], seen = {};
    function add(source, title, url, text) {
      if (!text || text.length < 30) return;
      var k = norm(title || source);
      if (seen[k]) return;
      seen[k] = 1;
      facts.push({ source: source, title: title || '', url: url || '', text: text });
    }
    function stage(idx) { if (hooks && hooks.onStage) hooks.onStage(idx); }
    stage(1);
    return stageLiveData(subj).then(function (hit) {
      if (hit) add(hit.source, subj, '', hit.text);
      stage(2);
      return wikiExtract('https://wiki.warframe.com/api.php', subj);
    }).then(function (w) {
      if (!w) return null;
      add('Warframe Wiki', w.title, w.url, w.text);
      return wikiLinks(w.title).then(function (links) {
        var scored = [];
        links.forEach(function (title) {
          if (norm(title) === norm(w.title) || title.indexOf(':') !== -1) return;
          var lt = norm(title), score = 0;
          qtokens.forEach(function (tk) { if (tk.length >= 4 && lt.indexOf(tk) !== -1) score += 2; });
          HOP_TERMS.forEach(function (ht) { if (lt.indexOf(ht) !== -1) score += 1; });
          if (score > 0) scored.push({ title: title, score: score });
        });
        scored.sort(function (a, b) { return b.score - a.score; });
        scored = scored.slice(0, 2);
        if (!scored.length) return null;
        stage(3);
        return Promise.all(scored.map(function (s) {
          return wikiExtract('https://wiki.warframe.com/api.php', s.title);
        })).then(function (hs) {
          hs.forEach(function (h) { if (h) add('Warframe Wiki', h.title, h.url, h.text); });
        });
      });
    }).then(function () {
      stage(4);
      return stageWikipedia(subj);
    }).then(function (wp) {
      if (wp) add(wp.source, subj, '', wp.text);
      return facts;
    }).catch(function () { return facts; });
  }
  function dig(q, opts) {
    opts = opts || {};
    var cmp = compareSubjects(q);
    var subjects = cmp || [subjectOf(q)];
    var qt = contentTokens(q);
    var all = [];
    if (opts.guideText) all.push({ source: 'The Foundry guide', title: 'Foundry guide', url: '', text: opts.guideText });
    var chain = Promise.resolve();
    subjects.forEach(function (subj) {
      chain = chain.then(function () { return digSubject(subj, qt, opts); })
        .then(function (facts) { all = all.concat(facts); });
    });
    return chain.then(function () { return { subjects: subjects, compare: !!cmp, facts: all }; });
  }
  function sourcesLine(facts) {
    var seen = {}, parts = [];
    facts.forEach(function (f) {
      var key = f.source + '|' + f.url;
      if (seen[key]) return;
      seen[key] = 1;
      parts.push(f.url
        ? '<a href="' + esc(f.url) + '" target="_blank" rel="noopener">' + esc(f.title || f.source) + '</a> (' + esc(f.source) + ')'
        : esc(f.source));
    });
    if (!parts.length) return '';
    return '<p class="muted small">🔎 Researched just now — ' + parts.join(' · ') +
      ' · The Vault\'s verified answers still come first.</p>';
  }
  function synthesize(q, bundle) {
    var qt = contentTokens(q);
    var cands = [];
    bundle.facts.forEach(function (f, fi) {
      String(f.text || '').split(/(?<=[.!?])\s+/).forEach(function (s) {
        s = s.replace(/\s+/g, ' ').trim();
        if (s.length < 40 || s.length > 340) return;
        var st = contentTokens(s), score = 0;
        qt.forEach(function (tk) { if (st.indexOf(tk) !== -1) score++; });
        if (f.source === 'The Foundry guide') score += 1;
        cands.push({ s: s, score: score, fi: fi, source: f.source });
      });
    });
    cands.sort(function (a, b) { return b.score - a.score || a.fi - b.fi; });
    var picked = [];
    for (var i = 0; i < cands.length && picked.length < 5; i++) {
      var c = cands[i];
      if (c.score <= 0) continue;
      var ct = contentTokens(c.s);
      var dup = picked.some(function (p) {
        var pt = contentTokens(p.s);
        var inter = ct.filter(function (w) { return pt.indexOf(w) !== -1; }).length;
        return inter / Math.max(1, Math.min(ct.length, pt.length)) > 0.62;
      });
      if (!dup) picked.push(c);
    }
    if (!picked.length) return null;
    picked.sort(function (a, b) { return a.fi - b.fi || b.score - a.score; });
    var intro = bundle.compare
      ? 'Here\'s how they stack up — I read up on both sides before answering:'
      : 'Good question — I dug into that one properly. Here\'s the honest picture on <b>' +
        esc(bundle.subjects.join('</b> and <b>')) + '</b>:';
    var srcSet = {};
    picked.forEach(function (p) { srcSet[p.source] = 1; });
    var html = '<p>' + intro + '</p>' +
      picked.map(function (p) { return '<p>' + esc(p.s) + '</p>'; }).join('') +
      (Object.keys(srcSet).length >= 2
        ? '<p class="muted small">Cross-checked across ' + Object.keys(srcSet).length + ' sources before answering.</p>'
        : '') +
      sourcesLine(bundle.facts);
    return html;
  }

  var CONVERSE_STAGES = ['Checking the guide', 'Live game data', 'Warframe Wiki', 'Digging deeper — linked pages', 'Wikipedia', 'Writing your answer'];
  /* opts: { isMiss, guideText, modelWriter(bundle) -> Promise<html|null> }
     The progress message mirrors handleMiss (staged bar + Stop text
     button). The final answer is synthesized prose with a "Researched
     just now" source line; the honest don't-know (missHtml) remains the
     last resort when the dig finds nothing usable. */
  function handleConverse(q, missHtml, msgsEl, render, opts) {
    opts = opts || {};
    if (opts.isMiss) logMiss(q);
    var token = { cancelled: false };
    var pel = document.createElement('div');
    pel.className = 'vai-msg bot vres-progress';
    pel.innerHTML =
      '<div class="vres-title">🔎 Digging in…</div>' +
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
    function finish(html) {
      if (done) return;
      done = true;
      if (pel.parentNode) pel.parentNode.removeChild(pel);
      render(html || missHtml);
    }
    function setStage(idx) {
      if (token.cancelled) return;
      if (stageEl) stageEl.textContent = CONVERSE_STAGES[idx] + '…';
      if (bar) bar.style.width = Math.min(96, 8 + idx * 17) + '%';
      if (msgsEl) msgsEl.scrollTop = msgsEl.scrollHeight;
    }
    setStage(0);
    dig(q, {
      guideText: opts.guideText || null,
      onStage: function (idx) { setStage(idx); }
    }).then(function (bundle) {
      if (token.cancelled) { finish(null); return; }
      setStage(5);
      if (opts.modelWriter) {
        var bundleArg = {
          question: q,
          subjects: bundle.subjects,
          compare: bundle.compare,
          facts: bundle.facts,
          factsText: bundle.facts.map(function (f) {
            return '[' + f.source + (f.title ? ' — ' + f.title : '') + '] ' + f.text;
          }).join('\n'),
          sourcesLine: sourcesLine(bundle.facts)
        };
        Promise.resolve(opts.modelWriter(bundleArg)).then(function (html) {
          if (token.cancelled) { finish(null); return; }
          if (html) {
            finish(html.indexOf('Researched just now') !== -1 ? html : html + sourcesLine(bundle.facts));
          } else {
            finish(synthesize(q, bundle));
          }
        }, function () { finish(synthesize(q, bundle)); });
        return;
      }
      finish(synthesize(q, bundle));
    }).catch(function () { finish(null); });
  }

  window.TVResearch = {
    isMiss: isMiss,
    logMiss: logMiss,
    run: run,
    handleMiss: handleMiss,
    handleConverse: handleConverse,
    _dig: dig,
    _synthesize: synthesize,
    _compareSubjects: compareSubjects,
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
