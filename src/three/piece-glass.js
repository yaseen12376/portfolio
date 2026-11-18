/**
 * A jar's glass, live, drawn the way Cycles drew it in the loop. The walls are
 * thin (11 mm, index 1.17), but the inner wall's faces point outward like the
 * outer wall's (scene.json piece.jar says why), so a ray from the camera
 * enters glass twice on its way in and the jar's whole inside renders as
 * solid glass of index 1.17^2. That is the look: the model magnified and
 * pressed toward the walls, and near the edges the far wall turning light
 * back (beyond the critical angle, all of it) as the dome's warm rim.
 *
 * One pass over the outer surface does it all, per pixel:
 *
 *  - the near wall mirrors the room outside: the window and the two tall
 *    strips (pieces/_kit.py lights()), each traced as the rectangle it is, so
 *    every highlight lands where the render has it. Both of its surfaces
 *    reflect, by the exact Fresnel term (Schlick's overshoots by a third or
 *    more at an index this low).
 *  - the rest goes in, bent, and is followed through the frame drawn so far
 *    (the glass draws last, on a layer of its own, over the scene's resolved
 *    colour and depth: post.js overlay) until it meets the model; what it
 *    meets is what shows. Where it goes on hidden behind something nearer,
 *    into ground the frame cannot show (behind the lander, round behind a
 *    hill), the ground map has it: the inside taken once from straight
 *    above, its colour as lit and its height, the lowest surface that faces
 *    up (captureGround). Where it goes into the ground's side, the cut face
 *    the map has none of, the frame's own view of that face just in front of
 *    there stands in (its bands run level).
 *  - a ray that meets nothing reaches the far wall (its place is worked out
 *    from the jar's own dimensions, wherever the glass is lifted to): part
 *    turns back and shows the inside again (round the outline, most of it:
 *    the dome's warm rim): the ground where that light comes down, from the
 *    ground map, softened as a curved mirror spreads it, or where the map
 *    has no ground, a cube map taken once from the middle of the jar; the
 *    rest leaves. (Both maps turn with the turntable since they were taken.)
 *  - the knob is solid glass of its own, a neck and a ball: its surface
 *    mirrors the room, and through it, bent going in and again coming out,
 *    shows the dome below where that light comes down on it (round its
 *    outline, where it bends most, the warm ring), and the dark elsewhere.
 *
 * The result replaces what the frame had under the glass, premultiplied
 * (post.js composites a piece that way), so where nothing lies behind, the
 * page shows through. The ground map also gives the model its reflections of
 * the ground below it (reflectGround).
 */
import {
  BufferGeometry,
  Color,
  ShaderChunk,
  CubeCamera,
  CustomBlending,
  DepthTexture,
  FrontSide,
  GreaterDepth,
  HalfFloatType,
  LinearMipmapLinearFilter,
  Matrix4,
  OneFactor,
  OrthographicCamera,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
  WebGLCubeRenderTarget,
  WebGLRenderTarget,
  ZeroFactor,
} from 'three';

import { ROOM_LIGHTS, roomLights } from './room-sheen.js';

const MAX_LIGHTS = ROOM_LIGHTS;
/** The glass's own layer: the scene's cameras (and the cube map's) leave it out. */
export const GLASS_LAYER = 3;
/** What the ground map is taken of: the model on the turntable, and the lights. */
const GROUND_LAYER = 4;
/** How far the far wall's mirror spreads the ground it shows (mip levels of the ground map). */
const GROUND_BLUR = 2.5;

// A model's reflections of the ground below it, from the ground map, where
// the light from round it (a cube taken over the model) has the deck and the
// arrays: PieceGlass.reflectGround.
const ENV_LOOKUP = /(vec4 envMapColor = textureCubeUV\( envMap, envMapRotation \* reflectVec, roughness \);)\s*return envMapColor\.rgb \* envMapIntensity;/;
const ENV_GROUND = ShaderChunk.envmap_physical_pars_fragment.replace(
  ENV_LOOKUP,
  `$1
			#ifdef GROUND_REFLECT
			vec4 grSeen = groundReflect( vGroundPos, reflectVec, roughness );
			return envMapColor.rgb * envMapIntensity * ( 1.0 - grSeen.a ) + grSeen.rgb;
			#else
			return envMapColor.rgb * envMapIntensity;
			#endif`
);
const GROUND_PARS = /* glsl */ `
#ifdef GROUND_REFLECT
uniform sampler2D grMap;
uniform vec4 grBox;
uniform vec3 grProbe;
uniform vec2 grSpin;
uniform vec3 grAt; // the ground's height, the map's texel (world)
varying vec3 vGroundPos;
// Where R from P comes down on the ground (a level at its middle height),
// as the ground map has it there: blurred as far as the surface's roughness
// spreads it, alpha how much of that is ground.
vec4 groundReflect( vec3 P, vec3 R, float rough ) {
	float t = R.y < -1e-3 ? ( grAt.x - P.y ) / R.y : -1.0;
	if ( t < 0.0 ) return vec4( 0.0 );
	vec2 d = P.xz + R.xz * t - grProbe.xz;
	vec2 q = vec2( d.x * grSpin.x - d.y * grSpin.y, d.x * grSpin.y + d.y * grSpin.x );
	vec2 uv = vec2( 0.5 + q.x * grBox.x, 0.5 - q.y * grBox.x );
	float lod = log2( max( t * 1.5 * rough * rough / grAt.y, 1.0 ) );
	return textureLod( grMap, uv, lod );
}
#endif
`;

const VERT = /* glsl */ `
  varying vec3 vPos;
  varying vec3 vNormal;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vPos = w.xyz;
    // (The node's scale is uniform: quantization keeps it so.)
    vNormal = mat3(modelMatrix) * normal;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const frag = (steps) => /* glsl */ `
  #define N_LIGHTS ${MAX_LIGHTS}
  #define STEPS ${steps}
  #define REFINE 5
  uniform float eta;          // each surface's index
  // The room outside: rectangles (centre, unit axes, half sizes) and the
  // radiance each sends, in the scene's linear units.
  uniform vec3 lPos[N_LIGHTS];
  uniform vec3 lX[N_LIGHTS];
  uniform vec3 lY[N_LIGHTS];
  uniform vec2 lHalf[N_LIGHTS];
  uniform vec3 lRad[N_LIGHTS];
  // The inside from its middle: the cube map, where it was taken, the room
  // it shows (radius, ground height; about the turntable's axis) and how far
  // the turntable has turned since (cos, sin).
  uniform samplerCube inside;
  uniform vec3 probe;
  uniform vec2 room;
  uniform vec2 spin;
  // The ground inside from above, taken with the cube map (so turned with
  // it too): its colour as lit, and its height, the lowest of what faces up
  // (the ground under the lander, not the deck over it). groundBox: 1 over
  // the map's width (world), its camera's height, near, and far - near.
  uniform sampler2D groundMap;
  uniform sampler2D groundDepth;
  uniform vec4 groundBox;
  // 1 while the glass stands on its base, 0 while it is lifted.
  uniform float down;
  // The frame drawn so far: colour (premultiplied) and depth, in the part
  // of their target this frame fills (uvScale), w x h pixels (res).
  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform vec2 uvScale;
  uniform mat4 viewProj;
  uniform vec2 clipNF;
  uniform vec2 res;
  // Where there is anything to meet (world): a box round all of it but the
  // glass (the turntable's part as it turns), the top of what stands inside
  // the jar, and a box round what stands outside it.
  uniform vec3 boxMin;
  uniform vec3 boxMax;
  uniform float innerTop;
  uniform vec3 outMin;
  uniform vec3 outMax;
  // The jar: world to its own frame (origin the middle of the glass's
  // foot, y up) and back, and its inner radius, straight wall and wall.
  uniform mat4 toJar;
  uniform mat4 fromJar;
  uniform vec3 jar;
  // The knob on top (the jar's frame): where its neck starts, its ball's
  // middle (on the axis) and radius, and the neck's radius.
  uniform vec4 knob;
  // How finely rays are followed (setQuality): pixels a step on screen, the
  // most steps a march takes, and the steps through the ground map.
  uniform vec3 marching;
  varying vec3 vPos;
  varying vec3 vNormal;

  // Unpolarised Fresnel reflectance into index n (n < 1: out of glass;
  // past the critical angle it is 1).
  float fresnel(float c, float n) {
    float s2 = (1.0 - c * c) / (n * n);
    float t = sqrt(max(0.0, 1.0 - s2));
    float rs = (c - n * t) / (c + n * t);
    float rp = (n * c - t) / (n * c + t);
    return 0.5 * (rs * rs + rp * rp);
  }
  // Two surfaces one behind the other, light going back and forth between.
  float pair(float r1, float r2) {
    return r1 > 0.9999 ? 1.0 : r1 + (1.0 - r1) * (1.0 - r1) * r2 / max(1e-4, 1.0 - r1 * r2);
  }

  // How much of a pixel a rectangle covers, along one of its axes (x its
  // coordinate, inside below 1): 1 inside, 0 outside, the share between.
  // A strip far thinner than a pixel, as round the knob, still shows, as
  // the render's many samples a pixel show it. (The width is capped: where
  // a ray turns parallel to a light the coordinate leaps.)
  float inside1(float x) {
    float w = clamp(fwidth(x), 1e-4, 8.0);
    return clamp((min(x + w, 1.0) - max(x - w, -1.0)) / (2.0 * w), 0.0, 1.0);
  }

  vec3 outsideLight(vec3 P, vec3 R) {
    vec3 L = vec3(0.0);
    for (int i = 0; i < N_LIGHTS; i++) {
      // Lights face the jar along -(x cross y); a ray reaches the lit face
      // when it travels against that.
      vec3 n = cross(lX[i], lY[i]);
      float den = dot(R, n);
      float t = dot(lPos[i] - P, n) / max(den, 1e-4);
      vec3 h = P + R * t - lPos[i];
      float u = abs(dot(h, lX[i])) / lHalf[i].x;
      float v = abs(dot(h, lY[i])) / lHalf[i].y;
      float hit = step(1e-4, den) * step(0.0, t);
      L += lRad[i] * (hit * inside1(u) * inside1(v));
    }
    return L;
  }

  vec4 insideLight(vec3 P, vec3 R) {
    // Where the ray meets the room: the cylinder's far side, or the ground.
    vec2 p = P.xz;
    vec2 r = R.xz;
    float a = max(dot(r, r), 1e-5);
    float b = dot(p, r);
    float c = dot(p, p) - room.x * room.x;
    float t = (-b + sqrt(max(b * b - a * c, 0.0))) / a;
    if (R.y < -1e-4) t = min(t, (room.y - P.y) / R.y);
    vec3 d = P + R * max(t, 0.0) - probe;
    // Back to where the model stood when the map was taken.
    d = vec3(d.x * spin.x - d.z * spin.y, d.y, d.x * spin.y + d.z * spin.x);
    // Soft: the far wall is a curved mirror, which spreads what it shows.
    return textureCubeLodEXT(inside, d, 2.5);
  }


  // The frame's depth (0..1) at a place on screen (0..1), and a depth as
  // view z (negative ahead).
  float depthAt(vec2 uv) { return texture2D(tDepth, uv * uvScale).x; }
  float viewZ(float d) { return clipNF.x * clipNF.y / ((clipNF.y - clipNF.x) * d - clipNF.y); }

  // Where a place inside the jar (world x, z) is on the ground map: turned
  // back to where the turntable stood when the map was taken.
  vec2 groundUV(vec2 xz) {
    vec2 d = xz - probe.xz;
    vec2 q = vec2(d.x * spin.x - d.y * spin.y, d.x * spin.y + d.y * spin.x);
    return vec2(0.5 + q.x * groundBox.x, 0.5 - q.y * groundBox.x);
  }
  // The ground's height there, or far below where the map has none.
  float groundAt(vec2 uv) {
    float d = textureLod(groundDepth, uv, 0.0).x;
    return d > 0.0 ? groundBox.y - groundBox.z - d * groundBox.w : -1e3;
  }
  // Where a ray first goes under the ground, within span: the ground's colour
  // there as the map has it (alpha 1), or nothing. For what the frame cannot
  // show: ground hidden behind the lander, or round behind the hills. A ray
  // that goes in by the ground's side instead (its cut face, which the map,
  // taken from above, has none of) gives where (xyz) and alpha -1.
  vec4 groundHit(vec3 p, vec3 d, vec2 span) {
    float dt = (span.y - span.x) / marching.z;
    float t0 = span.x;
    for (int i = 1; i <= 32; i++) {
      if (float(i) > marching.z) break;
      float t = span.x + dt * float(i);
      vec3 q = p + d * t;
      if (q.y < groundAt(groundUV(q.xz))) {
        float lo = t0;
        float hi = t;
        for (int k = 0; k < 6; k++) {
          float m = 0.5 * (lo + hi);
          vec3 qm = p + d * m;
          if (qm.y < groundAt(groundUV(qm.xz))) hi = m;
          else lo = m;
        }
        vec3 g = p + d * hi;
        vec2 uv = groundUV(g.xz);
        // Come down onto the top, it is at the ground's height there; in by
        // the side, well under it.
        if (groundAt(uv) - g.y > 0.006 + abs(d.y) * dt / 32.0) return vec4(g, -1.0);
        return vec4(textureLod(groundMap, uv, 0.0).rgb, 1.0);
      }
      t0 = t;
    }
    return vec4(0.0);
  }

  // What the far wall turns back shows: the ground where that light comes
  // down inside the jar (or, if it meets the wall first, by the wall below
  // there: it runs on round the wall, glancing off it, and comes down by
  // it), as the ground map has it, softened as a curved mirror spreads it.
  // (The cube map along R where the map has no ground.)
  vec4 groundLight(vec3 P, vec3 R) {
    float tg = R.y < -1e-3 ? (room.y - P.y) / R.y : 1e3;
    vec3 G = P + R * tg;
    if (dot(G.xz, G.xz) > 0.7 * room.x * room.x) {
      // To the wall: where the ray meets the cylinder just inside the glass.
      vec2 p = P.xz;
      vec2 r = R.xz;
      float a = max(dot(r, r), 1e-5);
      float b = dot(p, r);
      float t = (-b + sqrt(max(b * b - a * (dot(p, p) - room.x * room.x), 0.0))) / a;
      vec2 w = p + r * min(t, max(tg, 0.0));
      G = vec3(w / max(length(w), 1e-4) * (0.84 * room.x), room.y).xzy;
    }
    vec4 g = textureLod(groundMap, groundUV(G.xz), ${GROUND_BLUR.toFixed(2)});
    return g + insideLight(P, R) * (1.0 - g.a);
  }

  // The part of the ray p + d t, t within span, inside the box (none: x >= y).
  vec2 clipBox(vec3 p, vec3 d, vec3 lo, vec3 hi, vec2 span) {
    vec3 s = sign(d);
    vec3 inv = (s + (1.0 - abs(s))) / max(abs(d), vec3(1e-6));
    vec3 ta = (lo - p) * inv;
    vec3 tb = (hi - p) * inv;
    vec3 tn = min(ta, tb);
    vec3 tf = max(ta, tb);
    return vec2(max(span.x, max(tn.x, max(tn.y, tn.z))), min(span.y, min(tf.x, min(tf.y, tf.z))));
  }

  // The first surface in the frame that a ray from p along d meets within
  // span: xy its place on screen, z 1 if it met one. It steps out until a
  // step goes from in front of the frame's surface to behind it, then
  // halves that step down to where it crossed. Where it really went in, it
  // ends on the surface; where it ends well behind it, it only passed behind
  // something thin (a bead, a strut) and goes on. A ray that ends hidden
  // behind the frame's surface went where the frame cannot show: where it
  // passed closest behind the surface on its last stretch out of sight
  // stands in, if that was close; if not, z is 2 and xy is where it went out
  // of sight, for the caller to look further (the ground map). (In clip
  // space a point on the ray moves in a straight line, and its w is its
  // distance ahead.)
  vec3 march(vec3 p, vec3 d, vec2 span, float jitter) {
    if (span.y <= span.x) return vec3(0.0);
    vec4 c0 = viewProj * vec4(p, 1.0);
    vec4 cd = viewProj * vec4(d, 0.0);
    vec4 ca = c0 + cd * span.x;
    vec4 cb = c0 + cd * span.y;
    // About a pixel and a half a step on screen, so nothing small is
    // stepped over (coarser where the GPU cannot keep up: setQuality).
    float n = clamp(ceil(length((cb.xy / cb.w - ca.xy / ca.w) * 0.5 * res) / marching.x), 6.0, min(marching.y, float(STEPS)));
    float dt = (span.y - span.x) / n;
    // A ray can cross a small thing (a bead) within one step: it counts if
    // it ends no further behind it than one step goes in depth.
    float tol = 0.004 + abs(cd.w) * dt;
    float t0 = span.x;
    bool front = true;
    vec2 near = vec2(-1.0);
    float nearBy = 1e9;
    vec2 seen = vec2(-1.0); // where it was last in front of the surface
    for (int i = 0; i < STEPS; i++) {
      if (float(i) >= n) break;
      float t = span.x + dt * (float(i) + jitter);
      vec4 c = c0 + cd * t;
      vec3 s = c.xyz / c.w * 0.5 + 0.5;
      if (s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0) break;
      float sd = depthAt(s.xy);
      bool behind = sd < s.z;
      if (behind) {
        // How far behind the surface it is here (view z).
        float by = viewZ(sd) + c.w;
        if (front || by < nearBy) {
          nearBy = by;
          near = s.xy;
        }
      } else {
        seen = s.xy;
      }
      if (behind && front) {
        float lo = t0;
        float hi = t;
        for (int k = 0; k < REFINE; k++) {
          float m = 0.5 * (lo + hi);
          vec4 cm = c0 + cd * m;
          vec3 sm = cm.xyz / cm.w * 0.5 + 0.5;
          if (depthAt(sm.xy) < sm.z) hi = m;
          else lo = m;
        }
        vec4 ch = c0 + cd * hi;
        vec2 uv = ch.xy / ch.w * 0.5 + 0.5;
        if (viewZ(depthAt(uv)) + ch.w < tol) return vec3(uv, 1.0);
      }
      front = !behind;
      t0 = t;
    }
    if (front) return vec3(0.0);
    if (nearBy < 0.025) return vec3(near, 1.0);
    // (Hidden from its first step, by the ground's own edge: that edge.)
    return vec3(seen.x >= 0.0 ? seen : near, 2.0);
  }

  // How far a ray from p (the jar's frame) goes before the far side of the
  // jar's inside: the straight wall or the dome over it. 1e3 if it leaves by
  // the open foot instead.
  float exitT(vec3 p, vec3 d) {
    float r = jar.x;
    float h = jar.y;
    float t = 1e3;
    float a = dot(d.xz, d.xz);
    if (a > 1e-6) {
      float b = dot(p.xz, d.xz);
      float c = dot(p.xz, p.xz) - r * r;
      float disc = b * b - a * c;
      if (disc > 0.0) {
        float tw = (-b + sqrt(disc)) / a;
        float y = p.y + d.y * tw;
        if (tw > 0.0 && y >= 0.0 && y <= h) t = tw;
      }
    }
    vec3 o = p - vec3(0.0, h, 0.0);
    float b2 = dot(o, d);
    float disc2 = b2 * b2 - (dot(o, o) - r * r);
    if (disc2 > 0.0) {
      float ts = -b2 + sqrt(disc2);
      if (ts > 0.0 && p.y + d.y * ts > h) t = min(t, ts);
    }
    return t;
  }

  // The jar seen along -V where that meets its outer surface, at P (N the
  // normal there, facing V): the room in the near wall's two surfaces, and
  // through them, bent as glass of index eta^2, the inside, then the far
  // wall. Premultiplied, with how much it covers of what lies behind.
  vec4 jarAt(vec3 P, vec3 N, vec3 V) {
    float c0 = clamp(dot(N, V), 1e-4, 1.0);
    vec3 pj = (toJar * vec4(P, 1.0)).xyz;
    // The near wall: two surfaces, each mirroring the room.
    float r1 = fresnel(c0, eta);
    float c1 = sqrt(max(0.0, 1.0 - (1.0 - c0 * c0) / (eta * eta)));
    float rNear = pair(r1, fresnel(c1, eta));
    vec3 L = outsideLight(P, reflect(-V, N)) * rNear;
    float tNear = 1.0 - rNear;

    // On into the inside.
    vec3 T = refract(-V, N, 1.0 / (eta * eta));
    vec3 dj = mat3(toJar) * T;
    float tOut = exitT(pj, dj);
    float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    // Inside, only as far down as anything stands; out by the open foot
    // (the glass lifted), wherever anything is.
    vec2 span = tOut < 1e2
      ? clipBox(P, T, boxMin, vec3(boxMax.x, innerTop, boxMax.z), vec2(0.0, tOut))
      : clipBox(P, T, boxMin, boxMax, vec2(0.0, 1.6));
    vec3 hit = march(P, T, span, jit);
    vec4 seen = vec4(0.0);
    bool met = hit.z > 0.5 && hit.z < 1.5;
    if (met) {
      seen = texture2D(tColor, hit.xy * uvScale);
    } else if (hit.z > 1.5) {
      // Hidden where it ended: into ground the frame cannot show (behind the
      // lander, round behind a hill), as the ground map has it; in by the
      // ground's side, the cut face as the frame shows it just in front of
      // there (its bands run level, so they match); or down the gap between
      // the ground and the wall to the turntable (it leaves by the foot, and
      // the glass stands on its base), what it went out of sight behind.
      // (Down the gap to the far wall, the far wall; lifted, a ray out by
      // the open foot that ends hidden lets the frame show through.)
      seen = groundHit(P, T, span);
      met = seen.a > 0.5;
      if (seen.a < -0.5) {
        vec4 cg = viewProj * vec4(seen.xyz, 1.0);
        seen = texture2D(tColor, (cg.xy / cg.w * 0.5 + 0.5) * uvScale);
        met = true;
      } else if (!met && tOut > 1e2 && down > 0.5 && P.y + T.y * span.y < room.y) {
        seen = texture2D(tColor, hit.xy * uvScale);
        met = true;
      }
    }
    if (!met && tOut < 1e2) {
      // The far wall: out through two surfaces, each turning some light back
      // (and all of it past the critical angle).
      vec3 E = P + T * tOut;
      vec3 q = pj + dj * tOut;
      vec3 nj = q.y > jar.y ? normalize(q - vec3(0.0, jar.y, 0.0)) : normalize(vec3(q.x, 0.0, q.z));
      vec3 No = normalize(mat3(fromJar) * nj);
      float cf = clamp(dot(T, No), 1e-4, 1.0);
      float s2 = (1.0 - cf * cf) * eta * eta;
      float rFar = s2 >= 1.0 ? 1.0 : pair(fresnel(cf, 1.0 / eta), fresnel(sqrt(1.0 - s2), 1.0 / eta));
      // What it turns back sees the inside again (groundLight): round the
      // outline, where most of it turns back, the dome's warm rim. (Where
      // only a few per cent does, the render shows nothing: a veil of the
      // lit ground over the whole dome would be this model's alone.)
      seen = groundLight(E, reflect(T, No)) * (rFar * smoothstep(0.06, 0.3, rFar));
      if (rFar < 0.999) {
        vec3 T2 = refract(T, -No, eta * eta);
        // Out of the jar (it is convex: nothing inside it is met again).
        vec3 h2 = march(E, T2, clipBox(E, T2, outMin, outMax, vec2(0.0, 1.2)), jit);
        if (h2.z > 0.5 && h2.z < 1.5) seen += texture2D(tColor, h2.xy * uvScale) * (1.0 - rFar);
      }
    }
    return vec4(L + seen.rgb * tNear, 1.0 - tNear * (1.0 - seen.a));
  }

  void main() {
    vec3 V = normalize(cameraPosition - vPos);
    vec3 N = normalize(vNormal);
    N = dot(N, V) < 0.0 ? -N : N;
    vec3 P = vPos;
    vec3 pj = (toJar * vec4(vPos, 1.0)).xyz;
    // The knob, its neck and ball, is solid glass of its own: the room in
    // its surface, and through it, bent going in and again coming out, the
    // dome below where that comes down on it (round its outline, where it
    // bends most: the warm ring), or the dark.
    vec3 front = vec3(0.0);
    float pass = 1.0;
    bool on = true;
    if (pj.y > knob.x) {
      vec3 v = normalize(mat3(toJar) * V);
      vec3 n = normalize(mat3(toJar) * N);
      float r1 = fresnel(clamp(dot(n, v), 1e-4, 1.0), eta);
      front = outsideLight(vPos, reflect(-V, N)) * r1;
      vec3 d = refract(-v, n, 1.0 / eta);
      // Across to its far side: the ball's, or the neck's.
      vec3 x;
      vec3 nx;
      if (pj.y > knob.y - sqrt(max(knob.z * knob.z - knob.w * knob.w, 0.0))) {
        vec3 o = pj - vec3(0.0, knob.y, 0.0);
        float b = dot(o, d);
        x = pj + d * (-b + sqrt(max(b * b - dot(o, o) + knob.z * knob.z, 0.0)));
        nx = normalize(x - vec3(0.0, knob.y, 0.0));
      } else {
        float a = max(dot(d.xz, d.xz), 1e-6);
        float b = dot(pj.xz, d.xz);
        x = pj + d * ((-b + sqrt(max(b * b - a * (dot(pj.xz, pj.xz) - knob.w * knob.w), 0.0))) / a);
        nx = normalize(vec3(x.x, 0.0, x.z));
      }
      float r2 = fresnel(clamp(dot(d, nx), 1e-4, 1.0), 1.0 / eta);
      vec3 e = refract(d, -nx, eta);
      // (A sphere or a cylinder turns nothing back inside; its facets might.)
      if (dot(e, e) < 0.5) e = d;
      pass = (1.0 - r1) * (1.0 - r2);
      // Down onto the dome?
      vec3 oc = x - vec3(0.0, jar.y, 0.0);
      float R = jar.x + jar.z;
      float b = dot(oc, e);
      float disc = b * b - (dot(oc, oc) - R * R);
      float td = -b - sqrt(max(disc, 0.0));
      vec3 q = x + e * td;
      on = disc > 0.0 && td > 0.0 && q.y > jar.y;
      P = (fromJar * vec4(q, 1.0)).xyz;
      N = normalize(mat3(fromJar) * (q - vec3(0.0, jar.y, 0.0)));
      V = -normalize(mat3(fromJar) * e);
    }
    vec4 seen = vec4(0.0);
    if (on) seen = jarAt(P, N, V);
    gl_FragColor = vec4(front + seen.rgb * pass, 1.0 - pass * (1.0 - seen.a));
  }`;

const _v = new Vector3();
const _w = new Vector3();
const _p = new Vector3();
const _c = new Vector3();
const _cj = new Vector3();
const _n = new Vector3();
const _d = new Vector3();
const _dj = new Vector3();
const _m = new Matrix4();

export class PieceGlass {
  /**
   * @param {{ mesh: import('three').Mesh, frame: import('three').Object3D, renderer: import('three').WebGLRenderer,
   *           scene: import('three').Scene, piece: object, small?: boolean }} o
   *   mesh: the glass as loaded (drawn by its outer surface from here on).
   *   frame: the jar's own frame (origin the middle of the glass's foot, y up), moving with the glass.
   *   piece: scene.json's `piece` (jar, probe, room, ior).
   *   ground: the height of the ground inside (what the far wall mirrors is matched against it).
   *   bounds: where there is anything to see (world): { min, max } round all but the glass,
   *     innerTop, the top of what stands inside it, and { outMin, outMax } round what stands
   *     outside it. Rays search only there.
   *   models: the meshes on the turntable the ground map is taken of (the model and its ground).
   */
  constructor({ mesh, frame, renderer, scene, piece, ground = null, bounds = null, models = [], small = false }) {
    this.renderer = renderer;
    this.scene = scene;
    this.mesh = mesh;
    this.frame = frame;
    this.small = small;
    this.models = models;
    const jar = piece.jar ?? { r: 0.42, wall: 0.011, h: 0.6 };
    this.jar = jar;
    this.eta = piece.ior ?? 1.17;

    // Only the outer surface is drawn: what the inner wall does is in the shader.
    mesh.updateWorldMatrix(true, false);
    frame.updateWorldMatrix(true, false);
    this.geometry = outerSurface(mesh, frame, jar);
    this.source = mesh.geometry;
    mesh.geometry = this.geometry;

    const probe = new Vector3(...(piece.probe?.at ?? [0, jar.h / 2, 0]));
    const room = roomLights(piece);
    this.uniforms = {
      eta: { value: this.eta },
      lPos: { value: room.pos },
      lX: { value: room.x },
      lY: { value: room.y },
      lHalf: { value: room.half },
      lRad: { value: room.rad },
      inside: { value: null },
      probe: { value: probe },
      // The room inside, as the cube map sees it: just within the glass,
      // over the ground the model stands on.
      room: { value: new Vector2(jar.r - 0.002, ground ?? (piece.room?.y ?? 0) + 0.05) },
      spin: { value: new Vector2(1, 0) },
      groundMap: { value: null },
      groundDepth: { value: null },
      groundBox: { value: new Vector4() },
      down: { value: 1 },
      tColor: { value: null },
      tDepth: { value: null },
      uvScale: { value: new Vector2(1, 1) },
      viewProj: { value: new Matrix4() },
      clipNF: { value: new Vector2(0.1, 100) },
      res: { value: new Vector2(1, 1) },
      boxMin: { value: new Vector3(...(bounds?.min ?? [-1e3, -1e3, -1e3])) },
      boxMax: { value: new Vector3(...(bounds?.max ?? [1e3, 1e3, 1e3])) },
      innerTop: { value: bounds?.innerTop ?? 1e3 },
      outMin: { value: new Vector3(...(bounds?.outMin ?? bounds?.min ?? [-1e3, -1e3, -1e3])) },
      outMax: { value: new Vector3(...(bounds?.outMax ?? bounds?.max ?? [1e3, 1e3, 1e3])) },
      toJar: { value: new Matrix4() },
      fromJar: { value: new Matrix4() },
      jar: { value: new Vector3(jar.r, jar.h, jar.wall) },
      knob: { value: knobOf(this.source, mesh, frame, jar) },
      marching: { value: new Vector3() },
    };
    this.setQuality(0);
    mesh.material = new ShaderMaterial({
      name: 'glass',
      vertexShader: VERT,
      fragmentShader: frag(small ? 32 : 64),
      uniforms: this.uniforms,
      side: FrontSide,
      transparent: true,
      depthWrite: false,
      // It replaces what lies under it (premultiplied).
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: ZeroFactor,
      blendSrcAlpha: OneFactor,
      blendDstAlpha: ZeroFactor,
    });
    mesh.renderOrder = 10;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.layers.set(GLASS_LAYER);

    // Drawn over the finished scene, looking through it (post.js).
    const u = this.uniforms;
    this.overlay = {
      layer: GLASS_LAYER,
      prepare: (color, depth, camera, w, h, W, H) => {
        u.tColor.value = color;
        u.tDepth.value = depth;
        u.uvScale.value.set(w / W, h / H);
        u.res.value.set(w, h);
        u.viewProj.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        u.clipNF.value.set(camera.near, camera.far);
      },
    };

    this.cubeTarget = new WebGLCubeRenderTarget(small ? 128 : 256, { type: HalfFloatType, generateMipmaps: true, minFilter: LinearMipmapLinearFilter });
    this.cube = new CubeCamera(0.01, 20, this.cubeTarget);
    this.cube.position.copy(probe);
    this.uniforms.inside.value = this.cubeTarget.texture;
    this.takenAt = 0;

    // The ground map: the inside from straight above, square on the
    // turntable's axis, the lowest surface that faces up winning (its own
    // depth test, GreaterDepth from a clear of 0).
    const size = small ? 256 : 512;
    const half = jar.r + 0.01;
    const top = probe.y + 2;
    const near = 0.1;
    const far = top + 0.5;
    this.groundTarget = new WebGLRenderTarget(size, size, {
      type: HalfFloatType,
      generateMipmaps: true,
      minFilter: LinearMipmapLinearFilter,
      depthTexture: new DepthTexture(size, size),
    });
    this.groundCam = new OrthographicCamera(-half, half, half, -half, near, far);
    this.groundCam.position.set(probe.x, top, probe.z);
    // (Map right is +x, map up is -z: groundUV in the shader.)
    this.groundCam.up.set(0, 0, -1);
    this.groundCam.lookAt(probe.x, 0, probe.z);
    this.groundCam.updateMatrixWorld();
    this.groundCam.layers.set(GROUND_LAYER);
    this.groundMats = new Map();
    // The turntable's top, which the ground stands on.
    this.floor = piece.room?.y ?? jar.y ?? 0;
    for (const m of models) m.layers.enable(GROUND_LAYER);
    u.groundMap.value = this.groundTarget.texture;
    u.groundDepth.value = this.groundTarget.depthTexture;
    u.groundBox.value.set(1 / (2 * half), top, near, far - near);

    // Where the glass stands on its base, to tell when it is lifted.
    frame.updateWorldMatrix(true, false);
    this.rest = frame.matrixWorld.clone();
  }

  /** Take the inside of the jar at turntable angle `angle` (the glass is on a layer the cube leaves out). */
  capture(angle = 0) {
    this.scene.add(this.cube);
    this.cube.update(this.renderer, this.scene);
    this.scene.remove(this.cube);
    this.takenAt = angle;
  }

  /**
   * Take the ground map, as the model is lit now (after its own light from
   * the cube is in: piece.js lightModel), at the angle of the last capture().
   */
  captureGround() {
    if (!this.models.length) return;
    const r = this.renderer;
    const swapped = [];
    for (const o of this.models) {
      swapped.push([o, o.material]);
      o.material = Array.isArray(o.material) ? o.material.map((m) => this.groundMaterial(m)) : this.groundMaterial(o.material);
    }
    this.scene.traverse((o) => {
      if (o.isLight) o.layers.enable(GROUND_LAYER);
    });
    const target = r.getRenderTarget();
    const clear = r.getClearColor(new Color());
    const alpha = r.getClearAlpha();
    const auto = r.autoClear;
    const background = this.scene.background;
    this.scene.background = null;
    r.setRenderTarget(this.groundTarget);
    r.setClearColor(0x000000, 0);
    r.state.buffers.depth.setClear(0);
    r.clear();
    // (Back to 1 before the render: the key light's shadow map is drawn in
    // it, and cleared to 0 it would shadow everything.)
    r.state.buffers.depth.setClear(1);
    r.autoClear = false;
    r.render(this.scene, this.groundCam);
    r.autoClear = auto;
    r.setClearColor(clear, alpha);
    r.setRenderTarget(target);
    this.scene.background = background;
    for (const [o, m] of swapped) o.material = m;
  }

  /**
   * A model's material as the ground map draws it: lit the same, the lowest
   * surface winning, but nothing at the turntable's top or below (the export
   * merges the disc into the model; the ground stands on it).
   */
  groundMaterial(src) {
    let m = this.groundMats.get(src);
    if (!m) {
      m = src.clone();
      m.depthFunc = GreaterDepth;
      const top = this.groundCam.position.y;
      const floor = this.floor + 0.004;
      // Its own patches (the lights that only light: stage.js diffuseOnly) as well.
      const before = src.onBeforeCompile;
      m.onBeforeCompile = (shader, renderer) => {
        before.call(src, shader, renderer);
        shader.fragmentShader = shader.fragmentShader
          .replace('void main() {', `const float groundTop = ${top.toFixed(5)};\nconst float groundFloor = ${floor.toFixed(5)};\nvoid main() {`)
          .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n\tif ( groundTop - vViewPosition.z < groundFloor ) discard;');
      };
      m.customProgramCacheKey = () => `${src.customProgramCacheKey()}|ground-map-${top.toFixed(5)}-${floor.toFixed(5)}`;
      this.groundMats.set(src, m);
    }
    // (Its light from round it comes in after the first capture.)
    if (m.envMap !== src.envMap) {
      m.envMap = src.envMap;
      m.envMapIntensity = src.envMapIntensity;
      m.needsUpdate = true;
    }
    return m;
  }

  /**
   * Let a model's material mirror the ground below it from the ground map
   * (where Cycles had it: a gold foil under the lander's deck shows the
   * shadowed ground round the lander's feet, orange and dark), not from its
   * light from round it, a cube taken over the model, which sees the deck
   * and the arrays from up there. The ground map's own copy of the material
   * leaves it out (it would read the map it draws).
   */
  reflectGround(material) {
    if (!ENV_GROUND.includes('groundReflect')) {
      console.warn('piece-glass: the envmap chunk has changed; no ground in the model');
      return;
    }
    const u = this.uniforms;
    const at = { value: new Vector3(u.room.value.y, 1 / u.groundBox.value.x / this.groundTarget.width, 0) };
    material.defines = { ...(material.defines ?? {}), GROUND_REFLECT: '' };
    const before = material.onBeforeCompile;
    const beforeKey = material.customProgramCacheKey;
    material.onBeforeCompile = (shader, renderer) => {
      before.call(material, shader, renderer);
      Object.assign(shader.uniforms, { grMap: u.groundMap, grBox: u.groundBox, grProbe: u.probe, grSpin: u.spin, grAt: at });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\n#ifdef GROUND_REFLECT\nvarying vec3 vGroundPos;\n#endif')
        .replace('#include <project_vertex>', '#include <project_vertex>\n#ifdef GROUND_REFLECT\n\tvGroundPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\n#endif');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${GROUND_PARS}`)
        .replace('#include <envmap_physical_pars_fragment>', ENV_GROUND);
    };
    material.customProgramCacheKey = () => `${beforeKey.call(material)}|ground-reflect`;
    material.needsUpdate = true;
  }

  /**
   * How finely rays are followed through the frame, by the engine's quality
   * step (engine.js measure): at 2 and over, two and a half pixels or three a
   * step, fewer steps, and a coarser walk through the ground map. Small
   * beads and struts seen through the glass break up a little sooner; the
   * glass costs about half as much.
   */
  setQuality(q) {
    if (q === this.quality) return;
    this.quality = q;
    const [px, steps, ground] = q >= 3 ? [3, 32, 16] : q >= 2 ? [2.5, 40, 20] : [1.5, 64, 32];
    this.uniforms.marching.value.set(this.small ? Math.max(px, 2) : px, steps, ground);
  }

  /** Each frame: where the glass stands, and the turn since the capture. */
  update(angle) {
    const u = this.uniforms;
    this.frame.updateWorldMatrix(true, false);
    u.fromJar.value.copy(this.frame.matrixWorld);
    u.toJar.value.copy(this.frame.matrixWorld).invert();
    const d = angle - this.takenAt;
    u.spin.value.set(Math.cos(d), Math.sin(d));
    const e = this.frame.matrixWorld.elements;
    const rest = this.rest.elements;
    u.down.value = Math.abs(e[13] - rest[13]) < 1e-4 && Math.abs(e[5] - rest[5]) < 1e-5 ? 1 : 0;
  }

  /**
   * Where a point inside the jar shows on screen, seen through the glass
   * (normalized device coordinates, into `out`). A point the camera does not
   * see through the glass is projected straight.
   */
  apparent(point, camera, out) {
    const world = _p.copy(point);
    const target = _w.copy(world).project(camera);
    out.copy(target);
    const toJar = _m.copy(this.frame.matrixWorld).invert();
    const fromJar = this.frame.matrixWorld;
    const cam = camera.getWorldPosition(_c);
    const camJ = _cj.copy(cam).applyMatrix4(toJar);
    const ndc = _n.set(target.x, target.y, 0.5);
    for (let k = 0; k < 6; k++) {
      const dir = _d.copy(ndc).unproject(camera).sub(cam).normalize();
      const hit = enterJar(camJ, _dj.copy(dir).transformDirection(toJar), this.jar);
      if (!hit) return out;
      const p = hit.p.applyMatrix4(fromJar);
      const T = refract(dir, hit.n.transformDirection(fromJar), 1 / (this.eta * this.eta));
      if (!T) return out;
      // The point on the bent ray nearest the target, and how far off it shows.
      const seen = _v.copy(world).sub(p);
      seen.copy(T).multiplyScalar(seen.dot(T)).add(p).project(camera);
      ndc.x += target.x - seen.x;
      ndc.y += target.y - seen.y;
    }
    return out.set(ndc.x, ndc.y, target.z);
  }

  dispose() {
    this.mesh.geometry = this.source;
    this.geometry.dispose();
    this.mesh.material.dispose();
    this.cubeTarget.dispose();
    this.groundTarget.depthTexture.dispose();
    this.groundTarget.dispose();
    for (const m of this.groundMats.values()) m.dispose();
    for (const o of this.models) o.layers.disable(GROUND_LAYER);
    this.mesh.layers.set(0);
  }
}

/** The glass's outer surface: the triangles on or outside the middle of its wall. */
function outerSurface(mesh, frame, jar) {
  const g = mesh.geometry;
  const pos = g.attributes.position;
  const toJar = new Matrix4().copy(frame.matrixWorld).invert().multiply(mesh.matrixWorld);
  const mid = jar.r + jar.wall / 2;
  const outer = new Uint8Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    _v.fromBufferAttribute(pos, i).applyMatrix4(toJar);
    const d = _v.y <= jar.h ? Math.hypot(_v.x, _v.z) : _v.set(_v.x, _v.y - jar.h, _v.z).length();
    outer[i] = d > mid ? 1 : 0;
  }
  const src = g.index ? g.index.array : Array.from({ length: pos.count }, (_, i) => i);
  const keep = [];
  for (let t = 0; t < src.length; t += 3) {
    if (outer[src[t]] && outer[src[t + 1]] && outer[src[t + 2]]) keep.push(src[t], src[t + 1], src[t + 2]);
  }
  const out = new BufferGeometry();
  for (const [k, a] of Object.entries(g.attributes)) out.setAttribute(k, a);
  out.setIndex(keep);
  return out;
}

/**
 * The knob on the dome (pieces/_kit.py _jar_profile: a short solid neck, then
 * a solid ball), from the glass as loaded, in the jar's frame: where the neck
 * starts, the ball's middle (on the axis) and radius, and the neck's radius.
 * The ball is fitted to its vertices above the neck (a circle through them,
 * turned about the axis). None: never (x far above).
 */
function knobOf(geometry, mesh, frame, jar) {
  const pos = geometry.attributes.position;
  const toJar = new Matrix4().copy(frame.matrixWorld).invert().multiply(mesh.matrixWorld);
  const apex = jar.h + jar.r + jar.wall;
  // rho^2 + y^2 = 2 c y + k, by least squares over the ball's vertices.
  let n = 0, sy = 0, syy = 0, sw = 0, syw = 0;
  let neck = Infinity;
  let foot = Infinity;
  const near = [];
  for (let i = 0; i < pos.count; i++) {
    _v.fromBufferAttribute(pos, i).applyMatrix4(toJar);
    const rho = Math.hypot(_v.x, _v.z);
    if (_v.y > apex + 0.03) {
      const w = rho * rho + _v.y * _v.y;
      n++;
      sy += _v.y;
      syy += _v.y * _v.y;
      sw += w;
      syw += _v.y * w;
    } else if (_v.y > apex - 0.002 && rho > 0.005 && rho < 0.04) {
      neck = Math.min(neck, rho);
      near.push(rho, _v.y);
    }
  }
  const den = n * syy - sy * sy;
  if (n < 8 || !Number.isFinite(neck) || Math.abs(den) < 1e-12) return new Vector4(1e3, 0, 0, 0);
  const slope = (n * syw - sy * sw) / den;
  const c = slope / 2;
  const k = (sw - slope * sy) / n;
  const r = Math.sqrt(Math.max(k + c * c, 0));
  for (let i = 0; i < near.length; i += 2) if (Math.abs(near[i] - neck) < 0.002) foot = Math.min(foot, near[i + 1]);
  return new Vector4(foot + 0.0005, c, r, neck);
}

/** Where a ray (the jar's frame) first meets the glass's outer surface, and its normal there. */
function enterJar(o, d, jar) {
  const R = jar.r + jar.wall;
  let best = null;
  const a = d.x * d.x + d.z * d.z;
  if (a > 1e-9) {
    const b = o.x * d.x + o.z * d.z;
    const disc = b * b - a * (o.x * o.x + o.z * o.z - R * R);
    if (disc > 0) {
      const t = (-b - Math.sqrt(disc)) / a;
      const y = o.y + d.y * t;
      if (t > 0 && y >= 0 && y <= jar.h) best = { t, p: o.clone().addScaledVector(d, t) };
      if (best) best.n = new Vector3(best.p.x, 0, best.p.z).normalize();
    }
  }
  const c = new Vector3(0, jar.h, 0);
  const oc = o.clone().sub(c);
  const b2 = oc.dot(d);
  const disc2 = b2 * b2 - (oc.lengthSq() - R * R);
  if (disc2 > 0) {
    const t = -b2 - Math.sqrt(disc2);
    const p = o.clone().addScaledVector(d, t);
    if (t > 0 && p.y > jar.h && (!best || t < best.t)) best = { t, p, n: p.clone().sub(c).normalize() };
  }
  return best;
}

/** GLSL's refract(): null past the critical angle. */
function refract(I, N, eta) {
  const c = -N.dot(I);
  const k = 1 - eta * eta * (1 - c * c);
  if (k < 0) return null;
  return I.clone().multiplyScalar(eta).addScaledVector(N, eta * c - Math.sqrt(k));
}
