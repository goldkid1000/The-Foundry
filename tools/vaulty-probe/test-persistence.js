/* v2.20.0 regression test: the on-device AI model must NEVER be
   re-offered for download on a device that already has it — including
   across app updates. Loads the REAL js/ai.js (+ guide brain) in a Node
   vm; the web-llm module is faked through importModuleDynamically, the
   Cache Storage / localStorage stubs are shared between two simulated
   page loads (load 2 = "the updated app"), and the download box's
   visibility is asserted at each step. A negative control (no model in
   cache) proves the harness can see the prompt when it SHOULD appear.

   Usage: node --experimental-vm-modules tools/vaulty-probe/test-persistence.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const SITE = path.join(ROOT, 'data', 'site');
const read = (f) => JSON.parse(fs.readFileSync(path.join(SITE, f), 'utf8'));

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('PASS', name); }
  else { fail++; console.log('FAIL', name, extra ? ':: ' + extra : ''); }
}
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 250));

/* ---------- fake DOM (just enough for js/ai.js) ---------- */
let registry = {};
class FakeEl {
  constructor(tag) {
    this.tagName = tag || 'div';
    this.style = {};
    this.children = {};
    this.classList = {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      toggle(c, f) { if (f === undefined) f = !this._s.has(c); f ? this._s.add(c) : this._s.delete(c); },
      contains(c) { return this._s.has(c); },
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
    if (/class="vai-chips"/.test(html)) {
      const chips = new FakeEl('div');
      chips.querySelector = () => null;
      chips.insertBefore = (node) => { chips._inserted = node; };
      Object.defineProperty(chips, 'firstChild', { get: () => null });
      this.children['.vai-chips'] = chips;
    }
  }
  get innerHTML() { return this._html; }
  querySelector(sel) { return this.children[sel] || registry[sel.replace('#', '')] || null; }
  querySelectorAll() { return []; }
  addEventListener() {}
  appendChild() {}
  remove() { this.removed = true; }
  focus() {}
}

function makePage(shared) {
  registry = {};
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.console = console;
  sandbox.setTimeout = setTimeout;
  sandbox.clearTimeout = clearTimeout;
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
  };
  sandbox.navigator = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0',
    maxTouchPoints: 0,
    gpu: {}, /* WebGPU present → NOT guide-only */
    storage: { persisted: () => Promise.resolve(false), persist: () => Promise.resolve(true) },
  };
  sandbox.localStorage = shared.localStorage;
  sandbox.caches = shared.caches;
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
  sandbox.__MODEL_CACHED__ = shared.modelCached;
  vm.createContext(sandbox);
  return sandbox;
}

const WEBLLM_FAKE = `
export async function hasModelInCache(id) {
  globalThis.__hasModelCalls = (globalThis.__hasModelCalls || 0) + 1;
  return globalThis.__MODEL_CACHED__ === true;
}
export async function CreateMLCEngine(id, opts) {
  globalThis.__engineLoads = (globalThis.__engineLoads || 0) + 1;
  if (opts && opts.initProgressCallback) opts.initProgressCallback({ progress: 1, text: 'done' });
  return { chat: { completions: { create: async function () { throw new Error('unused in test'); } } } };
}`;

/* the fake module MUST share the page's vm context, or its globalThis
   is the harness process's and the __MODEL_CACHED__ flag is invisible.
   referrer.context is unreliable across Node versions, so the harness
   tracks the active page context explicitly (loads are sequential). */
let currentContext = null;
async function importModuleDynamically(specifier) {
  if (!/web-llm/.test(specifier)) throw new Error('unexpected import: ' + specifier);
  const mod = new vm.SourceTextModule(WEBLLM_FAKE, { identifier: specifier, context: currentContext });
  await mod.link(() => { throw new Error('no nested imports'); });
  await mod.evaluate();
  return mod;
}

function loadScripts(sandbox) {
  currentContext = sandbox;
  const opts = { importModuleDynamically };
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'ai-fallback.js'), 'utf8'), sandbox, opts);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'ai.js'), 'utf8'), sandbox, opts);
}

function makeShared(modelCached) {
  const store = {};
  return {
    modelCached,
    localStorage: {
      getItem(k) { return k in store ? store[k] : null; },
      setItem(k, v) { store[k] = String(v); },
      removeItem(k) { delete store[k]; },
    },
    caches: {
      has: (name) => Promise.resolve(modelCached && name === 'webllm/model'),
      open: () => Promise.resolve({ keys: () => Promise.resolve(modelCached ? [{}] : []) }),
      keys: () => Promise.resolve(modelCached ? ['foundry-v2.19.5', 'webllm/model', 'webllm/config'] : ['foundry-v2.19.5']),
      delete: () => Promise.resolve(true),
    },
  };
}

(async () => {
  /* ===== scenario 1: model already on device, then an APP UPDATE ===== */
  const shared = makeShared(true);

  let page = makePage(shared);
  loadScripts(page);
  page.TVAI.init();
  page.TVAI.toggle(true);
  await tick(400);
  check('load 1: cache check consulted', (page.__hasModelCalls || 0) >= 1, String(page.__hasModelCalls));
  check('load 1: engine loaded from device', (page.__engineLoads || 0) >= 1, String(page.__engineLoads));
  check('load 1: NO download prompt', !registry['vai-dlbox'] || registry['vai-dlbox'].style.display !== 'block',
    registry['vai-dlbox'] && registry['vai-dlbox'].style.display);
  check('load 1: status says "AI ready on this device"',
    !!registry['vai-status'] && registry['vai-status'].textContent === 'AI ready on this device',
    registry['vai-status'] && registry['vai-status'].textContent);

  /* app update: brand-new page (fresh code, same device storage) */
  page = makePage(shared);
  loadScripts(page);
  page.TVAI.init();
  page.TVAI.toggle(true);
  await tick(400);
  check('after update: engine loaded from device again', (page.__engineLoads || 0) >= 1, String(page.__engineLoads));
  check('after update: STILL no download prompt', !registry['vai-dlbox'] || registry['vai-dlbox'].style.display !== 'block',
    registry['vai-dlbox'] && registry['vai-dlbox'].style.display);
  check('after update: status still "AI ready on this device"',
    !!registry['vai-status'] && registry['vai-status'].textContent === 'AI ready on this device',
    registry['vai-status'] && registry['vai-status'].textContent);

  /* ===== scenario 2 (negative control): no model on device ===== */
  const shared2 = makeShared(false);
  page = makePage(shared2);
  loadScripts(page);
  page.TVAI.init();
  page.TVAI.toggle(true);
  await tick(400);
  check('control: download prompt DOES appear when model absent',
    !!registry['vai-dlbox'] && registry['vai-dlbox'].style.display === 'block',
    registry['vai-dlbox'] && registry['vai-dlbox'].style.display);
  check('control: status is honest ("AI not downloaded")',
    !!registry['vai-status'] && registry['vai-status'].textContent === 'AI not downloaded',
    registry['vai-status'] && registry['vai-status'].textContent);

  /* ===== static: no update path may evict non-'foundry-' caches ===== */
  for (const rel of ['sw.js', 'js/update-notify.js', 'index.html']) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const deletes = src.match(/caches\.delete/g) || [];
    const guarded = src.match(/indexOf\('foundry-'\)/g) || [];
    check(`eviction guard: ${rel} only deletes 'foundry-' caches`, deletes.length === 0 || guarded.length >= 1,
      `deletes=${deletes.length} guards=${guarded.length}`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('test crashed:', e); process.exit(1); });
