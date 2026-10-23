/* The Foundry — Vault Guide chat, now powered by a real in-browser LLM (WebLLM).
   Runs Llama-3.2-3B-Instruct entirely on-device via WebGPU — no API keys, no server.
   Falls back to the keyword guide (js/ai-fallback.js) when WebGPU is unavailable. */
(function () {
  'use strict';

  var FALLBACK = (window.TVAI && window.TVAI._answer) ? window.TVAI : null;
  var opened = false;
  var els = {};

  /* ---------- engine state ---------- */
  var engine = null;          /* MLCEngine once loaded */
  var engineLoading = false;
  var engineFailed = false;
  /* v2.23.0: two sizes — the desktop full model (unchanged) and the
     smallest suitable model for phones, picked by the capability gate
     below. MODEL_ID is the ACTIVE one; the choice persists on-device. */
  var MODEL_DESKTOP = 'Llama-3.2-3B-Instruct-q4f16_1-MLC';
  var MODEL_SMALL = 'Llama-3.2-1B-Instruct-q4f16_1-MLC';
  var MODEL_ID = MODEL_DESKTOP;
  var WEBLLM_CDN = 'https://esm.sh/@mlc-ai/web-llm@0.2.85';
  var history = [];           /* recent conversation for context */
  /* v2.19.2: the ~2GB model lives in Cache Storage ('webllm/model'), which
     the site's own update machinery used to wipe on every release — the
     download loop the owner hit. That wipe is fixed in sw.js /
     update-notify.js / index.html; the state below makes this panel honest
     and non-looping on its own side too: explicit tap-to-download (never
     auto-start), persistent-storage request on opt-in, a status derived
     from a real cache check, and after a failed attempt + one retry the
     panel settles into quick-answer mode instead of re-prompting. */
  var webllmPromise = null;   /* the imported web-llm module (code only) */
  var modelCached = null;     /* null=unchecked, true/false from hasModelInCache */
  var downloadAttempts = 0;   /* user-tapped download attempts this session */
  var aiSettled = false;      /* true once we stop offering the download */
  var greetMsgShown = false;  /* one-time messages: each is said only once */
  var settleMsgShown = false;
  /* v2.23.0: download cancel + the mobile/iOS load guard. The guard is
     a localStorage flag set BEFORE a phone engine init and cleared on
     success: if the page is found with the flag still set, the last
     attempt died mid-load (mobile Safari jetsam) — the panel settles
     into guide mode and NEVER auto-retries. That is what makes an
     iOS attempt incapable of recreating the v2.19.3 crash loop. */
  var dlCancelled = false;
  var lastQ = '';
  var offerShown = { ask: false, miss: false };
  var GUARD_KEY = 'tv-ai-load-guard';
  var OFF_KEY = 'tv-ai-off';
  var MODEL_KEY = 'tv-ai-model';
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function aiOff() { return lsGet(OFF_KEY) === '1'; }
  function guardGet() { return lsGet(GUARD_KEY); }
  function storedModelId() { return lsGet(MODEL_KEY); }

  function greetFallbackOnce() {
    if (greetMsgShown) return;
    greetMsgShown = true;
    addMsg('Hey Tenno! ◈ Running in quick-answer mode on this device. Ask me about builds, farming, mods — anything Warframe.', 'bot');
  }

  function esc(s) {
    if (window.TV) return window.TV.esc(s);
    return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }

  /* minimal markdown -> html for LLM output */
  function md(text) {
    var s = esc(text);
    s = s.replace(/```([\s\S]*?)```/g, function (m, code) { return '<pre>' + code.trim() + '</pre>'; });
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    s = s.replace(/(^|\W)\*([^*\n]+)\*/g, '$1<i>$2</i>');
    s = s.replace(/^### (.+)$/gm, '<b>$1</b>');
    s = s.replace(/^## (.+)$/gm, '<b>$1</b>');
    s = s.replace(/^\s*[-•] (.+)$/gm, '<li>$1</li>');
    s = s.replace(/^\s*\d+\. (.+)$/gm, '<li>$1</li>');
    s = s.replace(/(<li>.*<\/li>\n?)+/g, function (m) { return '<ul>' + m + '</ul>'; });
    s = s.replace(/\n{2,}/g, '</p><p>');
    s = s.replace(/\n/g, '<br>');
    return '<p>' + s + '</p>';
  }

  /* ---------- system prompt ---------- */
  var SYSTEM_PROMPT = [
    'You are the Vault Guide, an expert Warframe build advisor inside The Foundry app.',
    'You are the Vault Guide, a knowledgeable Warframe friend inside The Foundry app. Talk like a real person helping a friend — natural, conversational, a little personality. Not a robot, not a wiki article.',
    'Answer the actual question asked. If someone asks "where do I farm X", tell them the planet, the mission/node, and why that spot is best. Don\'t just list data — explain it like you\'re helping a friend.',
    'Keep answers focused but complete. Use short paragraphs, not walls of text. If they ask for a build, give the mods AND explain why each one matters in plain language.',
    'If you don\'t know something specific, say so honestly and point them to what you do know that\'s related.',
    'When recommending mods, ALWAYS explain WHY each mod matters in one short phrase, and mention where to farm it if it is rare.',
    '',
    'STEEL PATH ONE-SHOT FORMULA (the core of every build below):',
    '1. Hunter Munitions on crit weapons: crits trigger slash procs that IGNORE ARMOR.',
    '2. Viral (60/60 mods): multiplies health damage, making slash ticks hit much harder.',
    '3. Armor strip: Corrosive Projection aura (equipped on your Warframe — weapons have no aura slot), Unairu Caustic Strike, or viral+slash bypasses armor anyway.',
    '4. Crit stacking: Critical Delay + Vital Sense (rifles), Primed Ravage + Vigilante Armaments (shotguns), Blood Rush + Weeping Wounds (melee combo).',
    '5. Faction damage: Primed Bane mods (Bane of Grineer/Corpus/Infested/Corrupted) = huge multiplicative damage.',
    '6. Galvanized mods: on-kill stacking damage/multishot that snowballs through crowds.',
    '',
    'CURATED ONE-SHOT BUILDS (8 mods each, riven-less):',
    'Kuva Zarr: Galvanized Chamber, Semi-Rifle Cannonade, Critical Delay, Vital Sense, Primed Cryo Rounds, Hunter Munitions, Primed Bane Of Grineer, Primed Firestorm',
    'Kuva Bramma: Galvanized Chamber, Serration, Critical Delay, Vital Sense, Primed Cryo Rounds, Hunter Munitions, Primed Bane Of Grineer, Primed Firestorm',
    'Phenmor (Incarnon): Galvanized Chamber, Serration, Critical Delay, Vital Sense, Malignant Force, Rime Rounds, Hunter Munitions, Primed Bane Of Grineer',
    'Laetum (Incarnon pistol): Hornet Strike, Barrel Diffusion, Lethal Torrent, Primed Pistol Gambit, Primed Target Cracker, Pistol Pestilence, Frostbite, Galvanized Shot',
    'Tenet Arca Plasmor: Primed Point Blank, Galvanized Hell, Primed Ravage, Blunderbuss, Chilling Reload, Toxic Barrage, Hunter Munitions, Primed Bane Of Grineer',
    'Nataruk: Serration, Galvanized Chamber, Point Strike, Vital Sense, Hunter Munitions, Infected Clip, Cryo Rounds, Primed Bane Of Grineer',
    'Felarx (shotgun): Primed Point Blank, Galvanized Hell, Primed Ravage, Blunderbuss, Chilling Reload, Toxic Barrage, Hunter Munitions, Primed Bane Of Grineer',
    'Steflos (shotgun): Primed Point Blank, Hell\'s Chamber, Galvanized Hell, Primed Ravage, Vigilante Armaments, Hunter Munitions, Contagious Spread, Shell Shock',
    'Tenet Envoy: Serration, Galvanized Chamber, Critical Delay, Vital Sense, Hunter Munitions, Infected Clip, Cryo Rounds, Primed Firestorm',
    'Phantasma Prime: Primed Point Blank, Galvanized Hell, Primed Ravage, Blunderbuss, Frigid Blast, Toxic Barrage, Hunter Munitions, Primed Bane Of Grineer',
    'Kuva Nukor (primer): Hornet Strike, Galvanized Shot, Lethal Torrent, Barrel Diffusion, Pistol Pestilence, Frostbite, Jolt, Primed Heated Charge',
    'Epitaph (primer): Hornet Strike, Lethal Torrent, Barrel Diffusion, Pistol Pestilence, Frostbite, Jolt, Ice Storm, Seeker',
    'Tenet Grigori (melee): Corrupt Charge, Killing Blow, Amalgam Organ Shatter, Primed Pressure Point, Sacrificial Steel, Primed Reach, Primed Fury, Reflex Coil',
    'Kronen Prime (melee): Blood Rush, Weeping Wounds, Condition Overload, Organ Shatter, Primed Reach, Berserker Fury, Virulent Scourge, Vicious Frost',
    'Nova Prime (Antimatter nuke): Blind Rage, Transient Fortitude, Umbral Intensify, Primed Continuity, Stretch, Augur Reach, Antimatter Absorb, Rolling Guard',
    'Rhino Prime (Roar platform): Blind Rage, Transient Fortitude, Umbral Intensify, Primed Continuity, Constitution, Iron Shrapnel, Rolling Guard, Adaptation',
    'Mirage Prime (Eclipse): Blind Rage, Transient Fortitude, Umbral Intensify, Primed Continuity, Constitution, Total Eclipse, Rolling Guard, Adaptation',
    'Octavia Prime (Mallet): Blind Rage, Transient Fortitude, Primed Continuity, Constitution, Stretch, Augur Message, Rolling Guard, Adaptation',
    '',
    'AURA MODS: Corrosive Projection (armor strip, best for Steel Path), Energy Siphon (energy regen), Brief Respite (shields on ability cast), Growing Power (+power strength on status proc), Empowered Blades (+melee damage on ability cast), Rejuvenation (health regen), Steel Charge (+melee damage, high capacity), Dead Eye/Rifle Amp/Shotgun Amp/Pistol Amp (weapon damage auras).',
    '',
    'FRAME DAMAGE ENABLERS: Rhino Roar (faction-style damage buff), Mirage Eclipse (huge damage in light), Chroma Vex Armor (damage + armor on hits), Nova Antimatter Drop (chargeable nuke orb), Octavia Mallet (scales infinitely with enemy damage), Saryn Toxic Lash (toxin on weapons), Volt Shock Trooper (electric), Xaku Deny (defense strip).',
    '',
    'PRIMERS (apply status then swap to killer): Kuva Nukor (magnetic+viral primer), Epitaph (viral primer with AoE), Verglas Prime sentinel weapon + Manifold Bond (cold procs), Nautilus with Cordon (groups enemies).',
    '',
    'ARCHON SHARDS for one-shot builds: Crimson (power strength or crit damage), Amber (cast speed or energy), Azure (health or armor), Violet (crit damage on viral), Emerald (toxin damage). Tauforged = 1.5x value.',
    '',
    'AMPS: 777 (Klamora prism / Phahd scaffold / Certus brace) is the best amp. Use Madurai focus school (amp damage buffs after Void Sling), Virtuos Strike arcane (electric damage on headshot), Eternal Eradicate amp arcane. For Steel Path: Void Sling into enemy, headshot to proc Virtuos, hold Klamora beam point-blank.',
    '',
    'FARM NOTES: Primed mods come from Baro Ki\'Teer (void trader). Galvanized mods are bought from the Arbitrations vendor (Arbiters of Hexis room in any Relay) for 20 Vitus Essence each — Vitus Essence drops in Arbitration missions. Hunter Munitions from Ghoul Purge bounties on Cetus. 60/60 elemental mods from Spy missions and Corrupted Vor. Corrupt mods from Orokin Vaults (Deimos).',
    '',
    'LIVE QUESTIONS: if the Tenno asks about RIGHT NOW in-game (Baro Ki\'Teer, current events, fissures, Nightwave, the latest hotfix), the app answers those itself from the live worldstate feed — never guess at timers, dates, or stock lists from memory.',
    'RIVEN STATUS: Riven trading is temporarily disabled in-game right now (DE PSA, Oct 2026). Unveiling, rolling and using your own Rivens still works. DE is also retiring Riven dispositions, so every Riven is settling at a fixed 1.2 disposition.',
    'BUILDS RULE: never write out a mod list for a specific Warframe or weapon yourself — the app intercepts build questions and answers them from its verified build library. If a build request somehow reaches you anyway, explain the FORMULA and point to the Builds page instead of listing mods. Weapons have no aura slot: never put an aura mod in a weapon build.',
    'WORKSHOP RULE: the app also composes ORIGINAL builds in its Workshop — but composition is done by the app\'s engine from its verified mod database, never by you. You may discuss archetypes and emphasis in prose around an engine-made build; you may not author, add to, or "improve" a mod list. Any mod name you write must be a real, existing mod — an invented mod name gets the whole answer discarded and replaced.',
    'RESEARCH RULE: general questions are researched before they are answered — the app digs through live game data, the Warframe Wiki (including the pages it links to), and its own verified guide, and hands you ONLY those retrieved facts. When you are given a FACTS block, answer in natural, conversational prose from those facts alone. Never add numbers, drops, dates, or mechanics that are not in the facts. Never turn a researched answer into a mod list — builds are composed by the app\'s engine, not by you.',
    'HONESTY RULE: if you truly don\'t know a specific fact, say "I don\'t know that one" plainly — the app will offer the Tenno one-tap research buttons. Never invent drop locations, prices, dates, patch details, mod names, mod effects, or farm sources.'
  ].join('\n');

  /* ---------- WebGPU / engine ---------- */
  function hasWebGPU() {
    return typeof navigator !== 'undefined' && !!navigator.gpu;
  }

  /* v2.19.3: NEVER load WebLLM on iOS. The owner's screen recording shows
     the loop end to end: panel opens → model starts loading from cache →
     mobile Safari kills the page ("A problem repeatedly occurred") while
     the ~2GB model loads → reload → load restarts. iOS jetsam makes a 2GB
     in-tab model unloadable there, so on iPhone/iPad (Safari AND the iOS
     home-screen PWA — same engine, same UA family) and on any device
     without WebGPU, the panel is Vault Guide only: live answers + the
     guide brain, permanently. Desktop keeps the v2.19.2 opt-in flow. */
  function isIOS() {
    var ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    if (/iP(hone|ad|od)/.test(ua)) return true;
    /* iPadOS 13+ poses as a Mac in its UA; touch points give it away */
    return /Macintosh/.test(ua) && typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1;
  }
  function guideOnly() { return isIOS() || !hasWebGPU(); }
  var GUIDE_ONLY_STATUS = 'Quick-answer mode on iPhone — the AI download is experimental here (button below)';

  /* ---------- v2.23.0: the capability gate ----------
     Before ANY download is offered or started, the device is checked
     honestly: WebGPU present? Enough free storage (async estimate)?
     Enough reported memory? The gate picks the SMALLEST suitable
     model — phones always get the compact 1B, desktops keep the full
     3B — and when the device can't run it, the answer is a plain
     explanation plus guide mode, never a silent dead button. */
  function isMobileLike() {
    var ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)) return true;
    return typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1 &&
      typeof screen !== 'undefined' && Math.min(screen.width, screen.height) < 820;
  }
  function aiCapability() {
    var ios = isIOS();
    var mobile = isMobileLike();
    var tier = ios ? 'ios' : (mobile ? 'mobile' : 'desktop');
    var mem = (typeof navigator !== 'undefined' && typeof navigator.deviceMemory === 'number') ? navigator.deviceMemory : null;
    var reasons = [];
    var ok = true;
    if (!hasWebGPU()) {
      ok = false;
      reasons.push('this browser doesn\'t expose WebGPU, which the on-device AI needs to run at all');
    }
    if (mem !== null && mem < 2) {
      ok = false;
      reasons.push('the device reports very little memory (' + mem + 'GB), so the model would be killed as soon as it loads');
    }
    return {
      ok: ok, tier: tier, reasons: reasons, mem: mem, experimental: ios,
      modelId: tier === 'desktop' ? MODEL_DESKTOP : MODEL_SMALL,
      sizeMB: tier === 'desktop' ? 2200 : 800,
      modelLabel: tier === 'desktop' ? 'the full Vaulty AI (~2GB, one time)' : 'the compact Vaulty AI (~800MB, sized for phones)'
    };
  }
  function aiCapabilityAsync() {
    var cap = aiCapability();
    try {
      if (!navigator.storage || !navigator.storage.estimate) return Promise.resolve(cap);
      return navigator.storage.estimate().then(function (est) {
        if (est && typeof est.quota === 'number' && typeof est.usage === 'number') {
          var freeMB = Math.round((est.quota - est.usage) / 1048576);
          cap.freeMB = freeMB;
          if (freeMB < cap.sizeMB + 350) {
            cap.ok = false;
            cap.reasons.push('only about ' + freeMB + 'MB of storage is available to this browser, and the download needs roughly ' + cap.sizeMB + 'MB plus headroom');
          }
        }
        return cap;
      }).catch(function () { return cap; });
    } catch (e) { return Promise.resolve(cap); }
  }
  function postIncapable(cap) {
    setStatus('Vault Guide — quick answers', 'fallback');
    addMsg('I checked this device honestly before offering anything: <b>the Vaulty AI download can\'t run here</b> — ' +
      cap.reasons.join('; ') + '. No hard feelings and no fake button: the quick guide keeps answering everything it can, ' +
      'and my live research covers the rest. On a desktop browser the full AI unlocks.', 'bot');
  }

  function setStatus(text, cls) {
    var st = document.getElementById('vai-status');
    if (st) { st.textContent = text; st.className = 'vai-status ' + (cls || ''); }
  }

  function showProgress(pct, label) {
    var wrap = document.getElementById('vai-loadwrap');
    var bar = document.getElementById('vai-loadbar');
    var txt = document.getElementById('vai-loadtxt');
    if (!wrap) return;
    wrap.style.display = 'block';
    if (bar) bar.style.width = Math.round(pct * 100) + '%';
    if (txt) txt.textContent = label || ('Loading AI model… ' + Math.round(pct * 100) + '%');
  }

  function hideProgress() {
    var wrap = document.getElementById('vai-loadwrap');
    if (wrap) wrap.style.display = 'none';
  }

  function getWebLLM() {
    if (!webllmPromise) webllmPromise = import(WEBLLM_CDN);
    return webllmPromise;
  }

  /* Ask the browser to treat this origin's storage as persistent, so the
     downloaded model isn't first in line for eviction. Called only when
     the user taps Download — i.e. when they've opted in. Not every
     platform grants it (iOS is the strict one); where it's refused we
     simply carry on. */
  function requestPersist() {
    try {
      if (navigator.storage && navigator.storage.persist) {
        navigator.storage.persisted().then(function (p) {
          if (!p) navigator.storage.persist().catch(function () {});
        }).catch(function () {});
      }
    } catch (e) {}
  }

  /* Is the model actually on this device? Ask web-llm itself
     (hasModelInCache, exported by @mlc-ai/web-llm 0.2.85); fall back to
     looking for its 'webllm/model' cache if that export ever moves. */
  function checkModelCached() {
    var mid = storedModelId() || MODEL_ID;
    return getWebLLM().then(function (m) {
      if (m && typeof m.hasModelInCache === 'function') {
        return m.hasModelInCache(mid);
      }
      throw new Error('no hasModelInCache');
    }).catch(function () {
      if (!('caches' in window)) return false;
      return caches.has('webllm/model').then(function (has) {
        if (!has) return false;
        return caches.open('webllm/model').then(function (c) { return c.keys(); })
          .then(function (keys) { return keys.length > 0; });
      }).catch(function () { return false; });
    });
  }

  function showDownloadBox(mode) {
    var box = document.getElementById('vai-dlbox');
    var txt = document.getElementById('vai-dltxt');
    var btn = document.getElementById('vai-dlbtn');
    var btn2 = document.getElementById('vai-dlbtn2');
    if (!box || !txt || !btn) return;
    var cap = aiCapability();
    if (btn2) btn2.style.display = 'none';
    btn.onclick = startDownload;
    if (mode === 'retry') {
      txt.textContent = 'The AI download didn\'t finish. You can try once more — or just keep using the quick guide, it answers without the download.';
      btn.textContent = 'Try the AI download again';
    } else {
      txt.textContent = 'Optional: download ' + cap.modelLabel + '. It stays on this device — and the quick guide below works without it.' +
        (cap.experimental ? ' On iPhone this is EXPERIMENTAL: if the load fails, Vaulty settles back into quick mode and never loops.' : '');
      btn.textContent = cap.tier === 'desktop' ? 'Download AI (~2GB)' : 'Download Vaulty AI (~800MB)';
    }
    box.style.display = 'block';
  }

  function hideDownloadBox() {
    var box = document.getElementById('vai-dlbox');
    if (box) box.style.display = 'none';
  }

  /* v2.23.0: the manage state — the AI is on this device, and the
     Tenno gets a real off switch and a real delete, in one tap each. */
  function showManageBox(state) {
    var box = document.getElementById('vai-dlbox');
    var txt = document.getElementById('vai-dltxt');
    var btn = document.getElementById('vai-dlbtn');
    var btn2 = document.getElementById('vai-dlbtn2');
    if (!box || !txt || !btn) return;
    box.style.display = 'block';
    if (btn2) btn2.style.display = 'block';
    if (state === 'off') {
      txt.textContent = 'Vaulty AI is OFF on this device — the quick guide is answering. The download is still stored if you want it back.';
      btn.textContent = 'Turn Vaulty AI back on';
      btn.onclick = function () { setAIOff(false); };
      if (btn2) { btn2.textContent = 'Delete the AI download'; btn2.onclick = deleteAI; }
    } else if (state === 'downloaded') {
      txt.textContent = 'Vaulty AI is downloaded on this device but not started.';
      btn.textContent = 'Start Vaulty AI';
      btn.onclick = function () { hideDownloadBox(); runEngine('Loading AI from this device…', { guarded: aiCapability().tier !== 'desktop' }); };
      if (btn2) { btn2.textContent = 'Delete the AI download'; btn2.onclick = deleteAI; }
    } else { /* running */
      txt.textContent = 'Vaulty AI is running from this device. Nothing you ask leaves the device.';
      btn.textContent = 'Turn Vaulty AI off';
      btn.onclick = function () { setAIOff(true); };
      if (btn2) { btn2.textContent = 'Delete the AI download'; btn2.onclick = deleteAI; }
    }
  }

  function setAIOff(off) {
    lsSet(OFF_KEY, off ? '1' : null);
    hideDownloadBox();
    if (off) {
      if (engine) {
        try { if (engine.unload) engine.unload(); } catch (e) {}
        engine = null;
      }
      engineFailed = false;
      setStatus('Vaulty AI off — guide mode', 'fallback');
      addMsg('Vaulty AI is off — the quick guide has the wheel. The download stays on this device unless you delete it from the Vaulty AI button below.', 'bot');
      showManageBox('off');
    } else {
      setStatus('Checking AI…', 'loading');
      modelCached = null;
      loadEngine();
    }
  }

  function deleteAI() {
    var ids = [MODEL_DESKTOP, MODEL_SMALL];
    var done = function () {
      modelCached = false;
      engine = null;
      lsSet(MODEL_KEY, null);
      lsSet(GUARD_KEY, null);
      hideDownloadBox();
      setStatus('AI not downloaded');
      addMsg('Deleted — the AI download is gone from this device, freeing its storage. The quick guide is unaffected, and you can re-download any time from the Vaulty AI button.', 'bot');
    };
    getWebLLM().then(function (m) {
      var jobs = ids.map(function (id) {
        try { return (m && typeof m.deleteModelInCache === 'function') ? m.deleteModelInCache(id) : Promise.resolve(); }
        catch (e) { return Promise.resolve(); }
      });
      return Promise.all(jobs);
    }).catch(function () {}).then(function () {
      /* belt and braces: web-llm's caches go too */
      if (!('caches' in window)) { done(); return; }
      Promise.all(['webllm/model', 'webllm/config', 'webllm/wasm'].map(function (n) {
        return caches.delete(n).catch(function () {});
      })).then(done).catch(done);
    });
  }

  /* First open on a WebGPU device: check what's really on the device
     before claiming anything in the header. Cached → load it (that's a
     load, not a download). Not cached → say so and offer the download as
     an explicit tap; the guide answers in the meantime. */
  /* v2.23.0: load/start logic, tier by tier.
     DESKTOP: unchanged from v2.20.0 — a cached model loads on open;
     no cache → the explicit download box.
     MOBILE (Android etc.): nothing auto-downloads, ever. A model the
     Tenno deliberately downloaded before may load from cache, behind
     the load guard. Not cached → the panel button / chat offers.
     iOS: nothing auto-starts, ever (v2.19.3 stays law). The download
     exists only as an EXPERIMENTAL explicit opt-in via the button —
     smallest model, load guard armed, one failure settles it. */
  function loadEngine() {
    if (aiOff()) { setStatus('Vaulty AI off — guide mode', 'fallback'); showManageBox('off'); return; }
    if (engine || engineLoading || modelCached !== null) return;
    var cap = aiCapability();
    if (cap.tier !== 'desktop' && guardGet() === 'loading') {
      /* a previous phone attempt died mid-load: settle, don't retry */
      lsSet(GUARD_KEY, 'failed');
      aiSettled = true;
      modelCached = false;
      engineFailed = true;
      setStatus('Vault Guide — quick answers', 'fallback');
      greetFallbackOnce();
      return;
    }
    if (!hasWebGPU() && cap.tier === 'desktop') {
      engineFailed = true;
      setStatus('AI unavailable on this device', 'fallback');
      greetFallbackOnce();
      return;
    }
    setStatus('Checking AI…', 'loading');
    checkModelCached().then(function (cached) {
      modelCached = !!cached;
      if (modelCached) {
        /* v2.20.0: the model is already on this device — say so, keep the
           storage persistent, and load from cache. The download box must
           NEVER appear for a device that already has the model, across
           any number of app updates (the model cache is version-
           independent and nothing in the update path may evict it). */
        MODEL_ID = storedModelId() || cap.modelId;
        requestPersist();
        if (cap.tier === 'desktop') {
          runEngine('Loading AI from this device…');
        } else if (cap.tier === 'mobile' && guardGet() !== 'failed') {
          runEngine('Loading AI from this device…', { guarded: true });
        } else {
          /* iOS: cached but never auto-started — a button starts it */
          setStatus('AI ready on this device', 'ready');
          showManageBox('downloaded');
        }
      } else {
        setStatus(cap.tier === 'desktop' ? 'AI not downloaded' : 'Vault Guide — quick answers', cap.tier === 'desktop' ? '' : 'fallback');
        if (cap.tier === 'desktop' && !aiSettled) showDownloadBox('download');
        if (cap.tier !== 'desktop') greetFallbackOnce();
      }
    }).catch(function () {
      setStatus('Vault Guide — quick answers', 'fallback');
      greetFallbackOnce();
    });
  }

  function startDownload() {
    if (engine || engineLoading) return;
    if (aiOff()) lsSet(OFF_KEY, null);
    aiCapabilityAsync().then(function (cap) {
      if (!cap.ok) { postIncapable(cap); return; }
      MODEL_ID = cap.modelId;
      lsSet(MODEL_KEY, MODEL_ID);
      downloadAttempts++;
      requestPersist();
      hideDownloadBox();
      runEngine(cap.tier === 'desktop' ? 'Downloading AI model…' : 'Downloading Vaulty AI…', { guarded: cap.tier !== 'desktop' });
    });
  }

  function runEngine(firstLabel, opts) {
    if (engine || engineLoading) return;
    opts = opts || {};
    var guarded = !!opts.guarded;
    if (guarded) {
      if (guardGet() === 'loading' && !opts.userRetry) {
        /* a guarded load is already (or was last seen) in flight —
           the page that started it is gone. Settle, never stack. */
        lsSet(GUARD_KEY, 'failed');
        aiSettled = true;
        setStatus('Vault Guide — quick answers', 'fallback');
        return;
      }
      lsSet(GUARD_KEY, 'loading');
    }
    engineLoading = true;
    dlCancelled = false;
    showProgress(0, firstLabel);

    getWebLLM().then(function (m) {
      return m.CreateMLCEngine(MODEL_ID, {
        initProgressCallback: function (p) {
          if (dlCancelled) return;
          showProgress(p.progress || 0, p.text || 'Loading AI model…');
        }
      });
    }).then(function (eng) {
      engineLoading = false;
      hideProgress();
      if (dlCancelled) {
        /* the Tenno cancelled mid-flight: discard the engine, keep
           whatever finished downloading, stay in guide mode */
        try { if (eng && eng.unload) eng.unload(); } catch (e) {}
        modelCached = true;
        if (guarded) lsSet(GUARD_KEY, null);
        setStatus('Vault Guide — quick answers', 'fallback');
        showManageBox('downloaded');
        return;
      }
      engine = eng;
      engineFailed = false;
      modelCached = true;
      if (guarded) lsSet(GUARD_KEY, null);
      hideDownloadBox();
      setStatus('AI ready on this device', 'ready');
      addMsg('AI engine loaded — ask me anything about builds, mods, farms, or Steel Path. I answer from real Warframe knowledge now, not just keyword matching.', 'bot');
    }).catch(function () {
      engineLoading = false;
      engineFailed = true;
      hideProgress();
      if (dlCancelled) {
        if (guarded) lsSet(GUARD_KEY, null);
        setStatus('Vault Guide — quick answers', 'fallback');
        return;
      }
      if (guarded) {
        /* a phone load failed: settle permanently for this device —
           no retry boxes, no loops. The button can be tapped again
           deliberately, but Vaulty never nags. */
        lsSet(GUARD_KEY, 'failed');
        aiSettled = true;
        hideDownloadBox();
        setStatus('Vault Guide — quick answers', 'fallback');
        if (!settleMsgShown) {
          settleMsgShown = true;
          addMsg('The Vaulty AI didn\'t start on this phone, so I\'m settling into quick-answer mode for good — no more prompts, no loops. Builds, farming, mods, live questions: the guide covers them.', 'bot');
        }
        return;
      }
      if (downloadAttempts >= 2) {
        /* one failed attempt + one failed retry: settle. No more prompts. */
        aiSettled = true;
        hideDownloadBox();
        setStatus('Vault Guide — quick answers', 'fallback');
        if (!settleMsgShown) {
          settleMsgShown = true;
          addMsg('The AI didn\'t start on this device, so I\'m answering in quick-answer mode — no more download prompts. Ask me about builds, farming, mods — anything Warframe.', 'bot');
        }
      } else if (downloadAttempts === 1) {
        setStatus('Vault Guide — quick answers', 'fallback');
        greetFallbackOnce();
        showDownloadBox('retry');
      } else {
        /* the from-cache load failed (attempts still 0): the stored model
           may be damaged. Offer ONE deliberate fresh download as the
           recovery — an explicit tap, never an automatic restart. */
        modelCached = false;
        setStatus('AI not downloaded');
        greetFallbackOnce();
        showDownloadBox('download');
      }
    });
  }

  /* ---------- chat ---------- */
  function addMsg(html, who) {
    var d = document.createElement('div');
    d.className = 'vai-msg ' + who;
    if (who === 'user') {
      d.textContent = html;
    } else {
      d.innerHTML = html;
    }
    els.msgs.appendChild(d);
    els.msgs.scrollTop = els.msgs.scrollHeight;
    /* v2.23.0: 👍/👎 feedback, follow-up chips and optional spoken
       replies ride along on real answers (each module self-qualifies:
       greetings, progress bars and don't-knows get none of them) */
    if (who === 'bot') {
      try { if (window.TVLearn) TVLearn.attachFeedback(d, (lastQ + ' ' + html).slice(0, 900)); } catch (e) {}
      try { if (window.TVChips) TVChips.attach(d, lastQ, html, function (qq) { ask(qq); }); } catch (e) {}
      try { if (window.TVVoice) TVVoice.speakAnswer(html); } catch (e) {}
    }
    return d;
  }

  function addTyping() {
    var d = document.createElement('div');
    d.className = 'vai-msg bot vai-typing';
    d.id = 'vai-typing';
    d.innerHTML = '<span class="tdot"></span><span class="tdot"></span><span class="tdot"></span>';
    els.msgs.appendChild(d);
    els.msgs.scrollTop = els.msgs.scrollHeight;
  }

  function removeTyping() {
    var t = document.getElementById('vai-typing');
    if (t) t.remove();
  }

  /* v2.23.0: the chat-offered AI download. Two honest triggers: the
     Tenno asks about the AI itself, or they hit a question the guide
     missed (where the fuller brain genuinely helps). Capable device →
     an offer message with a real download button. Incapable → a plain
     explanation, but ONLY when they asked (never as a miss pile-on). */
  var AI_ASK_RE = /\b(download|get|install|turn on|enable|use|try) (the |your |me )?(full |real |vaulty )?ai\b|\bfull ai\b|\bsmarter ai\b|why (are you|is vaulty) (so )?(limited|dumb|basic)|upgrade (yourself|vaulty|the ai|your ai)/i;
  function maybeOfferAI(trigger) {
    if (engine || aiOff() || offerShown[trigger]) return;
    offerShown[trigger] = true;
    aiCapabilityAsync().then(function (cap) {
      if (engine) return;
      if (!cap.ok) {
        if (trigger === 'ask') postIncapable(cap);
        return;
      }
      if (modelCached) { showManageBox('downloaded'); return; }
      addMsg('<p>💡 <b>Want the fuller brain?</b> This device checks out for the optional on-device Vaulty AI — ' +
        cap.modelLabel + '. It downloads once, lives only on this device, works offline, and the quick guide keeps answering in the meantime.' +
        (cap.experimental ? '</p><p>⚠️ On iPhone this is <b>experimental</b>: mobile Safari may refuse the load — if it fails I settle back into quick mode and never loop or nag.' : '') +
        '</p><p><button type="button" class="vai-aioffer-btn btn primary">Download Vaulty AI</button></p>', 'bot');
    });
  }

  function askFallback(q, wantsAI) {
    if (!FALLBACK) {
      addMsg('The guide data isn\'t available right now — try reloading the page.', 'bot');
      return;
    }
    FALLBACK._load().then(function () {
      var html = FALLBACK._answer(q);
      /* v2.22.0: a creative build brief is a Workshop handoff in every
         mode — the Workshop researches the item and composes an original
         build from real mods (the model never authors the mod list). */
      if (window.TVWorkshop && FALLBACK._workshopIsHandoff && FALLBACK._workshopIsHandoff(html)) {
        /* v2.22.0: in AI mode the model may write the dossier's
           connective prose from the verified dossier data (workshop
           falls back to engine prose whenever that is unavailable) */
        TVWorkshop.handle(q, html, els.msgs, function (h) { addMsg(h, 'bot'); }, {
          proseWriter: function (dossier) { return workshopProseWrite(q, dossier); }
        });
        return;
      }
      /* v2.23.0: a pasted-build check is a checker handoff in every mode */
      if (window.TVWorkshop && FALLBACK._checkerIsHandoff && FALLBACK._checkerIsHandoff(html) && TVWorkshop.handleCheck) {
        TVWorkshop.handleCheck(q, html, els.msgs, function (h) { addMsg(h, 'bot'); });
        return;
      }
      /* v2.20.0: a guide miss is no longer a dead-end. The question is
         logged anonymously (text only) and Vaulty RESEARCHES it live —
         staged progress bar with a Stop button — in guide mode, AI mode,
         and on iOS alike. The honest don't-know stays as the last resort
         if research finds nothing. */
      if (window.TVResearch && TVResearch.isMiss(html)) {
        /* v2.22.0: research-first — dig deep, then answer in prose */
        var renderMiss = function (h) {
          addMsg(h, 'bot');
          /* v2.23.0: a miss is exactly where the fuller brain helps —
             offer the download here (capable devices only, once) */
          maybeOfferAI('miss');
        };
        if (TVResearch.handleConverse) TVResearch.handleConverse(q, html, els.msgs, renderMiss, { isMiss: true });
        else TVResearch.handleMiss(q, html, els.msgs, renderMiss);
      } else {
        addMsg(html, 'bot');
        if (wantsAI) maybeOfferAI('ask');
      }
    }).catch(function () {
      addMsg('Couldn\'t load the Vault\'s data — try reloading the page.', 'bot');
    });
  }

  function stripHtmlText(html) {
    return String(html == null ? '' : html)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n+/g, '\n')
      .trim();
  }

  /* v2.22.0: the model writes conversational prose from a bundle of
     RETRIEVED FACTS only (guide knowledge + live data + the Wiki dig),
     under the existing post-generation validation: any build-shaped mod
     list must be all-DB-real (validateAnswerText) or the draft is
     discarded — one tighter retry, then the composed-prose fallback in
     js/vaulty-research.js takes over. */
  function converseModelWrite(q, bundle, retry) {
    if (!engine || !FALLBACK) return Promise.resolve(null);
    if (!bundle.factsText) return Promise.resolve(null);
    var memoryLine = '';
    try {
      if (window.TVMemory && TVMemory._summary) {
        var s = TVMemory._summary();
        if (s && s.items && s.items.length) {
          memoryLine = 'The Tenno often asks about: ' + s.items.slice(0, 3).map(function (i) { return i.name; }).join(', ') + '.';
        }
      }
    } catch (e) {}
    var sys = SYSTEM_PROMPT + '\n\nRESEARCH MODE — answer the question in natural, conversational prose using ONLY the facts below. ' +
      'Structure: a direct first sentence, then the useful details, then anything practical. ' +
      'Do NOT list mods or builds. Do NOT invent numbers, drops, dates, or mechanics that are not in the facts. ' +
      'If the facts do not answer the question, reply exactly: I don\'t know that one.' +
      (retry ? '\nYour previous draft failed validation. Be stricter: shorter, facts only, no item or mod names beyond what the facts name.' : '');
    var user = 'QUESTION: ' + q + '\n\nFACTS:\n' + bundle.factsText + (memoryLine ? '\n\n' + memoryLine : '');
    return engine.chat.completions.create({
      messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
      temperature: 0.35, max_tokens: 650, stream: false
    }).then(function (res) {
      var text = '';
      try { text = res.choices[0].message.content || ''; } catch (e) { text = ''; }
      text = String(text).trim();
      if (!text || UNCERTAIN_RE.test(text)) return null;
      if (FALLBACK._validateAnswer && !FALLBACK._validateAnswer(text, q)) {
        if (!retry) return converseModelWrite(q, bundle, true);
        return null;
      }
      return md(text);
    }).catch(function () { return null; });
  }

  /* v2.22.0: AI mode — the model writes a Workshop dossier's connective
     prose (intro + why-this-works) from the engine's VERIFIED dossier
     data. The card, layout, Helminth, shards, rotation and every number
     stay engine-rendered. Output must arrive as labeled INTRO:/MATH:
     sections and pass the same validation; anything else → the caller
     falls back to engine prose (null). */
  function workshopProseWrite(q, dossier) {
    if (!engine || !FALLBACK || !dossier) return Promise.resolve(null);
    var facts = (dossier.facts || []).join('\n- ');
    var rot = (dossier.rotation || []).map(stripHtmlText).join(' / ');
    var sys = SYSTEM_PROMPT + '\n\nDOSSIER PROSE — the app has composed and verified a build (concept: ' + dossier.concept + '). ' +
      'Write TWO short pieces of connective prose and label them exactly:\nINTRO: <one or two sentences — how this build destroys and survives>\nMATH: <one short paragraph — why it works, using ONLY the verified facts>\n' +
      'Do NOT list mods, arcanes, or shards. Do NOT invent numbers. Facts:\n- ' + facts + '\nRotation (context only): ' + rot;
    return engine.chat.completions.create({
      messages: [{ role: 'system', content: sys }, { role: 'user', content: 'Write the INTRO and MATH prose for this build.' }],
      temperature: 0.4, max_tokens: 420, stream: false
    }).then(function (res) {
      var text = '';
      try { text = res.choices[0].message.content || ''; } catch (e) { text = ''; }
      var im = String(text).match(/INTRO:\s*([\s\S]*?)(?:\n\s*MATH:|$)/i);
      var mm = String(text).match(/MATH:\s*([\s\S]*)$/i);
      if (!im || !mm) return null;
      var intro = im[1].trim(), math = mm[1].trim();
      if (!intro || !math) return null;
      if (FALLBACK._validateAnswer && !FALLBACK._validateAnswer(intro + '\n' + math, q)) return null;
      return { introHtml: md(intro), mathHtml: md(math) };
    }).catch(function () { return null; });
  }

  /* v2.22.0: research-first routing for general questions in AI mode.
     The guide brain's own knowledge becomes one fact source among the
     dug-up ones; the on-device model then answers conversationally from
     the retrieved facts only. Build handoffs still go to the Workshop;
     smalltalk the guide already handles stays instant. */
  function askConverseAI(q) {
    if (!window.TVResearch || !TVResearch.handleConverse || !FALLBACK) { askAI(q); return; }
    FALLBACK._load().then(function () {
      var html = FALLBACK._answer(q);
      if (FALLBACK._workshopIsHandoff && FALLBACK._workshopIsHandoff(html)) { askFallback(q); return; }
      /* v2.23.0: build checks route to the checker in AI mode too */
      if (FALLBACK._checkerIsHandoff && FALLBACK._checkerIsHandoff(html)) { askFallback(q); return; }
      var miss = TVResearch.isMiss(html);
      if (!miss && /^(hi|hey|hello|yo|sup|howdy|thanks|thank you|thx|ty|bye|goodbye|who are you)\b/i.test(q)) {
        addMsg(html, 'bot');
        history.push({ role: 'user', content: q });
        history.push({ role: 'assistant', content: '(guide answer)' });
        if (history.length > 12) history = history.slice(-12);
        return;
      }
      TVResearch.handleConverse(q, html, els.msgs, function (h) {
        addMsg(h, 'bot');
        history.push({ role: 'user', content: q });
        history.push({ role: 'assistant', content: '(researched answer)' });
        if (history.length > 12) history = history.slice(-12);
      }, {
        isMiss: miss,
        guideText: miss ? null : stripHtmlText(html).slice(0, 1800),
        modelWriter: function (bundle) { return converseModelWrite(q, bundle, false); }
      });
    }).catch(function () { askAI(q); });
  }

  /* v2.19.5: validate-on-serve. A free-chat answer that presents a build
     must pass the guide brain's slot / real-mod check against the mods
     database (TVAI._validateAnswer). A failing answer is replaced by the
     verified guide answer for the same question — the model's improvised
     mod list is never the final rendered answer. */
  function finishAIAnswer(q, full, botEl) {
    var render = function () {
      var finalHtml = md(full);
      /* v2.20.0: model admitted it doesn't know → don't just append
         research buttons; actually research it (staged progress), with
         the draft + buttons as the fallback if research finds nothing. */
      if (UNCERTAIN_RE.test(full) && window.TVResearch) {
        if (FALLBACK && FALLBACK._research) finalHtml += FALLBACK._research(q);
        if (botEl) { botEl.remove(); botEl = null; }
        if (TVResearch.handleConverse) TVResearch.handleConverse(q, finalHtml, els.msgs, function (h) { addMsg(h, 'bot'); }, { isMiss: true });
        else TVResearch.handleMiss(q, finalHtml, els.msgs, function (h) { addMsg(h, 'bot'); });
        history.push({ role: 'user', content: q });
        history.push({ role: 'assistant', content: '(researched live — not in the verified data)' });
        if (history.length > 12) history = history.slice(-12);
        return;
      }
      if (botEl) botEl.innerHTML = finalHtml;
      else addMsg(finalHtml, 'bot');
      history.push({ role: 'user', content: q });
      history.push({ role: 'assistant', content: full });
      if (history.length > 12) history = history.slice(-12);
    };
    if (FALLBACK && FALLBACK._validateAnswer) {
      FALLBACK._load().then(function () {
        if (FALLBACK._validateAnswer(full, q)) { render(); return; }
        var html = '<p class="muted small">That AI draft didn\'t pass the Vault\'s build check (a mod was wrong for the item), so here\'s the verified answer instead:</p>' +
          FALLBACK._answer(q);
        if (botEl) botEl.innerHTML = html;
        else addMsg(html, 'bot');
        history.push({ role: 'user', content: q });
        history.push({ role: 'assistant', content: '(answered from the verified build library)' });
        if (history.length > 12) history = history.slice(-12);
      }).catch(render);
    } else render();
  }

  function askAI(q) {
    addTyping();
    var messages = [{ role: 'system', content: SYSTEM_PROMPT }];
    history.slice(-6).forEach(function (h) { messages.push(h); });
    messages.push({ role: 'user', content: q });

    var full = '';
    var botEl = null;

    engine.chat.completions.create({
      messages: messages,
      temperature: 0.6,
      max_tokens: 700,
      stream: true
    }).then(function (stream) {
      function pump() {
        return stream.next().then(function (r) {
          if (r.done) {
            removeTyping();
            finishAIAnswer(q, full, botEl);
            return;
          }
          var delta = (r.value.choices[0].delta.content) || '';
          full += delta;
          if (!botEl) {
            removeTyping();
            botEl = addMsg('', 'bot');
          }
          botEl.innerHTML = md(full) + '<span class="vai-caret">▍</span>';
          els.msgs.scrollTop = els.msgs.scrollHeight;
          return pump();
        });
      }
      return pump();
    }).catch(function () {
      removeTyping();
      addMsg('The AI hiccuped — falling back to the classic guide for this one.', 'bot');
      askFallback(q);
    });
  }

  /* v2.19.0: phrases that mean the model just admitted it doesn't know —
     those answers get one-tap research buttons appended */
  var UNCERTAIN_RE = /i (don'?t|do not) know|i'?m not (sure|certain)|no idea|not familiar with|can'?t (help with|answer)|don'?t have (any )?(info|information|details) (on|about)/i;

  /* v2.19.5: build-intent detection for the router below. Mirrors the
     guide brain's own build surface (build words, one-shot topics,
     primers, archon shards, mod-slotting questions, Steel Path builds)
     so both panels route these questions identically. */
  function isBuildIntent(q) {
    var t = String(q || '').toLowerCase().replace(/\?+$/, '').trim();
    if (!t) return false;
    if (/\b(build|loadout|setup)\b/.test(t)) return true;
    if (/one[\s-]?shot/.test(t)) return true;
    if (/\bprimer\b/.test(t)) return true;
    if (/archon shards?/.test(t)) return true;
    if (/\bwhat mods\b/.test(t) || /\bmods? (for|on) my\b/.test(t) || /\bhow (do|should) i mod\b/.test(t)) return true;
    if (/\bsteel\s?path\b/.test(t) && /\b(build|mod|mods|setup|loadout|guide|strong|damage|best|frame|warframe|weapon)\b/.test(t)) return true;
    return false;
  }

  function ask(q) {
    if (!q) return;
    lastQ = q;
    if (window.TVLearn && TVLearn.setContext) TVLearn.setContext(q);
    addMsg(q, 'user');
    els.input.value = '';
    /* v2.23.0: is the Tenno asking about the AI itself? The download
       offer (or the honest incapability explanation) rides along with
       the normal answer in guide mode. */
    var wantsAI = AI_ASK_RE.test(q) && !engine;
    /* v2.20.0: on-device memory — remember the question (this device
       only, nothing uploaded) and resolve "my usual" to the Tenno's
       most-asked item before routing. */
    if (window.TVMemory) {
      TVMemory.recordExchange(q);
      var usual = TVMemory.resolveUsual(q);
      if (usual) q = usual;
    }
    /* v2.19.0: time-sensitive questions are answered from the live
       worldstate feed (same data as the Live page), never from the
       model's memory — timers and stock change too fast to guess at. */
    if (window.TVLive && window.TVLive.isLive(q)) {
      addTyping();
      window.TVLive.answer(q).then(function (html) {
        removeTyping();
        addMsg(html || 'The live feed didn\'t have that — check the <a href="live.html">Live page</a>.', 'bot');
      }).catch(function () {
        removeTyping();
        addMsg('The live feed didn\'t answer just now — check the <a href="live.html">Live page</a>, or ask me again in a minute.', 'bot');
      });
      return;
    }
    /* v2.19.5: build questions are answered ONLY from verified data.
       The free-chat model improvised mod lists — it once put two AURA
       mods on a shotgun and invented effects and farm sources — so build
       intent never reaches it. In every mode the guide brain serves the
       build from the library / templates / generator, whose mods are
       checked against the mods database. */
    if (isBuildIntent(q)) {
      askFallback(q, wantsAI);
      return;
    }
    if (engine) {
      /* v2.22.0: general questions are research-first even with the model
         ready — the model writes from dug-up facts, never from memory */
      askConverseAI(q);
    } else {
      /* v2.19.3: questions NEVER wait for the model. If the engine isn't
         fully ready — still loading, not downloaded, failed, settled, or
         guide-only (iOS / no WebGPU) — the live/guide brain answers right
         now. The old "still loading" dead-end is gone. */
      askFallback(q, wantsAI);
    }
  }

  function toggle(open) {
    var show = typeof open === 'boolean' ? open : els.panel.style.display !== 'flex';
    if (show) {
      els.panel.style.display = 'flex';
      /* next frame so the transition animates */
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { els.panel.classList.add('open'); });
      });
    } else {
      els.panel.classList.remove('open');
      setTimeout(function () {
        if (!els.panel.classList.contains('open')) els.panel.style.display = 'none';
      }, 280);
      /* v2.19.1: Vaulty hid himself when the panel opened (mentor.js) —
         tell him the panel closed so he comes back and the next tap on
         him can reopen the chat */
      try { document.dispatchEvent(new CustomEvent('tv-ai-panel-closed')); } catch (e) {}
    }
    if (els.btn) els.btn.classList.toggle('open', show);
    /* v2.19.3: after showing, fit to the visual viewport (keyboard may
       already be up from the auto-focus); after hiding, hand sizing back */
    if (show) requestAnimationFrame(fitPanelToViewport);
    else clearPanelFit();
    /* on reopen, re-assert an honest status from the real engine state —
       never a stale "Loading AI…" (v2.19.1) and never a claim the cache
       check hasn't backed up (v2.19.2) */
    if (show && opened && !engineLoading) {
      if (engine) setStatus('AI ready on this device', 'ready');
      else if (aiOff()) setStatus('Vaulty AI off — guide mode', 'fallback');
      else if (isIOS() && modelCached !== true) setStatus(GUIDE_ONLY_STATUS, 'fallback');
      else if (!hasWebGPU()) setStatus('AI unavailable on this device', 'fallback');
      else if (engineFailed) setStatus('Vault Guide — quick answers', 'fallback');
      else if (modelCached === false) setStatus('AI not downloaded');
    }
    if (show && !opened) {
      opened = true;
      addMsg("Hey Tenno! ◈ I can help with builds, farming, mods — anything Warframe. " +
        "Try a suggestion below or just ask.", 'bot');
      /* v2.20.0: on-device memory personalization — a welcome-back line
         and a "your usual" chip for the Tenno's most-asked item. */
      if (window.TVMemory) {
        var wb = TVMemory.welcomeBackLine();
        if (wb) addMsg(wb, 'bot');
        var mMain = TVMemory.main();
        if (mMain) {
          var chipsEl = els.panel.querySelector('.vai-chips');
          if (chipsEl && !chipsEl.querySelector('.vai-chip-usual')) {
            var chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'vai-chip vai-chip-usual';
            chip.textContent = '⭐ My usual: ' + mMain.name + ' build';
            chip.addEventListener('click', function () { ask(mMain.name + ' build'); });
            chipsEl.insertBefore(chip, chipsEl.firstChild);
          }
        }
      }
      /* v2.23.0: loadEngine self-gates per tier — desktop keeps the
         v2.20.0 behavior; phones never auto-download; iOS never
         auto-starts (v2.19.3's law) but the experimental opt-in now
         lives behind the Vaulty AI button + capability gate. */
      loadEngine();
      /* v2.23.0: the daily brief (real worldstate only, once a day,
         dismissible) + a farm-watch check while the Tenno is here */
      try { if (window.TVDailyBrief) TVDailyBrief.maybeShow(function (h, w) { addMsg(h, w); }); } catch (e) {}
      try { if (window.TVWatch) TVWatch.checkNow(); } catch (e) {}
    }
    if (show) setTimeout(function () { els.input.focus(); }, 60);
  }

  /* ---------- v2.19.3: visual-viewport fit (iOS keyboard) ----------
     The panel is position:fixed + bottom-anchored to the LAYOUT viewport,
     but the iOS keyboard only shrinks the VISUAL viewport — so with the
     keyboard up, the panel slid under it, the newest message hid behind
     it, and page content showed through above it (owner's recording).
     While the keyboard is up we pin the panel to the visual viewport with
     inline styles; when it closes, the inline styles come off and the
     stylesheet's sizing rules again. The message list keeps its own
     internal scrolling either way. */
  var vvFitted = false;
  function clearPanelFit() {
    if (!els.panel || !vvFitted) return;
    vvFitted = false;
    els.panel.style.bottom = '';
    els.panel.style.height = '';
    els.panel.style.maxHeight = '';
  }
  function fitPanelToViewport() {
    if (!els.panel) return;
    var vv = window.visualViewport;
    if (!vv || els.panel.style.display !== 'flex') { clearPanelFit(); return; }
    var keyboardUp = (window.innerHeight - vv.height) > 80;
    if (!keyboardUp) { clearPanelFit(); return; }
    /* distance from the layout viewport's bottom edge up to the visual
       viewport's bottom edge = the keyboard's height on screen */
    var below = Math.max(0, window.innerHeight - vv.offsetTop - vv.height);
    vvFitted = true;
    els.panel.style.bottom = (below + 10) + 'px';
    els.panel.style.height = Math.max(230, Math.min(vv.height - 20, 620)) + 'px';
    els.panel.style.maxHeight = Math.max(230, vv.height - 20) + 'px';
    /* newest message stays reachable above the keyboard */
    if (els.msgs) els.msgs.scrollTop = els.msgs.scrollHeight;
  }

  var CHIPS = [
    '🛎 When is Baro back?',
    '💥 One-shot build for Kuva Zarr',
    '✨ Best aura mods?',
    "🌱 I'm new, where do I start?",
    '🔫 How do I farm Sevagoth?',
    '🛡 Best Steel Path warframe?',
    '🎲 Find me a good warframe to use',
    '💰 How do I make platinum?'
  ];

  /* strip emoji prefixes so the question the AI sees stays clean text */
  function cleanChipText(s) {
    return String(s).replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu, '').trim();
  }

  function init() {
    if (document.getElementById('vault-ai-panel') || !window.TV) return;
    /* v2.12.15: floating "Ask the Vault" button removed — Vaulty is the entry point now.
       Panel is still created; open via window.TVAI.toggle(true) */
    /* v2.12.29: reset chat history every 24h to prevent memory bloat/crashes */
    try {
      var lastReset = parseInt(localStorage.getItem('tv-chat-reset') || '0', 10);
      var now = Date.now();
      if (now - lastReset > 24 * 60 * 60 * 1000) {
        history = [];
        try { localStorage.removeItem('tv-chat-history'); } catch (e) {}
        localStorage.setItem('tv-chat-reset', String(now));
      }
    } catch (e) {}

    var panel = document.createElement('div');
    panel.id = 'vault-ai-panel';
    panel.style.display = 'none';
    panel.innerHTML =
      '<div class="vai-head"><span>◈ Vault Guide</span>' +
      '<span id="vai-status" class="vai-status"></span>' +
      '<button id="vai-close" type="button" aria-label="Close">⌄</button></div>' +
      '<div id="vai-loadwrap" style="display:none;padding:10px 12px 0">' +
      '<div id="vai-loadtxt" class="muted small">Loading AI model…</div>' +
      '<div style="height:8px;background:var(--bg2);border-radius:99px;margin-top:6px;overflow:hidden">' +
      '<div id="vai-loadbar" style="height:100%;width:0%;background:linear-gradient(135deg,#0090b8,#00d2ff);border-radius:99px;transition:width .2s"></div>' +
      '</div><p class="muted small" style="margin:6px 0 0">One-time download — after that the AI loads from this device. You can cancel any time; the quick guide keeps working.</p>' +
      '<button id="vai-loadcancel" type="button" class="btn warn" style="margin-top:6px">Cancel download</button></div>' +
      '<div id="vai-dlbox" style="display:none;padding:10px 12px 0">' +
      '<p id="vai-dltxt" class="muted small" style="margin:0"></p>' +
      '<button id="vai-dlbtn" type="button" class="btn primary" style="margin-top:8px;width:100%"></button>' +
      '<button id="vai-dlbtn2" type="button" class="btn warn" style="margin-top:6px;width:100%;display:none"></button></div>' +
      '<div id="vai-msgs"></div>' +
      '<div class="vai-chips">' +
      CHIPS.map(function (c) { return '<button type="button" class="vai-chip">' + esc(c) + '</button>'; }).join('') +
      '</div>' +
      '<div class="vai-foot">' +
      '<button type="button" id="vai-mem-btn" class="vai-mem-btn">🧠 What Vaulty remembers</button> ' +
      '<button type="button" id="vai-ai-btn" class="vai-mem-btn">⬇ Vaulty AI</button> ' +
      '<button type="button" id="vai-voice-btn" class="vai-mem-btn" style="display:none">🔊 Spoken replies: Off</button>' +
      '<p class="muted small">Unanswered questions are logged anonymously so Vaulty can learn them. ' +
      'Vaulty\'s memory of you stays on this device — nothing is uploaded.</p></div>' +
      '<form id="vai-form"><input id="vai-input" type="text" autocomplete="off" ' +
      'placeholder="Ask about builds, farms, mods…" aria-label="Ask the Vault">' +
      '<button type="button" id="vai-mic" aria-label="Voice input" style="display:none">🎤</button>' +
      '<button type="submit" aria-label="Send">➤</button></form>';

    document.body.appendChild(panel);

    els = {
      btn: null, panel: panel,
      msgs: panel.querySelector('#vai-msgs'),
      input: panel.querySelector('#vai-input'),
      form: panel.querySelector('#vai-form')
    };

    panel.querySelector('#vai-close').addEventListener('click', function () { toggle(false); });
    /* the download/manage buttons get their handlers from
       showDownloadBox / showManageBox (their meaning changes by state) */
    var cancelBtn = panel.querySelector('#vai-loadcancel');
    if (cancelBtn) cancelBtn.addEventListener('click', function () {
      /* v2.23.0: cancel is real — the engine promise, if it lands after
         this, is discarded by runEngine; the guide never waits on it */
      dlCancelled = true;
      engineLoading = false;
      hideProgress();
      lsSet(GUARD_KEY, null);
      setStatus('Vault Guide — quick answers', 'fallback');
      addMsg('Download cancelled — nothing is running in the background. The quick guide has you, and the Vaulty AI button below can restart the download whenever you want.', 'bot');
    });
    var memBtn = panel.querySelector('#vai-mem-btn');
    if (memBtn) memBtn.addEventListener('click', function () {
      if (window.TVMemory) {
        addMsg(TVMemory.viewHtml() + (window.TVLearn ? TVLearn.viewHtml() : ''), 'bot');
      } else {
        addMsg('Memory isn\'t available on this page — it lives in the Vault Guide panel.', 'bot');
      }
    });
    /* v2.23.0: the panel's Vaulty AI button — capability gate first,
       then download / manage / explanation, by real device state */
    var aiBtn = panel.querySelector('#vai-ai-btn');
    if (aiBtn) aiBtn.addEventListener('click', function () {
      if (engine) { showManageBox('running'); return; }
      if (aiOff()) { showManageBox('off'); return; }
      if (modelCached) { showManageBox('downloaded'); return; }
      aiCapabilityAsync().then(function (cap) {
        if (!cap.ok) { postIncapable(cap); return; }
        showDownloadBox('download');
        addMsg('Checked this device first: it can run ' + cap.modelLabel + '. Tap the download button above when you\'re ready — explicit tap only, it never starts itself.' +
          (cap.experimental ? ' On iPhone this is experimental — one failed load settles me back into quick mode, no loops.' : ''), 'bot');
      });
    });
    /* v2.23.0: chat-offered download buttons (delegated — offers are
       rendered inside chat messages) */
    panel.addEventListener('click', function (e) {
      var b = (e.target && typeof e.target.closest === 'function') ? e.target.closest('.vai-aioffer-btn') : null;
      if (b) startDownload();
    });
    /* v2.23.0: voice — mic only when the API exists; spoken replies
       are an explicit, persisted, off-by-default toggle */
    var micBtn = panel.querySelector('#vai-mic');
    var voiceBtn = panel.querySelector('#vai-voice-btn');
    if (window.TVVoice) {
      if (TVVoice.available() && micBtn) {
        micBtn.style.display = '';
        TVVoice.attachMic(micBtn, els.input, function (text) { if (text) ask(text); }, function () {
          addMsg('The microphone didn\'t get permission, so I\'ve hidden the mic button — typing works as always.', 'bot');
        });
      }
      if (TVVoice.speechAvailable() && voiceBtn) {
        voiceBtn.style.display = '';
        var syncVoice = function () { voiceBtn.textContent = TVVoice.repliesOn() ? '🔊 Spoken replies: On' : '🔊 Spoken replies: Off'; };
        syncVoice();
        voiceBtn.addEventListener('click', function () {
          TVVoice.setReplies(!TVVoice.repliesOn());
          syncVoice();
        });
      }
    }
    els.form.addEventListener('submit', function (e) {
      e.preventDefault();
      ask(els.input.value.trim());
    });
    panel.querySelectorAll('.vai-chip').forEach(function (chip) {
      chip.addEventListener('click', function () { ask(cleanChipText(chip.textContent)); });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && panel.style.display === 'flex') toggle(false);
    });
    /* v2.19.3: track the visual viewport so the panel rides the iOS
       keyboard instead of sliding under it */
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', fitPanelToViewport);
      window.visualViewport.addEventListener('scroll', fitPanelToViewport);
    }
    window.addEventListener('orientationchange', function () {
      setTimeout(fitPanelToViewport, 80);
    });
  }

  window.TVAI = {
    init: init, toggle: toggle,
    /* v2.23.0 test hooks: the capability gate is pure device logic and
       the fixtures drive it with stubbed navigators */
    _capability: aiCapability,
    _capabilityAsync: aiCapabilityAsync,
    _models: { desktop: MODEL_DESKTOP, small: MODEL_SMALL },
    _aiAskRe: AI_ASK_RE,
    _guardGet: guardGet,
    _aiOff: aiOff
  };
})();
