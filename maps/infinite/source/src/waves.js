// ============================================================================
// waves: the sea surface as simulated waves (the graphics setting "Surface: Waves")
// ============================================================================
// The wave simulation is taken from web-ocean (github.com/Noniv/web-ocean, MIT, Copyright (c) 2026 Maksymilian
// Dendura) and cut down for a sea that is only ever seen from below: a Tessendorf FFT sea of WC cascades of WN x WN
// samples (patches of WL metres), with a fetch-limited JONSWAP wind sea, Donelan-Banner spreading and a long swell.
// Every frame the spectrum is moved on in time, two passes of a radix-2 inverse FFT (rows, then columns, in workgroup
// memory) turn it into the surface, and the last of them writes two textures, each with a layer for a cascade and
// with mips: tWD the displacement (x, y, z) and tWS the slopes; the other three channels hold the surface's
// curvature (hxx, hzz in tWS, hxz in tWD), which is what focuses the sunlight into caustics and shafts (caus and
// W_RAYS in shaders.js) - in place of the original's foam terms. Left out of the original: the foam, the slope
// moments, the sky, and its own shading of the surface.
// The surface itself (surfW(1) in shaders.js) is a fan of rings around the camera, fine near it and wide far off,
// moved by tWD and shaded as the flat surface is, with the slopes from tWS in place of the water texture's.
// Without the setting nothing here is built, and `wave` stays null: the flat surface is drawn. With it every scene
// shader is built to read these textures, so a device that cannot run the simulation turns the setting off and
// loads the page again.
const W_WSIM = /*wgsl*/`
const N: u32 = ${WN}u;
const PI: f32 = 3.14159265;
const GRAV: f32 = 9.81;
const SURF: f32 = 7.4e-5;
struct Sim { L: vec4f, kMin: vec4f, kMax: vec4f, wind: vec4f, swell: vec4f, misc: vec4f, timeP: vec4f };
@group(0) @binding(0) var<uniform> S: Sim;
fn waveVec(x: u32, y: u32, L: f32) -> vec2f {
  let nx = select(i32(x), i32(x) - i32(N), x >= N / 2u);
  let ny = select(i32(y), i32(y) - i32(N), y >= N / 2u);
  return vec2f(f32(nx), f32(ny)) * (2. * PI / L);
}
fn omegaOf(k: f32) -> f32 { return sqrt(GRAV * k + SURF * k * k * k); }
fn dOmegaOf(k: f32) -> f32 { return (GRAV + 3. * SURF * k * k) / (2. * omegaOf(k)); }
fn cmul(a: vec2f, b: vec2f) -> vec2f { return vec2f(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
fn mulI(a: vec2f) -> vec2f { return vec2f(0. - a.y, a.x); }
`;
// the spectrum the sea starts from: built once
const W_WINIT = W_WSIM + /*wgsl*/`
@group(0) @binding(1) var<storage, read_write> h0: array<vec4f>;
fn pcgHash(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn rand01(s: u32) -> f32 { return (f32(pcgHash(s) >> 8u) + .5) / 16777216.; }
fn gauss2(seed: u32) -> vec2f {
  let u1 = rand01(seed * 2u + 17u);
  let u2 = rand01(seed * 2u + 18u + pcgHash(seed));
  let r = sqrt(log(u1) * (0. - 2.));
  let a = 2. * PI * u2;
  return r * vec2f(cos(a), sin(a));
}
fn wrapAngle(a: f32) -> f32 { return a - 2. * PI * floor((a + PI) / (2. * PI)); }
fn jonswap(w: f32, wp: f32, alpha: f32, gamma: f32) -> f32 {
  let sigma = select(.09, .07, w <= wp);
  let d = (w - wp) / (sigma * wp);
  let r = exp(d * d * (0. - .5));
  let q = wp / w;
  let q2 = q * q;
  return alpha * GRAV * GRAV / (w * w * w * w * w) * exp(q2 * q2 * (0. - 1.25)) * pow(gamma, r);
}
fn donelanBanner(theta: f32, w: f32, wp: f32) -> f32 {
  let ratio = w / wp;
  var beta: f32;
  if (ratio < .95) { beta = 2.61 * pow(ratio, 1.3); }
  else if (ratio < 1.6) { beta = 2.28 * pow(ratio, 0. - 1.3); }
  else { beta = pow(10., .8393 * exp(log(ratio * ratio) * (0. - .567)) - .4); }
  let sh = 1. / cosh(clamp(beta * theta, 0. - 20., 20.));
  return beta / (2. * tanh(beta * PI)) * sh * sh;
}
fn cosSpread(theta: f32, s: f32) -> f32 { return sqrt(s + .25) / (2. * sqrt(PI)) * pow(abs(cos(theta * .5)), 2. * s); }
fn spectrum(k: vec2f) -> f32 {
  let kl = length(k);
  let w = omegaOf(kl);
  let theta = atan2(k.y, k.x);
  let U = S.wind.x;
  let F = S.wind.z;
  var Sw = 0.;
  if (U > .1) {
    let alpha = .076 * pow(U * U / (F * GRAV), .22);
    let wp = 22. * pow(GRAV * GRAV / (U * F), 1. / 3.);
    Sw = jonswap(w, wp, alpha, S.wind.w) * donelanBanner(wrapAngle(theta - S.wind.y), w, wp);
  }
  if (S.swell.x > .001) {
    let ws = S.swell.z;
    let hs4 = S.swell.x * .25;
    let alphaS = hs4 * hs4 * 5. * ws * ws * ws * ws / (GRAV * GRAV) * (1. - .287 * log(6.));
    Sw += jonswap(w, ws, alphaS, 6.) * cosSpread(wrapAngle(theta - S.swell.y), S.swell.w);
  }
  let sc = S.misc.y;
  Sw *= exp(kl * kl * sc * sc * (0. - 1.));
  return Sw * dOmegaOf(kl) / kl * S.timeP.w;
}
fn amplitude(k: vec2f, c: u32) -> f32 {
  let kl = length(k);
  if (kl < 1e-5 || kl < S.kMin[c] || kl >= S.kMax[c]) { return 0.; }
  return sqrt(max(spectrum(k), 0.)) * (2. * PI / S.L[c]) * .5;
}
@compute @workgroup_size(16, 16, 1)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let c = id.z;
  let k = waveVec(id.x, id.y, S.L[c]);
  let mx = (N - id.x) % N;
  let my = (N - id.y) % N;
  let seed = u32(S.misc.w) * 7919u + c * 1000003u;
  let a = gauss2(seed + (id.y * N + id.x)) * amplitude(k, c);
  let b = gauss2(seed + (my * N + mx)) * amplitude(vec2f(0.) - k, c);
  h0[(c * N + id.y) * N + id.x] = vec4f(a, b.x, 0. - b.y);
}
`;
// the spectrum at this moment: of the displacement (specA) and of the slopes (specB)
const W_WEVO = W_WSIM + /*wgsl*/`
@group(0) @binding(1) var<storage, read> h0: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> specA: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> specB: array<vec4f>;
@compute @workgroup_size(16, 16, 1)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let c = id.z;
  let idx = (c * N + id.y) * N + id.x;
  let k = waveVec(id.x, id.y, S.L[c]);
  let kl = length(k);
  if (kl < 1e-5) { specA[idx] = vec4f(0.); specB[idx] = vec4f(0.); return; }
  let w0 = 2. * PI / S.misc.z;
  let w = floor(omegaOf(kl) / w0) * w0;
  let ph = w * S.timeP.x;
  let e = vec2f(cos(ph), sin(ph));
  let H0 = h0[idx];
  let h = cmul(H0.xy, vec2f(e.x, 0. - e.y)) + cmul(H0.zw, e);
  let ih = mulI(h);
  let lam = S.misc.x;
  let ik = 1. / kl;
  let Dx = ih * (lam * k.x * ik);
  let Dz = ih * (lam * k.y * ik);
  let jxz = h * (k.x * k.y * (0. - 1.));
  let sx = ih * k.x;
  let sz = ih * k.y;
  let jxx = h * (k.x * k.x * (0. - 1.));
  let jzz = h * (k.y * k.y * (0. - 1.));
  specA[idx] = vec4f(Dx + mulI(Dz), h + mulI(jxz));
  specB[idx] = vec4f(sx + mulI(sz), jxx + mulI(jzz));
}
`;
// one line of the inverse FFT, done by half as many threads as it has samples, in memory they share
const W_WFFT = /*wgsl*/`
const N: u32 = ${WN}u;
const LOGN: u32 = ${WLOG}u;
const PI: f32 = 3.14159265;
var<workgroup> wa: array<vec4f, ${WN}>;
var<workgroup> wb: array<vec4f, ${WN}>;
fn cmul(a: vec2f, b: vec2f) -> vec2f { return vec2f(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
fn bitrev(i: u32) -> u32 { return reverseBits(i) >> (32u - LOGN); }
fn butterflies(t: u32) {
  for (var s = 0u; s < LOGN; s++) {
    let half = 1u << s;
    let pos = t & (half - 1u);
    let i0 = ((t >> s) << (s + 1u)) + pos;
    let i1 = i0 + half;
    let ang = PI * f32(pos) / f32(half);
    let w = vec2f(cos(ang), sin(ang));
    let a0 = wa[i0]; let a1 = wa[i1];
    let b0 = wb[i0]; let b1 = wb[i1];
    let ta = vec4f(cmul(a1.xy, w), cmul(a1.zw, w));
    let tb = vec4f(cmul(b1.xy, w), cmul(b1.zw, w));
    wa[i0] = a0 + ta; wa[i1] = a0 - ta;
    wb[i0] = b0 + tb; wb[i1] = b0 - tb;
    workgroupBarrier();
  }
}
@group(0) @binding(0) var<storage, read> inA: array<vec4f>;
@group(0) @binding(1) var<storage, read> inB: array<vec4f>;
`;
const W_WROWS = W_WFFT + /*wgsl*/`
@group(0) @binding(2) var<storage, read_write> outA: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> outB: array<vec4f>;
@compute @workgroup_size(${WN / 2})
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) t: u32) {
  let base = (wg.z * N + wg.x) * N;
  let e0 = t;
  let e1 = t + N / 2u;
  wa[bitrev(e0)] = inA[base + e0]; wa[bitrev(e1)] = inA[base + e1];
  wb[bitrev(e0)] = inB[base + e0]; wb[bitrev(e1)] = inB[base + e1];
  workgroupBarrier();
  butterflies(t);
  outA[base + e0] = wa[e0]; outA[base + e1] = wa[e1];
  outB[base + e0] = wb[e0]; outB[base + e1] = wb[e1];
}
`;
// the columns, and the result written out: tWD = (Dx, Dy, Dz, hxz), tWS = (sx, sz, hxx, hzz)
const W_WCOLS = W_WFFT + /*wgsl*/`
@group(0) @binding(2) var dispOut: texture_storage_2d_array<rgba16float, write>;
@group(0) @binding(3) var slopeOut: texture_storage_2d_array<rgba16float, write>;
@compute @workgroup_size(${WN / 2})
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) t: u32) {
  let x = wg.x;
  let c = wg.z;
  let e0 = t;
  let e1 = t + N / 2u;
  wa[bitrev(e0)] = inA[(c * N + e0) * N + x]; wa[bitrev(e1)] = inA[(c * N + e1) * N + x];
  wb[bitrev(e0)] = inB[(c * N + e0) * N + x]; wb[bitrev(e1)] = inB[(c * N + e1) * N + x];
  workgroupBarrier();
  butterflies(t);
  textureStore(dispOut, vec2u(x, e0), c, vec4f(wa[e0].x, wa[e0].z, wa[e0].y, wa[e0].w)); textureStore(slopeOut, vec2u(x, e0), c, wb[e0]);
  textureStore(dispOut, vec2u(x, e1), c, vec4f(wa[e1].x, wa[e1].z, wa[e1].y, wa[e1].w)); textureStore(slopeOut, vec2u(x, e1), c, wb[e1]);
}
`;
// the next mip of both textures (a 2 x 2 box)
const W_WMIP = /*wgsl*/`
@group(0) @binding(0) var srcA: texture_2d_array<f32>;
@group(0) @binding(1) var srcB: texture_2d_array<f32>;
@group(0) @binding(2) var dstA: texture_storage_2d_array<rgba16float, write>;
@group(0) @binding(3) var dstB: texture_storage_2d_array<rgba16float, write>;
fn box(t: texture_2d_array<f32>, p: vec2i, l: u32) -> vec4f {
  return .25 * (textureLoad(t, p, l, 0) + textureLoad(t, p + vec2i(1, 0), l, 0) + textureLoad(t, p + vec2i(0, 1), l, 0) + textureLoad(t, p + vec2i(1, 1), l, 0));
}
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dstA);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy) * 2;
  textureStore(dstA, id.xy, id.z, box(srcA, p, id.z));
  textureStore(dstB, id.xy, id.z, box(srcB, p, id.z));
}
`;

// wave: what the frame needs (main.js) - sim(compute pass) runs the simulation, then pipe, vb, ib, n draw the surface
let wave = null;
if (GFX[7]) {
  // (a browser that cannot build this leaves the flat surface in place)
  device.pushErrorScope('validation');
  // (a build that fails asynchronously is made once more the plain way, which reports it to the error scope above)
  const cp = (code) => { const d = { layout: 'auto', compute: { module: mod(code), entryPoint: 'main' } }; return CP(d).catch(() => device.createComputePipeline(d)); };
  const dW = { layout: pl0,
    vertex: { module: mod(surfW(1)), entryPoint: 'vs', buffers: [{ arrayStride: 8, attributes: [A(0, 0, 'float32x2')] }] },
    fragment: { entryPoint: 'fs', targets: [{ format: HDR }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: DEPTH, depthWriteEnabled: true, depthCompare: 'greater' }, multisample: { count: AA } };
  dW.fragment.module = dW.vertex.module;
  const [pInit, pEvo, pRows, pCols, pMipW, pipe] = await Promise.all([cp(W_WINIT), cp(W_WEVO), cp(W_WROWS), cp(W_WCOLS), cp(W_WMIP), RP(dW).catch(() => device.createRenderPipeline(dW))]);
  const bytes = WN * WN * WC * 16, sb = () => device.createBuffer({ size: bytes, usage: BU.STORAGE });
  const h0 = sb(), sA = sb(), sB = sb(), tA = sb(), tB = sb();
  // The sea: a 6.5 m/s wind over 15 km of water (waves some 13 m long, under half a metre high) and a swell of 0.5 m,
  // 45 m long, from another quarter. Kept low: the creatures and the camera stop a little under the level surface.
  const WS = new Float32Array(28), uS = device.createBuffer({ size: 112, usage: BU.UNIFORM | BU.COPY_DST });
  for (let c = 0; c < WC; c++) { WS[c] = WL[c]; WS[4 + c] = c ? 12 * PI / WL[c] : PI / WL[c]; WS[8 + c] = c < WC - 1 ? 12 * PI / WL[c + 1] : PI * WN / WL[c] * 0.98; }
  WS.set([6.5, 2.06, 15000, 3.3, 0.5, 1.64, sqrt(9.81 * TAU / 45), 30, 1.1, 0.0012, WLOOP, 1, 0, 0, 0, 1], 12);
  Q.writeBuffer(uS, 0, WS);
  const MIPS = WLOG + 1, lvl = (t, m) => t.createView({ dimension: '2d-array', baseMipLevel: m, mipLevelCount: 1 });
  const bg = (p, list) => device.createBindGroup({ layout: p.getBindGroupLayout(0), entries: list.map((r, i) => ({ binding: i, resource: r.size ? { buffer: r } : r })) });
  const bInit = bg(pInit, [uS, h0]), bEvo = bg(pEvo, [uS, h0, sA, sB]), bRows = bg(pRows, [sA, sB, tA, tB]), bCols = bg(pCols, [tA, tB, lvl(tWD, 0), lvl(tWS, 0)]);
  const bMip = []; for (let m = 1; m < MIPS; m++) bMip.push(bg(pMipW, [lvl(tWD, m - 1), lvl(tWS, m - 1), lvl(tWD, m), lvl(tWS, m)]));
  { const e = device.createCommandEncoder(), c = e.beginComputePass(); c.setPipeline(pInit); c.setBindGroup(0, bInit); c.dispatchWorkgroups(WN / 16, WN / 16, WC); c.end(); Q.submit([e.finish()]); }
  // The surface: rings around the camera, each a tenth wider than the one inside it (0.3 m .. 330 m), and a last one
  // that the shader throws out to the horizon. Each vertex is its place from the camera, in metres.
  const SEG = 128, RING = 72, V = new Float32Array(SEG * RING * 2), I = new Uint16Array(SEG * (RING - 1) * 6);
  for (let j = 0, o = 0; j < RING; j++) { const r = j === RING - 1 ? 1e6 : j ? 0.3 * 1.105 ** j : 0; for (let i = 0; i < SEG; i++) { const a = i / SEG * TAU; V[o++] = cos(a) * r; V[o++] = sin(a) * r; } }
  for (let j = 0, o = 0; j < RING - 1; j++) for (let i = 0; i < SEG; i++) { const a = j * SEG + i, b = j * SEG + (i + 1) % SEG; I.set([a, b, a + SEG, b, b + SEG, a + SEG], o); o += 6; }
  const vb = device.createBuffer({ size: V.byteLength, usage: BU.VERTEX | BU.COPY_DST }), ib = device.createBuffer({ size: I.byteLength, usage: BU.INDEX | BU.COPY_DST });
  Q.writeBuffer(vb, 0, V); Q.writeBuffer(ib, 0, I);
  const T = new Float32Array(1);
  const sim = (c) => {
    T[0] = F[TIME] * WSPD % WLOOP; Q.writeBuffer(uS, 96, T);
    c.setPipeline(pEvo); c.setBindGroup(0, bEvo); c.dispatchWorkgroups(WN / 16, WN / 16, WC);
    c.setPipeline(pRows); c.setBindGroup(0, bRows); c.dispatchWorkgroups(WN, 1, WC);
    c.setPipeline(pCols); c.setBindGroup(0, bCols); c.dispatchWorkgroups(WN, 1, WC);
    c.setPipeline(pMipW);
    for (let k = 1; k < MIPS; k++) { const s = Math.ceil((WN >> k) / 8); c.setBindGroup(0, bMip[k - 1]); c.dispatchWorkgroups(s, s, WC); }
  };
  const err = await device.popErrorScope();
  if (err) {
    console.warn('waves: ' + err.message);
    try { const a = (localStorage.abyssalInfGfx || '').split(','); while (a.length < 8) a.push(''); a[7] = 0; localStorage.abyssalInfGfx = a.join(); location.reload(); await new Promise(() => {}); } catch {}
  } else wave = { sim, pipe, vb, ib, n: I.length };
}
