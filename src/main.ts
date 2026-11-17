// Slagpit: the scenes, the loop, the world (three.js), the player, the bots and the HUD.
// Pure rules live in src/game/rules.ts, the art in src/art.ts, the sound in src/audio.ts.
// Design: design/game-brief.md.
import * as THREE from 'three';
import { CONFIG, tune } from './config';
import { params, clock, install } from './hook';
import { ART } from './art';
import { startAudio, setMuted, isMuted, sfx } from './audio';
import * as R from './game/rules';
import type { Loose } from './game/types';
import { type Ent, type Ev, type Input, type Sim, GUNS, GUN_NAMES, KIND_NAMES, SHAPES, addHuman, buildWorld, createSim, makeRng, resetMatch, stepSim } from './game/sim';
import { NetClient } from './net/client';

// ==== The world: three.js, the effects, and the match as this viewer sees it ====
/** The three.js world and its pools; built once by initWorld. */
const W3: Loose = {};

function initWorld(viewCanvas: HTMLCanvasElement): void {
  const T = THREE;
  W3.renderer = new T.WebGLRenderer({ canvas: viewCanvas, antialias: false });
  W3.renderer.autoClear = false;
  W3.renderer.toneMapping = THREE.LinearToneMapping; // exposure = tune.brightness
  W3.scene = new T.Scene();
  W3.camera = new T.PerspectiveCamera(tune.fov, 16 / 9, 0.05, 200);
  W3.camera.rotation.order = 'YXZ';
  W3.tx = ART.textures();
  W3.world = buildWorld();
  W3.arena = ART.arena(W3.scene, W3.tx, W3.world.arena);
  W3.pickupMeshes = W3.world.arena.pickups.map((p: Loose) => { const m = ART.pickup(p.kind); W3.scene.add(m); return m; });
  W3.models = new Map<number, THREE.Group>();
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
}
const lerp = R.lerp;
let fxRng = makeRng(99); // sparks only: never gameplay
function tracer(a: number[], b: number[]): void {
  const tr = W3.tracers.find((x: Loose) => x.t <= 0) || W3.tracers[0];
  const pos = tr.line.geometry.attributes.position;
  pos.setXYZ(0, a[0], a[1], a[2]); pos.setXYZ(1, b[0], b[1], b[2]); pos.needsUpdate = true;
  tr.t = 0.06; tr.line.visible = true;
}
function sparks(p: number[], color: number, n: number): void {
  for (let i = 0; i < n; i++) {
    const s = W3.sparks.find((x: Loose) => x.t <= 0); if (!s) return;
    s.t = 0.35 + fxRng() * 0.2; s.mesh.visible = true; s.mesh.material.color.setHex(color);
    s.mesh.position.set(p[0], p[1], p[2]);
    s.vx = (fxRng() - 0.5) * 6; s.vy = fxRng() * 5; s.vz = (fxRng() - 0.5) * 6;
  }
}
function updateFx(dt: number): void {
  for (const t of W3.tracers) if (t.t > 0) { t.t -= dt; t.line.material.opacity = Math.max(0, t.t / 0.06); if (t.t <= 0) t.line.visible = false; }
  for (const s of W3.sparks) if (s.t > 0) {
    s.t -= dt; s.vy -= 14 * dt;
    s.mesh.position.x += s.vx * dt; s.mesh.position.y += s.vy * dt; s.mesh.position.z += s.vz * dt;
    if (s.t <= 0) s.mesh.visible = false;
  }
}
const angleTo = (a: Loose, b: Loose): number => Math.atan2(-(b.x - a.x), -(b.z - a.z));

// ---- The match: solo runs the sim here; online, the server runs it (src/net/client.ts) ----
let sim: Sim | null = null;
let net: NetClient | null = null;
let meId = 0, lookYaw = 0, lookPitch = 0, inputSeq = 0, wasAlive = true;
/** The bot skill of the match being played: online rooms play at the server's. */
const matchDiff = (): number => (net ? net.diff : settings.diff);
const killTarget = (): number => tune['matchKills' + matchDiff()]; // the first-to score
function everyone(): Ent[] { return net ? net.all() : sim ? sim.all : []; }

/** A fresh view of a match: the viewer's timers and lists, before the first step. */
function newView(): void {
  Object.assign(state, { feed: [], hurt: [], toldHurt: false, hurtLabel: 0, hitmark: 0, hitHead: false, killmark: 0, killName: '',
    redFlash: 0, won: false, ranked: null, gained: '', phase: 'countdown', countdown: tune.countdown, timeLeft: tune.matchTime, pickups: [] });
  fxRng = makeRng(99);
}
/** Points the view at the current match: me is "the player", everyone else is "the others". */
function refreshView(): void {
  const all = everyone();
  for (const e of all) (e as Loose).isPlayer = e.id === meId;
  const me = all.find(e => e.id === meId);
  state.all = all;
  state.player = me ?? state.player;
  state.bots = all.filter(e => e.id !== meId);
  if (sim) { state.phase = sim.phase; state.countdown = sim.countdown; state.timeLeft = sim.timeLeft; state.pickups = sim.pickups; }
  else if (net) {
    state.phase = net.phase; state.countdown = net.countdown; state.timeLeft = net.timeLeft;
    state.pickups = W3.world.arena.pickups.map((p: Loose, i: number) => ({ ...p, cd: net!.pickups[i] ? 1 : 0 }));
  }
  state.score = me ? me.kills : 0;
}
function startSolo(): void {
  if (net) { net.close(); net = null; }
  sim = createSim(tune, seed, settings.diff, 6);
  const me = addHuman(sim, 'You', settings.weapon);
  resetMatch(sim); // the bots take the seats around the player, in roster order
  meId = me.id; lookYaw = me.yaw; lookPitch = 0; wasAlive = true;
  newView(); refreshView();
}
function startOnline(room: string): void {
  if (net) net.close();
  sim = null;
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  net = new NetClient(url, room, playerName(), settings.weapon, tune);
  meId = 0; wasAlive = true;
  newView(); refreshView();
}
function playerName(): string {
  try { const n = localStorage.getItem('slagpit.name'); if (n) return n; } catch { /* storage blocked */ }
  const n = 'Player ' + (100 + Math.floor(Math.random() * 900)); // a label, not gameplay
  try { localStorage.setItem('slagpit.name', n); } catch { /* storage blocked */ }
  return n;
}

/** This step's controls from the keys and the mouse; the look is the page's, sent as absolute angles. */
function readInput(me: Ent | undefined): Input {
  const zoomK = me?.zoom ? tune.zoomFov / tune.fov : 1;
  lookYaw -= mouse.dx * tune.sensitivity * zoomK; lookPitch -= mouse.dy * tune.sensitivity * zoomK;
  mouse.dx = mouse.dy = 0;
  if (down.has('ArrowLeft')) lookYaw += tune.keyTurn * STEP * zoomK;
  if (down.has('ArrowRight')) lookYaw -= tune.keyTurn * STEP * zoomK;
  if (down.has('ArrowUp')) lookPitch += tune.keyTurn * 0.6 * STEP * zoomK;
  if (down.has('ArrowDown')) lookPitch -= tune.keyTurn * 0.6 * STEP * zoomK;
  lookPitch = Math.max(-1.5, Math.min(1.5, lookPitch));
  let weapon = -1;
  for (let i = 0; i < 3; i++) if (pressed('Digit' + (i + 1))) weapon = i;
  return {
    seq: ++inputSeq, f: (down.has('KeyW') ? 1 : 0) - (down.has('KeyS') ? 1 : 0), s: (down.has('KeyD') ? 1 : 0) - (down.has('KeyA') ? 1 : 0),
    jump: down.has('Space'), slide: pressed('ShiftLeft') || pressed('ShiftRight') || pressed('KeyC'),
    fire: down.has('Mouse0'), firePressed: pressed('Mouse0'), reload: pressed('KeyR'), weapon, next: pressed('KeyQ'), zoom: down.has('Mouse2'),
    yaw: lookYaw, pitch: lookPitch,
  };
}

/** One step of the match for this viewer. idle: the player's hands are off (paused online). */
function stepMatch(dt: number, idle = false): void {
  const me = everyone().find(e => e.id === meId);
  const inp = idle ? { ...readInput(me), f: 0, s: 0, jump: false, slide: false, fire: false, firePressed: false, reload: false, weapon: -1, next: false, zoom: false } : readInput(me);
  let evs: Ev[] = [];
  if (sim) { sim.events = []; stepSim(sim, dt, new Map([[meId, inp]])); evs = sim.events; }
  else if (net) {
    evs = net.step(inp);
    if (net.meId && !meId) { meId = net.meId; }
    if (net.respawned && net.me) { lookYaw = net.me.yaw; lookPitch = 0; net.respawned = false; }
    if (net.phase === 'countdown' && scene === 'results') { newView(); scene = 'play'; }
  }
  refreshView();
  const p = state.player;
  if (p && sim) { // solo: a respawn faces the player the way the spawn faces
    if (p.alive && !wasAlive) { lookYaw = p.yaw; lookPitch = 0; }
    wasAlive = p.alive;
  }
  showEvents(evs);
  tickView(dt);
}

/** Sound, effects and HUD marks for what happened this step, as this viewer should see it. */
function showEvents(evs: Ev[]): void {
  const all = everyone(), byId = (id: number): Loose => all.find(e => e.id === id);
  const p = state.player, heard = new Set<number>();
  for (const ev of evs) {
    switch (ev.k) {
      case 'shot': {
        const who = byId(ev.id);
        tracer(ev.from, ev.to); sparks(ev.to, ev.hit ? 0xff7a1a : 0x8a8070, ev.hit ? 5 : 3);
        if (heard.has(ev.id) || !who) break; // a shotgun's pellets: one sound
        heard.add(ev.id);
        if (ev.id === meId) sfx(GUNS[GUN_NAMES.indexOf(ev.gun)] ?? 'rifle');
        else {
          if (who.human) who.flash = 0.06;
          const far = p ? Math.hypot(p.x - who.x, p.z - who.z) : 0;
          sfx(who.kind === 'lancer' ? 'botRail' : 'botGun', Math.max(0.08, 1 - far / 45));
        }
        break;
      }
      case 'hurt': {
        const v = byId(ev.v), by = byId(ev.by);
        if (ev.v === meId && v && by) {
          if (!state.toldHurt) { state.toldHurt = true; state.hurtLabel = 2; }
          state.hurt.push({ ang: angleTo(v, by) - v.yaw, t: 1 }); state.redFlash = 0.25; sfx('hurt');
        }
        if (ev.by === meId && v) { v.barT = tune.hpBarTime; state.hitmark = 0.18; state.hitHead = ev.head; sfx(ev.head ? 'head' : 'hit'); }
        break;
      }
      case 'kill': {
        const v = byId(ev.v), by = byId(ev.by);
        if (!v || !by) break;
        const mine = ev.by === meId || ev.v === meId;
        state.feed.unshift({ text: `${ev.by === meId ? 'You' : by.name}  [${ev.gun}]  ${ev.v === meId ? 'You' : v.name}`, mine, t: 4 });
        if (state.feed.length > 5) state.feed.pop();
        events.push({ type: 'kill', by: by.name, victim: v.name });
        if (ev.by === meId) { state.killmark = 1.8; state.killName = v.name; sfx('kill'); }
        if (ev.v === meId) sfx('death');
        break;
      }
      case 'end': {
        const ranked = ev.ranked.map(id => byId(id)).filter(Boolean);
        const res = R.outcome(ranked.map((e: Loose) => ({ isPlayer: e.id === meId, kills: e.kills })), p ? p.kills : 0);
        state.won = res.won; state.ranked = ranked; state.gained = res.gained;
        scene = 'results';
        sfx(state.won ? 'win' : 'lose');
        if (document.pointerLockElement) document.exitPointerLock();
        events.push({ type: 'end', won: state.won });
        break;
      }
      case 'go': case 'tick': sfx(ev.k); break;
      default: if ('id' in ev && ev.id === meId) sfx(ev.k);
    }
  }
}
function tickView(dt: number): void {
  state.hitmark -= dt; state.hurtLabel -= dt; state.killmark -= dt; state.redFlash -= dt;
  state.hurt.forEach((h: Loose) => h.t -= dt); state.hurt = state.hurt.filter((h: Loose) => h.t > 0);
  state.feed.forEach((f: Loose) => f.t -= dt); state.feed = state.feed.filter((f: Loose) => f.t > 0);
  for (const b of state.bots ?? []) b.barT = (b.barT || 0) - dt;
  updateFx(dt);
}

// ---- Drawing the world to match the simulation ------------------------------------------
function syncWorld(alpha: number, now: number): void {
  const p = state.player, cam = W3.camera;
  cam.position.set(lerp(p.px, p.x, alpha), lerp(p.py, p.y, alpha) + (p.alive ? p.eye : 0.4), lerp(p.pz, p.z, alpha));
  cam.rotation.set(p.pitch + p.recoil, p.yaw, p.alive ? 0 : 0.5);
  const fov = p.zoom ? tune.zoomFov : tune.fov;
  if (cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
  const seen = new Set<number>();
  state.bots.forEach((b: Loose) => {
    seen.add(b.id);
    let m = W3.models.get(b.id);
    if (!m || m.userData.kind !== (b.human ? 'runner' : b.kind)) {
      if (m) W3.scene.remove(m);
      m = ART.bot(b.human ? 'runner' : b.kind, W3.tx); W3.scene.add(m); W3.models.set(b.id, m);
    }
    const u = m.userData;
    m.position.set(lerp(b.px, b.x, alpha), lerp(b.py, b.y, alpha), lerp(b.pz, b.z, alpha));
    m.rotation.set(0, b.yaw, 0);
    m.visible = b.alive || b.deathT < 1.2;
    u.body.rotation.x = b.alive ? 0 : -Math.min(1, b.deathT * 4) * Math.PI / 2;
    const sw = Math.sin(b.anim) * 0.7;
    u.legs[0].rotation.x = sw; u.legs[1].rotation.x = -sw;
    u.flash.visible = b.flash > 0; u.flash.rotation.z = now * 40;
    if (u.belly) u.belly.material.color.setHSL(0.06, 1, 0.4 + 0.15 * Math.sin(now * 6));
  });
  for (const [id, m] of W3.models) if (!seen.has(id)) { W3.scene.remove(m); W3.models.delete(id); }
  state.pickups.forEach((pk: Loose, i: number) => {
    const m = W3.pickupMeshes[i];
    m.visible = pk.cd <= 0; m.position.set(pk.x, pk.y + 0.45 + Math.sin(now * 2 + i) * 0.08, pk.z); m.rotation.y = now * 1.2 + i;
  });
  W3.arena.lavaMats.forEach((mt: Loose, i: number) => { const k = 0.8 + 0.2 * Math.sin(now * 3.1 + i * 1.7) + 0.05 * Math.sin(now * 17 + i); mt.color.setRGB(k, k, k); });
  const br = tune.brightness;
  W3.arena.lights.forEach((l: Loose, i: number) => { l.intensity = (i === 4 ? 6 : 9) * (0.85 + 0.15 * Math.sin(now * 3.1 + i * 1.7)); });
  W3.arena.hemi.intensity = 1.1 * br; W3.renderer.toneMappingExposure = br;
  W3.scene.fog.near = 18 * br; W3.scene.fog.far = 80 * br;
  // the gun in the hand
  W3.guns.forEach((g: Loose, i: number) => { g.visible = p.alive && i === p.weapon && !p.zoom; });
  const g = W3.guns[p.weapon], moving = Math.hypot(p.vx, p.vz) / tune.walkSpeed;
  const reloadDip = p.reload > 0 ? Math.sin(Math.min(1, 1 - p.reload / tune[GUNS[p.weapon] + 'Reload']) * Math.PI) : 0;
  g.position.set(0.24 + Math.cos(p.bob * 1.1) * 0.012 * moving, -0.24 + Math.abs(Math.sin(p.bob * 1.1)) * 0.012 * moving - reloadDip * 0.25 - p.raise * 0.8 - (p.slide > 0 ? 0.04 : 0),
    -0.42 + p.kick * 0.07);
  g.rotation.set(p.kick * 0.12 + reloadDip * 0.7, 0, p.slide > 0 ? 0.25 : reloadDip * 0.4);
  g.userData.flash.visible = p.flash > 0; g.userData.flash.rotation.z = now * 50;
}
function renderWorld(): void {
  const r = W3.renderer;
  r.clear(); r.render(W3.scene, W3.camera);
  r.clearDepth(); r.render(W3.vmScene, W3.vmCamera);
}

// ==== carried from the one-shot's hud.js ====
// Sound effects (Web Audio, synthesized) and the 2D overlay: HUD, title, pause, results.
const TEAL = '#5ac8c0', YELLOW = '#ffd34a', ORANGE = '#ff6a1a', BLOOD = '#c0201a', DIM = '#b8ab98';

// ---- Drawing helpers ------------------------------------------------------------------
function panel(x: number, y: number, w: number, h: number, a = 0.55): void { ctx.fillStyle = `rgba(8,5,4,${a})`; ctx.fillRect(x, y, w, h); ctx.fillStyle = ORANGE; ctx.fillRect(x, y, w, 2); }
function bar(x: number, y: number, w: number, h: number, k: number, c: string): void { ctx.fillStyle = '#1a1210'; ctx.fillRect(x, y, w, h); ctx.fillStyle = c; ctx.fillRect(x, y, w * Math.max(0, k), h); }
function fmtTime(s: number): string { s = Math.ceil(s); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
// a drawn heart-cross for health and a drawn bullet for ammo: no font symbols
function iconCross(x: number, y: number, c: string): void { ctx.fillStyle = c; ctx.fillRect(x - 9, y - 3, 18, 6); ctx.fillRect(x - 3, y - 9, 6, 18); }
function iconBullet(x: number, y: number): void { ctx.fillStyle = '#d8a840'; ctx.fillRect(x - 3, y - 6, 6, 12); ctx.fillStyle = '#9a5a20'; ctx.fillRect(x - 3, y - 10, 6, 4); }

// ---- The HUD --------------------------------------------------------------------------
function drawHud(): void {
  const p = state.player, k = GUNS[p.weapon], g = p.guns[p.weapon], cx = W / 2, cy = H / 2;
  if (p.zoom) { // scope
    ctx.fillStyle = '#000'; ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.arc(cx, cy, 300, 0, Math.PI * 2, true); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.9)'; ctx.fillRect(cx - 300, cy, 600, 1); ctx.fillRect(cx, cy - 300, 1, 600);
    ctx.fillStyle = ORANGE; ctx.fillRect(cx - 2, cy - 2, 4, 4);
  } else if (p.alive) { // crosshair, opening with spread and speed
    const sp = k === 'sniper' ? 0.04 : tune[k + 'Spread'];
    const gap = 6 + sp * 260 + Math.hypot(p.vx, p.vz) * 0.4 + p.kick * 6;
    ctx.fillStyle = '#e8e0d0';
    ctx.fillRect(cx - gap - 9, cy - 1, 9, 2); ctx.fillRect(cx + gap, cy - 1, 9, 2);
    ctx.fillRect(cx - 1, cy - gap - 9, 2, 9); ctx.fillRect(cx - 1, cy + gap, 2, 9);
  }
  // health bars over bots you hit lately
  const v3 = new THREE.Vector3();
  state.bots.forEach((b: Loose) => {
    if (!b.alive || !(b.barT > 0)) return;
    const s = SHAPES[b.human ? 'player' : b.kind];
    v3.set(b.x, b.y + s.h + s.hh + 0.35, b.z).project(W3.camera);
    if (v3.z > 1 || Math.abs(v3.x) > 1.1 || Math.abs(v3.y) > 1.1) return;
    const x = (v3.x + 1) / 2 * W, y = (1 - v3.y) / 2 * H, k = b.hp / tune[b.kind + 'Hp'];
    ctx.globalAlpha = Math.min(1, b.barT);
    ctx.fillStyle = '#000'; ctx.fillRect(x - 32, y - 5, 64, 10);
    bar(x - 30, y - 3, 60, 6, k, k < 0.35 ? BLOOD : ORANGE);
    ctx.globalAlpha = 1;
  });
  if (state.hitmark > 0) { // hit marker: an X on the crosshair
    ctx.strokeStyle = state.hitHead ? BLOOD : YELLOW; ctx.lineWidth = 3; ctx.globalAlpha = Math.min(1, state.hitmark / 0.1);
    ctx.beginPath();
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([a, b]) => { ctx.moveTo(cx + a * 7, cy + b * 7); ctx.lineTo(cx + a * 15, cy + b * 15); });
    ctx.stroke(); ctx.globalAlpha = 1;
  }
  if (state.killmark > 0) { // your kill: a gold flash at the edges and a banner under the crosshair
    const t = state.killmark, pop = 1 + Math.max(0, t - 1.3) * 1.5;
    const gr = ctx.createRadialGradient(cx, cy, 260, cx, cy, 760);
    gr.addColorStop(0, 'rgba(255,200,60,0)'); gr.addColorStop(1, `rgba(255,190,40,${Math.min(0.35, Math.max(0, t - 1.0))})`);
    ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = Math.min(1, t * 2);
    panel(cx - 230, cy + 92, 460, 92, 0.8);
    text(`KILLED  ${state.killName}`, cx, cy + 124, Math.round(32 * pop), YELLOW);
    text(`+1   ·   ${p.kills} / ${killTarget()}`, cx, cy + 162, 22, '#f0e8da');
    ctx.globalAlpha = 1;
  }
  // hurt direction: a bright red arrow pointing toward the shooter, over a faint arc
  state.hurt.forEach((hm: Loose) => {
    const a = -Math.PI / 2 - hm.ang, ux = Math.cos(a), uy = Math.sin(a), vx = -uy, vy = ux;
    ctx.strokeStyle = `rgba(220,30,20,${hm.t * 0.6})`; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.arc(cx, cy, 200, a - 0.3, a + 0.3); ctx.stroke();
    const tip = 262, base = 214, half = 30, x0 = cx + ux * tip, y0 = cy + uy * tip;
    ctx.fillStyle = `rgba(255,50,30,${hm.t})`; ctx.strokeStyle = `rgba(20,0,0,${hm.t})`; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x0, y0);
    ctx.lineTo(cx + ux * base + vx * half, cy + uy * base + vy * half);
    ctx.lineTo(cx + ux * (base + 14), cy + uy * (base + 14));
    ctx.lineTo(cx + ux * base - vx * half, cy + uy * base - vy * half);
    ctx.closePath(); ctx.fill(); ctx.stroke();
  });
  if (state.hurtLabel > 0 && state.hurt.length) { // the first hit of a match says what the arrow means
    const hm = state.hurt[state.hurt.length - 1], a = -Math.PI / 2 - hm.ang;
    const x = cx + Math.cos(a) * 320, y = cy + Math.sin(a) * 300;
    ctx.globalAlpha = Math.min(1, state.hurtLabel);
    panel(x - 105, y - 18, 210, 36, 0.8); text('SHOT FROM HERE', x, y, 20, '#ff5a3a');
    ctx.globalAlpha = 1;
  }
  const low = p.hp < 35;
  if (state.redFlash > 0 || (low && p.alive)) {
    const k2 = Math.max(state.redFlash * 2, low ? 0.25 + 0.1 * Math.sin(state.t * 6) : 0);
    const gr = ctx.createRadialGradient(cx, cy, 200, cx, cy, 760);
    gr.addColorStop(0, 'rgba(160,10,0,0)'); gr.addColorStop(1, `rgba(160,10,0,${Math.min(0.6, k2)})`);
    ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
  }
  // health, bottom left
  const regen = p.alive && p.hp < tune.maxHealth && p.sinceHurt >= tune.regenDelay;
  panel(24, H - 112, 330, 88);
  text('HEALTH', 44, H - 94, 15, DIM, 'left');
  if (regen) text('REGENERATING', 334, H - 94, 15, TEAL, 'right');
  iconCross(54, H - 58, low ? BLOOD : '#e8e0d0');
  text(String(Math.max(0, Math.ceil(p.hp))), 78, H - 60, 44, low ? BLOOD : '#f0e8da', 'left');
  text(`/ ${tune.maxHealth}`, 150, H - 54, 20, DIM, 'left');
  bar(204, H - 66, 132, 16, p.hp / tune.maxHealth, low ? BLOOD : regen ? TEAL : ORANGE);
  ctx.fillStyle = '#000'; for (let i = 1; i < 4; i++) ctx.fillRect(204 + 33 * i, H - 66, 2, 16); // quarter ticks
  // ammo, bottom right
  const lowAmmo = g.mag <= tune[k + 'Mag'] * tune.lowAmmo;
  panel(W - 274, H - 86, 250, 62);
  iconBullet(W - 250, H - 55);
  text(`${g.mag}`, W - 230, H - 58, 36, g.mag === 0 ? BLOOD : lowAmmo ? ORANGE : '#f0e8da', 'left');
  text(`/ ${g.reserve}`, W - 170, H - 54, 22, DIM, 'left');
  text(GUN_NAMES[p.weapon].toUpperCase(), W - 40, H - 66, 16, YELLOW, 'right');
  text('1 2 3', W - 40, H - 44, 14, DIM, 'right');
  if (p.reload > 0) text('RELOADING', cx, cy + 80, 20, YELLOW);
  else if (g.mag === 0 && p.alive) text(g.reserve > 0 ? 'R  RELOAD' : 'NO AMMO: FIND A CRATE', cx, cy + 80, 20, BLOOD);
  else if (lowAmmo && p.alive) text('LOW AMMO', cx, cy + 80, 16, ORANGE);
  // timer and score, top centre
  const lead = [...state.all].sort((a, b) => b.kills - a.kills).find(c => !c.isPlayer);
  panel(cx - 260, 14, 520, 70);
  text(fmtTime(state.timeLeft), cx, 40, 28, '#f0e8da');
  text(`FIRST TO ${killTarget()}`, cx, 68, 14, DIM);
  const bump = 1 + Math.max(0, state.killmark - 1.2) * 1.2; // your score swells when you kill
  text('YOU', cx - 230, 34, 15, YELLOW, 'left');
  text(String(p.kills), cx - 230, 62, Math.round(34 * bump), YELLOW, 'left');
  text(lead.name, cx + 230, 34, 15, DIM, 'right');
  text(String(lead.kills), cx + 230, 62, 34, '#f0e8da', 'right');
  // kill feed, top right
  state.feed.forEach((f: Loose, i: number) => {
    ctx.globalAlpha = Math.min(1, f.t); panel(W - 380, 14 + i * 30, 356, 26, 0.5);
    text(f.text, W - 34, 28 + i * 30, 15, f.mine ? YELLOW : '#e8e0d0', 'right'); ctx.globalAlpha = 1;
  });
  if (state.phase === 'countdown') {
    text(String(Math.ceil(state.countdown)), cx, cy - 90, 96, YELLOW);
    panel(cx - 330, cy + 110, 660, 100);
    text('Run, then SHIFT to slide.  SPACE during a slide to jump and keep the speed.', cx, cy + 134, 17, '#f0e8da');
    text('Hold SPACE to hop on landing.  Bots in this arena are bots, not people.', cx, cy + 162, 15, DIM);
    text('A RED ARROW around the crosshair points to where you are being shot from.', cx, cy + 188, 15, '#ff5a3a');
  }
  if (!p.alive) {
    ctx.fillStyle = 'rgba(70,0,0,0.45)'; ctx.fillRect(0, 0, W, H);
    text(`KILLED BY ${p.killedBy}`, cx, cy - 30, 34, '#f0e8da');
    text(`Respawning ${Math.max(0, p.respawn).toFixed(1)}`, cx, cy + 16, 20, DIM);
  }
  if (down.has('Tab')) drawScores(cx, 130);
  if (!locked() && !CHECKING && scene === 'play') text('Click to aim with the mouse', cx, H - 120, 16, YELLOW);
}
function drawScores(cx: number, y: number): void {
  const rows = [...state.all].sort((a, b) => b.kills - a.kills);
  panel(cx - 260, y, 520, 50 + rows.length * 34, 0.82);
  text('PLAYER', cx - 230, y + 24, 15, DIM, 'left'); text('KILLS', cx + 120, y + 24, 15, DIM, 'right'); text('DEATHS', cx + 230, y + 24, 15, DIM, 'right');
  rows.forEach((c, i) => {
    const yy = y + 60 + i * 34, col = c.isPlayer ? YELLOW : '#e8e0d0';
    text(c.isPlayer ? 'YOU' : c.human ? c.name : `${c.name}  (${KIND_NAMES[c.kind]})`, cx - 230, yy, 18, col, 'left');
    text(String(c.kills), cx + 120, yy, 18, col, 'right'); text(String(c.deaths), cx + 230, yy, 18, col, 'right');
  });
}

// ---- Screens --------------------------------------------------------------------------
const DIFFS = ['Easy', 'Normal', 'Hard'];
function chooser(label: string, opts: string[], cur: number, y: number, active: boolean): void {
  text(label, W / 2 - 300, y, 20, active ? YELLOW : DIM, 'left');
  opts.forEach((o, i) => {
    const x = W / 2 - 40 + i * 140;
    if (i === cur) { ctx.fillStyle = 'rgba(255,106,26,0.25)'; ctx.fillRect(x - 62, y - 18, 124, 36); ctx.fillStyle = ORANGE; ctx.fillRect(x - 62, y + 16, 124, 2); }
    text(o, x, y, 20, i === cur ? '#fff2dc' : DIM);
  });
}
function drawTitle(): void {
  ctx.fillStyle = 'rgba(6,4,3,0.55)'; ctx.fillRect(0, 0, W, H);
  text(TITLE.toUpperCase(), W / 2, 130, 92, ORANGE);
  text(settings.mode === 0 ? `A deathmatch against five bots. First to ${killTarget()} kills (${DIFFS[settings.diff]}).`
    : `Online: up to ${tune.onlineSeats} people, bots fill the empty seats. First to ${tune['matchKills' + tune.onlineDiff]} kills (${DIFFS[tune.onlineDiff]}).`, W / 2, 200, 20, DIM);
  panel(W / 2 - 340, 232, 680, 186, 0.7);
  chooser('BOT SKILL', DIFFS, settings.diff, 272, settings.row === 0);
  chooser('START GUN', GUN_NAMES, settings.weapon, 324, settings.row === 1);
  chooser('MODE', MODES, settings.mode, 376, settings.row === 2);
  if (settings.mode === 2) text(params.get('room') ? `Joins room ${params.get('room')!.toUpperCase()}` : 'Opens a new room: share the address it shows with friends', W / 2, 436, 15, YELLOW);
  CONTROLS.forEach((c, i) => text(c, W / 2, 462 + i * 24, 15, '#d8ccb8'));
  text('Up/Down choose a row · Left/Right change it', W / 2, H - 92, 15, DIM);
  text('ENTER or CLICK to fight', W / 2, H - 56, 26, YELLOW);
}
/** Online, before the match shows or after it is lost: what is happening, and the way out. */
function drawNetStatus(): void {
  clear('#0b0806');
  const n = net!;
  text(n.status === 'connecting' ? 'CONNECTING' : 'OFFLINE', W / 2, H / 2 - 40, 48, ORANGE);
  text(n.status === 'connecting' ? `Reaching the game server at ${location.host || 'this page'}...` : n.why || 'The connection closed.', W / 2, H / 2 + 14, 20, DIM);
  text('P then T: back to the title', W / 2, H / 2 + 70, 18, YELLOW);
}
function drawPause(): void {
  ctx.fillStyle = 'rgba(6,4,3,0.7)'; ctx.fillRect(0, 0, W, H);
  text('PAUSED', W / 2, H / 2 - 110, 56, ORANGE);
  text(`Mouse sensitivity  <  ${(tune.sensitivity * 1000).toFixed(1)}  >`, W / 2, H / 2 - 30, 22, '#f0e8da');
  text('Left/Right change it', W / 2, H / 2 + 2, 15, DIM);
  text(`M: sound ${isMuted() ? 'off' : 'on'}   ·   T: quit to title`, W / 2, H / 2 + 50, 18, DIM);
  text('CLICK or P to resume', W / 2, H / 2 + 110, 24, YELLOW);
}
function drawResults(): void {
  ctx.fillStyle = 'rgba(6,4,3,0.72)'; ctx.fillRect(0, 0, W, H);
  text(state.gained, W / 2, 110, 84, state.won ? YELLOW : BLOOD);
  const top = state.ranked[0];
  text(state.won ? `You took it with ${top.kills} kills.` : `${top.isPlayer ? 'You' : top.name} won with ${top.kills} kills.`, W / 2, 175, 20, DIM);
  drawScores(W / 2, 210);
  text(net ? 'The next match starts in a few seconds   ·   T: title' : 'R or ENTER: rematch   ·   T: title', W / 2, H - 60, 24, YELLOW);
}

// ==== the one-shot's page script ====

// The one-shot's starter: only what the checks read. Keep the fixed step, the clock hook,
// window.game and the play and figures scenes. Everything else is the game's own: replace
// what is marked "the game", and draw every figure in the brief's look, in 2D or with three.js.

// ---- Built to be checked ----------------------------------------------------------------
const STEP = 1 / 60;            // simulation step in seconds; motion is per second, never per frame
const W = 1280, H = 720;        // logical size; a pixel look lowers it and sets PIXEL
const PIXEL = false;            // pixel looks: whole-number scale, no smoothing
const FONT = 'Impact, "Arial Black", sans-serif'; // blocky, loud, retro-shooter type
const TITLE = 'Slagpit';
const CONTROLS = [ // shown on the title screen
  'WASD move  ·  Mouse aim  ·  Left click fire  ·  Right click scope (sniper)',
  'SHIFT slide  ·  SPACE jump  ·  R reload  ·  1 2 3 or Q switch gun  ·  Arrow keys turn',
  'TAB scores  ·  P or ESC pause  ·  M mute',
];
const CHEAP = params.get('render') === 'cheap'; // a headless shot or check: 3D draws cheap; players never see it
const CHECKING = CHEAP || params.get('manual') === '1' || !!navigator.webdriver; // no pointer-lock prompt in a check
let seed = 0;
function rng(): number { // mulberry32; every gameplay random call reads this, never Math.random
  seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const events: unknown[] = []; // window.game.events: anything the game wants a run to see

// ---- Screen ---------------------------------------------------------------------------
const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
function fit(): void { // fills the window at any size and pixel ratio
  const k = Math.min(innerWidth / W, innerHeight / H);
  const s = PIXEL ? Math.max(1, Math.floor(k)) : k;
  const r = PIXEL ? 1 : s * (devicePixelRatio || 1);
  canvas.width = Math.round(W * r); canvas.height = Math.round(H * r);
  canvas.style.width = Math.round(W * s) + 'px'; canvas.style.height = Math.round(H * s) + 'px';
  canvas.style.marginTop = Math.max(0, Math.floor((innerHeight - H * s) / 2)) + 'px';
  canvas.style.imageRendering = PIXEL ? 'pixelated' : 'auto';
  ctx.setTransform(r, 0, 0, r, 0, 0); ctx.imageSmoothingEnabled = !PIXEL;
  if (W3.renderer) { // the 3D view sits under the HUD at the same size, drawn at a low pixel ratio
    W3.renderer.setPixelRatio(CHEAP ? 0.5 : tune.renderScale);
    W3.renderer.setSize(Math.round(W * s), Math.round(H * s), false);
    const v = W3.renderer.domElement;
    v.style.width = canvas.style.width; v.style.height = canvas.style.height; v.style.marginTop = canvas.style.marginTop;
  }
}
addEventListener('resize', fit); fit();
function clear(c: string): void { ctx.fillStyle = c; ctx.fillRect(0, 0, W, H); }
function text(s: string, x: number, y: number, size: number, c: string, align: CanvasTextAlign = 'center'): void {
  ctx.fillStyle = c; ctx.font = `${size}px ${FONT}`; ctx.textAlign = align;
  ctx.textBaseline = 'middle'; ctx.fillText(s, x, y);
}

// ---- Input: keys by position (event.code), OS key repeat ignored ------------------------
const down = new Set(), hit = new Set();
const pressed = (code: string) => hit.has(code); // true for one step after the key goes down
addEventListener('keydown', e => {
  startAudio();
  if (!e.repeat) { down.add(e.code); hit.add(e.code); }
  if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
});
addEventListener('keyup', e => down.delete(e.code));
addEventListener('pointerdown', e => {
  startAudio();
  const code = 'Mouse' + e.button; down.add(code); hit.add(code);
  if (scene === 'title' && e.button === 0) startPlay();
  else if (scene === 'pause' && e.button === 0) { scene = 'play'; hit.delete('Mouse0'); }
  if ((scene === 'play') && !locked() && canvas.requestPointerLock) canvas.requestPointerLock();
});
addEventListener('pointerup', e => down.delete('Mouse' + e.button));
addEventListener('contextmenu', e => e.preventDefault());
addEventListener('keydown', e => { if (e.code === 'Tab') e.preventDefault(); });
const mouse = { dx: 0, dy: 0 };
addEventListener('mousemove', e => { if (locked()) { mouse.dx += e.movementX; mouse.dy += e.movementY; } });
function locked(): boolean { return document.pointerLockElement === canvas; }
let wasLocked = false;
document.addEventListener('pointerlockchange', () => { // leaving the lock (Esc) pauses the match
  if (wasLocked && !locked() && scene === 'play') scene = 'pause';
  wasLocked = locked();
});
addEventListener('blur', () => down.clear());

// ---- Scenes: keep only the day-one screens the brief calls for ----------------------------
// title: always. pause: real-time games. over: hard failure. results: a game with an end.
// figures: every enemy kind and unit side by side, for the outline check (?scene=figures).
// The checks look for play by name.
let scene: string, state: Loose;
const settings = { diff: 1, weapon: 0, row: 0, mode: params.get('room') ? 2 : 0 }; // the title's picks, kept between matches
function reset(): void {
  seed = Number(params.get('seed')) || (CONFIG.seed as number);
  // state.gained: the match's outcome, shown on the results screen.
  state = { t: 0, score: 0, gained: '' };
  startSolo();
}
const MODES = ['Solo', 'Quick match', 'Friend room'];
/** Starts the picked mode: solo here, or online on this page's server. */
function startPlay(): void {
  seed = Number(params.get('seed')) || (CONFIG.seed as number);
  state = { t: 0, score: 0, gained: '' };
  if (settings.mode === 0) startSolo();
  else {
    let room = '';
    if (settings.mode === 2) {
      room = (params.get('room') || Math.random().toString(36).slice(2, 7)).toUpperCase(); // a code to share, not gameplay
      history.replaceState(null, '', `?room=${room}`);
    }
    startOnline(room);
  }
  scene = 'play';
}
let figScene: THREE.Scene | null = null, figCam: THREE.PerspectiveCamera | null = null;
function buildFigures(): void {
  const T = THREE; figScene = new T.Scene(); figScene.background = new T.Color(0x0b0806);
  figScene.add(new T.HemisphereLight(0x5a8a94, 0x2a1408, 1.4));
  const l = new T.PointLight(0xff7a2a, 30, 20, 1); l.position.set(0, 4, 4); figScene.add(l);
  const fl = new T.Mesh(new T.BoxGeometry(12, 0.2, 5), new T.MeshLambertMaterial({ map: W3.tx.floor })); fl.position.y = -0.1; figScene.add(fl);
  ['rusher', 'lancer', 'brute', 'runner'].forEach((k, i) => { const b = ART.bot(k, W3.tx); b.position.x = (i - 1.5) * 2.8; b.rotation.y = Math.PI + 0.35; figScene!.add(b); });
  figCam = new T.PerspectiveCamera(40, 16 / 9, 0.1, 100); figCam.position.set(0, 1.6, 8.5); figCam.lookAt(0, 1.1, 0);
}
const scenes: Record<string, { update(dt: number): void; draw(): void }> = {
  figures: {
    update(dt) { state.t += dt; },
    draw() {
      if (!figScene) buildFigures();
      W3.renderer.clear(); W3.renderer.render(figScene, figCam);
      ctx.clearRect(0, 0, W, H);
      text('THE BOTS, AND OTHER PEOPLE ONLINE', W / 2, 50, 36, ORANGE);
      [['Scrapper', 'rusher: shotgun'], ['Lancer', 'marksman: rail gun'], ['Furnace', 'brute: rotary gun'], ['Runner', 'a person online']]
        .forEach(([n, d], i) => { text(n, W / 2 + (i - 1.5) * 300, H - 110, 28, '#f0e8da'); text(d, W / 2 + (i - 1.5) * 300, H - 76, 15, DIM); });
    },
  },
  title: {
    update(dt) {
      state.t += dt;
      if (pressed('ArrowUp') || pressed('KeyW')) settings.row = Math.max(0, settings.row - 1);
      if (pressed('ArrowDown') || pressed('KeyS')) settings.row = Math.min(2, settings.row + 1);
      const dx = (pressed('ArrowRight') || pressed('KeyD') ? 1 : 0) - (pressed('ArrowLeft') || pressed('KeyA') ? 1 : 0);
      if (dx) {
        if (settings.row === 0) settings.diff = (settings.diff + dx + 3) % 3;
        else if (settings.row === 1) settings.weapon = (settings.weapon + dx + 3) % 3;
        else settings.mode = (settings.mode + dx + 3) % 3;
        sfx('switch');
      }
      if (pressed('Enter') || pressed('Space')) startPlay();
    },
    draw() {
      const now = clock.now();
      syncWorld(1, now);
      const a = now * 0.08; W3.camera.position.set(Math.sin(a) * 30, 13, Math.cos(a) * 30);
      W3.camera.rotation.set(-0.38, a, 0); W3.guns.forEach((g: Loose) => { g.visible = false; });
      renderWorld(); ctx.clearRect(0, 0, W, H); drawTitle();
    },
  },
  play: {
    update(dt) {
      if (pressed('KeyP') || pressed('Escape')) { scene = 'pause'; if (locked()) document.exitPointerLock(); return; }
      state.t += dt;
      stepMatch(dt);
    },
    draw() {
      if (net && (net.status !== 'playing' || !state.player)) { drawNetStatus(); return; }
      syncWorld(ALPHA, clock.now()); renderWorld(); ctx.clearRect(0, 0, W, H); drawHud();
      if (net && net.room) text(`ROOM ${net.room}`, 24, 104, 15, DIM, 'left');
    },
  },
  pause: {
    update(dt) {
      if (net) stepMatch(dt, true); // online the match goes on while paused
      if (pressed('KeyP') || pressed('Escape')) scene = 'play';
      if (pressed('KeyT')) { if (net) { net.close(); net = null; } scene = 'title'; return; }
      const dx = (pressed('ArrowRight') ? 1 : 0) - (pressed('ArrowLeft') ? 1 : 0), c = CONFIG.sensitivity;
      if (dx) c.value = Math.max(c.min, Math.min(c.max, +(c.value + dx * 0.0002).toFixed(4)));
    },
    draw() { scenes.play.draw(); drawPause(); },
  },
  results: {
    update(dt) {
      if (net) { stepMatch(dt, true); if (pressed('KeyT')) { net.close(); net = null; scene = 'title'; } return; } // the room starts the next match itself
      if (pressed('KeyR') || pressed('Enter')) startPlay();
      else if (pressed('KeyT')) scene = 'title';
    },
    draw() { syncWorld(1, clock.now()); renderWorld(); ctx.clearRect(0, 0, W, H); drawResults(); },
  },
};

// ---- Loop: fixed step, frame time clamped ---------------------------------------------
function step(): void {
  if (pressed('KeyM')) { setMuted(!isMuted()); hit.delete('KeyM'); }
  scenes[scene].update(STEP); hit.clear();
}
let last = 0, acc = 0, ALPHA = 1; // ALPHA: how far the frame is between the last two steps
function tick(): void {
  const now = clock.now();
  acc += Math.min(now - last, 0.25); last = now; // a stall never fast-forwards the game
  while (acc >= STEP) { step(); acc -= STEP; }
  ALPHA = acc / STEP; // draw between steps, so the view never judders
  drawFrame();
}
function drawFrame(): void { scenes[scene].draw(); }
function frame(): void { tick(); requestAnimationFrame(frame); }
// A headless browser on a time budget runs timers but almost no animation frames: a timer
// ticks when no frame has come for 100 ms on a visible page; a hidden tab stays paused.
function timer(): void { if (document.visibilityState === 'visible' && clock.now() - last > 0.1) tick(); }

// ---- What a check can read and drive (?manual=1 stops the loop; players never see it) ----
install({
  get scene() { return scene; },
  get state() { return state; },
  press(code: string) { hit.add(code); },
  hold(code: string, on: boolean) { if (on) down.add(code); else down.delete(code); },
  get events() { return events; }, // the loop steps; a check empties it
  step(n = 1, draw = true, alpha = 1) {
    for (let i = 0; i < n; i++) step();
    if (draw) { ALPHA = alpha; drawFrame(); }
  },
} as Parameters<typeof install>[0]);

initWorld(document.getElementById('view') as HTMLCanvasElement);
fit();
reset();
scene = params.get('scene') || 'title';
last = clock.now();
if (params.get('manual') === '1') drawFrame();
else { requestAnimationFrame(frame); setInterval(timer, 50); }
