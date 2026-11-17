// Vitest: Slagpit's rules in src/game/, run in Node with no browser.
import { describe, expect, it } from 'vitest';
import config from '../../data/config.json';
import { STEP_UP, accel, blocked, heightAt, moveBody, outcome, rayBox, reachedTarget } from '../../src/game/rules';
import type { Body, BoxSpec } from '../../src/game/types';

const STEP = 1 / 60;
/** A step a body can climb, and a wall it cannot, both on the floor. */
const stair: BoxSpec = { minx: 1, maxx: 2, miny: 0, maxy: STEP_UP - 0.05, minz: -1, maxz: 1 };
const wall: BoxSpec = { minx: 1, maxx: 2, miny: 0, maxy: 3, minz: -1, maxz: 1 };
const body = (): Body => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, r: 0.35, grounded: true });

describe('the match target', () => {
  it('ends the match at each bot skill\'s kill target, not one kill before', () => {
    for (const key of ['matchKills0', 'matchKills1', 'matchKills2'] as const) {
      const target = config[key].value;
      expect(reachedTarget(target - 1, target)).toBe(false);
      expect(reachedTarget(target, target)).toBe(true);
    }
  });

  it('gives the player the win only alone at the top', () => {
    const t = config.matchKills1.value;
    expect(outcome([{ isPlayer: true, kills: t }, { kills: t - 3 }], t)).toEqual({ won: true, gained: 'VICTORY' });
    expect(outcome([{ isPlayer: true, kills: 5 }, { kills: 5 }], 5)).toEqual({ won: false, gained: 'DRAW' });
    expect(outcome([{ kills: t }, { isPlayer: true, kills: 2 }], 2)).toEqual({ won: false, gained: 'DEFEAT' });
  });
});

describe('movement', () => {
  it('reaches walking speed on the ground within a second, and no faster', () => {
    const b = body();
    for (let i = 0; i < 60; i++) accel(b, 1, 0, config.walkSpeed.value, config.groundAccel.value, STEP);
    expect(b.vx).toBeCloseTo(config.walkSpeed.value, 6);
  });

  it('climbs a step but stops at a wall', () => {
    const climb = body(); climb.vx = config.walkSpeed.value;
    // stop while standing on the step: about 1.7 m along
    for (let i = 0; i < 12; i++) moveBody([stair], climb, STEP, config.gravity.value);
    expect(climb.x).toBeGreaterThan(1);
    expect(climb.x).toBeLessThan(2);
    expect(climb.y).toBeCloseTo(stair.maxy, 6);
    const stop = body(); stop.vx = config.walkSpeed.value;
    for (let i = 0; i < 30; i++) moveBody([wall], stop, STEP, config.gravity.value);
    expect(stop.x).toBeLessThan(1 - stop.r + 1e-9);
    expect(stop.vx).toBe(0); // the wall took its speed
    expect(blocked([wall], 1.5, 0, 0.35, 0)).toBe(true);
    expect(heightAt([stair], 1.5, 0, 0.35, STEP_UP)).toBeCloseTo(stair.maxy, 6);
  });
});

describe('hitscan', () => {
  it('hits a box straight ahead at its near face and misses one beside the ray', () => {
    expect(rayBox([0, 1, 0], [1, 0, 0], [5, 0, -1], [6, 2, 1], 100)).toBeCloseTo(5, 6);
    expect(rayBox([0, 1, 0], [1, 0, 0], [5, 0, 2], [6, 2, 3], 100)).toBe(Infinity);
  });
});
