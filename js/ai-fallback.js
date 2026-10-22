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
    for (i = 0; i < list.length; i++) { if (norm(list[i].name).indexOf(q) !== -1) return list[i]; }
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
    var w = findByName(D.warframes, q);
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
    var wp = findByName(D.weapons, q);
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
      'And if I genuinely don\'t know something, I\'ll say so and give you one-tap research buttons instead of guessing.</p>';
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

  function fallbackAnswer(q) {
    var hits = D.index.filter(function (e) {
      return e.n && norm(e.n).indexOf(norm(q)) !== -1;
    }).slice(0, 5);
    if (!hits.length) {
      return 'Straight up: I don\'t know that one — "' + esc(q) + '" isn\'t in the Vault\'s data, and I won\'t make something up. 🤔 ' +
        'You can research it in one tap:' + researchMarkup(q) +
        '<p class="muted small">Or ask me about a warframe, weapon, mod, arcane, or relic by name — or say <i>"help"</i> to see everything I can do.</p>';
    }
    var rows = hits.map(function (h) {
      return '<li><a href="' + esc(h.u) + '"><b>' + esc(h.n) + '</b></a> ' +
        '<span class="muted small">' + esc(h.t) + '</span></li>';
    }).join('');
    return 'I didn\'t quite catch that — did you mean one of these?<ul>' + rows + '</ul>' +
      '<p class="muted small">Or rephrase — I\'m best with things like <i>"make me a Rhino build"</i> or <i>"where do I farm Orokin Cells"</i>.</p>';
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
    '<p class="muted small">Want to know where to farm any of these mods? Just ask <i>"where do I farm ' +
    esc(picks[0] ? picks[0].mod.name : 'this mod') + '"</i>.</p>' +
    '<p><a href="' + link(page, itemName) + '">Full ' + esc(itemName) + ' page &rarr;</a> · ' +
    '<a href="builds.html">Curated builds &rarr;</a></p>';
}

/* ===== WARFRAME BUILD GENERATOR ===== */
function genWarframeBuild(frame, purpose) {
  var picks = [];
  var armor = frame.armor || 0, energy = frame.energy || 150;

  function add(name, reason) {
    if (picks.length >= 8) return;
    var p = pick(name, reason);
    if (p && !picks.some(function (x) { return x.mod.name === p.mod.name; })) picks.push(p);
  }

  /* core survivability */
  add('Vitality', 'Core survivability — more health keeps you alive through burst damage.');
  if (armor >= 150) add('Steel Fiber', 'Your ' + armor + ' base armor makes this huge — armor scales your effective health.');
  else add('Redirection', 'Boosts shields since your base armor is low.');

  /* ability stats */
  add('Intensify', 'Ability Strength powers up everything ' + frame.name + ' does.');
  add(purpose.beginner ? 'Continuity' : 'Primed Continuity', 'Ability Duration — longer buffs, longer CC, less recasting.');
  if (energy <= 175) add(purpose.beginner ? 'Flow' : 'Primed Flow', 'Bigger energy pool so you can actually cast.');
  add('Stretch', 'Ability Range — hits more enemies, covers more ground.');

  /* purpose-specific */
  if (purpose.steelPath) {
    add('Adaptation', 'Steel Path essential — stacking damage resistance keeps you alive at high levels.');
    add('Rolling Guard', 'Brief invulnerability on dodge — dodges one-shots in Steel Path.');
  }
  if (purpose.oneShot) {
    add('Blind Rage', 'Massive Ability Strength for one-shot ability damage (watch the efficiency hit).');
    add('Transient Fortitude', 'More strength for the nuke — pair with Fleeting Expertise if energy suffers.');
  }
  /* fill remaining */
  add('Augur Secrets', 'Extra strength plus shield-gating synergy.');
  add('Fleeting Expertise', 'Efficiency for spamming abilities.');
  add('Natural Talent', 'Faster casting — less time vulnerable mid-animation.');
  add('Cunning Drift', 'Slide + range in one slot.');
  add('Constitution', 'Duration plus faster knockdown recovery.');

  var notes = purpose.steelPath
    ? 'Steel Path tip: shield-gating (brief shield regen = invulnerability) matters more than raw health at high levels. Rolling Guard + Adaptation is the standard survival package.'
    : 'Level the mods as you get Endo — even rank 6-8 mods carry you through the star chart.';
  return renderLoadout(frame.name + ' build', frame.name, picks,
    notes + ' Shard/arcane picks depend on your focus school — check the full page.', 'warframes.html', purpose);
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
  var isCrit = cc >= 18, isStatus = sc >= 18;

  function add(name, reason) {
    if (picks.length >= 8) return;
    var p = pick(name, reason);
    if (p && !picks.some(function (x) { return x.mod.name === p.mod.name; })) picks.push(p);
  }

  if (cls === 'melee') {
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

  var notes = purpose.steelPath
    ? 'Steel Path notes: Viral + Hunter Munitions slash procs bypass armor — that\'s the one-shot formula. Swap the faction Bane mod per mission.'
    : 'Level these gradually — a half-ranked core build beats a wishlist of unranked mods.';
  return renderLoadout(weapon.name + ' build', weapon.name, picks, notes, 'weapons.html', purpose);
}

/* extract item name + purpose from a build question */
function parseBuildQ(t) {
  var purpose = {
    steelPath: /steel\s?path/.test(t),
    oneShot: /one[\s-]?shot/.test(t),
    beginner: /beginner|starter|early|new player/.test(t)
  };
  /* strip build-related words to isolate the item name */
  var q = t
    .replace(/^(can you |please |hey |hi )?make( me)?/,'')
    .replace(/\b(a|an|the)\b/g,' ')
    .replace(/\b(build|setup|loadout)\b/g,' ')
    .replace(/\bfor\b/g,' ')
    .replace(/\b(best|strongest|good|top)\b/g,' ')
    .replace(/\bsteel\s?path\b/g,' ')
    .replace(/\bone[\s-]?shot\b/g,' ')
    .replace(/\bbeginner|starter|early\b/g,' ')
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

/* main entry: generate a build for any item */
function generateBuild(t) {
  var parsed = parseBuildQ(t);
  var found = findItemForBuild(parsed.name);
  if (!found) {
    /* try the raw question in case parsing stripped too much */
    found = findItemForBuild(t.replace(/\b(build|make|for|me|a|please)\b/g,' ').replace(/\s+/g,' ').trim());
  }
  if (!found) return null;
  if (found.kind === 'warframe') return genWarframeBuild(found.e, parsed.purpose);
  return genWeaponBuild(found.e, parsed.purpose);
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
  return '<b>' + esc(t.title) + '</b>' +
    '<p class="muted small">Riven-less Steel Path build — aura, exilus, and arcanes included. Every mod has a WHY.</p>' +
    card +
    rows +
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
  return '<b>' + esc(t.title) + '</b><p class="muted small">Riven-less. Every mod below has a WHY — ' +
    'this is the reasoning, not just a list.</p>' + card + rows +
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
      return opinionAnswer(item, t);
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

  function answer(q) {
    var t = stripQ(q);
    if (!t) return 'Ask me something — a build, a farm spot, a mod, or "help".';

    /* v2.12.31: conversational layer first — personality, opinions, casual chat */
    var convo = conversationalAnswer(t, q);
    if (convo) return convo;

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
      var spItem = findItemInText(D.warframes, t) || findItemInText(D.weapons, t);
      if (!spItem) return STEEL_PATH_GENERAL;
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
         try matching any known warframe/weapon name appearing in the question */
      var fw2 = findItemInText(D.warframes, t);
      if (fw2) {
        /* v2.12.68: curated Steel Path frame builds win here too */
        if (/steel/.test(t)) {
          var fw2Hit = spFrameBuildAnswer(norm(fw2.name).replace(/\s+prime$/, ''));
          if (fw2Hit) return fw2Hit;
        }
        return genWarframeBuild(fw2, { steelPath: /steel/.test(t), oneShot: /one/.test(t) });
      }
      var wp2 = findItemInText(D.weapons, t);
      if (wp2) return genWeaponBuild(wp2, { steelPath: /steel/.test(t), oneShot: /one/.test(t) });
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

    return fallbackAnswer(t);
  }

  /* ---------- UI ---------- */
  var els = {};

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
  }

  function ask(q) {
    if (!q) return;
    addMsg(q, 'user');
    els.input.value = '';
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
      addMsg(answer(q), 'bot');
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

  window.TVAI = { init: init, toggle: toggle, _answer: answer, _load: loadData, _research: researchMarkup, _validateAnswer: validateAnswerText };
})();
