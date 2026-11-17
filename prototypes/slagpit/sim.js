// PROTOTYPE - NOT FOR PRODUCTION
// Question: 봇 상대로 빠른 이동+사격 데스매치가 10분 동안 재밌는가?
// Date: 2026-11-17
// The world: three.js setup, collision against the arena's brushes, hitscan, the player and
// the guns. Loaded before index.html's script; it reads tune, rng, state, settings, down,
// pressed, mouse, sfx and events there at call time.
'use strict';
const GUNS = ['rifle', 'shotgun', 'sniper'];
const GUN_NAMES = ['Rifle', 'Shotgun', 'Sniper'];
const STEP_UP = 0.65;
// hitboxes: half width, body height, head height, head half width
const SHAPES = {
  player: { w: 0.35, h: 1.4, hh: 0.35, hw: 0.2 },
  rusher: { w: 0.42, h: 1.3, hh: 0.35, hw: 0.2 },
  lancer: { w: 0.3, h: 1.72, hh: 0.42, hw: 0.18 },
  brute: { w: 0.62, h: 1.48, hh: 0.3, hw: 0.2 },
};
const W3 = {};

function initWorld(viewCanvas) {
  const T = THREE;
  W3.renderer = new T.WebGLRenderer({ canvas: viewCanvas, antialias: false });
  W3.renderer.autoClear = false;
  W3.scene = new T.Scene();
  W3.camera = new T.PerspectiveCamera(tune.fov, 16 / 9, 0.05, 200);
  W3.camera.rotation.order = 'YXZ';
  W3.tx = ART.textures();
  const a = ART.arena(W3.scene, W3.tx);
  W3.arena = a;
  W3.boxes = a.boxes.map(b => ({ ...b, min: [b.minx, b.miny, b.minz], max: [b.maxx, b.maxy, b.maxz] }));
  W3.pickupMeshes = a.pickups.map(p => { const m = ART.pickup(p.kind); W3.scene.add(m); return m; });
  W3.botModels = {};
  // view model: a second scene drawn over the world so the gun never clips into walls
  W3.vmScene = new T.Scene();
  W3.vmCamera = new T.PerspectiveCamera(60, 16 / 9, 0.01, 10);
  W3.vmScene.add(new T.HemisphereLight(0x6a8a94, 0x2a1408, 1.6));
  const key = new T.DirectionalLight(0xffb070, 1.6); key.position.set(1, 1, 1); W3.vmScene.add(key);
  W3.guns = GUNS.map(k => { const g = ART.gun(k, W3.tx); g.scale.setScalar(0.75); g.visible = false; W3.vmScene.add(g); return g; });
  // fx pools: tracers and sparks
  W3.tracers = []; W3.sparks = [];
  for (let i = 0; i < 24; i++) {
    const geo = new T.BufferGeometry().setFromPoints([new T.Vector3(), new T.Vector3()]);
    const l = new T.Line(geo, new T.LineBasicMaterial({ color: 0xffd34a, transparent: true }));
    l.visible = false; l.frustumCulled = false; W3.scene.add(l); W3.tracers.push({ line: l, t: 0 });
  }
  const sg = new T.BoxGeometry(0.07, 0.07, 0.07);
  for (let i = 0; i < 80; i++) {
    const m = new T.Mesh(sg, new T.MeshBasicMaterial({ color: 0xff8a2a }));
    m.visible = false; W3.scene.add(m); W3.sparks.push({ mesh: m, t: 0, vx: 0, vy: 0, vz: 0 });
  }
  // nodes the bots walk between, linked where a straight walk works
  W3.nodes = a.nodes.map(n => ({ ...n, y: heightAt(n.x, n.z, 0.3, 99), links: [] }));
  W3.nodes.forEach((n, i) => W3.nodes.forEach((m, j) => { if (i !== j && walkable(n, m)) n.links.push(j); }));
}

// ---- Collision ------------------------------------------------------------------------
function overlapXZ(b, x, z, r) { return x + r > b.minx && x - r < b.maxx && z + r > b.minz && z - r < b.maxz; }
function heightAt(x, z, r, below) {
  let hgt = 0;
  for (const b of W3.boxes) if (b.maxy <= below && b.maxy > hgt && overlapXZ(b, x, z, r)) hgt = b.maxy;
  return hgt;
}
function blocked(x, z, r, y) {
  for (const b of W3.boxes) if (b.maxy > y + STEP_UP && overlapXZ(b, x, z, r)) return true;
  return false;
}
function walkable(a, b) { // a straight walk from a to b climbs no more than a step at a time
  const d = Math.hypot(b.x - a.x, b.z - a.z), n = Math.ceil(d / 0.4);
  let y = a.y;
  for (let i = 1; i <= n; i++) {
    const x = a.x + (b.x - a.x) * i / n, z = a.z + (b.z - a.z) * i / n;
    if (blocked(x, z, 0.45, y)) return false;
    y = heightAt(x, z, 0.45, y + STEP_UP);
  }
  return Math.abs(y - b.y) < 0.3;
}
function moveBody(e, dt) {
  e.hitWall = false;
  const nx = e.x + e.vx * dt;
  if (!blocked(nx, e.z, e.r, e.y)) e.x = nx; else { e.vx = 0; e.hitWall = true; }
  const nz = e.z + e.vz * dt;
  if (!blocked(e.x, nz, e.r, e.y)) e.z = nz; else { e.vz = 0; e.hitWall = true; }
  const ground = heightAt(e.x, e.z, e.r, e.y + STEP_UP);
  e.vy -= tune.gravity * dt;
  const ny = e.y + e.vy * dt;
  if (ny <= ground) { e.y = ground; e.vy = 0; e.grounded = true; }
  else if (e.grounded && e.vy <= 0 && ny - ground < 0.25) { e.y = ground; e.vy = 0; }
  else { e.y = ny; e.grounded = false; }
}

// ---- Rays -----------------------------------------------------------------------------
function rayBox(o, d, min, max, far) {
  let t0 = 0, t1 = far;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) { if (o[a] < min[a] || o[a] > max[a]) return Infinity; continue; }
    let ta = (min[a] - o[a]) / d[a], tb = (max[a] - o[a]) / d[a];
    if (ta > tb) { const s = ta; ta = tb; tb = s; }
    if (ta > t0) t0 = ta; if (tb < t1) t1 = tb;
    if (t0 > t1) return Infinity;
  }
  return t0;
}
function rayWorld(o, d, far) {
  let t = far;
  for (const b of W3.boxes) { const k = rayBox(o, d, b.min, b.max, t); if (k < t) t = k; }
  return t;
}
function hitboxes(c) {
  const s = SHAPES[c.isPlayer ? 'player' : c.kind], k = c.slide > 0 ? 0.6 : 1, top = c.y + s.h * k;
  return [
    { min: [c.x - s.w, c.y, c.z - s.w], max: [c.x + s.w, top, c.z + s.w], head: false },
    { min: [c.x - s.hw, top, c.z - s.hw], max: [c.x + s.hw, top + s.hh, c.z + s.hw], head: true },
  ];
}
function eyeOf(c) { return [c.x, c.y + (c.isPlayer ? c.eye : SHAPES[c.kind].h + SHAPES[c.kind].hh * 0.5), c.z]; }
function dirFrom(yaw, pitch) { const cp = Math.cos(pitch); return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp]; }
function canSee(a, b) {
  const o = eyeOf(a), t = [b.x, b.y + 1.1, b.z], d = [t[0] - o[0], t[1] - o[1], t[2] - o[2]], len = Math.hypot(...d);
  return rayWorld(o, d.map(v => v / len), len) >= len;
}

// One shot from `who`: pellets with spread, the nearest hit takes the damage.
function fire(who, yaw, pitch, spread, damage, pellets, muzzle) {
  const o = eyeOf(who);
  for (let p = 0; p < pellets; p++) {
    const a = rng() * Math.PI * 2, m = Math.sqrt(rng()) * spread;
    const d = dirFrom(yaw + Math.cos(a) * m, pitch + Math.sin(a) * m);
    let far = rayWorld(o, d, 150), victim = null, head = false;
    for (const c of combatants()) {
      if (c === who || !c.alive) continue;
      for (const hb of hitboxes(c)) { const t = rayBox(o, d, hb.min, hb.max, far); if (t < far) { far = t; victim = c; head = hb.head; } }
    }
    const hit = [o[0] + d[0] * far, o[1] + d[1] * far, o[2] + d[2] * far];
    tracer(muzzle || o, hit);
    sparks(hit, victim ? 0xff7a1a : 0x8a8070, victim ? 5 : 3);
    if (victim) hurt(victim, damage * (head ? tune.headMult : 1), who, head);
  }
}
function tracer(a, b) {
  const tr = W3.tracers.find(x => x.t <= 0) || W3.tracers[0];
  const pos = tr.line.geometry.attributes.position;
  pos.setXYZ(0, a[0], a[1], a[2]); pos.setXYZ(1, b[0], b[1], b[2]); pos.needsUpdate = true;
  tr.t = 0.06; tr.line.visible = true;
}
function sparks(p, color, n) {
  for (let i = 0; i < n; i++) {
    const s = W3.sparks.find(x => x.t <= 0); if (!s) return;
    s.t = 0.35 + rng() * 0.2; s.mesh.visible = true; s.mesh.material.color.setHex(color);
    s.mesh.position.set(p[0], p[1], p[2]);
    s.vx = (rng() - 0.5) * 6; s.vy = rng() * 5; s.vz = (rng() - 0.5) * 6;
  }
}
function updateFx(dt) {
  for (const t of W3.tracers) if (t.t > 0) { t.t -= dt; t.line.material.opacity = Math.max(0, t.t / 0.06); if (t.t <= 0) t.line.visible = false; }
  for (const s of W3.sparks) if (s.t > 0) {
    s.t -= dt; s.vy -= 14 * dt;
    s.mesh.position.x += s.vx * dt; s.mesh.position.y += s.vy * dt; s.mesh.position.z += s.vz * dt;
    if (s.t <= 0) s.mesh.visible = false;
  }
}

// ---- The player -----------------------------------------------------------------------
function fullGuns() { return GUNS.map(k => ({ mag: tune[k + 'Mag'], reserve: tune[k + 'Reserve'] })); }
function newPlayer(sp) {
  return {
    isPlayer: true, name: 'You', x: sp.x, y: 0, z: sp.z, px: sp.x, py: 0, pz: sp.z, vx: 0, vy: 0, vz: 0, r: 0.35,
    yaw: sp.yaw, pitch: 0, grounded: true, hp: tune.maxHealth, alive: true, respawn: 0, killedBy: '',
    slide: 0, slideCd: 0, eye: tune.eyeHeight, weapon: settings.weapon, guns: fullGuns(),
    fireCd: 0, reload: 0, raise: 0, kick: 0, recoil: 0, bob: 0, flash: 0, zoom: false, lowWarned: false,
    kills: 0, deaths: 0,
  };
}
function gunMag(p) { return p.guns[p.weapon]; }
function updatePlayer(p, dt, canFire) {
  p.px = p.x; p.py = p.y; p.pz = p.z;
  if (!p.alive) { p.respawn -= dt; if (p.respawn <= 0) respawnPlayer(p); return; }
  // look
  const zoomK = p.zoom ? tune.zoomFov / tune.fov : 1;
  p.yaw -= mouse.dx * tune.sensitivity * zoomK; p.pitch -= mouse.dy * tune.sensitivity * zoomK;
  mouse.dx = mouse.dy = 0;
  if (down.has('ArrowLeft')) p.yaw += tune.keyTurn * dt * zoomK;
  if (down.has('ArrowRight')) p.yaw -= tune.keyTurn * dt * zoomK;
  if (down.has('ArrowUp')) p.pitch += tune.keyTurn * 0.6 * dt * zoomK;
  if (down.has('ArrowDown')) p.pitch -= tune.keyTurn * 0.6 * dt * zoomK;
  p.recoil = Math.max(0, p.recoil - dt * 0.6);
  p.pitch = Math.max(-1.5, Math.min(1.5, p.pitch));
  // move
  const f = (down.has('KeyW') ? 1 : 0) - (down.has('KeyS') ? 1 : 0), s = (down.has('KeyD') ? 1 : 0) - (down.has('KeyA') ? 1 : 0);
  let wx = -Math.sin(p.yaw) * f + Math.cos(p.yaw) * s, wz = -Math.cos(p.yaw) * f - Math.sin(p.yaw) * s;
  const wl = Math.hypot(wx, wz); if (wl > 0) { wx /= wl; wz /= wl; }
  const speed = Math.hypot(p.vx, p.vz);
  p.slideCd -= dt;
  if ((pressed('ShiftLeft') || pressed('ShiftRight') || pressed('KeyC')) && p.grounded && speed > tune.slideMinSpeed && p.slideCd <= 0) {
    p.slide = tune.slideTime; p.slideCd = tune.slideTime + tune.slideCooldown;
    p.vx += p.vx / speed * tune.slideBoost; p.vz += p.vz / speed * tune.slideBoost;
    sfx('slide');
  }
  if (p.slide > 0) p.slide -= dt;
  if (p.grounded && down.has('Space')) { // held space hops on landing: speed carries
    p.vy = tune.jumpSpeed; p.grounded = false; p.slide = 0; sfx('jump');
  } else if (p.grounded) {
    const fr = p.slide > 0 ? tune.slideFriction : tune.friction;
    const k = Math.max(0, 1 - fr * dt); p.vx *= k; p.vz *= k;
    if (p.slide <= 0) accel(p, wx, wz, tune.walkSpeed, tune.groundAccel, dt);
  } else accel(p, wx, wz, tune.airSpeed, tune.airAccel, dt);
  moveBody(p, dt);
  p.x = Math.max(-31.6, Math.min(31.6, p.x)); p.z = Math.max(-31.6, Math.min(31.6, p.z));
  const eyeTo = p.slide > 0 ? tune.slideEyeHeight : tune.eyeHeight;
  p.eye += (eyeTo - p.eye) * Math.min(1, dt * 14);
  p.bob += Math.hypot(p.vx, p.vz) * dt * (p.grounded && p.slide <= 0 ? 1.4 : 0);
  updateGun(p, dt, canFire);
}
function accel(e, wx, wz, max, a, dt) {
  const cur = e.vx * wx + e.vz * wz, add = max - cur;
  if (add <= 0 || (wx === 0 && wz === 0)) return;
  const k = Math.min(add, a * dt); e.vx += wx * k; e.vz += wz * k;
}
function updateGun(p, dt, canFire) {
  p.fireCd -= dt; p.kick = Math.max(0, p.kick - dt * 5); p.flash -= dt; p.raise = Math.max(0, p.raise - dt);
  for (let i = 0; i < 3; i++) if (pressed('Digit' + (i + 1)) && p.weapon !== i) switchGun(p, i);
  if (pressed('KeyQ')) switchGun(p, (p.weapon + 1) % 3);
  const k = GUNS[p.weapon], g = gunMag(p), magMax = tune[k + 'Mag'];
  p.zoom = k === 'sniper' && down.has('Mouse2') && p.reload <= 0 && p.raise <= 0;
  if (p.reload > 0) {
    p.reload -= dt;
    if (p.reload <= 0) { const n = Math.min(magMax - g.mag, g.reserve); g.mag += n; g.reserve -= n; p.lowWarned = false; sfx('reloaded'); }
    return;
  }
  if (pressed('KeyR') && g.mag < magMax && g.reserve > 0) { startReload(p); return; }
  if (!canFire || p.raise > 0) return;
  if (down.has('Mouse0') && p.fireCd <= 0) {
    if (g.mag <= 0) {
      if (g.reserve > 0) startReload(p); else if (pressed('Mouse0')) sfx('empty');
      return;
    }
    g.mag--; p.fireCd = tune[k + 'Rate']; p.flash = 0.05;
    const spread = k === 'sniper' ? (p.zoom ? tune.sniperSpread : tune.sniperHipSpread) : tune[k + 'Spread'] * (p.grounded ? 1 : 1.6);
    fire(p, p.yaw, p.pitch + p.recoil, spread, tune[k + 'Damage'], k === 'shotgun' ? tune.shotgunPellets : 1, null);
    p.recoil += tune[k + 'Kick']; p.kick = 1;
    sfx(k);
    if (g.mag <= magMax * tune.lowAmmo && g.mag > 0 && !p.lowWarned) { p.lowWarned = true; sfx('low'); }
    if (g.mag === 0) sfx('empty');
  }
}
function startReload(p) { p.reload = tune[GUNS[p.weapon] + 'Reload']; p.zoom = false; sfx('reload'); }
function switchGun(p, i) { p.weapon = i; p.reload = 0; p.raise = tune.switchTime; p.fireCd = 0; p.lowWarned = false; sfx('switch'); }
function respawnPlayer(p) {
  const sp = farSpawn();
  Object.assign(p, { x: sp.x, y: 0, z: sp.z, px: sp.x, py: 0, pz: sp.z, vx: 0, vy: 0, vz: 0, yaw: sp.yaw, pitch: 0, hp: tune.maxHealth,
    alive: true, slide: 0, reload: 0, raise: tune.switchTime, guns: fullGuns(), recoil: 0 });
}
// the spawn point furthest from every living enemy
function farSpawn(exclude) {
  let best = null, bestD = -1;
  for (const sp of W3.arena.spawns) {
    let d = Infinity;
    for (const c of combatants()) if (c !== exclude && c.alive) d = Math.min(d, Math.hypot(c.x - sp.x, c.z - sp.z));
    d += rng() * 6;
    if (d > bestD) { bestD = d; best = sp; }
  }
  return best;
}
