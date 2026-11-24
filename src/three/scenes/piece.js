/**
 * A jar, live: one controller for every piece's case study. The scene is the
 * piece's own render, exported (scripts/build-pieces.mjs --stages live); the
 * words are its project's (src/data/projects.js, piece.chapters: the whole jar
 * first, then one chapter per spot the export marked).
 *
 *  - Drag turns the turntable, and only the turntable: the jar, its base and
 *    its tag hold still, as in the render. It carries on a little when let go.
 *    A mouse's vertical drag tilts the view up to 10 degrees; on touch a
 *    vertical swipe stays the page's scroll.
 *  - Left alone it turns by itself. It takes over from the loop at the loop's
 *    own pose and pace (so the cross-fade cannot be seen), then settles to a
 *    slower turn. Any input stops it; it picks up again after a few quiet
 *    seconds on the whole jar, with the glass on (off, the model holds still
 *    to be pointed at). Pause holds it, and the model's own motion.
 *  - Tapping the glass lifts it off: it rises off the brass, leaning back a
 *    little as it goes, and right out of the top of the frame, while the
 *    camera comes in on the model. Then the model is the thing to touch: a
 *    tap on a part (the export numbers them: the lander, its arrays, its
 *    dish; the tag) opens that part's chapter, a resting pointer names the
 *    part under it, and a mouse's vertical drag tilts further, to look down
 *    on it. "Put the glass back" (or the glass button, or Enter) brings it
 *    down from above and sets it on the brass, softly. Whatever hangs from
 *    the knob (a piece marks it `hangs`: the Earth on its thread) stays where
 *    it hangs; only its thread, which would end in the air, goes while the
 *    glass is off.
 *  - Numbered dots mark the spots and fade as they turn away. Tapping one,
 *    or its chapter, turns that side to face you and eases the camera in.
 *  - Keys on the focused jar: left and right turn it 15 degrees, Enter lifts
 *    the glass or puts it back. The explorer's buttons do the same, for touch
 *    and for screen readers (the dots, the parts and the pill on the canvas
 *    are a pointer's shortcuts to the chapters and the button).
 *
 * Everything moves by the frame's own step (update's dt), the drag's carry
 * too, so a recording stepped frame by frame moves as the page does.
 */
import { AnimationMixer, Box3, DoubleSide, Frustum, Group, LatheGeometry, MathUtils, Matrix4, Mesh, MeshBasicMaterial, PMREMGenerator, Vector2, Vector3 } from 'three';
import down from '@phosphor-icons/core/assets/light/arrow-line-down-light.svg?raw';
import grab from '@phosphor-icons/core/assets/light/hand-grabbing-light.svg?raw';
import tap from '@phosphor-icons/core/assets/light/hand-tap-light.svg?raw';

import { esc, prep } from '../../core/util.js';
import { fit } from '../camera-rig.js';
import { batchMovers } from '../piece-batch.js';
import { pieceDust } from '../piece-dust.js';
import { GROUND_LAYER, PieceGlass } from '../piece-glass.js';
import { pieceTracks } from '../piece-tracks.js';
import { HOOKS } from '../pieces/index.js';
import { addGlassGlow, addRoomSheen, floorMap, roomLights } from '../room-sheen.js';
import { dropHighlight, softShadow } from '../stage.js';

const TAU = Math.PI * 2;
const LOOP_TURN = TAU / 6; // the loop's pace: one turn in six seconds
const IDLE_TURN = TAU / 30; // the live jar's own: twelve degrees a second
const HANDOVER = 1.2; // seconds at the loop's pace while the canvas fades in over it
const IDLE_AFTER = 4; // quiet seconds before it turns by itself again
const HINT_AFTER = 3; // quiet seconds before "Drag to turn" shows
const KEY_STEP = MathUtils.degToRad(15);
const BUTTON_STEP = MathUtils.degToRad(45);
const DRAG_TURN = Math.PI * 1.25; // a drag across the whole box turns it 225 degrees
const LIFT_SECS = 1.2; // up: off the brass and out of the top of the frame
const LOWER_SECS = 1.4; // down: in from the top and onto the brass
const LIFT_PAST = 1.5; // it rises this much further than leaving the frame takes, so it leaves still moving
const LIFT_TIP = MathUtils.degToRad(-5); // the lean back it has while it moves
const GLASS_CLEAR = 0.6; // along the way up, the glass is clear of a chapter's closer view (the camera would go through it before)
// The camera on what is left to see with the glass off: clear of the pill
// at the top and the hint at the bottom (measured: they keep their size on a
// smaller box), with this much room beside them.
const LIFTED_ROOM = 8;
const LIFTED_SIDES = 0.04;
const LIFTED_PITCH = [MathUtils.degToRad(-6), MathUtils.degToRad(26)]; // a mouse's tilt then: down to 14 degrees, up to 46
const TAP_HINT_AFTER = 1.2; // seconds lifted before "Tap a part" shows
const PART_SCALE = 8; // the export keeps a part's number n as n / 8 (pieces/live.py part_attr)

/** `a` moved by whole turns to lie within half a turn of `ref`. */
const near = (a, ref) => a + TAU * Math.round((ref - a) / TAU);
/** [x, y, z] turned by `a` about the vertical axis. */
const turnY = (p, a, out = new Vector3()) => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return out.set(p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c);
};
const smooth = (e0, e1, x) => {
  const t = MathUtils.clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
/** Slow off, quick across, slow in. */
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (2 - 2 * x) ** 3 / 2);
/** A quarter pixel: dots glide at any speed, and are written only when they move. */
const quarter = (v) => Math.round(v * 4) / 4;

/**
 * The height of the ground a model stands on: the middle, by area, of its
 * faces that look up, out from the middle of the turntable to its edge
 * (where the ground is, more than the model). The glass mirrors the inside
 * against it.
 */
function groundOf(tt, radius) {
  const faces = [];
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const e = new Vector3();
  const n = new Vector3();
  tt.updateWorldMatrix(true, true);
  tt.traverse((o) => {
    const g = o.isMesh ? o.geometry : null;
    if (!g) return;
    const pos = g.attributes.position;
    const idx = g.index;
    const count = idx ? idx.count : pos.count;
    for (let t = 0; t < count; t += 3) {
      const i = idx ? idx.getX(t) : t;
      a.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      b.fromBufferAttribute(pos, idx ? idx.getX(t + 1) : t + 1).applyMatrix4(o.matrixWorld);
      c.fromBufferAttribute(pos, idx ? idx.getX(t + 2) : t + 2).applyMatrix4(o.matrixWorld);
      n.subVectors(c, b).cross(e.subVectors(a, b));
      const area = n.length() / 2;
      if (area < 1e-9 || n.y < 0.8 * 2 * area) continue;
      const x = (a.x + b.x + c.x) / 3;
      const z = (a.z + b.z + c.z) / 3;
      const r = Math.hypot(x, z);
      if (r < radius * 0.4 || r > radius) continue;
      faces.push([(a.y + b.y + c.y) / 3, area]);
    }
  });
  if (!faces.length) return null;
  faces.sort((p, q) => p[0] - q[0]);
  const half = faces.reduce((s, f) => s + f[1], 0) / 2;
  let sum = 0;
  for (const [y, w] of faces) if ((sum += w) >= half) return y;
  return faces[faces.length - 1][0];
}

/** The model's meshes on the turntable (the export's atlas: the model and its ground, not the disc). */
function modelsOn(tt) {
  const out = [];
  tt?.traverse((o) => {
    if (o.isMesh && [o.material].flat().some((m) => m?.name === 'atlas')) out.push(o);
  });
  return out;
}

/**
 * Where there is anything for the glass to see (world): a box round all of
 * the scene but the glass, with the turntable's part as it turns and as its
 * clip moves it over a whole loop; the top of what stands inside the jar (or
 * hangs there: the Earth on its thread); and a box round what stands outside
 * it (all a ray that has left the jar can meet: the jar is convex). `poses`
 * runs its callback once for each pose to take in.
 */
function boundsOf(root, tt, skip, poses) {
  const fixed = new Box3();
  const inner = new Box3();
  const b = new Box3();
  const boxOf = (o) => {
    if (o.boundingBox !== undefined) {
      if (o.boundingBox === null) o.computeBoundingBox();
      b.copy(o.boundingBox);
    } else {
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      b.copy(o.geometry.boundingBox);
    }
    return b.applyMatrix4(o.matrixWorld);
  };
  const walk = (o, into) => {
    if (!o.visible || skip.has(o)) return;
    if (o === tt) into = inner;
    if (o.geometry) into.union(boxOf(o));
    for (const c of o.children) walk(c, into);
  };
  poses(() => {
    root.updateMatrixWorld(true);
    walk(root, fixed);
  });
  const axis = tt ? new Vector3().setFromMatrixPosition(tt.matrixWorld) : new Vector3();
  const all = fixed.clone();
  // The turntable's part sweeps a circle.
  if (!inner.isEmpty()) {
    const R = Math.max(...[[inner.min.x, inner.min.z], [inner.min.x, inner.max.z], [inner.max.x, inner.min.z], [inner.max.x, inner.max.z]].map(([x, z]) => Math.hypot(x - axis.x, z - axis.z)));
    all.union(new Box3(new Vector3(axis.x - R, inner.min.y, axis.z - R), new Vector3(axis.x + R, inner.max.y, axis.z + R)));
  }
  all.expandByScalar(0.01);
  const out = fixed.isEmpty() ? all : fixed.clone().expandByScalar(0.01);
  return {
    min: all.min.toArray(),
    max: all.max.toArray(),
    innerTop: inner.isEmpty() ? all.max.y : inner.max.y + 0.01,
    outMin: out.min.toArray(),
    outMax: out.max.toArray(),
  };
}

/**
 * What must stay in view with the glass off (world points): the model as it
 * turns (its widest at each height, in bands of 5 cm), the base it stands on,
 * and every part the export numbered off the turntable (the tag), as its box.
 * `skip`: what goes while the glass is off (a thread).
 */
function keepInView(root, tt, skip, base, baseTop) {
  const pts = [];
  const ring = (r, y, cx, cz, n) => {
    for (let k = 0; k < n; k++) pts.push(new Vector3(cx + r * Math.cos((k / n) * TAU), y, cz + r * Math.sin((k / n) * TAU)));
  };
  const onTurntable = (o) => {
    for (let q = o; q; q = q.parent) if (q === tt) return true;
    return false;
  };
  root.updateMatrixWorld(true);
  const ax = tt ? tt.matrixWorld.elements[12] : 0;
  const az = tt ? tt.matrixWorld.elements[14] : 0;
  const bands = new Map();
  const fixed = new Box3();
  const v = new Vector3();
  root.traverse((o) => {
    // (A batch's geometry is its parts unplaced: the hidden nodes stand for it.)
    if (!o.isMesh || o.isBatchedMesh || skip.has(o)) return;
    const pos = o.geometry.attributes.position;
    const part = o.geometry.attributes._part;
    const turns = !!tt && onTurntable(o);
    if (!turns && !part) return;
    for (let i = 0; i < pos.count; i++) {
      if (!turns && part.getX(i) * PART_SCALE < 0.5) continue;
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      if (!turns) fixed.expandByPoint(v);
      else {
        const b = Math.floor(v.y / 0.05);
        bands.set(b, Math.max(bands.get(b) ?? 0, Math.hypot(v.x - ax, v.z - az)));
      }
    }
  });
  for (const [b, r] of bands) {
    ring(r, b * 0.05, ax, az, 16);
    ring(r, (b + 1) * 0.05, ax, az, 16);
  }
  ring(base, 0, 0, 0, 32);
  ring(base, baseTop, 0, 0, 32);
  if (!fixed.isEmpty()) {
    fixed.expandByScalar(0.01);
    for (const x of [fixed.min.x, fixed.max.x]) for (const y of [fixed.min.y, fixed.max.y]) for (const z of [fixed.min.z, fixed.max.z]) pts.push(new Vector3(x, y, z));
  }
  return pts;
}

/**
 * The see-through parts of the model, which the glass must find. It follows
 * each ray through the frame's depth to what it meets (piece-glass.js), and
 * what writes none it passes straight through: a beam or a drop standing in
 * the jar would never show through the glass (NeerNaadi's tickets and rain,
 * Indoor Tracking's links, KPS Clean-O's bubbles), only over what stands
 * behind it. So the glass draws these again on its own (seeThrough). Each
 * one whole: a part that is partly solid stays as it is. Not what a track
 * fades (a ripple, a pulse), nor the materials in `flat` (Mission Builder's
 * dust sheets, 0.7 mm over the cells): those lie flat on what is under them,
 * where the frame already shows them to any ray that meets it.
 */
function seenThrough(model, tracks, flat = []) {
  const objects = [];
  const materials = new Set();
  const fades = new Set(
    Object.entries(tracks?.materials ?? {})
      .filter(([, t]) => t.opacity)
      .map(([name]) => name)
  );
  const on = new Set(flat);
  const clear = (m) => m && m.transparent && !m.depthWrite && !fades.has(m.name) && !on.has(m) && (m.isMeshStandardMaterial || m.isMeshBasicMaterial);
  model?.traverse((o) => {
    if (!o.isMesh || o.isBatchedMesh) return;
    const ms = [o.material].flat();
    if (!ms.every(clear)) return;
    objects.push(o);
    for (const m of ms) materials.add(m);
  });
  return { objects, materials };
}

/** The role the export gave a mesh, or the node above it that carries it. */
function roleOf(o) {
  for (let p = o; p; p = p.parent) if (p.userData?.role) return p.userData.role;
  return null;
}

/**
 * The turn a drag leaves behind, from the angle frame by frame over its last
 * tenth of a second (frames, not pointer events: the same on every device,
 * and in a recording stepped frame by frame). Nothing if it had stopped
 * before the pointer lifted.
 */
function releaseSpeed(trail) {
  if (trail.length < 2) return 0;
  const [t0, a0] = trail[0];
  const [t1, a1] = trail[trail.length - 1];
  if (t1 - t0 < 0.03) return 0;
  const recent = trail.find(([t]) => t >= t1 - 0.05) ?? trail[0];
  if (Math.abs(a1 - recent[1]) < 1e-3) return 0;
  return (a1 - a0) / (t1 - t0);
}

export async function create({ stage, rig, slot, emit }) {
  const pc = stage.data.piece;
  const media = slot.media;
  const abort = new AbortController();
  const sig = { signal: abort.signal };
  const meta = slot.opts.meta?.chapters ?? [];

  // ------------------------------------------------------------ the parts
  const tt = stage.byName.get(pc.turntable);
  let glassMesh = stage.byName.get(pc.glass);
  if (glassMesh && !glassMesh.isMesh) glassMesh = glassMesh.children.find((c) => c.isMesh) ?? null;

  // The glass turns on a hinge at the back of its rim: as it lifts, it leans
  // back a little, the way a hand lifts a cloche.
  const box = glassMesh ? new Box3().setFromObject(glassMesh) : null;
  const pivot = new Group();
  pivot.name = 'glass_pivot';
  const hinge = box ? new Vector3(0, box.min.y, box.min.z) : new Vector3();
  pivot.position.copy(hinge);
  stage.root.add(pivot);
  // The jar's own frame, which the glass's optics are worked in: the middle
  // of its foot, lifted and tipped with it.
  const jarFrame = new Group();
  jarFrame.position.set(-hinge.x, 0, -hinge.z);
  pivot.add(jarFrame);
  pivot.updateMatrixWorld(true);
  let glass = null;
  let proxy = null;
  if (glassMesh) {
    pivot.attach(glassMesh);
    // What a tap on the glass hits: its outline, a few hundred triangles,
    // not the glass's own thousands.
    const r = (box.max.x - box.min.x) / 2;
    const h = box.max.y - box.min.y;
    const pts = [[r, 0], [r, 0.6], [0.97 * r, 0.68], [0.88 * r, 0.76], [0.72 * r, 0.84], [0.48 * r, 0.9], [0, 0.93]].map(([x, y]) => new Vector2(x, y * h));
    proxy = new Mesh(new LatheGeometry(pts, 24), new MeshBasicMaterial({ side: DoubleSide }));
    proxy.visible = false;
    proxy.userData.pick = 'glass';
    jarFrame.add(proxy);
  }

  // What hangs from the knob hangs on where it is while the glass is off
  // (it turns with the turntable, as it did in the render: it was on it).
  // Only its thread goes then, or it would end in the air: the hung part
  // named for it (the export keeps each thread a node of its own and joins
  // the rest of what hangs; by size, a stopwatch's hand or tick would go too).
  const threads = [];
  tt?.traverse((o) => {
    if (o.userData?.hangs && o.isMesh && /thread/.test(o.name)) threads.push(o);
  });

  // The model's own motion (a brush's sweep, a signal's beads): one clip,
  // as long as the loop.
  const clip = stage.animations[0] ?? null;
  const mixer = clip ? new AnimationMixer(stage.root) : null;
  const action = clip ? mixer.clipAction(clip) : null;
  action?.play();
  // A piece whose motion is all its own (the courier's receipt) has no clip:
  // its loop keeps time here, as long as the render's.
  const LOOP = clip?.duration ?? pc.loop ?? 6;
  let clock = 0;
  const setTime = (t) => {
    if (mixer) mixer.setTime(t);
    else clock = ((t % LOOP) + LOOP) % LOOP;
  };
  const advance = (dt) => {
    if (mixer) mixer.update(dt);
    else clock = (clock + dt) % LOOP;
  };
  const timeNow = () => (mixer ? mixer.time : clock);
  /** Where the clip is in its loop (0..1). */
  const phase = () => (action ? action.time / clip.duration : clock / LOOP);

  // A piece's dust (Mission Builder's arrays): the render's formula, on its
  // sheets, following the clip's brushes.
  const dust = pc.dust && stage.maps?.grain && stage.maps?.mottle ? pieceDust({ byName: stage.byName, dust: pc.dust, maps: stage.maps, prepare: softShadow }) : null;
  // What the clip changes on the materials (a glow's beat, a ripple fading).
  const tracks = pieceTracks(stage.root, pc.tracks);
  // And a piece's own effects, which neither carries (src/three/pieces/).
  const own = HOOKS[pc.id] ? (await HOOKS[pc.id]()).create({ stage, pc, tt, renderer: slot.engine.renderer }) : null;
  // What of the see-through the glass must find (after the hook: its own
  // materials count; before the movers are batched, which keep its layers).
  const throughGlass = glassMesh ? seenThrough(tt ?? stage.root, pc.tracks, dust?.materials) : { objects: [], materials: new Set() };
  /** Everything that follows the clip, where the clip is now. */
  const follow = (dt = 0) => {
    const ph = phase();
    dust?.update(ph);
    tracks?.update(ph);
    own?.update(ph, dt);
  };

  if (glassMesh) {
    const poses = (take) => {
      if (!clip) return take();
      for (let i = 0; i <= 16; i++) {
        mixer.setTime((clip.duration * i) / 16);
        take();
      }
      mixer.setTime(0);
    };
    glass = new PieceGlass({
      mesh: glassMesh,
      frame: jarFrame,
      renderer: slot.engine.renderer,
      scene: stage.scene,
      piece: pc,
      ground: tt ? groundOf(tt, pc.room?.r ?? 0.39) : null,
      bounds: boundsOf(stage.scene, tt, new Set([glassMesh, proxy]), poses),
      models: modelsOn(tt),
      small: slot.opts.tier !== 'high',
    });
    glass.seeThrough(throughGlass.objects, throughGlass.materials);
    glassMesh.geometry.computeBoundingBox();
  }
  // The clip's many small movers that share a material, drawn as one each
  // (after the glass took its bounds from them; before the first frames
  // below compile what draws them).
  const movers = batchMovers(tt, clip, { off: [GROUND_LAYER] });
  // (A batch of see-through movers, NeerNaadi's rain, leaves the frame with
  // its nodes while the glass is down: PieceGlass.seeInFrame.)
  glass?.seeAlso(movers?.batches ?? []);

  // The room's lights in the brass, and in the walnut's lacquer (the export
  // marks what of the set is glossy): the render's highlights, which the
  // panorama (its strips clipped) and the diffuse light bake cannot give.
  // Each sees only the lights that fall on it: the brass rim is glassware
  // and sees them all, the walnut only those not linked to the glassware;
  // and neither sees any through the glass. The brass mirrors the walnut's
  // top and the pad below it, out past the glass, from a map of the set seen
  // from above (the kit's base and pad, pieces/_kit.py: the base 0.57 m from
  // the middle, the pad trimmed at 0.76 m, its fade gone by 0.72 m).
  const jarSize = pc.jar ?? { y: 0.13, r: 0.42, wall: 0.011, h: 0.6 };
  const jar = glass ? { toJar: glass.uniforms.toJar, r: jarSize.r + jarSize.wall, h: jarSize.h } : null;
  const padR = pc.pad?.r ?? 0.76;
  const setMeshes = [];
  stage.root.traverse((o) => {
    if (o.isMesh && o.userData.role === 'set' && o.material?.isMeshBasicMaterial) setMeshes.push(o);
  });
  const floor = setMeshes.length ? floorMap(slot.engine.renderer, setMeshes, { half: padR + 0.02 }) : null;
  const floors = floor && { map: floor, base: [jarSize.y, pc.base?.r ?? 0.57], pad: [0, padR], inner: jar?.r ?? jarSize.r + jarSize.wall };
  const sheened = new Set();
  stage.root.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of [o.material].flat()) {
      if (!m || sheened.has(m)) continue;
      const brass = m.isMeshStandardMaterial && m.name === 'jar_brass';
      // (Baked from the camera with the rest of its gloss, where the export did.)
      const lacquer = pc.sheen && !stage.data.gloss && o.userData.role === 'set' && m.name === 'baked';
      if (!brass && !lacquer) continue;
      addRoomSheen(m, roomLights(pc, brass ? 'jar_rim' : 'jar_base'), { jar, floors: brass ? floors : null });
      // Each light once: the brass mirrors the room's lights as the
      // rectangles they are, where the glass does not hide them. One of them,
      // the kit's low light from behind in the piece's accent, is a live
      // light as well, for the model, and it lit the brass a second time, as
      // a point with nothing in its way: a line of the accent round the
      // inside of the rim, where in Cycles the model stands between them.
      if (brass) for (const l of pc.probe?.lights ?? []) dropHighlight(m, l.name);
      sheened.add(m);
    }
  });

  // The model's own light from round it: the inside of the jar as the glass's
  // cube map takes it, where the room seen through the glass is dark (Cycles'
  // lights are not seen through glass), not the panorama, which holds the
  // strips only the glassware sees.
  // (A piece's hook may dress one part in a copy of the atlas material of its
  // own: each copy is the model's too.)
  const atlasMats = new Set();
  stage.root.traverse((o) => {
    if (o.isMesh) for (const m of [o.material].flat()) if (m?.name === 'atlas') atlasMats.add(m);
  });
  // And the ground below it from the glass's ground map.
  if (glass) for (const m of atlasMats) glass.reflectGround(m);
  // And what the render's glass passes on to its rough parts: the lights
  // that fall on the glass, in their own gloss, as Cycles' glossy blur lets
  // them through (room-sheen.js addGlassGlow). Before the captures below,
  // so its shaders compile while the jar loads (the captures themselves are
  // taken without it).
  const spot = stage.key;
  const glow =
    glass && atlasMats.size && spot
      ? addGlassGlow(atlasMats, roomLights(pc), {
          dir: spot.position.clone().sub(spot.target.position),
          color: spot.color.clone().multiplyScalar(spot.intensity),
        })
      : null;
  let modelEnv = null;
  // The inside, for the glass to mirror, is taken now, while the jar loads
  // (its new shaders compile here, not in the first frames on screen), at
  // the turntable's start and the clip's: the maps turn with the turntable
  // from wherever they were taken.
  if (glass) {
    if (tt) tt.rotation.y = 0;
    setTime(0);
    follow();
    stage.root.updateMatrixWorld(true);
    glass.update(0);
    // (Without the glow: in Cycles only glossy rays find it, and the model
    // takes its diffuse light from this capture as well.)
    glow?.set(0);
    glass.capture(0);
    glow?.set(1);
    if (atlasMats.size) {
      const pm = new PMREMGenerator(slot.engine.renderer);
      modelEnv = pm.fromCubemap(glass.cubeTarget.texture);
      pm.dispose();
      for (const m of atlasMats) {
        m.envMap = modelEnv.texture;
        m.envMapIntensity = 1;
        m.needsUpdate = true;
      }
      dust?.setEnv(modelEnv.texture);
    }
    glass.captureGround();
  }

  // What a tap can meet with the glass off: every part of the model, and the
  // set and brass round them, which open nothing but are in the way.
  const solids = [];
  stage.root.traverse((o) => {
    if (!o.isMesh || o.isBatchedMesh || o === glassMesh || o === proxy || roleOf(o) === 'glass') return;
    o.userData.pick = 'part';
    solids.push(o);
  });

  // ------------------------------------------------------------ state
  const turn = { a: 0, v: 0, mode: 'idle', target: 0, still: 0, handover: false };
  const lift = { x: 0, want: 0, up: 0 }; // x: along the way up (0..1); up: seconds since it got there
  let held = false;
  let synced = false;
  let sinceLive = 0;
  let dragged = false;
  let tapped = false; // a part, with the glass off
  let focus = null; // the spot whose chapter is showing
  let hover = null; // the part under a resting pointer
  let glassSeen = true;
  let liftH = 0;

  const spots = new Map(
    Object.entries(pc.spots ?? {})
      .filter(([id]) => meta.some((c) => c.id === id))
      .map(([id, s]) => [id, { id, ...s, n: meta.findIndex((c) => c.id === id) + 1 }])
  );
  // Which spot a tap on a part opens: the export's numbers (spots[id].part).
  const partIds = new Map([...spots.values()].filter((s) => s.part).map((s) => [s.part, s.id]));

  /** Where a spot is, and which way it faces, with the turntable at `a`. */
  const spotAt = (s, a, out) => (s.on === 'jar' ? out.set(...s.at) : turnY(s.at, a, out));
  const spotOut = (s, a, out) => (s.on === 'jar' ? out.set(...s.out) : turnY(s.out, a, out));

  /** The turntable angle that faces a spot to the camera (null: any will do). */
  const facing = (s) => {
    if (s.on === 'jar') return null;
    const [ox, , oz] = s.out;
    const [ax, , az] = s.at;
    const phi = Math.hypot(ox, oz) > 0.25 ? Math.atan2(ox, oz) : Math.hypot(ax, az) > 0.06 ? Math.atan2(ax, az) : null;
    return phi == null ? null : near(-phi, turn.a);
  };

  const input = () => {
    turn.still = 0;
    turn.handover = false;
  };

  const seek = (a) => {
    input();
    turn.mode = 'seek';
    turn.target = a;
  };
  const turnBy = (d) => seek((turn.mode === 'seek' ? turn.target : turn.a) + d);

  // Lifted, the camera comes in on what is left to see (on the whole jar; a
  // part's close view stays where it is): framed as the rig frames a
  // diorama, then lowered or raised to sit between the pill and the hint.
  const view = stage.data.view;
  const keep = keepInView(stage.root, tt, new Set(threads), pc.base?.r ?? 0.57, jarSize.y);
  let framed = null;
  const liftedShot = () => {
    const aspect = slot.css.w && slot.css.h ? slot.css.w / slot.css.h : 1;
    const h = media.clientHeight || slot.css.h || 1;
    const key = `${aspect.toFixed(4)}:${h}`;
    if (framed?.key === key) return framed.shot;
    // What the pill and the hint take of the box (they are laid out while hidden).
    const t = back.isConnected ? (back.offsetTop + back.offsetHeight + LIFTED_ROOM) / h : 0.12;
    const b = hint.isConnected && hint.offsetHeight ? (h - hint.offsetTop + LIFTED_ROOM) / h : 0.1;
    const insets = { t: MathUtils.clamp(t, 0.06, 0.24), b: MathUtils.clamp(b, 0.06, 0.24), l: LIFTED_SIDES, r: LIFTED_SIDES };
    const lo = new Vector3(Infinity, Infinity, Infinity);
    const hi = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const q of keep) {
      lo.min(q);
      hi.max(q);
    }
    const f = fit([lo.toArray(), hi.toArray()], view.dir, view.fov, aspect, 1.02, insets, keep.map((q) => q.toArray()));
    // (Centred in the whole frame; moved to the middle of the room the insets leave.)
    const d = new Vector3(...view.dir).normalize();
    const right = d.clone().cross(new Vector3(0, 1, 0)).normalize();
    const up = right.clone().cross(d).normalize();
    const half = f.distance * Math.tan(MathUtils.degToRad(view.fov) / 2);
    f.target.addScaledVector(up, (insets.t - insets.b) * half);
    framed = { key, aspect, shot: { target: f.target.toArray(), zoom: f.distance / rig.home.distance } };
    return framed.shot;
  };

  /**
   * How high the glass goes: half as far again as it must to leave the top
   * of the frame at the home view (the widest the jar is seen), so it goes
   * out still moving and slows where nobody sees.
   */
  const liftHeight = () => {
    if (!box) return 0;
    const cam = rig.camera.clone();
    cam.position.copy(rig.home.target).addScaledVector(rig.dir, rig.home.distance);
    cam.lookAt(rig.home.target);
    cam.updateMatrixWorld(true);
    const R = jarSize.r + jarSize.wall;
    const v = new Vector3();
    let need = 0;
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * TAU;
      let lo = 0;
      let hi = 8;
      for (let i = 0; i < 24; i++) {
        const m = (lo + hi) / 2;
        v.set(R * Math.cos(a), box.min.y + m, R * Math.sin(a)).project(cam);
        if (v.y > 1.02 && v.z < 1) hi = m;
        else lo = m;
      }
      need = Math.max(need, hi);
    }
    return need * LIFT_PAST;
  };

  const setLift = (on) => {
    if (!glassMesh) return;
    if (on && !lift.want) {
      liftH = liftHeight();
      // It stops turning by itself to be looked at (it starts again later, left alone).
      if (turn.mode === 'idle') turn.mode = 'coast';
    }
    lift.want = on ? 1 : 0;
    if (!on) setHover(null);
    rig.setPitchLimits(...(on ? LIFTED_PITCH : []));
    if (!focus) rig.setShot(on ? liftedShot() : null);
    else if (!on) {
      // A part's close view stays; a chapter's closer one (with the glass
      // off) backs out before the glass comes down. (Going up, it comes in
      // once the glass is clear: see the lift, frame by frame.)
      const c = meta.find((x) => x.id === focus);
      if (c?.view && spots.get(focus)) rig.setShot(shotFor(spots.get(focus), c));
    }
    emit('lift', on ? 'up' : 'down');
  };

  // ------------------------------------------------------------ chapters
  const actions = () => [
    { id: 'left', label: 'Turn left' },
    { id: 'right', label: 'Turn right' },
    { id: 'lift', label: 'Lift the glass', pressed: lift.want > 0 },
  ];
  const act = (id) => {
    if (id === 'left') turnBy(-BUTTON_STEP);
    else if (id === 'right') turnBy(BUTTON_STEP);
    else if (id === 'lift') setLift(!lift.want);
  };
  const shotFor = (s, c) => {
    const a = turn.mode === 'seek' ? turn.target : turn.a;
    const p = spotAt(s, a, new Vector3());
    const up = spotOut(s, a, new Vector3()).y;
    // With the glass off, a chapter may come in closer, as its own view says
    // (with it on the camera stays well outside it: close, the glass smears),
    // and aim `drop` below its dot (a dot over what it names: ObserveX's
    // masked person, the dot over the label over the figure) or, negative,
    // above it (AirDraw's bridge: up the rod from the dot on its base).
    if (lift.want && lift.x >= GLASS_CLEAR && c?.view) return { target: [p.x, p.y - (c.view.drop ?? 0), p.z], zoom: c.view.zoom, pitch: c.view.pitch ?? 0 };
    // A spot that faces up is looked down on a little more.
    return { target: [p.x, p.y, p.z], zoom: s.on === 'jar' ? 0.5 : 0.58, pitch: up > 0.9 ? 0.12 : 0 };
  };
  const chapters = meta.map((c) => {
    const s = spots.get(c.id);
    if (!s) {
      return {
        id: c.id,
        get shot() {
          return lift.want ? liftedShot() : null;
        },
        enter() {
          focus = null;
          // Back to turning by itself soon, unless it already is.
          if (turn.mode !== 'idle') turn.still = Math.max(turn.still, IDLE_AFTER - 1.5);
        },
        actions,
        act,
      };
    }
    return {
      id: c.id,
      enter() {
        focus = s.id;
        const a = facing(s);
        if (a == null) {
          input();
          if (turn.mode === 'idle') turn.mode = 'coast';
        } else seek(a);
        emit('spot', s.id);
      },
      get shot() {
        return shotFor(s, c);
      },
      actions,
      act,
    };
  });

  /** A dot, a part or its chapter: go there; the same one again faces it again. */
  const goSpot = (id) => {
    const ch = slot.chapters;
    if (!ch) return;
    if (ch.current?.id === id) {
      ch.current.enter();
      rig.setShot(ch.current.shot ?? null);
    } else ch.go(id);
  };

  // ------------------------------------------------------------ the overlay
  const layer = document.createElement('div');
  layer.className = 'piece-spots';
  layer.setAttribute('aria-hidden', 'true');
  const dots = [...spots.values()].map((s) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'piece-spot';
    el.tabIndex = -1;
    el.innerHTML = `<span>${String(s.n).padStart(2, '0')}</span>`;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      goSpot(s.id);
    }, sig);
    layer.appendChild(el);
    return { s, el, x: NaN, y: NaN, o: -1, on: null, lit: null };
  });
  // The name of the part under a resting pointer, beside it.
  const tip = document.createElement('div');
  tip.className = 'piece-tip';
  layer.appendChild(tip);
  media.appendChild(layer);

  const hint = document.createElement('div');
  hint.className = 'piece-hint';
  hint.setAttribute('aria-hidden', 'true');
  const HINTS = { drag: `${prep(grab)}<span>Drag to turn</span>`, tap: `${prep(tap)}<span>Tap a part</span>` };
  let hintKind = 'drag';
  hint.innerHTML = HINTS.drag;
  media.appendChild(hint);

  // The way back for a pointer, on the canvas while the glass is off (the
  // explorer's glass button is the way for keyboards and screen readers): the
  // glass back on, and the whole jar in view again.
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'piece-back';
  back.tabIndex = -1;
  back.setAttribute('aria-hidden', 'true');
  back.innerHTML = `${prep(down)}<span>Put the glass back</span>`;
  back.addEventListener('click', (e) => {
    e.stopPropagation();
    input();
    // Done with the parts: the whole jar again, as it was.
    if (focus && meta[0]) slot.chapters?.go(meta[0].id);
    setLift(false);
  }, sig);
  if (glassMesh) media.appendChild(back);

  // The jar takes the keyboard when focused (the explorer's buttons are the
  // way in for everyone else).
  const label = `${stage.data.label ?? 'The model'} under glass, in 3D. The left and right arrow keys turn it; Enter lifts the glass off or puts it back.`;
  const hadTab = media.getAttribute('tabindex');
  media.tabIndex = 0;
  media.setAttribute('role', 'group');
  media.setAttribute('aria-roledescription', '3D model');
  media.setAttribute('aria-label', label);
  media.addEventListener('keydown', (e) => {
    if (e.target !== media || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      turnBy(e.key === 'ArrowLeft' ? -KEY_STEP : KEY_STEP);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setLift(!lift.want);
    }
  }, sig);

  /** The part a pointer rests on (null: none): its dot lights, its name shows beside the pointer. */
  function setHover(id, e) {
    if (id && e) {
      const r = media.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      if (id !== hover) {
        const s = spots.get(id);
        const c = meta.find((m) => m.id === id);
        tip.innerHTML = `<span class="n">${String(s?.n ?? 0).padStart(2, '0')}</span>${esc(c?.title ?? id)}`;
      }
      // Beside the pointer, kept inside the box.
      const w = tip.offsetWidth || 120;
      const left = x + 16 + w > r.width - 8 ? x - 16 - w : x + 16;
      tip.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(Math.min(y + 14, r.height - 40))}px, 0)`;
    }
    if (id === hover) return;
    hover = id;
    tip.classList.toggle('is-in', !!id);
  }

  // ------------------------------------------------------------ pointer
  let drag = null;
  const onDrag = (phase, hit, e) => {
    if (phase === 'start') {
      input();
      dragged = true;
      turn.mode = 'drag';
      turn.v = 0;
      setHover(null);
      drag = { x: e.clientX, y: e.clientY, a0: turn.a, mouse: e.pointerType === 'mouse', trail: [[sinceLive, turn.a]] };
      if (drag.mouse) rig.beginDrag();
      return;
    }
    if (!drag) return;
    if (phase === 'move') {
      const w = slot.css.w || 1;
      turn.a = drag.a0 + ((e.clientX - drag.x) / w) * DRAG_TURN;
      if (drag.mouse) rig.dragBy(0, (e.clientY - drag.y) / (slot.css.h || 1));
      turn.still = 0;
      return;
    }
    // Let go: it carries on at the speed it was turning, unless it had
    // stopped before the pointer lifted. (Where it is now counts, though the
    // frame that would have sampled it has not come yet.)
    const last = drag.trail[drag.trail.length - 1];
    if (last[0] === sinceLive) last[1] = turn.a;
    else drag.trail.push([sinceLive, turn.a]);
    turn.v = MathUtils.clamp(releaseSpeed(drag.trail), -9, 9);
    turn.mode = 'coast';
    turn.still = 0;
    if (drag.mouse) rig.endDrag();
    drag = null;
  };

  // ------------------------------------------------------------ frame
  /** Where the loop is (one turn per loop): its turn, its clip's time, and whether it plays on. */
  const loopPose = () => {
    const ph = slot.opts.phase?.();
    if (!ph || !(ph.d > 0)) return null;
    const f = (ph.t / ph.d) % 1;
    return { a: f * TAU, time: f * LOOP, playing: ph.playing !== false };
  };
  /** Take over from the loop where it is (its pose, its clip time, its pace). */
  const sync = () => {
    synced = true;
    const lp = loopPose();
    if (lp) {
      turn.a = lp.a;
      turn.v = held ? 0 : LOOP_TURN;
      turn.handover = true;
      setTime(lp.time);
    } else {
      turn.v = held ? 0 : IDLE_TURN;
    }
  };

  const atHome = () => !focus;

  // At the engine's last step (engine.js: the density floor) the key light's
  // shadow map is drawn half as fine, its edge spread over half as many
  // texels, so it stays as soft on the model (about 2 mm). Redrawn every
  // frame at 2048 a side, it was what NeerNaadi's jar, the busiest, could
  // least afford on an integrated GPU: with it held still, no frame came
  // late (build/qa/paceprobe.mjs).
  const shadowKey = stage.key?.castShadow ? stage.key : null;
  const shadowFull = shadowKey ? { size: shadowKey.shadow.mapSize.x, radius: shadowKey.shadow.radius } : null;
  let shadowHalf = false;
  const shadowQuality = (q) => {
    if (!shadowFull || (q >= 3) === shadowHalf) return;
    shadowHalf = q >= 3;
    const k = shadowHalf ? 0.5 : 1;
    // (three resizes the map itself when mapSize changes.)
    shadowKey.shadow.mapSize.setScalar(shadowFull.size * k);
    shadowKey.shadow.radius = shadowFull.radius * k;
  };

  function update(dt) {
    if (!synced) sync();
    sinceLive += dt;
    if (!held) advance(dt);
    glass?.setQuality(slot.engine.quality);
    shadowQuality(slot.engine.quality);

    const T = turn;
    // While the loop still plays under the canvas fading in, the jar keeps
    // to its pose (a slow first frame, its step capped, would leave it behind).
    const lp = T.mode === 'idle' && T.handover && !held && sinceLive < HANDOVER ? loopPose() : null;
    if (lp?.playing) {
      T.a = near(lp.a, T.a);
      T.v = LOOP_TURN;
      setTime(lp.time);
    } else if (T.mode === 'idle') {
      const want = held ? 0 : T.handover && sinceLive < HANDOVER ? LOOP_TURN : IDLE_TURN;
      // A turntable has weight: it eases to a new pace.
      T.v += (want - T.v) * (1 - Math.exp(-dt * (held ? 5 : 1.1)));
      T.a += T.v * dt;
    } else if (T.mode === 'coast') {
      T.v *= Math.exp(-dt * 2.4);
      T.a += T.v * dt;
      if (Math.abs(T.v) < 0.03) {
        T.v = 0;
        T.mode = 'rest';
      }
    } else if (T.mode === 'seek') {
      const k = 34;
      T.v += (-k * (T.a - T.target) - 2 * Math.sqrt(k) * T.v) * dt;
      T.a += T.v * dt;
      if (Math.abs(T.a - T.target) < 2e-3 && Math.abs(T.v) < 2e-3) {
        T.a = T.target;
        T.v = 0;
        T.mode = 'rest';
      }
    } else if (T.mode === 'drag' && drag) {
      // The angle frame by frame, for the carry when it is let go.
      drag.trail.push([sinceLive, T.a]);
      while (drag.trail.length > 2 && sinceLive - drag.trail[0][0] > 0.1) drag.trail.shift();
    }
    if (T.mode !== 'drag') T.still += dt;
    // (Not with the glass off: then the model holds still, to be pointed at and tapped.)
    if (T.mode === 'rest' && !held && atHome() && T.still > IDLE_AFTER && !lift.want) T.mode = 'idle';
    if (tt) tt.rotation.y = T.a;

    // The lift: off the brass slowly, quickly up and out of the frame; in
    // from the top, and slowly onto the brass. Leaning back while it moves.
    const L = lift;
    // A new shape of box while lifted (a phone turned): framed again.
    if (L.want && !focus && framed && slot.css.w && framed.key !== `${(slot.css.w / slot.css.h).toFixed(4)}:${media.clientHeight}`) rig.setShot(liftedShot());
    L.x = MathUtils.clamp(L.x + dt / (L.want ? LIFT_SECS : -LOWER_SECS), 0, 1);
    L.up = L.want && L.x === 1 ? L.up + dt : 0;
    // A chapter with a closer view of its own (the glass off) comes in once the glass is clear.
    if (L.want && focus && L.x >= GLASS_CLEAR && !rig.drag) {
      const c = meta.find((x) => x.id === focus);
      if (c?.view && rig.shot.zoom !== c.view.zoom && spots.get(focus)) rig.setShot(shotFor(spots.get(focus), c));
    }
    pivot.position.y = hinge.y + liftH * easeInOut(L.x);
    pivot.rotation.x = LIFT_TIP * Math.sin(Math.PI * L.x);
    // (Lifted clear, no glass passes the lights on.)
    glow?.set(1 - MathUtils.smoothstep(L.x, 0, GLASS_CLEAR));
    for (const t of threads) t.visible = L.x === 0;
    glass?.update(T.a);
    // The dust where the clip has its brushes now; the glows, the receipt,
    // the rings where the clip is.
    follow(held ? 0 : dt);

    // "Drag to turn", until someone has; lifted, "Tap a part", until someone has.
    const kind = L.want ? (!tapped && L.up > TAP_HINT_AFTER ? 'tap' : null) : !dragged && sinceLive > HINT_AFTER && T.still > HINT_AFTER - 0.5 ? 'drag' : null;
    if (kind && kind !== hintKind) {
      hintKind = kind;
      hint.innerHTML = HINTS[kind];
    }
    if (hint.classList.contains('is-in') !== !!kind) hint.classList.toggle('is-in', !!kind);
    const showBack = L.want && L.x > 0.9;
    if (back.classList.contains('is-in') !== showBack) back.classList.toggle('is-in', showBack);
  }

  const p = new Vector3();
  const o = new Vector3();
  const toCam = new Vector3();
  const frustum = new Frustum();
  const pv = new Matrix4();
  const seen = new Box3();
  function afterRig(camera, w, h) {
    camera.updateMatrixWorld();
    // Whether any of the glass is in the frame (out of it, it is not drawn).
    if (glassMesh) {
      glassMesh.updateWorldMatrix(true, false);
      seen.copy(glassMesh.geometry.boundingBox).applyMatrix4(glassMesh.matrixWorld);
      frustum.setFromProjectionMatrix(pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      glassSeen = frustum.intersectsBox(seen);
    }
    for (const d of dots) {
      spotAt(d.s, turn.a, p);
      spotOut(d.s, turn.a, o);
      toCam.subVectors(camera.position, p).normalize();
      const face = o.dot(toCam);
      // Where the part shows: through the glass, the jar's lens moves it.
      if (glass && glassSeen) glass.apparent(p, camera, p);
      else p.project(camera);
      const x = quarter(((p.x + 1) / 2) * w);
      const y = quarter(((1 - p.y) / 2) * h);
      const op = p.z > 1 ? 0 : Math.round(smooth(0.02, 0.32, face) * 100) / 100;
      if (x !== d.x || y !== d.y) {
        d.el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        d.x = x;
        d.y = y;
      }
      if (op !== d.o) {
        d.el.style.opacity = String(op);
        // A dot turned away cannot be tapped.
        d.el.style.pointerEvents = op > 0.4 ? '' : 'none';
        d.o = op;
      }
      const on = focus === d.s.id;
      if (on !== d.on) {
        d.el.classList.toggle('is-on', on);
        d.on = on;
      }
      const lit = hover === d.s.id;
      if (lit !== d.lit) {
        d.el.classList.toggle('is-lit', lit);
        d.lit = lit;
      }
    }
  }

  return {
    chapters,
    dragAll: true,
    // The glass while it is on; the model's parts while it is off.
    pickables: () => (lift.want ? solids : proxy ? [proxy] : []),
    /** A hit on the model: the part the export numbered there, or nothing (the ground, the brass). */
    refinePick(r, h) {
      if (r.kind !== 'part') return r;
      const a = h.object.geometry?.attributes?._part;
      let n = a && h.face ? Math.round(a.getX(h.face.a) * PART_SCALE) : 0;
      for (let q = h.object; q && !n; q = q.parent) n = q.userData?.part ?? 0;
      const id = partIds.get(n);
      return id ? { ...r, part: id } : null;
    },
    onDrag,
    onHover(hit, e) {
      setHover(hit?.kind === 'part' ? hit.part : null, e);
    },
    onClick(hit) {
      if (hit?.kind === 'glass') {
        input();
        setLift(!lift.want);
      } else if (hit?.kind === 'part') {
        input();
        tapped = true;
        setHover(null);
        goSpot(hit.part);
      }
    },
    update,
    afterRig,
    /** The glass, drawn over each finished frame and looking through it (none while it is out of the frame). */
    get overlay() {
      return glass && glassSeen ? glass.overlay : null;
    },
    /** QA: the glass itself (its cube and ground maps). */
    glass,
    /** Pause: the turn it makes by itself and the model's own motion hold. */
    hold(on) {
      held = !!on;
      if (!held && turn.mode === 'rest' && atHome()) turn.still = IDLE_AFTER;
    },
    reset() {
      seek(near(0, turn.a));
      setLift(false);
    },
    snapshot: () => ({ turn: turn.a, lifted: lift.want > 0, time: timeNow() }),
    resume(s) {
      if (s?.turn != null) {
        turn.a = s.turn;
        synced = true;
      }
      if (s?.time != null) setTime(s.time);
      if (s?.lifted && glassMesh) {
        liftH = liftHeight();
        lift.want = lift.x = 1;
        rig.setPitchLimits(...LIFTED_PITCH);
      }
    },
    /** QA: where it stands. */
    state: () => ({
      angle: MathUtils.radToDeg(turn.a),
      speed: MathUtils.radToDeg(turn.v),
      mode: turn.mode,
      lift: lift.x,
      lifted: lift.want > 0,
      height: +(liftH * easeInOut(lift.x)).toFixed(3),
      glassSeen,
      held,
      focus,
      hover,
      hint: hint.classList.contains('is-in') ? hintKind : null,
      back: back.classList.contains('is-in'),
      dots: dots.map((d) => ({ id: d.s.id, x: d.x, y: d.y, opacity: d.o })),
      dust: dust?.state() ?? null,
      tracks: tracks?.state() ?? null,
      own: own?.state?.() ?? null,
      batched: movers ? { meshes: movers.meshes, batches: movers.batches.length } : null,
      seen: [...throughGlass.materials].map((m) => m.name),
    }),
    dispose() {
      abort.abort();
      layer.remove();
      hint.remove();
      back.remove();
      if (hadTab == null) media.removeAttribute('tabindex');
      else media.setAttribute('tabindex', hadTab);
      for (const k of ['role', 'aria-roledescription', 'aria-label']) media.removeAttribute(k);
      mixer?.stopAllAction();
      mixer?.uncacheRoot(stage.root);
      dust?.dispose();
      own?.dispose();
      movers?.dispose();
      glass?.dispose();
      floor?.dispose();
      modelEnv?.dispose();
      proxy?.geometry.dispose();
      proxy?.material.dispose();
    },
  };
}
