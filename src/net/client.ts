// The page's side of an online match: sends this player's inputs, predicts its own movement and
// gun at once (so the controls feel as they do solo), corrects itself from each snapshot by
// replaying the inputs the server has not seen yet, and draws everyone else 100 ms in the past,
// blended between snapshots. The server decides every hit.
import { type Cfg, type Ent, type Ev, type Input, GUN_NAMES, buildWorld, fullGuns, dirFrom, eyeOf, moveHuman, stepGun } from '../game/sim';
import * as R from '../game/rules';
import { type ClientMsg, type EntRow, INTERP_TICKS, type ServerMsg, TICK_HZ } from './protocol';

const STEP = 1 / TICK_HZ;
/** Events the page already showed for its own player when it predicted them. */
const PREDICTED = new Set(['shot', 'jump', 'slide', 'switch', 'reload', 'reloaded', 'empty', 'low']);

/** A combatant as the page draws it, built from the roster and snapshots. */
function viewEnt(id: number, name: string, kind: string, human: boolean, cfg: Cfg): Ent {
  return {
    id, name, kind, human, x: 0, y: 0, z: 0, px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0, r: 0.35, yaw: 0, pitch: 0, grounded: true,
    hp: human ? cfg.maxHealth : cfg[kind + 'Hp'], alive: true, respawn: 0, deathT: 0, kills: 0, deaths: 0, killedBy: '', slide: 0, anim: 0, flash: 0,
    slideCd: 0, eye: cfg.eyeHeight, weapon: 0, guns: fullGuns(cfg), fireCd: 0, reload: 0, raise: 0, kick: 0, recoil: 0, bob: 0, zoom: false,
    lowWarned: false, sinceHurt: 99, seq: 0, target: null, alert: null, react: 0, think: 0, burst: 0, strafe: 1, strafeT: 1, stuck: 0,
    node: -1, prevNode: -1, last: null, lastT: 99, hist: [],
  };
}
const lerpAngle = (a: number, b: number, k: number): number => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

/** One online match as this page sees it. */
export class NetClient {
  status: 'connecting' | 'playing' | 'closed' = 'connecting';
  why = '';
  room = '';
  meId = 0;
  me: Ent | null = null;
  ents = new Map<number, Ent>();
  phase: 'countdown' | 'fight' | 'over' = 'countdown';
  countdown = 0; timeLeft = 0; diff = 1;
  pickups: (0 | 1)[] = [];
  ranked: number[] | null = null;
  /** True for one step after this player came back from a death: the page resets its look. */
  respawned = false;
  private ws: WebSocket;
  private world = buildWorld();
  private snaps: { tick: number; rows: Map<number, EntRow> }[] = [];
  private pending: Input[] = [];
  private outbox: Input[] = [];
  private inbox: Ev[] = [];
  private renderTick = 0;
  private latest = 0;

  constructor(url: string, room: string, name: string, weapon: number, private cfg: Cfg) {
    this.ws = new WebSocket(url);
    this.ws.onopen = () => this.send({ t: 'join', room, name, weapon });
    this.ws.onmessage = e => this.onMessage(JSON.parse(String(e.data)) as ServerMsg);
    this.ws.onclose = () => { if (this.status !== 'closed') { this.status = 'closed'; this.why ||= 'Disconnected from the server.'; } };
    this.ws.onerror = () => { this.why ||= 'Could not reach the game server.'; };
  }
  close(): void { this.status = 'closed'; this.ws.close(); }
  private send(m: ClientMsg): void { if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m)); }

  /** Everyone, this player included. */
  all(): Ent[] { return [...this.ents.values()]; }

  private onMessage(m: ServerMsg): void {
    if (m.t === 'welcome') { this.meId = m.id; this.room = m.room; this.diff = m.diff; this.latest = m.tick; this.renderTick = m.tick - INTERP_TICKS; this.status = 'playing'; }
    else if (m.t === 'full') { this.why = m.why; this.status = 'closed'; }
    else if (m.t === 'roster') {
      const keep = new Set(m.ents.map(e => e.id));
      for (const id of this.ents.keys()) if (!keep.has(id)) this.ents.delete(id);
      for (const r of m.ents) {
        const e = this.ents.get(r.id);
        if (e) e.name = r.name;
        else this.ents.set(r.id, viewEnt(r.id, r.name, r.kind, r.human, this.cfg));
      }
      this.me = this.ents.get(this.meId) ?? null;
    } else if (m.t === 'snap') this.onSnap(m);
  }

  private onSnap(m: Extract<ServerMsg, { t: 'snap' }>): void {
    this.phase = m.phase; this.countdown = m.cd; this.timeLeft = m.tl; this.pickups = m.pk; this.ranked = m.ranked;
    const rows = new Map(m.ents.map(r => [r[0], r]));
    this.snaps.push({ tick: m.tick, rows });
    while (this.snaps.length > 30) this.snaps.shift();
    this.latest = m.tick;
    for (const [id, r] of rows) { const e = this.ents.get(id); if (e) { e.kills = r[10]; e.deaths = r[11]; e.hp = r[6]; } }
    for (const ev of m.ev) {
      if ('id' in ev && ev.id === this.meId && PREDICTED.has(ev.k)) continue;
      this.inbox.push(ev);
    }
    const me = this.me, y = m.you;
    if (!me) return;
    const wasAlive = me.alive;
    Object.assign(me, { x: y.x, y: y.y, z: y.z, vx: y.vx, vy: y.vy, vz: y.vz, grounded: y.grounded, slide: y.slide, slideCd: y.slideCd,
      eye: y.eye, weapon: y.weapon, guns: y.guns.map(g => ({ ...g })), fireCd: y.fireCd, reload: y.reload, raise: y.raise, recoil: y.recoil,
      hp: y.hp, alive: y.alive, respawn: y.respawn, killedBy: y.killedBy, deathT: y.deathT, sinceHurt: y.sinceHurt });
    if (!wasAlive && y.alive) { me.yaw = y.yaw; me.pitch = 0; me.px = me.x; me.py = me.y; me.pz = me.z; this.pending = []; this.respawned = true; return; }
    // replay what the server has not seen yet, quietly
    this.pending = this.pending.filter(i => i.seq > y.seq);
    if (y.alive && this.phase !== 'over') for (const inp of this.pending) {
      moveHuman(this.world.boxes, this.cfg, me, inp, STEP);
      stepGun(this.cfg, me, inp, STEP, this.phase === 'fight', () => {});
    }
  }

  /** One fixed step: send and predict this player's input, move the others; returns what to show. */
  step(inp: Input): Ev[] {
    const out: Ev[] = [];
    const me = this.me;
    if (this.status === 'playing' && me) {
      me.px = me.x; me.py = me.y; me.pz = me.z; me.flash -= STEP;
      inp.viewTick = Math.round(this.renderTick);
      if (me.alive && this.phase !== 'over') {
        this.pending.push(inp); this.outbox.push(inp);
        moveHuman(this.world.boxes, this.cfg, me, inp, STEP, out);
        stepGun(this.cfg, me, inp, STEP, this.phase === 'fight', spread => out.push(this.localShot(me, spread)), out);
      } else { me.deathT += STEP; me.respawn -= STEP; me.yaw = inp.yaw; me.pitch = inp.pitch; }
      if (this.outbox.length) { this.send({ t: 'in', i: this.outbox }); this.outbox = []; }
    }
    if (this.phase === 'countdown') this.countdown -= STEP; else if (this.phase === 'fight') this.timeLeft = Math.max(0, this.timeLeft - STEP);
    this.interpolate();
    out.push(...this.inbox); this.inbox = [];
    return out;
  }

  /** The shot as this page shows it at once: the tracer to the first wall. The server judges hits. */
  private localShot(me: Ent, spread: number): Ev {
    const o = eyeOf(me), a = Math.random() * Math.PI * 2, m = Math.sqrt(Math.random()) * spread; // the look only
    const d = dirFrom(me.yaw + Math.cos(a) * m, me.pitch + me.recoil + Math.sin(a) * m);
    const far = R.rayWorld(this.world.boxes, o, d, 150);
    return { k: 'shot', id: me.id, gun: GUN_NAMES[me.weapon], from: o, to: [o[0] + d[0] * far, o[1] + d[1] * far, o[2] + d[2] * far], hit: false };
  }

  /** Others are drawn INTERP_TICKS behind the newest snapshot, blended between the two around it. */
  private interpolate(): void {
    this.renderTick += 1;
    const target = this.latest - INTERP_TICKS;
    if (Math.abs(this.renderTick - target) > TICK_HZ / 2) this.renderTick = target; // far off: jump
    else this.renderTick += (target - this.renderTick) * 0.05; // a little off: drift back
    let a = this.snaps[0], b = this.snaps[this.snaps.length - 1];
    for (let i = 0; i + 1 < this.snaps.length; i++) if (this.snaps[i].tick <= this.renderTick && this.snaps[i + 1].tick >= this.renderTick) { a = this.snaps[i]; b = this.snaps[i + 1]; break; }
    if (!a || !b) return;
    const k = b.tick === a.tick ? 1 : Math.max(0, Math.min(1, (this.renderTick - a.tick) / (b.tick - a.tick)));
    for (const e of this.ents.values()) {
      if (e.id === this.meId) continue;
      const ra = a.rows.get(e.id), rb = b.rows.get(e.id) ?? ra;
      if (!ra || !rb) continue;
      e.px = e.x; e.py = e.y; e.pz = e.z;
      e.x = ra[1] + (rb[1] - ra[1]) * k; e.y = ra[2] + (rb[2] - ra[2]) * k; e.z = ra[3] + (rb[3] - ra[3]) * k;
      e.yaw = lerpAngle(ra[4], rb[4], k); e.pitch = ra[5] + (rb[5] - ra[5]) * k;
      const wasAlive = e.alive;
      e.alive = rb[7] === 1; e.slide = rb[8]; e.weapon = rb[9]; e.deathT = ra[13] + (rb[13] - ra[13]) * k; e.anim = ra[14] + (rb[14] - ra[14]) * k;
      if (rb[12]) e.flash = 0.06; else e.flash -= STEP;
      if (e.alive !== wasAlive || Math.hypot(e.x - e.px, e.z - e.pz) > 4) { e.px = e.x; e.py = e.y; e.pz = e.z; } // a respawn: no slide across the map
    }
  }
}
