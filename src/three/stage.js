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
 */
import {
  Color,
  DirectionalLight,
  Mesh,
  Shape,
  ShapeGeometry,
  ShadowMaterial,
  EquirectangularReflectionMapping,
  MeshBasicMaterial,
  NoColorSpace,
  PMREMGenerator,
  RepeatWrapping,
  SRGBColorSpace,
  Scene,
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
 * @param {{ small?: boolean, signal?: AbortSignal, shadows?: number }} opts  shadows: map size, 0 for none
 */
export async function loadStage(renderer, base, { small = false, signal, shadows = 2048 } = {}) {
  const data = await fetchJSON(`${base}scene.json`, signal);
  const v = `?v=${data.hash ?? '0'}`;
  // The tiled era's photo tiles (shared across scenes, named by content).
  const tileNames = Object.entries(data.materials ?? {}).filter(([, m]) => m.map);
  const [gltf, lightmap, envTex, albedo, ...tileTex] = await Promise.all([
    loader.loadAsync(`${base}scene.glb${v}`),
    texture(`${base}${small ? (data.materials ? 'lightmap-small.webp' : 'lightmap-1k.webp') : 'lightmap.webp'}${v}`, true),
    texture(`${base}env.webp${v}`, true, false),
    data.albedo ? texture(`${base}${small ? 'albedo-2k.webp' : data.albedo}${v}`, true) : null,
    ...tileNames.map(([, m]) => texture(m.map, true)),
  ]);
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
  if (albedo) {
    albedo.channel = 1; // the atlas shares the lightmap's UVs
    albedo.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  }
  const lightIntensity = Math.PI * (data.lightScale ?? 5);

  const root = gltf.scene;
  const byName = new Map();
  const anchors = new Map();
  const disposables = new Set([lightmap, envRT, albedo, ...tileTex]);
  // Every diffuse surface of the set shares one material in the atlas era.
  let bakedMat = null;
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
      const metal = (src.metalness ?? 0) > 0.5;
      const glassy = src.transparent || (src.opacity ?? 1) < 1;
      if (tiled.has(src.name)) return tiled.get(src.name);
      if (data.materials && src.name === 'flat') {
        flatMat ??= new MeshBasicMaterial({ name: 'flat', vertexColors: true, lightMap: lightmap, lightMapIntensity: lightIntensity });
        disposables.add(flatMat);
        return flatMat;
      }
      if (albedo && (src.name === 'baked' || src.userData?.baked)) {
        // Colour from the atlas (photo detail and all) x Cycles' light.
        bakedMat ??= new MeshBasicMaterial({ name: 'baked', map: albedo, lightMap: lightmap, lightMapIntensity: lightIntensity });
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
    o.castShadow = role === 'dyn';
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
    light.position.copy(new Vector3(...l.dir).normalize().multiplyScalar(-10));
    light.target.position.set(0, 0, 0);
    scene.add(light, light.target);
    return light;
  });
  const key = lights[0];
  let catcher = null;
  if (shadows && key) catcher = shadowRig(scene, key, data, shadows);
  // The shadow map is a render target (colour and depth) the light owns.
  if (catcher) disposables.add(catcher.geometry).add(catcher.material).add(key.shadow);

  const dispose = () => {
    for (const r of disposables) r?.dispose?.();
    scene.clear();
  };

  return { scene, root, data, byName, anchors, envMap, key, dispose };
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
