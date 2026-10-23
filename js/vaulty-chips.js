/* The Foundry — follow-up chips (v2.23.0).
   After a REAL answer (Workshop dossier / build card, recommendation,
   researched prose), Vaulty offers 2–3 contextual next questions as
   tappable chips — generated from the answer itself: its item, its
   kind. Tapping a chip sends that question through the panel's own
   ask(). NEVER on a don't-know: a miss gets research, not suggestions. */
(function () {
  'use strict';

  function esc(s) {
    if (window.TV && window.TV.esc) return window.TV.esc(s);
    return String(s == null ? '' : s).replace(/[&<>""]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function isMissHtml(html) {
    var s = String(html || '');
    return s.indexOf('Straight up: I don\'t know that one') !== -1 ||
      s.indexOf('isn\'t in the Vault\'s data') !== -1 ||
      s.indexOf('vres-progress') !== -1 || s.indexOf('vws-progress') !== -1;
  }
  function cardItem(html) {
    var m = String(html || '').match(/vbc-title">([^<]+)/);
    if (!m) return '';
    var t = m[1].replace(/&amp;/g, '&').trim();
    /* dossier titles read "Octavia Prime — Room Melter": keep the item */
    var parts = t.split(/\s+[—–-]\s+/);
    return (parts[0] || t).trim();
  }
  function recoTop(html) {
    var m = String(html || '').match(/data-top="([^"]+)"/);
    return m ? m[1].replace(/&quot;/g, '"') : '';
  }

  /* returns [{label, q}] — empty when no chips belong on this answer */
  function forAnswer(q, html) {
    var s = String(html || '');
    if (!s || isMissHtml(s)) return [];
    var chips = [];
    if (s.indexOf('vai-reco') !== -1) {
      var top = recoTop(s);
      if (top) chips.push({ label: '🛠 Build for ' + top + '?', q: top + ' build' });
      chips.push({ label: '🎯 Steel Path pick?', q: 'what is a good warframe for steel path' });
      chips.push({ label: '🌱 Beginner pick?', q: 'what is a good beginner warframe' });
      return chips.slice(0, 3);
    }
    if (s.indexOf('vbc-grid') !== -1 || s.indexOf('vai-dossier') !== -1 || s.indexOf('vai-check') !== -1) {
      var item = cardItem(s);
      if (item) {
        chips.push({ label: '💥 Steel Path version?', q: item + ' steel path build' });
        chips.push({ label: '💰 Budget version?', q: 'budget ' + item + ' build no primed mods' });
        chips.push({ label: '📍 Where do I farm it?', q: 'where do I farm ' + item });
      }
      return chips.slice(0, 3);
    }
    if (s.indexOf('Researched just now') !== -1) {
      var subj = '';
      try { if (window.TVResearch && TVResearch.subjectOf) subj = TVResearch.subjectOf(q); } catch (e) {}
      if (subj && subj.length >= 3 && subj.length <= 40) {
        chips.push({ label: '🔎 Tell me more', q: 'tell me more about ' + subj });
        chips.push({ label: '📍 Where do I get it?', q: 'where do I farm ' + subj });
      }
      return chips.slice(0, 3);
    }
    return [];
  }

  function attach(el, q, html, sendFn) {
    try {
      if (!el || typeof sendFn !== 'function') return;
      if (el.querySelector && el.querySelector('.vai-followups')) return;
      var chips = forAnswer(q, html);
      if (!chips.length) return;
      var row = document.createElement('div');
      row.className = 'vai-followups';
      chips.forEach(function (c) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'vai-chip vai-followup-chip';
        b.textContent = c.label;
        b.setAttribute('data-q', c.q);
        b.addEventListener('click', function () { sendFn(c.q); });
        row.appendChild(b);
      });
      el.appendChild(row);
    } catch (e) {}
  }

  window.TVChips = { forAnswer: forAnswer, attach: attach, _isMissHtml: isMissHtml };
})();
