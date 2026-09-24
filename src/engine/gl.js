// Thin WebGL2 helpers: programs, textures, render targets, fullscreen passes.

export function createContext(canvas) {
  const gl = canvas.getContext('webgl2', {
    antialias: false,
    depth: false,
    stencil: false,
    alpha: false,
    premultipliedAlpha: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
  });
  if (!gl) throw new Error('WebGL2 is not available in this browser.');
  const ext = {
    colorFloat: gl.getExtension('EXT_color_buffer_float'),
    colorHalf: gl.getExtension('EXT_color_buffer_half_float'),
    floatLinear: gl.getExtension('OES_texture_float_linear'),
    aniso: gl.getExtension('EXT_texture_filter_anisotropic'),
    timer: null,
  };
  if (!ext.colorFloat && !ext.colorHalf) {
    throw new Error('This browser cannot render to floating point textures (EXT_color_buffer_float), which the HDR pipeline needs.');
  }
  return { gl, ext };
}

function addLineNumbers(src) {
  return src.split('\n').map((l, i) => String(i + 1).padStart(4) + ': ' + l).join('\n');
}

export function compileShader(gl, type, src, name) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    console.error(`Shader compile error in ${name}:\n${log}\n${addLineNumbers(src)}`);
    gl.deleteShader(sh);
    throw new Error(`Shader ${name} failed to compile: ${log}`);
  }
  return sh;
}

export class Program {
  constructor(gl, vsSrc, fsSrc, name = 'program') {
    this.gl = gl;
    this.name = name;
    const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc, name + '.vert');
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc, name + '.frag');
    const p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(p);
      throw new Error(`Program ${name} failed to link: ${log}`);
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    this.program = p;
    this.uniforms = new Map();
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      const uname = info.name.replace(/\[0\]$/, '');
      this.uniforms.set(uname, gl.getUniformLocation(p, info.name));
    }
    const blockIndex = gl.getUniformBlockIndex(p, 'Frame');
    if (blockIndex !== gl.INVALID_INDEX) gl.uniformBlockBinding(p, blockIndex, 0);
    this.samplerUnits = new Map();
    this.nextUnit = 0;
  }

  use() {
    this.gl.useProgram(this.program);
    return this;
  }

  loc(name) {
    return this.uniforms.get(name);
  }

  // Bind a texture to a sampler uniform. Units are assigned per program on first use.
  tex(name, texture, target = this.gl.TEXTURE_2D, sampler = null) {
    const gl = this.gl;
    const loc = this.uniforms.get(name);
    if (loc === undefined) return this;
    let unit = this.samplerUnits.get(name);
    if (unit === undefined) {
      unit = this.nextUnit++;
      this.samplerUnits.set(name, unit);
      gl.uniform1i(loc, unit);
    }
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(target, texture);
    gl.bindSampler(unit, sampler);
    return this;
  }

  f1(name, x) { const l = this.uniforms.get(name); if (l !== undefined) this.gl.uniform1f(l, x); return this; }
  f2(name, x, y) { const l = this.uniforms.get(name); if (l !== undefined) this.gl.uniform2f(l, x, y); return this; }
  f3(name, x, y, z) { const l = this.uniforms.get(name); if (l !== undefined) this.gl.uniform3f(l, x, y, z); return this; }
  f4(name, x, y, z, w) { const l = this.uniforms.get(name); if (l !== undefined) this.gl.uniform4f(l, x, y, z, w); return this; }
  i1(name, x) { const l = this.uniforms.get(name); if (l !== undefined) this.gl.uniform1i(l, x); return this; }
  m4(name, m) { const l = this.uniforms.get(name); if (l !== undefined) this.gl.uniformMatrix4fv(l, false, m); return this; }
}

export const FORMATS = {
  rgba8: { internal: 'RGBA8', format: 'RGBA', type: 'UNSIGNED_BYTE' },
  rgba16f: { internal: 'RGBA16F', format: 'RGBA', type: 'HALF_FLOAT' },
  rg16f: { internal: 'RG16F', format: 'RG', type: 'HALF_FLOAT' },
  r16f: { internal: 'R16F', format: 'RED', type: 'HALF_FLOAT' },
  r32f: { internal: 'R32F', format: 'RED', type: 'FLOAT' },
  r8: { internal: 'R8', format: 'RED', type: 'UNSIGNED_BYTE' },
  rgb10a2: { internal: 'RGB10_A2', format: 'RGBA', type: 'UNSIGNED_INT_2_10_10_10_REV' },
  r11g11b10f: { internal: 'R11F_G11F_B10F', format: 'RGB', type: 'HALF_FLOAT' },
  depth24: { internal: 'DEPTH_COMPONENT24', format: 'DEPTH_COMPONENT', type: 'UNSIGNED_INT' },
  depth32f: { internal: 'DEPTH_COMPONENT32F', format: 'DEPTH_COMPONENT', type: 'FLOAT' },
};

export function createTexture2D(gl, w, h, fmt, opts = {}) {
  const f = FORMATS[fmt];
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  const levels = opts.mips ? Math.floor(Math.log2(Math.max(w, h))) + 1 : 1;
  gl.texStorage2D(gl.TEXTURE_2D, levels, gl[f.internal], w, h);
  const filter = opts.filter ?? gl.LINEAR;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, opts.mips ? gl.LINEAR_MIPMAP_LINEAR : filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  const wrap = opts.wrap ?? gl.CLAMP_TO_EDGE;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, opts.wrapT ?? wrap);
  if (opts.data) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl[f.format], gl[f.type], opts.data);
  tex.width = w;
  tex.height = h;
  tex.fmt = fmt;
  return tex;
}

export class RenderTarget {
  // colors: array of format names; depth: format name or texture to share
  constructor(gl, w, h, colors, depth = null, opts = {}) {
    this.gl = gl;
    this.width = w;
    this.height = h;
    this.fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    this.textures = colors.map((fmt, i) => {
      const t = createTexture2D(gl, w, h, fmt, { filter: opts.filter ?? gl.LINEAR, wrap: opts.wrap });
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0);
      return t;
    });
    this.ownsDepth = false;
    if (typeof depth === 'string') {
      this.depth = createTexture2D(gl, w, h, depth, { filter: gl.NEAREST });
      this.ownsDepth = true;
    } else this.depth = depth;
    if (this.depth) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.depth, 0);
    if (colors.length) gl.drawBuffers(colors.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
    else { gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE); }
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Framebuffer incomplete: 0x' + status.toString(16) + ' for ' + colors.join(','));
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  get texture() {
    return this.textures[0];
  }

  bind() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.width, this.height);
    return this;
  }

  dispose() {
    const gl = this.gl;
    for (const t of this.textures) gl.deleteTexture(t);
    if (this.ownsDepth) gl.deleteTexture(this.depth);
    gl.deleteFramebuffer(this.fbo);
  }
}

// Fullscreen triangle helper (no vertex buffers needed: uses gl_VertexID)
export const FULLSCREEN_VS = `#version 300 es
out vec2 vUV;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUV = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export function drawFullscreen(gl, emptyVao) {
  gl.bindVertexArray(emptyVao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

export class UniformBuffer {
  constructor(gl, floats, binding = 0) {
    this.gl = gl;
    this.data = new Float32Array(floats);
    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.buffer);
    gl.bufferData(gl.UNIFORM_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, binding, this.buffer);
    this.binding = binding;
  }
  upload() {
    const gl = this.gl;
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.buffer);
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, this.data);
  }
}
