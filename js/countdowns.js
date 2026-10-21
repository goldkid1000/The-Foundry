/* The Foundry — Update launch countdowns.
   Data-driven: entries live in data/site/countdowns.json as
   { name, date (ISO), kind ("launch" | "ends"), description }.
   - Date-only entries (YYYY-MM-DD) count down to the END of that day
     (23:59:59 local), so an event ending Nov 17 stays live through Nov 17.
   - Full ISO timestamps with a time are used exactly as given.
   - Past entries drop off 24h after their target; within the first 24h
     past target they show as LIVE NOW (launches) / ENDED (events).
   - Renders into #tv-countdowns on the homepage; no-ops elsewhere.
   - Ticks once per second; re-renders when an entry crosses its target. */
(function () {
  'use strict';

  var GRACE_MS = 24 * 60 * 60 * 1000; /* 24h past-target grace window */

  function parseTarget(entry) {
    var d = String(entry.date || '').trim();
    if (!d) return null;
    /* date-only: count to end of that local day */
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return new Date(d + 'T23:59:59');
    var t = new Date(d);
    return isNaN(t.getTime()) ? null : t;
  }

  function fmtDate(target) {
    return target.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* state: entries with computed targets */
  var items = [];
  var section = null;
  var list = null;
  var timer = null;

  function stateOf(item, now) {
    var diff = item.target.getTime() - now;
    if (diff > 0) return item.kind === 'ends' ? 'Ends in' : 'Launches in';
    if (-diff <= GRACE_MS) return item.kind === 'ends' ? 'Ended' : 'LIVE NOW';
    return 'gone';
  }

  function render(now) {
    now = now || Date.now();
    var visible = items.filter(function (it) { return stateOf(it, now) !== 'gone'; });
    if (!visible.length) {
      if (section) section.style.display = 'none';
      if (timer) { clearInterval(timer); timer = null; }
      return;
    }
    if (section) section.style.display = '';
    list.innerHTML = visible.map(function (it) {
      var st = stateOf(it, now);
      var diff = Math.max(0, it.target.getTime() - now);
      var days = Math.floor(diff / 86400000);
      var hours = Math.floor(diff % 86400000 / 3600000);
      var mins = Math.floor(diff % 3600000 / 60000);
      var secs = Math.floor(diff % 60000 / 1000);
      var cls = st === 'LIVE NOW' ? ' tv-cd-live' : (st === 'Ended' ? ' tv-cd-ended' : '');
      var body = (st === 'LIVE NOW' || st === 'Ended')
        ? '<div class="tv-cd-status">' + st + '</div>'
        : '<div class="tv-cd-units" role="timer" aria-live="off" aria-label="' + days + ' days, ' + hours + ' hours, ' + mins + ' minutes, ' + secs + ' seconds">' +
          '<span class="tv-cd-unit"><b class="tv-cd-num" data-part="d">' + days + '</b><i>days</i></span>' +
          '<span class="tv-cd-unit"><b class="tv-cd-num" data-part="h">' + pad(hours) + '</b><i>hrs</i></span>' +
          '<span class="tv-cd-unit"><b class="tv-cd-num" data-part="m">' + pad(mins) + '</b><i>min</i></span>' +
          '<span class="tv-cd-unit"><b class="tv-cd-num" data-part="s">' + pad(secs) + '</b><i>sec</i></span></div>';
      return '<div class="card tv-cd-card' + cls + '">' +
        '<h3>' + esc(it.name) + '</h3>' +
        '<p class="tv-cd-date">' + esc(st) + ' · ' + esc(fmtDate(it.target)) + '</p>' +
        body +
        (it.description ? '<p class="muted small">' + esc(it.description) + '</p>' : '') +
        '</div>';
    }).join('');
  }

  function tick() {
    var now = Date.now();
    var needRender = false;
    items.forEach(function (it) {
      var before = it.lastState;
      var after = stateOf(it, now);
      if (before !== after) { it.lastState = after; needRender = true; }
    });
    if (needRender) { render(now); return; }
    /* fast path: just update the numbers in place */
    var cards = list ? list.querySelectorAll('.tv-cd-card') : [];
    var vi = 0;
    items.forEach(function (it) {
      if (stateOf(it, now) === 'gone') return;
      var card = cards[vi++];
      if (!card) return;
      var diff = Math.max(0, it.target.getTime() - now);
      var map = {
        d: String(Math.floor(diff / 86400000)),
        h: pad(Math.floor(diff % 86400000 / 3600000)),
        m: pad(Math.floor(diff % 3600000 / 60000)),
        s: pad(Math.floor(diff % 60000 / 1000))
      };
      Object.keys(map).forEach(function (k) {
        var el = card.querySelector('[data-part="' + k + '"]');
        if (el && el.textContent !== map[k]) el.textContent = map[k];
      });
      /* Keep the accessible text in sync with the visible numbers.
         role="timer" is implicitly aria-live="off", so this never
         announces every second — a screen reader reads the current
         value when the user focuses/polls the timer. */
      var units = card.querySelector('.tv-cd-units');
      if (units) {
        var label = Math.floor(diff / 86400000) + ' days, ' +
          Math.floor(diff % 86400000 / 3600000) + ' hours, ' +
          Math.floor(diff % 3600000 / 60000) + ' minutes, ' +
          Math.floor(diff % 60000 / 1000) + ' seconds';
        if (units.getAttribute('aria-label') !== label) units.setAttribute('aria-label', label);
      }
    });
  }

  function init() {
    section = document.getElementById('tv-countdown-section');
    list = document.getElementById('tv-countdowns');
    if (!section || !list) return; /* not the homepage */
    fetch('data/site/countdowns.json', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) {
        var now = Date.now();
        (Array.isArray(data) ? data : []).forEach(function (e) {
          var t = parseTarget(e);
          if (!t) return;
          var kind = (e.kind === 'ends') ? 'ends' : 'launch';
          items.push({ name: e.name || 'Update', description: e.description || '', kind: kind, target: t, lastState: null });
        });
        items.forEach(function (it) { it.lastState = stateOf(it, now); });
        items.sort(function (a, b) { return a.target - b.target; });
        render(now);
        if (timer) clearInterval(timer);
        timer = setInterval(tick, 1000);
      })
      .catch(function () {
        /* data missing/unreachable: hide the section, don't break the page */
        if (section) section.style.display = 'none';
      });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
