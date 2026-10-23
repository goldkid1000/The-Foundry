# Vaulty training — how the guide learns

Vaulty is not retrained like a neural net. Its "training" is a measured
loop over the **guide brain** (`js/ai-fallback.js`) and the **research
chain** (`js/vaulty-research.js`):

1. **Measure.** Run the probe battery (below). It asks 50 realistic
   questions of the real guide brain and scores each one
   *answered-well / answered-wrong / don't-know*, then runs every miss
   through the live research chain to see what research covers.
2. **Log reality.** In production, every question the guide can't answer
   is logged anonymously (question text only — no identifiers) to the
   `vaulty-misses` collection in the tenno-vault Firebase project. Read
   it in the Firebase console; it is the backlog for the next pass.
3. **Expand coverage.** For the top real misses, add entries to the
   `KNOWLEDGE` array in `js/ai-fallback.js` (or fix the underlying
   matcher/data bug, like the Aya→"Gnashing Payara" fuzzy-match found in
   pass 1). Content rules: evergreen facts only, verified against the
   Warframe Wiki, and builds always go through the verified library —
   never hand-write a mod list into a knowledge entry.
4. **Re-measure.** Run the battery again and record the before/after in
   `tools/vaulty-probe/last-run.json`. A pass only counts if
   answered-wrong does not rise.

## The battery

```bash
node tools/vaulty-probe/run-probe.js            # guide + research scores
node tools/vaulty-probe/run-probe.js --no-research   # guide only (fast)
node tools/vaulty-probe/test-research-memory.js      # research + memory regressions
node --experimental-vm-modules tools/vaulty-probe/test-persistence.js
```

`test-persistence.js` guards the model-persistence guarantee: a device
with the on-device AI in cache must never see the download prompt again,
including across an app update, and no update path may delete caches
that don't start with `foundry-`.

Questions live in `tools/vaulty-probe/questions.json` — add the real
misses you find in `vaulty-misses` there (with expectations) so they
become regression fixtures.

## Pass log

- **Pass 1 (v2.20.0, 2026-10-22)** — baseline 33 well / 2 wrong / 9
  don't-know (of 44 guide-scored; 6 live-routed). After coverage work,
  measured on the shipped tree (v2.19.6 variety fix + this release):
  **41 well / 0 wrong / 3 don't-know**, and research covered all 3
  remaining misses — full stack 44/44. Added knowledge: Aya, best auras,
  starter frames, Necramech, Incarnon, Archwing, clans. Fixed:
  `findByName` word-boundary rule for short queries (the Aya bug).
