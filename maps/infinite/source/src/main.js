// ============================================================================
// world loading, camera, frame loop and input
// ============================================================================
// preset viewpoints (position, look-at), keys 1-6; the world generator dresses the scene around them
const POSES = [
  [10, 1.3, 7, -9, -31, -10],
  [50, 1.3, 34, 58, -23, 8],
  [-26, 2.2, -100, 0, -9, -108],
  [-55, 1.5, -18, -60, -30, 8],
  [10, 1.2, -62, 6, -22, -90],
  [3, 1.6, 62, 1, -28, 100],
];
// keys 7-0: four places further and further down, found when the world loads (see below)
const DEEPS = [];
// 60 s camera path (position + look-at, Catmull-Rom): the world generator keeps it clear, dev.js flies along it
const FLY = new Float32Array([
  10, -42.2, 7, -9, -31, -10,
  7.5, -41.8, 5.5, -10, -31, -12,
  9, -40.5, 18, 17, -37, 42,
  22, -39.2, 40, 48, -36, 45,
  38, -39.2, 46, 57, -27, 18,
  50, -40.4, 35, 58, -24, 8,
  55, -39, 20, 60, -18, -10,
  58, -34, -12, 40, -26, -60,
  50, -30, -44, 10, -26, -80,
  30, -30, -70, 4, -28, -90,
  12, -38.5, -62, 6, -27, -90,
  -4, -36.5, -70, 0, -14, -100,
  -16, -37, -84, 0, -22, -108,
  -29, -38, -90, -44, -34, -60,
  -41, -38, -70, -56, -34, -40,
  -53, -38, -50, -60, -34, -20,
  -58, -38, -28, -60, -32, 0,
  -57, -38, -10, -60, -30, 16,
  -60, -38, 10, -50, -36, 40,
  -52, -37, 36, -20, -35, 44,
  -22, -38, 43, 4, -38, 52,
  -6, -39.2, 44.5, 4, -37, 70,
  3, -40.6, 53, 3, -35, 84,
  3, -41.5, 62, 1, -30, 100,
  4, -39, 76, 3, -22, 100,
]);
const FLYN = FLY.length / 6, FLYT = 60, LUTN = 1024, flyLUT = new Float32Array(LUTN + 1);
const flyPts = [];
// per-frame float state lives in one preallocated array, so the frame loop allocates no heap numbers
const F = new Float64Array(32), P6 = new Float64Array(6);
const CX = 0, CY = 1, CZ = 2, YAW = 3, PIT = 4, FX = 5, FY = 6, FZ = 7, RX = 8, RZ = 9, UX = 10, UY = 11, UZ = 12, VX = 13, VY = 14, VZ = 15, TIME = 16, FLT = 17, LAST = 18, GPU = 19, HUDT = 20, SPL = 21, MX = 22, MY = 23, MZ = 24;
// aim the camera from P6 = position + look-at point
function aim() {
  const dx = P6[3] - P6[0], dy = P6[4] - P6[1], dz = P6[5] - P6[2];
  F[CX] = P6[0]; F[CY] = P6[1]; F[CZ] = P6[2];
  F[YAW] = atan2(dx, -dz); F[PIT] = atan2(dy, sqrt(dx * dx + dz * dz));
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
for (const p of POSES) flyPts.push([p[0], -40, p[2]]);

// ---------------------------------------------------------------- set pieces
await say('Building set pieces…', 0.12, 600);
// marks a load in progress (quality.js); leaving the page before it ends is not a crash
keep('abyssalInfLoad', 1);
addEventListener('pagehide', () => keep('abyssalInfLoad', ''));
// mesh ids: 0-3 boulders, 4-6 sponges, 7-8 coral, 9 tube sponge, 10 whale fluke, 11 ship, 12 manta, 13 fish,
// 14-20 rock chunks + pebbles, 21-22 coral LOD, 23-25 far LOD of the large rock chunks
const meshes = [meshChunk(1, 3), meshChunk(7, 3), meshChunk(13, 3), meshChunk(22, 3),
  meshLathe([[0, 0, 0.5], [0.34, 0, 0.6], [0.5, 0.2, 0.85], [0.6, 0.6, 1], [0.55, 0.95, 1], [0.47, 1.08, 1], [0.38, 1.1, 0.9], [0.3, 1.0, 0.45], [0.26, 0.6, 0.15], [0, 0.35, 0.05]], 18, 0.3, 9),
  meshLathe([[0, 0, 0.5], [0.2, 0, 0.6], [0.26, 0.5, 0.85], [0.4, 1.25, 1], [0.4, 1.42, 1], [0.33, 1.48, 0.9], [0.26, 1.38, 0.4], [0.18, 0.8, 0.12], [0, 0.5, 0.05]], 16, 0.35, 8),
  meshLathe([[0, 0, 0.5], [0.5, 0, 0.7], [0.72, 0.18, 1], [0.74, 0.38, 1], [0.62, 0.5, 0.9], [0.48, 0.42, 0.45], [0.4, 0.2, 0.15], [0, 0.14, 0.06]], 18, 0.25, 10),
  meshCoral(0), meshCoral(1), meshTubes()].map((m) => m.build());
// (the ship's mesh also makes the field that keeps the creatures out of its timbers, bots.js)
const flukeMesh = meshFluke(), shipMesh = meshShip(); shipBuild(shipMesh);
meshes.push(flukeMesh, shipMesh.build(), meshManta().build(), meshFish().build(),
  meshChunk(3).build(), meshChunk(11).build(), meshChunk(29).build(), meshChunk(5, 3).build(), meshChunk(17, 3).build(), meshChunk(41, 3).build(), meshChunk(9, 1).build(), meshCoral(0, 1).build(), meshCoral(1, 1).build(), meshChunk(5, 2, 1).build(), meshChunk(17, 2, 1).build(), meshChunk(41, 2, 1).build());
const CRIT0 = meshes.length; meshes.push(...critMeshes()); // the creatures' meshes (creatures.js), in the order of CRIT
let nV = 0, nI = 0;
for (const m of meshes) { m.v0 = nV; m.i0 = nI; nV += m.nv; nI += m.ib.length; }
const allV = new Uint8Array(nV * 16), allI = new Uint32Array(nI);
for (const m of meshes) { allV.set(new Uint8Array(m.vb), m.v0 * 16); allI.set(m.ib, m.i0); }
const vbMesh = buf(allV, BU.VERTEX), ibMesh = buf(allI, BU.INDEX);
const MANTA = meshes[12], FISH = meshes[13];
// drifting particles
rseed(15);
const snow = new Float32Array(9000 * 4); for (let i = 0; i < snow.length; i++) snow[i] = rnd();
const ibSnowB = buf(snow, BU.VERTEX), nSnow = 9000 - LV * 3000; // Medium draws the first two thirds, Low the first third

// ---------------------------------------------------------------- the first window of the world
await say('Sculpting the seabed…', 0.2, 600);
// the viewpoints are given as heights above the sea floor
for (const p of POSES) p[1] += await groundAt(p[0], p[2]);
{
  // the nearest far-from-home formation around (x, z) that passes `ok`: its cell's shapes
  const near = (x, z, ok) => { let best = null, bd = 1e18; for (let cz = -7; cz <= 7; cz++) for (let cx = -7; cx <= 7; cx++) { const f = cellShapes(floor(x / FC) + cx, floor(z / FC) + cz); if (ok(f)) { const p = f.clears[0], d = hypot(p[0] - x, p[1] - z); if (d < bd) { bd = d; best = f; } } } return best; };
  // stands the camera `up` metres over the floor at (x, z), looking at a point `dy` higher or lower
  const stand = async (x, z, up, tx, tz, dy) => { const y = await groundAt(x, z) + up; DEEPS.push([x, y, z, tx, y + dy, tz]); };
  // 7: over the gorge, looking down along it (the rim is 55 m down)
  const gy = await groundAt(gorgeX(60) + 45, 60);
  DEEPS.push([gorgeX(60) + 4, gy + 15, 60, gorgeX(125), gy - 30, 125]);
  // 8: over the rift (its rim is about 90 m down, its bed nearly 300)
  const ry = await groundAt(riftX(-420) + 70, -420);
  DEEPS.push([riftX(-420) + 3, ry + 10, -420, riftX(-340), ry - 70, -340]);
  // 9: a rock formation halfway down the slope, about 200 m deep, seen from upslope
  const a = near(-1700, -900, (f) => f.mesas.length > 0 && f.clears[0][0] < -1500), ac = a ? a.clears[0] : [-1700, -900];
  await stand(ac[0] + 56, ac[1] + 16, 12, ac[0], ac[1], -3);
  // 0: far out on the abyssal plain, the deepest water there is: the nearest formation, or the open plain
  const d = near(-8200, 2600, (f) => f.clears.length > 0), dc = d ? d.clears[0] : [-8200, 2600];
  await stand(dc[0] + 40, dc[1] + 22, 9, dc[0], dc[1], -3);
}
startWorkers(POSES, flyPts);
lookAt(...POSES[0]);
// The browser remembers where the player is (localStorage.abyssalInfAt, written by keepAt: every few seconds once the
// player has dived, when the page is left, and when settings are applied, which reloads it). The next visit builds
// the world there, not at home, with the view as it was (back: the camera's place and angles, then the creature's
// species, place, angles and health), and the dive puts the creature back. Key 1 is the way home.
const keepAt = () => keep('abyssalInfAt', JSON.stringify([F[CX], F[CY], F[CZ], F[YAW], F[PIT]].concat(me ? [me.s, me.x, me.y, me.z, me.yaw, me.pit, meHP] : [])));
const BENCH = /[?&]bench/.test(location.search); // the measuring run at the end of this file: always at home
let back = null; try { back = BENCH || JSON.parse(localStorage.abyssalInfAt); } catch {}
if (Array.isArray(back) && back.length > 4 && back.every(isFinite)) for (let i = 0; i < 5; i++) F[i] = back[i]; else back = null;
moveWindow(F[CX], F[CZ]);
{
  const all = nWanted, names = ['Sculpting the seabed…', 'Carving canyons…', 'Growing kelp…'];
  for (let shown = -1; nWanted || shadowAll < 2;) {
    pump(true);
    const k = (1 - nWanted / all) * 3 | 0;
    if (k > shown && k < 3) { shown = k; await say(names[k], 0.2 + 0.25 * (k + 1), 2500); }
    await new Promise((r) => setTimeout(r, 8));
  }
}

// ---------------------------------------------------------------- one-time bake: detail texture
{
  const m = mod(W_DETAIL), p = await fullPipe(m, 'rgba8unorm');
  const e = device.createCommandEncoder();
  let r = e.beginRenderPass({ colorAttachments: [colorAtt(tDetail.createView({ baseMipLevel: 0, mipLevelCount: 1 }), true)] });
  r.setPipeline(p); r.draw(3); r.end();
  for (let i = 1; i < 11; i++) {
    r = e.beginRenderPass({ colorAttachments: [colorAtt(tDetail.createView({ baseMipLevel: i, mipLevelCount: 1 }), true)] });
    r.setPipeline(pMip8); r.setBindGroup(0, blitBG(tDetail.createView({ baseMipLevel: i - 1, mipLevelCount: 1 }))); r.draw(3); r.end();
  }
  Q.submit([e.finish()]);
}

// ---------------------------------------------------------------- render targets (rebuilt on resize)
// The scene is drawn at `pix` pixels and scaled up to the window. With the resolution setting on auto, frame() tunes
// it for 60 fps, starting where the last visit left it. `det` scales every draw distance and the haze that hides
// them together (1 = 135 m): DET0 is the distance setting, and frame() draws it in further while tiles are late.
const PIXMAX = 3840 * 2160, // auto never draws more than this (it was 2560 x 1440: an ultrawide window stayed at about 90%)
   PIXMIN = mob || LV > 1 ? 25e4 : 5e5, DET0 = VIEWD / 135;
let W = 0, H = 0, DW = 0, DH = 0, pix = RESQ ? 1e9 : +SV[1] || (LV > 1 ? 41e4 : mob ? 1280 * 720 : PIXMAX), det = DET0, lk = 1, lkT = 1, dynN = 0, dynT = 0, dynG = 0, dynGN = 0, dynBad = 0, dynOk = 0, dynWait = 3, dynFast = 1;
let passScene, passRays, passBlur, bgBlur, passPost, bgRays, bgPost, bloomPass = [], bloomBG = [], targets = [];
const NB = LV > 1 ? 3 : 6; // levels of the bloom chain (Low: fewer, a tighter glow)
// the frame rate setting: FT a frame's time (0: every frame the screen shows), DK auto resolution's budget against 60 fps
const FT = [1000 / 30, 1000 / 60, 0][GFX[8]], DK = GFX[8] ? 1 : 2;
let capT = 0; // when the last frame was due (frame() keeps to FT)
function resize() {
  if (xs) return; // in VR the headset sets the size (xr.js)
  DW = max(2, round(canvas.clientWidth * devicePixelRatio)); DH = max(2, round(canvas.clientHeight * devicePixelRatio));
  const s = RESQ || min(1, sqrt(pix / (DW * DH)));
  const w = max(2, round(DW * s)), h = max(2, round(DH * s)); // (any size: at 100% exactly the window's, so nothing is stretched)
  if (w === W && h === H) return;
  dynN = dynG = dynGN = 0; dynT = -300; // let the new size settle before measuring again
  canvas.width = w; canvas.height = h;
  if (!OFF) ctx.configure({ device, format: FMT, alphaMode: 'opaque' });
  makeTargets(w, h);
}
// the render targets for a w x h view: the window's (resize) or one eye's (xr.js)
function makeTargets(w, h) {
  W = w; H = h;
  for (const t of targets) t.destroy();
  const tMS = tex(AA > 1 ? W : 1, H, HDR, TU.RENDER_ATTACHMENT, { samples: AA }), tDp = tex(W, H, DEPTH, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING, { samples: AA });
  const tRes = tex(W, H, HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING), tRay = tex(W >> 1, H >> 1, HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING), tRay2 = tex(W >> 1, H >> 1, HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING);
  targets = [tMS, tDp, tRes, tRay, tRay2];
  if (OFF) { tOff = tex(W, H, FMT, TU.RENDER_ATTACHMENT | TU.COPY_SRC); targets.push(tOff); }
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
    { binding: 3, resource: tShadow.createView() }, { binding: 4, resource: (tWS || tWater).createView() }, { binding: 5, resource: vDp }, { binding: 6, resource: tVol.createView() }, { binding: 7, resource: sWrap }] });
  bgPost = device.createBindGroup({ layout: plPostBGL, entries: [{ binding: 0, resource: { buffer: ubo } }, { binding: 1, resource: sClamp }, { binding: 2, resource: vRes },
    { binding: 3, resource: vRay2 }, { binding: 4, resource: vBl[0] }, { binding: 5, resource: vDp }] });
  bloomPass = []; bloomBG = [];
  // down: res -> b0 -> ... -> b5 ; up: b5 -> b4 (additive) ... -> b0
  for (let i = 0; i < NB; i++) { bloomPass.push({ colorAttachments: [colorAtt(vBl[i], true)] }); bloomBG.push(blitBG(i ? vBl[i - 1] : vRes)); }
  for (let i = NB - 1; i > 0; i--) { bloomPass.push({ colorAttachments: [colorAtt(vBl[i - 1], false)] }); bloomBG.push(blitBG(vBl[i])); }
  UB[52] = W; UB[54] = 1 / W; UB[55] = 1 / H;
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
const TANH = 0.6, NEAR = 0.1, EXPO = 0.62; let RAYS = GFX[5] ? 0.54 : 0, HIDE = 0; // HIDE leaves parts out (dev.js, ?bench): 1 terrain, 2 solids, 4 mantas, 8 creatures and fish, 16 leaves, 32 surface, 64 particles, 128 light rays, 256 glow; 512 solids and 8192 leaves without their pixels, 1024 big rocks, 2048 chunks, 4096 sponges and corals
// view culling: tangents of the half field of view, and whether they follow the window (VR sets its own, wider ones)
let CTX = 0, CTY = TANH;
const submitList = [null];
// the culling basis from yaw and pitch (the right vector is horizontal)
function basis(yaw, pitch) {
  const cp = cos(pitch), rx = cos(yaw), rz = sin(yaw), fy = sin(pitch), fx = cp * rz, fz = -cp * rx;
  F[FX] = fx; F[FY] = fy; F[FZ] = fz; F[RX] = rx; F[RZ] = rz; F[UX] = -rz * fy; F[UY] = rz * fx - rx * fz; F[UZ] = rx * fy;
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
  m[51] = zoneL(cx, cz);
  let ek = (-cy - 8) / 26; ek = ek < 0 ? 0 : ek > 1 ? 1 : ek;
  let es = -cy / 22; es = es > 1 ? 1 : es; // the glare of the shallows
  // the eye gets used to the dark of the deep: from 60 m down, and once more in the abyss below 300 m
  let dq = (-cy - 60) / 240; dq = dq < 0 ? 0 : dq > 1 ? 1 : dq;
  let da = (-cy - 300) / 400; da = da < 0 ? 0 : da > 1 ? 1 : da;
  m[56] = EXPO * (0.6 + 0.4 * ek) * (0.55 + 0.45 * es) * (1 + 15 * dq * dq * (3 - 2 * dq) + 12 * da);
  m[57] = RAYS; m[58] = det; m[53] = lk;
  m[59] = dq * dq * (3 - 2 * dq); // how far into the dark: the deep's own faint glow (see amb() and fog())
}
function render() {
  basis(F[YAW], F[PIT]);
  setCam(F[CX], F[CY], F[CZ], F[RX], 0, F[RZ], F[UX], F[UY], F[UZ], F[FX], F[FY], F[FZ], 1 / (TANH * W / H), 1 / TANH, 0, 0);
  botShadows(UB);
  Q.writeBuffer(ubo, 0, UB);
  const e = device.createCommandEncoder();
  passPost.colorAttachments[0].view = (OFF ? tOff : ctx.getCurrentTexture()).createView();
  draw(e, true, true, pPost, passPost, null, true);
  submitList[0] = e.finish();
  Q.submit(submitList);
}
// Records one view's passes into e: the scene from the camera in UB (already written), composited by `post` into
// `outPass` (inside viewport vp, or all of it). first: the frame's first view, which also sorts the tiles and animates
// the water; last: its last view, which reads back the GPU time measured since the first. bloom: false skips the glow.
let tsSlot = null;
function draw(e, first, last, post, outPass, vp, bloom) {
  let r;
  if (first) {
    WT[0] = F[TIME]; Q.writeBuffer(uboW, 0, WT);
    sortTiles();
    tsSlot = null;
    if (hasTS) { for (let i = 0; i < qRead.length; i++) if (!qRead[i].busy) { tsSlot = qRead[i]; break; } }
    waterPass[0].timestampWrites = tsSlot ? tsBegin : undefined;
    // animated water texture + mips
    r = e.beginRenderPass(waterPass[0]); r.setPipeline(pWater); r.setBindGroup(0, bgWater); r.draw(3); r.end();
    for (let i = 1; i < 5; i++) { r = e.beginRenderPass(waterPass[i]); r.setPipeline(pMip16); r.setBindGroup(0, waterBG[i - 1]); r.draw(3); r.end(); }
    if (wave && !(HIDE & 32)) { const c = e.beginComputePass(); wave.sim(c); c.end(); } // the simulated waves (waves.js)
  }
  const slot = tsSlot;
  // scene
  r = e.beginRenderPass(passScene);
  r.setBindGroup(0, bg0);
  // every loaded tile brings its own buffers; `order` has them nearest first
  r.setPipeline(pTerrain); r.setVertexBuffer(1, ibIdent);
  for (let k = 0; k < nOrder; k++) { const t = order[k]; if (t.vis && t.ib && !(HIDE & 1)) { r.setVertexBuffer(0, t.vb); r.setIndexBuffer(t.ib, 'uint32'); drawPart(r, t, t.terr, 1.5, 1, 0, 0, 137 * det + 1); } }
  r.setPipeline(pSolid); r.setVertexBuffer(0, vbMesh); r.setIndexBuffer(ibMesh, 'uint32');
  if (HIDE & 512) r.setScissorRect(0, 0, 1, 1);
  const far2 = (137 * det + 16) ** 2; // a tile's big rocks are drawn as far as its sea floor is (and 15 m more: a floating cluster reaches out of its tile)
  for (let k = 0; k < nOrder; k++) {
    const t = order[k]; if (!t.solB || HIDE & 2) continue;
    r.setVertexBuffer(1, t.solB);
    // (the fluke and the ship, 10 and 11, reach far out of their tile: always drawn)
    for (let i = 0; i < 12; i++) { const n = t.solids[i * 2 + 1]; if (n && (i > 3 || t.d2 < far2) && !(HIDE & 1024)) r.drawIndexed(meshes[i].ib.length, n, meshes[i].i0, meshes[i].v0, t.solids[i * 2]); }
    if (!t.vis || t.d2 > 22500) continue;
    for (let i = 0; i < NCHUNK && !(HIDE & 2048); i++) {
      const c = t.chunks[i], big = i > 2 && i < 6;
      drawPart(r, t, c, 3, meshes[14 + i], 0, 0, i > 5 ? 30 : big ? 40 * lk : 96);
      if (big) drawPart(r, t, c, 3, meshes[20 + i], 0, 40 * lk, 150);
    }
    for (let i = 0; i < 6 && !(HIDE & 4096); i++) {
      const lod = i === 3 || i === 4;
      drawPart(r, t, t.props[i], 3, meshes[4 + i], 0, 0, lod ? 6 * lk : 132);
      if (lod) drawPart(r, t, t.props[i], 3, meshes[18 + i], 0, 6 * lk, 132);
    }
  }
  if (HIDE & 512) r.setScissorRect(0, 0, W, H);
  r.setPipeline(pManta);
  for (let k = 0; k < nOrder; k++) { const t = order[k], n = t.misc[7]; if (n && !(HIDE & 4)) { r.setVertexBuffer(1, t.miscB); r.drawIndexed(MANTA.ib.length, n, MANTA.i0, MANTA.v0, t.misc[6]); } }
  if (!(HIDE & 8)) botDraw(r, CRIT0);
  r.setPipeline(pFish);
  for (let k = 0; k < nOrder; k++) { const t = order[k], n = t.misc[5]; if (n && t.d2 < 32400 && !(HIDE & 8)) { r.setVertexBuffer(1, t.miscB); r.drawIndexed(FISH.ib.length, n, FISH.i0, FISH.v0, t.misc[4]); } }
  // kelp and plants: 9-row blades up close, 5 rows mid-range, a decimated set far away
  r.setPipeline(pLeaf); if (HIDE & 8192) r.setScissorRect(0, 0, 1, 1);
  for (let k = 0; k < nOrder; k++) { const t = order[k]; if (t.vis && t.leafB && t.d2 < 576 * lk * lk && !(HIDE & 16)) { r.setVertexBuffer(0, t.leafB); drawPart(r, t, t.big, 5, false, 18, 0, 24 * lk); } }
  r.setPipeline(pLeaf5);
  for (let k = 0; k < nOrder; k++) { const t = order[k]; if (t.vis && t.leafB && t.d2 < 3364 * lk * lk && !(HIDE & 16)) { r.setVertexBuffer(0, t.leafB); drawPart(r, t, t.big, 5, false, 10, 24 * lk, 58 * lk); } }
  r.setPipeline(pLeafF);
  for (let k = 0; k < nOrder; k++) { const t = order[k]; if (t.vis && t.leafB && t.d2 < 22500 && !(HIDE & 16)) { r.setVertexBuffer(0, t.leafB); drawPart(r, t, t.bigF, 5, false, 6, 58 * lk, 150); } }
  r.setPipeline(pLeafS);
  for (let k = 0; k < nOrder; k++) { const t = order[k]; if (t.vis && t.leafB && t.d2 < 4900 && !(HIDE & 16)) { r.setVertexBuffer(0, t.leafB); drawPart(r, t, t.small, 1.5, false, 6, 0, 70); } }
  if (HIDE & 8192) r.setScissorRect(0, 0, W, H);
  if (!(HIDE & 32)) { if (wave) { r.setPipeline(wave.pipe); r.setVertexBuffer(0, wave.vb); r.setIndexBuffer(wave.ib, 'uint16'); r.drawIndexed(wave.n); } else { r.setPipeline(pSurf); r.draw(4); } }
  r.setPipeline(pBack); r.draw(4);
  r.setPipeline(pBub);
  for (let k = 0; k < nOrder; k++) { const t = order[k], n = t.misc[1]; if (n && t.d2 < 14400 && !(HIDE & 64)) { r.setVertexBuffer(0, t.miscB); r.draw(4, n, 0, t.misc[0]); } }
  if (!(HIDE & 64)) gurDraw(r);
  r.setPipeline(pGl);
  for (let k = 0; k < nOrder; k++) { const t = order[k], n = t.misc[3]; if (n && t.vis && t.d2 < 14400 && !(HIDE & 64)) { r.setVertexBuffer(0, t.miscB); r.draw(4, n, 0, t.misc[2]); } }
  if (!(HIDE & 64)) { r.setPipeline(pSnow); r.setVertexBuffer(0, ibSnowB); r.draw(4, nSnow); }
  r.end();
  // light shafts (with Light rays off neither pass runs: the shafts' texture stays empty)
  if (GFX[5] && !(HIDE & 128)) {
    r = e.beginRenderPass(passRays); r.setPipeline(pRays); r.setBindGroup(0, bgRays); r.draw(3); r.end();
    r = e.beginRenderPass(passBlur); r.setPipeline(pRB); r.setBindGroup(0, bgBlur); r.draw(3); r.end();
  }
  // bloom
  for (let i = 0; bloom && i < bloomPass.length && !(HIDE & 256); i++) {
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
function sd(j) {
  const x = (F[CX] + CE[j * 3]) / VS, y = (F[CY] + CE[j * 3 + 1] - OY) / VS, z = (F[CZ] + CE[j * 3 + 2]) / VS;
  const ix = floor(x), iy = floor(y), iz = floor(z), u = x - ix, v = y - iy, a = cv(ix, iy, iz), b = cv(ix, iy + 1, iz), c = cv(ix, iy, iz + 1), d = cv(ix, iy + 1, iz + 1);
  const p = a + (cv(ix + 1, iy, iz) - a) * u, q = b + (cv(ix + 1, iy + 1, iz) - b) * u, r = c + (cv(ix + 1, iy, iz + 1) - c) * u, s = d + (cv(ix + 1, iy + 1, iz + 1) - d) * u;
  const e = p + (q - p) * v; CS[j] = (e + (r + (s - r) * v - e) * (z - iz)) / 127;
}
// Moves the camera by F[MX..MZ] in steps shorter than its radius CR (so it can't pass through thin rock), pushing it
// back out after each step and dropping velocity into the rock, so it slides along.
const CR = 0.5;
function collide() {
  const n = floor(sqrt(F[MX] * F[MX] + F[MY] * F[MY] + F[MZ] * F[MZ]) / 0.4) + 1;
  for (let i = 0; i < n; i++) {
    F[CX] += F[MX] / n; F[CY] += F[MY] / n; F[CZ] += F[MZ] / n;
    for (let k = 0; k < 2; k++) {
      sd(0); const s = CS[0] + CR; if (s <= 0) break;
      for (let j = 1; j < 7; j++) sd(j);
      let gx = CS[1] - CS[2], gy = CS[3] - CS[4], gz = CS[5] - CS[6]; const l = sqrt(gx * gx + gy * gy + gz * gz);
      if (l < 0.075) break; // flat: deep in rock
      gx /= l; gy /= l; gz /= l; const vn = F[VX] * gx + F[VY] * gy + F[VZ] * gz;
      F[CX] -= gx * s; F[CY] -= gy * s; F[CZ] -= gz * s;
      if (vn > 0) { F[VX] -= gx * vn; F[VY] -= gy * vn; F[VZ] -= gz * vn; }
    }
  }
}

function frame(now) {
  if (!OFF) requestAnimationFrame(frame); // offscreen: dev.js steps the frames
  if (xs) { F[LAST] = now; return; } // in VR the headset drives the frames (xr.js)
  // the frame rate setting (30 on Low, 60 on Medium): a frame is skipped until FT, less 2 ms, after the last one was due
  if (FT && !OFF) { if (now - capT < FT - 2) return; capT = max(capT + FT, now - FT); }
  const dtr = now - F[LAST]; F[LAST] = now;
  let dt = dtr / 1000; if (dt > 0.1) dt = 0.1;
  // Dynamic resolution for 60 fps (30 with that frame rate chosen: DK doubles every limit): every second (0.4 s behind the menu, and until the first period at full pace) scale the load by k
  if (dtr < 1e3 && (dynT += dtr) > 0 && (dynN++, dynT > (menu || dynFast ? 400 : 1000))) {
    const a = dynT / dynN, g = dynGN ? dynG / dynGN : 0; let k = 1;
    // with GPU timing: keep it between 9.8 and 13.6 ms
    if (g) { if (g > 13.6 * DK || g < 9.8 * DK) k = 11.7 * DK / g; }
    // without: slow for two periods in a row means fewer pixels, and twice as long before trying to go back up
    // (at the start one slow period is enough, so a visit does not begin with seconds of stutter)
    else if (a > 17.6 * DK) { dynOk = 0; if (dynFast) k = 15 * DK / a; else if (++dynBad > 1) { k = 15 * DK / a; dynBad = 0; dynWait = min(dynWait * 2, 60); } }
    // at the display's rate there is no telling if there is room, so try a little more now and then
    else { dynFast = dynBad = 0; if (a < 12.5 * DK) k = 15 * DK / a; else if (++dynOk > dynWait) { k = 1.17; dynOk = 0; } }
    k = k < 0.5 ? 0.5 : k > 1.7 ? 1.7 : k; const top = min(PIXMAX, DW * DH), was = pix;
    // The distances at which things get their detail (lk times the usual ones, see render()) are tuned the same way,
    // from the GPU time alone: with every pixel drawn and the frame under half full they move out, up to 2.5 times,
    // and a frame that fills up brings them back before any pixels are given up.
    if (g && !OFF) { if (g > 8.5 * DK) { if (lkT > 1) { lkT = max(1, lkT * 7 * DK / g); if (k < 1) k = 1; } } else if (g < 6 * DK && pix >= top && lkT < 2.5) lkT = min(2.5, lkT * 1.15); }
    if (!RESQ) { pix = min(pix, top) * k; pix = pix < PIXMIN ? PIXMIN : pix > top ? top : pix; }
    if (was !== pix) keep('abyssalInf', [LV, pix < top ? pix | 0 : '']); // nothing kept at full resolution
    dynN = dynT = dynG = dynGN = 0; RESQ || resize();
  }
  lk += lkT > lk ? min(lkT - lk, dt * 0.2) : max(lkT - lk, -dt * 0.6); // (eased, so the detail does not arrive in steps)
  step(dt, now);
  render();
  if (hud) {
    hN++; if (dtr > hMax) hMax = dtr; if (dtr < hMin) hMin = dtr; if (dtr > hPer * 1.5) { hLate++; hTot++; }
    F[HUDT] += dtr / 1000;
    if (F[HUDT] > 0.5) { info.textContent = `${(hN / F[HUDT]).toFixed(0)} fps  ·  worst frame ${hMax.toFixed(1)} ms  ·  late frames ${hLate} (total ${hTot})  ·  GPU ${F[GPU].toFixed(2)} ms  ·  ${W}x${H} (${W * 100 / DW | 0}%)  ·  x ${F[CX].toFixed(0)} z ${F[CZ].toFixed(0)}  ·  tiles ${nLoaded}/${LW * LW}  ·  detail x${lk.toFixed(2)}`; F[HUDT] = 0; hPer = hMin; hN = 0; hMax = 0; hMin = 1e9; hLate = 0; }
  }
}
// One step of the world: input, the creature in play (or the free camera), the bots, streaming and the haze. The
// desktop's frame() runs it, and so does VR's (xr.js), with the headset's sticks standing in for the keys.
function step(dt, now) {
  F[TIME] += dt;
  {
    // touch, one finger: holding the finger away from where it went down keeps turning, like a joystick
    if (tId >= 0 && !TJ) {
      const tr = 4 / (innerWidth < innerHeight ? innerWidth : innerHeight); let jx = (tx - tx0) * tr, jy = (ty - ty0) * tr;
      jx = jx > 1 ? 1 : jx < -1 ? -1 : jx; jy = jy > 1 ? 1 : jy < -1 ? -1 : jy;
      lkx += jx * 1.5 * dt; lky += jy * dt;
    }
    // mouse look through two cascaded low-pass stages
    const kq = 1 - exp(-dt * 30); lkx += mdx * 0.0022; lky += mdy * 0.0022; mdx = 0; mdy = 0;
    const ax = lkx * kq, ay = lky * kq; lkx -= ax; lky -= ay; l2x += ax; l2y += ay;
    const dyw = l2x * kq, dpt = l2y * kq; l2x -= dyw; l2y -= dpt;
    // what the fingers ask for: one finger swims ahead (a second one: faster); the stick swims any way, and faster pushed far out
    const jm = hypot(jmx, jmy), jk = jm > 1 ? 1 / jm : 1, tf = TJ ? -jmy * jk : tId >= 0 ? 0.7 : 0, tr = TJ ? jmx * jk : 0, tfast = TJ ? jm > 1.7 : tN > 1;
    if (me) me.gur = !menu && kg > 0;
    if (kz && me) meZoom = clamp(meZoom + kz * dt * 1.3, 0, 2); // a phone's camera button is held
    meAway = menu; meHeld = !menu && kbt > 0;
    netFrame(dt);
    if (me && menu) { /* the creature waits while the menu is up */ }
    else if (me) meStep(dt, dyw, dpt, tf || kf - kb, tr || kr - kl, ku - kd, ks || tfast); // playing a creature (bots.js)
    else {
    const yaw = F[YAW] + dyw; let pitch = F[PIT] - dpt; pitch = pitch < -1.55 ? -1.55 : pitch > 1.55 ? 1.55 : pitch;
    const sp = ks || tfast ? 26 : 7, k = 1 - exp(-dt * 4.5), mf = tf || kf - kb, mr = tr || kr - kl, mu = ku - kd, cp = cos(pitch), sy = sin(yaw), cw = cos(yaw);
    const vx = F[VX] + ((sy * cp * mf + cw * mr) * sp - F[VX]) * k, vy = F[VY] + ((sin(pitch) * mf + mu) * sp - F[VY]) * k, vz = F[VZ] + ((-cw * cp * mf + sy * mr) * sp - F[VZ]) * k;
    let x = F[CX] + vx * dt, y = F[CY] + vy * dt; const z = F[CZ] + vz * dt, ox = F[CX], oy = F[CY], oz = F[CZ];
    if (x > SHOREX) x = SHOREX; // the beach
    const yb = gridBase(x) + 5; y = y < yb ? yb : y > -1.2 ? -1.2 : y; // between the band's floor and the surface
    F[YAW] = yaw; F[PIT] = pitch; F[VX] = vx; F[VY] = vy; F[VZ] = vz; F[MX] = x - F[CX]; F[MY] = y - F[CY]; F[MZ] = z - F[CZ];
    collide();
    // pushed up through the surface by rising ground (the shallows, an islet): no way through, stay where it was
    if (F[CY] > -1.2) { F[CX] = ox; F[CZ] = oz; F[CY] = oy < -1.2 ? oy : -1.2; F[VX] = F[VY] = F[VZ] = 0; }
    }
  }
  // the world follows the camera: tiles ahead are started, finished ones come in
  moveWindow(F[CX], F[CZ]); pump(false);
  if (!menu || bots.length) botStep(dt); // the creatures live on behind the menu once they are there
  if (!menu && !OFF && !xs) { sonarDraw($('sn'), dt); if (me) { $('sb').style.width = round(meStamina * 100) + '%'; const h = clamp(meHP, 0, 1); $('hf').style.width = round(h * 100) + '%'; $('hf').style.background = h < 0.25 ? '#ff5e5b' : h < 0.5 ? '#ffc061' : '#7fe08a'; $('hb').className = meHurtT > -0.4 ? 'h' : ''; $('hm').textContent = meMsgT > 0 ? meMsg : ''; } const on = netOn ? 'Online · ' + (netNames.size + 1) + ' in the sea' : ''; if (on !== netShown) $('hn').textContent = netShown = on; }
  if (menu) pickDraw(now);
  {
    // the haze reaches as far as the setting says, but never past what is loaded: quick to close, slow to open
    let k = (reach(F[CX], F[CZ]) - 2) / 135; k = k > DET0 ? DET0 : k < 0.2 ? 0.2 : k;
    // (in VR the draw distance follows the headset's frame time too: it never goes past xrDet)
    det = k < det ? max(k, det - dt * 0.8) : min(k, det + dt * 0.12); if (xs && det > xrDet) det = xrDet;
  }
}
let xrDet = 1;

// ---------------------------------------------------------------- input
let shiftAt = -1e9, netShown = '';
// the name other players see (the menu's field, kept between visits); without a server to reach the field is not shown
{ const nm = $('nm'); nm.value = netName; if (!netURL()) nm.hidden = true; nm.oninput = () => { netName = nm.value.trim().slice(0, 16); keep('abyssalInfName', netName); if (netOn) netSend({ t: 'hi', name: netName }); }; }
const key = (e, v) => {
  switch (e.code) {
    case 'KeyW': kf = v; break; case 'KeyS': kb = v; break; case 'KeyA': kl = v; break; case 'KeyD': kr = v; break;
    case 'KeyE': ku = v; break; case 'KeyQ': kd = v; break;
    // Shift held: a dash; tapped twice quickly: a burst of speed
    case 'ShiftLeft': case 'ShiftRight': if (v && !e.repeat) { if (e.timeStamp - shiftAt < 350) meBurst(); shiftAt = e.timeStamp; } ks = v; break;
    default: if (v && !e.repeat) {
      if (e.code === 'KeyH') { hud = !hud; hTot = 0; hPer = 1e9; info.textContent = ''; }
      else if (e.code === 'KeyM') mute();
      else if (e.code === 'KeyZ') sonarZoom();
      else if (e.code === 'Escape') ui(true);
      else if (e.code >= 'Digit1' && e.code <= 'Digit6') { lookAt(...POSES[e.code.charCodeAt(5) - 49]); meWarp(); }
      else if (/^Digit[7890]$/.test(e.code)) { lookAt(...DEEPS[(e.code.charCodeAt(5) - 45) % 10]); meWarp(); }
    }
  }
};
// behind the menu only the stats and mute keys work
addEventListener('keydown', (e) => { if (e.target && e.target.tagName === 'INPUT') return; if (menu && e.code !== 'KeyH' && e.code !== 'KeyM') return; sound(); key(e, 1); });
addEventListener('keyup', (e) => key(e, 0));
const release = () => { kf = kb = kl = kr = ku = kd = ks = kg = kbt = 0; tId = jId = sId = -1; tN = jmx = jmy = kz = 0; $('tj').style.display = ''; };
// the right mouse button: the creature in play gurgles for as long as it is held; the left: it bites, strikes, feeds (bots.js)
let kg = 0, kbt = 0, kz = 0;
addEventListener('mousedown', (e) => { if (e.button === 0 && !menu && document.pointerLockElement === canvas) kbt = 1; });
addEventListener('mouseup', (e) => { if (e.button === 0) kbt = 0; });
addEventListener('mousedown', (e) => { if (e.button === 2 && !menu) { sound(); kg = 1; } });
addEventListener('mouseup', (e) => { if (e.button === 2) kg = 0; });
addEventListener('contextmenu', (e) => { if (!menu) e.preventDefault(); });
// Asking for the mouse is refused for a moment after Esc gave it back (Chrome: 1.25 s after the key): then it is
// asked for again once that moment has passed (the click's permission still holds). Until the mouse is taken the menu
// button (#o) stays hidden (.w on <body>; taken, pointerlockchange sets the class anew); refused for good, it shows.
let freed = -1e4;
const lock = () => {
  const p = canvas.requestPointerLock({ unadjustedMovement: true });
  return p && p.catch ? p.catch(() => canvas.requestPointerLock()) : new Promise((ok, no) => { document.addEventListener('pointerlockchange', ok, { once: true }); document.addEventListener('pointerlockerror', no, { once: true }); });
};
const capture = () => {
  sound(); body.classList.add('w');
  const done = () => body.classList.remove('w');
  lock().catch(() => { const t = freed + 1500 - performance.now(); if (t > 0) setTimeout(() => (menu ? done() : lock().catch(done)), t); else done(); });
};
canvas.addEventListener('click', capture);
addEventListener('mousemove', (e) => { if (document.pointerLockElement === canvas) { mdx += e.movementX; mdy += e.movementY; } });
addEventListener('blur', release);
// Touch, two ways (TJ, the Controls row of a phone's menu, localStorage.abyssalInfTouch):
//   one finger (0): hold to swim forward, slide to steer, a second finger to go faster;
//   joystick (1): a finger on the left half is a stick to swim by (jmx, jmy: how far it is pushed, 1 = the ring),
//   one on the right half turns the view.
// Only the fingers on the scene count: the round action buttons take their own.
// A short tap on the sonar's disc is its next range (sId: the finger that went down there, sAt, sx, sy: when and
// where); held longer or slid, it is a finger like any other.
let TJ = 0, jId = -1, jx0 = 0, jy0 = 0, jmx = 0, jmy = 0, sId = -1, sAt = 0, sx = 0, sy = 0;
try { TJ = +localStorage.abyssalInfTouch === 1 ? 1 : 0; } catch {}
const touch = (e) => {
  e.preventDefault(); sound(); const T = e.targetTouches, r = rot.matches, tj = $('tj'); tN = T.length;
  // the touch axes turn with the page when it lies on its side
  const X = (t) => (r ? t.clientY : t.clientX), Y = (t) => (r ? innerWidth - t.clientX : t.clientY);
  // iOS can hand out negative identifiers, but a negative tId means "no finger": compare them as unsigned
  const c = e.changedTouches[0];
  if (e.type === 'touchstart') { const b = $('so').getBoundingClientRect(); if (c.clientX > b.left && c.clientX < b.right && c.clientY > b.top && c.clientY < b.bottom) { sId = c.identifier >>> 0; sAt = e.timeStamp; sx = c.clientX; sy = c.clientY; } }
  else if (e.type === 'touchend' && c.identifier >>> 0 === sId) { sId = -1; if (e.timeStamp - sAt < 300 && hypot(c.clientX - sx, c.clientY - sy) < 12) sonarZoom(); }
  let f = null, j = null, first = false;
  for (let i = 0; i < tN; i++) { const id = T[i].identifier >>> 0; if (id === tId) f = T[i]; else if (id === jId) j = T[i]; }
  if (!f) tId = -1; if (!j) jId = -1;
  const half = (r ? innerHeight : innerWidth) / 2, side = min(innerWidth, innerHeight);
  if (TJ) {
    const R = side * 0.14;
    for (let i = 0; i < tN; i++) {
      const t = T[i], id = t.identifier >>> 0; if (id === tId || id === jId) continue;
      if (X(t) < half) { if (jId < 0) { jId = id; j = t; jx0 = X(t); jy0 = Y(t); tj.style.left = jx0 + 'px'; tj.style.top = jy0 + 'px'; } }
      else if (tId < 0) { tId = id; f = t; first = true; }
    }
    if (j) { jmx = (X(j) - jx0) / R; jmy = (Y(j) - jy0) / R; const k = R / max(1, hypot(jmx, jmy)); tj.firstChild.style.transform = 'translate(' + jmx * k + 'px,' + jmy * k + 'px)'; } else jmx = jmy = 0;
    tj.style.display = j ? 'block' : '';
  } else if (!f && tN) { f = T[0]; tId = f.identifier >>> 0; first = true; }
  if (f) {
    const x = X(f), y = Y(f), s = 1100 / side;
    if (first) { tx0 = x; ty0 = y; } else { mdx += (x - tx) * s; mdy += (y - ty) * s; } // the view follows the finger at once
    tx = x; ty = y;
  }
};
// the round buttons: the mouth (the left mouse button), the gurgle (the right one, held), a burst (Shift twice)
[['t1', (v) => { kbt = v; }], ['t2', (v) => { kg = v; }], ['t3', (v) => { if (v) meBurst(); }]].forEach(([id, fn]) => {
  const b = $(id), h = (v) => (e) => { e.preventDefault(); sound(); b.className = v ? 'on' : ''; fn(v); };
  b.addEventListener('touchstart', h(1), { passive: false }); b.addEventListener('touchend', h(0)); b.addEventListener('touchcancel', h(0));
});
for (const n of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) canvas.addEventListener(n, touch, { passive: false });

// ---------------------------------------------------------------- menu
// The scene keeps rendering (blurred by CSS) behind the menu. Esc, losing the mouse or the corner button open it.
let menu = true;
// the focus ring shows from the first Tab until the next click or touch (template.html)
addEventListener('keydown', (e) => e.code === 'Tab' && document.documentElement.classList.add('k'), true);
addEventListener('pointerdown', () => document.documentElement.classList.remove('k'), true);
const bDive = $('d');
// The way home is a button before the dive button: on a phone (it has no key 1) always, elsewhere where there is a
// place kept from the last visit (back) or once a dive has begun. With a place kept, the dive button is Resume.
$('dh').hidden = !mob && !back; if (back) bDive.textContent = 'Resume';
const ui = (m) => {
  if (dead) return;
  menu = m; body.className = m ? 'm' : document.pointerLockElement ? 'g p' : 'g';
  // focus the dive button so Enter works (delayed: it can't take focus while still hidden)
  // (once a dive has begun the dive button is Resume, with Home before it: changed as the menu comes back, not while it fades out)
  // (the creature panel, left open by the dive, starts its preview again)
  if (m) { if (!first) { bDive.textContent = 'Resume'; $('dh').hidden = false; } if (!$('cp').hidden) pickOpenUp(); release(); setTimeout(() => menu && bDive.focus(), 100); fitMenu(); } else document.activeElement.blur();
};
let first = true;
setInterval(() => first || keepAt(), 3000); addEventListener('pagehide', () => first || keepAt());
// vr: the dive starts in the headset (xr.js): no pointer capture or full screen
const go = (vr) => {
  meSync();
  // the first dive starts as key 1 does: the creature at the first viewpoint, heading the way it looks
  if (first && !back) { lookAt(...POSES[0]); meWarp(); } first = false;
  if (back && me && me.s === back[5]) { me.x = back[6]; me.y = back[7]; me.z = back[8]; me.yaw = me.ty = back[9]; me.pit = back[10]; meHP = back[11]; } back = null;
  hudWho(); pickClose(); netConnect();
  sound(); ui(false);
  // phones: go fullscreen and ask for landscape; where that is refused the CSS rotation still applies
  if (vr === true) return;
  if (mob) document.documentElement.requestFullscreen?.()?.then(() => screen.orientation.lock('landscape')).catch(() => 0);
  if (!mob) capture();
};
bDive.onclick = go; $('o').onclick = () => ui(true);
// The graphics and the world panels. Their rows are one list of choices: detail level, water, the settings of GFX
// (the last two of them are shown higher up: Surface right under Detail, Frame rate under Resolution),
// then those of WORLD (creatures, time of day, colours, floating rocks).
// Choices are only marked until the panels are left: the question asked then keeps them and reloads (they are compiled into the shaders and the
// world's buffers). Picking a detail level marks the settings that level comes with; a dot on the Graphics and World
// tabs says they hold choices not applied yet.
{
  const yr = [...$('y').querySelectorAll('p')], wr = [...document.querySelectorAll('#yw p:not(.h)')];
  const was = [2 - LV, WQ, ...GFX, ...WORLD], pick = was.slice(), rows = [yr[0], wr[0], yr[2], yr[3], ...yr.slice(5), yr[1], yr[4], ...wr.slice(1)], G = 2 + GFX.length;
  const ch = (f) => pick.some((v, k) => v !== was[k] && f(k));
  const mark = () => {
    rows.forEach((r, k) => r.querySelectorAll('button').forEach((b, i) => { b.className = i === pick[k] ? 'on' : ''; }));
    $('x').classList.toggle('ch', ch((k) => !k || (k > 1 && k < G))); $('xw').classList.toggle('ch', ch((k) => k === 1 || k >= G));
  };
  rows.forEach((r, k) => r.querySelectorAll('button').forEach((b, i) => { b.onclick = () => { pick[k] = i; if (!k) pick.splice(2, GFX.length, ...gdef(2 - i)); mark(); }; }));
  // The tabs (Controls, Graphics, World, Sound) and the creature button: each opens its pane under the tabs (a tab is
  // lit while it is open, the creature button ringed; pressed again, it leads back to Controls).
  const panes = ['kp', 'y', 'yw', 'ys', 'cp'], tabs = ['xc', 'x', 'xw', 'xs', 'cb'];
  const panel = (id) => {
    if (!$(id).hidden) return;
    panes.forEach((p, i) => { $(p).hidden = p !== id; $(tabs[i]).classList.toggle(i < 4 ? 'on' : 'w', p === id); });
    if (id === 'cp') pickOpenUp(); else pickClose();
    $('sc').scrollTop = 0; fitMenu();
  };
  // Diving (or going home) with graphics or world choices that were not applied asks first: apply and reload, drop
  // them, or stay. Going from tab to tab does not ask (the dot on Graphics and World shows what is waiting).
  let after = null;
  const leave = (then) => { if (pick.join() === was.join()) then(); else { after = then; $('u').hidden = false; $('ua').focus(); } };
  $('ud').onclick = () => { $('u').hidden = true; pick.splice(0, pick.length, ...was); mark(); after(); };
  $('uk').onclick = () => { $('u').hidden = true; };
  $('ua').onclick = () => {
    if (pick[0] !== was[0] || pick[3] !== was[3]) keep('abyssalInf', 2 - pick[0]); // another level or resolution: the tuned resolution is forgotten
    keep('abyssalInfWater', pick[1]); keep('abyssalInfGfx', pick.slice(2, 2 + GFX.length).join()); keep('abyssalInfWorld', pick.slice(2 + GFX.length).join());
    keepAt();
    location.reload();
  };
  $('x').onclick = () => panel('y'); $('xw').onclick = () => panel('yw'); $('xs').onclick = () => panel('ys'); $('xc').onclick = () => panel('kp');
  $('cb').onclick = () => panel($('cp').hidden ? 'cp' : 'kp'); bDive.onclick = () => leave(go);
  $('dh').onclick = () => leave(() => { back = null; lookAt(...POSES[0]); meWarp(); go(); }); // (back: the place kept from the last visit is dropped)
  // the sound panel: a choice is heard at once (audio.js)
  const srows = [...$('ys').querySelectorAll('p')], smark = () => srows.forEach((r, k) => r.querySelectorAll('button').forEach((b, i) => { b.className = i === SND[k] ? 'on' : ''; }));
  srows.forEach((r, k) => r.querySelectorAll('button').forEach((b, i) => { b.onclick = () => { SND[k] = i; sound(); sndApply(); smark(); }; }));
  smark();
  // the World panel's last row, HUD: the sonar and the lines at the bottom left, shown or hidden at once, with no
  // reload (HUD in quality.js)
  const hb = [...document.querySelectorAll('#yw p.h button')];
  const hmark = () => { hb.forEach((b, i) => { b.className = i === HUD ? 'on' : ''; }); $('so').style.visibility = $('hu').style.visibility = HUD ? '' : 'hidden'; };
  hb.forEach((b, i) => { b.onclick = () => { HUD = i; keep('abyssalInfHud', i); hmark(); }; });
  hmark();
  mark();
}
// a phone's Scheme row: taken at once, and the rows under it say how that way works, a gesture a row
{
  const GEST = [
    [['M12 2a4 4 0 0 1 4 4h-2a2 2 0 1 0-4 0H8a4 4 0 0 1 4-4zm-1 6h2v6l4.5 1.2a2 2 0 0 1 1.5 2.2L18.4 22H9.6l-3.3-5.2 1.6-1.2L11 18V8z', 'Hold to swim forward'],
      ['M4 11h3V8l4 4-4 4v-3H4zm16 0h-3V8l-4 4 4 4v-3h3zM11 5h2v14h-2z', 'Slide to steer'],
      ['M7 7h2v8l1.6.4V7h2v8.9l1.4.4V9h2v7.8l1.6.4a2 2 0 0 1 1.4 2.3L18.6 22H9l-4-5 1.5-1.2L7 16.4z', 'Second finger to go faster']],
    [['M12 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16zm0 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12zm0 3a3 3 0 1 1 0 6 3 3 0 0 1 0-6z', 'Left thumb swims'],
      ['M12 5c5 0 9 4.5 10 7-1 2.5-5 7-10 7S3 14.5 2 12c1-2.5 5-7 10-7zm0 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4z', 'Right thumb looks'],
      ['M3 6h2v12H3zm4 0 7 6-7 6zm7 0 7 6-7 6z', 'Push the stick far to go faster']],
  ];
  const bs = [...$('tc').querySelectorAll('button')], mk = () => { bs.forEach((b, i) => { b.className = i === TJ ? 'on' : ''; }); $('h').innerHTML = GEST[TJ].map(([d, t]) => '<p><svg viewBox="0 0 24 24"><path d="' + d + '"/></svg>' + t + '</p>').join(''); };
  bs.forEach((b, i) => { b.onclick = () => { TJ = i; keep('abyssalInfTouch', i); release(); mk(); fitMenu(); }; }); mk();
}
// a phone's two buttons beside the menu button: the camera further from the creature in play, and nearer to it (the mouse wheel)
// Held, they keep moving it (kz, see frame()), also while other fingers swim and steer; let go, the distance is kept.
[['tm', 1], ['tp', -1]].forEach(([id, d]) => {
  const b = $(id), h = (v) => (e) => { e.preventDefault(); kz = v; meZoomBy(v * 0.08); };
  b.addEventListener('touchstart', h(d), { passive: false }); b.addEventListener('touchend', h(0)); b.addEventListener('touchcancel', h(0));
});
pickInit(); $('cb').click(); // (the menu opens on the creature panel)
// the line at the bottom left: who the player is (the score will stand here too)
function hudWho() { $('hw').innerHTML = me ? 'Playing as <b>' + CRITNAME[me.s] + '</b>' : 'Free camera'; $('st').style.display = $('hb').style.display = me ? '' : 'none'; $('tb').className = $('tz').className = me ? 'c' : ''; if (me) { $('t1').textContent = me.s === CRAB ? 'Strike' : 'Bite'; $('t2').textContent = me.s === CRAB ? 'Block' : 'Gurgle'; } if (!me) $('hm').textContent = ''; }
// the mouse wheel: the camera nearer to the creature in play, or further from it
addEventListener('wheel', (e) => { if (!menu && me) meZoomBy(e.deltaY > 0 ? 0.12 : -0.12); }, { passive: true });
document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement) freed = performance.now(); if (!xs) ui(!document.pointerLockElement); });

// draw the first frame and wait for the GPU to finish it (pipelines get compiled on first use) before the reveal
await say('Letting the light in…', 1, 400);
render(); await Q.onSubmittedWorkDone();
setTimeout(keep, 15e3, 'abyssalLoad', ''); // the load counts as survived after 15 s of frames
ui(true);
if (!OFF) requestAnimationFrame((t) => { F[LAST] = t; requestAnimationFrame(frame); });

// ---------------------------------------------------------------- ?bench: what a frame's time goes on
// A minute at the home viewpoint with the menu away: the frame is timed whole, then with one part of the picture
// left out at a time (HIDE), with all of them out, at a quarter of the pixels, and with a part's shapes drawn but none
// of its pixels (which tells the cost of its triangles from the cost of shading them); all of it twice, so the two
// columns show how far the numbers can be trusted. The table stays on screen.
if (BENCH && !OFF) {
  const run = frame, wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let n = 0, cpu = 0, gpu = 0;
  frame = (now) => { const t = performance.now(), l = F[LAST]; run(now); if (F[LAST] !== l) { n++; cpu += performance.now() - t; gpu += F[GPU]; } dynT = -1 / 0; };
  ui(false); hud = false; info.style.cssText = 'top:0;left:0;margin:0;padding:12px;background:#000c;color:#fff;font:14px/1.5 monospace;z-index:99;user-select:text;pointer-events:auto';
  const rows = [['everything', 0], ['no sea floor', 1], ['no rocks, corals', 2], ['no plants', 16], ['no creatures, fish', 12], ['no surface', 32], ['no particles', 64], ['no light rays', 128], ['no glow', 256], ['none of these', 511], ['everything, 1/4 of the pixels', 0, 1], ['no rocks, corals, 1/4 of the pixels', 2, 1], ['rocks, corals: no pixels', 512], ['no big rocks', 1024], ['no small rocks', 2048], ['no sponges, corals', 4096], ['plants: no pixels', 8192]];
  const ai = adapter.info || {}; let out = `Abyssal Infinite, frame parts  ·  ${ai.vendor || '?'} ${ai.architecture || ''} ${ai.description || ''}\nDetail ${['High', 'Medium', 'Low'][LV]}, settings ${GFX.join('')}, window ${DW}x${DH}\n`, base = 0;
  await wait(4000); // (the resolution settles first; from here it is held)
  const p0 = pix, p4 = W * H / 4, R = rows.map(() => [0, 0, 0, 0]), f = (v, w) => v.toFixed(1).padStart(w);
  out += `drawn at ${W}x${H}${hasTS ? '' : '  ·  no GPU timer in this browser: only the fps column counts'}\n\n${'part left out'.padEnd(38)}GPU ms 1st   2nd   change   script ms   fps\n`;
  for (let k = 0; k < 2; k++) for (let i = 0; i < rows.length; i++) {
    const q = rows[i][2]; if (q) { if (RESQ) continue; pix = p4; resize(); }
    HIDE = rows[i][1]; info.textContent = `Measuring ${k * rows.length + i + 1} of ${rows.length * 2}…`;
    await wait(600); n = cpu = gpu = 0; await wait(1600);
    R[i][k] = gpu / n; R[i][2] = cpu / n; R[i][3] = n / 1.6;
    if (q) { pix = p0; resize(); }
  }
  R.forEach((r, i) => { if (!rows[i][2] || !RESQ) { const d = (r[0] + r[1] - R[0][0] - R[0][1]) / 2; out += `${rows[i][0].padEnd(38)}${f(r[0], 10)}${f(r[1], 6)}   ${(i ? (d > 0 ? '+' : '') + d.toFixed(1) : '').padStart(6)}   ${f(r[2], 9)}   ${r[3].toFixed(0).padStart(3)}\n`; } });
  HIDE = 0; info.textContent = out + '\nDone. Send this table (a screenshot will do).';
}
