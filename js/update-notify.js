/* Tenno Vault — update flow. When a new version is detected:
   1. Popup appears: "Update available" + version + what's new
   2. "Update" button next to it
   3. Tapping Update shows a loading bar, clears caches, unregisters the SW
   4. Auto-refreshes when done
   Works on mobile PWA, PC installed app, and regular browser tabs.
   v2.12.69: anti-strand rewrite —
   - TV_BUILD_VERSION is the source of truth for "am I old?", not localStorage.
     The old code marked the REMOTE version as seen on first load even when the
     running page was a stale cached build, so the popup never fired (stranded).
   - The notice is consumed only when the NEW build actually boots: tapping
     Update sets a sessionStorage pending flag; boot clears it only if the
     running build matches. A failed update re-prompts instead of going silent.
   - Dismiss/Later is remembered per version (not "never ask again" globally).
   - window.location.reload(true) was a deprecated no-op — plain reload(). */
(function () {
  'use strict';

  /* BUMP WITH EVERY RELEASE — this is how the running page knows its own age */
  var TV_BUILD_VERSION = '2.12.69';

  var CHECK_INTERVAL = 15 * 60 * 1000; /* check every 15 minutes */
  var updating = false;
  var pendingData = null;

  function dismissedFor(v) {
    try { return localStorage.getItem('tv-dismissed-' + v) === '1'; } catch (e) { return false; }
  }
  function markDismissed(v) {
    try { localStorage.setItem('tv-dismissed-' + v, '1'); } catch (e) {}
  }
  function getPending() {
    try { return sessionStorage.getItem('tv-update-pending'); } catch (e) { return null; }
  }
  function setPending(v) {
    try { sessionStorage.setItem('tv-update-pending', v); } catch (e) {}
  }
  function clearPending() {
    try { sessionStorage.removeItem('tv-update-pending'); } catch (e) {}
  }

  /* boot: consume the pending-update notice ONLY when the new build is running.
     If we're still on the old build, the update didn't land — leave the flag
     so check() re-prompts instead of going silent. */
  (function consumePending() {
    var p = getPending();
    if (p && p === TV_BUILD_VERSION) clearPending();
  })();

  function check() {
    if (updating) return;
    fetch('version.json', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || !data.version) return;
        /* the RUNNING build is older than what's published → update available.
           Never mark anything "seen" here: a stale cached page must still fire. */
        if (data.version !== TV_BUILD_VERSION) {
          pendingData = data;
          /* only pop up for real updates WE push (notify flag) —
             not auto-added content like content-watch videos */
          if (data.notify === true && !dismissedFor(data.version)) {
            showUpdatePopup(data);
          }
        }
        /* running build == published version: nothing to do */
      })
      .catch(function () { /* offline — stay quiet */ });
  }

  /* ---------- the popup ---------- */
  function showUpdatePopup(data) {
    if (document.getElementById('tv-update-popup')) return;
    if (updating) return;

    var notesHTML = '';
    if (data.notes) {
      var items = String(data.notes).split(/,\s*/);
      if (items.length > 1) {
        notesHTML = '<ul class="tv-upd-list">' +
          items.map(function (n) { return '<li>' + escapeHtml(n.trim()) + '</li>'; }).join('') +
          '</ul>';
      } else {
        notesHTML = '<p class="tv-upd-notes">' + escapeHtml(data.notes) + '</p>';
      }
    }

    var p = document.createElement('div');
    p.id = 'tv-update-popup';
    p.setAttribute('role', 'alertdialog');
    p.setAttribute('aria-label', 'Update available');
    p.innerHTML =
      '<div class="tv-upd-card">' +
        '<div class="tv-upd-head">' +
          '<span class="tv-upd-icon">🚀</span>' +
          '<div><b>Update available</b>' +
          '<span class="tv-upd-ver">v' + escapeHtml(data.version) + '</span></div>' +
          '<button class="tv-upd-dismiss" aria-label="Dismiss">×</button>' +
        '</div>' +
        notesHTML +
        '<div class="tv-upd-actions">' +
          '<button id="tv-upd-btn" class="btn primary">⬇ Update</button>' +
          '<button id="tv-upd-later" class="btn ghost">Later</button>' +
        '</div>' +
        '<div class="tv-upd-progress" hidden>' +
          '<div class="tv-upd-bar"><div class="tv-upd-fill"></div></div>' +
          '<span class="tv-upd-status">Updating…</span>' +
        '</div>' +
      '</div>';
    document.body.appendChild(p);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { p.classList.add('show'); });
    });

    p.querySelector('.tv-upd-dismiss').addEventListener('click', dismiss);
    p.querySelector('#tv-upd-later').addEventListener('click', dismiss);
    p.querySelector('#tv-upd-btn').addEventListener('click', startUpdate);
  }

  /* Dismiss/Later = "not this version", remembered per version. A future
     version still prompts. */
  function dismiss() {
    var p = document.getElementById('tv-update-popup');
    if (!p || updating) return;
    if (pendingData && pendingData.version) markDismissed(pendingData.version);
    p.classList.remove('show');
    setTimeout(function () { if (p.parentNode) p.parentNode.removeChild(p); }, 350);
  }

  /* ---------- the update with loading bar ---------- */
  function startUpdate() {
    if (updating) return;
    updating = true;
    var p = document.getElementById('tv-update-popup');
    if (!p) return;
    var prog = p.querySelector('.tv-upd-progress');
    var fill = p.querySelector('.tv-upd-fill');
    var status = p.querySelector('.tv-upd-status');
    var actions = p.querySelector('.tv-upd-actions');
    if (actions) actions.style.display = 'none';
    prog.hidden = false;

    var steps = [
      ['Checking for new files…', 15],
      ['Downloading update…', 45],
      ['Clearing old cache…', 70],
      ['Finalizing…', 90]
    ];
    var i = 0;
    function nextStep() {
      if (i < steps.length) {
        status.textContent = steps[i][0];
        fill.style.width = steps[i][1] + '%';
        i++;
        setTimeout(nextStep, 600 + Math.random() * 500);
      } else {
        doActualUpdate(fill, status);
      }
    }
    nextStep();
  }

  function doActualUpdate(fill, status) {
    status.textContent = 'Almost done…';
    fill.style.width = '95%';
    var done = function () {
      fill.style.width = '100%';
      status.textContent = 'Done! Refreshing…';
      /* notice is consumed only when the NEW build boots (see consumePending).
         If the reload still serves the old build, check() will re-prompt. */
      if (pendingData && pendingData.version) setPending(pendingData.version);
      setTimeout(function () { window.location.reload(); }, 800);
    };
    /* clear caches + unregister service worker so nothing stale survives */
    var clearCaches = ('caches' in window)
      ? caches.keys().then(function (names) {
          return Promise.all(names.map(function (n) { return caches.delete(n); }));
        })
      : Promise.resolve();
    var unregSW = ('serviceWorker' in navigator)
      ? navigator.serviceWorker.getRegistrations().then(function (regs) {
          return Promise.all(regs.map(function (r) { return r.unregister(); }));
        })
      : Promise.resolve();
    Promise.all([clearCaches, unregSW]).then(done).catch(done);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* init: check shortly after load, then periodically */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(check, 3000); });
  } else {
    setTimeout(check, 3000);
  }
  setInterval(check, CHECK_INTERVAL);

  /* also check when the app comes back to foreground (mobile) */
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') check();
  });

  /* expose for manual trigger / debugging */
  window.TV = window.TV || {};
  window.TV.checkForUpdate = check;
  window.TV.buildVersion = TV_BUILD_VERSION;
})();
