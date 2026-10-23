/* The Foundry — Farm Watch + Daily Brief (v2.23.0).
   FARM WATCH: "I'm farming X" stores ONE watch on this device. While
   the app stays open, the watch polls the same live worldstate feed
   the Live page uses (via js/vaulty-live.js) and nudges the Tenno the
   moment a matching fissure / alert / invasion is live. One watch at
   a time, clearable by chat ("stop watch") — stored only on-device.
   DAILY BRIEF: once per day, when the chat opens, one compact line of
   REAL worldstate (Baro, today's Sortie, daily reset) — dismissible,
   never invented; if the feed doesn't answer, there is no brief. */
(function () {
  'use strict';

  var WATCH_KEY = 'tv-farm-watch-v1';
  var BRIEF_KEY = 'tv-daily-brief-date';
  var POLL_MS = 180 * 1000;

  function esc(s) {
    if (window.TV && window.TV.esc) return window.TV.esc(s);
    return String(s == null ? '' : s).replace(/[&<>""]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function norm(s) { return String(s || '').toLowerCase().trim(); }

  /* ---------- the watch store ---------- */
  function current() {
    try {
      var raw = localStorage.getItem(WATCH_KEY);
      if (!raw) return null;
      var w = JSON.parse(raw);
      return (w && w.item) ? w : null;
    } catch (e) { return null; }
  }
  function set(item, source) {
    try {
      localStorage.setItem(WATCH_KEY, JSON.stringify({ item: String(item), source: String(source || ''), ts: Date.now() }));
    } catch (e) {}
    scheduleChecks();
  }
  function clear() {
    try { localStorage.removeItem(WATCH_KEY); } catch (e) {}
  }

  /* ---------- matching ----------
     A watch matches the live worldstate when:
     - relic watch ("Lith A1"): a fissure of that relic's TIER is live
       (any node — cracking needs the tier, the node is a bonus note);
     - item watch: the item's name tokens appear in an alert's reward,
       an invasion's battle pay, or a fissure reward context. */
  var STOPTOK = { the: 1, prime: 1, relic: 1, of: 1, a: 1, an: 1 };
  function tokensOf(item) {
    return norm(item).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter(function (w) { return w.length >= 3 && !STOPTOK[w]; })
      /* reward text is usually singular ("Argon Crystal") while the
         Tenno names the plural — match on the stem */
      .map(function (w) { return w.length > 3 && /s$/.test(w) ? w.slice(0, -1) : w; });
  }
  function relicTier(item) {
    var m = norm(item).match(/^(lith|meso|neo|axi|requiem)\b/);
    return m ? m[1] : null;
  }
  function rewardText(side) {
    var out = [];
    try {
      var r = (side && side.reward) || side || {};
      (r.items || []).forEach(function (x) { out.push(String(x)); });
      (r.countedItems || []).forEach(function (x) { if (x && x.type) out.push(String(x.type)); });
    } catch (e) {}
    return norm(out.join(' '));
  }
  function matchWorld(d, watch) {
    if (!d || !watch || !watch.item) return [];
    var reasons = [];
    var item = watch.item;
    var tier = relicTier(item);
    var toks = tokensOf(item);
    function toksHit(text) {
      if (!toks.length) return false;
      return toks.every(function (tk) { return text.indexOf(tk) !== -1; });
    }
    (d.fissures || []).forEach(function (f) {
      if (!f || f.completed) return;
      if (tier && norm(f.tier) === tier) {
        reasons.push('A ' + esc(f.tier) + ' fissure — your <b>' + esc(item) + '</b> tier — is live right now: ' +
          esc(f.missionType || 'Fissure') + ' on <b>' + esc(f.node || '') + '</b>' +
          (f.isHard ? ' (Steel Path)' : '') + (f.expiry && window.TVLive ? ', ends in ' + esc(TVLive._inLeft(f.expiry)) : '') + '.');
      }
    });
    (d.alerts || []).forEach(function (a) {
      if (!a) return;
      var rt = rewardText(a);
      if (rt && toksHit(rt)) {
        var m = a.mission || {};
        reasons.push('An alert paying <b>' + esc(item) + '</b> is live: ' + esc(m.type || 'Alert') +
          ' on <b>' + esc(m.node || '') + '</b>' + (a.expiry && window.TVLive ? ', ends in ' + esc(TVLive._inLeft(a.expiry)) : '') + '.');
      }
    });
    (d.invasions || []).forEach(function (i) {
      if (!i || i.completed) return;
      var rt = rewardText(i.attacker) + ' ' + rewardText(i.defender);
      if (rt.trim() && toksHit(rt)) {
        reasons.push('An invasion on <b>' + esc(i.node || '') + '</b> is paying <b>' + esc(item) + '</b> as battle pay right now.');
      }
    });
    return reasons;
  }

  /* ---------- nudges ---------- */
  var nudgedKeys = {};
  var deliverOverride = null;
  function deliver(html) {
    if (typeof deliverOverride === 'function') { deliverOverride(html); return; }
    try {
      /* into the chat if the panel is on screen */
      var msgs = document.querySelector ? document.querySelector('#vai-msgs') : null;
      var panel = document.getElementById ? document.getElementById('vault-ai-panel') : null;
      if (msgs && panel && panel.style.display === 'flex') {
        var d = document.createElement('div');
        d.className = 'vai-msg bot';
        d.innerHTML = html;
        msgs.appendChild(d);
        msgs.scrollTop = msgs.scrollHeight;
        return;
      }
      /* otherwise a dismissible toast */
      var old = document.getElementById('tv-watch-toast');
      if (old && old.parentNode) old.parentNode.removeChild(old);
      var t = document.createElement('div');
      t.id = 'tv-watch-toast';
      t.innerHTML = html + '<p><button type="button" class="tv-watch-dismiss">Dismiss</button></p>';
      document.body.appendChild(t);
    } catch (e) {}
  }
  document.addEventListener('click', function (e) {
    var t = e.target;
    var btn = (t && typeof t.closest === 'function') ? t.closest('.tv-watch-dismiss') : null;
    if (btn) {
      var toast = btn.closest('#tv-watch-toast');
      if (toast && toast.parentNode) toast.parentNode.removeChild(toast);
      return;
    }
    var db = (t && typeof t.closest === 'function') ? t.closest('.tv-brief-dismiss') : null;
    if (db) {
      var msg = db.closest('.vai-msg');
      if (msg && msg.parentNode) msg.parentNode.removeChild(msg);
    }
  });

  function checkNow() {
    var w = current();
    if (!w) return Promise.resolve([]);
    if (!window.TVLive || !TVLive._fetchWorld) return Promise.resolve([]);
    return TVLive._fetchWorld().then(function (d) {
      var reasons = matchWorld(d, w);
      reasons.forEach(function (r) {
        var key = norm(w.item) + '|' + r.replace(/<[^>]+>/g, '').slice(0, 60);
        if (nudgedKeys[key]) return;
        nudgedKeys[key] = 1;
        deliver('<p>👁 <b>Farm watch:</b> ' + r + '</p>' +
          '<p class="muted small">Watching for <b>' + esc(w.item) + '</b> — say <i>"stop watch"</i> to clear it.</p>');
      });
      return reasons;
    }).catch(function () { return []; });
  }

  var pollTimer = null;
  function scheduleChecks() {
    if (pollTimer) return;
    setTimeout(checkNow, 15000);
    pollTimer = setInterval(function () {
      try {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      } catch (e) {}
      checkNow();
    }, POLL_MS);
  }
  if (current()) scheduleChecks();

  /* ---------- daily brief ---------- */
  function todayKey() {
    var d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }
  function briefHtml(d) {
    if (!window.TVLive) return null;
    var bits = [];
    var vt = d.voidTrader;
    if (vt && vt.activation) {
      var now = Date.now();
      var act = new Date(vt.activation).getTime();
      var exp = new Date(vt.expiry).getTime();
      if (now < act) bits.push('Baro arrives <b>' + esc(TVLive._fmtWhen(vt.activation)) + '</b>');
      else if (now <= exp) bits.push('<b>Baro is HERE</b> at ' + esc(vt.location || 'a Relay') + ' — leaves in ' + esc(TVLive._inLeft(vt.expiry)));
    }
    if (d.sortie && d.sortie.boss) {
      bits.push('Sortie today: <b>' + esc(d.sortie.boss) + '</b> (resets in ' + esc(TVLive._inLeft(d.sortie.expiry)) + ')');
    }
    if (d.archonHunt && d.archonHunt.boss) bits.push('Archon Hunt: <b>' + esc(d.archonHunt.boss) + '</b>');
    var reset = new Date(); reset.setUTCHours(24, 0, 0, 0);
    bits.push('Daily reset in ' + esc(TVLive._inLeft(reset.toISOString())));
    if (d.cetusCycle && !d.cetusCycle.isDay) bits.push('Plains are at <b>night</b> — Eidolons are out');
    if (!bits.length) return null;
    return '<p>☀️ <b>Daily brief:</b> ' + bits.join(' · ') +
      ' <button type="button" class="tv-brief-dismiss muted small">Dismiss</button></p>' +
      '<p class="muted small">📡 Live from the worldstate feed' +
      (TVLive._lastFetch() ? ' — live as of ' + esc(new Date(TVLive._lastFetch()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })) : '') + '.</p>';
  }
  /* call on chat open; shows at most once per day, only with real data */
  function maybeShowBrief(addMsg) {
    try {
      if (localStorage.getItem(BRIEF_KEY) === todayKey()) return Promise.resolve(false);
    } catch (e) { return Promise.resolve(false); }
    if (!window.TVLive || !TVLive._fetchWorld) return Promise.resolve(false);
    return TVLive._fetchWorld().then(function (d) {
      var html = briefHtml(d);
      try { localStorage.setItem(BRIEF_KEY, todayKey()); } catch (e) {}
      if (!html) return false;
      addMsg(html, 'bot');
      return true;
    }).catch(function () { return false; });
  }

  window.TVWatch = {
    set: set, clear: clear, current: current,
    checkNow: checkNow,
    _match: matchWorld,
    _setDeliver: function (fn) { deliverOverride = fn; },
    _resetNudges: function () { nudgedKeys = {}; }
  };
  window.TVDailyBrief = { maybeShow: maybeShowBrief, _html: briefHtml, _todayKey: todayKey };
})();
