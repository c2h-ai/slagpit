// Slagpit's game server: serves the built page (dist/) and runs online matches over a WebSocket
// at /ws. Each room is one match (src/game/sim.ts) of SEATS combatants; bots fill the seats no
// person has, and give theirs up when someone joins. The server is the judge: pages send
// inputs, the server moves everyone, resolves every shot (rewinding the others to what the
// shooter saw), and sends snapshots.
//   PORT (default 2201)  DIST (default ./dist)  HOST (default 0.0.0.0)
//   TLS_CERT_FILE, TLS_KEY_FILE: both set, it serves HTTPS (and wss), read once at start
import http from 'node:http';
import https from 'node:https';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import data from '../data/config.json';
import { type Cfg, type Ent, type Input, NO_INPUT, type Sim, addHuman, createSim, removeEnt, resetMatch, stepSim } from '../src/game/sim';
import { type ClientMsg, type EntRow, type ServerMsg, SNAP_EVERY, TICK_HZ } from '../src/net/protocol';

const PORT = Number(process.env.PORT ?? 2201), HOST = process.env.HOST ?? '0.0.0.0';
const DIST = path.resolve(process.env.DIST ?? 'dist');
const cfg: Cfg = Object.fromEntries(Object.entries(data).filter(([k]) => k !== 'seed').map(([k, v]) => [k, (v as { value: number }).value]));
const DIFF = cfg.onlineDiff; // bot skill and kill target of every online room
const RESTART_AFTER = cfg.onlineRestart; // seconds on the results before the next match
const SEATS = cfg.onlineSeats;
const MAX_QUEUE = 8; // inputs held per person before the oldest are dropped

interface Client { ws: WebSocket; id: number; inputs: Input[]; last: Input }
interface Room { code: string; sim: Sim; clients: Map<number, Client>; overT: number; snapT: number; quick: boolean }
const rooms = new Map<string, Room>();

function send(ws: WebSocket, m: ServerMsg): void { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)); }
function roster(room: Room): void {
  const ents = room.sim.all.map(e => ({ id: e.id, name: e.name, kind: e.kind, human: e.human }));
  for (const c of room.clients.values()) send(c.ws, { t: 'roster', ents });
}
function newRoom(code: string, quick: boolean): Room {
  const sim = createSim(cfg, (Date.now() & 0x7fffffff) || 1, DIFF, SEATS);
  const room: Room = { code, sim, clients: new Map(), overT: 0, snapT: 0, quick };
  rooms.set(code, room);
  console.log(`room ${code} opened`);
  return room;
}
function humans(room: Room): number { return room.clients.size; }
function pickRoom(code: string): Room | null {
  if (code) {
    const c = code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    if (!c) return null;
    const r = rooms.get('F-' + c) ?? newRoom('F-' + c, false);
    return humans(r) < SEATS ? r : null;
  }
  for (const r of rooms.values()) if (r.quick && humans(r) < SEATS) return r;
  let n = 1; while (rooms.has('Q-' + n)) n++;
  return newRoom('Q-' + n, true);
}

function row(e: Ent): EntRow {
  const f = (v: number): number => Math.round(v * 1000) / 1000;
  return [e.id, f(e.x), f(e.y), f(e.z), f(e.yaw), f(e.pitch), Math.ceil(e.hp), e.alive ? 1 : 0, f(e.slide), e.weapon, e.kills, e.deaths,
    e.flash > 0 ? 1 : 0, f(e.deathT), f(e.anim)];
}
function snapshot(room: Room): void {
  const s = room.sim, ents = s.all.map(row), pk = s.pickups.map(p => (p.cd > 0 ? 1 : 0) as 0 | 1);
  const ranked = s.ranked ? s.ranked.map(e => e.id) : null;
  for (const c of room.clients.values()) {
    const e = s.all.find(x => x.id === c.id);
    if (!e) continue;
    send(c.ws, {
      t: 'snap', tick: s.tick, phase: s.phase, cd: s.countdown, tl: s.timeLeft, ents, pk, ev: s.events, ranked,
      you: { seq: e.seq, x: e.x, y: e.y, z: e.z, yaw: e.yaw, vx: e.vx, vy: e.vy, vz: e.vz, grounded: e.grounded, slide: e.slide, slideCd: e.slideCd,
        eye: e.eye, weapon: e.weapon, guns: e.guns, fireCd: e.fireCd, reload: e.reload, raise: e.raise, recoil: e.recoil,
        hp: e.hp, alive: e.alive, respawn: e.respawn, killedBy: e.killedBy, deathT: e.deathT, sinceHurt: e.sinceHurt },
    });
  }
  s.events = [];
}

function tickRoom(room: Room, dt: number): void {
  const s = room.sim, inputs = new Map<number, Input>();
  for (const c of room.clients.values()) {
    while (c.inputs.length > MAX_QUEUE) c.inputs.shift();
    const next = c.inputs.shift();
    // no fresh input this tick: hold the last one, without its one-step presses
    const inp = next ?? { ...c.last, slide: false, firePressed: false, reload: false, next: false, weapon: -1 };
    c.last = inp; inputs.set(c.id, inp);
  }
  const before = s.all.map(e => e.id).join();
  stepSim(s, dt, inputs);
  if (s.phase === 'over') {
    room.overT += dt;
    if (room.overT >= RESTART_AFTER) { room.overT = 0; resetMatch(s); roster(room); }
  }
  if (s.all.map(e => e.id).join() !== before) roster(room);
  if (++room.snapT >= SNAP_EVERY) { room.snapT = 0; snapshot(room); }
}

// ---- The page ------------------------------------------------------------------------
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.woff2': 'font/woff2' };
const tls = process.env.TLS_CERT_FILE && process.env.TLS_KEY_FILE
  ? { cert: readFileSync(process.env.TLS_CERT_FILE), key: readFileSync(process.env.TLS_KEY_FILE) } : null;
const handler: http.RequestListener = async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/favicon.ico') { res.writeHead(204).end(); return; }
  const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const file = path.resolve(DIST, '.' + rel);
  if (!file.startsWith(DIST + path.sep)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': rel === '/index.html' ? 'no-cache' : 'max-age=3600' });
    res.end(body);
  } catch { res.writeHead(404).end('not found'); }
};
const server = tls ? https.createServer(tls, handler) : http.createServer(handler);

// ---- The sockets ----------------------------------------------------------------------
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });
wss.on('connection', ws => {
  let room: Room | null = null, me: Client | null = null;
  ws.on('message', raw => {
    let m: ClientMsg;
    try { m = JSON.parse(String(raw)); } catch { return; }
    if (m.t === 'join' && !room) {
      room = pickRoom(String(m.room ?? ''));
      if (!room) { send(ws, { t: 'full', why: 'That room is full.' }); ws.close(); return; }
      const name = String(m.name ?? 'Player').replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 16) || 'Player';
      const e = addHuman(room.sim, name, Math.max(0, Math.min(2, Number(m.weapon) | 0)));
      me = { ws, id: e.id, inputs: [], last: { ...NO_INPUT, yaw: e.yaw } };
      room.clients.set(e.id, me);
      send(ws, { t: 'welcome', id: e.id, room: room.code.slice(2), tick: room.sim.tick, diff: DIFF });
      roster(room);
      console.log(`${name} joined ${room.code} (${humans(room)} people)`);
    } else if (m.t === 'in' && me && Array.isArray(m.i)) {
      for (const inp of m.i.slice(0, MAX_QUEUE)) if (inp && typeof inp.yaw === 'number') me.inputs.push(inp);
    }
  });
  ws.on('close', () => {
    if (!room || !me) return;
    room.clients.delete(me.id);
    removeEnt(room.sim, me.id);
    roster(room);
    if (room.clients.size === 0) { rooms.delete(room.code); console.log(`room ${room.code} closed`); }
  });
});

// ---- The clock: fixed steps, never fast-forwarding more than a quarter second -------------
const STEP = 1 / TICK_HZ;
let last = performance.now() / 1000, acc = 0;
setInterval(() => {
  const now = performance.now() / 1000;
  acc += Math.min(now - last, 0.25); last = now;
  while (acc >= STEP) { for (const r of rooms.values()) tickRoom(r, STEP); acc -= STEP; }
}, 1000 / TICK_HZ / 2);

server.listen(PORT, HOST, () => console.log(`slagpit server on ${tls ? 'https' : 'http'}://${HOST}:${PORT} serving ${DIST}`));
