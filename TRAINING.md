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
node tools/vaulty-probe/test-workshop.js             # v2.21.0 Workshop fixtures
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

## The Workshop (v2.21.0) — invent builds, never mods

Owner rule: Vaulty may invent BUILDS (original compositions) but may
NEVER invent MODS. **Detection** (`workshopDetect` in
`js/ai-fallback.js`): creative verbs (design / create / craft / invent /
come up with / …), novelty asks (weird / off-meta / meme / from scratch /
surprise me), damage-max asks ("full damage"), ability-focus asks
("focused on Spores"), and element-only constraints route a named-item
build ask to the Workshop. Deliberately NOT triggers: bare "make me a
X build" (canonical phrasing — plain instant library) and
qualifier-only asks (v2.19.6 keeps its path). **Flow**
(`js/vaulty-workshop.js`): the research bar gains build stages —
"Researching <item>…" (warframestat item entry: damage split,
crit/status profile; the Vault's own data is the offline fallback) →
"Designing your build…" → "Verifying every mod…" (the `buildIsValid`
gate plus a capacity sanity check against live drain data; over-budget
gets one swap attempt, then an honest note). Stop button throughout.
**Composer** (`wsCompose`): role-driven slot filling — damage core /
crit core / status-or-element core / frame archetype cores
(caster/tank/support/melee/weapons-platform/nuker) read from the
frame's own stats + its augment; aura, exilus and arcane by role —
every candidate resolved via `findModExact` + class/aura-slot legality,
and every pick carries a WHY = role label + the mod's real database
effect. Off-meta steers by library frequency (least-used legal mods
first). **Honest labeling**: composed builds render on the standard
card with "🛠 Vaulty Original — composed just now from real mods" and
"Every mod is real and checked against the database; the combination
is new." A composition that fails validation twice serves the library
card or the honest don't-know — an invalid build is never displayed.
**AI mode**: the model still may not author mod lists (WORKSHOP RULE
in the prompt), and `_validateAnswer` now also rejects any build-shaped
answer whose list lines contain a Title-Case name found nowhere in the
mods / arcanes / items / abilities data — fabricated names are
impossible to serve.
