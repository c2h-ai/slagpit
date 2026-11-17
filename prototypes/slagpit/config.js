// PROTOTYPE - NOT FOR PRODUCTION
// Question: 봇 상대로 빠른 이동+사격 데스매치가 10분 동안 재밌는가?
// Date: 2026-11-17
// Every tuning value lives here, each with value, min, max and step. The game reads them live
// through tune.<name> (index.html); the tweak panel, an add-on, writes them back here.
window.CONFIG = {
  seed: 1, // every gameplay random call reads rng(), seeded from this (or ?seed= in the address)
  volume: { value: 0.5, min: 0, max: 1, step: 0.05 },

  // View and aim
  sensitivity: { value: 0.0024, min: 0.0004, max: 0.008, step: 0.0001 }, // radians per mouse pixel
  keyTurn: { value: 2.6, min: 0.5, max: 6, step: 0.1 },        // radians/s with the arrow keys
  fov: { value: 90, min: 60, max: 115, step: 1 },              // degrees, vertical
  zoomFov: { value: 32, min: 15, max: 60, step: 1 },           // degrees, sniper scope
  renderScale: { value: 0.5, min: 0.25, max: 1, step: 0.05 },  // 3D pixel ratio: low is the chunky retro look

  // Movement (units are metres and seconds)
  walkSpeed: { value: 8.5, min: 4, max: 14, step: 0.1 },       // m/s on the ground
  groundAccel: { value: 70, min: 10, max: 200, step: 1 },      // m/s² toward the wished speed
  friction: { value: 9, min: 1, max: 20, step: 0.5 },          // 1/s speed loss on the ground
  airSpeed: { value: 3, min: 0.5, max: 10, step: 0.1 },        // m/s air control cap (strafe gain)
  airAccel: { value: 40, min: 5, max: 150, step: 1 },          // m/s² in the air
  jumpSpeed: { value: 7.8, min: 4, max: 12, step: 0.1 },       // m/s up
  gravity: { value: 24, min: 10, max: 40, step: 0.5 },         // m/s²
  slideBoost: { value: 4.5, min: 0, max: 10, step: 0.1 },      // m/s added when a slide starts
  slideMinSpeed: { value: 5, min: 0, max: 10, step: 0.1 },     // m/s needed to start a slide
  slideTime: { value: 0.7, min: 0.2, max: 2, step: 0.05 },     // s
  slideFriction: { value: 1.2, min: 0, max: 6, step: 0.1 },    // 1/s while sliding
  slideCooldown: { value: 0.4, min: 0, max: 2, step: 0.05 },   // s between slides
  eyeHeight: { value: 1.55, min: 1.2, max: 1.8, step: 0.01 },  // m
  slideEyeHeight: { value: 0.9, min: 0.5, max: 1.4, step: 0.01 },

  // Match
  maxHealth: { value: 100, min: 50, max: 200, step: 5 },
  respawnTime: { value: 2, min: 0.5, max: 6, step: 0.1 },      // s, the player
  botRespawn: { value: 2.5, min: 0.5, max: 8, step: 0.1 },     // s
  matchKills0: { value: 10, min: 3, max: 50, step: 1 },        // first to this wins, Easy
  matchKills1: { value: 15, min: 3, max: 50, step: 1 },        // Normal
  matchKills2: { value: 20, min: 3, max: 50, step: 1 },        // Hard
  matchTime: { value: 300, min: 60, max: 900, step: 10 },      // s
  countdown: { value: 3, min: 0, max: 6, step: 0.5 },         // s before the fight
  regenDelay: { value: 4, min: 0, max: 15, step: 0.5 },      // s without being hit before health comes back
  regenRate: { value: 8, min: 0, max: 50, step: 1 },         // health per second while regenerating
  healthAmount: { value: 50, min: 10, max: 100, step: 5 },
  ammoFraction: { value: 0.5, min: 0.1, max: 1, step: 0.05 },  // of each gun's full reserve
  pickupRespawn: { value: 15, min: 3, max: 60, step: 1 },      // s
  hpBarTime: { value: 3, min: 0.5, max: 10, step: 0.5 },    // s a bot's health bar shows after you hit it
  headMult: { value: 1.6, min: 1, max: 3, step: 0.1 },         // headshot damage multiplier
  lowAmmo: { value: 0.25, min: 0, max: 0.6, step: 0.05 },      // fraction of a magazine that warns

  // Player guns
  rifleDamage: { value: 22, min: 5, max: 60, step: 1 },
  rifleRate: { value: 0.1, min: 0.04, max: 0.5, step: 0.01 },  // s between shots
  rifleSpread: { value: 0.012, min: 0, max: 0.1, step: 0.001 }, // radians
  rifleMag: { value: 30, min: 5, max: 60, step: 1 },
  rifleReserve: { value: 120, min: 0, max: 300, step: 10 },
  rifleReload: { value: 1.5, min: 0.3, max: 4, step: 0.1 },
  rifleKick: { value: 0.012, min: 0, max: 0.1, step: 0.001 },  // radians of view kick
  shotgunDamage: { value: 13, min: 2, max: 40, step: 1 },      // per pellet
  shotgunPellets: { value: 8, min: 1, max: 16, step: 1 },
  shotgunRate: { value: 0.75, min: 0.2, max: 2, step: 0.05 },
  shotgunSpread: { value: 0.075, min: 0.01, max: 0.2, step: 0.005 },
  shotgunMag: { value: 6, min: 1, max: 12, step: 1 },
  shotgunReserve: { value: 30, min: 0, max: 80, step: 2 },
  shotgunReload: { value: 1.9, min: 0.3, max: 4, step: 0.1 },
  shotgunKick: { value: 0.05, min: 0, max: 0.2, step: 0.005 },
  sniperDamage: { value: 90, min: 30, max: 200, step: 5 },
  sniperRate: { value: 1.1, min: 0.3, max: 3, step: 0.05 },
  sniperSpread: { value: 0.002, min: 0, max: 0.05, step: 0.001 },   // scoped
  sniperHipSpread: { value: 0.04, min: 0, max: 0.15, step: 0.005 }, // not scoped
  sniperMag: { value: 5, min: 1, max: 10, step: 1 },
  sniperReserve: { value: 25, min: 0, max: 60, step: 1 },
  sniperReload: { value: 2.2, min: 0.3, max: 4, step: 0.1 },
  sniperKick: { value: 0.08, min: 0, max: 0.3, step: 0.005 },
  switchTime: { value: 0.3, min: 0, max: 1, step: 0.05 },      // s to raise a gun

  // Bots: difficulty 0 easy, 1 normal, 2 hard
  botReact0: { value: 0.65, min: 0.05, max: 2, step: 0.05 },   // s from first sight to first shot
  botReact1: { value: 0.38, min: 0.05, max: 2, step: 0.05 },
  botReact2: { value: 0.22, min: 0.05, max: 2, step: 0.05 },
  botAim0: { value: 0.11, min: 0, max: 0.3, step: 0.005 },     // radians of aim error
  botAim1: { value: 0.065, min: 0, max: 0.3, step: 0.005 },
  botAim2: { value: 0.04, min: 0, max: 0.3, step: 0.005 },
  botDamage0: { value: 0.7, min: 0.2, max: 2, step: 0.05 },    // multiplier on bot damage
  botDamage1: { value: 1, min: 0.2, max: 2, step: 0.05 },
  botDamage2: { value: 1.2, min: 0.2, max: 2, step: 0.05 },
  botTurn: { value: 6, min: 1, max: 20, step: 0.5 },           // radians/s
  botSight: { value: 60, min: 10, max: 100, step: 1 },         // m
  botHearing: { value: 8, min: 0, max: 30, step: 0.5 },        // m: seen even from behind
  botPlayerBias: { value: 0.8, min: 0.3, max: 1.5, step: 0.05 }, // <1: bots prefer the player as a target
  leaderBias: { value: 0.45, min: 0.2, max: 1, step: 0.05 },   // the leading bot, late in the match
  rusherSpeed: { value: 7.5, min: 2, max: 12, step: 0.1 },
  rusherHp: { value: 100, min: 30, max: 300, step: 5 },
  rusherDamage: { value: 9, min: 1, max: 30, step: 1 },        // per pellet, 6 pellets
  rusherRate: { value: 0.9, min: 0.2, max: 3, step: 0.05 },
  rusherRange: { value: 16, min: 4, max: 40, step: 1 },        // m: fires only this close
  lancerSpeed: { value: 6, min: 2, max: 12, step: 0.1 },
  lancerHp: { value: 90, min: 30, max: 300, step: 5 },
  lancerDamage: { value: 40, min: 5, max: 100, step: 1 },
  lancerRate: { value: 1.7, min: 0.3, max: 4, step: 0.05 },
  bruteSpeed: { value: 4.8, min: 2, max: 12, step: 0.1 },
  bruteHp: { value: 175, min: 50, max: 400, step: 5 },
  bruteDamage: { value: 8, min: 1, max: 30, step: 1 },         // per bullet, bursts of 5
  bruteRate: { value: 1.0, min: 0.2, max: 3, step: 0.05 },     // s between bursts
};
