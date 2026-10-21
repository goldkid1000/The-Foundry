/* The Foundry — UI effects: animated counters, tap ripple, pull-to-refresh.
   Vanilla JS, no dependencies. All motion respects prefers-reduced-motion. */
(function () {
  'use strict';

  var reducedMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- animated counters: <b data-count="123"> ---------- */
  /* data-count="builds" loads the live build count dynamically */
  function animateCount(el) {
    var raw = el.getAttribute('data-count');
    if (raw === 'builds') { loadLiveBuildCount(el); return; }
    var target = parseInt(raw, 10);
    if (isNaN(target)) return;
    function fmt(n) { return n.toLocaleString('en-US'); }
    if (reducedMotion) { el.textContent = fmt(target); return; }
    var dur = 1300, start = null;
    function step(ts) {
      if (!start) start = ts;
      var p = Math.min((ts - start) / dur, 1);
      var eased = 1 - Math.pow(1 - p, 3); /* easeOutCubic */
      el.textContent = fmt(Math.round(target * eased));
      if (p < 1) requestAnimationFrame(step);
      else el.textContent = fmt(target);
    }
    requestAnimationFrame(step);
  }

  function loadLiveBuildCount(el) {
    function fmt(n) { return n.toLocaleString('en-US'); }
    /* v2.12.38: fetch all part files in parallel (was sequential — too slow) */
    var base = 'data/site/builds-';
    var promises = [];
    for (var i = 0; i <= 10; i++) {
      promises.push(
        fetch(base + i + '.json', { cache: 'no-store' }).then(function (r) {
          return r.ok ? r.json() : [];
        }).catch(function () { return []; })
      );
    }
    Promise.all(promises).then(function (results) {
      var total = 0;
      results.forEach(function (d) { total += d.length; });
      el.setAttribute('data-count', total);
      animateCount(el);
    });
  }

  function initCounters() {
    var els = document.querySelectorAll('[data-count]');
    if (!els.length) return;
    if (!('IntersectionObserver' in window)) {
      for (var i = 0; i < els.length; i++) animateCount(els[i]);
      return;
    }
    var seen = new WeakSet();
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting && !seen.has(en.target)) {
          seen.add(en.target);
          animateCount(en.target);
          io.unobserve(en.target);
        }
      });
    }, { threshold: 0.4 });
    for (var j = 0; j < els.length; j++) io.observe(els[j]);
  }

  /* ---------- tap ripple on buttons, chips, cards, tabs ---------- */
  function initRipple() {
    if (reducedMotion) return;
    document.addEventListener('pointerdown', function (e) {
      var t = e.target.closest && e.target.closest('.btn, .chip, #tabbar a, a.card, .vai-chip');
      if (!t) return;
      var rect = t.getBoundingClientRect();
      var size = Math.max(rect.width, rect.height);
      var ripple = document.createElement('span');
      ripple.className = 'tv-ripple';
      ripple.style.width = ripple.style.height = size + 'px';
      /* position relative to the target */
      var x = (e.clientX - rect.left - size / 2);
      var y = (e.clientY - rect.top - size / 2);
      ripple.style.left = x + 'px';
      ripple.style.top = y + 'px';
      t.appendChild(ripple);
      setTimeout(function () { if (ripple.parentNode) ripple.parentNode.removeChild(ripple); }, 600);
    }, { passive: true });
  }

  /* ---------- pull-to-refresh (touch devices, at scroll top) ---------- */
  function initPullToRefresh() {
    if (!('ontouchstart' in window) || reducedMotion) return;
    var startY = 0, pulling = false, el = null, pullDist = 0;

    function ensure() {
      if (!el) {
        el = document.createElement('div');
        el.id = 'tv-ptr';
        el.setAttribute('aria-hidden', 'true');
        el.innerHTML = '<div class="tv-ptr-spin"></div>';
        document.body.appendChild(el);
      }
      return el;
    }
    function hide() {
      if (el) {
        el.classList.remove('show', 'ready');
        el.style.transform = '';
        pullDist = 0;
      }
    }

    document.addEventListener('touchstart', function (e) {
      if (window.scrollY <= 0 && !pulling && e.touches.length === 1) {
        startY = e.touches[0].clientY;
        pulling = true;
        pullDist = 0;
      }
    }, { passive: true });

    document.addEventListener('touchmove', function (e) {
      if (!pulling) return;
      var dy = e.touches[0].clientY - startY;
      if (dy > 8 && window.scrollY <= 0) {
        var ind = ensure();
        pullDist = Math.min(dy, 130);
        ind.classList.add('show');
        /* slide the indicator down with the pull */
        ind.style.transform = 'translate(-50%, ' + Math.round(pullDist - 70) + 'px)';
        if (pullDist > 90) ind.classList.add('ready');
        else ind.classList.remove('ready');
      } else if (dy <= 0) {
        hide();
        pulling = false;
      }
    }, { passive: true });

    document.addEventListener('touchend', function () {
      if (!pulling) return;
      pulling = false;
      if (pullDist > 90 && el) {
        el.classList.add('loading');
        el.style.transform = 'translate(-50%, 14px)';
        setTimeout(function () { window.location.reload(); }, 450);
      } else {
        hide();
      }
    }, { passive: true });

    document.addEventListener('touchcancel', function () {
      pulling = false;
      hide();
    }, { passive: true });
  }

  /* ---------- init ---------- */
  function init() {
    initCounters();
    initRipple();
    initPullToRefresh();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
