// The bots' minds: pick a target a few times a second, move by kind (the Scrapper charges, the
// Lancer keeps away, the Furnace advances slowly), wander the node graph when no one is seen,
// and shoot after a human-like reaction delay with aim error that grows with the target's speed.
// Design: design/game-brief.md (Challenge; Features: bots).
import * as R from './rules';
import { type Ent, type Sim, angleTo, canSee, diffCfg, eyeOf, farSpawn, fire, killTarget, leader } from './sim';

function nearestNode(sim: Sim, b: Ent): number {
  let best = 0, bd = Infinity;
  sim.nodes.forEach((n, i) => { const d = Math.hypot(n.x - b.x, n.z - b.z) + Math.abs(n.y - b.y) * 4; if (d < bd) { bd = d; best = i; } });
  return best;
}

/** One step of a bot. */
export function updateBot(sim: Sim, b: Ent, dt: number): void {
  const c = sim.cfg;
  b.px = b.x; b.py = b.y; b.pz = b.z; b.flash -= dt;
  if (!b.alive) {
    b.deathT += dt; b.respawn -= dt;
    if (b.respawn <= 0) {
      const sp = farSpawn(sim, b);
      Object.assign(b, { x: sp.x, y: 0, z: sp.z, px: sp.x, py: 0, pz: sp.z, vx: 0, vy: 0, vz: 0, yaw: sp.yaw,
        hp: c[b.kind + 'Hp'], alive: true, target: null, alert: null, node: -1, lastT: 99 });
    }
    return;
  }
  // pick a target a few times a second: the nearest seen, humans weighted nearer
  b.think -= dt;
  if (b.think <= 0) {
    b.think = 0.25;
    let best: Ent | null = null, bestS = Infinity;
    const lead = leader(sim), late = sim.timeLeft < c.matchTime * 0.5 || (!!lead && lead.kills >= killTarget(sim) * 0.5);
    for (const o of sim.all) {
      if (o === b || !o.alive) continue;
      const d = Math.hypot(o.x - b.x, o.z - b.z);
      if (d > c.botSight) continue;
      const ahead = Math.cos(angleTo(b, o) - b.yaw) > -0.2; // about 160 degrees of view
      if (!(ahead || d < c.botHearing || o === b.alert) || !canSee(sim, b, o)) continue;
      let s = d;
      if (o.human) s *= late && lead === b ? c.leaderBias : c.botPlayerBias;
      if (s < bestS) { bestS = s; best = o; }
    }
    if (best !== b.target) { b.target = best; b.react = diffCfg(sim, 'botReact') + sim.rng() * 0.15; }
  }
  const t = b.target && b.target.alive ? b.target : null;
  if (!t) b.target = null;
  let wx = 0, wz = 0, faceYaw = b.yaw;
  b.strafeT -= dt; if (b.strafeT <= 0) { b.strafe = -b.strafe; b.strafeT = 0.8 + sim.rng() * 1.4; }
  if (t) {
    b.last = { x: t.x, z: t.z }; b.lastT = 0;
    const d = Math.hypot(t.x - b.x, t.z - b.z); faceYaw = angleTo(b, t);
    const fx = -Math.sin(faceYaw), fz = -Math.cos(faceYaw), sx = Math.cos(faceYaw), sz = -Math.sin(faceYaw);
    let fwd = 0, side = b.strafe;
    if (b.kind === 'rusher') fwd = d > 4 ? 1 : 0;
    else if (b.kind === 'lancer') fwd = d < 14 ? -1 : d > 30 ? 1 : 0;
    else { fwd = d > 10 ? 0.7 : 0; side *= 0.4; }
    wx = fx * fwd + sx * side; wz = fz * fwd + sz * side;
    shootAt(sim, b, t, d, dt);
  } else {
    b.lastT += dt;
    let goal: { x: number; z: number };
    if (b.last && b.lastT < 3) goal = b.last;
    else {
      if (b.node < 0) b.node = nearestNode(sim, b);
      const n = sim.nodes[b.node];
      if (Math.hypot(n.x - b.x, n.z - b.z) < 1.2) {
        const links = n.links.filter(j => j !== b.prevNode);
        b.prevNode = b.node; b.node = links.length ? links[Math.floor(sim.rng() * links.length)] : n.links[0] ?? b.node;
      }
      goal = sim.nodes[b.node];
    }
    const dx = goal.x - b.x, dz = goal.z - b.z, d = Math.hypot(dx, dz);
    if (d > 0.5) { wx = dx / d; wz = dz / d; faceYaw = Math.atan2(-dx, -dz); }
    else if (goal === b.last) b.lastT = 99;
  }
  // turn at a limited rate, then walk
  let dy = faceYaw - b.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  const turn = c.botTurn * dt; b.yaw += Math.max(-turn, Math.min(turn, dy));
  const wl = Math.hypot(wx, wz), sp = c[b.kind + 'Speed'];
  if (wl > 0) { wx /= wl; wz /= wl; }
  if (b.grounded) { const k = Math.min(1, 10 * dt); b.vx += (wx * sp - b.vx) * k; b.vz += (wz * sp - b.vz) * k; }
  R.moveBody(sim.boxes, b, dt, c.gravity);
  b.x = Math.max(-31.4, Math.min(31.4, b.x)); b.z = Math.max(-31.4, Math.min(31.4, b.z));
  if (b.hitWall && wl > 0) {
    b.stuck += dt;
    if (b.stuck > 0.4) { b.strafe = -b.strafe; if (b.grounded) b.vy = c.jumpSpeed * 0.9; b.node = nearestNode(sim, b); b.lastT = 99; b.stuck = 0; }
  } else b.stuck = 0;
  b.anim += Math.hypot(b.vx, b.vz) * dt * 1.6;
}

function shootAt(sim: Sim, b: Ent, t: Ent, d: number, dt: number): void {
  const c = sim.cfg;
  b.react -= dt; b.fireCd -= dt;
  const aim = angleTo(b, t), off = Math.abs(Math.atan2(Math.sin(aim - b.yaw), Math.cos(aim - b.yaw)));
  if (b.react > 0 || off > 0.25 || b.fireCd > 0) return;
  if (b.kind === 'rusher' && d > c.rusherRange) return;
  const o = eyeOf(b), tgt = [t.x, t.y + (t.human && t.slide > 0 ? 0.6 : 1.0), t.z];
  const pitch = Math.atan2(tgt[1] - o[1], Math.hypot(tgt[0] - o[0], tgt[2] - o[2]));
  const moving = Math.hypot(t.vx, t.vz) + (t.grounded ? 0 : 4);
  const err = diffCfg(sim, 'botAim') * (1 + moving / 10), dm = diffCfg(sim, 'botDamage');
  if (b.kind === 'rusher') { fire(sim, b, aim, pitch, 0.09 + err, c.rusherDamage * dm, 6, 'Scrapper'); b.fireCd = c.rusherRate; }
  else if (b.kind === 'lancer') { fire(sim, b, aim, pitch, err, c.lancerDamage * dm, 1, 'Lancer'); b.fireCd = c.lancerRate; }
  else {
    fire(sim, b, aim, pitch, err * 1.3, c.bruteDamage * dm, 1, 'Furnace');
    b.burst++; b.fireCd = b.burst < 5 ? 0.12 : c.bruteRate; if (b.burst >= 5) b.burst = 0;
  }
  b.flash = 0.06;
}
