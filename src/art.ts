// Slagpit's art, all drawn in code: chunky 32px textures with nearest filtering, the arena's
// brushes, the three bot kinds, the guns and the pickups. Dark rust, cold teal shadow, warm
// lava light, sulphur-yellow accents.
import * as THREE from 'three';
import type { Loose, BoxSpec } from './game/types';

type RGB = [number, number, number];
type Ctx2D = CanvasRenderingContext2D;

/** Builders for every drawn thing in the game. */
export const ART = (() => {
  const T = THREE;
  let h = 7;
  const r = () => { h = (h * 1103515245 + 12345) & 0x7fffffff; return h / 0x7fffffff; }; // texture noise only

  function tex(size: number, paint: (g: Ctx2D, s: number) => void): THREE.CanvasTexture {
    const c = document.createElement('canvas'); c.width = c.height = size;
    paint(c.getContext('2d') as Ctx2D, size);
    const t = new T.CanvasTexture(c);
    t.magFilter = T.NearestFilter; t.minFilter = T.NearestFilter; t.generateMipmaps = false;
    t.wrapS = t.wrapT = T.RepeatWrapping; t.colorSpace = T.SRGBColorSpace;
    return t;
  }
  function px(g: Ctx2D, x: number, y: number, c: RGB | number[], k: number): void {
    const v = 1 + (r() - 0.5) * k;
    g.fillStyle = `rgb(${c[0] * v | 0},${c[1] * v | 0},${c[2] * v | 0})`; g.fillRect(x, y, 1, 1);
  }
  function fill(g: Ctx2D, s: number, c: RGB, k: number): void { for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) px(g, x, y, c, k); }

  function textures(): Record<string, THREE.CanvasTexture> {
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
          const x0 = col * 16 + (row % 2) * 8, y0 = row * 8, base: RGB = [62 + r() * 14, 50 + r() * 8, 44];
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
      flash: tex(32, (g: Ctx2D) => { // muzzle flash star
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
  function boxGeo(w: number, hgt: number, d: number, unit = 2): THREE.BoxGeometry {
    const g = new T.BoxGeometry(w, hgt, d), uv = g.attributes.uv;
    const dims = [[d, hgt], [d, hgt], [w, d], [w, d], [w, hgt], [w, hgt]];
    for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
      const k = f * 4 + i; uv.setXY(k, uv.getX(k) * dims[f][0] / unit, uv.getY(k) * dims[f][1] / unit);
    }
    return g;
  }

  // The arena: symmetric, 64 m square, every solid brush stands on the floor.
  function arena(scene: THREE.Scene, tx: Record<string, THREE.CanvasTexture>): Loose {
    const A = 32, boxes: BoxSpec[] = [], lavaMats: THREE.MeshBasicMaterial[] = [], lights: THREE.PointLight[] = [];
    const M = (k: string) => new T.MeshLambertMaterial({ map: tx[k] });
    const mat = { floor: M('floor'), wall: M('wall'), metal: M('metal'), crate: M('crate') };
    function add(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, m: THREE.Material, solid = true): THREE.Mesh {
      const mesh = new T.Mesh(boxGeo(x1 - x0, y1 - y0, z1 - z0), m);
      mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); scene.add(mesh);
      if (solid) boxes.push({ minx: x0, maxx: x1, miny: y0, maxy: y1, minz: z0, maxz: z1 });
      return mesh;
    }
    function mx(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, m: THREE.Material): void { add(x0, x1, y0, y1, z0, z1, m); add(-x1, -x0, y0, y1, z0, z1, m); }
    function mz(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, m: THREE.Material): void { add(x0, x1, y0, y1, z0, z1, m); add(x0, x1, y0, y1, -z1, -z0, m); }
    function m4(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, m: THREE.Material): void { mz(x0, x1, y0, y1, z0, z1, m); mz(-x1, -x0, y0, y1, z0, z1, m); }

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
  function part(parent: THREE.Object3D, w: number, hgt: number, d: number, color: number, x: number, y: number, z: number, map?: THREE.Texture): THREE.Mesh {
    const m = new T.Mesh(new T.BoxGeometry(w, hgt, d), new T.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.35, ...(map ? { map } : {}) }));
    m.position.set(x, y, z); parent.add(m); return m;
  }
  function glow(parent: THREE.Object3D, w: number, hgt: number, d: number, x: number, y: number, z: number, color = 0xff6a1a): THREE.Mesh {
    const m = new T.Mesh(new T.BoxGeometry(w, hgt, d), new T.MeshBasicMaterial({ color }));
    m.position.set(x, y, z); parent.add(m); return m;
  }
  function leg(parent: THREE.Object3D, x: number, w: number, len: number, color: number, map?: THREE.Texture): THREE.Group { // a pivot at the hip so it can swing
    const p = new T.Group(); p.position.set(x, len, 0); parent.add(p);
    part(p, w, len, w, color, 0, -len / 2, 0, map); part(p, w * 1.3, 0.1, w * 1.8, 0x1c1814, 0, -len + 0.05, -w * 0.3);
    return p;
  }
  // Bots face -z, like the camera.
  function bot(kind: string, tx: Record<string, THREE.CanvasTexture>): THREE.Group {
    const g = new T.Group(), body = new T.Group(); g.add(body);
    const u: Loose = { legs: [], kind };
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
  function gun(kind: string, tx: Record<string, THREE.CanvasTexture>): THREE.Group {
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

  function pickup(kind: string): THREE.Group {
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
