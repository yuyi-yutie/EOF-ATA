'use strict';

/* ============================================================
   R — 极简 WebGL 渲染器（零依赖）
   1) 场景渲染到离屏缓冲：方块 + 两段色阶 + 地面投影阴影
   2) 全屏后处理：深度边缘检测 → 均匀墨线（不会断、不会黑块）
   ============================================================ */

const R = (function () {
  let gl = null;
  let W = 1, H = 1, dpr = 1;
  let progSolid = null, progShadow = null, progPost = null, progNormal = null;
  let vpMat = new Float32Array(16);
  let viewMat = new Float32Array(16);
  let camPos = [0, 0, 0];
  let camFwd = [0, 0, -1], camRight = [1, 0, 0], camUp = [0, 1, 0];
  let camTan = 0.4, camAspect = 1;
  let visionOn = false;
  let visionPos = [0, 0], visionYaw = 0, visionHalf = Math.PI, visionRange = 24, visionSoft = 0.061;
  let visionShade = 0.42;
  let sky = [0.26, 0.29, 0.33];
  let fogRange = [30, 78];
  const NEAR = 0.2, FAR = 260;
  const SHADOW_COL = [0.335, 0.295, 0.285];
  const INK = [0.086, 0.075, 0.059];

  let fbo = null, colTex = null, depTex = null, fboN = null, nrmTex = null, fboW = 0, fboH = 0;
  let fboM = null, maskTex = null;
  let fboS = null, shadowTex = null;
  let quadBuf = null;

  /* ---------- 数学 ---------- */
  function mat4() { return new Float32Array(16); }

  function mul(o, a, b) {
    for (let c = 0; c < 4; c++) {
      const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
      o[c * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
      o[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
      o[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
      o[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
    }
    return o;
  }

  function persp(o, fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy * Math.PI / 360);
    o.fill(0);
    o[0] = f / aspect;
    o[5] = f;
    o[10] = (far + near) / (near - far);
    o[11] = -1;
    o[14] = (2 * far * near) / (near - far);
    return o;
  }

  function lookAt(o, eye, center, up) {
    let zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
    let l = Math.hypot(zx, zy, zz) || 1;
    zx /= l; zy /= l; zz /= l;
    let xx = up[1] * zz - up[2] * zy;
    let xy = up[2] * zx - up[0] * zz;
    let xz = up[0] * zy - up[1] * zx;
    l = Math.hypot(xx, xy, xz) || 1;
    xx /= l; xy /= l; xz /= l;
    const yx = zy * xz - zz * xy;
    const yy = zz * xx - zx * xz;
    const yz = zx * xy - zy * xx;
    o[0] = xx; o[1] = yx; o[2] = zx; o[3] = 0;
    o[4] = xy; o[5] = yy; o[6] = zy; o[7] = 0;
    o[8] = xz; o[9] = yz; o[10] = zz; o[11] = 0;
    o[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
    o[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
    o[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
    o[15] = 1;
    return o;
  }

  function boxMatrix(o, x, y, z, yaw, rx, px, py, pz) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cx = Math.cos(rx), sx = Math.sin(rx);
    const r00 = cy, r01 = sy * sx, r02 = sy * cx;
    const r10 = 0, r11 = cx, r12 = -sx;
    const r20 = -sy, r21 = cy * sx, r22 = cy * cx;
    o[0] = r00; o[1] = r10; o[2] = r20; o[3] = 0;
    o[4] = r01; o[5] = r11; o[6] = r21; o[7] = 0;
    o[8] = r02; o[9] = r12; o[10] = r22; o[11] = 0;
    o[12] = x + px - (r00 * px + r01 * py + r02 * pz);
    o[13] = y + py - (r10 * px + r11 * py + r12 * pz);
    o[14] = z + pz - (r20 * px + r21 * py + r22 * pz);
    o[15] = 1;
    return o;
  }

  /* ---------- 单位立方体 ---------- */
  const CORNER = [
    [-1, -1, -1], [1, -1, -1], [-1, 1, -1], [1, 1, -1],
    [-1, -1, 1], [1, -1, 1], [-1, 1, 1], [1, 1, 1]
  ];
  const FACE_DEF = [
    { n: [1, 0, 0], q: [1, 3, 7, 5] },
    { n: [-1, 0, 0], q: [0, 4, 6, 2] },
    { n: [0, 1, 0], q: [2, 6, 7, 3] },
    { n: [0, -1, 0], q: [0, 1, 5, 4] },
    { n: [0, 0, 1], q: [4, 5, 7, 6] },
    { n: [0, 0, -1], q: [0, 2, 3, 1] }
  ];
  const FACES = FACE_DEF.map(function (f) {
    const a = CORNER[f.q[0]], b = CORNER[f.q[1]], c = CORNER[f.q[2]];
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const dot = cr[0] * f.n[0] + cr[1] * f.n[1] + cr[2] * f.n[2];
    return { n: f.n, q: dot < 0 ? [f.q[0], f.q[3], f.q[2], f.q[1]] : f.q };
  });

  /* ---------- 着色器 ---------- */
  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      console.error(log, src);
      throw new Error('shader: ' + log);
    }
    return s;
  }

  function program(vs, fs, attribs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    for (const k in attribs) gl.bindAttribLocation(p, attribs[k], k);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error('link: ' + gl.getProgramInfoLog(p));
    }
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      u[info.name] = gl.getUniformLocation(p, info.name);
    }
    return { p: p, u: u };
  }

  const VS_SOLID = [
    'attribute vec3 aPos; attribute vec3 aNrm; attribute vec3 aCol; attribute float aEmis;',
    'uniform mat4 uVP; uniform vec3 uCam;',
    'varying vec3 vN; varying vec3 vCol; varying float vEmis; varying float vDist;',
    'void main(){',
    '  vN = aNrm; vCol = aCol; vEmis = aEmis;',
    '  vDist = distance(aPos, uCam);',
    '  gl_Position = uVP * vec4(aPos, 1.0);',
    '}'
  ].join('\n');

  const FS_SOLID = [
    'precision mediump float;',
    'varying vec3 vN; varying vec3 vCol; varying float vEmis; varying float vDist;',
    'uniform vec3 uL; uniform vec3 uFog; uniform vec2 uFogRange;',
    'void main(){',
    '  vec3 c;',
    '  if (vEmis > 0.5) { c = vCol; }',
    '  else {',
    '    vec3 n = normalize(vN);',
    '    float d = max(dot(n, uL), 0.0);',
    '    vec3 sh = vCol * 0.50 + vec3(0.05, 0.07, 0.12);',
    '    vec3 hi = min(vCol * 1.14 + 0.02, vec3(1.0));',
    '    float a = smoothstep(0.24, 0.36, d);',
    '    float b = smoothstep(0.68, 0.80, d);',
    '    c = mix(sh, vCol, a);',
    '    c = mix(c, hi, b);',
    '  }',
    '  float f = clamp((vDist - uFogRange.x) / (uFogRange.y - uFogRange.x), 0.0, 1.0);',
    '  c = mix(c, uFog, f * 0.85);',
    '  gl_FragColor = vec4(c, 1.0);',
    '}'
  ].join('\n');

  const VS_FLAT = [
    'attribute vec3 aPos;',
    'uniform mat4 uVP;',
    'void main(){ gl_Position = uVP * vec4(aPos, 1.0); }'
  ].join('\n');

  const FS_FLAT = [
    'precision mediump float;',
    'uniform vec3 uColor; uniform float uAlpha;',
    'void main(){ gl_FragColor = vec4(uColor, uAlpha); }'
  ].join('\n');

  /* 法线通道：给折边检测用 */
  const VS_NRM = [
    'attribute vec3 aPos; attribute vec3 aNrm;',
    'uniform mat4 uVP;',
    'varying vec3 vN;',
    'void main(){ vN = aNrm; gl_Position = uVP * vec4(aPos, 1.0); }'
  ].join('\n');

  const FS_NRM = [
    'precision mediump float;',
    'varying vec3 vN;',
    'void main(){ vec3 n = normalize(vN); gl_FragColor = vec4(n * 0.5 + 0.5, 1.0); }'
  ].join('\n');

  /* 全屏后处理：深度 + 法线边缘 → 墨线 */
  const VS_POST = [
    'attribute vec2 aPos;',
    'varying vec2 vUv;',
    'void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }'
  ].join('\n');

  const FS_POST = [
    'precision mediump float;',
    'varying vec2 vUv;',
    'uniform sampler2D uColor; uniform sampler2D uDepth; uniform sampler2D uNormal; uniform sampler2D uMask;',
    'uniform vec2 uTexel; uniform float uNear; uniform float uFar;',
    'uniform vec3 uInk; uniform float uThresh;',
    'uniform vec3 uCamPos; uniform vec3 uCamFwd; uniform vec3 uCamRight; uniform vec3 uCamUp;',
    'uniform float uTanHalf; uniform float uAspect;',
    'uniform vec2 uVisionPos;',
    'uniform float uVisionRange; uniform float uVisionOn;',
    'uniform float uVisionShade;',
    'uniform sampler2D uShadowTex;',
    'float lin(float d){',
    '  float z = d * 2.0 - 1.0;',
    '  return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear));',
    '}',
    'float dep(vec2 uv){ return lin(texture2D(uDepth, uv).r); }',
    'vec3 worldAt(vec2 uv){',
    '  float vz = lin(texture2D(uDepth, uv).r);',
    '  vec2 ndc = uv * 2.0 - 1.0;',
    '  return uCamPos + uCamFwd * vz',
    '    + uCamRight * (ndc.x * uTanHalf * uAspect * vz)',
    '    + uCamUp * (ndc.y * uTanHalf * vz);',
    '}',
    'void main(){',
    '  float d0 = dep(vUv);',
    '  vec2 t = uTexel;',
    '  float m = 0.0;',
    '  vec2 t1 = t * 1.4;',
    '  vec2 t2 = t * 2.8;',
    '  vec2 t3 = t * 5.0;',
    '  vec2 t4 = t * 10.0;',
    '  m = max(m, abs(d0 - dep(vUv + vec2(t1.x, 0.0))));',
    '  m = max(m, abs(d0 - dep(vUv - vec2(t1.x, 0.0))));',
    '  m = max(m, abs(d0 - dep(vUv + vec2(0.0, t1.y))));',
    '  m = max(m, abs(d0 - dep(vUv - vec2(0.0, t1.y))));',
    '  m = max(m, abs(d0 - dep(vUv + vec2(t2.x, 0.0))) * 0.7);',
    '  m = max(m, abs(d0 - dep(vUv - vec2(t2.x, 0.0))) * 0.7);',
    '  m = max(m, abs(d0 - dep(vUv + vec2(0.0, t2.y))) * 0.7);',
    '  m = max(m, abs(d0 - dep(vUv - vec2(0.0, t2.y))) * 0.7);',
    '  float rel = m / max(d0, 0.35);',
    '  float eD = smoothstep(uThresh, uThresh * 2.2, rel);',
    '  vec3 n0 = texture2D(uNormal, vUv).xyz * 2.0 - 1.0;',
    '  vec3 n1 = texture2D(uNormal, vUv + vec2(t1.x, 0.0)).xyz * 2.0 - 1.0;',
    '  vec3 n2 = texture2D(uNormal, vUv - vec2(t1.x, 0.0)).xyz * 2.0 - 1.0;',
    '  vec3 n3 = texture2D(uNormal, vUv + vec2(0.0, t1.y)).xyz * 2.0 - 1.0;',
    '  vec3 n4 = texture2D(uNormal, vUv - vec2(0.0, t1.y)).xyz * 2.0 - 1.0;',
    '  vec3 n5 = texture2D(uNormal, vUv + vec2(t2.x, 0.0)).xyz * 2.0 - 1.0;',
    '  vec3 n6 = texture2D(uNormal, vUv - vec2(t2.x, 0.0)).xyz * 2.0 - 1.0;',
    '  vec3 n7 = texture2D(uNormal, vUv + vec2(0.0, t2.y)).xyz * 2.0 - 1.0;',
    '  vec3 n8 = texture2D(uNormal, vUv - vec2(0.0, t2.y)).xyz * 2.0 - 1.0;',
    '  float nd = min(min(min(dot(n0, n1), dot(n0, n2)), min(dot(n0, n3), dot(n0, n4))),',
    '                 min(min(dot(n0, n5), dot(n0, n6)), min(dot(n0, n7), dot(n0, n8))) * 0.98);',
    '  float eN = smoothstep(0.99, 0.93, nd);',
    '  float e = max(eD, eN * 0.92);',
    '  float un0 = texture2D(uMask, vUv).b;',
    '  float un = un0;',
    '  un = max(un, texture2D(uMask, vUv + vec2(t2.x, 0.0)).b);',
    '  un = max(un, texture2D(uMask, vUv - vec2(t2.x, 0.0)).b);',
    '  un = max(un, texture2D(uMask, vUv + vec2(0.0, t2.y)).b);',
    '  un = max(un, texture2D(uMask, vUv - vec2(0.0, t2.y)).b);',
    '  un = max(un, texture2D(uMask, vUv + vec2(t3.x, 0.0)).b);',
    '  un = max(un, texture2D(uMask, vUv - vec2(t3.x, 0.0)).b);',
    '  un = max(un, texture2D(uMask, vUv + vec2(0.0, t3.y)).b);',
    '  un = max(un, texture2D(uMask, vUv - vec2(0.0, t3.y)).b);',
    '  e *= 1.0 - un;',
    '  float im0 = texture2D(uMask, vUv).r;',
    '  float im = im0;',
    '  float block = 0.0;',
    '  vec2 offs[8];',
    '  offs[0] = vec2(t2.x, 0.0); offs[1] = vec2(-t2.x, 0.0);',
    '  offs[2] = vec2(0.0, t2.y); offs[3] = vec2(0.0, -t2.y);',
    '  offs[4] = vec2(t3.x, 0.0); offs[5] = vec2(-t3.x, 0.0);',
    '  offs[6] = vec2(0.0, t3.y); offs[7] = vec2(0.0, -t3.y);',
    '  for (int k = 0; k < 8; k++) {',
    '    vec2 uv2 = vUv + offs[k];',
    '    float mv = texture2D(uMask, uv2).r;',
    '    float dn = dep(uv2);',
    '    if (mv > 0.5) {',
    '      im = max(im, step(dn - 0.18, d0));',
    '    } else if (dn < d0 - 0.8) {',
    '      block = 1.0;',
    '    }',
    '  }',
    /* 更宽的遮挡检测：前方有不可互动物体时，整圈白边让位给遮挡物的黑描边 */
    '  vec2 offsB[4];',
    '  offsB[0] = vec2(t4.x, 0.0); offsB[1] = vec2(-t4.x, 0.0);',
    '  offsB[2] = vec2(0.0, t4.y); offsB[3] = vec2(0.0, -t4.y);',
    '  for (int k2 = 0; k2 < 4; k2++) {',
    '    vec2 uvb = vUv + offsB[k2];',
    '    if (texture2D(uMask, uvb).r < 0.5 && dep(uvb) < d0 - 0.8) block = 1.0;',
    '  }',
    '  float mn = texture2D(uMask, vUv + vec2(t3.x, 0.0)).r;',
    '  mn = min(mn, texture2D(uMask, vUv - vec2(t3.x, 0.0)).r);',
    '  mn = min(mn, texture2D(uMask, vUv + vec2(0.0, t3.y)).r);',
    '  mn = min(mn, texture2D(uMask, vUv - vec2(0.0, t3.y)).r);',
    '  float band = clamp(im, 0.0, 1.0) * (1.0 - block);',
    '  float nearBand = band * (1.0 - mn);',
    '  vec3 ink = mix(uInk, vec3(0.97, 0.98, 1.0), band);',
    '  vec3 c = texture2D(uColor, vUv).rgb;',
    '  c = mix(c, ink, max(e, nearBand * 0.92));',
    '  float ux1 = texture2D(uMask, vUv + vec2(t1.x, 0.0)).b;',
    '  float ux2 = texture2D(uMask, vUv - vec2(t1.x, 0.0)).b;',
    '  float uy1 = texture2D(uMask, vUv + vec2(0.0, t1.y)).b;',
    '  float uy2 = texture2D(uMask, vUv - vec2(0.0, t1.y)).b;',
    '  float unitEdge = max(max(abs(un0 - ux1), abs(un0 - ux2)), max(abs(un0 - uy1), abs(un0 - uy2)));',
    '  c = mix(c, uInk, clamp(unitEdge, 0.0, 1.0) * 0.92);',
    '  if (uVisionOn > 0.5) {',
    '    vec3 P = worldAt(vUv);',
    '    vec2 rel = P.xz - uVisionPos;',
    '    float vd = length(rel);',
    '    float shadow = step(0.5, texture2D(uShadowTex, vUv).r);',
    '    float inRange = step(vd, uVisionRange);',
    '    float ground = smoothstep(0.55, 0.85, n0.y) * (1.0 - smoothstep(0.035, 0.10, P.y));',
    '    c *= mix(1.0, uVisionShade, shadow * inRange * ground);',
    '  }',
    '  gl_FragColor = vec4(c, 1.0);',
    '}'
  ].join('\n');

  /* ---------- 几何批 ---------- */
  function Geo() {
    this.solid = [];
    this.shadow = [];
    this.bufS = null; this.bufW = null;
    this.nS = -1; this.nW = -1;
  }

  const _m = mat4();
  const _c = new Float32Array(24);

  function convexHull(pts) {
    const p = pts.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    if (p.length < 3) return p;
    const cross = function (o, a, b) {
      return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    };
    const lower = [];
    for (let i = 0; i < p.length; i++) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p[i]) <= 0) lower.pop();
      lower.push(p[i]);
    }
    const upper = [];
    for (let i = p.length - 1; i >= 0; i--) {
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p[i]) <= 0) upper.pop();
      upper.push(p[i]);
    }
    lower.pop(); upper.pop();
    const out = lower.concat(upper);
    return out.length >= 3 ? out : p;
  }

  Geo.prototype.box = function (o) {
    const sx = o.sx * 0.5, sy = o.sy * 0.5, sz = o.sz * 0.5;
    const yaw = o.yaw || 0, rx = o.rotX || 0;
    boxMatrix(_m, o.x, o.y, o.z, yaw, rx, o.px || 0, o.py || 0, o.pz || 0);
    const m = _m;
    const col = o.color;
    const emis = o.emis ? 1 : 0;
    const draw = !o.castOnly;

    for (let i = 0; i < 8; i++) {
      const c = CORNER[i];
      const lx = c[0] * sx, ly = c[1] * sy, lz = c[2] * sz;
      _c[i * 3] = m[0] * lx + m[4] * ly + m[8] * lz + m[12];
      _c[i * 3 + 1] = m[1] * lx + m[5] * ly + m[9] * lz + m[13];
      _c[i * 3 + 2] = m[2] * lx + m[6] * ly + m[10] * lz + m[14];
    }

    if (draw) {
      const S = this.solid;
      for (let f = 0; f < 6; f++) {
        const face = FACES[f];
        const nX = face.n[0], nY = face.n[1], nZ = face.n[2];
        const wx = m[0] * nX + m[4] * nY + m[8] * nZ;
        const wy = m[1] * nX + m[5] * nY + m[9] * nZ;
        const wz = m[2] * nX + m[6] * nY + m[10] * nZ;
        const q = face.q;
        const tri = [q[0] * 3, q[1] * 3, q[2] * 3, q[0] * 3, q[2] * 3, q[3] * 3];
        for (let t = 0; t < 6; t++) {
          const k = tri[t];
          S.push(_c[k], _c[k + 1], _c[k + 2], wx, wy, wz, col[0], col[1], col[2], emis);
        }
      }
    }

    if (o.shadow || o.castOnly) {
      const pts = [];
      for (let i = 0; i < 8; i++) {
        const x = _c[i * 3], y = _c[i * 3 + 1], z = _c[i * 3 + 2];
        if (y <= 0.001) { pts.push([x, z]); continue; }
        const t = y / LIGHT[1];
        pts.push([x - LIGHT[0] * t, z - LIGHT[2] * t]);
      }
      const hull = convexHull(pts);
      const W2 = this.shadow;
      for (let i = 1; i + 1 < hull.length; i++) {
        W2.push(hull[0][0], 0.03, hull[0][1], hull[i][0], 0.03, hull[i][1], hull[i + 1][0], 0.03, hull[i + 1][1]);
      }
    }
  };

  /* 外部三角网格（OBJ 导入）：数据为每顶点 10 个数
     pos3 + normal3 + color3 + emissive1 */
  Geo.prototype.mesh = function (mesh, o) {
    if (!mesh || !mesh.length) return;
    o = o || {};
    const yaw = o.yaw || 0, rx = o.rotX || 0;
    boxMatrix(_m, o.x || 0, o.y || 0, o.z || 0, yaw, rx, o.px || 0, o.py || 0, o.pz || 0);
    const m = _m;
    const S = this.solid;
    const sc = o.scale || 1;
    const px0 = o.px || 0, py0 = o.py || 0, pz0 = o.pz || 0;
    for (let i = 0; i < mesh.length; i += 10) {
      let lx = mesh[i], ly = mesh[i + 1], lz = mesh[i + 2];
      if (sc !== 1) {
        lx = px0 + (lx - px0) * sc;
        ly = py0 + (ly - py0) * sc;
        lz = pz0 + (lz - pz0) * sc;
      }
      const nx0 = mesh[i + 3], ny0 = mesh[i + 4], nz0 = mesh[i + 5];
      const r = o.color ? o.color[0] : mesh[i + 6];
      const g = o.color ? o.color[1] : mesh[i + 7];
      const b = o.color ? o.color[2] : mesh[i + 8];
      const emis = (o.emis !== undefined) ? (o.emis ? 1 : 0) : mesh[i + 9];
      const wx = m[0] * lx + m[4] * ly + m[8] * lz + m[12];
      const wy = m[1] * lx + m[5] * ly + m[9] * lz + m[13];
      const wz = m[2] * lx + m[6] * ly + m[10] * lz + m[14];
      let nx = m[0] * nx0 + m[4] * ny0 + m[8] * nz0;
      let ny = m[1] * nx0 + m[5] * ny0 + m[9] * nz0;
      let nz = m[2] * nx0 + m[6] * ny0 + m[10] * nz0;
      const nl = Math.hypot(nx, ny, nz) || 1;
      S.push(wx, wy, wz, nx / nl, ny / nl, nz / nl, r, g, b, emis);
    }
  };

  /* 水平面（地板砖）：无光照、无描边 */
  Geo.prototype.plane = function (o) {
    const x = o.x, y = o.y, z = o.z;
    const hx = o.sx * 0.5, hz = o.sz * 0.5;
    const c = o.color;
    const S = this.solid;
    const p = [[x - hx, z - hz], [x + hx, z - hz], [x + hx, z + hz], [x - hx, z + hz]];
    const tri = [0, 2, 1, 0, 3, 2];
    for (let t = 0; t < 6; t++) {
      const q = p[tri[t]];
      S.push(q[0], y, q[1], 0, 1, 0, c[0], c[1], c[2], 1);
    }
  };

  /* 水平三角形（扇形冲击区等） */
  Geo.prototype.tri = function (ax, az, bx, bz, cx, cz, y, color, emis) {
    const S = this.solid;
    const e = emis === false ? 0 : 1;
    S.push(ax, y, az, 0, 1, 0, color[0], color[1], color[2], e);
    S.push(cx, y, cz, 0, 1, 0, color[0], color[1], color[2], e);
    S.push(bx, y, bz, 0, 1, 0, color[0], color[1], color[2], e);
  };

  /* 地面圆弧带（冲击波、燃烧圈） */
  Geo.prototype.arc = function (cx, cz, r1, r2, a0, a1, y, color, segs) {
    segs = segs || 14;
    const S = this.solid;
    const c0 = color[0], c1 = color[1], c2 = color[2];
    const push = function (x, z) { S.push(x, y, z, 0, 1, 0, c0, c1, c2, 1); };
    for (let i = 0; i < segs; i++) {
      const t0 = a0 + (a1 - a0) * (i / segs);
      const t1 = a0 + (a1 - a0) * ((i + 1) / segs);
      const s0 = Math.sin(t0), k0 = Math.cos(t0);
      const s1 = Math.sin(t1), k1 = Math.cos(t1);
      const ax = cx + s0 * r1, az = cz + k0 * r1;
      const bx = cx + s1 * r1, bz = cz + k1 * r1;
      const dx = cx + s1 * r2, dz = cz + k1 * r2;
      const ex = cx + s0 * r2, ez = cz + k0 * r2;
      push(ax, az); push(dx, dz); push(bx, bz);
      push(ax, az); push(ex, ez); push(dx, dz);
      push(ax, az); push(bx, bz); push(dx, dz);
      push(ax, az); push(dx, dz); push(ex, ez);
    }
  };

  Geo.prototype.upload = function () {
    if (!this.bufS || this.nS !== this.solid.length) {
      if (!this.bufS) this.bufS = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bufS);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.solid), gl.DYNAMIC_DRAW);
      this.nS = this.solid.length;
    }
    if (!this.bufW || this.nW !== this.shadow.length) {
      if (!this.bufW) this.bufW = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bufW);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.shadow), gl.DYNAMIC_DRAW);
      this.nW = this.shadow.length;
    }
  };

  Geo.prototype.clear = function () {
    this.solid.length = 0;
    this.shadow.length = 0;
    this.nS = this.nW = -1;
  };

  Geo.prototype.drawSolid = function () {
    if (!this.nS || this.nS <= 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufS);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 40, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 40, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 40, 24);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 40, 36);
    gl.drawArrays(gl.TRIANGLES, 0, this.nS / 10);
  };

  Geo.prototype.drawShadow = function () {
    if (!this.nW || this.nW <= 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, this.nW / 3);
  };

  const staticGeo = new Geo();
  const dynGeo = new Geo();
  const overlayGeo = new Geo();
  const maskGeo = new Geo();
  const unitMaskGeo = new Geo();
  const shadowGeo = new Geo();
  const dynXGeo = new Geo();   // 最后叠在画面上、忽略深度的效果层（声波穿墙）

  /* ---------- 离屏目标 ---------- */
  function ensureTargets(w, h) {
    if (fbo && fboW === w && fboH === h) return;
    if (!fbo) {
      fbo = gl.createFramebuffer();
      fboN = gl.createFramebuffer();
      fboM = gl.createFramebuffer();
      colTex = gl.createTexture();
      depTex = gl.createTexture();
      nrmTex = gl.createTexture();
      maskTex = gl.createTexture();
      fboS = gl.createFramebuffer();
      shadowTex = gl.createTexture();
    }
    gl.bindTexture(gl.TEXTURE_2D, colTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindTexture(gl.TEXTURE_2D, depTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, w, h, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindTexture(gl.TEXTURE_2D, nrmTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindTexture(gl.TEXTURE_2D, maskTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindTexture(gl.TEXTURE_2D, shadowTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colTex, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depTex, 0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, fboN);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, nrmTex, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depTex, 0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, fboM);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, maskTex, 0);
    /* 复用主场景深度：遮罩只记录真正可见的交互物像素 */
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depTex, 0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, fboS);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, shadowTex, 0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    fboW = w; fboH = h;
  }

  /* ---------- 对外 ---------- */
  function init(canvas) {
    gl = canvas.getContext('webgl2', { antialias: false, alpha: false })
      || canvas.getContext('webgl', { antialias: false, alpha: false });
    if (!gl) throw new Error('WebGL 不可用');

    progSolid = program(VS_SOLID, FS_SOLID, { aPos: 0, aNrm: 1, aCol: 2, aEmis: 3 });
    progShadow = program(VS_FLAT, FS_FLAT, { aPos: 0 });
    progPost = program(VS_POST, FS_POST, { aPos: 0 });
    progNormal = program(VS_NRM, FS_NRM, { aPos: 0, aNrm: 1 });

    quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 3, -1, -1, 3
    ]), gl.STATIC_DRAW);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    resize(canvas);
    return gl;
  }

  function resize(canvas) {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(320, canvas.clientWidth || window.innerWidth);
    const h = Math.max(240, canvas.clientHeight || window.innerHeight);
    W = Math.floor(w * dpr);
    H = Math.floor(h * dpr);
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    ensureTargets(W, H);
  }

  function setCamera(eye, target, fovDeg) {
    camPos = [eye[0], eye[1], eye[2]];
    let fx = target[0] - eye[0], fy = target[1] - eye[1], fz = target[2] - eye[2];
    let fl = Math.hypot(fx, fy, fz) || 1;
    camFwd = [fx / fl, fy / fl, fz / fl];
    /* right = cross(fwd, up)（与 lookAt 的相机基一致） */
    let rx = -camFwd[2], ry = 0, rz = camFwd[0];
    let rl = Math.hypot(rx, ry, rz) || 1;
    camRight = [rx / rl, 0, rz / rl];
    camUp = [
      camRight[1] * camFwd[2] - camRight[2] * camFwd[1],
      camRight[2] * camFwd[0] - camRight[0] * camFwd[2],
      camRight[0] * camFwd[1] - camRight[1] * camFwd[0]
    ];
    camTan = Math.tan(fovDeg * Math.PI / 360);
    camAspect = W / H;
    const proj = persp(mat4(), fovDeg, W / H, NEAR, FAR);
    lookAt(viewMat, eye, target, [0, 1, 0]);
    mul(vpMat, proj, viewMat);
  }

  function begin() {
    ensureTargets(W, H);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, W, H);
    gl.clearColor(sky[0], sky[1], sky[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    dynGeo.clear();
    overlayGeo.clear();
    unitMaskGeo.clear();
    shadowGeo.clear();
    dynXGeo.clear();
    maskGeo.clear();
  }

  function useSolid() {
    gl.useProgram(progSolid.p);
    gl.uniformMatrix4fv(progSolid.u.uVP, false, vpMat);
    gl.uniform3fv(progSolid.u.uCam, camPos);
    gl.uniform3fv(progSolid.u.uL, LIGHT);
    gl.uniform3fv(progSolid.u.uFog, sky);
    gl.uniform2fv(progSolid.u.uFogRange, fogRange);
  }

  function buildStatic(fn) {
    staticGeo.clear();
    fn(staticGeo);
    staticGeo.upload();
  }

  function drawScene() {
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    useSolid();
    staticGeo.drawSolid();

    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(progShadow.p);
    gl.uniformMatrix4fv(progShadow.u.uVP, false, vpMat);
    gl.uniform3f(progShadow.u.uColor, SHADOW_COL[0], SHADOW_COL[1], SHADOW_COL[2]);
    gl.uniform1f(progShadow.u.uAlpha, 1.0);
    staticGeo.drawShadow();
    dynGeo.drawShadow();

    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    /* 覆盖层必须画在动态几何之前：此时深度缓冲里只有墙体/地板，
       纯色只会落在真正被墙挡住的人物像素上；人物自己可见的部分随后正常覆盖。 */
    drawOverlay();
    useSolid();
    dynGeo.drawSolid();
  }

  /* 角色被墙挡住时：只把被墙遮住的部分用纯色覆盖出来 */
  function drawOverlay() {
    if (!overlayGeo.nS || overlayGeo.nS <= 0) return;
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.GREATER);
    gl.depthMask(false);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.disable(gl.BLEND);
    gl.useProgram(progShadow.p);
    gl.uniformMatrix4fv(progShadow.u.uVP, false, vpMat);
    gl.uniform3f(progShadow.u.uColor, 1.0, 0.56, 0.14);
    gl.uniform1f(progShadow.u.uAlpha, 1.0);
    gl.bindBuffer(gl.ARRAY_BUFFER, overlayGeo.bufS);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 40, 0);
    gl.drawArrays(gl.TRIANGLES, 0, overlayGeo.nS / 10);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
  }

  /* 法线 pass：复用同一张深度纹理，只写最近层的法线 */
  function drawNormals() {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fboN);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0.5, 0.5, 1.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(false);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.useProgram(progNormal.p);
    gl.uniformMatrix4fv(progNormal.u.uVP, false, vpMat);
    staticGeo.drawSolid();
    dynGeo.drawSolid();
    gl.depthMask(true);
  }

  /* 可互动物品遮罩：只记录物品覆盖的屏幕像素，用于把它们的描边染成白色 */
  function drawMask() {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fboM);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!maskGeo.nS || maskGeo.nS <= 0) return;
    /* 复用场景深度：被墙挡住的箱子不会写进遮罩，白描边也不会透墙 */
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(false);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.disable(gl.BLEND);
    gl.useProgram(progShadow.p);
    gl.uniformMatrix4fv(progShadow.u.uVP, false, vpMat);
    gl.uniform3f(progShadow.u.uColor, 1, 0, 0);
    gl.uniform1f(progShadow.u.uAlpha, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, maskGeo.bufS);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 40, 0);
    gl.drawArrays(gl.TRIANGLES, 0, maskGeo.nS / 10);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
  }

  /* 单位遮罩：把可见人物写进 mask 的蓝色通道，用于去掉人物身上的后处理粗描边 */
  function drawUnitMask() {
    if (!unitMaskGeo.nS || unitMaskGeo.nS <= 0) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fboM);
    gl.viewport(0, 0, W, H);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(false);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.disable(gl.BLEND);
    gl.useProgram(progShadow.p);
    gl.uniformMatrix4fv(progShadow.u.uVP, false, vpMat);
    gl.uniform3f(progShadow.u.uColor, 0, 0, 1);
    gl.uniform1f(progShadow.u.uAlpha, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, unitMaskGeo.bufS);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 40, 0);
    gl.drawArrays(gl.TRIANGLES, 0, unitMaskGeo.nS / 10);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
  }

  /* 硬边地面阴影遮罩：把视野遮挡多边形画成 1-bit 屏幕遮罩 */
  function drawShadowMask() {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fboS);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!shadowGeo.nS || shadowGeo.nS <= 0) return;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.useProgram(progShadow.p);
    gl.uniformMatrix4fv(progShadow.u.uVP, false, vpMat);
    gl.uniform3f(progShadow.u.uColor, 1, 1, 1);
    gl.uniform1f(progShadow.u.uAlpha, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, shadowGeo.bufS);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 40, 0);
    gl.drawArrays(gl.TRIANGLES, 0, shadowGeo.nS / 10);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
  }

  /* 忽略深度的效果层：最后画到画布上，可穿过墙体显示 */
  function drawXray() {
    if (!dynXGeo.nS || dynXGeo.nS <= 0) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.depthMask(false);
    useSolid();
    dynXGeo.drawSolid();
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
  }

  function post() {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);

    gl.useProgram(progPost.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, colTex);
    gl.uniform1i(progPost.u.uColor, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, depTex);
    gl.uniform1i(progPost.u.uDepth, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, nrmTex);
    gl.uniform1i(progPost.u.uNormal, 2);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, maskTex);
    gl.uniform1i(progPost.u.uMask, 3);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, shadowTex);
    gl.uniform1i(progPost.u.uShadowTex, 4);
    gl.uniform2f(progPost.u.uTexel, 1 / W, 1 / H);
    gl.uniform1f(progPost.u.uNear, NEAR);
    gl.uniform1f(progPost.u.uFar, FAR);
    gl.uniform3f(progPost.u.uInk, INK[0], INK[1], INK[2]);
    gl.uniform1f(progPost.u.uThresh, 0.045);
    gl.uniform3fv(progPost.u.uCamPos, camPos);
    gl.uniform3fv(progPost.u.uCamFwd, camFwd);
    gl.uniform3fv(progPost.u.uCamRight, camRight);
    gl.uniform3fv(progPost.u.uCamUp, camUp);
    gl.uniform1f(progPost.u.uTanHalf, camTan);
    gl.uniform1f(progPost.u.uAspect, camAspect);
    gl.uniform2f(progPost.u.uVisionPos, visionPos[0], visionPos[1]);
    gl.uniform1f(progPost.u.uVisionRange, visionRange);
    gl.uniform1f(progPost.u.uVisionShade, visionShade);
    gl.uniform1f(progPost.u.uVisionOn, visionOn ? 1 : 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
  }

  return {
    init: init,
    resize: resize,
    setCamera: setCamera,
    begin: begin,
    end: function () {
      dynGeo.upload();
      overlayGeo.upload();
      unitMaskGeo.upload();
      shadowGeo.upload();
      dynXGeo.upload();
      maskGeo.upload();
      drawScene();
      drawNormals();
      drawMask();
      drawUnitMask();
      drawShadowMask();
      post();
      drawXray();
    },
    buildStatic: buildStatic,
    dyn: dynGeo,
    xray: dynXGeo,
    overlay: overlayGeo,
    shadow: shadowGeo,
    unitMask: unitMaskGeo,
    mask: maskGeo,
    stat: staticGeo,
    setSky: function (c) { sky = c; },
    setFog: function (a, b) { fogRange = [a, b]; },
    setVision: function (v) {
      if (!v) { visionOn = false; return; }
      visionOn = true;
      visionPos = [v.x, v.z];
      visionYaw = v.yaw;
      visionHalf = v.half;
      visionRange = v.range;
      visionSoft = v.soft || 0.061;
      visionShade = v.shade != null ? v.shade : 0.42;
    }
  };
})();
