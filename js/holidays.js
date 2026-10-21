/* The Foundry — Holiday theming. Detects the current date, applies a
   data-holiday attribute to <body>, shows a badge, and spawns lightweight
   CSS particle decorations. Dark theme stays; only accents change.
   API: window.TV.holiday = { id, name, emoji } | null
        window.TV.getHolidayCostume(variant) -> SVG string for the mentor */
(function () {
  'use strict';

  /* month is 1-12 */
  var HOLIDAYS = [
    { id: 'halloween',    name: 'Halloween',    emoji: '🎃', from: [10, 1],  to: [10, 31] },
    { id: 'christmas',    name: 'Christmas',    emoji: '🎄', from: [12, 1],  to: [12, 26] },
    { id: 'newyear',      name: 'New Year',     emoji: '🎆', from: [12, 27], to: [1, 2]   },
    { id: 'valentine',    name: "Valentine's",  emoji: '💘', from: [2, 7],   to: [2, 14]  },
    { id: 'stpatrick',    name: "St. Patrick's",emoji: '🍀', from: [3, 10],  to: [3, 17]  },
    { id: 'july4',        name: '4th of July',  emoji: '🎇', from: [7, 1],   to: [7, 7]   },
    { id: 'thanksgiving', name: 'Thanksgiving', emoji: '🦃', from: [11, 20], to: [11, 30] }
  ];

  /* particle emoji per holiday */
  var PARTICLES = {
    halloween:    ['🎃', '🦇', '👻', '🕷️'],
    christmas:    ['❄️', '✨', '🔔'],
    newyear:      ['🎆', '✨', '🥂'],
    valentine:    ['💕', '💖', '❤️'],
    stpatrick:    ['🍀', '🌈', '✨'],
    july4:        ['🎇', '✨', '⭐'],
    thanksgiving: ['🍂', '🍁', '🌾']
  };

  function detect() {
    var now = new Date();
    var m = now.getMonth() + 1, d = now.getDate();
    for (var i = 0; i < HOLIDAYS.length; i++) {
      var h = HOLIDAYS[i];
      var fm = h.from[0], fd = h.from[1], tm = h.to[0], td = h.to[1];
      var inRange;
      if (fm === tm) {
        inRange = (m === fm && d >= fd && d <= td);
      } else {
        /* wraps the year boundary (newyear) */
        inRange = (m === fm && d >= fd) || (m === tm && d <= td);
      }
      if (inRange) return h;
    }
    return null;
  }

  function spawnParticles(id) {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var emojis = PARTICLES[id];
    if (!emojis) return;
    var layer = document.createElement('div');
    layer.id = 'tv-holiday-particles';
    layer.setAttribute('aria-hidden', 'true');
    var n = 14;
    for (var i = 0; i < n; i++) {
      var p = document.createElement('span');
      p.className = 'tv-particle';
      p.textContent = emojis[i % emojis.length];
      /* randomize: left position, fall duration, delay, size, sway */
      p.style.left = (Math.random() * 100) + 'vw';
      p.style.animationDuration = (7 + Math.random() * 8) + 's';
      p.style.animationDelay = (-Math.random() * 15) + 's';
      p.style.fontSize = (14 + Math.random() * 18) + 'px';
      p.style.setProperty('--sway', (Math.random() * 60 - 30) + 'px');
      layer.appendChild(p);
    }
    document.body.appendChild(layer);
  }

  function showBadge(h) {
    var b = document.createElement('div');
    b.id = 'tv-holiday-badge';
    b.innerHTML = '<span>' + h.emoji + '</span> ' + h.name + ' mode';
    document.body.appendChild(b);
  }

  /* ---------- mentor costumes: SVG overlays for the character's head ----------
     variant: 'idle' (60x72 viewBox, head cx=30 cy=20) or 'point' (72x72, cx=28 cy=22) */
  var COSTUMES = {
    halloween: {
      idle:
        /* witch hat: brim + cone */
        '<ellipse cx="30" cy="10" rx="15" ry="3.5" fill="#1a0f2e" stroke="#b366ff" stroke-width="1.2"/>' +
        '<path d="M30 -14 L20 9 L40 9 Z" fill="#1a0f2e" stroke="#b366ff" stroke-width="1.2"/>' +
        '<path d="M30 -14 q3 5 -2 9" fill="none" stroke="#b366ff" stroke-width="1.5"/>' +
        '<rect x="22" y="4" width="16" height="3.5" fill="#ff8c1a"/>' +
        '<rect x="27" y="4" width="6" height="3.5" fill="#ffd54a"/>',
      point:
        '<ellipse cx="28" cy="12" rx="15" ry="3.5" fill="#1a0f2e" stroke="#b366ff" stroke-width="1.2"/>' +
        '<path d="M28 -12 L18 11 L38 11 Z" fill="#1a0f2e" stroke="#b366ff" stroke-width="1.2"/>' +
        '<path d="M28 -12 q3 5 -2 9" fill="none" stroke="#b366ff" stroke-width="1.5"/>' +
        '<rect x="20" y="6" width="16" height="3.5" fill="#ff8c1a"/>' +
        '<rect x="25" y="6" width="6" height="3.5" fill="#ffd54a"/>'
    },
    christmas: {
      idle:
        /* santa hat: white brim + red floppy cone + pom */
        '<path d="M16 10 Q30 -6 46 4 Q40 2 38 8 Q30 2 16 10 Z" fill="#d42426" stroke="#a01a1c" stroke-width="1"/>' +
        '<ellipse cx="30" cy="9" rx="15" ry="4" fill="#f5f5f5" stroke="#ccc" stroke-width="1"/>' +
        '<circle cx="46" cy="4" r="4.5" fill="#f5f5f5" stroke="#ccc" stroke-width="1"/>' +
        '<circle cx="22" cy="7" r="1.6" fill="#fff" opacity="0.8"/><circle cx="36" cy="5" r="1.2" fill="#fff" opacity="0.8"/>',
      point:
        '<path d="M14 12 Q28 -4 44 6 Q38 4 36 10 Q28 4 14 12 Z" fill="#d42426" stroke="#a01a1c" stroke-width="1"/>' +
        '<ellipse cx="28" cy="11" rx="15" ry="4" fill="#f5f5f5" stroke="#ccc" stroke-width="1"/>' +
        '<circle cx="44" cy="6" r="4.5" fill="#f5f5f5" stroke="#ccc" stroke-width="1"/>'
    },
    newyear: {
      idle:
        /* striped party hat + pom + string */
        '<path d="M30 -16 L21 8 L39 8 Z" fill="#ffd54a" stroke="#c9930a" stroke-width="1"/>' +
        '<path d="M27.5 -6 L32.5 -6 M25.5 0 L34.5 0" stroke="#c9930a" stroke-width="1.6"/>' +
        '<circle cx="30" cy="-17" r="3.6" fill="#ff5f8f" stroke="#d13a6b" stroke-width="1"/>' +
        '<path d="M21 8 q9 3 18 0" fill="none" stroke="#00e5ff" stroke-width="1.4"/>',
      point:
        '<path d="M28 -14 L19 10 L37 10 Z" fill="#ffd54a" stroke="#c9930a" stroke-width="1"/>' +
        '<path d="M25.5 -4 L30.5 -4 M23.5 2 L32.5 2" stroke="#c9930a" stroke-width="1.6"/>' +
        '<circle cx="28" cy="-15" r="3.6" fill="#ff5f8f" stroke="#d13a6b" stroke-width="1"/>'
    },
    valentine: {
      idle:
        /* heart antenna: spring + heart */
        '<path d="M30 8 q0 -8 6 -10" fill="none" stroke="#ff5f8f" stroke-width="1.8"/>' +
        '<path d="M36 -2 c-2.4 -3.4 -7.4 -1.4 -6 2 c0.8 2 3.6 3.4 6 4.6 c2.4 -1.2 5.2 -2.6 6 -4.6 c1.4 -3.4 -3.6 -5.4 -6 -2 Z" fill="#ff5f8f" stroke="#d13a6b" stroke-width="1"/>' +
        '<circle cx="18" cy="2" r="2.2" fill="#ff5f8f" opacity="0.7"/><circle cx="42" cy="4" r="1.6" fill="#ff8fab" opacity="0.7"/>',
      point:
        '<path d="M28 10 q0 -8 6 -10" fill="none" stroke="#ff5f8f" stroke-width="1.8"/>' +
        '<path d="M34 0 c-2.4 -3.4 -7.4 -1.4 -6 2 c0.8 2 3.6 3.4 6 4.6 c2.4 -1.2 5.2 -2.6 6 -4.6 c1.4 -3.4 -3.6 -5.4 -6 -2 Z" fill="#ff5f8f" stroke="#d13a6b" stroke-width="1"/>'
    },
    stpatrick: {
      idle:
        /* leprechaun top hat */
        '<rect x="20" y="-12" width="20" height="20" rx="2" fill="#1e7a34" stroke="#145c26" stroke-width="1.2"/>' +
        '<ellipse cx="30" cy="9" rx="16" ry="3.5" fill="#1e7a34" stroke="#145c26" stroke-width="1.2"/>' +
        '<rect x="20" y="2" width="20" height="4.5" fill="#111"/>' +
        '<rect x="27" y="2" width="6" height="4.5" fill="#ffd54a"/>' +
        '<text x="30" y="-2" text-anchor="middle" font-size="8">🍀</text>',
      point:
        '<rect x="18" y="-10" width="20" height="20" rx="2" fill="#1e7a34" stroke="#145c26" stroke-width="1.2"/>' +
        '<ellipse cx="28" cy="11" rx="16" ry="3.5" fill="#1e7a34" stroke="#145c26" stroke-width="1.2"/>' +
        '<rect x="18" y="4" width="20" height="4.5" fill="#111"/>' +
        '<rect x="25" y="4" width="6" height="4.5" fill="#ffd54a"/>' +
        '<text x="28" y="0" text-anchor="middle" font-size="8">🍀</text>'
    },
    july4: {
      idle:
        /* star glasses over the visor */
        '<g stroke="#ffd54a" stroke-width="1.2" fill="#ff3b3b">' +
        '<path d="M25 15 l1.8 3.6 4 .6 -2.9 2.8 .7 4 -3.6 -1.9 -3.6 1.9 .7 -4 -2.9 -2.8 4 -.6 Z"/>' +
        '<path d="M35 15 l1.8 3.6 4 .6 -2.9 2.8 .7 4 -3.6 -1.9 -3.6 1.9 .7 -4 -2.9 -2.8 4 -.6 Z"/>' +
        '</g>' +
        '<path d="M29 19 L31 19" stroke="#ffd54a" stroke-width="1.5"/>' +
        '<circle cx="30" cy="-4" r="2" fill="#00e5ff" opacity="0.0"/>',
      point:
        '<g stroke="#ffd54a" stroke-width="1.2" fill="#ff3b3b">' +
        '<path d="M23 17 l1.8 3.6 4 .6 -2.9 2.8 .7 4 -3.6 -1.9 -3.6 1.9 .7 -4 -2.9 -2.8 4 -.6 Z"/>' +
        '<path d="M33 17 l1.8 3.6 4 .6 -2.9 2.8 .7 4 -3.6 -1.9 -3.6 1.9 .7 -4 -2.9 -2.8 4 -.6 Z"/>' +
        '</g>' +
        '<path d="M27 21 L29 21" stroke="#ffd54a" stroke-width="1.5"/>'
    },
    thanksgiving: {
      idle:
        /* pilgrim hat */
        '<rect x="21" y="-14" width="18" height="22" rx="2" fill="#2b2b33" stroke="#111" stroke-width="1.2"/>' +
        '<ellipse cx="30" cy="9" rx="16" ry="3.5" fill="#2b2b33" stroke="#111" stroke-width="1.2"/>' +
        '<rect x="21" y="1" width="18" height="4" fill="#8a5a2b"/>' +
        '<rect x="27.5" y="0.5" width="5" height="5" fill="none" stroke="#ffd54a" stroke-width="1.4"/>' +
        '<text x="44" y="14" font-size="9">🦃</text>',
      point:
        '<rect x="19" y="-12" width="18" height="22" rx="2" fill="#2b2b33" stroke="#111" stroke-width="1.2"/>' +
        '<ellipse cx="28" cy="11" rx="16" ry="3.5" fill="#2b2b33" stroke="#111" stroke-width="1.2"/>' +
        '<rect x="19" y="3" width="18" height="4" fill="#8a5a2b"/>' +
        '<rect x="25.5" y="2.5" width="5" height="5" fill="none" stroke="#ffd54a" stroke-width="1.4"/>' +
        '<text x="42" y="16" font-size="9">🦃</text>'
    }
  };

  function getHolidayCostume(variant) {
    var h = window.TV && window.TV.holiday;
    if (!h || !COSTUMES[h.id]) return '';
    var c = COSTUMES[h.id];
    return c[variant] || c.idle || '';
  }

  /* ---------- init ---------- */
  function init() {
    var h = detect();
    window.TV = window.TV || {};
    window.TV.holiday = h;
    window.TV.getHolidayCostume = getHolidayCostume;
    if (!h) return;
    document.body.setAttribute('data-holiday', h.id);
    function ready() {
      spawnParticles(h.id);
      showBadge(h);
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', ready);
    } else {
      ready();
    }
  }

  /* test hook: TV._testHoliday(10, 31) returns the holiday object or null */
  window.TV = window.TV || {};
  window.TV._testHoliday = function (m, d) {
    var realGetMonth = Date.prototype.getMonth;
    var realGetDate = Date.prototype.getDate;
    Date.prototype.getMonth = function () { return m - 1; };
    Date.prototype.getDate = function () { return d; };
    var result;
    try { result = detect(); } finally {
      Date.prototype.getMonth = realGetMonth;
      Date.prototype.getDate = realGetDate;
    }
    return result;
  };

  init();
})();
