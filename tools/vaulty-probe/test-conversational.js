/* v2.22.0 fixtures: CONVERSATIONAL VAULTY.
   Loads the REAL js/ai-fallback.js (power routing + composer + dossier),
   js/vaulty-workshop.js (orchestration) and js/vaulty-research.js (deep
   dig + synthesis) in a Node vm with the site's real data, a canned
   warframestat fetch, and a canned Warframe Wiki API.

   F1  the owner's EXACT Octavia message → power handoff (never the stock
       library card) → full dossier: named concept, conversational intro,
       8 real legal mods with concept-tied WHYs, Helminth (Pillage over
       Resonator, from Hildryn) with reasoning, 2 real arcanes, Archon
       Shard setup, a math section whose Ability Strength total and
       Pillage strip % are RE-COMPUTED from the displayed card and the
       real formula (25% × strength; full strip at 400%, 328% with
       Corrosive Projection), a numbered play rotation, the "Researched
       just now" line with a Wiki citation, and a follow-up offer.
   F1b the AI-mode prose hook: a stub proseWriter's labeled prose lands
       in the dossier while the card stays engine-exact.
   F2  follow-up "and for steel path survival?" — no item named — must
       resolve to Octavia via session context, print the context note,
       and compose a survival dossier.
   F3–F7 general questions (ability mechanics / farming / lore who-is /
       how-to / comparison) → synthesized PROSE with citations, no cards.
   F8  nonsense → the honest don't-know, untouched.
   Plus routing regressions: plain asks stay library, "best beginner"
   stays beginner, power phrases for other frames route as dossiers.

   Usage: node tools/vaulty-probe/test-conversational.js */
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
const ARCANES = readParts('arcanes-');
const modFirst = new Map();
MODS.forEach((m) => { const k = norm(m.name); if (!modFirst.has(k)) modFirst.set(k, m); });
const modByName = new Map(MODS.map((m) => [norm(m.name), m]));
const auraNames = new Set(MODS.filter((m) => m.aura || norm(m.compat) === 'aura').map((m) => norm(m.name)));
const arcaneNames = new Set(ARCANES.map((a) => norm(a.name)));
const TYPE_CLASS = {
  'Primary Mod': 'primary', 'Rifle Mod': 'rifle', 'Shotgun Mod': 'shotgun', 'Sniper Mod': 'sniper',
  'Bow Mod': 'bow', 'Secondary Mod': 'secondary', 'Pistol Mod': 'pistol', 'Melee Mod': 'melee',
  'Warframe Mod': 'warframe', 'Companion Mod': 'companion', 'Archgun Mod': 'archgun', 'Archmelee Mod': 'archmelee',
};
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
  return mc === cls;
}
function strengthOf(name) {
  const m = modFirst.get(norm(name));
  if (!m) return 0;
  const mt = String(m.effect || '').match(/([+-]?\d+(?:\.\d+)?)%\s*Ability Strength/);
  return mt ? parseFloat(mt[1]) : 0;
}
function fmtNum(x) { const r = Math.round(x * 10) / 10; return (r % 1 === 0) ? String(Math.round(r)) : String(r); }

/* ---------- canned network ---------- */
const WIKI_OPEN = {
  'mallet': 'Mallet', 'octavia prime': 'Octavia Prime', 'octavia': 'Octavia',
  'cryotic': 'Cryotic', 'ballas': 'Ballas', 'adaptation': 'Adaptation',
  'rolling guard': 'Rolling Guard', 'damage': 'Damage',
};
const WIKI_EXTRACTS = {
  'Mallet': 'Mallet is the first ability of Octavia. It draws enemy fire toward itself and converts the damage it absorbs into damage of its own, growing more lethal the more damage it takes. Because its damage scales with incoming enemy damage, Mallet becomes stronger the longer a mission runs and the tougher the enemies are.',
  'Damage': 'Damage is the depletion of a target\'s health by weapons and abilities. Octavia\'s Mallet converts absorbed damage into its own damage output, which is why its damage scales in long missions against high-level enemies.',
  'Octavia Prime': 'Octavia Prime is the primed variant of Octavia, the music-themed Warframe. Her abilities revolve around rhythm: Mallet draws fire and scales in damage, Resonator charms enemies into following it, Metronome grants buffs for actions on the beat, and Amp multiplies damage based on the noise level around her.',
  'Cryotic': 'Cryotic is a resource harvested in Excavation missions, where excavators dig at marked sites and must be powered with energy cells dropped by Power Carriers and defended until the dig completes. Each finished excavator yields Cryotic, which is spent on many weapon and equipment blueprints.',
  'Ballas': 'Ballas was an Executor of the Orokin Empire and the creator of the Warframes. He betrayed the Orokin to Hunhow during the Old War, and his machinations eventually set the events of The New War in motion.',
  'Angels of the Zariman': 'Angels of the Zariman is a quest that takes place aboard the Zariman Ten Zero. Completing it unlocks the Chrysalith social hub and the Zariman bounty missions, including Void Armageddon and Void Cascade. The quest requires The New War to be completed first.',
  'Adaptation': 'Adaptation is a Warframe mod that grants stacking resistance to the damage types the Warframe has recently taken, building up to 90% resistance against the strongest incoming damage type. The resistance decays if that damage type is not received again for a while.',
  'Rolling Guard': 'Rolling Guard is a Warframe mod that grants a brief window of invulnerability and removes all status effects when the Warframe performs a dodge roll. It has a cooldown of several seconds between activations, so rolls must be timed.',
};
const WIKI_LINKS = { 'Mallet': ['Octavia', 'Damage'] };
function wikiTitleFor(search) {
  const s = norm(search);
  if (s.includes('zariman')) return 'Angels of the Zariman';
  return WIKI_OPEN[s] || null;
}
function stubFetch(url) {
  const u = String(url);
  const ok = (data) => Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
  if (u.includes('wiki.warframe.com/api.php')) {
    const parsed = new URL(u);
    const action = parsed.searchParams.get('action');
    if (action === 'opensearch') {
      const t = wikiTitleFor(parsed.searchParams.get('search') || '');
      return ok(t ? [parsed.searchParams.get('search'), [t], [''], ['https://wiki.warframe.com/w/' + t.replace(/ /g, '_')]] : [parsed.searchParams.get('search'), [], [], []]);
    }
    if (parsed.searchParams.get('prop') === 'links') {
      const links = WIKI_LINKS[parsed.searchParams.get('titles')] || [];
      return ok({ query: { pages: { '1': { links: links.map((x) => ({ title: x })) } } } });
    }
    if (parsed.searchParams.get('prop') === 'extracts') {
      const ex = WIKI_EXTRACTS[parsed.searchParams.get('titles')];
      return ok({ query: { pages: ex ? { '1': { extract: ex } } : { '-1': {} } } });
    }
    return ok({});
  }
  if (u.includes('en.wikipedia.org')) {
    const parsed = new URL(u);
    if (parsed.searchParams.get('action') === 'opensearch') return ok([parsed.searchParams.get('search'), [], [], []]);
    return ok({ query: { pages: { '-1': {} } } });
  }
  if (u.includes('api.warframestat.us/items/search/')) {
    const name = decodeURIComponent(u.split('/search/')[1].split('?')[0]);
    const key = norm(name);
    if (key === 'octavia prime') {
      return ok([{ name: 'Octavia Prime', category: 'Warframes', description: 'Octavia Prime, the primed conductor of mayhem and music.' }]);
    }
    if (modByName.has(key)) {
      return ok([{ name, category: 'Mods', baseDrain: 2, fusionLimit: 3 }]);
    }
    return ok([]);
  }
  return ok([]);
}

/* ---------- vm sandbox (test-workshop pattern) ---------- */
const docListeners = {};
let clipboardText = null;
function makeEl() {
  const subs = {};
  const el = {
    style: {}, className: '', innerHTML: '', textContent: '', value: '', parentNode: null,
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {}, getAttribute() { return null; }, hasAttribute() { return false; },
    addEventListener() {}, appendChild() {}, remove() {}, select() {},
    querySelector(sel) { return subs[sel] || (subs[sel] = makeEl()); },
    querySelectorAll() { return []
 },
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
  addEventListener(ev, fn) { docListeners[ev] = fn; },
  getElementById() { return null; },
  createElement() { return makeEl(); },
  body: { appendChild() {} },
  head: { appendChild() {} },
  execCommand() { return true; },
};
sandbox.navigator = {
  userAgent: 'vaulty-conversational-test',
  clipboard: { writeText(t) { clipboardText = t; return Promise.resolve(); } },
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
function cardSlot(html, label) {
  const m = String(html).match(new RegExp('<div class="vbc-slot"><span>' + label + '</span>([^<]*)</div>'));
  return m ? m[1] : null;
}
function flatText(html) {
  return String(html || '').replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&rsquo;/g, "'").replace(/\s+/g, ' ');
}
function stripText(html) {
  return flatText(html).trim();
}
function runWorkshop(q, handoffHtml, opts) {
  return new Promise((resolve) => {
    let out = null;
    TVWorkshop.handle(q, handoffHtml, makeEl(), (h) => { out = h; }, opts || undefined);
    waitFor(() => out !== null, 6000).then(() => resolve(out));
  });
}
function runConverse(q, missHtml, opts) {
  return new Promise((resolve) => {
    let out = null;
    TVResearch.handleConverse(q, missHtml, makeEl(), (h) => { out = h; }, opts || {});
    waitFor(() => out !== null, 6000).then(() => resolve(out));
  });
}
function assertLegalCard(name, html, itemName) {
  const mods = cardMods(html) || [];
  check(name + ': renders a build card with exactly 8 mods', mods.length === 8, 'got ' + mods.length + ': ' + mods.join(' | '));
  check(name + ': every mod is a real DB entry', mods.every((m) => modByName.has(norm(m))),
    mods.filter((m) => !modByName.has(norm(m))).join(', '));
  check(name + ': no duplicate mods', new Set(mods.map(norm)).size === mods.length);
  check(name + ': no aura mod inside the grid', mods.every((m) => !auraNames.has(norm(m))));
  check(name + ': every mod legal for warframe class', mods.every((m) => modLegalFor(m, 'warframe', itemName)),
    mods.filter((m) => !modLegalFor(m, 'warframe', itemName)).join(', '));
  check(name + ': 🛠 Vaulty Original label present',
    flatText(html).includes('🛠 Vaulty Original — composed just now from real mods'));
  check(name + ': honesty line present', String(html).includes('combination is new'));
  const rowCount = (String(html).match(/class="mod-row"/g) || []).length;
  check(name + ': a why-row for every mod', rowCount >= 8, 'rows: ' + rowCount);
  return mods;
}

const F1Q = "what's like the best Octavia prime build where she just kills anything in he way or even like survival and destroying everything";
const stockOctavia = BUILDS.filter((b) => norm(b.item) === 'octavia prime' || norm(b.item) === 'octavia');

(async () => {
  await TVAI._load();

  /* ================= F1: the owner's exact Octavia message ============ */
  const h1 = TVAI._answer(F1Q);
  check('F1: routes to a Workshop handoff (not the library)', TVAI._workshopIsHandoff(h1));
  check('F1: no build card in the handoff itself', !String(h1).includes('vbc-grid'));
  const plan1 = TVWorkshop.parsePlan(h1) || {};
  check('F1: plan item is Octavia Prime', plan1.item === 'Octavia Prime', JSON.stringify(plan1));
  check('F1: plan focus is power (damage + survival)', plan1.focus === 'power', 'focus=' + plan1.focus);
  check('F1: plan flagged as power intent', plan1.power === true);
  check('F1: stock library has Octavia builds (the thing we must NOT serve)', stockOctavia.length >= 2, 'found ' + stockOctavia.length);

  const out1 = await runWorkshop(F1Q, h1);
  check('F1: workshop produced a final answer', !!out1);
  const flat1 = flatText(out1);
  const mods1 = assertLegalCard('F1', out1, 'Octavia Prime');
  const cardTitle1 = (String(out1).match(/<div class="vbc-title">([^<]*)<\/div>/) || [])[1] || '';
  check('F1: card title is the concept (Octavia Prime — Room Melter), not a library name',
    cardTitle1.includes('Room Melter') && !stockOctavia.some((b) => norm(b.name) === norm(cardTitle1)),
    'title=' + cardTitle1 + ' ; stock: ' + stockOctavia.map((b) => b.name).join(' | '));
  stockOctavia.forEach((b, i) => {
    const stockMods = (b.mods || []).map((m) => norm(typeof m === 'string' ? m : m.name)).sort().join('|');
    check('F1: dossier mods differ from stock build #' + (i + 1) + ' (' + b.name + ')',
      stockMods !== mods1.map(norm).sort().join('|'));
  });
  const introAt = flat1.indexOf('Mallet');
  check('F1: conversational wrapper leads with how Octavia does it (Mallet before the card)',
    introAt !== -1 && String(out1).indexOf('Mallet') < String(out1).indexOf('vbc-grid'));
  const aura1 = cardSlot(out1, 'Aura');
  check('F1: aura slot holds a real aura', !!aura1 && auraNames.has(norm(aura1)), 'aura=' + aura1);
  check('F1: exilus slot filled', !!cardSlot(out1, 'Exilus'), 'exilus=' + cardSlot(out1, 'Exilus'));
  const arcSlot = (String(out1).match(/<div class="vbc-arcanes"><span>Arcanes?<\/span>([^<]*)<\/div>/) || [])[1] || '';
  const arcPicks = arcSlot ? arcSlot.split('+').map((s) => s.trim()).filter(Boolean) : [];
  check('F1: exactly two arcanes on the card', arcPicks.length === 2, 'got: ' + (arcSlot || 'none'));
  check('F1: both arcanes are real DB arcanes', arcPicks.every((a) => arcaneNames.has(norm(a))),
    arcPicks.filter((a) => !arcaneNames.has(norm(a))).join(', '));
  check('F1: caster-survival arcane class (Energize / Molt)',
    /energize|molt/i.test(arcSlot), arcSlot || 'none');
  check('F1: WHY rows tied to the concept (Raw power / Survival layer labels)',
    /Raw power —|Survival layer —/.test(flat1));
  check('F1: Helminth line names Pillage, its donor Hildryn, and the replaced Resonator',
    flat1.includes('Helminth') && flat1.includes('Pillage') && flat1.includes('Hildryn') && flat1.includes('Resonator'));
  check('F1: Helminth reasoning gives the Mallet synergy', /strip[\s\S]{0,400}Mallet|Mallet[\s\S]{0,400}strip/i.test(flat1));
  check('F1: Archon Shard setup present (Crimson + Amber by role)',
    flat1.includes('Archon Shards') && flat1.includes('Crimson') && flat1.includes('Amber'));
  check('F1: math section present', flat1.includes('Why this works — the math'));
  /* recompute the strength + strip math from the DISPLAYED card */
  const exilus1 = cardSlot(out1, 'Exilus');
  const totalStr = 100 + mods1.reduce((s, m) => s + strengthOf(m), 0) + (exilus1 ? strengthOf(exilus1) : 0);
  const stripPct = 25 * totalStr / 100;
  const casts = stripPct >= 100 ? 1 : Math.ceil(100 / stripPct);
  check('F1: math states the computed Ability Strength (' + totalStr + '%)',
    flat1.includes(totalStr + '%'), 'looking for ' + totalStr + '%');
  check('F1: math states the computed Pillage strip (≈' + fmtNum(stripPct) + '%)',
    flat1.includes('≈ ' + fmtNum(stripPct) + '%'), 'looking for ≈ ' + fmtNum(stripPct) + '%');
  check('F1: casts-to-full-strip is the derived number (' + casts + '), never a sloppy claim',
    casts === 1 ? flat1.includes('full strip in a single cast') : flat1.includes(casts + ' casts to fully strip'));
  check('F1: strip claim is honest when under 400% (no "one cast" shortcut)',
    totalStr >= 400 || !/full strip in a single cast/.test(flat1.replace('The Wiki\'s checkpoints agree with the formula: full strip at 400% strength, or 328% with Corrosive Projection up. ', '')));
  const rotAt = flat1.indexOf('Play rotation');
  check('F1: numbered play rotation present', rotAt !== -1 && String(out1).includes('<ol>'));
  const rotText = rotAt !== -1 ? flat1.slice(rotAt) : '';
  check('F1: rotation runs Mallet → Pillage', rotText.includes('Mallet') && rotText.includes('Pillage'));
  check('F1: closing follow-up offer present', /Want the full Archon Shard setup for this layout/.test(flat1));
  check('F1: "Researched just now" line with a Wiki citation',
    flat1.includes('Researched just now') && String(out1).includes('wiki.warframe.com/w/Octavia_Prime'));

  /* ================= F1b: AI prose hook ================= */
  const out1b = await runWorkshop(F1Q, h1, {
    proseWriter: () => Promise.resolve({
      introHtml: '<p>STUB INTRO — written from the verified dossier.</p>',
      mathHtml: '<p>STUB MATH — written from the verified dossier.</p>',
    }),
  });
  const flat1b = flatText(out1b);
  check('F1b: model prose lands in the dossier intro slot', flat1b.includes('STUB INTRO'));
  check('F1b: model prose lands in the math slot', flat1b.includes('STUB MATH'));
  check('F1b: the card itself is untouched by prose (same 8 mods)',
    JSON.stringify(cardMods(out1b)) === JSON.stringify(mods1));
  check('F1b: Helminth + shards sections stay engine-rendered',
    flat1b.includes('Pillage') && flat1b.includes('Archon Shards'));

  /* ================= F2: session follow-up ================= */
  const F2Q = 'and for steel path survival?';
  const h2 = TVAI._answer(F2Q);
  check('F2: bare follow-up resolves to a Workshop handoff', TVAI._workshopIsHandoff(h2));
  const plan2 = TVWorkshop.parsePlan(h2) || {};
  check('F2: resolved item is Octavia Prime (never restated by the user)',
    plan2.item === 'Octavia Prime', JSON.stringify(plan2));
  check('F2: resolved focus is survival', plan2.focus === 'survival', 'focus=' + plan2.focus);
  check('F2: context note computed', !!plan2.ctxNote && plan2.ctxNote.includes('Octavia Prime') &&
    plan2.ctxNote.includes('Steel Path') && plan2.ctxNote.includes('survival'), 'ctxNote=' + plan2.ctxNote);
  const out2 = await runWorkshop(F2Q, h2);
  const flat2 = flatText(out2);
  const mods2 = assertLegalCard('F2', out2, 'Octavia Prime');
  check('F2: context note shown subtly at the top', flat2.includes('For Octavia Prime, Steel Path survival:'));
  check('F2: survival dossier — Adaptation is in the composition', mods2.map(norm).includes('adaptation'),
    mods2.join(' | '));
  check('F2: dossier shape holds (Helminth + shards + rotation)',
    flat2.includes('Helminth') && flat2.includes('Archon Shards') && flat2.includes('Play rotation'));

  /* ================= F3–F7: general questions, prose + citations ======= */
  async function converseFixture(tag, q, mustInclude, extra) {
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
    check(tag + ': not the old extract-dump shape', !/From the Warframe Wiki —/.test(flat));
    if (extra) extra(out, flat);
    return out;
  }

  await converseFixture('F3 (ability mechanics)', 'how does mallet work', ['Mallet', 'scales']);
  await converseFixture('F4 (farming method)', 'how do i farm cryotic', ['Cryotic', 'Excavation']);
  await converseFixture('F5 (lore who-is)', 'who is ballas', ['Ballas', 'Orokin']);
  await converseFixture('F6 (how-to)', 'how do I start the angels of the zariman quest', ['Zariman', 'New War']);
  check('F7: comparison subjects resolve to both items',
    JSON.stringify(TVResearch._compareSubjects('which is better for survival, adaptation or rolling guard?')) ===
    JSON.stringify(['adaptation', 'rolling guard']),
    JSON.stringify(TVResearch._compareSubjects('which is better for survival, adaptation or rolling guard?')));
  await converseFixture('F7 (comparison)', 'which is better for survival, adaptation or rolling guard?',
    ['resistance', 'invulnerability']);

  /* ================= F8: nonsense stays honest ================= */
  const F8Q = 'what is the best pizza topping';
  const guide8 = TVAI._answer(F8Q);
  check('F8: guide honestly doesn\'t know', TVResearch.isMiss(guide8));
  const out8 = await runConverse(F8Q, guide8, { isMiss: true });
  check('F8: converse falls back to the honest don\'t-know verbatim', out8 === guide8);
  check('F8: no fabricated prose or citations', !flatText(out8).includes('Researched just now'));

  /* ================= routing regressions ================= */
  const plain = TVAI._answer('make me a steflos build');
  check('R1: plain build ask stays on the library path (no handoff)', !TVAI._workshopIsHandoff(plain));
  const beginner = TVAI._answer('best beginner build');
  check('R2: "best beginner build" is NOT power-routed', !TVAI._workshopIsHandoff(beginner));
  const hTank = TVAI._answer('make me an unkillable inaros build');
  check('R3: "unkillable" routes to a power handoff', TVAI._workshopIsHandoff(hTank));
  const planTank = TVWorkshop.parsePlan(hTank) || {};
  check('R3: survival emphasis + Inaros resolved', planTank.focus === 'survival' && planTank.item === 'Inaros Prime' || planTank.item === 'Inaros',
    JSON.stringify(planTank));
  const hDmg = TVAI._answer("what's the strongest saryn build");
  const planDmg = TVWorkshop.parsePlan(hDmg) || {};
  check('R4: "strongest" routes to a damage power dossier', TVAI._workshopIsHandoff(hDmg) && planDmg.focus === 'damage',
    JSON.stringify(planDmg));
  const starter = TVAI._answer('best starter frame');
  check('R5: "best starter frame" is not a build handoff', !TVAI._workshopIsHandoff(starter));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (failures.length) console.log('FAILURES: ' + failures.join(' ; '));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
