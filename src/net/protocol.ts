// The messages between a page and the game server (server/server.ts), as JSON over a WebSocket
// at /ws. The server runs the match (src/game/sim.ts); a page sends its inputs and draws what
// the snapshots say, predicting only its own movement and gun.
import type { Ev, Input, Mag } from '../game/sim';

/** Server ticks a second (the sim's fixed step) and snapshots a second. */
export const TICK_HZ = 60;
export const SNAP_EVERY = 3; // ticks: 20 snapshots a second
/** How far behind the newest snapshot a page draws the others, in ticks (100 ms). */
export const INTERP_TICKS = 6;

/** Page to server. room '' joins a quick match; another code joins or opens that friend room. */
export type ClientMsg =
  | { t: 'join'; room: string; name: string; weapon: number }
  | { t: 'in'; i: Input[] };

/** Everything the page needs to rebuild its own player after a snapshot. */
export interface YouState {
  seq: number; x: number; y: number; z: number; yaw: number; vx: number; vy: number; vz: number; grounded: boolean;
  slide: number; slideCd: number; eye: number; weapon: number; guns: Mag[]; fireCd: number; reload: number; raise: number;
  recoil: number; hp: number; alive: boolean; respawn: number; killedBy: string; deathT: number; sinceHurt: number;
}
/** One combatant: id, x, y, z, yaw, pitch, hp, alive, slide, weapon, kills, deaths, flash, deathT, anim. */
export type EntRow = [number, number, number, number, number, number, number, 0 | 1, number, number, number, number, 0 | 1, number, number];

/** Server to page. */
export type ServerMsg =
  | { t: 'welcome'; id: number; room: string; tick: number; diff: number }
  | { t: 'roster'; ents: { id: number; name: string; kind: string; human: boolean }[] }
  | {
    t: 'snap'; tick: number; phase: 'countdown' | 'fight' | 'over'; cd: number; tl: number;
    you: YouState; ents: EntRow[]; pk: (0 | 1)[]; ev: Ev[]; ranked: number[] | null;
  }
  | { t: 'full'; why: string };
