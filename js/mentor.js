/* The Foundry — Vaulty. v2.15.0 COMPLETE REBUILD.
   The speech bubble system is GONE — no bubble, no close button, no × anywhere.
   Mobile: single face bubble button, left edge, level with the chat bubble.
   Desktop: Vaulty sits still by the chat bubble (no wandering). Tap opens AI chat.
   Face SVG unchanged. API: window.TV.mentor.hide(), .init() */
(function () {
  'use strict';

  /* ---------- SVG character: chibi Warframe, sitting pose ----------
     Big rounded helmet with ornate gold Orokin faceplate, stubby white body,
     folded legs, hands resting on knees. #tm-eyes (blink), #tm-arm-r (wave/point),
     #tm-costume (holiday hats, drawn on top) are kept for the animation system. */
  function charSVG(mode) {
    var costume = '';
    try {
      if (typeof window.TV !== 'undefined' && typeof window.TV.getHolidayCostume === 'function') {
        costume = window.TV.getHolidayCostume() || '';
      }
    } catch (e) { costume = ''; }
    var armR = (mode === 'point')
      ? '<g id="tm-arm-r">' +
        '<path d="M42 46 L59 32" stroke="#8a8f98" stroke-width="8" stroke-linecap="round"/>' +
        '<path d="M42 46 L59 32" stroke="url(#tmbg)" stroke-width="5.5" stroke-linecap="round"/>' +
        '<path d="M50 39 L59 32" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" opacity="0.7"/>' +
        '<circle cx="60.5" cy="31" r="4.4" fill="url(#tmgd)" stroke="#d4a017" stroke-width="0.8"/>' +
        '<circle cx="60.5" cy="31" r="2.4" fill="#fff3c4"/>' +
        '<circle cx="60.5" cy="31" r="7" fill="#ffd54a" opacity="0.22"/></g>'
      : '<g id="tm-arm-r">' +
        '<path d="M42 46 C47 50, 49 55, 48 60" stroke="#8a8f98" stroke-width="8" stroke-linecap="round"/>' +
        '<path d="M42 46 C47 50, 49 55, 48 60" stroke="url(#tmbg)" stroke-width="5.5" stroke-linecap="round"/>' +
        '<path d="M44.5 50 C47 53, 48.5 56, 48 59" stroke="#ffffff" stroke-width="1.4" stroke-linecap="round" opacity="0.6"/>' +
        '<path d="M45.5 52 L48 57" stroke="url(#tmgd)" stroke-width="2.4" stroke-linecap="round" opacity="0.95"/>' +
        '<circle cx="48" cy="62" r="4.4" fill="url(#tmbg)" stroke="#8a8f98" stroke-width="1"/>' +
        '<circle cx="48" cy="62" r="1.6" fill="#ffffff" opacity="0.7"/></g>';
    return '<svg viewBox="0 0 64 76" width="84" height="100" aria-hidden="true">' +
      '<defs>' +
      '<radialGradient id="tmhg" cx="38%" cy="30%" r="75%">' +
      '<stop offset="0%" stop-color="#ffffff"/><stop offset="55%" stop-color="#eef0f3"/>' +
      '<stop offset="100%" stop-color="#c9cdd4"/></radialGradient>' +
      '<linearGradient id="tmbg" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#f7f8fa"/><stop offset="100%" stop-color="#d3d7dd"/></linearGradient>' +
      '<linearGradient id="tmgd" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#ffe9a3"/><stop offset="55%" stop-color="#ffd54a"/>' +
      '<stop offset="100%" stop-color="#d4a017"/></linearGradient>' +
      '<radialGradient id="tmfg" cx="50%" cy="35%" r="70%">' +
      '<stop offset="0%" stop-color="#2e2e38"/><stop offset="100%" stop-color="#101014"/></radialGradient>' +
      '</defs>' +
      /* soft ground shadow */
      '<ellipse cx="32" cy="71.5" rx="20" ry="3.4" fill="#000000" opacity="0.28"/>' +
      /* folded legs — sitting cross-legged */
      '<g id="tm-legs">' +
      '<ellipse cx="20" cy="65" rx="11.5" ry="6.4" fill="url(#tmbg)" stroke="#8a8f98" stroke-width="1.2"/>' +
      '<ellipse cx="44" cy="65" rx="11.5" ry="6.4" fill="url(#tmbg)" stroke="#8a8f98" stroke-width="1.2"/>' +
      '<path d="M11 63 C16 60.5, 25 60.5, 30 63" stroke="#ffffff" stroke-width="1.6" fill="none" stroke-linecap="round" opacity="0.8"/>' +
      '<path d="M34 63 C39 60.5, 48 60.5, 53 63" stroke="#ffffff" stroke-width="1.6" fill="none" stroke-linecap="round" opacity="0.8"/>' +
      '<path d="M13 66.5 C19 65, 27 65, 31 67" stroke="url(#tmgd)" stroke-width="1.8" fill="none" stroke-linecap="round" opacity="0.9"/>' +
      '<path d="M33 67 C37 65, 45 65, 51 66.5" stroke="url(#tmgd)" stroke-width="1.8" fill="none" stroke-linecap="round" opacity="0.9"/>' +
      '</g>' +
      /* feet */
      '<ellipse cx="10" cy="68.5" rx="5.2" ry="3.8" fill="#33333c" stroke="#1c1c22" stroke-width="0.8"/>' +
      '<ellipse cx="54" cy="68.5" rx="5.2" ry="3.8" fill="#33333c" stroke="#1c1c22" stroke-width="0.8"/>' +
      '<ellipse cx="8.8" cy="67.4" rx="1.8" ry="1.1" fill="#5a5a66" opacity="0.7"/>' +
      '<ellipse cx="52.8" cy="67.4" rx="1.8" ry="1.1" fill="#5a5a66" opacity="0.7"/>' +
      /* stubby torso with armor panel lines */
      '<path d="M32 41 L23.5 45.5 L22.5 60 Q32 63.5 41.5 60 L40.5 45.5 Z" fill="url(#tmbg)" stroke="#8a8f98" stroke-width="1.2"/>' +
      '<path d="M26.5 47.5 L25.8 57.5 M37.5 47.5 L38.2 57.5" stroke="#b7bcc4" stroke-width="1.2" stroke-linecap="round"/>' +
      '<path d="M24 52 Q32 54.5 40 52" stroke="#c6c9cf" stroke-width="1" fill="none" opacity="0.8"/>' +
      /* gold chest emblem with glow */
      '<circle cx="32" cy="53" r="5.4" fill="#ffd54a" opacity="0.18"/>' +
      '<path d="M32 48.5 L35.5 53 L32 57.5 L28.5 53 Z" fill="url(#tmgd)" stroke="#d4a017" stroke-width="0.9"/>' +
      '<circle cx="32" cy="53" r="1.3" fill="#fff3c4"/>' +
      /* gold belt trim */
      '<path d="M23.5 58.5 Q32 61.5 40.5 58.5" stroke="url(#tmgd)" stroke-width="2" fill="none" stroke-linecap="round"/>' +
      /* left arm resting on knee */
      '<g id="tm-arm-l">' +
      '<path d="M22 46 C17 50, 15 55, 16 60" stroke="#8a8f98" stroke-width="8" stroke-linecap="round"/>' +
      '<path d="M22 46 C17 50, 15 55, 16 60" stroke="url(#tmbg)" stroke-width="5.5" stroke-linecap="round"/>' +
      '<path d="M20.5 49 C18.5 52, 17.5 55, 17.6 57.5" stroke="#ffffff" stroke-width="1.4" stroke-linecap="round" opacity="0.6"/>' +
      '<path d="M18.5 52 L16 57" stroke="url(#tmgd)" stroke-width="2.4" stroke-linecap="round" opacity="0.95"/>' +
      '<circle cx="16" cy="62" r="4.4" fill="url(#tmbg)" stroke="#8a8f98" stroke-width="1"/>' +
      '<circle cx="16" cy="62" r="1.6" fill="#ffffff" opacity="0.7"/>' +
      '</g>' +
      armR +
      /* big rounded helmet — the focal point */
      '<g id="tm-head">' +
      '<ellipse cx="32" cy="25" rx="17.5" ry="18.5" fill="url(#tmhg)" stroke="#8a8f98" stroke-width="1.5"/>' +
      /* dome highlight + soft side shading */
      '<path d="M19.5 17 C22.5 10.5, 29 7.5, 35.5 8" stroke="#ffffff" stroke-width="3" fill="none" opacity="0.95" stroke-linecap="round"/>' +
      '<path d="M46.5 21 C48.5 27.5, 47.5 35, 43 40.5" stroke="#aeb4bd" stroke-width="2.4" fill="none" opacity="0.7" stroke-linecap="round"/>' +
      '<path d="M17.5 21 C15.5 27.5, 16.5 35, 21 40.5" stroke="#aeb4bd" stroke-width="2.4" fill="none" opacity="0.7" stroke-linecap="round"/>' +
      /* gold helmet band */
      '<path d="M16.5 32 C22 36.5, 42 36.5, 47.5 32" stroke="url(#tmgd)" stroke-width="2.2" fill="none" stroke-linecap="round"/>' +
      /* gold crest — soft rounded fin */
      '<path d="M32 -1 Q26.5 4.5, 27 10.5 L37 10.5 Q37.5 4.5, 32 -1 Z" fill="url(#tmgd)" stroke="#d4a017" stroke-width="1"/>' +
      '<circle cx="32" cy="3.2" r="2.2" fill="url(#tmgd)" stroke="#d4a017" stroke-width="0.8"/>' +
      '<circle cx="32" cy="3.2" r="0.9" fill="#fff3c4"/>' +
      '<path d="M20.5 10.5 C26 6.5, 38 6.5, 43.5 10.5" stroke="#d4a017" stroke-width="1.8" fill="none" stroke-linecap="round" opacity="0.9"/>' +
      /* dark face opening */
      '<ellipse cx="32" cy="28.5" rx="10" ry="11.5" fill="url(#tmfg)"/>' +
      /* ornate gold ring around the face */
      '<ellipse cx="32" cy="28.5" rx="11.6" ry="13.1" fill="none" stroke="url(#tmgd)" stroke-width="3"/>' +
      '<ellipse cx="32" cy="28.5" rx="11.6" ry="13.1" fill="none" stroke="#8a5a00" stroke-width="0.7" opacity="0.6"/>' +
      '<circle cx="32" cy="14.6" r="1.7" fill="url(#tmgd)" stroke="#d4a017" stroke-width="0.6"/>' +
      '<circle cx="21.8" cy="20.5" r="1.7" fill="url(#tmgd)" stroke="#d4a017" stroke-width="0.6"/>' +
      '<circle cx="42.2" cy="20.5" r="1.7" fill="url(#tmgd)" stroke="#d4a017" stroke-width="0.6"/>' +
      '<circle cx="20.2" cy="32" r="1.7" fill="url(#tmgd)" stroke="#d4a017" stroke-width="0.6"/>' +
      '<circle cx="43.8" cy="32" r="1.7" fill="url(#tmgd)" stroke="#d4a017" stroke-width="0.6"/>' +
      /* soft rounded gold chin guard */
      '<ellipse cx="32" cy="44.5" rx="5.4" ry="3.2" fill="url(#tmgd)" stroke="#d4a017" stroke-width="0.8"/>' +
      '<ellipse cx="32" cy="43.8" rx="3.6" ry="1.9" fill="#fff3c4" opacity="0.55"/>' +
      '</g>' +
      /* big cute glowing eyes with sparkles */
      '<g id="tm-eyes">' +
      '<ellipse cx="27.6" cy="28" rx="5.2" ry="6" fill="#00e5ff" opacity="0.22"/>' +
      '<ellipse cx="36.4" cy="28" rx="5.2" ry="6" fill="#00e5ff" opacity="0.22"/>' +
      '<ellipse cx="27.6" cy="28" rx="4" ry="5" fill="#00e5ff"/>' +
      '<ellipse cx="36.4" cy="28" rx="4" ry="5" fill="#00e5ff"/>' +
      '<ellipse cx="27.6" cy="28" rx="4" ry="5" fill="none" stroke="#7df3ff" stroke-width="0.8" opacity="0.8"/>' +
      '<ellipse cx="36.4" cy="28" rx="4" ry="5" fill="none" stroke="#7df3ff" stroke-width="0.8" opacity="0.8"/>' +
      '<circle cx="29" cy="25.8" r="1.5" fill="#ffffff" opacity="0.95"/>' +
      '<circle cx="37.8" cy="25.8" r="1.5" fill="#ffffff" opacity="0.95"/>' +
      '<circle cx="26.6" cy="30.5" r="0.7" fill="#ffffff" opacity="0.7"/>' +
      '<circle cx="35.4" cy="30.5" r="0.7" fill="#ffffff" opacity="0.7"/>' +
      '</g>' +
      /* bigger soft blush + tiny smile = huggable */
      '<ellipse cx="23.6" cy="34.5" rx="2.8" ry="1.8" fill="#ff9db0" opacity="0.6"/>' +
      '<ellipse cx="40.4" cy="34.5" rx="2.8" ry="1.8" fill="#ff9db0" opacity="0.6"/>' +
      '<path d="M29 37.5 Q32 39.8 35 37.5" stroke="#ffd54a" stroke-width="1.4" fill="none" stroke-linecap="round" opacity="0.95"/>' +
      /* holiday costume sits on top of the helmet */
      '<g id="tm-costume">' + costume + '</g>' +
      '<g id="tm-tab-accessory">' + themeAccessory() + '</g>' +
      '</svg>';
  }

  /* ===== v2.12.73: mobile face bubble — head-only SVG for the circular button ===== */
  function faceSVG() {
    return '<svg viewBox="8 -8 48 58" width="56" height="56" aria-hidden="true">' +
      '<defs>' +
      '<radialGradient id="tmfhg" cx="38%" cy="30%" r="75%">' +
      '<stop offset="0%" stop-color="#ffffff"/><stop offset="55%" stop-color="#eef0f3"/>' +
      '<stop offset="100%" stop-color="#c9cdd4"/></radialGradient>' +
      '<linearGradient id="tmfgd" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#ffe9a3"/><stop offset="55%" stop-color="#ffd54a"/>' +
      '<stop offset="100%" stop-color="#d4a017"/></linearGradient>' +
      '<radialGradient id="tmffg" cx="50%" cy="35%" r="70%">' +
      '<stop offset="0%" stop-color="#2e2e38"/><stop offset="100%" stop-color="#101014"/></radialGradient>' +
      '</defs>' +
      /* helmet */
      '<ellipse cx="32" cy="25" rx="17.5" ry="18.5" fill="url(#tmfhg)" stroke="#8a8f98" stroke-width="1.5"/>' +
      '<path d="M19.5 17 C22.5 10.5, 29 7.5, 35.5 8" stroke="#ffffff" stroke-width="3" fill="none" opacity="0.95" stroke-linecap="round"/>' +
      '<path d="M46.5 21 C48.5 27.5, 47.5 35, 43 40.5" stroke="#aeb4bd" stroke-width="2.4" fill="none" opacity="0.7" stroke-linecap="round"/>' +
      '<path d="M17.5 21 C15.5 27.5, 16.5 35, 21 40.5" stroke="#aeb4bd" stroke-width="2.4" fill="none" opacity="0.7" stroke-linecap="round"/>' +
      '<path d="M16.5 32 C22 36.5, 42 36.5, 47.5 32" stroke="url(#tmfgd)" stroke-width="2.2" fill="none" stroke-linecap="round"/>' +
      /* gold crest */
      '<path d="M32 -1 Q26.5 4.5, 27 10.5 L37 10.5 Q37.5 4.5, 32 -1 Z" fill="url(#tmfgd)" stroke="#d4a017" stroke-width="1"/>' +
      '<circle cx="32" cy="3.2" r="2.2" fill="url(#tmfgd)" stroke="#d4a017" stroke-width="0.8"/>' +
      '<circle cx="32" cy="3.2" r="0.9" fill="#fff3c4"/>' +
      /* dark face opening + gold ring */
      '<ellipse cx="32" cy="28.5" rx="10" ry="11.5" fill="url(#tmffg)"/>' +
      '<ellipse cx="32" cy="28.5" rx="11.6" ry="13.1" fill="none" stroke="url(#tmfgd)" stroke-width="3"/>' +
      /* glowing eyes */
      '<ellipse cx="27.6" cy="28" rx="4" ry="5" fill="#00e5ff"/>' +
      '<ellipse cx="36.4" cy="28" rx="4" ry="5" fill="#00e5ff"/>' +
      '<circle cx="29" cy="25.8" r="1.5" fill="#ffffff" opacity="0.95"/>' +
      '<circle cx="37.8" cy="25.8" r="1.5" fill="#ffffff" opacity="0.95"/>' +
      /* blush + smile */
      '<ellipse cx="23.6" cy="34.5" rx="2.8" ry="1.8" fill="#ff9db0" opacity="0.6"/>' +
      '<ellipse cx="40.4" cy="34.5" rx="2.8" ry="1.8" fill="#ff9db0" opacity="0.6"/>' +
      '<path d="M29 37.5 Q32 39.8 35 37.5" stroke="#ffd54a" stroke-width="1.4" fill="none" stroke-linecap="round" opacity="0.95"/>' +
      /* chin guard */
      '<ellipse cx="32" cy="44.5" rx="5.4" ry="3.2" fill="url(#tmfgd)" stroke="#d4a017" stroke-width="0.8"/>' +
      '</svg>';
  }
  /* v2.12.73: mobile face-bubble mode — circular button replaces the shimeji */
  function isMobileFaceMode() {
    try { return window.matchMedia('(max-width: 767px)').matches; } catch (e) { return false; }
  }

  var VAULTY = 'Vaulty';
  var TIPS = {
    'index': "Hiya, I'm Vaulty! 👋 Your tiny Vault keeper. Tap me anytime — I give great advice and terrible jokes.",
    'builds': "Ooh, builds! My favorite. Tap the ⭐ filter for the spicy one-shot Steel Path stuff.",
    'starchart': "Pick a planet, any planet! I'll tell you what's worth farming there.",
    'donate': "Donations keep my little legs running! No pressure though — your company is enough. 🥺",
    'live': "Live stuff! Cycles, fissures, alerts — fresher than a Forma'd Braton.",
    'farming': "Grind time! These are the best farms. Trust me, I've run Ophelia like 400 times.",
    'marketplace': "Buy low, sell high, Tenno! Just don't get scammed — I can't bail you out of that.",
    'news': "Fresh off the press! I read patch notes so you don't have to. You're welcome.",
    'chat': "The community hub! Be nice — I read everything. EVERYTHING. 👀",
    'videos': "Grab popcorn! These are the best guides on YouTube right now."
  };

  /* Vaulty's honest (and silly) takes on popular gear */
  var TAKES = {
    'kuva zarr': ["The Kuva Zarr? Absolute menace. Barrage mode goes BRRR. 10/10 would explode myself with it again.",
                 "Kuva Zarr is what happens when a cannon and a shotgun have a beautiful baby."],
    'torid': ["Torid with Incarnon? Disgusting. In the best way. It melts Steel Path like butter."],
    'rubico prime': ["Rubico Prime. The sniper that made Eidolons cry. Still a headshot machine."],
    'nova prime': ["Nova Prime is THAT frame. Speedva, Slowva, she does it all. My queen. 👑"],
    'saryn': ["Saryn says 'what if the whole map just... died?' And honestly? Iconic behavior."],
    'wukong': ["Wukong players are either chill or terrifying. No in-between. The clone does half your work though, respect."],
    'octavia': ["Octavia is just Warframe's way of letting you win while teabagging. Musical teabagging."],
    'revenant': ["Revenant Prime goes brrr and everything dies. Mesmer Skin is basically plot armor."],
    'ignis wraith': ["The Ignis Wraith: for when aiming is too much effort. We've all been there."],
    'xaku': ["Xaku is what happens when you put a Warframe in a blender and it comes out BETTER."],
    'kullervo': ["Kullervo. Melee go brrr. One button, whole room deleted. Simple. Elegant. Violent."]
  };
  function vaultyTake(itemName) {
    if (!itemName) return null;
    var key = String(itemName).toLowerCase().trim();
    var takes = TAKES[key];
    if (!takes) return null;
    return takes[Math.floor(Math.random() * takes.length)];
  }

  var GREETINGS = [
    "Hello, Tenno! 👋",
    "Need a build? Tap me!",
    "Psst… check the News tab for the latest hotfix",
    "Your arsenal is looking strong today",
    "Did you know? You can ask me anything about Warframe",
    "Don't forget to check today's fissures!"
  ];

  var HOLIDAY_GREETINGS = {
    'halloween': ["Spooky builds for spooky season, Tenno! 🎃", "Trick or treat, Tenno — I brought builds! 🦇"],
    'christmas': ["Happy holidays, Tenno! 🎄", "All I want for Christmas is a God-roll riven 🎁"],
    'newyear': ["Happy New Year, Tenno! 🎆", "New year, new main? I can help you pick! ✨"]
  };

  var LS_KEY = 'tv-mentor-seen';
  var els = {};
  var reducedMotion = false;

  /* session-only playful state (never persisted) */
  var session = {
    popups: 0,
    lastDismiss: 0,
    lastTip: 0,
    greetIdx: Math.floor(Math.random() * GREETINGS.length)
  };

  function seenMap() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); }
    catch (e) { return {}; }
  }
  function markSeen(key) {
    try {
      var m = seenMap();
      m[key] = 1;
      localStorage.setItem(LS_KEY, JSON.stringify(m));
    } catch (e) { /* private mode */ }
  }
  function wasSeen(key) { return !!seenMap()[key]; }

  function pageKey() {
    var p = (location.pathname.split('/').pop() || 'index.html').replace('.html', '');
    return p === '' ? 'index' : p;
  }

  function holiday() {
    try {
      return (window.TV && window.TV.holiday) || null;
    } catch (e) { return null; }
  }

  function build() {
    if (document.getElementById('tv-mentor')) return;
    var wrap = document.createElement('div');
    wrap.id = 'tv-mentor';
    wrap.setAttribute('role', 'button');
    wrap.setAttribute('tabindex', '0');
    wrap.setAttribute('aria-label', 'Open Vault Guide AI chat');
    wrap.title = 'Ask the Vault Guide AI';
    /* v2.15.0: COMPLETE REBUILD — speech bubble system DELETED. No bubble,
       no close button, no × anywhere. Wrap holds ONLY: char (desktop),
       facebtn (mobile). Nothing else can render. */
    wrap.innerHTML =
      '<div id="tv-mentor-char" class="tv-mentor-char">' + charSVG('idle') + '</div>';
    document.body.appendChild(wrap);
    els.wrap = wrap;
    els.char = wrap.querySelector('#tv-mentor-char');
    /* v2.12.73: mobile face bubble — circular button with Vaulty's face */
    var facebtn = document.createElement('button');
    facebtn.id = 'tv-facebtn';
    facebtn.className = 'tv-facebtn';
    facebtn.type = 'button';
    facebtn.setAttribute('aria-label', 'Open Vault Guide AI chat');
    facebtn.title = 'Ask Vaulty';
    facebtn.innerHTML = faceSVG();
    wrap.appendChild(facebtn);
    els.facebtn = facebtn;
    /* face tap opens the AI chat (same as tapping Vaulty on desktop) */
    facebtn.addEventListener('click', function (e) {
      e.stopPropagation();
      openAI();
    });

    function openAI() {
      squash();
      setTimeout(function () {
        hide();
        /* v2.12.29: ensure TVAI is initialized before toggling */
        try {
          if (window.TVAI) {
            /* if panel doesn't exist, try to init first */
            if (!document.getElementById('vault-ai-panel') && typeof window.TVAI.init === 'function') {
              window.TVAI.init();
            }
            if (typeof window.TVAI.toggle === 'function') {
              window.TVAI.toggle(true);
            }
          }
        } catch (e) {}
      }, reducedMotion ? 0 : 180);
    }
    /* tap Vaulty: random fun animation before opening AI (not when dragging) */
    /* v2.12.27 fix: track actual drag distance, not any pointer movement —
       hovering to click was setting tapMoved=true and blocking the AI chat */
    var tapMoved = false;
    var downX = 0, downY = 0;
    els.char.addEventListener('pointerdown', function (e) {
      tapMoved = false;
      downX = e.clientX; downY = e.clientY;
    });
    els.char.addEventListener('pointermove', function (e) {
      if (e.buttons === 0) return; /* not dragging, just hovering */
      var dx = e.clientX - downX, dy = e.clientY - downY;
      if (dx * dx + dy * dy > 100) tapMoved = true; /* >10px = real drag */
    });
    els.char.addEventListener('click', function (e) {
      /* was it a drag? then don't open AI */
      if (tapMoved || (shimeji.dragging)) return;
      if (els.char && !reducedMotion) {
        /* v2.12.31: all animations in the random tap rotation */
        var anims = ['excited', 'spin', 'dance', 'jump', 'flip', 'happy', 'wave'];
        var anim = anims[Math.floor(Math.random() * anims.length)];
        els.char.classList.add(anim);
        setTimeout(function () {
          if (els.char) els.char.classList.remove(anim);
        }, 1500);
      }
      setTimeout(openAI, 350);
    });
    wrap.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openAI(); }
    });
  }

  /* ---------- one-shot animation helpers ---------- */
  function playAnim(cls, ms) {
    if (reducedMotion || !els.char) return;
    els.char.classList.remove('attn', 'wave', 'dance', 'squash');
    /* force reflow so re-triggering works */
    void els.char.offsetWidth;
    els.char.classList.add(cls);
    setTimeout(function () { if (els.char) els.char.classList.remove(cls); }, ms);
  }
  function attention() { playAnim('attn', 700); }
  function wave() { playAnim('wave', 1400); }
  function dance() { playAnim('dance', 2000); }
  function squash() {
    playAnim('squash', 400);
    /* v2.13.3: on mobile the full char is hidden — squash the visible face bubble instead */
    if (isMobileFaceMode() && els.facebtn && !reducedMotion) {
      els.facebtn.classList.remove('tv-squash');
      void els.facebtn.offsetWidth;
      els.facebtn.classList.add('tv-squash');
      setTimeout(function () { if (els.facebtn) els.facebtn.classList.remove('tv-squash'); }, 400);
    }
  }
  /* v2.12.31: new animation helpers */
  function jump() { playAnim('jump', 700); }
  function flip() { playAnim('flip', 800); }
  function happy() { playAnim('happy', 1200); }
  function sad() { playAnim('sad', 1500); }
  function think() { playAnim('think', 2000); }

  /* walk across the screen, then say something */
  function walkAcross(msg) {
    if (isMobileFaceMode()) { return; } /* v2.12.73: face bubble stays parked */
    if (reducedMotion || !els.wrap) return;
    build();
    els.wrap.classList.add('visible');
    /* start from left edge */
    els.wrap.style.left = '-80px';
    els.wrap.style.right = 'auto';
    els.wrap.style.bottom = '14px';
    els.wrap.style.top = 'auto';
    els.wrap.classList.add('walking');
    if (els.char) els.char.classList.add('walk-anim');
    /* walk to right edge */
    requestAnimationFrame(function () {
      els.wrap.style.left = (window.innerWidth + 20) + 'px';
    });
    /* when he reaches the middle, wave (v2.15.0: no speech) */
    setTimeout(function () {
      wave();
    }, 4000);
    /* clean up after crossing — v2.12.11: restore shimeji home so he doesn't teleport */
    setTimeout(function () {
      if (els.wrap) {
        els.wrap.classList.remove('walking', 'visible');
        els.wrap.style.left = '';
        if (els.char) els.char.classList.remove('walk-anim');
        /* resync shimeji to his home spot */
        shimeji.x = shimeji.homeX;
        shimeji.y = shimeji.homeY;
        shimeji.state = 'idle';
        positionShimeji();
      }
    }, 8500);
  }

  /* Vaulty transforms per section! */
  var SECTION_THEMES = {
    /* GEAR */
    'warframes':  { held: '🛡️', pose: 'hero' },
    'weapons':    { held: '🔫', pose: 'stand' },
    'companions': { morph: '🐾', pose: 'morph' },
    'amps':       { held: '⚡', pose: 'stand' },
    'operators':  { held: '👁️', pose: 'hero' },
    'archwing':   { held: '🚀', pose: 'hero' },
    /* UPGRADES */
    'mods':       { held: '🃏', pose: 'hold' },
    'arcanes':    { held: '💎', pose: 'hold' },
    'shards':     { held: '🔷', pose: 'hold' },
    'builds':     { held: '⚔️', pose: 'stand' },
    'helminth':   { held: '🧬', pose: 'hold' },
    'focus':      { held: '🔮', pose: 'hold' },
    'incarnon':   { held: '🔥', pose: 'stand' },
    /* WORLD */
    'relics':     { held: '🪐', pose: 'planet' },
    'starchart':  { held: '🌍', pose: 'planet' },
    'farming':    { held: '⛏️', pose: 'planet' },
    'resources':  { held: '🌎', pose: 'planet' },
    'live':       { held: '📡', pose: 'planet' },
    'duviri':     { held: '🌀', pose: 'planet' },
    /* COMMUNITY */
    'chat':       { held: '💕', pose: 'buddy', buddy: true },
    'marketplace':{ held: '🤝', pose: 'buddy', buddy: true },
    'videos':     { held: '📺', pose: 'buddy', buddy: true },
    'news':       { held: '📰', pose: 'buddy', buddy: true },
    'donate':     { held: '💝', pose: 'buddy', buddy: true }
  };
  function sectionTheme() {
    var key = pageKey();
    return SECTION_THEMES[key] || null;
  }
  /* build the theme SVG: held item + optional buddy — BIG and obvious */
  function themeAccessory() {
    var theme = sectionTheme();
    if (!theme) return '';
    var svg = '';
    if (theme.morph) {
      /* Vaulty BECOMES the thing — big morph emoji above him */
      svg = '<text x="32" y="18" font-size="32" text-anchor="middle">' + theme.morph + '</text>';
    } else if (theme.pose === 'planet') {
      /* planet floating above his head */
      svg = '<text x="32" y="14" font-size="22" text-anchor="middle">' + theme.held + '</text>';
    } else if (theme.pose === 'buddy') {
      /* buddy right next to him + love */
      svg = '<text x="56" y="54" font-size="26" text-anchor="middle">🤖</text>' +
            '<text x="44" y="16" font-size="14" text-anchor="middle">' + theme.held + '</text>' +
            '<text x="20" y="16" font-size="12" text-anchor="middle">💕</text>';
    } else {
      /* weapon/upgrade held high in hand */
      svg = '<text x="50" y="30" font-size="22" text-anchor="middle">' + theme.held + '</text>';
    }
    return svg;
  }

  function setChar(mode) {
    if (!els.char) return;
    els.char.innerHTML = charSVG(mode);
    /* v2.12.11: SVG was rebuilt — force body-anim to re-query parts */
    try { if (window.TV && window.TV._vaultyResync) window.TV._vaultyResync(); } catch (e) {}
  }

  function hide() {
    if (!els.wrap) return;
    if (reducedMotion) {
      finishHide();
      return;
    }
    els.wrap.classList.add('exiting');
    setTimeout(finishHide, 280);
  }
  function finishHide() {
    if (!els.wrap) return;
    els.wrap.classList.remove('visible', 'exiting');
    els.wrap.style.left = ''; els.wrap.style.top = '';
    els.wrap.style.right = ''; els.wrap.style.bottom = '';
    setChar('idle');
  }

  function resetPosition() {
    if (!els.wrap || els.wrap.classList.contains('pointing')) return;
    els.wrap.style.left = ''; els.wrap.style.top = '';
  }

  /* ---------- online counter badge ---------- */
  /* v2.13.2: Vaulty's Tenno-online badge removed per Giel (for now).
     The Firebase counter still flows through window.TV._onlineCount;
     only Vaulty's pill is gone. */
  function updateBadge() {
    if (els.badge) els.badge.hidden = true;
  }

  /* ---------- playful random pop-ups ---------- */
  function nextGreeting() {
    var h = holiday();
    if (h && h.id && HOLIDAY_GREETINGS[h.id]) {
      var arr = HOLIDAY_GREETINGS[h.id];
      return arr[Math.floor(Math.random() * arr.length)];
    }
    var g = GREETINGS[session.greetIdx % GREETINGS.length];
    session.greetIdx++;
    return g;
  }

  function canPopup() {
    if (session.popups >= 8) return false;
    var now = Date.now();
    if (now - session.lastDismiss < 5 * 60 * 1000) return false;
    if (now - session.lastTip < 2 * 60 * 1000) return false;
    /* update banner visible? */
    var banner = document.getElementById('tv-update-banner');
    if (banner && banner.classList.contains('show')) return false;
    /* AI chat open or user typing in it? */
    var aiPanel = document.getElementById('vault-ai-panel');
    if (aiPanel && aiPanel.style.display === 'flex') return false;
    var active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA') &&
        active.closest && active.closest('#vault-ai-panel')) return false;
    /* mid-donation? (typing amount or PayPal iframe present) */
    if (pageKey() === 'donate') {
      var amt = document.getElementById('pp-amount');
      if (amt && document.activeElement === amt) return false;
      var ppFrame = document.querySelector('#pp-donate-btn iframe');
      if (ppFrame) return false;
    }
    return true;
  }

  function randomPopup() {
    if (!canPopup()) { schedulePopup(); return; }
    session.popups++;
    var msg = nextGreeting();
    /* occasionally brag about the crowd */
    if (Math.random() < 0.3) {
      var n = 0;
      try { if (window.TV && typeof window.TV.getOnlineCount === 'function') n = window.TV.getOnlineCount(); } catch (e) {}
      if (n > 1) msg = n + ' Tenno browsing the Vault right now! 🎉';
    }
    /* v2.14.0: Vaulty is stationary — no more walking across the screen.
       He stays parked by the chat bubble; wave or dance in place instead. */
    var doDance = Math.random() < 0.4;
    /* v2.15.0: no speech bubble — just wave/dance in place */
    setTimeout(function () { doDance ? dance() : wave(); }, 400);
    schedulePopup();
  }

  function schedulePopup() {
    /* 60 seconds – 2 minutes, randomized (more active!) */
    var delay = (1 + Math.random() * 1) * 60 * 1000;
    setTimeout(randomPopup, delay);
  }

  function maybeFirstVisit() {
    /* v2.15.0: tips removed with the speech bubble — Vaulty just waves hello now */
    return;
  }

  function init() {
    try {
      reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) { reducedMotion = false; }
    /* v2.12.14: respect user's animation toggle */
    try {
      if (localStorage.getItem('tv-animations') === 'off') reducedMotion = true;
    } catch (e) {}
    /* listen for toggle changes (same-tab custom event + cross-tab storage) */
    var onAnimToggle = function (on) {
      reducedMotion = !on;
      /* v2.12.31: don't hide Vaulty — just freeze animations, keep him tappable */
      if (!on) {
        shimeji.state = 'idle';
      } else {
        if (els.wrap && !els.wrap.classList.contains('visible')) {
          els.wrap.classList.add('visible');
        }
        setTimeout(shimejiBehave, 2000);
      }
    };
    try {
      document.addEventListener('tv-anim-toggle', function (e) {
        if (e && e.detail && typeof e.detail.on === 'boolean') onAnimToggle(e.detail.on);
      });
      window.addEventListener('storage', function (e) {
        if (e.key === 'tv-animations') onAnimToggle(e.newValue !== 'off');
      });
    } catch (e) {}
    build();
    /* entrance: slide/fade in with a little bounce */
    setTimeout(function () {
      els.wrap.classList.add('visible', 'entering');
      setTimeout(function () { if (els.wrap) els.wrap.classList.remove('entering'); }, reducedMotion ? 0 : 700);
    }, 1200);
    maybeFirstVisit();
    updateBadge(); /* badge stays hidden (v2.13.2) */
    /* real-time: update instantly when the count changes */
    document.addEventListener('tv-online-count', function (e) {
      if (e && e.detail && typeof e.detail.count === 'number') {
        window.TV = window.TV || {};
        window.TV._onlineCount = e.detail.count;
      }
    });
    schedulePopup();
    shimejiInit();
    /* v2.12.20: on resize, recalc home position and keep Vaulty above tab bar */
    /* v2.12.30: if user placed him, keep his spot (clamped to new viewport) */
    window.addEventListener('resize', function () {
      resetPosition();
      /* recalc home for new viewport size — parked by the chat bubble */
      var rh = stationaryHome();
      shimeji.homeX = rh.x;
      shimeji.homeY = rh.y;
      if (shimeji.userPlaced && !shimeji.dragging) {
        /* keep his spot, just clamp inside the new viewport */
        shimeji.x = Math.max(0, Math.min(window.innerWidth - 80, shimeji.x));
        shimeji.y = Math.max(60, Math.min(window.innerHeight - 80, shimeji.y));
      } else if (!shimeji.dragging && shimeji.state !== 'walking') {
        /* not placed by user — snap back to home; positionShimeji handles tab bar */
        shimeji.x = shimeji.homeX;
        shimeji.y = shimeji.homeY;
      }
      positionShimeji();
    });
  }

  /* ===== SHIMEJI ENGINE — Vaulty is a living screen pet ===== */
  var shimeji = {
    x: 0, y: 0,               // position — set on init
    vx: 0, vy: 0,            // velocity
    dir: 1,                  // facing: 1 right, -1 left (start facing right/inward)
    state: 'idle',           // idle, walking, falling, dragging, climbing, sleeping
    groundY: 0,              // y position from top — set on init
    dragging: false,
    lastAction: 0,
    homeX: 0,                // his home spot — returns here
    homeY: 0,
    userPlaced: false        // v2.12.30: true after user drags him — resize keeps his spot
  };

  /* v2.14.0: stationary home — parked left of the chat bubble (right:18px, 52px wide,
     bottom:84px), aligned at the same height. He doesn't wander anymore. */
  function stationaryHome() {
    return {
      x: Math.max(0, window.innerWidth - 18 - 52 - 16 - 90),
      y: Math.max(60, window.innerHeight - 84 - 100)
    };
  }

  function shimejiInit() {
    if (isMobileFaceMode()) return; /* v2.12.73: face bubble replaces shimeji on mobile */
    if (reducedMotion || !els.wrap) return;
    els.wrap.classList.add('shimeji');
    /* v2.14.0 home: parked left of the chat bubble, same height — stationary */
    var h0 = stationaryHome();
    shimeji.x = h0.x;
    shimeji.y = h0.y;
    shimeji.homeX = shimeji.x;
    shimeji.homeY = shimeji.y;
    positionShimeji();
    /* drag interactions */
    var char = els.char;
    if (!char) return;
    var startX, startY, origX, origY;

    char.addEventListener('pointerdown', function (e) {
      shimeji.dragging = true;
      shimeji.state = 'dragging';
      els.wrap.classList.add('dragging');
      if (els.char) els.char.classList.remove('falling', 'sleeping', 'climbing');
      var zzz = els.wrap.querySelector('.tv-mentor-zzz');
      if (zzz) zzz.remove();
      startX = e.clientX; startY = e.clientY;
      origX = shimeji.x; origY = shimeji.y;
      try { char.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
      e.stopPropagation();
    });
    char.addEventListener('pointermove', function (e) {
      if (!shimeji.dragging) return;
      shimeji.x = origX + (e.clientX - startX);
      shimeji.y = origY + (e.clientY - startY);
      shimeji.x = Math.max(0, Math.min(window.innerWidth - 80, shimeji.x));
      shimeji.y = Math.max(60, Math.min(window.innerHeight - 80, shimeji.y));
      positionShimeji();
    });
    function drop(e) {
      if (!shimeji.dragging) return;
      shimeji.dragging = false;
      els.wrap.classList.remove('dragging');
      /* stays where you put him — no falling */
      shimeji.state = 'idle';
      shimeji.vy = 0;
      shimeji.userPlaced = true; /* v2.12.30: remember — resize won't move him */
      if (els.char) els.char.classList.remove('falling', 'climbing');
      /* happy little bounce on landing */
      if (els.char && !reducedMotion) {
        els.char.classList.add('excited');
        setTimeout(function () { if (els.char) els.char.classList.remove('excited'); }, 600);
      }
      e.stopPropagation();
    }
    char.addEventListener('pointerup', drop);
    char.addEventListener('pointercancel', drop);

    /* cursor proximity: he looks at your cursor */
    var lookTimer = null;
    document.addEventListener('pointermove', function (e) {
      if (shimeji.dragging || shimeji.state === 'sleeping') return;
      if (!els.wrap || !els.wrap.classList.contains('visible')) return;
      var rect = els.wrap.getBoundingClientRect();
      var cx = rect.left + rect.width / 2;
      var dx = e.clientX - cx;
      /* face the cursor */
      var newDir = dx > 0 ? 1 : -1;
      if (newDir !== shimeji.dir && Math.abs(dx) > 60) {
        shimeji.dir = newDir;
        flipShimeji();
      }
    }, { passive: true });

    /* physics loop */
    setInterval(shimejiPhysics, 50);
    /* behavior loop */
    setTimeout(shimejiBehave, 4000);
    /* JS body animation — guaranteed to work on all devices */
    startBodyAnimation();
  }

  /* Animate Vaulty's body parts with JavaScript — arms wave, legs kick, head bobs.
     v2.12.11 hotfix: pause when hidden/background tab (perf), and resync after
     setChar() rebuilds the SVG so parts are never stale. */
  var bodyAnimT = 0;
  var bodyAnimStarted = false;
  function startBodyAnimation() {
    if (bodyAnimStarted) return;
    bodyAnimStarted = true;
    /* v2.12.32: idle swaying disabled — Vaulty stays still by default.
       Only specific actions (wave, dance, tap animations) move him now.
       Keeping the function as a no-op so existing calls don't break. */
    return;
    var armR, armL, legs, head, svg;
    function findParts() {
      var wrap = document.getElementById('tv-mentor');
      if (!wrap) return false;
      /* re-query every time — setChar() rebuilds innerHTML */
      armR = wrap.querySelector('#tm-arm-r');
      armL = wrap.querySelector('#tm-arm-l');
      legs = wrap.querySelector('#tm-legs');
      head = wrap.querySelector('#tm-head');
      svg = wrap.querySelector('.tv-mentor-char > svg') || wrap.querySelector('svg');
      return !!(armR || armL || head);
    }
    /* expose a resync hook so setChar() never leaves stale refs */
    window.TV = window.TV || {};
    window.TV._vaultyResync = function () { armR = armL = legs = head = null; };
    function tick() {
      try {
        /* skip work when tab hidden or Vaulty not visible — saves battery */
        if (document.hidden) { requestAnimationFrame(tick); return; }
        bodyAnimT += 0.06;
        var t = bodyAnimT;
        var wrap = document.getElementById('tv-mentor');
        var vis = wrap && wrap.classList.contains('visible') &&
                  getComputedStyle(wrap).opacity !== '0';
        if (!reducedMotion && vis) {
          if (!armR && !findParts()) { requestAnimationFrame(tick); return; }
          var char = wrap.querySelector('.tv-mentor-char');
          var waving = char && char.classList.contains('wave');
          /* arms: gentle natural sway (not flailing) */
          if (armR && !waving) armR.setAttribute('transform', 'rotate(' + (Math.sin(t * 1.8) * 6).toFixed(1) + ' 42 46)');
          if (armL) armL.setAttribute('transform', 'rotate(' + (Math.sin(t * 1.8 + Math.PI) * 6).toFixed(1) + ' 22 46)');
          /* legs: bounce */
          if (legs) legs.setAttribute('transform', 'translate(0 ' + (Math.sin(t * 3.5) * -3).toFixed(1) + ')');
          /* head: look side to side + bob */
          if (head) head.setAttribute('transform', 'rotate(' + (Math.sin(t * 1.1) * 7).toFixed(1) + ' 32 40) translate(0 ' + (Math.sin(t * 2.8) * 1.5).toFixed(1) + ')');
          /* NO whole-svg transform — it clips and distorts */
        }
      } catch (e) {}
      requestAnimationFrame(tick);
    }
    /* start immediately, retry until parts found */
    requestAnimationFrame(tick);
  }
  /* start body animation independently — don't depend on shimeji init */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(startBodyAnimation, 2000); });
  } else {
    setTimeout(startBodyAnimation, 2000);
  }

  function positionShimeji() {
    if (!els.wrap) return;
    els.wrap.style.left = shimeji.x + 'px';
    els.wrap.style.right = 'auto';
    els.wrap.style.top = shimeji.y + 'px';
    els.wrap.style.bottom = 'auto';
    /* playful but polite: fade slightly when over the bottom tab bar */
    var tabbar = document.getElementById('tabbar');
    if (tabbar) {
      var tb = tabbar.getBoundingClientRect();
      var mr = els.wrap.getBoundingClientRect();
      var overlap = !(mr.bottom < tb.top || mr.top > tb.bottom || mr.right < tb.left || mr.left > tb.right);
      /* keep him visible — just nudge, don't fade */
      if (overlap && !shimeji.dragging) {
        shimeji.y = Math.max(60, tb.top - 90 - window.scrollY);
        els.wrap.style.top = shimeji.y + 'px';
      }
    }
  }

  function flipShimeji() {
    if (!els.char) return;
    els.char.style.transform = shimeji.dir === 1 ? '' : 'scaleX(-1)';
  }

  function shimejiPhysics() {
    if (!els.wrap || shimeji.dragging || reducedMotion) return;
    if (shimeji.state === 'falling') {
      /* gravity */
      shimeji.vy -= 1.2;
      shimeji.y += shimeji.vy;
      if (shimeji.y <= shimeji.groundY) {
        shimeji.y = shimeji.groundY;
        shimeji.vy = 0;
        shimeji.state = 'idle';
        if (els.char) els.char.classList.remove('falling');
        /* little bounce landing */
        if (els.char && !reducedMotion) {
          els.char.classList.add('excited');
          setTimeout(function () { if (els.char) els.char.classList.remove('excited'); }, 600);
        }
      }
      positionShimeji();
    } else if (shimeji.state === 'climbing') {
      /* climb down the wall */
      shimeji.y -= 3;
      if (shimeji.y <= shimeji.groundY) {
        shimeji.y = shimeji.groundY;
        shimeji.state = 'idle';
        if (els.char) els.char.classList.remove('climbing');
      }
      positionShimeji();
    } else if (shimeji.state === 'walking') {
      /* v2.14.0: stationary — never move on his own; snap back to idle */
      shimeji.state = 'idle';
      if (els.char) els.char.classList.remove('walk-anim');
      /* walk in facing direction */
      shimeji.x += 2 * shimeji.dir;
      if (shimeji.x <= 0) { shimeji.x = 0; shimeji.dir = 1; flipShimeji(); }
      if (shimeji.x >= window.innerWidth - 80) { shimeji.x = window.innerWidth - 80; shimeji.dir = -1; flipShimeji(); }
      positionShimeji();
    }
  }

  function shimejiBehave() {
    if (!els.wrap || !els.wrap.classList.contains('visible') || reducedMotion) {
      setTimeout(shimejiBehave, 5000);
      return;
    }
    /* don't interrupt important states */
    if (shimeji.dragging || shimeji.state === 'falling' || shimeji.state === 'climbing' ||
        els.wrap.classList.contains('walking')) {
      setTimeout(shimejiBehave, 6000);
      return;
    }
    var roll = Math.random();
    /* v2.14.0: Vaulty is stationary — walk and peek-a-boo move him, so skip both.
       Nap, jump, spin, wave all happen in place and are fine. */
    if (roll < 0.35) {
      /* v2.14.0: walk + peek-a-boo disabled (stationary) — chill instead */
    } else if (roll < 0.45) {
      /* take a nap */
      shimeji.state = 'sleeping';
      if (els.char) els.char.classList.add('sleeping');
      var zzz = document.createElement('span');
      zzz.className = 'tv-mentor-zzz';
      zzz.textContent = '💤';
      els.wrap.appendChild(zzz);
      /* nap for 8-15 seconds */
      setTimeout(function () {
        shimeji.state = 'idle';
        if (els.char) els.char.classList.remove('sleeping');
        var z = els.wrap.querySelector('.tv-mentor-zzz');
        if (z) z.remove();
      }, 8000 + Math.random() * 7000);
    } else if (roll < 0.55) {
      /* jump */
      if (els.char) {
        els.char.classList.add('excited');
        setTimeout(function () { if (els.char) els.char.classList.remove('excited'); }, 1000);
      }
    } else if (roll < 0.65) {
      /* spin */
      if (els.char) {
        els.char.classList.add('spin');
        setTimeout(function () { if (els.char) els.char.classList.remove('spin'); }, 1000);
      }
    } else if (roll < 0.75) {
      /* wave */
      wave();
    }
    /* else: chill */
    setTimeout(shimejiBehave, 5000 + Math.random() * 8000);
  }

  window.TV = window.TV || {};
  /* v2.12.26: expose reset for debugging — rebuilds Vaulty from scratch */
  window.TV.mentor = {
    /* v2.15.0: say/pointAt removed with the speech bubble. No-op stubs kept
       so any stale caller doesn't throw. */
    say: function () {}, pointAt: function () {}, hide: hide, init: init, take: vaultyTake, name: VAULTY,
    reset: function () {
      try {
        var old = document.getElementById('tv-mentor');
        if (old && old.parentNode) old.parentNode.removeChild(old);
      } catch (e) {}
      els.wrap = null; els.char = null;
      els.facebtn = null;
      bodyAnimStarted = false;
      try { init(); } catch (e) {}
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      try { init(); } catch (e) {
        /* retry once after a delay — DOM might not be ready */
        setTimeout(function () { try { init(); } catch (e2) {} }, 2000);
      }
    });
  } else {
    try { init(); } catch (e) {
      setTimeout(function () { try { init(); } catch (e2) {} }, 2000);
    }
  }
})();
