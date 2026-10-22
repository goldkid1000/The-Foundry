#!/usr/bin/env python3
"""The Foundry — build library validator.

Run:  python3 tools/validate-builds.py
Exit: 0 when the library is clean, 1 when any check fails.

Checks every served build (data/site/builds-0..10.json) against the site's
own mods database (data/site/mods-0..8.json):

  * every mod named in a build exists in the mods DB under its exact name
  * slot validity — aura mods (compat "AURA") appear ONLY in a Warframe
    build's aura field; never inside a mod list, never on a weapon
  * class fit — a mod's class (from its DB type/compat) must fit the
    build's item class; augments locked to one frame/weapon fit only there;
    faction (Bane/Cleanse/Expel/Smite) mods exist per weapon class
  * no duplicate mod inside one build
  * slot counts — exactly 8 regular mods; a 9th entry is allowed only when
    its note flags it as the Exilus mod (the library's own convention)
  * no duplicate build ids, and no two builds with the same item + mod set
  * builds.json is the canonical full-library file: its id set must equal
    the shards' id set
  * videos.json: no duplicate YouTube ids

Also prints the library counts (warframes / weapons / mods / builds /
videos) so displayed counters can be checked against the data.
"""
import json
import os
import re
import sys
from collections import Counter, defaultdict

SITE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'site')


def load(name):
    with open(os.path.join(SITE, name)) as f:
        return json.load(f)


mods = []
for i in range(9):
    mods += load(f'mods-{i}.json')
mod_by_name = defaultdict(list)
for m in mods:
    mod_by_name[m['name']].append(m)

warframes, weapons = [], []
for i in range(2):
    warframes += load(f'warframes-{i}.json')
for i in range(3):
    try:
        weapons += load(f'weapons-{i}.json')
    except FileNotFoundError:
        pass
wep_by_name = {w['name']: w for w in weapons}
wf_by_name = {w['name']: w for w in warframes}
FRAME_NAMES = set(wf_by_name)
WEAPON_NAMES = set(wep_by_name)

TYPE_CLASS = {
    'Warframe Mod': 'warframe', 'Primary Mod': 'rifle', 'Shotgun Mod': 'shotgun',
    'Secondary Mod': 'pistol', 'Melee Mod': 'melee', 'Stance Mod': 'stance',
    'Companion Mod': 'companion', 'Arch-Gun Mod': 'archgun',
    'Arch-Melee Mod': 'archmelee', 'Archwing Mod': 'archwing',
    'Necramech Mod': 'necramech', 'Parazon Mod': 'parazon',
    'Plexus Mod': 'plexus', 'K-Drive Mod': 'kdrive',
}
SET_CLASS = {'WARFRAME': 'warframe', 'Rifle': 'rifle', 'Shotgun': 'shotgun',
             'Pistol': 'pistol', 'Melee': 'melee', 'COMPANION': 'companion',
             'AURA': 'aura', 'ANY': 'any'}
BANE_RE = re.compile(r'^(Primed )?(Bane Of|Cleanse|Expel|Smite) ')


def classes_of(name):
    out = set()
    for e in mod_by_name.get(name, []):
        t, c = e.get('type', ''), e.get('compat') or ''
        if c == 'AURA':
            out.add('aura')
        elif c == 'PRIMARY':
            out.add('primary-any')
        elif c in FRAME_NAMES:
            out.add('frame:' + c)
        elif c in WEAPON_NAMES:
            out.add('weapon:' + c)
        elif t == 'Mod Set Mod':
            out.add(SET_CLASS.get(c, 'any'))
        else:
            out.add(TYPE_CLASS.get(t, 'other:' + t))
        if c == 'ANY':
            out.add('any')
    if BANE_RE.match(name):
        out |= {'rifle', 'shotgun', 'pistol', 'melee'}
    return out


def fits(name, cls, item):
    for c in classes_of(name):
        if c == 'aura':
            continue
        if c.startswith('frame:'):
            if item.replace(' Prime', '') == c[6:] or item == c[6:]:
                return True
        elif c.startswith('weapon:'):
            w = c[7:]
            if item == w or item.endswith(' ' + w) or item.replace(' Prime', '') == w:
                return True
        elif c == 'any':
            return True
        elif c == 'primary-any' and cls in ('rifle', 'shotgun'):
            return True
        elif c == cls:
            return True
    return False


AURA_NAMES = {m['name'] for m in mods if (m.get('compat') or '') == 'AURA'}


def build_class(b):
    cat = b.get('category', '')
    if cat == 'Warframe':
        return 'warframe'
    if cat == 'Shotgun':
        return 'shotgun'
    if cat == 'Secondary':
        return 'pistol'
    if cat == 'Melee':
        return 'melee'
    if cat == 'Archgun':
        return 'archgun'
    if cat == 'Archmelee':
        return 'archmelee'
    if cat == 'Companion':
        return 'companion'
    if cat == 'Primary':
        w = wep_by_name.get(b.get('item', ''))
        return 'shotgun' if w and w.get('category') == 'Shotgun' else 'rifle'
    return ''


errors = []


def check_build(b, where):
    bid = b.get('id', '?')
    tag = f'{where} [{bid}]'
    for field in ('id', 'name', 'item', 'category', 'description'):
        if not (b.get(field) or '').strip():
            errors.append(f'{tag}: missing/empty {field}')
    cls = build_class(b)
    if not cls:
        errors.append(f'{tag}: unknown category {b.get("category")!r}')
        return
    names = []
    for m in b.get('mods', []):
        n = m.get('name')
        if not n:
            errors.append(f'{tag}: mod entry without a name')
            continue
        names.append(n)
        if n not in mod_by_name:
            errors.append(f'{tag}: mod not in the mods DB: {n!r}')
        elif n in AURA_NAMES:
            errors.append(f'{tag}: aura mod inside the mod list: {n!r}')
        elif not fits(n, cls, b.get('item', '')):
            errors.append(f'{tag}: {n!r} does not fit a {cls} build')
    for n, cnt in Counter(names).items():
        if cnt > 1:
            errors.append(f'{tag}: duplicate mod in build: {n!r} x{cnt}')
    if len(names) != 8:
        ninth_ok = (len(names) == 9 and b['mods'][8] and
                    'exilus' in (b['mods'][8].get('note') or b['mods'][8].get('why') or '').lower())
        if not ninth_ok:
            errors.append(f'{tag}: {len(names)} mods (expected 8, or 9 with an Exilus-flagged 9th)')
    if b.get('aura') is not None:
        if cls != 'warframe':
            errors.append(f'{tag}: aura field on a non-Warframe build: {b["aura"]!r}')
        elif b['aura'] not in AURA_NAMES:
            errors.append(f'{tag}: aura field is not a real aura mod: {b["aura"]!r}')
    if b.get('exilus') is not None:
        ex = b['exilus']
        if ex not in mod_by_name:
            errors.append(f'{tag}: exilus not in the mods DB: {ex!r}')
        elif not fits(ex, cls, b.get('item', '')):
            errors.append(f'{tag}: exilus {ex!r} does not fit a {cls} build')


shards = []
for i in range(11):
    shards += [(f'builds-{i}.json', b) for b in load(f'builds-{i}.json')]

for where, b in shards:
    check_build(b, where)

by_id = Counter(b['id'] for _, b in shards)
for bid, cnt in by_id.items():
    if cnt > 1:
        errors.append(f'duplicate build id in shards: {bid!r} x{cnt}')
by_sig = defaultdict(list)
for _, b in shards:
    sig = (b.get('item'), tuple(sorted(m.get('name') for m in b.get('mods', []))))
    by_sig[sig].append(b.get('id'))
for sig, ids in by_sig.items():
    if len(ids) > 1:
        errors.append(f'duplicate build (same item + mod set): {ids}')

canon = load('builds.json')
canon_ids = {b['id'] for b in canon}
if canon_ids != set(by_id):
    errors.append(f'builds.json id set != shards id set '
                  f'(only in builds.json: {sorted(canon_ids - set(by_id))[:5]}, '
                  f'only in shards: {sorted(set(by_id) - canon_ids)[:5]})')

videos = load('videos.json')
vc = Counter(v['id'] for v in videos)
for vid, cnt in vc.items():
    if cnt > 1:
        errors.append(f'duplicate video id: {vid} x{cnt}')
for v in videos:
    if not re.fullmatch(r'[A-Za-z0-9_-]{11}', v.get('id', '')):
        errors.append(f'malformed video id: {v.get("id")!r}')

print(f'counts: warframes={len(warframes)} weapons={len(weapons)} '
      f'mods={len(mods)} builds={len(shards)} videos={len(videos)}')
if errors:
    print(f'\nFAIL — {len(errors)} problem(s):')
    for e in errors:
        print('  -', e)
    sys.exit(1)
print('OK — build library is clean.')
