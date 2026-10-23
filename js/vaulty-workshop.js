/* The Foundry — Vaulty Workshop (v2.23.0; created v2.22.0).
   Generative build composition, with the owner's rules welded in:
   Vaulty may INVENT BUILDS (original compositions) but may NEVER
   invent MODS. A creative build brief ("design…", "come up with…",
   "weird off-meta…", "full damage…", "focused on <ability>…") is handed
   here by the guide brain (js/ai-fallback.js, which owns detection and
   the composer). The Workshop takes its time, in the open:

     Researching <item>…   live item data (warframestat.us): damage
                           split, crit/status profile — the composition
                           is grounded in what the item actually does.
     Designing your build… the composer (TVAI._workshopCompose) fills
                           8 slots strictly from the mods database.
     Verifying every mod…  the build must pass buildIsValid() plus a
                           capacity sanity check against live drain data.

   A build that fails verification is never displayed: the item's proven
   library build serves instead, or the honest don't-know. The free-chat
   model never authors a mod list — in AI mode this same path serves,
   behind the extended _validateAnswer fabricated-name scan. */
(function () {
  'use strict';

  function esc(s) {
    if (window.TV && window.TV.esc) return window.TV.esc(s);
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function norm(s) { return String(s || '').toLowerCase().trim(); }

  function fetchJSON(url, ms) {
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, ms || 7000) : null;
    return fetch(url, ctrl ? { signal: ctrl.signal } : {}).then(function (r) {
      if (timer) clearTimeout(timer);
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    }).catch(function (e) { if (timer) clearTimeout(timer); throw e; });
  }

  function isHandoff(html) {
    return String(html == null ? '' : html).indexOf('vai-workshop-handoff') !== -1;
  }
  function parsePlan(html) {
    var m = String(html == null ? '' : html).match(/data-plan="([^"]*)"/);
    if (!m) return null;
    try { return JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&')); } catch (e) { return null; }
  }

  /* ---------- stage 1: research the item ----------
     warframestat item entry: crit/status profile + the damage split the
     composition keys off. Best-effort — the Vault's own data is the
     offline fallback and the composer says which one grounded it. */
  function researchItem(itemName) {
    var url = 'https://api.warframestat.us/items/search/' + encodeURIComponent(itemName) + '?language=en';
    return fetchJSON(url, 8000).then(function (arr) {
      if (!arr || !arr.length) return null;
      var want = norm(itemName), best = null;
      for (var i = 0; i < arr.length; i++) {
        if (arr[i] && norm(arr[i].name) === want && arr[i].category !== 'Skins') { best = arr[i]; break; }
      }
      if (!best) return null;
      var prof = {};
      if (best.criticalChance != null) prof.cc = Math.round(best.criticalChance * 1000) / 10;
      if (best.procChance != null) prof.sc = Math.round(best.procChance * 1000) / 10;
      if (best.criticalMultiplier != null) prof.cm = best.criticalMultiplier;
      if (best.damage) {
        var skip = { total: 1, shieldDrain: 1, healthDrain: 1, energyDrain: 1, cinematic: 1, 'true': 1 };
        var types = Object.keys(best.damage).filter(function (k) {
          return !skip[k] && best.damage[k] > 0;
        }).sort(function (a, b) { return best.damage[b] - best.damage[a]; });
        prof.damageTypes = types.slice(0, 3).map(function (k) { return k.charAt(0).toUpperCase() + k.slice(1); });
      }
      return prof;
    }).catch(function () { return null; });
  }

  /* ---------- stage 3: drain data for the capacity check ---------- */
  function fetchDrain(name) {
    var url = 'https://api.warframestat.us/items/search/' + encodeURIComponent(name) + '?language=en';
    return fetchJSON(url, 6000).then(function (arr) {
      if (!arr || !arr.length) return null;
      var want = norm(name);
      for (var i = 0; i < arr.length; i++) {
        var it = arr[i];
        if (it && norm(it.name) === want && it.baseDrain != null && it.fusionLimit != null) {
          return it.baseDrain + it.fusionLimit;
        }
      }
      return null;
    }).catch(function () { return null; });
  }
  function fetchDrains(build) {
    var names = build.mods.map(function (m) { return m.name; });
    if (build.exilus) names.push(build.exilus);
    if (build.aura) names.push(build.aura);
    return Promise.all(names.map(function (n) {
      return fetchDrain(n).then(function (d) { return [norm(n), d]; });
    })).then(function (pairs) {
      var out = {};
      pairs.forEach(function (p) { if (p[1] != null) out[p[0]] = p[1]; });
      return Object.keys(out).length ? out : null;
    });
  }

  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  /* ---------- orchestration ----------
     Appends a progress message with the staged bar + a Stop button
     (text button — no × glyph), then replaces it with the composed
     build card, the library fallback, or the honest don't-know. */
  function handle(q, handoffHtml, msgsEl, render, opts) {
    var TVAI = window.TVAI;
    var planInfo = parsePlan(handoffHtml) || {};
    var itemLabel = planInfo.item || 'your item';
    var token = { cancelled: false };
    var stageNames = [
      'Researching ' + itemLabel + '…',
      'Designing your build…',
      'Verifying every mod…'
    ];
    var pel = document.createElement('div');
    pel.className = 'vai-msg bot vws-progress';
    pel.innerHTML =
      '<div class="vres-title">🛠 In the Workshop — composing an original ' + esc(itemLabel) + ' build</div>' +
      '<div class="vres-barwrap"><div class="vres-bar" style="width:4%"></div></div>' +
      '<div class="vres-stage muted small">' + esc(stageNames[0]) + '</div>' +
      '<button type="button" class="vres-stop">Stop</button>';
    if (msgsEl) {
      msgsEl.appendChild(pel);
      msgsEl.scrollTop = msgsEl.scrollHeight;
    }
    var bar = pel.querySelector('.vres-bar');
    var stageEl = pel.querySelector('.vres-stage');
    var stopBtn = pel.querySelector('.vres-stop');
    var done = false;
    function setStage(idx) {
      if (stageEl) stageEl.textContent = stageNames[idx];
      if (bar) bar.style.width = Math.min(96, 10 + idx * 32) + '%';
      if (msgsEl) msgsEl.scrollTop = msgsEl.scrollHeight;
    }
    function finish(html) {
      if (done) return;
      done = true;
      if (pel.parentNode) pel.parentNode.removeChild(pel);
      render(html);
    }
    if (stopBtn) stopBtn.addEventListener('click', function () {
      token.cancelled = true;
      finish('<p>🛠 Stopped — the Workshop put its tools down. Ask again any time, or say <i>"' +
        esc(itemLabel) + ' build"</i> for the Vault\'s proven library build instead.</p>');
    });
    function fail() {
      var fb = (TVAI && TVAI._workshopFallback) ? TVAI._workshopFallback(itemLabel) : null;
      if (fb) {
        finish('<p>🛠 The Workshop couldn\'t compose a build for <b>' + esc(itemLabel) +
          '</b> that passed every check — so here\'s a proven one from the library instead:</p>' + fb);
      } else {
        finish('<p>🛠 The Workshop couldn\'t compose a build for <b>' + esc(itemLabel) +
          '</b> that passed every check, and the library has none either — I won\'t invent mods to fill the gap.</p>' +
          (TVAI && TVAI._research ? TVAI._research(q) : ''));
      }
    }
    /* v2.22.0: render the verified build. In AI mode the caller may pass
       opts.proseWriter(dossier) — the on-device model rewriting the
       dossier's connective prose from the VERIFIED dossier facts only.
       The card, the layout and every number stay engine-rendered; a
       prose failure or rejection falls back to the engine's prose. */
    function emitBuild(finalBuild, res) {
      if (opts && opts.proseWriter && TVAI._workshopDossier) {
        var dossier = null;
        try { dossier = TVAI._workshopDossier(finalBuild, res.plan, res.profile); } catch (e) { dossier = null; }
        if (dossier) {
          Promise.resolve(opts.proseWriter(dossier)).then(function (ph) {
            if (token.cancelled || done) return;
            finish(TVAI._workshopRender(finalBuild, res.plan, res.profile, ph || null));
          }, function () {
            if (token.cancelled || done) return;
            finish(TVAI._workshopRender(finalBuild, res.plan, res.profile));
          });
          return;
        }
      }
      finish(TVAI._workshopRender(finalBuild, res.plan, res.profile));
    }
    if (!TVAI || !TVAI._workshopCompose) { fail(); return; }

    setStage(0);
    Promise.all([TVAI._load(), researchItem(itemLabel), delay(500)])
      .then(function (r) {
        if (token.cancelled || done) return null;
        setStage(1);
        return delay(450).then(function () {
          if (token.cancelled || done) return null;
          return TVAI._workshopCompose(q, r[1], planInfo);
        });
      })
      .then(function (res) {
        if (token.cancelled || done) return;
        if (!res || !res.build) { fail(); return; }
        setStage(2);
        fetchDrains(res.build).then(function (drains) {
          if (token.cancelled || done) return;
          var finalBuild = TVAI._workshopVerify(res.build, drains);
          if (!finalBuild) { fail(); return; }
          delay(350).then(function () {
            if (token.cancelled || done) return;
            emitBuild(finalBuild, res);
          });
        }).catch(function () {
          if (token.cancelled || done) return;
          var noDrain = TVAI._workshopVerify(res.build, null);
          if (noDrain) emitBuild(noDrain, res);
          else fail();
        });
      })
      .catch(function () { if (!done && !token.cancelled) fail(); });
  }

  /* ---------- v2.23.0: BUILD CHECKER orchestration ----------
     The guide brain parsed the Tenno's own pasted build and handed it
     over (vai-checker-handoff). Checking needs REAL drain data for the
     capacity verdict, so — exactly like composition — it happens here:
     a short staged progress, a drain fetch for every named mod, then
     TVAI._checkBuildReport renders the verdict. If the drain fetch
     fails entirely, the report still renders with the capacity line
     honestly marked unchecked. */
  function handleCheck(q, handoffHtml, msgsEl, render) {
    var TVAI = window.TVAI;
    var plan = parsePlan(handoffHtml);
    if (!plan || !TVAI || !TVAI._checkBuildReport) { render(''); return; }
    var pel = document.createElement('div');
    pel.className = 'vai-msg bot vws-progress';
    pel.innerHTML =
      '<div class="vres-title">🔎 Checking your ' + esc(plan.item || 'build') + ' build…</div>' +
      '<div class="vres-barwrap"><div class="vres-bar" style="width:35%"></div></div>' +
      '<div class="vres-stage muted small">Verifying every mod against the database…</div>';
    if (msgsEl) {
      msgsEl.appendChild(pel);
      msgsEl.scrollTop = msgsEl.scrollHeight;
    }
    var fakeBuild = { mods: (plan.known || []).map(function (k) { return { name: k.name }; }) };
    fetchDrains(fakeBuild).then(function (drains) {
      if (pel.parentNode) pel.parentNode.removeChild(pel);
      var html = TVAI._checkBuildReport(plan, drains);
      render(html || '');
    }).catch(function () {
      if (pel.parentNode) pel.parentNode.removeChild(pel);
      var html = TVAI._checkBuildReport(plan, null);
      render(html || '');
    });
  }

  window.TVWorkshop = {
    isHandoff: isHandoff,
    parsePlan: parsePlan,
    handle: handle,
    handleCheck: handleCheck,
    _researchItem: researchItem,
    _fetchDrains: fetchDrains,
    stages: ['Researching the item', 'Designing your build', 'Verifying every mod']
  };
})();
