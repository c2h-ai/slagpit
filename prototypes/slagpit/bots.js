// PROTOTYPE - NOT FOR PRODUCTION
// Question: 봇 상대로 빠른 이동+사격 데스매치가 10분 동안 재밌는가?
// Date: 2026-11-17
// The bots, damage and kills, pickups, the match clock, and moving the 3D figures to match
// the simulation each frame.
'use strict';
const ROSTER = [['rusher', 'Cinder'], ['lancer', 'Lance'], ['brute', 'Furnace'], ['rusher', 'Scrap'], ['lancer', 'Pike']];
const KIND_NAMES = { rusher: 'Scrapper', lancer: 'Lancer', brute: 'Furnace' };

function combatants() { return state.all; }
function newBot([kind, name], i) {
  if (!W3.botModels[i]) { W3.botModels[i] = ART.bot(kind, W3.tx); W3.scene.add(W3.botModels[i]); }
  const sp = W3.arena.spawns[[1, 5, 7, 9, 11][i]]; // the far side from the player's first spawn
  return {
    kind, name: 'BOT ' + name, model: W3.botModels[i], x: sp.x, y: 0, z: sp.z, px: sp.x, py: 0, pz: sp.z,
    vx: 0, vy: 0, vz: 0, r: SHAPES[kind].w, yaw: sp.yaw, grounded: true, slide: 0,
    hp: tune[kind + 'Hp'], alive: true, respawn: 0, deathT: 0, kills: 0, deaths: 0,
    target: null, alert: null, react: 0, think: rng() * 0.25, fireCd: 0, burst: 0, flash: 0,
    strafe: rng() < 0.5 ? 1 : -1, strafeT: 1, stuck: 0, node: -1, prevNode: -1, last: null, lastT: 99, anim: 0,
  };
}
const diffTune = n => tune[n + settings.diff];

function updateBot(b, dt) {
  b.px = b.x; b.py = b.y; b.pz = b.z; b.flash -= dt;
  if (!b.alive) {
    b.deathT += dt; b.respawn -= dt;
    if (b.respawn <= 0) {
      const sp = farSpawn(b);
      Object.assign(b, { x: sp.x, y: 0, z: sp.z, px: sp.x, py: 0, pz: sp.z, vx: 0, vy: 0, vz: 0, yaw: sp.yaw,
        hp: tune[b.kind + 'Hp'], alive: true, target: null, alert: null, node: -1, lastT: 99 });
    }
    return;
  }
  // pick a target a few times a second: the nearest seen, the player weighted nearer
  b.think -= dt;
  if (b.think <= 0) {
    b.think = 0.25;
    let best = null, bestS = Infinity;
    const lead = leader(), late = state.timeLeft < tune.matchTime * 0.5 || (lead && lead.kills >= tune.matchKills * 0.5);
    for (const c of state.all) {
      if (c === b || !c.alive) continue;
      const dx = c.x - b.x, dz = c.z - b.z, d = Math.hypot(dx, dz);
      if (d > tune.botSight) continue;
      const ahead = Math.cos(angleTo(b, c) - b.yaw) > -0.2; // about 160 degrees of view
      if (!(ahead || d < tune.botHearing || c === b.alert) || !canSee(b, c)) continue;
      let s = d;
      if (c.isPlayer) s *= late && lead === b ? tune.leaderBias : tune.botPlayerBias;
      if (s < bestS) { bestS = s; best = c; }
    }
    if (best !== b.target) { b.target = best; b.react = diffTune('botReact') + rng() * 0.15; }
  }
  const t = b.target && b.target.alive ? b.target : null;
  if (!t) b.target = null;
  let wx = 0, wz = 0, faceYaw = b.yaw;
  b.strafeT -= dt; if (b.strafeT <= 0) { b.strafe = -b.strafe; b.strafeT = 0.8 + rng() * 1.4; }
  if (t) {
    b.last = { x: t.x, z: t.z }; b.lastT = 0;
    const d = Math.hypot(t.x - b.x, t.z - b.z); faceYaw = angleTo(b, t);
    const fx = -Math.sin(faceYaw), fz = -Math.cos(faceYaw), sx = Math.cos(faceYaw), sz = -Math.sin(faceYaw);
    let fwd = 0, side = b.strafe;
    if (b.kind === 'rusher') fwd = d > 4 ? 1 : 0;
    else if (b.kind === 'lancer') fwd = d < 14 ? -1 : d > 30 ? 1 : 0;
    else { fwd = d > 10 ? 0.7 : 0; side *= 0.4; }
    wx = fx * fwd + sx * side; wz = fz * fwd + sz * side;
    shootAt(b, t, d, dt);
  } else {
    b.lastT += dt;
    let goal = null;
    if (b.last && b.lastT < 3) goal = b.last;
    else {
      if (b.node < 0) b.node = nearestNode(b);
      const n = W3.nodes[b.node];
      if (Math.hypot(n.x - b.x, n.z - b.z) < 1.2) {
        const links = n.links.filter(j => j !== b.prevNode);
        b.prevNode = b.node; b.node = links.length ? links[Math.floor(rng() * links.length)] : n.links[0] ?? b.node;
      }
      goal = W3.nodes[b.node];
    }
    const dx = goal.x - b.x, dz = goal.z - b.z, d = Math.hypot(dx, dz);
    if (d > 0.5) { wx = dx / d; wz = dz / d; faceYaw = Math.atan2(-dx, -dz); }
    else if (goal === b.last) b.lastT = 99;
  }
  // turn at a limited rate, then walk
  let dy = faceYaw - b.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  const turn = tune.botTurn * dt; b.yaw += Math.max(-turn, Math.min(turn, dy));
  const wl = Math.hypot(wx, wz), sp = tune[b.kind + 'Speed'];
  if (wl > 0) { wx /= wl; wz /= wl; }
  if (b.grounded) { const k = Math.min(1, 10 * dt); b.vx += (wx * sp - b.vx) * k; b.vz += (wz * sp - b.vz) * k; }
  moveBody(b, dt);
  b.x = Math.max(-31.4, Math.min(31.4, b.x)); b.z = Math.max(-31.4, Math.min(31.4, b.z));
  if (b.hitWall && wl > 0) {
    b.stuck += dt;
    if (b.stuck > 0.4) { b.strafe = -b.strafe; if (b.grounded) b.vy = tune.jumpSpeed * 0.9; b.node = nearestNode(b); b.lastT = 99; b.stuck = 0; }
  } else b.stuck = 0;
  b.anim += Math.hypot(b.vx, b.vz) * dt * 1.6;
}
function shootAt(b, t, d, dt) {
  b.react -= dt; b.fireCd -= dt;
  const aim = angleTo(b, t), off = Math.abs(Math.atan2(Math.sin(aim - b.yaw), Math.cos(aim - b.yaw)));
  if (b.react > 0 || off > 0.25 || b.fireCd > 0) return;
  if (b.kind === 'rusher' && d > tune.rusherRange) return;
  const o = eyeOf(b), tgt = [t.x, t.y + (t.isPlayer && t.slide > 0 ? 0.6 : 1.0), t.z];
  const pitch = Math.atan2(tgt[1] - o[1], Math.hypot(tgt[0] - o[0], tgt[2] - o[2]));
  const moving = Math.hypot(t.vx, t.vz) + (t.grounded ? 0 : 4);
  const err = diffTune('botAim') * (1 + moving / 10), dm = diffTune('botDamage');
  const muzzle = muzzleOf(b);
  if (b.kind === 'rusher') { fire(b, aim, pitch, 0.09 + err, tune.rusherDamage * dm, 6, muzzle); b.fireCd = tune.rusherRate; }
  else if (b.kind === 'lancer') { fire(b, aim, pitch, err, tune.lancerDamage * dm, 1, muzzle); b.fireCd = tune.lancerRate; }
  else {
    fire(b, aim, pitch, err * 1.3, tune.bruteDamage * dm, 1, muzzle);
    b.burst++; b.fireCd = b.burst < 5 ? 0.12 : tune.bruteRate; if (b.burst >= 5) b.burst = 0;
  }
  b.flash = 0.06;
  const p = state.player, far = Math.hypot(p.x - b.x, p.z - b.z);
  sfx(b.kind === 'lancer' ? 'botRail' : 'botGun', Math.max(0.08, 1 - far / 45));
}
function muzzleOf(b) {
  const u = b.model.userData, s = Math.sin(b.yaw), c = Math.cos(b.yaw), lx = u.flash.position.x, lz = u.flashZ;
  return [b.x + lx * c + lz * s, b.y + u.flashY, b.z - lx * s + lz * c];
}
function angleTo(a, b) { return Math.atan2(-(b.x - a.x), -(b.z - a.z)); }
function nearestNode(b) {
  let best = 0, bd = Infinity;
  W3.nodes.forEach((n, i) => { const d = Math.hypot(n.x - b.x, n.z - b.z) + Math.abs(n.y - b.y) * 4; if (d < bd) { bd = d; best = i; } });
  return best;
}
function leader() { let l = null; for (const c of state.all) if (!l || c.kills > l.kills) l = c; return l; }

// ---- Damage and kills -----------------------------------------------------------------
function hurt(v, amount, by, head) {
  if (!v.alive || state.phase !== 'fight') return;
  v.hp -= amount;
  if (!v.isPlayer) v.alert = by;
  if (v.isPlayer) { state.hurt.push({ ang: angleTo(v, by) - v.yaw, t: 1 }); state.redFlash = 0.25; sfx('hurt'); }
  if (by.isPlayer) { state.hitmark = 0.18; state.hitHead = head; sfx(head ? 'head' : 'hit'); }
  if (v.hp > 0) return;
  v.alive = false; v.deaths++; v.deathT = 0;
  v.respawn = v.isPlayer ? tune.respawnTime : tune.botRespawn;
  by.kills++;
  const gun = by.isPlayer ? GUN_NAMES[by.weapon] : KIND_NAMES[by.kind];
  state.feed.unshift({ text: `${by.name}  [${gun}]  ${v.name}`, mine: by.isPlayer || v.isPlayer, t: 4 });
  if (state.feed.length > 5) state.feed.pop();
  events.push({ type: 'kill', by: by.name, victim: v.name });
  if (by.isPlayer) { state.killmark = 0.6; state.score = by.kills; sfx('kill'); }
  if (v.isPlayer) { v.killedBy = by.name; sfx('death'); }
  if (by.kills >= tune.matchKills) endMatch();
}
function endMatch() {
  const ranked = [...state.all].sort((a, b) => b.kills - a.kills);
  state.won = ranked[0].isPlayer && (ranked.length < 2 || ranked[0].kills > ranked[1].kills);
  state.ranked = ranked;
  state.gained = state.won ? 'VICTORY' : ranked[0].kills === state.player.kills ? 'DRAW' : 'DEFEAT';
  state.phase = 'over'; scene = 'results';
  sfx(state.won ? 'win' : 'lose');
  if (document.pointerLockElement) document.exitPointerLock();
  events.push({ type: 'end', won: state.won });
}

// ---- Pickups --------------------------------------------------------------------------
function updatePickups(dt) {
  state.pickups.forEach(pk => {
    if (pk.cd > 0) { pk.cd -= dt; return; }
    for (const c of state.all) {
      if (!c.alive || Math.hypot(c.x - pk.x, c.z - pk.z) > 1.2 || Math.abs(c.y - pk.y) > 1.5) continue;
      if (pk.kind === 'health') {
        if (c.hp >= (c.isPlayer ? tune.maxHealth : tune[c.kind + 'Hp'])) continue;
        c.hp = Math.min(c.isPlayer ? tune.maxHealth : tune[c.kind + 'Hp'], c.hp + tune.healthAmount);
      } else {
        if (!c.isPlayer || GUNS.every((k, i) => c.guns[i].reserve >= tune[k + 'Reserve'])) continue; // full: leave the crate
        GUNS.forEach((k, i) => { const max = tune[k + 'Reserve']; c.guns[i].reserve = Math.min(max, c.guns[i].reserve + Math.ceil(max * tune.ammoFraction)); });
      }
      pk.cd = tune.pickupRespawn;
      if (c.isPlayer) sfx('pickup');
      break;
    }
  });
}

// ---- The match ------------------------------------------------------------------------
function newMatch() {
  state.all = [];
  state.player = newPlayer(W3.arena.spawns[0]);
  state.bots = ROSTER.map(newBot);
  state.all = [state.player, ...state.bots];
  Object.assign(state, {
    phase: 'countdown', countdown: tune.countdown, timeLeft: tune.matchTime, feed: [], hurt: [], hitmark: 0, hitHead: false,
    killmark: 0, redFlash: 0, won: false, ranked: null,
    pickups: W3.arena.pickups.map(p => ({ ...p, cd: 0 })),
  });
}
function updateMatch(dt) {
  if (state.phase === 'countdown') {
    state.countdown -= dt;
    if (state.countdown <= 0) { state.phase = 'fight'; sfx('go'); }
    else if (Math.ceil(state.countdown) !== Math.ceil(state.countdown + dt)) sfx('tick');
  } else if (state.phase === 'fight') {
    state.timeLeft -= dt;
    if (state.timeLeft <= 0) { state.timeLeft = 0; endMatch(); return; }
  }
  const fight = state.phase === 'fight';
  updatePlayer(state.player, dt, fight);
  if (fight) { state.bots.forEach(b => updateBot(b, dt)); updatePickups(dt); }
  else state.bots.forEach(b => { b.px = b.x; b.py = b.y; b.pz = b.z; });
  state.hitmark -= dt; state.killmark -= dt; state.redFlash -= dt;
  state.hurt.forEach(h => h.t -= dt); state.hurt = state.hurt.filter(h => h.t > 0);
  state.feed.forEach(f => f.t -= dt); state.feed = state.feed.filter(f => f.t > 0);
  updateFx(dt);
}

// ---- Drawing the world to match the simulation ------------------------------------------
const lerp = (a, b, k) => a + (b - a) * k;
function syncWorld(alpha, now) {
  const p = state.player, cam = W3.camera;
  cam.position.set(lerp(p.px, p.x, alpha), lerp(p.py, p.y, alpha) + (p.alive ? p.eye : 0.4), lerp(p.pz, p.z, alpha));
  cam.rotation.set(p.pitch + p.recoil, p.yaw, p.alive ? 0 : 0.5);
  const fov = p.zoom ? tune.zoomFov : tune.fov;
  if (cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
  state.bots.forEach(b => {
    const m = b.model, u = m.userData;
    m.position.set(lerp(b.px, b.x, alpha), lerp(b.py, b.y, alpha), lerp(b.pz, b.z, alpha));
    m.rotation.set(0, b.yaw, 0);
    m.visible = b.alive || b.deathT < 1.2;
    u.body.rotation.x = b.alive ? 0 : -Math.min(1, b.deathT * 4) * Math.PI / 2;
    const sw = Math.sin(b.anim) * 0.7;
    u.legs[0].rotation.x = sw; u.legs[1].rotation.x = -sw;
    u.flash.visible = b.flash > 0; u.flash.rotation.z = now * 40;
    if (u.belly) u.belly.material.color.setHSL(0.06, 1, 0.4 + 0.15 * Math.sin(now * 6));
  });
  state.pickups.forEach((pk, i) => {
    const m = W3.pickupMeshes[i];
    m.visible = pk.cd <= 0; m.position.set(pk.x, pk.y + 0.45 + Math.sin(now * 2 + i) * 0.08, pk.z); m.rotation.y = now * 1.2 + i;
  });
  W3.arena.lavaMats.forEach((mt, i) => { const k = 0.8 + 0.2 * Math.sin(now * 3.1 + i * 1.7) + 0.05 * Math.sin(now * 17 + i); mt.color.setRGB(k, k, k); });
  W3.arena.lights.forEach((l, i) => { l.intensity = (i === 4 ? 6 : 9) * (0.85 + 0.15 * Math.sin(now * 3.1 + i * 1.7)); });
  // the gun in the hand
  W3.guns.forEach((g, i) => { g.visible = p.alive && i === p.weapon && !p.zoom; });
  const g = W3.guns[p.weapon], moving = Math.hypot(p.vx, p.vz) / tune.walkSpeed;
  const reloadDip = p.reload > 0 ? Math.sin(Math.min(1, 1 - p.reload / tune[GUNS[p.weapon] + 'Reload']) * Math.PI) : 0;
  g.position.set(0.24 + Math.cos(p.bob * 1.1) * 0.012 * moving, -0.24 + Math.abs(Math.sin(p.bob * 1.1)) * 0.012 * moving - reloadDip * 0.25 - p.raise * 0.8 - (p.slide > 0 ? 0.04 : 0),
    -0.42 + p.kick * 0.07);
  g.rotation.set(p.kick * 0.12 + reloadDip * 0.7, 0, p.slide > 0 ? 0.25 : reloadDip * 0.4);
  g.userData.flash.visible = p.flash > 0; g.userData.flash.rotation.z = now * 50;
}
function renderWorld() {
  const r = W3.renderer;
  r.clear(); r.render(W3.scene, W3.camera);
  r.clearDepth(); r.render(W3.vmScene, W3.vmCamera);
}
