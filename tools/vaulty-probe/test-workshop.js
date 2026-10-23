/* v2.22.0 fixtures: THE WORKSHOP — generative build composition.
   Loads the REAL js/ai-fallback.js (detection + composer) and
   js/vaulty-workshop.js (research → design → verify orchestration) in a
   Node vm with the site's real data and a canned warframestat fetch.

   Asserts for every composed card: exactly 8 mods, every name an exact
   mods-DB entry, legal class/slots (incl. no aura mod inside a grid,
   aura only on frames), the 🛠 Vaulty Original label, and a Copy
   payload byte-equal to the displayed mods. Also: two differently
   phrased creative asks for one item yield non-identical lists, and
   the v2.19.5/v2.19.6 behaviors (aura hallucination rejected,
   fabricated mod names rejected, qualifiers, plain library routing,
   archetype variety) stay green.

   Usage: node tools/vaulty-probe/test-workshop.js */
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

/* ---------- real data, Node side (ground truth for assertions) ---------- */
const MODS = readParts('mods-');
const BUILDS = readParts('builds-');
const WEAPONS = readParts('weapons-');
const FRAMES = readParts('warframes-');
const modByName = new Map(MODS.map((m) => [norm(m.name), m]));
const auraNames = new Set(MODS.filter((m) => m.aura || norm(m.compat) === 'aura').map((m) => norm(m.name)));
const TYPE_CLASS = {
  'Primary Mod': 'primary', 'Rifle Mod': 'rifle', 'Shotgun Mod': 'shotgun', 'Sniper Mod': 'sniper',
  'Bow Mod': 'bow', 'Secondary Mod': 'secondary', 'Pistol Mod': 'pistol', 'Melee Mod': 'melee',
  'Warframe Mod': 'warframe', 'Companion Mod': 'companion', 'Archgun Mod': 'archgun', 'Archmelee Mod': 'archmelee',
};
function weaponClass(name) {
  const w = WEAPONS.find((x) => norm(x.name) === norm(name));
  if (!w) return null;
  const t = norm(w.type);
  if (t.includes('shotgun')) return 'shotgun';
  if (t.includes('sniper')) return 'sniper';
  if (t.includes('bow')) return 'bow';
  if (t.includes('launcher') || t.includes('rifle') || t.includes('pistol')) return 'primary';
  if (t.includes('dual pistols') || t.includes('thrown')) return 'secondary';
  return t.includes('melee') ? 'melee' : 'primary';
}
function modLegalFor(modName, cls, itemName) {
  const m = modByName.get(norm(modName));
  if (!m) return false;
  const c = norm(m.compatName || m.compat);
  if (c === 'aura') return cls === 'warframe' && auraNames.has(norm(modName));
  if (c === 'any' || !m.compat) return true;
  if (c === norm(itemName)) return true;
  const mc = TYPE_CLASS[m.type] || null;
  if (!mc) return true;
  if (cls === 'primary') return mc === 'primary' || mc === 'rifle' || mc === 'shotgun' || mc === 'sniper' || mc === 'bow';
  if (cls === 'secondary') return mc === 'secondary' || mc === 'pistol';
  return mc === cls;
}

/* ---------- canned warframestat ---------- */
const CANNED_ITEMS = {
  acceltra: [{ name: 'Acceltra', category: 'Primary', criticalChance: 0.40, procChance: 0.06, criticalMultiplier: 2.8, damage: { heat: 30, impact: 22, total: 52 } }],
  braton: [{ name: 'Braton', category: 'Primary', criticalChance: 0.12, procChance: 0.06, criticalMultiplier: 1.6, damage: { slash: 8.2, impact: 7.9, puncture: 7.9, total: 24 } }],
  saryn: [{ name: 'Saryn', category: 'Warframes' }],
};
function stubFetch(url) {
  const u = String(url);
  if (u.includes('api.warframestat.us/items/search/')) {
    const name = decodeURIComponent(u.split('/search/')[1].split('?')[0]);
    const key = norm(name);
    if (CANNED_ITEMS[key]) return Promise.resolve({ ok: true, json: () => Promise.resolve(CANNED_ITEMS[key]) });
    if (modByName.has(key)) {
      /* flat canned drain: 2 + 3 = 5 per mod — inside every budget */
      return Promise.resolve({ ok: true, json: () => Promise.resolve([{ name, category: 'Mods', baseDrain: 2, fusionLimit: 3 }]) });
    }
    const w = WEAPONS.find((x) => norm(x.name) === key);
    if (w) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([{ name: w.name, category: 'Primary', criticalChance: 0.18, procChance: 0.22, criticalMultiplier: 2.0, damage: { slash: 60, puncture: 20, impact: 20, total: 100 } }]) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
  }
  return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
}

/* ---------- vm sandbox (run-probe pattern + interactive stubs) ---------- */
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
  addEventListener(ev, fn) { docListeners[ev] = fn; },
  getElementById() { return null; },
  createElement() { return makeEl(); },
  body: { appendChild() {} },
  head: { appendChild() {} },
  execCommand() { return true; },
};
sandbox.navigator = {
  userAgent: 'vaulty-workshop-test',
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
function assertComposedCard(name, html, itemName, cls) {
  check(name + ': renders a build card', !!cardMods(html));
  const mods = cardMods(html) || [];
  check(name + ': exactly 8 mods', mods.length === 8, 'got ' + mods.length + ': ' + mods.join(' | '));
  check(name + ': every mod is a real DB entry', mods.every((m) => modByName.has(norm(m))),
    mods.filter((m) => !modByName.has(norm(m))).join(', '));
  check(name + ': no duplicate mods', new Set(mods.map(norm)).size === mods.length);
  check(name + ': no aura mod inside the grid', mods.every((m) => !auraNames.has(norm(m))),
    mods.filter((m) => auraNames.has(norm(m))).join(', '));
  check(name + ': every mod legal for class ' + cls, mods.every((m) => modLegalFor(m, cls, itemName)),
    mods.filter((m) => !modLegalFor(m, cls, itemName)).join(', '));
  check(name + ': 🛠 Vaulty Original label present',
    flatText(html).includes('🛠 Vaulty Original — composed just now from real mods'));
  check(name + ': honesty line present', String(html).includes('combination is new'));
  const rowCount = (String(html).match(/class="mod-row"/g) || []).length;
  check(name + ': a why-row for every mod', rowCount >= 8, 'rows: ' + rowCount);
  const flat = flatText(html);
  /* The mods DB carries per-rank duplicate rows for 132 names (e.g.
     Serration at +40/+90/+165). The invariant that matters: the WHY's
     effect text must be one of the mod's real DB effect strings —
     drawn from the database, never invented. */
  const effectsByName = new Map();
  MODS.forEach((m) => {
    const k = norm(m.name);
    if (!effectsByName.has(k)) effectsByName.set(k, []);
    const e = String(m.effect || '').replace(/\s+/g, ' ').trim();
    if (e) effectsByName.get(k).push(e);
  });
  const noEffect = mods.filter((m) => {
    const effs = effectsByName.get(norm(m)) || [];
    return effs.length && !effs.some((e) => flat.includes(e));
  });
  check(name + ': every why drawn from the mod\'s real DB effect', noEffect.length === 0, noEffect.join(', '));
  return mods;
}
async function assertCopyMatches(name, html, mods, aura, exilus) {
  const idm = String(html).match(/data-vbc="(vbc\d+)"/);
  check(name + ': copy button id present', !!idm);
  if (!idm) return;
  clipboardText = null;
  const btn = {
    getAttribute: (a) => (a === 'data-vbc' ? idm[1] : a === 'data-label' ? 'Copy build' : null),
    setAttribute() {}, hasAttribute: (a) => a === 'data-compact' ? false : false,
    classList: { add() {}, remove() {} }, textContent: 'Copy build',
  };
  docListeners.click({ target: { closest: (s) => (s === '.vbc-copy' ? btn : null) } });
  await tick(20);
  check(name + ': clipboard was written', typeof clipboardText === 'string' && clipboardText.length > 0);
  if (!clipboardText) return;
  const lines = clipboardText.split('\n');
  const payloadMods = lines.filter((l) => mods.includes(l));
  check(name + ': copy payload mods == displayed mods', payloadMods.length === 8 && mods.every((m) => payloadMods.includes(m)),
    'payload: ' + lines.join(' / '));
  if (aura) check(name + ': copy payload carries the aura', lines.some((l) => l === 'Aura: ' + aura), lines.join(' / '));
  if (exilus) check(name + ': copy payload carries the exilus', lines.some((l) => l === 'Exilus: ' + exilus), lines.join(' / '));
}
function makeMsgs() {
  const msgs = {
    children: [], scrollTop: 0, scrollHeight: 100,
    appendChild(el) { el.parentNode = msgs; msgs.children.push(el); },
    removeChild(el) { el.parentNode = null; const i = msgs.children.indexOf(el); if (i >= 0) msgs.children.splice(i, 1); },
  };
  return msgs;
}
async function runWorkshop(q) {
  const handoff = TVAI._answer(q);
  check('handoff issued for: ' + q, TVWorkshop.isHandoff(handoff), String(handoff).slice(0, 120));
  if (!TVWorkshop.isHandoff(handoff)) return null;
  const renders = [];
  TVWorkshop.handle(q, handoff, makeMsgs(), (html) => renders.push(html));
  const ok = await waitFor(() => renders.length > 0, 9000);
  check('workshop finished for: ' + q, ok);
  return ok ? renders[0] : null;
}

TVAI._load().then(async () => {
  check('TVAI workshop hooks exposed',
    typeof TVAI._workshopCompose === 'function' && typeof TVAI._workshopRender === 'function' &&
    typeof TVAI._workshopVerify === 'function' && typeof TVWorkshop.handle === 'function');

  /* ---- fixture 1: full damage, primary ---- */
  const h1 = await runWorkshop('design a full damage build for Acceltra');
  let acceltraMods = [];
  if (h1) {
    check('acceltra: title marks it a full-damage original', /Full Damage/.test(h1) && /Acceltra/.test(h1), h1.slice(0, 200));
    check('acceltra: grounded in the researched profile',
      h1.includes('Research first') && h1.includes('40% crit') && h1.includes('Heat') && h1.includes('live item data'),
      h1.slice(0, 400));
    acceltraMods = assertComposedCard('acceltra', h1, 'Acceltra', 'primary');
    await assertCopyMatches('acceltra', h1, acceltraMods, null, null);
  }

  /* ---- fixture 2: off-meta Braton ---- */
  const h2 = await runWorkshop('make me a weird off-meta Braton build');
  if (h2) {
    check('braton: title marks it off-meta', /Off-Meta/.test(h2), h2.slice(0, 200));
    const mods = assertComposedCard('braton', h2, 'Braton', 'primary');
    await assertCopyMatches('braton', h2, mods, null, null);
  }

  /* ---- fixture 3: frame, ability-focused ---- */
  const h3 = await runWorkshop('come up with a Saryn build focused on Spores');
  if (h3) {
    check('saryn: title names the ability focus', /Spores/.test(h3), h3.slice(0, 200));
    const mods = assertComposedCard('saryn', h3, 'Saryn', 'warframe');
    const aura = cardSlot(h3, 'Aura');
    check('saryn: aura present and a real aura mod', !!aura && auraNames.has(norm(aura)), String(aura));
    check('saryn: aura itself is in the mods DB', !!aura && modByName.has(norm(aura)), String(aura));
    const sarynAugments = MODS.filter((m) => norm(m.compatName || m.compat) === 'saryn').map((m) => m.name);
    check('saryn: a Saryn augment made the build', mods.some((m) => sarynAugments.includes(m)),
      'mods: ' + mods.join(', ') + ' | augments: ' + sarynAugments.join(', '));
    await assertCopyMatches('saryn', h3, mods, aura, cardSlot(h3, 'Exilus'));
  }

  /* ---- fixture 4: an item with NO library build ---- */
  const builtItems = new Set(BUILDS.map((b) => norm(b.item)));
  const noLib = WEAPONS.find((w) => !builtItems.has(norm(w.name)) && w.name.length >= 5 &&
    !/exalted|incarnon/i.test(w.name) && /Primary|Secondary|Melee/i.test(w.type || '') &&
    !/Skin|Syandana/i.test(w.type || ''));
  check('found a no-library-build weapon to compose for', !!noLib, 'none found');
  if (noLib) {
    const h4 = await runWorkshop('design a build for ' + noLib.name);
    if (h4) {
      const mods = assertComposedCard('nolib(' + noLib.name + ')', h4, noLib.name, weaponClass(noLib.name));
      await assertCopyMatches('nolib(' + noLib.name + ')', h4, mods, null, null);
    }
  }

  /* ---- fixture 5: same item, different phrasing → different list ---- */
  const h5 = await runWorkshop('invent a max damage Acceltra build from scratch');
  if (h5 && acceltraMods.length) {
    const mods5 = cardMods(h5) || [];
    check('variety: second phrasing still composes 8 legal mods', mods5.length === 8 && mods5.every((m) => modByName.has(norm(m))));
    const same = mods5.length === acceltraMods.length && mods5.every((m) => acceltraMods.includes(m));
    check('variety: two creative phrasings give non-identical lists', !same,
      'A: ' + acceltraMods.join(', ') + ' || B: ' + mods5.join(', '));
  }

  /* ---- routing regressions ---- */
  const lib = TVAI._answer('steflos build');
  check('plain ask: library card, not a workshop handoff', !TVWorkshop.isHandoff(lib) && !!cardMods(lib));
  const plain = TVAI._answer('make me a saryn build');
  check('"make me a X build" alone: instant library, not a handoff', !TVWorkshop.isHandoff(plain) && !!cardMods(plain));
  const budget = TVAI._answer('budget steflos build with no primed mods');
  const budgetMods = cardMods(budget) || [];
  check('qualifier ask: not a handoff', !TVWorkshop.isHandoff(budget));
  check('qualifier ask: zero Primed/Galvanized mods', budgetMods.length === 8 &&
    budgetMods.every((m) => !/primed|galvanized/i.test(m)), budgetMods.join(', '));
  const status = TVAI._answer('status build for kuva zarr');
  const statusMods = cardMods(status) || [];
  const statusCount = statusMods.filter((m) => /status chance/i.test((modByName.get(norm(m)) || {}).effect || '')).length;
  check('status ask: not a handoff, status-weighted card', !TVWorkshop.isHandoff(status) && statusMods.length === 8 && statusCount >= 3,
    statusMods.join(', ') + ' (status-effect mods: ' + statusCount + ')');
  const sarynLib = cardMods(TVAI._answer('saryn build')) || [];
  const wispLib = cardMods(TVAI._answer('wisp build')) || [];
  const shared = sarynLib.filter((m) => wispLib.includes(m)).length;
  check('archetype variety: generated Saryn vs Wisp differ >= 4/8', sarynLib.length === 8 && wispLib.length === 8 && (8 - shared) >= 4,
    'shared ' + shared + ': S[' + sarynLib.join(', ') + '] W[' + wispLib.join(', ') + ']');

  /* ---- _validateAnswer: v2.19.5 exhibits + fabricated names ---- */
  const auraExhibit = 'Here\'s a Steel Path Steflos build:\n' +
    '* Corrosive Projection (armor strip, best for Steel Path)\n' +
    '* Steel Charge (melee damage aura)\n' +
    '* Primed Point Blank\n* Galvanized Hell\n* Galvanized Savvy\n' +
    '* Primed Ravage\n* Critical Deceleration\n* Hunter Munitions\n* Toxic Barrage';
  check('v2.19.5 exhibit (auras on a shotgun) rejected', TVAI._validateAnswer(auraExhibit, 'build me a steflos build') === false);
  const fabText = 'Saryn build:\n1. Primed Thunder Rounds\n2. Vitality\n3. Steel Fiber\n4. Intensify\n' +
    '5. Continuity\n6. Stretch\n7. Streamline\n8. Primed Flow';
  check('fabricated mod name rejected', TVAI._validateAnswer(fabText, 'saryn build') === false);
  const legitText = 'Saryn build:\n1. Vitality\n2. Steel Fiber\n3. Intensify\n4. Continuity\n' +
    '5. Stretch\n6. Streamline\n7. Primed Flow\n8. Blind Rage';
  check('legit all-real frame build accepted', TVAI._validateAnswer(legitText, 'saryn build') === true);
  const fabProse = 'For the Acceltra try Serration, Split Chamber, Point Strike, Vital Sense, ' +
    'Hunter Munitions, Hellfire, Stormbringer and Primed Quantum Splitter for maximum damage.';
  check('fabricated name in prose list rejected', TVAI._validateAnswer(fabProse, 'acceltra build') === false);

  console.log('\n=== Workshop fixtures: ' + pass + ' passed, ' + fail + ' failed ===');
  if (failures.length) console.log('Failures:\n - ' + failures.join('\n - '));
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error('workshop test crashed:', e); process.exit(1); });
