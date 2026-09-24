// The frame pipeline: shadows -> G-buffer -> SSAO -> clouds -> deferred lighting -> water ->
// god rays -> TAA -> bloom -> exposure -> tone mapping -> FXAA/upscale.

import { createContext, Program, RenderTarget, createTexture2D, FULLSCREEN_VS, UniformBuffer } from '../engine/gl.js';
import { mat4, Frustum, halton } from '../engine/math.js';
import { gbufferVS, gbufferFS, shadowVS, shadowFS } from './shaders/terrain.js';
import { skyLutFS } from './shaders/sky.js';
import { cloudsFS } from './shaders/clouds.js';
import { lightingFS } from './shaders/lighting.js';
import { waterVS, waterFS } from './shaders/water.js';
import {
  ssaoFS, aoBlurFS, volumetricFS, compositeFS, taaFS, bloomDownFS, bloomUpFS, exposureFS, tonemapFS, finalFS,
} from './shaders/post.js';
import { cloudNoiseFS, weatherFS, waterNormalFS } from './shaders/noisegen.js';
import { outlineVS, outlineFS, particleVS, particleFS, handVS, handFS } from './shaders/overlay.js';
import { precipVS, precipFS } from './shaders/precip.js';
import { transmittance, skyIrradiance, PLANET_RADIUS } from './atmosphere.js';
import { VERTEX_BYTES } from '../world/mesher.js';

const MAX_QUADS = 1 << 18;
const SUN_E = 10.0;
const MOON_E = 0.4;
const SUN_TILT = 0.42; // orbit tilt (radians) so noon shadows are not axis aligned

export const QUALITY_PRESETS = {
  low: { renderScale: 0.75, shadows: true, shadowRes: 1024, shadowDistance: 72, pcf: 1, clouds: true, cloudSteps: 18, cloudRes: 0.35, volumetric: false, volSteps: 0, ssao: false, ssr: false, bloom: true, taa: false, maxDpr: 1 },
  medium: { renderScale: 1.0, shadows: true, shadowRes: 2048, shadowDistance: 96, pcf: 8, clouds: true, cloudSteps: 26, cloudRes: 0.5, volumetric: true, volSteps: 12, ssao: false, ssr: true, bloom: true, taa: true, maxDpr: 1 },
  high: { renderScale: 1.0, shadows: true, shadowRes: 2048, shadowDistance: 128, pcf: 12, clouds: true, cloudSteps: 36, cloudRes: 0.5, volumetric: true, volSteps: 20, ssao: true, ssr: true, bloom: true, taa: true, maxDpr: 1.25 },
  ultra: { renderScale: 1.0, shadows: true, shadowRes: 4096, shadowDistance: 160, pcf: 16, clouds: true, cloudSteps: 48, cloudRes: 0.5, volumetric: true, volSteps: 28, ssao: true, ssr: true, bloom: true, taa: true, maxDpr: 2 },
};

function createQuadIndices(gl, quads) {
  const idx = new Uint32Array(quads * 6);
  for (let q = 0, v = 0; q < quads; q++, v += 4) {
    const o = q * 6;
    idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2;
    idx[o + 3] = v; idx[o + 4] = v + 2; idx[o + 5] = v + 3;
  }
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
  return buf;
}

export class Renderer {
  constructor(canvas, textureArrays, settings) {
    this.canvas = canvas;
    const { gl, ext } = createContext(canvas);
    this.gl = gl;
    this.ext = ext;
    this.settings = { ...settings };
    this.frame = 0;
    this.time = 0;
    this.stats = { draws: 0, tris: 0, chunks: 0, shadowChunks: 0 };
    this.emptyVao = gl.createVertexArray();
    this.ubo = new UniformBuffer(gl, 196, 0);
    this.indexBuffer = createQuadIndices(gl, MAX_QUADS);
    this.frustum = new Frustum();
    this.shadowFrustum = new Frustum();
    this.m = {
      view: mat4.create(), proj: mat4.create(), viewProj: mat4.create(), invViewProj: mat4.create(),
      prevViewProj: mat4.create(), viewProjNJ: mat4.create(), projNJ: mat4.create(), shadow: mat4.create(),
      invProj: mat4.create(), tmp: mat4.create(), tmp2: mat4.create(), lightRot: mat4.create(), ortho: mat4.create(),
    };
    this.prevCam = null;
    this.historyValid = false;
    this.skyCache = { key: null };
    this.lutDirty = true;
    this.lastLutSun = [0, 0, 0];

    this.compilePrograms();
    this.createSamplers();
    this.createBlockTextures(textureArrays);
    this.generateNoiseTextures();
    this.createShadowMaps();
    this.skyLut = new RenderTarget(gl, 256, 128, ['rgba16f'], null, { wrap: gl.REPEAT });
    // repeat horizontally only
    gl.bindTexture(gl.TEXTURE_2D, this.skyLut.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.exposure = [new RenderTarget(gl, 1, 1, ['rgba16f'], null, { filter: gl.NEAREST }), new RenderTarget(gl, 1, 1, ['rgba16f'], null, { filter: gl.NEAREST })];
    this.exposureIndex = 0;
    this.exposureReset = true;
    this.createDynamicBuffers();
    this.targets = null;
  }

  // ------------------------------------------------------------------ setup
  compilePrograms() {
    const gl = this.gl;
    const P = (vs, fs, name) => new Program(gl, vs, fs, name);
    const FS = FULLSCREEN_VS;
    this.prog = {
      gbuffer: P(gbufferVS(false), gbufferFS(false), 'gbuffer'),
      gbufferCutout: P(gbufferVS(true), gbufferFS(true), 'gbufferCutout'),
      shadow: P(shadowVS(false), shadowFS(false), 'shadow'),
      shadowCutout: P(shadowVS(true), shadowFS(true), 'shadowCutout'),
      water: P(waterVS, waterFS, 'water'),
      skyLut: P(FS, skyLutFS, 'skyLut'),
      clouds: P(FS, cloudsFS, 'clouds'),
      lighting: P(FS, lightingFS, 'lighting'),
      ssao: P(FS, ssaoFS, 'ssao'),
      aoBlur: P(FS, aoBlurFS, 'aoBlur'),
      volumetric: P(FS, volumetricFS, 'volumetric'),
      composite: P(FS, compositeFS, 'composite'),
      taa: P(FS, taaFS, 'taa'),
      bloomDown: P(FS, bloomDownFS, 'bloomDown'),
      bloomUp: P(FS, bloomUpFS, 'bloomUp'),
      exposure: P(FS, exposureFS, 'exposure'),
      tonemap: P(FS, tonemapFS, 'tonemap'),
      final: P(FS, finalFS, 'final'),
      outline: P(outlineVS, outlineFS, 'outline'),
      particles: P(particleVS, particleFS, 'particles'),
      hand: P(handVS, handFS, 'hand'),
      precip: P(precipVS, precipFS, 'precip'),
      cloudNoise: P(FS, cloudNoiseFS, 'cloudNoise'),
      weather: P(FS, weatherFS, 'weather'),
      waterNormal: P(FS, waterNormalFS, 'waterNormal'),
    };
  }

  createSamplers() {
    const gl = this.gl;
    this.shadowCmpSampler = gl.createSampler();
    gl.samplerParameteri(this.shadowCmpSampler, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.samplerParameteri(this.shadowCmpSampler, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.samplerParameteri(this.shadowCmpSampler, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.samplerParameteri(this.shadowCmpSampler, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.samplerParameteri(this.shadowCmpSampler, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.samplerParameteri(this.shadowCmpSampler, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    this.nearestSampler = gl.createSampler();
    gl.samplerParameteri(this.nearestSampler, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.samplerParameteri(this.nearestSampler, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.samplerParameteri(this.nearestSampler, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.samplerParameteri(this.nearestSampler, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.linearSampler = gl.createSampler();
    gl.samplerParameteri(this.linearSampler, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.samplerParameteri(this.linearSampler, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.samplerParameteri(this.linearSampler, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.samplerParameteri(this.linearSampler, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  createBlockTextures(arrays) {
    const gl = this.gl;
    const make = (key) => {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, arrays.levels.length, gl.RGBA8, arrays.size, arrays.size, arrays.count);
      arrays.levels.forEach((lvl, i) => {
        gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, i, 0, 0, 0, lvl.size, lvl.size, arrays.count, gl.RGBA, gl.UNSIGNED_BYTE, lvl[key]);
      });
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      // LINEAR magnification: the shaders snap UVs to texel centres (sharp bilinear)
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
      if (this.ext.aniso) gl.texParameterf(gl.TEXTURE_2D_ARRAY, this.ext.aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(this.ext.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
      return tex;
    };
    this.texAlbedo = make('albedo');
    this.texNormal = make('normal');
    this.texMaterial = make('material');
  }

  generateNoiseTextures() {
    const gl = this.gl;
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    // 3D cloud noise, one slice at a time
    const N = 64;
    this.noise3D = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D, this.noise3D);
    gl.texStorage3D(gl.TEXTURE_3D, Math.log2(N) + 1, gl.RGBA8, N, N, N);
    this.prog.cloudNoise.use();
    gl.viewport(0, 0, N, N);
    for (let z = 0; z < N; z++) {
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, this.noise3D, 0, z);
      this.prog.cloudNoise.f1('uSlice', (z + 0.5) / N);
      this.fullscreen();
    }
    gl.bindTexture(gl.TEXTURE_3D, this.noise3D);
    gl.generateMipmap(gl.TEXTURE_3D);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    for (const w of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, w, gl.REPEAT);

    const gen2D = (size, prog) => {
      const tex = createTexture2D(gl, size, size, 'rgba8', { mips: true, wrap: gl.REPEAT });
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.viewport(0, 0, size, size);
      prog.use();
      this.fullscreen();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.generateMipmap(gl.TEXTURE_2D);
      return tex;
    };
    this.weatherTex = gen2D(512, this.prog.weather);
    this.waterTex = gen2D(256, this.prog.waterNormal);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
  }

  createShadowMaps() {
    const gl = this.gl;
    if (this.shadowTarget) { this.shadowTarget.dispose(); this.waterShadowTarget.dispose(); }
    const res = this.settings.shadowRes;
    this.shadowTarget = new RenderTarget(gl, res, res, [], 'depth24');
    this.waterShadowTarget = new RenderTarget(gl, res >> 1, res >> 1, [], 'depth24');
    for (const t of [this.shadowTarget.depth, this.waterShadowTarget.depth]) {
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    }
    this.shadowRes = res;
  }

  createDynamicBuffers() {
    const gl = this.gl;
    // selection outline: unit cube faces with per-face uv for edge detection
    const v = [];
    const faces = [
      [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
      [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
      [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]],
    ];
    const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (const f of faces) {
      for (const k of [0, 1, 2, 0, 2, 3]) v.push(...f[k], ...uvs[k]);
    }
    this.cubeVao = gl.createVertexArray();
    gl.bindVertexArray(this.cubeVao);
    const cb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
    // particles: dynamic buffer, 6 verts x (pos3, corner2, uv2, layer1, light2)
    this.particleVao = gl.createVertexArray();
    gl.bindVertexArray(this.particleVao);
    this.particleBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleBuf);
    gl.bufferData(gl.ARRAY_BUFFER, 4096 * 6 * 10 * 4, gl.DYNAMIC_DRAW);
    const stride = 10 * 4;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 20);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 3, gl.FLOAT, false, stride, 28);
    this.particleData = new Float32Array(4096 * 6 * 10);
    // held block: small cube with per-face texture layer chosen in the shader
    this.handVao = gl.createVertexArray();
    gl.bindVertexArray(this.handVao);
    const hv = [];
    const normals = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    faces.forEach((f, fi) => {
      const uvh = [[0, 1], [1, 1], [1, 0], [0, 0]];
      for (const k of [0, 1, 2, 0, 2, 3]) hv.push(f[k][0] - 0.5, f[k][1] - 0.5, f[k][2] - 0.5, ...uvh[k], ...normals[fi], fi);
    });
    const hb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, hb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(hv), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 36, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 36, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 36, 20);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 36, 32);
    // precipitation: one strip quad instanced over random seeds
    this.precipVao = gl.createVertexArray();
    gl.bindVertexArray(this.precipVao);
    const corners = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, 0, 1, 0, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    this.precipMax = 6000;
    const seeds = new Float32Array(this.precipMax * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    const sb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, sb);
    gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 16, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.bindVertexArray(null);
    this.rainMap = createTexture2D(gl, 64, 64, 'r8', { filter: gl.NEAREST });
    this.rainOrigin = [0, 0];
  }

  // Top-down height map (64x64 columns) of whatever blocks rain, centred near the camera.
  updateRainMap(originX, originZ, data) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.rainMap);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 64, 64, gl.RED, gl.UNSIGNED_BYTE, data);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    this.rainOrigin = [originX, originZ];
  }

  drawPrecipitation(state) {
    const gl = this.gl;
    const pr = state.precip;
    const snow = pr.type === 'snow';
    const count = Math.floor(this.precipMax * Math.min(1, pr.amount) * (snow ? 0.55 : 1));
    if (count < 10) return;
    const wind = state.weather ? 1.5 + state.weather.storm * 3 : 1.5;
    this.prog.precip.use()
      .tex('uOcclusion', this.rainMap, gl.TEXTURE_2D, this.nearestSampler)
      .f2('uOccOrigin', this.rainOrigin[0], this.rainOrigin[1])
      .f4('uBox', snow ? 22 : 26, 34, snow ? 1.6 : 14, snow ? 0 : 0.9)
      .f4('uStyle', snow ? 0.05 : 0.022, snow ? 1 : 0, wind, wind * 0.4)
      .f1('uIntensity', 0.35 + 0.65 * Math.min(1, pr.amount));
    gl.depthMask(false);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.precipVao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    gl.depthMask(true);
  }

  applySettings(settings) {
    const prev = this.settings;
    this.settings = { ...settings };
    if (prev.shadowRes !== settings.shadowRes) this.createShadowMaps();
    if (prev.renderScale !== settings.renderScale || prev.cloudRes !== settings.cloudRes || prev.maxDpr !== settings.maxDpr) this.targets = null;
    this.historyValid = false;
    this.exposureReset = true;
  }

  // ------------------------------------------------------------------ targets
  ensureTargets() {
    const gl = this.gl;
    const dpr = Math.min(window.devicePixelRatio || 1, this.settings.maxDpr || 1);
    const cw = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const ch = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
    }
    const scale = this.settings.renderScale;
    const w = Math.max(16, Math.floor(cw * scale));
    const h = Math.max(16, Math.floor(ch * scale));
    if (this.targets && this.targets.w === w && this.targets.h === h) return this.targets;
    if (this.targets) this.disposeTargets();
    const hw = Math.max(8, w >> 1), hh = Math.max(8, h >> 1);
    const cr = this.settings.cloudRes || 0.5;
    const cloudW = Math.max(8, Math.floor(w * cr)), cloudH = Math.max(8, Math.floor(h * cr));
    const t = { w, h };
    t.gbuffer = new RenderTarget(gl, w, h, ['rgba8', 'rgba16f', 'rgba8'], 'depth24', { filter: gl.NEAREST });
    t.depth = t.gbuffer.depth;
    t.hdr = new RenderTarget(gl, w, h, ['rgba16f']);
    t.hdrDepth = this.makeFbo([t.hdr.texture], t.depth, w, h);
    t.sceneCopy = new RenderTarget(gl, w, h, ['rgba16f']);
    t.depthCopy = new RenderTarget(gl, w, h, [], 'depth24');
    t.composite = new RenderTarget(gl, w, h, ['rgba16f']);
    t.taa = [new RenderTarget(gl, w, h, ['rgba16f']), new RenderTarget(gl, w, h, ['rgba16f'])];
    t.taaIndex = 0;
    t.ldr = new RenderTarget(gl, w, h, ['rgba8']);
    t.ldrDepth = this.makeFbo([t.ldr.texture], t.depth, w, h);
    t.ssao = new RenderTarget(gl, hw, hh, ['rg16f']);
    t.ssaoBlur = new RenderTarget(gl, hw, hh, ['rg16f']);
    t.volumetric = new RenderTarget(gl, hw, hh, ['rgba16f']);
    t.clouds = new RenderTarget(gl, cloudW, cloudH, ['rgba16f']);
    t.bloom = [];
    let bw = w, bh = h;
    for (let i = 0; i < 6; i++) {
      bw = Math.max(1, bw >> 1);
      bh = Math.max(1, bh >> 1);
      t.bloom.push(new RenderTarget(gl, bw, bh, ['rgba16f']));
    }
    this.targets = t;
    this.historyValid = false;
    return t;
  }

  makeFbo(colors, depth, w, h) {
    const gl = this.gl;
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    colors.forEach((c, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, c, 0));
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0);
    gl.drawBuffers(colors.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
    const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (st !== gl.FRAMEBUFFER_COMPLETE) throw new Error('fbo incomplete ' + st);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fbo, width: w, height: h };
  }

  disposeTargets() {
    const t = this.targets;
    const gl = this.gl;
    for (const k of ['gbuffer', 'hdr', 'sceneCopy', 'depthCopy', 'composite', 'ldr', 'ssao', 'ssaoBlur', 'volumetric', 'clouds']) t[k].dispose();
    t.taa.forEach((x) => x.dispose());
    t.bloom.forEach((x) => x.dispose());
    gl.deleteFramebuffer(t.hdrDepth.fbo);
    gl.deleteFramebuffer(t.ldrDepth.fbo);
    this.targets = null;
  }

  // ------------------------------------------------------------------ chunk meshes
  uploadChunk(chunk, mesh) {
    const gl = this.gl;
    if (!chunk.gpu) chunk.gpu = { layers: [null, null, null], minY: 0, maxY: 0 };
    const g = chunk.gpu;
    g.minY = mesh.minY;
    g.maxY = mesh.maxY;
    const datas = [mesh.opaque, mesh.cutout, mesh.translucent];
    for (let l = 0; l < 3; l++) {
      const data = datas[l];
      const count = data.byteLength / VERTEX_BYTES;
      let m = g.layers[l];
      if (count === 0) {
        if (m) { gl.deleteBuffer(m.vbo); gl.deleteVertexArray(m.vao); g.layers[l] = null; }
        continue;
      }
      if (count / 4 > MAX_QUADS) { console.warn('chunk mesh too large'); continue; }
      if (!m) {
        m = { vao: gl.createVertexArray(), vbo: gl.createBuffer(), count: 0 };
        gl.bindVertexArray(m.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, m.vbo);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.UNSIGNED_SHORT, false, VERTEX_BYTES, 0);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 2, gl.UNSIGNED_BYTE, false, VERTEX_BYTES, 6);
        gl.enableVertexAttribArray(2);
        gl.vertexAttribIPointer(2, 4, gl.UNSIGNED_BYTE, VERTEX_BYTES, 8);
        gl.enableVertexAttribArray(3);
        gl.vertexAttribIPointer(3, 4, gl.UNSIGNED_BYTE, VERTEX_BYTES, 12);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
        g.layers[l] = m;
      }
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, m.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(data), gl.STATIC_DRAW);
      m.count = count;
    }
    gl.bindVertexArray(null);
  }

  freeChunk(chunk) {
    const gl = this.gl;
    if (!chunk.gpu) return;
    for (const m of chunk.gpu.layers) {
      if (m) { gl.deleteBuffer(m.vbo); gl.deleteVertexArray(m.vao); }
    }
    chunk.gpu = null;
  }

  // ------------------------------------------------------------------ frame setup
  fullscreen() {
    const gl = this.gl;
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // Fraction of moonlight for a phase (0 new, 0.5 full); never fully dark so nights stay playable.
  moonLight(phase) {
    return 0.2 + 0.8 * (0.5 - 0.5 * Math.cos(phase * Math.PI * 2));
  }

  computeLighting(dayTime, moonPhase = 0.5) {
    // dayTime: 0 sunrise, 0.25 noon, 0.5 sunset, 0.75 midnight
    const a = dayTime * Math.PI * 2;
    const sun = [Math.cos(a), Math.sin(a) * Math.cos(SUN_TILT), Math.sin(a) * Math.sin(SUN_TILT)];
    const moon = [-sun[0], -sun[1], -sun[2]];
    // sky irradiance costs a few ms on the CPU: refresh it in ~0.25 degree steps of sun motion
    const moonK = this.moonLight(moonPhase);
    const key = sun.map((v) => Math.round(v * 240)).join(',') + ',' + moonK.toFixed(2);
    if (this.skyCache.key !== key) {
      const alt = 200;
      const p = [0, PLANET_RADIUS + alt, 0];
      const tSun = transmittance(p[0], p[1], p[2], sun[0], sun[1], sun[2], 16);
      const tMoon = transmittance(p[0], p[1], p[2], moon[0], moon[1], moon[2], 16);
      const irrSun = sun[1] > -0.3 ? skyIrradiance(sun, alt, SUN_E) : { up: [0, 0, 0], side: [0, 0, 0] };
      const irrMoon = moon[1] > -0.2 ? skyIrradiance(moon, alt, MOON_E * moonK) : { up: [0, 0, 0], side: [0, 0, 0] };
      const moonTint = [0.72, 0.84, 1.15];
      const up = [0, 1, 2].map((c) => irrSun.up[c] + irrMoon.up[c] * moonTint[c]);
      const side = [0, 1, 2].map((c) => irrSun.side[c] + irrMoon.side[c] * moonTint[c]);
      this.skyCache = { key, tSun, tMoon, up, side };
    }
    const sc = this.skyCache;
    const sunUp = sun[1] > -0.035;
    const light = sunUp ? sun : moon;
    const fadeSun = Math.min(1, Math.max(0, (sun[1] + 0.035) / 0.06));
    const fadeMoon = Math.min(1, Math.max(0, (moon[1] + 0.035) / 0.12));
    const lightColor = sunUp
      ? sc.tSun.map((t) => t * SUN_E * fadeSun)
      : sc.tMoon.map((t, c) => t * MOON_E * moonK * fadeMoon * [0.72, 0.84, 1.15][c]);
    // Boost + slightly desaturate the sky irradiance (multiple scattering the model lacks)
    const boost = (c) => {
      const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      return c.map((v) => (v * 0.7 + l * 0.3) * 1.9);
    };
    const skyUp = boost(sc.up);
    const skySide = boost(sc.side);
    const ground = skyUp.map((v, c) => v * 0.28 * [0.95, 1.0, 0.85][c]);
    const night = Math.min(1, Math.max(0, (-sun[1] + 0.05) / 0.2));
    return { sun, moon, light, isSun: sunUp, lightColor, skyUp, skySide, ground, night, fadeSun, fadeMoon, sunAngle: a };
  }

  updateFrameUniforms(state, t) {
    const s = this.settings;
    const cam = state.camera;
    const m = this.m;
    const w = t.w, h = t.h;
    const aspect = w / h;
    const near = 0.06;
    const far = Math.max(256, state.renderDistance * 16 * 1.6 + 64);
    this.near = near;
    this.far = far;
    let jx = 0, jy = 0;
    if (s.taa) {
      const i = (this.frame % 8) + 1;
      jx = (halton(i, 2) - 0.5) * 2 / w;
      jy = (halton(i, 3) - 0.5) * 2 / h;
    }
    mat4.lookDir(m.view, cam.forward, [0, 1, 0]);
    mat4.perspective(m.proj, cam.fov, aspect, near, far, jx, jy);
    mat4.perspective(m.projNJ, cam.fov, aspect, near, far, 0, 0);
    mat4.multiply(m.viewProj, m.proj, m.view);
    mat4.multiply(m.viewProjNJ, m.projNJ, m.view);
    mat4.invert(m.invViewProj, m.viewProj);
    mat4.invert(m.invProj, m.proj);
    this.frustum.setFromMatrix(m.viewProjNJ);

    const L = this.computeLighting(state.dayTime, state.moonPhase ?? 0.5);
    this.moonPhase = state.moonPhase ?? 0.5;
    // overcast: the cloud deck blocks most direct light and turns the ambient grey and even
    const rainAmt = (state.weather && state.weather.rain) || 0;
    if (rainAmt > 0) {
      const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      const grey = (c, amt, scale) => { const l = lum(c); for (let i = 0; i < 3; i++) c[i] = (c[i] + (l * [0.95, 0.98, 1.03][i] - c[i]) * amt) * scale; };
      for (let i = 0; i < 3; i++) L.lightColor[i] *= 1 - 0.82 * rainAmt;
      grey(L.skyUp, rainAmt * 0.8, 1 - 0.3 * rainAmt);
      grey(L.skySide, rainAmt * 0.8, 1 - 0.3 * rainAmt);
      for (let i = 0; i < 3; i++) L.skySide[i] += (L.skyUp[i] * 0.85 - L.skySide[i]) * rainAmt;
      grey(L.ground, rainAmt * 0.6, 1 - 0.3 * rainAmt);
    }
    this.light = L;
    // shadow matrix: orthographic around the (snapped) camera, looking along -light
    const R = s.shadowDistance;
    const D = R + 110;
    const ld = L.light;
    const up = Math.abs(ld[1]) > 0.99 ? [1, 0, 0] : [0, 1, 0];
    mat4.lookDir(m.lightRot, [-ld[0], -ld[1], -ld[2]], up);
    const px = cam.pos[0], py = cam.pos[1], pz = cam.pos[2];
    const lr = m.lightRot;
    const lx = lr[0] * px + lr[4] * py + lr[8] * pz;
    const ly = lr[1] * px + lr[5] * py + lr[9] * pz;
    const texel = (2 * R) / this.shadowRes;
    const fx = lx - Math.round(lx / texel) * texel;
    const fy = ly - Math.round(ly / texel) * texel;
    mat4.copy(m.tmp, lr);
    m.tmp[12] += fx;
    m.tmp[13] += fy;
    mat4.ortho(m.ortho, -R, R, -R, R, -D, D);
    mat4.multiply(m.shadow, m.ortho, m.tmp);
    this.shadowFrustum.setFromMatrix(m.shadow);

    const d = this.ubo.data;
    d.set(m.view, 0);
    d.set(m.proj, 16);
    d.set(m.viewProj, 32);
    d.set(m.invViewProj, 48);
    // previous frame (unjittered), relative to the previous camera
    if (this.prevViewProjStore) d.set(this.prevViewProjStore, 64); else d.set(m.viewProjNJ, 64);
    d.set(m.viewProjNJ, 80);
    d.set(m.shadow, 96);
    d.set(m.invProj, 112);
    const v4 = (o, a, b, c, e) => { d[o] = a; d[o + 1] = b; d[o + 2] = c; d[o + 3] = e; };
    v4(128, px, py, pz, this.time);
    v4(132, ld[0], ld[1], ld[2], L.isSun ? 1 : 0);
    v4(136, L.sun[0], L.sun[1], L.sun[2], 1 - L.night);
    v4(140, L.lightColor[0], L.lightColor[1], L.lightColor[2], (L.isSun ? L.fadeSun : L.fadeMoon) > 0.001 ? 1 : 0);
    v4(144, L.skyUp[0], L.skyUp[1], L.skyUp[2], 0);
    v4(148, L.skySide[0], L.skySide[1], L.skySide[2], 0);
    v4(152, L.ground[0], L.ground[1], L.ground[2], 0);
    const rd = state.renderDistance * 16;
    const fog = state.fog;
    v4(156, fog.density, fog.falloff, rd * 0.62, rd * 0.98);
    v4(160, w, h, 1 / w, 1 / h);
    // w: 0 above water, otherwise 1 + depth of the eye below the surface
    v4(164, near, far, this.frame, state.underwater ? 1 + (state.waterDepth || 0) : 0);
    const rain = (state.weather && state.weather.rain) || 0;
    const coverage = (state.cloudCoverage ?? 0.5) + (0.96 - (state.cloudCoverage ?? 0.5)) * Math.min(1, rain * 1.3);
    v4(168, rain, (state.wind ?? 1) * (1 + rain * 1.2), coverage, state.eyeSky ?? 1);
    const pc = this.prevCam || cam.pos;
    v4(172, px - pc[0], py - pc[1], pz - pc[2], 0);
    v4(176, R, D, 1 / this.shadowRes, 0.86);
    v4(180, 185, 340, state.cloudOffset[0], state.cloudOffset[1]);
    v4(184, L.moon[0], L.moon[1], L.moon[2], L.night);
    v4(188, s.shadows ? 1 : 0, s.pcf, s.volSteps || 1, s.cloudSteps || 1);
    const wx = state.weather || {};
    v4(192, wx.rain || 0, wx.wetness || 0, wx.flash || 0, wx.snow ? 1 : 0);
    this.ubo.upload();
  }

  // Build culled, sorted draw lists
  collectChunks(chunks, cam) {
    const main = [];
    const shadow = [];
    const R = this.settings.shadowDistance + 24;
    const px = cam.pos[0], py = cam.pos[1], pz = cam.pos[2];
    for (const c of chunks) {
      const g = c.gpu;
      if (!g) continue;
      const ox = c.cx * 16 - px, oz = c.cz * 16 - pz;
      const y0 = g.minY - py - 1, y1 = g.maxY - py + 1;
      const dx = ox + 8, dz = oz + 8;
      const dist2 = dx * dx + dz * dz;
      c._ox = ox; c._oy = -py; c._oz = oz; c._d2 = dist2;
      if (this.frustum.intersectsBox(ox - 0.5, y0, oz - 0.5, ox + 16.5, y1, oz + 16.5)) main.push(c);
      if (this.settings.shadows && dist2 < R * R * 2 && this.shadowFrustum.intersectsBox(ox - 0.5, y0, oz - 0.5, ox + 16.5, y1 + 1, oz + 16.5)) shadow.push(c);
    }
    main.sort((a, b) => a._d2 - b._d2);
    return { main, shadow };
  }

  drawChunks(prog, list, layer) {
    const gl = this.gl;
    const loc = prog.loc('uChunkOffset');
    let draws = 0, verts = 0;
    for (const c of list) {
      const m = c.gpu.layers[layer];
      if (!m) continue;
      gl.uniform3f(loc, c._ox, c._oy, c._oz);
      gl.bindVertexArray(m.vao);
      gl.drawElements(gl.TRIANGLES, (m.count >> 2) * 6, gl.UNSIGNED_INT, 0);
      draws++;
      verts += m.count;
    }
    this.stats.draws += draws;
    this.stats.tris += verts >> 1;
  }

  // ------------------------------------------------------------------ the frame
  render(state, dt) {
    const gl = this.gl;
    const s = this.settings;
    this.time += dt;
    const t = this.ensureTargets();
    this.stats.draws = 0;
    this.stats.tris = 0;
    this.updateFrameUniforms(state, t);
    const { main, shadow } = this.collectChunks(state.chunks, state.camera);
    this.stats.chunks = main.length;
    this.stats.shadowChunks = shadow.length;

    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);

    // ---- sky view LUT (only when the sun moved noticeably or the camera changed altitude a lot)
    const L = this.light;
    const rainNow = (state.weather && state.weather.rain) || 0;
    const lutKey = Math.round(L.sun[0] * 2000) + ',' + Math.round(L.sun[1] * 2000) + ',' + Math.round(state.camera.pos[1] / 16) + ',' + Math.round(rainNow * 50) + ',' + this.moonPhase;
    if (lutKey !== this.lutKey) {
      this.lutKey = lutKey;
      this.skyLut.bind();
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      this.prog.skyLut.use().f1('uSunIntensity', SUN_E).f1('uMoonIntensity', MOON_E * this.moonLight(this.moonPhase));
      this.fullscreen();
    }

    // ---- shadow maps
    if (s.shadows) {
      this.shadowTarget.bind();
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LESS);
      gl.depthMask(true);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(1.1, 2.0);
      this.prog.shadow.use();
      this.drawChunks(this.prog.shadow, shadow, 0);
      this.prog.shadowCutout.use().tex('uAlbedo', this.texAlbedo, gl.TEXTURE_2D_ARRAY);
      this.drawChunks(this.prog.shadowCutout, shadow, 1);
      // water surfaces (for caustics / underwater light)
      this.waterShadowTarget.bind();
      gl.clear(gl.DEPTH_BUFFER_BIT);
      this.prog.shadow.use();
      this.drawChunks(this.prog.shadow, shadow, 2);
      gl.disable(gl.POLYGON_OFFSET_FILL);
    } else {
      this.waterShadowTarget.bind();
      gl.clearDepth(1);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      this.shadowTarget.bind();
      gl.clear(gl.DEPTH_BUFFER_BIT);
    }

    // ---- G-buffer
    t.gbuffer.bind();
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    const gp = this.prog.gbuffer.use();
    gp.tex('uAlbedo', this.texAlbedo, gl.TEXTURE_2D_ARRAY).tex('uNormalMap', this.texNormal, gl.TEXTURE_2D_ARRAY).tex('uMaterialMap', this.texMaterial, gl.TEXTURE_2D_ARRAY);
    this.drawChunks(gp, main, 0);
    const gc = this.prog.gbufferCutout.use();
    gc.tex('uAlbedo', this.texAlbedo, gl.TEXTURE_2D_ARRAY).tex('uNormalMap', this.texNormal, gl.TEXTURE_2D_ARRAY).tex('uMaterialMap', this.texMaterial, gl.TEXTURE_2D_ARRAY);
    this.drawChunks(gc, main, 1);
    // held block (drawn into the G-buffer so it is lit like everything else)
    if (state.hand && state.hand.visible) this.drawHand(state);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);

    // ---- SSAO
    if (s.ssao) {
      t.ssao.bind();
      this.prog.ssao.use().tex('uDepth', t.depth, gl.TEXTURE_2D, this.nearestSampler).tex('uGNormal', t.gbuffer.textures[1], gl.TEXTURE_2D, this.nearestSampler);
      this.fullscreen();
      t.ssaoBlur.bind();
      this.prog.aoBlur.use().tex('uSrc', t.ssao.texture).f2('uDir', 1, 0);
      this.fullscreen();
      t.ssao.bind();
      this.prog.aoBlur.use().tex('uSrc', t.ssaoBlur.texture).f2('uDir', 0, 1);
      this.fullscreen();
    }

    // ---- clouds (half res, independent of scene depth)
    if (s.clouds) {
      t.clouds.bind();
      this.prog.clouds.use().tex('uNoise3D', this.noise3D, gl.TEXTURE_3D).tex('uWeatherMap', this.weatherTex).tex('uSkyLut', this.skyLut.texture);
      this.fullscreen();
    }

    // ---- deferred lighting
    t.hdr.bind();
    const lp = this.prog.lighting.use();
    lp.tex('uGAlbedo', t.gbuffer.textures[0], gl.TEXTURE_2D, this.nearestSampler)
      .tex('uGNormal', t.gbuffer.textures[1], gl.TEXTURE_2D, this.nearestSampler)
      .tex('uGLight', t.gbuffer.textures[2], gl.TEXTURE_2D, this.nearestSampler)
      .tex('uDepth', t.depth, gl.TEXTURE_2D, this.nearestSampler)
      .tex('uShadowCmp', this.shadowTarget.depth, gl.TEXTURE_2D, this.shadowCmpSampler)
      .tex('uShadowRaw', this.shadowTarget.depth, gl.TEXTURE_2D, this.nearestSampler)
      .tex('uWaterShadow', this.waterShadowTarget.depth, gl.TEXTURE_2D, this.nearestSampler)
      .tex('uSkyLut', this.skyLut.texture)
      .tex('uClouds', t.clouds.texture, gl.TEXTURE_2D, this.linearSampler)
      .tex('uAO', t.ssao.texture, gl.TEXTURE_2D, this.linearSampler)
      .tex('uNoise3D', this.noise3D, gl.TEXTURE_3D)
      .tex('uWeatherMap', this.weatherTex)
      .tex('uWaterTex', this.waterTex)
      .f1('uUseSSAO', s.ssao ? 1 : 0)
      .f1('uUseClouds', s.clouds ? 1 : 0)
      .f1('uVolumetricOn', s.volumetric ? 1 : 0)
      .f1('uStarAngle', L.sunAngle)
      .f1('uMoonPhase', this.moonPhase)
      .tex('uPrevColor', t.taa[1 - t.taaIndex].texture, gl.TEXTURE_2D, this.linearSampler)
      .f1('uReflectSSR', s.ssr && s.taa && this.historyValid ? 1 : 0);
    this.fullscreen();

    // ---- copies for refraction / reflections
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, t.hdr.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, t.sceneCopy.fbo);
    gl.blitFramebuffer(0, 0, t.w, t.h, 0, 0, t.w, t.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, t.gbuffer.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, t.depthCopy.fbo);
    gl.blitFramebuffer(0, 0, t.w, t.h, 0, 0, t.w, t.h, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);

    // ---- water & translucent
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.hdrDepth.fbo);
    gl.viewport(0, 0, t.w, t.h);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const wp = this.prog.water.use();
    wp.tex('uSceneColor', t.sceneCopy.texture, gl.TEXTURE_2D, this.linearSampler)
      .tex('uSceneDepth', t.depthCopy.depth, gl.TEXTURE_2D, this.nearestSampler)
      .tex('uShadowCmp', this.shadowTarget.depth, gl.TEXTURE_2D, this.shadowCmpSampler)
      .tex('uAlbedo', this.texAlbedo, gl.TEXTURE_2D_ARRAY)
      .tex('uSkyLut', this.skyLut.texture)
      .tex('uWaterTex', this.waterTex)
      .f1('uSSR', s.ssr ? 1 : 0)
      .f1('uVolumetricOn', s.volumetric ? 1 : 0)
      .f1('uStarAngle', L.sunAngle)
      .f1('uMoonPhase', this.moonPhase);
    const back = main.slice().reverse();
    this.drawChunks(wp, back, 2);
    // particles
    if (state.particles && state.particles.count) this.drawParticles(state);
    if (state.precip && state.precip.amount > 0.01 && !state.underwater) this.drawPrecipitation(state);
    gl.disable(gl.BLEND);
    gl.depthMask(false);
    gl.disable(gl.DEPTH_TEST);

    // ---- god rays
    if (s.volumetric) {
      t.volumetric.bind();
      this.prog.volumetric.use()
        .tex('uDepth', t.depth, gl.TEXTURE_2D, this.nearestSampler)
        .tex('uShadowCmp', this.shadowTarget.depth, gl.TEXTURE_2D, this.shadowCmpSampler)
        .tex('uWaterShadow', this.waterShadowTarget.depth, gl.TEXTURE_2D, this.nearestSampler)
        .tex('uNoise3D', this.noise3D, gl.TEXTURE_3D)
        .tex('uWeatherMap', this.weatherTex)
        .tex('uWaterTex', this.waterTex)
        .f1('uUseClouds', s.clouds ? 1 : 0);
      this.fullscreen();
    }

    // ---- composite (god rays + underwater fog)
    t.composite.bind();
    this.prog.composite.use()
      .tex('uScene', t.hdr.texture, gl.TEXTURE_2D, this.nearestSampler)
      .tex('uVolumetric', t.volumetric.texture, gl.TEXTURE_2D, this.nearestSampler)
      .tex('uDepth', t.depth, gl.TEXTURE_2D, this.nearestSampler)
      .f1('uUseVolumetric', s.volumetric ? 1 : 0);
    this.fullscreen();
    let sceneTex = t.composite.texture;

    // ---- TAA
    if (s.taa) {
      const cur = t.taa[t.taaIndex], prev = t.taa[1 - t.taaIndex];
      cur.bind();
      this.prog.taa.use()
        .tex('uCurrent', t.composite.texture, gl.TEXTURE_2D, this.nearestSampler)
        .tex('uHistory', prev.texture, gl.TEXTURE_2D, this.linearSampler)
        .tex('uDepth', t.depth, gl.TEXTURE_2D, this.nearestSampler)
        .f1('uHistoryValid', this.historyValid ? 1 : 0);
      this.fullscreen();
      t.taaIndex = 1 - t.taaIndex;
      sceneTex = cur.texture;
      this.historyValid = true;
    }

    // ---- bloom (the downsample chain also feeds exposure metering, so it always runs)
    {
      let src = sceneTex;
      for (let i = 0; i < t.bloom.length; i++) {
        t.bloom[i].bind();
        this.prog.bloomDown.use().tex('uSrc', src, gl.TEXTURE_2D, this.linearSampler).f1('uFirst', i === 0 ? 1 : 0);
        this.fullscreen();
        src = t.bloom[i].texture;
      }
    }
    // ---- exposure: meter the first bloom level small enough for the 64x64 metering loop
    let meter = t.bloom.length - 1;
    for (let i = 0; i < t.bloom.length; i++) {
      if (t.bloom[i].width <= 64 && t.bloom[i].height <= 64) { meter = i; break; }
    }
    // metering reads the downsampled chain before the upsample pass adds into it
    const expSrc = t.bloom[meter].texture;
    const eCur = this.exposure[this.exposureIndex], ePrev = this.exposure[1 - this.exposureIndex];
    if (expSrc) {
      eCur.bind();
      this.prog.exposure.use()
        .tex('uSrc', expSrc, gl.TEXTURE_2D, this.nearestSampler)
        .tex('uPrev', ePrev.texture, gl.TEXTURE_2D, this.nearestSampler)
        .f1('uDt', Math.min(dt, 0.1))
        .f1('uReset', this.exposureReset ? 1 : 0)
        .f2('uRange', 0.05, 6.5)
        .f1('uCompensation', state.brightness ?? 1)
        .f1('uReference', this.referenceExposure(state));
      this.fullscreen();
      this.exposureIndex = 1 - this.exposureIndex;
      this.exposureReset = false;
    }

    if (s.bloom) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      for (let i = t.bloom.length - 1; i > 0; i--) {
        t.bloom[i - 1].bind();
        this.prog.bloomUp.use().tex('uSrc', t.bloom[i].texture, gl.TEXTURE_2D, this.linearSampler).f1('uRadius', 1.0);
        this.fullscreen();
      }
      gl.disable(gl.BLEND);
    }

    // ---- tone map into LDR (+ selection outline on top)
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.ldrDepth.fbo);
    gl.viewport(0, 0, t.w, t.h);
    this.prog.tonemap.use()
      .tex('uScene', sceneTex, gl.TEXTURE_2D, this.nearestSampler)
      .tex('uBloom', s.bloom ? t.bloom[0].texture : sceneTex, gl.TEXTURE_2D, this.linearSampler)
      .tex('uExposure', eCur.texture, gl.TEXTURE_2D, this.nearestSampler)
      .f1('uBloomStrength', s.bloom ? 0.055 : 0)
      .f1('uSaturation', 1.08)
      .f1('uContrast', 1.04)
      .f1('uVignette', 0.28)
      .f1('uManualExposure', expSrc ? 0 : 0.6);
    this.fullscreen();
    if (state.selection) this.drawOutline(state.selection, state.camera);

    // ---- final: FXAA / sharpen / upscale to the canvas
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const dbg = { clouds: [t.clouds.texture, 1], ssao: [t.ssao.texture, 2], volumetric: [t.volumetric.texture, 3], albedo: [t.gbuffer.textures[0], 3], sky: [this.skyLut.texture, 3] }[this.debugView];
    this.prog.final.use()
      .tex('uSrc', t.ldr.texture, gl.TEXTURE_2D, this.linearSampler)
      .tex('uDebug', dbg ? dbg[0] : t.ldr.texture, gl.TEXTURE_2D, this.linearSampler)
      .f1('uDebugMode', dbg ? dbg[1] : 0)
      .f1('uFxaa', s.taa ? 0 : 1)
      .f1('uSharpen', s.taa ? 0.35 : 0.0);
    this.fullscreen();

    // remember this frame's unjittered matrices for reprojection
    if (!this.prevViewProjStore) this.prevViewProjStore = new Float32Array(16);
    this.prevViewProjStore.set(this.m.viewProjNJ);
    this.prevCam = state.camera.pos.slice();
    this.frame++;
  }

  drawOutline(sel, cam) {
    const gl = this.gl;
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.CULL_FACE);
    const e = 0.002;
    this.prog.outline.use()
      .f3('uMin', sel.min[0] - cam.pos[0] - e, sel.min[1] - cam.pos[1] - e, sel.min[2] - cam.pos[2] - e)
      .f3('uSize', sel.max[0] - sel.min[0] + 2 * e, sel.max[1] - sel.min[1] + 2 * e, sel.max[2] - sel.min[2] + 2 * e);
    gl.bindVertexArray(this.cubeVao);
    gl.drawArrays(gl.TRIANGLES, 0, 36);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
  }

  drawParticles(state) {
    const gl = this.gl;
    const ps = state.particles;
    const n = Math.min(ps.count, 4096);
    const d = this.particleData;
    const cam = state.camera.pos;
    let o = 0;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];
    for (let i = 0; i < n; i++) {
      const p = ps.list[i];
      for (const [cx, cy] of corners) {
        d[o++] = p.x - cam[0]; d[o++] = p.y - cam[1]; d[o++] = p.z - cam[2];
        d[o++] = cx * p.size; d[o++] = cy * p.size;
        d[o++] = p.u + (cx * 0.5 + 0.5) * 0.25; d[o++] = p.v + (0.5 - cy * 0.5) * 0.25;
        d[o++] = p.layer; d[o++] = p.sky; d[o++] = p.block;
      }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, d.subarray(0, o));
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.prog.particles.use().tex('uAlbedo', this.texAlbedo, gl.TEXTURE_2D_ARRAY).tex('uSkyLut', this.skyLut.texture);
    gl.bindVertexArray(this.particleVao);
    gl.drawArrays(gl.TRIANGLES, 0, n * 6);
  }

  drawHand(state) {
    const gl = this.gl;
    const hd = state.hand;
    const p = this.prog.hand.use();
    p.tex('uAlbedo', this.texAlbedo, gl.TEXTURE_2D_ARRAY).tex('uNormalMap', this.texNormal, gl.TEXTURE_2D_ARRAY).tex('uMaterialMap', this.texMaterial, gl.TEXTURE_2D_ARRAY);
    p.m4('uModel', hd.model).f4('uLayers', hd.layers[0], hd.layers[1], hd.layers[2], hd.layers[3])
      .f4('uLight', hd.sky, hd.block, hd.tint, hd.mat).f3('uTint', hd.tintColor[0], hd.tintColor[1], hd.tintColor[2])
      .f1('uAspect', this.targets.w / this.targets.h);
    // the hand lives close to the camera: clear depth range by drawing with a squeezed depth
    gl.depthRange(0.0, 0.02);
    gl.bindVertexArray(this.handVao);
    gl.drawArrays(gl.TRIANGLES, 0, 36);
    gl.depthRange(0.0, 1.0);
  }

  resetHistory() {
    this.historyValid = false;
  }

  // Exposure predicted from the light reaching the eye: sun/moon, sky (occluded in caves) and torches.
  referenceExposure(state) {
    const L = this.light;
    const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const sky = state.eyeSky ?? 1;
    const elev = Math.max(0, L.light[1]);
    const env = (lum(L.lightColor) * (0.25 + 0.75 * elev) + lum(L.skyUp) * 2.5) * sky * sky;
    const torch = Math.pow(state.eyeBlock ?? 0, 2.6) * 10;
    return 10.0 / (env + torch + 0.03);
  }
}
