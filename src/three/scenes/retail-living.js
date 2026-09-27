/**
 * The store's living set: what changes on its own as the day goes on, and
 * the small things people take and leave.
 *
 * Blender makes these pieces separately and lit live (scripts/blender/kit/
 * retail.py and scenes/retail-analytics.py), so the page can move them:
 *   - the wall clock's hands, on the store's own time
 *   - a lamp over each fitting booth: green while free, red while taken
 *   - the till: the POS screen brightens as the cashier scans, the card
 *     reader turns green when a card is accepted, and a receipt feeds out of
 *     the printer
 *   - a shirt left on a booth's hook after a try-on, until the staff collect it
 *   - the top pairs of the denim wall's waist-high stacks: taken, and restocked
 * and the page adds its own:
 *   - pigeons on the pavement, which hop off when someone comes near
 *   - what people carry: a shirt on its hanger to the fitting room, a bag after paying
 */
import { ConeGeometry, Group, Mesh, MeshStandardMaterial, Quaternion, SphereGeometry, Vector3 } from 'three';

const FREE = 0x35d07f;
const TAKEN = 0xf0506e;

export function livingSet({ stage, scene, rand }) {
  const byName = stage.byName;
  const disposables = [];

  // ---------------------------------------------------------------- the clock
  const hands = ['clock_hour', 'clock_minute'].map((n) => byName.get(n)).filter(Boolean);
  const handRest = hands.map((h) => h.quaternion.clone());
  const turn = new Quaternion();
  const faceNormal = new Vector3(0, 0, 1); // Blender's -Y, the face's front, in the hand's own frame
  function clock(storeSecs) {
    const h = (storeSecs / 3600) % 12;
    const m = (storeSecs / 60) % 60;
    [h / 12, m / 60].forEach((k, i) => {
      if (!hands[i]) return;
      // Clockwise seen from the front: negative about the face's normal.
      hands[i].quaternion.copy(handRest[i]).multiply(turn.setFromAxisAngle(faceNormal, -k * Math.PI * 2));
    });
  }

  // ---------------------------------------------------------------- the booths
  const lamps = [0, 1, 2].map((i) => byName.get(`booth_${i}_lamp`)).map((o) => {
    if (!o?.material) return null;
    o.material = o.material.clone(); // each booth's own
    disposables.push(o.material);
    return o;
  });
  const left = [0, 1, 2].map((i) => byName.get(`booth_${i}_left`) ?? null);
  for (const s of left) if (s) s.visible = false;

  // ---------------------------------------------------------------- the till
  const posScreen = byName.get('cash_wrap_pos_screen');
  const reader = byName.get('cash_wrap_reader');
  const receipt = byName.get('cash_wrap_receipt');
  for (const o of [posScreen, reader]) {
    if (o?.material) {
      o.material = o.material.clone();
      disposables.push(o.material);
    }
  }
  const posBase = posScreen?.material.emissiveIntensity ?? 1;
  const readerColor = reader?.material.emissive?.clone();
  if (receipt) receipt.visible = false;
  const till = { accepted: 0, receipt: 0, scan: 0 };

  // ---------------------------------------------------------------- the denim wall
  // Five columns of stacks; the top two pairs of each waist-high stack can go.
  const denim = [];
  for (let c = 0; c < 5; c++) for (let k = 0; k < 2; k++) {
    const o = byName.get(`denim_take_${c}_${k}`);
    if (o) denim.push({ o, c, k });
  }

  // ---------------------------------------------------------------- pigeons
  // Grey, a green-violet sheen at the neck, pink feet: a few spheres and cones.
  const grey = new MeshStandardMaterial({ color: 0x8d9097, roughness: 0.8 });
  const neck = new MeshStandardMaterial({ color: 0x5f7a6e, roughness: 0.5, metalness: 0.2 });
  const beakMat = new MeshStandardMaterial({ color: 0x3a3a3c, roughness: 0.6 });
  const bodyGeo = new SphereGeometry(0.045, 12, 8);
  const headGeo = new SphereGeometry(0.022, 10, 8);
  const beakGeo = new ConeGeometry(0.006, 0.02, 6);
  const wingGeo = new SphereGeometry(0.03, 8, 6);
  disposables.push(grey, neck, beakMat, bodyGeo, headGeo, beakGeo, wingGeo);
  const pavement = { x0: 3.45, x1: 4.85, z0: 1.2, z1: 3.3 };
  const birds = [];
  for (let i = 0; i < 4; i++) {
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
  function pigeons(dt, people) {
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

  // ---------------------------------------------------------------- what people carry
  /** Show or hide a piece a figure carries (made with the figure: people.js). */
  const carry = (a, piece, on) => {
    const o = a.fig.root.getObjectByName(piece);
    if (o) o.visible = on;
    return !!o;
  };

  return {
    /** A booth is taken (its lamp turns red) or free. */
    booth(i, taken) {
      const l = lamps[i];
      if (l) l.material.emissive.setHex(taken ? TAKEN : FREE);
    },
    /** Something was tried on and left on booth i's hook (or collected: false). */
    leftOnHook(i, on) {
      if (left[i]) left[i].visible = on;
    },
    hookHasShirt: (i) => !!left[i]?.visible,
    /** The cashier scans an item: the POS screen brightens a moment. */
    scan() {
      till.scan = 1;
    },
    /** A card is accepted: the reader goes green, and the receipt feeds out. */
    paid() {
      till.accepted = 1;
      till.receipt = 0.001;
    },
    /** A pair taken from the denim wall's column `c` (nearest the shopper); false if that column is bare. */
    takeDenim(c) {
      const d = denim.filter((q) => q.c === c && q.o.visible).sort((p, q) => q.k - p.k)[0];
      if (!d) return false;
      d.o.visible = false;
      return true;
    },
    denimMissing: () => denim.filter((q) => !q.o.visible).length,
    restockDenim() {
      for (const q of denim) q.o.visible = true;
    },
    carry,
    update(dt, { clock: storeSecs, people }) {
      clock(storeSecs);
      if (posScreen) {
        till.scan = Math.max(0, till.scan - dt * 2);
        posScreen.material.emissiveIntensity = posBase * (1 + till.scan * 1.4);
      }
      if (reader?.material && readerColor) {
        // Green for two and a half seconds after a card is accepted.
        till.accepted = Math.max(0, till.accepted - dt / 2.5);
        if (till.accepted > 0) reader.material.emissive.setHex(FREE);
        else reader.material.emissive.copy(readerColor);
        reader.material.emissiveIntensity = till.accepted > 0 ? 3 : 1;
      }
      if (receipt) {
        if (till.receipt > 0) {
          till.receipt += dt;
          receipt.visible = true;
          // Feeds out over a second and a half, and is torn off after four.
          receipt.scale.y = Math.min(1, till.receipt / 1.5);
          if (till.receipt > 4) {
            till.receipt = 0;
            receipt.visible = false;
          }
        }
      }
      pigeons(dt, people);
    },
    dispose() {
      for (const b of birds) b.g.removeFromParent();
      disposables.forEach((d) => d.dispose?.());
    },
  };
}
