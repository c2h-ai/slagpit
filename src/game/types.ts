// Shared types for Slagpit's rules and world.

/**
 * Objects the code builds field by field, kind by kind: the combatants (the player and each
 * bot kind), the match state and the three.js world bag. Typing still to do (grow record).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Loose = any;

/** A solid brush of the arena, as the art builds it: every brush stands on the floor. */
export interface BoxSpec { minx: number; maxx: number; miny: number; maxy: number; minz: number; maxz: number }

/** A brush with its corners as arrays too, for the ray test. */
export interface Box extends BoxSpec { min: number[]; max: number[] }

/** A combatant as the rules see it. */
export interface Body { x: number; y: number; z: number; vx: number; vy: number; vz: number; r: number; grounded: boolean; hitWall?: boolean }

/** One row of the final standings. */
export interface Ranked { isPlayer?: boolean; kills: number }
