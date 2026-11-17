// The arena as data, with no three.js: every brush, the lava strips, the lights, the spawn
// points, the pickups and the bots' walking nodes. The browser draws it (src/art.ts) and the
// game server collides against the same brushes. Symmetric, 64 m square; every solid brush
// stands on the floor.
import type { BoxSpec } from './types';

/** A brush and the material it is drawn with; a non-solid one is decoration only. */
export interface Brush extends BoxSpec { mat: 'floor' | 'wall' | 'metal' | 'crate' | 'lava'; solid: boolean }
/** A spawn point facing the middle. */
export interface Spawn { x: number; z: number; yaw: number }
/** A pickup's place. */
export interface PickupSpot { kind: 'health' | 'ammo'; x: number; y: number; z: number }
/** The whole arena. */
export interface Arena {
  brushes: Brush[];
  lights: { x: number; y: number; z: number; color: number; intensity: number; distance: number }[];
  spawns: Spawn[];
  pickups: PickupSpot[];
  nodes: { x: number; z: number }[];
}

const A = 32;

/** Builds the arena's data, the same every time. */
export function buildArena(): Arena {
  const brushes: Brush[] = [];
  const add = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, mat: Brush['mat'], solid = true): void => {
    brushes.push({ minx: x0, maxx: x1, miny: y0, maxy: y1, minz: z0, maxz: z1, mat, solid });
  };
  type M = Brush['mat'];
  const mx = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, m: M): void => { add(x0, x1, y0, y1, z0, z1, m); add(-x1, -x0, y0, y1, z0, z1, m); };
  const mz = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, m: M): void => { add(x0, x1, y0, y1, z0, z1, m); add(x0, x1, y0, y1, -z1, -z0, m); };
  const m4 = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, m: M): void => { mz(x0, x1, y0, y1, z0, z1, m); mz(-x1, -x0, y0, y1, z0, z1, m); };

  add(-A, A, -1, 0, -A, A, 'floor');
  mz(-A - 1, A + 1, 0, 10, A, A + 1, 'wall'); mx(A, A + 1, 0, 10, -A, A, 'wall');
  // the central hill: a platform with stairs on the east and west and low cover north and south
  add(-5, 5, 0, 2.4, -5, 5, 'metal');
  for (let k = 1; k <= 3; k++) mx(5 + (3 - k) * 1.2, 5 + (4 - k) * 1.2, 0, 0.6 * k, -2, 2, 'metal');
  mz(-5, 5, 2.4, 3.3, 4.4, 5, 'wall');
  // four corner towers, stairs running toward the middle, a parapet on the inner side
  m4(22, A, 0, 3, 22, A, 'wall');
  for (let k = 1; k <= 4; k++) m4(24, 28, 0, 0.6 * k, 22 - (5 - k) * 1.2, 22 - (4 - k) * 1.2, 'metal');
  m4(22, 22.6, 3, 4, 25, A, 'wall');
  // cover: long walls, side walls, crates, pillars
  mz(-6, 6, 0, 2.2, 19.5, 20.5, 'wall');
  mx(19.5, 20.5, 0, 2.2, -5, 5, 'wall');
  m4(11, 13.2, 0, 2.2, 7, 9.2, 'crate');
  m4(7, 8.4, 0, 1, 13, 14.4, 'crate');
  m4(18, 19.4, 0, 6, 9, 10.4, 'wall');
  // lava channels set into the walls and the floor: the signature light (decoration)
  const lava = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): void => add(x0, x1, y0, y1, z0, z1, 'lava', false);
  lava(-20, 20, 3, 3.5, A - 0.05, A); lava(-20, 20, 3, 3.5, -A, -A + 0.05);
  lava(A - 0.05, A, 3, 3.5, -20, 20); lava(-A, -A + 0.05, 3, 3.5, -20, 20);
  for (const [a, b, c, d] of [[-1, 1, 7, 18], [-1, 1, -18, -7]]) { lava(a, b, 0.005, 0.03, c, d); lava(c, d, 0.005, 0.03, a, b); }

  const lights = [
    ...[[0, 4, A - 2], [0, 4, -A + 2], [A - 2, 4, 0], [-A + 2, 4, 0]].map(([x, y, z]) => ({ x, y, z, color: 0xff5a1a, intensity: 9, distance: 34 })),
    { x: 0, y: 7, z: 0, color: 0xffa050, intensity: 6, distance: 26 },
  ];
  const spawns = [[26, 0], [-26, 0], [0, 26], [0, -26], [14, 26], [-14, 26], [14, -26], [-14, -26], [26, 14], [-26, -14], [26, -14], [-26, 14]]
    .map(([x, z]) => ({ x, z, yaw: Math.atan2(x, z) }));
  const pickups: PickupSpot[] = [
    ...[[26.5, 26.5], [-26.5, 26.5], [26.5, -26.5], [-26.5, -26.5]].map(([x, z]) => ({ kind: 'health' as const, x, y: 3, z })),
    ...[[0, 14], [0, -14]].map(([x, z]) => ({ kind: 'health' as const, x, y: 0, z })), // on the floor, between the hill and the long walls
    ...[[24, 0], [-24, 0], [0, 25], [0, -25], [0, 0]].map(([x, z]) => ({ kind: 'ammo' as const, x, y: x === 0 && z === 0 ? 2.4 : 0, z })),
  ];
  const nodes = [[10, 0], [-10, 0], [0, 0], [14, 14], [-14, 14], [14, -14], [-14, -14], [0, 14], [0, -14], [0, 26], [0, -26],
    [26, 0], [-26, 0], [14, 26], [-14, 26], [14, -26], [-14, -26], [26, 14], [-26, 14], [26, -14], [-26, -14],
    [26, 16], [-26, 16], [26, -16], [-26, -16], [26.5, 26.5], [-26.5, 26.5], [26.5, -26.5], [-26.5, -26.5], [6, 24], [-6, 24], [6, -24], [-6, -24]]
    .map(([x, z]) => ({ x, z }));
  return { brushes, lights, spawns, pickups, nodes };
}
