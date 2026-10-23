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
  var MODEL_ID = 'Llama-3.2-3B-Instruct-q4f16_1-MLC';
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
  var GUIDE_ONLY_STATUS = 'Quick-answer mode on iPhone — the full AI model is too heavy for mobile Safari';

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
    return getWebLLM().then(function (m) {
      if (m && typeof m.hasModelInCache === 'function') {
        return m.hasModelInCache(MODEL_ID);
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
    if (!box || !txt || !btn) return;
    if (mode === 'retry') {
      txt.textContent = 'The AI download didn\'t finish. You can try once more — or just keep using the quick guide, it answers without the download.';
      btn.textContent = 'Try the AI download again';
    } else {
      txt.textContent = 'Optional: download the full on-device AI (~2GB, one time). It stays on this device — and the quick guide below works without it.';
      btn.textContent = 'Download AI (~2GB)';
    }
    box.style.display = 'block';
  }

  function hideDownloadBox() {
    var box = document.getElementById('vai-dlbox');
    if (box) box.style.display = 'none';
  }

  /* First open on a WebGPU device: check what's really on the device
     before claiming anything in the header. Cached → load it (that's a
     load, not a download). Not cached → say so and offer the download as
     an explicit tap; the guide answers in the meantime. */
  function loadEngine() {
    if (guideOnly()) return; /* v2.19.3: WebLLM never loads on iOS / no WebGPU */
    if (engine || engineLoading || modelCached !== null) return;
    setStatus('Checking AI…', 'loading');
    checkModelCached().then(function (cached) {
      modelCached = !!cached;
      if (modelCached) {
        /* v2.20.0: the model is already on this device — say so, keep the
           storage persistent, and load from cache. The download box must
           NEVER appear for a device that already has the model, across
           any number of app updates (the model cache is version-
           independent and nothing in the update path may evict it). */
        requestPersist();
        runEngine('Loading AI from this device…');
      } else {
        setStatus('AI not downloaded');
        if (!aiSettled) showDownloadBox('download');
      }
    });
  }

  function startDownload() {
    if (guideOnly()) return; /* v2.19.3: no download exists on iOS / no WebGPU */
    if (engine || engineLoading || aiSettled) return;
    downloadAttempts++;
    requestPersist();
    hideDownloadBox();
    runEngine('Downloading AI model…');
  }

  function runEngine(firstLabel) {
    if (engine || engineLoading) return;
    engineLoading = true;
    showProgress(0, firstLabel);

    getWebLLM().then(function (m) {
      return m.CreateMLCEngine(MODEL_ID, {
        initProgressCallback: function (p) {
          showProgress(p.progress || 0, p.text || 'Loading AI model…');
        }
      });
    }).then(function (eng) {
      engine = eng;
      engineLoading = false;
      engineFailed = false;
      modelCached = true;
      hideProgress();
      hideDownloadBox();
      setStatus('AI ready on this device', 'ready');
      addMsg('AI engine loaded — ask me anything about builds, mods, farms, or Steel Path. I answer from real Warframe knowledge now, not just keyword matching.', 'bot');
    }).catch(function () {
      engineLoading = false;
      engineFailed = true;
      hideProgress();
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

  function askFallback(q) {
    if (!FALLBACK) {
      addMsg('The guide data isn\'t available right now — try reloading the page.', 'bot');
      return;
    }
    FALLBACK._load().then(function () {
      var html = FALLBACK._answer(q);
      /* v2.21.0: a creative build brief is a Workshop handoff in every
         mode — the Workshop researches the item and composes an original
         build from real mods (the model never authors the mod list). */
      if (window.TVWorkshop && FALLBACK._workshopIsHandoff && FALLBACK._workshopIsHandoff(html)) {
        TVWorkshop.handle(q, html, els.msgs, function (h) { addMsg(h, 'bot'); });
        return;
      }
      /* v2.20.0: a guide miss is no longer a dead-end. The question is
         logged anonymously (text only) and Vaulty RESEARCHES it live —
         staged progress bar with a Stop button — in guide mode, AI mode,
         and on iOS alike. The honest don't-know stays as the last resort
         if research finds nothing. */
      if (window.TVResearch && TVResearch.isMiss(html)) {
        TVResearch.handleMiss(q, html, els.msgs, function (h) { addMsg(h, 'bot'); });
      } else {
        addMsg(html, 'bot');
      }
    }).catch(function () {
      addMsg('Couldn\'t load the Vault\'s data — try reloading the page.', 'bot');
    });
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
        TVResearch.handleMiss(q, finalHtml, els.msgs, function (h) { addMsg(h, 'bot'); });
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
    addMsg(q, 'user');
    els.input.value = '';
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
      askFallback(q);
      return;
    }
    if (engine) {
      askAI(q);
    } else {
      /* v2.19.3: questions NEVER wait for the model. If the engine isn't
         fully ready — still loading, not downloaded, failed, settled, or
         guide-only (iOS / no WebGPU) — the live/guide brain answers right
         now. The old "still loading" dead-end is gone. */
      askFallback(q);
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
      else if (isIOS()) setStatus(GUIDE_ONLY_STATUS, 'fallback');
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
      if (isIOS()) {
        /* v2.19.3: iPhone/iPad — guide mode permanently, WebLLM never loads */
        engineFailed = true;
        setStatus(GUIDE_ONLY_STATUS, 'fallback');
        greetFallbackOnce();
      } else if (!hasWebGPU()) {
        engineFailed = true;
        setStatus('AI unavailable on this device', 'fallback');
        greetFallbackOnce();
      } else {
        loadEngine();
      }
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
      '</div><p class="muted small" style="margin:6px 0 0">Downloading is a one-time ~2GB — after that the AI loads from this device.</p></div>' +
      '<div id="vai-dlbox" style="display:none;padding:10px 12px 0">' +
      '<p id="vai-dltxt" class="muted small" style="margin:0"></p>' +
      '<button id="vai-dlbtn" type="button" class="btn primary" style="margin-top:8px;width:100%"></button></div>' +
      '<div id="vai-msgs"></div>' +
      '<div class="vai-chips">' +
      CHIPS.map(function (c) { return '<button type="button" class="vai-chip">' + esc(c) + '</button>'; }).join('') +
      '</div>' +
      '<div class="vai-foot">' +
      '<button type="button" id="vai-mem-btn" class="vai-mem-btn">🧠 What Vaulty remembers</button>' +
      '<p class="muted small">Unanswered questions are logged anonymously so Vaulty can learn them. ' +
      'Vaulty\'s memory of you stays on this device — nothing is uploaded.</p></div>' +
      '<form id="vai-form"><input id="vai-input" type="text" autocomplete="off" ' +
      'placeholder="Ask about builds, farms, mods…" aria-label="Ask the Vault">' +
      '<button type="submit" aria-label="Send">➤</button></form>';

    document.body.appendChild(panel);

    els = {
      btn: null, panel: panel,
      msgs: panel.querySelector('#vai-msgs'),
      input: panel.querySelector('#vai-input'),
      form: panel.querySelector('#vai-form')
    };

    panel.querySelector('#vai-close').addEventListener('click', function () { toggle(false); });
    panel.querySelector('#vai-dlbtn').addEventListener('click', startDownload);
    var memBtn = panel.querySelector('#vai-mem-btn');
    if (memBtn) memBtn.addEventListener('click', function () {
      if (window.TVMemory) addMsg(TVMemory.viewHtml(), 'bot');
      else addMsg('Memory isn\'t available on this page — it lives in the Vault Guide panel.', 'bot');
    });
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

  window.TVAI = { init: init, toggle: toggle };
})();
