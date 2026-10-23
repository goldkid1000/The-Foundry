/* The Foundry — Vault Guide chat. Built-in guide answering from the Vault's own
   data (warframes, weapons, mods, arcanes, relics, builds, farming). Not a live AI. */
(function () {
  'use strict';

  var D = null;          /* loaded data cache */
  var loadingPromise = null;
  var opened = false;

  function esc(s) { return window.TV ? window.TV.esc(s) : String(s); }
  function link(page, name) {
    return page + '#' + encodeURIComponent(name);
  }

  /* drops can be a string, a string array, or [{location, chance}] */
  function fmtDrops(drops) {
    if (!drops) return '';
    var arr = [].concat(drops);
    if (!arr.length) return '';
    return arr.map(function (d) {
      if (typeof d === 'string') return d;
      if (d && d.location) return d.location + (d.chance != null ? ' (' + d.chance + '%)' : '');
      return '';
    }).filter(Boolean).join('; ');
  }

  /* ---------- lazy data load (once, reused for every question) ---------- */
  function loadData() {
    if (D) return Promise.resolve(D);
    if (loadingPromise) return loadingPromise;
    var TV = window.TV;
    loadingPromise = Promise.all([
      TV.getJSONParts('data/site/search-index', 7),
      TV.getJSONParts('data/site/builds', 11),
      TV.getJSONParts('data/site/warframes', 2),
      TV.getJSONParts('data/site/weapons', 3),
      TV.getJSONParts('data/site/mods', 9),
      TV.getJSONParts('data/site/relics', 6),
      TV.getJSONParts('data/site/arcanes', 2),
      TV.getJSON('data/site/farming.json')
    ]).then(function (r) {
      D = {
        index: r[0], builds: r[1], warframes: r[2], weapons: r[3],
        mods: r[4], relics: r[5], arcanes: r[6], farming: r[7]
      };
      return D;
    });
    return loadingPromise;
  }

  /* ---------- matching helpers ---------- */
  function norm(s) { return String(s || '').toLowerCase().trim(); }

  /* drop leading "the/a/an" so "is the kuva bramma good" still matches */
  function stripArticles(s) { return norm(s).replace(/^(the|a|an)\s+/, ''); }

  /* escape + turn literal \n sequences in data into line breaks */
  function fmtText(s) {
    return esc(s).replace(/\\n/g, '<br>');
  }

  /* levenshtein distance for typo tolerance */
  function lev(a, b) {
    var m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    var d = [], i, j;
    for (i = 0; i <= m; i++) d[i] = [i];
    for (j = 0; j <= n; j++) d[0][j] = j;
    for (i = 1; i <= m; i++) for (j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i-1][j]+1, d[i][j-1]+1, d[i-1][j-1] + (a[i-1]===b[j-1]?0:1));
    return d[m][n];
  }

  function findByName(list, q) {
    q = norm(q);
    if (!q) return null;
    var i, n;
    for (i = 0; i < list.length; i++) { if (norm(list[i].name) === q) return list[i]; }
    for (i = 0; i < list.length; i++) {
      n = norm(list[i].name);
      if (n.indexOf(q) === 0 && q.length >= 4) return list[i];
    }
    for (i = 0; i < list.length; i++) {
      n = norm(list[i].name);
      var idx = n.indexOf(q);
      if (idx === -1) continue;
      /* v2.20.0: short queries must match at a word boundary — "aya" used
         to fuzzy-hit "Gnashing Payara" (a fish mod) and answer an Aya farm
         question with fish drop tables. Mid-word matches on ≤4-letter
         queries are almost never the intent. */
      if (q.length <= 4 && idx > 0 && n.charAt(idx - 1) !== ' ') continue;
      return list[i];
    }

    /* fuzzy: allow 1-2 typos on names of similar length.
       v2.19.0: for short queries the first letter must match — otherwise
       "kuva" typo-matched "Nova" (distance 2) and farm questions about
       Kuva answered with Nova's drop location. */
    var best = null, bestD = 3;
    for (i = 0; i < list.length; i++) {
      n = norm(list[i].name);
      if (Math.abs(n.length - q.length) > 2) continue;
      if (q.length <= 6 && n.charAt(0) !== q.charAt(0)) continue;
      var dd = lev(n, q);
      /* very short names collide at distance 2 (kuva→Khra) — allow only 1 */
      if (q.length <= 5 && dd > 1) continue;
      if (dd < bestD) { bestD = dd; best = list[i]; }
    }
    return best;
  }

  function findBuild(q) {
    q = norm(q);
    if (!q) return null;
    var i, b;
    for (i = 0; i < D.builds.length; i++) {
      b = D.builds[i];
      if (norm(b.item) === q || norm(b.name) === q) return b;
    }
    for (i = 0; i < D.builds.length; i++) {
      b = D.builds[i];
      if (norm(b.item).indexOf(q) !== -1 && q.length >= 4) return b;
    }
    return null;
  }

  /* find a farm answer for a thing across warframes, mods, arcanes, relics, resources */
  function findFarm(q) {
    /* v2.23.1: word-boundary fallback — a farm subject is often a whole
       phrase ("the nyx prime parts"); the named frame inside it counts */
    var w = findByName(D.warframes, q) || findItemInTextWB(D.warframes, q);
    if (w && w.farm) return { kind: 'warframe', e: w };
    var m = findByName(D.mods, q);
    if (m && fmtDrops(m.drops)) return { kind: 'mod', e: m };
    var a = findByName(D.arcanes, q);
    if (a && a.drops && a.drops.length) return { kind: 'arcane', e: a };
    var r = findByName(D.relics, q);
    if (r) return { kind: 'relic', e: r };
    /* resource / farm-spot tables (v2.19.0: currencyFarms included — credits,
       endo, kuva and focus lookups used to miss this table entirely.
       Two passes: an exact/prefix "what" match beats a contains match, so
       "kuva" finds "Kuva (Riven rolling)" instead of "Entropic Kuva".) */
    var cats = ['resourceFarms', 'modFarms', 'arcaneFarms', 'relicFarms', 'primePartFarms', 'currencyFarms'];
    var pass, c, list, i;
    for (pass = 0; pass < 2; pass++) {
      for (c = 0; c < cats.length; c++) {
        list = D.farming[cats[c]] || [];
        for (i = 0; i < list.length; i++) {
          var what = norm(list[i].what);
          var hit = pass === 0
            ? (what.indexOf(norm(q)) === 0 && norm(q).length >= 3)
            : (what.indexOf(norm(q)) !== -1 && norm(q).length >= 3);
          if (hit) return { kind: 'spot', e: list[i] };
        }
      }
    }
    /* prime weapon/part -> which relics drop it? */
    var wp = findByName(D.weapons, q) || findItemInTextWB(D.weapons, q);
    if (wp) {
      var hits = [];
      for (var ri = 0; ri < D.relics.length && hits.length < 6; ri++) {
        var rel = D.relics[ri];
        for (var rj = 0; rj < rel.rewards.length; rj++) {
          if (norm(rel.rewards[rj].name).indexOf(norm(wp.name)) !== -1) {
            hits.push({ relic: rel, reward: rel.rewards[rj] });
            break;
          }
        }
      }
      if (hits.length) return { kind: 'weapon-relic', e: wp, hits: hits };
      return { kind: 'weapon', e: wp };
    }
    return null;
  }

  /* ---------- v2.19.4: copyable build cards ----------
     When the guide brain answers with a build, the answer carries a tidy
     build card (title, aura/exilus slots, mods in mod-screen order,
     arcanes, play note) plus Copy buttons. Warframe has NO external build
     import — build links are minted in-game only — so the honest offer is
     one-tap copying of a clean text build the Tenno can paste anywhere
     and slot in order. Payloads live in vbcStore keyed by the button's
     data-vbc id, so the copied text always matches the card on screen. */
  var vbcSeq = 0;
  var vbcStore = {};

  function vbcCleanSlot(v) {
    var s = String(v == null ? '' : v).trim();
    return (!s || /^none$/i.test(s)) ? '' : s;
  }

  function vbcArcanes(arcane) {
    var s = vbcCleanSlot(arcane);
    if (!s) return [];
    return s.split(/\s*\+\s*/).map(function (x) { return x.trim(); }).filter(Boolean);
  }

  function vbcFullText(d) {
    var lines = [d.title];
    if (d.aura) lines.push('Aura: ' + d.aura);
    if (d.exilus) lines.push('Exilus: ' + d.exilus);
    lines.push('Mods:');
    d.mods.forEach(function (m) { lines.push(m); });
    if (d.arcanes.length) lines.push((d.arcanes.length > 1 ? 'Arcanes: ' : 'Arcane: ') + d.arcanes.join(' + '));
    if (d.arcanesText) lines.push('Arcanes: ' + d.arcanesText);
    if (d.note) lines.push('Note: ' + d.note);
    return lines.join('\n');
  }

  function vbcCompactText(d) {
    var parts = [];
    if (d.aura) parts.push(d.aura + ' (Aura)');
    if (d.exilus) parts.push(d.exilus + ' (Exilus)');
    d.mods.forEach(function (m) { parts.push(m); });
    d.arcanes.forEach(function (a) { parts.push(a + ' (Arcane)'); });
    if (d.arcanesText) parts.push(d.arcanesText);
    return d.title + ': ' + parts.join(', ');
  }

  /* data: {title, aura, exilus, mods:[names], arcanes:[names], note} */
  function buildCard(d) {
    /* v2.19.6: clean the mod list before rendering — a card must always
       show its mods. Empty/garbage entries are dropped, and if nothing
       survives, render an honest placeholder instead of a titled card
       with an empty grid and working Copy buttons (the Q2 bug). */
    var cleanMods = (d.mods || []).map(function (m) { return String(m == null ? '' : m).trim(); }).filter(Boolean);
    if (!cleanMods.length) {
      return '<div class="vai-build-card"><div class="vbc-title">' + esc(d.title) + '</div>' +
        '<p class="muted small">The mod list for this one didn\'t come through — find it on the <a href="builds.html">builds page</a>.</p></div>';
    }
    d = { title: d.title, aura: d.aura, exilus: d.exilus, mods: cleanMods, arcanes: d.arcanes || [], arcanesText: d.arcanesText, note: d.note };
    var id = 'vbc' + (++vbcSeq);
    vbcStore[id] = { full: vbcFullText(d), compact: vbcCompactText(d) };
    var slots = '';
    if (d.aura) slots += '<div class="vbc-slot"><span>Aura</span>' + esc(d.aura) + '</div>';
    if (d.exilus) slots += '<div class="vbc-slot"><span>Exilus</span>' + esc(d.exilus) + '</div>';
    var cells = d.mods.map(function (m) { return '<div class="vbc-mod">' + esc(m) + '</div>'; }).join('');
    return '<div class="vai-build-card">' +
      '<div class="vbc-title">' + esc(d.title) + '</div>' +
      slots +
      '<div class="vbc-grid">' + cells + '</div>' +
      (d.arcanes.length ? '<div class="vbc-arcanes"><span>' + (d.arcanes.length > 1 ? 'Arcanes' : 'Arcane') + '</span>' + esc(d.arcanes.join(' + ')) + '</div>' : '') +
      (d.arcanesText ? '<div class="vbc-arcanes"><span>Arcanes</span>' + esc(d.arcanesText) + '</div>' : '') +
      (d.note ? '<div class="vbc-note">' + esc(d.note) + '</div>' : '') +
      '<div class="vbc-actions">' +
      '<button type="button" class="vbc-copy" data-vbc="' + id + '">Copy build</button>' +
      '<button type="button" class="vbc-copy vbc-compact-btn" data-vbc="' + id + '" data-compact="1">Copy compact</button>' +
      '</div>' +
      '<div class="vbc-sub">Paste it anywhere — Warframe itself only makes build links in-game, so slot the mods in this order.</div>' +
      '</div>';
  }

  function vbcFallbackCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    } catch (e) {}
  }

  function vbcCopied(btn) {
    if (!btn) return;
    if (!btn.getAttribute('data-label')) btn.setAttribute('data-label', btn.textContent);
    btn.textContent = 'Copied ✓';
    btn.classList.add('copied');
    setTimeout(function () {
      btn.textContent = btn.getAttribute('data-label');
      btn.classList.remove('copied');
    }, 1600);
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    var btn = (t && typeof t.closest === 'function') ? t.closest('.vbc-copy') : null;
    if (!btn) return;
    var rec = vbcStore[btn.getAttribute('data-vbc')];
    if (!rec) return;
    var text = btn.hasAttribute('data-compact') ? rec.compact : rec.full;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { vbcCopied(btn); }, function () {
        vbcFallbackCopy(text); vbcCopied(btn);
      });
    } else {
      vbcFallbackCopy(text); vbcCopied(btn);
    }
  });

  /* ---------- answer builders (HTML) ---------- */
  function buildAnswer(b) {
    var card = buildCard({
      title: b.name || b.item,
      aura: vbcCleanSlot(b.aura),
      exilus: vbcCleanSlot(b.exilus),
      mods: (b.mods || []).map(function (m) { return m.name; }),
      arcanes: vbcArcanes(b.arcane),
      note: b.playstyle || ''
    });
    return 'Good pick — here\'s the <b>' + esc(b.name || b.item) + '</b> setup:' +
      (window.TV.badge ? ' ' + window.TV.badge(b.tags || []) : '') +
      '<p>' + fmtText(b.description || '') + '</p>' +
      card +
      '<p class="muted small">Want to know where to farm any of these mods? Just ask.</p>' +
      alternativesHtml(b.item, b) +
      '<p><a href="builds.html#build-' + encodeURIComponent(b.id) + '">Open the full build &rarr;</a></p>';
  }

  function farmAnswer(f) {
    var e = f.e;
    var itemLabel = e.name || e.what || 'it';
    /* build offer only makes sense for gear, not raw resources */
    var buildOffer = (f.kind === 'spot')
      ? ''
      : '<p class="muted small">Want a build for it once you have it? Just ask <i>"make me a ' +
        esc(itemLabel) + ' build"</i>.</p>';
    if (f.kind === 'warframe') {
      return 'Good pick — here\'s where to get <b>' + esc(e.name) + '</b>:<p><b>📍 Farm:</b> ' + esc(e.farm) + '</p>' +
        buildOffer +
        '<p><a href="' + link('warframes.html', e.name) + '">Warframe page &rarr;</a></p>';
    }
    if (f.kind === 'mod') {
      return 'Here\'s where <b>' + esc(e.name) + '</b> drops:<p><b>📍 Farm:</b> ' + esc(fmtDrops(e.drops)) + '</p>' +
        buildOffer +
        '<p><a href="' + link('mods.html', e.name) + '">Mod page &rarr;</a></p>';
    }
    if (f.kind === 'arcane') {
      var aloc = fmtDrops(e.drops);
      return '<b>' + esc(e.name) + '</b>' +
        (aloc ? '<p><b>📍 Farm:</b> ' + esc(aloc) + '</p>' : '<p>Farm info coming — check the arcane page for now.</p>') +
        buildOffer +
        '<p><a href="' + link('arcanes.html', e.name) + '">Arcane page &rarr;</a></p>';
    }
    if (f.kind === 'relic') {
      return '<b>' + esc(e.name) + '</b> (' + esc(e.tier) + ' relic)<p>📍 Crack it in <b>Void Fissure</b> missions — ' +
        'relics drop from endless missions (survival/defense), bounties, and Void captures.</p>' +
        buildOffer +
        '<p><a href="' + link('relics.html', e.name) + '">Relic page &rarr;</a></p>';
    }
    if (f.kind === 'spot') {
      return 'You\'ll find <b>' + esc(e.what) + '</b> here:<p><b>📍 Farm:</b> ' + esc(e.source) + '</p>' +
        buildOffer +
        '<p><a href="farming.html">Farming Hub &rarr;</a></p>';
    }
    if (f.kind === 'weapon-relic') {
      var rows = f.hits.map(function (h) {
        return '<li><a href="' + link('relics.html', h.relic.name) + '">' + esc(h.relic.name) +
          '</a> <span class="muted small">' + esc(h.relic.tier) + ' · ' + esc(h.reward.rarity) + '</span></li>';
      }).join('');
      return 'To get <b>' + esc(e.name) + '</b>, crack these relics in Void Fissures:<ul>' +
        rows + '</ul>' + buildOffer +
        '<p><a href="' + link('weapons.html', e.name) + '">Weapon page &rarr;</a></p>';
    }
    return '<b>' + esc(e.name) + '</b><p>The Vault doesn\'t list a farm spot for this one yet — ' +
      'the in-game Codex will have the latest source.</p>' +
      buildOffer +
      '<p><a href="' + link('weapons.html', e.name) + '">Weapon page &rarr;</a></p>';
  }

  function describeAnswer(e, page) {
    var desc = e.description || e.effect || '';
    var extra = '';
    if (e.effect) extra += '<p><b>Effect:</b> ' + fmtText(e.effect) + '</p>';
    var dloc = fmtDrops(e.drops);
    if (dloc) extra += '<p><b>Farm:</b> ' + esc(dloc) + '</p>';
    if (e.farm) extra += '<p><b>Farm:</b> ' + esc(e.farm) + '</p>';
    return '<b>' + esc(e.name) + '</b>' + (desc ? '<p>' + fmtText(desc) + '</p>' : '') + extra +
      '<p><a href="' + link(page, e.name) + '">Full page &rarr;</a></p>';
  }

  function steelPathAnswer() {
    var picks = D.builds.filter(function (b) {
      return (b.tags || []).indexOf('steel-path') !== -1 || (b.tags || []).indexOf('one-shot') !== -1;
    }).slice(0, 8);
    if (!picks.length) return 'Hmm, no Steel Path builds in the Vault yet — but ask me <i>"make me a [frame/weapon] Steel Path build"</i> and I\'ll generate one for you on the spot.';
    var rows = picks.map(function (b) {
      return '<li><a href="builds.html#build-' + encodeURIComponent(b.id) + '"><b>' + esc(b.name || b.item) +
        '</b></a> <span class="muted small">' + esc(b.item) + '</span> ' +
        (window.TV.badge ? window.TV.badge(b.tags || []) : '') + '</li>';
    }).join('');
    return 'Here are the Vault\'s <b>Steel Path / one-shot builds</b> — these delete high-level enemies:<ul>' + rows + '</ul>' +
      '<p class="muted small">Don\'t see your favorite? Ask <i>"make me a [frame] Steel Path build"</i> and I\'ll whip one up.</p>' +
      '<p><a href="builds.html">All builds &rarr;</a></p>';
  }

  function sellAnswer() {
    return 'Selling for platinum is easier than it looks. Here\'s the loop:' +
      '<p><b>1.</b> Farm <b>prime parts</b> from Void Relics (crack them in fissure missions).<br>' +
      '<b>2.</b> List them on <b>warframe.market</b> — check the Live tab\'s price checker first so you don\'t undersell.<br>' +
      '<b>3.</b> Meet the buyer in-game and trade at a relay or your clan dojo.</p>' +
      '<p class="muted small">Pro tip: vaulted relics and rare mods fetch the most. Good luck out there, Tenno. 💰</p>' +
      '<p><a href="trading.html">Full trading guide &rarr;</a></p>';
  }

  function beginnerAnswer() {
    return 'Welcome to Warframe, Tenno! 🎉 Here\'s the short version of what to do first:' +
      '<p><b>1.</b> Pick <b>Excalibur</b> as your starter frame — simple, strong, forgiving.<br>' +
      '<b>2.</b> Clear the <b>star chart</b> planet by planet and open <b>junctions</b> — that\'s your main progression.<br>' +
      '<b>3.</b> Do the early <b>quests</b> (Vor\'s Prize → Once Awake → The Archwing) — they unlock core systems.<br>' +
      '<b>4.</b> Level <b>mods</b>, not just gear — a ranked-up Serration matters more than a new rifle.<br>' +
      '<b>5.</b> Don\'t stress about builds yet — just ask me <i>"make me an Excalibur build"</i> when you\'re ready.</p>' +
      '<p><a href="index.html#beginner-guide">Full New Player Guide &rarr;</a></p>';
  }

  function helpAnswer() {
    return 'Here\'s what I can do for you, Tenno:' +
      '<ul><li>🛠 <b>Build anything</b> — <i>"make me a Nova Prime Steel Path build"</i></li>' +
      '<li>💥 <b>One-shot formula</b> — <i>"one-shot formula"</i> for the Steel Path delete-everything theory</li>' +
      '<li>🎯 <b>One-shot build library</b> — <i>"tenet envoy"</i>, <i>"kronen prime"</i>, <i>"nova prime"</i>, <i>"stropha"</i>, <i>"knell prime"</i>… 30+ curated Steel Path one-shot builds, every mod explained</li>' +
      '<li>🧪 <b>Primers</b> — <i>"primer"</i> for Kuva Nukor / Epitaph / Verglas Prime setups</li>' +
      '<li>💎 <b>Archon shards</b> — <i>"archon shards"</i> for one-shot builds</li>' +
      '<li>🦾 <b>Damage frames</b> — <i>"best frame for damage"</i> for one-shot enablers</li>' +
      '<li>📍 <b>Find anything</b> — <i>"where do I farm Argon Crystals"</i></li>' +
      '<li>❓ <b>Explain mods & arcanes</b> — <i>"what does Hunter Munitions do"</i></li>' +
      '<li>💰 <b>Platinum trading</b> — <i>"how do I sell for platinum"</i></li>' +
      '<li>🛎 <b>Live stuff, answered live</b> — <i>"when is Baro back?"</i>, <i>"what events are on?"</i>, <i>"Nightwave challenges"</i>, <i>"active fissures"</i>, <i>"latest hotfix"</i> — pulled from the live worldstate feed</li>' +
      '<li>🧭 <b>Doctrine & guidance</b> — <i>"how do I mod"</i>, <i>"what is a Riven"</i>, <i>"best tank frame"</i>, <i>"how do I raise Mastery Rank"</i></li>' +
      '<li>🌱 <b>New player help</b> — <i>"I\'m new, what should I do first"</i></li></ul>' +
      '<p class="muted small">I\'m the Vault\'s built-in guide — I answer from the Vault\'s own data plus the live worldstate feed. ' +
      'And if I hit something I don\'t know, I research it live first — the honest don\'t-know is my last resort, never my first.</p>';
  }

  /* v2.19.0: the honest dead-end. When Vaulty doesn't know, it says so
     plainly and offers one-tap research on the user's exact question —
     the Warframe Wiki and the open web — instead of a canned shrug. */
  function researchMarkup(q) {
    var wiki = 'https://wiki.warframe.com/w/Special:Search?search=' + encodeURIComponent(q);
    var web = 'https://www.google.com/search?q=' + encodeURIComponent(q + ' warframe');
    return '<div class="vai-research">' +
      '<a class="vai-research-btn" href="' + wiki + '" target="_blank" rel="noopener">🔎 Research on the Warframe Wiki</a>' +
      '<a class="vai-research-btn" href="' + web + '" target="_blank" rel="noopener">🌐 Research on the web</a></div>';
  }

  /* v2.23.0 ORDERING RULE: this is the LAST RESORT, and it must read
     like one in every variant. The panel layer runs the research /
     compose pipeline (js/vaulty-research.js) BEFORE this text can
     ever render — it keys off the canonical miss signature below, so
     BOTH branches carry it. The "did you mean" suggestions ride along
     inside the miss text: if the dig finds nothing, the Tenno still
     sees them under the honest don't-know. */
  function fallbackAnswer(q) {
    var hits = D.index.filter(function (e) {
      return e.n && norm(e.n).indexOf(norm(q)) !== -1;
    }).slice(0, 5);
    var rows = hits.map(function (h) {
      return '<li><a href="' + esc(h.u) + '"><b>' + esc(h.n) + '</b></a> ' +
        '<span class="muted small">' + esc(h.t) + '</span></li>';
    }).join('');
    return 'Straight up: I don\'t know that one — "' + esc(q) + '" isn\'t in the Vault\'s data, and I won\'t make something up. 🤔 ' +
      (hits.length ? '<p>Closest matches in the Vault:</p><ul>' + rows + '</ul>' : '') +
      'You can research it in one tap:' + researchMarkup(q) +
      '<p class="muted small">Or ask me about a warframe, weapon, mod, arcane, or relic by name — or say <i>"help"</i> to see everything I can do.</p>';
  }

/* ---------- GENERATIVE BUILD ENGINE ----------
   Generates complete 8-mod loadouts on the spot for ANY warframe or weapon.
   Picks mods based on the item's actual stats + requested purpose. */

function findModExact(name) {
  var q = norm(name);
  for (var i = 0; i < D.mods.length; i++) {
    if (norm(D.mods[i].name) === q) return D.mods[i];
  }
  return null;
}

/* pick a mod, return {mod, reason} or null if not in DB */
function pick(name, reason) {
  var m = findModExact(name);
  if (!m) return null;
  return { mod: m, reason: reason };
}

function modFarmLine(m) {
  var d = fmtDrops(m.drops);
  return d ? '<span class="muted small">Farm: ' + esc(d) + '</span>' : '';
}

/* ---------- v2.19.5: validate-on-serve ----------
   A build may only render if every mod in it is real (present in the mods
   database under its exact name), fits the item's class, and breaks no slot
   rule: aura mods live only in a Warframe's aura field — never inside a mod
   list, and never on a weapon at all; no duplicate mods; 8 regular slots
   (a 9th entry is allowed only when its note flags it as the Exilus mod —
   the library's own convention). The same checks guard free-chat AI text
   via _validateAnswer, and tools/validate-builds.py runs them over the
   whole library offline. */
var MOD_TYPE_CLASS = {
  'Warframe Mod': 'warframe', 'Primary Mod': 'rifle', 'Shotgun Mod': 'shotgun',
  'Secondary Mod': 'pistol', 'Melee Mod': 'melee', 'Stance Mod': 'stance',
  'Companion Mod': 'companion', 'Arch-Gun Mod': 'archgun', 'Arch-Melee Mod': 'archmelee',
  'Archwing Mod': 'archwing', 'Necramech Mod': 'necramech', 'Parazon Mod': 'parazon',
  'Plexus Mod': 'plexus', 'K-Drive Mod': 'kdrive'
};
var SET_COMPAT_CLASS = { 'WARFRAME': 'warframe', 'Rifle': 'rifle', 'Shotgun': 'shotgun', 'Pistol': 'pistol', 'Melee': 'melee', 'COMPANION': 'companion', 'AURA': 'aura', 'ANY': 'any' };

function modEntries(name) {
  var q = norm(name), out = [];
  for (var i = 0; i < D.mods.length; i++) if (norm(D.mods[i].name) === q) out.push(D.mods[i]);
  return out;
}
function isAuraMod(name) {
  var es = modEntries(name);
  for (var i = 0; i < es.length; i++) if (es[i].compat === 'AURA') return true;
  return false;
}
function isItemName(s) {
  var q = norm(s), i;
  for (i = 0; i < D.warframes.length; i++) if (norm(D.warframes[i].name) === q) return true;
  for (i = 0; i < D.weapons.length; i++) if (norm(D.weapons[i].name) === q) return true;
  return false;
}
function modFitsClass(name, cls, item) {
  var es = modEntries(name);
  if (!es.length) return false;
  /* faction (Bane/Cleanse/Expel/Smite) mods exist per weapon class under one name */
  if (/^(primed )?(bane of|cleanse|expel|smite) /.test(norm(name))) {
    return cls === 'rifle' || cls === 'shotgun' || cls === 'pistol' || cls === 'melee';
  }
  for (var i = 0; i < es.length; i++) {
    var e = es[i], c = e.compat || '';
    if (c === 'AURA') continue;
    if (c === 'PRIMARY' && (cls === 'rifle' || cls === 'shotgun')) return true;
    if (c === 'ANY') return true;
    if (c && isItemName(c)) {
      /* augment locked to one frame/weapon */
      var it = norm(item), cc = norm(c);
      if (it === cc || it.replace(/ prime$/, '') === cc || it.slice(-(cc.length + 1)) === ' ' + cc) return true;
      continue;
    }
    var mc = e.type === 'Mod Set Mod' ? SET_COMPAT_CLASS[c] : MOD_TYPE_CLASS[e.type];
    if (mc === 'any' || mc === cls) return true;
  }
  return false;
}
function buildClassOf(b) {
  var cat = b.category || '';
  if (cat === 'Warframe') return 'warframe';
  if (cat === 'Shotgun') return 'shotgun';
  if (cat === 'Secondary') return 'pistol';
  if (cat === 'Melee') return 'melee';
  if (cat === 'Archgun') return 'archgun';
  if (cat === 'Archmelee') return 'archmelee';
  if (cat === 'Companion') return 'companion';
  if (cat === 'Primary') {
    for (var i = 0; i < D.weapons.length; i++) {
      if (norm(D.weapons[i].name) === norm(b.item)) {
        return (D.weapons[i].category || '') === 'Shotgun' ? 'shotgun' : 'rifle';
      }
    }
    return 'rifle';
  }
  return '';
}
function buildIsValid(b) {
  if (!D || !b || !b.mods || !b.mods.length) return false;
  var cls = buildClassOf(b);
  if (!cls) return false;
  var seen = {};
  for (var i = 0; i < b.mods.length; i++) {
    var n = b.mods[i] && b.mods[i].name;
    if (!n || !findModExact(n)) return false;
    if (isAuraMod(n)) return false;
    if (!modFitsClass(n, cls, b.item)) return false;
    var k = norm(n);
    if (seen[k]) return false;
    seen[k] = 1;
  }
  if (b.mods.length !== 8) {
    var ninth = b.mods[8];
    if (!(b.mods.length === 9 && ninth && /exilus/i.test(ninth.note || ninth.why || ''))) return false;
  }
  if (b.aura && (cls !== 'warframe' || !isAuraMod(b.aura))) return false;
  if (b.exilus && (!findModExact(b.exilus) || !modFitsClass(b.exilus, cls, b.item))) return false;
  return true;
}

/* Validate free-form answer text (the downloaded-AI path in js/ai.js).
   If the text presents a build (4+ real mod names) for an identifiable
   item, every named mod must be legal on that item — aura mods and
   wrong-class mods fail. Returns true when the answer may be shown. */
function validateAnswerText(text, question) {
  if (!D || !text) return true;
  var hay = ' ' + norm(text).replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ') + ' ';
  /* longest names first, matched spans masked out — otherwise the melee
     mod "Reach" would "appear" inside "Augur Reach", "Flow" inside
     "Primed Flow", and legal builds would fail the check */
  var cands = [], seenC = {};
  for (var ci = 0; ci < D.mods.length; ci++) {
    var cnm = norm(D.mods[ci].name).replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (cnm.length < 5 || seenC[cnm]) continue;
    seenC[cnm] = 1;
    cands.push({ nm: cnm, name: D.mods[ci].name });
  }
  cands.sort(function (a, b) { return b.nm.length - a.nm.length; });
  var found = [];
  for (var i = 0; i < cands.length; i++) {
    var idx = hay.indexOf(' ' + cands[i].nm + ' ');
    if (idx !== -1) {
      found.push(cands[i].name);
      hay = hay.slice(0, idx) + ' ' + new Array(cands[i].nm.length + 1).join(' ') + hay.slice(idx + cands[i].nm.length + 1);
    }
  }
  if (found.length < 4) return true; /* not a build-shaped answer */
  var qn = norm(question || '');
  var frame = findItemInText(D.warframes, qn);
  var cls, itemName;
  if (frame) { cls = 'warframe'; itemName = frame.name; }
  else {
    var wpn = findItemInText(D.weapons, qn);
    if (!wpn) return true; /* no identifiable subject — the router guard covers these */
    itemName = wpn.name;
    var wc = weaponClass(wpn);
    cls = wc === 'secondary' ? 'pistol' : (wc === 'primary' ? 'rifle' : wc);
  }
  for (var j = 0; j < found.length; j++) {
    if (isAuraMod(found[j])) {
      if (cls !== 'warframe') return false;
      continue;
    }
    if (!modFitsClass(found[j], cls, itemName)) return false;
  }
  /* v2.22.0: fabricated-name scan. The checks above prove every REAL mod
     named in the answer is legal for the item — but a model can also slip
     in a mod-shaped name that does not exist at all ("Primed Thunder
     Rounds"). In a build-shaped answer (4+ real mods and an identifiable
     item — both already established above), any list-entry line that
     reads as a mod name (2–4 Title-Case words) must exist somewhere in
     the Vault's data: mods, arcanes, items, or ability names. A name
     found nowhere is invented, and the answer is discarded. */
  var known = {}, ki;
  for (ki = 0; ki < D.mods.length; ki++) known[norm(D.mods[ki].name)] = 1;
  for (ki = 0; ki < D.arcanes.length; ki++) known[norm(D.arcanes[ki].name)] = 1;
  for (ki = 0; ki < D.warframes.length; ki++) {
    known[norm(D.warframes[ki].name)] = 1;
    (D.warframes[ki].abilities || []).forEach(function (a) { known[norm(a.name)] = 1; });
  }
  for (ki = 0; ki < D.weapons.length; ki++) known[norm(D.weapons[ki].name)] = 1;
  var LIST_LABELS = { 'mods': 1, 'mod list': 1, 'arcane': 1, 'arcanes': 1, 'aura': 1, 'exilus': 1, 'stance': 1, 'build': 1, 'loadout': 1, 'setup': 1 };
  var NAME_RE = /^[A-Z][A-Za-z']*(?:\s+(?:[A-Z][A-Za-z']*|of|the|and)){1,3}$/;
  var lines = String(text).split(/\n/);
  for (var li = 0; li < lines.length; li++) {
    var s = lines[li].replace(/[*_`#>]/g, '').trim();
    if (!s) continue;
    var isEntry = false;
    var bm = s.match(/^(?:[-•·]|\d{1,2}[.)])\s+(.*)$/);
    if (bm) { isEntry = true; s = bm[1].trim(); }
    var colon = s.indexOf(':');
    if (colon !== -1 && LIST_LABELS[norm(s.slice(0, colon))]) { isEntry = true; s = s.slice(colon + 1).trim(); }
    var cand = s.split(/[—–(]/)[0].split(/\s+-\s+/)[0].replace(/[.,;:]+$/, '').trim();
    if (!isEntry && NAME_RE.test(cand) && cand === s.replace(/[.,;:]+$/, '').trim()) isEntry = true;
    if (!isEntry) continue;
    if (!NAME_RE.test(cand)) continue;
    if (!known[norm(cand)]) return false;
  }
  /* v2.22.0 (cont.): comma enumerations. A model that lists mods in
     prose ("try Serration, Split Chamber, …, and Primed Quantum
     Splitter") produces no list lines for the scan above. When a text
     enumerates 3+ KNOWN mods that way, any other Title-Case phrase
     (2–4 words) found in a segment of the same enumeration is treated
     as a claimed mod name and must exist in the data too. A small
     allowlist covers fixed game phrases that are not names at all. */
  var PHRASE_ALLOW = {
    'steel path': 1, 'the circuit': 1, 'void cascade': 1, 'void flood': 1,
    'red veil': 1, 'steel meridian': 1, 'new loka': 1, 'perrin sequence': 1,
    'cephalon suda': 1, 'arbiters of hexis': 1, 'open world': 1,
    'plains of eidolon': 1, 'orb vallis': 1, 'cambion drift': 1,
    'the zariman': 1, 'albrecht labs': 1, 'star chart': 1, 'void relics': 1
  };
  var modKnown = {};
  for (ki = 0; ki < D.mods.length; ki++) modKnown[norm(D.mods[ki].name)] = 1;
  for (ki = 0; ki < D.arcanes.length; ki++) modKnown[norm(D.arcanes[ki].name)] = 1;
  var LEAD_TRIM = { 'for': 1, 'the': 1, 'a': 1, 'an': 1, 'try': 1, 'use': 1, 'using': 1, 'with': 1, 'take': 1, 'add': 1, 'slot': 1, 'run': 1, 'equip': 1, 'plus': 1, 'on': 1, 'in': 1, 'to': 1, 'or': 1, 'bring': 1 };
  var segs = String(text).replace(/\n/g, ', ').split(/,|\band\b/);
  var knownHits = 0, mystery = null;
  for (var si = 0; si < segs.length; si++) {
    var words = segs[si].replace(/[*_`#>]/g, '').trim().split(/\s+/).filter(Boolean);
    while (words.length && LEAD_TRIM[norm(words[0]).replace(/[.,;:]+$/, '')]) words.shift();
    var run = [];
    for (var wi = 0; wi < words.length && run.length < 4; wi++) {
      var w = words[wi].replace(/[.,;:()]+$/, '');
      if (/^[A-Z][A-Za-z']*$/.test(w) || (run.length && (w === 'of' || w === 'the' || w === 'and'))) run.push(w);
      else break;
    }
    if (run.length < 2) continue;
    var phrase = norm(run.join(' '));
    if (modKnown[phrase]) { knownHits++; continue; }
    if (known[phrase] || PHRASE_ALLOW[phrase]) continue;
    if (!mystery) mystery = phrase;
  }
  if (knownHits >= 3 && mystery) return false;
  return true;
}

function renderLoadout(title, itemName, picks, notes, page, purpose) {
  var rows = picks.map(function (p, i) {
    return '<div class="mod-row"><div><b>' + (i + 1) + '. ' + esc(p.mod.name) + '</b>' +
      '<div class="muted small">' + esc(p.reason) + '</div>' + modFarmLine(p.mod) + '</div></div>';
  }).join('');
  var cheer = purpose && purpose.steelPath
    ? 'This\'ll shred Steel Path. 💪'
    : purpose && purpose.oneShot
    ? 'This thing\'s going to delete enemies. Enjoy. 💥'
    : 'Solid setup — you\'ll feel the difference right away. 👍';
  var card = buildCard({
    title: title,
    aura: '',
    exilus: '',
    mods: picks.map(function (p) { return p.mod.name; }),
    arcanes: [],
    note: notes || ''
  });
  return '<b>' + esc(title) + '</b> <span class="muted small">generated for ' + esc(itemName) + '</span>' +
    '<p>' + cheer + '</p>' +
    card +
    rows +
    alternativesHtml(itemName, null) +
    '<p class="muted small">Want to know where to farm any of these mods? Just ask <i>"where do I farm ' +
    esc(picks[0] ? picks[0].mod.name : 'this mod') + '"</i>.</p>' +
    '<p><a href="' + link(page, itemName) + '">Full ' + esc(itemName) + ' page &rarr;</a> · ' +
    '<a href="builds.html">Curated builds &rarr;</a></p>';
}

/* ---------- v2.19.6: build qualifiers ----------
   "budget steflos build with no primed mods" used to return the same
   Primed-loaded one-shot as every other Steflos ask — the matcher ignored
   qualifiers entirely, and the frame generator ran every frame through
   one tank skeleton. Qualifiers are now parsed, enforced on library
   builds (verified base-equivalent substitutions), and fed to the
   generator; generated frame builds derive from each frame's own kit. */
function parseQualifiers(t) {
  return {
    budget: /\bbudget\b|\bno primed\b|\bno prime mods\b|\bwithout primed\b|\bcheap\b/.test(t),
    beginner: /\bbeginner\b|\bstarter\b|\bnew player\b/.test(t),
    status: /\bstatus\b/.test(t),
    crit: /\bcrit(ical)?\b/.test(t),
    steelPath: /steel\s?path/.test(t),
    oneShot: /one[\s-]?shot/.test(t),
    /* v2.23.1: 'general' is a first-class qualifier — a balanced,
       all-purpose build for the named item (see qualifiedBuildAnswer) */
    general: /\bgeneral\b|\bbalanced\b|\ball[\s-]?purpose\b|\ball[\s-]?rounder\b|\bwell[\s-]?rounded\b/.test(t)
  };
}
function anyQualifier(q) { return !!(q.budget || q.beginner || q.status || q.crit || q.general); }

var ARBITRATION_MODS = { 'adaptation': 1, 'rolling guard': 1 };
function modBannedFor(name, quals) {
  var n = norm(name);
  if ((quals.budget || quals.beginner) && /^(primed|galvanized) /.test(n)) return true;
  if (quals.beginner && ARBITRATION_MODS[n]) return true;
  return false;
}

var GALV_EQUIV = {
  'galvanized chamber': 'Split Chamber',
  'galvanized hell': "Hell's Chamber",
  'galvanized shot': 'Barrel Diffusion',
  'galvanized diffusion': 'Barrel Diffusion',
  'galvanized savvy': 'Shotgun Savvy',
  'galvanized aptitude': 'Rifle Aptitude',
  'galvanized crosshairs': 'Argon Scope',
  'galvanized scope': 'Argon Scope',
  'galvanized acceleration': 'Vigilante Armaments'
};
var FILLER_POOL = {
  warframe: ['Vitality', 'Redirection', 'Intensify', 'Stretch', 'Streamline', 'Continuity', 'Flow', 'Steel Fiber', 'Natural Talent', 'Constitution', 'Augur Secrets', 'Augur Message', 'Fleeting Expertise'],
  rifle: ['Serration', 'Split Chamber', 'Vigilante Armaments', 'Point Strike', 'Vital Sense', 'Infected Clip', 'Cryo Rounds', 'Stormbringer', 'Shred', 'Hammer Shot', 'Hunter Munitions'],
  shotgun: ['Point Blank', "Hell's Chamber", 'Blunderbuss', 'Ravage', 'Vigilante Armaments', 'Contagious Spread', 'Shell Shock', 'Toxic Barrage', 'Frigid Blast', 'Seeking Fury', 'Scattering Inferno', 'Blaze'],
  pistol: ['Hornet Strike', 'Barrel Diffusion', 'Lethal Torrent', 'Target Cracker', 'Pistol Gambit', 'Pistol Pestilence', 'Frostbite', 'Jolt', 'Scorch', 'Heated Charge'],
  melee: ['Pressure Point', 'Fury', 'Organ Shatter', 'True Steel', 'Drifting Contact', 'Condition Overload', 'Weeping Wounds', 'Virulent Scourge', 'Vicious Frost']
};

/* replacement for a banned mod: base equivalent first (Primed X -> X,
   Galvanized -> its base counterpart), verified real + class-legal + unused */
function substituteMod(name, cls, item, quals, used) {
  var n = norm(name), cand = null;
  if (/^primed /.test(n)) cand = name.replace(/^Primed /, '');
  else if (GALV_EQUIV[n]) cand = GALV_EQUIV[n];
  if (cand && !used[norm(cand)] && !modBannedFor(cand, quals) && pick(cand, '') && modFitsClass(cand, cls, item)) return cand;
  return null;
}

/* Apply qualifiers to a library build: swap banned mods for verified base
   equivalents, refill freed slots from a class-legal pool, re-validate.
   Returns {build, swaps, fills} or null when it can't be made legal. */
function qualifyBuild(b, quals) {
  var cls = buildClassOf(b);
  if (!cls) return null;
  var mods = [], used = {}, swaps = [], fills = [];
  (b.mods || []).forEach(function (m) {
    var n = m && m.name;
    if (!n || used[norm(n)]) return;
    if (!modBannedFor(n, quals)) { mods.push({ name: n, note: m.note || m.why || '' }); used[norm(n)] = 1; return; }
    var rep = substituteMod(n, cls, b.item, quals, used);
    if (rep) { mods.push({ name: rep, note: m.note || m.why || '' }); used[norm(rep)] = 1; swaps.push({ from: n, to: rep }); }
  });
  var pool = FILLER_POOL[cls] || [];
  for (var i = 0; i < pool.length && mods.length < 8; i++) {
    var pn = pool[i];
    if (used[norm(pn)] || modBannedFor(pn, quals)) continue;
    if (pick(pn, '') && modFitsClass(pn, cls, b.item)) {
      mods.push({ name: pn, note: 'Legal filler for the freed slot — a strong general pick.' });
      used[norm(pn)] = 1; fills.push(pn);
    }
  }
  if (mods.length < 8 || mods.length > 9) return null;
  var clone = {
    id: b.id, name: b.name, item: b.item, category: b.category, tags: b.tags || [],
    description: b.description || '', playstyle: b.playstyle || '',
    aura: b.aura || '', exilus: b.exilus || '',
    arcane: quals.beginner ? '' : (b.arcane || ''),
    mods: mods
  };
  if (!buildIsValid(clone)) return null;
  return { build: clone, swaps: swaps, fills: fills };
}

/* Apply qualifiers to generated picks ({mod, reason} list) the same way */
function qualifyPicks(picks, cls, itemName, quals) {
  var out = [], used = {}, swaps = [];
  picks.forEach(function (p) {
    var n = p.mod.name;
    if (!modBannedFor(n, quals)) { if (!used[norm(n)]) { out.push(p); used[norm(n)] = 1; } return; }
    var rep = substituteMod(n, cls, itemName, quals, used);
    if (rep) {
      var rp = pick(rep, p.reason + ' (base equivalent — swapped in to fit your ask)');
      if (rp) { out.push(rp); used[norm(rep)] = 1; swaps.push({ from: n, to: rep }); }
    }
  });
  var pool = FILLER_POOL[cls] || [];
  for (var i = 0; i < pool.length && out.length < 8; i++) {
    var pn = pool[i];
    if (used[norm(pn)] || modBannedFor(pn, quals)) continue;
    var pm = pick(pn, 'Legal filler — strong general pick for this slot.');
    if (pm && modFitsClass(pn, cls, itemName)) { out.push(pm); used[norm(pn)] = 1; }
  }
  return { picks: out.slice(0, 8), swaps: swaps };
}

var STATUS_MODS = {}, CRIT_MODS = {};
['Malignant Force', 'Rime Rounds', 'Thermite Rounds', 'High Voltage', 'Pistol Pestilence', 'Frostbite', 'Jolt', 'Scorch', 'Toxic Barrage', 'Frigid Blast', 'Shell Shock', 'Voltaic Strike', 'Virulent Scourge', 'Vicious Frost', 'Rifle Aptitude', 'Shotgun Savvy', 'Hammer Shot', 'Sure Shot', 'Stunning Speed', 'Melee Prowess'].forEach(function (n) { STATUS_MODS[norm(n)] = 1; });
['Point Strike', 'Vital Sense', 'Critical Delay', 'Blunderbuss', 'Ravage', 'Primed Ravage', 'Target Cracker', 'Pistol Gambit', 'Primed Target Cracker', 'Primed Pistol Gambit', 'Argon Scope', 'Blood Rush', 'Organ Shatter', 'Gladiator Might', 'Hunter Munitions', 'Berserker Fury', 'True Steel', 'Sacrificial Steel'].forEach(function (n) { CRIT_MODS[norm(n)] = 1; });
function countMods(b, set) { return (b.mods || []).filter(function (m) { return set[norm(m.name)]; }).length; }
function bannedCount(b, quals) { return (b.mods || []).filter(function (m) { return modBannedFor(m.name, quals); }).length; }

/* all valid library builds for an item, base and Prime variants included */
function libraryBuildsFor(itemName) {
  var base = norm(itemName).replace(/ prime$/, '');
  var names = {};
  names[base] = 1; names[base + ' prime'] = 1;
  return D.builds.filter(function (b) { return b && names[norm(b.item)] && buildIsValid(b); });
}

/* v2.19.6: every build answer ends with the OTHER verified builds for the
   same item, so the Tenno can pick a different one instead of re-asking */
function alternativesHtml(itemName, exclude) {
  if (!itemName) return '';
  var alts = libraryBuildsFor(itemName).filter(function (b) {
    if (!exclude) return true;
    if (exclude.id && b.id === exclude.id) return false;
    if (!exclude.id && norm(b.name || '') === norm(exclude.name || '')) return false;
    return true;
  }).slice(0, 3);
  if (!alts.length) return '';
  var lis = alts.map(function (b) {
    return '<li><a href="builds.html#build-' + encodeURIComponent(b.id) + '"><b>' + esc(b.name || b.item) + '</b></a></li>';
  }).join('');
  return '<p class="muted small">Other verified builds for ' + esc(itemName) + ' in the Vault:</p><ul>' + lis + '</ul>';
}

/* v2.23.1: ability-strength strip breakpoints, stated only from real
   formula data (Warframe Wiki, verified Oct 2026) — the same discipline
   as the Workshop's Pillage math (25% base, linear in Strength). Keyed
   by ABILITY, never by frame: any frame whose own kit contains a
   tabled ability gets its breakpoint computed against the served
   build's summed Strength. Psychic Bolts: drains 80% of armor AND
   shields at max rank at 100% Strength -> a full strip at 125%. */
var STRIP_ABILITY_MATH = {
  'psychic bolts': { base: 80, full: 125, what: 'armor and shields' }
};
function stripBreakpointNote(frame, build) {
  var ab = null;
  (frame.abilities || []).forEach(function (a) { if (!ab && STRIP_ABILITY_MATH[norm(a.name)]) ab = a; });
  if (!ab) return '';
  var info = STRIP_ABILITY_MATH[norm(ab.name)];
  var st = wsBuildStrength(build);
  var total = st.total + st.exilus;
  var strip = info.base * total / 100;
  var parts = st.parts.map(function (p) { return '+' + p.s + '% (' + esc(p.name) + ')'; }).join(', ');
  return '<p>🎯 <b>' + esc(ab.name) + ' breakpoint:</b> it strips <b>' + info.base + '%</b> of ' + info.what +
    ' at 100% Ability Strength, scaling linearly — a <b>full strip at ' + info.full + '% Strength</b>. ' +
    'This build runs <b>' + total + '% Strength</b>' + (parts ? ' (100 base, ' + parts + ')' : '') + ' — so ' +
    (strip >= 100
      ? esc(ab.name) + ' removes defenses <b>completely in one cast</b>.'
      : 'each cast strips about <b>' + Math.round(strip) + '%</b>; push Strength to ' + info.full + '% for the one-cast full strip.') +
    '</p>';
}

function qualifierLabel(quals) {
  if (quals.budget) return 'Budget (no Primed mods)';
  if (quals.beginner) return 'Beginner (starter)';
  if (quals.status) return 'Status';
  if (quals.crit) return 'Crit';
  if (quals.general) return 'General (balanced)';
  return '';
}

function qualifiedRender(found, quals, qb) {
  var b = qb.build;
  var itemName = found.e.name;
  var title = itemName + ' — ' + qualifierLabel(quals);
  var rows = b.mods.map(function (m, i) {
    var fm = findModExact(m.name);
    var farm = fm ? modFarmLine(fm) : '';
    return '<div class="mod-row"><div><b>' + (i + 1) + '. ' + esc(m.name) + '</b>' +
      (m.note ? '<div class="muted small">' + esc(m.note) + '</div>' : '') + farm + '</div></div>';
  }).join('');
  var card = buildCard({
    title: title,
    aura: vbcCleanSlot(b.aura), exilus: vbcCleanSlot(b.exilus),
    mods: b.mods.map(function (m) { return m.name; }),
    arcanes: vbcArcanes(b.arcane),
    note: b.playstyle || ''
  });
  var swapNote = '';
  if (qb.swaps.length) {
    swapNote = '<p class="muted small">Swaps to fit your ask: ' +
      qb.swaps.map(function (s) { return esc(s.from) + ' &rarr; ' + esc(s.to); }).join(' · ') +
      (qb.fills.length ? ' · freed slot filled with ' + qb.fills.map(function (f) { return esc(f); }).join(', ') : '') + '.</p>';
  }
  /* v2.23.1: a general frame answer states the frame's strip
     breakpoint against the served build's real Strength total */
  var stripNote = (quals.general && found.kind === 'warframe') ? stripBreakpointNote(found.e, b) : '';
  return '<b>' + esc(title) + '</b>' +
    '<p class="muted small">Built from the Vault\'s <b>' + esc(b.name || b.item) + '</b>, adjusted to your qualifier — every mod re-checked against the database.</p>' +
    card + rows + stripNote + swapNote +
    alternativesHtml(itemName, b) +
    '<p><a href="builds.html#build-' + encodeURIComponent(b.id || '') + '">Open the original build &rarr;</a></p>';
}

/* A qualified ask (budget / beginner / status / crit) for a named item:
   serve a library build that fits (transformed if needed), else generate
   one under the qualifier. Never returns the unqualified default. */
function qualifiedBuildAnswer(found, quals, t) {
  var itemName = found.e.name;
  var cands = libraryBuildsFor(itemName);
  var qb = null;
  if (quals.budget || quals.beginner) {
    var sorted = cands.slice().sort(function (a, b) {
      var d = bannedCount(a, quals) - bannedCount(b, quals);
      if (d) return d;
      if (quals.beginner) {
        var at = (a.tags || []).indexOf('beginner') !== -1 ? 0 : 1;
        var bt = (b.tags || []).indexOf('beginner') !== -1 ? 0 : 1;
        if (at !== bt) return at - bt;
      }
      if (quals.steelPath) {
        var as = (a.tags || []).indexOf('steel-path') !== -1 ? 0 : 1;
        var bs = (b.tags || []).indexOf('steel-path') !== -1 ? 0 : 1;
        if (as !== bs) return as - bs;
      }
      return 0;
    });
    for (var i = 0; i < sorted.length && !qb; i++) qb = qualifyBuild(sorted[i], quals);
  } else if (quals.general) {
    /* v2.23.1: 'general' = the item's balanced all-rounder. The
       library's balanced/general-tagged build serves first (for Nyx
       that IS her Steel Path Balanced build); a steel-path-tagged
       build is the next-best all-rounder. No candidate -> the
       archetype generator below, whose default profile is balanced. */
    var gBest = null, gBestScore = 0;
    cands.forEach(function (b) {
      var tags = (b.tags || []).map(function (x) { return norm(x); });
      var s = 0;
      if (tags.indexOf('balanced') !== -1) s += 4;
      if (tags.indexOf('general') !== -1 || tags.indexOf('all-rounder') !== -1) s += 4;
      if (tags.indexOf('steel-path') !== -1) s += 1;
      if (s > gBestScore) { gBestScore = s; gBest = b; }
    });
    if (gBest) qb = { build: gBest, swaps: [], fills: [] };
  } else if (quals.status && found.kind === 'weapon') {
    /* a status ask needs a status-WEIGHTED build: status mods must
       outnumber crit mods (a crit/Hunter Munitions build with two 60/60s
       is a crit build, and used to be served for "status phantasma") */
    var bestS = null, bestScore = 1;
    cands.forEach(function (b) {
      var s = countMods(b, STATUS_MODS);
      if (s >= 2 && s > countMods(b, CRIT_MODS) && s > bestScore) { bestS = b; bestScore = s; }
    });
    if (bestS) qb = { build: bestS, swaps: [], fills: [] };
  } else if (quals.crit && found.kind === 'weapon') {
    var bestC = null, bestCC = 2;
    cands.forEach(function (b) {
      var s = countMods(b, CRIT_MODS);
      if (s >= 3 && s >= countMods(b, STATUS_MODS) && s > bestCC) { bestC = b; bestCC = s; }
    });
    if (bestC) qb = { build: bestC, swaps: [], fills: [] };
  }
  if (qb) return qualifiedRender(found, quals, qb);
  var purpose = { steelPath: quals.steelPath, oneShot: quals.oneShot, beginner: quals.beginner, budget: quals.budget, status: quals.status, crit: quals.crit, general: quals.general };
  return found.kind === 'warframe' ? genWarframeBuild(found.e, purpose) : genWeaponBuild(found.e, purpose);
}

/* ===== WARFRAME BUILD GENERATOR (v2.19.6: kit archetypes) =====
   The old generator ran every frame through one skeleton (Vitality /
   Steel Fiber / Intensify / Primed Continuity / Primed Flow / Stretch /
   Augur Secrets / Fleeting Expertise), so Saryn, Wisp and Rhino came
   back near-identical. Builds now derive from the frame's own kit:
   ability text classifies the frame (support / caster / tank / weapons
   platform), each archetype has its own core, and a frame augment from
   the mods database fills the signature slot when one exists. */
function frameArchetype(frame) {
  var ab = (frame.abilities || []).map(function (a) { return norm((a.name || '') + ' ' + (a.description || '')); }).join(' ');
  if (/heal/.test(ab) && /allies|ally/.test(ab)) return 'support';
  if (/spore|miasma|toxin damage|poison|spread|detonat|explos|damage over time|radial damage/.test(ab)) return 'caster';
  if (/overguard|iron skin|insulat|immune|absorb|damage reduction/.test(ab)) return 'tank';
  if (/increased damage|weapon damage|grants.*damage|damage buff|fire rate/.test(ab)) return 'platform';
  if ((frame.armor || 0) >= 275) return 'tank';
  if ((frame.energy || 0) >= 175) return 'caster';
  return 'platform';
}

/* the frame's own augment from the mods DB (compat = frame), preferring
   one whose effect matches the archetype or names a frame ability */
function frameAugment(frame, preferRe) {
  var base = norm(frame.name).replace(/ prime$/, '');
  var best = null, bestScore = 0;
  for (var i = 0; i < D.mods.length; i++) {
    var m = D.mods[i];
    if (m.type !== 'Warframe Mod') continue;
    var c = norm(m.compat || '');
    if (c !== base && c !== norm(frame.name)) continue;
    var score = 1, txt = norm(m.name + ' ' + (m.effect || ''));
    if (preferRe && preferRe.test(txt)) score += 2;
    (frame.abilities || []).forEach(function (a) { if (txt.indexOf(norm(a.name)) !== -1) score += 1; });
    if (score > bestScore) { bestScore = score; best = m; }
  }
  return best;
}

function genWarframeBuild(frame, purpose) {
  purpose = purpose || {};
  var picks = [];
  var arch = frameArchetype(frame);
  var armor = frame.armor || 0, energy = frame.energy || 150;
  var sigAbility = (frame.abilities && frame.abilities[0] && frame.abilities[0].name) || frame.name;
  var augName = null;

  function add(name, reason) {
    if (picks.length >= 8) return;
    var p = pick(name, reason);
    if (p && !picks.some(function (x) { return x.mod.name === p.mod.name; })) picks.push(p);
  }
  function addAugment(preferRe) {
    var aug = frameAugment(frame, preferRe);
    if (aug) { augName = aug.name; add(aug.name, 'Signature augment for ' + frame.name + '\'s kit.' + (aug.effect ? ' ' + aug.effect : '')); }
  }
  function ensureMod(name, reason) {
    if (picks.some(function (x) { return x.mod.name === name; })) return;
    var p = pick(name, reason);
    if (!p) return;
    if (picks.length < 8) { picks.push(p); return; }
    for (var i = picks.length - 1; i >= 0; i--) {
      if (picks[i].mod.name !== augName && picks[i].mod.name !== 'Vitality') { picks[i] = p; return; }
    }
  }
  var P = function (primed, base) { return (purpose.budget || purpose.beginner) ? base : primed; };

  if (arch === 'caster') {
    add('Blind Rage', '+99% Ability Strength — ' + frame.name + '\'s damage abilities scale directly with it.');
    add('Transient Fortitude', '+55% more strength — the nuke stat.');
    add(P('Primed Continuity', 'Continuity'), 'Ability Duration — damage-over-time effects and debuffs tick longer.');
    add('Stretch', '+45% Ability Range — ' + sigAbility + ' and the rest of the kit cover the whole room.');
    add('Overextended', '+60% range for a strength cost the strength stack already covers — maximum coverage.');
    add('Vitality', 'A real health pool for the moments between casts.');
    addAugment(/spore|miasma|regenerat|ability|detonat|spread|toxin/);
    add('Fleeting Expertise', 'Efficiency — run the rotation more often.');
    add('Augur Reach', 'More range plus shield-gating from the Augur set.');
    add('Streamline', 'Efficiency — cheaper casts.');
  } else if (arch === 'support') {
    add('Vitality', 'Support frames play in the line of fire — and health pools synergize with healing kits.');
    add('Umbral Intensify', '+44% Ability Strength — buffs and heals scale with it.');
    add(P('Primed Continuity', 'Continuity'), 'Ability Duration — buffs stay up longer.');
    add(P('Primed Flow', 'Flow'), 'A deep energy pool — supports cast constantly.');
    add('Stretch', '+45% Ability Range — your buffs reach the whole squad.');
    addAugment(/heal|allies|mote|reservoir|support/);
    add('Adaptation', 'Stacking damage resistance — a dead support helps nobody.');
    add('Augur Message', 'More duration plus shield-gating from the Augur set.');
    add('Natural Talent', 'Faster casting — get the support abilities out sooner.');
    add('Blind Rage', 'Raw strength for bigger buff numbers.');
  } else if (arch === 'tank') {
    add('Vitality', 'Core health pool — the tank\'s foundation.');
    if (armor >= 150) add('Steel Fiber', 'Your ' + armor + ' base armor makes this huge — armor multiplies effective health.');
    else add('Redirection', 'Shield bulk, since base armor is low.');
    add('Intensify', 'Ability Strength — defensive abilities (and any damage buff in the kit) scale with it.');
    add(P('Primed Continuity', 'Continuity'), 'Ability Duration — defensive buffs stay up longer.');
    if (energy <= 175) add(P('Primed Flow', 'Flow'), 'Bigger energy pool — the base pool is small and recasts need headroom.');
    add('Stretch', '+45% Ability Range — defensive auras and crowd control cover more ground.');
    addAugment(/iron skin|armor|charge|overguard|stomp|skin/);
    add('Adaptation', 'Stacking damage resistance — the tank keeps stacking.');
    add('Streamline', 'Efficiency — recasting defenses stays cheap.');
    add('Augur Secrets', 'Extra strength plus shield-gating synergy.');
  } else { /* platform */
    add('Blind Rage', '+99% Ability Strength — the weapon buff scales directly with it.');
    add('Transient Fortitude', '+55% more strength — bigger buff numbers.');
    add('Umbral Intensify', '+44% strength with no downside.');
    add(P('Primed Continuity', 'Continuity'), 'Ability Duration — the buff stays up longer.');
    add('Narrow Minded', '+99% duration — maximum buff uptime; range rarely matters on a self-buff.');
    addAugment(/roar|eclipse|weapon|damage|buff/);
    add('Vitality', 'A real health pool — weapon platforms still get shot at.');
    add('Adaptation', 'Stacking damage resistance while you shoot.');
    add('Augur Secrets', 'Extra strength plus shield-gating synergy.');
  }

  if (purpose.oneShot) {
    ensureMod('Blind Rage', 'Massive Ability Strength for one-shot ability damage (watch the efficiency hit).');
    ensureMod('Transient Fortitude', 'More strength for the nuke.');
  }
  if (purpose.steelPath) {
    ensureMod('Adaptation', 'Steel Path essential — stacking damage resistance keeps you alive at high levels.');
    ensureMod('Rolling Guard', 'Brief invulnerability on dodge — dodges one-shots in Steel Path.');
  }

  var swapsNote = '';
  if (purpose.budget || purpose.beginner) {
    var qp = qualifyPicks(picks, 'warframe', frame.name, purpose);
    picks = qp.picks;
    if (qp.swaps.length) swapsNote = ' Swaps to fit your ask: ' + qp.swaps.map(function (s) { return s.from + ' &rarr; ' + s.to; }).join(' · ') + '.';
  }

  var archLabel = { caster: 'ability-damage (caster/nuke)', support: 'support', tank: 'tank', platform: 'weapons-platform' }[arch];
  var notes = purpose.steelPath
    ? 'Steel Path tip: shield-gating (brief shield regen = invulnerability) matters more than raw health at high levels. Rolling Guard + Adaptation is the standard survival package.'
    : purpose.beginner
    ? 'Starter-friendly: no Primed, Galvanized or Arbitration mods — everything here is earnable early. Level the mods as you get Endo.'
    : purpose.general
    ? 'General-purpose balance: no stat dumped, survivability included — the all-mission version of this frame\'s kit. Specialize it any time with the Workshop ("design me a ' + frame.name + ' build").'
    : 'Generated around ' + frame.name + '\'s ' + archLabel + ' kit, not a generic skeleton — the hand-made library builds for this frame are listed below too.';
  return renderLoadout(frame.name + ' build', frame.name, picks,
    notes + swapsNote + ' Shard/arcane picks depend on your focus school — check the full page.', 'warframes.html', purpose);
}

/* ===== WEAPON BUILD GENERATOR ===== */
function weaponClass(w) {
  var t = (w.type || '').toLowerCase();
  var c = (w.category || '').toLowerCase();
  if (t.indexOf('melee') !== -1) return 'melee';
  if (c.indexOf('shotgun') !== -1) return 'shotgun';
  if (t.indexOf('secondary') !== -1 || t.indexOf('pistol') !== -1) return 'secondary';
  return 'primary';
}

function genWeaponBuild(weapon, purpose) {
  var picks = [];
  var cls = weaponClass(weapon);
  var cc = parseFloat(weapon.criticalChance) || 0;
  var sc = parseFloat(weapon.statusChance) || 0;
  var isCrit = cc >= 18 || !!purpose.crit, isStatus = sc >= 18 || !!purpose.status;
  var plainBase = purpose.budget || purpose.beginner;

  function add(name, reason) {
    if (picks.length >= 8) return;
    var p = pick(name, reason);
    if (p && !picks.some(function (x) { return x.mod.name === p.mod.name; })) picks.push(p);
  }

  if (cls === 'melee' && purpose.status) {
    /* v2.19.6: status melee — combo-scaled status chance + dual combos */
    add(plainBase ? 'Pressure Point' : (purpose.steelPath ? 'Primed Pressure Point' : 'Pressure Point'), 'Base damage — the foundation of every melee build.');
    add('Condition Overload', '+Damage per status type on the enemy — the status melee payoff.');
    add('Weeping Wounds', 'Status chance that scales with your combo counter.');
    add('Virulent Scourge', 'Toxin 60/60 — half of Viral.');
    add('Vicious Frost', 'Cold 60/60 — completes Viral (Toxin + Cold).');
    add('Voltaic Strike', 'Electric 60/60 — pairs with Fever Strike for Corrosive.');
    add('Fever Strike', 'Toxin damage — completes Corrosive (Electric + Toxin), the anti-armor combo.');
    add('Drifting Contact', 'Combo duration — keeps Weeping Wounds stacked between packs.');
    add('Fury', 'Attack speed — more hits, more procs per second.');
  } else if (cls === 'melee') {
    add(purpose.steelPath ? 'Primed Pressure Point' : 'Pressure Point', 'Base damage — the foundation of every melee build.');
    if (isCrit) {
      add('Blood Rush', 'Your ' + cc + '% crit chance makes this scale insanely with your combo counter.');
      add('Organ Shatter', 'Crit damage multiplier — pairs with Blood Rush.');
    }
    if (isStatus || purpose.steelPath) {
      add('Weeping Wounds', 'Status chance that scales with combo — ' + sc + '% base loves this.');
      add('Condition Overload', 'Steel Path king — +damage per status type on the enemy.');
    }
    add('Fury', 'Attack speed — more hits per second, faster combo building.');
    add('Primed Reach', 'Range — hit more enemies per swing.');
    /* elements */
    add('Voltaic Strike', 'Electric 60/60 — pairs toward Corrosive (anti-armor).');
    add('Virulent Scourge', 'Toxin 60/60 — completes Corrosive (Electric + Toxin), the Steel Path anti-armor combo.');
    add('Gladiator Might', 'Crit damage + combo duration backup.');
    add('Drifting Contact', 'Combo duration — keeps your counter alive between packs.');
  } else if (cls === 'shotgun' && purpose.status) {
    /* v2.19.6: status shotgun — every pellet rolls status, so stack it */
    add(purpose.steelPath && !plainBase ? 'Primed Point Blank' : 'Point Blank', 'Base damage — the shotgun foundation.');
    add(purpose.steelPath && !plainBase ? 'Galvanized Hell' : "Hell's Chamber", 'Multishot — more pellets per shot, and every pellet rolls its own status proc.');
    add('Toxic Barrage', 'Toxin 60/60 — half of Viral, plus status chance.');
    add('Frigid Blast', 'Cold 60/60 — completes Viral (Toxin + Cold).');
    add('Shell Shock', 'Electric 60/60 — pairs with Scattering Inferno for Radiation, a second combo element.');
    add('Scattering Inferno', 'Heat 60/60 — completes Radiation (Electric + Heat).');
    add('Shotgun Savvy', 'Flat status chance — on a pellet weapon this multiplies fast.');
    add('Seeking Fury', 'Reload speed + punch-through — keeps the proc hose flowing.');
    add('Vigilante Armaments', 'More multishot — more pellets, more procs.');
  } else if (cls === 'shotgun') {
    /* v2.12.51: shotguns get shotgun mods — NOT rifle mods. Serration /
       Split Chamber / Point Strike do not fit shotguns. */
    add(purpose.steelPath ? 'Primed Point Blank' : 'Point Blank', 'Base damage — the shotgun foundation.');
    add(purpose.steelPath ? 'Galvanized Hell' : "Hell's Chamber", purpose.steelPath
      ? 'Galvanized multishot — stacks on kill, the Steel Path standard.'
      : 'Multishot — more pellets per shot.');
    if (isCrit) {
      add('Blunderbuss', 'Crit chance — your ' + cc + '% crit chance wants this.');
      add('Primed Ravage', 'Crit damage to cash in on those crits.');
      if (purpose.steelPath || purpose.oneShot) {
        var hm2 = pick('Hunter Munitions', 'Crits apply Slash procs that bypass armor — the one-shot engine.');
        if (hm2) picks.push(hm2);
      }
    }
    if (isStatus || !isCrit) {
      add('Toxic Barrage', 'Toxin 60/60 — start of the Viral combo.');
      add('Frigid Blast', 'Cold 60/60 — Viral (Toxin+Cold) is the meta element.');
    } else {
      add('Shell Shock', 'Electric 60/60 — toward Corrosive.');
      add('Contagious Spread', 'Toxin 90% — completes Corrosive (Electric + Toxin), the anti-armor combo.');
    }
    if (purpose.steelPath) {
      var bane2 = pick('Primed Bane of Grineer', 'Faction damage — the biggest Steel Path multiplier, swap per faction.');
      if (bane2) picks.push(bane2);
      else add('Vigilante Armaments', 'More multishot — pick your feel.');
    }
    add('Vigilante Armaments', 'More multishot — pick your feel.');
    add('Chilling Reload', 'Cold + faster reloads — smooths out shotgun downtime.');
    add('Galvanized Savvy', 'Status damage that stacks on status — huge on pellet weapons.');
  } else {
    var dmgMod = cls === 'secondary' ? 'Hornet Strike' : 'Serration';
    var msMod = cls === 'secondary' ? 'Barrel Diffusion' : 'Split Chamber';
    var galvMs = cls === 'secondary' ? 'Galvanized Shot' : 'Galvanized Chamber';
    var critC = cls === 'secondary' ? 'Primed Pistol Gambit' : 'Point Strike';
    var critD = cls === 'secondary' ? 'Primed Target Cracker' : 'Vital Sense';

    if (purpose.status) {
      /* v2.19.6: status guns — dual 60/60 combos (Viral + Radiation) and
         flat status chance; crit mods and Hunter Munitions stay out */
      add(dmgMod, 'Base damage — every gun build starts here.');
      add(purpose.steelPath && !plainBase ? galvMs : msMod, 'Multishot — more projectiles per shot, and every one rolls its own status proc.');
      add(cls === 'secondary' ? 'Pistol Pestilence' : 'Malignant Force', 'Toxin 60/60 — half of Viral, plus status chance.');
      add(cls === 'secondary' ? 'Frostbite' : 'Rime Rounds', 'Cold 60/60 — completes Viral (Toxin + Cold).');
      add(cls === 'secondary' ? 'Scorch' : 'Thermite Rounds', 'Heat 60/60 — pairs with Electric for Radiation, a second combo element.');
      add(cls === 'secondary' ? 'Jolt' : 'High Voltage', 'Electric 60/60 — completes Radiation (Heat + Electric).');
      add(cls === 'secondary' ? 'Sure Shot' : 'Rifle Aptitude', 'Flat status chance — the whole build is about proccing more.');
      add(cls === 'secondary' ? 'Lethal Torrent' : 'Vigilante Armaments', 'More shots per second = more status stacks.');
      add('Hammer Shot', 'Status chance plus crit damage — the hybrid filler.');
    } else if (purpose.crit) {
      /* v2.19.6: crit guns — crit chance/damage weighted, whatever the
         weapon's base stats say */
      add(dmgMod, 'Base damage — every gun build starts here.');
      add(purpose.steelPath && !plainBase ? galvMs : msMod, purpose.steelPath && !plainBase
        ? 'Galvanized multishot — stacks on kill, the Steel Path standard.'
        : 'Multishot — more projectiles, more crit rolls per shot.');
      add(critC, 'Crit chance — a crit build lives or dies on this.');
      add(critD, 'Crit damage to cash in on those crits.');
      var hmc = pick('Hunter Munitions', 'Crits apply Slash procs that bypass armor — the crit build\'s armor answer.');
      if (hmc) picks.push(hmc);
      add(cls === 'secondary' ? 'Pathogen Rounds' : 'Infected Clip', 'Toxin damage — half of Viral.');
      add(cls === 'secondary' ? 'Deep Freeze' : 'Cryo Rounds', 'Cold damage — completes Viral (Toxin + Cold), which multiplies damage to health.');
      if (purpose.steelPath && !plainBase) {
        var banec = pick('Primed Bane of Grineer', 'Faction damage — the biggest Steel Path multiplier, swap per faction.');
        if (banec) picks.push(banec);
      }
      add(cls === 'secondary' ? 'Lethal Torrent' : 'Vigilante Armaments', 'Fire rate or more multishot — pick your feel.');
      add('Hammer Shot', 'Crit damage plus status chance — solid hybrid filler.');
    } else {
    add(dmgMod, 'Base damage — every gun build starts here.');
    add(purpose.steelPath ? galvMs : msMod, purpose.steelPath
      ? 'Galvanized multishot — stacks on kill, the Steel Path standard.'
      : 'Multishot — more projectiles per trigger pull.');
    if (isCrit) {
      add(critC, 'Your ' + cc + '% crit chance wants this.');
      add(critD, 'Crit damage to cash in on those crits.');
      if (purpose.steelPath || purpose.oneShot) {
        var hm = pick('Hunter Munitions', 'The one-shot engine — crits apply Slash procs that bypass armor.');
        if (hm) picks.push(hm);
      }
    }
    if (isStatus || !isCrit) {
      add(cls === 'secondary' ? 'Pistol Pestilence' : 'Malignant Force', 'Toxin 60/60 — start of the Viral combo.');
      add(cls === 'secondary' ? 'Frostbite' : 'Rime Rounds', 'Cold 60/60 — Viral (Toxin+Cold) is the meta element.');
    } else {
      add(cls === 'secondary' ? 'Jolt' : 'Stormbringer', cls === 'secondary'
        ? 'Electric 60/60 — pairs with Scorch for Radiation.'
        : 'Electric for Corrosive, or swap to Viral 60/60s vs flesh.');
      add(cls === 'secondary' ? 'Scorch' : 'Infected Clip', cls === 'secondary'
        ? 'Heat 60/60 — completes Radiation (Electric + Heat).'
        : 'Toxin for Corrosive/Viral flexibility.');
    }
    if (purpose.steelPath) {
      var bane = pick('Primed Bane of Grineer', 'Faction damage — the biggest Steel Path multiplier, swap per faction.');
      if (bane) picks.push(bane);
      else add(cls === 'secondary' ? 'Lethal Torrent' : 'Shred', 'Fire rate / punch-through utility.');
    }
    add(cls === 'secondary' ? 'Lethal Torrent' : 'Vigilante Armaments', 'Fire rate or more multishot — pick your feel.');
    }
  }

  /* v2.19.6: never ship a short build (a status-leaning rifle used to
     come back with 5 mods) — top up from class staples */
  var FILL_CANDS = {
    primary: ['Infected Clip', 'Cryo Rounds', 'Stormbringer', 'Hellfire', 'Shred', 'Vigilante Armaments', 'Hammer Shot', 'Point Strike', 'Vital Sense', 'Hunter Munitions'],
    secondary: ['Heated Charge', 'Convulsion', 'Deep Freeze', 'Pathogen Rounds', 'Lethal Torrent', 'Augur Pact', 'Ice Storm'],
    shotgun: ['Chilling Reload', 'Seeking Fury', 'Scattering Inferno', 'Blaze', 'Contagious Spread', 'Shell Shock', 'Vigilante Armaments'],
    melee: ['Fury', 'Reach', 'Drifting Contact', 'Gladiator Might', 'Berserker Fury', 'Fever Strike', 'Shocking Touch']
  };
  (FILL_CANDS[cls] || []).forEach(function (n) { add(n, 'Solid staple — fills out the build.'); });

  var swapsNote = '';
  if (plainBase) {
    var qcls = cls === 'primary' ? 'rifle' : cls === 'secondary' ? 'pistol' : cls;
    var qp2 = qualifyPicks(picks, qcls, weapon.name, purpose);
    picks = qp2.picks;
    if (qp2.swaps.length) swapsNote = ' Swaps to fit your ask: ' + qp2.swaps.map(function (s) { return s.from + ' &rarr; ' + s.to; }).join(' · ') + '.';
  }

  var notes = purpose.status
    ? 'Status build: two combo elements (Viral + Radiation) stack procs fast, and every projectile rolls its own — proc first, melt second.' + swapsNote
    : purpose.steelPath
    ? 'Steel Path notes: Viral + Hunter Munitions slash procs bypass armor — that\'s the one-shot formula. Swap the faction Bane mod per mission.' + swapsNote
    : 'Level these gradually — a half-ranked core build beats a wishlist of unranked mods.' + swapsNote;
  var wTitle = weapon.name + (purpose.status ? ' status build' : purpose.crit ? ' crit build' : ' build');
  return renderLoadout(wTitle, weapon.name, picks, notes, 'weapons.html', purpose);
}

/* extract item name + purpose from a build question.
   v2.19.6: purpose is the full qualifier set (parseQualifiers), and the
   qualifier words are stripped from the name so item lookup still works. */
function parseBuildQ(t) {
  var purpose = parseQualifiers(t);
  /* strip build-related words to isolate the item name */
  var q = t
    .replace(/^(can you |could you |please |hey |hi )?(make|build|create|give|craft)( me)?\b/,'')
    .replace(/\b(a|an|the)\b/g,' ')
    .replace(/\b(build|setup|loadout)\b/g,' ')
    .replace(/\bfor\b/g,' ')
    .replace(/\b(best|strongest|good|top)\b/g,' ')
    .replace(/\b(general|balanced|all[\s-]?purpose|all[\s-]?rounder|well[\s-]?rounded)\b/g,' ')
    .replace(/\bsteel\s?path\b/g,' ')
    .replace(/\bone[\s-]?shot\b/g,' ')
    .replace(/\bbeginner|starter|early\b/g,' ')
    .replace(/\bbudget\b/g,' ')
    .replace(/\bno primed( mods)?\b/g,' ')
    .replace(/\bwithout primed\b/g,' ')
    .replace(/\bstatus\b/g,' ')
    .replace(/\bcrit(ical)?\b/g,' ')
    .replace(/\?+$/,'')
    .replace(/\s+/g,' ').trim();
  return { name: q, purpose: purpose };
}

/* no specific item named — recommend something useful instead of dead-ending.
   "what's a good beginner warframe build" -> Rhino starter build + curated list. */
function genericBuildAnswer(t, purpose) {
  var isBeginner = purpose.beginner || /\b(beginner|starter|new player|just started)\b/.test(t);
  if (/steel/.test(t)) return steelPathAnswer();
  if (isBeginner) {
    var rhino = findByName(D.warframes, 'rhino');
    var gb = rhino ? genWarframeBuild(rhino, { beginner: true }) : null;
    var curated = D.builds.filter(function (b) { return (b.tags || []).indexOf('beginner') !== -1; }).slice(0, 5);
    var rows = curated.map(function (b) {
      return '<li><a href="builds.html#build-' + encodeURIComponent(b.id) + '"><b>' +
        esc(b.name || b.item) + '</b></a> <span class="muted small">' + esc(b.item || '') + '</span></li>';
    }).join('');
    return 'Great question — for a beginner you can\'t go wrong with <b>Rhino</b>. ' +
      'Iron Skin makes you nearly unkillable while you\'re learning the game. Here\'s a starter build for him:' +
      (gb ? gb.replace(/^<b>[^<]+<\/b> <span[^>]+>[^<]+<\/span>/, '') : '') +
      (rows ? '<p>More starter builds in the Vault:</p><ul>' + rows + '</ul>' : '') +
      '<p class="muted small">Want one for a specific frame? Just ask <i>"make me an Excalibur build"</i>.</p>' +
      '<p><a href="builds.html">All builds &rarr;</a></p>';
  }
  /* generic "give me a warframe/weapon build" — show strong curated picks */
  var picks = D.builds.filter(function (b) { return (b.tags || []).indexOf('strong') !== -1; }).slice(0, 6);
  if (!picks.length) picks = D.builds.slice(0, 6);
  var rows2 = picks.map(function (b) {
    return '<li><a href="builds.html#build-' + encodeURIComponent(b.id) + '"><b>' +
      esc(b.name || b.item) + '</b></a> <span class="muted small">' + esc(b.item || '') + '</span> ' +
      (window.TV.badge ? window.TV.badge(b.tags || []) : '') + '</li>';
  }).join('');
  return 'Here are some of the Vault\'s most popular builds to get you started:<ul>' + rows2 + '</ul>' +
    '<p class="muted small">Or name a frame/weapon and I\'ll generate a build on the spot — ' +
    'try <i>"make me a Saryn build"</i>.</p>' +
    '<p><a href="builds.html">All builds &rarr;</a></p>';
}

function findItemForBuild(q) {
  var w = findByName(D.warframes, q);
  if (w) return { kind: 'warframe', e: w };
  var wp = findByName(D.weapons, q);
  if (wp) return { kind: 'weapon', e: wp };
  return null;
}

/* find any known item name appearing anywhere inside a longer question.
   Longest names first so "Nova Prime" beats "Nova". */
function findItemInText(list, t) {
  var best = null, bestLen = 0;
  for (var i = 0; i < list.length; i++) {
    var n = norm(list[i].name);
    if (n.length >= 4 && n.length > bestLen && t.indexOf(n) !== -1) {
      best = list[i]; bestLen = n.length;
    }
  }
  return best;
}

/* v2.23.1: word-boundary in-text scan. findItemInText requires names of
   >= 4 chars, which made 3-letter items (Nyx, Ash) invisible inside a
   sentence: "general build for nyx" resolved NOTHING and fell through
   to the generic popular-builds list while naming a frame the whole
   site indexes. Whole-word matching is safe for short names — "nyx"
   only ever matches the standalone word. Longest name wins. */
function findItemInTextWB(list, t) {
  var best = null, bestLen = 0;
  var padded = ' ' + String(t || '').replace(/[^a-z0-9' ]/g, ' ') + ' ';
  for (var i = 0; i < list.length; i++) {
    var n = norm(list[i].name).replace(/[^a-z0-9' ]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!n || n.length <= bestLen) continue;
    if (padded.indexOf(' ' + n + ' ') !== -1) { best = list[i]; bestLen = n.length; }
  }
  return best;
}

/* v2.23.1: ENTITY-FIRST resolution — the one resolver every intent path
   uses (build, qualifiers, Workshop, power, Steel Path general,
   checker, session context, generateBuild). The substring matcher runs
   first so nothing that resolved before changes; the word-boundary net
   only widens. Returns {kind, e} or null. */
function resolveNamedItem(t) {
  var f = findItemInText(D.warframes, t) || findItemInTextWB(D.warframes, t);
  if (f) return { kind: 'warframe', e: f };
  var w = findItemInText(D.weapons, t) || findItemInTextWB(D.weapons, t);
  if (w) return { kind: 'weapon', e: w };
  return null;
}

/* main entry: generate a build for any item */
function generateBuild(t) {
  var parsed = parseBuildQ(t);
  var found = findItemForBuild(parsed.name);
  if (!found) {
    /* try the raw question in case parsing stripped too much */
    found = findItemForBuild(t.replace(/\b(build|make|for|me|a|please)\b/g,' ').replace(/\s+/g,' ').trim());
  }
  /* v2.23.1: entity-first — any item named anywhere in the question
     (word-boundary net included) resolves before this can give up */
  if (!found) found = resolveNamedItem(t);
  if (!found) return null;
  if (found.kind === 'warframe') return genWarframeBuild(found.e, parsed.purpose);
  return genWeaponBuild(found.e, parsed.purpose);
}

/* ---------- v2.22.0: POWER INTENT ----------
   The owner's test: "what's like the best Octavia prime build where she
   just kills anything in he way or even like survival and destroying
   everything" used to return the stock library card — the phrasing has
   no creative verb, so v2.22.0's Workshop detection never fired. Power
   intent = superlatives + outcome language on a build ask. It routes to
   the Workshop with a damage / survival / mixed-power emphasis profile
   and renders as a full dossier (concept, Helminth, shards, verified
   math, rotation) — NEVER the stock library card for that item. */
var POWER_SUPER_RE = /\b(best|strongest|most powerful|ultimate|god[\s-]?tier|meta|top[\s-]?tier|optimal|perfect|max(imum)? (damage|power)|full damage)\b/;
var POWER_KILL_RE = /\b(kills? (anything|everything|all)|kill everything|destroy(s|ing)? (anything|everything)|melts?|shreds?|wipes?|nukes?|deletes?|one[\s-]?taps?|room[\s-]?clear\w*|unstoppable|broken|annihilat\w+|slaughter\w*|massacre|obliterat\w+)\b/;
var POWER_SURVIVE_RE = /\b(survival|survive|surviving|unkillable|never (die|dies)|can'?t die|cannot die|immortal|invincible|endless)\b/;
function powerDetect(t) {
  if (!/\b(build|loadout|setup)\b/.test(t) && !/one[\s-]?shot/.test(t)) return null;
  var kill = POWER_SUPER_RE.test(t) || POWER_KILL_RE.test(t);
  var surv = POWER_SURVIVE_RE.test(t);
  if (!kill && !surv) return null;
  /* "best beginner build" is the beginner path, not a power fantasy */
  if (/\b(beginner|starter|new player)\b/.test(t) && !POWER_KILL_RE.test(t) && !surv) return null;
  return { emphasis: kill && surv ? 'power' : surv ? 'survival' : 'damage', kill: kill, surv: surv };
}
function powerPlan(q) {
  var t = stripQ(q);
  var pw = powerDetect(t);
  if (!pw) return null;
  /* Creative briefs keep the v2.22.0 workshop path — unless the ask
     carries strong outcome language (kills / destroys / unkillable /
     survival), which is the more specific intent and claims the ask. */
  if (workshopDetect(t) && !POWER_KILL_RE.test(t) && !POWER_SURVIVE_RE.test(t)) return null;
  var found = resolveNamedItem(t);
  if (!found) return null;
  return {
    item: found.e.name, kind: found.kind, e: found.e,
    focus: pw.emphasis, abilityPhrase: null, element: null,
    quals: parseQualifiers(t), q: q,
    power: true, kill: pw.kill, surv: pw.surv,
    ctxNote: pendingCtxNote || null
  };
}

/* ---------- v2.22.0: THE WORKSHOP — generative build composition ----------
   The owner opened the creative door: Vaulty may INVENT BUILDS (original
   compositions) but may NEVER invent MODS. The Workshop composes an
   original 8-mod build for a creative ask ("design…", "come up with…",
   "weird off-meta…", "full damage…", "focused on <ability>…"), grounded
   in the item's researched profile (live item data when available — see
   js/vaulty-workshop.js for the staged research UI) and composed STRICTLY
   from the mods database: every pick is resolved through findModExact +
   modFitsClass, and the finished build must pass buildIsValid() (with one
   DB-alternative repair pass) or it is never shown — the library card or
   the honest fallback serves instead. Plain asks keep the instant library
   path; qualified asks keep the v2.19.6 path; "make me a X build" with no
   creative/constraint signal is the site's canonical phrasing and also
   stays instant. */
var WORKSHOP_MARK = '<!--TVWORKSHOP-->';

function wsHash(s) {
  var h = 0; s = norm(s);
  for (var i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

var WS_CREATIVE_VERB = /\b(design|designing|create|creating|craft|crafting|invent|imagine|dream up|cook up|come up with|brew up|conjure|homebrew)\b/;
var WS_NOVELTY = /\b(weird|off[\s-]?meta|unusual|unconventional|crazy|meme|experimental|unique|original|from scratch|surprise me|something (new|different|fun|weird|else))\b/;
var WS_DAMAGE_MAX = /\b(full damage|maximum damage|max damage|all[\s-]?out damage|pure damage|highest damage|damage[- ]focused|tons of damage)\b/;
var WS_ELEMENTS = ['viral', 'corrosive', 'radiation', 'gas', 'magnetic', 'blast'];

/* Detect a Workshop ask. Returns {focus, abilityPhrase, element, quals}
   or null. A creative signal is required: a creative verb, novelty /
   off-meta language, a damage-max brief, an ability-focus phrase, or an
   element-only constraint. Qualifiers alone stay on the v2.19.6 path. */
function workshopDetect(t) {
  if (!/\b(build|loadout|setup)\b/.test(t) && !/one[\s-]?shot/.test(t) && !/steel\s?path/.test(t)) return null;
  var focus = null, abilityPhrase = null, element = null;
  var mAb = t.match(/\b(?:focused on|focus on|built around|build around|centered on|centred on|all about)\s+(.+)$/);
  var mEl = t.match(/\b(viral|corrosive|radiation|gas|magnetic|blast)[\s-]?(only|build|focused|focus)?\b/);
  if (WS_DAMAGE_MAX.test(t)) focus = 'damage';
  else if (WS_NOVELTY.test(t)) focus = 'offmeta';
  else if (mAb) { focus = 'ability'; abilityPhrase = mAb[1].replace(/\b(build|please|for me)\b/g, ' ').replace(/\s+/g, ' ').trim(); }
  else if (mEl && (mEl[2] || WS_CREATIVE_VERB.test(t))) { focus = 'element'; element = mEl[1]; }
  else if (WS_CREATIVE_VERB.test(t)) focus = /\bstatus\b/.test(t) ? 'status' : (/\bcrit/.test(t) ? 'crit' : 'profile');
  else if (/\bstatus\b/.test(t) && /\b(design|weird|custom|original|invent|create)\b/.test(t)) focus = 'status';
  if (!focus) return null;
  return { focus: focus, abilityPhrase: abilityPhrase, element: element, quals: parseQualifiers(t) };
}

/* Resolve a Workshop plan for a raw question: detection + the named item.
   Returns {item, kind, e, focus, abilityPhrase, element, quals, q} | null. */
function workshopPlan(q) {
  var t = stripQ(q);
  var det = workshopDetect(t);
  if (!det) return null;
  var found = resolveNamedItem(t);
  if (!found) return null;
  return {
    item: found.e.name, kind: found.kind, e: found.e,
    focus: det.focus, abilityPhrase: det.abilityPhrase, element: det.element,
    quals: det.quals, q: q, ctxNote: pendingCtxNote || null
  };
}

/* The handoff: answer() returns this marker + a short note; the chat
   wrappers (guide ask + AI-panel askFallback) intercept it and hand the
   question to js/vaulty-workshop.js, which runs the staged research and
   calls back in to compose. If the Workshop script is missing (a stale
   cached page mid-deploy), the note alone is a graceful answer. */
function workshopHandoffHtml(plan) {
  var planJson = JSON.stringify({ item: plan.item, kind: plan.kind, focus: plan.focus, power: !!plan.power, ctxNote: plan.ctxNote || null, steelPath: !!(plan.quals && plan.quals.steelPath) });
  return WORKSHOP_MARK +
    '<div class="vai-workshop-handoff" data-plan="' + esc(planJson) + '" style="display:none"></div>' +
    '<p>🛠 <b>The Workshop</b> — give me a moment, Tenno: I\'m researching <b>' + esc(plan.item) +
    '</b> and composing an original build for it from real mods.</p>';
}

function wsClassOfFound(found) {
  if (found.kind === 'warframe') return 'warframe';
  var wc = weaponClass(found.e);
  return wc === 'primary' ? 'rifle' : wc === 'secondary' ? 'pistol' : wc;
}
function wsBuildCategory(found) {
  if (found.kind === 'warframe') return 'Warframe';
  var wc = weaponClass(found.e);
  return wc === 'shotgun' ? 'Shotgun' : wc === 'secondary' ? 'Secondary' : wc === 'melee' ? 'Melee' : 'Primary';
}

/* The item profile the composition is grounded in: the Vault's own data,
   enriched by the live research (warframestat damage split / proc chance)
   when js/vaulty-workshop.js fetched it. */
function wsProfile(found, researched) {
  var e = found.e;
  var p = { cc: 0, sc: 0, cm: 2, innate: [], live: false, arch: null, abilities: [] };
  if (found.kind === 'weapon') {
    p.cc = parseFloat(e.criticalChance) || 0;
    p.sc = parseFloat(e.statusChance) || 0;
    p.cm = parseFloat(e.criticalMultiplier) || 2;
  } else {
    p.arch = frameArchetype(e);
    p.abilities = (e.abilities || []).map(function (a) { return a.name; });
  }
  if (researched) {
    if (researched.cc != null && !isNaN(researched.cc)) p.cc = researched.cc;
    if (researched.sc != null && !isNaN(researched.sc)) p.sc = researched.sc;
    if (researched.cm != null && !isNaN(researched.cm)) p.cm = researched.cm;
    if (researched.damageTypes && researched.damageTypes.length) p.innate = researched.damageTypes;
    p.live = true;
  }
  return p;
}

/* elemental mod candidates per class: [60/60 (status), 90% (raw)] */
var WS_ELEM = {
  rifle:   { toxin: ['Malignant Force', 'Infected Clip'], cold: ['Rime Rounds', 'Cryo Rounds'], heat: ['Thermite Rounds', 'Hellfire'], electric: ['High Voltage', 'Stormbringer'] },
  shotgun: { toxin: ['Toxic Barrage', 'Contagious Spread'], cold: ['Frigid Blast', 'Chilling Reload'], heat: ['Scattering Inferno', 'Blaze'], electric: ['Shell Shock', 'Charged Shell'] },
  pistol:  { toxin: ['Pistol Pestilence', 'Pathogen Rounds'], cold: ['Frostbite', 'Deep Freeze'], heat: ['Scorch', 'Heated Charge'], electric: ['Jolt', 'Convulsion'] },
  melee:   { toxin: ['Virulent Scourge', 'Fever Strike'], cold: ['Vicious Frost', 'North Wind'], heat: ['Volcanic Edge', 'Molten Impact'], electric: ['Voltaic Strike', 'Shocking Touch'] }
};
var WS_COMBO_PARTS = {
  viral: ['toxin', 'cold'], corrosive: ['electric', 'toxin'], radiation: ['heat', 'electric'],
  gas: ['heat', 'toxin'], magnetic: ['electric', 'cold'], blast: ['heat', 'cold']
};
var WS_COMBO_WHY = {
  viral: 'Viral (Toxin + Cold) — viral procs amplify damage to health by up to +325%.',
  corrosive: 'Corrosive (Electric + Toxin) — corrosive procs strip armor, up to 80%.',
  radiation: 'Radiation (Heat + Electric) — rad procs turn enemies on each other and punish alloy armor.',
  gas: 'Gas (Heat + Toxin) — gas clouds deal toxin damage over time to the whole pack.',
  magnetic: 'Magnetic (Electric + Cold) — magnetic procs multiply damage to shields and Overguard.',
  blast: 'Blast (Heat + Cold) — blast procs knock enemies down and punish crowds.'
};
var WS_FLAT_STATUS = { rifle: 'Rifle Aptitude', shotgun: 'Shotgun Savvy', pistol: 'Sure Shot', melee: 'Melee Prowess' };
var WS_FLEX = {
  rifle: ['Vigilante Armaments', 'Shred', 'Hammer Shot', 'Heavy Caliber', 'Bladed Rounds', 'Fanged Fusillade', 'Wildfire'],
  shotgun: ['Vigilante Armaments', 'Seeking Fury', 'Blaze', 'Accelerated Blast', 'Tactical Pump', 'Shotgun Barrage'],
  pistol: ['Lethal Torrent', 'Gunslinger', 'Anemic Agility', 'Augur Pact', 'Ice Storm', 'Stunning Speed'],
  melee: ['Berserker Fury', 'Fury', 'Primed Reach', 'Reach', 'Gladiator Might', 'Drifting Contact', 'Quickening', 'Relentless Combination']
};
var WS_FRAME_CORES = {
  caster: ['Blind Rage', 'Transient Fortitude', 'Primed Continuity', 'Stretch', 'Overextended', 'Augur Reach', 'Fleeting Expertise', 'Streamline', 'Vitality', 'Umbral Intensify'],
  support: ['Umbral Intensify', 'Primed Continuity', 'Primed Flow', 'Stretch', 'Vitality', 'Adaptation', 'Augur Message', 'Natural Talent', 'Blind Rage', 'Redirection'],
  tank: ['Vitality', 'Steel Fiber', 'Intensify', 'Primed Continuity', 'Adaptation', 'Stretch', 'Primed Flow', 'Augur Secrets', 'Streamline', 'Redirection'],
  platform: ['Blind Rage', 'Transient Fortitude', 'Umbral Intensify', 'Primed Continuity', 'Narrow Minded', 'Augur Secrets', 'Vitality', 'Adaptation', 'Stretch', 'Fleeting Expertise']
};
var WS_FRAME_OFFMETA = ['Quick Thinking', 'Armored Agility', 'Rapid Resilience', 'Diamond Skin', 'Redirection', 'Fast Deflection', 'Flow', 'Constitution', 'Natural Talent', 'Rage', 'Streamline', 'Handspring'];

/* how often each mod appears across the whole library — the data-driven
   "meta-ness" the off-meta brief steers away from */
function wsMetaFreq() {
  var freq = {};
  (D.builds || []).forEach(function (b) {
    (b.mods || []).forEach(function (m) { var k = norm(m.name); freq[k] = (freq[k] || 0) + 1; });
  });
  return freq;
}

/* Choose the element combo for a composition: an explicit element
   constraint wins; status always runs Viral first; off-meta rotates by
   seed; otherwise the item's own researched innate element leads, with a
   seeded Viral/Corrosive variation so rephrased asks can differ. */
function wsComboFor(plan, profile, seed) {
  if (plan.focus === 'element' && plan.element) return plan.element;
  if (plan.focus === 'status') return 'viral';
  if (plan.focus === 'offmeta') return WS_ELEMENTS[seed % WS_ELEMENTS.length];
  if (profile.innate && profile.innate.length) {
    var inn = norm(profile.innate[0]);
    var order = ['viral', 'corrosive', 'radiation', 'magnetic', 'gas', 'blast'];
    for (var i = 0; i < order.length; i++) {
      if (WS_COMBO_PARTS[order[i]].indexOf(inn) !== -1) return order[i];
    }
  }
  return seed % 3 === 0 ? 'corrosive' : 'viral';
}

/* THE COMPOSER. Role-driven slot filling over DB-verified candidates.
   Every WHY is the mod's real database effect, prefixed only by a
   structural role label (no invented effects). Returns a library-shaped
   build object (validated by the caller) or null. */
function wsCompose(found, plan, researched) {
  var cls = wsClassOfFound(found);
  var profile = wsProfile(found, researched);
  var seed = wsHash(plan.q || found.e.name);
  var quals = plan.quals || {};
  var used = {}, picks = [];

  function whyFor(m, roleLabel) {
    var eff = (m.effect || m.tip || '').trim();
    return (roleLabel ? roleLabel + ' ' : '') + eff;
  }
  function tryAdd(name, roleLabel) {
    if (!name || picks.length >= 8) return false;
    var k = norm(name);
    if (used[k]) return false;
    if (modBannedFor(name, quals)) {
      var rep = substituteMod(name, cls, found.e.name, quals, used);
      if (!rep) return false;
      name = rep; k = norm(rep);
      if (used[k]) return false;
    }
    var m = findModExact(name);
    if (!m || isAuraMod(m.name)) return false;
    if (!modFitsClass(m.name, cls, found.e.name)) return false;
    used[k] = 1;
    picks.push({ name: m.name, note: whyFor(m, roleLabel), mod: m });
    return true;
  }
  function slot(cands, roleLabel) {
    for (var i = 0; i < cands.length; i++) if (tryAdd(cands[i], roleLabel)) return true;
    return false;
  }
  function elemSlots(combo, rawFirst, label) {
    var parts = WS_COMBO_PARTS[combo];
    if (!parts) return;
    parts.forEach(function (el) {
      var pair = (WS_ELEM[cls] || {})[el] || [];
      var ordered = rawFirst ? [pair[1], pair[0]] : [pair[0], pair[1]];
      slot(ordered, (label || 'Element') + ' — ' + WS_COMBO_WHY[combo]);
    });
  }
  function flexSlot(extra) {
    var pool = (WS_FLEX[cls] || []).concat(extra || []);
    if (!pool.length) return;
    var rot = seed % pool.length;
    var ordered = pool.slice(rot).concat(pool.slice(0, rot));
    slot(ordered, 'Flex slot —');
  }

  var focus = plan.focus;
  var isCritProfile = profile.cc >= 18, isStatusProfile = profile.sc >= 18;

  if (found.kind === 'warframe') {
    var arch = profile.arch || 'platform';
    var aug = null, augWhy = '';
    if (focus === 'ability' && plan.abilityPhrase) {
      var abName = plan.abilityPhrase.replace(/^(her|his|its|the)\s+/, '');
      var abHit = null;
      (found.e.abilities || []).forEach(function (a) {
        if (norm(a.name) === norm(abName) || norm(abName).indexOf(norm(a.name)) !== -1 || norm(a.name).indexOf(norm(abName)) !== -1) abHit = a;
      });
      var preferRe = abHit ? new RegExp(norm(abHit.name).replace(/[^a-z0-9 ]/g, ''), 'i') : null;
      aug = frameAugment(found.e, preferRe);
      plan._abilityName = abHit ? abHit.name : null;
      plan._abilityText = abHit ? (abHit.description || '') : '';
    }
    if (!aug && focus !== 'offmeta') aug = frameAugment(found.e, null);
    if (aug) augWhy = 'Signature augment.';

    var core;
    if (focus === 'damage') core = ['Blind Rage', 'Transient Fortitude', 'Umbral Intensify', 'Primed Continuity', 'Augur Secrets', 'Stretch', 'Vitality', 'Fleeting Expertise', 'Adaptation', 'Primed Flow'];
    else if (focus === 'offmeta') {
      var freq = wsMetaFreq();
      core = WS_FRAME_OFFMETA.filter(function (n) { return (freq[norm(n)] || 0) < 25; });
      core = core.concat(WS_FRAME_CORES[arch]);
    } else if (focus === 'ability') {
      var abTxt = norm(plan._abilityText || '');
      var statFirst = /radius|area|range|nearby|around/.test(abTxt)
        ? ['Stretch', 'Overextended', 'Augur Reach']
        : /second|duration|lasts|over time/.test(abTxt)
        ? ['Primed Continuity', 'Narrow Minded', 'Constitution']
        : ['Blind Rage', 'Transient Fortitude', 'Umbral Intensify'];
      core = statFirst.concat(WS_FRAME_CORES[arch]);
    } else core = WS_FRAME_CORES[focus === 'crit' ? 'platform' : arch];

    if (aug) tryAdd(aug.name, augWhy);
    if (focus === 'power' || focus === 'survival') {
      /* v2.22.0 dossier cores — every pick carries a WHY tied to the concept */
      var labeled = focus === 'power'
        ? [['Blind Rage', 'Raw power —'], ['Transient Fortitude', 'Raw power —'], ['Umbral Intensify', 'Raw power —'], ['Augur Secrets', 'Raw power —'],
           ['Adaptation', 'Survival layer —'], ['Rolling Guard', 'Survival layer —'],
           ['Primed Continuity', 'Keeps the engine running —'], ['Stretch', 'Room-clearing reach —'], ['Primed Flow', 'Energy buffer —']]
        : [['Adaptation', 'Survival layer —'], ['Rolling Guard', 'Survival layer —'], ['Umbral Vitality', 'Survival layer —'], ['Umbral Fiber', 'Survival layer —'],
           ['Primed Continuity', 'Keeps defenses up —'], ['Umbral Intensify', 'Defensive scaling —'], ['Stretch', 'Breathing room —'], ['Primed Flow', 'Energy buffer —']];
      for (var li = 0; li < labeled.length && picks.length < 8; li++) tryAdd(labeled[li][0], labeled[li][1]);
      flexSlot([]);
    } else {
      for (var ci = 0; ci < core.length && picks.length < 8; ci++) tryAdd(core[ci], '');
      if (quals.steelPath) { tryAdd('Adaptation', 'Steel Path survival.'); tryAdd('Rolling Guard', 'Steel Path survival.'); }
      flexSlot([]);
    }
  } else if (cls === 'melee') {
    var mBase = focus === 'status'
      ? ['Condition Overload', 'Primed Pressure Point', 'Pressure Point']
      : ['Primed Pressure Point', 'Pressure Point'];
    slot(mBase, 'Base damage —');
    if (focus === 'status') {
      tryAdd('Weeping Wounds', 'Status engine —');
      elemSlots('viral', false, 'Status element');
      elemSlots('corrosive', false, 'Second combo');
      tryAdd(WS_FLAT_STATUS.melee, 'Flat status —');
      tryAdd('Drifting Contact', 'Combo uptime —');
    } else if (focus === 'offmeta') {
      slot(['Spoiled Strike', 'Heavy Trauma', 'Buzz Kill'], 'Off-meta pick —');
      slot(['True Steel', 'Sacrificial Steel'], 'Crit chance —');
      elemSlots(wsComboFor(plan, profile, seed), seed % 2 === 0, 'Element');
      flexSlot(['Collision Force', 'Primed Heavy Trauma']);
    } else {
      if (isCritProfile || focus === 'crit' || focus === 'damage') {
        slot(['Blood Rush', 'True Steel', 'Sacrificial Steel'], 'Crit chance —');
        slot(['Organ Shatter', 'Gladiator Might'], 'Crit damage —');
      }
      if (isStatusProfile || quals.steelPath) tryAdd('Condition Overload', 'Status payoff —');
      elemSlots(wsComboFor(plan, profile, seed), focus === 'damage', 'Element');
      if (focus === 'damage' || quals.steelPath) slot(['Primed Smite Grineer', 'Smite Grineer'], 'Faction damage —');
      flexSlot([]);
    }
    flexSlot([]);
  } else {
    /* guns: rifle / shotgun / pistol */
    var baseCands = cls === 'shotgun' ? ['Primed Point Blank', 'Point Blank']
      : cls === 'pistol' ? ['Hornet Strike', 'Magnum Force'] : ['Serration', 'Heavy Caliber'];
    var msCands = cls === 'shotgun' ? ['Galvanized Hell', "Hell's Chamber"]
      : cls === 'pistol' ? ['Galvanized Diffusion', 'Barrel Diffusion'] : ['Galvanized Chamber', 'Split Chamber'];
    var ccCands = cls === 'shotgun' ? ['Blunderbuss', 'Laser Sight']
      : cls === 'pistol' ? ['Primed Pistol Gambit', 'Pistol Gambit', 'Creeping Bullseye'] : ['Point Strike', 'Critical Delay', 'Argon Scope'];
    var cdCands = cls === 'shotgun' ? ['Primed Ravage', 'Ravage']
      : cls === 'pistol' ? ['Primed Target Cracker', 'Target Cracker'] : ['Vital Sense', 'Hammer Shot'];
    var hmCands = cls === 'pistol' ? ['Hemorrhage'] : ['Hunter Munitions'];
    var baneCands = cls === 'shotgun' || cls === 'rifle' || cls === 'pistol' ? ['Primed Bane of Grineer', 'Bane of Grineer'] : [];

    if (focus === 'offmeta') {
      slot(baseCands.slice().reverse(), 'Base damage —');
      slot(msCands.slice().reverse(), 'Multishot —');
      elemSlots(wsComboFor(plan, profile, seed), seed % 2 === 0, 'Element');
      slot(['Bladed Rounds', 'Fanged Fusillade', 'Wildfire', 'Seeking Force', 'Metal Auger', 'Crash Course'], 'Off-meta pick —');
      flexSlot(['Tainted Mag', 'Stabilizer', 'Sure Shot']);
    } else if (focus === 'status') {
      slot(baseCands, 'Base damage —');
      slot(msCands, 'Multishot —');
      elemSlots('viral', false, 'Status element');
      elemSlots('radiation', false, 'Second combo');
      tryAdd(WS_FLAT_STATUS[cls], 'Flat status —');
      flexSlot([]);
    } else {
      slot(baseCands, 'Base damage —');
      slot(msCands, 'Multishot —');
      var critLean = focus === 'crit' || focus === 'damage' || isCritProfile || (!isStatusProfile && focus === 'profile');
      if (critLean) {
        if (seed % 2 === 0 && focus === 'damage') ccCands = ccCands.slice().reverse();
        slot(ccCands, 'Crit chance —');
        slot(cdCands, 'Crit damage —');
        slot(hmCands, 'Slash engine —');
      }
      elemSlots(wsComboFor(plan, profile, seed), focus === 'damage', 'Element');
      if ((focus === 'damage' || quals.steelPath) && seed % 2 === 0) slot(baneCands, 'Faction damage —');
      else if (quals.steelPath) slot(baneCands, 'Faction damage —');
      if (isStatusProfile && !critLean) tryAdd(WS_FLAT_STATUS[cls], 'Flat status —');
      flexSlot([]);
    }
    flexSlot([]);
  }

  /* top up to a full 8 from the class filler pool (all DB-verified) */
  var fillPool = FILLER_POOL[cls] || [];
  for (var fi = 0; fi < fillPool.length && picks.length < 8; fi++) tryAdd(fillPool[fi], 'Workshop filler — a strong legal staple for the slot.');
  if (picks.length !== 8) return null;

  var aura = '', exilus = '', arcane = '';
  if (found.kind === 'warframe') {
    aura = wsAuraFor(found, plan, profile, seed);
    exilus = wsExilusFor(found, plan, seed);
    arcane = wsArcanesFor(found, plan, profile).join(' + ');
  } else {
    arcane = wsWeaponArcaneFor(cls, plan);
  }

  var focusTitles = {
    power: 'Full Power', survival: 'Survival Fortress',
    damage: 'Full Damage', status: 'Status Storm', crit: 'Crit Hunter',
    offmeta: 'Off-Meta Experiment', profile: 'Original Mix', element: (plan.element ? plan.element.charAt(0).toUpperCase() + plan.element.slice(1) : 'Element') + ' Mix',
    ability: (plan._abilityName ? plan._abilityName + ' Focus' : 'Ability Focus')
  };
  var build = {
    name: found.e.name + ' — ' + (focusTitles[focus] || 'Workshop Original'),
    item: found.e.name,
    category: wsBuildCategory(found),
    tags: ['workshop'],
    description: '',
    playstyle: '',
    aura: aura, exilus: exilus, arcane: arcane,
    mods: picks.map(function (p) { return { name: p.name, note: p.note }; })
  };
  /* v2.22.0: a power build gets a named concept of its own, never a
     library card's name */
  if (plan.power) build.name = found.e.name + ' — ' + wsConceptName(found, plan, profile);
  return { build: build, profile: profile };
}

/* aura for a Workshop frame build — a real aura mod from the database */
function wsAuraFor(found, plan, profile, seed) {
  var byArch = {
    caster: ['Growing Power', 'Corrosive Projection'],
    support: ['Energy Siphon', 'Rejuvenation', 'Growing Power'],
    tank: ['Steel Charge', 'Physique', 'Rejuvenation'],
    platform: ['Growing Power', 'Corrosive Projection']
  };
  var cands = [];
  if (plan.focus === 'offmeta') cands = ['Loot Detector', 'Enemy Sense', 'Sprint Boost', 'Physique', 'Dead Eye'];
  if (plan.focus === 'damage' || plan.focus === 'ability') cands = cands.concat(['Growing Power']);
  if (plan.focus === 'power') cands = cands.concat(['Growing Power']);
  if (plan.focus === 'survival') cands = cands.concat(['Physique', 'Rejuvenation', 'Growing Power']);
  cands = cands.concat(byArch[profile.arch] || [], ['Corrosive Projection', 'Brief Respite', 'Energy Siphon']);
  for (var i = 0; i < cands.length; i++) {
    if (findModExact(cands[i]) && isAuraMod(cands[i])) return cands[i];
  }
  return '';
}

/* exilus for a Workshop frame build — verified against the DB + class */
function wsExilusFor(found, plan, seed) {
  var cands = plan.focus === 'offmeta'
    ? ['Rush', 'Mobilize', 'Firewalker', 'Lightning Dash', 'Ice Spring', 'Toxic Flight']
    : ['Power Drift', 'Cunning Drift', 'Coaction Drift', 'Rush', 'Mobilize'];
  for (var i = 0; i < cands.length; i++) {
    if (findModExact(cands[i]) && modFitsClass(cands[i], 'warframe', found.e.name) && !isAuraMod(cands[i])) return cands[i];
  }
  return '';
}

/* arcane for a Workshop frame build — must exist in the arcanes DB */
function wsArcaneFor(found, plan, profile) {
  var byArch = {
    caster: ['Arcane Energize', 'Arcane Steadfast', 'Molt Augmented'],
    support: ['Arcane Energize', 'Arcane Guardian', 'Molt Efficiency'],
    tank: ['Arcane Guardian', 'Arcane Grace', 'Arcane Tanker'],
    platform: ['Arcane Avenger', 'Arcane Fury', 'Molt Augmented']
  };
  var cands = (byArch[profile.arch] || []).concat(['Arcane Energize', 'Molt Augmented']);
  for (var i = 0; i < cands.length; i++) {
    if (findByName(D.arcanes, cands[i])) return cands[i];
  }
  return '';
}
/* v2.22.0: dossier frame builds carry TWO arcanes, picked by role and
   verified against the arcanes DB (Energize / Molt-class for casters,
   Guardian-class for survival). build.arcane stays a ' + '-joined string —
   vbcArcanes splits it back into the card's two arcane slots. */
function wsArcanesFor(found, plan, profile) {
  var arch = profile.arch || 'platform';
  var pair;
  if (plan.focus === 'survival') pair = ['Arcane Guardian', 'Arcane Energize'];
  else if (plan.focus === 'power' || plan.focus === 'damage') pair = arch === 'tank' ? ['Arcane Guardian', 'Molt Augmented'] : ['Arcane Energize', 'Molt Augmented'];
  else if (arch === 'support') pair = ['Arcane Energize', 'Arcane Guardian'];
  else if (arch === 'tank') pair = ['Arcane Guardian', 'Arcane Grace'];
  else if (arch === 'platform') pair = ['Arcane Avenger', 'Arcane Energize'];
  else pair = ['Arcane Energize', 'Molt Efficiency'];
  var out = [];
  pair.concat(['Arcane Energize', 'Arcane Guardian', 'Arcane Aegis', 'Molt Efficiency', 'Molt Augmented']).forEach(function (n) {
    if (out.length < 2 && out.indexOf(n) === -1 && findByName(D.arcanes, n)) out.push(n);
  });
  return out;
}
function wsWeaponArcaneFor(cls, plan) {
  var cands = cls === 'melee' ? ['Melee Influence', 'Melee Crescendo', 'Melee Exposure']
    : cls === 'pistol' ? ['Secondary Merciless', 'Secondary Deadhead', 'Secondary Encumber']
    : ['Primary Merciless', 'Primary Deadhead', 'Primary Blight'];
  for (var i = 0; i < cands.length; i++) {
    if (findByName(D.arcanes, cands[i])) return cands[i];
  }
  return '';
}

/* One repair pass: drop any mod that fails the real-mod / class / dupe /
   aura checks, refill from DB-legal filler, fix aura/exilus. Returns the
   repaired build or null — an invalid build is never displayed. */
function wsRepair(build) {
  var cls = buildClassOf(build);
  if (!cls) return null;
  var used = {}, mods = [];
  (build.mods || []).forEach(function (m) {
    var n = m && m.name;
    if (!n || used[norm(n)]) return;
    if (!findModExact(n) || isAuraMod(n) || !modFitsClass(n, cls, build.item)) return;
    used[norm(n)] = 1;
    mods.push({ name: n, note: m.note || '' });
  });
  var pool = FILLER_POOL[cls] || [];
  for (var i = 0; i < pool.length && mods.length < 8; i++) {
    var pn = pool[i];
    if (used[norm(pn)] || !findModExact(pn) || !modFitsClass(pn, cls, build.item)) continue;
    used[norm(pn)] = 1;
    mods.push({ name: pn, note: 'Workshop repair — a verified legal staple swapped in to keep this build legal.' });
  }
  if (mods.length !== 8) return null;
  var out = {
    name: build.name, item: build.item, category: build.category, tags: build.tags || ['workshop'],
    description: '', playstyle: build.playstyle || '',
    aura: build.aura || '', exilus: build.exilus || '', arcane: build.arcane || '',
    mods: mods
  };
  if (out.aura && (cls !== 'warframe' || !isAuraMod(out.aura))) out.aura = '';
  if (out.exilus && (!findModExact(out.exilus) || !modFitsClass(out.exilus, cls, out.item))) out.exilus = '';
  return buildIsValid(out) ? out : null;
}

/* Capacity sanity check (v2.22.0): drains come from the live item data
   fetched during the research stage ({normName: maxDrain}). Budgets are
   the standard no-Forma ones — 60 for a Catalyst weapon, 60 + aura bonus
   for a Reactor frame. One swap attempt (highest-drain pick → lowest-
   drain legal filler); the outcome is reported honestly on the card:
   'ok' (verified fits), 'over' (a Forma is part of the plan), or
   'unknown' (drain data incomplete — no claim is made). */
function wsCapacity(build, drains) {
  if (!drains) return 'unknown';
  var cls = buildClassOf(build);
  var cap = cls === 'warframe' ? 60 + (drains[norm(build.aura || '')] || 14) : 60;
  function total(b) {
    var sum = 0, known = true;
    b.mods.forEach(function (m) {
      var d = drains[norm(m.name)];
      if (d == null) known = false; else sum += d;
    });
    if (b.exilus) { var dx = drains[norm(b.exilus)]; if (dx == null) known = false; else sum += dx; }
    return known ? sum : -1;
  }
  var t = total(build);
  if (t === -1) return 'unknown';
  if (t <= cap) { build._capNote = 'ok'; return build; }
  /* one repair attempt: swap the priciest pick for the cheapest legal filler */
  var pool = (FILLER_POOL[cls] || []).filter(function (n) {
    return drains[norm(n)] != null && !build.mods.some(function (m) { return norm(m.name) === norm(n); }) &&
      findModExact(n) && modFitsClass(n, cls, build.item);
  }).sort(function (a, b) { return drains[norm(a)] - drains[norm(b)]; });
  if (pool.length) {
    var idx = -1, maxD = -1;
    build.mods.forEach(function (m, i) { var d = drains[norm(m.name)] || 0; if (d > maxD) { maxD = d; idx = i; } });
    var clone = JSON.parse(JSON.stringify(build));
    clone.mods[idx] = { name: pool[0], note: 'Capacity swap — the Workshop traded this slot to a lower-drain staple so the build fits a standard setup.' };
    if (buildIsValid(clone) && total(clone) !== -1 && total(clone) <= cap) { clone._capNote = 'ok'; return clone; }
  }
  build._capNote = 'over';
  return build;
}

/* Compose + validate (+ one repair). Returns {build, profile} or null.
   v2.22.0: also resolves power plans, and accepts the handoff's plan hint
   (item / focus / power / ctxNote) for session follow-ups whose raw text
   names no item — the hint comes from the handoff answer() itself made. */
function workshopCompose(q, researched, hint) {
  var plan = null;
  if (hint && hint.power) plan = powerPlan(q);
  if (!plan) plan = workshopPlan(q) || powerPlan(q);
  if (!plan && hint && hint.item) {
    var hf = findByName(D.warframes, hint.item);
    var he = hf || findByName(D.weapons, hint.item);
    if (he) {
      var hq = parseQualifiers(q);
      if (hint.steelPath) hq.steelPath = true;
      plan = {
        item: he.name, kind: hf ? 'warframe' : 'weapon', e: he,
        focus: hint.focus || 'profile', abilityPhrase: null, element: null,
        quals: hq, q: q, power: !!hint.power,
        kill: false, surv: /\bsurvival\b/.test(String(hint.focus || '') + ' ' + q),
        ctxNote: hint.ctxNote || null
      };
    }
  }
  if (!plan) return null;
  var found = { kind: plan.kind, e: plan.e };
  var res = wsCompose(found, plan, researched);
  if (!res) return null;
  var build = res.build;
  if (!buildIsValid(build)) {
    build = wsRepair(build);
    if (!build) return null;
  }
  return { build: build, profile: res.profile, plan: plan };
}

/* ---------- v2.22.0: THE DOSSIER — power / survival build answers ----
   The owner's style spec (from a Google AI answer he held up as the bar):
   a named concept, an intro on how it destroys / survives, the full
   layout with concept-tied WHYs, a Helminth line with reasoning, two
   arcanes, an Archon Shard setup, a "why this works — the math" section
   whose numbers are COMPUTED from the build and the real formulas (the
   exemplar he pasted was sloppy here — ours may not be), a numbered
   play rotation, and a closing follow-up offer. Everything named —
   subsume, donor, shards, arcanes — is verified against the database
   or the site's verified shards data before it is printed. */
function wsStripTags(s) { return String(s || '').replace(/<[^>]+>/g, ''); }
function wsFmtNum(x) { var r = Math.round(x * 10) / 10; return (r % 1 === 0) ? String(Math.round(r)) : String(r); }

var WS_CONCEPTS = {
  power:    { caster: 'Room Melter', support: 'Deathless Engine', tank: 'The Immovable Object', platform: 'Room Melter' },
  damage:   { caster: 'Room Melter', support: 'The Amplifier', tank: 'The Wrecking Ball', platform: 'Room Melter' },
  survival: { caster: 'The Untouchable', support: 'The Lifeline', tank: 'The Immovable Object', platform: 'The Untouchable' },
  profile:  { caster: 'Workshop Original', support: 'Workshop Original', tank: 'Workshop Original', platform: 'Workshop Original' }
};
function wsConceptName(found, plan, profile) {
  if (found.kind === 'weapon') {
    if ((profile.cc || 0) >= 25) return 'The Headtaker';
    if ((profile.sc || 0) >= 25) return 'The Plaguebearer';
    return 'The Deleter';
  }
  var table = WS_CONCEPTS[plan.focus] || WS_CONCEPTS.profile;
  return table[profile.arch || 'platform'] || 'Workshop Original';
}

/* real Ability Strength of a composed build, parsed from the mods DB's
   own effect strings ("+99% Ability Strength | -55% Ability Efficiency") */
function wsStrengthOf(name) {
  var m = findModExact(name);
  if (!m) return 0;
  var mt = String(m.effect || '').match(/([+-]?\d+(?:\.\d+)?)%\s*Ability Strength/);
  return mt ? parseFloat(mt[1]) : 0;
}
function wsBuildStrength(build) {
  var parts = [], total = 100;
  (build.mods || []).forEach(function (md) {
    var s = wsStrengthOf(md.name);
    if (s) { parts.push({ name: md.name, s: s }); total += s; }
  });
  return { total: total, parts: parts, exilus: build.exilus ? wsStrengthOf(build.exilus) : 0 };
}

/* the Helminth subsume pool the composer may reach for — every entry is
   re-verified at compose time against the donor frame's real ability
   list in the database before it can be printed */
var WS_SUBSUMES = [
  { name: 'Pillage', donor: 'Hildryn' },
  { name: 'Nourish', donor: 'Grendel' },
  { name: 'Roar', donor: 'Rhino' },
  { name: 'Eclipse', donor: 'Mirage' },
  { name: 'Gloom', donor: 'Sevagoth' },
  { name: 'Dispensary', donor: 'Protea' },
  { name: 'Elemental Ward', donor: 'Chroma' }
];
function wsSubsumeVerified(s) {
  var donor = findByName(D.warframes, s.donor);
  if (!donor) return false;
  return (donor.abilities || []).some(function (a) { return norm(a.name) === norm(s.name); });
}
function wsSignatureAbility(frame) {
  var best = null;
  (frame.abilities || []).forEach(function (a) {
    if (!best && /damage/.test(norm(a.description || ''))) best = a;
  });
  return best || (frame.abilities || [])[0] || null;
}
/* Which ability the subsume replaces — ONE general rule for every frame,
   no per-frame exceptions: score each ability by the value its own DB
   description claims (damage and defenses are precious, buffs and energy
   matter, pure crowd manipulation is the most replaceable), protect the
   ability the brief is focused on, and replace the lowest scorer. A kit
   shaped like a scaling damage engine + a defensive layer + a buff + a
   charmed distraction lands on its distraction ability by this rule
   alone — which is exactly the answer the owner's test case needs,
   reached with no frame named anywhere. */
function wsReplaceTarget(frame, plan) {
  var abs = frame.abilities || [];
  function keepScore(a) {
    var d = norm(a.description || ''), s = 0;
    if (/damage/.test(d)) s += 4;
    if (/heal|health|shield|invisib|cloak|stealth|damage reduction|overguard|armor|resist/.test(d)) s += 3;
    if (/buff|amplif|energy|restore/.test(d)) s += 2;
    if (/charm|follow|attract|distract|decoy|taunt|confus/.test(d)) s -= 2;
    return s;
  }
  var worst = null, worstScore = 1e9;
  abs.forEach(function (a) {
    if (plan._abilityName && norm(a.name) === norm(plan._abilityName)) return;
    var s = keepScore(a);
    if (s < worstScore) { worstScore = s; worst = a; }
  });
  return worst;
}
function wsHelminth(found, plan, profile) {
  if (found.kind !== 'warframe') return null;
  var frame = found.e;
  var arch = profile.arch || frameArchetype(frame);
  var abText = (frame.abilities || []).map(function (a) { return norm((a.name || '') + ' ' + (a.description || '')); }).join(' ');
  var hasStrip = /(strip|reduc\w+|remov\w+)[^.]{0,40}armor|armor[^.]{0,40}(strip|reduc|remov)/.test(abText);
  var want;
  if ((plan.power || (plan.quals && plan.quals.steelPath)) && !hasStrip) want = 'Pillage';
  else if (plan.focus === 'survival') want = 'Gloom';
  else if (arch === 'support') want = 'Nourish';
  else if (arch === 'tank') want = 'Elemental Ward';
  else if (arch === 'platform') want = 'Roar';
  else want = 'Nourish';
  var base = norm(frame.name).replace(/ prime$/, '');
  var chosen = null;
  var order = [want];
  WS_SUBSUMES.forEach(function (s) { if (s.name !== want) order.push(s.name); });
  for (var i = 0; i < order.length && !chosen; i++) {
    var cand = null;
    WS_SUBSUMES.forEach(function (s) { if (s.name === order[i]) cand = s; });
    if (!cand) continue;
    if (norm(cand.donor).replace(/ prime$/, '') === base) continue; /* already hers */
    if ((frame.abilities || []).some(function (a) { return norm(a.name) === norm(cand.name); })) continue;
    if (wsSubsumeVerified(cand)) chosen = cand;
  }
  if (!chosen) return null;
  var rep = wsReplaceTarget(frame, plan);
  var sig = wsSignatureAbility(frame);
  var why = {
    'Pillage': 'Pillage strips a percentage of enemy armor and shields that scales with Ability Strength, then pays the stolen defenses back to you as shields on the return pulse. ' + (sig ? '<b>' + esc(sig.name) + '</b> damage scales the longer a fight runs — against stripped armor, every point of it lands in full. Strip first, then let ' + esc(sig.name) + ' cash out on bare health: that is the whole loop.' : 'Percent-strip is the great equalizer at high level — tanky enemies stop being tanky.'),
    'Gloom': 'Gloom slows everything that walks into its aura and pays life steal on every hit landed inside it — a survival engine that also soft-locks melee rushes before they reach you.',
    'Nourish': 'Nourish multiplies the energy you gain and adds viral damage to your weapons — the sustain a casting build burns through, plus a damage type the whole squad benefits from.',
    'Roar': 'Roar is a flat damage multiplier for you and your squad — the highest-value button a weapon platform can borrow.',
    'Eclipse': 'Eclipse is a damage buff in the light and damage reduction in the dark — one slot that swings between output and survival as the fight moves.',
    'Dispensary': 'Dispensary prints health, energy and ammo on demand — the sustain anchor for a frame that wants to hold one position and never leave it.',
    'Elemental Ward': 'Elemental Ward converts your energy color into a standing health or armor buff — passive toughness that is simply on.'
  };
  return { name: chosen.name, donor: chosen.donor, replaces: rep ? rep.name : null, why: why[chosen.name] || '' };
}

/* Archon Shard recommendations — bonus values verified against the
   site's own shards data (data/site/shards.json); 5 slots per frame */
var WS_SHARD_STATS = {
  Crimson: { strength: '+10% Ability Strength (+15% Tauforged)', duration: '+10% Ability Duration (+15% Tauforged)', meleeCd: '+25% Melee Critical Damage (+37.5% Tauforged)' },
  Amber: { casting: '+25% Casting Speed (+37.5% Tauforged)', orbEnergy: '+45% Energy Orb Effectiveness (+67.5% Tauforged)' },
  Azure: { armor: '+150 Armor (+225 Tauforged)', health: '+150 Max Health (+225 Tauforged)', energy: '+50 Max Energy (+75 Tauforged)' },
  Violet: { meleeCd: '+25% Melee Critical Damage — doubles while max energy is over 500' }
};
function wsShardRec(found, plan, profile) {
  if (found.kind !== 'warframe') return null;
  var arch = profile.arch || 'platform';
  var rec;
  if (plan.focus === 'survival') rec = [{ n: 2, c: 'Azure', s: 'armor' }, { n: 1, c: 'Azure', s: 'health' }, { n: 1, c: 'Crimson', s: 'duration' }, { n: 1, c: 'Amber', s: 'casting' }];
  else if (arch === 'support') rec = [{ n: 2, c: 'Amber', s: 'orbEnergy' }, { n: 2, c: 'Crimson', s: 'duration' }, { n: 1, c: 'Azure', s: 'energy' }];
  else if (arch === 'tank') rec = [{ n: 2, c: 'Azure', s: 'armor' }, { n: 1, c: 'Azure', s: 'health' }, { n: 2, c: 'Crimson', s: 'strength' }];
  else rec = [{ n: 3, c: 'Crimson', s: 'strength' }, { n: 1, c: 'Amber', s: 'casting' }, { n: 1, c: 'Crimson', s: 'duration' }];
  var line = rec.map(function (r) { return r.n + '× ' + r.c + ' (' + WS_SHARD_STATS[r.c][r.s] + ')'; }).join(' · ');
  return { rec: rec, line: line };
}

/* the math section — every number derived from the composed build and
   the real formulas, never asserted. Pillage (Warframe Wiki, verified
   Oct 2026): strips 25% of armor/shields at max rank, scaled by Ability
   Strength; full strip at 400% strength, or 328% with one Corrosive
   Projection (which itself removes 18%). */
function wsMathLines(build, plan, profile, helminth) {
  var lines = [];
  if (plan.kind === 'warframe') {
    var st = wsBuildStrength(build);
    var effTotal = st.total + st.exilus;
    if (st.parts.length) {
      lines.push('Modded Ability Strength: <b>' + effTotal + '%</b> — 100 base' +
        st.parts.map(function (p) { return ' + ' + p.s + ' (' + esc(p.name) + ')'; }).join('') +
        (st.exilus ? ' + ' + st.exilus + ' (' + esc(build.exilus) + ', Exilus)' : '') + '.');
    }
    if (helminth && helminth.name === 'Pillage') {
      var strip = 25 * effTotal / 100;
      var cp = norm(build.aura || '') === 'corrosive projection';
      var needed = cp ? 82 : 100;
      var casts = strip >= needed ? 1 : Math.ceil(needed / strip);
      lines.push('<b>Pillage:</b> strips <b>25% × ' + effTotal + '% strength ≈ ' + wsFmtNum(strip) + '%</b> of an enemy\'s total armor per cast' +
        (cp ? ' — and Corrosive Projection has already removed 18%, so only 82% is left to strip' : '') +
        ' — that is <b>' + (casts === 1 ? 'a full strip in a single cast' : casts + ' casts to fully strip') + '</b>. ' +
        'The Wiki\'s checkpoints agree with the formula: full strip at 400% strength, or 328% with Corrosive Projection up. This build sits at ' + effTotal +
        '%, so the honest number is ' + (casts === 1 ? 'one cast' : casts + ' casts') + ' — not one.');
    }
    var sig = wsSignatureAbility(plan.e);
    if (sig && sig.description) {
      var first = sig.description.split(/(?<=[.!?])\s+/)[0];
      /* the scaling claim is made only when the ability's own DB text
         supports it — otherwise the strip is justified on its own terms */
      var scales = /scal|increas|grow|longer|accumulat|stack/.test(norm(sig.description));
      lines.push('<b>' + esc(sig.name) + '</b> — ' + esc(first) +
        (scales
          ? ' Scaling damage is why the strip matters: percent-strip takes a cut of an enemy\'s total armor, so the tankiest targets lose the most effective health to it.'
          : ' Percent-strip takes a cut of an enemy\'s total armor, so the tankiest targets lose the most effective health to it.'));
    }
  } else if ((profile.cc || 0) > 0) {
    var avg = 1 + (profile.cc / 100) * (profile.cm - 1);
    lines.push('Researched profile: <b>' + profile.cc + '% crit × ' + profile.cm + '</b> — before mods, an average hit is worth ≈ <b>×' + wsFmtNum(avg) + '</b> (crit chance × crit damage; headshot multipliers not counted). The composition\'s job is pushing that crit rate toward always-on.');
  }
  return lines;
}

function wsRotation(build, plan, profile, helminth) {
  var steps = [];
  if (plan.kind === 'warframe') {
    var frame = plan.e;
    var sig = wsSignatureAbility(frame);
    var def = null, fourth = null;
    (frame.abilities || []).forEach(function (a) {
      if (!def && /heal|shield|invisib|cloak|damage reduction|overguard/.test(norm(a.description || ''))) def = a;
    });
    (frame.abilities || []).forEach(function (a) {
      if (fourth) return;
      if (a === sig || a === def) return;
      if (helminth && helminth.replaces && norm(a.name) === norm(helminth.replaces)) return;
      fourth = a;
    });
    if (sig) {
      /* rotation flavor is read off the ability's own DB description —
         any ability that draws fire and converts damage earns the line */
      var sigD = norm(sig.description || ''), sigFlavor = '';
      if (/(draw|attract|divert|taunt)/.test(sigD) && /(fire|attention|attacks|aggro)/.test(sigD)) {
        sigFlavor = ' — it draws their fire';
        if (/(damage inflicted|absorbs?|converts?|reflects?|increases its|grows)/.test(sigD)) sigFlavor += ' and turns what it soaks up into more damage';
      }
      steps.push('Drop <b>' + esc(sig.name) + '</b> where the pack funnels in' + sigFlavor + '.');
    }
    if (helminth && helminth.name === 'Pillage') steps.push('Fire <b>Pillage</b> through the pack — the strip math above is per cast, and the stolen defenses come back to you as shields on the return pulse.');
    else if (helminth) steps.push('Weave in <b>' + esc(helminth.name) + '</b>' + (helminth.replaces ? ' (it replaced ' + esc(helminth.replaces) + ')' : '') + ' whenever its job comes up — it is the borrowed half of this build.');
    if (def && (!helminth || !helminth.replaces || norm(def.name) !== norm(helminth.replaces))) {
      /* defensive flavor likewise comes from the ability's own text —
         cloaking, overguard, damage blunting, healing — never its name */
      var defD = norm(def.description || ''), defFlavor = '';
      if (/invisib|cloak|unseen/.test(defD)) defFlavor = ' — cloaking is the strongest defense in the kit: enemies cannot kill what they cannot see';
      else if (/overguard/.test(defD)) defFlavor = ' — while overguard holds, status effects and knockdowns simply do not apply';
      else if (/damage reduction|redirect/.test(defD)) defFlavor = ' — while it holds, incoming damage is blunted before it reaches you';
      else if (/heal|health/.test(defD)) defFlavor = ' — steady healing is what turns a long fight into a safe one';
      steps.push('Keep <b>' + esc(def.name) + '</b> rolling' + defFlavor + '.');
    }
    if (fourth) steps.push('Refresh in order: ' + esc(sig ? sig.name : 'your damage ability') + ' before it fades' + (helminth ? ', ' + esc(helminth.name) + ' on every new pack' : '') + ', ' + esc(fourth.name) + ' whenever it drops. The longer the run, the harder this build hits.');
  } else {
    if ((profile.cc || 0) >= 18) steps.push('Aim for heads — at ' + profile.cc + '% base crit chance, headshots are where this build lives.');
    else if ((profile.sc || 0) >= 18) steps.push('Let status land first — two or three hits prime a target, then the damage mods cash out.');
    else steps.push('Open at the range the profile favors and make the first magazine decisive.');
    var arc0 = vbcArcanes(build.arcane)[0];
    if (arc0) steps.push('Keep <b>' + esc(arc0) + '</b> stacked — re-engage before the buff lapses rather than starting cold.');
    steps.push('Reposition instead of reloading in the open; this setup wins fights early, not late.');
  }
  return steps;
}

function wsIntro(build, plan, profile, helminth) {
  if (plan.kind === 'warframe') {
    var sig = wsSignatureAbility(plan.e);
    var s = '';
    if (sig && sig.description) {
      var first = sig.description.split(/(?<=[.!?])\s+/)[0];
      s = '<b>' + esc(sig.name) + '</b> is the engine — ' + esc(first.charAt(0).toLowerCase() + first.slice(1)) + ' ';
    }
    if (plan.focus === 'survival') s += 'This layout is built so ' + esc(plan.item) + ' does not go down: layered defenses first, damage a close second.';
    else if (helminth && helminth.name === 'Pillage') s += 'Layer Pillage\'s scaling armor strip underneath and the loop closes: strip the room, let the scaling damage land on bare health, and let the stolen shields pay for your survival.';
    else s += 'This layout leans everything into ' + (sig ? esc(sig.name) : 'the kit') + ' and the stats that feed it.';
    return s;
  }
  return 'Researched profile: <b>' + profile.cc + '% crit</b> (×' + profile.cm + '), <b>' + profile.sc + '% status</b>' +
    (profile.innate && profile.innate.length ? ', mostly <b>' + esc(profile.innate.slice(0, 3).join(' / ')) + '</b>' : '') +
    ' — this composition pushes exactly those numbers until the item does what you asked.';
}

/* the dossier as structured data — the render consumes it, and the AI
   panel's prose writer (js/ai.js) may rewrite the connective prose from
   these verified facts only */
function buildDossier(build, plan, profile) {
  var found = { kind: plan.kind, e: plan.e };
  var helminth = wsHelminth(found, plan, profile);
  var shards = wsShardRec(found, plan, profile);
  var math = wsMathLines(build, plan, profile, helminth);
  var intro = wsIntro(build, plan, profile, helminth);
  return {
    concept: wsConceptName(found, plan, profile),
    intro: intro,
    helminth: helminth,
    shards: shards,
    math: math,
    rotation: wsRotation(build, plan, profile, helminth),
    facts: [wsStripTags(intro)].concat(math.map(wsStripTags))
  };
}

function dossierRender(build, plan, profile, prose) {
  var d = buildDossier(build, plan, profile);
  var capLine = build._capNote === 'ok'
    ? ' Capacity-verified against live drain data: fits a standard Catalyst/Reactor setup, no Forma assumed.'
    : build._capNote === 'over'
    ? ' Heads-up: at max rank this set runs over a no-Forma capacity — a Forma or two is part of the plan.'
    : '';
  var card = buildCard({
    title: build.name,
    aura: vbcCleanSlot(build.aura),
    exilus: vbcCleanSlot(build.exilus),
    mods: build.mods.map(function (m) { return m.name; }),
    arcanes: vbcArcanes(build.arcane),
    note: 'Composed in the Workshop as a power dossier.' + capLine
  });
  var rows = build.mods.map(function (m, i) {
    var fm = findModExact(m.name);
    return '<div class="mod-row"><div><b>' + (i + 1) + '. ' + esc(m.name) + '</b>' +
      (m.note ? '<div class="muted small">' + esc(m.note) + '</div>' : '') +
      (fm ? modFarmLine(fm) : '') + '</div></div>';
  }).join('');
  var h = '';
  if (plan.ctxNote) h += '<p class="muted small">' + esc(plan.ctxNote) + '</p>';
  h += '<p>🛠 <b>Vaulty Original</b> — composed just now from real mods.</p>';
  h += '<p><b>' + esc(d.concept) + '</b> — ' + (prose && prose.introHtml ? String(prose.introHtml).replace(/^<p>/, '').replace(/<\/p>\s*$/, '') : d.intro) + '</p>';
  h += card + rows;
  if (d.helminth) {
    var augNote = '';
    if (d.helminth.replaces) {
      (build.mods || []).forEach(function (m) {
        var fm2 = findModExact(m.name);
        if (fm2 && norm(fm2.effect || '').indexOf(norm(d.helminth.replaces) + ' augment') !== -1) {
          augNote = ' Heads-up: <b>' + esc(m.name) + '</b> augments ' + esc(d.helminth.replaces) + ' — swap it out when you make this subsume, it mods the ability being replaced.';
        }
      });
    }
    h += '<p>🧬 <b>Helminth:</b> subsume <b>' + esc(d.helminth.name) + '</b> (from ' + esc(d.helminth.donor) + ')' +
      (d.helminth.replaces ? ' over <b>' + esc(d.helminth.replaces) + '</b>' : '') + ' — ' + d.helminth.why + augNote + '</p>';
  }
  if (d.shards) h += '<p>💠 <b>Archon Shards:</b> ' + esc(d.shards.line) + ' <span class="muted small">(5 slots; Tauforged = 1.5× each bonus.)</span></p>';
  if (d.math.length) {
    h += '<p><b>📐 Why this works — the math:</b></p>' +
      (prose && prose.mathHtml ? prose.mathHtml : d.math.map(function (l) { return '<p>' + l + '</p>'; }).join(''));
  }
  if (d.rotation.length) {
    h += '<p><b>▶ Play rotation:</b></p><ol>' + d.rotation.map(function (s) { return '<li>' + s + '</li>'; }).join('') + '</ol>';
  }
  h += '<p class="muted small">Every mod is real and checked against the database; the combination is new — this build is not from the library.</p>';
  h += alternativesHtml(build.item, null);
  h += '<p class="muted small">🔎 Researched just now — item data: the Vault database' +
    (profile.live ? ' + live data (warframestat.us)' : '') +
    ' · mechanics: <a href="https://wiki.warframe.com/w/' + encodeURIComponent(plan.item.replace(/ /g, '_')) + '" target="_blank" rel="noopener">Warframe Wiki — ' + esc(plan.item) + '</a>' +
    (d.helminth && d.helminth.name === 'Pillage' ? ' · <a href="https://wiki.warframe.com/w/Pillage" target="_blank" rel="noopener">Pillage</a>' : '') + '</p>';
  h += '<p>' + (plan.kind === 'warframe'
    ? 'Want the full Archon Shard setup for this layout — Tauforged picks included?'
    : 'Want the frame setup that feeds this weapon?') + '</p>';
  return h;
}

/* Render a composed build on the standard card, with the Workshop label.
   Copy payloads come from buildCard's store, so Copy always matches the
   mods on screen. */
function workshopRender(build, plan, profile, prose) {
  if (plan && (plan.power || plan.focus === 'survival' || plan.focus === 'power')) {
    return dossierRender(build, plan, profile, prose);
  }
  var focusLines = {
    damage: 'You asked for <b>full damage</b> — no survival padding, no half measures.',
    status: 'You asked for <b>status</b> — this composition stacks procs first and asks questions later.',
    crit: 'You asked for <b>crit</b> — this composition lives on crit chance and crit damage.',
    offmeta: 'You asked for <b>weird / off-meta</b> — this composition deliberately steps off the beaten path (every mod still real, still legal).',
    element: 'You asked for a <b>' + esc(plan.element || 'element') + '</b> composition.',
    ability: 'You asked for a build <b>focused on ' + esc(plan._abilityName || plan.abilityPhrase || 'its signature ability') + '</b>.',
    profile: 'An original composition, built around what the research says this item actually does.'
  };
  var ground = '';
  if (plan.kind === 'weapon') {
    ground = 'Research first: <b>' + esc(plan.item) + '</b> rolls <b>' + profile.cc + '% crit</b> (×' + profile.cm +
      ' damage) and <b>' + profile.sc + '% status</b>' +
      (profile.innate.length ? ', dealing mostly <b>' + esc(profile.innate.slice(0, 3).join(' / ')) + '</b>' : '') +
      (profile.live ? ' — live item data, pulled just now.' : ' — from the Vault\'s data.');
  } else {
    ground = 'Research first: <b>' + esc(plan.item) + '</b> is a <b>' + esc(profile.arch || 'versatile') +
      '-archetype frame' + (plan._abilityName ? ', and this brief centers <b>' + esc(plan._abilityName) + '</b>' : '') +
      (profile.live ? ' — kit confirmed against live data just now.' : ' — from the Vault\'s data.');
  }
  var capLine = build._capNote === 'ok'
    ? ' Capacity-verified against live drain data: fits a standard Catalyst/Reactor setup, no Forma assumed.'
    : build._capNote === 'over'
    ? ' Heads-up: at max rank this set runs over a no-Forma capacity — a Forma or two is part of the plan.'
    : '';
  var card = buildCard({
    title: build.name,
    aura: vbcCleanSlot(build.aura),
    exilus: vbcCleanSlot(build.exilus),
    mods: build.mods.map(function (m) { return m.name; }),
    arcanes: vbcArcanes(build.arcane),
    note: 'Composed in the Workshop for this brief.' + capLine
  });
  var rows = build.mods.map(function (m, i) {
    var fm = findModExact(m.name);
    return '<div class="mod-row"><div><b>' + (i + 1) + '. ' + esc(m.name) + '</b>' +
      (m.note ? '<div class="muted small">' + esc(m.note) + '</div>' : '') +
      (fm ? modFarmLine(fm) : '') + '</div></div>';
  }).join('');
  return '<p>🛠 <b>Vaulty Original</b> — composed just now from real mods.</p>' +
    '<p>' + (focusLines[plan.focus] || focusLines.profile) + ' ' + ground + '</p>' +
    card + rows +
    '<p class="muted small">Every mod is real and checked against the database; the combination is new — this build is not from the library.</p>' +
    alternativesHtml(build.item, null) +
    '<p class="muted small">Want a different flavor? Rephrase the brief — <i>"design a status ' + esc(plan.item) +
    ' build"</i>, <i>"weird off-meta ' + esc(plan.item) + '"</i> — and the Workshop will compose again.</p>';
}

/* Workshop failure path: the item's library card if one exists (proven
   beats invented), else null so the caller can serve the honest
   don't-know + research buttons. */
function workshopFallback(itemName) {
  var libs = libraryBuildsFor(itemName);
  if (libs.length) return buildAnswer(libs[0]);
  return null;
}

  /* ===== STEEL PATH ONE-SHOT KNOWLEDGE BASE =====
   Deep build knowledge: the one-shot formula, curated 8-mod templates for
   meta weapons, primer setups, archon shards, and frame enablers. */

var ONE_SHOT_FORMULA =
  '<b>The Steel Path one-shot formula</b> — this is how meta builds delete level 200+ enemies:' +
  '<p><b>1. Hunter Munitions is the engine.</b> It gives your crits a 30% chance to inflict a ' +
  'Slash proc worth 35% of the hit. Slash <i>bleed</i> procs ignore armor entirely and scale with ' +
  'how hard you hit — so big crit + slash = enemy melts regardless of armor.</p>' +
  '<p><b>2. Viral multiplies it.</b> 10 stacks of Viral = +325% damage to enemy health (a 4.25x multiplier). That\'s why ' +
  'every one-shot build runs Toxin + Cold 60/60 mods (Viral). The slash procs hit the ' +
  'viral-weakened health pool.</p>' +
  '<p><b>3. Strip armor anyway.</b> Even with slash, less armor = faster kills. Corrosive Projection ' +
  'aura (-18% armor, stacks with your squad), Unairu\'s Caustic Strike, Terrify (up to 80% armor strip), ' +
  'or Pillage.</p>' +
  '<p><b>4. Stack crit.</b> Point Strike / Critical Delay + Vital Sense (or Primed versions). ' +
  'Critical Delay\'s fire-rate penalty barely matters on slow heavy-hitters like the Kuva Zarr.</p>' +
  '<p><b>5. Faction damage last.</b> Primed Bane mods (+55% damage vs a faction) are the biggest ' +
  'single-slot multiplier in Steel Path. Swap per mission: Grineer / Corpus / Infested / Murmur.</p>' +
  '<p><b>6. Galvanized on kill.</b> Galvanized Chamber / Shot / Hell stack damage as you kill — ' +
  'in Steel Path you\'re always killing, so they\'re always stacked.</p>' +
  '<p class="muted small">Formula: big crit → Hunter Munitions slash → viral-weakened health → dead enemy. ' +
  'Everything below follows this.</p>';

/* Curated riven-less 8-mod templates. Each pick has a WHY. */
var ONE_SHOT_TEMPLATES = {
  'kuva zarr': {
    title: 'Kuva Zarr — Steel Path one-shot (Cannon mode)',
    picks: [
      ['Serration', 'WHY: Base damage. Every gun build starts here — it multiplies everything else.'],
      ['Galvanized Chamber', 'WHY: Multishot that stacks MORE multishot on kill. In Steel Path you\'re always killing, so it\'s always stacked.'],
      ['Critical Delay', 'WHY: Huge crit chance for cheap. The fire-rate penalty barely matters on the Zarr\'s slow cannon shots.'],
      ['Vital Sense', 'WHY: Crit damage multiplier — cashes in on all that crit chance from Critical Delay.'],
      ['Hunter Munitions', 'WHY: THE one-shot engine. Your crits inflict armor-ignoring Slash bleeds that scale with the hit.'],
      ['Infected Clip', 'WHY: Toxin damage — half of the Viral combo.'],
      ['Cryo Rounds', 'WHY: Cold damage — Toxin + Cold = Viral, which multiplies damage to enemy health by up to +325% at 10 stacks.'],
      ['Primed Bane Of Grineer', 'WHY: +55% faction damage — the biggest single-slot Steel Path multiplier. Swap per mission (Corpus/Infested/Murmur).']
    ],
    notes: 'On your Warframe, run Corrosive Projection as your aura for -18% enemy armor. Cannon mode one-shots crowds; Barrage mode for single targets.'
  },
  'phenmor': {
    title: 'Phenmor — Steel Path one-shot (Incarnon)',
    picks: [
      ['Serration', 'WHY: Base damage foundation — multiplies the Incarnon form\'s already huge damage.'],
      ['Galvanized Chamber', 'WHY: Multishot stacking on kill. Charge the Incarnon with headshots, then delete rooms.'],
      ['Critical Delay', 'WHY: Massive crit chance. The fire-rate hit doesn\'t matter when every shot one-taps.'],
      ['Vital Sense', 'WHY: Crit damage to convert those crits into room-clearing hits.'],
      ['Hunter Munitions', 'WHY: Slash procs from crits bypass armor — the core one-shot mechanic.'],
      ['Malignant Force', 'WHY: Toxin 60/60 — Viral combo piece that also adds status chance.'],
      ['Rime Rounds', 'WHY: Cold 60/60 — completes Viral with Malignant Force.'],
      ['Primed Bane Of Grineer', 'WHY: +55% faction damage. Swap per faction for maximum overkill.']
    ],
    notes: 'Phenmor\'s Incarnon mode has innate punch-through — line up headshots to charge it, then sweep crowds. Devouring Attrition (Incarnon perk) adds even more damage.'
  },
  'laetum': {
    title: 'Laetum — Steel Path one-shot (Incarnon pistol)',
    picks: [
      ['Hornet Strike', 'WHY: Base damage — the pistol equivalent of Serration.'],
      ['Galvanized Shot', 'WHY: On-kill stacking damage AND status chance. Laetum kills constantly, so it stays maxed.'],
      ['Primed Pistol Gambit', 'WHY: Crit chance — feeds the Incarnon form\'s devastating headshots.'],
      ['Primed Target Cracker', 'WHY: Crit damage multiplier for those Incarnon headshots.'],
      ['Pistol Pestilence', 'WHY: Toxin 60/60 — Viral combo starter.'],
      ['Frostbite', 'WHY: Cold 60/60 — completes Viral.'],
      ['Lethal Torrent', 'WHY: Fire rate + multishot — charges Incarnon faster and sprays more death.'],
      ['Primed Bane Of Grineer', 'WHY: +55% faction damage. Swap per mission.']
    ],
    notes: 'Laetum\'s Incarnon form fires a devastating void beam on headshot kills — aim for heads to keep it rolling. One of the strongest secondaries in the game.'
  },
  'tenet arca plasmor': {
    title: 'Tenet Arca Plasmor — Steel Path one-shot',
    picks: [
      ['Primed Point Blank', 'WHY: Shotgun base damage — the foundation.'],
      ['Galvanized Hell', 'WHY: Multishot that stacks on kill. The Plasmor\'s wide projectile loves multishot.'],
      ['Primed Ravage', 'WHY: Shotgun crit damage — the Plasmor has solid crit stats to exploit.'],
      ['Blunderbuss', 'WHY: Crit chance — pairs with Primed Ravage.'],
      ['Chilling Reload', 'WHY: Cold damage + faster reloads — the Viral combo piece (with Toxic Barrage) that also smooths the downtime.'],
      ['Toxic Barrage', 'WHY: Toxin 60/60 — completes Viral with Chilling Reload.'],
      ['Hunter Munitions', 'WHY: Slash procs from the Plasmor\'s crits melt armored targets.'],
      ['Primed Bane Of Grineer', 'WHY: +55% faction damage. Swap per mission.']
    ],
    notes: 'Get the 60% Magnetic progenitor bonus when you valence-fuse it — Magnetic + Viral covers almost everything. The radial projectile clears crowds in one trigger pull.'
  },
  'nataruk': {
    title: 'Nataruk — Steel Path one-shot (bow)',
    picks: [
      ['Serration', 'WHY: Base damage — multiplies the Nataruk\'s perfect shots.'],
      ['Galvanized Chamber', 'WHY: Multishot stacking on kill — more arrows per shot.'],
      ['Point Strike', 'WHY: Crit chance — the Nataruk\'s charged shots crit hard.'],
      ['Vital Sense', 'WHY: Crit damage to maximize those charged headshots.'],
      ['Hunter Munitions', 'WHY: Slash procs on crit — charged shots inflict brutal bleeds.'],
      ['Infected Clip', 'WHY: Toxin — Viral combo half.'],
      ['Cryo Rounds', 'WHY: Cold — completes Viral for up to +325% damage to health at 10 stacks.'],
      ['Primed Bane Of Grineer', 'WHY: +55% faction damage. Swap per mission.']
    ],
    notes: 'The Nataruk\'s perfect-release mechanic (release at the chime) gives bonus crit — learn the timing and everything dies. Silent, so great for stealth Steel Path.'
  },
  'felarx': {
    title: 'Felarx — Steel Path one-shot (Incarnon shotgun)',
    picks: [
      ['Primed Point Blank', 'WHY: Shotgun base damage foundation.'],
      ['Galvanized Hell', 'WHY: Multishot stacking on kill — the Felarx devours crowds.'],
      ['Primed Ravage', 'WHY: Crit damage — the Incarnon form crits relentlessly.'],
      ['Blunderbuss', 'WHY: Crit chance to feed Primed Ravage.'],
      ['Chilling Reload', 'WHY: Cold damage + faster reloads — Viral combo piece.'],
      ['Toxic Barrage', 'WHY: Toxin 60/60 — completes Viral.'],
      ['Hunter Munitions', 'WHY: Slash procs from crits — armor becomes irrelevant.'],
      ['Primed Bane Of Grineer', 'WHY: +55% faction damage. Swap per mission.']
    ],
    notes: 'Felarx\'s Incarnon form fires homing projectiles that devastate crowds. One of the highest-DPS shotguns in the game when built for crit + viral + slash.'
  }
};

var PRIMER_KNOWLEDGE =
  '<b>Primers — the secret to faster one-shots</b>' +
  '<p>A primer is a weapon (or companion) whose only job is to stack status effects on enemies ' +
  'so your main weapon\'s Condition Overload / slash procs hit harder. You spray the primer, swap to your killer.</p>' +
  '<p><b>Kuva Nukor (the classic primer):</b> Microwave beam with insane status chance that chains between enemies. ' +
  'Build: Lethal Torrent + Barrel Diffusion (multishot/status), Pistol Pestilence + Frostbite (Viral), Jolt + Scorch (more status). ' +
  'Get a Magnetic or Heat progenitor. Spray a crowd → swap to your main gun → everything dies faster.</p>' +
  '<p><b>Epitaph (AoE primer):</b> Charged shots explode in a status-spreading blast. Build for Viral + Heat with high status chance. ' +
  'One charged shot primes a whole room.</p>' +
  '<p><b>Verglas Prime + Manifold Bond (companion primer):</b> Give Nautilus the Verglas Prime (cold beam sentinel weapon) ' +
  'and the Manifold Bond mod — every status your sentinel inflicts boosts YOUR weapon\'s status application. ' +
  'It primes enemies with Cold while you focus on killing. Nautilus\'s Cordon ability also groups enemies for your AoE.</p>' +
  '<p class="muted small">Primer + Condition Overload melee is one of the strongest Steel Path combos in the game.</p>';

var SHARD_KNOWLEDGE =
  '<b>Archon Shards for one-shot builds</b>' +
  '<p><b>Crimson shards:</b> +Ability Strength — for frames whose abilities do the killing (Saryn, Volt, Rhino Roar). ' +
  'Or +Melee Crit Chance if you\'re on a melee one-shot build.</p>' +
  '<p><b>Amber shards:</b> +Casting Speed — faster Roar/Eclipse/Terrify casts keep your damage buffs rolling. ' +
  '+Max Energy on spawn is the lazy alternative.</p>' +
  '<p><b>Azure shards:</b> +Armor or +Health — survivability so you live long enough to one-shot. ' +
  '+Max Energy if your build is energy-hungry.</p>' +
  '<p><b>Violet shards:</b> +Crit Damage after a crit — pure damage for crit-based one-shot weapons.</p>' +
  '<p><b>Emerald shards:</b> +Toxin damage when you inflict status — feeds the Viral + Hunter Munitions loop.</p>' +
  '<p class="muted small">Tauforged (from Archon Hunts) give 1.5x the bonus — always use Tauforged when you have them.</p>';

var ENABLER_KNOWLEDGE =
  '<b>Warframes that enable one-shots</b>' +
  '<p><b>Rhino — Roar:</b> +damage buff (multiplicative, works like faction damage). Subsumed onto any frame via the Helminth. ' +
  'The universal damage button.</p>' +
  '<p><b>Mirage — Eclipse:</b> Up to +200% damage in light. Pair with a bright energy color and stand in the light — ' +
  'your weapons hit like trucks.</p>' +
  '<p><b>Chroma — Vex Armor:</b> Take damage → +damage and +armor. Fury (damage) scales the more you get hit. ' +
  'Classic Eidolon hunter frame.</p>' +
  '<p><b>Volt — Shock Trooper:</b> Adds Electric damage to weapons (Eidolon meta) and Speed for fire rate. ' +
  'His shields also add Crit Damage to shots fired through them.</p>' +
  '<p><b>Saryn — Toxic Lash:</b> Adds Toxin damage to every weapon hit — feeds Viral combos and pops spores that spread.</p>' +
  '<p><b>Octavia — Amp:</b> Standing in her Amp zone multiplies weapon damage. Drop it, stand in it, delete.</p>' +
  '<p><b>Xaku — Deny:</b> Armor strip + the Vast Untime that freezes enemies. Armor-stripped + frozen = free one-shots.</p>' +
  '<p class="muted small">Pro move: subsume Roar (Rhino) or Eclipse (Mirage) onto your main frame via the Helminth for damage on any kit.</p>';


/* ===== v2.12.68: STEEL PATH GENERAL BUILD KNOWLEDGE =====
   Answers "build me a general steel path strong build that does lots of
   damage plus arcanes, auras, exilus" — the full modding doctrine with
   verified values, plus 4 concrete curated frame builds. */

var STEEL_PATH_GENERAL =
  '<b>Steel Path builds — the general formula</b>' +
  '<p>Steel Path enemies have massively scaled health and armor, so builds that slap on the normal star chart fall off. Everything that works here follows the same layers:</p>' +
  '<p><b>1. Base damage first.</b> Serration / Hornet Strike / Point Blank / Pressure Point — the foundation every gun and melee build starts on.</p>' +
  '<p><b>2. Crit.</b> Point Strike + Vital Sense (or Primed versions). Crits are the delivery system for the real damage.</p>' +
  '<p><b>3. Hunter Munitions.</b> Crits inflict armor-ignoring Slash bleeds — the core Steel Path damage engine. Ask <i>"one-shot formula"</i> for the full theory.</p>' +
  '<p><b>4. Viral.</b> Toxin + Cold 60/60 mods — Viral multiplies damage to enemy health.</p>' +
  '<p><b>5. Faction damage.</b> Primed Bane mods (+55% vs a faction) are the biggest single-slot Steel Path multiplier. Swap per mission: Grineer / Corpus / Infested / Murmur.</p>' +
  '<p><b>6. Galvanized on kill.</b> Galvanized Chamber / Shot / Hell stack damage as you kill — in Steel Path you\'re always killing, so they\'re always stacked.</p>' +
  '<p><b>WEAPON ARCANES</b> <span class="muted small">(farm: Steel Path Acolytes)</span></p>' +
  '<p><b>Primary Merciless</b> — on kill: +30% damage for 4s, stacking 12x to <b>+360%</b> at max rank, plus +30% reload speed. The default pick for most primaries.</p>' +
  '<p><b>Primary Deadhead</b> — on headshot kill: +120% damage for 24s, stacking 3x to <b>+360%</b> at max rank, plus +30% weak-point damage and -50% recoil. Better for precision and headshot weapons; the long 24s duration is very forgiving.</p>' +
  '<p><b>AURA SLOT — pick per mission</b></p>' +
  '<p><b>Corrosive Projection</b> — enemies lose <b>18%</b> armor at max rank, stacking with your squad. The default Steel Path aura.</p>' +
  '<p><b>Growing Power</b> — <b>+25%</b> Ability Strength for 6s when your weapons proc status. For ability-damage frames.</p>' +
  '<p><b>Rifle Amp</b> — <b>+27%</b> rifle damage for the squad. It\'s additive with Serration, so the real gain is smaller than it looks — Corrosive Projection usually wins against armor.</p>' +
  '<p><b>Steel Charge</b> — <b>+60%</b> melee damage for the squad. For melee builds (also gives the most mod capacity of any aura).</p>' +
  '<p><b>Brief Respite</b> — converts <b>150%</b> of energy spent on casts into shields at max rank (can overshield). For shield-gating builds.</p>' +
  '<p><b>Energy Siphon</b> — <b>+0.6</b> energy regen/s for the squad. For energy-hungry frames.</p>' +
  '<p><b>EXILUS SLOT</b></p>' +
  '<p><b>Primed Sure Footed</b> — <b>100%</b> knockdown resistance at max rank. Knockdowns get you killed in Steel Path; this ends them.</p>' +
  '<p><b>Power Drift</b> — <b>+15%</b> Ability Strength and 30% knockdown resistance. The budget damage option.</p>' +
  '<p><b>Cunning Drift</b> — <b>+15%</b> Ability Range plus slide. For nuke and range frames.</p>' +
  '<p><b>FRAME ARCANES</b></p>' +
  '<p><b>Molt Augmented</b> — <b>+60%</b> Ability Strength at 250 kills (Zariman / Thrax farm). The default for almost every frame.</p>' +
  '<p><b>Arcane Energize</b> — 60% chance for <b>+150</b> energy (you + allies) on energy orb pickup, 15s cooldown. Fixes energy-hungry builds.</p>' +
  '<p><b>Arcane Grace</b> — 9% chance on health damage: <b>+6%</b> health regen/s for 9s. For health tanks.</p>' +
  '<p><b>Arcane Guardian</b> — 15% chance on damage: <b>+900</b> armor for 20s. For armor frames.</p>' +
  '<p><b>SURVIVAL</b> — Adaptation (up to 90% damage resistance) + Rolling Guard (brief invulnerability on dodge) is the standard Steel Path survival package. Shield-gating matters more than raw health at high levels.</p>' +
  '<p class="muted small">Want a concrete build? Ask <i>"saryn steel path build"</i>, <i>"rhino steel path build"</i>, <i>"revenant steel path build"</i>, or <i>"nova steel path build"</i> — full 8 mods plus aura, exilus, and arcanes.</p>' +
  '<p><a href="builds.html">Curated build library &rarr;</a></p>';

/* Curated riven-less Steel Path frame builds: 8 mods + aura + exilus + arcanes.
   Keyed by base frame name (no "prime"). */
var SP_FRAME_TEMPLATES = {
  'saryn': {
    title: 'Saryn — Steel Path nuke',
    aura: 'Corrosive Projection — enemies lose 18% armor. Saryn has no innate armor strip, so the aura does that job.',
    exilus: 'Cunning Drift — +15% Ability Range. Bigger spore spread, bigger Miasma.',
    picks: [
      ['Blind Rage', 'WHY: +99% Ability Strength. Spore ticks and Miasma scale directly with strength — this is the biggest one.'],
      ['Transient Fortitude', 'WHY: +55% strength. More nuke damage; the duration hit is covered below.'],
      ['Umbral Intensify', 'WHY: +44% strength with no downside. Stacks with the set bonus if you run other Umbrals.'],
      ['Primed Continuity', 'WHY: +55% duration. Spores tick longer, so they spread further before falling off.'],
      ['Stretch', 'WHY: +45% range. Spores jump to more enemies, Miasma covers the room.'],
      ['Vitality', 'WHY: +440% health. You need a real health pool for the moments between casts.'],
      ['Adaptation', 'WHY: Up to 90% damage resistance that stacks as you take hits — the Steel Path survival standard.'],
      ['Rolling Guard', 'WHY: Brief invulnerability on dodge. Dodges one-shots and refreshes your shield gate.']
    ],
    arcanes: 'Molt Augmented (+60% strength at 250 kills) + Arcane Energize (60% chance for +150 energy on orb pickup — you cast constantly).',
    play: 'Cast Spores on an enemy, then pop them with Toxic Lash-buffed weapon kills to spread the infection. Once the room is seeded, Miasma detonates everything. Keep moving — you are tanky, not immortal.'
  },
  'rhino': {
    title: 'Rhino — Steel Path weapon buffer (Roar)',
    aura: 'Corrosive Projection — enemies lose 18% armor. Rhino has no armor strip of his own, so the aura covers it.',
    exilus: 'Power Drift — +15% strength for a bigger Roar and a tougher Iron Skin.',
    picks: [
      ['Blind Rage', 'WHY: +99% Ability Strength. Bigger Roar buff, tougher Iron Skin.'],
      ['Transient Fortitude', 'WHY: +55% strength. Roar is the whole point of this build — feed it.'],
      ['Umbral Intensify', 'WHY: +44% strength, no downside.'],
      ['Augur Secrets', 'WHY: +24% strength plus shield-gate synergy from the Augur set.'],
      ['Primed Continuity', 'WHY: +55% duration. Longer Roar uptime, longer Iron Skin.'],
      ['Stretch', 'WHY: +45% range. Roar reaches the whole squad, Stomp covers more ground.'],
      ['Vitality', 'WHY: +440% health. Backup for when Iron Skin is down.'],
      ['Adaptation', 'WHY: Up to 90% damage resistance — keeps you alive while you reposition.']
    ],
    arcanes: 'Molt Augmented (+60% strength at 250 kills) + Arcane Energize (Roar is hungry — this keeps it fed).',
    play: 'Iron Skin up, Roar up, then your weapons do the talking — Roar is a multiplicative damage buff for the whole squad. Stomp for breathing room. Recast Roar the moment it drops; never let the buff lapse mid-fight.'
  },
  'revenant': {
    title: 'Revenant — Steel Path endurance (Mesmer Skin)',
    aura: 'Brief Respite — converts 150% of energy spent into shields at max rank. You cast constantly, so your shield gate stays fed.',
    exilus: 'Cunning Drift — +15% Ability Range for Reave and Danse Macabre.',
    picks: [
      ['Blind Rage', 'WHY: +99% Ability Strength. Mesmer Skin charges and Reave damage both scale with strength.'],
      ['Transient Fortitude', 'WHY: +55% strength. More charges, harder Reave.'],
      ['Umbral Intensify', 'WHY: +44% strength, no downside.'],
      ['Primed Continuity', 'WHY: +55% duration. Mesmer Skin stays up longer between recasts.'],
      ['Narrow Minded', 'WHY: +99% duration for -66% range. Mesmer Skin is self-cast, so the range hit barely matters.'],
      ['Streamline', 'WHY: Ability efficiency. Recasting Mesmer Skin stays cheap.'],
      ['Vitality', 'WHY: +440% health. For the rare hit that gets through.'],
      ['Rolling Guard', 'WHY: Brief invulnerability on dodge — your panic button while recasting.']
    ],
    arcanes: 'Molt Augmented (+60% strength at 250 kills) + Arcane Energize (keeps the casts flowing).',
    play: 'Mesmer Skin on — every charge stuns whatever hits you. Reave through packs to drain them while invulnerable. Recast Mesmer Skin BEFORE the charges run out; while it is up you are nearly unkillable.'
  },
  'nova': {
    title: 'Nova — Steel Path nuke / control (Molecular Prime)',
    aura: 'Corrosive Projection — enemies lose 18% armor. Molecular Prime already doubles their damage taken; the aura stacks on top.',
    exilus: 'Cunning Drift — +15% Ability Range for a bigger Prime wave.',
    picks: [
      ['Blind Rage', 'WHY: +99% Ability Strength. Bigger Molecular Prime explosions.'],
      ['Transient Fortitude', 'WHY: +55% strength. More boom per primed enemy.'],
      ['Umbral Intensify', 'WHY: +44% strength, no downside.'],
      ['Primed Continuity', 'WHY: +55% duration. Longer slow on Slowva.'],
      ['Narrow Minded', 'WHY: +99% duration for -66% range. Duration is what extends the slow.'],
      ['Stretch', 'WHY: +45% range. Claws back the range Narrow Minded takes.'],
      ['Vitality', 'WHY: +440% health. Nova is fragile — this is mandatory.'],
      ['Rolling Guard', 'WHY: Brief invulnerability on dodge. Your escape button.']
    ],
    arcanes: 'Molt Augmented (+60% strength at 250 kills) + Arcane Energize (Prime every room without thinking about energy).',
    play: 'Cast Molecular Prime — primed enemies take double damage and explode on death, chaining the wave through the room. High duration = Slowva for control. Swap Narrow Minded for Overextended and you get Speedva, which hurries defense and excavation missions.'
  }
};

function spFrameBuildAnswer(key) {
  var t = SP_FRAME_TEMPLATES[key];
  if (!t) return null;
  /* v2.19.5: validate-on-serve — every pick must be a real mod, the aura a real aura */
  for (var vi = 0; vi < t.picks.length; vi++) { if (!findModExact(t.picks[vi][0])) return null; }
  if (t.aura && !isAuraMod(t.aura.split(' — ')[0])) return null;
  if (t.exilus && !findModExact(t.exilus.split(' — ')[0])) return null;
  var rows = t.picks.map(function (p, i) {
    var m = findModExact(p[0]);
    var farm = m ? modFarmLine(m) : '';
    return '<div class="mod-row"><div><b>' + (i + 1) + '. ' + esc(p[0]) + '</b>' +
      '<div class="muted small">' + esc(p[1]) + '</div>' + farm + '</div></div>';
  }).join('');
  var card = buildCard({
    title: t.title,
    aura: vbcCleanSlot(t.aura),
    exilus: vbcCleanSlot(t.exilus),
    mods: t.picks.map(function (p) { return p[0]; }),
    arcanes: [],
    arcanesText: t.arcanes || '',
    note: t.play || ''
  });
  var spItemName = (findByName(D.warframes, key) || {}).name || key;
  return '<b>' + esc(t.title) + '</b>' +
    '<p class="muted small">Riven-less Steel Path build — aura, exilus, and arcanes included. Every mod has a WHY.</p>' +
    card +
    rows +
    alternativesHtml(spItemName, null) +
    '<p><a href="builds.html">More builds &rarr;</a></p>';
}

function oneShotTemplateAnswer(key) {
  var t = ONE_SHOT_TEMPLATES[key];
  if (!t) return null;
  /* v2.19.5: validate-on-serve — every pick must be a real mod */
  for (var vi = 0; vi < t.picks.length; vi++) { if (!findModExact(t.picks[vi][0])) return null; }
  var rows = t.picks.map(function (p, i) {
    var m = findModExact(p[0]);
    var farm = m ? modFarmLine(m) : '';
    return '<div class="mod-row"><div><b>' + (i + 1) + '. ' + esc(p[0]) + '</b>' +
      '<div class="muted small">' + esc(p[1]) + '</div>' + farm + '</div></div>';
  }).join('');
  var card = buildCard({
    title: t.title,
    aura: '',
    exilus: '',
    mods: t.picks.map(function (p) { return p[0]; }),
    arcanes: [],
    note: t.notes || ''
  });
  var tplItemName = (findByName(D.weapons, key) || {}).name || key;
  return '<b>' + esc(t.title) + '</b><p class="muted small">Riven-less. Every mod below has a WHY — ' +
    'this is the reasoning, not just a list.</p>' + card + rows +
    alternativesHtml(tplItemName, null) +
    '<p>Want the theory behind it? Ask <i>"one-shot formula"</i>. Need a primer? Ask <i>"primer"</i>.</p>';
}

/* Curated one-shot builds live in builds.json too (tags include 'one-shot').
   If the query names an item that has one there, render it like a template —
   this keeps the AI in sync with the full build library automatically. */
function oneShotBuildAnswer(t) {
  if (!D || !D.builds) return null;
  var best = null, bestLen = 0;
  for (var i = 0; i < D.builds.length; i++) {
    var b = D.builds[i];
    if (!b || (b.tags || []).indexOf('one-shot') === -1) continue;
    if (!buildIsValid(b)) continue; /* v2.19.5: validate-on-serve */
    var iname = norm(b.item);
    if (iname && iname.length >= 4 && t.indexOf(iname) !== -1 && iname.length > bestLen) {
      best = b; bestLen = iname.length;
    }
  }
  if (!best) return null;
  var rows = best.mods.map(function (m, i) {
    var fm = findModExact(m.name);
    var farm = fm ? modFarmLine(fm) : '';
    return '<div class="mod-row"><div><b>' + (i + 1) + '. ' + esc(m.name) + '</b>' +
      (m.note ? '<div class="muted small">' + esc(m.note) + '</div>' : '') + farm + '</div></div>';
  }).join('');
  var card = buildCard({
    title: best.name || best.item,
    aura: vbcCleanSlot(best.aura),
    exilus: vbcCleanSlot(best.exilus),
    mods: (best.mods || []).map(function (m) { return m.name; }),
    arcanes: vbcArcanes(best.arcane),
    note: best.playstyle || ''
  });
  return '<b>' + esc(best.name) + '</b><p class="muted small">' + esc(best.description) +
    ' Riven-less — every mod has a WHY.</p>' + card + rows +
    alternativesHtml(best.item, best) +
    '<p>Full build also on the <a href="builds.html#build-' + esc(best.id) + '">builds page</a>. ' +
    'Want the theory? Ask <i>"one-shot formula"</i>.</p>';
}

/* ---------- v2.19.0 KNOWLEDGE BASE ----------
   Curated doctrine & guidance: modding, Rivens, Steel Path / MR explainers,
   credits & endo routes, relic farming, focus schools, amps, forma/potatoes,
   playstyle frame picks, trading basics. Checked in answer() after the build
   generator, before the generic farm intent — patterns are kept narrow so
   specific item lookups still win. */
  var KNOWLEDGE = [
    /* v2.20.0 training pass 1: entries added from the probe battery's top
       misses (tools/vaulty-probe). Facts verified against the Warframe
       Wiki — keep them evergreen (no dates, no prices). */
    {
      re: /\baya\b/,
      html: '<b>Aya</b> is the Prime Resurgence currency — you spend it at <b>Varzia</b> (Maroo\'s Bazaar, Mars) ' +
        'on Void Relics and returning Prime gear.<p><b>Best farm:</b> high-level open-world bounties — the top-tier ' +
        'bounties on the <b>Zariman</b>, with the <b>Cavia</b> (Sanctum Anatomica), <b>Hex</b> (Höllvania), Cetus, Fortuna ' +
        'and Deimos bounties close behind. <b>Void missions</b> (fast captures like Ukko and Hepit) are a steady solo alternative.</p>' +
        '<p class="muted small">Regal Aya is the paid twin — Aya itself is 100% farmable. What\'s in stock rotates with Prime Resurgence.</p>'
    },
    {
      re: /best (aura|auras)|which aura|top aura|good aura/,
      html: '<b>Aura mods</b> — the short list that matters (auras slot on your <i>Warframe</i>, never on a weapon):' +
        '<p>🛡 <b>Corrosive Projection</b> — reduces enemy armor for the whole squad; the Steel Path default.</p>' +
        '<p>💪 <b>Growing Power</b> — +Power Strength whenever you inflict a status proc; great on status-heavy frames.</p>' +
        '<p>🌀 <b>Brief Respite</b> — converts energy spent into shields; the shield-gating aura.</p>' +
        '<p>🔋 <b>Energy Siphon</b> — passive energy regen; the comfort pick for ability-hungry frames.</p>' +
        '<p>⚔️ <b>Steel Charge</b> — +melee damage and the highest capacity of any aura (polarity space for pricey builds).</p>' +
        '<p class="muted small">Match the aura\'s polarity to your frame\'s aura slot and it <i>adds</i> mod capacity instead of costing it.</p>'
    },
    {
      re: /best (starter|starting|first) (frame|warframe)|starter frame|which (frame|warframe).*(start with|beginner|first)/,
      html: '<b>Best starter frames:</b>' +
        '<p>⚔️ <b>Excalibur</b> — the starter pick for a reason: simple, strong, and his Exalted Blade carries you deep into the star chart.</p>' +
        '<p>🦏 <b>Rhino</b> — the beginner tank. Farm his parts from the <b>Jackal on Fossa, Venus</b>; Iron Skin makes early mistakes free.</p>' +
        '<p>🧲 <b>Mag</b> — squishier starter, huge payoff once you learn her bubble combos.</p>' +
        '<p>⚡ <b>Volt</b> — a starter pick too, and later his parts come from any clan dojo\'s Tenno Lab.</p>' +
        '<p class="muted small">Honest answer: pick whichever starter looks fun — Rhino is your first big upgrade either way. Ask <i>"make me a Rhino build"</i> when you have him.</p>'
    },
    {
      re: /necramech/,
      html: '<b>Necramechs</b> are the Entrati\'s Old War walking tanks — you\'ll want one before <b>The New War</b> quest, and they shine in Orphix missions where Warframes get shut down.' +
        '<p><b>How to get one:</b> go to the <b>Necralisk on Deimos</b> and rank up the <b>Necraloid</b> syndicate (talk to Loid) for the main blueprints — <b>Voidrig</b> first, <b>Bonewidow</b> second. ' +
        'The <b>Damaged Necramech parts</b> drop from enemy Necramechs in <b>Isolation Vault bounties</b> on the Cambion Drift.</p>' +
        '<p class="muted small">Build the parts in your Foundry like a Warframe, then deploy the mech from your gear wheel in open worlds and Railjack missions.</p>'
    },
    {
      re: /incarnon/,
      html: '<b>Incarnon</b> weapons evolve mid-mission: build charge (headshots and kills), then hit <b>alt-fire</b> to transform into the weapon\'s Incarnon Form — new stats, new fire mode, a few seconds of delete.' +
        '<p><b>Natural Incarnons</b> (Phenmor, Laetum, Felarx, Praedos, Innodem) come from the <b>Zariman</b> — buy their blueprints from <b>Cavalero</b> aboard the Chrysalith.</p>' +
        '<p><b>Incarnon Genesis adapters</b> graft the system onto older weapons (Braton, Lex, Latron and more): earn them in <b>The Circuit on Steel Path</b> (Duviri), then install at Cavalero with <b>Pathos Clamps</b> and Duviri resources. Each adapter unlocks a perk tree you level by using the weapon.</p>' +
        '<p class="muted small">Ask <i>"Phenmor build"</i> or <i>"Laetum build"</i> — the Vault\'s one-shot library is built around these.</p>'
    },
    {
      re: /archwing/,
      html: '<b>Archwing</b> — your flight rig for space and open-world flight.' +
        '<p><b>How to get it:</b> finish <b>The Archwing</b> quest (it unlocks early, off the Mars path) — you\'ll build the <b>Odonata</b> piece by piece during the quest itself.</p>' +
        '<p><b>Flying in open worlds</b> needs the <b>Archwing Launcher</b> in your gear wheel: the segment comes from your clan dojo\'s <b>Tenno Lab</b> (or the Market), and launchers are built in the Foundry.</p>' +
        '<p class="muted small">Favorites once you have options: <b>Amesha</b> (near-unkillable) and <b>Itzal</b> (fast, vacuum looting). Archwing levels also feed your Mastery Rank.</p>'
    },
    {
      re: /\bclan\b/,
      html: '<b>Clans</b> — joining one is close to mandatory: the clan <b>Dojo</b> is where Tenno Lab research lives (frames like <b>Volt, Wukong, Nezha and Banshee</b>, plus dozens of weapons), and it\'s a trading post too.' +
        '<p><b>To join:</b> get an invite — ask in <b>Recruiting chat</b> ("LF active clan") or accept any player\'s clan invite, then craft the <b>Clan Key</b> (blueprint from the Market, 12h build) to walk into the Dojo.</p>' +
        '<p><b>Starting your own</b> is free to create, but you fund every research project solo — most Tenno join an established clan first.</p>' +
        '<p class="muted small">Check a clan\'s research completion before joining — a finished Tenno Lab saves you weeks.</p>'
    },
    {
      re: /\brivens?\b.*\b(trade|trading|sell|buy)\b|\b(trade|trading|sell|buy)\b.*\brivens?\b/,
      html: '<b>⚠️ Riven trading is temporarily disabled in-game right now</b> — DE posted a PSA about it (Oct 20), ' +
        'so Riven mods can\'t change hands until they switch it back on. Unveiling, rolling with Kuva, and using your own ' +
        'Rivens all still work normally.<p class="muted small">When it\'s back: Rivens trade like any mod — price by weapon, ' +
        'stats and roll quality on warframe.market. See the <a href="trading.html">Trading page</a>.</p>'
    },
    {
      re: /what (is|are) (a |an )?(riven|rivens)\b|how do rivens work|riven (mod )?(basics|guide|help|explained)/,
      html: '<b>Riven mods</b> are randomized, weapon-specific mods — each one is locked to a single weapon (or weapon family) ' +
        'and rolls 2–4 random stats, sometimes with a negative.<p><b>Getting them:</b> Sortie rewards, Archon Hunts, Steel Path ' +
        'honors (Teshin sells one weekly), and Riven Slivers → trade 10 to <b>Palladino</b> at Iron Wake.</p>' +
        '<p><b>Rolling:</b> spend <b>Kuva</b> to re-roll the stats (the weapon lock never changes). A weapon\'s <b>disposition</b> ' +
        'scales how strong the numbers can roll — DE is retiring dispositions so every Riven settles at a fixed 1.2.</p>' +
        '<p class="muted small">⚠️ Right now Riven <i>trading</i> is temporarily disabled in-game (DE PSA, Oct 20) — ' +
        'you can still unveil, roll and equip your own. Deep dive on the <a href="guides.html">Guides page</a>.</p>'
    },
    {
      re: /how (do i|to|should i) mod\b|modding (guide|tips|help|basics)|why is my damage|my damage is (low|bad|weak)|how.*(increase|boost|raise) (my )?damage|damage (guide|help|tips)/,
      html: '<b>Modding doctrine — the 30-second version:</b>' +
        '<p><b>1. Multiply, don\'t stack.</b> Damage comes from different buckets multiplying together: base damage ' +
        '(Serration/Hornet Strike) × multishot × crit × elemental × faction (Bane) mods. Two mods from different buckets ' +
        'beat three from the same one.</p>' +
        '<p><b>2. Capacity first.</b> Orokin Catalyst/Reactor doubles mod capacity; <b>Forma</b> halves a slot\'s cost. ' +
        'Match slot polarities to your expensive mods.</p>' +
        '<p><b>3. Elements matter.</b> Viral (cold + toxin) is the default — it amplifies health damage. Corrosive for armor, ' +
        'Magnetic for shields/Overguard.</p>' +
        '<p><b>4. Rank your mods.</b> One rank-8 Serration beats three unranked mods. Spend Endo on the core set first.</p>' +
        '<p class="muted small">Want it applied? Ask <i>"make me a [weapon] build"</i> and I\'ll slot a full loadout with a reason for every mod. Full doctrine on the <a href="index.html">homepage modding section</a> and <a href="damage.html">Damage page</a>.</p>'
    },
    {
      re: /what is (the )?steel path|how.*(unlock|start|get into).*steel path|steel path.*(unlock|start)/,
      html: '<b>Steel Path</b> is Warframe\'s hard mode: the whole star chart again at +100 enemy levels with boosted ' +
        'health, armor and shields.<p><b>Unlock:</b> complete every node on the normal star chart, then talk to <b>Teshin</b> ' +
        'in any Relay.</p><p><b>Why bother:</b> Steel Essence (buys Arcane Adapters, Umbra Forma, Kuva), Acolytes that drop ' +
        'the Merciless/Deadhead/Dexterity weapon arcanes, and much better resource rates.</p>' +
        '<p class="muted small">Bring a real build — ask <i>"make me a [frame] Steel Path build"</i> when you\'re ready.</p>'
    },
    {
      re: /mastery rank|how.*(raise|increase|level up).*(\bmr\b|mastery)|\bwhat is mr\b|rank up (fast|quick)/,
      html: '<b>Mastery Rank (MR)</b> rises by leveling <i>new</i> gear — every Warframe, weapon, companion and Archwing ' +
        'grants Mastery the first time you rank it to 30 (6,000 per frame, 3,000 per weapon). Re-leveling the same item gives nothing new.' +
        '<p><b>Fastest route:</b> keep a constant rotation of fresh gear leveling while you clear the star chart and do quests. ' +
        'Leveling spots: <b>Hydron (Sedna)</b>, <b>Helene (Saturn)</b>, or <b>Sanctuary Onslaught</b>.</p>' +
        '<p><b>Why it matters:</b> MR gates weapons, Rivens, daily standing caps and your daily trade count (trades/day = MR).</p>' +
        '<p class="muted small">When your bar fills, take the rank-up test at a Relay (Cephalon Simaris\' room) — you can practice it first, and a failed test just means a 24h retry wait.</p>'
    },
    {
      re: /credits?/,
      test: /(farm|make|earn|get|best|fast|grind|need)/,
      html: '<b>Credits — best routes:</b>' +
        '<p>🏦 <b>The Index (Neptune, High Risk)</b> — the credit king. Solo or squad, ~250k per run, doubled during credit-booster weekends.</p>' +
        '<p>🕷 <b>Profit-Taker bounties (Fortuna)</b> — ~125k per kill plus toroids to sell for standing.</p>' +
        '<p>🌑 <b>Dark Sector missions</b> (e.g. Seimeni, Ceres) — solid early-game credits, leave after the first rotation.</p>' +
        '<p class="muted small">First mission of the day pays double credits — make it a good one. Full table on the <a href="farming.html">Farming Hub</a>.</p>'
    },
    {
      re: /\bendo\b/,
      html: '<b>Endo — best routes:</b>' +
        '<p>⚖️ <b>Arbitrations</b> — the best repeatable source: Endo drops plus Ayatan Sculptures you can dissolve.</p>' +
        '<p>🏟 <b>Vodyanoi / Yam (Sedna, Rathuum arena)</b> on Steel Path with a Nekros/Khora squad — the classic Endo-per-hour farm.</p>' +
        '<p>🗿 <b>Maroo\'s weekly Ayatan hunt</b> (Maroo\'s Bazaar, Mars) — one guaranteed sculpture a week; fill it with Amber/Cyan stars before dissolving.</p>' +
        '<p class="muted small">Also: dissolve duplicate mods you\'ll never use — most players sit on thousands of Endo without knowing. Full table on the <a href="farming.html">Farming Hub</a>.</p>'
    },
    {
      re: /\b(farm|farming|get|grind|best)\b.{0,30}\brelics\b|\brelic (farm|farming|spots?)\b/,
      html: '<b>Farming Void Relics by tier:</b>' +
        '<p><b>Lith</b> — Hepit (Void, Capture): ~1 minute per relic.<br>' +
        '<b>Meso</b> — Ukko (Void, Capture) for Meso+Neo, or Io (Jupiter, Defense).<br>' +
        '<b>Neo</b> — Ukko (Void, Capture); Xini (Eris, Interception) for Neo+Axi.<br>' +
        '<b>Axi</b> — Apollo (Lua, Disruption) is the community favorite; Xini works too.</p>' +
        '<p class="muted small">Then crack them in Void Fissures — ask me <i>"active fissures"</i> for what\'s live right now. Which relics hold which parts: <a href="relics.html">Relics page</a>.</p>'
    },
    {
      re: /focus school|which focus|best focus|\b(zenurik|madurai|naramon|unairu|vazarin)\b/,
      html: '<b>Focus schools — which one?</b>' +
        '<p>⚡ <b>Zenurik</b> — the default pick: energy regeneration for you and the squad. Most players live here.</p>' +
        '<p>🔥 <b>Madurai</b> — damage: amp damage for Eidolons/operators and a weapon damage buff after Void Sling. The one-shot school.</p>' +
        '<p>🗡 <b>Naramon</b> — melee: combo decay instead of full loss, combo-count tricks.</p>' +
        '<p>🛡 <b>Unairu</b> — armor/shield strip on demand (Caustic Strike / Magnetic Flare) — a Steel Path problem-solver.</p>' +
        '<p>💚 <b>Vazarin</b> — support: instant revives and protective healing.</p>' +
        '<p class="muted small">Farm Focus with lenses on your gear in Elite Sanctuary Onslaught, or convert Eidolon Shards past the daily cap. You can switch schools freely once unlocked — max Zenurik first if unsure.</p>'
    },
    {
      re: /best amp|which amp|amp (build|setup|guide)|\b777\b.*amp|amp.*\b777\b/,
      html: '<b>The meta amp is the "777"</b> — <b>Klamora</b> prism (wide flamethrower beam) + <b>Phahd</b> scaffold ' +
        '(bouncing glaive) + <b>Certus</b> brace (crit). Parts come from the <b>Quills</b> (Cetus) and <b>Vox Solaris</b> ' +
        '(Fortuna) — you\'ll need rank with both.<p><b>Arcanes:</b> Virtuos Strike (Quills) + Eternal Eradicate (Zariman). ' +
        'Pair with <b>Madurai</b> focus for the amp damage buffs.</p>' +
        '<p class="muted small">Full amp part list on the <a href="amps.html">Amps page</a>.</p>'
    },
    {
      re: /what is (a |an )?(orokin )?(catalyst|reactor|potato)|how.*(get|farm|find).*(catalyst|reactor|potato)|\bpotato(es)?\b.*(get|farm|find|work)|orokin (catalyst|reactor)/,
      html: '<b>"Potatoes"</b> — <b>Orokin Reactor</b> (Warframes/companions) and <b>Orokin Catalyst</b> (weapons) — ' +
        'double a item\'s mod capacity 30 → 60 (or 40 → 80 for aura frames/Kuva gear). The single biggest power jump a new item can get.' +
        '<p><b>Free sources:</b> Nightwave credit offerings (150 Cred each — the main route), Sortie rewards, Invasion battle-pay, ' +
        'Gift of the Lotus alerts after Devstreams, and occasional events.</p>' +
        '<p class="muted small">Or 20p each in the Market — but spend Nightwave Cred first. Never put one on gear you\'ll throw away tomorrow.</p>'
    },
    {
      re: /what is (a |an )?forma|how.*(get|farm|make|build).*forma|forma.*(drop|farm|get)/,
      html: '<b>Forma</b> changes a mod slot\'s polarity so matching mods cost half — that\'s how endgame builds fit. ' +
        'Using one resets the item to rank 0; re-level it and the polarity stays.' +
        '<p><b>Getting Forma:</b> the <b>Forma Blueprint</b> drops from many <b>Void Relics</b> (a common reward — crack relics and you\'ll swim in them), ' +
        'the Lua music-room puzzle, and Plague Star when it runs. Crafting takes 23 hours, so keep one cooking in the Foundry at all times.</p>' +
        '<p class="muted small">Built Forma also show up in Nightwave and market bundles — the blueprint route is free. See <a href="relics.html">Relics</a> for which ones drop it.</p>'
    },
    {
      re: /how (do|does) (i |you )?trad|how trading works|trading (basics|guide|help)|where do i trade|trade with (other )?players/,
      html: '<b>Trading basics:</b>' +
        '<p><b>Requirements:</b> Mastery Rank 2+, two-factor authentication enabled on your account, and enough credits for the trade tax.</p>' +
        '<p><b>Where:</b> a clan <b>dojo trading post</b> (best) or <b>Maroo\'s Bazaar</b> (Mars). One of you invites, the other accepts, both pick items, both confirm twice.</p>' +
        '<p><b>Limits:</b> trades per day = your MR. Prime parts, mods, arcanes and some special items are tradable; built gear and resources are not.</p>' +
        '<p><b>Prices:</b> check <b>warframe.market</b> before you buy or sell — never accept a "trust me" price.</p>' +
        '<p class="muted small">⚠️ Riven trading is temporarily disabled in-game right now (DE PSA, Oct 20). Full guide: <a href="trading.html">Trading page</a>.</p>'
    },
    {
      re: /(best|good|top|strongest).{0,14}(tank|tanky) frame|frame.{0,10}(tank|unkillable|never dies)|hardest frame to kill/,
      html: '<b>Tank frames — pick your flavor:</b>' +
        '<p>🦏 <b>Rhino</b> — Iron Skin + Roar: tank AND team damage buff. The beginner-proof pick.</p>' +
        '<p>👑 <b>Revenant</b> — Mesmer Skin makes him functionally immortal; the lazy Steel Path tank.</p>' +
        '<p>🌀 <b>Nezha</b> — Warding Halo + speed + crowd control, the fun tank.</p>' +
        '<p>🐒 <b>Wukong</b> — a clone, three extra lives, and a cloud to escape in.</p>' +
        '<p class="muted small">Ask <i>"revenant steel path build"</i> or <i>"rhino steel path build"</i> for full loadouts.</p>'
    },
    {
      re: /(best|good|top).{0,14}support frame|frame.{0,10}support|best healer/,
      html: '<b>Support frames:</b>' +
        '<p>🌸 <b>Wisp</b> — health/speed/fire-rate motes; the squad never wants her to leave.</p>' +
        '<p>📖 <b>Dante</b> — team Overguard + book nukes; support that also deletes rooms.</p>' +
        '<p>🍋 <b>Citrine</b> — health/energy orb economy + status priming for the whole team.</p>' +
        '<p>✝️ <b>Trinity</b> — the classic: instant energy and heals, still great for bosses.</p>' +
        '<p class="muted small">Tell me a frame name + <i>"build"</i> and I\'ll slot a full support loadout.</p>'
    },
    {
      re: /fastest frame|best.{0,10}speed frame|frame.{0,10}(fast|speed runs?)/,
      html: '<b>Speed frames:</b>' +
        '<p>💨 <b>Gauss</b> — Mach Rush; literally built to be the fastest thing in the game.</p>' +
        '<p>⚡ <b>Volt</b> — Speed buffs the whole squad (and his shield carries guns too).</p>' +
        '<p>🦋 <b>Titania</b> — Razorwing flight: fastest across open worlds and big tilesets.</p>' +
        '<p>🏎 <b>Wukong</b> — Cloud Walker zooms and ignores lasers/traps.</p>' +
        '<p class="muted small">For Capture/Rescue farming it\'s Titania or Wukong; for style points, Gauss.</p>'
    },
    {
      re: /(best|good).{0,12}spy frame|frame.{0,12}spy|spy missions?.{0,14}(frame|easy|best)/,
      html: '<b>Spy frames:</b>' +
        '<p>🍄 <b>Ivara</b> — permanent invisibility + Infiltrate augment walks through lasers. Spy on easy mode.</p>' +
        '<p>🎭 <b>Loki</b> — long invisibility and decoys; the classic.</p>' +
        '<p>🐒 <b>Wukong</b> — Cloud Walker flies over everything and ignores alarms\' lasers.</p>' +
        '<p>🚪 <b>Limbo</b> — the Rift ignores lasers (but not cameras).</p>' +
        '<p class="muted small">Pro tip: Spy rewards come from getting all 3 vaults — bring ciphers for emergencies, not as the plan.</p>'
    },
    {
      re: /which frame should i|what frame should i|frame should i (get|pick|use|build|farm|main)/,
      html: 'Depends on your flavor — here\'s the cheat sheet:' +
        '<p>🛡 <b>Survive anything:</b> Revenant, Rhino<br>' +
        '💥 <b>Delete rooms:</b> Saryn, Mesa, Octavia<br>' +
        '🌾 <b>Farm loot:</b> Nekros, Khora, Hydroid (extra loot rolls)<br>' +
        '🏃 <b>Go fast:</b> Gauss, Volt, Titania<br>' +
        '🤝 <b>Support the squad:</b> Wisp, Dante, Citrine<br>' +
        '🕵️ <b>Spy/stealth:</b> Ivara, Wukong</p>' +
        '<p class="muted small">Tell me which job you want done and I\'ll give you the build and where to farm it.</p>'
    },
    {
      re: /(best|good|great) (weapon|gun)s? for (a )?(beginner|new player)|beginner (weapon|gun)|starter weapon|early game (weapon|gun)|first weapon/,
      html: '<b>Best early weapons (low MR, carry hard):</b>' +
        '<p>🔫 <b>Hek</b> (MR4 shotgun) — the classic new-player delete button; its Syndicate augment (Scattered Justice, Steel Meridian) is a huge boost.</p>' +
        '<p>💥 <b>Atomos</b> (MR5) — chaining beam pistol that melts crowds.</p>' +
        '<p>🌀 <b>Xoris</b> (from The Deadlock Protocol quest) — infinite-combo glaive, carries well into Steel Path.</p>' +
        '<p>⚔️ <b>Broken War</b> (quest reward) — one of the best melee in the game, handed to you for free.</p>' +
        '<p class="muted small">Ask <i>"make me a Hek build"</i> and I\'ll mod it out for you.</p>'
    }
  ];

  function knowledgeAnswer(t) {
    for (var i = 0; i < KNOWLEDGE.length; i++) {
      var k = KNOWLEDGE[i];
      if (k.re.test(t) && (!k.test || k.test.test(t))) return k.html;
    }
    return null;
  }

/* ---------- v2.23.0: THE RECOMMENDER ----------
   The owner's live failure: "could you find me a good warframe to use"
   got the canned don't-know. A recommendation question is not a lookup
   — it is answered by REASONING over the Vault's own data: every frame
   and weapon is scored against the stated goal (or spread across roles
   when no goal is stated) using its role, stats, mastery requirement,
   acquisition source, the playstyle tags of its library builds, the
   Tenno's on-device feedback votes (js/vaulty-learn.js) and their
   arsenal (js/vaulty-memory.js). Picks are always real DB entries,
   each with a WHY drawn from real fields and one honest trade-off. */
  function itemBuildTags(itemName) {
    var set = {};
    var key = norm(itemName);
    (D.builds || []).forEach(function (b) {
      if (norm(b.item) !== key) return;
      (b.tags || []).forEach(function (tg) { set[norm(tg)] = 1; });
    });
    return set;
  }
  function baseName(name) { return norm(name).replace(/\s+prime$/, ''); }
  function fbBoost(name) {
    try { return (window.TVLearn && TVLearn.boostForItem) ? TVLearn.boostForItem(name) : 0; } catch (e) { return 0; }
  }
  function ownsItem(name) {
    try { return !!(window.TVMemory && TVMemory.owns && TVMemory.owns(name)); } catch (e) { return false; }
  }
  function arsenalAny() {
    try { return !!(window.TVMemory && TVMemory.ownedList && TVMemory.ownedList().length); } catch (e) { return false; }
  }

  function recoGoalOf(t) {
    if (/steel\s?path/.test(t)) return 'steelpath';
    if (/\b(surviv|endless|not die|staying alive|unkillable|tanky|tank)\b/.test(t)) return 'survival';
    if (/\b(beginner|new player|starter|first (frame|weapon)|easy|simple|starter)\b/.test(t)) return 'beginner';
    if (/\b(boss|bosses|eidolon|archon hunt boss)\b/.test(t)) return 'boss';
    if (/\b(stealth|sneak|invisible|spy)\b/.test(t)) return 'stealth';
    if (/\b(support|heal|buff|team|squad)\b/.test(t)) return 'support';
    if (/\b(cc|crowd control|control|lock ?down)\b/.test(t)) return 'cc';
    if (/\b(damage|dps|nuke|kill|melts?|destroy|strongest|powerful|hardest hitting)\b/.test(t)) return 'damage';
    return null;
  }
  var RECO_CLASS_WORDS = [
    [/warframes?\b/, 'warframe'], [/\bframes?\b/, 'warframe'],
    [/\bshotguns?\b/, 'shotgun'], [/\brifles?\b/, 'rifle'], [/\bpistols?\b/, 'pistol'],
    [/\bmelee\b/, 'melee'], [/\bprimary\b/, 'primary'], [/\bsecondary\b/, 'secondary'],
    [/\bweapons?\b/, 'weapon'], [/\bguns?\b/, 'weapon']
  ];
  function recoDetect(t) {
    if (/\b(build|vs|versus|farm|where|mod)\b/.test(t)) return null;
    if (!/(find|recommend|suggest|good|best|which|what|pick|choose|should)/.test(t)) return null;
    var cls = null;
    for (var i = 0; i < RECO_CLASS_WORDS.length; i++) {
      if (RECO_CLASS_WORDS[i][0].test(t)) { cls = RECO_CLASS_WORDS[i][1]; break; }
    }
    if (!cls) return null;
    var verb = /\b(find|recommend|suggest|give|show|pick|choose)\b/.test(t) ||
      /\bwhat('s| is| are)?\b[^.]*\b(good|best)\b/.test(t) ||
      /\b(good|best|great|strong|solid|fun|easy|decent)\b/.test(t) ||
      /\bshould (i|we) (use|play|pick|get|run|main)\b/.test(t) ||
      /\bwhich\b/.test(t);
    if (!verb) return null;
    /* a NAMED item is a build/info question, never a recommendation */
    if (findItemInText(D.warframes, t) || findItemInText(D.weapons, t)) return null;
    return { cls: cls, goal: recoGoalOf(t) };
  }

  var RECO_ROLE_WHY = {
    'Tank': 'a genuine tank — its kit is built around not dying',
    'DPS/Nuke': 'a damage frame — its kit deletes rooms',
    'Support': 'a support — it keeps the whole squad stronger and alive',
    'Crowd Control': 'a controller — it locks rooms down so nothing reaches you',
    'Stealth': 'a stealth frame — it wins by never being seen',
    'Mobility': 'all about speed and movement',
    'Hybrid': 'a flexible hybrid that adapts to the mission'
  };
  function recoFrameScore(f, goal) {
    var tags = itemBuildTags(f.name);
    var role = f.role || 'Hybrid';
    var s = 3, why = [];
    if (tags.strong) { s += 3; }
    var abText = (f.abilities || []).map(function (a) { return norm((a.name || '') + ' ' + (a.description || '')); }).join(' ');
    function abHit(re, label) {
      for (var i = 0; i < (f.abilities || []).length; i++) {
        if (re.test(norm((f.abilities[i].name || '') + ' ' + (f.abilities[i].description || '')))) return f.abilities[i].name;
      }
      return null;
    }
    if (goal === 'survival' || goal === 'tank') {
      if (role === 'Tank') { s += 16; why.push(RECO_ROLE_WHY.Tank); }
      if (tags.tank) s += 12;
      var sus = abHit(/(invulnerab|immortal|heal|restore|regenerat|damage reduction|overshield)/, 'sustain');
      if (sus) { s += 7; why.push('<b>' + esc(sus) + '</b> keeps it alive when missions get long'); }
    } else if (goal === 'damage' || goal === 'steelpath') {
      if (role === 'DPS/Nuke') { s += 16; why.push(RECO_ROLE_WHY['DPS/Nuke']); }
      if (tags.nuke) s += 11;
      if (tags.dps) s += 9;
      if (tags.strong) s += 5;
      if (tags['steel-path']) s += 5;
      if (goal === 'steelpath') { var sig = abHit(/(damage|nuke|explode|detonat)/); if (sig) { s += 4; why.push('<b>' + esc(sig) + '</b> scales into high-level content'); } }
    } else if (goal === 'support') {
      if (role === 'Support') { s += 16; why.push(RECO_ROLE_WHY.Support); }
      if (tags.support) s += 13;
    } else if (goal === 'stealth') {
      if (role === 'Stealth') { s += 16; why.push(RECO_ROLE_WHY.Stealth); }
      if (tags.stealth) s += 12;
    } else if (goal === 'cc') {
      if (role === 'Crowd Control') { s += 16; why.push(RECO_ROLE_WHY['Crowd Control']); }
      if (tags.cc) s += 13;
    } else if (goal === 'boss') {
      if (tags.boss) s += 13;
      if (role === 'DPS/Nuke') s += 8;
    } else if (goal === 'beginner') {
      if (tags.beginner) { s += 18; why.push('it has a beginner-proven build in the library'); }
      if ((f.masteryReq || 0) === 0) s += 5;
      if (role === 'Tank') { s += 6; why.push('tanky frames forgive beginner mistakes'); }
      if (/ prime$/.test(norm(f.name))) s -= 6;
    }
    if (!why.length && RECO_ROLE_WHY[role]) why.push(RECO_ROLE_WHY[role]);
    if (abText && !why.length) why.push('a solid all-round kit');
    return { score: s, why: why };
  }
  function recoFrameTradeoff(f, goal) {
    if ((f.masteryReq || 0) >= 8) return 'needs MR ' + f.masteryReq + ' — not a tonight pick if you\'re below that';
    if (/ prime$/.test(norm(f.name))) return 'it\'s a Prime — the relic grind for the parts is real';
    if ((f.armor || 0) < 150 && (f.health || 0) < 400 && f.role !== 'Tank') return 'glass — positioning matters, it won\'t face-tank for you';
    if (f.role === 'Tank' && (goal === 'damage' || goal === 'steelpath')) return 'tanky first, damage second — rooms clear slower than a nuke frame';
    if (f.role === 'DPS/Nuke') return 'squishier than the tanks — it survives by killing first';
    if (f.role === 'Support') return 'shines brightest with a squad counting on it';
    if (f.role === 'Stealth') return 'rewards patience — not a face-tank playstyle';
    if (f.role === 'Crowd Control') return 'controls rooms beautifully, melts bosses slower';
    return 'needs its build to really shine — which I can compose for you';
  }
  function recoWeaponScore(w, goal) {
    var tags = itemBuildTags(w.name);
    var s = 3;
    if (tags.strong) s += 4;
    if (goal === 'steelpath' || goal === 'survival') {
      if (tags['steel-path']) s += 6;
      if (tags.strong) s += 5;
      if ((w.criticalChance || 0) >= 25) s += 5;
      if ((w.statusChance || 0) >= 25) s += 4;
    } else if (goal === 'damage' || goal === 'boss') {
      if (tags.boss) s += 8;
      if ((w.totalDamage || 0) >= 300) s += 6;
      if ((w.criticalChance || 0) * (w.criticalMultiplier || 1) >= 60) s += 6;
      if (tags.dps) s += 6;
    } else if (goal === 'beginner') {
      if (tags.beginner) s += 16;
      if ((w.masteryReq || 0) <= 4) s += 8;
      if (/ prime$/.test(norm(w.name))) s -= 5;
    } else {
      if ((w.criticalChance || 0) >= 22) s += 4;
      if ((w.totalDamage || 0) >= 250) s += 3;
    }
    return { score: s };
  }
  function recoWeaponTradeoff(w, goal) {
    if ((w.masteryReq || 0) >= 10) return 'needs MR ' + w.masteryReq + ' — a longer road if you\'re below that';
    if ((w.statusChance || 0) < 10) return 'it won\'t prime statuses on its own — it\'s a finisher, not a primer';
    if ((w.criticalChance || 0) < 10) return 'not a crit weapon — it mods very differently from the crit staples';
    if (/ prime$/.test(norm(w.name))) return 'Prime parts mean relic cracking';
    return 'needs its build to shine — I can compose one from real mods';
  }

  function recommendAnswer(t, det) {
    var goal = det.goal;
    var isFrameAsk = det.cls === 'warframe';
    var picks = [];
    if (isFrameAsk) {
      var scored = D.warframes.map(function (f) {
        var r = recoFrameScore(f, goal);
        var sc = r.score + fbBoost(f.name) + (ownsItem(f.name) ? 10 : 0);
        return { e: f, score: sc, why: r.why };
      });
      if (goal) {
        scored.sort(function (a, b) { return b.score - a.score; });
        var seenBase = {};
        for (var i = 0; i < scored.length && picks.length < 3; i++) {
          var bn = baseName(scored[i].e.name);
          if (seenBase[bn]) continue;
          seenBase[bn] = 1;
          picks.push(scored[i]);
        }
      } else {
        /* no goal stated: spread across roles — survive / delete / support */
        var lenses = ['survival', 'damage', 'support'];
        var usedBase = {};
        lenses.forEach(function (lens) {
          var ss = D.warframes.map(function (f) {
            var r = recoFrameScore(f, lens);
            return { e: f, score: r.score + fbBoost(f.name) + (ownsItem(f.name) ? 10 : 0), why: r.why, lens: lens };
          }).sort(function (a, b) { return b.score - a.score; });
          for (var j = 0; j < ss.length; j++) {
            var b2 = baseName(ss[j].e.name);
            if (usedBase[b2]) continue;
            usedBase[b2] = 1;
            picks.push(ss[j]);
            break;
          }
        });
      }
    } else {
      var typeFilter = null, tagFilter = null;
      if (det.cls === 'primary') typeFilter = 'Primary';
      else if (det.cls === 'secondary' || det.cls === 'pistol') typeFilter = 'Secondary';
      else if (det.cls === 'melee') typeFilter = 'Melee';
      else if (det.cls === 'shotgun') tagFilter = 'shotgun';
      else if (det.cls === 'rifle') tagFilter = 'rifle';
      var pool = D.weapons.filter(function (w) {
        if (typeFilter && w.type !== typeFilter) return false;
        if (tagFilter && !itemBuildTags(w.name)[tagFilter]) return false;
        return w.type === 'Primary' || w.type === 'Secondary' || w.type === 'Melee';
      });
      var wscored = pool.map(function (w) {
        var r = recoWeaponScore(w, goal || 'steelpath');
        return { e: w, score: r.score + fbBoost(w.name) + (ownsItem(w.name) ? 10 : 0), weapon: true };
      }).sort(function (a, b) { return b.score - a.score; });
      var seenW = {};
      for (var k = 0; k < wscored.length && picks.length < 3; k++) {
        var bw = baseName(wscored[k].e.name);
        if (seenW[bw]) continue;
        seenW[bw] = 1;
        picks.push(wscored[k]);
      }
    }
    if (!picks.length) return null;

    var goalLine = {
      steelpath: 'For Steel Path, here\'s what I\'d actually run:',
      survival: 'Built to not die — my picks for survival:',
      damage: 'You want rooms deleted. These do that:',
      support: 'For backing up a squad, these are the real deal:',
      beginner: 'Starting out? These forgive mistakes and carry early:',
      stealth: 'Unseen and unbothered — my stealth picks:',
      cc: 'Lock the whole room down with these:',
      boss: 'For bosses, bring one of these:'
    }[goal] || null;
    var intro = goalLine || (isFrameAsk
      ? 'Good question — let me answer it properly instead of shrugging. Here are three very different frames, one per job:'
      : 'Good question — here are my top three picks from the Vault\'s data:');
    var lensLabel = { survival: '🛡 The survivor', damage: '💥 The deleter', support: '✨ The backbone' };
    var html = '<div class="vai-reco" data-top="' + esc(picks[0].e.name) + '"><p>' + intro + '</p>';
    picks.forEach(function (p, idx) {
      var e = p.e;
      var page = p.weapon ? 'weapons.html' : 'warframes.html';
      var head = (p.lens ? lensLabel[p.lens] + ' — ' : (idx + 1) + '. ') +
        '<a href="' + link(page, e.name) + '"><b>' + esc(e.name) + '</b></a>';
      var whyTxt;
      if (p.weapon) {
        whyTxt = (e.goodAt ? 'Built for ' + esc(e.goodAt) + '. ' : '') +
          'Profile from the Vault\'s data: ' + (e.criticalChance || 0) + '% crit · ' + (e.statusChance || 0) +
          '% status · ' + (e.totalDamage || 0) + ' base damage.';
      } else {
        whyTxt = 'It\'s ' + esc((p.why && p.why[0]) || 'a solid pick') +
          (p.why && p.why[1] ? ', and ' + p.why[1] : '') + '.';
      }
      var trade = p.weapon ? recoWeaponTradeoff(e, goal) : recoFrameTradeoff(e, goal);
      var own = ownsItem(e.name);
      var getLine = '';
      if (own) getLine = ' <span class="muted small">🎒 Already in your arsenal.</span>';
      else if (arsenalAny() && e.farm) getLine = ' <span class="muted small">To get it: ' + esc(String(e.farm).slice(0, 110)) + '</span>';
      html += '<p>' + head + '<br>' + whyTxt +
        '<br><span class="muted small">Trade-off: ' + esc(trade) + '</span>' + getLine + '</p>';
    });
    if (!goal) {
      html += '<p>One question back so I can sharpen this: mostly <b>surviving</b>, <b>deleting rooms</b>, or <b>backing up a squad</b>?</p>';
    }
    html += '<p class="muted small">Want a build for <b>' + esc(picks[0].e.name) + '</b>? Just say <i>"' +
      esc(picks[0].e.name) + ' build"</i> — or ask me for a build for any of the three.</p></div>';
    /* the top pick becomes the session's item, so "build for her" lands */
    sessionCtx.item = picks[0].e.name;
    sessionCtx.kind = picks[0].weapon ? 'weapon' : 'warframe';
    return html;
  }

  /* ---------- v2.23.0: MY ARSENAL by chat ---------- */
  function arsenalAnswer(t) {
    if (!window.TVMemory || !TVMemory.addOwned) {
      if (/^(i (have|own)|add |remove |my arsenal|what do i own)/.test(t)) {
        return 'My memory of your gear lives in the full Vault Guide panel — open Vaulty there and tell me what you own; this page\'s quick view can\'t store it.';
      }
      return null;
    }
    var m;
    if (/^(my arsenal|what do i own|what('s| is) in my arsenal|show (me )?my arsenal)/.test(t)) {
      var list = TVMemory.ownedList();
      if (!list.length) return 'Your arsenal is empty so far. Tell me <i>"I have Saryn Prime"</i> (any frame or weapon) and I\'ll remember it — recommendations then start from gear you actually own.';
      return '<b>🎒 Your arsenal:</b><ul>' + list.map(function (e) {
        return '<li>' + esc(e.name) + ' <span class="muted small">' + esc(e.kind) + '</span></li>';
      }).join('') + '</ul><p class="muted small">Stored only on this device. Say <i>"remove X from my arsenal"</i> to take something off.</p>';
    }
    m = t.match(/^remove (.+?) from (?:my )?arsenal$/) || t.match(/^(?:remove|delete) (.+?)(?: from my arsenal)?$/);
    if (m && /arsenal|remove|delete/.test(t)) {
      var rf = findItemInText(D.warframes, m[1]);
      var rw = rf ? null : findItemInText(D.weapons, m[1]);
      var rName = rf ? rf.name : (rw ? rw.name : null);
      if (rName && TVMemory.removeOwned(rName)) return 'Removed <b>' + esc(rName) + '</b> from your arsenal.';
      if (rName) return '<b>' + esc(rName) + '</b> wasn\'t in your arsenal — nothing removed.';
      return null;
    }
    m = t.match(/^i (?:have|own|main) (.+)$/) || t.match(/^add (.+?) to (?:my )?arsenal$/) || t.match(/^(.+?) is in my arsenal$/);
    if (m) {
      /* short remainders only — "I have a question about Nova" is not
         an arsenal claim, it's a question that happens to name gear */
      if (m[1].split(/\s+/).length > 5) return null;
      var af = findItemInText(D.warframes, m[1]);
      var aw = af ? null : findItemInText(D.weapons, m[1]);
      var item = af || aw;
      if (!item) return null;
      var kind = af ? 'warframe' : 'weapon';
      if (TVMemory.owns(item.name)) return 'Already got <b>' + esc(item.name) + '</b> in your arsenal — no double-counting.';
      TVMemory.addOwned(item.name, kind);
      return '🎒 Added <b>' + esc(item.name) + '</b> to your arsenal. From now on my recommendations start from what you own. ' +
        'Want a build for it? Say <i>"' + esc(item.name) + ' build"</i>.';
    }
    return null;
  }

  /* ---------- v2.23.0: FARM WATCH by chat ----------
     "I'm farming X" stores ONE on-device watch (js/vaulty-watch.js);
     the best source comes from the Vault's farm data right now, and
     while the app stays open the watch checks the live feed and nudges
     when a matching fissure / alert / invasion is live. */
  function farmWatchAnswer(t) {
    var m;
    if (/^(stop|clear|remove|end)( the| my)? (farm )?watch/.test(t) || /^i'?m done farming/.test(t)) {
      if (window.TVWatch) TVWatch.clear();
      return 'Farm watch cleared — I\'ll stop keeping an eye out. Tell me <i>"I\'m farming …"</i> any time to start a new one.';
    }
    if (/^(what am i farming|farm watch|my farm watch)/.test(t)) {
      var cur = (window.TVWatch && TVWatch.current) ? TVWatch.current() : null;
      if (!cur) return 'No farm watch running. Say <i>"I\'m farming Lith A1"</i> or <i>"I\'m farming Argon Crystals"</i> and I\'ll watch the live feed for it.';
      return 'You\'re farming <b>' + esc(cur.item) + '</b>. Best source: ' + esc(cur.source || 'the Vault\'s farm data') +
        '. I\'m watching the live feed while the app is open — I\'ll nudge you the moment a matching fissure, alert or invasion is live.';
    }
    m = t.match(/^(?:i'?m|im) (?:farming|grinding|hunting for) (.+)$/) ||
        t.match(/^watch (?:for )?(.+)$/) || t.match(/^set (?:a )?watch (?:for )?(.+)$/) ||
        t.match(/^farm watch (?:for )?(.+)$/);
    if (!m) return null;
    var subj = m[1].replace(/^(the|a|an)\s+/, '').trim();
    if (subj.split(/\s+/).length > 6) return null;
    var itemName = null, sourceLine = null;
    var relicM = subj.match(/^(lith|meso|neo|axi|requiem)\s+([a-z]\d)$/);
    if (relicM) {
      itemName = relicM[1].charAt(0).toUpperCase() + relicM[1].slice(1) + ' ' + relicM[2].toUpperCase();
      sourceLine = 'Crack it in Void Fissure missions of its tier; the relic itself drops from endless missions, bounties and Void captures';
    } else {
      var f = findFarm(subj);
      if (f) {
        itemName = f.e.name || f.e.what || subj;
        sourceLine = f.e.farm || f.e.source || (f.e.drops ? fmtDrops(f.e.drops) : '') || 'the Vault\'s farm data';
      } else {
        var fi = findItemInText(D.warframes, subj) || findItemInText(D.weapons, subj);
        if (fi) { itemName = fi.name; sourceLine = fi.farm || 'the Vault\'s farm data'; }
      }
    }
    if (!itemName) {
      return 'I couldn\'t find "' + esc(subj) + '" in the Vault\'s farm data, so I won\'t pretend to watch for it. ' +
        'Try the full name — a relic (<i>Lith A1</i>), a resource (<i>Argon Crystals</i>), or a frame/weapon.';
    }
    if (window.TVWatch) TVWatch.set(itemName, String(sourceLine).slice(0, 220));
    return '👁 Farm watch set: <b>' + esc(itemName) + '</b>.<p><b>📍 Best source:</b> ' + esc(String(sourceLine).slice(0, 220)) + '</p>' +
      '<p>While this app stays open I\'ll check the live feed and nudge you when a matching fissure, alert or invasion is live. ' +
      'One watch at a time — say <i>"stop watch"</i> to clear it.</p>';
  }

  /* ---------- v2.23.0: BUILD CHECKER ----------
     The Tenno pastes THEIR build; Vaulty checks it like a verifier,
     never a vibes machine: every mod must be a real DB entry, legal
     for the item's class, non-duplicated, in the right slot kind, and
     the total max-rank drain must fit the standard capacity budget.
     The verdict renders through the Workshop module, which fetches
     REAL drain data (warframestat) exactly like the capacity check in
     the composer. Unknown names are called unrecognized — never
     silently "corrected" into a different real mod. */
  var CHECKER_FILLER = ['and', 'with', 'using', 'on', 'for', 'my', 'the', 'build', 'mods', 'mod', 'is', 'are', 'equipped', 'running', 'currently', 'this', 'setup', 'loadout', 'in', 'a', 'an', 'plus', '+'];
  function checkerParse(t) {
    if (!/\bbuild\b/.test(t)) return null;
    var wants = /\b(check|rate|review|validate|fix|look over|look at|verify|grade)\b/.test(t) ||
      /^my\b/.test(t) || /\b(my|this|current) build\b/.test(t) || /\bbuild (is|:)\b/.test(t);
    if (!wants) return null;
    var itemFound = resolveNamedItem(t);
    var item = itemFound ? itemFound.e : null;
    /* known mods, longest names first so multiword names win */
    var names = [];
    var seenN = {};
    (D.mods || []).forEach(function (md) {
      var n = norm(md.name);
      if (n.length >= 4 && !seenN[n]) { seenN[n] = 1; names.push({ name: md.name, key: n }); }
    });
    names.sort(function (a, b) { return b.key.length - a.key.length; });
    var padded = ' ' + t.replace(/[^a-z0-9' ]/g, ' ') + ' ';
    var known = [];
    names.forEach(function (cand) {
      var needle = ' ' + cand.key.replace(/-/g, ' ') + ' ';
      var idx = padded.indexOf(needle);
      if (idx !== -1) {
        /* count occurrences for dupe detection */
        var count = 0, from = 0, hay = padded;
        while ((from = hay.indexOf(needle, from)) !== -1) { count++; from += needle.length - 1; }
        known.push({ name: cand.name, count: count });
      }
    });
    if (known.length < 3) return null;
    /* unknown claimed mods: chunks between separators, with the item
       name and the command scaffolding stripped first, so what remains
       is what the Tenno actually claimed was a mod */
    var unknown = [];
    var chunkSrc = t;
    if (item) chunkSrc = chunkSrc.split(norm(item.name)).join(' ');
    var filler = {};
    CHECKER_FILLER.forEach(function (w) { filler[w] = 1; });
    filler.mod = 0; filler.mods = 0; /* "mod" is part of claimed names */
    chunkSrc.split(/[,+•·\n]|\band\b|\bwith\b|\busing\b/).forEach(function (ch) {
      var words = ch.trim().split(/\s+/).filter(function (w) {
        return w && !filler[w] && !/^(check|rate|review|validate|fix|verify|look|over|at|grade|please|what|do|you|think|is|it|legal|ok|good)$/.test(w);
      });
      if (!words.length || words.length > 4) return;
      var candTxt = words.join(' ').replace(/^[:\s]+|[:\s]+$/g, '');
      if (candTxt.length < 4 || /^\d+$/.test(candTxt)) return;
      if (known.some(function (k) { return norm(k.name) === candTxt; })) return;
      unknown.push(candTxt);
    });
    unknown = unknown.filter(function (u, i) { return unknown.indexOf(u) === i; }).slice(0, 4);
    return { item: item, itemKind: itemFound ? itemFound.kind : null, known: known, unknown: unknown };
  }
  function checkerHandoffHtml(parsed) {
    var plan = {
      item: parsed.item ? parsed.item.name : (sessionCtx.item || ''),
      kind: parsed.itemKind || sessionCtx.kind || '',
      known: parsed.known, unknown: parsed.unknown
    };
    return '<div class="vai-checker-handoff" data-plan="' +
      esc(JSON.stringify(plan)).replace(/"/g, '&quot;') + '"></div>';
  }
  function checkBuildIntent(t) {
    var parsed = checkerParse(t);
    if (!parsed) return null;
    if (!parsed.item && !sessionCtx.item) {
      return 'I can check that build — but which item is it on? The mod list came through (' +
        parsed.known.length + ' mods I recognize); tell me the frame or weapon and I\'ll verify every slot, legality and the capacity math.';
    }
    return checkerHandoffHtml(parsed);
  }
  /* The full report — called by the Workshop orchestrator once real
     drain data has been fetched (drains may be null → capacity is
     then honestly reported as unchecked, never guessed). */
  function checkBuildReport(plan, drains) {
    var itemName = plan.item || '';
    var found = findItemForBuild(itemName) || (function () {
      var f = findByName(D.warframes, itemName); if (f) return { kind: 'warframe', e: f };
      var w = findByName(D.weapons, itemName); if (w) return { kind: 'weapon', e: w };
      return null;
    })();
    if (!found) return null;
    var cls = found.kind === 'warframe' ? 'warframe'
      : (found.e.type === 'Secondary' ? 'pistol' : (found.e.type === 'Melee' ? 'melee'
      : (itemBuildTags(found.e.name).shotgun ? 'shotgun' : 'rifle')));
    var problems = [], swaps = [], grid = [], auraName = null;
    var seen = {};
    (plan.known || []).forEach(function (k) {
      var entry = findModExact(k.name);
      if (!entry) { problems.push('<b>' + esc(k.name) + '</b> isn\'t in the mods database.'); return; }
      if (k.count > 1) problems.push('<b>' + esc(k.name) + '</b> appears ' + k.count + ' times — a mod can only be slotted once.');
      if (seen[norm(k.name)]) return;
      seen[norm(k.name)] = 1;
      if (isAuraMod(k.name)) {
        if (found.kind !== 'warframe') problems.push('<b>' + esc(k.name) + '</b> is an AURA mod — weapons have no aura slot.');
        else if (auraName) problems.push('<b>' + esc(k.name) + '</b> is a second aura — only one aura slot exists.');
        else auraName = k.name;
        return;
      }
      if (!modFitsClass(k.name, cls, itemName)) {
        problems.push('<b>' + esc(k.name) + '</b> can\'t go on a ' + cls + ' — it\'s a ' + esc(entry.type || 'different-class') + ' mod (' + esc(entry.compat || '') + ').');
        var sub = substituteMod(k.name, cls, itemName, {}, seen) ||
          (FILLER_POOL[cls] || []).filter(function (n) { return !seen[norm(n)] && findModExact(n) && modFitsClass(n, cls, itemName); })[0];
        if (sub) { swaps.push({ from: k.name, to: sub }); seen[norm(sub)] = 1; }
        return;
      }
      grid.push(k.name);
    });
    (plan.unknown || []).forEach(function (u) {
      problems.push('<b>' + esc(u) + '</b> — I don\'t recognize that as a real mod name. It isn\'t in the Vault\'s database, so I won\'t guess what you meant; check the spelling on the mod card.');
    });
    if (grid.length > 8) problems.push('That\'s <b>' + grid.length + ' mods</b> in the grid — only 8 slots exist.');
    else if (grid.length < 8 && grid.length > 0) problems.push('<span class="muted">You have <b>' + (8 - grid.length) + ' open slot' + (8 - grid.length === 1 ? '' : 's') + '</b> — room to grow.</span>');
    /* capacity vs REAL drain (same budgets as the Workshop) */
    var capLine = '';
    if (drains) {
      var cap = found.kind === 'warframe' ? 60 + (auraName && drains[norm(auraName)] != null ? drains[norm(auraName)] : 14) : 60;
      var total = 0, knownAll = true;
      grid.forEach(function (n) { var d = drains[norm(n)]; if (d == null) knownAll = false; else total += d; });
      if (auraName && found.kind === 'warframe' && drains[norm(auraName)] == null) knownAll = false;
      if (!knownAll) {
        capLine = '<p>⚖️ <b>Capacity:</b> drain data didn\'t come back for every mod, so I won\'t guess the total.</p>';
      } else if (total <= cap) {
        capLine = '<p>⚖️ <b>Capacity:</b> ' + total + ' / ' + cap + ' at max rank — fits a standard setup, no Forma needed for capacity.</p>';
      } else {
        capLine = '<p>⚖️ <b>Capacity:</b> ' + total + ' / ' + cap + ' at max rank — <b>over by ' + (total - cap) + '</b>. That\'s normal for endgame builds: it means Forma (polarized slots halve drain) is part of the plan.';
        var maxN = null, maxD = -1;
        grid.forEach(function (n) { var d = drains[norm(n)] || 0; if (d > maxD) { maxD = d; maxN = n; } });
        var cheap = (FILLER_POOL[cls] || []).filter(function (n) {
          return !grid.some(function (g) { return norm(g) === norm(n); }) && drains[norm(n)] != null && findModExact(n) && modFitsClass(n, cls, itemName);
        }).sort(function (a, b) { return drains[norm(a)] - drains[norm(b)]; })[0];
        if (maxN && cheap && !swaps.some(function (s) { return s.from === maxN; })) {
          swaps.push({ from: maxN, to: cheap, capSwap: true });
        }
      }
    } else {
      capLine = '<p>⚖️ <b>Capacity:</b> live drain data didn\'t answer just now, so the capacity check is honestly skipped — legality above is fully verified.</p>';
    }
    var bad = problems.filter(function (p) { return p.indexOf('muted') === -1; }).length;
    var verdict = bad === 0
      ? '✅ <b>' + esc(itemName) + '</b> — this build is <b>legal</b>. Every mod is real, class-correct and slotted once.'
      : '🔎 <b>' + esc(itemName) + '</b> — checked it properly. ' + bad + ' problem' + (bad === 1 ? '' : 's') + ' to fix:';
    var html = '<div class="vai-check"><p>' + verdict + '</p>';
    if (problems.length) html += '<ul>' + problems.map(function (p) { return '<li>' + p + '</li>'; }).join('') + '</ul>';
    html += capLine;
    if (swaps.length) {
      html += '<p><b>Suggested swaps</b> <span class="muted small">(every suggestion is a real mod, verified legal for this item):</span></p><ul>' +
        swaps.map(function (s) {
          var e2 = findModExact(s.to);
          return '<li><b>' + esc(s.from) + '</b> → <b>' + esc(s.to) + '</b>' +
            (e2 ? ' <span class="muted small">' + esc(e2.effect || '') + '</span>' : '') +
            (s.capSwap ? ' <span class="muted small">(capacity swap — lower drain)</span>' : '') + '</li>';
        }).join('') + '</ul>';
    }
    html += '<p class="muted small">Want the Workshop to compose a clean original for ' + esc(itemName) +
      ' instead? Say <i>"design a ' + esc(itemName) + ' build"</i>.</p></div>';
    return html;
  }

  /* ---------- v2.23.0: how Vaulty learns ---------- */
  function learnAnswer(t) {
    if (/what (are|have) you learning|show me what you('re| are) learning|what vaulty is learning/.test(t)) {
      if (window.TVLearn) return TVLearn.viewHtml();
      return 'On this page my learning view isn\'t wired up — open the full Vault Guide panel and tap <i>"🧠 What Vaulty remembers"</i>.';
    }
    if (/how do you learn|how does vaulty learn|do you (actually )?learn|how do you (get smarter|improve)|how do you remember/.test(t)) {
      if (window.TVLearn) return TVLearn.explainHtml();
      return 'Honestly: I remember what you ask about on this device only (nothing is uploaded), questions I can\'t answer are logged anonymously — question text only — so future updates can teach me them, and your 👍/👎 votes on this device re-rank my recommendations. I don\'t retrain a model in your browser.';
    }
    return null;
  }

/* ---------- intent routing ---------- */
  function stripQ(q) { return norm(q).replace(/\?+$/, '').trim(); }

  /* v2.12.31: conversational layer — answer like a peer, not a wiki.
     Handles opinions, comparisons, "what should I do", and casual chat. */
  function conversationalAnswer(t, origQ) {
    /* greetings with personality */
    if (/^(hi|hey|hello|yo|sup|howdy|whats up|what's up)\b/.test(t)) {
      var greetings = [
        'Hey, Tenno. What are we working on — builds, farming, or just figuring out what to do next?',
        'Yo. Ask me about builds, where to farm something, or what\'s worth your time.',
        'Hey. I can help with builds, mods, farming spots — or tell you straight up if something\'s worth it.'
      ];
      return greetings[Math.floor(Math.random() * greetings.length)];
    }
    /* "is X good/worth it?" — opinions */
    var isGoodMatch = t.match(/is ([a-z0-9 '\-]+?) (good|worth it|worth|any good|good\?)/);
    if (isGoodMatch) {
      var item = isGoodMatch[1].trim();
      /* v2.23.0: "what is a good <class>…" captures just the article —
         that's a RECOMMENDATION question, not an opinion about an
         item. Let it fall through to the recommender. */
      var bareItem = item.replace(/^(a|an|the)(\s+|$)/, '');
      if (bareItem && !/^(warframe|frame|weapon|melee|gun|primary|secondary|pistol|rifle|shotgun|mod)s?$/.test(bareItem)) {
        return opinionAnswer(item, t);
      }
    }
    /* "should I ..." — advice */
    if (/^should i\b/.test(t)) {
      return 'Depends on where you\'re at. ' + helpAnswer() + ' Give me more context — what MR are you, what are you trying to do?';
    }
    /* "what should I do/farm/next" — guidance */
    if (/what should i (do|farm|focus|work on)/.test(t) || /what('s| is) next/.test(t)) {
      return 'Here\'s the priority: <b>1)</b> Clear the star chart if you haven\'t — unlocks everything. ' +
        '<b>2)</b> Farm the mods you\'re missing (check the mods page for sources). ' +
        '<b>3)</b> Crack relics for prime parts — that\'s your platinum income. ' +
        'Tell me your MR and I\'ll get specific.';
    }
    /* "X vs Y" or "X or Y" — comparisons */
    var vsMatch = t.match(/([a-z0-9 '\-]+?) (vs|versus|or) ([a-z0-9 '\-]+?)$/);
    if (vsMatch && t.indexOf('build') === -1) {
      return 'Comparing <b>' + esc(vsMatch[1].trim()) + '</b> vs <b>' + esc(vsMatch[3].trim()) + '</b> — ' +
        'I\'d need to know what you\'re using them for. In general: check both on the builds page and look at ' +
        'the use case. Want me to pull up builds for either?';
    }
    /* thanks */
    if (/^(thanks|thank you|thx|ty)\b/.test(t)) {
      return 'Anytime, Tenno. Go get that loot. ◈';
    }
    /* bye */
    if (/^(bye|goodbye|see you|later)\b/.test(t)) {
      return 'Later, Tenno. Vault\'s always open. ◈';
    }
    /* "who are you" */
    if (/who are you|your name/.test(t)) {
      return 'I\'m the Vault Guide — your Warframe companion built into The Foundry. Ask me about builds, farming, mods, anything.';
    }
    return null; /* not handled — fall through to keyword matching */
  }

  /* opinions on gear — direct, peer-level */
  function opinionAnswer(item, t) {
    /* check if it's in our data first */
    var itemLower = item.toLowerCase();
    /* generic but honest framework */
    return 'Honest take on <b>' + esc(item) + '</b>: ' +
      'check if it has a build in the library — if it\'s got a Steel Path tag, it\'s solid. ' +
      'If you tell me what you want to use it for (Steel Path? Sorties? just fun?), I\'ll give you a real answer.';
  }

  /* ---------- v2.22.0: session continuity ----------
     Vaulty remembers the conversation's current item for this session
     only (in-memory; nothing is written to storage), so a bare follow-up
     — "and for steel path survival?" — resolves against the item under
     discussion instead of falling into a don't-know. The resolved
     context is shown back subtly ("For Octavia Prime, Steel Path
     survival:") whenever it is used. Wh-questions and anything naming
     its own item are never rewritten. */
  var sessionCtx = { item: null, kind: null, lastIntent: null };
  var pendingCtxNote = null;
  function ctxItemOf(t) {
    /* v2.23.1: entity-first — a named item (even a 3-letter one like
       Nyx) registers as the conversation's item; before this, "nyx
       build" after a Wisp question was hijacked AS a Wisp follow-up */
    var r = resolveNamedItem(t);
    if (r) return { name: r.e.name, kind: r.kind };
    return null;
  }
  function ctxNoteFor(item, t) {
    var bits = [];
    if (/\bsteel\s?path\b/.test(t)) bits.push('Steel Path');
    if (/\bsurvival\b/.test(t)) bits.push('survival');
    else if (/\b(damage|dps|kills?|melts?|destroys?)\b/.test(t)) bits.push('damage');
    if (/\bone[\s-]?shot\b/.test(t)) bits.push('one-shot');
    return 'For ' + item + (bits.length ? ', ' + bits.join(' ') : '') + ':';
  }
  function resolveFollowUp(t) {
    if (!sessionCtx.item) return null;
    if (/^(what|where|who|how|when|why|which|is|are|do|does|can|could|should)\b/.test(t)) return null;
    var opener = /^(and|ok(ay)? and|now|but|so)\b/.test(t);
    var keyword = /\b(steel\s?path|survival|survive|damage|dps|build|setup|loadout|variant|version|one[\s-]?shot|melts?|kills?)\b/.test(t);
    if (!opener && !(t.length <= 48 && keyword)) return null;
    if (!opener && !keyword) return null;
    var body = t.replace(/^(and|ok(ay)? and|now|but|so)\s+/, '').replace(/[?.!\s]+$/, '');
    if (!body) return null;
    var resolved = norm(sessionCtx.item) + ' ' + body;
    if (sessionCtx.lastIntent === 'build' && !/\b(build|setup|loadout|farm|get|find|drop)\b/.test(resolved)) resolved += ' build';
    return resolved;
  }

  function answer(q) {
    var t0 = stripQ(q);
    if (!t0) return 'Ask me something — a build, a farm spot, a mod, or "help".';
    /* v2.22.0: track the item under discussion; resolve bare follow-ups */
    pendingCtxNote = null;
    var ctxHere = ctxItemOf(t0);
    if (ctxHere) {
      sessionCtx.item = ctxHere.name; sessionCtx.kind = ctxHere.kind;
      if (/\b(build|setup|loadout)\b/.test(t0)) sessionCtx.lastIntent = 'build';
    } else {
      var resolvedT = resolveFollowUp(t0);
      if (resolvedT) {
        pendingCtxNote = ctxNoteFor(sessionCtx.item, t0);
        q = resolvedT;
      }
    }
    var html = answerInner(q);
    if (pendingCtxNote && html && html.indexOf('data-workshop-handoff') === -1) {
      html = '<p class="muted small">' + esc(pendingCtxNote) + '</p>' + html;
    }
    return html;
  }

  function answerInner(q) {
    var t = stripQ(q);
    if (!t) return 'Ask me something — a build, a farm spot, a mod, or "help".';

    /* v2.12.31: conversational layer first — personality, opinions, casual chat */
    var convo = conversationalAnswer(t, q);
    if (convo) return convo;

    /* v2.23.0: learning, arsenal and farm-watch intents — personal
       state questions that only these handlers can answer truthfully. */
    var learnHit = learnAnswer(t);
    if (learnHit) return learnHit;
    var arsHit = arsenalAnswer(t);
    if (arsHit) return arsHit;
    var watchHit = farmWatchAnswer(t);
    if (watchHit) return watchHit;

    if (/^(hi|hey|hello|yo|sup|howdy)\b/.test(t)) {
      return 'Hey, Tenno. ' + helpAnswer();
    }
    if (t.indexOf('help') !== -1 || t.indexOf('what can you') !== -1) return helpAnswer();
    /* ONE-SHOT KNOWLEDGE — deep build theory, curated templates, primers, shards, enablers.
       Check these before the generic build intent so specific questions get the deep answers. */
    if (/one[\s-]?shot (formula|guide|how|theory)/.test(t) || /how (do|to).{0,20}one[\s-]?shot/.test(t)) {
      return ONE_SHOT_FORMULA;
    }
    if (/\bprimer\b/.test(t)) {
      return PRIMER_KNOWLEDGE;
    }
    if (/archon shard/.test(t)) {
      return SHARD_KNOWLEDGE;
    }
    if (/\benabler\b/.test(t) || /best frame for (damage|one[\s-]?shot|dps)/.test(t)) {
      return ENABLER_KNOWLEDGE;
    }
    /* v2.19.0: "what is Steel Path / how do I unlock it" is an explainer
       question, not a build request — answer it before the build intent
       below can hijack it ("steel path" is itself a build-intent word). */
    if (/what is (the )?steel path|how.*(unlock|start|get into).*steel path|steel path.*(unlock|start)/.test(t)) {
      var spx = knowledgeAnswer(t);
      if (spx) return spx;
    }
    /* v2.12.68: general Steel Path build questions — "build me a general steel path
       strong build that does lots of damage plus arcanes, auras, exilus".
       Only when NO specific item is named; named items keep their own builds. */
    if (/steel/.test(t) && /\b(build|mod|setup|loadout|guide|strong|damage)\b/.test(t)) {
      var spItem = resolveNamedItem(t);
      if (!spItem) return STEEL_PATH_GENERAL;
    }
    /* v2.22.0: THE WORKSHOP — a creative build brief ("design…", "come up
       with…", "weird off-meta…", "full damage…", "focused on <ability>…")
       for a named item is handed to the Workshop (js/vaulty-workshop.js),
       which researches the item and composes an ORIGINAL build from real
       mods. This runs before the qualifier interception and the library:
       a creative brief is a request for invention, and the Workshop
       honors qualifiers itself. Plain asks and qualifier-only asks keep
       their instant paths below. */
    /* v2.22.0: POWER INTENT — superlatives + outcome language on a build
       ask ("best Octavia build, kills anything, survival and destroying
       everything") is a power fantasy, not a library lookup: it goes to
       the Workshop for a composed power/survival dossier, never the
       stock card. Creative briefs keep the workshop path below. */
    /* v2.23.0: BUILD CHECKER — "check my <item> build: <mods>" is a
       verification request, not a build request: it must be caught
       before the power/workshop/template paths below would happily
       compose a NEW build and ignore the Tenno's own. */
    var checkHit = checkBuildIntent(t);
    if (checkHit) return checkHit;
    var pwPlan = powerPlan(q);
    if (pwPlan) return workshopHandoffHtml(pwPlan);
    var wsPlanFound = workshopPlan(q);
    if (wsPlanFound) return workshopHandoffHtml(wsPlanFound);
    /* v2.19.6: qualifiers are enforced, not decorative. A budget / beginner /
       status / crit ask for a named item is answered by qualifiedBuildAnswer
       BEFORE the one-shot templates and library interception below, which
       know nothing of qualifiers and would serve the default build. */
    var quals = parseQualifiers(t);
    if (anyQualifier(quals) && /\b(build|setup|loadout|steel\s?path|one[\s-]?shot)\b/.test(t)) {
      var qFound = resolveNamedItem(t);
      if (qFound) {
        var qAns = qualifiedBuildAnswer(qFound, quals, t);
        if (qAns) return qAns;
      }
    }
    /* curated 8-mod templates for meta one-shot weapons (with WHY for each mod) */
    var templateKeys = Object.keys(ONE_SHOT_TEMPLATES);
    for (var ti = 0; ti < templateKeys.length; ti++) {
      if (t.indexOf(templateKeys[ti]) !== -1) {
        return oneShotTemplateAnswer(templateKeys[ti]);
      }
    }
    /* one-shot builds from the build library (builds.json) — covers every
       curated one-shot build automatically, including new additions */
    var libHit = oneShotBuildAnswer(t);
    if (libHit) return libHit;
    /* BUILD INTENT — catch this FIRST, before anything else. If the player wants
       a build for a specific item, generate it. Handles: "make me a nova prime
       steelpath build", "wisp prime one shot", "rhino build", etc. */
    var buildIntent = /\b(build|make|setup|loadout|steel\s?path|one[\s-]?shot)\b/.test(t);
    if (buildIntent) {
      var bp = parseBuildQ(t);
      if (bp.name.length >= 3) {
        var bf = findItemForBuild(bp.name);
        if (bf) {
          /* v2.12.68: curated Steel Path frame builds (with aura/exilus/arcanes)
             win over the generic generator for these frames */
          if (bf.kind === 'warframe' && bp.purpose.steelPath) {
            var spKey = norm(bf.e.name).replace(/\s+prime$/, '');
            var spHit = spFrameBuildAnswer(spKey);
            if (spHit) return spHit;
          }
          return bf.kind === 'warframe'
            ? genWarframeBuild(bf.e, bp.purpose)
            : genWeaponBuild(bf.e, bp.purpose);
        }
      }
      /* item name might be embedded without clear build words stripped right —
         try matching any known warframe/weapon name appearing in the question
         (v2.23.1: via the entity-first resolver, word-boundary net included) */
      var fw2found = resolveNamedItem(t);
      if (fw2found && fw2found.kind === 'warframe') {
        var fw2 = fw2found.e;
        /* v2.12.68: curated Steel Path frame builds win here too */
        if (/steel/.test(t)) {
          var fw2Hit = spFrameBuildAnswer(norm(fw2.name).replace(/\s+prime$/, ''));
          if (fw2Hit) return fw2Hit;
        }
        return genWarframeBuild(fw2, parseQualifiers(t));
      }
      if (fw2found) return genWeaponBuild(fw2found.e, parseQualifiers(t));
      /* v2.23.0: no item named, but the phrasing is a recommendation
         ("what's a good weapon for steel path" — "steel path" alone
         tripped the build intent) → the recommender answers it with
         reasons, not the generic build list */
      var recoInBuild = recoDetect(t);
      if (recoInBuild) {
        var recoBuildHit = recommendAnswer(t, recoInBuild);
        if (recoBuildHit) return recoBuildHit;
      }
      /* v2.19.5: "how do I make platinum/credits" names no item — that's the
         trading answer, not a build request (the word "make" used to hijack it) */
      if (/\b(platinum|plat|credits?)\b/.test(t)) return sellAnswer();
      /* no specific item found — recommend instead of dead-ending */
      return genericBuildAnswer(t, bp.purpose);
    }
    /* v2.19.0: curated knowledge base — doctrine, explainers, playstyle picks.
       Runs after the build generator so "X build" still builds, and before the
       sell/farm intents so Riven-trading status and trading basics win over
       the generic platinum answer. */
    var know = knowledgeAnswer(t);
    if (know) return know;
    if (/\bi'?m new\b/.test(t) || /\bnew player\b/.test(t) || /\bjust started\b/.test(t) ||
        /\bwhat should i do first\b/.test(t) || /\bwhere do i start\b/.test(t) ||
        /\bbeginner (guide|tips|help)\b/.test(t)) {
      return beginnerAnswer();
    }
    /* v2.23.0: RECOMMENDATION intent — "find me a good warframe",
       "what's a good weapon for steel path", "what frame should I
       play". Runs after the curated knowledge base (doctrine keeps
       its answers) and before the sell/farm matchers below, which
       used to swallow these phrasings and dead-end them. The
       recommender answers from the Vault's data — never a punt. */
    var recoDet = recoDetect(t);
    if (recoDet) {
      var recoHit = recommendAnswer(t, recoDet);
      if (recoHit) return recoHit;
    }
    if (t.indexOf('sell') !== -1 || t.indexOf('platinum') !== -1 || t.indexOf('trade') !== -1) {
      return sellAnswer();
    }

    var m;
    m = t.match(/^what does (.+?) do$/);
    if (m) {
      var thing = m[1];
      var mod = findByName(D.mods, thing);
      if (mod) return describeAnswer(mod, 'mods.html');
      var arc = findByName(D.arcanes, thing);
      if (arc) return describeAnswer(arc, 'arcanes.html');
      return 'Hmm, I don\'t know a mod or arcane called "' + esc(thing) + '". 🤔 ' +
        'Check the spelling — or browse the <a href="mods.html">mods list</a>. Or research it directly:' +
        researchMarkup(thing);
    }

    m = t.match(/^(?:where (?:do|can) i (?:farm|get|find|hunt|grind)|where to (?:farm|get|find|hunt|grind)|how do i (?:get|farm|obtain|find|hunt|grind)|how to (?:get|farm|obtain|find|hunt|grind)|farm|get|find|hunt|grind) (.+)$/);
    if (m) {
      /* v2.12.47: "hunt for X" / "grind for X" — strip the leading "for" so the lookup gets the item */
      m[1] = m[1].replace(/^for\s+/i, '');
      var q = m[1].toLowerCase();
      /* general "best farm" questions — conversational answer, not a lookup */
      if (/best (?:place|spot|mission|way)|most (?:efficient|resources)|one mission/.test(q)) {
        return 'Good question — depends what you need most, but here are the best all-around spots:<br><br>' +
          '<b>Gabii, Ceres</b> (Dark Sector Survival) — the classic. Orokin Cells drop here plus tons of common resources. Bring a Nekros or Khora for extra loot.<br><br>' +
          '<b>Helene, Saturn</b> — another Orokin Cell spot, great for leveling weapons while you farm.<br><br>' +
          '<b>Void Cascade (Zariman)</b> — you\'re already going there. Thrax drop arcanes, plus Zariman resources like Voidplumes.<br><br>' +
          'If you tell me <i>which</i> resource you\'re after, I can point you to the single best node for it.';
      }
      var f = findFarm(m[1]);
      if (f) return farmAnswer(f);
      /* didn't find a specific item — try category-level knowledge before giving up */
      var catAnswer = categoryFarmAnswer(m[1].toLowerCase());
      if (catAnswer) return catAnswer;
      return 'Hmm, I couldn\'t find a farm spot for "' + esc(m[1]) + '" in the Vault. ' +
        'Try the full item name — or check the <a href="resources.html">Resource Finder</a> to search everything.';
    }

    /* Category-level farm knowledge: when someone asks about a TYPE of thing,
       not a specific item. This is what makes it feel like a real AI. */
    function categoryFarmAnswer(q) {
      if (/operator arcane|magus arcane|magus/.test(q)) {
        return 'Operator arcanes (Magus arcanes) come from two vendors:<br><br>' +
          '<b>Quills (Cetus, via Onkko)</b> — Magus Husk, Magus Vigor, Magus Cadence, Magus Cloud, Magus Replenish, Magus Elevate, Magus Nourish. Trade in Eidolon Shards and Sentient cores.<br><br>' +
          '<b>Vox Solaris (Fortuna, via Little Duck)</b> — Magus Lockdown, Magus Anomaly, Magus Drive, Magus Repair, Magus Destruct, Magus Firewall, Magus Melt, Magus Overload, Magus Accelerant, Magus Glitch, Magus Revert. 10,000 Standing each; Lockdown needs rank Instrument, Repair needs rank Shadow.<br><br>' +
          'If you tell me <i>which</i> Magus arcane you want, I\'ll give you the exact vendor and cost.';
      }
      if (/amp arcane|eternal|virtuos/.test(q)) {
        return 'Amp arcanes come from three places:<br><br>' +
          '<b>Quills (Cetus)</b> — Virtuos Strike, Virtuos Shadow, Virtuos Tempo, Virtuos Null, Virtuos Fury, Virtuos Ghost.<br><br>' +
          '<b>Vox Solaris (Fortuna, via Little Duck)</b> — Virtuos Forge, Virtuos Trojan, Virtuos Spike, Virtuos Surge.<br><br>' +
          '<b>Zariman</b> — Eternal Eradicate, Eternal Onslaught, Eternal Logistics (drops from Void Angels and Thrax).<br><br>' +
          'For your 777: <b>Virtuos Strike</b> from Quills + <b>Eternal Eradicate</b> from Zariman is the meta combo.';
      }
      if (/warframe arcane|molt|guardian|energize/.test(q)) {
        return 'Warframe arcanes mostly come from <b>Eidolon hunts</b> (Teralyst, Gantulyst, Hydrolyst on Plains of Eidolon at night). ' +
          'Arcane Energize, Guardian, Grace, etc. all drop there.<br><br>' +
          'The newer <b>Molt</b> arcanes (Molt Augmented, Molt Efficiency) come from <b>Thrax enemies in Zariman missions</b> — which is why Void Cascade is so good for farming them.<br><br>' +
          'Tell me which specific arcane and I\'ll narrow it down.';
      }
      if (/adapter/.test(q) && /arcane|melee|primary|secondary|weapon/.test(q)) {
        return 'Arcane Adapters (unlock the arcane slot on a weapon — one per weapon):<br><br>' +
          '<b>Melee Arcane Adapter</b> — Market for <b>20 Platinum</b>, OR <b>Bird 3 (Cavia)</b> for <b>50,000 Standing</b> (needs Rank 3 - Colleague), OR as a reward from <b>Netracells / Deep Archimedea</b>. Needs the <b>Whispers in the Walls</b> quest done + the Melee Upgrade Segment.<br><br>' +
          '<b>Primary / Secondary Arcane Adapter</b> — <b>Teshin (Steel Path Honors)</b> for <b>15 Steel Essence</b> each, OR Market for 20 Platinum, OR Acrithis for 25 Pathos Clamp.<br><br>' +
          'Note: adapters are NOT drops from Acolytes — Acolytes drop the arcanes themselves.';
      }
      if (/primary arcane|secondary arcane|melee arcane|merciless|deadhead|encumber/.test(q)) {
        return 'Weapon arcanes:<br><br>' +
          '<b>Primary/Secondary Merciless, Deadhead, Dexterity</b> — drop from <b>Acolytes in Steel Path</b> missions.<br><br>' +
          '<b>Secondary Encumber</b> — <b>Mirror Defense</b> (Tyana Pass, Mars), NOT Acolytes.<br><br>' +
          '<b>Melee arcanes</b> (the ones that slot into a melee weapon — Crescendo, Influence, Duplicate, Animosity, Exposure, Retaliation, Fortification, Vortex) — <b>Bird 3 (Cavia)</b> vendor, <b>The Fragmented / Effervo</b>, <b>Netracells</b> and <b>Deep Archimedea</b>. The Legendary ones (Crescendo, Influence, Duplicate) come from Netracells / Deep Archimedea. <b>Melee Afflictions</b> — Ascension Sister of Parvos, or Ordis for Vestigial Motes. <b>Melee Doughty</b> — Höllvania / The Hex (1999). You need the Melee Upgrade Segment + a Melee Arcane Adapter to use them.<br><br>' +
          'Run Steel Path missions and hunt the Acolyte when it spawns — that\'s your farm for Merciless / Deadhead / Dexterity.';
      }
      if (/corrupted mod|blind rage|narrow minded|transient/.test(q)) {
        return 'Corrupted mods <b>only</b> drop from <b>Orokin Vaults on Deimos</b>. ' +
          'Grab a Dragon Key from your Dojo, run Horend or Phlegyas (capture missions), find the vault door, open it. ' +
          'Each run gives you one random Corrupted mod — Blind Rage, Narrow Minded, Transient Fortitude, Fleeting Expertise, etc.';
      }
      if (/60\/60|dual stat/.test(q)) {
        return '60/60 dual-stat mods:<br><br>' +
          '<b>Spy missions</b> — each faction\'s Spy drops their 60/60s (Corpus Spy for electric/cold, Grineer Spy for heat/toxin).<br><br>' +
          '<b>Nightmare missions</b> — some 60/60s are Nightmare-exclusive.<br><br>' +
          'Run the Spy vaults perfectly (all 3) for the best drop chance.';
      }
      if (/galvanized/.test(q)) {
        return 'Galvanized mods come from <b>Arbitrations</b> — buy them from the Arbitration vendor in the Arbiters of Hexis room at any Relay for <b>20 Vitus Essence</b> each. ' +
          'Acolytes in Steel Path drop Steel Path weapon arcanes and Steel Essence, not Galvanized mods.';
      }
      if (/prime part|prime blueprint|relic/.test(q)) {
        return 'Prime parts come from <b>Void Relics</b> — run Fissure missions to crack them open.<br><br>' +
          'Check the <a href="relics.html">Relics page</a> to see which relic drops the specific part you need, and where to farm that relic.';
      }
      if (/kuva weapon|kuva lich/.test(q)) {
        return 'Kuva weapons come from <b>Kuva Liches</b>:<br><br>' +
          '1. Find a Kuva Larvling on a Grineer mission (level 20+), kill it with a finisher<br>' +
          '2. Your Lich spawns — hunt it across the star chart<br>' +
          '3. Figure out the Requiem mod order, kill your Lich<br>' +
          '4. Claim the Kuva weapon<br><br>' +
          'The progenitor Warframe determines the bonus element. Check the <a href="liches.html">Liches guide</a> for the full walkthrough.';
      }
      if (/tenet|sister/.test(q)) {
        return 'Tenet weapons come from <b>Sisters of Parvos</b> (Corpus Liches):<br><br>' +
          '1. Run a Corpus Granum Void mission, get 25 kills to spawn a Candidate<br>' +
          '2. Down the Candidate with a finisher to make her your Sister<br>' +
          '3. Hunt her across the star chart like a Lich<br><br>' +
          'Full guide on the <a href="liches.html">Liches page</a>.';
      }
      if (/archon shard|tauforged/.test(q)) {
        return 'Archon Shards:<br><br>' +
          '<b>Normal shards</b> — drop from <b>Archon Hunts</b> (weekly mission).<br><br>' +
          '<b>Tauforged shards</b> (stronger version) — rare drop from <b>Archon Hunts</b> and <b>Netracells</b>.<br><br>' +
          'Check the <a href="shards.html">Archon Shards page</a> for every color and what they do.';
      }
      if (/eidolon|teralyst|hydrolyst|gantulyst/.test(q)) {
        return 'Eidolon hunts happen on the <b>Plains of Eidolon at night</b> (Cetus).<br><br>' +
          'You need: a good amp (your 777 works), Madurai focus school, and ideally Chroma/Rhino/Volt for the team.<br><br>' +
          'Teralyst → Gantulyst → Hydrolyst in order. They drop Arcanes, Eidolon Shards (for Quills standing), and Sentient cores.';
      }
      return null;
    }

    m = t.match(/^is (.+?) good(?: for (.+?))?$/) || t.match(/^how (?:is|good is) (.+?)(?: for (.+?))?$/);
    if (m) {
      var itemQ = stripArticles(m[1]), ctx = m[2] || '';
      var fw = findByName(D.warframes, itemQ);
      var fp = findByName(D.weapons, itemQ);
      var it = fw || fp;
      if (it) {
        var isSP = /steel/.test(ctx) || /steel/.test(t);
        var verdict = isSP
          ? 'Oh yeah — <b>' + esc(it.name) + '</b> can absolutely hang in Steel Path with the right build. 💪 '
          : '<b>' + esc(it.name) + '</b>? Solid pick, Tenno. ';
        var genQ = it.name + ' build' + (isSP ? ' steel path' : '');
        var gb = generateBuild(genQ);
        return verdict + 'Here\'s a build to make it shine:' +
          (gb ? gb.replace(/^<b>[^<]+<\/b> <span[^>]+>[^<]+<\/span>(<p>[^<]*<\/p>)?/, '') : '') +
          '<p class="muted small">Want the farm location too? Just ask <i>"where do I get ' + esc(it.name) + '"</i>.</p>';
      }
    }

    m = t.match(/^(?:best |strongest )?(.+?) build$/) || t.match(/^(?:best |strongest )?build for (.+)$/) ||
        t.match(/^make(?: me)?(?: a)? (.+?) build$/) || t.match(/^(?:can you )?make(?: me)? (.+)$/);
    if (m) {
      /* try curated build first, then GENERATE one */
      var b = findBuild(m[1]);
      if (b && buildIsValid(b)) return buildAnswer(b); /* v2.19.5: validate-on-serve */
      var gen = generateBuild(t);
      if (gen) return gen;
      /* last resort: suggest closest */
      var sug = findItemForBuild(m[1]) || findItemForBuild(t);
      if (sug) return generateBuild(sug.e.name + ' build');
      return 'Hmm, I couldn\'t pin down which item you mean. 🤔 Try the full name — like <i>"Nova Prime build"</i> or <i>"Kuva Zarr build"</i>. ' +
        'Or ask <i>"help"</i> to see what I can do — or research it:' + researchMarkup(q);
    }

    m = t.match(/^what is (?:a |an |the )?(.+)$/);
    if (m) {
      var w = findByName(D.warframes, m[1]);
      if (w) return describeAnswer(w, 'warframes.html');
      var wp = findByName(D.weapons, m[1]);
      if (wp) return describeAnswer(wp, 'weapons.html');
      var md = findByName(D.mods, m[1]);
      if (md) return describeAnswer(md, 'mods.html');
      var ar = findByName(D.arcanes, m[1]);
      if (ar) return describeAnswer(ar, 'arcanes.html');
    }

    /* v2.23.1: genuinely item-less build browsing — "show me popular
       builds", "what's strong right now", a bare "builds?" — is the ONE
       doorway to the curated popular list, guarded by entity-first:
       if ANY item resolved in the question, its own paths above have
       already answered and this is unreachable. (These phrasings used
       to fall into the don't-know research punt.) */
    if (!resolveNamedItem(t) &&
        (/\bpopular builds?\b/.test(t) || /\bwhat'?s strong( right now)?\b/.test(t) ||
         /\bstrongest builds?\b/.test(t) || /^builds?\??$/.test(t))) {
      return genericBuildAnswer(t, parseQualifiers(t));
    }

    return fallbackAnswer(t);
  }

  /* ---------- UI ---------- */
  var els = {};

  var lastAskQ = '';
  function addMsg(html, who) {
    var d = document.createElement('div');
    d.className = 'vai-msg ' + who;
    if (who === 'user') {
      d.textContent = html;
    } else {
      d.innerHTML = html;
    }
    els.msgs.appendChild(d);
    els.msgs.scrollTop = els.msgs.scrollHeight;
    /* v2.23.0: 👍/👎 + follow-up chips on real answers (both modules
       self-qualify — greetings, progress and don't-knows get neither) */
    if (who === 'bot') {
      try { if (window.TVLearn) TVLearn.attachFeedback(d, (lastAskQ + ' ' + html).slice(0, 900)); } catch (e) {}
      try { if (window.TVChips) TVChips.attach(d, lastAskQ, html, function (qq) { ask(qq); }); } catch (e) {}
      try { if (window.TVVoice) TVVoice.speakAnswer(html); } catch (e) {}
    }
    return d;
  }

  function ask(q) {
    if (!q) return;
    lastAskQ = q;
    addMsg(q, 'user');
    els.input.value = '';
    /* v2.20.0: on-device memory (this device only) + "my usual" */
    if (window.TVMemory) {
      TVMemory.recordExchange(q);
      var usualQ = TVMemory.resolveUsual(q);
      if (usualQ) q = usualQ;
    }
    /* v2.19.0: live questions go to the worldstate feed, not stored data */
    if (window.TVLive && window.TVLive.isLive(q)) {
      window.TVLive.answer(q).then(function (html) {
        addMsg(html || 'The live feed didn\'t have that — check the <a href="live.html">Live page</a>.', 'bot');
      }).catch(function () {
        addMsg('The live feed didn\'t answer just now — check the <a href="live.html">Live page</a>.', 'bot');
      });
      return;
    }
    loadData().then(function () {
      var html = answer(q);
      /* v2.22.0: a creative build brief is a Workshop handoff — the
         Workshop researches the item (staged progress + Stop) and
         composes an original build from real mods. Checked before the
         miss path: a handoff is not a miss. */
      if (window.TVWorkshop && TVAI._workshopIsHandoff(html)) {
        TVWorkshop.handle(q, html, els.msgs, function (h) { addMsg(h, 'bot'); });
      } else if (window.TVWorkshop && TVAI._checkerIsHandoff(html) && TVWorkshop.handleCheck) {
        /* v2.23.0: build-checker handoff — real drain fetch, then the verdict */
        TVWorkshop.handleCheck(q, html, els.msgs, function (h) { addMsg(h, 'bot'); });
      } else if (window.TVResearch && TVResearch.isMiss(html)) {
        /* v2.22.0: research-first — dig deep, then answer in prose */
        if (TVResearch.handleConverse) TVResearch.handleConverse(q, html, els.msgs, function (h) { addMsg(h, 'bot'); }, { isMiss: true });
        else TVResearch.handleMiss(q, html, els.msgs, function (h) { addMsg(h, 'bot'); });
      } else {
        addMsg(html, 'bot');
      }
    }).catch(function () {
      addMsg('Couldn\'t load the Vault\'s data — try the retry button on the page, or reload.', 'bot');
    });
  }

  function toggle(open) {
    var show = typeof open === 'boolean' ? open : els.panel.style.display !== 'flex';
    els.panel.style.display = show ? 'flex' : 'none';
    if (els.btn) els.btn.classList.toggle('open', show);
    /* v2.19.1: restore Vaulty on close (see js/ai.js / js/mentor.js) */
    if (!show) {
      try { document.dispatchEvent(new CustomEvent('tv-ai-panel-closed')); } catch (e) {}
    }
    if (show && !opened) {
      opened = true;
      addMsg('Hey Tenno! ◈ Welcome to the Vault — I\'m your built-in guide. ' +
        'Ask me to <b>build</b> something ("make me a Nova Prime Steel Path build"), ' +
        'tell you <b>where to farm</b> anything ("where do I find Argon Crystals"), ' +
        'or explain <b>mods, arcanes, and platinum trading</b>. What are you working on?', 'bot');
      loadData().catch(function () {
        addMsg('Heads up: the Vault data didn\'t load — answers may be limited until you reload.', 'bot');
      });
    }
    if (show) setTimeout(function () { els.input.focus(); }, 60);
  }

  var CHIPS = [
    'One-shot formula?',
    'Kuva Zarr build',
    'Where do I farm Argon Crystals?',
    'How do I sell for platinum?',
    'Steel Path build guide'
  ];

  function init() {
    if (document.getElementById('vault-ai-panel') || !window.TV) return;
    /* v2.12.15: floating "Ask the Vault" button removed — Vaulty is the entry point now. */
    /* v2.12.29: reset chat history every 24h to prevent memory bloat/crashes */
    try {
      var lastReset = parseInt(localStorage.getItem('tv-chat-reset') || '0', 10);
      var now = Date.now();
      if (now - lastReset > 24 * 60 * 60 * 1000) {
        try { localStorage.removeItem('tv-chat-history'); } catch (e) {}
        localStorage.setItem('tv-chat-reset', String(now));
      }
    } catch (e) {}

    var panel = document.createElement('div');
    panel.id = 'vault-ai-panel';
    panel.style.display = 'none';
    panel.innerHTML =
      '<div class="vai-head"><span>◈ Vault Guide</span>' +
      '<button id="vai-close" type="button" aria-label="Close">⌄</button></div>' +
      '<div id="vai-msgs"></div>' +
      '<div class="vai-chips">' +
      CHIPS.map(function (c) { return '<button type="button" class="vai-chip">' + esc(c) + '</button>'; }).join('') +
      '</div>' +
      '<div class="vai-foot">' +
      '<button type="button" id="vai-mem-btn" class="vai-mem-btn">🧠 What Vaulty remembers</button>' +
      '<p class="muted small">Unanswered questions are logged anonymously so Vaulty can learn them. ' +
      'Vaulty\'s memory of you stays on this device — nothing is uploaded.</p></div>' +
      '<form id="vai-form"><input id="vai-input" type="text" autocomplete="off" ' +
      'placeholder="Ask about builds, farms, mods…" aria-label="Ask the Vault">' +
      '<button type="submit" aria-label="Send">➤</button></form>';

    document.body.appendChild(panel);

    els = {
      btn: null, panel: panel,
      msgs: panel.querySelector('#vai-msgs'),
      input: panel.querySelector('#vai-input'),
      form: panel.querySelector('#vai-form')
    };

    panel.querySelector('#vai-close').addEventListener('click', function () { toggle(false); });
    var memBtn2 = panel.querySelector('#vai-mem-btn');
    if (memBtn2) memBtn2.addEventListener('click', function () {
      if (window.TVMemory) addMsg(TVMemory.viewHtml() + (window.TVLearn ? TVLearn.viewHtml() : ''), 'bot');
    });
    els.form.addEventListener('submit', function (e) {
      e.preventDefault();
      ask(els.input.value.trim());
    });
    panel.querySelectorAll('.vai-chip').forEach(function (chip) {
      chip.addEventListener('click', function () { ask(chip.textContent); });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && panel.style.display === 'flex') toggle(false);
    });
  }

  window.TVAI = {
    init: init, toggle: toggle, _answer: answer, _load: loadData, _research: researchMarkup,
    _validateAnswer: validateAnswerText,
    /* v2.22.0: Workshop hooks for js/vaulty-workshop.js */
    _workshopPlan: workshopPlan,
    _workshopCompose: workshopCompose,
    _workshopRender: workshopRender,
    _workshopDossier: buildDossier,
    _workshopFallback: workshopFallback,
    _workshopIsHandoff: function (html) { return String(html || '').indexOf('vai-workshop-handoff') !== -1; },
    /* v2.23.0: build checker + recommender hooks */
    _checkerIsHandoff: function (html) { return String(html || '').indexOf('vai-checker-handoff') !== -1; },
    _checkBuildReport: checkBuildReport,
    _recoDetect: recoDetect,
    _recommend: recommendAnswer,
    _workshopVerify: function (build, drains) {
      if (!build || !buildIsValid(build)) return null;
      return wsCapacity(build, drains);
    }
  };
})();
