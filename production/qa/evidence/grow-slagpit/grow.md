# Grow record: slagpit

From `prototypes/slagpit/` at commit bfdc72e (first build tag `one-shot/slagpit`).

| Step | Result |
|---|---|
| 1 Reference | same-seed replay twice: `exact yes` (reference.png) |
| 2 Copy (JavaScript) | three.js 0.186.1 pinned from npm; the one-shot's scripts carried into src/main.js in page order; replay `match yes` (copy.png) |
| 3 TypeScript | src/game/rules.ts, src/game/types.ts, src/art.ts, src/audio.ts, src/config.ts, src/main.ts; `tsc --noEmit` clean; replay `match yes` (typescript.png) |
| 4 Rules under test | Vitest 5 passed (kill target watched failing when broken, then restored); Playwright 2 passed (boot, same-seed scripted run) |
| 5 Checks | `npm run build` ok · `test-run.sh web` rule web:pass, 7 tests · `npm run smoke` 1 passed |

Seen in: typescript.png, beside reference.png: the same frame.

NOT ASSESSED: nothing.

Still `Loose` (typing still to do): the combatants (player, bot kinds), the match state, the three.js world bag `W3`, the arena data from `ART.arena`, the bot model's userData.
