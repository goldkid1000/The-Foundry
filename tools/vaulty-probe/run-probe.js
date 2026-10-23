/* Vaulty training probe battery (v2.20.0 — see ../../TRAINING.md).
   Runs realistic questions against the REAL guide brain (js/ai-fallback.js)
   loaded in a Node vm with data stubs, classifies each answer as
   answered-well / answered-wrong / don't-know, then runs every guide
   miss through the REAL research chain (js/vaulty-research.js, live
   network) to measure how much of the gap research covers.

   Usage:  node tools/vaulty-probe/run-probe.js [--no-research] [--dump]
   Writes: tools/vaulty-probe/last-run.json
   Exit:   0 always — this is a measurement tool, not a gate. Compare runs. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const SITE = path.join(ROOT, 'data', 'site');
const read = (f) => JSON.parse(fs.readFileSync(path.join(SITE, f), 'utf8'));
const NO_RESEARCH = process.argv.includes('--no-research');
const DUMP = process.argv.includes('--dump');

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
sandbox.navigator = { userAgent: 'vaulty-probe' };
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
const TVAI = sandbox.TVAI;
const TVResearch = sandbox.TVResearch;

function strip(html) {
  return String(html || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
}
function cardMods(html) {
  if (!html.includes('vbc-grid')) return null;
  return [...html.matchAll(/<div class="vbc-mod">([^<]*)<\/div>/g)].map((m) => m[1]);
}

const questions = JSON.parse(fs.readFileSync(path.join(__dirname, 'questions.json'), 'utf8'));

TVAI._load().then(async () => {
  const rows = [];
  const scores = { well: 0, wrong: 0, dontknow: 0, honestMiss: 0, live: 0, researched: 0, researchCovered: 0 };

  for (const item of questions) {
    const html = TVAI._answer(item.q);
    const text = strip(html);
    const lower = text.toLowerCase();
    const miss = TVResearch.isMiss(html);
    const row = { q: item.q, cat: item.cat, expect: item.expect, miss, verdict: null, research: null };

    if (item.expect === 'live') {
      /* live questions are routed to TVLive before the guide in the real
         panel; the guide's own result is recorded but not scored */
      row.verdict = 'live-route';
      scores.live++;
      rows.push(row);
      continue;
    }
    if (miss) {
      if (item.expect === 'dontknow') { row.verdict = 'well'; scores.well++; scores.honestMiss++; }
      else { row.verdict = 'dontknow'; scores.dontknow++; }
    } else if (item.expect === 'dontknow') {
      /* should have declined honestly but answered confidently */
      row.verdict = 'wrong'; row.why = 'answered a dontknow-expect question'; scores.wrong++;
    } else {
      let ok = true;
      const why = [];
      if (item.card && !html.includes('vbc-grid')) { ok = false; why.push('no build card'); }
      if (item.cardExcludes && cardMods(html)) {
        const bad = cardMods(html).filter((m) => item.cardExcludes.some((x) => m.toLowerCase().includes(x.toLowerCase())));
        if (bad.length) { ok = false; why.push('card contains excluded: ' + bad.join(', ')); }
      }
      (item.has || []).forEach((h) => { if (!lower.includes(h.toLowerCase())) { ok = false; why.push('missing: ' + h); } });
      if (item.any && !item.any.some((a) => lower.includes(a.toLowerCase()))) { ok = false; why.push('none of: ' + item.any.join('/')); }
      (item.notContains || []).forEach((n) => { if (lower.includes(n.toLowerCase())) { ok = false; why.push('contains banned: ' + n); } });
      row.verdict = ok ? 'well' : 'wrong';
      row.why = why.join('; ') || undefined;
      if (ok) scores.well++; else scores.wrong++;
    }
    rows.push(row);
    if (DUMP) console.log('\n###', item.q, '→', row.verdict, row.why || '', '\n', text.slice(0, 300));
  }

  /* research pass over the guide's real misses */
  if (!NO_RESEARCH) {
    for (const row of rows) {
      if (row.verdict !== 'dontknow') continue;
      scores.researched++;
      const res = await TVResearch._probe(row.q).catch(() => null);
      row.research = res ? { source: res.source, chars: res.text.length } : null;
      if (res && res.text && res.text.length >= 40) scores.researchCovered++;
    }
  }

  const scored = questions.length - scores.live;
  const summary = {
    when: new Date().toISOString(),
    total: questions.length,
    scoredByGuide: scored,
    liveRouted: scores.live,
    answeredWell: scores.well,
    answeredWrong: scores.wrong,
    dontKnow: scores.dontknow,
    honestMisses: scores.honestMiss,
    researchAttempted: scores.researched,
    researchCovered: scores.researchCovered,
    stackCovered: scores.well + scores.researchCovered,
  };
  console.log('\n=== Vaulty probe battery ===');
  console.log(JSON.stringify(summary, null, 2));
  console.log('\nMisses (dont-know):');
  rows.filter((r) => r.verdict === 'dontknow').forEach((r) =>
    console.log(' -', r.q, r.research ? `→ research: ${r.research.source}` : '→ research: nothing'));
  console.log('\nWrong:');
  rows.filter((r) => r.verdict === 'wrong').forEach((r) => console.log(' -', r.q, '::', r.why));
  fs.writeFileSync(path.join(__dirname, 'last-run.json'), JSON.stringify({ summary, rows }, null, 2));
  console.log('\nWrote tools/vaulty-probe/last-run.json');
}).catch((e) => { console.error('probe failed:', e); process.exit(1); });
