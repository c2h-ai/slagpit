# The values' notes

What `prototypes/slagpit/config.js` said beside its values, kept here because `data/config.json`
holds no comments. The values themselves are in `data/config.json`.

- `seed`: every gameplay random call reads rng(), seeded from this (or ?seed= in the address)

View and aim
- `sensitivity`: radians per mouse pixel
- `keyTurn`: radians/s with the arrow keys
- `fov`: degrees, vertical
- `zoomFov`: degrees, sniper scope
- `brightness`: light and fog distance multiplier; 1 is the first build's darkness
- `renderScale`: 3D pixel ratio: low is the chunky retro look

Movement (units are metres and seconds)
- `walkSpeed`: m/s on the ground
- `groundAccel`: m/s² toward the wished speed
- `friction`: 1/s speed loss on the ground
- `airSpeed`: m/s air control cap (strafe gain)
- `airAccel`: m/s² in the air
- `jumpSpeed`: m/s up
- `gravity`: m/s²
- `slideBoost`: m/s added when a slide starts
- `slideMinSpeed`: m/s needed to start a slide
- `slideTime`: s
- `slideFriction`: 1/s while sliding
- `slideCooldown`: s between slides
- `eyeHeight`: m

Match
- `respawnTime`: s, the player
- `botRespawn`: s
- `matchKills0`: first to this wins, Easy
- `matchKills1`: Normal
- `matchKills2`: Hard
- `matchTime`: s
- `countdown`: s before the fight
- `regenDelay`: s without being hit before health comes back
- `regenRate`: health per second while regenerating
- `ammoFraction`: of each gun's full reserve
- `pickupRespawn`: s
- `hpBarTime`: s a bot's health bar shows after you hit it
- `headMult`: headshot damage multiplier
- `lowAmmo`: fraction of a magazine that warns

Player guns
- `rifleRate`: s between shots
- `rifleSpread`: radians
- `rifleKick`: radians of view kick
- `shotgunDamage`: per pellet
- `sniperSpread`: scoped
- `sniperHipSpread`: not scoped
- `switchTime`: s to raise a gun

Bots: difficulty 0 easy, 1 normal, 2 hard
- `botReact0`: s from first sight to first shot
- `botAim0`: radians of aim error
- `botDamage0`: multiplier on bot damage
- `botTurn`: radians/s
- `botSight`: m
- `botHearing`: m: seen even from behind
- `botPlayerBias`: <1: bots prefer the player as a target
- `leaderBias`: the leading bot, late in the match
- `rusherDamage`: per pellet, 6 pellets
- `rusherRange`: m: fires only this close
- `bruteDamage`: per bullet, bursts of 5
- `bruteRate`: s between bursts
