/* The Foundry — News & Hotfixes feed.
   Pulls official Warframe news from warframestat.us (CORS-friendly JSON).
   Caches for 1 hour. Filters hotfixes/updates vs news/events. */
(function () {
  'use strict';

  var API = 'https://api.warframestat.us/pc/news';
  var CACHE_KEY = 'tv-news-cache';
  var CACHE_TTL = 60 * 60 * 1000; /* 1 hour */
  var currentFilter = 'all';
  var items = [];

  /* A news item is a hotfix/update if its title matches patch-note patterns */
  var HOTFIX_RE = /hotfix|patch\s*notes?|update\s*\d|build\s*notes?|iceblade|isles\s*of|whispers|abyss|jade\s*shadows|techrot|1999|narin/i;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function isHotfix(item) {
    var msg = (item.message || '') + ' ' + (item.link || '');
    return HOTFIX_RE.test(msg);
  }

  function load() {
    var host = document.getElementById('news-list');
    if (!host) return;
    /* try cache first */
    try {
      var cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (cached && cached.ts && (Date.now() - cached.ts) < CACHE_TTL && cached.items) {
        items = cached.items;
        render(host);
        /* refresh in background */
        fetchFresh(host, true);
        return;
      }
    } catch (e) { /* fall through to fetch */ }
    fetchFresh(host, false);
  }

  function fetchFresh(host, silent) {
    fetch(API, { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('bad status'); return r.json(); })
      .then(function (data) {
        /* filter out placeholder promo links (dated 1970) */
        items = (data || []).filter(function (it) {
          var d = new Date(it.date);
          return !isNaN(d.getTime()) && d.getFullYear() > 2000;
        }).sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), items: items }));
        } catch (e) { /* storage full — ignore */ }
        render(host);
      })
      .catch(function () {
        if (!silent) renderError(host);
      });
  }

  function renderError(host) {
    host.innerHTML =
      '<div class="notice"><b>News feed unavailable.</b> Could not reach the news server. ' +
      '<a href="https://www.warframe.com/news" target="_blank" rel="noopener">Check warframe.com →</a></div>';
  }

  function card(it) {
    var hotfix = isHotfix(it);
    var badge = hotfix
      ? '<span class="tag hotfix">🔧 Hotfix / Update</span>'
      : '<span class="tag news">📢 News</span>';
    var img = it.imageLink
      ? '<img src="' + esc(it.imageLink) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">'
      : '';
    return '<article class="card news-card">' +
      img +
      '<div class="news-body">' + badge +
      '<h3>' + esc(it.message || 'Untitled') + '</h3>' +
      '<p class="muted small">📅 ' + esc(fmtDate(it.date)) + '</p>' +
      (it.link ? '<p><a class="btn" href="' + esc(it.link) + '" target="_blank" rel="noopener">Read more →</a></p>' : '') +
      '</div></article>';
  }

  function render(host) {
    var filtered = items.filter(function (it) {
      if (currentFilter === 'hotfix') return isHotfix(it);
      if (currentFilter === 'news') return !isHotfix(it);
      return true;
    });
    if (!filtered.length) {
      host.innerHTML = '<div class="notice">No items in this category right now.</div>';
      return;
    }
    host.innerHTML = '<div class="card-grid">' + filtered.map(card).join('') + '</div>';
  }

  /* filter chips */
  document.addEventListener('click', function (e) {
    var chip = e.target.closest('.filter-chip');
    if (!chip) return;
    currentFilter = chip.getAttribute('data-filter');
    document.querySelectorAll('.filter-chip').forEach(function (c) {
      c.classList.toggle('active', c === chip);
    });
    var host = document.getElementById('news-list');
    if (host && items.length) render(host);
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }
})();
