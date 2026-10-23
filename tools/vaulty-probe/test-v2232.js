/* v2.23.2 fixtures: THE HONESTY PATCH.
   F1–F5  social inputs ("how are we", "hello vaulty", "thanks vaulty
          you're the best", "tell me a joke", "who are you") get social
          prose — varied, no don't-know, no research buttons — in the
          guide brain AND through the panel router (guide + AI paths).
   F6     simulated app version bump with the model cached → "AI ready
          on this device", zero download prompts (one-time law).
   F7     a different brain installed than the app ships today →
          OPTIONAL upgrade offer; the installed brain keeps serving;
          the swap happens only through the offer and the old cache
          entry is never wiped.
   F8     stored model id + empty cache (system eviction) → one honest
          line about storage, once per session, normal re-download box.
   F9     iPhone UA + passing GPU probe → capable, download offered;
          the decision path consults the probe, never platform strings.
   F10    adapter present but the probe fails → quick mode + one honest
          line, no prompt loop; the app stays fully usable.
   F11    two loads that died mid-load (guard corpses) → the AI
          auto-disables on that device with a plain explanation; quick
          mode carries on; a fresh session doesn't repeat the speech.
   F12    AI performance presets change the REAL engine config: the
          context window handed to WebLLM and the max_tokens of a chat.
   F13    a knob change marks the preset "Custom", persists in
          localStorage, and survives a simulated reload.
   F14    settings survive a simulated app version bump, applied.
   F15    battery rule: unplugged + "prefer cool on battery" → Cool
          parameters automatically (caps clamped, pacing on).

   Usage: node --experimental-vm-modules tools/vaulty-probe/test-v2232.js */
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
const MISS_RE = /don'?t know that one|isn'?t in the Vault'?s data/i;

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

/* ================= PART A: the guide brain ================= */
function makeElA() {
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
    querySelector(sel) { return subs[sel] || (subs[sel] = makeElA()); },
    querySelectorAll() { return []; }
  };
  return el;
}
function guideSandbox() {
  const storage = makeStorage();
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.console = console;
  sandbox.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
  sandbox.AbortController = AbortController;
  sandbox.setTimeout = setTimeout; sandbox.clearTimeout = clearTimeout;
  sandbox.setInterval = setInterval; sandbox.clearInterval = clearInterval;
  sandbox.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  sandbox.addEventListener = () => {};
  sandbox.screen = { width: 1280, height: 800 };
  sandbox.document = {
    addEventListener() {}, getElementById() { return null; },
    createElement() { return makeElA(); },
    body: makeElA(), head: { appendChild() {} }, execCommand() { return true; },
    visibilityState: 'visible'
  };
  sandbox.localStorage = storage;
  sandbox.navigator = { userAgent: 'vaulty-v2232-test', maxTouchPoints: 0 };
  sandbox.TV = TVSTUB();
  vm.createContext(sandbox);
  return sandbox;
}
const GUIDE_FILES = ['ai-fallback.js', 'vaulty-memory.js', 'vaulty-learn.js', 'vaulty-research.js', 'vaulty-workshop.js', 'vaulty-live.js', 'vaulty-watch.js', 'vaulty-chips.js', 'vaulty-voice.js'];
function loadGuide(sandbox, files) {
  files.forEach((f) => vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'), sandbox));
}

/* ================= PART B: the panel (persistence-style) ================= */
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
  remove() { this.removed = true; }
  focus() {}
}
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1';
const GPU_PASS = {
  requestAdapter: () => Promise.resolve({
    requestDevice: () => Promise.resolve({
      createShaderModule: () => ({ getCompilationInfo: () => Promise.resolve({ messages: [] }) }),
      destroy() {}
    })
  })
};
const GPU_FAIL_DEVICE = {
  requestAdapter: () => Promise.resolve({ requestDevice: () => Promise.reject(new Error('device refused')) })
};
function makeShared() {
  return {
    storage: makeStorage(),
    webllm: { cache: {}, engineMode: 'ok', createLog: [], chatLog: [], hasCalls: 0 }
  };
}
function makePage(shared, navOpts) {
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
  sandbox.screen = (navOpts && navOpts.screen) || { width: 1280, height: 800 };
  sandbox.navigator = Object.assign({
    userAgent: DESKTOP_UA, maxTouchPoints: 0, gpu: {},
    storage: {
      persisted: () => Promise.resolve(false),
      persist: () => Promise.resolve(true),
      estimate: () => Promise.resolve({ quota: 50 * 1e9, usage: 1e8 })
    }
  }, navOpts || {});
  sandbox.localStorage = shared.storage;
  sandbox.caches = {
    has: () => Promise.resolve(false),
    open: () => Promise.resolve({ keys: () => Promise.resolve([]) }),
    keys: () => Promise.resolve([]),
    delete: () => Promise.resolve(true)
  };
  sandbox.TV = TVSTUB();
  sandbox.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
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
        const pieces = ['Doing great, Tenno — ', 'circuits warm, ', 'opinions loaded. ◈'];
        let i = 0;
        return { next: async function () {
          if (i < pieces.length) return { done: false, value: { choices: [{ delta: { content: pieces[i++] } }] } };
          return { done: true, value: { choices: [{ delta: {} }] } };
        } };
      }
      return { choices: [{ message: { content: 'Model prose answer.' } }] };
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
const PANEL_FILES = ['vaulty-social.js', 'ai-fallback.js', 'ai.js'];
function botKids() {
  const msgs = registry['vai-msgs'];
  if (!msgs) return [];
  return msgs._kids.filter((k) => k && !k.removed && String(k.className || '').includes('bot'));
}
function botText() { return botKids().map((k) => flat(k.innerHTML)).join('\n'); }
function lastBotText() { const k = botKids(); return k.length ? flat(k[k.length - 1].innerHTML) : ''; }
function clearBots() { const msgs = registry['vai-msgs']; if (msgs) msgs._kids.length = 0; }
function status() { return registry['vai-status'] ? registry['vai-status'].textContent : ''; }
function dlVisible() { return !!registry['vai-dlbox'] && registry['vai-dlbox'].style.display === 'block'; }
async function openPanel(page) { page.TVAI.init(); page.TVAI.toggle(true); await tick(600); }

const SOCIAL_INPUTS = [
  ['F1', 'how are we'],
  ['F2', 'hello vaulty'],
  ['F3', "thanks vaulty you're the best"],
  ['F4', 'tell me a joke'],
  ['F5', 'who are you']
];

(async () => {
  /* ================= PART A: guide brain ================= */
  const G = guideSandbox();
  loadGuide(G, ['vaulty-social.js'].concat(GUIDE_FILES));
  const GAI = G.TVAI;
  await GAI._load();
  const TS = G.TVSocial;
  check('A: social categories classify the owner inputs',
    TS.category('how are we') === 'howareyou' && TS.category('hello vaulty') === 'greeting' &&
    TS.category("thanks vaulty you're the best") === 'thanks' && TS.category('tell me a joke') === 'joke' &&
    TS.category('who are you') === 'identity',
    [TS.category('how are we'), TS.category('hello vaulty'), TS.category('tell me a joke')].join(','));
  check('A: real questions are NOT swallowed by the social layer',
    TS.category('how are we farming argon crystals') === null &&
    TS.category("thanks, now what's a good saryn build") === null &&
    TS.category('what is a good saryn build') === null);
  for (const [id, q] of SOCIAL_INPUTS) {
    const a = flat(GAI._answer(q));
    check(id + ' (guide): social prose, no don\'t-know, no research buttons',
      a.length > 15 && !MISS_RE.test(a) && !/vai-research|Research on the/.test(a), a.slice(0, 140));
  }
  const greetSet = new Set(), howSet = new Set();
  for (let i = 0; i < 8; i++) { greetSet.add(GAI._answer('hello vaulty')); howSet.add(GAI._answer('how are we')); }
  check('F2 (guide): greeting replies vary', greetSet.size >= 2, String(greetSet.size));
  check('F1 (guide): "how are we" replies vary', howSet.size >= 2, String(howSet.size));

  /* ============ PART B1: panel, guide mode (iPhone, GPU passes) ============ */
  const sh1 = makeShared();
  const P1 = makePage(sh1, { userAgent: IPHONE_UA, maxTouchPoints: 5, gpu: GPU_PASS, screen: { width: 390, height: 844 } });
  loadPanel(P1, PANEL_FILES);
  await openPanel(P1);
  for (const [id, q] of SOCIAL_INPUTS) {
    clearBots();
    P1.TVAI._ask(q);
    await tick(500);
    const a = lastBotText();
    check(id + ' (panel, guide mode): social prose, no don\'t-know, no research',
      a.length > 15 && !MISS_RE.test(a) && !/Research on the/.test(a), a.slice(0, 140));
  }

  /* ============ PART B2: panel, AI mode — the model gets first crack ============ */
  const sh2 = makeShared();
  const DESK = P1.TVAI._models.desktop;
  const SMALL = P1.TVAI._models.small;
  sh2.webllm.cache[DESK] = true;
  const P2 = makePage(sh2, {});
  loadPanel(P2, PANEL_FILES);
  await openPanel(P2);
  check('B2: engine loaded from cache on open', sh2.webllm.createLog.length === 1 && sh2.webllm.createLog[0].id === DESK,
    JSON.stringify(sh2.webllm.createLog));
  for (const [id, q] of SOCIAL_INPUTS) {
    const before = sh2.webllm.chatLog.length;
    clearBots();
    P2.TVAI._ask(q);
    await tick(500);
    const a = lastBotText();
    check(id + ' (panel, AI mode): the loaded model answers the chat itself',
      sh2.webllm.chatLog.length === before + 1 && /Doing great, Tenno/.test(a) && !MISS_RE.test(a), a.slice(0, 140));
  }
  check('B2: the model was handed the Vaulty persona (system prompt rides along)',
    sh2.webllm.chatLog.length > 0 && sh2.webllm.chatLog[0].messages[0].role === 'system' &&
    /Vault Guide/.test(sh2.webllm.chatLog[0].messages[0].content));

  /* ============ F6: version bump, model cached → ready, no prompt ============ */
  const P2b = makePage(sh2, {}); /* same device storage+cache, brand-new app code = the update */
  loadPanel(P2b, PANEL_FILES);
  await openPanel(P2b);
  check('F6: after the update the engine loads from the device again', sh2.webllm.createLog.length === 2,
    String(sh2.webllm.createLog.length));
  check('F6: status "AI ready on this device", no download prompt after a version bump',
    status() === 'AI ready on this device' && !dlVisible(), status());

  /* ============ F7: different brain installed → optional upgrade ============ */
  const sh7 = makeShared();
  sh7.webllm.cache[SMALL] = true;
  sh7.storage.setItem('tv-ai-model', SMALL);
  const P7 = makePage(sh7, {});
  loadPanel(P7, PANEL_FILES);
  await openPanel(P7);
  check('F7: the installed (smaller) brain is the one that loads and serves',
    sh7.webllm.createLog.length === 1 && sh7.webllm.createLog[0].id === SMALL &&
    sh7.storage.getItem('tv-ai-model') === SMALL, JSON.stringify(sh7.webllm.createLog));
  check('F7: the difference is an OPTIONAL upgrade offer (current brain keeps working)',
    /Optional/.test(botText()) && /keeps working either way/.test(botText()) && /vai-upgrade-btn/.test(botKids().map((k) => k.innerHTML).join('')),
    botText().slice(0, 200));
  clearBots();
  P7.TVAI._ask('hello vaulty');
  await tick(500);
  check('F7: the installed brain still answers while the offer sits there',
    /Doing great, Tenno/.test(lastBotText()), lastBotText().slice(0, 120));
  P7.TVAI._startUpgrade();
  await tick(600);
  check('F7: accepting the offer installs the new brain and only then switches to it',
    sh7.webllm.createLog.length === 2 && sh7.webllm.createLog[1].id === DESK &&
    sh7.storage.getItem('tv-ai-model') === DESK, JSON.stringify(sh7.webllm.createLog));
  check('F7: the old brain was never wiped from the cache', sh7.webllm.cache[SMALL] === true);

  /* ============ F8: evicted cache → honest line, once ============ */
  const sh8 = makeShared();
  sh8.storage.setItem('tv-ai-model', DESK); /* it WAS installed… */
  /* …but the cache is empty: the system cleared it for space */
  const P8 = makePage(sh8, {});
  loadPanel(P8, PANEL_FILES);
  await openPanel(P8);
  const evictCount = (botText().match(/cleared from this device to free up space/g) || []).length;
  check('F8: eviction is named honestly, exactly once, with the download offered (not forced)',
    evictCount === 1 && /not an update/.test(botText()) && dlVisible() && status() === 'AI not downloaded',
    'count=' + evictCount + ' status=' + status());
  P8.TVAI.toggle(false); P8.TVAI.toggle(true);
  await tick(400);
  const evictCount2 = (botText().match(/cleared from this device to free up space/g) || []).length;
  check('F8: no repeat prompt within the session', evictCount2 === 1, 'count=' + evictCount2);

  /* ============ F9: iPhone + passing probe → capable, offered ============ */
  const cap9 = await P1.TVAI._capabilityAsync();
  check('F9: iPhone UA + passing GPU probe → capable, phone-class tier, probe consulted',
    cap9.ok === true && cap9.tier === 'mobile' && cap9.gpu === 'pass', JSON.stringify(cap9));
  const aiSrc = fs.readFileSync(path.join(ROOT, 'js', 'ai.js'), 'utf8');
  check('F9: no platform gate remains anywhere in the decision path',
    !/isIOS\(|guideOnly|GUIDE_ONLY_STATUS/.test(aiSrc) && !/'ios'/.test(P1.TVAI._capability.toString()));
  clearBots();
  P1.TVAI._ask('download the ai');
  await tick(700);
  check('F9: on the iPhone the download is actually offered (box shown)',
    dlVisible() || /Download Vaulty AI/.test(botText()), botText().slice(0, 160));

  /* ============ F10: adapter present, probe fails → quick mode, once ============ */
  const sh10 = makeShared();
  const P10 = makePage(sh10, { userAgent: IPHONE_UA, maxTouchPoints: 5, gpu: GPU_FAIL_DEVICE, screen: { width: 390, height: 844 } });
  loadPanel(P10, PANEL_FILES);
  await openPanel(P10);
  const incapableCount = (botText().match(/can'?t run here/g) || []).length;
  check('F10: probe failure → honest one-liner, quick mode, no download box',
    incapableCount === 1 && /GPU refused/.test(botText()) && !dlVisible(), botText().slice(0, 220));
  P10.TVAI.toggle(false); P10.TVAI.toggle(true);
  await tick(400);
  check('F10: the honest line never repeats / never loops',
    (botText().match(/can'?t run here/g) || []).length === 1);
  clearBots();
  P10.TVAI._ask('hello vaulty');
  await tick(500);
  check('F10: the app stays fully usable in quick mode', lastBotText().length > 10 && !MISS_RE.test(lastBotText()),
    lastBotText().slice(0, 120));

  /* ============ F11: repeated mid-load deaths → auto-disable ============ */
  const sh11 = makeShared();
  sh11.webllm.cache[DESK] = true;
  sh11.storage.setItem('tv-ai-load-guard', 'loading'); /* corpse #1 */
  const P11a = makePage(sh11, {});
  loadPanel(P11a, PANEL_FILES);
  await openPanel(P11a);
  check('F11: first mid-load death settles (guard failed), AI not yet disabled',
    sh11.storage.getItem('tv-ai-load-guard') === 'failed' && sh11.storage.getItem('tv-ai-off') === null &&
    P11a.TVAI._crashCount() === 1, 'crashes=' + P11a.TVAI._crashCount());
  sh11.storage.setItem('tv-ai-load-guard', 'loading'); /* corpse #2 */
  const P11b = makePage(sh11, {});
  loadPanel(P11b, PANEL_FILES);
  await openPanel(P11b);
  check('F11: second mid-load death → AI auto-disables on this device, with the plain explanation',
    sh11.storage.getItem('tv-ai-off') === '1' && sh11.storage.getItem('tv-ai-disabled') === '1' &&
    /kept dying while it loaded/.test(botText()) && /off on this device/.test(status()),
    'off=' + sh11.storage.getItem('tv-ai-off') + ' status=' + status());
  clearBots();
  P11b.TVAI._ask('hello vaulty');
  await tick(500);
  check('F11: quick mode still answers socially after the disable', lastBotText().length > 10 && !MISS_RE.test(lastBotText()),
    lastBotText().slice(0, 120));
  const P11c = makePage(sh11, {});
  loadPanel(P11c, PANEL_FILES);
  await openPanel(P11c);
  check('F11: a fresh session does not repeat the disable speech',
    !/kept dying while it loaded/.test(botText()) && /off on this device/.test(status()), status());

  /* ============ F12: presets change the real engine config ============ */
  const sh12 = makeShared();
  sh12.webllm.cache[DESK] = true;
  const P12a = makePage(sh12, {});
  loadPanel(P12a, PANEL_FILES);
  await openPanel(P12a);
  check('F12: default (Balanced) hands WebLLM the desktop-medium context',
    sh12.webllm.createLog.length === 1 && sh12.webllm.createLog[0].chatOpts &&
    sh12.webllm.createLog[0].chatOpts.context_window_size === 3072, JSON.stringify(sh12.webllm.createLog));
  P12a.TVAI._applyPreset('cool');
  check('F12: Cool & quiet persists as a preset', P12a.TVAI._settings().preset === 'cool');
  const P12b = makePage(sh12, {});
  loadPanel(P12b, PANEL_FILES);
  await openPanel(P12b);
  const lastCreate12 = sh12.webllm.createLog[sh12.webllm.createLog.length - 1];
  check('F12: after Cool, the engine is created with the small context',
    lastCreate12.chatOpts && lastCreate12.chatOpts.context_window_size === 2048, JSON.stringify(lastCreate12));
  clearBots();
  P12b.TVAI._ask('hello vaulty');
  await tick(500);
  const chatCool = sh12.webllm.chatLog[sh12.webllm.chatLog.length - 1];
  check('F12: Cool caps the reply length (max_tokens 350) and paces generation',
    chatCool && chatCool.max_tokens === 350 && P12b.TVAI._effParams().pacingMs === 40,
    chatCool && String(chatCool.max_tokens));
  P12b.TVAI._applyPreset('max');
  const P12c = makePage(sh12, {});
  loadPanel(P12c, PANEL_FILES);
  await openPanel(P12c);
  const lastCreate12c = sh12.webllm.createLog[sh12.webllm.createLog.length - 1];
  clearBots();
  P12c.TVAI._ask('hello vaulty');
  await tick(500);
  const chatMax = sh12.webllm.chatLog[sh12.webllm.chatLog.length - 1];
  check('F12: Max power = largest context, longest cap, no pacing',
    lastCreate12c.chatOpts.context_window_size === 4096 && chatMax.max_tokens === 1200 &&
    P12c.TVAI._effParams().pacingMs === 0, JSON.stringify(lastCreate12c.chatOpts));

  /* ============ F13: knob → Custom, persists across reload ============ */
  const sh13 = makeShared();
  sh13.webllm.cache[DESK] = true;
  const P13a = makePage(sh13, {});
  loadPanel(P13a, PANEL_FILES);
  await openPanel(P13a);
  P13a.TVAI._knobChanged('reply', 'long');
  const saved13 = JSON.parse(sh13.storage.getItem('tv-ai-settings') || '{}');
  check('F13: changing a knob marks the preset Custom and persists it',
    P13a.TVAI._settings().preset === 'custom' && saved13.preset === 'custom' && saved13.reply === 'long',
    JSON.stringify(saved13));
  const P13b = makePage(sh13, {});
  loadPanel(P13b, PANEL_FILES);
  await openPanel(P13b);
  check('F13: after a reload the panel shows Custom and the knob value survived',
    /Custom/.test(registry['vai-perf-preset'].textContent) && P13b.TVAI._settings().reply === 'long',
    registry['vai-perf-preset'] && registry['vai-perf-preset'].textContent);
  clearBots();
  P13b.TVAI._ask('hello vaulty');
  await tick(500);
  const chat13 = sh13.webllm.chatLog[sh13.webllm.chatLog.length - 1];
  check('F13: the persisted custom cap is what the engine actually gets',
    chat13 && chat13.max_tokens === 1200, chat13 && String(chat13.max_tokens));

  /* ============ F14: settings survive a version bump ============ */
  const P13c = makePage(sh13, {}); /* the "updated app" over the same device */
  loadPanel(P13c, PANEL_FILES);
  await openPanel(P13c);
  const lastCreate14 = sh13.webllm.createLog[sh13.webllm.createLog.length - 1];
  check('F14: version bump does not reset settings; they are applied at load',
    P13c.TVAI._settings().preset === 'custom' && P13c.TVAI._settings().reply === 'long' &&
    lastCreate14.chatOpts.context_window_size === 3072, JSON.stringify(P13c.TVAI._settings()));

  /* ============ F15: battery rule ============ */
  const sh15 = makeShared();
  sh15.webllm.cache[DESK] = true;
  const P15 = makePage(sh15, {
    getBattery: () => Promise.resolve({ charging: false, level: 0.4, addEventListener() {} })
  });
  loadPanel(P15, PANEL_FILES);
  await openPanel(P15);
  await tick(120); /* let the battery state land */
  P15.TVAI._knobChanged('batteryCool', true);
  const eff15 = P15.TVAI._effParams();
  check('F15: unplugged + prefer-cool-on-battery → Cool parameters automatically',
    eff15.batteryCool === true && eff15.maxTokens === 350 && eff15.contextSize === 2048 && eff15.pacingMs === 40,
    JSON.stringify(eff15));

  console.log('\n== v2.23.2 fixtures: ' + pass + ' passed, ' + fail + ' failed ==');
  if (failures.length) console.log('FAILURES:\n - ' + failures.join('\n - '));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
