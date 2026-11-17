// Slagpit's rules with no browser in them: collision against the arena's brushes, the hitscan
// ray test, movement acceleration, and how a match is won. Vitest runs these in Node.
import type { Body, Box, BoxSpec, Ranked } from './types';

/** How high a body climbs without jumping, in metres. */
export const STEP_UP = 0.65;

/** True when a square footprint of half width r at (x, z) overlaps the brush on the ground plane. */
export function overlapXZ(b: BoxSpec, x: number, z: number, r: number): boolean {
  return x + r > b.minx && x - r < b.maxx && z + r > b.minz && z - r < b.maxz;
}

/** The highest brush top under the footprint at or below `below`; the floor is 0. */
export function heightAt(boxes: BoxSpec[], x: number, z: number, r: number, below: number): number {
  let hgt = 0;
  for (const b of boxes) if (b.maxy <= below && b.maxy > hgt && overlapXZ(b, x, z, r)) hgt = b.maxy;
  return hgt;
}

/** True when a brush taller than a step above y stands in the footprint. */
export function blocked(boxes: BoxSpec[], x: number, z: number, r: number, y: number): boolean {
  for (const b of boxes) if (b.maxy > y + STEP_UP && overlapXZ(b, x, z, r)) return true;
  return false;
}

/** A straight walk from a to b climbs no more than a step at a time and ends at b's height. */
export function walkable(boxes: BoxSpec[], a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): boolean {
  const d = Math.hypot(b.x - a.x, b.z - a.z), n = Math.ceil(d / 0.4);
  let y = a.y;
  for (let i = 1; i <= n; i++) {
    const x = a.x + (b.x - a.x) * i / n, z = a.z + (b.z - a.z) * i / n;
    if (blocked(boxes, x, z, 0.45, y)) return false;
    y = heightAt(boxes, x, z, 0.45, y + STEP_UP);
  }
  return Math.abs(y - b.y) < 0.3;
}

/** Moves a body one step: x and z each stop at walls, steps are climbed, gravity pulls it down. */
export function moveBody(boxes: BoxSpec[], e: Body, dt: number, gravity: number): void {
  e.hitWall = false;
  const nx = e.x + e.vx * dt;
  if (!blocked(boxes, nx, e.z, e.r, e.y)) e.x = nx; else { e.vx = 0; e.hitWall = true; }
  const nz = e.z + e.vz * dt;
  if (!blocked(boxes, e.x, nz, e.r, e.y)) e.z = nz; else { e.vz = 0; e.hitWall = true; }
  const ground = heightAt(boxes, e.x, e.z, e.r, e.y + STEP_UP);
  e.vy -= gravity * dt;
  const ny = e.y + e.vy * dt;
  if (ny <= ground) { e.y = ground; e.vy = 0; e.grounded = true; }
  else if (e.grounded && e.vy <= 0 && ny - ground < 0.25) { e.y = ground; e.vy = 0; }
  else { e.y = ny; e.grounded = false; }
}

/** Distance along the ray from o in direction d to the box, or Infinity when it misses within far. */
export function rayBox(o: number[], d: number[], min: number[], max: number[], far: number): number {
  let t0 = 0, t1 = far;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) { if (o[a] < min[a] || o[a] > max[a]) return Infinity; continue; }
    let ta = (min[a] - o[a]) / d[a], tb = (max[a] - o[a]) / d[a];
    if (ta > tb) { const s = ta; ta = tb; tb = s; }
    if (ta > t0) t0 = ta;
    if (tb < t1) t1 = tb;
    if (t0 > t1) return Infinity;
  }
  return t0;
}

/** Distance to the nearest brush along the ray, or far. */
export function rayWorld(boxes: Box[], o: number[], d: number[], far: number): number {
  let t = far;
  for (const b of boxes) { const k = rayBox(o, d, b.min, b.max, t); if (k < t) t = k; }
  return t;
}

/** Quake-style acceleration: speeds up toward the wished direction, never past max along it. */
export function accel(e: { vx: number; vz: number }, wx: number, wz: number, max: number, a: number, dt: number): void {
  const cur = e.vx * wx + e.vz * wz, add = max - cur;
  if (add <= 0 || (wx === 0 && wz === 0)) return;
  const k = Math.min(add, a * dt); e.vx += wx * k; e.vz += wz * k;
}

/** The match's result from the standings, best first: the player wins only alone at the top. */
export function outcome(ranked: Ranked[], playerKills: number): { won: boolean; gained: 'VICTORY' | 'DRAW' | 'DEFEAT' } {
  const won = !!ranked[0].isPlayer && (ranked.length < 2 || ranked[0].kills > ranked[1].kills);
  return { won, gained: won ? 'VICTORY' : ranked[0].kills === playerKills ? 'DRAW' : 'DEFEAT' };
}

/** True when this kill count ends the match. */
export function reachedTarget(kills: number, target: number): boolean {
  return kills >= target;
}

/** Linear blend from a to b. */
export const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
