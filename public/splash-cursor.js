/* MERIDIAN — splash cursor (vanilla port of React Bits <SplashCursor/>)
   WebGL fluid simulation that follows the pointer with crimson ink wisps.
   Fully GPU-driven; the canvas is a fixed, pointer-events:none overlay.
   Bails out silently when WebGL / float render targets are unavailable,
   and when the visitor prefers reduced motion. */
(function () {
  "use strict";

  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  var coarse = matchMedia("(pointer: coarse)").matches;

  var config = {
    SIM_RESOLUTION: coarse ? 72 : 128,
    DYE_RESOLUTION: coarse ? 512 : 1024,
    DENSITY_DISSIPATION: 1.5,
    VELOCITY_DISSIPATION: 8,
    PRESSURE: 0.3,
    PRESSURE_ITERATIONS: 14,
    CURL: 21,
    SPLAT_RADIUS: 0.12,
    SPLAT_FORCE: 4000,
    SHADING: true,
    COLOR: "#c2181b",         /* brand crimson (RAINBOW_MODE off) */
    PAUSED: false
  };

  var wrap = document.createElement("div");
  wrap.className = "fluid-layer";
  wrap.setAttribute("aria-hidden", "true");
  wrap.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;z-index:260;pointer-events:none;";
  var canvas = document.createElement("canvas");
  canvas.style.cssText = "width:100%;height:100%;display:block;";
  wrap.appendChild(canvas);

  function pointerPrototype() {
    this.id = -1;
    this.texcoordX = 0; this.texcoordY = 0;
    this.prevTexcoordX = 0; this.prevTexcoordY = 0;
    this.deltaX = 0; this.deltaY = 0;
    this.down = false; this.moved = false;
    this.color = { r: 0, g: 0, b: 0 };
  }
  var pointers = [new pointerPrototype()];

  function getWebGLContext(canvas) {
    var params = { alpha: true, depth: false, stencil: false, antialias: false, preserveDrawingBuffer: false };
    var gl = canvas.getContext("webgl2", params);
    var isWebGL2 = !!gl;
    if (!isWebGL2) gl = canvas.getContext("webgl", params) || canvas.getContext("experimental-webgl", params);
    if (!gl) return null;

    var halfFloat, supportLinearFiltering;
    if (isWebGL2) {
      gl.getExtension("EXT_color_buffer_float");
      supportLinearFiltering = gl.getExtension("OES_texture_float_linear");
    } else {
      halfFloat = gl.getExtension("OES_texture_half_float");
      supportLinearFiltering = gl.getExtension("OES_texture_half_float_linear");
    }
    gl.clearColor(0, 0, 0, 1);

    var halfFloatTexType = isWebGL2 ? gl.HALF_FLOAT : (halfFloat && halfFloat.HALF_FLOAT_OES);
    if (!halfFloatTexType) return null;
    var formatRGBA, formatRG, formatR;
    if (isWebGL2) {
      formatRGBA = getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, halfFloatTexType);
      formatRG = getSupportedFormat(gl, gl.RG16F, gl.RG, halfFloatTexType);
      formatR = getSupportedFormat(gl, gl.R16F, gl.RED, halfFloatTexType);
    } else {
      formatRGBA = getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);
      formatRG = getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);
      formatR = getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);
    }
    if (!formatRGBA || !formatRG || !formatR) return null;

    return {
      gl: gl,
      ext: {
        formatRGBA: formatRGBA, formatRG: formatRG, formatR: formatR,
        halfFloatTexType: halfFloatTexType,
        supportLinearFiltering: supportLinearFiltering
      }
    };
  }

  function getSupportedFormat(gl, internalFormat, format, type) {
    if (!supportRenderTextureFormat(gl, internalFormat, format, type)) {
      switch (internalFormat) {
        case gl.R16F: return getSupportedFormat(gl, gl.RG16F, gl.RG, type);
        case gl.RG16F: return getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, type);
        default: return null;
      }
    }
    return { internalFormat: internalFormat, format: format };
  }

  function supportRenderTextureFormat(gl, internalFormat, format, type) {
    var texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null);
    var fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    return gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  }

  var ctx;
  try { ctx = getWebGLContext(canvas); } catch (e) { ctx = null; }
  if (!ctx) return;
  var gl = ctx.gl, ext = ctx.ext;
  if (!ext.supportLinearFiltering) {
    config.DYE_RESOLUTION = 256;
    config.SHADING = false;
  }
  document.body.appendChild(wrap);

  function compileShader(type, source, keywords) {
    source = addKeywords(source, keywords);
    var shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return shader;
  }
  function addKeywords(source, keywords) {
    if (!keywords) return source;
    var s = "";
    keywords.forEach(function (k) { s += "#define " + k + "\n"; });
    return s + source;
  }
  function createProgramGL(vs, fs) {
    var program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    return program;
  }
  function getUniforms(program) {
    var uniforms = {};
    var count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < count; i++) {
      var name = gl.getActiveUniform(program, i).name;
      uniforms[name] = gl.getUniformLocation(program, name);
    }
    return uniforms;
  }
  function hashCode(s) {
    if (s.length === 0) return 0;
    var hash = 0;
    for (var i = 0; i < s.length; i++) { hash = (hash << 5) - hash + s.charCodeAt(i); hash |= 0; }
    return hash;
  }

  function Material(vertexShader, fragmentShaderSource) {
    this.vertexShader = vertexShader;
    this.fragmentShaderSource = fragmentShaderSource;
    this.programs = {};
    this.activeProgram = null;
    this.uniforms = {};
  }
  Material.prototype.setKeywords = function (keywords) {
    var hash = 0;
    for (var i = 0; i < keywords.length; i++) hash += hashCode(keywords[i]);
    var program = this.programs[hash];
    if (program == null) {
      var fragmentShader = compileShader(gl.FRAGMENT_SHADER, this.fragmentShaderSource, keywords);
      program = createProgramGL(this.vertexShader, fragmentShader);
      this.programs[hash] = program;
    }
    if (program === this.activeProgram) return;
    this.uniforms = getUniforms(program);
    this.activeProgram = program;
  };
  Material.prototype.bind = function () { gl.useProgram(this.activeProgram); };

  function ProgramWrap(vertexShader, fragmentShader) {
    this.program = createProgramGL(vertexShader, fragmentShader);
    this.uniforms = getUniforms(this.program);
  }
  ProgramWrap.prototype.bind = function () { gl.useProgram(this.program); };

  var baseVertexShader = compileShader(gl.VERTEX_SHADER,
    "precision highp float;\n" +
    "attribute vec2 aPosition;\n" +
    "varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;\n" +
    "uniform vec2 texelSize;\n" +
    "void main () {\n" +
    "  vUv = aPosition * 0.5 + 0.5;\n" +
    "  vL = vUv - vec2(texelSize.x, 0.0); vR = vUv + vec2(texelSize.x, 0.0);\n" +
    "  vT = vUv + vec2(0.0, texelSize.y); vB = vUv - vec2(0.0, texelSize.y);\n" +
    "  gl_Position = vec4(aPosition, 0.0, 1.0);\n" +
    "}");

  var copyShader = compileShader(gl.FRAGMENT_SHADER,
    "precision mediump float; precision mediump sampler2D;\n" +
    "varying highp vec2 vUv; uniform sampler2D uTexture;\n" +
    "void main () { gl_FragColor = texture2D(uTexture, vUv); }");

  var clearShader = compileShader(gl.FRAGMENT_SHADER,
    "precision mediump float; precision mediump sampler2D;\n" +
    "varying highp vec2 vUv; uniform sampler2D uTexture; uniform float value;\n" +
    "void main () { gl_FragColor = value * texture2D(uTexture, vUv); }");

  var displayShaderSource =
    "precision highp float; precision highp sampler2D;\n" +
    "varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;\n" +
    "uniform sampler2D uTexture; uniform vec2 texelSize;\n" +
    "void main () {\n" +
    "  vec3 c = texture2D(uTexture, vUv).rgb;\n" +
    "  #ifdef SHADING\n" +
    "    vec3 lc = texture2D(uTexture, vL).rgb; vec3 rc = texture2D(uTexture, vR).rgb;\n" +
    "    vec3 tc = texture2D(uTexture, vT).rgb; vec3 bc = texture2D(uTexture, vB).rgb;\n" +
    "    float dx = length(rc) - length(lc); float dy = length(tc) - length(bc);\n" +
    "    vec3 n = normalize(vec3(dx, dy, length(texelSize)));\n" +
    "    float diffuse = clamp(dot(n, vec3(0.0, 0.0, 1.0)) + 0.7, 0.7, 1.0);\n" +
    "    c *= diffuse;\n" +
    "  #endif\n" +
    "  float a = max(c.r, max(c.g, c.b));\n" +
    "  gl_FragColor = vec4(c, a);\n" +
    "}";

  var splatShader = compileShader(gl.FRAGMENT_SHADER,
    "precision highp float; precision highp sampler2D;\n" +
    "varying vec2 vUv; uniform sampler2D uTarget; uniform float aspectRatio;\n" +
    "uniform vec3 color; uniform vec2 point; uniform float radius;\n" +
    "void main () {\n" +
    "  vec2 p = vUv - point.xy; p.x *= aspectRatio;\n" +
    "  vec3 splat = exp(-dot(p, p) / radius) * color;\n" +
    "  vec3 base = texture2D(uTarget, vUv).xyz;\n" +
    "  gl_FragColor = vec4(base + splat, 1.0);\n" +
    "}");

  var advectionShader = compileShader(gl.FRAGMENT_SHADER,
    "precision highp float; precision highp sampler2D;\n" +
    "varying vec2 vUv; uniform sampler2D uVelocity; uniform sampler2D uSource;\n" +
    "uniform vec2 texelSize; uniform vec2 dyeTexelSize; uniform float dt; uniform float dissipation;\n" +
    "vec4 bilerp (sampler2D sam, vec2 uv, vec2 tsize) {\n" +
    "  vec2 st = uv / tsize - 0.5; vec2 iuv = floor(st); vec2 fuv = fract(st);\n" +
    "  vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * tsize);\n" +
    "  vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * tsize);\n" +
    "  vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * tsize);\n" +
    "  vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * tsize);\n" +
    "  return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);\n" +
    "}\n" +
    "void main () {\n" +
    "  #ifdef MANUAL_FILTERING\n" +
    "    vec2 coord = vUv - dt * bilerp(uVelocity, vUv, texelSize).xy * texelSize;\n" +
    "    vec4 result = bilerp(uSource, coord, dyeTexelSize);\n" +
    "  #else\n" +
    "    vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;\n" +
    "    vec4 result = texture2D(uSource, coord);\n" +
    "  #endif\n" +
    "  float decay = 1.0 + dissipation * dt;\n" +
    "  gl_FragColor = result / decay;\n" +
    "}",
    ext.supportLinearFiltering ? null : ["MANUAL_FILTERING"]);

  var divergenceShader = compileShader(gl.FRAGMENT_SHADER,
    "precision mediump float; precision mediump sampler2D;\n" +
    "varying highp vec2 vUv; varying highp vec2 vL; varying highp vec2 vR; varying highp vec2 vT; varying highp vec2 vB;\n" +
    "uniform sampler2D uVelocity;\n" +
    "void main () {\n" +
    "  float L = texture2D(uVelocity, vL).x; float R = texture2D(uVelocity, vR).x;\n" +
    "  float T = texture2D(uVelocity, vT).y; float B = texture2D(uVelocity, vB).y;\n" +
    "  vec2 C = texture2D(uVelocity, vUv).xy;\n" +
    "  if (vL.x < 0.0) { L = -C.x; } if (vR.x > 1.0) { R = -C.x; }\n" +
    "  if (vT.y > 1.0) { T = -C.y; } if (vB.y < 0.0) { B = -C.y; }\n" +
    "  float div = 0.5 * (R - L + T - B);\n" +
    "  gl_FragColor = vec4(div, 0.0, 0.0, 1.0);\n" +
    "}");

  var curlShader = compileShader(gl.FRAGMENT_SHADER,
    "precision mediump float; precision mediump sampler2D;\n" +
    "varying highp vec2 vUv; varying highp vec2 vL; varying highp vec2 vR; varying highp vec2 vT; varying highp vec2 vB;\n" +
    "uniform sampler2D uVelocity;\n" +
    "void main () {\n" +
    "  float L = texture2D(uVelocity, vL).y; float R = texture2D(uVelocity, vR).y;\n" +
    "  float T = texture2D(uVelocity, vT).x; float B = texture2D(uVelocity, vB).x;\n" +
    "  float vorticity = R - L - T + B;\n" +
    "  gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);\n" +
    "}");

  var vorticityShader = compileShader(gl.FRAGMENT_SHADER,
    "precision highp float; precision highp sampler2D;\n" +
    "varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;\n" +
    "uniform sampler2D uVelocity; uniform sampler2D uCurl; uniform float curl; uniform float dt;\n" +
    "void main () {\n" +
    "  float L = texture2D(uCurl, vL).x; float R = texture2D(uCurl, vR).x;\n" +
    "  float T = texture2D(uCurl, vT).x; float B = texture2D(uCurl, vB).x;\n" +
    "  float C = texture2D(uCurl, vUv).x;\n" +
    "  vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));\n" +
    "  force /= length(force) + 0.0001; force *= curl * C; force.y *= -1.0;\n" +
    "  vec2 velocity = texture2D(uVelocity, vUv).xy;\n" +
    "  velocity += force * dt;\n" +
    "  velocity = min(max(velocity, -1000.0), 1000.0);\n" +
    "  gl_FragColor = vec4(velocity, 0.0, 1.0);\n" +
    "}");

  var pressureShader = compileShader(gl.FRAGMENT_SHADER,
    "precision mediump float; precision mediump sampler2D;\n" +
    "varying highp vec2 vUv; varying highp vec2 vL; varying highp vec2 vR; varying highp vec2 vT; varying highp vec2 vB;\n" +
    "uniform sampler2D uPressure; uniform sampler2D uDivergence;\n" +
    "void main () {\n" +
    "  float L = texture2D(uPressure, vL).x; float R = texture2D(uPressure, vR).x;\n" +
    "  float T = texture2D(uPressure, vT).x; float B = texture2D(uPressure, vB).x;\n" +
    "  float divergence = texture2D(uDivergence, vUv).x;\n" +
    "  float pressure = (L + R + B + T - divergence) * 0.25;\n" +
    "  gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);\n" +
    "}");

  var gradientSubtractShader = compileShader(gl.FRAGMENT_SHADER,
    "precision mediump float; precision mediump sampler2D;\n" +
    "varying highp vec2 vUv; varying highp vec2 vL; varying highp vec2 vR; varying highp vec2 vT; varying highp vec2 vB;\n" +
    "uniform sampler2D uPressure; uniform sampler2D uVelocity;\n" +
    "void main () {\n" +
    "  float L = texture2D(uPressure, vL).x; float R = texture2D(uPressure, vR).x;\n" +
    "  float T = texture2D(uPressure, vT).x; float B = texture2D(uPressure, vB).x;\n" +
    "  vec2 velocity = texture2D(uVelocity, vUv).xy;\n" +
    "  velocity.xy -= vec2(R - L, T - B);\n" +
    "  gl_FragColor = vec4(velocity, 0.0, 1.0);\n" +
    "}");

  var blit = (function () {
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(0);
    return function (target, clear) {
      if (target == null) {
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      } else {
        gl.viewport(0, 0, target.width, target.height);
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      }
      if (clear) {
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    };
  })();

  var dye, velocity, divergence, curl, pressure;

  var copyProgram = new ProgramWrap(baseVertexShader, copyShader);
  var clearProgram = new ProgramWrap(baseVertexShader, clearShader);
  var splatProgram = new ProgramWrap(baseVertexShader, splatShader);
  var advectionProgram = new ProgramWrap(baseVertexShader, advectionShader);
  var divergenceProgram = new ProgramWrap(baseVertexShader, divergenceShader);
  var curlProgram = new ProgramWrap(baseVertexShader, curlShader);
  var vorticityProgram = new ProgramWrap(baseVertexShader, vorticityShader);
  var pressureProgram = new ProgramWrap(baseVertexShader, pressureShader);
  var gradienSubtractProgram = new ProgramWrap(baseVertexShader, gradientSubtractShader);
  var displayMaterial = new Material(baseVertexShader, displayShaderSource);

  function initFramebuffers() {
    var simRes = getResolution(config.SIM_RESOLUTION);
    var dyeRes = getResolution(config.DYE_RESOLUTION);
    var texType = ext.halfFloatTexType;
    var rgba = ext.formatRGBA, rg = ext.formatRG, r = ext.formatR;
    var filtering = ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST;
    gl.disable(gl.BLEND);

    if (!dye) dye = createDoubleFBO(dyeRes.width, dyeRes.height, rgba.internalFormat, rgba.format, texType, filtering);
    else dye = resizeDoubleFBO(dye, dyeRes.width, dyeRes.height, rgba.internalFormat, rgba.format, texType, filtering);

    if (!velocity) velocity = createDoubleFBO(simRes.width, simRes.height, rg.internalFormat, rg.format, texType, filtering);
    else velocity = resizeDoubleFBO(velocity, simRes.width, simRes.height, rg.internalFormat, rg.format, texType, filtering);

    divergence = createFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
    curl = createFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
    pressure = createDoubleFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
  }

  function createFBO(w, h, internalFormat, format, type, param) {
    gl.activeTexture(gl.TEXTURE0);
    var texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);
    var fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return {
      texture: texture, fbo: fbo, width: w, height: h,
      texelSizeX: 1 / w, texelSizeY: 1 / h,
      attach: function (id) {
        gl.activeTexture(gl.TEXTURE0 + id);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        return id;
      }
    };
  }

  function createDoubleFBO(w, h, internalFormat, format, type, param) {
    var fbo1 = createFBO(w, h, internalFormat, format, type, param);
    var fbo2 = createFBO(w, h, internalFormat, format, type, param);
    return {
      width: w, height: h,
      texelSizeX: fbo1.texelSizeX, texelSizeY: fbo1.texelSizeY,
      get read() { return fbo1; },
      set read(v) { fbo1 = v; },
      get write() { return fbo2; },
      set write(v) { fbo2 = v; },
      swap: function () { var t = fbo1; fbo1 = fbo2; fbo2 = t; }
    };
  }

  function resizeFBO(target, w, h, internalFormat, format, type, param) {
    var newFBO = createFBO(w, h, internalFormat, format, type, param);
    copyProgram.bind();
    gl.uniform1i(copyProgram.uniforms.uTexture, target.attach(0));
    blit(newFBO);
    return newFBO;
  }

  function resizeDoubleFBO(target, w, h, internalFormat, format, type, param) {
    if (target.width === w && target.height === h) return target;
    target.read = resizeFBO(target.read, w, h, internalFormat, format, type, param);
    target.write = createFBO(w, h, internalFormat, format, type, param);
    target.width = w; target.height = h;
    target.texelSizeX = 1 / w; target.texelSizeY = 1 / h;
    return target;
  }

  function updateKeywords() {
    var displayKeywords = [];
    if (config.SHADING) displayKeywords.push("SHADING");
    displayMaterial.setKeywords(displayKeywords);
  }

  updateKeywords();
  initFramebuffers();
  var lastUpdateTime = Date.now();

  /* idle sleep: the dye fully dissipates ~3s after the last interaction,
     so once the pointer has been still for 4s the sim + render loop stops
     entirely — scrolling without mouse movement costs nothing. Any pointer
     activity wakes it again. */
  var IDLE_MS = 4000;
  var lastActive = Date.now();
  var sleeping = false;
  function wake() {
    lastActive = Date.now();
    if (sleeping) {
      sleeping = false;
      lastUpdateTime = Date.now();
      requestAnimationFrame(updateFrame);
    }
  }

  function updateFrame() {
    if (Date.now() - lastActive > IDLE_MS) { sleeping = true; return; }
    var dt = calcDeltaTime();
    if (resizeCanvas()) initFramebuffers();
    applyInputs();
    step(dt);
    render(null);
    requestAnimationFrame(updateFrame);
  }

  function calcDeltaTime() {
    var now = Date.now();
    var dt = (now - lastUpdateTime) / 1000;
    dt = Math.min(dt, 0.016666);
    lastUpdateTime = now;
    return dt;
  }

  function resizeCanvas() {
    var width = scaleByPixelRatio(canvas.clientWidth);
    var height = scaleByPixelRatio(canvas.clientHeight);
    if (width <= 0 || height <= 0) return false;   // pre-layout / hidden: keep old buffers
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      return true;
    }
    return false;
  }

  function applyInputs() {
    pointers.forEach(function (p) {
      if (p.moved) {
        p.moved = false;
        splatPointer(p);
      }
    });
  }

  function step(dt) {
    gl.disable(gl.BLEND);
    curlProgram.bind();
    gl.uniform2f(curlProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(curlProgram.uniforms.uVelocity, velocity.read.attach(0));
    blit(curl);

    vorticityProgram.bind();
    gl.uniform2f(vorticityProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(vorticityProgram.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(vorticityProgram.uniforms.uCurl, curl.attach(1));
    gl.uniform1f(vorticityProgram.uniforms.curl, config.CURL);
    gl.uniform1f(vorticityProgram.uniforms.dt, dt);
    blit(velocity.write);
    velocity.swap();

    divergenceProgram.bind();
    gl.uniform2f(divergenceProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(divergenceProgram.uniforms.uVelocity, velocity.read.attach(0));
    blit(divergence);

    clearProgram.bind();
    gl.uniform1i(clearProgram.uniforms.uTexture, pressure.read.attach(0));
    gl.uniform1f(clearProgram.uniforms.value, config.PRESSURE);
    blit(pressure.write);
    pressure.swap();

    pressureProgram.bind();
    gl.uniform2f(pressureProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(pressureProgram.uniforms.uDivergence, divergence.attach(0));
    for (var i = 0; i < config.PRESSURE_ITERATIONS; i++) {
      gl.uniform1i(pressureProgram.uniforms.uPressure, pressure.read.attach(1));
      blit(pressure.write);
      pressure.swap();
    }

    gradienSubtractProgram.bind();
    gl.uniform2f(gradienSubtractProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(gradienSubtractProgram.uniforms.uPressure, pressure.read.attach(0));
    gl.uniform1i(gradienSubtractProgram.uniforms.uVelocity, velocity.read.attach(1));
    blit(velocity.write);
    velocity.swap();

    advectionProgram.bind();
    gl.uniform2f(advectionProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    if (!ext.supportLinearFiltering)
      gl.uniform2f(advectionProgram.uniforms.dyeTexelSize, velocity.texelSizeX, velocity.texelSizeY);
    var velocityId = velocity.read.attach(0);
    gl.uniform1i(advectionProgram.uniforms.uVelocity, velocityId);
    gl.uniform1i(advectionProgram.uniforms.uSource, velocityId);
    gl.uniform1f(advectionProgram.uniforms.dt, dt);
    gl.uniform1f(advectionProgram.uniforms.dissipation, config.VELOCITY_DISSIPATION);
    blit(velocity.write);
    velocity.swap();

    if (!ext.supportLinearFiltering)
      gl.uniform2f(advectionProgram.uniforms.dyeTexelSize, dye.texelSizeX, dye.texelSizeY);
    gl.uniform1i(advectionProgram.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(advectionProgram.uniforms.uSource, dye.read.attach(1));
    gl.uniform1f(advectionProgram.uniforms.dissipation, config.DENSITY_DISSIPATION);
    blit(dye.write);
    dye.swap();
  }

  function render(target) {
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.BLEND);
    var width = target == null ? gl.drawingBufferWidth : target.width;
    var height = target == null ? gl.drawingBufferHeight : target.height;
    displayMaterial.bind();
    if (config.SHADING) gl.uniform2f(displayMaterial.uniforms.texelSize, 1 / width, 1 / height);
    gl.uniform1i(displayMaterial.uniforms.uTexture, dye.read.attach(0));
    blit(target);
  }

  function splatPointer(pointer) {
    var dx = pointer.deltaX * config.SPLAT_FORCE;
    var dy = pointer.deltaY * config.SPLAT_FORCE;
    splat(pointer.texcoordX, pointer.texcoordY, dx, dy, pointer.color);
  }

  function clickSplat(pointer) {
    var color = generateColor();
    color.r *= 10; color.g *= 10; color.b *= 10;
    var dx = 10 * (Math.random() - 0.5);
    var dy = 30 * (Math.random() - 0.5);
    splat(pointer.texcoordX, pointer.texcoordY, dx, dy, color);
  }

  function splat(x, y, dx, dy, color) {
    splatProgram.bind();
    gl.uniform1i(splatProgram.uniforms.uTarget, velocity.read.attach(0));
    gl.uniform1f(splatProgram.uniforms.aspectRatio, canvas.width / canvas.height);
    gl.uniform2f(splatProgram.uniforms.point, x, y);
    gl.uniform3f(splatProgram.uniforms.color, dx, dy, 0);
    gl.uniform1f(splatProgram.uniforms.radius, correctRadius(config.SPLAT_RADIUS / 100));
    blit(velocity.write);
    velocity.swap();

    gl.uniform1i(splatProgram.uniforms.uTarget, dye.read.attach(0));
    gl.uniform3f(splatProgram.uniforms.color, color.r, color.g, color.b);
    blit(dye.write);
    dye.swap();
  }

  function correctRadius(radius) {
    var aspectRatio = canvas.width / canvas.height;
    if (aspectRatio > 1) radius *= aspectRatio;
    return radius;
  }

  function updatePointerDownData(pointer, id, posX, posY) {
    pointer.id = id;
    pointer.down = true;
    pointer.moved = false;
    pointer.texcoordX = posX / canvas.width;
    pointer.texcoordY = 1 - posY / canvas.height;
    pointer.prevTexcoordX = pointer.texcoordX;
    pointer.prevTexcoordY = pointer.texcoordY;
    pointer.deltaX = 0;
    pointer.deltaY = 0;
    pointer.color = generateColor();
  }

  function updatePointerMoveData(pointer, posX, posY, color) {
    pointer.prevTexcoordX = pointer.texcoordX;
    pointer.prevTexcoordY = pointer.texcoordY;
    pointer.texcoordX = posX / canvas.width;
    pointer.texcoordY = 1 - posY / canvas.height;
    pointer.deltaX = correctDeltaX(pointer.texcoordX - pointer.prevTexcoordX);
    pointer.deltaY = correctDeltaY(pointer.texcoordY - pointer.prevTexcoordY);
    pointer.moved = Math.abs(pointer.deltaX) > 0 || Math.abs(pointer.deltaY) > 0;
    pointer.color = color;
  }

  function correctDeltaX(delta) {
    var aspectRatio = canvas.width / canvas.height;
    if (aspectRatio < 1) delta *= aspectRatio;
    return delta;
  }

  function correctDeltaY(delta) {
    var aspectRatio = canvas.width / canvas.height;
    if (aspectRatio > 1) delta /= aspectRatio;
    return delta;
  }

  function hexToRGB(hex) {
    var val = hex.replace("#", "");
    if (val.length === 3) val = val[0] + val[0] + val[1] + val[1] + val[2] + val[2];
    return {
      r: parseInt(val.slice(0, 2), 16) / 255,
      g: parseInt(val.slice(2, 4), 16) / 255,
      b: parseInt(val.slice(4, 6), 16) / 255
    };
  }

  var brand = hexToRGB(config.COLOR);
  function generateColor() {
    // brand crimson with a light intensity jitter so trails feel organic
    var k = 0.10 + Math.random() * 0.08;
    return { r: brand.r * k, g: brand.g * k, b: brand.b * k };
  }

  function getResolution(resolution) {
    var aspectRatio = gl.drawingBufferWidth / gl.drawingBufferHeight;
    if (aspectRatio < 1) aspectRatio = 1 / aspectRatio;
    var min = Math.round(resolution);
    var max = Math.round(resolution * aspectRatio);
    if (gl.drawingBufferWidth > gl.drawingBufferHeight) return { width: max, height: min };
    return { width: min, height: max };
  }

  function scaleByPixelRatio(input) {
    var pixelRatio = Math.min(window.devicePixelRatio || 1, 1.25);
    return Math.floor(input * pixelRatio);
  }

  window.addEventListener("mousedown", function (e) {
    wake();
    var pointer = pointers[0];
    var posX = scaleByPixelRatio(e.clientX);
    var posY = scaleByPixelRatio(e.clientY);
    updatePointerDownData(pointer, -1, posX, posY);
    clickSplat(pointer);
  }, { passive: true });

  var firstMouseMoveHandled = false;
  window.addEventListener("mousemove", function (e) {
    wake();
    var pointer = pointers[0];
    var posX = scaleByPixelRatio(e.clientX);
    var posY = scaleByPixelRatio(e.clientY);
    if (!firstMouseMoveHandled) {
      updatePointerMoveData(pointer, posX, posY, generateColor());
      firstMouseMoveHandled = true;
    } else {
      updatePointerMoveData(pointer, posX, posY, pointer.color);
    }
  }, { passive: true });

  window.addEventListener("touchstart", function (e) {
    wake();
    var touches = e.targetTouches;
    var pointer = pointers[0];
    for (var i = 0; i < touches.length; i++) {
      var posX = scaleByPixelRatio(touches[i].clientX);
      var posY = scaleByPixelRatio(touches[i].clientY);
      updatePointerDownData(pointer, touches[i].identifier, posX, posY);
    }
  }, { passive: true });

  window.addEventListener("touchmove", function (e) {
    wake();
    var touches = e.targetTouches;
    var pointer = pointers[0];
    for (var i = 0; i < touches.length; i++) {
      var posX = scaleByPixelRatio(touches[i].clientX);
      var posY = scaleByPixelRatio(touches[i].clientY);
      updatePointerMoveData(pointer, posX, posY, pointer.color);
    }
  }, { passive: true });

  window.addEventListener("touchend", function () {
    pointers[0].down = false;
  }, { passive: true });

  updateFrame();
})();
