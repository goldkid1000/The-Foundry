/* The Foundry — Vaulty live answers (v2.19.0).
   Answers time-sensitive questions ("when is Baro back?", "what events are on?",
   "Nightwave challenges", "active fissures", "latest hotfix") from the SAME
   live feed the site already uses: https://api.warframestat.us/pc
   (the worldstate behind the Live page + news). No backend, no keys.
   If the feed doesn't answer, Vaulty says so instead of guessing. */
(function () {
  'use strict';

  var API = 'https://api.warframestat.us/pc';
  var TTL = 60 * 1000; /* worldstate changes slowly — cache a minute */
  var cache = null;        /* { ts, data } */
  var inflight = null;

  function esc(s) {
    if (window.TV && window.TV.esc) return window.TV.esc(s);
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function norm(s) { return String(s || '').toLowerCase().trim(); }

  function fetchWorld() {
    if (cache && (Date.now() - cache.ts) < TTL) return Promise.resolve(cache.data);
    if (inflight) return inflight;
    inflight = fetch(API, { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('bad status'); return r.json(); })
      .then(function (d) {
        cache = { ts: Date.now(), data: d };
        inflight = null;
        return d;
      })
      .catch(function (e) {
        inflight = null;
        throw e;
      });
    return inflight;
  }

  /* ---------- time helpers ---------- */
  function fmtDur(ms) {
    if (!(ms > 0)) return 'any moment now';
    var m = Math.floor(ms / 60000);
    var d = Math.floor(m / 1440);
    var h = Math.floor((m % 1440) / 60);
    var mm = m % 60;
    if (d > 0) return d + 'd ' + h + 'h';
    if (h > 0) return h + 'h ' + mm + 'm';
    if (mm > 0) return mm + 'm';
    return 'under a minute';
  }
  function fmtWhen(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) +
      ' at ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  function inLeft(iso) { return fmtDur(new Date(iso).getTime() - Date.now()); }

  function liveTag() {
    return '<p class="muted small">📡 Live from the worldstate feed — same data as the <a href="live.html">Live page</a>.</p>';
  }
  function failMsg() {
    return 'I tried to pull the live feed just now and it didn\'t answer — so I won\'t guess at this one. ' +
      'Check the <a href="live.html">Live page</a> (it retries on its own), or ask me again in a minute.';
  }

  /* ---------- per-topic answers (worldstate object in, HTML out) ---------- */
  function baroAnswer(d) {
    var vt = d.voidTrader;
    if (!vt || !vt.activation) return null;
    var now = Date.now();
    var act = new Date(vt.activation).getTime();
    var exp = new Date(vt.expiry).getTime();
    var loc = vt.location || 'a Relay';
    if (now < act) {
      var inv = (vt.inventory && vt.inventory.length)
        ? '<p class="muted small">His stock list usually posts once he lands.</p>' : '';
      return '<b>Baro Ki\'Teer</b> isn\'t here yet — he arrives <b>' + esc(fmtWhen(vt.activation)) + '</b> ' +
        'at <b>' + esc(loc) + '</b>. That\'s in <b>' + inLeft(vt.activation) + '</b>.' + inv + liveTag();
    }
    if (now <= exp) {
      var stock = '';
      if (vt.inventory && vt.inventory.length) {
        var rows = vt.inventory.slice(0, 14).map(function (it) {
          return '<li><b>' + esc(it.name) + '</b> <span class="muted small">' +
            (it.ducats ? it.ducats + ' ducats' : '') +
            (it.ducats && it.credits ? ' + ' : '') +
            (it.credits ? Number(it.credits).toLocaleString() + ' credits' : '') + '</span></li>';
        }).join('');
        stock = '<p><b>This visit\'s stock (first ' + Math.min(14, vt.inventory.length) + '):</b></p><ul>' + rows + '</ul>';
      } else {
        stock = '<p class="muted small">His stock list hasn\'t loaded into the feed yet — check his console at the relay.</p>';
      }
      return '<b>Baro Ki\'Teer is HERE</b> — at <b>' + esc(loc) + '</b>, and he leaves in <b>' + inLeft(vt.expiry) + '</b> ' +
        '(' + esc(fmtWhen(vt.expiry)) + ').' + stock + liveTag();
    }
    return '<b>Baro Ki\'Teer</b> just left ' + esc(loc) + '. He comes back roughly every two weeks — ' +
      'watch the <a href="live.html">Live page</a> for his next landing.' + liveTag();
  }

  function eventsAnswer(d) {
    var evs = (d.events || []).filter(function (e) { return e.expiry; });
    if (!evs.length) return 'No special events are running right now according to the live feed. ' + liveTag();
    var rows = evs.map(function (e) {
      return '<li><b>' + esc(e.description || 'Event') + '</b> <span class="muted small">ends ' +
        esc(fmtWhen(e.expiry)) + ' (' + inLeft(e.expiry) + ' left)</span></li>';
    }).join('');
    return 'Here\'s what\'s running right now:<ul>' + rows + '</ul>' + liveTag();
  }

  function alertsAnswer(d) {
    var als = (d.alerts || []).filter(function (a) { return a.expiry; });
    if (!als.length) return 'No alerts are up right now. They rotate often — the <a href="live.html">Live page</a> tracks them as they land.' + liveTag();
    var rows = als.map(function (a) {
      var m = a.mission || {};
      var rew = '';
      try {
        var ri = (a.reward && a.reward.items) || [];
        var rc = a.reward && a.reward.countedItems;
        if (ri.length) rew = ' · 🎁 ' + esc(ri.join(', '));
        else if (rc && rc.length) rew = ' · 🎁 ' + esc(rc.map(function (x) { return x.type; }).join(', '));
      } catch (e) {}
      return '<li><b>' + esc(m.type || 'Alert') + '</b> <span class="muted small">' + esc(m.node || '') +
        (m.faction ? ' vs ' + esc(m.faction) : '') + ' · ends in ' + inLeft(a.expiry) + rew + '</span></li>';
    }).join('');
    return 'Active alerts right now:<ul>' + rows + '</ul>' + liveTag();
  }

  function nightwaveAnswer(d) {
    var nw = d.nightwave;
    if (!nw) return null;
    var now = Date.now();
    var acts = (nw.activeChallenges || []).filter(function (c) {
      return new Date(c.expiry).getTime() > now;
    });
    var dailies = acts.filter(function (c) { return c.isDaily; });
    var weeklies = acts.filter(function (c) { return !c.isDaily; });
    weeklies.sort(function (a, b) { return (b.isElite ? 1 : 0) - (a.isElite ? 1 : 0); });
    function row(c) {
      return '<li><b>' + esc(c.title || '') + '</b> <span class="muted small">' + esc(c.desc || '') +
        ' · +' + Number(c.reputation || 0).toLocaleString() + ' standing' +
        (c.isElite ? ' · ⭐ elite' : '') + '</span></li>';
    }
    var html = '<b>Nightwave</b>' + (nw.season ? ' — Series ' + esc(String(nw.season)) : '') +
      (nw.expiry ? ' <span class="muted small">(season ends ' + esc(fmtWhen(nw.expiry)) + ')</span>' : '');
    if (dailies.length) html += '<p><b>Today\'s dailies:</b></p><ul>' + dailies.map(row).join('') + '</ul>';
    if (weeklies.length) html += '<p><b>This week:</b></p><ul>' + weeklies.slice(0, 5).map(row).join('') + '</ul>';
    if (!dailies.length && !weeklies.length) html += '<p>No active challenges in the feed right now.</p>';
    return html + liveTag();
  }

  function fissuresAnswer(d) {
    var fs = (d.fissures || []).filter(function (f) { return f.expiry; });
    if (!fs.length) return 'No Void Fissures in the feed right now — they rotate about every hour.' + liveTag();
    fs.sort(function (a, b) { return new Date(a.expiry) - new Date(b.expiry); });
    var counts = {};
    fs.forEach(function (f) { counts[f.tier] = (counts[f.tier] || 0) + 1; });
    var sum = Object.keys(counts).map(function (k) { return counts[k] + ' ' + k; }).join(' · ');
    var sp = fs.filter(function (f) { return f.isHard; }).slice(0, 5);
    var rows = sp.map(function (f) {
      return '<li><b>' + esc(f.tier) + ' — ' + esc(f.missionType) + '</b> <span class="muted small">' +
        esc(f.node) + ' · Steel Path · ends in ' + inLeft(f.expiry) + '</span></li>';
    }).join('');
    var html = '<b>' + fs.length + ' Void Fissures</b> are active right now (' + esc(sum) + ').';
    if (rows) html += '<p><b>Steel Path fissures:</b></p><ul>' + rows + '</ul>';
    html += '<p class="muted small">Full list with timers on the <a href="live.html">Live page</a>.</p>';
    return html + liveTag();
  }

  function newsAnswer(d) {
    var items = (d.news || []).filter(function (n) {
      var dt = new Date(n.date);
      return !isNaN(dt.getTime()) && dt.getFullYear() > 2000 && n.message;
    }).sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
    if (!items.length) return null;
    var HOT = /hotfix|patch notes|update \d|devstream|workshop/i;
    var hot = null;
    for (var i = 0; i < items.length; i++) { if (HOT.test(items[i].message)) { hot = items[i]; break; } }
    function line(n) {
      return '<li><a href="' + esc(n.link || 'news.html') + '" target="_blank" rel="noopener"><b>' +
        esc(n.message) + '</b></a> <span class="muted small">' +
        new Date(n.date).toLocaleDateString([], { month: 'short', day: 'numeric' }) + '</span></li>';
    }
    var html = '';
    if (hot) html += '<p>🔥 Latest hotfix/update: <b>' + esc(hot.message) + '</b> (' +
      new Date(hot.date).toLocaleDateString([], { month: 'short', day: 'numeric' }) + ')</p>';
    html += '<p><b>Latest official news:</b></p><ul>' + items.slice(0, 4).map(line).join('') + '</ul>' +
      '<p class="muted small">Full feed on the <a href="news.html">News page</a>.</p>';
    return html + liveTag();
  }

  function cyclesAnswer(d) {
    var parts = [];
    if (d.cetusCycle) parts.push('<b>Plains of Eidolon:</b> ' + (d.cetusCycle.isDay ? '☀️ daytime' : '🌙 nighttime (Eidolons are out)') +
      ' — flips in ' + inLeft(d.cetusCycle.expiry));
    if (d.earthCycle) parts.push('<b>Earth:</b> ' + (d.earthCycle.isDay ? '☀️ day' : '🌙 night') +
      ' — flips in ' + inLeft(d.earthCycle.expiry));
    if (d.vallisCycle) parts.push('<b>Orb Vallis:</b> ' + (d.vallisCycle.isWarm ? '🔥 warm' : '❄️ cold') +
      ' — flips in ' + inLeft(d.vallisCycle.expiry));
    if (d.cambionCycle) parts.push('<b>Cambion Drift:</b> ' + (d.cambionCycle.active === 'fass' ? '🟠 Fass' : '🔵 Vome') +
      ' — flips in ' + inLeft(d.cambionCycle.expiry));
    if (!parts.length) return null;
    return parts.join('<br>') + liveTag();
  }

  function sortieAnswer(d) {
    var html = '';
    if (d.sortie && d.sortie.boss) {
      var ms = (d.sortie.missions || []).map(function (m) {
        return '<li><b>' + esc(m.missionType) + '</b> <span class="muted small">' + esc(m.node) +
          (m.modifier ? ' · ' + esc(m.modifier) : '') + '</span></li>';
      }).join('');
      html += '<p><b>Today\'s Sortie — ' + esc(d.sortie.boss) + ':</b></p><ul>' + ms + '</ul>' +
        '<p class="muted small">Resets in ' + inLeft(d.sortie.expiry) + '.</p>';
    }
    if (d.archonHunt && d.archonHunt.boss) {
      html += '<p><b>Archon Hunt — ' + esc(d.archonHunt.boss) + '</b> (weekly, drops an Archon Shard).</p>';
    }
    if (!html) return null;
    return html + liveTag();
  }

  function steelPathAnswer(d) {
    var sp = d.steelPath;
    if (!sp || !sp.currentReward) return null;
    var rot = (sp.rotation || []).map(function (r) { return esc(r.name); }).join(' → ');
    return '<b>Steel Path Honors</b> this week: Teshin\'s featured reward is <b>' + esc(sp.currentReward.name) + '</b>' +
      (sp.currentReward.cost ? ' (' + esc(String(sp.currentReward.cost)) + ' Steel Essence)' : '') +
      (sp.expiry ? ' — rotation resets ' + esc(fmtWhen(sp.expiry)) + ' (' + inLeft(sp.expiry) + ' left)' : '') + '.' +
      (rot ? '<p class="muted small">Rotation: ' + rot + '</p>' : '') + liveTag();
  }

  function digestAnswer(d) {
    var bits = [];
    var b = baroAnswer(d);
    if (b) bits.push(b.replace(liveTag(), ''));
    var evs = (d.events || []).filter(function (e) { return e.expiry; });
    if (evs.length) bits.push('<b>Events:</b> ' + evs.map(function (e) {
      return esc(e.description || 'Event') + ' (ends ' + inLeft(e.expiry) + ')';
    }).join(' · '));
    if (d.cetusCycle) bits.push('<b>Plains:</b> ' + (d.cetusCycle.isDay ? '☀️ day' : '🌙 night') + ', flips in ' + inLeft(d.cetusCycle.expiry));
    if (d.fissures) bits.push('<b>Fissures:</b> ' + d.fissures.length + ' active');
    if (d.sortie && d.sortie.boss) bits.push('<b>Sortie:</b> ' + esc(d.sortie.boss));
    if (d.nightwave && d.nightwave.season) bits.push('<b>Nightwave:</b> Series ' + esc(String(d.nightwave.season)) + ' running');
    if (!bits.length) return null;
    return 'Here\'s the Origin System right now:<br>' + bits.join('<br>') + liveTag();
  }

  /* ---------- intent detection ---------- */
  var INTENTS = [
    { key: 'baro', re: /\b(baro|ki'?teer|void trader)\b/, fn: baroAnswer },
    { key: 'nightwave', re: /\bnightwave\b/, fn: nightwaveAnswer },
    { key: 'fissures', re: /\bfissures?\b|where.*crack.*relic|crack.*relic.*where/, fn: fissuresAnswer },
    { key: 'sortie', re: /\b(sortie|archon hunt)\b/, fn: sortieAnswer },
    { key: 'steelpath', re: /steel path (reward|rotation|honors|offering)|\bteshin\b/, fn: steelPathAnswer },
    { key: 'alerts', re: /\balerts?\b/, fn: alertsAnswer },
    { key: 'news', re: /\b(hotfix|patch notes|latest update|recent update|devstream)\b|latest (warframe )?news|warframe news|what'?s new in warframe/, fn: newsAnswer },
    { key: 'events', re: /\b(events?|tactical alert|naberus|what'?s on)\b/, fn: eventsAnswer },
    { key: 'cycles', re: /is it (day|night)|day or night|cetus|plains.*(day|night)|eidolon.*(when|time)|orb vallis.*(warm|cold)|cycle/, fn: cyclesAnswer },
    { key: 'digest', re: /what'?s (happening|live|going on)|right now|currently (on|happening)|anything (happening|live)/, fn: digestAnswer }
  ];

  function detect(q) {
    var t = norm(q);
    for (var i = 0; i < INTENTS.length; i++) {
      if (INTENTS[i].re.test(t)) return INTENTS[i];
    }
    return null;
  }

  function isLive(q) { return !!detect(q); }

  /* returns a Promise of an HTML string, or null when the question isn't live */
  function answer(q) {
    var intent = detect(q);
    if (!intent) return Promise.resolve(null);
    return fetchWorld().then(function (d) {
      var html = intent.fn(d);
      if (html == null) {
        return 'The live feed answered, but it has no ' + intent.key + ' data in it right now — ' +
          'the <a href="live.html">Live page</a> shows everything it\'s carrying.';
      }
      return html;
    }).catch(function () {
      return failMsg();
    });
  }

  window.TVLive = { isLive: isLive, answer: answer, _detect: detect };
})();
