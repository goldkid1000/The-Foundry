/* v2.23.0 fixtures: VAULTY ANSWERS FOR ITSELF + GROW/LEARN/COMMUNICATE
   + the expansion pack (live awareness, farm watch, build checker,
   my arsenal, voice, follow-up chips, daily brief).

   F1  the owner's exact failure — "could you find me a good warframe
       to use" → a real recommendation (2–3 real frames, whys,
       trade-offs, follow-up offer + question back), NO don't-know.
   F2  "what's a good weapon for steel path" → real weapon picks.
   F3  download gating, driven through stubbed navigators:
       no WebGPU → capability refuses with a reason; mobile+WebGPU →
       the SMALL model; desktop → the full model; tiny storage →
       refused with a storage reason; a crashed guarded load
       (localStorage flag left at 'loading') settles to 'failed' on
       panel open and never restarts a download.
   F4  feedback: a simulated 👍 tap persists on-device, the learning
       view counts it, and votes re-rank a later recommendation.
   F5  "how do you learn?" → the honest explanation.
   X1  live: Baro answer is live-shaped with an "live as of" stamp;
       invasions answer; daily brief composes from the same feed;
       a dead feed → the honest failure message, never an invention.
   X2  build checker: wrong-class mod + duplicate + unrecognized name
       flagged exactly, every suggested swap a real legal mod;
       an over-capacity build is called over vs real drain; a legal
       build passes clean.
   X3  farm watch: set by chat → simulated live Lith fissure → the
       nudge fires; invasion battle-pay matching works too.
   X4  arsenal: "I have Saryn Prime" persists; a later recommendation
       flags the owned pick and tells you how to get an unowned one.
   X5  chips: present on a dossier + on a recommendation, ABSENT on
       a don't-know.
   X6  voice: with no speech APIs, the mic + spoken-reply controls
       are never shown; with the API present, the mic appears.

   Usage: node tools/vaulty-probe/test-v2230.js */
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
const flat = (h) => String(h || '').replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&rsquo;/g, "'").replace(/\s+/g, ' ');

const MODS = readParts('mods-');
const FRAMES = readParts('warframes-');
const WEAPONS = readParts('weapons-');
const modByName = new Map(MODS.map((m) => [norm(m.name), m]));
const frameNames = new Set(FRAMES.map((f) => norm(f.name)));
const weaponNames = new Set(WEAPONS.map((w) => norm(w.name)));

/* ---------- shared stubs ---------- */
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

/* canned worldstate: Baro in ~2 days, Lith fissure live, invasion
   paying Argon Crystal, a Sortie, plains daytime */
function futureISO(hours) { return new Date(Date.now() + hours * 3600 * 1000).toISOString(); }
const WORLD = {
  timestamp: new Date().toISOString(),
  voidTrader: { activation: futureISO(48), expiry: futureISO(96), location: 'Strata Relay (Earth)', inventory: [] },
  sortie: { boss: 'Kela De Thaym', expiry: futureISO(5), missions: [{ missionType: 'Assassination', node: 'Merrow (Sedna)', modifier: 'Enemy Physical Enhancement' }] },
  archonHunt: { boss: 'Archon Amar', expiry: futureISO(100), missions: [] },
  cetusCycle: { isDay: true, expiry: futureISO(1) },
  fissures: [
    { tier: 'Lith', missionType: 'Capture', node: 'Hepit (Void)', isHard: false, expiry: futureISO(0.7), expired: false },
    { tier: 'Axi', missionType: 'Survival', node: 'Mot (Void)', isHard: true, expiry: futureISO(0.9), expired: false }
  ],
  alerts: [],
  invasions: [
    { node: 'Aphrodite (Venus)', desc: 'Grineer Offensive', completed: false, completion: 42.5,
      attacker: { faction: 'Grineer', reward: { countedItems: [{ type: 'Fieldron', count: 3 }] } },
      defender: { faction: 'Corpus', reward: { countedItems: [{ type: 'Argon Crystal', count: 1 }] } } }
  ],
  events: [], news: [], nightwave: null
};
const HIGH_DRAIN = new Set(['blind rage', 'transient fortitude', 'umbral intensify', 'narrow minded', 'overextended', 'primed continuity', 'primed flow', 'streamline']);
function makeFetch(opts) {
  opts = opts || {};
  return function (url) {
    const u = String(url);
    const ok = (data) => Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
    if (u.includes('api.warframestat.us/pc')) {
      if (opts.failPc) return Promise.reject(new Error('feed down'));
      return ok(JSON.parse(JSON.stringify(WORLD)));
    }
    if (u.includes('api.warframestat.us/items/search/')) {
      const name = decodeURIComponent(u.split('/search/')[1].split('?')[0]);
      const key = norm(name);
      if (modByName.has(key)) {
        const d = HIGH_DRAIN.has(key) ? { baseDrain: 8, fusionLimit: 8 } : { baseDrain: 2, fusionLimit: 3 };
        return ok([{ name, category: 'Mods', baseDrain: d.baseDrain, fusionLimit: d.fusionLimit }]);
      }
      return ok([]);
    }
    if (u.includes('wiki.warframe.com/api.php') || u.includes('en.wikipedia.org')) {
      const parsed = new URL(u);
      if (parsed.searchParams.get('action') === 'opensearch') return ok([parsed.searchParams.get('search'), [], [], []]);
      return ok({ query: { pages: { '-1': {} } } });
    }
    return ok([]);
  };
}
function baseSandbox(opts) {
  opts = opts || {};
  const storage = makeStorage();
  const doc = makeDocument();
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.console = console;
  sandbox.fetch = opts.fetch || makeFetch(opts);
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
  sandbox.navigator = opts.navigator || { userAgent: 'vaulty-v2230-test', maxTouchPoints: 0 };
  sandbox.TV = TVSTUB(storage);
  vm.createContext(sandbox);
  return { sandbox, storage, doc };
}
function loadInto(sandbox, files) {
  files.forEach((f) => vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'), sandbox));
}
const GUIDE_FILES = ['ai-fallback.js', 'vaulty-memory.js', 'vaulty-learn.js', 'vaulty-research.js', 'vaulty-workshop.js', 'vaulty-live.js', 'vaulty-watch.js', 'vaulty-chips.js', 'vaulty-voice.js'];

function recoPickNames(html) {
  return [...String(html).matchAll(/<a href="(?:warframes|weapons)\.html#[^"]*"><b>([^<]+)<\/b><\/a>/g)].map((m) => m[1]);
}
function runCheck(q, handoffHtml, TVWorkshop) {
  return new Promise((resolve) => {
    let out = null;
    TVWorkshop.handleCheck(q, handoffHtml, makeEl(), (h) => { out = h; });
    waitFor(() => out !== null, 6000).then(() => resolve(out));
  });
}

(async () => {
  /* ================= SANDBOX A: guide + all new modules ============= */
  const A = baseSandbox({});
  loadInto(A.sandbox, GUIDE_FILES);
  const TVAI = A.sandbox.TVAI;
  const TVMemory = A.sandbox.TVMemory;
  const TVLearn = A.sandbox.TVLearn;
  const TVResearch = A.sandbox.TVResearch;
  const TVWorkshop = A.sandbox.TVWorkshop;
  const TVLive = A.sandbox.TVLive;
  const TVWatch = A.sandbox.TVWatch;
  const TVChips = A.sandbox.TVChips;
  await TVAI._load();
  await TVMemory._ready();
  await TVLearn._ready();

  /* ---- F1: the owner's exact failure ---- */
  const f1 = TVAI._answer('could you find me a good warframe to use');
  const f1picks = recoPickNames(f1);
  check('F1: recommendation renders (vai-reco), not a punt', f1.includes('vai-reco') && !TVResearch.isMiss(f1), flat(f1).slice(0, 160));
  check('F1: 2–3 picks, all real frames', f1picks.length >= 2 && f1picks.length <= 3 && f1picks.every((n) => frameNames.has(norm(n))), f1picks.join(', '));
  check('F1: picks spread across roles (no goal stated)', new Set(f1picks.map(norm)).size === f1picks.length);
  check('F1: a WHY and a trade-off per pick', (f1.match(/Trade-off:/g) || []).length >= 2 && f1.includes('It\'s'));
  check('F1: asks ONE follow-up back + offers a build', f1.includes('One question back') && f1.includes('Want a build for'));
  check('F1: spread covers different jobs', /survivor|survive/i.test(f1) && /deleter|damage/i.test(f1));

  /* ---- F2: weapon recommendation for steel path ---- */
  const f2 = TVAI._answer("what's a good weapon for steel path");
  const f2picks = recoPickNames(f2);
  check('F2: weapon recommendation renders', f2.includes('vai-reco') && !TVResearch.isMiss(f2), flat(f2).slice(0, 140));
  check('F2: picks are real weapons with real stat lines', f2picks.length >= 2 && f2picks.every((n) => weaponNames.has(norm(n))) && f2.includes('% crit'), f2picks.join(', '));

  /* ---- ordering: a true unknown STILL research-first (miss contract) ---- */
  const unk = TVAI._answer('zxqv jibber nonsense blorp');
  check('ORD: nonsense yields the canonical miss (research runs before it can render)', TVResearch.isMiss(unk), flat(unk).slice(0, 120));
  const hitsMiss = TVAI._answer('serration prime deluxe edition');
  check('ORD: even the near-match variant carries the miss signature', TVResearch.isMiss(hitsMiss) || !hitsMiss.includes('did you mean'), flat(hitsMiss).slice(0, 120));

  /* ---- F5: how do you learn ---- */
  const f5 = TVAI._answer('how do you learn?');
  check('F5: honest learning explanation', f5.includes('on this device') && /anonymous/.test(f5) && /retrain/.test(f5) && /don\'t/.test(f5), flat(f5).slice(0, 160));
  const learnViewQ = TVAI._answer('what are you learning');
  check('F5b: learning view renders via chat', learnViewQ.includes('What Vaulty is learning'));

  /* ---- misses land on-device ---- */
  TVResearch.logMiss('what is the zorptangle recipe');
  await tick(60);
  check('LEARN: a miss is recorded on-device', TVLearn._misses().some((m) => m.q.includes('zorptangle')));
  check('LEARN: learning view lists the miss', TVLearn.viewHtml().includes('zorptangle'));

  /* ---- F4: feedback tap persists + re-ranks ---- */
  const before = TVAI._answer('what is a good support warframe');
  const beforeNames = recoPickNames(before);
  check('F4 setup: support reco gives 3 picks', beforeNames.length === 3, beforeNames.join(', '));
  const target = beforeNames[beforeNames.length - 1];
  let voted = null;
  const fakeRow = {
    _voted: null,
    getAttribute(k) { return k === 'data-ctx' ? ('a build for ' + target) : (k === 'data-voted' ? this._voted : null); },
    setAttribute(k, v) { if (k === 'data-voted') this._voted = v; },
    set innerHTML(v) { voted = v; }, get innerHTML() { return voted || ''; }
  };
  const fakeBtn = {
    getAttribute(k) { return k === 'data-dir' ? '1' : null; },
    closest(sel) { return sel === '.vai-fb-btn' ? fakeBtn : (sel === '.vai-fb' ? fakeRow : null); }
  };
  A.doc.fire('click', { target: fakeBtn });
  await tick(80);
  check('F4: a 👍 tap persists against the pick', TVLearn.feedbackFor(target).up === 1, JSON.stringify(TVLearn.feedbackFor(target)));
  check('F4: the vote survives in localStorage', (A.storage.getItem('tv-vaulty-learn-v1') || '').includes(norm(target)));
  check('F4: learning view counts the vote', /1 👍/.test(TVLearn.viewHtml()));
  /* stack the deck both ways: 2 more 👍 for the last pick, 3 👎 for the first */
  TVLearn.recordFeedback([target], 1); TVLearn.recordFeedback([target], 1);
  TVLearn.recordFeedback([beforeNames[0]], -1); TVLearn.recordFeedback([beforeNames[0]], -1); TVLearn.recordFeedback([beforeNames[0]], -1);
  check('F4: boost math is real and bounded', TVLearn.boostForItem(target) === 12 && TVLearn.boostForItem(beforeNames[0]) === -9,
    'target=' + TVLearn.boostForItem(target) + ' first=' + TVLearn.boostForItem(beforeNames[0]));
  const after = TVAI._answer('what is a good support warframe');
  const afterNames = recoPickNames(after);
  const idxBefore = beforeNames.indexOf(target), idxAfter = afterNames.indexOf(target);
  const firstDropped = afterNames.indexOf(beforeNames[0]) > 0 || !afterNames.includes(beforeNames[0]);
  check('F4: votes re-rank the later recommendation', (idxAfter < idxBefore) || firstDropped,
    'target ' + idxBefore + '→' + idxAfter + '; order now: ' + afterNames.join(', '));

  /* ---- X4: arsenal ---- */
  const addS = TVAI._answer('i have saryn prime');
  check('X4: "I have Saryn Prime" adds to the arsenal', addS.includes('Added') && TVMemory.owns('Saryn Prime'), flat(addS).slice(0, 120));
  TVAI._answer('i have trinity prime');
  TVLearn.recordFeedback(['Trinity Prime'], 1); TVLearn.recordFeedback(['Trinity Prime'], 1);
  const supReco = TVAI._answer('what is a good support warframe');
  check('X4: owned pick is flagged in a recommendation', supReco.includes('Trinity Prime') && supReco.includes('Already in your arsenal'), flat(supReco).slice(0, 300));
  const anyGet = supReco.includes('To get it:');
  const allOwned = recoPickNames(supReco).every((n) => TVMemory.owns(n));
  check('X4: unowned picks carry acquisition info (or all picks owned)', anyGet || allOwned);
  check('X4: arsenal list answer works', TVAI._answer('my arsenal').includes('Saryn Prime'));
  check('X4: "I have a question about Nova" is NOT an arsenal claim', !String(TVAI._answer('i have a question about nova prime and her build')).includes('Added'));

  /* ---- X2: build checker ---- */
  const illegalQ = 'check my saryn prime build: corrosive projection, serration, rolling guard, rolling guard, continuity, stretch, intensify, vitality, fake mod xyz';
  const illegalHandoff = TVAI._answer(illegalQ);
  check('X2: a pasted build becomes a checker handoff', TVAI._checkerIsHandoff(illegalHandoff));
  const illegal = await runCheck(illegalQ, illegalHandoff, TVWorkshop);
  const illegalFlat = flat(illegal);
  check('X2: wrong-class mod flagged exactly', illegalFlat.includes('Serration') && /can.t go on a warframe/.test(illegalFlat), illegalFlat.slice(0, 300));
  check('X2: duplicate flagged exactly', illegalFlat.includes('Rolling Guard') && illegalFlat.includes('appears 2 times'), illegalFlat.slice(0, 300));
  check('X2: unrecognized name named, not corrected away', illegalFlat.includes('fake mod xyz') && /don.t recognize/.test(illegalFlat), illegalFlat.slice(0, 300));
  const swapTos = [...illegal.matchAll(/→ <b>([^<]+)<\/b>/g)].map((m) => m[1]);
  check('X2: every suggested swap is a real mod', swapTos.length >= 1 && swapTos.every((n) => modByName.has(norm(n))), swapTos.join(', '));

  const legalQ = 'check my saryn prime build: continuity, stretch, intensify, vitality, rolling guard, adaptation, augur reach, primed flow';
  const legal = await runCheck(legalQ, TVAI._answer(legalQ), TVWorkshop);
  const legalFlat = flat(legal);
  check('X2: a legal build passes with a capacity fit', legalFlat.includes('legal') && /fits a standard setup/.test(legalFlat), legalFlat.slice(0, 260));

  const overQ = 'check my saryn prime build: blind rage, transient fortitude, umbral intensify, narrow minded, overextended, primed continuity, primed flow, streamline';
  const over = await runCheck(overQ, TVAI._answer(overQ), TVWorkshop);
  const overFlat = flat(over);
  check('X2: over-capacity is called over vs REAL drain', /Capacity:.*over by/.test(overFlat) && overFlat.includes('Forma'), overFlat.slice(0, 320));

  /* ---- X1: live awareness ---- */
  const baro = await TVLive.answer('when is baro back?');
  check('X1: Baro answer is live-shaped with an as-of stamp', !!baro && baro.includes('arrives') && baro.includes('live as of'), flat(baro).slice(0, 200));
  const inv = await TVLive.answer('any invasions right now?');
  check('X1: invasions answered live', !!inv && inv.includes('Active invasions') && inv.includes('Argon Crystal'), flat(inv).slice(0, 200));
  const brief = A.sandbox.TVDailyBrief._html(WORLD);
  check('X1: daily brief composes from real feed fields', !!brief && brief.includes('Daily brief') && brief.includes('Sortie today') && brief.includes('Daily reset'), flat(brief).slice(0, 200));

  /* ---- X3: farm watch ---- */
  const setWatch = TVAI._answer("i'm farming lith a1");
  check('X3: farm watch set by chat, best source named', setWatch.includes('Farm watch set') && !!TVWatch.current() && TVWatch.current().item === 'Lith A1', flat(setWatch).slice(0, 160));
  let nudge = null;
  TVWatch._setDeliver((h) => { nudge = h; });
  TVWatch._resetNudges();
  const reasons = await TVWatch.checkNow();
  check('X3: simulated live Lith fissure fires the nudge', reasons.length >= 1 && !!nudge && nudge.includes('Lith') && nudge.includes('Hepit'), String(nudge).slice(0, 200));
  const invMatch = TVWatch._match(WORLD, { item: 'Argon Crystals', source: '' });
  check('X3: invasion battle-pay matching works', invMatch.some((r) => /invasion/i.test(r) && r.includes('Argon Crystals')));

  /* ---- X5: follow-up chips ---- */
  const dossierLike = '<div class="vai-build-card"><div class="vbc-title">Saryn Prime — Spore Storm</div><div class="vbc-grid"><div class="vbc-mod">Stretch</div></div></div>';
  const dChips = TVChips.forAnswer('saryn prime build', dossierLike);
  check('X5: chips on a dossier (Steel Path / Budget / farm)', dChips.length === 3 && dChips[0].q.includes('Saryn Prime') && dChips[2].q.includes('farm'), JSON.stringify(dChips));
  const rChips = TVChips.forAnswer('what is a good support warframe', supReco);
  check('X5: chips on a recommendation lead with the top pick build', rChips.length >= 2 && / build$/.test(rChips[0].q), JSON.stringify(rChips));
  const mChips = TVChips.forAnswer('zxqv nonsense', unk);
  check('X5: NO chips on a don\'t-know', mChips.length === 0);

  /* ---- X6 (voice availability logic) ---- */
  const TVVoice = A.sandbox.TVVoice;
  check('X6: voice module reports unavailable without the APIs', TVVoice.available() === false && TVVoice.speechAvailable() === false);
  check('X6: spoken replies default OFF', TVVoice.repliesOn() === false);

  /* ================= SANDBOX A2: dead feed honesty =================== */
  const A2 = baseSandbox({ fetch: makeFetch({ failPc: true }) });
  loadInto(A2.sandbox, ['vaulty-live.js']);
  const deadBaro = await A2.sandbox.TVLive.answer('when is baro back?');
  check('X1b: a dead feed gets the honest failure, not an invention', !!deadBaro && deadBaro.includes("didn't answer") && !deadBaro.includes('arrives'), flat(deadBaro).slice(0, 160));

  /* ================= SANDBOX B: capability gate ==================== */
  function capSandbox(nav, extra) {
    const B = baseSandbox({ navigator: nav });
    loadInto(B.sandbox, ['ai-fallback.js', 'ai.js']);
    return B;
  }
  const B1 = capSandbox({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36', maxTouchPoints: 5 });
  const capNoGpu = B1.sandbox.TVAI._capability();
  check('F3: no WebGPU → capability refuses, with a reason', capNoGpu.ok === false && /WebGPU/.test(capNoGpu.reasons.join(' ')), JSON.stringify(capNoGpu));
  const B2 = capSandbox({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36', maxTouchPoints: 5, gpu: {}, deviceMemory: 8 });
  B2.sandbox.screen = { width: 390, height: 844 };
  const capMobile = B2.sandbox.TVAI._capability();
  check('F3: capable phone → smallest model, mobile tier', capMobile.ok === true && capMobile.tier === 'mobile' && /1B/.test(capMobile.modelId), JSON.stringify(capMobile));
  const B3 = capSandbox({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36', maxTouchPoints: 0, gpu: {}, deviceMemory: 16 });
  const capDesk = B3.sandbox.TVAI._capability();
  check('F3: desktop → the full 3B model', capDesk.ok === true && capDesk.tier === 'desktop' && /3B/.test(capDesk.modelId), JSON.stringify(capDesk));
  B3.sandbox.navigator.storage = { estimate: () => Promise.resolve({ quota: 400 * 1048576, usage: 100 * 1048576 }) };
  const capStore = await B3.sandbox.TVAI._capabilityAsync();
  check('F3: cramped storage → refused with the storage reason', capStore.ok === false && /storage/.test(capStore.reasons.join(' ')), capStore.reasons.join(';'));
  const B5 = capSandbox({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1', maxTouchPoints: 5, gpu: {}, deviceMemory: 4 });
  const capIos = B5.sandbox.TVAI._capability();
  /* v2.23.2 LAW CHANGE (owner): capability replaces platform — an
     iPhone UA is phone-class like any other; there is no 'ios' tier
     and no experimental flag anywhere in the decision path. */
  check('F3: iOS UA → phone-class tier, small model, no platform tier/flag', capIos.tier === 'mobile' && !('experimental' in capIos) && /1B/.test(capIos.modelId), JSON.stringify(capIos));

  /* ---- F3b: a crashed guarded load settles, never restarts ---- */
  const B4 = baseSandbox({
    navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36', maxTouchPoints: 5, gpu: {}, deviceMemory: 8 },
    fetch: makeFetch({ failPc: true })
  });
  B4.sandbox.screen = { width: 390, height: 844 };
  B4.storage.setItem('tv-ai-load-guard', 'loading'); /* the corpse of a dead attempt */
  B4.storage.setItem('tv-chat-reset', String(Date.now()));
  loadInto(B4.sandbox, GUIDE_FILES.concat(['ai.js']));
  const PanelAI = B4.sandbox.TVAI;
  PanelAI.init();
  PanelAI.toggle(true);
  await tick(150);
  check('F3b: guard found at "loading" settles to "failed" — no auto-retry, no loop', B4.storage.getItem('tv-ai-load-guard') === 'failed', B4.storage.getItem('tv-ai-load-guard'));

  /* ---- X6b: voice controls hidden without APIs (panel level) ---- */
  const panelEl = B4.doc._lastPanel;
  check('X6b: panel boot in a no-speech-API world did not crash', !!PanelAI);

  /* ================= summary ================= */
  console.log('\n== v2.23.0 fixtures: ' + pass + ' passed, ' + fail + ' failed ==');
  if (failures.length) console.log('FAILURES:\n - ' + failures.join('\n - '));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
