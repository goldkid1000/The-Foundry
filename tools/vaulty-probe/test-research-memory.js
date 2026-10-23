/* v2.20.0 regression tests: Vaulty research chain + on-device memory.
   Loads the REAL js/vaulty-memory.js, js/vaulty-research.js and
   js/ai-fallback.js in a Node vm with data stubs (same pattern as the
   guide harnesses). Research probes hit the live APIs.

   Usage: node tools/vaulty-probe/test-research-memory.js */
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
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 30));

const store = {};
const sandbox = {};
sandbox.window = sandbox;
sandbox.console = console;
sandbox.fetch = fetch;
sandbox.AbortController = AbortController;
sandbox.setTimeout = setTimeout;
sandbox.clearTimeout = clearTimeout;
sandbox.document = {
  addEventListener() {},
  getElementById() { return null; },
  createElement() {
    return {
      style: {}, classList: { add() {}, toggle() {} }, appendChild() {},
      querySelector() { return null; }, querySelectorAll() { return []; },
      addEventListener() {}, setAttribute() {}, parentNode: null,
    };
  },
  body: { appendChild() {} },
  head: { appendChild() {} },
};
sandbox.navigator = { userAgent: 'vaulty-test' };
sandbox.localStorage = {
  getItem(k) { return k in store ? store[k] : null; },
  setItem(k, v) { store[k] = String(v); },
  removeItem(k) { delete store[k]; },
};
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
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'vaulty-memory.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'vaulty-research.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'ai-fallback.js'), 'utf8'), sandbox);
const M = sandbox.TVMemory, R = sandbox.TVResearch, G = sandbox.TVAI;

(async () => {
  /* ---------- subject extraction ---------- */
  check('subjectOf: necramech', R.subjectOf('how do i get a necramech') === 'necramech', R.subjectOf('how do i get a necramech'));
  check('subjectOf: incarnon', R.subjectOf('how do incarnon weapons work') === 'incarnon weapons', R.subjectOf('how do incarnon weapons work'));
  check('subjectOf: corrosive', R.subjectOf('how does corrosive work') === 'corrosive', R.subjectOf('how does corrosive work'));
  check('subjectOf: argon', R.subjectOf('where do i farm argon crystals') === 'argon crystals', R.subjectOf('where do i farm argon crystals'));
  check('subjectOf: clan', R.subjectOf('how do i join a clan') === 'clan', R.subjectOf('how do i join a clan'));

  /* ---------- miss detection against the real guide ---------- */
  await G._load();
  check('isMiss: nonsense is a miss', R.isMiss(G._answer('asdfgh qwerty')) === true);
  check('isMiss: real build is not a miss', R.isMiss(G._answer('make me a steflos build')) === false);
  check('isMiss: aya now covered by guide', R.isMiss(G._answer('where do i get aya')) === false);
  check('isMiss: best aura mods covered', R.isMiss(G._answer('best aura mods')) === false);

  /* ---------- memory ---------- */
  await M._ready();
  M.recordExchange('make me a steflos build');
  M.recordExchange('steflos build please');
  M.recordExchange('where do i farm argon crystals');
  await tick(60);
  const sum = M._summary();
  check('memory: steflos recorded twice', sum.items.length && sum.items[0].name === 'Steflos' && sum.items[0].n === 2, JSON.stringify(sum.items));
  check('memory: main is Steflos', !!M.main() && M.main().name === 'Steflos');
  check('memory: resolveUsual', M.resolveUsual('my usual') === 'Steflos build', M.resolveUsual('my usual'));
  check('memory: welcome-back line names the main', /Steflos/.test(M.welcomeBackLine() || ''));
  const view = M.viewHtml();
  check('memory: view lists the item', view.includes('Steflos'));
  check('memory: view carries the on-device honesty copy', /only on this device/.test(view) && /nothing/i.test(view));
  check('memory: view has a clear button', view.includes('vmem-clear'));
  check('memory: persisted to localStorage', !!store['tv-vaulty-memory-v1']);
  M.clear();
  const sum2 = M._summary();
  check('memory: clear wipes items + recents', sum2.items.length === 0 && sum2.recent.length === 0 && M.main() === null);

  /* ---------- research chain (live network) ---------- */
  const stalker = await R._probe('who is the stalker');
  check('research: stalker answered from a source', !!stalker && !!stalker.source && stalker.text.length >= 40, stalker && stalker.source);
  const overguard = await R._probe('what is overguard');
  check('research: overguard answered from a source', !!overguard && overguard.text.length >= 40, overguard && overguard.source);
  const junk = await R._probe('zxqw blarg fnord');
  check('research: nonsense stays an honest null', junk === null, JSON.stringify(junk));
  const buildProbe = await R._probe('make me a nokko build');
  check('research: never returns a build card', !buildProbe || !/vbc-grid/.test(buildProbe.text || ''));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('test crashed:', e); process.exit(1); });
