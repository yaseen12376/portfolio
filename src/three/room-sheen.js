/**
 * The room a jar stands in, as its glass, brass and walnut see it: the two
 * tall strips, the window and the warm rim (pieces/_kit.py lights()), each a
 * rectangle of light (scene.json piece.probe). The glass mirrors them sharp
 * (piece-glass.js). The brass and the lacquered walnut catch them blurred by
 * their roughness, as the render shows them, on top of the light they have:
 * the walnut's is baked diffuse only, and the brass's panorama holds the
 * strips clipped to white, a hundredth of their brightness.
 *
 * Two things the render does that a reflection lookup alone would not:
 *  - the glass hides the room from whatever looks through it. Cycles' lights
 *    are invisible through glass (pieces/_kit.py _hide_from_camera), so the
 *    brass trim inside the jar, the rim's inner edge and the walnut behind
 *    the jar mirror none of them.
 *  - the brass mirrors the walnut and the pad right below it. Its panorama
 *    was taken from the middle of the jar, half a metre up, which sees the
 *    rim's own brass where the rim sees the walnut beside it; so a ray that
 *    comes down on the base's top or on the pad, out past the glass, takes
 *    what is there from a map of the set seen from straight above (its baked
 *    light: floorMap()).
 */
import {
  Color,
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  OrthographicCamera,
  Scene,
  ShaderChunk,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
} from 'three';

export const ROOM_LIGHTS = 4;

/** '#rrggbb' as linear light. */
const linear = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));

/**
 * The room's lights (world): centres, unit axes, half sizes and the radiance
 * each sends, in the scene's linear units. Unused slots are far off and dark.
 * `on`: only the lights that fall on that object. The strips that draw the
 * glass are linked to the glassware (glass, rim and trim) and light nothing
 * else, so the walnut never mirrors them (scene.json probe light `on`).
 */
export function roomLights(piece, on = null) {
  const probe = new Vector3(...(piece?.probe?.at ?? [0, 0.3, 0]));
  const lights = (piece?.probe?.lights ?? []).filter((l) => !on || !l.on || l.on.includes(on)).slice(0, ROOM_LIGHTS);
  const pad = (arr, make) => Array.from({ length: ROOM_LIGHTS }, (_, i) => (i < arr.length ? arr[i] : make()));
  const v3 = (a) => new Vector3(...a);
  return {
    pos: pad(lights.map((l) => v3(l.pos).add(probe)), () => new Vector3(0, -100, 0)),
    x: pad(lights.map((l) => v3(l.x).normalize()), () => new Vector3(1, 0, 0)),
    y: pad(lights.map((l) => v3(l.y).normalize()), () => new Vector3(0, 0, 1)),
    half: pad(lights.map((l) => new Vector2(l.size[0] / 2, l.size[1] / 2)), () => new Vector2(1e-3, 1e-3)),
    rad: pad(lights.map((l) => v3(linear(l.color)).multiplyScalar(l.radiance)), () => new Vector3()),
  };
}

const PARS = /* glsl */ `
  #define ROOM_LIGHTS ${ROOM_LIGHTS}
  uniform vec3 roomPos[ROOM_LIGHTS];
  uniform vec3 roomX[ROOM_LIGHTS];
  uniform vec3 roomY[ROOM_LIGHTS];
  uniform vec2 roomHalf[ROOM_LIGHTS];
  uniform vec3 roomRad[ROOM_LIGHTS];
  // The glass: world to its own frame (origin the middle of its foot, y up),
  // and its outer radius and straight wall (x 0: no glass).
  uniform mat4 roomJar;
  uniform vec2 roomJarDim;
  varying vec3 vRoomPos;
  varying vec3 vRoomN;

  // Whether a ray from p along d (the glass's frame) goes through the glass:
  // its straight wall, or the dome over it.
  bool roomThroughGlass(vec3 p, vec3 d) {
    float R = roomJarDim.x;
    float h = roomJarDim.y;
    float a = dot(d.xz, d.xz);
    if (a > 1e-6) {
      float b = dot(p.xz, d.xz);
      float disc = b * b - a * (dot(p.xz, p.xz) - R * R);
      if (disc > 0.0) {
        float s = sqrt(disc);
        vec2 t = vec2(max((-b - s) / a, 0.0), (-b + s) / a);
        // Inside the wall's circle for t in that span: within its height for any of it?
        vec2 y = p.y + d.y * t;
        if (t.y > t.x && max(y.x, y.y) >= 0.0 && min(y.x, y.y) <= h) return true;
      }
    }
    vec3 o = p - vec3(0.0, h, 0.0);
    float b2 = dot(o, d);
    float disc2 = b2 * b2 - (dot(o, o) - R * R);
    if (disc2 > 0.0) {
      float s = sqrt(disc2);
      vec2 t = vec2(max(-b2 - s, 0.0), -b2 + s);
      vec2 y = p.y + d.y * t;
      if (t.y > t.x && max(y.x, y.y) >= h) return true;
    }
    return false;
  }

  // A box of half-width 1, seen through a blur of half-width w, at u.
  float roomBox(float u, float w) {
    return max(0.0, min(1.0, u + w) - max(-1.0, u - w)) / (2.0 * w);
  }
  // How much a rough surface turns back of what reaches it (Karis's fit).
  vec3 roomBRDF(vec3 f0, float rough, float NoV) {
    vec4 r = rough * vec4(-1.0, -0.0275, -0.572, 0.022) + vec4(1.0, 0.0425, 1.04, -0.04);
    float a004 = min(r.x * r.x, exp2(-9.28 * NoV)) * r.x + r.y;
    vec2 ab = vec2(-1.04, 1.04) * a004 + r.zw;
    return f0 * ab.x + ab.y;
  }
  // The room's lights in a surface's reflection: each rectangle where the
  // mirror ray meets its plane, blurred by about the width of the surface's
  // lobe there (GGX's, roughness squared, both ways round the ray), never
  // sharper than a pixel. Off that, GGX's long tail: the lobe's own value
  // toward the rectangle's nearest point, times how big the rectangle looks.
  // None that the ray would see through the glass.
  vec3 roomSheen(vec3 P, vec3 N, vec3 V, float rough, vec3 f0) {
    vec3 R = reflect(-V, N);
    float open = roomJarDim.x > 0.0 && roomThroughGlass((roomJar * vec4(P, 1.0)).xyz, mat3(roomJar) * R) ? 0.0 : 1.0;
    float NoV = clamp(dot(N, V), 1e-4, 1.0);
    float a2 = max(rough * rough, 2e-3);
    a2 *= a2;
    vec3 dfg = roomBRDF(f0, rough, NoV);
    float spread = 1.5 * rough * rough;
    vec3 sum = vec3(0.0);
    for (int i = 0; i < ROOM_LIGHTS; i++) {
      // Lights face the jar along -(x cross y): a ray meets the lit face
      // travelling against that (along x cross y).
      vec3 n = cross(roomX[i], roomY[i]);
      float den = dot(R, n);
      float t = dot(roomPos[i] - P, n) / max(den, 1e-4);
      vec3 h = P + R * t - roomPos[i];
      float u = dot(h, roomX[i]) / roomHalf[i].x;
      float v = dot(h, roomY[i]) / roomHalf[i].y;
      float b = t * spread;
      float au = min(fwidth(u), 0.25) + 1e-3;
      float av = min(fwidth(v), 0.25) + 1e-3;
      float core = step(1e-4, den) * step(0.0, t) * roomBox(u, max(b / roomHalf[i].x, au)) * roomBox(v, max(b / roomHalf[i].y, av));
      // The tail: toward the rectangle's point nearest where the ray points
      // (its middle, for a ray turned away from it).
      vec2 q = den > 1e-4 && t > 0.0 ? clamp(vec2(u, v), -1.0, 1.0) : vec2(0.0);
      vec3 Lv = roomPos[i] + roomX[i] * (q.x * roomHalf[i].x) + roomY[i] * (q.y * roomHalf[i].y) - P;
      float d2 = max(dot(Lv, Lv), 1e-4);
      vec3 L = Lv * inversesqrt(d2);
      vec3 H = normalize(L + V);
      float NoH = max(dot(N, H), 0.0);
      float k = NoH * NoH * (a2 - 1.0) + 1.0;
      float D = a2 / (PI * k * k);
      // (Seen from its lit side: toward the light is along x cross y, as
      // the ray above meets it. Taken the other way round, as it was, this
      // was nothing for every light, and the brass had no tail at all.)
      float solid = 4.0 * roomHalf[i].x * roomHalf[i].y * max(dot(L, n), 0.0) / d2;
      vec3 F = f0 + (1.0 - f0) * pow(1.0 - max(dot(V, H), 0.0), 5.0);
      vec3 tail = F * (D * solid * step(0.0, dot(N, L)) / (4.0 * NoV));
      sum += roomRad[i] * (core * dfg + (1.0 - core) * min(tail, dfg));
    }
    return sum * open;
  }

  #ifdef ROOM_FLOOR
  // The flats below the brass, the base's top and the pad (each its height
  // and radius), the glass's outer radius (inside it, the panorama's own
  // view holds), and the map of them from above: its middle (x, z), one over
  // its width, and its texel (m).
  uniform vec4 roomFloors;
  uniform float roomFloorIn;
  uniform vec4 roomFloorBox;
  uniform sampler2D roomFloorMap;

  // What a reflection ray from P comes down on out past the glass, the base's
  // top or the pad, blurred by the width of the lobe where it lands (a: 1 if
  // it does).
  vec4 roomFloor(vec3 P, vec3 R, float rough) {
    if (R.y > -1e-3) return vec4(0.0);
    float t = (roomFloors.x - P.y) / R.y;
    vec2 H = P.xz + R.xz * t;
    float r2 = dot(H, H);
    if (t < 0.0 || r2 > roomFloors.y * roomFloors.y) {
      t = (roomFloors.z - P.y) / R.y;
      H = P.xz + R.xz * t;
      if (t < 0.0 || dot(H, H) > roomFloors.w * roomFloors.w) return vec4(0.0);
    } else if (r2 < roomFloorIn * roomFloorIn) return vec4(0.0);
    vec2 uv = vec2(0.5 + (H.x - roomFloorBox.x) * roomFloorBox.z, 0.5 - (H.y - roomFloorBox.y) * roomFloorBox.z);
    float lod = log2(max(t * 1.5 * rough * rough / roomFloorBox.w, 1.0));
    return vec4(textureLod(roomFloorMap, uv, lod).rgb, 1.0);
  }
  #endif
`;

const VERT = /* glsl */ `
  vRoomPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vRoomN = normalize(mat3(modelMatrix) * normal);
`;

// three's panorama lookup for reflections, with what comes down on the flats
// taken from the map of them instead.
const LOOKUP = /(vec4 envMapColor = textureCubeUV\( envMap, envMapRotation \* reflectVec, roughness \);)\s*return envMapColor\.rgb \* envMapIntensity;/;
const ENV_FLOOR = ShaderChunk.envmap_physical_pars_fragment.replace(
  LOOKUP,
  '$1\n\t\t\tvec4 roomFl = roomFloor( vRoomPos, reflectVec, roughness );\n\t\t\treturn mix( envMapColor.rgb * envMapIntensity, roomFl.rgb, roomFl.a );'
);
if (ENV_FLOOR === ShaderChunk.envmap_physical_pars_fragment) console.warn('room-sheen: the panorama lookup has changed; the brass mirrors the floor as the panorama sees it');

/**
 * The set as seen from straight above, its baked light and gloss and all
 * (linear, as the frame has it before the tone curve), for the brass to
 * mirror: an orthographic view `half` metres each way from the middle of the
 * jar. `meshes`: the set's baked meshes (colour x light, unlit), drawn with
 * their own materials.
 */
export function floorMap(renderer, meshes, { half = 0.78, size = 512 } = {}) {
  const target = new WebGLRenderTarget(size, size, {
    type: HalfFloatType,
    generateMipmaps: true,
    minFilter: LinearMipmapLinearFilter,
    magFilter: LinearFilter,
  });
  const scene = new Scene();
  for (const o of meshes) {
    const c = new Mesh(o.geometry, o.material);
    o.updateWorldMatrix(true, false);
    c.matrixAutoUpdate = false;
    c.matrix.copy(o.matrixWorld);
    scene.add(c);
  }
  // Looking straight down: the map's right is +x, its up -z.
  const cam = new OrthographicCamera(-half, half, half, -half, 0.5, 8);
  cam.position.set(0, 4, 0);
  cam.up.set(0, 0, -1);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  const was = renderer.getRenderTarget();
  const clear = renderer.getClearColor(new Color());
  const alpha = renderer.getClearAlpha();
  renderer.setRenderTarget(target);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, cam);
  renderer.setRenderTarget(was);
  renderer.setClearColor(clear, alpha);
  return { texture: target.texture, half, texel: (2 * half) / size, dispose: () => target.dispose() };
}

// The glass's glow on a rough surface inside it (addGlassGlow): after three's
// GGX, so the lights are weighed by the surface's own lobe, as its direct
// light is.
const GLOW_PARS = /* glsl */ `
  #define GLOW_LIGHTS ${ROOM_LIGHTS}
  uniform vec3 glowPos[GLOW_LIGHTS];
  uniform vec3 glowX[GLOW_LIGHTS];
  uniform vec3 glowY[GLOW_LIGHTS];
  uniform vec2 glowHalf[GLOW_LIGHTS];
  uniform vec3 glowRad[GLOW_LIGHTS];
  uniform vec3 glowSpotL;
  uniform vec3 glowSpot;
  // x: how much of the lights at roughness 1, y: the roughness it starts
  // from, z: how much of the glass is down (1 on the brass, 0 lifted clear),
  // w: how much of the spot at roughness 1.
  uniform vec4 glowK;
  varying vec3 vGlowPos;

  vec3 glassGlow(vec3 P, vec3 N, vec3 V, PhysicalMaterial material) {
    float w = glowK.z * smoothstep(glowK.y, 1.0, material.roughness);
    if (w <= 0.0) return vec3(0.0);
    vec3 R = reflect(-V, N);
    vec3 sum = vec3(0.0);
    for (int i = 0; i < GLOW_LIGHTS; i++) {
      // Each rectangle from its point nearest the mirror ray (its middle for
      // a ray turned away from it), times how big it looks from here.
      vec3 n = cross(glowX[i], glowY[i]);
      float den = dot(R, n);
      float t = dot(glowPos[i] - P, n) / max(den, 1e-4);
      vec3 h = P + R * t - glowPos[i];
      vec2 q = den > 1e-4 && t > 0.0 ? clamp(vec2(dot(h, glowX[i]) / glowHalf[i].x, dot(h, glowY[i]) / glowHalf[i].y), -1.0, 1.0) : vec2(0.0);
      vec3 Lv = glowPos[i] + glowX[i] * (q.x * glowHalf[i].x) + glowY[i] * (q.y * glowHalf[i].y) - P;
      float d2 = max(dot(Lv, Lv), 1e-4);
      vec3 L = Lv * inversesqrt(d2);
      float solid = 4.0 * glowHalf[i].x * glowHalf[i].y * max(dot(L, n), 0.0) / d2;
      sum += glowRad[i] * (saturate(dot(N, L)) * solid) * BRDF_GGX(L, V, N, material);
    }
    sum *= glowK.x;
    sum += glowK.w * glowSpot * saturate(dot(N, glowSpotL)) * BRDF_GGX(glowSpotL, V, N, material);
    return sum * w;
  }
`;

/**
 * What the render's glass gives a rough surface inside it: the room's lights
 * and the spot, in the surface's own lobe, as if the glass passed them on.
 *
 * In Cycles none of the strips falls on the model (they are linked to the
 * glassware), and the spot's light reaches it once, through glass that is
 * clear to shadow rays. Yet in every poster a dark disc under the dome reads
 * as a pale floor: a rough surface's glossy rays meet the glass, Cycles'
 * glossy blur (render_piece.py, blur_glossy 0.5) roughens the glass for a
 * ray that comes off a rough bounce, and rough glass takes the light of
 * every lamp it is linked to and passes it on. Rendered with that blur off,
 * or with the disc's gloss off, the floor is dark, as it is here without
 * this. A sharp surface keeps the glass sharp and gets none of it.
 *
 * Measured on ObserveX's disc (build/qa/band_cal.py): the strips' share
 * comes to about a third of the surface's own GGX response to them at
 * roughness 0.5 to 0.65, and half at 0.94; the spot's grows from a sixth of
 * its direct gloss at 0.5 to as much again at 0.94. Here, a weight for
 * each, the strips' `k` and the spot's `kSpot`, from nothing at roughness
 * `from` to all of it at 1 (the model's roughness is the atlas's times 1.3,
 * stage.js), unshadowed but for the model's own occlusion (its atlas's R),
 * and fading as the glass is lifted (set()). Fitted to ObserveX's disc
 * alone they came to 0.1 and 2, which left Mission Builder's jar, its rough
 * ground square to the spot, brighter than its poster (tone dE 3.9). Of the
 * nine pairs tried on all ten jars against their posters
 * (build/qa/glowprobe.mjs), 0.06 and 1.5 is the one that keeps every jar
 * within tone dE 3.
 *
 * @param {Iterable<import('three').MeshStandardMaterial>} materials the model's, sharing these uniforms
 * @param {ReturnType<typeof roomLights>} room every light the glass takes (roomLights(piece))
 * @param {{ dir: import('three').Vector3, color: import('three').Color }} spot
 *   the direction toward the spot and its irradiance (the key light's colour
 *   x intensity, linear)
 */
export function addGlassGlow(materials, room, spot, { k = 0.06, kSpot = 1.5, from = 0.4 } = {}) {
  const uniforms = {
    glowPos: { value: room.pos },
    glowX: { value: room.x },
    glowY: { value: room.y },
    glowHalf: { value: room.half },
    glowRad: { value: room.rad },
    glowSpotL: { value: spot.dir.clone().normalize() },
    glowSpot: { value: new Vector3(spot.color.r, spot.color.g, spot.color.b) },
    glowK: { value: new Vector4(k, from, 1, kSpot) },
  };
  for (const material of materials) {
    const before = material.onBeforeCompile;
    const beforeKey = material.customProgramCacheKey;
    material.onBeforeCompile = (shader, renderer) => {
      before.call(material, shader, renderer);
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGlowPos;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvGlowPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>\n${GLOW_PARS}`).replace(
        '#include <opaque_fragment>',
        `{
          #ifdef USE_AOMAP
          float glowAO = ambientOcclusion;
          #else
          float glowAO = 1.0;
          #endif
          // (The shading normal, turned to face the eye on a sheet's back.)
          vec3 glowN = normalize(inverseTransformDirection(normal, viewMatrix));
          outgoingLight += glowAO * glassGlow(vGlowPos, glowN, normalize(cameraPosition - vGlowPos), material);
        }
        #include <opaque_fragment>`
      );
    };
    material.customProgramCacheKey = () => `${beforeKey.call(material)}|glass-glow`;
    material.needsUpdate = true;
  }
  return {
    uniforms,
    /** How much of the glass is down: 1 on the brass, 0 lifted clear. */
    set(down) {
      uniforms.glowK.value.z = down;
    },
  };
}

/**
 * Give a material the room's lights in its reflection.
 *  - A physically lit one (the brass) uses its own roughness and specular
 *    colour, and what its reflections come down on below it, out past the
 *    glass, is taken from the map of the set from above (`floors`).
 *  - An unlit one (the baked set, colour x baked light) takes them per vertex
 *    from its first UVs, where the export put them (u roughness, v ten times
 *    F0; nothing where u is 0: bake_scene.py, a set object's `sheen`).
 *
 * @param {{ jar?: { toJar: { value: import('three').Matrix4 }, r: number, h: number } | null,
 *           floors?: { map: ReturnType<typeof floorMap>, base: [number, number], pad: [number, number], inner: number } | null }} [opts]
 *   jar: the glass, whose frame (shared with the glass, so it follows the
 *   lift) hides the room from what looks through it.
 */
export function addRoomSheen(material, room, { jar = null, floors = null } = {}) {
  const lit = !!material.isMeshStandardMaterial;
  const uniforms = {
    roomPos: { value: room.pos },
    roomX: { value: room.x },
    roomY: { value: room.y },
    roomHalf: { value: room.half },
    roomRad: { value: room.rad },
    roomJar: jar?.toJar ?? { value: new Matrix4() },
    roomJarDim: { value: new Vector2(jar ? jar.r : 0, jar ? jar.h : 0) },
  };
  if (floors) {
    Object.assign(uniforms, {
      roomFloors: { value: new Vector4(floors.base[0], floors.base[1], floors.pad[0], floors.pad[1]) },
      roomFloorIn: { value: floors.inner },
      roomFloorBox: { value: new Vector4(0, 0, 1 / (2 * floors.map.half), floors.map.texel) },
      roomFloorMap: { value: floors.map.texture },
    });
  }
  // After any patch the material has already (a piece's set: its gloss).
  const before = material.onBeforeCompile;
  const beforeKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vRoomPos;\nvarying vec3 vRoomN;\n${lit ? '' : 'varying vec2 vRoomSheen;'}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${VERT}${lit ? '' : 'vRoomSheen = uv;'}`);
    const add = lit
      ? 'outgoingLight += roomSheen(vRoomPos, normalize(vRoomN), normalize(cameraPosition - vRoomPos), material.roughness, material.specularColorBlended);'
      : 'if (vRoomSheen.x > 0.01) outgoingLight += roomSheen(vRoomPos, normalize(vRoomN), normalize(cameraPosition - vRoomPos), vRoomSheen.x, vec3(vRoomSheen.y * 0.1));';
    const floor = lit && floors;
    let frag = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${floor ? '#define ROOM_FLOOR\n' : ''}${PARS}${lit ? '' : 'varying vec2 vRoomSheen;'}`)
      .replace('#include <opaque_fragment>', `${add}\n#include <opaque_fragment>`);
    if (floor) frag = frag.replace('#include <envmap_physical_pars_fragment>', ENV_FLOOR);
    shader.fragmentShader = frag;
  };
  // Its own program (the patch changes the source, not the material's settings).
  material.customProgramCacheKey = () => `${beforeKey.call(material)}|room-sheen-${lit ? 'lit' : 'baked'}${floors ? '-floors' : ''}`;
  material.needsUpdate = true;
}
