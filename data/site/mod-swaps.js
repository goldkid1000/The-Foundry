/* The Foundry — Mod Equivalents data.
   "Don't have X? Use Y instead" — for damage, one-shots, and Steel Path.
   Each entry: the best-in-slot mod, then alternatives ranked by effectiveness. */

var MOD_SWAPS = [
  {
    category: "Rifle Damage",
    icon: "🔫",
    desc: "Base damage mods for rifles — the foundation of every build",
    swaps: [
      {
        best: "Serration",
        bestFarm: "Nightmare missions (low chance) or general drops",
        bestNote: "+165% damage. The standard.",
        alternatives: [
          { mod: "Primed Serration",
          farm: "Baro Ki'Teer (Ducats)", note: "+220% damage. Baro Ki'Teer. Strict upgrade.", effectiveness: 133 },
          { mod: "Amalgam Serration",
          farm: "Ropalolyst boss (Jupiter)", note: "+155% damage + sprint speed. Slightly weaker but faster.", effectiveness: 94 }
        ]
      },
      {
        best: "Split Chamber",
        bestFarm: "General drops / Nightmare missions",
        bestNote: "+90% multishot. Non-negotiable on rifles.",
        alternatives: [
          { mod: "Primed Split Chamber", note: "Doesn't exist — Split Chamber IS the best. No alternative needed.", effectiveness: 100 },
          { mod: "Vigilante Armaments",
          farm: "Cetus bounties (Plains of Eidolon)", note: "+60% multishot. Use if you need the set bonus.", effectiveness: 67 }
        ]
      }
    ]
  },
  {
    category: "Shotgun Damage",
    icon: "💥",
    desc: "Base damage for shotguns — Felarx, Hek, etc.",
    swaps: [
      {
        best: "Point Blank",
        bestFarm: "General shotgun drops",
        bestNote: "+165% damage.",
        alternatives: [
          { mod: "Primed Point Blank",
          farm: "Baro Ki'Teer (Ducats)", note: "+220% damage. Baro Ki'Teer. The one-shot standard.", effectiveness: 133 }
        ]
      },
      {
        best: "Hell's Chamber",
        bestFarm: "General drops",
        bestNote: "+120% multishot.",
        alternatives: [
          { mod: "Primed Hell's Chamber", note: "Doesn't exist — regular is best-in-slot.", effectiveness: 100 },
          { mod: "Vigilante Armaments",
          farm: "Cetus bounties (Plains of Eidolon)", note: "+60% multishot. Weaker but works.", effectiveness: 50 }
        ]
      }
    ]
  },
  {
    category: "Crit Mods (One-Shot Core)",
    icon: "🎯",
    desc: "Crit chance + crit damage — the heart of one-shot builds",
    swaps: [
      {
        best: "Point Strike",
        bestFarm: "General rifle drops",
        bestNote: "+150% crit chance (rifles).",
        alternatives: [
          { mod: "Primed Point Strike", note: "Doesn't exist for rifles. Point Strike is it.", effectiveness: 100 },
          { mod: "Critical Delay",
          farm: "Orokin Vaults (Deimos) — Dragon Key", note: "+200% crit chance, -20% fire rate. Better crit, slower. Great for one-shots.", effectiveness: 133 }
        ]
      },
      {
        best: "Vital Sense",
        bestFarm: "General rifle drops",
        bestNote: "+120% crit damage (rifles).",
        alternatives: [
          { mod: "Primed Vital Sense", note: "Doesn't exist. Vital Sense is best.", effectiveness: 100 },
          { mod: "Hammer Shot",
          farm: "Nightmare missions", note: "+60% crit damage +60% status. Weaker crit, adds status.", effectiveness: 50 }
        ]
      },
      {
        best: "Blunderbuss (shotguns)",
        bestNote: "+90% crit chance.",
        alternatives: [
          { mod: "Primed Blunderbuss",
          farm: "Baro Ki'Teer (Ducats)", note: "+135% crit chance. Baro. Massive upgrade for crit shotguns.", effectiveness: 150 },
          { mod: "Critical Deceleration",
          farm: "Orokin Vaults (Deimos) — Dragon Key", note: "+200% crit chance, -20% fire rate. Best for one-shot Felarx.", effectiveness: 222 }
        ]
      },
      {
        best: "Ravage (shotguns)",
        bestNote: "+110% crit damage.",
        alternatives: [
          { mod: "Primed Ravage",
          farm: "Baro Ki'Teer (Ducats)", note: "+165% crit damage. Baro. Essential for one-shot shotguns.", effectiveness: 150 }
        ]
      }
    ]
  },
  {
    category: "Melee Damage",
    icon: "⚔️",
    desc: "The big three for melee one-shots",
    swaps: [
      {
        best: "Pressure Point",
        bestFarm: "General melee drops",
        bestNote: "+120% melee damage.",
        alternatives: [
          { mod: "Primed Pressure Point",
          farm: "Daily Tribute milestone (login reward)", note: "+165% damage. Baro/Login reward. Huge upgrade.", effectiveness: 138 },
          { mod: "Spoiled Strike",
          farm: "Orokin Vaults (Deimos) — Dragon Key", note: "+100% damage, -20% attack speed. NOT worth it for one-shots.", effectiveness: 83 }
        ]
      },
      {
        best: "Blood Rush",
        bestFarm: "Lua Spy missions",
        bestNote: "+440% crit chance at 12x combo. Core of every melee build.",
        alternatives: [
          { mod: "No alternative", note: "Nothing replaces Blood Rush. Farm it from Lua spies.", effectiveness: 0 }
        ]
      },
      {
        best: "Organ Shatter",
        bestFarm: "General melee drops",
        bestNote: "+90% crit damage.",
        alternatives: [
          { mod: "Primed Organ Shatter", note: "Doesn't exist. Regular is best.", effectiveness: 100 }
        ]
      },
      {
        best: "Weeping Wounds",
        bestFarm: "Plains of Eidolon bounties",
        bestNote: "+660% status at 12x combo.",
        alternatives: [
          { mod: "No alternative", note: "Unique effect. Essential for status melee.", effectiveness: 0 }
        ]
      }
    ]
  },
  {
    category: "Warframe Ability Strength",
    icon: "💪",
    desc: "For Nova nukes, Rhino buffs, and every ability DPS frame",
    swaps: [
      {
        best: "Intensify",
        bestFarm: "General warframe drops",
        bestNote: "+30% ability strength.",
        alternatives: [
          { mod: "Primed Intensify", note: "Doesn't exist. Use Umbral Intensify instead.", effectiveness: 100 },
          { mod: "Umbral Intensify",
          farm: "The Sacrifice quest", note: "+44% strength (+77% with the full 3-mod Umbral set, +55% with 2). The upgrade.", effectiveness: 147 },
          { mod: "Transient Fortitude",
          farm: "Orokin Vaults (Deimos) — Dragon Key", note: "+55% strength, -27.5% duration. Great for nuke frames.", effectiveness: 183 },
          { mod: "Blind Rage",
          farm: "Orokin Vaults (Deimos) — Dragon Key", note: "+99% strength, -55% efficiency. For max-strength one-shot builds.", effectiveness: 330 }
        ]
      },
      {
        best: "Augur Secrets",
        bestFarm: "Cetus bounties",
        bestNote: "+24% strength. Easy to get.",
        alternatives: [
          { mod: "No direct alternative", note: "Stacks with Intensify. Use both.", effectiveness: 0 }
        ]
      }
    ]
  },
  {
    category: "Steel Path Essentials",
    icon: "🛡️",
    desc: "Survivability mods that make Steel Path bearable",
    swaps: [
      {
        best: "Adaptation",
        bestFarm: "Arbitrations (Vitus Essence)",
        bestNote: "Up to 90% damage resistance. Arbitrations.",
        alternatives: [
          { mod: "No alternative", note: "Nothing else does this. Farm Arbitrations ASAP.", effectiveness: 0 },
          { mod: "Rolling Guard",
          farm: "Arbitrations (Vitus Essence)", note: "3s invulnerability on dodge. Different but great.", effectiveness: 80 }
        ]
      },
      {
        best: "Vitality",
        bestFarm: "General drops",
        bestNote: "+100% health.",
        alternatives: [
          { mod: "Primed Vitality",
          farm: "Baro Ki'Teer (Ducats)", note: "+440% health (same, less drain). Baro.", effectiveness: 100 },
          { mod: "Umbral Vitality",
          farm: "The Sacrifice quest", note: "+180% health with the full 3-mod Umbral set (+130% with 2). The tank standard.", effectiveness: 180 },
          { mod: "Vigor",
          farm: "Nightmare missions", note: "+50% health +50% shields. Weaker, but cheap.", effectiveness: 50 }
        ]
      },
      {
        best: "Steel Fiber",
        bestFarm: "General warframe drops",
        bestNote: "+100% armor.",
        alternatives: [
          { mod: "Primed Steel Fiber", note: "Doesn't exist. Regular is fine.", effectiveness: 100 },
          { mod: "Umbral Fiber",
          farm: "The Sacrifice quest", note: "+180% armor with the full 3-mod Umbral set (+130% with 2). Better for Umbral builds.", effectiveness: 180 }
        ]
      }
    ]
  },
  {
    category: "One-Shot Enablers",
    icon: "☠️",
    desc: "The mods that make one-shots possible",
    swaps: [
      {
        best: "Hunter Munitions",
        bestFarm: "Ghoul bounties (Cetus, Plains of Eidolon)",
        bestNote: "Crits apply Slash procs. The one-shot engine for rifles/shotguns.",
        alternatives: [
          { mod: "No alternative", note: "Nothing else does this. Ghoul bounties on Cetus.", effectiveness: 0 }
        ]
      },
      {
        best: "Internal Bleeding",
        bestFarm: "Deimos / Heart of Deimos",
        bestNote: "Like Hunter Munitions but for high-impact weapons.",
        alternatives: [
          { mod: "Hunter Munitions",
          farm: "Ghoul bounties (Cetus, Plains of Eidolon)", note: "Use HM for slash-based, IB for impact-based.", effectiveness: 100 }
        ]
      },
      {
        best: "Galvanized Aptitude",
        bestFarm: "Arbitrations — 20 Vitus Essence",
        bestNote: "+80% status chance; on kill, +40% damage per unique status proc on the target (up to +80% per proc with 2 stacks). The Arbitration damage king.",
        alternatives: [
          { mod: "No alternative", note: "Arbitration reward. Nothing else scales like this.", effectiveness: 0 }
        ]
      }
    ]
  }
];
