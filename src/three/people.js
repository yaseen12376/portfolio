/**
 * The cast: one shared rig and its bodies (public/3d/_shared/people.glb, built
 * by scripts/blender/people_build.py), cloned per figure.
 *
 *  - Colour: every vertex carries a region code (sixteen: eyes, whites, skin,
 *    top, trousers, shoes, soles, hair, mouth, accent, trim, vest, strip,
 *    badge, lens, belt) in COLOR_0.r; each figure's material maps it through
 *    its own palette. Any outfit, one shader.
 *  - Pieces: hair, hats, glasses and what people carry are rigid meshes
 *    parented to a bone of the figure's own skeleton (bag in the hand, hard
 *    hat on the head). A hi-vis vest is a skinned overlay on the body.
 *  - Motion: an AnimationMixer per figure, crossfading clips; walkers follow a
 *    polyline at the speed their stride covers, so feet don't slide.
 *  - Paths use the same arc-length parameter ('along', 0..1) as the Blender
 *    stills (bake_scene.py path_point), so a figure starts exactly where the
 *    poster shows it.
 */
import {
  AnimationClip,
  AnimationMixer,
  CanvasTexture,
  Color,
  LoopOnce,
  LoopRepeat,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

import { fetchJSON } from './stage.js';

const REGIONS = ['eyes', 'white', 'skin', 'top', 'bottom', 'shoes', 'sole', 'hair', 'mouth', 'accent', 'trim', 'vest', 'strip', 'badge', 'lens', 'belt'];
// The same defaults and fallbacks as people.py resolve_outfit(): stills and live agree.
const DEFAULT = {
  eyes: '#2a1c14', white: '#f3efe8', skin: '#e2b79a', top: '#6f7f94', bottom: '#2d3340', shoes: '#1b1b1e', sole: '#d9d4cb',
  hair: '#221c19', mouth: '#7a3b36', accent: '#f59e0b', lens: '#15171b', belt: '#2e2622',
};
export function resolveOutfit(outfit = {}) {
  const o = { ...DEFAULT, ...outfit };
  o.trim ??= o.top;
  o.badge ??= o.top;
  o.vest ??= o.top;
  o.strip ??= o.vest;
  return o;
}

let shared = null;

export async function loadPeople(base = '/3d/_shared/') {
  if (shared) return shared;
  shared = (async () => {
    const meta = await fetchJSON(`${base}people.json`);
    const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(`${base}people.glb?v=${meta.hash ?? '0'}`);
    const clips = new Map(gltf.animations.map((c) => [c.name, c]));
    // Arms held in, hands together in front (the queueing pose's arms
    // alone, the narrowest of the clips: 20 cm to the side where the walk
    // swings 25): blended over any clip when someone squeezes past a fixture
    // or a person, so the swing doesn't clip.
    const held = clips.get('queue');
    if (held) {
      const arms = held.tracks.filter((t) => /^(upperarm|forearm|hand)[LR]\./.test(t.name));
      if (arms.length) clips.set('arms_in', new AnimationClip('arms_in', held.duration, arms));
    }
    // The rigid pieces (hair, hats, what people carry), by name.
    const pieces = new Map();
    gltf.scene.traverse((o) => {
      if (o.isMesh && !o.isSkinnedMesh && meta.attachments?.[o.name]) pieces.set(o.name, o);
    });
    return { gltf, clips, meta, pieces };
  })();
  return shared;
}

/** A figure's material: region code -> palette colour, one program for all. */
function paletteMaterial(outfit) {
  const o = resolveOutfit(outfit);
  const palette = REGIONS.map((r) => new Color(o[r]));
  const m = new MeshStandardMaterial({ roughness: 0.46, metalness: 0 });
  m.userData.palette = palette;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uPalette = { value: palette };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 color;\nvarying float vRegion;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRegion = color.r;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uPalette[16];\nvarying float vRegion;')
      .replace(
        'vec4 diffuseColor = vec4( diffuse, opacity );',
        'vec4 diffuseColor = vec4( uPalette[ int( clamp( floor( vRegion * 16.0 ), 0.0, 15.0 ) ) ], opacity );'
      );
  };
  m.customProgramCacheKey = () => 'diorama-figure-palette';
  return m;
}

let blobTex = null;
function blob() {
  if (!blobTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    // Contact darkening only: the real shadow comes from the key light.
    grd.addColorStop(0, 'rgba(0,0,0,0.4)');
    grd.addColorStop(0.5, 'rgba(0,0,0,0.16)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    blobTex = new CanvasTexture(c);
  }
  const m = new Mesh(new PlaneGeometry(0.46, 0.46), new MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.016;
  m.renderOrder = 1;
  return m;
}

/** Arc-length parametrised polyline, three.js coordinates ([x, y, z] points). */
export class Path {
  constructor(points) {
    this.pts = points.map((p) => new Vector3(...p));
    this.lens = [];
    this.total = 0;
    for (let i = 0; i < this.pts.length - 1; i++) {
      const l = this.pts[i].distanceTo(this.pts[i + 1]);
      this.lens.push(l);
      this.total += l;
    }
  }

  /** Position and unit tangent at `along` (0..1, wraps). */
  at(along, pos = new Vector3(), tan = new Vector3()) {
    let d = (((along % 1) + 1) % 1) * this.total;
    for (let i = 0; i < this.lens.length; i++) {
      const l = this.lens[i];
      if (d <= l || i === this.lens.length - 1) {
        const t = l ? d / l : 0;
        pos.lerpVectors(this.pts[i], this.pts[i + 1], t);
        tan.subVectors(this.pts[i + 1], this.pts[i]).normalize();
        return { pos, tan };
      }
      d -= l;
    }
    return { pos: pos.copy(this.pts[0]), tan: tan.set(0, 0, 1) };
  }
}

/** three.js strips '.' and other reserved characters from node names. */
const boneName = (n) => n.replace(/[[\].:/]/g, '').replace(/\s/g, '_');

/**
 * One figure from a scene.json cast entry:
 *   { body: 'body_a' | 'body_a+vest', hair?: 'quiff', wear?: ['hat', 'glasses'],
 *     carry?: ['bag'], outfit, clip, path?, along?, at?, face?, phase?, speed?, scale? }
 */
export function makeFigure(people, entry, paths) {
  const root = cloneSkinned(people.gltf.scene);
  const material = paletteMaterial(entry.outfit ?? {});
  const [bodyName, extra] = String(entry.body).split('+');
  const vestName = extra === 'vest' ? `vest_${bodyName.split('_')[1]}` : null;
  const rigid = people.meta.attachments ?? {};
  let mesh = null;
  const drop = [];
  root.traverse((o) => {
    if (o.isSkinnedMesh) {
      if ((o.name === bodyName && !mesh) || o.name === vestName) {
        if (o.name === bodyName) mesh = o;
        o.material = material;
        o.frustumCulled = false; // bounds don't follow the pose
        o.castShadow = true;
      } else drop.push(o);
    } else if (o.isMesh && rigid[o.name]) {
      drop.push(o); // re-added below, on its bone, if this figure has it
    }
  });
  drop.forEach((o) => o.removeFromParent());
  if (!mesh) throw new Error(`no body ${bodyName} in people.glb`);
  root.updateMatrixWorld(true); // the clone is at rest and at the origin: bone matrices are rest poses

  // Hair and pieces: the shared geometry, placed on the bone with that bone's
  // inverse bind matrix, so each sits exactly where Blender modelled it at
  // rest and moves with the bone from then on.
  const pieces = [entry.hair && `hair_${entry.hair}`, ...(entry.wear ?? []), ...(entry.carry ?? [])].filter(Boolean);
  for (const name of pieces) {
    const src = people.pieces.get(name);
    const bone = mesh.skeleton.getBoneByName(boneName(rigid[name] ?? ''));
    if (!src || !bone) continue;
    const m = new Mesh(src.geometry, material);
    // In the figure's own space, at rest: the piece where Blender put it (its
    // node matrix also carries meshopt's dequantisation), seen from the bone.
    // Not the skin's inverse bind matrices: those absorb the body's own
    // quantisation, which is not the piece's.
    src.updateMatrix();
    new Matrix4().copy(bone.matrixWorld).invert().multiply(src.matrix).decompose(m.position, m.quaternion, m.scale);
    m.castShadow = false; // the body's shadow is enough; hair and pieces would double the pass
    m.name = name;
    bone.add(m);
  }
  if (entry.scale) root.scale.setScalar(entry.scale);

  const shadow = blob();
  root.add(shadow);

  // The head turns toward what the person is looking at, on top of whatever
  // the clip does: undone before each mixer update, so it never accumulates.
  const head = mesh.skeleton.getBoneByName('head');
  const lookQ = new Quaternion();
  const undoQ = new Quaternion();
  const up = new Vector3(0, 1, 0);
  let lookYaw = 0;
  let lookWant = 0;
  // The shoulders turn to squeeze past someone (the chest about the spine);
  // the head turns back by as much, so the gaze stays where it was.
  const chest = mesh.skeleton.getBoneByName('chest');
  const twistQ = new Quaternion();
  let twistYaw = 0;
  let twistWant = 0;

  const mixer = new AnimationMixer(root);
  const actions = new Map();
  const action = (name) => {
    if (!actions.has(name)) {
      const c = people.clips.get(name);
      if (!c) throw new Error(`no clip ${name}`);
      const a = mixer.clipAction(c);
      // A fall and a getting-up happen once and hold their last pose.
      if (people.meta.clips?.[name]?.loop === false) {
        a.setLoop(LoopOnce, 1);
        a.clampWhenFinished = true;
      } else a.setLoop(LoopRepeat, Infinity);
      actions.set(name, a);
    }
    return actions.get(name);
  };
  let current = action(entry.clip);
  current.play();
  // Arms in: weighted over the clip (0, not at all, while there's room).
  const armsIn = people.clips.has('arms_in') ? mixer.clipAction(people.clips.get('arms_in')) : null;
  let tuckK = 0;
  let tuckWant = 0;
  if (armsIn) {
    armsIn.setLoop(LoopRepeat, Infinity);
    armsIn.setEffectiveWeight(0);
    armsIn.play();
  }
  // Start exactly at the poster's pose.
  current.time = (entry.phase ?? 0) * current.getClip().duration;

  const path = entry.path ? new Path(paths[entry.path]) : null;
  const stride = people.meta.walkStride ?? 1.0;
  const walkSecs = people.clips.get('walk')?.duration ?? 1.07;
  let along = entry.along ?? 0;
  const pos = new Vector3();
  const tan = new Vector3();
  if (path) {
    path.at(along, pos, tan);
    root.position.copy(pos);
    root.rotation.y = Math.atan2(tan.x, tan.z);
  } else if (entry.at) {
    root.position.set(entry.at[0], 0, entry.at[2]);
    root.rotation.y = ((entry.face ?? 0) * Math.PI) / 180;
  }

  return {
    root,
    mesh,
    material,
    contact: shadow,
    get along() {
      return along;
    },
    get clip() {
      return current.getClip().name;
    },
    play(name, fade = 0.3) {
      const next = action(name);
      if (next === current) return;
      next.reset().setEffectiveTimeScale(1).play();
      current.crossFadeTo(next, fade, false);
      current = next;
    },
    /**
     * Fade the whole figure (body, hair, what they carry, contact shadow):
     * 0 gone, 1 solid. Used only inside portals, so nobody pops in or out.
     */
    setFade(k) {
      const see = k < 0.999;
      if (material.transparent !== see) {
        material.transparent = see;
        material.needsUpdate = true;
      }
      material.opacity = k;
      shadow.material.opacity = (shadow.userData.base ??= shadow.material.opacity) * k;
      mesh.castShadow = k > 0.5;
    },
    /** Playback rate of the current clip (the crowd paces the walk by speed). */
    setTimeScale(s) {
      current.setEffectiveTimeScale(s);
    },
    /** Head yaw (radians, relative to the body), eased toward. */
    look(yaw) {
      lookWant = Math.max(-0.9, Math.min(0.9, yaw));
    },
    /** Shoulders turned (radians about the spine, relative to the hips), eased toward. */
    twist(yaw) {
      twistWant = Math.max(-0.6, Math.min(0.6, yaw));
    },
    /** Arms held in, 0 (swinging freely) to 1 (hands together in front, most of the way), eased toward. */
    tuck(k) {
      tuckWant = Math.max(0, Math.min(1, k));
    },
    update(dt) {
      // Undo last frame's additions before the clip poses the bones again.
      if (head && lookYaw - twistYaw) head.quaternion.multiply(undoQ.setFromAxisAngle(up, -(lookYaw - twistYaw)));
      if (chest && twistYaw) chest.quaternion.multiply(undoQ.setFromAxisAngle(up, -twistYaw));
      if (armsIn) {
        tuckK += (tuckWant - tuckK) * (1 - Math.exp(-dt * 8));
        if (tuckK < 1e-3) tuckK = 0;
        // Blended with the clip by weight, w / (1 + w) of the way to the held
        // arms: three quarters at half a tuck, all but a little at a full one.
        armsIn.setEffectiveWeight(12 * tuckK * tuckK);
      }
      mixer.update(dt);
      lookYaw += (lookWant - lookYaw) * (1 - Math.exp(-dt * 5));
      twistYaw += (twistWant - twistYaw) * (1 - Math.exp(-dt * 6));
      if (Math.abs(lookYaw) < 1e-3) lookYaw = 0;
      if (Math.abs(twistYaw) < 1e-3) twistYaw = 0;
      if (chest && twistYaw) chest.quaternion.multiply(twistQ.setFromAxisAngle(up, twistYaw));
      if (head && lookYaw - twistYaw) head.quaternion.multiply(lookQ.setFromAxisAngle(up, lookYaw - twistYaw));
      if (path && current.getClip().name === 'walk') {
        // The distance one walk cycle covers, over the time it takes.
        const speed = (stride / walkSecs) * (entry.speed ?? 1) * current.getEffectiveTimeScale();
        along += (speed * dt) / path.total;
        path.at(along, pos, tan);
        root.position.copy(pos);
        const want = Math.atan2(tan.x, tan.z);
        let dy = want - root.rotation.y;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        root.rotation.y += dy * Math.min(1, dt * 8); // turn corners, don't snap
      }
    },
    /** Seconds left in a one-shot clip (0 once it has finished, or for a loop). */
    get remaining() {
      const c = current.getClip();
      return current.loop === LoopOnce ? Math.max(0, c.duration - current.time) : 0;
    },
    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
      // Each clone has its own skeleton, and three keeps its bones in a GPU
      // texture that only skeleton.dispose() releases.
      root.traverse((o) => o.isSkinnedMesh && o.skeleton.dispose());
      material.dispose();
      shadow.geometry.dispose();
      shadow.material.dispose();
    },
  };
}
