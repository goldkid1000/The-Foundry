# Tools

## validate-builds.py — build library validator

Checks every served build against the site's own mods database and fails
loudly if the library ever ships an impossible build again (the v2.19.5
accuracy pass exists because a shotgun build once carried aura mods).

Run from the repo root:

```sh
python3 tools/validate-builds.py
```

Exit code is `0` when the library is clean, `1` when any check fails.
It verifies, for all builds in `data/site/builds-*.json`:

- every named mod exists in the mods DB (`data/site/mods-*.json`) by exact name
- aura mods appear only in a Warframe build's aura slot — never in a mod
  list, never on a weapon
- each mod's class fits the build's item class (augments stay on their own
  frame/weapon; faction mods match the weapon class)
- no duplicate mod inside one build; exactly 8 regular mods (a 9th entry
  only when its note flags it as the Exilus mod)
- no duplicate build ids and no two builds with the same item + mod set;
  `builds.json` id set matches the shards' id set
- `videos.json` has no duplicate YouTube ids

It also prints the library counts (warframes / weapons / mods / builds /
videos) — check the site's displayed counters against these numbers.

Run it after any edit to the build or mod data, before pushing.
