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
import { Quaternion, Vector3 } from 'three';

import { carry, pigeons } from './kit/living.js';

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
  const birds = pigeons({ scene, rand, rect: { x0: 3.45, x1: 4.85, z0: 1.2, z1: 3.3 }, disposables });

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
      birds.update(dt, people);
    },
    dispose() {
      birds.dispose();
      disposables.forEach((d) => d.dispose?.());
    },
  };
}
