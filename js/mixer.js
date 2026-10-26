/* The Foundry — Mod Mixer (v2.24.0).
   Pick a warframe or weapon, slot mods yourself, and see a build that is
   honest about what it knows:
   - Every mod comes from the Vault's real 1,756-mod list. Nothing invented.
   - Capacity uses LIVE drain data (warframestat.us, baseDrain +
     fusionLimit — the same source the Workshop's capacity check uses).
     A drain that can't be fetched is flagged unknown, never guessed.
   - Slot polarities are yours to set: a matching polarity halves the
     drain (rounded up). A Universal-polarity mod counts as matching any
     slot. Aura/Stance capacity bonus doubles on a polarity match.
   - Elements come from the slotted mods in slot order, paired the way
     the game pairs them (first two distinct elements combine, a third
     stays single unless a fourth pairs with it). Only the element NAMES
     are used — never the numbers in the Vault's mod lines, which are
     not max-rank values (its Serration line says +40%, the real max is
     +165%), so modded stat totals are deliberately NOT shown in v1.
   Pure logic lives on window.FoundryMixer (and module.exports under
   node) so it can be unit-tested without a browser. */
(function () {
  'use strict';

  var MX = {};

  function norm(s) { return String(s == null ? '' : s).toLowerCase().trim(); }
  MX.norm = norm;

  /* ---------- polarities ---------- */
  MX.POLARITIES = ['none', 'madurai', 'vazarin', 'naramon', 'zenurik', 'unairu', 'penjaga', 'umbra'];
  MX.nextPolarity = function (p) {
    var i = MX.POLARITIES.indexOf(p);
    return MX.POLARITIES[(i < 0 ? 0 : i + 1) % MX.POLARITIES.length];
  };
  MX.polLabel = function (p) { return p === 'none' ? 'no polarity' : p; };

  /* Drain for one slotted mod. drain null = unknown (never guessed). */
  MX.slotDrain = function (drain, slotPol, modPol) {
    if (drain == null) return null;
    var mp = norm(modPol);
    if (mp === 'universal') return Math.ceil(drain / 2);
    if (slotPol && slotPol !== 'none' && slotPol === mp) return Math.ceil(drain / 2);
    return drain;
  };

  /* ---------- elements ---------- */
  MX.PAIR = {
    'Cold+Heat': 'Blast',
    'Cold+Electricity': 'Magnetic',
    'Cold+Toxin': 'Viral',
    'Electricity+Heat': 'Radiation',
    'Electricity+Toxin': 'Corrosive',
    'Heat+Toxin': 'Gas'
  };
  MX.COMBINED_NAMES = ['Blast', 'Corrosive', 'Gas', 'Magnetic', 'Radiation', 'Viral'];
  MX.BASE_ELEMENTS = ['Heat', 'Cold', 'Electricity', 'Toxin'];

  /* Element identity only: a "+N% <Element>" clause in the effect text.
     Prose mentions ("this ability deals Heat damage") are NOT counted —
     the percentage must sit right against the element name. */
  MX.elementOfMod = function (mod) {
    var eff = mod && mod.effect ? String(mod.effect) : '';
    var m = eff.match(/(\d+)%\s*(Heat|Cold|Electricity|Toxin|Blast|Corrosive|Gas|Magnetic|Radiation|Viral)/);
    return m ? m[2] : null;
  };

  /* Pair slotted elemental mods in slot order, the way the game does.
     Input: [{name, element}] (element null for non-elemental mods, which
     never interrupt pairing). Output: [{element, mods: [names]}]. */
  MX.combineElements = function (modsInOrder) {
    var groups = [], pending = -1;
    modsInOrder.forEach(function (mm) {
      if (!mm.element) return;
      var el = mm.element;
      if (MX.COMBINED_NAMES.indexOf(el) >= 0) { groups.push({ element: el, mods: [mm.name] }); return; }
      if (pending >= 0 && groups[pending].element === el) { groups[pending].mods.push(mm.name); return; }
      if (pending >= 0) {
        var other = groups[pending].element;
        var combo = MX.PAIR[[other, el].sort().join('+')];
        groups[pending] = { element: combo, mods: groups[pending].mods.concat([mm.name]) };
        pending = -1;
        return;
      }
      groups.push({ element: el, mods: [mm.name] });
      pending = groups.length - 1;
    });
    return groups;
  };

  /* ---------- item families ---------- */
  MX.familyFor = function (item) {
    if (!item) return null;
    if (item.kind === 'warframe') return { kind: 'warframe', modType: 'Warframe Mod', aura: true, stance: false };
    if (item.type === 'Melee') return { kind: 'weapon', modType: 'Melee Mod', aura: false, stance: true };
    if (item.category === 'Shotgun') return { kind: 'weapon', modType: 'Shotgun Mod', aura: false, stance: false };
    if (item.type === 'Primary') return { kind: 'weapon', modType: 'Primary Mod', aura: false, stance: false };
    if (item.type === 'Secondary') return { kind: 'weapon', modType: 'Secondary Mod', aura: false, stance: false };
    if (item.type === 'Archgun') return { kind: 'weapon', modType: 'Arch-Gun Mod', aura: false, stance: false };
    if (item.type === 'Archmelee') return { kind: 'weapon', modType: 'Arch-Melee Mod', aura: false, stance: false };
    return null;
  };
  MX.isRiven = function (mod) { return /riven/i.test(mod.type || '') || /riven/i.test(mod.name || ''); };

  /* Mods offered for the 8 regular slots. Weapons take any compat in the
     family (the Vault records no weapon subclass, so the compat tag is
     shown and a compat filter is offered) — frames take generic mods
     plus augments for exactly this frame, never another frame's. */
  MX.modFitsPicker = function (mod, item, family) {
    if (!mod || MX.isRiven(mod)) return false;
    if (mod.type !== family.modType) return false;
    if (family.kind === 'warframe') {
      var c = mod.compat || '';
      return c === 'WARFRAME' || c === item.name;
    }
    return true;
  };
  MX.auraFits = function (mod) { return !MX.isRiven(mod) && mod.compat === 'AURA'; };
  MX.stanceFits = function (mod) { return !MX.isRiven(mod) && mod.type === 'Stance Mod'; };

  /* ---------- capacity ---------- */
  /* slots: [{mod, pol}], extra: {mod, pol, kind} | null (aura/stance).
     drains: {normName: maxDrain}. potato: rank-30 capacity 60 vs 30.
     Returns capacity null + over null whenever any needed drain is
     unknown — the check is incomplete, not wrong. */
  MX.capacityCalc = function (slots, extra, drains, potato) {
    var base = potato ? 60 : 30, used = 0, full = 0, unknown = [], bonus = 0, bonusUnknown = false;
    slots.forEach(function (s) {
      if (!s.mod) return;
      var d = drains[norm(s.mod.name)];
      if (d == null) { unknown.push(s.mod.name); return; }
      used += MX.slotDrain(d, s.pol, s.mod.polarity);
      full += d;
    });
    var capacity = base;
    if (extra && extra.mod) {
      var ed = drains[norm(extra.mod.name)];
      if (ed == null) { bonusUnknown = true; unknown.push(extra.mod.name); }
      else {
        var mp = norm(extra.mod.polarity);
        bonus = (extra.pol && extra.pol !== 'none' && (extra.pol === mp || mp === 'universal')) ? ed * 2 : ed;
        capacity += bonus;
      }
    }
    /* Any unknown drain makes the whole verdict incomplete — a partial
       "fits" would be a wrong answer, so capacity/over go null and the
       UI shows "used + ?" with the unknown names instead. */
    var incomplete = unknown.length > 0;
    return {
      base: base, bonus: bonus, bonusUnknown: bonusUnknown,
      capacity: incomplete ? null : capacity,
      used: used, fullCost: full, unknown: unknown,
      over: incomplete ? null : (used > capacity)
    };
  };

  /* ---------- copy text ---------- */
  MX.copyText = function (item, slots, extra, cap) {
    var lines = [item.name + ' — Mod Mixer build'];
    if (extra && extra.mod) lines.push((extra.kind === 'aura' ? 'Aura' : 'Stance') + ': ' + extra.mod.name);
    slots.forEach(function (s, i) { lines.push((i + 1) + '. ' + (s.mod ? s.mod.name : '(empty)')); });
    if (cap && cap.capacity != null) lines.push('Capacity: ' + cap.used + '/' + cap.capacity + (cap.over ? ' (OVER CAPACITY)' : ''));
    return lines.join('\n');
  };

  /* ================= browser wiring ================= */
  if (typeof module !== 'undefined' && module.exports) { module.exports = MX; }
  if (typeof window !== 'undefined') { window.FoundryMixer = MX; }
  if (typeof document === 'undefined' || typeof window === 'undefined' || !window.TV) return;

  var esc = window.TV.esc;
  var allMods = [], allItems = [];
  var state = {
    item: null, family: null,
    slots: [], extra: null, potato: true,
    drains: {}, drainLoading: {},
    pickerTarget: null, pickerQuery: '', pickerCompat: 'any'
  };
  for (var si = 0; si < 8; si++) state.slots.push({ mod: null, pol: 'none' });

  function $(id) { return document.getElementById(id); }

  function baseStatsLine(item) {
    if (item.kind === 'warframe') {
      return 'HP ' + item.health + ' · Shield ' + item.shield + ' · Armor ' + item.armor +
        ' · Energy ' + item.energy + (item.sprint ? ' · Sprint ' + item.sprint : '');
    }
    var s = 'DMG ' + item.totalDamage + ' · Crit ' + item.criticalChance + '% ×' + item.criticalMultiplier +
      ' · Status ' + item.statusChance + '% · Fire rate ' + item.fireRate;
    if (item.magazine) s += ' · Mag ' + item.magazine;
    if (item.reload) s += ' · Reload ' + item.reload + 's';
    if (item.multishot && item.multishot !== 1) s += ' · Multishot ' + item.multishot;
    return s;
  }

  function familyChip(item) {
    if (item.kind === 'warframe') return 'Warframe';
    if (item.category === 'Shotgun') return 'Shotgun';
    return item.type || 'Weapon';
  }

  /* ---------- item picker ---------- */
  var itemFam = 'all', itemQuery = '';
  function renderItems() {
    var q = norm(itemQuery);
    var list = allItems.filter(function (it) {
      if (itemFam === 'warframe' && it.kind !== 'warframe') return false;
      if (itemFam === 'primary' && !(it.kind === 'weapon' && it.type === 'Primary' && it.category !== 'Shotgun')) return false;
      if (itemFam === 'shotgun' && !(it.kind === 'weapon' && it.category === 'Shotgun')) return false;
      if (itemFam === 'secondary' && !(it.kind === 'weapon' && it.type === 'Secondary')) return false;
      if (itemFam === 'melee' && !(it.kind === 'weapon' && it.type === 'Melee')) return false;
      if (q && norm(it.name).indexOf(q) === -1) return false;
      return true;
    });
    var capped = list.slice(0, 120);
    $('mix-count').textContent = list.length + ' items' + (list.length > capped.length ? ' — showing first ' + capped.length + ', refine your search' : '');
    $('mix-items').innerHTML = capped.map(function (it) {
      var sel = state.item && state.item.name === it.name ? ' style="border-color:#f5c518;"' : '';
      return '<a href="#" class="list-item" data-item="' + esc(it.name) + '"' + sel + '>' +
        '<div><h3>' + esc(it.name) + ' <span class="badge type">' + esc(familyChip(it)) + '</span></h3>' +
        '<p class="muted small">' + esc(baseStatsLine(it)) + '</p></div></a>';
    }).join('') || '<p class="muted">Nothing matches — try another search.</p>';
    Array.prototype.forEach.call($('mix-items').querySelectorAll('[data-item]'), function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        var it = allItems.filter(function (x) { return x.name === a.getAttribute('data-item'); })[0];
        if (it) selectItem(it);
      });
    });
  }

  function selectItem(it) {
    state.item = it;
    state.family = MX.familyFor(it);
    state.slots.forEach(function (s) { s.mod = null; s.pol = 'none'; });
    state.extra = state.family && (state.family.aura || state.family.stance)
      ? { mod: null, pol: 'none', kind: state.family.aura ? 'aura' : 'stance' } : null;
    state.pickerTarget = null;
    renderAll();
    $('mix-builder').scrollIntoView();
  }

  /* ---------- drains (live) ---------- */
  function ensureDrain(mod) {
    var key = norm(mod.name);
    if (state.drains[key] !== undefined || state.drainLoading[key]) return;
    state.drainLoading[key] = true;
    window.TV.getJSON('https://api.warframestat.us/items/search/' + encodeURIComponent(mod.name) + '?language=en')
      .then(function (arr) {
        var d = null;
        if (arr) for (var i = 0; i < arr.length; i++) {
          var it = arr[i];
          if (it && norm(it.name) === key && it.baseDrain != null && it.fusionLimit != null) { d = it.baseDrain + it.fusionLimit; break; }
        }
        state.drains[key] = d;
      })
      .catch(function () { state.drains[key] = null; })
      .then(function () { state.drainLoading[key] = false; renderCapacity(); renderSlots(); });
  }
  function retryDrains() {
    Object.keys(state.drains).forEach(function (k) { if (state.drains[k] == null) delete state.drains[k]; });
    var mods = [];
    state.slots.forEach(function (s) { if (s.mod) mods.push(s.mod); });
    if (state.extra && state.extra.mod) mods.push(state.extra.mod);
    mods.forEach(ensureDrain);
    renderCapacity(); renderSlots();
  }

  /* ---------- capacity + elements ---------- */
  function capNow() { return MX.capacityCalc(state.slots, state.extra, state.drains, state.potato); }

  function renderCapacity() {
    var cap = capNow(), box = $('mix-cap');
    var usedTxt = cap.used + (cap.unknown.length ? ' + ?' : '');
    var html = '<h3>Capacity</h3><p class="mix-capnum">' + usedTxt + ' / ' +
      (cap.capacity == null ? '?' : cap.capacity) + '</p>' +
      '<p class="muted small">Base ' + cap.base + (state.potato ? ' (potato: Orokin Reactor/Catalyst)' : ' (no potato)') +
      (cap.bonus ? ' + ' + cap.bonus + ' from ' + (state.extra.kind === 'aura' ? 'aura' : 'stance') : '') +
      ' · Full cost before polarity discounts: ' + cap.fullCost + '</p>';
    if (cap.over) html += '<p style="color:#f87171;"><b>Over capacity by ' + (cap.used - cap.capacity) + '.</b> Swap in a cheaper mod, match a polarity, or drop a slot.</p>';
    else if (cap.capacity != null) html += '<p class="muted small">Fits — ' + (cap.capacity - cap.used) + ' capacity left.</p>';
    if (cap.unknown.length) {
      html += '<p style="color:#fbbf24;">Capacity check incomplete — drain unknown for: ' +
        cap.unknown.map(esc).join(', ') + '. <button class="btn small" id="mix-retry">Retry drain check</button></p>';
    }
    box.innerHTML = html;
    var rb = $('mix-retry');
    if (rb) rb.addEventListener('click', retryDrains);
  }

  function renderElements() {
    var order = [];
    state.slots.forEach(function (s) { if (s.mod) order.push({ name: s.mod.name, element: MX.elementOfMod(s.mod) }); });
    if (state.extra && state.extra.mod) order.push({ name: state.extra.mod.name, element: MX.elementOfMod(state.extra.mod) });
    var groups = MX.combineElements(order);
    $('mix-elements').innerHTML = '<h3>Elements</h3>' + (groups.length ? groups.map(function (g) {
      return '<p><b>' + esc(g.element) + '</b> <span class="muted small">— from ' + g.mods.map(esc).join(' + ') + '</span></p>';
    }).join('') : '<p class="muted">No elemental mods slotted yet. Elemental mods combine in slot order: the first two different elements make a combined element.</p>');
  }

  /* ---------- slots ---------- */
  function drainBadge(mod) {
    if (!mod) return '';
    var d = state.drains[norm(mod.name)];
    if (d == null && state.drainLoading[norm(mod.name)]) return ' <span class="badge type">drain…</span>';
    if (d == null) return ' <span class="badge type">drain ?</span>';
    return ' <span class="badge type">' + d + ' drain</span>';
  }

  function slotCard(label, holder, isExtra) {
    var mod = holder.mod;
    var html = '<div class="mix-slot"><div class="mix-slot-head"><b>' + label + '</b> ' +
      '<button class="btn small mix-pol" data-polbtn="1">' + esc(MX.polLabel(holder.pol)) + '</button></div>';
    if (mod) {
      html += '<p><b>' + esc(mod.name) + '</b>' +
        (mod.polarity ? ' <span class="badge type">' + esc(mod.polarity) + '</span>' : '') +
        (mod.compat ? ' <span class="badge type">' + esc(mod.compat) + '</span>' : '') +
        drainBadge(mod) + '<br><span class="muted small">' + esc((mod.effect || '').slice(0, 110)) + '</span></p>';
    } else html += '<p class="muted">Empty slot</p>';
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap;"><button class="btn small mix-pick">Add / change</button>' +
      (mod ? '<button class="btn small mix-rm">Remove</button>' : '') + '</div></div>';
    var div = document.createElement('div');
    div.innerHTML = html;
    div.querySelector('[data-polbtn]').addEventListener('click', function () {
      holder.pol = MX.nextPolarity(holder.pol);
      renderSlots(); renderCapacity();
    });
    div.querySelector('.mix-pick').addEventListener('click', function () { openPicker(holder, isExtra); });
    var rm = div.querySelector('.mix-rm');
    if (rm) rm.addEventListener('click', function () { holder.mod = null; state.pickerTarget = null; renderAll(); });
    return div.firstChild;
  }

  function renderSlots() {
    var grid = $('mix-slots');
    grid.innerHTML = '';
    if (state.extra) grid.appendChild(slotCard(state.extra.kind === 'aura' ? 'Aura' : 'Stance', state.extra, true));
    state.slots.forEach(function (s, i) { grid.appendChild(slotCard('Slot ' + (i + 1), s, false)); });
  }

  function renderBuilderHead() {
    var head = $('mix-builder-head');
    if (!state.item) {
      head.innerHTML = '<p class="muted">Pick an item above to start mixing.</p>';
      return;
    }
    head.innerHTML = '<h2>' + esc(state.item.name) + ' <span class="badge type">' + esc(familyChip(state.item)) + '</span></h2>' +
      '<p class="muted small">Base stats (before mods): ' + esc(baseStatsLine(state.item)) + '</p>' +
      '<label style="display:block;margin:8px 0;"><input type="checkbox" id="mix-potato"' + (state.potato ? ' checked' : '') + '> ' +
      'Orokin Reactor / Catalyst installed (+30 capacity, max-rank item)</label>' +
      '<button class="btn small" id="mix-clear">Clear build</button> ' +
      '<button class="btn small" id="mix-copy">Copy build</button> <span id="mix-copied" class="muted small"></span>';
    $('mix-potato').addEventListener('change', function (e) { state.potato = e.target.checked; renderCapacity(); });
    $('mix-clear').addEventListener('click', function () {
      state.slots.forEach(function (s) { s.mod = null; s.pol = 'none'; });
      if (state.extra) { state.extra.mod = null; state.extra.pol = 'none'; }
      state.pickerTarget = null; renderAll();
    });
    $('mix-copy').addEventListener('click', function () {
      var text = MX.copyText(state.item, state.slots, state.extra, capNow());
      var done = function () { $('mix-copied').textContent = 'Copied — paste it anywhere as your second screen.'; };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
      else { fallbackCopy(text); done(); }
    });
  }
  function fallbackCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
    } catch (e) {}
  }

  /* ---------- mod picker ---------- */
  function pickerPool() {
    var fam = state.family;
    if (!fam) return [];
    if (state.pickerTarget === 'extra') {
      return allMods.filter(function (m) { return fam.aura ? MX.auraFits(m) : MX.stanceFits(m); });
    }
    return allMods.filter(function (m) { return MX.modFitsPicker(m, state.item, fam); });
  }

  function openPicker(holder, isExtra) {
    state.pickerTarget = isExtra ? 'extra' : holder;
    state.pickerQuery = ''; state.pickerCompat = 'any';
    renderPicker();
    $('mix-picker').scrollIntoView();
  }

  function renderPicker() {
    var box = $('mix-picker');
    if (!state.pickerTarget) { box.innerHTML = ''; return; }
    var pool = pickerPool();
    var q = norm(state.pickerQuery);
    var compats = [];
    pool.forEach(function (m) { if (m.compat && compats.indexOf(m.compat) === -1) compats.push(m.compat); });
    compats.sort();
    var list = pool.filter(function (m) {
      if (q && norm(m.name).indexOf(q) === -1) return false;
      if (state.pickerCompat !== 'any' && m.compat !== state.pickerCompat) return false;
      return true;
    }).slice(0, 120);
    var compatSel = state.family.kind === 'warframe' && state.pickerTarget !== 'extra' ? '' :
      '<label class="muted small">Compat: <select id="mix-compat"><option value="any">Any compat</option>' +
      compats.map(function (c) { return '<option value="' + esc(c) + '"' + (state.pickerCompat === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') +
      '</select></label> ';
    box.innerHTML = '<h3>Pick a mod</h3>' +
      '<div class="field"><input id="mix-pq" type="search" placeholder="Search ' + pool.length + ' mods…" value="' + esc(state.pickerQuery) + '"></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;align-items:center;">' + compatSel +
      '<button class="btn small" id="mix-pclose">Close picker</button></div>' +
      '<div id="mix-plist" class="item-list" style="margin-top:8px;">' + (list.map(function (m) {
        return '<a href="#" class="list-item" data-mod="' + esc(m.name) + '"><div><h3>' + esc(m.name) +
          (m.polarity ? ' <span class="badge type">' + esc(m.polarity) + '</span>' : '') +
          (m.compat ? ' <span class="badge type">' + esc(m.compat) + '</span>' : '') + '</h3>' +
          '<p class="muted small">' + esc((m.effect || '').slice(0, 130)) + '</p></div></a>';
      }).join('') || '<p class="muted">Nothing matches.</p>') + '</div>';
    $('mix-pq').addEventListener('input', function (e) { state.pickerQuery = e.target.value; renderPicker(); });
    var cs = $('mix-compat');
    if (cs) cs.addEventListener('change', function (e) { state.pickerCompat = e.target.value; renderPicker(); });
    $('mix-pclose').addEventListener('click', function () { state.pickerTarget = null; renderPicker(); });
    Array.prototype.forEach.call(box.querySelectorAll('[data-mod]'), function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        var m = allMods.filter(function (x) { return x.name === a.getAttribute('data-mod'); })[0];
        if (!m) return;
        var holder = state.pickerTarget === 'extra' ? state.extra : state.pickerTarget;
        holder.mod = m;
        ensureDrain(m);
        state.pickerTarget = null;
        renderAll();
      });
    });
    var pq = $('mix-pq');
    if (pq) pq.focus();
  }

  function renderAll() {
    renderBuilderHead(); renderSlots(); renderCapacity(); renderElements(); renderPicker(); renderItems();
  }

  /* ---------- boot ---------- */
  document.addEventListener('DOMContentLoaded', function () {
    if (!$('mix-items')) return;
    var famBtns = document.querySelectorAll('[data-mixfam]');
    famBtns.forEach(function (b) {
      b.addEventListener('click', function () { itemFam = b.getAttribute('data-mixfam'); renderItems(); });
    });
    $('mix-q').addEventListener('input', function (e) { itemQuery = e.target.value; renderItems(); });
    Promise.all([
      window.TV.getJSONParts('data/site/mods', 9),
      window.TV.getJSONParts('data/site/warframes', 2),
      window.TV.getJSONParts('data/site/weapons', 3)
    ]).then(function (parts) {
      allMods = parts[0];
      var frames = parts[1].map(function (w) { w.kind = 'warframe'; return w; });
      var weapons = parts[2].map(function (w) { w.kind = 'weapon'; return w; });
      allItems = frames.concat(weapons).sort(function (a, b) { return a.name < b.name ? -1 : 1; });
      renderItems();
      var params = {};
      location.search.replace(/[?&]+([^=&]+)=([^&]*)/gi, function (m, k, v) { params[decodeURIComponent(k)] = decodeURIComponent(v); });
      if (params.item) {
        var it = allItems.filter(function (x) { return norm(x.name) === norm(params.item); })[0];
        if (it) selectItem(it);
      }
    }).catch(function () {
      $('mix-items').innerHTML = '<p class="muted">Could not load the Vault data. Check your connection and reload.</p>';
    });
  });
})();
