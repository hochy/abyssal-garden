// ============================================================================
// renderer, camera and input
// ============================================================================
const $ = (id) => document.getElementById(id);
const canvas = $('c'), info = $('i'), body = document.body;
// a phone held upright gets the page turned on its side (see template.html)
const rot = matchMedia('(orientation:portrait) and (pointer:coarse)');
// loading bar: each stage glides it to `to` (the share done) over ~`ms` on the compositor, so it moves while this
// thread is busy
let loaded = 0, dead; // dead: the graphics device was lost
const say = (m, to, ms) => {
  if (!dead) $('s').textContent = m;
  const a = $('b').animate({ transform: [`scaleX(${loaded})`, `scaleX(${to})`] }, { duration: ms, fill: 'forwards', easing: 'cubic-bezier(.3,.5,.5,1)' });
  loaded = to;
  // go on once the animation runs: one not started before the thread gets busy stays stuck (timer: hidden tabs)
  return new Promise((r) => { a.ready.then(() => setTimeout(r)); setTimeout(r, document.hidden ? 0 : 1e3); });
};
const fail = (m) => { throw new Error(m, { cause: 1 }); }; // cause marks a message that is shown as it is
if (!navigator.gpu) fail('This scene needs WebGPU. Try a current Chrome or Edge.');
// xrCompatible: the same device has to drive a headset later (xr.js); browsers without WebXR ignore it
const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance', xrCompatible: !!navigator.xr });
if (!adapter) fail('No WebGPU adapter found.');
$('w').hidden = !!navigator.userAgentData; // only Chromium-based browsers have it
const hasTS = adapter.features.has('timestamp-query');
const device = await adapter.requestDevice({ requiredFeatures: hasTS ? ['timestamp-query'] : [] });
device.addEventListener('uncapturederror', (e) => console.error('GPU: ' + e.error.message));
// out of memory or a GPU timeout: reload a level lower, or on Low say what happened
device.lost.then((l) => {
  if (l.reason === 'destroyed') return; // the page is closing
  if (LV < 2) { keep('nebula', LV + 1); location.reload(); }
  dead = body.className = 'l e'; $('s').textContent = 'The graphics device was lost. Reload the page to try again.';
});
const ctx = canvas.getContext('webgpu'), FMT = navigator.gpu.getPreferredCanvasFormat();
const Q = device.queue, HDR = 'rgba16float', DEPTH = 'depth32float';
const TU = GPUTextureUsage, BU = GPUBufferUsage, SS = GPUShaderStage;

const mod = (code) => device.createShaderModule({ code });
const buf = (data, usage) => { const b = device.createBuffer({ size: (data.byteLength + 3) & ~3, usage: usage | BU.COPY_DST }); Q.writeBuffer(b, 0, data.buffer || data, data.byteOffset || 0, data.byteLength); return b; };
const tex = (w, h, format, usage, o = {}) => device.createTexture({ size: [w, h, o.d || 1], format, usage, mipLevelCount: o.mips || 1, sampleCount: o.samples || 1, dimension: o.d ? '3d' : '2d' });

// ---------------------------------------------------------------- static resources
const sRep = device.createSampler({ addressModeU: 'repeat', addressModeV: 'repeat', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', maxAnisotropy: LV > 1 ? 1 : 8 });
const sClamp = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
const sCmp = device.createSampler({ compare: 'less-equal', magFilter: 'linear', minFilter: 'linear' });
const tShadow = tex(SHADOW, SHADOW, DEPTH, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING);
const tDummy = tex(1, 1, DEPTH, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING);
const tWater = tex(WATER, WATER, HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING, { mips: 5 });
const tDetail = tex(1024, 1024, 'rgba8unorm', TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING, { mips: 11 });
const tVol = tex(NX / 2, NY / 2, 'rg8unorm', TU.TEXTURE_BINDING | TU.COPY_DST, { d: NZ / 2 });
const tMap = tex(512, 512, 'rgba8unorm', TU.TEXTURE_BINDING | TU.COPY_DST);
const tSky = tex(SKYW, SKYW / 2, HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING);

// UB is struct G in shaders.js; 60-63 (xr) and 64-67 (xo) are only non-zero in VR (xr.js)
const UB = new Float32Array(68), UBS = new Float32Array(68);
const ubo = device.createBuffer({ size: 272, usage: BU.UNIFORM | BU.COPY_DST }), uboS = device.createBuffer({ size: 272, usage: BU.UNIFORM | BU.COPY_DST });
const WT = new Float32Array(4), uboW = device.createBuffer({ size: 16, usage: BU.UNIFORM | BU.COPY_DST });

const VF = SS.VERTEX | SS.FRAGMENT;
const bgl0 = device.createBindGroupLayout({ entries: [
  { binding: 0, visibility: VF, buffer: {} },
  { binding: 1, visibility: VF, sampler: {} }, { binding: 2, visibility: VF, sampler: {} }, { binding: 3, visibility: VF, sampler: { type: 'comparison' } },
  { binding: 4, visibility: VF, texture: { sampleType: 'depth' } },
  { binding: 5, visibility: VF, texture: {} }, { binding: 6, visibility: VF, texture: {} },
  { binding: 7, visibility: VF, texture: { viewDimension: '3d' } }, { binding: 8, visibility: VF, texture: {} }, { binding: 9, visibility: VF, texture: {} }] });
const mkBG0 = (u, sh) => device.createBindGroup({ layout: bgl0, entries: [
  { binding: 0, resource: { buffer: u } }, { binding: 1, resource: sRep }, { binding: 2, resource: sClamp }, { binding: 3, resource: sCmp },
  { binding: 4, resource: sh.createView() }, { binding: 5, resource: tWater.createView() }, { binding: 6, resource: tDetail.createView() },
  { binding: 7, resource: tVol.createView() }, { binding: 8, resource: tMap.createView() }, { binding: 9, resource: tSky.createView() }] });
const bg0 = mkBG0(ubo, tShadow), bg0s = mkBG0(uboS, tDummy);
const pl0 = device.createPipelineLayout({ bindGroupLayouts: [bgl0] });

const bglBlit = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: SS.FRAGMENT, texture: {} }, { binding: 1, visibility: SS.FRAGMENT, sampler: {} }] });
const plBlit = device.createPipelineLayout({ bindGroupLayouts: [bglBlit] });
const mBlit = mod(W_BLIT);
const blitPipe = (entry, format, add) => device.createRenderPipeline({ layout: plBlit, vertex: { module: mBlit, entryPoint: 'vs' },
  fragment: { module: mBlit, entryPoint: entry, targets: [{ format, blend: add ? { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } } : undefined }] } });
const pMip8 = blitPipe('fsMip', 'rgba8unorm'), pMip16 = blitPipe('fsMip', HDR), pDown0 = blitPipe('fsDown0', HDR), pDown = blitPipe('fsDown', HDR), pUp = blitPipe('fsUp', HDR, true);
const blitBG = (view) => device.createBindGroup({ layout: bglBlit, entries: [{ binding: 0, resource: view }, { binding: 1, resource: sClamp }] });
const colorAtt = (view, clear) => ({ view, loadOp: clear ? 'clear' : 'load', storeOp: 'store', clearValue: [0, 0, 0, 0] });

// vertex layouts
const A = (shaderLocation, offset, format) => ({ shaderLocation, offset, format });
const vbSolid = { arrayStride: 16, attributes: [A(0, 0, 'float32x3'), A(1, 12, 'snorm8x4')] };
const ibSolid = { arrayStride: 48, stepMode: 'instance', attributes: [A(2, 0, 'float32x4'), A(3, 16, 'float32x4'), A(4, 32, 'float32x4')] };
const ibLeaf = { arrayStride: 36, stepMode: 'instance', attributes: [A(0, 0, 'float32x4'), A(1, 16, 'float32x4'), A(2, 32, 'unorm8x4')] };
const ibAnim = { arrayStride: 32, stepMode: 'instance', attributes: [A(2, 0, 'float32x4'), A(3, 16, 'float32x4')] };
const ibBub = { arrayStride: 32, stepMode: 'instance', attributes: [A(0, 0, 'float32x4'), A(1, 16, 'float32x4')] };
const ibSnow = { arrayStride: 16, stepMode: 'instance', attributes: [A(0, 0, 'float32x4')] };

const scenePipe = (m, vsE, fsE, buffers, o = {}) => device.createRenderPipeline({ layout: pl0,
  vertex: { module: m, entryPoint: vsE, buffers, constants: o.constants },
  fragment: { module: m, entryPoint: fsE, targets: [{ format: HDR, blend: o.blend }] },
  primitive: { topology: o.strip ? 'triangle-strip' : 'triangle-list', cullMode: o.cull || 'none' },
  depthStencil: { format: DEPTH, depthWriteEnabled: !o.blend, depthCompare: 'greater' }, multisample: { count: AA } });
const shadowPipe = (m, vsE, buffers, o = {}) => device.createRenderPipeline({ layout: pl0,
  vertex: { module: m, entryPoint: vsE, buffers, constants: o.constants },
  primitive: { topology: o.strip ? 'triangle-strip' : 'triangle-list', cullMode: o.cull || 'none' },
  depthStencil: { format: DEPTH, depthWriteEnabled: true, depthCompare: 'less', depthBias: 2, depthBiasSlopeScale: 1.5 } });

await say('Compiling shaders…', 0.05, 300);
const mSolid = mod(W_SOLID), mLeaf = mod(W_LEAF), mAnim = mod(W_ANIM), mSurf = mod(W_SURF), mSpr = mod(W_SPR);
const pTerrain = scenePipe(mSolid, 'vs', 'fs', [vbSolid, ibSolid], { cull: 'back' });
const pSolid = scenePipe(mSolid, 'vs', 'fs', [vbSolid, ibSolid]);
const pLeaf = scenePipe(mLeaf, 'vs', 'fs', [ibLeaf], { strip: true, constants: { ROWS: 9 } });
const pLeaf5 = scenePipe(mLeaf, 'vs', 'fs', [ibLeaf], { strip: true, constants: { ROWS: 5 } });
const pLeafS = scenePipe(mLeaf, 'vs', 'fs', [ibLeaf], { strip: true, constants: { ROWS: 3, FAR: 70 } });
const pLeafF = scenePipe(mLeaf, 'vs', 'fs', [ibLeaf], { strip: true, constants: { ROWS: 3 } });
const pFish = scenePipe(mAnim, 'vsFish', 'fsFish', [vbSolid, ibAnim]);
const pManta = scenePipe(mAnim, 'vsManta', 'fsManta', [vbSolid, ibAnim]);
const pBack = scenePipe(mSurf, 'vsB', 'fsB', [], { strip: true });
const pBub = scenePipe(mSpr, 'vsBub', 'fsBub', [ibBub], { strip: true, blend: { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } } });
const ADD = { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } };
const pSnow = scenePipe(mSpr, 'vsSnow', 'fsSnow', [ibSnow], { strip: true, blend: ADD }), pTail = scenePipe(mSpr, 'vsTail', 'fsTail', [ibSnow], { strip: true, blend: ADD });
const pGl = scenePipe(mLeaf, 'vsGl', 'fsGl', [ibBub], { strip: true, blend: ADD, constants: { ROWS: 7 } });
const pSolidSh = shadowPipe(mSolid, 'vs', [vbSolid, ibSolid]), pTerrSh = shadowPipe(mSolid, 'vs', [vbSolid, ibSolid], { cull: 'front' });
const pLeafSh = shadowPipe(mLeaf, 'vs', [ibLeaf], { strip: true, constants: { ROWS: 3 } });

const mWater = mod(W_WATER);
const pWater = device.createRenderPipeline({ layout: 'auto', vertex: { module: mWater, entryPoint: 'vs' }, fragment: { module: mWater, entryPoint: 'fs', targets: [{ format: HDR }] } });
const bgWater = device.createBindGroup({ layout: pWater.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uboW } }] });
const waterViews = [0, 1, 2, 3, 4].map((m) => tWater.createView({ baseMipLevel: m, mipLevelCount: 1 }));
const waterBG = waterViews.map((v) => blitBG(v));
const waterPass = waterViews.map((v) => ({ colorAttachments: [colorAtt(v, true)] }));

const mRays = mod(W_RAYS), mPost = mod(W_POST), mRB = mod(W_RBLUR);
const pRB = device.createRenderPipeline({ layout: 'auto', vertex: { module: mRB, entryPoint: 'vs' }, fragment: { module: mRB, entryPoint: 'fs', targets: [{ format: HDR }] } });
const pRays = device.createRenderPipeline({ layout: 'auto', vertex: { module: mRays, entryPoint: 'vs' }, fragment: { module: mRays, entryPoint: 'fs', targets: [{ format: HDR }] } });
// explicit layout: the VR composite (xr.js) is the same shader into the headset's format and shares the bind group
const FT = (texture) => ({ visibility: SS.FRAGMENT, texture });
const plPost = device.createPipelineLayout({ bindGroupLayouts: [device.createBindGroupLayout({ entries: [{ binding: 0, visibility: SS.FRAGMENT, buffer: {} }, { binding: 1, visibility: SS.FRAGMENT, sampler: {} },
  { binding: 2, ...FT({}) }, { binding: 3, ...FT({}) }, { binding: 4, ...FT({}) }, { binding: 5, ...FT({ sampleType: 'depth', multisampled: AA > 1 }) }] })] });
// SRGB: the target encodes sRGB itself, so the shader skips its own gamma
const postPipe = (format) => device.createRenderPipeline({ layout: plPost, vertex: { module: mPost, entryPoint: 'vs' },
  fragment: { module: mPost, entryPoint: 'fs', targets: [{ format }], constants: { SRGB: format.endsWith('-srgb') ? 1 : 0 } } });
const pPost = postPipe(FMT), plPostBGL = pPost.getBindGroupLayout(0);

// ---------------------------------------------------------------- sun + shadow matrix
const SUN = (() => { const v = [0.55, 0.62, -0.56], l = hypot(...v); return v.map((c) => c / l); })();
{
  const L = SUN, lr = [L[1], -L[0], 0], ll = hypot(...lr); lr[0] /= ll; lr[1] /= ll;
  const lu = [L[1] * lr[2] - L[2] * lr[1], L[2] * lr[0] - L[0] * lr[2], L[0] * lr[1] - L[1] * lr[0]];
  const R = 96, d0 = -110, d1 = 110, m = UBS;
  m[0] = lr[0] / R; m[4] = lr[1] / R; m[8] = lr[2] / R; m[12] = 0;
  m[1] = lu[0] / R; m[5] = lu[1] / R; m[9] = lu[2] / R; m[13] = 0;
  m[2] = -L[0] / (d1 - d0); m[6] = -L[1] / (d1 - d0); m[10] = -L[2] / (d1 - d0); m[14] = d1 / (d1 - d0);
  m[3] = 0; m[7] = 0; m[11] = 0; m[15] = 1;
  for (let i = 0; i < 16; i++) { UBS[16 + i] = m[i]; UB[16 + i] = m[i]; }
  for (let i = 0; i < 3; i++) { UB[48 + i] = UBS[48 + i] = SUN[i]; }
  UBS[32] = 0; UBS[33] = -20; UBS[34] = 0; UBS[35] = 0; UBS[58] = 1; UB[60] = UB[61] = 0.5;
  Q.writeBuffer(uboS, 0, UBS);
}

// ---------------------------------------------------------------- world generation
await say('Shaping the asteroid…', 0.25, 1200);
// marks a load in progress (quality.js); leaving the page before it ends is not a crash
keep('nebulaLoad', 1);
addEventListener('pagehide', () => keep('nebulaLoad', ''));
let D;
{
  const prims = primBuffer();
  const m = mod(W_DENS), p = device.createComputePipeline({ layout: 'auto', compute: { module: m, entryPoint: 'main' } });
  const size = NX * NY * NZ * 4;
  const u = new ArrayBuffer(48), uu = new Uint32Array(u), uf = new Float32Array(u);
  uu[0] = NX; uu[1] = NY; uu[2] = NZ; uf[4] = OX; uf[5] = OY; uf[6] = OZ; uf[7] = VS;
  uu[8] = CRATERS.length;
  const bu = buf(new Uint8Array(u), BU.UNIFORM), bp = buf(prims, BU.STORAGE);
  const bd = device.createBuffer({ size, usage: BU.STORAGE | BU.COPY_SRC }), br = device.createBuffer({ size, usage: BU.MAP_READ | BU.COPY_DST });
  const bg = device.createBindGroup({ layout: p.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: bu } }, { binding: 1, resource: { buffer: bd } }, { binding: 2, resource: { buffer: bp } }] });
  // in slabs of 32 z, each its own submit, so no single GPU job runs long enough to be killed (phones, headsets)
  for (let z0 = 0; z0 < NZ; z0 += 32) {
    Q.writeBuffer(bu, 12, new Uint32Array([z0]));
    const e = device.createCommandEncoder(), c = e.beginComputePass();
    c.setPipeline(p); c.setBindGroup(0, bg); c.dispatchWorkgroups(NX / 4, NY / 4, 8); c.end();
    Q.submit([e.finish()]); await Q.onSubmittedWorkDone();
  }
  const e = device.createCommandEncoder(); e.copyBufferToBuffer(bd, 0, br, 0, size); Q.submit([e.finish()]);
  await br.mapAsync(GPUMapMode.READ);
  D = new Float32Array(br.getMappedRange().slice(0));
  br.unmap(); br.destroy(); bd.destroy();
  // keep the rock that is joined to the middle of the asteroid; a speck of noise floating free (surface nets would
  // make it a small box) becomes space
  const S = NX * NY, R = new Uint8Array(D.length), st = new Int32Array(D.length >> 1), O = [1, -1, NX, -NX, S, -S];
  let n = 0; const seed = 78 + NX * (NY / 2 + NY * NZ / 2); // 30 m from the middle, clear of the core and the shaft
  R[seed] = 1; st[n++] = seed;
  while (n) { const i = st[--n]; for (let k = 0; k < 6; k++) { const j = i + O[k]; if (!R[j] && D[j] > 0) { R[j] = 1; st[n++] = j; } } }
  for (let i = 0; i < D.length; i++) if (D[i] > 0 && !R[i]) D[i] = -D[i];
}
// Distance to the rock for collide(), in 1/127 m (> 0 in rock, clamped to ±1 m), kept only in the 4x4x4-voxel
// bricks near the surface within the camera's reach (~2 MB). CI per brick: 0 all water, 1 all rock, n brick n-2 in CG.
const CO = 0, CN = 64, CI = new Uint16Array(CN * CN * NY / 4);
let CG = new Int8Array(64 * 65534);
{
  let n = 0;
  for (let bz = 1; bz < CN - 1; bz++) for (let by = 1; by < NY / 4 - 1; by++) for (let bx = 1; bx < CN - 1; bx++) {
    let lo = 127, hi = -127;
    for (let z = 0; z < 4; z++) for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const i = CO + bx * 4 + x + NX * (by * 4 + y + NY * (CO + bz * 4 + z)), gz = D[i + NX * NY] - D[i - NX * NY];
      const gx = D[i + 1] - D[i - 1], g = D[i + NX] - D[i - NX], l = sqrt(gx * gx + g * g + gz * gz) / (2 * VS);
      const q = round(clamp(D[i] / max(l, 0.05), -1, 1) * 127);
      CG[n * 64 + x + 4 * y + 16 * z] = q; if (q < lo) lo = q; if (q > hi) hi = q;
    }
    CI[bx + CN * (by + NY / 4 * bz)] = lo === hi && lo * lo === 16129 ? +(lo > 0) : (n++, n + 1);
  }
  CG = CG.slice(0, n * 64);
}
await say('Cratering…', 0.32, 400);
const T = buildTerrain(D);

// preset viewpoints (position, look-at), keys 1-6; the world generator dresses the scene around them
// viewpoints, keys 1-6: where the camera stands (a direction from the middle of the asteroid, metres above the
// ground there), then what it looks at (the same, or nothing for the middle); turned into points once the world exists
const POSES = [
  [16.5, 52.4, 18.8, 1.2, 0.15, 1, 0.2, 2.6],
  [-0.55, 0.72, -0.3, 5, -0.75, 0.45, -0.5, 8],
  [0.62, 0.55, -0.5, 5, 0.8, 0.2, -0.55, 4],
  [1, 0.35, 0.9, 115],
  [0.55, -0.15, 0.82, 12],
  [0.3, -0.9, -0.05, 6, 0, -0.954, -0.3, 5],
];
// 60 s camera path (position + look-at, Catmull-Rom) for dev.js: one and a half turns round the asteroid
const FLY = new Float32Array(150);
for (let i = 0; i < 25; i++) { const a = i / 16 * TAU, r = 84 + 22 * sin(a * 1.3); FLY[i * 6] = cos(a) * r; FLY[i * 6 + 1] = 34 * sin(a * 0.7); FLY[i * 6 + 2] = sin(a) * r; }
const FLYN = FLY.length / 6, FLYT = 60, LUTN = 1024, flyLUT = new Float32Array(LUTN + 1);
const flyPts = [];
// per-frame float state lives in one preallocated array, so the frame loop allocates no heap numbers
const F = new Float64Array(32), P6 = new Float64Array(6);
F[26 + 3] = 1; F[27] = -1;
const CX = 0, CY = 1, CZ = 2, YAW = 3, PIT = 4, FX = 5, FY = 6, FZ = 7, RX = 8, RZ = 9, UX = 10, UY = 11, UZ = 12, VX = 13, VY = 14, VZ = 15, TIME = 16, FLT = 17, LAST = 18, GPU = 19, HUDT = 20, SPL = 21, MX = 22, MY = 23, MZ = 24, HX = 25, HY = 26, HZ = 27, GX = 28, GY = 29, GZ = 30, RY = 31;
// Local up at the camera: away from the asteroid, which is a flattened body, so over its faces up is close to the
// world's y axis and it swings round at the rim. grav is the pull toward it in m/s², weaker far out.
let upx = 0, upy = 1, upz = 0, grav = 0, alt = 0, onGround = 0, grounded = 0, gnx = 0, gny = 1, gnz = 0, thr = 0, landHit = 0, dip = 0;
function upAt() {
  const x = F[CX], y = F[CY], z = F[CZ], r = sqrt(x * x + y * y + z * z);
  if (r > 0.01) { upx = x / r; upy = y / r; upz = z / r; } alt = r - 54;
  grav = r > 54 ? 3.6 * 2916 / (r * r) : 3.6 * r / 54; // inverse square outside, easing to nothing at the middle
}
// The camera is a heading H square to an up vector G, plus a pitch. aim() sets them from P6 = position + look-at point.
function aim() {
  let dx = P6[3] - P6[0], dy = P6[4] - P6[1], dz = P6[5] - P6[2]; const dl = sqrt(dx * dx + dy * dy + dz * dz) || 1; dx /= dl; dy /= dl; dz /= dl;
  F[CX] = P6[0]; F[CY] = P6[1]; F[CZ] = P6[2]; upAt();
  const s = dx * upx + dy * upy + dz * upz;
  let hx = dx - upx * s, hy = dy - upy * s, hz = dz - upz * s, hl = sqrt(hx * hx + hy * hy + hz * hz);
  if (hl < 1e-3) { hx = upy; hy = -upx; hz = 0; hl = sqrt(hx * hx + hy * hy) || 1; }
  F[HX] = hx / hl; F[HY] = hy / hl; F[HZ] = hz / hl; F[GX] = upx; F[GY] = upy; F[GZ] = upz;
  F[PIT] = atan2(s, sqrt(1 - (s > 1 ? 1 : s * s))); F[VX] = F[VY] = F[VZ] = 0;
}
// view vectors from heading, up and pitch
function basis() {
  const hx = F[HX], hy = F[HY], hz = F[HZ], gx = F[GX], gy = F[GY], gz = F[GZ], cp = cos(F[PIT]), sp = sin(F[PIT]);
  const rx = hy * gz - hz * gy, ry = hz * gx - hx * gz, rz = hx * gy - hy * gx, fx = hx * cp + gx * sp, fy = hy * cp + gy * sp, fz = hz * cp + gz * sp;
  F[RX] = rx; F[RY] = ry; F[RZ] = rz; F[FX] = fx; F[FY] = fy; F[FZ] = fz;
  F[UX] = ry * fz - rz * fy; F[UY] = rz * fx - rx * fz; F[UZ] = rx * fy - ry * fx;
}
const lookAt = (x, y, z, tx, ty, tz) => { P6[0] = x; P6[1] = y; P6[2] = z; P6[3] = tx; P6[4] = ty; P6[5] = tz; aim(); };
// camera spline (Catmull-Rom over position + look-at) at parameter F[SPL]
function flyRaw() {
  const s = F[SPL]; let i = floor(s) | 0; if (i > FLYN - 2) i = FLYN - 2;
  const u = s - i, i0 = (i > 0 ? i - 1 : 0) * 6, i1 = i * 6, i2 = (i + 1) * 6, i3 = (i + 2 < FLYN ? i + 2 : FLYN - 1) * 6;
  for (let o = 0; o < 6; o++) {
    const a = FLY[i0 + o], b = FLY[i1 + o], c = FLY[i2 + o], d = FLY[i3 + o];
    P6[o] = 0.5 * (2 * b + (c - a) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (3 * b - a - 3 * c + d) * u * u * u);
  }
  aim();
}
{ // arc-length table: flyLUT[k] = spline parameter at fraction k/LUTN of the total path length
  const M = 4096, len = new Float32Array(M + 1); let px = 0, py = 0, pz = 0;
  for (let k = 0; k <= M; k++) { F[SPL] = k / M * (FLYN - 1); flyRaw(); if (k) len[k] = len[k - 1] + hypot(F[CX] - px, F[CY] - py, F[CZ] - pz); px = F[CX]; py = F[CY]; pz = F[CZ]; }
  for (let k = 0, j = 0; k <= LUTN; k++) { const d = k / LUTN * len[M]; while (j < M - 1 && len[j + 1] < d) j++; flyLUT[k] = (j + (d - len[j]) / max(len[j + 1] - len[j], 1e-6)) / M * (FLYN - 1); }
}
// camera on the scripted path at time F[FLT]
function flyAt() {
  let s = F[FLT] / FLYT; s = s < 0 ? 0 : s > 1 ? 1 : s; s = s * s * (3 - 2 * s) * 0.25 + s * 0.75;
  s *= LUTN; let k = floor(s) | 0; if (k > LUTN - 1) k = LUTN - 1;
  F[SPL] = flyLUT[k] + (flyLUT[k + 1] - flyLUT[k]) * (s - k); flyRaw();
}
for (let t = 0; t <= FLYT; t += 0.1) { F[FLT] = t; flyAt(); flyPts.push([F[CX], F[CY], F[CZ]]); }

await say('Seeding the garden…', 0.73, 2500);
const Wd = makeWorld(D, T);
for (const p of POSES) { const c = Wd.at(nrm3(p), p[3]), t = p.length > 4 ? Wd.at(nrm3([p[4], p[5], p[6]]), p[7]) : [0, 0, 0]; p.length = 0; p.push(...c, ...t); }
D = Wd.at = T.smp = null; // with gy goes the generator's working memory (about 200 MB)

await say('Building set pieces…', 0.94, 1200);
// mesh ids: 0-3 boulders, 4-6 sponges, 7-8 coral, 9 tube sponge, 10 whale fluke, 11 ship, 12 manta, 13 fish,
// 14-20 rock chunks + pebbles, 21-22 coral LOD, 23-25 far LOD of the large rock chunks
// mesh ids: 0-3 drifting rocks, 4-6 fungi, 7-9 crystals, 10 crystal spire, 11 unused, 12 wisp, 13 ice shard,
// 14-20 rock chunks + pebbles, 21-22 crystal far slots, 23-25 far LOD of the large rock chunks, 26 unused, 27 gate
const meshes = [meshRock(1, 3), meshRock(7, 3), meshRock(13, 3), meshRock(22, 3),
  meshLathe([[0, 0, 0.5], [0.13, 0, 0.6], [0.1, 0.5, 0.8], [0.09, 0.9, 0.84], [0.12, 0.95, 0.25], [0.55, 0.92, 0.12], [0.72, 1.0, 0.3], [0.66, 1.12, 1], [0.42, 1.27, 1], [0.15, 1.34, 1], [0, 1.35, 1]], 18, 0.2, 7),
  meshLathe([[0, 0, 0.5], [0.09, 0, 0.6], [0.07, 1.0, 0.8], [0.07, 1.5, 0.84], [0.1, 1.52, 0.2], [0.3, 1.38, 0.1], [0.36, 1.45, 0.4], [0.3, 1.72, 1], [0.14, 1.9, 1], [0, 1.94, 1]], 16, 0.2, 6),
  meshLathe([[0, 0, 0.5], [0.2, 0, 0.6], [0.16, 0.3, 0.8], [0.2, 0.42, 0.2], [0.8, 0.5, 0.1], [0.95, 0.56, 0.4], [0.8, 0.66, 1], [0.3, 0.72, 1], [0, 0.7, 1]], 18, 0.25, 9),
  meshCrystal(1, 5, 0), meshCrystal(2, 7, 0), meshCrystal(3, 4, 1)].map((m) => m.build());
meshes.push(meshCrystal(4, 6, 1).build(), meshDart().build(), meshWisp().build(), meshDart().build(),
  meshRock(3).build(), meshRock(11).build(), meshRock(29).build(), meshRock(5, 3).build(), meshRock(17, 3).build(), meshRock(41, 3).build(), meshRock(9, 1).build(),
  meshCrystal(1, 5, 0).build(), meshCrystal(2, 7, 0).build(), meshRock(5, 2).build(), meshRock(17, 2).build(), meshRock(41, 2).build(), meshDart().build(), meshGate().build());
let nV = 0, nI = 0;
for (const m of meshes) { m.v0 = nV; m.i0 = nI; nV += m.nv; nI += m.ib.length; }
const allV = new Uint8Array(nV * 16), allI = new Uint32Array(nI);
for (const m of meshes) { allV.set(new Uint8Array(m.vb), m.v0 * 16); allI.set(m.ib, m.i0); }
const vbMesh = buf(allV, BU.VERTEX), ibMesh = buf(allI, BU.INDEX);
const vbTerrain = buf(new Uint8Array(T.vb), BU.VERTEX), ibTerrain = buf(T.ib, BU.INDEX);
const nSolid = Wd.solids.data.length / 12;
const solidData = new Float32Array((nSolid + 1) * 12); solidData.set(Wd.solids.data); solidData.set([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0], nSolid * 12);
const ibSolids = buf(solidData, BU.VERTEX);
const ibChunk = Wd.chunks.map((c) => buf(c.data, BU.VERTEX)), ibProp = Wd.props.map((c) => buf(c.data, BU.VERTEX));
const ibBig = buf(new Uint8Array(Wd.big.buf), BU.VERTEX), ibBigF = buf(new Uint8Array(Wd.bigF.buf), BU.VERTEX), ibSmall = buf(new Uint8Array(Wd.small.buf), BU.VERTEX);
const ibFish = buf(Wd.fish, BU.VERTEX), ibManta = buf(Wd.mantas, BU.VERTEX), ibBubbles = buf(Wd.bubbles, BU.VERTEX), ibSnowB = buf(Wd.snow, BU.VERTEX);
const ibGl = buf(Wd.glints, BU.VERTEX), nGl = Wd.glints.length / 8;
const nFish = Wd.fish.length / 8, nManta = Wd.mantas.length / 8, nBub = Wd.bubbles.length / 8, nSnow = Wd.snow.length / 4;
const MANTA = meshes[12], FISH = meshes[13];
Q.writeTexture({ texture: tVol }, Wd.volD, { bytesPerRow: NX, rowsPerImage: NY / 2 }, [NX / 2, NY / 2, NZ / 2]);
Q.writeTexture({ texture: tMap }, Wd.gm, { bytesPerRow: 2048 }, [512, 512]);

// ---------------------------------------------------------------- one-time bakes: detail texture, shadow map
{
  const m = mod(W_DETAIL), p = device.createRenderPipeline({ layout: 'auto', vertex: { module: m, entryPoint: 'vs' }, fragment: { module: m, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] } });
  const e = device.createCommandEncoder();
  let r = e.beginRenderPass({ colorAttachments: [colorAtt(tDetail.createView({ baseMipLevel: 0, mipLevelCount: 1 }), true)] });
  r.setPipeline(p); r.draw(3); r.end();
  for (let i = 1; i < 11; i++) {
    r = e.beginRenderPass({ colorAttachments: [colorAtt(tDetail.createView({ baseMipLevel: i, mipLevelCount: 1 }), true)] });
    r.setPipeline(pMip8); r.setBindGroup(0, blitBG(tDetail.createView({ baseMipLevel: i - 1, mipLevelCount: 1 }))); r.draw(3); r.end();
  }
  { // nebula map
    const ms = mod(W_SKYB), ps = device.createRenderPipeline({ layout: 'auto', vertex: { module: ms, entryPoint: 'vs' }, fragment: { module: ms, entryPoint: 'fs', targets: [{ format: HDR }] } });
    r = e.beginRenderPass({ colorAttachments: [colorAtt(tSky.createView(), true)] }); r.setPipeline(ps); r.draw(3); r.end();
  }
  r = e.beginRenderPass({ colorAttachments: [], depthStencilAttachment: { view: tShadow.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
  r.setBindGroup(0, bg0s);
  r.setPipeline(pTerrSh);
  r.setVertexBuffer(0, vbTerrain); r.setVertexBuffer(1, ibSolids); r.setIndexBuffer(ibTerrain, 'uint32');
  r.drawIndexed(T.ib.length, 1, 0, 0, nSolid);
  r.setPipeline(pSolidSh); r.setVertexBuffer(0, vbMesh); r.setIndexBuffer(ibMesh, 'uint32');
  for (let i = 0; i < 28; i++) { const g = Wd.solids.ranges[i]; if (g[1]) r.drawIndexed(meshes[i].ib.length, g[1], meshes[i].i0, meshes[i].v0, g[0]); }
  // small rocks, sponges and corals (~35M triangles) only on High: too much for a phone's driver
  if (!LV) for (let i = 0; i < NCHUNK; i++) { r.setVertexBuffer(1, ibChunk[i]); r.drawIndexed(meshes[14 + i].ib.length, Wd.chunks[i].n, meshes[14 + i].i0, meshes[14 + i].v0, 0); }
  if (!LV) for (let i = 0; i < 6; i++) if (Wd.props[i].n) { r.setVertexBuffer(1, ibProp[i]); r.drawIndexed(meshes[4 + i].ib.length, Wd.props[i].n, meshes[4 + i].i0, meshes[4 + i].v0, 0); }
  r.setPipeline(pLeafSh); r.setVertexBuffer(0, ibBig); r.draw(6, Wd.big.n);
  r.end();
  Q.submit([e.finish()]);
}
// the GPU has its own copies now: let go of the generator's (about 300 MB)
for (const o of [Wd.big, Wd.bigF, Wd.small, ...Wd.chunks, ...Wd.props]) o.buf = o.data = 0;
Wd.glints = Wd.volD = Wd.gm = T.vb = T.ib = T.wp = T.wn = 0;

// ---------------------------------------------------------------- render targets (rebuilt on resize)
// The scene is drawn at `pix` pixels and scaled up to the window. frame() tunes it and the draw distance scale `det`
// for 60 fps; both start where the last visit left them.
const PIXMAX = 2560 * 1440, PIXMIN = mob ? 25e4 : 5e5, DETMIN = 0.4;
let W = 0, H = 0, DW = 0, DH = 0, pix = +SV[1] || (LV > 1 ? 41e4 : mob ? 1280 * 720 : PIXMAX), det = +SV[2] || 1, dynN = 0, dynT = 0, dynG = 0, dynGN = 0, dynBad = 0, dynOk = 0, dynWait = 3;
let passScene, passRays, passBlur, bgBlur, passPost, bgRays, bgPost, bloomPass = [], bloomBG = [], targets = [];
const NB = 6;
function resize() {
  if (xs) return; // in VR the headset sets the size (xr.js)
  DW = max(2, round(canvas.clientWidth * devicePixelRatio)); DH = max(2, round(canvas.clientHeight * devicePixelRatio));
  const s = min(1, sqrt(pix / (DW * DH)));
  const w = max(2, round(DW * s) & ~1), h = max(2, round(DH * s) & ~1);
  if (w === W && h === H) return;
  dynN = dynG = dynGN = 0; dynT = -300; // let the new size settle before measuring again
  canvas.width = w; canvas.height = h;
  ctx.configure({ device, format: FMT, alphaMode: 'opaque' });
  makeTargets(w, h);
}
// the render targets for a w x h view: the window's (resize) or one eye's (xr.js)
function makeTargets(w, h) {
  W = w; H = h;
  for (const t of targets) t.destroy();
  const tMS = tex(AA > 1 ? W : 1, H, HDR, TU.RENDER_ATTACHMENT, { samples: AA }), tDp = tex(W, H, DEPTH, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING, { samples: AA });
  const tRes = tex(W, H, HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING), tRay = tex(W / 2, H / 2, HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING), tRay2 = tex(W / 2, H / 2, HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING);
  targets = [tMS, tDp, tRes, tRay, tRay2];
  const bl = [];
  for (let i = 0; i < NB; i++) { const t = tex(max(1, W >> (i + 1)), max(1, H >> (i + 1)), HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING); bl.push(t); targets.push(t); }
  const vDp = tDp.createView(), vRes = tRes.createView(), vRay = tRay.createView(), vRay2 = tRay2.createView(), vBl = bl.map((t) => t.createView());
  // without anti-aliasing (Low) the scene goes straight into the resolve target, and tMS is one unused column
  passScene = { colorAttachments: [{ view: AA > 1 ? tMS.createView() : vRes, resolveTarget: AA > 1 ? vRes : undefined, loadOp: 'clear', storeOp: AA > 1 ? 'discard' : 'store', clearValue: [0, 0, 0, 1] }],
    depthStencilAttachment: { view: vDp, depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'store' } };
  passRays = { colorAttachments: [colorAtt(vRay, true)] };
  passBlur = { colorAttachments: [colorAtt(vRay2, true)] };
  bgBlur = device.createBindGroup({ layout: pRB.getBindGroupLayout(0), entries: [{ binding: 0, resource: vRay }] });
  passPost = { colorAttachments: [{ view: null, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] };
  bgRays = device.createBindGroup({ layout: pRays.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ubo } }, { binding: 1, resource: sRep }, { binding: 2, resource: sCmp },
    { binding: 3, resource: tShadow.createView() }, { binding: 4, resource: tWater.createView() }, { binding: 5, resource: vDp }, { binding: 6, resource: tVol.createView() }, { binding: 7, resource: sClamp }] });
  bgPost = device.createBindGroup({ layout: plPostBGL, entries: [{ binding: 0, resource: { buffer: ubo } }, { binding: 1, resource: sClamp }, { binding: 2, resource: vRes },
    { binding: 3, resource: vRay2 }, { binding: 4, resource: vBl[0] }, { binding: 5, resource: vDp }] });
  bloomPass = []; bloomBG = [];
  // down: res -> b0 -> ... -> b5 ; up: b5 -> b4 (additive) ... -> b0
  for (let i = 0; i < NB; i++) { bloomPass.push({ colorAttachments: [colorAtt(vBl[i], true)] }); bloomBG.push(blitBG(i ? vBl[i - 1] : vRes)); }
  for (let i = NB - 1; i > 0; i--) { bloomPass.push({ colorAttachments: [colorAtt(vBl[i - 1], false)] }); bloomBG.push(blitBG(vBl[i])); }
  UB[52] = W; UB[53] = H; UB[54] = 1 / W; UB[55] = 1 / H;
}
let xs = null; // the WebXR session while in VR (xr.js)
resize();
addEventListener('resize', resize);

// ---------------------------------------------------------------- timing (GPU timestamp queries)
let qs, qResolve, qRead = [], tsBegin, tsEnd;
if (hasTS) {
  qs = device.createQuerySet({ type: 'timestamp', count: 2 });
  qResolve = device.createBuffer({ size: 16, usage: BU.QUERY_RESOLVE | BU.COPY_SRC });
  for (let i = 0; i < 6; i++) {
    const b = device.createBuffer({ size: 16, usage: BU.MAP_READ | BU.COPY_DST });
    const o = { b, busy: false, done: null };
    o.done = () => {
      const a = new BigInt64Array(b.getMappedRange());
      const ms = Number(a[1] - a[0]) / 1e6; F[GPU] = ms; b.unmap(); o.busy = false;
      if (dynT > 0 && ms > 0 && ms < 1e3) { dynG += ms; dynGN++; }
    };
    qRead.push(o);
  }
  tsBegin = { querySet: qs, beginningOfPassWriteIndex: 0 }; tsEnd = { querySet: qs, endOfPassWriteIndex: 1 };
}

// ---------------------------------------------------------------- frame
let hud = false;
let kf = 0, kb = 0, kl = 0, kr = 0, ku = 0, kd = 0, ks = 0, mdx = 0, mdy = 0, lkx = 0, lky = 0, l2x = 0, l2y = 0, hN = 0, hMax = 0, hMin = 1e9, hPer = 1e9, hLate = 0, hTot = 0, tId = -1, tN = 0, tx0 = 0, ty0 = 0, tx = 0, ty = 0;
const TANH = 0.6, NEAR = 0.1, EXPO = 0.62, RAYS = 1, EYE = 1;
// view culling: tangents of the half field of view, and whether they follow the window (VR sets its own, wider ones)
let CTX = 0, CTY = TANH;
const submitList = [null];
const rowOrd = new Uint8Array(CELLS);
// Draws the cells of a cell-sorted buffer that are in view and within [minD, maxD) (scaled by `det`, but not for the
// terrain) as merged runs, nearest rows first.
function drawCells(r, start, lo, hi, mar, indexed, verts, minD, maxD) {
  const eh = EYE - dip, cx = F[CX] + F[GX] * eh, cy = F[CY] + F[GY] * eh, cz = F[CZ] + F[GZ] * eh, fx = F[FX], fy = F[FY], fz = F[FZ], rx = F[RX], ry = F[RY], rz = F[RZ], ux = F[UX], uy = F[UY], uz = F[UZ];
  const ds = indexed === 1 ? 1 : det * det;
  const tx = CTX || TANH * W / H, hw = CELLW * 0.5, ex = hw + mar, min2 = minD * minD * ds, max2 = maxD * maxD * ds;
  for (let k = 0; k < CELLS; k++) {
    const rw = rowOrd[k], row = rw * CELLS, pz = OZ + (rw + 0.5) * CELLW - cz, hz = max(abs(pz) - hw, 0);
    let run = -1;
    for (let x = 0; x <= CELLS; x++) {
      const c = row + x; let v = false;
      if (x < CELLS) {
        const l = lo[c], h = hi[c];
        if (l <= h) {
          const px = OX + (x + 0.5) * CELLW - cx, py = (l + h) * 0.5 - cy, ey = (h - l) * 0.5 + mar, hx = max(abs(px) - hw, 0), h2 = hx * hx + hz * hz;
          if (h2 < max2 && h2 >= min2) {
            const lim = px * fx + py * fy + pz * fz + ex * abs(fx) + ey * abs(fy) + ex * abs(fz);
            if (lim >= 0 && abs(px * rx + py * ry + pz * rz) - ex * (abs(rx) + abs(rz)) - ey * abs(ry) <= lim * tx) v = abs(px * ux + py * uy + pz * uz) - ex * (abs(ux) + abs(uz)) - ey * abs(uy) <= lim * CTY;
          }
        }
      }
      if (v) { if (run < 0) run = c; } else if (run >= 0) {
        const a = start[run], n = start[c] - a;
        if (n > 0) { if (indexed === 1) r.drawIndexed(n * 6, 1, a * 6, 0, nSolid); else if (indexed) r.drawIndexed(indexed.ib.length, n, indexed.i0, indexed.v0, a); else r.draw(verts, n, 0, a); }
        run = -1;
      }
    }
  }
}
// Fills the camera part of UB: eye at c, orthonormal right / up / forward vectors, and the projection
// x_ndc = a * x / depth - ox, y_ndc = b * y / depth - oy (ox = oy = 0 for a centred view, as on the desktop; a VR eye
// is off-centre). Depth is reversed and infinite: z_ndc = NEAR / depth. The shaders rebuild view rays as
// fwd + right * (x_ndc * right.w) + up * (y_ndc * up.w), so `fwd` takes the off-centre shift.
function setCam(cx, cy, cz, rx, ry, rz, ux, uy, uz, fx, fy, fz, a, b, ox, oy) {
  const m = UB;
  m[0] = a * rx - ox * fx; m[4] = a * ry - ox * fy; m[8] = a * rz - ox * fz; m[12] = -(m[0] * cx + m[4] * cy + m[8] * cz);
  m[1] = b * ux - oy * fx; m[5] = b * uy - oy * fy; m[9] = b * uz - oy * fz; m[13] = -(m[1] * cx + m[5] * cy + m[9] * cz);
  m[2] = 0; m[6] = 0; m[10] = 0; m[14] = NEAR;
  m[3] = fx; m[7] = fy; m[11] = fz; m[15] = -(fx * cx + fy * cy + fz * cz);
  m[32] = cx; m[33] = cy; m[34] = cz; m[35] = F[TIME];
  m[36] = rx; m[37] = ry; m[38] = rz; m[39] = 1 / a;
  m[40] = ux; m[41] = uy; m[42] = uz; m[43] = 1 / b;
  m[44] = fx + (rx * ox) / a + (ux * oy) / b; m[45] = fy + (ry * ox) / a + (uy * oy) / b; m[46] = fz + (rz * ox) / a + (uz * oy) / b; m[47] = NEAR;
  m[51] = 0; m[56] = EXPO; m[57] = RAYS; m[58] = det;
}
function render() {
  // camera basis (right vector is horizontal)
  basis();
  setCam(F[CX], F[CY], F[CZ], F[RX], F[RY], F[RZ], F[UX], F[UY], F[UZ], F[FX], F[FY], F[FZ], 1 / (TANH * W / H), 1 / TANH, 0, 0);
  Q.writeBuffer(ubo, 0, UB);
  const e = device.createCommandEncoder();
  passPost.colorAttachments[0].view = ctx.getCurrentTexture().createView();
  draw(e, true, true, pPost, passPost, null, true);
  submitList[0] = e.finish();
  Q.submit(submitList);
}
// Records one view's passes into e: the scene from the camera in UB (already written), composited by `post` into
// `outPass` (inside viewport vp, or all of it). first: the frame's first view, which also animates the water texture;
// last: its last view, which reads back the GPU time measured since the first. bloom: false skips the bloom chain.
let tsSlot = null;
function draw(e, first, last, post, outPass, vp, bloom) {
  if (first) {
    WT[0] = F[TIME] * 0.1; Q.writeBuffer(uboW, 0, WT);
    tsSlot = null;
    if (hasTS) { for (let i = 0; i < qRead.length; i++) if (!qRead[i].busy) { tsSlot = qRead[i]; break; } }
  }
  const slot = tsSlot;
  { let cr = floor((F[CZ] - OZ) / CELLW) | 0; cr = cr < 0 ? 0 : cr > CELLS - 1 ? CELLS - 1 : cr; let n = 0; rowOrd[n++] = cr; for (let d = 1; d < CELLS; d++) { if (cr - d >= 0) rowOrd[n++] = cr - d; if (cr + d < CELLS) rowOrd[n++] = cr + d; } }
  let r;
  if (first) {
    // animated water texture + mips
    waterPass[0].timestampWrites = slot ? tsBegin : undefined;
    r = e.beginRenderPass(waterPass[0]); r.setPipeline(pWater); r.setBindGroup(0, bgWater); r.draw(3); r.end();
    for (let i = 1; i < 5; i++) { r = e.beginRenderPass(waterPass[i]); r.setPipeline(pMip16); r.setBindGroup(0, waterBG[i - 1]); r.draw(3); r.end(); }
  }
  // scene
  r = e.beginRenderPass(passScene);
  r.setBindGroup(0, bg0);
  r.setPipeline(pTerrain); r.setVertexBuffer(0, vbTerrain); r.setVertexBuffer(1, ibSolids); r.setIndexBuffer(ibTerrain, 'uint32');
  drawCells(r, T.start, T.lo, T.hi, 1.5, 1, 0, 0, 900);
  r.setPipeline(pSolid); r.setVertexBuffer(0, vbMesh); r.setIndexBuffer(ibMesh, 'uint32');
  for (let i = 0; i < 28; i++) { const g = Wd.solids.ranges[i]; if (g[1]) r.drawIndexed(meshes[i].ib.length, g[1], meshes[i].i0, meshes[i].v0, g[0]); }
  for (let i = 0; i < NCHUNK; i++) {
    const c = Wd.chunks[i], big = i > 2 && i < 6; r.setVertexBuffer(1, ibChunk[i]);
    drawCells(r, c.start, c.lo, c.hi, 3, meshes[14 + i], 0, 0, i > 5 ? 30 : big ? 40 : 96);
    if (big) drawCells(r, c.start, c.lo, c.hi, 3, meshes[20 + i], 0, 40, 330);
  }
  for (let i = 0; i < 6; i++) {
    const lod = i === 3 || i === 4; r.setVertexBuffer(1, ibProp[i]);
    drawCells(r, Wd.props[i].start, Wd.props[i].lo, Wd.props[i].hi, 3, meshes[4 + i], 0, 0, lod ? 6 : 330);
    if (lod) drawCells(r, Wd.props[i].start, Wd.props[i].lo, Wd.props[i].hi, 3, meshes[18 + i], 0, 6, 330);
  }
  r.setPipeline(pManta); r.setVertexBuffer(1, ibManta); r.drawIndexed(MANTA.ib.length, nManta, MANTA.i0, MANTA.v0, 0);
  r.setPipeline(pFish); r.setVertexBuffer(1, ibFish); r.drawIndexed(FISH.ib.length, nFish, FISH.i0, FISH.v0, 0);
  // kelp and plants: 9-row blades up close, 5 rows mid-range, a decimated set far away
  r.setPipeline(pLeaf); r.setVertexBuffer(0, ibBig); drawCells(r, Wd.big.start, Wd.big.lo, Wd.big.hi, 5, false, 18, 0, 24);
  r.setPipeline(pLeaf5); drawCells(r, Wd.big.start, Wd.big.lo, Wd.big.hi, 5, false, 10, 24, 58);
  r.setPipeline(pLeafF); r.setVertexBuffer(0, ibBigF); drawCells(r, Wd.bigF.start, Wd.bigF.lo, Wd.bigF.hi, 5, false, 6, 58, 150);
  r.setPipeline(pLeafS); r.setVertexBuffer(0, ibSmall); drawCells(r, Wd.small.start, Wd.small.lo, Wd.small.hi, 1.5, false, 6, 0, 70);
  r.setPipeline(pBack); r.draw(4);
  r.setPipeline(pBub); r.setVertexBuffer(0, ibBubbles); r.draw(4, nBub);
  r.setPipeline(pGl); r.setVertexBuffer(0, ibGl); r.draw(4, nGl);
  r.setPipeline(pSnow); r.setVertexBuffer(0, ibSnowB); r.draw(4, nSnow);
  r.setPipeline(pTail); r.draw(4, nSnow);
  r.end();
  // light shafts
  r = e.beginRenderPass(passRays); r.setPipeline(pRays); r.setBindGroup(0, bgRays); r.draw(3); r.end();
  r = e.beginRenderPass(passBlur); r.setPipeline(pRB); r.setBindGroup(0, bgBlur); r.draw(3); r.end();
  // bloom
  if (bloom) for (let i = 0; i < bloomPass.length; i++) {
    r = e.beginRenderPass(bloomPass[i]); r.setPipeline(i === 0 ? pDown0 : i < NB ? pDown : pUp); r.setBindGroup(0, bloomBG[i]); r.draw(3); r.end();
  }
  // composite
  outPass.timestampWrites = slot && last ? tsEnd : undefined;
  r = e.beginRenderPass(outPass); r.setPipeline(post); r.setBindGroup(0, bgPost);
  if (vp) r.setViewport(vp.x, vp.y, vp.width, vp.height, 0, 1);
  r.draw(3); r.end();
  if (slot && last) {
    e.resolveQuerySet(qs, 0, 2, qResolve, 0); e.copyBufferToBuffer(qResolve, 0, slot.b, 0, 16);
    slot.busy = true; queueMicrotask(() => slot.b.mapAsync(GPUMapMode.READ).then(slot.done)); // mapped after the submit
  }
}

// CS[j] = distance to the rock (metres, < 0 in water) at the camera + CE[3j..3j+2]: the camera, then ±0.375 m on
// each axis for the gradient
const CE = new Float64Array([0, 0, 0, .375, 0, 0, -.375, 0, 0, 0, .375, 0, 0, -.375, 0, 0, 0, .375, 0, 0, -.375]), CS = new Float64Array(7);
const cv = (x, y, z) => { const b = CI[(x >> 2) + CN * ((y >> 2) + NY / 4 * (z >> 2))]; return b > 1 ? CG[b * 64 - 128 + (x & 3) + 4 * (y & 3) + 16 * (z & 3)] : b * 254 - 127; };
function sd(j) {
  const x = (F[CX] + CE[j * 3] - OX) / VS - CO, y = (F[CY] + CE[j * 3 + 1] - OY) / VS, z = (F[CZ] + CE[j * 3 + 2] - OZ) / VS - CO;
  if (x < 1 || y < 1 || z < 1 || x > CN * 4 - 3 || y > NY - 3 || z > CN * 4 - 3) { CS[j] = -1; return; } // outside the grid: open space
  const ix = x | 0, iy = y | 0, iz = z | 0, u = x - ix, v = y - iy, a = cv(ix, iy, iz), b = cv(ix, iy + 1, iz), c = cv(ix, iy, iz + 1), d = cv(ix, iy + 1, iz + 1);
  const p = a + (cv(ix + 1, iy, iz) - a) * u, q = b + (cv(ix + 1, iy + 1, iz) - b) * u, r = c + (cv(ix + 1, iy, iz + 1) - c) * u, s = d + (cv(ix + 1, iy + 1, iz + 1) - d) * u;
  const e = p + (q - p) * v; CS[j] = (e + (r + (s - r) * v - e) * (z - iz)) / 127;
}
// Moves the camera by F[MX..MZ] in steps shorter than its radius CR (so it can't pass through thin rock), pushing it
// back out after each step and dropping velocity into the rock, so it slides along.
const CR = 0.7;
// keep the camera out of an ellipsoid at c with the axis a (radius ra across it, rb along it) moving at o
function hit(cx, cy, cz, ax, ay, az, ra, rb, ox, oy, oz, dt, walk) {
  const dx = F[CX] - cx, dy = F[CY] - cy, dz = F[CZ] - cz, k = ra / rb, h = (dx * ax + dy * ay + dz * az) * (k - 1);
  // stretched along the axis the ellipsoid is a ball of radius ra
  const ex = dx + ax * h, ey = dy + ay * h, ez = dz + az * h, l = sqrt(ex * ex + ey * ey + ez * ez);
  if (l >= ra || l < 1e-3) return;
  const s = ra / l, e2 = (ex * ax + ey * ay + ez * az) * s * (1 / k - 1);
  F[CX] = cx + ex * s + ax * e2; F[CY] = cy + ey * s + ay * e2; F[CZ] = cz + ez * s + az * e2;
  const g2 = (ex * ax + ey * ay + ez * az) * (k - 1); let nx = ex + ax * g2, ny = ey + ay * g2, nz = ez + az * g2; const nl = sqrt(nx * nx + ny * ny + nz * nz) || 1; nx /= nl; ny /= nl; nz /= nl;
  let rx = F[VX] - ox, ry = F[VY] - oy, rz = F[VZ] - oz; const vn = rx * nx + ry * ny + rz * nz;
  if (vn < 0) { rx -= nx * vn; ry -= ny * vn; rz -= nz * vn; if (vn < -1.5 && !landHit) landHit = -vn; }
  if (walk) { if (nx * upx + ny * upy + nz * upz > 0.45) { onGround = 1; gnx = nx; gny = ny; gnz = nz; } }
  else { const f = exp(-dt * 5); rx *= f; ry *= f; rz *= f; } // friction against what you touch
  F[VX] = rx + ox; F[VY] = ry + oy; F[VZ] = rz + oz;
}
function collide() {
  let n = floor(sqrt(F[MX] * F[MX] + F[MY] * F[MY] + F[MZ] * F[MZ]) / 0.4) + 1; if (!(n < 300)) n = 300;
  for (let i = 0; i < n; i++) {
    F[CX] += F[MX] / n; F[CY] += F[MY] / n; F[CZ] += F[MZ] / n;
    for (let k = 0; k < 2; k++) {
      sd(0); const s = CS[0] + CR; if (s <= -0.35) break;
      for (let j = 1; j < 7; j++) sd(j);
      let gx = CS[1] - CS[2], gy = CS[3] - CS[4], gz = CS[5] - CS[6]; const l = sqrt(gx * gx + gy * gy + gz * gz);
      if (l < 0.075) break; // flat: deep in rock
      gx /= l; gy /= l; gz /= l; const vn = F[VX] * gx + F[VY] * gy + F[VZ] * gz;
      if (gx * upx + gy * upy + gz * upz < -0.45) { onGround = 1; gnx = -gx; gny = -gy; gnz = -gz; } // rock underfoot (within a hand's width)
      if (s <= 0) break;
      F[CX] -= gx * s; F[CY] -= gy * s; F[CZ] -= gz * s;
      if (vn > 0) { F[VX] -= gx * vn; F[VY] -= gy * vn; F[VZ] -= gz * vn; }
    }
  }
}

// the start page: a slow orbit of the asteroid. The first click eases the camera down to the landing site: the
// direction and the distance ease separately, so the path bends round the asteroid and never through it
let land = 0, started = 0, hs = 0, hT = 0; const L0 = new Float64Array(6), tip = $('t');
const hint = (m) => { if (m) tip.textContent = m; tip.className = m ? 'on' : ''; };
function title(dt) {
  if (!started) { const a = F[TIME] * 0.025 - 1.7, c = cos(a), s = sin(a); L0[0] = c * 150; L0[1] = 38; L0[2] = s * 150; L0[3] = -s * 36; L0[4] = 4; L0[5] = c * 36; return lookAt(...L0); }
  land += dt / 6; if (land > 1) land = 1;
  const e = land * land * land * (land * (land * 6 - 15) + 10), p = POSES[0], r0 = hypot(L0[0], L0[1], L0[2]), r1 = hypot(p[0], p[1], p[2]);
  const d = nrm3([L0[0] / r0 * (1 - e) + p[0] / r1 * e, L0[1] / r0 * (1 - e) + p[1] / r1 * e, L0[2] / r0 * (1 - e) + p[2] / r1 * e]), r = r0 + (r1 - r0) * e;
  lookAt(d[0] * r, d[1] * r, d[2] * r, L0[3] + (p[3] - L0[3]) * e, L0[4] + (p[4] - L0[4]) * e, L0[5] + (p[5] - L0[5]) * e);
  mdx = mdy = 0;
}
function frame(now) {
  requestAnimationFrame(frame);
  if (xs) { F[LAST] = now; return; } // in VR the headset drives the frames (xr.js)
  const dtr = now - F[LAST]; F[LAST] = now;
  let dt = dtr / 1000; dt = dt > 0.1 ? 0.1 : dt > 0 ? dt : 0;
  // Dynamic resolution for 60 fps: every second (0.4 s behind the menu) scale the load by k
  if (dtr < 1e3 && (dynT += dtr) > 0 && (dynN++, dynT > (menu ? 400 : 1000))) {
    const a = dynT / dynN, g = dynGN ? dynG / dynGN : 0; let k = 1;
    // with GPU timing: keep it between 9.8 and 13.6 ms
    if (g) { if (g > 13.6 || g < 9.8) k = 11.7 / g; }
    // without: slow for two periods in a row means fewer pixels, and twice as long before trying to go back up
    else if (a > 17.6) { dynOk = 0; if (++dynBad > 1) { k = 15 / a; dynBad = 0; dynWait = min(dynWait * 2, 60); } }
    // at the display's rate there is no telling if there is room, so try a little more now and then
    else { dynBad = 0; if (a < 12.5) k = 15 / a; else if (++dynOk > dynWait) { k = 1.17; dynOk = 0; } }
    k = k < 0.5 ? 0.5 : k > 1.7 ? 1.7 : k; const top = min(PIXMAX, DW * DH), mid = max(top / 2, PIXMIN), was = pix + det;
    // too slow: pixels down to `mid` first, then draw distance, then the remaining pixels; faster goes back the same way
    if (k < 1 ? pix > mid || det <= DETMIN : pix < mid || det >= 1) {
      const end = k < 1 ? (det > DETMIN ? mid : PIXMIN) : det < 1 ? mid : top;
      pix *= k; if (k < 1 ? pix < end : pix > end) pix = end;
    } else { det *= sqrt(k); det = det < DETMIN ? DETMIN : det > 1 ? 1 : det; }
    if (was !== pix + det) keep('nebula', [LV, pix < top ? pix | 0 : '', det]); // nothing kept at full resolution
    dynN = dynT = dynG = dynGN = 0; resize();
  }
  step(dt);
  render();
  if (hud) {
    hN++; if (dtr > hMax) hMax = dtr; if (dtr < hMin) hMin = dtr; if (dtr > hPer * 1.5) { hLate++; hTot++; }
    F[HUDT] += dtr / 1000;
    if (F[HUDT] > 0.5) { info.textContent = `${(hN / F[HUDT]).toFixed(0)} fps  ·  worst frame ${hMax.toFixed(1)} ms  ·  late frames ${hLate} (total ${hTot})  ·  GPU ${F[GPU].toFixed(2)} ms  ·  ${W}x${H} (${W * 100 / DW | 0}%)`; F[HUDT] = 0; hPer = hMin; hN = 0; hMax = 0; hMin = 1e9; hLate = 0; }
  }
}
// one tick of the game: the title flight until landed, then walking / flying, collisions and the hints. VR (xr.js)
// calls it with the headset's inputs in the same key variables.
function step(dt) {
  F[TIME] += dt;
  if (land < 1) title(dt); else {
    // touch: holding the finger away from where it went down keeps turning, like a joystick
    if (tId >= 0) {
      const tr = 4 / (innerWidth < innerHeight ? innerWidth : innerHeight); let jx = (tx - tx0) * tr, jy = (ty - ty0) * tr;
      jx = jx > 1 ? 1 : jx < -1 ? -1 : jx; jy = jy > 1 ? 1 : jy < -1 ? -1 : jy;
      lkx += jx * 1.5 * dt; lky += jy * dt;
    }
    // mouse look through two cascaded low-pass stages
    const kq = 1 - exp(-dt * 30); lkx += mdx * 0.0022; lky += mdy * 0.0022; mdx = 0; mdy = 0;
    const ax = lkx * kq, ay = lky * kq; lkx -= ax; lky -= ay; l2x += ax; l2y += ay;
    const dyw = l2x * kq, dpt = l2y * kq; l2x -= dyw; l2y -= dpt;
    let pitch = F[PIT] - dpt; pitch = pitch < -1.5 ? -1.5 : pitch > 1.5 ? 1.5 : pitch; F[PIT] = pitch;
    // up eases toward "away from the asteroid" (not at all near its middle, where that flips); the heading stays
    // square to it and turns with the mouse
    upAt();
    let ar = (alt + 46) / 20; ar = ar < 0 ? 0 : ar > 1 ? 1 : ar;
    const ke = 1 - exp(-dt * 6 * ar);
    let gx = F[GX] + (upx - F[GX]) * ke, gy = F[GY] + (upy - F[GY]) * ke, gz = F[GZ] + (upz - F[GZ]) * ke, l = sqrt(gx * gx + gy * gy + gz * gz) || 1; gx /= l; gy /= l; gz /= l;
    let hx = F[HX], hy = F[HY], hz = F[HZ]; const hd = hx * gx + hy * gy + hz * gz; hx -= gx * hd; hy -= gy * hd; hz -= gz * hd; l = sqrt(hx * hx + hy * hy + hz * hz) || 1; hx /= l; hy /= l; hz /= l;
    let rx = hy * gz - hz * gy, ry = hz * gx - hx * gz, rz = hx * gy - hy * gx;
    const ca = cos(dyw), sa = sin(dyw); hx = hx * ca + rx * sa; hy = hy * ca + ry * sa; hz = hz * ca + rz * sa;
    rx = hy * gz - hz * gy; ry = hz * gx - hx * gz; rz = hx * gy - hy * gx;
    F[GX] = gx; F[GY] = gy; F[GZ] = gz; F[HX] = hx; F[HY] = hy; F[HZ] = hz;
    const fast = ks || tN > 1, mf = tId >= 0 ? 0.7 : kf - kb, mr = kr - kl, mu = ku - kd, cp = cos(pitch), sp = sin(pitch);
    let vx = F[VX], vy = F[VY], vz = F[VZ], push = 0;
    if (grounded && !(ku && 1)) {
      // on foot: friction pulls the velocity along the ground to what the keys ask for (nothing: you stop), and
      // gravity presses along the ground's own normal, so a slope does not slide you
      const ws = fast ? 11 : 5.5, k = 1 - exp(-dt * 10), vn = vx * gnx + vy * gny + vz * gnz, pr = (grav + 8) * dt;
      vx += ((hx * mf + rx * mr) * ws - (vx - gnx * vn)) * k - gnx * pr; vy += ((hy * mf + ry * mr) * ws - (vy - gny * vn)) * k - gny * pr; vz += ((hz * mf + rz * mr) * ws - (vz - gnz * vn)) * k - gnz * pr;
    } else {
      // off the ground nothing slows you: thrusters push along where you look, sideways and along your up, gravity
      // pulls toward the asteroid, and whatever speed you have you keep
      if (grounded && vx * gx + vy * gy + vz * gz < 2) { vx += gx * 4.5; vy += gy * 4.5; vz += gz * 4.5; } // leaving the ground: a jump
      const a = (fast ? 16 : 8) * dt, g = grav * dt, fx = hx * cp + gx * sp, fy = hy * cp + gy * sp, fz = hz * cp + gz * sp;
      vx += (fx * mf + rx * mr + gx * mu) * a - upx * g; vy += (fy * mf + ry * mr + gy * mu) * a - upy * g; vz += (fz * mf + rz * mr + gz * mu) * a - upz * g;
      push = (mf || mr || mu) ? (fast ? 1 : 0.6) : 0;
    }
    thr += (push - thr) * (1 - exp(-dt * 14));
    // a soft leash 190 m out, so a hard burn cannot lose the asteroid
    if (alt > 136) { const s = (alt - 136) * 0.5 * dt; vx -= upx * s; vy -= upy * s; vz -= upz * s; }
    const fall = -(vx * upx + vy * upy + vz * upz), was = grounded;
    F[VX] = vx; F[VY] = vy; F[VZ] = vz; F[MX] = vx * dt; F[MY] = vy * dt; F[MZ] = vz * dt;
    onGround = 0;
    collide();
    // the moonlets are solid too: balls that push you out
    for (const m of MOONS) { const an = F[TIME] * m[4], cs = cos(an), sn = sin(an), px = cs * m[0] + sn * m[2], pz = cs * m[2] - sn * m[0], R = m[3] * 0.95 + CR; hit(px, m[1], pz, 0, 1, 0, R, R, m[4] * pz, 0, -m[4] * px, dt, 0); }
    grounded = onGround;
    if (grounded && !was && fall > 1) { landHit = fall; dip = fall * 0.06 > 0.5 ? 0.5 : fall * 0.06; } // touchdown: a thud and a dip of the knees
    dip *= exp(-dt * 7);
  }
  // hints: each control is named the first time it is needed
  if (land >= 1 && hs < 4) {
    if (!hs) { hint(mob ? 'Hold to move · slide to look · second finger to boost' : 'W A S D to walk · mouse to look'); hs = mob ? 3 : 1; hT = F[TIME] + 9; }
    else if (hs < 2 && (kf || kb || kl || kr)) { hint('Space to jump · hold it to fly'); hs = 2; }
    else if (hs < 3 && ku && !grounded) { hint('Shift to boost · Q to descend · Esc for all controls'); hs = 3; hT = F[TIME] + 9; }
    else if (hs > 2 && F[TIME] > hT) { hint(''); hs = 4; }
  }
}

// ---------------------------------------------------------------- input
const key = (e, v) => {
  switch (e.code) {
    case 'KeyW': kf = v; break; case 'KeyS': kb = v; break; case 'KeyA': kl = v; break; case 'KeyD': kr = v; break;
    case 'KeyE': case 'Space': ku = v; break; case 'KeyQ': kd = v; break; case 'ShiftLeft': case 'ShiftRight': ks = v; break;
    default: if (v && !e.repeat) {
      if (e.code === 'KeyH') { hud = !hud; hTot = 0; hPer = 1e9; info.textContent = ''; }
      else if (e.code === 'KeyM') mute();
      else if (e.code === 'Escape') ui(true);
      else if (e.code >= 'Digit1' && e.code <= 'Digit6') lookAt(...POSES[e.code.charCodeAt(5) - 49]);
    }
  }
};
// behind the menu only the stats and mute keys work
addEventListener('keydown', (e) => { if (menu && e.code !== 'KeyH' && e.code !== 'KeyM') return; sound(); key(e, 1); });
addEventListener('keyup', (e) => key(e, 0));
const release = () => { kf = kb = kl = kr = ku = kd = ks = 0; tId = -1; tN = 0; };
const capture = () => { sound(); const p = canvas.requestPointerLock({ unadjustedMovement: true }); if (p && p.catch) p.catch(() => canvas.requestPointerLock()).catch(() => 0); };
canvas.addEventListener('click', capture);
addEventListener('mousemove', (e) => { if (document.pointerLockElement === canvas) { mdx += e.movementX; mdy += e.movementY; } });
addEventListener('blur', release);
const touch = (e) => {
  e.preventDefault(); sound(); tN = e.touches.length;
  let f = null, first = false; for (let i = 0; i < tN; i++) if (e.touches[i].identifier === tId) f = e.touches[i];
  if (!f) { tId = -1; if (tN) { f = e.touches[0]; tId = f.identifier; first = true; } }
  if (f) {
    // the touch axes turn with the page when it lies on its side
    const x = rot.matches ? f.clientY : f.clientX, y = rot.matches ? -f.clientX : f.clientY, s = 1100 / min(innerWidth, innerHeight);
    if (first) { tx0 = x; ty0 = y; } else { mdx += (x - tx) * s; mdy += (y - ty) * s; } // the view follows the finger at once
    tx = x; ty = y;
  }
};
for (const n of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) canvas.addEventListener(n, touch, { passive: false });

// ---------------------------------------------------------------- start page and pause page
// The scene keeps rendering behind both. Esc, losing the mouse or the corner button pause.
let menu = true;
const bDive = $('d'), verb = mob ? 'Tap to ' : 'Click to ';
bDive.textContent = verb + 'land';
const ui = (m) => {
  if (dead) return;
  menu = m; body.className = m ? (started ? 'm r' : 'm') : document.pointerLockElement ? 'g p' : 'g';
  // focus the one action so Enter works (delayed: it can't take focus while still hidden)
  if (m) { release(); setTimeout(() => menu && bDive.focus(), 100); } else document.activeElement.blur();
};
const go = () => {
  sound(); started = 1; ui(false); bDive.textContent = verb + 'resume';
  // phones: go fullscreen and ask for landscape; where that is refused the CSS rotation still applies
  if (mob) document.documentElement.requestFullscreen?.()?.then(() => screen.orientation.lock('landscape')).catch(() => 0);
  if (!mob) capture();
};
// a click anywhere on the page starts or resumes, except on the small print
$('m').onclick = (e) => { if (menu && body.className[0] === 'm' && !e.target.closest('#x')) go(); };
$('o').onclick = () => ui(true);
// quality: the current level is marked, the others reload the page with theirs
$('q').querySelectorAll('button').forEach((b, i) => { if (i === 2 - LV) b.className = 'on'; else b.onclick = () => { keep('nebula', 2 - i); location.reload(); }; });
document.addEventListener('pointerlockchange', () => ui(!document.pointerLockElement));

// draw the first frame and wait for the GPU to finish it (pipelines get compiled on first use) before the reveal
lookAt(...POSES[0]);
await say('Lighting the star…', 1, 400);
render(); await Q.onSubmittedWorkDone();
setTimeout(keep, 15e3, 'nebulaLoad', ''); // the load counts as survived after 15 s of frames
ui(true);
requestAnimationFrame((t) => { F[LAST] = t; requestAnimationFrame(frame); });
