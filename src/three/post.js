/**
 * The miniature look, live: the same treatment scripts/build-3d.mjs applies to
 * the posters (miniature()), so a poster and the scene that replaces it match.
 *
 *   1. The scene renders into a multisampled HDR target (linear light).
 *   2. It is downsampled to half size and blurred (separable Gaussian).
 *   3. A composite mixes sharp and soft by SCREEN HEIGHT (a sharp band at
 *      `focus`, soft above and below: real tilt-shift works on the image
 *      plane, so no depth buffer is needed), lifts saturation a touch,
 *      vignettes, tone maps (Khronos PBR Neutral, as Blender), converts to
 *      sRGB and dithers against banding on the near-black backdrop.
 *
 * Every target is sized to the LARGEST card seen so far and each card renders
 * into its own sub-region (uvScale), so cards of different sizes never force a
 * reallocation per frame.
 */
import {
  BufferAttribute,
  BufferGeometry,
  HalfFloatType,
  LinearFilter,
  Mesh,
  OrthographicCamera,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
} from 'three';

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }`;

const BLUR = /* glsl */ `
  uniform sampler2D tSrc;
  uniform vec2 uvScale;
  uniform vec2 texel;
  uniform vec2 dir;
  varying vec2 vUv;
  // The targets are shared by cards of different sizes: beyond this card's
  // sub-region is another card's stale frame, so never sample past it.
  vec4 tap(vec2 uv) { return texture2D(tSrc, clamp(uv, texel * 0.5, uvScale - texel * 0.5)); }
  void main() {
    vec2 uv = vUv * uvScale;
    // 9-tap Gaussian via 5 bilinear fetches.
    vec4 c = tap(uv) * 0.227027;
    vec2 o1 = dir * texel * 1.384615;
    vec2 o2 = dir * texel * 3.230769;
    c += (tap(uv + o1) + tap(uv - o1)) * 0.316216;
    c += (tap(uv + o2) + tap(uv - o2)) * 0.070270;
    gl_FragColor = c;
  }`;

const COPY = /* glsl */ `
  uniform sampler2D tSrc;
  uniform vec2 uvScale;
  uniform vec2 texel;
  varying vec2 vUv;
  void main() { gl_FragColor = texture2D(tSrc, clamp(vUv * uvScale, texel * 0.5, uvScale - texel * 0.5)); }`;

const COMPOSITE = /* glsl */ `
  uniform sampler2D tSharp;
  uniform sampler2D tSoft;
  uniform vec2 uvSharp;
  uniform vec2 uvSoft;
  uniform vec2 texSharp;
  uniform vec2 texSoft;
  uniform float focus;
  uniform float band;
  uniform float ramp;
  uniform float sat;
  uniform float vignette;
  uniform float blurAmount;
  uniform float bloom;
  uniform float bloomThreshold;
  uniform float cctv;
  uniform float time;
  uniform vec3 backdropA;
  uniform vec3 backdropB;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

  void main() {
    vec4 sharpC = texture2D(tSharp, min(vUv * uvSharp, uvSharp - texSharp * 0.5));
    vec4 softC = texture2D(tSoft, clamp(vUv * uvSoft, texSoft * 0.5, uvSoft - texSoft * 0.5));
    // Screen-space tilt-shift: 0 inside the focus band, easing to 1 outside it.
    float d = max(0.0, abs(vUv.y - focus) - band);
    float k = smoothstep(0.0, ramp, d) * blurAmount;
    vec4 c = mix(sharpC, softC, k);
    // Glow: the bright part of the already-blurred image, added back. Only
    // what is brighter than white (emissive screens, overlay lines) blooms.
    c.rgb += max(softC.rgb - bloomThreshold, 0.0) * bloom;
    // The backdrop the posters are composited on, behind everything.
    float r = distance(vUv, vec2(0.5, 0.54));
    vec3 bg = mix(backdropA, backdropB, smoothstep(0.0, 0.75, r));
    vec3 col = mix(bg, c.rgb, c.a);
    float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(vec3(lum), col, mix(sat, 0.35, cctv));
    // A store camera's picture: flatter colour, a touch of green, sensor grain.
    col = mix(col, col * vec3(0.94, 1.03, 0.96) + (hash(gl_FragCoord.xy + time) - 0.5) * 0.035, cctv);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    // Vignette and dither in display space.
    float v = smoothstep(0.55, 1.05, distance(vUv, vec2(0.5)) * 1.3);
    gl_FragColor.rgb *= 1.0 - v * vignette;
    gl_FragColor.rgb += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
  }`;

function fullscreenTriangle() {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  return g;
}

const bucket = (n) => Math.ceil(n / 64) * 64;

export class Post {
  /** @param {import('three').WebGLRenderer} renderer */
  constructor(renderer, { msaa = 4 } = {}) {
    this.renderer = renderer;
    this.size = new Vector2(0, 0);
    this.msaa = msaa;
    this.quadScene = new Scene();
    this.cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.geo = fullscreenTriangle();
    this.quad = new Mesh(this.geo);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
    const common = { vertexShader: VERT, depthTest: false, depthWrite: false };
    this.copyMat = new ShaderMaterial({
      ...common,
      fragmentShader: COPY,
      uniforms: { tSrc: { value: null }, uvScale: { value: new Vector2(1, 1) }, texel: { value: new Vector2() } },
      toneMapped: false,
    });
    this.blurMat = new ShaderMaterial({
      ...common,
      fragmentShader: BLUR,
      uniforms: { tSrc: { value: null }, uvScale: { value: new Vector2(1, 1) }, texel: { value: new Vector2() }, dir: { value: new Vector2(1, 0) } },
      toneMapped: false,
    });
    this.compMat = new ShaderMaterial({
      ...common,
      fragmentShader: COMPOSITE,
      uniforms: {
        tSharp: { value: null },
        tSoft: { value: null },
        uvSharp: { value: new Vector2(1, 1) },
        uvSoft: { value: new Vector2(1, 1) },
        texSharp: { value: new Vector2() },
        texSoft: { value: new Vector2() },
        focus: { value: 0.5 },
        band: { value: 0.16 },
        ramp: { value: 0.3 },
        sat: { value: 1.06 },
        vignette: { value: 0.3 },
        blurAmount: { value: 1 },
        bloom: { value: 0 },
        bloomThreshold: { value: 1 },
        cctv: { value: 0 },
        time: { value: 0 },
        // Linear versions of the posters' backdrop (#1b1a22 centre, #09090b edge).
        backdropA: { value: [0.0116, 0.0103, 0.0159] },
        backdropB: { value: [0.0027, 0.0027, 0.0033] },
      },
      toneMapped: true,
    });
  }

  ensure(w, h) {
    if (w <= this.size.x && h <= this.size.y) return;
    const W = bucket(Math.max(w, this.size.x));
    const H = bucket(Math.max(h, this.size.y));
    this.disposeTargets();
    const opts = { type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false };
    this.rtScene = new WebGLRenderTarget(W, H, { type: HalfFloatType, samples: this.msaa, depthBuffer: true });
    this.rtA = new WebGLRenderTarget(W / 2, H / 2, opts);
    this.rtB = new WebGLRenderTarget(W / 2, H / 2, opts);
    this.size.set(W, H);
  }

  pass(mat, target, w, h) {
    const r = this.renderer;
    this.quad.material = mat;
    if (target) {
      target.viewport.set(0, 0, w, h);
      target.scissor.set(0, 0, w, h);
      target.scissorTest = true;
    }
    r.setRenderTarget(target);
    if (!target) {
      r.setViewport(0, 0, w, h);
      r.setScissor(0, 0, w, h);
      r.setScissorTest(true);
    }
    r.render(this.quadScene, this.cam);
  }

  /**
   * Render `scene` through `camera` at w x h (device pixels) into the bottom-
   * left w x h of the renderer's own canvas. The caller copies it out.
   */
  render(scene, camera, w, h, params = {}) {
    const r = this.renderer;
    this.ensure(w, h);
    const { x: W, y: H } = this.size;
    const hw = Math.ceil(w / 2);
    const hh = Math.ceil(h / 2);

    // 1. The scene, linear HDR, multisampled.
    this.rtScene.viewport.set(0, 0, w, h);
    this.rtScene.scissor.set(0, 0, w, h);
    this.rtScene.scissorTest = true;
    r.setRenderTarget(this.rtScene);
    r.setClearColor(0x000000, 0);
    r.clear(true, true, false);
    r.render(scene, camera);

    const blur = params.blur !== false && (params.blurAmount ?? 1) > 0;
    if (blur) {
      // 2. Half size, then a separable blur.
      this.copyMat.uniforms.tSrc.value = this.rtScene.texture;
      this.copyMat.uniforms.uvScale.value.set(w / W, h / H);
      this.copyMat.uniforms.texel.value.set(1 / W, 1 / H);
      this.pass(this.copyMat, this.rtA, hw, hh);
      const u = this.blurMat.uniforms;
      u.uvScale.value.set(hw / (W / 2), hh / (H / 2));
      u.texel.value.set(1 / (W / 2), 1 / (H / 2));
      for (const [src, dst, dir] of [[this.rtA, this.rtB, [1, 0]], [this.rtB, this.rtA, [0, 1]], [this.rtA, this.rtB, [1, 0]], [this.rtB, this.rtA, [0, 1]]]) {
        u.tSrc.value = src.texture;
        u.dir.value.set(...dir);
        this.pass(this.blurMat, dst, hw, hh);
      }
    }

    // 3. Composite to the canvas.
    const c = this.compMat.uniforms;
    c.tSharp.value = this.rtScene.texture;
    c.tSoft.value = blur ? this.rtA.texture : this.rtScene.texture;
    c.uvSharp.value.set(w / W, h / H);
    c.uvSoft.value.set(blur ? hw / (W / 2) : w / W, blur ? hh / (H / 2) : h / H);
    c.texSharp.value.set(1 / W, 1 / H);
    c.texSoft.value.set(blur ? 2 / W : 1 / W, blur ? 2 / H : 1 / H);
    c.focus.value = params.focus ?? 0.5;
    c.band.value = params.band ?? 0.16;
    c.ramp.value = params.ramp ?? 0.3;
    c.sat.value = params.sat ?? 1.06;
    c.vignette.value = params.vignette ?? 0.3;
    c.blurAmount.value = blur ? params.blurAmount ?? 1 : 0;
    c.bloom.value = blur ? params.bloom ?? 0 : 0;
    c.bloomThreshold.value = params.bloomThreshold ?? 1;
    c.cctv.value = params.cctv ?? 0;
    c.time.value = (performance.now() / 1000) % 100;
    this.pass(this.compMat, null, w, h);
  }

  disposeTargets() {
    this.rtScene?.dispose();
    this.rtA?.dispose();
    this.rtB?.dispose();
  }

  dispose() {
    this.disposeTargets();
    this.geo.dispose();
    this.copyMat.dispose();
    this.blurMat.dispose();
    this.compMat.dispose();
  }
}
