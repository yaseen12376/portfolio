/**
 * Load one diorama built by scripts/build-3d.mjs (public/3d/<id>/) into a
 * three.js Scene, drawn the way Cycles rendered it (ported from KPS's
 * doorstep3d/stage.ts):
 *
 *  - The set (everything that never moves) is UNLIT here: its material colour
 *    times the light Cycles baked for it (the lightmap, on UV 1). Colour edges
 *    stay sharp; the light is exactly Cycles'.
 *  - Metals, glass, props and moving pieces are lit live, physically: the
 *    scene's own baked panorama for ambient light and reflections, plus the key
 *    light at the angle Blender used. Their crevices carry baked AO (vertex
 *    colour), so nothing floats.
 *  - Khronos PBR Neutral tone mapping on the renderer, matching Blender's view
 *    transform, so the poster and the live scene agree on colour.
 *
 * The renderer is shared by every diorama on the page; this module never sizes
 * or disposes it.
 *
 * A piece (a model under glass, scripts/build-pieces.mjs --stages live) loads
 * the same way, from public/pieces/<id>/live/, with three differences: its
 * model is one atlas (colour, and occlusion, roughness and metalness in one
 * map) lit live; its glass is left for the piece controller to draw; and its
 * shadow is fitted to the room inside the jar.
 */
import {
  Color,
  DirectionalLight,
  DoubleSide,
  Mesh,
  Shape,
  ShapeGeometry,
  ShadowMaterial,
  EquirectangularReflectionMapping,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  PMREMGenerator,
  RepeatWrapping,
  SRGBColorSpace,
  Scene,
  ShaderChunk,
  TextureLoader,
  Vector3,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const textures = new TextureLoader();

export async function fetchJSON(url, signal) {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

async function texture(url, srgb, gltfUV = true) {
  const t = await textures.loadAsync(url);
  t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
  // Baked maps follow glTF's UV convention (row 0 at v = 0).
  if (gltfUV) t.flipY = false;
  return t;
}

/**
 * A piece's set shines as well as taking light: its gloss as the poster's
 * camera saw it (the lacquer catching the brass, the pad mirroring the lit
 * base), baked on the lightmap's UVs and added on top of colour x light.
 */
function addGloss(material, map, scale) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.glossMap = { value: map };
    shader.uniforms.glossScale = { value: scale };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D glossMap;\nuniform float glossScale;')
      .replace('#include <opaque_fragment>', 'outgoingLight += texture2D( glossMap, vLightMapUv ).rgb * glossScale;\n#include <opaque_fragment>');
  };
  material.customProgramCacheKey = () => 'gloss';
}

// The directional lights' loop, each light's highlight kept or dropped (dirGlossy, in three's order).
const DIR_BLOCK = '#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )';
const RE_CALL = 'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';
const LIGHTS_BEGIN = (() => {
  const src = ShaderChunk.lights_fragment_begin;
  const at = src.indexOf(DIR_BLOCK);
  const k = at < 0 ? -1 : src.indexOf(RE_CALL, at);
  if (k < 0) {
    console.warn('stage: the lights loop has changed; every light leaves its highlight');
    return null;
  }
  // In braces: three unrolls the loop into one scope.
  const keep = `{\n\t\tvec3 glossBefore = reflectedLight.directSpecular;\n\t\t${RE_CALL}\n\t\treflectedLight.directSpecular = mix( glossBefore, reflectedLight.directSpecular, dirGlossy[ i ] );\n\t\t}`;
  return src.slice(0, k) + keep + src.slice(k + RE_CALL.length);
})();

/** Drop the highlight of the directional lights `mask` marks 0 (after any patch the material has). */
function diffuseOnly(material, mask) {
  if (!LIGHTS_BEGIN) return;
  const before = material.onBeforeCompile;
  const beforeKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    shader.uniforms.dirGlossy = { value: mask };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n#if NUM_DIR_LIGHTS > 0\nuniform float dirGlossy[ NUM_DIR_LIGHTS ];\n#endif')
      .replace('#include <lights_fragment_begin>', LIGHTS_BEGIN);
  };
  material.customProgramCacheKey = () => `${beforeKey.call(material)}|diffuse-only`;
}

/**
 * A model's faces its baked occlusion says are shut in (nothing open within
 * the bake's reach, live.py AO_DISTANCE: two skins of one part laid face to
 * face, a dish's white front on its dark back) take no direct light either,
 * as in Cycles, where each skin shadows the other. A shadow map is far too
 * coarse to tell them apart, so without this the live lights would light
 * what the render shows dark.
 */
function shutIn(material) {
  const before = material.onBeforeCompile;
  const beforeKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <aomap_fragment>',
      `#include <aomap_fragment>
	#ifdef USE_AOMAP
	{
		float open = smoothstep( 0.02, 0.15, texture2D( aoMap, vAoMapUv ).r );
		reflectedLight.directDiffuse *= open;
		reflectedLight.directSpecular *= open;
	}
	#endif`
    );
  };
  material.customProgramCacheKey = () => `${beforeKey.call(material)}|shut-in`;
}

/**
 * The key light's shadow edged as softly as the render's (Cycles' spot has a
 * size, so a deck a hand above the ground blurs its shadow over a few
 * millimetres): a fixed 4 x 4 grid of filtered taps over shadow.radius
 * texels each way, in place of three's five, turned by a noise per pixel,
 * which at that width leave a dither that nothing here averages away.
 */
const PCF_TAPS = /float phi = interleavedGradientNoise\( gl_FragCoord\.xy \) \* PI2;\s*shadow = \([\s\S]*?\) \* 0\.2;/;
export function softShadow(material) {
  if (!PCF_TAPS.test(ShaderChunk.shadowmap_pars_fragment)) {
    console.warn("stage: three's shadow chunk has changed; its own filter stays");
    return;
  }
  const chunk = ShaderChunk.shadowmap_pars_fragment.replace(
    PCF_TAPS,
    `shadow = 0.0;
				for ( int i = 0; i < 4; i ++ ) {
					for ( int j = 0; j < 4; j ++ ) {
						vec2 o = ( vec2( float( i ), float( j ) ) - 1.5 ) / 1.5;
						shadow += texture( shadowMap, vec3( shadowCoord.xy + o * radius, shadowCoord.z ) );
					}
				}
				shadow *= 1.0 / 16.0;`
  );
  const before = material.onBeforeCompile;
  const beforeKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace('#include <shadowmap_pars_fragment>', chunk);
  };
  material.customProgramCacheKey = () => `${beforeKey.call(material)}|soft-shadow`;
}

/**
 * A mesh with several materials arrives as a group of one child mesh per
 * material, and Blender's custom properties (the role) sit on the group.
 */
function roleOf(o) {
  for (let p = o; p; p = p.parent) if (p.userData?.role) return p.userData.role;
  return 'prop';
}

/**
 * @param {import('three').WebGLRenderer} renderer
 * @param {string} base  e.g. '/3d/retail-analytics/'
 * @param {{ small?: boolean, signal?: AbortSignal, shadows?: number, piece?: boolean, version?: string }} opts
 *   shadows: map size, 0 for none. version: busts the cache of scene.json itself
 *   (a piece's, which vercel.json lets browsers keep for a week like its files).
 */
export async function loadStage(renderer, base, { small = false, signal, shadows = 2048, piece = false, version } = {}) {
  const data = await fetchJSON(`${base}scene.json${version ? `?v=${encodeURIComponent(version)}` : ''}`, signal);
  const v = `?v=${data.hash ?? '0'}`;
  const pc = piece ? data.piece : null;
  // The tiled era's photo tiles (shared across scenes, named by content).
  const tileNames = Object.entries(data.materials ?? {}).filter(([, m]) => m.map);
  // A piece's set maps are 1k already; only its model's colour has a small one.
  const lightmapFile = pc || !small ? 'lightmap.webp' : data.materials ? 'lightmap-small.webp' : 'lightmap-1k.webp';
  // A piece's own maps (Mission Builder's dust: its grain and its patches),
  // grey data on the piece's own coordinates (row 0 at the bottom, as Blender reads it).
  const ownMaps = Object.entries(pc?.dust?.maps ?? {});
  const [gltf, lightmap, envTex, albedo, modelColor, modelOrm, modelEmit, gloss, ...rest] = await Promise.all([
    loader.loadAsync(`${base}scene.glb${v}`),
    texture(`${base}${lightmapFile}${v}`, true),
    texture(`${base}env.webp${v}`, true, false),
    data.albedo ? texture(`${base}${small && !pc ? 'albedo-2k.webp' : data.albedo}${v}`, true) : null,
    pc ? texture(`${base}${small ? pc.model.color.replace(/\.webp$/, '-1k.webp') : pc.model.color}${v}`, true) : null,
    pc ? texture(`${base}${pc.model.orm}${v}`, false) : null,
    pc?.model?.emit ? texture(`${base}${pc.model.emit}${v}`, true) : null,
    pc && data.gloss ? texture(`${base}${data.gloss.file}${v}`, true) : null,
    ...tileNames.map(([, m]) => texture(m.map, true)),
    ...ownMaps.map(([, f]) => texture(`${base}${f}${v}`, false, false)),
  ]);
  const tileTex = rest.slice(0, tileNames.length);
  const maps = Object.fromEntries(ownMaps.map(([k], i) => [k, rest[tileNames.length + i]]));
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError');

  const scene = new Scene();
  scene.background = null;

  // Ambient light and reflections for everything lit live: the scene's own panorama.
  envTex.mapping = EquirectangularReflectionMapping;
  const pmrem = new PMREMGenerator(renderer);
  // Keep the render target: disposing only its texture leaves it on the GPU.
  const envRT = pmrem.fromEquirectangular(envTex);
  const envMap = envRT.texture;
  pmrem.dispose();
  envTex.dispose();
  const envScale = data.env?.scale ?? 2;

  lightmap.channel = 1;
  if (gloss) gloss.channel = 1;
  if (albedo) {
    albedo.channel = 1; // the atlas shares the lightmap's UVs
    albedo.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  }
  const lightIntensity = Math.PI * (data.lightScale ?? 5);

  const root = gltf.scene;
  const byName = new Map();
  const anchors = new Map();
  const disposables = new Set([lightmap, envRT, albedo, modelColor, modelOrm, modelEmit, gloss, ...tileTex, ...Object.values(maps)]);
  // Every diffuse surface of the set shares one material in the atlas era.
  let bakedMat = null;
  // A piece's model: colour, and occlusion (R), roughness (G) and metalness
  // (B) from one map, the way glTF packs them, all on the model's one UV.
  let atlasMat = null;
  for (const t of [modelColor, modelEmit]) if (t) t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  // In the tiled era: flat colour (vertex colours) and one material per photo
  // tile (tint in the vertex colours, the tile on UV 0), all x the light on UV 1.
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const tiled = new Map();
  tileNames.forEach(([name], i) => {
    const t = tileTex[i];
    t.wrapS = t.wrapT = RepeatWrapping;
    t.anisotropy = aniso;
    // Tiles are stored at half value (8 bits hold up to 2x the average): doubled back here.
    tiled.set(name, new MeshBasicMaterial({ name, map: t, color: new Color(2, 2, 2), vertexColors: true, lightMap: lightmap, lightMapIntensity: lightIntensity }));
  });
  tiled.forEach((m) => disposables.add(m));
  let flatMat = null;

  root.traverse((o) => {
    if (o.name) byName.set(o.name, o);
    if (o.userData?.anchor) anchors.set(o.name, o);
    if (!o.isMesh) return;
    const role = roleOf(o);
    const convert = (src) => {
      disposables.add(src);
      // Its maps too, which a material's dispose() leaves on the GPU (a
      // piece's own textured part: KPS Clean-O's grass, two each time its
      // jar was opened).
      for (const v of Object.values(src)) if (v?.isTexture) disposables.add(v);
      const metal = (src.metalness ?? 0) > 0.5;
      const glassy = src.transparent || (src.opacity ?? 1) < 1;
      if (tiled.has(src.name)) return tiled.get(src.name);
      if (modelColor && src.userData?.atlas) {
        atlasMat ??= new MeshStandardMaterial({
          name: 'atlas',
          map: modelColor,
          aoMap: modelOrm,
          roughnessMap: modelOrm,
          metalnessMap: modelOrm,
          // A little rougher than the atlas: it leaves out the borrowed
          // materials' normal maps (a brushed deck's grain), whose fine
          // bumps spread a highlight in Cycles as roughness would. (At 1 the
          // lander's deck takes four fifths of the spot's light the render
          // gives it.)
          roughness: 1.3,
          metalness: 1,
          // The light its faint glows give, where it has any (live.py
          // model_atlas: a screen's dim panels, a watch's hand).
          ...(modelEmit ? { emissiveMap: modelEmit, emissive: 0xffffff } : {}),
          // A model's thin sheets (a solar array's panel) cast whole
          // shadows, as in Cycles; drawn by their back faces only (three's
          // default) a sheet casts none and only its ribs would.
          shadowSide: DoubleSide,
        });
        shutIn(atlasMat);
        softShadow(atlasMat);
        disposables.add(atlasMat);
        return atlasMat;
      }
      if (data.materials && src.name === 'flat') {
        flatMat ??= new MeshBasicMaterial({ name: 'flat', vertexColors: true, lightMap: lightmap, lightMapIntensity: lightIntensity });
        disposables.add(flatMat);
        return flatMat;
      }
      if (albedo && (src.name === 'baked' || src.userData?.baked)) {
        // Colour from the atlas (photo detail and all) x Cycles' light.
        if (!bakedMat) {
          bakedMat = new MeshBasicMaterial({ name: 'baked', map: albedo, lightMap: lightmap, lightMapIntensity: lightIntensity });
          if (gloss) addGloss(bakedMat, gloss, data.gloss.scale);
        }
        disposables.add(bakedMat);
        return bakedMat;
      }
      if (role === 'set' && !metal && !glassy) {
        // Colour x baked light, unlit.
        const m = new MeshBasicMaterial({
          name: src.name,
          color: src.color.clone(),
          map: src.map ?? null,
          lightMap: lightmap,
          lightMapIntensity: lightIntensity,
        });
        disposables.add(m);
        return m;
      }
      // Lit live (scene.environment below): metals keep their reflections;
      // everything else gets the panorama's ambient light as well as the key.
      return src;
    };
    o.material = Array.isArray(o.material) ? o.material.map(convert) : convert(o.material);
    o.userData.role = role;
    // Moving pieces cast live shadows; live-lit props catch the figures'.
    // Nothing clear or glowing casts one (a piece's dust, its signal beads),
    // as in Blender, and its glass neither casts nor takes any.
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const clear = mats.some((m) => m.transparent || (m.opacity ?? 1) < 1);
    // (Not the model's atlas: its glows are faint parts of solid things.)
    const glow = mats.some((m) => m !== atlasMat && m.emissive && (m.emissiveIntensity ?? 1) * Math.max(m.emissive.r, m.emissive.g, m.emissive.b) > 0.5);
    o.castShadow = role === 'dyn' && !(pc && (clear || glow));
    o.receiveShadow = role === 'prop' || role === 'dyn';
    disposables.add(o.geometry);
  });
  scene.add(root);
  // Every physically lit material in the scene, figures included, takes its
  // ambient light and reflections from the scene's own panorama.
  scene.environment = envMap;
  scene.environmentIntensity = envScale;

  // Blender's own lights, for everything lit live: direction, colour and the
  // irradiance each delivers mid-scene (bake_scene.py live_lights()). Up to
  // three; the panorama above supplies the bounce light between them.
  const specs = (data.lights?.length ? data.lights : [data.key ?? { dir: [0, -1, 0], color: '#ffffff', power: 2.2 }]).slice(0, 3);
  const lights = specs.map((l) => {
    const light = new DirectionalLight(new Color(l.color ?? '#ffffff'), l.power ?? 1);
    light.name = l.name ?? '';
    light.position.copy(new Vector3(...l.dir).normalize().multiplyScalar(-10));
    light.target.position.set(0, 0, 0);
    light.userData.glossy = l.glossy !== false;
    scene.add(light, light.target);
    return light;
  });
  const key = lights[0];
  let catcher = null;
  if (shadows && key && pc) {
    roomShadow(key, pc.room, shadows);
    disposables.add(key.shadow);
  } else if (shadows && key) catcher = shadowRig(scene, key, data, shadows);
  // A light that only lights (Blender's fill, never seen in a reflection)
  // leaves no highlight on what is lit live. three orders its directional
  // lights with the shadow casters first.
  if (lights.some((l) => !l.userData.glossy)) {
    const mask = [...lights].sort((a, b) => Number(b.castShadow) - Number(a.castShadow)).map((l) => (l.userData.glossy ? 1 : 0));
    const lit = new Set();
    root.traverse((o) => {
      if (o.isMesh) for (const m of [o.material].flat()) if (m?.isMeshStandardMaterial) lit.add(m);
    });
    for (const m of lit) diffuseOnly(m, mask);
  }
  // The shadow map is a render target (colour and depth) the light owns.
  if (catcher) disposables.add(catcher.geometry).add(catcher.material).add(key.shadow);

  const dispose = () => {
    for (const r of disposables) r?.dispose?.();
    scene.clear();
  };

  return { scene, root, data, byName, anchors, envMap, key, animations: gltf.animations ?? [], maps, dispose };
}

/**
 * A piece's key-light shadow: the orthographic frustum wraps the room inside
 * the jar (the turntable's radius, the clear height above it), whichever way
 * the model is turned, so its texels are spent on the model and nothing else.
 * No catcher: the set under the turntable is out of sight, and the model's
 * own shadow falls on the turntable, which takes it live.
 */
function roomShadow(key, room, size) {
  const c = new Vector3(0, room.y + room.h / 2, 0);
  const radius = Math.hypot(room.r, room.h / 2) + 0.04;
  const dir = key.position.clone().normalize().negate();
  key.position.copy(c).addScaledVector(dir, -6);
  key.target.position.copy(c);
  key.target.updateMatrixWorld();
  key.updateMatrixWorld();
  const cam = key.shadow.camera;
  cam.left = cam.bottom = -radius;
  cam.right = cam.top = radius;
  cam.near = 6 - radius - 0.1;
  cam.far = 6 + radius + 0.1;
  cam.updateProjectionMatrix();
  key.castShadow = true;
  key.shadow.mapSize.set(size, size);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.008;
  // Texels each way the edge is spread over (softShadow): about 2 mm.
  key.shadow.radius = 4;
}

/** A rounded rectangle as a three.js Shape in the floor plane (x, -z). */
function roundedRect(w, d, r) {
  const s = new Shape();
  const x = -w / 2;
  const y = -d / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + d - r);
  s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d);
  s.quadraticCurveTo(x, y + d, x, y + d - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/**
 * The key light's shadow, fitted tightly around the diorama, and an invisible
 * floor that shows only the shadows falling on it (the baked floor is unlit,
 * so it cannot receive them itself). It sits just above the rugs and mats.
 */
function shadowRig(scene, key, data, size) {
  const [lo, hi] = data.view.bounds;
  const c = new Vector3((lo[0] + hi[0]) / 2, 0, (lo[2] + hi[2]) / 2);
  const dir = key.position.clone().normalize().negate();
  key.position.copy(c).addScaledVector(dir, -12);
  key.target.position.copy(c);
  key.target.updateMatrixWorld();
  key.updateMatrixWorld();
  // The box's corners in the light's view space set the orthographic frustum
  // (the shadow camera looks from the light to its target, as three aims it).
  const cam = key.shadow.camera;
  cam.position.copy(key.position);
  cam.lookAt(c);
  cam.updateMatrixWorld();
  const view = cam.matrixWorld.clone().invert();
  const lo3 = new Vector3(Infinity, Infinity, Infinity);
  const hi3 = new Vector3(-Infinity, -Infinity, -Infinity);
  const p = new Vector3();
  for (const x of [lo[0], hi[0]]) {
    for (const y of [Math.max(0, Math.min(lo[1], hi[1])), 1.8]) {
      for (const z of [lo[2], hi[2]]) {
        p.set(x, y, z).applyMatrix4(view);
        lo3.min(p);
        hi3.max(p);
      }
    }
  }
  cam.left = lo3.x - 0.1;
  cam.right = hi3.x + 0.1;
  cam.bottom = lo3.y - 0.1;
  cam.top = hi3.y + 0.1;
  cam.near = Math.max(0.1, -hi3.z - 0.5);
  cam.far = -lo3.z + 0.5;
  cam.updateProjectionMatrix();
  key.castShadow = true;
  key.shadow.mapSize.set(size, size);
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 3;

  const nav = data.nav;
  const w = nav ? nav.w * nav.cell : Math.abs(hi[0] - lo[0]) * 0.9;
  const d = nav ? nav.h * nav.cell : Math.abs(hi[2] - lo[2]) * 0.9;
  const g = new ShapeGeometry(roundedRect(w - 0.04, d - 0.04, 0.14), 6);
  g.rotateX(-Math.PI / 2);
  const catcher = new Mesh(g, new ShadowMaterial({ color: 0x160f1c, opacity: 0.34, depthWrite: false }));
  catcher.position.set(nav ? nav.origin[0] + w / 2 : c.x, 0.014, nav ? nav.origin[1] + d / 2 : c.z);
  catcher.receiveShadow = true;
  catcher.renderOrder = 1;
  catcher.name = 'shadow-catcher';
  scene.add(catcher);
  return catcher;
}
