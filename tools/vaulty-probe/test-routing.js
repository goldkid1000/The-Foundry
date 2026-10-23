/* v2.23.1 fixtures: ENTITY-FIRST ROUTING.
   The owner's live failure: "Can you build me a general build for nyx"
   returned the generic "most popular builds" list (Kuva Zarr, Bramma,
   Phenmor weapon builds) — the named frame was ignored entirely.
   Root causes found in js/ai-fallback.js:
     1. findItemInText requires item names of >= 4 chars, so 3-letter
        items (Nyx, Ash) are invisible inside a sentence.
     2. parseBuildQ only strips "make"-style openers, not "build me",
        and "general" was not a qualifier at all — so the parsed name
        was the garbage string "can you me general nyx".
   The fix: a word-boundary resolver (resolveNamedItem) wired into
   every intent path (build, qualifiers, Workshop, power, Steel Path
   general, checker, farm, session context, generateBuild), "general"
   as a first-class qualifier (the item's balanced all-rounder), and
   the popular-builds list reachable ONLY when no item is named.

   F1  owner's exact ask -> Nyx general build (library balanced),
       summed Strength >= 125% with the Psychic Bolts full-strip
       breakpoint stated, ZERO popular-list content.
   F2  "saryn prime build"          F3 "build for kuva zarr"
   F4  "general build for wisp"     F5 "nyx build"
   F6  NEGATIVE CONTROL: "show me popular builds" -> the list itself.
   S1  "good build for nyx" (recommendation-shaped build ask)
   S2  checker ask naming Nyx resolves the item (no "which item?")
   S3  "how do i get nyx prime" farm ask answers about Nyx Prime
   S4  "general steel path build for nyx" is NOT the generic
       Steel Path essay — it is a Nyx build
   S5  "design a build for nyx" reaches the Workshop handoff for Nyx

   Usage: node tools/vaulty-probe/test-routing.js
          ROUTING_OBSERVE=1 node tools/vaulty-probe/test-routing.js */
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
const OBSERVE = !!process.env.ROUTING_OBSERVE;
function check(name, cond, extra) {
  if (OBSERVE) return;
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
const flat = (h) => String(h || '').replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&rsquo;/g, "'").replace(/\s+/g, ' ');

const MODS = readParts('mods-');
const modByName = new Map();
MODS.forEach((m) => { const k = norm(m.name); if (!modByName.has(k)) modByName.set(k, m); });
function strengthOf(name) {
  const m = modByName.get(norm(name));
  if (!m) return 0;
  const mt = String(m.effect || '').match(/([+-]?\d+(?:\.\d+)?)%\s*Ability Strength/);
  return mt ? parseFloat(mt[1]) : 0;
}

/* ---------- stubs (test-v2230 pattern) ---------- */
function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    _map: map
  };
}
function makeEl() {
  const subs = {};
  const classes = new Set();
  const el = {
    style: {}, className: '', innerHTML: '', textContent: '', value: '', parentNode: null,
    children: [], _attrs: {}, _subs: subs, scrollTop: 0, scrollHeight: 100,
    classList: {
      add(c) { classes.add(c); }, remove(c) { classes.delete(c); },
      toggle(c) { classes.has(c) ? classes.delete(c) : classes.add(c); },
      contains(c) { return classes.has(c); }
    },
    setAttribute(k, v) { el._attrs[k] = String(v); },
    getAttribute(k) { return k in el._attrs ? el._attrs[k] : null; },
    hasAttribute(k) { return k in el._attrs; },
    addEventListener() {},
    appendChild(c) { el.children.push(c); c.parentNode = el; return c; },
    removeChild(c) { const i = el.children.indexOf(c); if (i >= 0) el.children.splice(i, 1); return c; },
    remove() { if (el.parentNode) el.parentNode.removeChild(el); },
    focus() {}, select() {},
    closest() { return null; },
    querySelector(sel) { return subs[sel] || (subs[sel] = makeEl()); },
    querySelectorAll() { return []; }
  };
  return el;
}
function makeDocument() {
  const listeners = {};
  return {
    _listeners: listeners,
    addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    fire(ev, arg) { (listeners[ev] || []).forEach((fn) => fn(arg)); },
    getElementById() { return null; },
    createElement() { return makeEl(); },
    body: makeEl(),
    head: { appendChild() {} },
    execCommand() { return true; },
    visibilityState: 'visible'
  };
}
const TVSTUB = (storage) => ({
  esc: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
  getJSONParts: (base, n) => {
    const parts = [];
    for (let i = 0; i < n; i++) {
      try { parts.push(...read(`${base.split('/').pop()}-${i}.json`)); } catch (e) {}
    }
    return Promise.resolve(parts);
  },
  getJSON: (p) => Promise.resolve(read(p.split('/').pop()))
});
function makeFetch() {
  return function (url) {
    const ok = (data) => Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
    return ok([]);
  };
}
function baseSandbox() {
  const storage = makeStorage();
  const doc = makeDocument();
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.console = console;
  sandbox.fetch = makeFetch();
  sandbox.AbortController = AbortController;
  sandbox.setTimeout = setTimeout;
  sandbox.clearTimeout = clearTimeout;
  sandbox.setInterval = setInterval;
  sandbox.clearInterval = clearInterval;
  sandbox.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  sandbox.addEventListener = () => {};
  sandbox.screen = { width: 1280, height: 800 };
  sandbox.document = doc;
  sandbox.localStorage = storage;
  sandbox.navigator = { userAgent: 'vaulty-routing-test', maxTouchPoints: 0 };
  sandbox.TV = TVSTUB(storage);
  vm.createContext(sandbox);
  return sandbox;
}
const GUIDE_FILES = ['ai-fallback.js', 'vaulty-memory.js', 'vaulty-learn.js', 'vaulty-research.js', 'vaulty-workshop.js', 'vaulty-live.js', 'vaulty-watch.js', 'vaulty-chips.js', 'vaulty-voice.js'];
function loadInto(sandbox, files) {
  files.forEach((f) => vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'), sandbox));
}
function cardMods(html) {
  if (!String(html).includes('vbc-grid')) return null;
  return [...String(html).matchAll(/<div class="vbc-mod">([^<]*)<\/div>/g)].map((m) => m[1]);
}
function observe(label, q, html) {
  console.log('\n### ' + label + ' :: ' + JSON.stringify(q));
  console.log(flat(html).slice(0, 420));
}

(async () => {
  const sandbox = baseSandbox();
  loadInto(sandbox, GUIDE_FILES);
  const TVAI = sandbox.TVAI;
  await TVAI._load();

  const POPULAR = 'most popular builds to get you started';

  /* ---- F6 FIRST (negative control, before any session context) ---- */
  const f6 = TVAI._answer('show me popular builds');
  if (OBSERVE) observe('F6', 'show me popular builds', f6);
  check('F6: item-less "show me popular builds" still serves the popular list',
    flat(f6).includes(POPULAR), flat(f6).slice(0, 200));

  /* ---- F1: the owner's exact failure ---- */
  const F1Q = 'Can you build me a general build for nyx';
  const f1 = TVAI._answer(F1Q);
  if (OBSERVE) observe('F1', F1Q, f1);
  const f1flat = flat(f1);
  const f1mods = cardMods(f1);
  check('F1: answer is about Nyx', f1flat.includes('Nyx'), f1flat.slice(0, 200));
  check('F1: renders a build card', !!f1mods);
  check('F1: exactly 8 mods on the card', !!f1mods && f1mods.length === 8,
    f1mods ? f1mods.join(' | ') : 'no card');
  check('F1: every mod is a real DB entry',
    !!f1mods && f1mods.every((m) => modByName.has(norm(m))),
    f1mods ? f1mods.filter((m) => !modByName.has(norm(m))).join(', ') : '');
  const f1str = f1mods ? 100 + f1mods.reduce((s, m) => s + strengthOf(m), 0) : 0;
  check('F1: summed Ability Strength >= 125% (Psychic Bolts full-strip breakpoint)',
    f1str >= 125, 'summed ' + f1str + '%');
  check('F1: strip breakpoint stated (Psychic Bolts + 125% + full strip)',
    f1flat.includes('Psychic Bolts') && f1flat.includes('125') && /full strip/i.test(f1flat),
    f1flat.slice(0, 300));
  check('F1: ZERO popular-list content', !f1flat.includes(POPULAR) && !f1flat.includes('One-Shot Steel Path Kuva Zarr'));

  /* ---- F2..F5: name variants ---- */
  const variants = [
    ['F2', 'saryn prime build', 'Saryn Prime'],
    ['F3', 'build for kuva zarr', 'Kuva Zarr'],
    ['F4', 'general build for wisp', 'Wisp'],
    ['F5', 'nyx build', 'Nyx']
  ];
  for (const [id, q, want] of variants) {
    const h = TVAI._answer(q);
    if (OBSERVE) observe(id, q, h);
    const hf = flat(h);
    check(id + ': "' + q + '" answers about ' + want, hf.includes(want), hf.slice(0, 160));
    check(id + ': not the popular list', !hf.includes(POPULAR));
    check(id + ': carries build content (card or mod rows)',
      !!cardMods(h) || (h.match(/class="mod-row"/g) || []).length >= 6 || hf.includes('ONE-SHOT'));
  }

  /* ---- S1: recommendation-shaped build ask ---- */
  const s1 = TVAI._answer('good build for nyx');
  if (OBSERVE) observe('S1', 'good build for nyx', s1);
  check('S1: "good build for nyx" answers about Nyx, not the list',
    flat(s1).includes('Nyx') && !flat(s1).includes(POPULAR), flat(s1).slice(0, 200));

  /* ---- S2: checker ask naming Nyx ---- */
  const S2Q = 'check my nyx build: Umbral Intensify, Primed Continuity, Stretch, Streamline, Vitality, Rolling Guard, Adaptation, Augur Secrets';
  const s2 = TVAI._answer(S2Q);
  if (OBSERVE) observe('S2', S2Q, s2);
  check('S2: checker handoff fires with item = Nyx (no "which item?" punt)',
    String(s2).includes('vai-checker-handoff') && String(s2).includes('Nyx') &&
    !flat(s2).includes('which item is it on'), String(s2).slice(0, 200));

  /* ---- S3: farm ask naming Nyx Prime in a longer subject ---- */
  const s3 = TVAI._answer('how do i get nyx prime');
  if (OBSERVE) observe('S3', 'how do i get nyx prime', s3);
  check('S3: farm answer is about Nyx Prime (relics), not a miss',
    flat(s3).includes('Nyx Prime') && /relic/i.test(flat(s3)) && !flat(s3).includes("couldn't find a farm spot"),
    flat(s3).slice(0, 200));

  /* ---- S4: general Steel Path ask naming Nyx ---- */
  const s4 = TVAI._answer('general steel path build for nyx');
  if (OBSERVE) observe('S4', 'general steel path build for nyx', s4);
  check('S4: answers with a Nyx build, not the generic Steel Path essay or the list',
    flat(s4).includes('Nyx') && (!!cardMods(s4) || (s4.match(/class="mod-row"/g) || []).length >= 6) &&
    !flat(s4).includes(POPULAR), flat(s4).slice(0, 200));

  /* ---- S5: creative ask naming Nyx reaches the Workshop ---- */
  const s5 = TVAI._answer('design a build for nyx');
  if (OBSERVE) observe('S5', 'design a build for nyx', s5);
  check('S5: Workshop handoff for Nyx',
    TVAI._workshopIsHandoff(s5) && String(s5).includes('Nyx'), String(s5).slice(0, 200));

  console.log('\n== test-routing: ' + pass + ' passed, ' + fail + ' failed ==');
  if (failures.length) console.log('failures:', failures.join(' | '));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
