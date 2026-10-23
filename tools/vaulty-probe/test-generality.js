/* v2.22.1 fixtures: GENERALITY PROOF SWEEP.
   The owner correction: "I don't want it to know Octavia specifically —
   I want it to be a general thing for everything." So this suite runs
   the SAME pipeline (power routing → Workshop dossier composer,
   research-first conversational synthesis, session continuity) over
   items and topics that were never test cases, with no special handling:

   G1–G5  power dossiers for non-Octavia frames — Wisp Prime, Garuda
          Prime, Revenant Prime, Saryn Prime, Hildryn Prime (Hildryn
          owns Pillage natively: the rule must NOT hand it back to her).
          Per frame: legal 8-mod card, concept title, Helminth pick
          from the verified subsume pool (donor correct, replaced
          ability is really that frame's), Archon Shards, computed
          math, rotation, follow-up offer — and ZERO Octavia bleed
          (no Octavia / Mallet / Resonator / Metronome text).
   G6     follow-up continuity on Saryn (never Octavia): a bare
          "and for steel path survival?" after the Saryn dossier must
          resolve to Saryn Prime with the context note shown.
   G7–G9  power dossiers for weapons: Acceltra Prime and Kuva Zarr
          (library builds exist — the dossier must differ from every
          one) and Desert Wind (NO library build at all).
   G10–13 conversational prose for general topics (fishing, Eidolon
          hunts, Kuva Liches, a lore who-is): prose + citations, no
          build cards, no Octavia bleed.

   Usage: node tools/vaulty-probe/test-generality.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const SITE = path.join(ROOT, 'data', 'site');
const read = (f) => JSON.parse(fs.readFileSync(path.join(SITE, f), 'utf8'));
function readParts(prefix) {
  const out = [];
  const re = new RegExp('^' + prefix + '\\d+\\.json$');
  fs.readdirSync(SITE).filter((f) => re.test(f)).sort()
    .forEach((f) => { out.push(...read(f)); });
  return out;
}

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { pass++; console.log('PASS', name); }
  else { fail++; failures.push(name); console.log('FAIL', name, extra ? ':: ' + extra : ''); }
}
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 30));
async function waitFor(fn, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await tick(40); }
  return false;
}
const norm = (s) => String(s || '').toLowerCase().trim();

/* ---------- real data, Node side ---------- */
const MODS = readParts('mods-');
const BUILDS = readParts('builds-');
const WEAPONS = readParts('weapons-');
const FRAMES = readParts('warframes-');
const ARCANES = readParts('arcanes-');
const SHARDS = read('shards.json');
const shardNames = new Set((Array.isArray(SHARDS) ? SHARDS : (SHARDS.shards || []))
  .map((s) => norm(s.name || s.color || '')));
const modByName = new Map(MODS.map((m) => [norm(m.name), m]));
const auraNames = new Set(MODS.filter((m) => m.aura || norm(m.compat) === 'aura').map((m) => norm(m.name)));
const arcaneNames = new Set(ARCANES.map((a) => norm(a.name)));
const TYPE_CLASS = {
  'Primary Mod': 'primary', 'Rifle Mod': 'rifle', 'Shotgun Mod': 'shotgun', 'Sniper Mod': 'sniper',
  'Bow Mod': 'bow', 'Secondary Mod': 'secondary', 'Pistol Mod': 'pistol', 'Melee Mod': 'melee',
  'Warframe Mod': 'warframe', 'Companion Mod': 'companion', 'Archgun Mod': 'archgun', 'Archmelee Mod': 'archmelee',
};
function weaponCls(name) {
  const w = WEAPONS.find((x) => norm(x.name) === norm(name));
  if (!w) return 'primary';
  const t = norm(w.type || w.category);
  if (t.includes('melee')) return 'melee';
  if (t.includes('shotgun')) return 'shotgun';
  if (t.includes('sniper')) return 'sniper';
  if (t.includes('bow')) return 'bow';
  if (t.includes('pistol') || t.includes('dual') || t.includes('thrown') || t.includes('secondary')) return 'secondary';
  return 'primary';
}
function modLegalFor(modName, cls, itemName) {
  const m = modByName.get(norm(modName));
  if (!m) return false;
  const c = norm(m.compatName || m.compat);
  if (c === 'aura') return false;
  if (c === 'any' || !m.compat) return true;
  if (c === norm(itemName)) return true;
  const mc = TYPE_CLASS[m.type] || null;
  if (!mc) return true;
  if (cls === 'primary') return mc === 'primary' || mc === 'rifle' || mc === 'shotgun' || mc === 'sniper' || mc === 'bow';
  if (cls === 'secondary') return mc === 'secondary' || mc === 'pistol';
  if (cls === 'warframe') return mc === 'warframe';
  return mc === cls;
}
/* the subsume pool as shipped in the code (donor must really own it) */
const SUBSUME_POOL = [
  ['Pillage', 'Hildryn'], ['Nourish', 'Grendel'], ['Roar', 'Rhino'],
  ['Eclipse', 'Mirage'], ['Gloom', 'Sevagoth'], ['Dispensary', 'Protea'],
  ['Elemental Ward', 'Chroma'],
];
function frameAbilities(name) {
  const f = FRAMES.find((x) => norm(x.name) === norm(name));
  return f ? (f.abilities || []).map((a) => a.name) : [];
}

/* ---------- canned network: wiki + warframestat ---------- */
const WIKI_OPEN = {
  'fishing': 'Fishing', 'eidolon hunts': 'Eidolon Teralyst', 'eidolon': 'Eidolon Teralyst',
  'kuva lich': 'Kuva Lich', 'hunhow': 'Hunhow',
};
const WIKI_EXTRACTS = {
  'Fishing': 'Fishing in Warframe is done with a fishing spear in the open-world landscapes, the Plains of Eidolon, Orb Vallis and the Cambion Drift. Fish spawn in lakes and rivers, and different species appear depending on the time of day, the water, and the bait thrown into it. A thrown spear that hits a fish catches it, and caught fish can be traded for standing or broken down into resources.',
  'Eidolon Teralyst': 'The Eidolon Teralyst is a giant Sentient that rises from the waters of the Plains of Eidolon at night. Hunting it requires an Operator with a proper Amp, because only Void damage from an Amp can strip its shields. Eidolon Lures must be charged and kept close to stop the Teralyst teleporting away when a limb is destroyed. Breaking all of its synovia and then destroying it completes the hunt before dawn.',
  'Kuva Lich': 'A Kuva Lich is a personal nemesis created when a Tenno mercy-kills a Kuva Larvling with their Parazon. The Lich takes over nodes on a planet and steals a cut of the mission rewards earned there. To kill a Lich, the Tenno must learn the three Requiem Mods on their Parazon, in the right order, by fighting the Lich\'s thralls and testing the sequence in combat.',
  'Hunhow': 'Hunhow is an ancient Sentient destroyer from the Old War, and the father of Natah, who later became the Lotus. He was defeated and his consciousness imprisoned in the depths of Uranus, from where he later manipulated events through the Stalker. Hunhow\'s fragments and weapons, including the sword War, remain a threat long after his defeat.',
};
function stubFetch(url) {
  const u = String(url);
  const ok = (data) => Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
  if (u.includes('wiki.warframe.com/api.php')) {
    const parsed = new URL(u);
    const action = parsed.searchParams.get('action');
    if (action === 'opensearch') {
      const s = parsed.searchParams.get('search') || '';
      const t = WIKI_OPEN[norm(s)] || null;
      return ok(t ? [s, [t], [''], ['https://wiki.warframe.com/w/' + t.replace(/ /g, '_')]] : [s, [], [], []]);
    }
    if (parsed.searchParams.get('prop') === 'links') {
      return ok({ query: { pages: { '1': { links: [] } } } });
    }
    if (parsed.searchParams.get('prop') === 'extracts') {
      const ex = WIKI_EXTRACTS[parsed.searchParams.get('titles')];
      return ok({ query: { pages: ex ? { '1': { extract: ex } } : { '-1': {} } } });
    }
    return ok({});
  }
  if (u.includes('en.wikipedia.org')) return ok({ query: { pages: { '-1': {} } } });
  if (u.includes('api.warframestat.us/items/search/')) {
    const name = decodeURIComponent(u.split('/search/')[1].split('?')[0]);
    const key = norm(name);
    if (modByName.has(key)) return ok([{ name, category: 'Mods', baseDrain: 2, fusionLimit: 3 }]);
    const w = WEAPONS.find((x) => norm(x.name) === key);
    if (w) return ok([{ name: w.name, category: 'Primary', criticalChance: 0.30, procChance: 0.28, criticalMultiplier: 2.2, damage: { slash: 60, puncture: 20, impact: 20, total: 100 } }]);
    const f = FRAMES.find((x) => norm(x.name) === key);
    if (f) return ok([{ name: f.name, category: 'Warframes', description: f.description || '' }]);
    return ok([]);
  }
  return ok([]);
}

/* ---------- vm sandbox ---------- */
function makeEl() {
  const subs = {};
  const el = {
    style: {}, className: '', innerHTML: '', textContent: '', value: '', parentNode: null,
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {}, getAttribute() { return null; }, hasAttribute() { return false; },
    addEventListener() {}, appendChild() {}, remove() {}, select() {},
    querySelector(sel) { return subs[sel] || (subs[sel] = makeEl()); },
    querySelectorAll() { return []; },
  };
  return el;
}
const sandbox = {};
sandbox.window = sandbox;
sandbox.console = console;
sandbox.fetch = stubFetch;
sandbox.AbortController = AbortController;
sandbox.setTimeout = setTimeout;
sandbox.clearTimeout = clearTimeout;
sandbox.document = {
  addEventListener() {},
  getElementById() { return null; },
  createElement() { return makeEl(); },
  body: { appendChild() {} },
  head: { appendChild() {} },
  execCommand() { return true; },
};
sandbox.navigator = {
  userAgent: 'vaulty-generality-test',
  clipboard: { writeText() { return Promise.resolve(); } },
};
sandbox.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
sandbox.TV = {
  esc: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
  getJSONParts: (base, n) => {
    const parts = [];
    for (let i = 0; i < n; i++) {
      try { parts.push(...read(`${base.split('/').pop()}-${i}.json`)); } catch (e) { /* missing part = empty */ }
    }
    return Promise.resolve(parts);
  },
  getJSON: (p) => Promise.resolve(read(p.split('/').pop())),
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'ai-fallback.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'vaulty-research.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'vaulty-workshop.js'), 'utf8'), sandbox);
const TVAI = sandbox.TVAI;
const TVWorkshop = sandbox.TVWorkshop;
const TVResearch = sandbox.TVResearch;

/* ---------- helpers ---------- */
function cardMods(html) {
  if (!String(html).includes('vbc-grid')) return null;
  return [...String(html).matchAll(/<div class="vbc-mod">([^<]*)<\/div>/g)].map((m) => m[1]);
}
function cardTitle(html) {
  return (String(html).match(/<div class="vbc-title">([^<]*)<\/div>/) || [])[1] || '';
}
function flatText(html) {
  return String(html || '').replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&rsquo;/g, "'").replace(/\s+/g, ' ');
}
function stripText(html) { return flatText(html).trim(); }
function runWorkshop(q, handoffHtml) {
  return new Promise((resolve) => {
    let out = null;
    TVWorkshop.handle(q, handoffHtml, makeEl(), (h) => { out = h; });
    waitFor(() => out !== null, 8000).then(() => resolve(out));
  });
}
function runConverse(q, missHtml, opts) {
  return new Promise((resolve) => {
    let out = null;
    TVResearch.handleConverse(q, missHtml, makeEl(), (h) => { out = h; }, opts || {});
    waitFor(() => out !== null, 8000).then(() => resolve(out));
  });
}
const OCTAVIA_BLEED = /\boctavia\b|\bmallet\b|\bresonator\b|\bmetronome\b/i;
function assertLegalCard(tag, html, itemName, cls) {
  const mods = cardMods(html) || [];
  check(tag + ': build card with exactly 8 mods', mods.length === 8, 'got ' + mods.length + ': ' + mods.join(' | '));
  check(tag + ': every mod is a real DB entry', mods.every((m) => modByName.has(norm(m))),
    mods.filter((m) => !modByName.has(norm(m))).join(', '));
  check(tag + ': no duplicate mods', new Set(mods.map(norm)).size === mods.length);
  check(tag + ': no aura mod inside the grid', mods.every((m) => !auraNames.has(norm(m))));
  check(tag + ': every mod legal for its class', mods.every((m) => modLegalFor(m, cls, itemName)),
    mods.filter((m) => !modLegalFor(m, cls, itemName)).join(', '));
  check(tag + ': 🛠 Vaulty Original label + honesty line',
    flatText(html).includes('🛠 Vaulty Original') && String(html).includes('combination is new'));
  const title = cardTitle(html);
  check(tag + ': card title names the item', norm(title).includes(norm(itemName)), 'title=' + title);
  check(tag + ': card title carries a concept suffix', title.includes('—'), 'title=' + title);
  const stock = BUILDS.filter((b) => norm(b.item) === norm(itemName));
  stock.forEach((b, i) => {
    const sm = (b.mods || []).map((m) => norm(typeof m === 'string' ? m : m.name)).sort().join('|');
    check(tag + ': differs from stock build #' + (i + 1) + ' (' + b.name + ')', sm !== mods.map(norm).sort().join('|'));
  });
  return mods;
}
function assertDossierShape(tag, html, frameName) {
  const flat = flatText(html);
  check(tag + ': math section present', flat.includes('Why this works — the math'));
  check(tag + ': numbered play rotation present', flat.includes('Play rotation') && String(html).includes('<ol>'));
  check(tag + ': follow-up offer present', /Want the full Archon Shard setup|Want the frame setup/.test(flat));
  check(tag + ': "Researched just now" citation line', flat.includes('Researched just now') && String(html).includes('wiki.warframe.com'));
  check(tag + ': ZERO Octavia bleed-through', !OCTAVIA_BLEED.test(flat), flat.slice(0, 300));
  if (frameName) {
    /* Helminth: name must be in the pool, donor must match, donor must
       really own the ability, replaced ability must be this frame's */
    const hm = flat.match(/Helminth: subsume ([A-Za-z' -]+?) \(from ([A-Za-z]+)\)(?: over ([A-Za-z' -]+?))? —/);
    check(tag + ': Helminth line present and parseable', !!hm, flat.slice(flat.indexOf('Helminth'), flat.indexOf('Helminth') + 160));
    if (hm) {
      const sub = hm[1].trim(), donor = hm[2].trim(), rep = hm[3] ? hm[3].trim() : null;
      const poolHit = SUBSUME_POOL.find((p) => norm(p[0]) === norm(sub));
      check(tag + ': subsume "' + sub + '" is in the verified pool', !!poolHit);
      check(tag + ': donor named is the pool donor (' + donor + ')', !!poolHit && norm(poolHit[1]) === norm(donor));
      check(tag + ': donor really owns ' + sub, frameAbilities(donor).some((a) => norm(a) === norm(sub)),
        frameAbilities(donor).join(' | '));
      check(tag + ': ' + sub + ' is NOT already the frame\'s own ability',
        !frameAbilities(frameName).some((a) => norm(a) === norm(sub)));
      if (rep) check(tag + ': replaced ability "' + rep + '" is really ' + frameName + '\'s',
        frameAbilities(frameName).some((a) => norm(a) === norm(rep)), frameAbilities(frameName).join(' | '));
    }
    check(tag + ': Archon Shard setup present with real shard colors',
      flat.includes('Archon Shards') && /(Crimson|Amber|Azure|Violet|Emerald|Topaz)/.test(flat.slice(flat.indexOf('Archon Shards'))));
    const arcs = (String(html).match(/<div class="vbc-arcanes"><span>Arcanes?<\/span>([^<]*)<\/div>/) || [])[1] || '';
    const picks = arcs ? arcs.split('+').map((s) => s.trim()).filter(Boolean) : [];
    check(tag + ': two real arcanes on the card', picks.length === 2 && picks.every((a) => arcaneNames.has(norm(a))), arcs || 'none');
  }
  return flat;
}
async function powerDossier(tag, q, itemName, cls) {
  const h = TVAI._answer(q);
  check(tag + ': power ask routes to a Workshop handoff', TVAI._workshopIsHandoff(h));
  const plan = TVWorkshop.parsePlan(h) || {};
  check(tag + ': plan resolves to ' + itemName, plan.item === itemName, JSON.stringify(plan));
  const out = await runWorkshop(q, h);
  check(tag + ': workshop produced a final answer', !!out);
  if (!out) return null;
  assertLegalCard(tag, out, itemName, cls);
  return out;
}

(async () => {
  await TVAI._load();

  /* ================= G1–G5: non-Octavia frame dossiers ================ */
  const outWisp = await powerDossier('G1 Wisp Prime',
    "what's the strongest wisp prime build, unkillable, melts everything, endless survival",
    'Wisp Prime', 'warframe');
  if (outWisp) assertDossierShape('G1', outWisp, 'Wisp Prime');

  const outGaruda = await powerDossier('G2 Garuda Prime',
    "what's the best garuda prime build that destroys everything in steel path",
    'Garuda Prime', 'warframe');
  if (outGaruda) assertDossierShape('G2', outGaruda, 'Garuda Prime');

  const outRev = await powerDossier('G3 Revenant Prime',
    'make me an unkillable revenant prime build for endless survival',
    'Revenant Prime', 'warframe');
  if (outRev) assertDossierShape('G3', outRev, 'Revenant Prime');

  const outHild = await powerDossier('G4 Hildryn Prime',
    "what's the strongest hildryn prime build that never dies and destroys everything",
    'Hildryn Prime', 'warframe');
  if (outHild) {
    const flatH = assertDossierShape('G4', outHild, 'Hildryn Prime');
    check('G4: Pillage is NOT subsumed onto its own donor frame',
      !/Helminth: subsume Pillage/.test(flatH || ''));
  }

  const outSaryn = await powerDossier('G5 Saryn Prime',
    "what's the best saryn prime build where she just nukes the whole map",
    'Saryn Prime', 'warframe');
  if (outSaryn) assertDossierShape('G5', outSaryn, 'Saryn Prime');

  /* ================= G6: continuity on Saryn, not Octavia ============= */
  const FQ = 'and for steel path survival?';
  const h6 = TVAI._answer(FQ);
  check('G6: bare follow-up routes to a Workshop handoff', TVAI._workshopIsHandoff(h6));
  const plan6 = TVWorkshop.parsePlan(h6) || {};
  check('G6: follow-up resolves to Saryn Prime (the item just discussed)',
    plan6.item === 'Saryn Prime', JSON.stringify(plan6));
  check('G6: follow-up focus is survival', plan6.focus === 'survival', 'focus=' + plan6.focus);
  const out6 = await runWorkshop(FQ, h6);
  check('G6: workshop produced the follow-up dossier', !!out6);
  if (out6) {
    assertLegalCard('G6', out6, 'Saryn Prime', 'warframe');
    const flat6 = assertDossierShape('G6', out6, 'Saryn Prime');
    check('G6: context note shown ("For Saryn Prime…")',
      (flat6 || '').includes('For Saryn Prime'), (flat6 || '').slice(0, 160));
  }

  /* ================= G7–G9: weapon dossiers =========================== */
  const outAcc = await powerDossier('G7 Acceltra Prime',
    "what's the strongest acceltra prime build that melts everything",
    'Acceltra Prime', weaponCls('Acceltra Prime'));
  if (outAcc) {
    const flatA = assertDossierShape('G7', outAcc, null);
    check('G7: weapon dossier has no Helminth / Shards sections',
      !(flatA || '').includes('Helminth:') && !(flatA || '').includes('Archon Shards:'));
  }

  const outZarr = await powerDossier('G8 Kuva Zarr',
    "what's the best kuva zarr build, destroys everything in the room",
    'Kuva Zarr', weaponCls('Kuva Zarr'));
  if (outZarr) assertDossierShape('G8', outZarr, null);

  check('G9: Desert Wind confirmed to have NO library build',
    BUILDS.filter((b) => norm(b.item) === 'desert wind').length === 0);
  const outDW = await powerDossier('G9 Desert Wind (no library build)',
    "what's the strongest desert wind build that deletes rooms",
    'Desert Wind', weaponCls('Desert Wind'));
  if (outDW) assertDossierShape('G9', outDW, null);

  /* ================= G10–G13: general topics, prose =================== */
  async function topic(tag, q, mustInclude) {
    const guide = TVAI._answer(q);
    const miss = TVResearch.isMiss(guide);
    const out = await runConverse(q, guide, {
      isMiss: miss,
      guideText: miss ? null : stripText(guide).slice(0, 1800),
    });
    const flat = flatText(out);
    check(tag + ': produced an answer', !!out);
    check(tag + ': prose, not a build card', !String(out || '').includes('vbc-grid'));
    check(tag + ': carries the "Researched just now" citation line',
      flat.includes('Researched just now') && String(out || '').includes('wiki.warframe.com'));
    mustInclude.forEach((s) => check(tag + ': covers "' + s + '"', flat.toLowerCase().includes(s.toLowerCase())));
    check(tag + ': ZERO Octavia bleed-through', !OCTAVIA_BLEED.test(flat));
  }
  await topic('G10 fishing', 'how does fishing work', ['spear', 'Plains of Eidolon']);
  await topic('G11 eidolon hunts', 'how do eidolon hunts work', ['Teralyst', 'night']);
  await topic('G12 kuva lich', 'what is a kuva lich', ['Kuva Lich', 'Requiem']);
  await topic('G13 lore (who is Hunhow)', 'who is hunhow', ['Hunhow', 'Sentient']);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (failures.length) console.log('FAILURES: ' + failures.join(' ; '));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
