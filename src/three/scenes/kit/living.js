/**
 * Living detail any diorama can use: the small things that move on their own
 * or with the people around them, made by the page rather than baked.
 *
 *   carry     show or hide a piece a figure carries (made with the figure)
 *   pigeons   a few birds on a patch of ground, pecking and hopping, that
 *             fly off to another bit of it when someone comes near
 *   particles points rising, falling or drifting from a source: sparks,
 *             flames, smoke; their own random stream is the caller's
 *   spin      a part turning about its own axis (a mixer's drum)
 */
import { BufferAttribute, BufferGeometry, CanvasTexture, ConeGeometry, Group, Mesh, MeshStandardMaterial, Points, PointsMaterial, SphereGeometry, Vector3 } from 'three';

/** Show or hide a piece a figure carries (made with the figure: people.js). */
export const carry = (a, piece, on) => {
  const o = a.fig.root.getObjectByName(piece);
  if (o) o.visible = on;
  return !!o;
};

/**
 * Pigeons on the ground inside `rect` ({ x0, x1, z0, z1 }), `count` of them.
 * Materials and geometry go into `disposables` (the caller's to free).
 * @returns {{ update(dt, people): void, dispose(): void }}
 */
export function pigeons({ scene, rand, rect, count = 4, disposables }) {
  // Grey, a green-violet sheen at the neck, pink feet: a few spheres and cones.
  const grey = new MeshStandardMaterial({ color: 0x8d9097, roughness: 0.8 });
  const neck = new MeshStandardMaterial({ color: 0x5f7a6e, roughness: 0.5, metalness: 0.2 });
  const beakMat = new MeshStandardMaterial({ color: 0x3a3a3c, roughness: 0.6 });
  const bodyGeo = new SphereGeometry(0.045, 12, 8);
  const headGeo = new SphereGeometry(0.022, 10, 8);
  const beakGeo = new ConeGeometry(0.006, 0.02, 6);
  const wingGeo = new SphereGeometry(0.03, 8, 6);
  disposables.push(grey, neck, beakMat, bodyGeo, headGeo, beakGeo, wingGeo);
  const pavement = rect;
  const birds = [];
  for (let i = 0; i < count; i++) {
    const g = new Group();
    const body = new Mesh(bodyGeo, grey);
    body.scale.set(0.8, 0.75, 1.25);
    body.position.y = 0.05;
    const head = new Mesh(headGeo, neck);
    head.position.set(0, 0.09, 0.05);
    const beak = new Mesh(beakGeo, beakMat);
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, 0.088, 0.075);
    const wings = [-1, 1].map((s) => {
      const w = new Mesh(wingGeo, grey);
      w.scale.set(0.3, 0.5, 1.2);
      w.position.set(s * 0.03, 0.06, -0.005);
      g.add(w);
      return w;
    });
    g.add(body, head, beak);
    const x = pavement.x0 + rand() * (pavement.x1 - pavement.x0);
    const z = pavement.z0 + rand() * (pavement.z1 - pavement.z0);
    g.position.set(x, 0.035, z);
    g.rotation.y = rand() * Math.PI * 2;
    scene.add(g);
    birds.push({ g, head, wings, t: rand() * 3, peck: 0, fly: null });
  }
  const flyTo = (b, from) => {
    // Away from whoever came close, onto another bit of the pavement.
    for (let k = 0; k < 8; k++) {
      const x = pavement.x0 + rand() * (pavement.x1 - pavement.x0);
      const z = pavement.z0 + rand() * (pavement.z1 - pavement.z0);
      if (Math.hypot(x - from.x, z - from.y) > 1.4) {
        b.fly = { from: b.g.position.clone(), to: new Vector3(x, 0.035, z), t: 0, dur: 0.9 + rand() * 0.5 };
        b.g.rotation.y = Math.atan2(x - b.g.position.x, z - b.g.position.z);
        return;
      }
    }
  };
  return {
    update,
    dispose() {
      for (const b of birds) b.g.removeFromParent();
    },
  };

  function update(dt, people) {
    for (const b of birds) {
      if (b.fly) {
        const f = b.fly;
        f.t += dt / f.dur;
        const k = Math.min(1, f.t);
        b.g.position.lerpVectors(f.from, f.to, k);
        b.g.position.y = 0.035 + Math.sin(k * Math.PI) * 0.55;
        const flap = Math.sin(f.t * 60) * 0.9;
        b.wings.forEach((w, i) => (w.rotation.z = (i ? -1 : 1) * (0.4 + flap)));
        if (f.t >= 1) {
          b.fly = null;
          b.wings.forEach((w) => (w.rotation.z = 0));
        }
        continue;
      }
      const scare = people.find((p) => p.visible && Math.hypot(p.pos.x - b.g.position.x, p.pos.y - b.g.position.z) < 0.75);
      if (scare) {
        flyTo(b, scare.pos);
        continue;
      }
      // Pecking and the odd hop.
      b.t -= dt;
      if (b.t <= 0) {
        b.t = 0.6 + rand() * 2.2;
        if (rand() < 0.35) {
          const a = b.g.rotation.y + (rand() - 0.5) * 1.6;
          const x = Math.min(pavement.x1, Math.max(pavement.x0, b.g.position.x + Math.sin(a) * 0.12));
          const z = Math.min(pavement.z1, Math.max(pavement.z0, b.g.position.z + Math.cos(a) * 0.12));
          b.g.rotation.y = a;
          b.g.position.set(x, 0.035, z);
        } else b.peck = 1;
      }
      b.peck = Math.max(0, b.peck - dt * 3);
      b.head.position.y = 0.09 - Math.sin(b.peck * Math.PI) * 0.04;
      b.head.position.z = 0.05 + Math.sin(b.peck * Math.PI) * 0.02;
    }
  }

}

/** A soft round dot, bright in the middle: points drawn with it read as a glow or a puff, not a square. */
function drawDot() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.35, 'rgba(255,255,255,0.7)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}
// One dot for every particle system (the page has one renderer), made on
// first use and let go when the last system is disposed.
let dot = null;
let dotUsers = 0;
const takeDot = () => {
  dotUsers++;
  return (dot ??= drawDot());
};
const dropDot = () => {
  if (--dotUsers > 0) return;
  dot?.dispose();
  dot = null;
  dotUsers = 0;
};

/**
 * `n` points, each living 0.6 to 1.4 s from where `spawn(i, pos, vel)` puts
 * it, moving at its velocity; `step(dt, spawn, on)` each frame (while `on`,
 * about two in three dead points respawn). Draws from `rand` only for them.
 * Each point is a soft round dot `size` across.
 */
export function particles({ scene, rand, n, color, size, blending = null, opacity = 0.8 }) {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(n * 3), 3));
  const map = takeDot();
  const m = new PointsMaterial({ color, size, map, transparent: true, opacity, depthWrite: false, sizeAttenuation: true, ...(blending ? { blending } : {}) });
  const pts = new Points(g, m);
  pts.frustumCulled = false;
  pts.visible = false;
  scene.add(pts);
  const life = new Float32Array(n);
  const vel = new Float32Array(n * 3);
  return {
    pts,
    vel,
    n,
    step(dt, spawn, on) {
      const pos = g.attributes.position.array;
      let any = false;
      for (let i = 0; i < n; i++) {
        if (life[i] <= 0) {
          if (!on || rand() > 0.35) {
            pos[i * 3 + 1] = -10;
            continue;
          }
          spawn(i, pos, vel);
          life[i] = 0.6 + rand() * 0.8;
        }
        life[i] -= dt;
        pos[i * 3] += vel[i * 3] * dt;
        pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
        pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        any = true;
      }
      pts.visible = any;
      g.attributes.position.needsUpdate = true;
    },
    dispose() {
      pts.removeFromParent();
      g.dispose();
      m.dispose();
      if (m.map) dropDot();
      m.map = null;
    },
  };
}

/** A part turning about its own (local) Y axis at `rate` radians a second. */
export const spin = (node, rate) => ({
  update(dt) {
    node?.rotateY(dt * rate);
  },
});
