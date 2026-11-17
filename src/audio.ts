// Slagpit's sound: one Web Audio graph started on the first input, and every effect
// synthesized from noise and oscillators, no recordings.
import { audioContext } from './hook';
import { tune } from './config';

let audio: { ac: AudioContext; out: GainNode } | null = null, muted = false;

/** Starts (or resumes) the audio graph; call from an input handler. */
export function startAudio(): void {
  if (!audio) {
    const ac = audioContext(); // a check may inject one
    const out = ac.createGain(); out.gain.value = muted ? 0 : tune.volume;
    out.connect(ac.destination); audio = { ac, out };
  }
  if (audio.ac.state === 'suspended') audio.ac.resume();
}
/** Mutes or unmutes everything. */
export function setMuted(m: boolean): void { muted = m; if (audio) audio.out.gain.value = m ? 0 : tune.volume; }
/** True while muted. */
export function isMuted(): boolean { return muted; }
addEventListener('tune', () => setMuted(muted)); // the tweak panel moved a value: the volume follows

let noiseBuf: AudioBuffer | null = null;
function noise(dur: number, vol: number, freq: number, type: BiquadFilterType = 'lowpass', delay = 0): void {
  if (!audio || muted) return;
  const ac = audio!.ac;
  if (!noiseBuf) {
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0); let s = 1;
    for (let i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; d[i] = s / 1073741823 - 1; }
  }
  const t = ac.currentTime + delay, src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  src.buffer = noiseBuf!; f.type = type; f.frequency.value = freq;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f).connect(g).connect(audio!.out); src.start(t); src.stop(t + dur);
}
function tn(freq: number, dur: number, type: OscillatorType, vol: number, delay = 0, to = 0): void {
  if (!audio || muted) return;
  const ac = audio!.ac, t = ac.currentTime + delay, o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t); if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(audio!.out); o.start(t); o.stop(t + dur);
}
const SFX: Record<string, (v: number) => void> = {
  rifle: () => { noise(0.09, 0.5, 2600); tn(160, 0.07, 'square', 0.12, 0, 60); },
  shotgun: () => { noise(0.3, 0.8, 1300); tn(90, 0.2, 'sawtooth', 0.25, 0, 35); },
  sniper: () => { noise(0.45, 0.7, 3800); tn(260, 0.35, 'sawtooth', 0.2, 0, 50); },
  botGun: (v: number) => { noise(0.08, 0.35 * v, 1500); },
  botRail: (v: number) => { tn(1500, 0.18, 'sine', 0.2 * v, 0, 300); noise(0.12, 0.25 * v, 3000); },
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
/** Plays the named effect; v scales its volume for distance. */
export function sfx(name: string, v = 1): void { SFX[name](v); }

