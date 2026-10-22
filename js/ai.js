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
    '3. Armor strip: Corrosive Projection aura, Unairu Caustic Strike, or viral+slash bypasses armor anyway.',
    '4. Crit stacking: Critical Delay + Vital Sense (rifles), Primed Ravage + Vigilante Armaments (shotguns), Blood Rush + Weeping Wounds (melee combo).',
    '5. Faction damage: Primed Bane mods (Bane of Grineer/Corpus/Infested/Corrupted) = huge multiplicative damage.',
    '6. Galvanized mods: on-kill stacking damage/multishot that snowballs through crowds.',
    '',
    'CURATED ONE-SHOT BUILDS (8 mods each, riven-less):',
    'Kuva Zarr: Galvanized Chamber, Critical Delay, Vital Sense, Primed Cryo Rounds, Hunter Munitions, Primed Bane Of Grineer, Primed Firestorm, Vigilante Supplies',
    'Kuva Bramma: Galvanized Chamber, Serration, Critical Delay, Vital Sense, Primed Cryo Rounds, Hunter Munitions, Primed Bane Of Grineer, Primed Firestorm',
    'Phenmor (Incarnon): Galvanized Chamber, Serration, Critical Delay, Vital Sense, Malignant Force, Rime Rounds, Hunter Munitions, Primed Bane Of Grineer',
    'Laetum (Incarnon pistol): Hornet Strike, Barrel Diffusion, Lethal Torrent, Primed Pistol Gambit, Primed Target Cracker, Pistol Pestilence, Frostbite, Galvanized Shot',
    'Tenet Arca Plasmor: Galvanized Chamber, Galvanized Aptitude, Critical Delay, Vital Sense, Blunderbuss, Primed Ravage, Toxic Barrage, Frigid Blast',
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
    'FARM NOTES: Primed mods come from Baro Ki\'Teer (void trader). Galvanized mods drop from Steel Path Arbitration-style rewards. Hunter Munitions from Ghoul Purge bounties on Cetus. 60/60 elemental mods from Spy missions and Corrupted Vor. Corrupt mods from Orokin Vaults (Deimos).',
    '',
    'LIVE QUESTIONS: if the Tenno asks about RIGHT NOW in-game (Baro Ki\'Teer, current events, fissures, Nightwave, the latest hotfix), the app answers those itself from the live worldstate feed — never guess at timers, dates, or stock lists from memory.',
    'RIVEN STATUS: Riven trading is temporarily disabled in-game right now (DE PSA, Oct 2026). Unveiling, rolling and using your own Rivens still works. DE is also retiring Riven dispositions, so every Riven is settling at a fixed 1.2 disposition.',
    'HONESTY RULE: if you truly don\'t know a specific fact, say "I don\'t know that one" plainly — the app will offer the Tenno one-tap research buttons. Never invent drop locations, prices, dates, or patch details.'
  ].join('\n');

  /* ---------- WebGPU / engine ---------- */
  function hasWebGPU() {
    return typeof navigator !== 'undefined' && !!navigator.gpu;
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

  function loadEngine() {
    if (engine || engineLoading || engineFailed) return;
    engineLoading = true;
    setStatus('Loading AI… (one-time download)', 'loading');
    showProgress(0, 'Starting AI download…');

    import(WEBLLM_CDN).then(function (m) {
      return m.CreateMLCEngine(MODEL_ID, {
        initProgressCallback: function (p) {
          showProgress(p.progress || 0, p.text || 'Loading AI model…');
        }
      });
    }).then(function (eng) {
      engine = eng;
      engineLoading = false;
      hideProgress();
      setStatus('◈ AI ready — ask me anything', 'ready');
      addMsg('AI engine loaded — ask me anything about builds, mods, farms, or Steel Path. I answer from real Warframe knowledge now, not just keyword matching.', 'bot');
    }).catch(function () {
      engineLoading = false;
      engineFailed = true;
      hideProgress();
      setStatus('Vault Guide — quick answers', 'fallback');
      addMsg('Hey Tenno! ◈ Running in quick-answer mode on this device. Ask me about builds, farming, mods — anything Warframe.', 'bot');
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
      addMsg(FALLBACK._answer(q), 'bot');
    }).catch(function () {
      addMsg('Couldn\'t load the Vault\'s data — try reloading the page.', 'bot');
    });
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
            var finalHtml = md(full);
            /* model admitted it doesn't know → offer real research */
            if (UNCERTAIN_RE.test(full) && FALLBACK && FALLBACK._research) {
              finalHtml += FALLBACK._research(q);
            }
            if (botEl) botEl.innerHTML = finalHtml;
            else addMsg(finalHtml, 'bot');
            history.push({ role: 'user', content: q });
            history.push({ role: 'assistant', content: full });
            if (history.length > 12) history = history.slice(-12);
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

  function ask(q) {
    if (!q) return;
    addMsg(q, 'user');
    els.input.value = '';
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
    if (engine) {
      askAI(q);
    } else if (engineFailed || !hasWebGPU()) {
      askFallback(q);
    } else {
      addMsg('Still loading the AI model — one sec… (or ask again in a moment)', 'bot');
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
    }
    if (els.btn) els.btn.classList.toggle('open', show);
    if (show && !opened) {
      opened = true;
      addMsg("Hey Tenno! ◈ I can help with builds, farming, mods — anything Warframe. " +
        "Try a suggestion below or just ask.", 'bot');
      if (!hasWebGPU()) {
        engineFailed = true;
        setStatus('Vault Guide — quick answers', 'fallback');
      } else {
        loadEngine();
      }
    }
    if (show) setTimeout(function () { els.input.focus(); }, 60);
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
      '</div><p class="muted small" style="margin:6px 0 0">First load downloads ~2GB — once, then it\'s instant.</p></div>' +
      '<div id="vai-msgs"></div>' +
      '<div class="vai-chips">' +
      CHIPS.map(function (c) { return '<button type="button" class="vai-chip">' + esc(c) + '</button>'; }).join('') +
      '</div>' +
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
  }

  window.TVAI = { init: init, toggle: toggle };
})();
