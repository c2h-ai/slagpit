// Slagpit's match simulation, with no browser and no three.js: the same code runs a solo match
// in the page and an online match on the game server (server/server.ts). Humans are driven by
// Input records, bots by src/game/botai.ts. Everything a viewer should see or hear happens as
// an event in sim.events; the page turns events into sound and effects.
// Design: design/game-brief.md (Core loop, Goal & fail state, Features).
import { buildArena, type Arena, type Spawn } from './arena';
import * as R from './rules';
import type { Box } from './types';
import { updateBot } from './botai';

/** Live tuning values by name (data/config.json's values). */
export type Cfg = Record<string, number>;

export const GUNS = ['rifle', 'shotgun', 'sniper'] as const;
export const GUN_NAMES = ['Rifle', 'Shotgun', 'Sniper'];
export const KIND_NAMES: Record<string, string> = { rusher: 'Scrapper', lancer: 'Lancer', brute: 'Furnace', runner: 'Runner' };
/** Hitboxes: half width, body height, head height, head half width. */
export const SHAPES: Record<string, { w: number; h: number; hh: number; hw: number }> = {
  player: { w: 0.35, h: 1.4, hh: 0.35, hw: 0.2 },
  rusher: { w: 0.42, h: 1.3, hh: 0.35, hw: 0.2 },
  lancer: { w: 0.3, h: 1.72, hh: 0.42, hw: 0.18 },
  brute: { w: 0.62, h: 1.48, hh: 0.3, hw: 0.2 },
};
/** Where each kind's muzzle sits, in its own space (it faces -z). */
export const MUZZLE: Record<string, [number, number, number]> = {
  rusher: [0.4, 0.95, -0.7], lancer: [0.22, 1.25, -1.4], brute: [0.78, 0.95, -1.1], runner: [0.3, 1.07, -0.9],
};
const ROSTER: [string, string][] = [['rusher', 'Cinder'], ['lancer', 'Lance'], ['brute', 'Furnace'], ['rusher', 'Scrap'], ['lancer', 'Pike']];
const BOT_SPAWNS = [1, 5, 7, 9, 11]; // the far side from the first human's spawn
const HISTORY = 60; // ticks of positions kept for lag compensation: one second

/** One step of a human's controls. yaw and pitch are absolute; the "pressed" fields are edges. */
export interface Input {
  seq: number; f: number; s: number; jump: boolean; slide: boolean;
  fire: boolean; firePressed: boolean; reload: boolean; weapon: number; next: boolean; zoom: boolean;
  yaw: number; pitch: number;
  /** The server tick this viewer saw the others at, for lag compensation (online only). */
  viewTick?: number;
}
export const NO_INPUT: Input = { seq: 0, f: 0, s: 0, jump: false, slide: false, fire: false, firePressed: false, reload: false, weapon: -1, next: false, zoom: false, yaw: 0, pitch: 0 };

/** A gun's magazine and reserve. */
export interface Mag { mag: number; reserve: number }
/** A combatant: a human or a bot. Bots use the AI fields. */
export interface Ent {
  id: number; name: string; human: boolean; kind: string;
  x: number; y: number; z: number; px: number; py: number; pz: number; vx: number; vy: number; vz: number; r: number;
  yaw: number; pitch: number; grounded: boolean; hitWall?: boolean; hp: number; alive: boolean; respawn: number; deathT: number;
  kills: number; deaths: number; killedBy: string; slide: number; anim: number; flash: number;
  // humans
  slideCd: number; eye: number; weapon: number; guns: Mag[]; fireCd: number; reload: number; raise: number;
  kick: number; recoil: number; bob: number; zoom: boolean; lowWarned: boolean; sinceHurt: number; seq: number;
  // bots
  target: Ent | null; alert: Ent | null; react: number; think: number; burst: number;
  strafe: number; strafeT: number; stuck: number; node: number; prevNode: number; last: { x: number; z: number } | null; lastT: number;
  hist: { tick: number; x: number; y: number; z: number; slide: number }[];
}
/** Something a viewer sees or hears. Ids name the combatants. */
export type Ev =
  | { k: 'shot'; id: number; gun: string; from: number[]; to: number[]; hit: boolean }
  | { k: 'hurt'; v: number; by: number; amt: number; head: boolean }
  | { k: 'kill'; v: number; by: number; gun: string }
  | { k: 'pickup' | 'reload' | 'reloaded' | 'switch' | 'empty' | 'low' | 'jump' | 'slide'; id: number }
  | { k: 'go' | 'tick' }
  | { k: 'end'; ranked: number[] };
/** A walking node for the bots, with the nodes a straight walk reaches. */
export interface Node { x: number; y: number; z: number; links: number[] }

/** A match: the arena, the combatants, the clock and this step's events. */
export interface Sim {
  cfg: Cfg; rng: () => number; arena: Arena; boxes: Box[]; nodes: Node[]; diff: number;
  all: Ent[]; pickups: { kind: string; x: number; y: number; z: number; cd: number }[];
  phase: 'countdown' | 'fight' | 'over'; countdown: number; timeLeft: number; tick: number;
  events: Ev[]; nextId: number; seats: number; ranked: Ent[] | null;
}

/** mulberry32: every gameplay random call reads this, never Math.random. */
export function makeRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The shared world both the sim and a predicting viewer collide against. */
export function buildWorld(): { arena: Arena; boxes: Box[]; nodes: Node[] } {
  const arena = buildArena();
  const boxes = arena.brushes.filter(b => b.solid).map(b => ({ ...b, min: [b.minx, b.miny, b.minz], max: [b.maxx, b.maxy, b.maxz] }));
  const nodes: Node[] = arena.nodes.map(n => ({ ...n, y: R.heightAt(boxes, n.x, n.z, 0.3, 99), links: [] }));
  nodes.forEach((n, i) => nodes.forEach((m, j) => { if (i !== j && R.walkable(boxes, n, m)) n.links.push(j); }));
  return { arena, boxes, nodes };
}

/** A new match with no one in it yet. seats: how many combatants; bots fill what humans leave. */
export function createSim(cfg: Cfg, seed: number, diff: number, seats = 6): Sim {
  const w = buildWorld();
  const sim: Sim = { cfg, rng: makeRng(seed), ...w, diff, all: [], pickups: [], phase: 'countdown', countdown: 0, timeLeft: 0,
    tick: 0, events: [], nextId: 1, seats, ranked: null };
  resetMatch(sim);
  return sim;
}
/** The first-to score for this match's bot skill. */
export function killTarget(sim: Sim): number { return sim.cfg['matchKills' + sim.diff]; }
export function diffCfg(sim: Sim, n: string): number { return sim.cfg[n + sim.diff]; }

function blank(sim: Sim, name: string, human: boolean, kind: string, sp: Spawn): Ent {
  const c = sim.cfg;
  return {
    id: sim.nextId++, name, human, kind, x: sp.x, y: 0, z: sp.z, px: sp.x, py: 0, pz: sp.z, vx: 0, vy: 0, vz: 0,
    r: human ? 0.35 : SHAPES[kind].w, yaw: sp.yaw, pitch: 0, grounded: true, hp: human ? c.maxHealth : c[kind + 'Hp'],
    alive: true, respawn: 0, deathT: 0, kills: 0, deaths: 0, killedBy: '', slide: 0, anim: 0, flash: 0,
    slideCd: 0, eye: c.eyeHeight, weapon: 0, guns: fullGuns(c), fireCd: 0, reload: 0, raise: 0, kick: 0, recoil: 0, bob: 0,
    zoom: false, lowWarned: false, sinceHurt: 99, seq: 0,
    target: null, alert: null, react: 0, think: 0, burst: 0, strafe: 1, strafeT: 1, stuck: 0, node: -1, prevNode: -1, last: null, lastT: 99,
    hist: [],
  };
}
export function fullGuns(c: Cfg): Mag[] { return GUNS.map(k => ({ mag: c[k + 'Mag'], reserve: c[k + 'Reserve'] })); }

/** A human joins; a bot gives up its seat when the match is full. */
export function addHuman(sim: Sim, name: string, weapon: number): Ent {
  const humans = sim.all.filter(e => e.human).length;
  const sp = humans === 0 ? sim.arena.spawns[0] : farSpawn(sim);
  const p = blank(sim, name, true, 'runner', sp);
  p.weapon = weapon;
  if (sim.all.length >= sim.seats) {
    const bots = sim.all.filter(e => !e.human).sort((a, b) => a.kills - b.kills);
    if (bots.length) removeEnt(sim, bots[0].id);
  }
  sim.all.push(p);
  return p;
}
/** Takes a combatant out; a bot fills a human's empty seat. */
export function removeEnt(sim: Sim, id: number): void {
  const e = sim.all.find(x => x.id === id);
  sim.all = sim.all.filter(x => x.id !== id);
  for (const b of sim.all) { if (b.target === e) b.target = null; if (b.alert === e) b.alert = null; }
  if (e?.human) fillBots(sim);
}
function fillBots(sim: Sim): void {
  let i = 0;
  while (sim.all.length < sim.seats && i < 20) {
    const used = new Set(sim.all.map(e => e.name));
    const pick = ROSTER.find(([, n]) => !used.has('BOT ' + n)) ?? ROSTER[i % ROSTER.length];
    const k = sim.all.filter(e => !e.human).length;
    const sp = sim.all.length ? (sim.phase === 'countdown' ? sim.arena.spawns[BOT_SPAWNS[k % 5]] : farSpawn(sim)) : sim.arena.spawns[BOT_SPAWNS[k % 5]];
    const b = blank(sim, 'BOT ' + pick[1], false, pick[0], sp);
    b.think = sim.rng() * 0.25; b.strafe = sim.rng() < 0.5 ? 1 : -1;
    sim.all.push(b); i++;
  }
}
/** Starts a new match: scores cleared, everyone back at a spawn, bots in the empty seats. */
export function resetMatch(sim: Sim): void {
  const c = sim.cfg;
  const humans = sim.all.filter(e => e.human);
  sim.all = [];
  humans.forEach((h, i) => {
    const sp = sim.arena.spawns[i === 0 ? 0 : [2, 3, 4, 6, 8, 10][(i - 1) % 6]];
    const fresh = blank(sim, h.name, true, 'runner', sp); fresh.id = h.id; fresh.weapon = h.weapon;
    sim.all.push(fresh);
  });
  fillBots(sim);
  Object.assign(sim, { phase: 'countdown', countdown: c.countdown, timeLeft: c.matchTime, ranked: null,
    pickups: sim.arena.pickups.map(p => ({ ...p, cd: 0 })) });
}

// ---- Rays and sight ----------------------------------------------------------------
export function hitboxes(c: { human?: boolean; kind: string; slide: number; x: number; y: number; z: number }): { min: number[]; max: number[]; head: boolean }[] {
  const s = SHAPES[c.human ? 'player' : c.kind], k = c.slide > 0 ? 0.6 : 1, top = c.y + s.h * k;
  return [
    { min: [c.x - s.w, c.y, c.z - s.w], max: [c.x + s.w, top, c.z + s.w], head: false },
    { min: [c.x - s.hw, top, c.z - s.hw], max: [c.x + s.hw, top + s.hh, c.z + s.hw], head: true },
  ];
}
export function eyeOf(c: Ent): number[] { return [c.x, c.y + (c.human ? c.eye : SHAPES[c.kind].h + SHAPES[c.kind].hh * 0.5), c.z]; }
export function dirFrom(yaw: number, pitch: number): number[] { const cp = Math.cos(pitch); return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp]; }
export function canSee(sim: Sim, a: Ent, b: Ent): boolean {
  const o = eyeOf(a), t = [b.x, b.y + 1.1, b.z], d = [t[0] - o[0], t[1] - o[1], t[2] - o[2]], len = Math.hypot(...d);
  return R.rayWorld(sim.boxes, o, d.map(v => v / len), len) >= len;
}
export function angleTo(a: { x: number; z: number }, b: { x: number; z: number }): number { return Math.atan2(-(b.x - a.x), -(b.z - a.z)); }
export function muzzleOf(b: Ent): number[] {
  const [lx, ly, lz] = MUZZLE[b.kind], s = Math.sin(b.yaw), c = Math.cos(b.yaw);
  return [b.x + lx * c + lz * s, b.y + ly, b.z - lx * s + lz * c];
}
/** Where c stood at a past tick (lag compensation), or now. */
function posAt(c: Ent, tick: number | undefined): Ent {
  if (tick === undefined) return c;
  const h = c.hist.find(p => p.tick === tick);
  return h ? { ...c, x: h.x, y: h.y, z: h.z, slide: h.slide } : c;
}

/** One shot from `who`: pellets with spread; the nearest hit takes the damage. */
export function fire(sim: Sim, who: Ent, yaw: number, pitch: number, spread: number, damage: number, pellets: number, gun: string, viewTick?: number): void {
  const o = eyeOf(who), from = who.human ? o : muzzleOf(who);
  for (let p = 0; p < pellets; p++) {
    const a = sim.rng() * Math.PI * 2, m = Math.sqrt(sim.rng()) * spread;
    const d = dirFrom(yaw + Math.cos(a) * m, pitch + Math.sin(a) * m);
    let far = R.rayWorld(sim.boxes, o, d, 150), victim: Ent | null = null, head = false;
    for (const c of sim.all) {
      if (c === who || !c.alive) continue;
      for (const hb of hitboxes(posAt(c, viewTick))) { const t = R.rayBox(o, d, hb.min, hb.max, far); if (t < far) { far = t; victim = c; head = hb.head; } }
    }
    sim.events.push({ k: 'shot', id: who.id, gun, from, to: [o[0] + d[0] * far, o[1] + d[1] * far, o[2] + d[2] * far], hit: !!victim });
    if (victim) hurt(sim, victim, damage * (head ? sim.cfg.headMult : 1), who, head);
  }
}

// ---- Humans ------------------------------------------------------------------------
/** A human's movement for one step from its input: the server and a predicting viewer both run it. */
export function moveHuman(boxes: Box[], c: Cfg, p: Ent, inp: Input, dt: number, events?: Ev[]): void {
  p.yaw = inp.yaw; p.pitch = Math.max(-1.5, Math.min(1.5, inp.pitch));
  p.recoil = Math.max(0, p.recoil - dt * 0.6);
  let wx = -Math.sin(p.yaw) * inp.f + Math.cos(p.yaw) * inp.s, wz = -Math.cos(p.yaw) * inp.f - Math.sin(p.yaw) * inp.s;
  const wl = Math.hypot(wx, wz); if (wl > 0) { wx /= wl; wz /= wl; }
  const speed = Math.hypot(p.vx, p.vz);
  p.slideCd -= dt;
  if (inp.slide && p.grounded && speed > c.slideMinSpeed && p.slideCd <= 0) {
    p.slide = c.slideTime; p.slideCd = c.slideTime + c.slideCooldown;
    p.vx += p.vx / speed * c.slideBoost; p.vz += p.vz / speed * c.slideBoost;
    events?.push({ k: 'slide', id: p.id });
  }
  if (p.slide > 0) p.slide -= dt;
  if (p.grounded && inp.jump) { // held space hops on landing: speed carries
    p.vy = c.jumpSpeed; p.grounded = false; p.slide = 0; events?.push({ k: 'jump', id: p.id });
  } else if (p.grounded) {
    const fr = p.slide > 0 ? c.slideFriction : c.friction;
    const k = Math.max(0, 1 - fr * dt); p.vx *= k; p.vz *= k;
    if (p.slide <= 0) R.accel(p, wx, wz, c.walkSpeed, c.groundAccel, dt);
  } else R.accel(p, wx, wz, c.airSpeed, c.airAccel, dt);
  R.moveBody(boxes, p, dt, c.gravity);
  p.x = Math.max(-31.6, Math.min(31.6, p.x)); p.z = Math.max(-31.6, Math.min(31.6, p.z));
  const eyeTo = p.slide > 0 ? c.slideEyeHeight : c.eyeHeight;
  p.eye += (eyeTo - p.eye) * Math.min(1, dt * 14);
  p.bob += Math.hypot(p.vx, p.vz) * dt * (p.grounded && p.slide <= 0 ? 1.4 : 0);
  p.anim += Math.hypot(p.vx, p.vz) * dt * 1.6;
}
/**
 * A human's gun for one step. shoot is called for each shot fired, with the spread: the sim
 * resolves the hit, a predicting viewer only shows it.
 */
export function stepGun(c: Cfg, p: Ent, inp: Input, dt: number, canFire: boolean, shoot: (spread: number) => void, events?: Ev[]): void {
  p.fireCd -= dt; p.kick = Math.max(0, p.kick - dt * 5); p.flash -= dt; p.raise = Math.max(0, p.raise - dt);
  const sw = (i: number): void => { p.weapon = i; p.reload = 0; p.raise = c.switchTime; p.fireCd = 0; p.lowWarned = false; events?.push({ k: 'switch', id: p.id }); };
  if (inp.weapon >= 0 && inp.weapon < 3 && inp.weapon !== p.weapon) sw(inp.weapon);
  if (inp.next) sw((p.weapon + 1) % 3);
  const k = GUNS[p.weapon], g = p.guns[p.weapon], magMax = c[k + 'Mag'];
  const startReload = (): void => { p.reload = c[k + 'Reload']; p.zoom = false; events?.push({ k: 'reload', id: p.id }); };
  p.zoom = k === 'sniper' && inp.zoom && p.reload <= 0 && p.raise <= 0;
  if (p.reload > 0) {
    p.reload -= dt;
    if (p.reload <= 0) { const n = Math.min(magMax - g.mag, g.reserve); g.mag += n; g.reserve -= n; p.lowWarned = false; events?.push({ k: 'reloaded', id: p.id }); }
    return;
  }
  if (inp.reload && g.mag < magMax && g.reserve > 0) { startReload(); return; }
  if (!canFire || p.raise > 0) return;
  if (inp.fire && p.fireCd <= 0) {
    if (g.mag <= 0) {
      if (g.reserve > 0) startReload(); else if (inp.firePressed) events?.push({ k: 'empty', id: p.id });
      return;
    }
    g.mag--; p.fireCd = c[k + 'Rate']; p.flash = 0.05;
    shoot(k === 'sniper' ? (p.zoom ? c.sniperSpread : c.sniperHipSpread) : c[k + 'Spread'] * (p.grounded ? 1 : 1.6));
    p.recoil += c[k + 'Kick']; p.kick = 1;
    if (g.mag <= magMax * c.lowAmmo && g.mag > 0 && !p.lowWarned) { p.lowWarned = true; events?.push({ k: 'low', id: p.id }); }
    if (g.mag === 0) events?.push({ k: 'empty', id: p.id });
  }
}
function stepHuman(sim: Sim, p: Ent, inp: Input, dt: number, canFire: boolean): void {
  const c = sim.cfg;
  p.px = p.x; p.py = p.y; p.pz = p.z; p.flash -= dt;
  if (!p.alive) {
    p.deathT += dt; p.respawn -= dt;
    if (p.respawn <= 0) {
      const sp = farSpawn(sim, p);
      Object.assign(p, { x: sp.x, y: 0, z: sp.z, px: sp.x, py: 0, pz: sp.z, vx: 0, vy: 0, vz: 0, yaw: sp.yaw, pitch: 0, hp: c.maxHealth,
        alive: true, slide: 0, reload: 0, raise: c.switchTime, guns: fullGuns(c), recoil: 0 });
    }
    return;
  }
  p.seq = inp.seq;
  moveHuman(sim.boxes, c, p, inp, dt, sim.events);
  // out of the fight for a while: health creeps back
  p.sinceHurt += dt;
  if (p.sinceHurt >= c.regenDelay && p.hp < c.maxHealth) p.hp = Math.min(c.maxHealth, p.hp + c.regenRate * dt);
  const k = GUNS[p.weapon];
  stepGun(c, p, inp, dt, canFire,
    spread => fire(sim, p, p.yaw, p.pitch + p.recoil, spread, c[k + 'Damage'], k === 'shotgun' ? c.shotgunPellets : 1, GUN_NAMES[p.weapon], inp.viewTick),
    sim.events);
}

/** The spawn point furthest from every living enemy. */
export function farSpawn(sim: Sim, exclude?: Ent): Spawn {
  let best = sim.arena.spawns[0], bestD = -1;
  for (const sp of sim.arena.spawns) {
    let d = Infinity;
    for (const c of sim.all) if (c !== exclude && c.alive) d = Math.min(d, Math.hypot(c.x - sp.x, c.z - sp.z));
    d += sim.rng() * 6;
    if (d > bestD) { bestD = d; best = sp; }
  }
  return best;
}
export function leader(sim: Sim): Ent | null { let l: Ent | null = null; for (const c of sim.all) if (!l || c.kills > l.kills) l = c; return l; }

// ---- Damage and kills ------------------------------------------------------------------
export function hurt(sim: Sim, v: Ent, amount: number, by: Ent, head: boolean): void {
  if (!v.alive || sim.phase !== 'fight') return;
  v.hp -= amount;
  if (!v.human) v.alert = by; else v.sinceHurt = 0;
  sim.events.push({ k: 'hurt', v: v.id, by: by.id, amt: amount, head });
  if (v.hp > 0) return;
  v.alive = false; v.deaths++; v.deathT = 0; v.killedBy = by.name;
  v.respawn = v.human ? sim.cfg.respawnTime : sim.cfg.botRespawn;
  by.kills++;
  sim.events.push({ k: 'kill', v: v.id, by: by.id, gun: by.human ? GUN_NAMES[by.weapon] : KIND_NAMES[by.kind] });
  if (R.reachedTarget(by.kills, killTarget(sim))) endMatch(sim);
}
function endMatch(sim: Sim): void {
  sim.ranked = [...sim.all].sort((a, b) => b.kills - a.kills);
  sim.phase = 'over';
  sim.events.push({ k: 'end', ranked: sim.ranked.map(e => e.id) });
}

// ---- Pickups -------------------------------------------------------------------------
function stepPickups(sim: Sim, dt: number): void {
  const c = sim.cfg;
  for (const pk of sim.pickups) {
    if (pk.cd > 0) { pk.cd -= dt; continue; }
    for (const e of sim.all) {
      if (!e.alive || Math.hypot(e.x - pk.x, e.z - pk.z) > 1.2 || Math.abs(e.y - pk.y) > 1.5) continue;
      const maxHp = e.human ? c.maxHealth : c[e.kind + 'Hp'];
      if (pk.kind === 'health') {
        if (e.hp >= maxHp) continue;
        e.hp = Math.min(maxHp, e.hp + c.healthAmount);
      } else {
        if (!e.human || GUNS.every((k, i) => e.guns[i].reserve >= c[k + 'Reserve'])) continue; // full: leave the crate
        GUNS.forEach((k, i) => { const max = c[k + 'Reserve']; e.guns[i].reserve = Math.min(max, e.guns[i].reserve + Math.ceil(max * c.ammoFraction)); });
      }
      pk.cd = c.pickupRespawn;
      sim.events.push({ k: 'pickup', id: e.id });
      break;
    }
  }
}

// ---- The match step --------------------------------------------------------------------
/** Advances the match one fixed step with each human's input (missing input: none). */
export function stepSim(sim: Sim, dt: number, inputs: Map<number, Input>): void {
  sim.tick++;
  if (sim.phase === 'countdown') {
    sim.countdown -= dt;
    if (sim.countdown <= 0) { sim.phase = 'fight'; sim.events.push({ k: 'go' }); }
    else if (Math.ceil(sim.countdown) !== Math.ceil(sim.countdown + dt)) sim.events.push({ k: 'tick' });
  } else if (sim.phase === 'fight') {
    sim.timeLeft -= dt;
    if (sim.timeLeft <= 0) { sim.timeLeft = 0; endMatch(sim); return; }
  } else return;
  const fight = sim.phase === 'fight';
  for (const e of sim.all) if (e.human) stepHuman(sim, e, inputs.get(e.id) ?? { ...NO_INPUT, yaw: e.yaw, pitch: e.pitch }, dt, fight);
  if (fight) { for (const e of sim.all) if (!e.human) updateBot(sim, e, dt); stepPickups(sim, dt); }
  else for (const e of sim.all) if (!e.human) { e.px = e.x; e.py = e.y; e.pz = e.z; }
  for (const e of sim.all) {
    e.hist.push({ tick: sim.tick, x: e.x, y: e.y, z: e.z, slide: e.slide });
    if (e.hist.length > HISTORY) e.hist.shift();
  }
}
