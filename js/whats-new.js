/* The Foundry — "What's new" notification bubble.
   Sits in the top header on every page. Shows a red dot when there are
   updates the visitor hasn't seen yet; tapping opens a panel listing the
   latest versions from changelog.json. Seen state is kept in localStorage. */
(function () {
  'use strict';

  var SEEN_KEY = 'tv-whatsnew-seen';
  var MAX_TRIES = 50; /* ~5s waiting for the header to be built */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function getSeen() {
    try { return localStorage.getItem(SEEN_KEY); } catch (e) { return null; }
  }

  function setSeen(v) {
    try { localStorage.setItem(SEEN_KEY, v); } catch (e) { /* private mode — stay quiet */ }
  }

  function mount(data) {
    if (!data || !data.length) return;
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      var inner = document.querySelector('#site-header .header-inner');
      if (inner) {
        clearInterval(timer);
        build(inner, data);
      } else if (tries >= MAX_TRIES) {
        clearInterval(timer);
      }
    }, 100);
  }

  function build(inner, data) {
    if (document.getElementById('tv-whatsnew')) return;
    var latest = data[0].version;
    var hasNew = getSeen() !== latest;

    var btn = document.createElement('button');
    btn.id = 'tv-whatsnew';
    btn.className = 'tv-whatsnew-pill';
    btn.type = 'button';
    btn.setAttribute('aria-label', "What's new in The Foundry");
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML =
      '<span class="tv-whatsnew-dot"' + (hasNew ? '' : ' hidden') + '></span>' +
      '<span aria-hidden="true">✨</span><span class="tv-whatsnew-label">What\'s new</span>';

    /* sit right after the logo / online pill, before the search box */
    var anchor = inner.querySelector('#tv-online');
    if (anchor && anchor.nextSibling) {
      inner.insertBefore(btn, anchor.nextSibling);
    } else {
      var search = inner.querySelector('.search-wrap');
      if (search) inner.insertBefore(btn, search);
      else inner.appendChild(btn);
    }

    var panel = document.createElement('div');
    panel.id = 'tv-whatsnew-panel';
    panel.className = 'tv-whatsnew-panel';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', "What's new");
    panel.innerHTML =
      '<div class="tv-whatsnew-head"><b>✨ What\'s new</b>' +
      '<button class="tv-whatsnew-close" type="button" aria-label="Close">✕</button></div>' +
      '<div class="tv-whatsnew-list">' +
      data.slice(0, 8).map(function (v) {
        /* notes can be a string (older changelog entries) or an array — normalize */
        var notesRaw = Array.isArray(v.notes) ? v.notes : (v.notes ? [v.notes] : []);
        var ver = v.version || v.v || '';
        var notes = notesRaw.map(function (n) {
          return '<li>' + esc(n) + '</li>';
        }).join('');
        return '<div class="tv-whatsnew-item">' +
          '<div class="tv-whatsnew-ver"><span class="tv-whatsnew-badge">v' + esc(ver) + '</span>' +
          '<span class="tv-whatsnew-date">' + esc(v.date || '') + '</span></div>' +
          '<ul>' + notes + '</ul></div>';
      }).join('') +
      '</div>';
    document.body.appendChild(panel);

    function close() {
      panel.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('click', onDocClick, true);
    }
    function onDocClick(e) {
      if (!panel.contains(e.target) && e.target !== btn && !btn.contains(e.target)) close();
    }
    function toggle() {
      if (panel.hidden) {
        /* position under the pill */
        var r = btn.getBoundingClientRect();
        panel.style.top = (r.bottom + window.scrollY + 8) + 'px';
        panel.style.left = Math.max(8, Math.min(r.left + window.scrollX,
          document.documentElement.clientWidth - 330)) + 'px';
        panel.hidden = false;
        btn.setAttribute('aria-expanded', 'true');
        document.addEventListener('click', onDocClick, true);
        /* marking seen as soon as they've opened it (was: only on close,
           so Escape / outside-click left the dot stuck on) */
        setSeen(latest);
        var dot = btn.querySelector('.tv-whatsnew-dot');
        if (dot) dot.hidden = true;
      } else {
        close();
      }
    }
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      toggle();
    });
    panel.querySelector('.tv-whatsnew-close').addEventListener('click', function () {
      close();
      setSeen(latest);
      var dot = btn.querySelector('.tv-whatsnew-dot');
      if (dot) dot.hidden = true;
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !panel.hidden) close();
    });
  }

  function init() {
    fetch('changelog.json', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(mount)
      .catch(function () { /* offline — stay quiet */ });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
