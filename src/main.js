// The game: the one-shot's script, carried over as it was. The grow step splits it
// by what the code does and moves it to TypeScript.
import './config.js';
import * as THREE from 'three';

// ==== carried from the one-shot's art.js ====
// Slagpit's art, all drawn in code: chunky 32px textures with nearest filtering, the arena's
// brushes, the three bot kinds, the guns and the pickups. Dark rust, cold teal shadow, warm
// lava light, sulphur-yellow accents.
window.ART = (() => {
  const T = THREE;
  let h = 7;
  const r = () => { h = (h * 1103515245 + 12345) & 0x7fffffff; return h / 0x7fffffff; }; // texture noise only

  function tex(size, paint) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    paint(c.getContext('2d'), size);
    const t = new T.CanvasTexture(c);
    t.magFilter = T.NearestFilter; t.minFilter = T.NearestFilter; t.generateMipmaps = false;
    t.wrapS = t.wrapT = T.RepeatWrapping; t.colorSpace = T.SRGBColorSpace;
    return t;
  }
  function px(g, x, y, c, k) {
    const v = 1 + (r() - 0.5) * k;
    g.fillStyle = `rgb(${c[0] * v | 0},${c[1] * v | 0},${c[2] * v | 0})`; g.fillRect(x, y, 1, 1);
  }
  function fill(g, s, c, k) { for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) px(g, x, y, c, k); }

  function textures() {
    return {
      floor: tex(32, (g, s) => { // rusted deck plates with seams and rivets
        fill(g, s, [66, 50, 40], 0.35);
        for (let i = 0; i < 40; i++) px(g, r() * s | 0, r() * s | 0, [120, 60, 25], 0.4);
        g.fillStyle = '#1b1210'; g.fillRect(0, 0, s, 1); g.fillRect(0, 16, s, 1); g.fillRect(0, 0, 1, s); g.fillRect(16, 0, 1, s);
        g.fillStyle = '#8a7a66'; [[3, 3], [13, 3], [3, 13], [13, 13], [19, 19], [29, 19], [19, 29], [29, 29], [19, 3], [29, 13], [3, 19], [13, 29]].forEach(([x, y]) => g.fillRect(x, y, 1, 1));
      }),
      wall: tex(32, (g, s) => { // soot-dark bricks
        fill(g, s, [24, 19, 17], 0.3);
        for (let row = 0; row < 4; row++) for (let col = -1; col < 3; col++) {
          const x0 = col * 16 + (row % 2) * 8, y0 = row * 8, base = [62 + r() * 14, 50 + r() * 8, 44];
          for (let y = y0 + 1; y < y0 + 8; y++) for (let x = x0 + 1; x < x0 + 16; x++) if (x >= 0 && x < s) px(g, x, y, base, 0.25);
        }
      }),
      metal: tex(32, (g, s) => { // tread plate for stairs and platforms
        fill(g, s, [72, 70, 66], 0.2);
        g.fillStyle = '#9a958a';
        for (let y = 2; y < s; y += 6) for (let x = (y / 6 % 2) * 3 + 1; x < s; x += 6) g.fillRect(x, y, 3, 1);
        g.fillStyle = '#2a2622'; g.fillRect(0, s - 1, s, 1);
      }),
      crate: tex(32, (g, s) => { // iron crate with an X brace
        fill(g, s, [52, 56, 50], 0.25);
        g.fillStyle = '#7d7a62';
        for (let i = 2; i < 30; i++) { g.fillRect(i, i, 2, 2); g.fillRect(30 - i, i, 2, 2); }
        g.fillStyle = '#23241f'; g.fillRect(0, 0, s, 2); g.fillRect(0, s - 2, s, 2); g.fillRect(0, 0, 2, s); g.fillRect(s - 2, 0, 2, s);
      }),
      lava: tex(32, (g, s) => { // molten channel
        fill(g, s, [255, 110, 20], 0.3);
        for (let i = 0; i < 12; i++) { g.fillStyle = '#8a1e04'; g.fillRect(r() * s | 0, r() * s | 0, 3 + r() * 5 | 0, 2); }
        for (let i = 0; i < 18; i++) { g.fillStyle = '#ffd34a'; g.fillRect(r() * s | 0, r() * s | 0, 1 + r() * 2 | 0, 1); }
      }),
      body: tex(16, (g, s) => fill(g, s, [200, 200, 200], 0.18)), // grain for bot plating, tinted by colour
      flash: tex(32, (g) => { // muzzle flash star
        g.translate(16, 16);
        for (let i = 0; i < 6; i++) {
          g.rotate(Math.PI / 3); g.fillStyle = i % 2 ? '#ffd34a' : '#fff3b0';
          g.beginPath(); g.moveTo(0, -15 + (i % 2) * 5); g.lineTo(3, 0); g.lineTo(-3, 0); g.fill();
        }
        g.fillStyle = '#ffffff'; g.fillRect(-3, -3, 6, 6);
      }),
    };
  }

  // A box whose UVs repeat one texture tile every `unit` metres, so bricks stay one size.
  function boxGeo(w, hgt, d, unit = 2) {
    const g = new T.BoxGeometry(w, hgt, d), uv = g.attributes.uv;
    const dims = [[d, hgt], [d, hgt], [w, d], [w, d], [w, hgt], [w, hgt]];
    for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
      const k = f * 4 + i; uv.setXY(k, uv.getX(k) * dims[f][0] / unit, uv.getY(k) * dims[f][1] / unit);
    }
    return g;
  }

  // The arena: symmetric, 64 m square, every solid brush stands on the floor.
  function arena(scene, tx) {
    const A = 32, boxes = [], lavaMats = [], lights = [];
    const M = k => new T.MeshLambertMaterial({ map: tx[k] });
    const mat = { floor: M('floor'), wall: M('wall'), metal: M('metal'), crate: M('crate') };
    function add(x0, x1, y0, y1, z0, z1, m, solid = true) {
      const mesh = new T.Mesh(boxGeo(x1 - x0, y1 - y0, z1 - z0), m);
      mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); scene.add(mesh);
      if (solid) boxes.push({ minx: x0, maxx: x1, miny: y0, maxy: y1, minz: z0, maxz: z1 });
      return mesh;
    }
    function mx(x0, x1, y0, y1, z0, z1, m) { add(x0, x1, y0, y1, z0, z1, m); add(-x1, -x0, y0, y1, z0, z1, m); }
    function mz(x0, x1, y0, y1, z0, z1, m) { add(x0, x1, y0, y1, z0, z1, m); add(x0, x1, y0, y1, -z1, -z0, m); }
    function m4(x0, x1, y0, y1, z0, z1, m) { mz(x0, x1, y0, y1, z0, z1, m); mz(-x1, -x0, y0, y1, z0, z1, m); }

    add(-A, A, -1, 0, -A, A, mat.floor);
    mz(-A - 1, A + 1, 0, 10, A, A + 1, mat.wall); mx(A, A + 1, 0, 10, -A, A, mat.wall);
    // the central hill: a platform with stairs on the east and west and low cover north and south
    add(-5, 5, 0, 2.4, -5, 5, mat.metal);
    for (let k = 1; k <= 3; k++) mx(5 + (3 - k) * 1.2, 5 + (4 - k) * 1.2, 0, 0.6 * k, -2, 2, mat.metal);
    mz(-5, 5, 2.4, 3.3, 4.4, 5, mat.wall);
    // four corner towers, stairs running toward the middle, a parapet on the inner side
    m4(22, A, 0, 3, 22, A, mat.wall);
    for (let k = 1; k <= 4; k++) m4(24, 28, 0, 0.6 * k, 22 - (5 - k) * 1.2, 22 - (4 - k) * 1.2, mat.metal);
    m4(22, 22.6, 3, 4, 25, A, mat.wall);
    // cover: long walls, side walls, crates, pillars
    mz(-6, 6, 0, 2.2, 19.5, 20.5, mat.wall);
    mx(19.5, 20.5, 0, 2.2, -5, 5, mat.wall);
    m4(11, 13.2, 0, 2.2, 7, 9.2, mat.crate);
    m4(7, 8.4, 0, 1, 13, 14.4, mat.crate);
    m4(18, 19.4, 0, 6, 9, 10.4, mat.wall);

    // lava channels set into the walls and the floor: the signature light
    const lavaMat = () => { const m = new T.MeshBasicMaterial({ map: tx.lava, color: 0xffffff }); lavaMats.push(m); return m; };
    mz(-20, 20, 3, 3.5, A - 0.05, A, lavaMat()); mx(A - 0.05, A, 3, 3.5, -20, 20, lavaMat());
    [[-1, 1, 7, 18], [-1, 1, -18, -7]].forEach(([a, b, c, d]) => { add(a, b, 0.005, 0.03, c, d, lavaMat(), false); add(c, d, 0.005, 0.03, a, b, lavaMat(), false); });
    [[0, 4, A - 2], [0, 4, -A + 2], [A - 2, 4, 0], [-A + 2, 4, 0]].forEach(([x, y, z]) => {
      const l = new T.PointLight(0xff5a1a, 9, 34, 1); l.position.set(x, y, z); scene.add(l); lights.push(l);
    });
    const top = new T.PointLight(0xffa050, 6, 26, 1); top.position.set(0, 7, 0); scene.add(top); lights.push(top);
    const hemi = new T.HemisphereLight(0x2f5560, 0x1a0e08, 1.1); scene.add(hemi);
    const sun = new T.DirectionalLight(0x8fa4b0, 0.5); sun.position.set(-10, 20, 6); scene.add(sun);
    scene.fog = new T.Fog(0x1a120e, 18, 80); scene.background = new T.Color(0x24180f); // a smoky ember sky

    const spawns = [[26, 0], [-26, 0], [0, 26], [0, -26], [14, 26], [-14, 26], [14, -26], [-14, -26], [26, 14], [-26, -14], [26, -14], [-26, 14]]
      .map(([x, z]) => ({ x, z, yaw: Math.atan2(x, z) }));
    const pickups = [
      ...[[26.5, 26.5], [-26.5, 26.5], [26.5, -26.5], [-26.5, -26.5]].map(([x, z]) => ({ kind: 'health', x, y: 3, z })),
      ...[[0, 14], [0, -14]].map(([x, z]) => ({ kind: 'health', x, y: 0, z })), // on the floor, between the hill and the long walls
      ...[[24, 0], [-24, 0], [0, 25], [0, -25], [0, 0]].map(([x, z]) => ({ kind: 'ammo', x, y: x === 0 && z === 0 ? 2.4 : 0, z })),
    ];
    const nodes = [[10, 0], [-10, 0], [0, 0], [14, 14], [-14, 14], [14, -14], [-14, -14], [0, 14], [0, -14], [0, 26], [0, -26],
      [26, 0], [-26, 0], [14, 26], [-14, 26], [14, -26], [-14, -26], [26, 14], [-26, 14], [26, -14], [-26, -14],
      [26, 16], [-26, 16], [26, -16], [-26, -16], [26.5, 26.5], [-26.5, 26.5], [26.5, -26.5], [-26.5, -26.5], [6, 24], [-6, 24], [6, -24], [-6, -24]]
      .map(([x, z]) => ({ x, z }));
    return { boxes, lavaMats, lights, hemi, sun, spawns, pickups, nodes };
  }

  // ---- Figures: every bot kind has its own outline ----------------------------------------
  function part(parent, w, hgt, d, color, x, y, z, map) {
    const m = new T.Mesh(new T.BoxGeometry(w, hgt, d), new T.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.35, ...(map ? { map } : {}) }));
    m.position.set(x, y, z); parent.add(m); return m;
  }
  function glow(parent, w, hgt, d, x, y, z, color = 0xff6a1a) {
    const m = new T.Mesh(new T.BoxGeometry(w, hgt, d), new T.MeshBasicMaterial({ color }));
    m.position.set(x, y, z); parent.add(m); return m;
  }
  function leg(parent, x, w, len, color, map) { // a pivot at the hip so it can swing
    const p = new T.Group(); p.position.set(x, len, 0); parent.add(p);
    part(p, w, len, w, color, 0, -len / 2, 0, map); part(p, w * 1.3, 0.1, w * 1.8, 0x1c1814, 0, -len + 0.05, -w * 0.3);
    return p;
  }
  // Bots face -z, like the camera.
  function bot(kind, tx) {
    const g = new T.Group(), body = new T.Group(); g.add(body);
    const u = { legs: [], kind };
    if (kind === 'rusher') { // Scrapper: hunched, lean, spiked shoulders, stubby shotgun
      const c = 0x8a3c22;
      u.legs = [leg(body, -0.18, 0.14, 0.7, 0x4a2a1c, tx.body), leg(body, 0.18, 0.14, 0.7, 0x4a2a1c, tx.body)];
      const torso = new T.Group(); torso.position.set(0, 0.75, 0); torso.rotation.x = -0.35; body.add(torso);
      part(torso, 0.7, 0.6, 0.45, c, 0, 0.3, 0, tx.body);
      part(torso, 0.34, 0.3, 0.34, 0x5a2a18, 0, 0.72, -0.12, tx.body);
      glow(torso, 0.08, 0.05, 0.02, -0.08, 0.75, -0.3); glow(torso, 0.08, 0.05, 0.02, 0.08, 0.75, -0.3);
      [-1, 1].forEach(s => {
        const sp = new T.Mesh(new T.ConeGeometry(0.11, 0.42, 4), new T.MeshLambertMaterial({ color: 0xb8a070 }));
        sp.position.set(s * 0.36, 0.7, 0); sp.rotation.z = -s * 0.5; torso.add(sp);
        part(torso, 0.16, 0.5, 0.16, c, s * 0.45, 0.2, -0.1, tx.body);
      });
      part(torso, 0.12, 0.12, 0.5, 0x22201c, 0.45, 0.05, -0.4); part(torso, 0.12, 0.12, 0.5, 0x22201c, 0.32, 0.05, -0.4);
      u.flashZ = -0.7; u.flashY = 0.95;
    } else if (kind === 'lancer') { // Lancer: tall and thin, one slit visor, antenna, long rail gun
      const c = 0x4b5866;
      u.legs = [leg(body, -0.12, 0.11, 1.0, 0x2c333b, tx.body), leg(body, 0.12, 0.11, 1.0, 0x2c333b, tx.body)];
      part(body, 0.44, 0.75, 0.28, c, 0, 1.38, 0, tx.body);
      part(body, 0.6, 0.12, 0.3, 0x2c333b, 0, 1.72, 0, tx.body);
      part(body, 0.3, 0.38, 0.3, c, 0, 1.92, 0, tx.body);
      glow(body, 0.26, 0.05, 0.02, 0, 1.95, -0.16);
      part(body, 0.03, 0.5, 0.03, 0x9aa4ae, 0.1, 2.3, 0.05); glow(body, 0.06, 0.06, 0.06, 0.1, 2.56, 0.05);
      part(body, 0.1, 0.55, 0.1, c, 0.3, 1.4, -0.1, tx.body); part(body, 0.1, 0.55, 0.1, c, -0.3, 1.4, -0.1, tx.body);
      part(body, 0.07, 0.07, 1.5, 0x1d2126, 0.22, 1.25, -0.6); part(body, 0.12, 0.12, 0.3, 0x5a6670, 0.22, 1.33, -0.2);
      u.flashZ = -1.4; u.flashY = 1.25;
    } else { // Furnace: wide and heavy, a glowing belly grate, tiny head, a rotary gun
      const c = 0x3e3934;
      u.legs = [leg(body, -0.3, 0.32, 0.55, 0x2a2622, tx.body), leg(body, 0.3, 0.32, 0.55, 0x2a2622, tx.body)];
      part(body, 1.15, 0.95, 0.75, c, 0, 1.0, 0, tx.body);
      u.belly = glow(body, 0.6, 0.35, 0.04, 0, 0.92, -0.39);
      [-0.12, 0, 0.12].forEach(y => part(body, 0.62, 0.04, 0.05, 0x1a1512, 0, 0.92 + y, -0.41));
      part(body, 0.3, 0.26, 0.3, 0x2a2622, 0, 1.6, -0.08, tx.body);
      glow(body, 0.2, 0.04, 0.02, 0, 1.62, -0.24);
      part(body, 0.36, 0.85, 0.4, c, -0.78, 1.05, 0, tx.body); part(body, 0.36, 0.85, 0.4, c, 0.78, 1.05, 0, tx.body);
      part(body, 0.42, 0.3, 0.3, 0x6e5a2a, 0.78, 0.95, -0.25);
      [[-0.07, 0], [0.07, 0], [0, 0.07], [0, -0.07]].forEach(([a, b]) => part(body, 0.06, 0.06, 0.8, 0x1a1816, 0.78 + a, 0.95 + b, -0.65));
      u.flashZ = -1.1; u.flashY = 0.95;
    }
    const flash = new T.Mesh(new T.PlaneGeometry(0.5, 0.5), new T.MeshBasicMaterial({ map: tx.flash, transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide }));
    flash.position.set(kind === 'lancer' ? 0.22 : kind === 'brute' ? 0.78 : 0.4, u.flashY, u.flashZ); flash.visible = false; body.add(flash);
    u.flash = flash; u.body = body; g.userData = u;
    return g;
  }

  // ---- Guns in the hand (view model space: the camera looks down -z) ------------------------
  function gun(kind, tx) {
    const g = new T.Group(), dark = 0x24221f, steel = 0x5c5a55, brass = 0xc89a3a, wood = 0x5a3518;
    if (kind === 'rifle') {
      part(g, 0.08, 0.11, 0.46, dark, 0, 0, 0); part(g, 0.035, 0.035, 0.36, steel, 0, 0.02, -0.4);
      part(g, 0.05, 0.17, 0.08, brass, 0, -0.12, -0.06).rotation.x = 0.25; part(g, 0.07, 0.1, 0.2, dark, 0, -0.03, 0.3);
      part(g, 0.03, 0.04, 0.12, steel, 0, 0.08, -0.05);
    } else if (kind === 'shotgun') {
      part(g, 0.06, 0.06, 0.56, steel, -0.033, 0.03, -0.24); part(g, 0.06, 0.06, 0.56, steel, 0.033, 0.03, -0.24);
      part(g, 0.13, 0.1, 0.2, wood, 0, -0.04, -0.22); part(g, 0.12, 0.12, 0.26, dark, 0, -0.01, 0.08);
      part(g, 0.1, 0.13, 0.22, wood, 0, -0.06, 0.3);
    } else {
      part(g, 0.07, 0.09, 0.42, dark, 0, 0, 0.02); part(g, 0.03, 0.03, 0.62, steel, 0, 0.02, -0.5);
      const scope = new T.Mesh(new T.CylinderGeometry(0.035, 0.035, 0.26, 8), new T.MeshLambertMaterial({ color: 0x151412 }));
      scope.rotation.x = Math.PI / 2; scope.position.set(0, 0.1, -0.02); g.add(scope);
      glow(g, 0.05, 0.05, 0.01, 0, 0.1, 0.11, 0xffd34a);
      part(g, 0.08, 0.12, 0.24, wood, 0, -0.04, 0.3); part(g, 0.02, 0.02, 0.08, brass, 0.05, 0.03, 0.05);
    }
    const flash = new T.Mesh(new T.PlaneGeometry(0.32, 0.32), new T.MeshBasicMaterial({ map: tx.flash, transparent: true, depthWrite: false, blending: T.AdditiveBlending }));
    flash.position.set(0, 0.03, kind === 'sniper' ? -0.85 : kind === 'shotgun' ? -0.55 : -0.62); flash.visible = false; g.add(flash);
    g.userData.flash = flash;
    return g;
  }

  function pickup(kind) {
    const g = new T.Group();
    if (kind === 'health') {
      part(g, 0.6, 0.38, 0.5, 0xb8b4a8, 0, 0, 0);
      part(g, 0.4, 0.04, 0.12, 0xc0201a, 0, 0.2, 0); part(g, 0.12, 0.04, 0.32, 0xc0201a, 0, 0.2, 0);
      part(g, 0.12, 0.3, 0.02, 0xc0201a, 0, 0, -0.26); part(g, 0.3, 0.1, 0.02, 0xc0201a, 0, 0, -0.26);
    } else {
      part(g, 0.6, 0.3, 0.4, 0x4a4f2a, 0, 0, 0); part(g, 0.62, 0.05, 0.42, 0x2a2c18, 0, 0.05, 0);
      [-0.15, 0, 0.15].forEach(x => { part(g, 0.07, 0.22, 0.07, 0xd8a840, x, 0.25, 0); part(g, 0.05, 0.06, 0.05, 0x9a5a20, x, 0.39, 0); });
    }
    return g;
  }

  return { textures, arena, bot, gun, pickup };
})();

// ==== carried from the one-shot's sim.js ====
// The world: three.js setup, collision against the arena's brushes, hitscan, the player and
// the guns. Loaded before index.html's script; it reads tune, rng, state, settings, down,
// pressed, mouse, sfx and events there at call time.
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
  W3.renderer.toneMapping = THREE.LinearToneMapping; // exposure = tune.brightness
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
    kills: 0, deaths: 0, sinceHurt: 99,
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
  // out of the fight for a while: health creeps back
  p.sinceHurt += dt;
  if (p.sinceHurt >= tune.regenDelay && p.hp < tune.maxHealth) p.hp = Math.min(tune.maxHealth, p.hp + tune.regenRate * dt);
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

// ==== carried from the one-shot's bots.js ====
// The bots, damage and kills, pickups, the match clock, and moving the 3D figures to match
// the simulation each frame.
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
const killTarget = () => diffTune('matchKills'); // the first-to score for the picked bot skill

function updateBot(b, dt) {
  b.px = b.x; b.py = b.y; b.pz = b.z; b.flash -= dt; b.barT = (b.barT || 0) - dt;
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
    const lead = leader(), late = state.timeLeft < tune.matchTime * 0.5 || (lead && lead.kills >= killTarget() * 0.5);
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
  if (v.isPlayer && !state.toldHurt) { state.toldHurt = true; state.hurtLabel = 2; }
  if (v.isPlayer) { v.sinceHurt = 0; state.hurt.push({ ang: angleTo(v, by) - v.yaw, t: 1 }); state.redFlash = 0.25; sfx('hurt'); }
  if (by.isPlayer) { v.barT = tune.hpBarTime; state.hitmark = 0.18; state.hitHead = head; sfx(head ? 'head' : 'hit'); }
  if (v.hp > 0) return;
  v.alive = false; v.deaths++; v.deathT = 0;
  v.respawn = v.isPlayer ? tune.respawnTime : tune.botRespawn;
  by.kills++;
  const gun = by.isPlayer ? GUN_NAMES[by.weapon] : KIND_NAMES[by.kind];
  state.feed.unshift({ text: `${by.name}  [${gun}]  ${v.name}`, mine: by.isPlayer || v.isPlayer, t: 4 });
  if (state.feed.length > 5) state.feed.pop();
  events.push({ type: 'kill', by: by.name, victim: v.name });
  if (by.isPlayer) { state.killmark = 1.8; state.killName = v.name; state.score = by.kills; sfx('kill'); }
  if (v.isPlayer) { v.killedBy = by.name; sfx('death'); }
  if (by.kills >= killTarget()) endMatch();
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
    phase: 'countdown', countdown: tune.countdown, timeLeft: tune.matchTime, feed: [], hurt: [], toldHurt: false, hurtLabel: 0, hitmark: 0, hitHead: false,
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
  state.hitmark -= dt; state.hurtLabel -= dt; state.killmark -= dt; state.redFlash -= dt;
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
  const br = tune.brightness;
  W3.arena.lights.forEach((l, i) => { l.intensity = (i === 4 ? 6 : 9) * (0.85 + 0.15 * Math.sin(now * 3.1 + i * 1.7)); });
  W3.arena.hemi.intensity = 1.1 * br; W3.renderer.toneMappingExposure = br;
  W3.scene.fog.near = 18 * br; W3.scene.fog.far = 80 * br;
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

// ==== carried from the one-shot's hud.js ====
// Sound effects (Web Audio, synthesized) and the 2D overlay: HUD, title, pause, results.
const TEAL = '#5ac8c0', YELLOW = '#ffd34a', ORANGE = '#ff6a1a', BLOOD = '#c0201a', DIM = '#b8ab98';

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
  state.hurt.forEach(hm => {
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
  state.feed.forEach((f, i) => {
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
  text(`A deathmatch against five bots. First to ${killTarget()} kills (${DIFFS[settings.diff]}).`, W / 2, 200, 20, DIM);
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

// ==== the one-shot's page script ====

'use strict';
// The one-shot's starter: only what the checks read. Keep the fixed step, the clock hook,
// window.game and the play and figures scenes. Everything else is the game's own: replace
// what is marked "the game", and draw every figure in the brief's look, in 2D or with three.js.

// ---- Built to be checked ----------------------------------------------------------------
const params = new URLSearchParams(location.search);
const tune = new Proxy({}, { get: (_, k) => CONFIG[k].value }); // live: tune.speed is CONFIG.speed.value
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
const clock = window.GAME_CLOCK || { now: () => performance.now() / 1000 }; // a check may inject one
const CHEAP = params.get('render') === 'cheap'; // a headless shot or check: 3D draws cheap; players never see it
const CHECKING = CHEAP || params.get('manual') === '1' || navigator.webdriver; // no pointer-lock prompt in a check
let seed;
function rng() { // mulberry32; every gameplay random call reads this, never Math.random
  seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const events = []; // window.game.events: anything the game wants a run to see

// ---- Screen ---------------------------------------------------------------------------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
function fit() { // fills the window at any size and pixel ratio
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
function clear(c) { ctx.fillStyle = c; ctx.fillRect(0, 0, W, H); }
function text(s, x, y, size, c, align = 'center') {
  ctx.fillStyle = c; ctx.font = `${size}px ${FONT}`; ctx.textAlign = align;
  ctx.textBaseline = 'middle'; ctx.fillText(s, x, y);
}

// ---- Input: keys by position (event.code), OS key repeat ignored ------------------------
const down = new Set(), hit = new Set();
const pressed = code => hit.has(code); // true for one step after the key goes down
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
function locked() { return document.pointerLockElement === canvas; }
let wasLocked = false;
document.addEventListener('pointerlockchange', () => { // leaving the lock (Esc) pauses the match
  if (wasLocked && !locked() && scene === 'play') scene = 'pause';
  wasLocked = locked();
});
addEventListener('blur', () => down.clear());

// ---- Audio: started on first input, mute on M --------------------------------------------
let audio = null, muted = false;
function startAudio() {
  if (!audio) {
    const ac = window.GAME_AUDIO || new (window.AudioContext || window.webkitAudioContext)(); // a check may inject one
    const out = ac.createGain(); out.gain.value = muted ? 0 : tune.volume;
    out.connect(ac.destination); audio = { ac, out };
  }
  if (audio.ac.state === 'suspended') audio.ac.resume();
}
function setMuted(m) { muted = m; if (audio) audio.out.gain.value = m ? 0 : tune.volume; }
addEventListener('tune', () => setMuted(muted)); // the tweak panel (an add-on), when added, moved a value: the volume follows
function tone(freq, dur, type = 'square', vol = 0.3) {
  if (!audio || muted) return;
  const t = audio.ac.currentTime, o = audio.ac.createOscillator(), g = audio.ac.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(audio.out); o.start(t); o.stop(t + dur);
}

// ---- Scenes: keep only the day-one screens the brief calls for ----------------------------
// title: always. pause: real-time games. over: hard failure. results: a game with an end.
// figures: every enemy kind and unit side by side, for the outline check (?scene=figures).
// The checks look for play by name.
let scene, state;
const settings = { diff: 1, weapon: 0, row: 0 }; // the title's picks, kept between matches
function reset() {
  seed = Number(params.get('seed')) || CONFIG.seed;
  // state.gained: the match's outcome, shown on the results screen.
  state = { t: 0, score: 0, gained: '' };
  newMatch();
}
function startPlay() { reset(); scene = 'play'; }
let figScene = null, figCam = null;
function buildFigures() {
  const T = THREE; figScene = new T.Scene(); figScene.background = new T.Color(0x0b0806);
  figScene.add(new T.HemisphereLight(0x5a8a94, 0x2a1408, 1.4));
  const l = new T.PointLight(0xff7a2a, 30, 20, 1); l.position.set(0, 4, 4); figScene.add(l);
  const fl = new T.Mesh(new T.BoxGeometry(12, 0.2, 5), new T.MeshLambertMaterial({ map: W3.tx.floor })); fl.position.y = -0.1; figScene.add(fl);
  ['rusher', 'lancer', 'brute'].forEach((k, i) => { const b = ART.bot(k, W3.tx); b.position.x = (i - 1) * 3; b.rotation.y = Math.PI + 0.35; figScene.add(b); });
  figCam = new T.PerspectiveCamera(40, 16 / 9, 0.1, 100); figCam.position.set(0, 1.6, 8.5); figCam.lookAt(0, 1.1, 0);
}
const scenes = {
  figures: {
    update(dt) { state.t += dt; },
    draw() {
      if (!figScene) buildFigures();
      W3.renderer.clear(); W3.renderer.render(figScene, figCam);
      ctx.clearRect(0, 0, W, H);
      text('THE BOTS', W / 2, 50, 36, ORANGE);
      [['Scrapper', 'rusher: shotgun, charges in'], ['Lancer', 'marksman: rail gun, keeps away'], ['Furnace', 'brute: rotary gun, soaks damage']]
        .forEach(([n, d], i) => { text(n, W / 2 + (i - 1) * 380, H - 110, 30, '#f0e8da'); text(d, W / 2 + (i - 1) * 380, H - 76, 16, DIM); });
    },
  },
  title: {
    update(dt) {
      state.t += dt;
      if (pressed('ArrowUp') || pressed('KeyW')) settings.row = 0;
      if (pressed('ArrowDown') || pressed('KeyS')) settings.row = 1;
      const dx = (pressed('ArrowRight') || pressed('KeyD') ? 1 : 0) - (pressed('ArrowLeft') || pressed('KeyA') ? 1 : 0);
      if (dx) {
        if (settings.row === 0) settings.diff = (settings.diff + dx + 3) % 3; else settings.weapon = (settings.weapon + dx + 3) % 3;
        sfx('switch');
      }
      if (pressed('Enter') || pressed('Space')) startPlay();
    },
    draw() {
      const now = clock.now();
      syncWorld(1, now);
      const a = now * 0.08; W3.camera.position.set(Math.sin(a) * 30, 13, Math.cos(a) * 30);
      W3.camera.rotation.set(-0.38, a, 0); W3.guns.forEach(g => { g.visible = false; });
      renderWorld(); ctx.clearRect(0, 0, W, H); drawTitle();
    },
  },
  play: {
    update(dt) {
      if (pressed('KeyP') || pressed('Escape')) { scene = 'pause'; if (locked()) document.exitPointerLock(); return; }
      state.t += dt;
      updateMatch(dt);
    },
    draw() { syncWorld(ALPHA, clock.now()); renderWorld(); ctx.clearRect(0, 0, W, H); drawHud(); },
  },
  pause: {
    update() {
      if (pressed('KeyP') || pressed('Escape')) scene = 'play';
      if (pressed('KeyT')) { scene = 'title'; return; }
      const dx = (pressed('ArrowRight') ? 1 : 0) - (pressed('ArrowLeft') ? 1 : 0), c = CONFIG.sensitivity;
      if (dx) c.value = Math.max(c.min, Math.min(c.max, +(c.value + dx * 0.0002).toFixed(4)));
    },
    draw() { scenes.play.draw(); drawPause(); },
  },
  results: {
    update() {
      if (pressed('KeyR') || pressed('Enter')) startPlay();
      else if (pressed('KeyT')) scene = 'title';
    },
    draw() { syncWorld(1, clock.now()); renderWorld(); ctx.clearRect(0, 0, W, H); drawResults(); },
  },
};

// ---- Loop: fixed step, frame time clamped ---------------------------------------------
function step() {
  if (pressed('KeyM')) { setMuted(!muted); hit.delete('KeyM'); }
  scenes[scene].update(STEP); hit.clear();
}
let last, acc = 0, ALPHA = 1; // ALPHA: how far the frame is between the last two steps
function tick() {
  const now = clock.now();
  acc += Math.min(now - last, 0.25); last = now; // a stall never fast-forwards the game
  while (acc >= STEP) { step(); acc -= STEP; }
  ALPHA = acc / STEP; // draw between steps, so the view never judders
  drawFrame();
}
function drawFrame() { scenes[scene].draw(); }
function frame() { tick(); requestAnimationFrame(frame); }
// A headless browser on a time budget runs timers but almost no animation frames: a timer
// ticks when no frame has come for 100 ms on a visible page; a hidden tab stays paused.
function timer() { if (document.visibilityState === 'visible' && clock.now() - last > 0.1) tick(); }

// ---- What a check can read and drive (?manual=1 stops the loop; players never see it) ----
window.game = {
  get scene() { return scene; },
  get state() { return state; },
  press(code) { hit.add(code); },
  hold(code, on) { on ? down.add(code) : down.delete(code); },
  get events() { return events; }, // the loop steps; a check empties it
  step(n = 1, draw = true, alpha = 1) {
    for (let i = 0; i < n; i++) step();
    if (draw) { ALPHA = alpha; drawFrame(); }
  },
};

initWorld(document.getElementById('view'));
fit();
reset();
scene = params.get('scene') || 'title';
last = clock.now();
if (params.get('manual') === '1') drawFrame();
else { requestAnimationFrame(frame); setInterval(timer, 50); }
