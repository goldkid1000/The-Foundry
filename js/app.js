/* The Foundry — shared layout, navigation, search, infinite scroll */
(function () {
  'use strict';

  /* v2.12.14: apply saved animation preference ASAP (before first paint) */
  try {
    if (localStorage.getItem('tv-animations') === 'off') {
      document.documentElement.classList.add('tv-no-anim-early');
    }
  } catch (e) {}
  document.addEventListener('DOMContentLoaded', function () {
    try {
      if (localStorage.getItem('tv-animations') === 'off') {
        document.body.classList.add('tv-no-anim');
      }
    } catch (e) {}
  });

  var NAV = [
    /* Home stays separate at the top — no group */
    { id: 'home', label: 'Home', sub: 'Start here', icon: '🏠', file: 'index.html' },

    /* ---- Gear ---- */
    { id: 'warframes', label: 'Warframes', sub: 'Every character — abilities, stats, where to farm them', icon: '🥷', file: 'warframes.html', group: 'Gear' },
    { id: 'weapons', label: 'Weapons', sub: 'Every gun, blade & bow — stats and where to get them', icon: '🔫', file: 'weapons.html', group: 'Gear' },
    { id: 'companions', label: 'Companions', sub: 'Pets & robots that fight beside you', icon: '🐾', file: 'companions.html', group: 'Gear' },
    { id: 'amps', label: 'Amps', sub: "Your operator's weapon — built from parts", icon: '🔷', file: 'amps.html', group: 'Gear' },
    { id: 'operators', label: 'Operators', sub: 'Your second character — focus schools & abilities', icon: '👁', file: 'operators.html', group: 'Gear' },

    /* ---- Upgrades ---- */
    { id: 'mods', label: 'Mods', sub: 'Upgrade cards that make everything stronger', icon: '🧩', file: 'mods.html', group: 'Upgrades' },
    { id: 'mod-swaps', label: 'Mod Swaps', sub: "Don't have it? Use this instead — damage & Steel Path", icon: '🔄', file: 'mod-swaps.html', group: 'Upgrades' },
    { id: 'arcanes', label: 'Arcanes', sub: 'Bonus powers for warframes & weapons', icon: '✨', file: 'arcanes.html', group: 'Upgrades' },
    { id: 'shards', label: 'Shards', sub: 'Stat boosts you slot into your warframe', icon: '💠', file: 'shards.html', group: 'Upgrades' },
    { id: 'builds', label: 'Builds', sub: 'Ready-made setups — copy & play', icon: '⚔️', file: 'builds.html', group: 'Upgrades' },
    { id: 'mixer', label: 'Mod Mixer', sub: 'Build your own setup — slot mods yourself', icon: '🧪', file: 'mixer.html', group: 'Upgrades' },
    { id: 'helminth', label: 'Helminth', sub: 'Swap abilities between warframes', icon: '🧬', file: 'helminth.html', group: 'Upgrades' },
    { id: 'focus', label: 'Focus', sub: 'Power up your operator — 5 schools explained', icon: '🔮', file: 'focus.html', group: 'Upgrades' },
    { id: 'incarnon', label: 'Incarnon Guide', sub: 'Weapons that transform mid-mission', icon: '🔥', file: 'incarnon.html', group: 'Upgrades' },

    /* ---- World ---- */
    { id: 'relics', label: 'Relics', sub: 'Crack these open for prime parts', icon: '📦', file: 'relics.html', group: 'World' },
    { id: 'farming', label: 'Farming', sub: 'Where to farm anything in the game', icon: '🌾', file: 'farming.html', group: 'World' },
    { id: 'resources', label: 'Resource Finder', sub: 'What mission, what planet — find any material', icon: '⛏️', file: 'resources.html', group: 'World' },
    { id: 'starchart', label: 'Star Chart', sub: 'Interactive map — fly to where anything farms', icon: '🗺️', file: 'starchart.html', group: 'World' },
    { id: 'live', label: 'Live', sub: "What's happening in-game right now", icon: '📡', file: 'live.html', group: 'World' },
    { id: 'news', label: 'News & Hotfixes', sub: 'Latest updates, patch notes & events', icon: '📰', file: 'news.html', group: 'World' },
    { id: 'quests', label: 'Quests', sub: 'Story missions — what order & what you get', icon: '📜', file: 'quests.html', group: 'World' },
    { id: 'liches', label: 'Liches', sub: 'Hunt your nemesis for powerful weapons', icon: '👹', file: 'liches.html', group: 'World' },
    { id: 'railjack', label: 'Railjack', sub: 'Space ships, space combat & mechs', icon: '🚀', file: 'railjack.html', group: 'World' },
    { id: 'archwing', label: 'Archwing', sub: 'Space wings, archguns & the ground deployer', icon: '🪽', file: 'archwing.html', group: 'World' },
    { id: 'damage', label: 'Damage', sub: 'What kills what — damage types made simple', icon: '💥', file: 'damage.html', group: 'World' },
    { id: 'syndicates', label: 'Syndicates', sub: 'Earn standing, unlock rewards from every faction', icon: '🤝', file: 'syndicates.html', group: 'World' },

    /* ---- Community ---- */
    { id: 'chat', label: 'Community Chat', sub: 'Talk Warframe with other Tenno', icon: '💬', file: 'chat.html', group: 'Community' },
    { id: 'trading', label: 'Trading', sub: 'Sell your stuff for platinum', icon: '💰', file: 'trading.html', group: 'Community' },
    { id: 'marketplace', label: 'Marketplace', sub: 'Listings from other players', icon: '🏪', file: 'marketplace.html', group: 'Community' },
    { id: 'videos', label: 'Videos', sub: 'Watch & learn from the community', icon: '🎬', file: 'videos.html', group: 'Community' },
    { id: 'guides', label: 'Guides', sub: 'Bosses, tips & how-tos', icon: '📖', file: 'guides.html', group: 'Community' },
  ];

  /* Group order for the grouped sidebar nav + homepage section cards */
  var NAV_GROUPS = ['Gear', 'Upgrades', 'World', 'Community'];

  var page = document.body.getAttribute('data-page') || 'home';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ---------- header ---------- */
  function buildHeader() {
    var host = document.getElementById('site-header');
    if (!host) return;
    host.innerHTML =
      '<div class="header-inner">' +
      '<button id="tv-menu-btn" aria-label="Open menu" aria-expanded="false"><span class="bars"><span></span><span></span><span></span></span></button>' +
      (page !== 'home' ? '<button class="back-btn" id="tv-back" aria-label="Go back">←</button>' : '') +
      '<a class="logo" href="index.html"><span class="logo-mark">◈</span><span class="logo-text">THE<em>FOUNDRY</em></span></a>' +
      '<span id="tv-online" class="muted small" style="display:none;white-space:nowrap"></span>' +
      '<div class="search-wrap"><input id="global-search" type="search" placeholder="Search warframes, weapons, mods, builds…" autocomplete="off" aria-label="Search"></div>' +
      '<!-- DONATE: buttons link to donate.html; swap the embedded QR data URI and the PayPal.me href inside donate.html as needed -->' +
      '<a class="btn home-btn" href="index.html" aria-label="Home">🏠</a>' +
      '<a class="btn donate-btn" href="donate.html">♥ Donate</a>' +
      '</div>';
    var input = document.getElementById('global-search');
    input.addEventListener('focus', openSearch);
    input.addEventListener('click', openSearch);
    /* animated PC menu: hamburger toggles slide-in sidebar drawer */
    var menuBtn = document.getElementById('tv-menu-btn');
    var sidebar = document.getElementById('sidebar');
    var backdrop = document.getElementById('tv-menu-backdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.id = 'tv-menu-backdrop';
      document.body.appendChild(backdrop);
    }
    function setMenu(open) {
      if (!sidebar || !menuBtn) return;
      sidebar.classList.toggle('open', open);
      menuBtn.classList.toggle('open', open);
      menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      menuBtn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      if (backdrop) backdrop.classList.toggle('show', open);
      try { document.body.style.overflow = open ? 'hidden' : ''; } catch (e) {}
      /* stagger every nav link + label so they all pop in one by one */
      if (open) {
        var items = sidebar.querySelectorAll('nav a, nav .nav-label');
        for (var i = 0; i < items.length; i++) {
          items[i].style.animationDelay = Math.min(i * 0.025, 0.6) + 's';
        }
      }
    }
    if (menuBtn) {
      menuBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        setMenu(!sidebar.classList.contains('open'));
      });
    }
    if (backdrop) backdrop.addEventListener('click', function () { setMenu(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && sidebar && sidebar.classList.contains('open')) setMenu(false);
    });
    /* close menu when a nav link is tapped */
    if (sidebar) sidebar.addEventListener('click', function (e) {
      if (e.target.closest('a')) setMenu(false);
    });
    window.TV = window.TV || {};
    window.TV.toggleMenu = setMenu;
  }

  /* ---------- sidebar (desktop) ---------- */
  function buildSidebar() {
    var host = document.getElementById('sidebar');
    if (!host) return;
    function link(n) {
      return '<a href="' + n.file + '" class="' + (n.id === page ? 'active' : '') + '">' +
        n.icon + ' ' + esc(n.label) + '</a>';
    }
    var html = '<nav>';
    /* home first, ungrouped */
    NAV.forEach(function (n) { if (!n.group) html += link(n); });
    /* then each group with its heading */
    NAV_GROUPS.forEach(function (g) {
      html += '<div class="nav-label">' + esc(g) + '</div>';
      NAV.forEach(function (n) { if (n.group === g) html += link(n); });
    });
    html += '</nav>';
    /* v2.12.14: Settings — animations toggle (saves CPU/battery) */
    var animOff = false;
    try { animOff = localStorage.getItem('tv-animations') === 'off'; } catch (e) {}
    html += '<div class="tv-settings"><h4>⚙️ Settings</h4>' +
      '<div class="tv-setting-row"><div>' +
        '<div class="tv-setting-label">Animations</div>' +
        '<div class="tv-setting-desc">Turn off to save CPU & battery</div>' +
      '</div>' +
      '<label class="tv-toggle"><input type="checkbox" id="tv-anim-toggle"' +
        (animOff ? '' : ' checked') + ' aria-label="Toggle animations">' +
        '<span class="tv-toggle-track"><span class="tv-toggle-thumb"></span></span></label>' +
      '</div></div>';
    host.innerHTML = html;
    /* wire up the toggle */
    var toggle = host.querySelector('#tv-anim-toggle');
    if (toggle) {
      /* apply saved state on load */
      if (animOff) document.body.classList.add('tv-no-anim');
      toggle.addEventListener('change', function () {
        var on = toggle.checked;
        try { localStorage.setItem('tv-animations', on ? 'on' : 'off'); } catch (e) {}
        document.body.classList.toggle('tv-no-anim', !on);
        document.documentElement.classList.toggle('tv-no-anim-early', !on);
        /* notify Vaulty via custom event (same-tab) */
        try {
          document.dispatchEvent(new CustomEvent('tv-anim-toggle', { detail: { on: on } }));
        } catch (e) {}
      });
    }
  }

  /* ---------- tab bar (mobile) ---------- */
  function buildTabbar() {
    var host = document.getElementById('tabbar');
    if (!host) return;
    /* v2.12.25: hide tab bar on PC (mouse devices) — hamburger covers nav.
       JS fallback in case CSS is cached. */
    try {
      var isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
      var hasMouse = window.matchMedia('(hover:hover)').matches;
      if (!isTouch || hasMouse) {
        host.style.display = 'none';
        return;
      }
      /* v2.12.43: clear any inline display:none so CSS can show tab bar on touch */
      host.style.display = '';
    } catch (e) {}
    var tabs = [
      { id: 'home', label: 'Home', icon: '🏠', file: 'index.html' },
      { id: 'builds', label: 'Builds', icon: '⚔️', file: 'builds.html' },
      /* v2.24.2: Mixer as a bottom tab too, not just the sidebar */
      { id: 'mixer', label: 'Mixer', icon: '🧪', file: 'mixer.html' },
      { id: 'news', label: 'News', icon: '📰', file: 'news.html' },
      { id: 'live', label: 'Live', icon: '📡', file: 'live.html' },
      { id: 'more', label: 'More', icon: '☰', file: 'index.html#sections' },
    ];
    host.innerHTML = tabs.map(function (t) {
      var cls = t.id === page ? 'active' : '';
      return '<a href="' + t.file + '" class="' + cls + '">' +
        '<span class="ti">' + t.icon + '</span>' + t.label + '</a>';
    }).join('');
  }

  /* ---------- breadcrumbs ---------- */
  function buildCrumbs() {
    var host = document.getElementById('breadcrumbs');
    if (!host) return;
    var crumb = document.body.getAttribute('data-crumb') || 'Home';
    var parts = crumb.split(',');
    host.innerHTML = parts.map(function (p, i) {
      p = p.trim();
      var link = i === 0 ? 'index.html' : null;
      var label = esc(p);
      if (i < parts.length - 1) {
        var target = i === 0 ? 'index.html' : '#';
        return '<a href="' + target + '">' + label + '</a><span class="sep">›</span>';
      }
      return '<span>' + label + '</span>';
    }).join('');
  }

  /* ---------- footer ---------- */
  function buildFooter() {
    var host = document.getElementById('site-footer');
    if (!host) return;
    host.innerHTML =
      '<div class="frow">' +
      '<!-- DONATE: buttons link to donate.html; swap the embedded QR data URI and the PayPal.me href inside donate.html as needed -->' +
      '<a class="btn donate-btn" href="donate.html">♥ Donate to The Foundry</a>' +
      '<a class="btn small" href="index.html#feedback">🐛 Report a bug / suggest something</a>' +
      '<span>Unofficial fan site. Not affiliated with Digital Extremes.</span>' +
      '<span>Game data: warframe-items (WFCD) · Price guide: community averages · Live: warframestat.us</span>' +
      '<span class="muted small" id="tv-version" style="display:inline-block;padding:3px 10px;border:1px solid rgba(0,229,255,.35);border-radius:20px;color:#00e5ff;font-size:11px;font-weight:600;"></span>' +
      '</div>';
    /* version stamp — loaded async so footer renders instantly */
    try {
      window.TV.getJSON('data/site/version.json').then(function (v) {
        var el = document.getElementById('tv-version');
        if (el && v && v.version) {
          var stamp = 'The Foundry v' + v.version;
          if (v.updated) {
            var mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            var p = String(v.updated).split('-');
            if (p.length === 3) stamp += ' · Updated ' + mo[parseInt(p[1], 10) - 1] + ' ' + parseInt(p[2], 10) + ', ' + p[0];
          }
          el.textContent = stamp;
        }
      }).catch(function () {});
    } catch (e) {}
  }

  /* ---------- search ---------- */
  var searchIndex = null, searchLoading = null;
  function loadIndex() {
    if (searchIndex) return Promise.resolve(searchIndex);
    if (searchLoading) return searchLoading;
    searchLoading = getJSONParts('data/site/search-index', 7)
      .then(function (d) { searchIndex = d; return d; })
      .catch(function () { searchIndex = []; return []; });
    return searchLoading;
  }

  function openSearch() {
    var ov = document.getElementById('search-overlay');
    ov.classList.add('open');
    var input = document.getElementById('search-input');
    input.value = '';
    document.getElementById('search-results').innerHTML =
      '<div class="loading">Type to search 3,500+ warframes, weapons, mods, builds…</div>';
    setTimeout(function () { input.focus(); }, 30);
    loadIndex();
  }
  function closeSearch() {
    document.getElementById('search-overlay').classList.remove('open');
  }

  function renderHits(q) {
    var box = document.getElementById('search-results');
    if (!q || q.length < 2) {
      box.innerHTML = '<div class="loading">Type at least 2 letters…</div>';
      return;
    }
    if (!searchIndex) {
      box.innerHTML = '<div class="tv-loader" role="status" aria-label="Loading search"></div>';
    }
    var myQ = q; /* token: ignore stale responses from earlier keystrokes */
    loadIndex().then(function (idx) {
      if (document.getElementById('search-input').value.trim() !== myQ) return;
      q = q.toLowerCase();
      var hits = idx.filter(function (e) {
        return e.n.toLowerCase().indexOf(q) !== -1 || e.d.toLowerCase().indexOf(q) !== -1;
      }).slice(0, 60);
      if (!hits.length) {
        box.innerHTML = '<div class="loading">No matches. Try another spelling.</div>';
        return;
      }
      box.innerHTML = hits.map(function (h) {
        return '<a class="search-hit" href="' + esc(h.u) + '">' +
          '<div class="t">' + esc(h.t) + '</div><div><b>' + esc(h.n) + '</b></div>' +
          '<div class="muted small">' + esc(h.d) + '</div></a>';
      }).join('');
    });
  }

  function buildSearchOverlay() {
    var ov = document.createElement('div');
    ov.id = 'search-overlay';
    ov.innerHTML =
      '<div class="search-panel">' +
      '<input id="search-input" type="search" placeholder="Search everything…" autocomplete="off" aria-label="Search everything">' +
      '<div id="search-results"></div></div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function (e) { if (e.target === ov) closeSearch(); });
    document.getElementById('search-input').addEventListener('input', function (e) {
      renderHits(e.target.value.trim());
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeSearch();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault(); openSearch();
      }
    });
  }

  /* ---------- infinite scroll ---------- */
  function infiniteScroll(container, items, renderItem, pageSize) {
    pageSize = pageSize || 40;
    var shown = 0;
    var sentinel = document.createElement('div');
    sentinel.className = 'sentinel';
    container.innerHTML = ''; /* clear loader/skeletons before rendering */
    function more() {
      var frag = document.createDocumentFragment();
      var next = Math.min(shown + pageSize, items.length);
      for (var i = shown; i < next; i++) {
        var el = renderItem(items[i], i);
        /* staggered entrance: subtle cascade, capped so long lists stay snappy */
        el.style.animationDelay = Math.min((i - shown) * 25, 300) + 'ms';
        frag.appendChild(el);
      }
      container.insertBefore(frag, sentinel);
      shown = next;
      if (shown >= items.length && sentinel.parentNode) {
        sentinel.parentNode.removeChild(sentinel);
        if (window._io) window._io.disconnect();
      }
    }
    container.appendChild(sentinel);
    var io = new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting) more();
    }, { rootMargin: '600px' });
    window._io = io;
    io.observe(sentinel);
    more();
    return {
      reset: function (newItems) {
        items = newItems; shown = 0;
        container.innerHTML = '';
        container.appendChild(sentinel);
        io.observe(sentinel);
        more();
      }
    };
  }

  /* ---------- skeleton loading placeholders ---------- */
  function walkerLoader(text) {
    return '<div class="tv-loader" role="status" aria-label="Loading">' +
      '<div class="tv-walker" aria-hidden="true">' +
      '<div class="crest"></div><div class="head"></div>' +
      '<div class="arm-l"></div><div class="torso"></div><div class="arm-r"></div>' +
      '<div class="leg-l"></div><div class="leg-r"></div><div class="ground"></div>' +
      '</div><p>' + esc(text || 'Loading…') + '</p></div>';
  }
  function showLoader(container, text) {
    if (typeof container === 'string') container = document.getElementById(container);
    if (container) container.innerHTML = walkerLoader(text);
  }
  function skeletonCards(container, n) {
    n = n || 6;
    var html = '';
    for (var i = 0; i < n; i++) {
      html += '<div class="tv-skeleton-card" aria-hidden="true">' +
        '<div class="tv-skeleton" style="min-height:18px;width:60%"></div>' +
        '<div class="tv-skeleton"></div><div class="tv-skeleton"></div></div>';
    }
    container.innerHTML = html;
  }
  function fetchWithTimeout(path, ms) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { reject(new Error('timeout: ' + path)); }, ms || 12000);
      fetch(path, { cache: 'no-store' }).then(function (r) {
        clearTimeout(timer);
        if (!r.ok) reject(new Error('load failed: ' + path));
        else resolve(r.json());
      }, function (err) { clearTimeout(timer); reject(err); });
    });
  }
  function getJSON(path, _retried) {
    return fetchWithTimeout(path, 12000).catch(function (err) {
      if (_retried) throw err; /* retried once already — give up */
      return new Promise(function (res) { setTimeout(res, 700); })
        .then(function () { return getJSON(path, true); });
    });
  }

  function getJSONParts(base, count) {
    var ps = [];
    for (var i = 0; i < count; i++) ps.push(getJSON(base + '-' + i + '.json'));
    return Promise.all(ps).then(function (parts) { return [].concat.apply([], parts); });
  }

  /* Hard reload that bypasses the HTTP cache (for the stale-cache retry button). */
  function hardReload() {
    try { location.reload(true); } catch (e) { /* fall through to fallback */ }
    setTimeout(function () {
      var base = location.href.split('?')[0].split('#')[0];
      location.href = base + '?cb=' + Date.now() + location.hash;
    }, 600);
  }

  function badge(tags) {
    var out = '';
    if (tags.indexOf('one-shot') !== -1) out += '<span class="badge oneshot">One-shot</span>';
    if (tags.indexOf('steel-path') !== -1) out += '<span class="badge steelpath">Steel Path</span>';
    if (tags.indexOf('strong') !== -1) out += '<span class="badge strong">Strong</span>';
    if (tags.indexOf('beginner') !== -1) out += '<span class="badge type">Beginner-friendly</span>';
    return out;
  }

  function liveNote() {
    return '<div class="notice"><b>Live data unavailable.</b> Could not reach the live server. ' +
      'Check your connection and refresh — the rest of the Vault still works.</div>';
  }

  /* ---------- related links ---------- */
  function relatedLinks(title, links) {
    if (!links || !links.length) return '';
    return '<div class="related"><h3>' + esc(title) + '</h3><div class="card-grid">' +
      links.map(function (l) {
        return '<a class="card" href="' + esc(l.url) + '"><h3>' + esc(l.label) +
          '</h3><p>' + esc(l.sub || '') + '</p></a>';
      }).join('') + '</div></div>';
  }

  /* ---------- back to top ---------- */
  function buildToTop() {
    var btn = document.createElement('button');
    btn.id = 'tv-totop';
    btn.setAttribute('aria-label', 'Back to top');
    btn.textContent = '↑';
    document.body.appendChild(btn);
    btn.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    var onScroll = function () {
      btn.classList.toggle('show', window.scrollY > 600);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ---------- init ---------- */
  document.addEventListener('DOMContentLoaded', function () {
    buildHeader();
    buildSidebar();
    buildTabbar();
    buildCrumbs();
    buildFooter();
    buildSearchOverlay();
    buildToTop();
    /* back button: history.back() with homepage fallback */
    var backBtn = document.getElementById('tv-back');
    if (backBtn) {
      backBtn.addEventListener('click', function () {
        if (window.history.length > 1) { window.history.back(); }
        else { window.location.href = 'index.html'; }
      });
    }
    if (window.TVAI && window.TVAI.init) window.TVAI.init();
  });

  window.TV = {
    NAV: NAV, NAV_GROUPS: NAV_GROUPS, page: page, esc: esc, getJSON: getJSON, getJSONParts: getJSONParts,
    infiniteScroll: infiniteScroll, skeletonCards: skeletonCards, showLoader: showLoader, walkerLoader: walkerLoader, badge: badge, hardReload: hardReload,
    liveNote: liveNote, relatedLinks: relatedLinks,
    openSearch: openSearch
  };
})();
