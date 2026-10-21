/* The Foundry — live worldstate + platinum prices */
(function () {
  'use strict';
  var esc = function (s) { return window.TV.esc(s); };

  /* HH:MM:SS formatter for live ticking countdowns */
  function fmtHMS(ms) {
    if (!(ms > 0)) return 'updating…';
    var s = Math.floor(ms / 1000);
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return p(h) + ':' + p(m) + ':' + p(sec);
  }

  function fmtCountdown(iso) {
    try { return fmtHMS(new Date(iso).getTime() - Date.now()); }
    catch (e) { return '--:--:--'; }
  }

  /* one shared 1s ticker: recomputes every [data-countdown] from Date.now(),
     so timers stay accurate even after the tab was backgrounded */
  var lastCycleRefresh = 0;
  function tickCountdowns() {
    var els = document.querySelectorAll('[data-countdown]');
    var now = Date.now();
    var expired = false;
    for (var i = 0; i < els.length; i++) {
      var iso = els[i].getAttribute('data-countdown');
      var ms = new Date(iso).getTime() - now;
      if (ms <= 0) expired = true;
      els[i].textContent = fmtHMS(ms);
    }
    /* a cycle just flipped — refresh immediately for the new state (max once per 10s) */
    if (expired && typeof loadWorld === 'function' && now - lastCycleRefresh > 10000) {
      lastCycleRefresh = now;
      try { loadWorld(); } catch (e) {}
    }
  }

  /* span that the 1s ticker keeps live */
  function liveCd(iso) {
    return '<span data-countdown="' + esc(iso || '') + '">' + fmtCountdown(iso) + '</span>';
  }

  /* ---------------- worldstate ---------------- */
  function cycleCard(title, state, expiryIso, icon, nextState) {
    var expiry = new Date(expiryIso);
    var timeStr = expiry.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return '<div class="card"><div class="icon">' + icon + '</div><h3>' + esc(title) + '</h3>' +
      '<p style="font-size:1.15rem;font-weight:700">' + esc(state) + '</p>' +
      '<p class="muted small">⏱ ' + liveCd(expiryIso) + ' left</p>' +
      '<p style="font-size:1.05rem;margin-top:6px">→ <b>' + esc(nextState) + '</b> at ' + esc(timeStr) + '</p></div>';
  }

  var lastUpdate = 0;

  function timeAgo() {
    var s = Math.floor((Date.now() - lastUpdate) / 1000);
    if (s < 5) return 'just now';
    if (s < 60) return s + 's ago';
    return Math.floor(s / 60) + 'm ago';
  }

  function renderIncoming(d) {
    var items = [];
    /* alerts */
    (d.alerts || []).forEach(function (a) {
      items.push({ title: '🚨 Alert: ' + (a.mission ? a.mission.type : 'Alert'),
        sub: (a.mission ? a.mission.node : '') + ' vs ' + (a.mission ? a.mission.faction : ''),
        expiry: a.expiry, kind: 'alert' });
    });
    /* events */
    (d.events || []).forEach(function (e) {
      if (e.expiry) items.push({ title: '🎉 ' + (e.description || 'Event'), sub: '', expiry: e.expiry, kind: 'event' });
    });
    /* sort by soonest expiry */
    items.sort(function (a, b) { return new Date(a.expiry) - new Date(b.expiry); });
    if (!items.length) return '';
    var html = '<h2>🔔 Incoming — ending soon</h2><div class="item-list">';
    items.slice(0, 10).forEach(function (it) {
      html += '<div class="list-item incoming-pulse"><h3>' + esc(it.title) + '</h3>' +
        '<p class="muted small">' + esc(it.sub) + (it.sub ? ' · ' : '') +
        'ends in ⏱ <b>' + liveCd(it.expiry) + '</b></p></div>';
    });
    return html + '</div>';
  }

  function renderWorld(d) {
    lastUpdate = Date.now();
    var html = '<p class="muted small" id="live-updated">Updated ' + timeAgo() + ' · auto-refreshes every minute</p>';
    html += '<h2>Right now in the Origin System</h2><div class="card-grid">';
    if (d.earthCycle) html += cycleCard('Earth', d.earthCycle.isDay ? '☀️ Daytime now' : '🌙 Nighttime now', d.earthCycle.expiry, '🌍',
      d.earthCycle.isDay ? '🌙 Night starts' : '☀️ Day starts');
    if (d.cetusCycle) html += cycleCard('Plains of Eidolon', d.cetusCycle.isDay ? '☀️ Daytime now' : '🌙 Nighttime now', d.cetusCycle.expiry, '🌅',
      d.cetusCycle.isDay ? '🌙 Night starts (Eidolons!)' : '☀️ Day starts');
    if (d.vallisCycle) html += cycleCard('Orb Vallis', d.vallisCycle.isWarm ? '🔥 Warm now' : '❄️ Cold now', d.vallisCycle.expiry, '🏔',
      d.vallisCycle.isWarm ? '❄️ Cold starts' : '🔥 Warm starts');
    if (d.cambionCycle) html += cycleCard('Cambion Drift', d.cambionCycle.active === 'fass' ? '🟠 Fass now' : '🔵 Vome now', d.cambionCycle.expiry, '🦠',
      d.cambionCycle.active === 'fass' ? '🔵 Vome starts' : '🟠 Fass starts');
    html += '</div>';

    // fissures
    if (d.fissures && d.fissures.length) {
      html += '<h2>Active Void Fissures</h2><div class="item-list">';
      d.fissures.slice(0, 24).forEach(function (f) {
        html += '<div class="list-item"><h3>' + esc(f.tier + ' — ' + f.missionType) + ' <span class="muted">(' + esc(f.node) + ')</span></h3>' +
          '<p class="muted small">vs ' + esc(f.enemy) + ' · ⏱ ' + liveCd(f.expiry) +
          (f.isStorm ? ' · <b>Railjack</b>' : '') + (f.isHard ? ' · <b>Steel Path</b>' : '') + '</p></div>';
      });
      html += '</div>';
    }

    // sortie / archon hunt
    if (d.sortie && d.sortie.boss) {
      html += '<h2>Sortie — ' + esc(d.sortie.boss) + '</h2><div class="detail-box">';
      (d.sortie.missions || []).forEach(function (m) {
        html += '<div class="mod-row"><div><b>' + esc(m.missionType) + '</b> <span class="muted">(' + esc(m.node) + ')</span></div>' +
          '<div class="muted">' + esc(m.modifier) + '</div></div>';
      });
      html += '<p class="muted small">Resets in ⏱ ' + liveCd(d.sortie.expiry) + '</p></div>';
    }
    if (d.archonHunt && d.archonHunt.boss) {
      html += '<h2>Archon Hunt — ' + esc(d.archonHunt.boss) + '</h2><div class="detail-box">';
      (d.archonHunt.missions || []).forEach(function (m) {
        html += '<div class="mod-row"><div><b>' + esc(m.missionType || m.type) + '</b> <span class="muted">(' + esc(m.node) + ')</span></div></div>';
      });
      html += '</div>';
    }

    // news
    if (d.news && d.news.length) {
      html += '<h2>Official Warframe News</h2><div class="item-list">';
      d.news.slice(0, 8).forEach(function (n) {
        /* v2.12.17 fix: invalid dates showed 12/31/1969 — hide date if unparseable */
        var dateStr = '';
        try {
          var dt = new Date(n.date);
          if (!isNaN(dt.getTime()) && dt.getTime() > 0) dateStr = dt.toLocaleDateString() + ' · ';
        } catch (e) {}
        html += '<a class="list-item" href="' + esc(n.link) + '" target="_blank" rel="noopener">' +
          '<h3>' + esc(n.message) + '</h3>' +
          '<p class="muted small">' + dateStr + 'warframe.com ↗</p></a>';
      });
      html += '</div>';
    }
    /* incoming alerts/events with countdowns */
    html += renderIncoming(d);
    return html;
  }

  function loadWorld() {
    var box = document.getElementById('live-world');
    fetch('https://api.warframestat.us/pc')
      .then(function (r) { if (!r.ok) throw new Error('bad'); return r.json(); })
      .then(function (d) { box.innerHTML = renderWorld(d); })
      .catch(function () { box.innerHTML = window.TV.liveNote(); });
  }

  /* ---------------- platinum prices ---------------- */
  var marketIndex = null;
  function loadMarketIndex() {
    if (marketIndex) return Promise.resolve(marketIndex);
    return window.TV.getJSON('data/site/market-index.json').then(function (d) {
      marketIndex = d; return d;
    }).catch(function () { marketIndex = {}; return {}; });
  }
  function slugify(name) {
    return name.toLowerCase().trim()
      .replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, '_');
  }
  /* rough price estimate when live lookup yields nothing — clearly labeled as estimate */
  function estimatePrice(q) {
    var t = q.toLowerCase();
    var isPrimePart = /prime/.test(t) && /(systems|chassis|neuroptics|barrel|receiver|stock|blade|handle|link|barrel|blueprint)/.test(t);
    var isRareMod = false;
    try {
      /* check mod rarity from search index if available */
      if (window.TVAI && window.TVAI._mods) {
        var m = window.TVAI._mods.filter(function (x) { return x.name && x.name.toLowerCase() === t; })[0];
        if (m && /rare|legendary/i.test(m.rarity || '')) isRareMod = true;
      }
    } catch (e) {}
    if (isPrimePart) return 'Prime parts like this typically go for <b>5–20p</b> (vaulted ones more).';
    if (isRareMod) return 'Rare mods like this often fetch <b>20–80p+</b> depending on demand.';
    if (/prime/.test(t)) return 'Prime items usually run <b>10–40p</b> for common parts, more when vaulted.';
    return 'Common items like this usually go for <b>2–10p</b>.';
  }

  /* ---------------- platinum prices ----------------
     warframe.market blocks all automated API access (403), so live lookup
     is impossible. Instead we use a curated price database (market averages)
     with buy AND sell prices. */
  var priceDB = null;
  function loadPriceDB() {
    if (priceDB) return Promise.resolve(priceDB);
    var ps = [window.TV.getJSON('data/site/prices-0.json'), window.TV.getJSON('data/site/prices-1.json')];
    return Promise.all(ps).then(function (parts) {
      priceDB = {};
      parts.forEach(function (p) { for (var k in p) { if (Object.prototype.hasOwnProperty.call(p, k)) priceDB[k] = p[k]; } });
      return priceDB;
    }).catch(function () { priceDB = {}; return {}; });
  }
  /* fuzzy match: exact, then starts-with, then contains */
  function findPrice(db, q) {
    q = q.toLowerCase().trim();
    if (db[q]) return { name: q, p: db[q] };
    var keys = Object.keys(db), i, k;
    for (i = 0; i < keys.length; i++) {
      k = keys[i];
      if (k.indexOf(q) === 0 && q.length >= 4) return { name: k, p: db[k] };
    }
    for (i = 0; i < keys.length; i++) {
      k = keys[i];
      if (k.indexOf(q) !== -1) return { name: k, p: db[k] };
    }
    return null;
  }

  function lookupPrice() {
    var q = document.getElementById('plat-input').value.trim();
    var out = document.getElementById('plat-result');
    if (!q) return;
    out.innerHTML = '<div class="loading">Looking up prices…</div>';
    Promise.all([loadPriceDB(), loadMarketIndex()]).then(function (r) {
      var db = r[0], idx = r[1];
      var urlName = idx[q] || Object.keys(idx).find(function (k) {
        return k.toLowerCase() === q.toLowerCase();
      });
      urlName = urlName ? idx[urlName] || urlName : slugify(q);
      var marketLink = 'https://warframe.market/items/' + encodeURIComponent(urlName);
      var fallback = '<p class="small"><a href="' + marketLink + '" target="_blank" rel="noopener">Check live on warframe.market ↗</a></p>';
      var hit = findPrice(db, q);
      if (hit) {
        var displayName = hit.name.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
        out.innerHTML = '<div class="detail-box"><h3>' + esc(displayName) + '</h3>' +
          '<div class="price-row" style="display:flex;gap:24px;margin:12px 0">' +
          '<div><div class="muted small">SELL FOR</div><div style="font-size:1.6rem;font-weight:800;color:#7fd67f">~' + hit.p.sell + 'p</div></div>' +
          '<div><div class="muted small">BUY FOR</div><div style="font-size:1.6rem;font-weight:800;color:#7fb8d6">~' + hit.p.buy + 'p</div></div>' +
          '</div>' +
          '<p class="muted small">Market averages — actual trades vary. Always check warframe.market before you trade.</p>' + fallback + '</div>';
        return;
      }
      /* riven guidance */
      if (/riven/i.test(q)) {
        out.innerHTML = '<div class="detail-box"><h3>Riven Mods</h3>' +
          '<p>Rivens are priced per-roll, not per mod — a god-roll can go for <b>500p+</b>, ' +
          'while a bad roll might fetch <b>10–30p</b> (basically the veiled price).</p>' +
          '<p class="muted small">What matters: the weapon (meta = more), the stats (crit chance/damage, multishot), ' +
          'and the negative (harmless ones like -zoom are best). Check the <a href="guides.html">Riven guide</a>.</p>' +
          '<p class="muted small">Market averages — check warframe.market before you trade.</p></div>' + fallback;
        return;
      }
      /* not in database — rough estimate */
      out.innerHTML = '<div class="notice"><b>' + esc(q) + '</b> isn\'t in our price database yet.<br>' +
        'Rough estimate: ' + estimatePrice(q) + '<br>' +
        '<span class="muted small">This is an estimate — check live prices before you trade.</span></div>' + fallback;
    }).catch(function () {
      out.innerHTML = '<div class="notice"><b>Price check unavailable.</b> Try again in a moment.</div>';
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (document.getElementById('live-world')) {
      loadWorld();
      setInterval(loadWorld, 60000);
      /* live 1s countdown ticker — one shared interval for all [data-countdown] */
      setInterval(tickCountdowns, 1000);
      /* refresh the "updated Xs ago" label every 10s */
      setInterval(function () {
        var el = document.getElementById('live-updated');
        if (el && lastUpdate) el.textContent = 'Updated ' + timeAgo() + ' · auto-refreshes every minute';
      }, 10000);
    }
    var btn = document.getElementById('plat-btn');
    if (btn) {
      btn.addEventListener('click', lookupPrice);
      document.getElementById('plat-input').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') lookupPrice();
      });
      loadMarketIndex();
    }
  });

  window.TVMarket = { lookupPrice: lookupPrice };
})();
