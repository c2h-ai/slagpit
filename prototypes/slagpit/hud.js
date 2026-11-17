// PROTOTYPE - NOT FOR PRODUCTION
// Question: 봇 상대로 빠른 이동+사격 데스매치가 10분 동안 재밌는가?
// Date: 2026-11-17
// Sound effects (Web Audio, synthesized) and the 2D overlay: HUD, title, pause, results.
'use strict';
const YELLOW = '#ffd34a', ORANGE = '#ff6a1a', BLOOD = '#c0201a', DIM = '#b8ab98';

// ---- Sound ----------------------------------------------------------------------------
let noiseBuf = null;
function noise(dur, vol, freq, type = 'lowpass', delay = 0) {
  if (!audio || muted) return;
  const ac = audio.ac;
  if (!noiseBuf) {
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0); let s = 1;
    for (let i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; d[i] = s / 1073741823 - 1; }
  }
  const t = ac.currentTime + delay, src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  src.buffer = noiseBuf; f.type = type; f.frequency.value = freq;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f).connect(g).connect(audio.out); src.start(t); src.stop(t + dur);
}
function tn(freq, dur, type, vol, delay = 0, to = 0) {
  if (!audio || muted) return;
  const ac = audio.ac, t = ac.currentTime + delay, o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t); if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(audio.out); o.start(t); o.stop(t + dur);
}
const SFX = {
  rifle: () => { noise(0.09, 0.5, 2600); tn(160, 0.07, 'square', 0.12, 0, 60); },
  shotgun: () => { noise(0.3, 0.8, 1300); tn(90, 0.2, 'sawtooth', 0.25, 0, 35); },
  sniper: () => { noise(0.45, 0.7, 3800); tn(260, 0.35, 'sawtooth', 0.2, 0, 50); },
  botGun: v => { noise(0.08, 0.35 * v, 1500); },
  botRail: v => { tn(1500, 0.18, 'sine', 0.2 * v, 0, 300); noise(0.12, 0.25 * v, 3000); },
  hit: () => tn(1900, 0.04, 'square', 0.12),
  head: () => { tn(2600, 0.05, 'square', 0.14); tn(3400, 0.05, 'square', 0.1, 0.03); },
  kill: () => { tn(660, 0.08, 'square', 0.18); tn(990, 0.16, 'square', 0.18, 0.07); },
  hurt: () => { tn(120, 0.15, 'sawtooth', 0.25, 0, 60); noise(0.1, 0.3, 500); },
  death: () => { tn(330, 0.15, 'sawtooth', 0.25, 0, 200); tn(200, 0.4, 'sawtooth', 0.25, 0.15, 60); },
  empty: () => tn(1300, 0.025, 'square', 0.1),
  low: () => { tn(720, 0.05, 'triangle', 0.18); tn(720, 0.05, 'triangle', 0.18, 0.09); },
  reload: () => { noise(0.05, 0.3, 4000, 'highpass'); tn(300, 0.05, 'square', 0.08); },
  reloaded: () => { noise(0.04, 0.3, 5000, 'highpass'); tn(520, 0.04, 'square', 0.08); },
  switch: () => tn(420, 0.04, 'triangle', 0.12),
  jump: () => tn(260, 0.06, 'sine', 0.1, 0, 380),
  slide: () => noise(0.35, 0.18, 700, 'bandpass'),
  pickup: () => { tn(880, 0.06, 'square', 0.12); tn(1320, 0.1, 'square', 0.12, 0.06); },
  tick: () => tn(600, 0.08, 'square', 0.15),
  go: () => tn(900, 0.35, 'square', 0.18),
  win: () => [523, 659, 784, 1046].forEach((f, i) => tn(f, 0.25, 'square', 0.15, i * 0.12)),
  lose: () => [392, 330, 262, 196].forEach((f, i) => tn(f, 0.3, 'sawtooth', 0.15, i * 0.15)),
};
function sfx(name, v = 1) { SFX[name](v); }

// ---- Drawing helpers ------------------------------------------------------------------
function panel(x, y, w, h, a = 0.55) { ctx.fillStyle = `rgba(8,5,4,${a})`; ctx.fillRect(x, y, w, h); ctx.fillStyle = ORANGE; ctx.fillRect(x, y, w, 2); }
function bar(x, y, w, h, k, c) { ctx.fillStyle = '#1a1210'; ctx.fillRect(x, y, w, h); ctx.fillStyle = c; ctx.fillRect(x, y, w * Math.max(0, k), h); }
function fmtTime(s) { s = Math.ceil(s); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
// a drawn heart-cross for health and a drawn bullet for ammo: no font symbols
function iconCross(x, y, c) { ctx.fillStyle = c; ctx.fillRect(x - 9, y - 3, 18, 6); ctx.fillRect(x - 3, y - 9, 6, 18); }
function iconBullet(x, y) { ctx.fillStyle = '#d8a840'; ctx.fillRect(x - 3, y - 6, 6, 12); ctx.fillStyle = '#9a5a20'; ctx.fillRect(x - 3, y - 10, 6, 4); }

// ---- The HUD --------------------------------------------------------------------------
function drawHud() {
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
  state.bots.forEach(b => {
    if (!b.alive || !(b.barT > 0)) return;
    const s = SHAPES[b.kind];
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
  if (state.killmark > 0) text('KILL', cx, cy + 46, 22, BLOOD);
  // hurt direction: a red arc at the screen edge of the hit
  state.hurt.forEach(hm => {
    const a = -Math.PI / 2 - hm.ang;
    ctx.strokeStyle = `rgba(220,30,20,${hm.t})`; ctx.lineWidth = 14;
    ctx.beginPath(); ctx.arc(cx, cy, 230, a - 0.35, a + 0.35); ctx.stroke();
  });
  const low = p.hp < 35;
  if (state.redFlash > 0 || (low && p.alive)) {
    const k2 = Math.max(state.redFlash * 2, low ? 0.25 + 0.1 * Math.sin(state.t * 6) : 0);
    const gr = ctx.createRadialGradient(cx, cy, 200, cx, cy, 760);
    gr.addColorStop(0, 'rgba(160,10,0,0)'); gr.addColorStop(1, `rgba(160,10,0,${Math.min(0.6, k2)})`);
    ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
  }
  // health, bottom left
  panel(24, H - 86, 250, 62);
  iconCross(52, H - 55, low ? BLOOD : '#e8e0d0');
  text(String(Math.max(0, Math.ceil(p.hp))), 76, H - 58, 36, low ? BLOOD : '#f0e8da', 'left');
  bar(150, H - 62, 108, 10, p.hp / tune.maxHealth, low ? BLOOD : ORANGE);
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
  panel(cx - 170, 14, 340, 64);
  text(fmtTime(state.timeLeft), cx, 36, 26, '#f0e8da');
  text(`YOU ${p.kills}   ·   ${lead.name} ${lead.kills}   ·   FIRST TO ${tune.matchKills}`, cx, 62, 15, DIM);
  // kill feed, top right
  state.feed.forEach((f, i) => {
    ctx.globalAlpha = Math.min(1, f.t); panel(W - 380, 14 + i * 30, 356, 26, 0.5);
    text(f.text, W - 34, 28 + i * 30, 15, f.mine ? YELLOW : '#e8e0d0', 'right'); ctx.globalAlpha = 1;
  });
  if (state.phase === 'countdown') {
    text(String(Math.ceil(state.countdown)), cx, cy - 90, 96, YELLOW);
    panel(cx - 330, cy + 110, 660, 74);
    text('Run, then SHIFT to slide.  SPACE during a slide to jump and keep the speed.', cx, cy + 134, 17, '#f0e8da');
    text('Hold SPACE to hop on landing.  Bots in this arena are bots, not people.', cx, cy + 162, 15, DIM);
  }
  if (!p.alive) {
    ctx.fillStyle = 'rgba(70,0,0,0.45)'; ctx.fillRect(0, 0, W, H);
    text(`KILLED BY ${p.killedBy}`, cx, cy - 30, 34, '#f0e8da');
    text(`Respawning ${Math.max(0, p.respawn).toFixed(1)}`, cx, cy + 16, 20, DIM);
  }
  if (down.has('Tab')) drawScores(cx, 130);
  if (!locked() && !CHECKING && scene === 'play') text('Click to aim with the mouse', cx, H - 120, 16, YELLOW);
}
function drawScores(cx, y) {
  const rows = [...state.all].sort((a, b) => b.kills - a.kills);
  panel(cx - 260, y, 520, 50 + rows.length * 34, 0.82);
  text('PLAYER', cx - 230, y + 24, 15, DIM, 'left'); text('KILLS', cx + 120, y + 24, 15, DIM, 'right'); text('DEATHS', cx + 230, y + 24, 15, DIM, 'right');
  rows.forEach((c, i) => {
    const yy = y + 60 + i * 34, col = c.isPlayer ? YELLOW : '#e8e0d0';
    text(c.isPlayer ? 'YOU' : `${c.name}  (${KIND_NAMES[c.kind]})`, cx - 230, yy, 18, col, 'left');
    text(String(c.kills), cx + 120, yy, 18, col, 'right'); text(String(c.deaths), cx + 230, yy, 18, col, 'right');
  });
}

// ---- Screens --------------------------------------------------------------------------
const DIFFS = ['Easy', 'Normal', 'Hard'];
function chooser(label, opts, cur, y, active) {
  text(label, W / 2 - 300, y, 20, active ? YELLOW : DIM, 'left');
  opts.forEach((o, i) => {
    const x = W / 2 - 40 + i * 140;
    if (i === cur) { ctx.fillStyle = 'rgba(255,106,26,0.25)'; ctx.fillRect(x - 62, y - 18, 124, 36); ctx.fillStyle = ORANGE; ctx.fillRect(x - 62, y + 16, 124, 2); }
    text(o, x, y, 20, i === cur ? '#fff2dc' : DIM);
  });
}
function drawTitle() {
  ctx.fillStyle = 'rgba(6,4,3,0.55)'; ctx.fillRect(0, 0, W, H);
  text(TITLE.toUpperCase(), W / 2, 130, 92, ORANGE);
  text('A deathmatch against five bots. First to ' + tune.matchKills + ' kills.', W / 2, 200, 20, DIM);
  panel(W / 2 - 340, 240, 680, 140, 0.7);
  chooser('BOT SKILL', DIFFS, settings.diff, 285, settings.row === 0);
  chooser('START GUN', GUN_NAMES, settings.weapon, 340, settings.row === 1);
  CONTROLS.forEach((c, i) => text(c, W / 2, 420 + i * 26, 16, '#d8ccb8'));
  text('Up/Down choose a row · Left/Right change it', W / 2, H - 92, 15, DIM);
  text('ENTER or CLICK to fight', W / 2, H - 56, 26, YELLOW);
}
function drawPause() {
  ctx.fillStyle = 'rgba(6,4,3,0.7)'; ctx.fillRect(0, 0, W, H);
  text('PAUSED', W / 2, H / 2 - 110, 56, ORANGE);
  text(`Mouse sensitivity  <  ${(tune.sensitivity * 1000).toFixed(1)}  >`, W / 2, H / 2 - 30, 22, '#f0e8da');
  text('Left/Right change it', W / 2, H / 2 + 2, 15, DIM);
  text(`M: sound ${muted ? 'off' : 'on'}   ·   T: quit to title`, W / 2, H / 2 + 50, 18, DIM);
  text('CLICK or P to resume', W / 2, H / 2 + 110, 24, YELLOW);
}
function drawResults() {
  ctx.fillStyle = 'rgba(6,4,3,0.72)'; ctx.fillRect(0, 0, W, H);
  text(state.gained, W / 2, 110, 84, state.won ? YELLOW : BLOOD);
  const top = state.ranked[0];
  text(state.won ? `You took it with ${top.kills} kills.` : `${top.isPlayer ? 'You' : top.name} won with ${top.kills} kills.`, W / 2, 175, 20, DIM);
  drawScores(W / 2, 210);
  text('R or ENTER: rematch   ·   T: title', W / 2, H - 60, 24, YELLOW);
}
