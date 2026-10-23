/* v2.23.3 fixtures: VAULTY ANSWERS IN GENERAL — not just from the
   Vault's database (owner directive, Oct 23).
   F1     the owner's exact failure — "where would be the best place
          to farm" — is fixture #1: the guide answers it (general
          best-farm answer), never the don't-know wall.
   A      farm phrasings (8) × in-DB items (resource / mod / frame):
          every phrasing reaches the Vault's farm data — no miss.
   B      farm phrasings (8) × an out-of-DB item (Vainthorn — a real
          resource with zero Vault data): the guide returns the farm
          MISS signature (never the don't-know wall), subjectOf
          reduces every phrasing to the item, and the panel dig
          (LIVE network) auto-researches it into an answer naming
          the real farm spot — no tap, no wall, no general label.
   C      AI mode (fake engine): 4 general questions the Vault and
          research can't cover → the model answers from general
          knowledge WITH the honest label ("From my general
          knowledge (not Vault data)"), after a GENERAL KNOWLEDGE
          MODE prompt; a researched farm answer carries the
          "Researched just now" line and NOT the general label; a
          build question never gets a general-knowledge answer.

   Usage: node --experimental-vm-modules tools/vaulty-probe/test-v2233.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const SITE = path.join(ROOT, 'data', 'site');
const read = (f) => JSON.parse(fs.readFileSync(path.join(SITE, f), 'utf8'));

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { pass++; console.log('PASS', name); }
  else { fail++; failures.push(name); console.log('FAIL', name, extra ? ':: ' + extra : ''); }
}
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 30));
const flat = (h) => String(h || '').replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&rsquo;/g, "'").replace(/\s+/g, ' ');
const WALL_RE = /don'?t know that one/i;
const FARM_MISS_RE = /couldn'?t find a farm spot/i;
const GENERAL_LABEL = 'From my general knowledge (not Vault data)';

function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    _map: map
  };
}
const TVSTUB = () => ({
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

/* ================= guide-brain sandbox (Parts A + B) ================= */
function guideSandbox(fetchImpl) {
  const store = {};
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.console = console;
  sandbox.fetch = fetchImpl || fetch;
  sandbox.AbortController = AbortController;
  sandbox.setTimeout = setTimeout;
  sandbox.clearTimeout = clearTimeout;
  sandbox.document = {
    addEventListener() {},
    getElementById() { return null; },
    createElement() {
      return {
        style: {}, className: '', innerHTML: '', textContent: '',
        classList: { add() {}, toggle() {} }, appendChild() {},
        querySelector() { return null; }, querySelectorAll() { return []; },
        addEventListener() {}, setAttribute() {}, parentNode: null
      };
    },
    body: { appendChild() {} },
    head: { appendChild() {} }
  };
  sandbox.navigator = { userAgent: 'vaulty-test-v2233' };
  sandbox.localStorage = {
    getItem(k) { return k in store ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; }
  };
  sandbox.TV = TVSTUB();
  vm.createContext(sandbox);
  for (const f of ['vaulty-social.js', 'vaulty-research.js', 'ai-fallback.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'), sandbox);
  }
  return sandbox;
}

const PHRASINGS = [
  (x) => `where would be the best place to farm ${x}`,
  (x) => `what is the best place to farm ${x}`,
  (x) => `best place to farm ${x}`,
  (x) => `where does ${x} drop`,
  (x) => `what drops ${x}`,
  (x) => `where can i farm ${x}`,
  (x) => `how can i get ${x}`,
  (x) => `where's the best spot to farm ${x}`
];
const IN_DB = [
  ['argon crystals', /Argon Crystals/],
  ['condition overload', /Condition Overload/],
  ['nyx prime', /Nyx Prime/]
];

/* ================= AI panel sandbox (Part C) ================= */
let registry = {};
class FakeEl {
  constructor(tag) {
    this.tagName = tag || 'div';
    this.style = {};
    this.children = {};
    this._kids = [];
    this.classList = {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      toggle(c, f) { if (f === undefined) f = !this._s.has(c); f ? this._s.add(c) : this._s.delete(c); },
      contains(c) { return this._s.has(c); }
    };
    this.textContent = '';
    this.value = '';
    this.scrollTop = 0; this.scrollHeight = 999;
    this._html = '';
  }
  set innerHTML(html) {
    this._html = html;
    const ids = [...String(html).matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
    ids.forEach((id) => { const el = new FakeEl('div'); registry[id] = el; this.children['#' + id] = el; });
  }
  get innerHTML() { return this._html; }
  querySelector(sel) { return this.children[sel] || registry[sel.replace('#', '')] || null; }
  querySelectorAll() { return []; }
  addEventListener() {}
  appendChild(c) { this._kids.push(c); if (c) c.parentNode = this; return c; }
  removeChild(c) { const i = this._kids.indexOf(c); if (i >= 0) this._kids.splice(i, 1); if (c) c.parentNode = null; return c; }
  remove() { this.removed = true; if (this.parentNode) this.parentNode.removeChild(this); }
  focus() {}
}
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36';
function makeShared() {
  return { storage: makeStorage(), webllm: { cache: {}, engineMode: 'ok', createLog: [], chatLog: [], hasCalls: 0 } };
}
function makePage(shared, fetchImpl) {
  registry = {};
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.console = console;
  sandbox.setTimeout = setTimeout;
  sandbox.clearTimeout = clearTimeout;
  sandbox.setInterval = setInterval;
  sandbox.clearInterval = clearInterval;
  sandbox.requestAnimationFrame = (fn) => { try { fn(); } catch (e) {} return 0; };
  sandbox.CustomEvent = class { constructor(type) { this.type = type; } };
  sandbox.addEventListener = () => {};
  sandbox.removeEventListener = () => {};
  sandbox.document = {
    addEventListener() {},
    dispatchEvent() { return true; },
    getElementById(id) { return registry[id] || null; },
    createElement(tag) { return new FakeEl(tag); },
    body: new FakeEl('body'),
    head: new FakeEl('head'),
    visibilityState: 'visible'
  };
  sandbox.screen = { width: 1280, height: 800 };
  sandbox.navigator = {
    userAgent: DESKTOP_UA, maxTouchPoints: 0, gpu: {},
    storage: {
      persisted: () => Promise.resolve(false),
      persist: () => Promise.resolve(true),
      estimate: () => Promise.resolve({ quota: 50 * 1e9, usage: 1e8 })
    }
  };
  sandbox.localStorage = shared.storage;
  sandbox.caches = {
    has: () => Promise.resolve(false),
    open: () => Promise.resolve({ keys: () => Promise.resolve([]) }),
    keys: () => Promise.resolve([]),
    delete: () => Promise.resolve(true)
  };
  sandbox.TV = TVSTUB();
  sandbox.fetch = fetchImpl;
  sandbox.__WEBLLM__ = shared.webllm;
  vm.createContext(sandbox);
  return sandbox;
}
const WEBLLM_FAKE = `
export async function hasModelInCache(id) {
  const W = globalThis.__WEBLLM__;
  W.hasCalls = (W.hasCalls || 0) + 1;
  return !!(W.cache && W.cache[id]);
}
export async function CreateMLCEngine(id, cfg, chatOpts) {
  const W = globalThis.__WEBLLM__;
  W.createLog.push({ id: id, chatOpts: chatOpts || null });
  if (cfg && cfg.initProgressCallback) cfg.initProgressCallback({ progress: 1, text: 'done' });
  if (W.engineMode === 'reject') throw new Error('simulated load failure');
  W.cache[id] = true;
  return {
    unload: function () {},
    chat: { completions: { create: async function (opts) {
      W.chatLog.push(opts);
      if (opts.stream) {
        const pieces = ['Streamed answer.'];
        let i = 0;
        return { next: async function () {
          if (i < pieces.length) return { done: false, value: { choices: [{ delta: { content: pieces[i++] } }] } };
          return { done: true, value: { choices: [{ delta: {} }] } };
        } };
      }
      const sysC = (opts.messages && opts.messages[0] && opts.messages[0].content) || '';
      const usrC = (opts.messages && opts.messages[1] && opts.messages[1].content) || '';
      if (sysC.indexOf('RESEARCH MODE') !== -1) {
        /* a competent model writes from the facts it was handed */
        const dm = usrC.match(/drops: ([^\\n]*)/i);
        return { choices: [{ message: { content: dm ? ('Best farm: ' + dm[1].trim()) : 'Researched answer from the facts.' } }] };
      }
      return { choices: [{ message: { content: 'A leap year has 366 days — the extra day is February 29, added because Earth\\'s orbit takes about 365.25 days.' } }] };
    } } }
  };
}`;
let currentContext = null;
async function importModuleDynamically(specifier) {
  if (!/web-llm/.test(specifier)) throw new Error('unexpected import: ' + specifier);
  const mod = new vm.SourceTextModule(WEBLLM_FAKE, { identifier: specifier, context: currentContext });
  await mod.link(() => { throw new Error('no nested imports'); });
  await mod.evaluate();
  return mod;
}
function loadPanel(sandbox, files) {
  currentContext = sandbox;
  const opts = { importModuleDynamically };
  files.forEach((f) => vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'), sandbox, opts));
}
const PANEL_FILES = ['vaulty-social.js', 'vaulty-research.js', 'ai-fallback.js', 'ai.js'];
function botKids() {
  const msgs = registry['vai-msgs'];
  if (!msgs) return [];
  return msgs._kids.filter((k) => k && !k.removed && String(k.className || '').includes('bot'));
}
function lastBotText() { const k = botKids(); return k.length ? flat(k[k.length - 1].innerHTML) : ''; }
function clearBots() { const msgs = registry['vai-msgs']; if (msgs) msgs._kids.length = 0; }
async function openPanel(page) { page.TVAI.init(); page.TVAI.toggle(true); await tick(700); }

/* empty research world: every fetch returns an empty JSON array */
const EMPTY_FETCH = () => Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
/* canned research world for Vainthorn (real payloads, trimmed) */
function farmFetch(url) {
  const u = String(url);
  const json = (v) => Promise.resolve({ ok: true, json: () => Promise.resolve(v) });
  if (u.indexOf('api.warframestat.us') !== -1) {
    return json([{
      name: 'Vainthorn',
      description: 'A jagged thorn from an extinct rose. Location: Abyssal Zone on Ceres (requires Abyssal Beacons to access).',
      drops: [{ location: 'Abyssal Beacon, Rotation C', chance: 33.3 }]
    }]);
  }
  if (u.indexOf('wiki.warframe.com') !== -1) {
    if (u.indexOf('opensearch') !== -1) return json(['vainthorn', ['Vainthorn'], [''], ['https://wiki.warframe.com/w/Vainthorn']]);
    if (u.indexOf('prop=links') !== -1) return json({ query: { pages: { 1: { links: [] } } } });
    if (u.indexOf('prop=extracts') !== -1) {
      return json({ query: { pages: { 1: { extract: 'Vainthorn is a special resource from the Abyssal Zone used in Dagath\'s construction. Vainthorn drops from Abyssal Beacon missions on Ceres, Rotation C.' } } } });
    }
  }
  return json([]);
}

const GENERAL_QS = [
  'how many days are in a leap year',
  'what is the capital of japan',
  'who wrote romeo and juliet',
  'how many continents are there on earth'
];

(async () => {
  /* ================= PART A: guide brain ================= */
  const S = guideSandbox();
  const G = S.TVAI, R = S.TVResearch;
  await G._load();

  const f1 = flat(G._answer('where would be the best place to farm'));
  check('F1 (owner exact): bare best-place farm question gets the general farm answer, not the wall',
    !WALL_RE.test(f1) && /Gabii/.test(f1) && /Helene/.test(f1), f1.slice(0, 160));

  for (const [item, marker] of IN_DB) {
    PHRASINGS.forEach((ph, i) => {
      const q = ph(item);
      const html = G._answer(q);
      check(`A${i + 1} in-DB [${item}]: "${q}" answered from Vault farm data`,
        !R.isMiss(html) && marker.test(html) && /Farm/.test(html), flat(html).slice(0, 120));
    });
  }
  PHRASINGS.forEach((ph, i) => {
    const q = ph('vainthorn');
    const html = G._answer(q);
    check(`B${i + 1} out-of-DB: "${q}" returns the farm-miss signature, never the don't-know wall`,
      R.isMiss(html) && FARM_MISS_RE.test(html) && !WALL_RE.test(html), flat(html).slice(0, 120));
    check(`B${i + 1} out-of-DB: subjectOf reduces the phrasing to the item`,
      R.subjectOf(q) === 'vainthorn', R.subjectOf(q));
  });
  check('units: subjectOf keeps the classic phrasings intact',
    R.subjectOf('where do i farm argon crystals') === 'argon crystals' &&
    R.subjectOf('how do i get a necramech') === 'necramech' &&
    R.subjectOf('how does corrosive work') === 'corrosive');
  check('units: isFarmQuestion separates farm intent from general questions',
    R._isFarm('where would be the best place to farm vainthorn') === true &&
    R._isFarm('where does vainthorn drop') === true &&
    R._isFarm('who is the stalker') === false &&
    R._isFarm('what is overguard') === false);

  /* ================= PART B: panel dig, live network ================= */
  for (const q of ['where would be the best place to farm vainthorn', 'where does vainthorn drop']) {
    const missHtml = G._answer(q);
    const finalHtml = await new Promise((resolve) => {
      const msgsEl = { appendChild() {}, scrollTop: 0, scrollHeight: 100 };
      R.handleConverse(q, missHtml, msgsEl, resolve, { isMiss: true });
    });
    const a = flat(finalHtml);
    check(`B-live: "${q}" auto-researches to the real farm spot (no tap, no wall, no general label)`,
      !WALL_RE.test(a) && /Abyssal Beacon/.test(a) && /Researched just now/.test(a) && a.indexOf(GENERAL_LABEL) === -1,
      a.slice(0, 220));
  }

  /* ================= PART C: AI mode ================= */
  /* C0: read the desktop model id from a guide-mode page */
  const shG = makeShared();
  const PG = makePage(shG, EMPTY_FETCH);
  loadPanel(PG, PANEL_FILES);
  await openPanel(PG);
  const DESK = PG.TVAI._models.desktop;

  /* C1: general questions — empty research world, model answers labeled */
  const sh1 = makeShared();
  sh1.webllm.cache[DESK] = true;
  const P1 = makePage(sh1, EMPTY_FETCH);
  loadPanel(P1, PANEL_FILES);
  await openPanel(P1);
  check('C1: engine loaded from cache', sh1.webllm.createLog.length === 1, JSON.stringify(sh1.webllm.createLog));
  for (let i = 0; i < GENERAL_QS.length; i++) {
    const q = GENERAL_QS[i];
    const before = sh1.webllm.chatLog.length;
    clearBots();
    P1.TVAI._ask(q);
    await tick(1200);
    const a = lastBotText();
    const newCalls = sh1.webllm.chatLog.slice(before);
    check(`C1.${i + 1} general question answered from general knowledge WITH the label: "${q}"`,
      a.indexOf(GENERAL_LABEL) !== -1 && !WALL_RE.test(a) && a.indexOf('Researched just now') === -1,
      a.slice(0, 200));
    check(`C1.${i + 1} the model was asked in GENERAL KNOWLEDGE MODE (not from facts)`,
      newCalls.length === 1 && /GENERAL KNOWLEDGE MODE/.test(newCalls[0].messages[0].content),
      newCalls.length + ' calls');
  }

  /* C2: researched farm answer — researched label, NOT the general label */
  const sh2 = makeShared();
  sh2.webllm.cache[DESK] = true;
  const P2 = makePage(sh2, farmFetch);
  loadPanel(P2, PANEL_FILES);
  await openPanel(P2);
  clearBots();
  P2.TVAI._ask('where would be the best place to farm vainthorn');
  await tick(1200);
  const a2 = lastBotText();
  check('C2: out-of-DB farm question in AI mode answers from RESEARCH (Abyssal Beacon), sources labeled',
    /Abyssal Beacon/.test(a2) && /Researched just now/.test(a2) && a2.indexOf(GENERAL_LABEL) === -1 && !WALL_RE.test(a2),
    a2.slice(0, 220));

  /* C3: build safety — a build question never gets a general-knowledge answer */
  clearBots();
  P2.TVAI._ask('make me a nyx build');
  await tick(900);
  const a3 = lastBotText();
  check('C3: build question routes to the engine — no general-knowledge label',
    a3.indexOf(GENERAL_LABEL) === -1 && /Nyx/.test(a3), a3.slice(0, 160));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (failures.length) console.log('failures:', failures.join(' | '));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('test crashed:', e); process.exit(1); });
