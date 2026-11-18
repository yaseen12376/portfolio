/**
 * A piece's dust, live (Mission Builder's solar arrays): the render's own
 * formula (scripts/blender/pieces/mission-builder-3d.py, _dust_material), on
 * the same sheets, from the same two maps (a grime scan's grain and its
 * patches), with every number from scene.json's piece.dust, so the jar shows
 * what its loop shows.
 *
 * Each array's brush waits, parked, while dust settles, then sweeps once
 * round. Where it has just passed the cells show, nearly clean (5 per cent,
 * the game's cleaner stopping), with its bristles' arcs; from there the dust
 * builds again, in patches and grains, to 35 per cent by the time the brush
 * comes round. Ahead of a sweeping brush, a ridge of what it pushes.
 *
 * The clip turns the brushes (the export keyed each sweep to start and end on
 * a key); the dust reads each brush's own turn off its pivot every frame, so
 * the clean edge is always under the bristles, and where in its cycle each
 * array is from the clip's time.
 */
import { Color, Matrix4, MeshStandardMaterial, RepeatWrapping } from 'three';

const TAU = Math.PI * 2;
const n = (v) => {
  const s = String(+v);
  return s.includes('.') || s.includes('e') ? s : `${s}.0`;
};

/** The formula, as the render has it (its constants written in). */
function fragment(d) {
  const lk = d.look;
  const rings = lk.rings.map(([a, k, ph]) => `s += ${n(a)} * sin(r * ${n(TAU * k)} + ${n(ph)});`).join('\n\t\t');
  return /* glsl */ `
	{
		vec2 q = vec2(vDustHub.x, -vDustHub.z);
		float r = length(q);
		float p = fract((atan(q.y, q.x) - ${n(Math.PI / 2)}) / ${n(TAU)});
		float passed = 1.0 - step(uDustArm, p);
		float wp = ${n(d.sweep)} * (0.5 - sin(asin(clamp(1.0 - 2.0 * p, -1.0, 1.0)) / 3.0));
		float tau = clamp(uDustW - wp + 1.0 - passed, 0.0, 1.0);
		float level = ${n(d.min)} + ${n(d.max - d.min)} * tau;
		vec2 st = q / ${n(d.tile)} + uDustShift;
		float patches = texture2D(uDustMottle, st).r;
		float grain = texture2D(uDustGrain, st).r;
		float s = 0.5;
		${rings}
		float ring = clamp(s, 0.0, 1.0);
		float fresh = exp(-tau / ${n(lk.streak[2])});
		float streak = (ring * ${n(lk.streak[1])} + ${n(lk.streak[0] - 1)}) * fresh + 1.0;
		float dd = level * (patches * ${n(lk.patch[1])} + ${n(lk.patch[0])}) * (grain * ${n(lk.grain[1])} + ${n(lk.grain[0])}) * streak;
		float ahead = (1.0 - passed) * uDustSweep;
		float past = max((p - uDustArm) * r * ${n(TAU)} - ${n(d.brush)}, 0.0);
		float ridge = ahead * exp(-past / ${n(lk.ridge[1])});
		dd += ridge * (patches * ${n(lk.ridge[3])} + ${n(lk.ridge[2])}) * ${n(lk.ridge[0])};
		float film = 1.0 - exp(-pow(max(dd, 0.0), ${n(lk.film[1])}) * ${n(lk.film[0])});
		float speck = smoothstep(${n(lk.speck[0])}, ${n(lk.speck[1])}, grain) * min(level * ${n(lk.speck[3])} + ${n(lk.speck[2])}, ${n(lk.speck[4])});
		diffuseColor.rgb = mix(uDustC0, uDustC1, grain);
		diffuseColor.a = 1.0 - (1.0 - film) * (1.0 - speck);
	}`;
}

/**
 * @param {object} o
 * @param {Map<string, import('three').Object3D>} o.byName  the stage's objects by name
 * @param {object} o.dust   scene.json's piece.dust
 * @param {{ grain: import('three').Texture, mottle: import('three').Texture }} o.maps
 * @param {(m: import('three').Material) => void} [o.prepare]  what the stage does to a live material (its shadow filter)
 */
export function pieceDust({ byName, dust, maps, prepare }) {
  for (const t of [maps.grain, maps.mottle]) {
    t.wrapS = t.wrapT = RepeatWrapping;
    t.needsUpdate = true;
  }
  const c0 = new Color(dust.colors[0]);
  const c1 = new Color(dust.colors[1]);
  const body = fragment(dust);
  const sheets = [];
  for (const s of dust.sheets) {
    const mesh = byName.get(s.mesh);
    const pivot = byName.get(s.pivot);
    if (!mesh?.isMesh || !pivot?.parent) continue;
    const u = {
      uDustW: { value: 0 },
      uDustArm: { value: 1 },
      uDustSweep: { value: 0 },
      uDustShift: { value: s.shift },
      uDustGrain: { value: maps.grain },
      uDustMottle: { value: maps.mottle },
      uDustC0: { value: c0 },
      uDustC1: { value: c1 },
      // The sheet's own space to the hub's (the lander's metres and axes,
      // its origin the brush's pivot): fixed, both ride the turntable.
      uDustToHub: { value: new Matrix4() },
    };
    const m = new MeshStandardMaterial({
      name: `dust:${s.mesh}`,
      roughness: 0.95,
      metalness: 0,
      transparent: true,
      depthWrite: false,
      // A hair above the cells (0.7 mm): never behind them, however far.
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform mat4 uDustToHub;\nvarying vec3 vDustHub;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvDustHub = (uDustToHub * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nuniform sampler2D uDustGrain;\nuniform sampler2D uDustMottle;\nuniform vec2 uDustShift;\nuniform float uDustW;\nuniform float uDustArm;\nuniform float uDustSweep;\nuniform vec3 uDustC0;\nuniform vec3 uDustC1;\nvarying vec3 vDustHub;'
        )
        .replace('#include <color_fragment>', `#include <color_fragment>${body}`);
    };
    m.customProgramCacheKey = () => 'piece-dust';
    prepare?.(m);
    const old = mesh.material;
    mesh.material = m;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    sheets.push({ s, mesh, pivot, u, m, old });
  }

  const hub = new Matrix4();
  /** Where each sheet's points are from its hub: once, with the scene posed. */
  const place = () => {
    for (const { mesh, pivot, u } of sheets) {
      mesh.updateWorldMatrix(true, false);
      pivot.parent.updateWorldMatrix(true, false);
      hub.makeTranslation(pivot.position.x, pivot.position.y, pivot.position.z).premultiply(pivot.parent.matrixWorld);
      u.uDustToHub.value.copy(hub).invert().multiply(mesh.matrixWorld);
    }
  };
  place();

  return {
    materials: sheets.map((x) => x.m),
    /** The clip's phase (0..1): each array's cycle, and its brush's turn as the clip has it. */
    update(phase) {
      for (const { s, pivot, u } of sheets) {
        const t = phase - s.offset - dust.start;
        const w = t - Math.floor(t);
        let arm = 1;
        const sweeping = w < dust.sweep;
        if (sweeping) {
          const x = w / dust.sweep;
          const e = x * x * (3 - 2 * x);
          const q = pivot.quaternion;
          let a = (2 * Math.atan2(q.y, q.w)) / TAU;
          a -= Math.floor(a);
          // Read off a turn, a whole one either side of the ease's is the same pose.
          if (a - e > 0.5) a -= 1;
          else if (e - a > 0.5) a += 1;
          arm = Math.min(1, Math.max(0, a));
        }
        u.uDustW.value = w;
        u.uDustArm.value = arm;
        u.uDustSweep.value = sweeping ? 1 : 0;
      }
    },
    /** QA: each sheet's cycle (0 as its sweep starts), its brush's turn so far (1 parked), and whether it sweeps. */
    state: () => sheets.map(({ s, u }) => ({ mesh: s.mesh, w: +u.uDustW.value.toFixed(4), arm: +u.uDustArm.value.toFixed(4), sweeping: u.uDustSweep.value === 1 })),
    /** The model's own light from round it, as the atlas has it. */
    setEnv(tex) {
      for (const { m } of sheets) {
        m.envMap = tex;
        m.envMapIntensity = 1;
        m.needsUpdate = true;
      }
    },
    dispose() {
      for (const { mesh, m, old } of sheets) {
        if (mesh.material === m) mesh.material = old;
        m.dispose();
      }
    },
  };
}
