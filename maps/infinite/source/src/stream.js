// ============================================================================
// the endless world: tiles are generated around the camera, uploaded, drawn and dropped again as it moves on
// ============================================================================
// The world is a grid of 48 m tiles without end. A window of LW x LW of them, centred on the camera, is loaded.
// A tile's way in:
//   1. the GPU computes its block of rock density (W_DENS), a few slices per frame
//   2. a worker turns the density into the terrain mesh and everything that grows on it (gen.js)
//   3. here its buffers are uploaded, its part of the wrapped world textures written and its shadows drawn
// Nothing of this blocks a frame for long: the frame loop only starts and collects the steps (pump()).
// A tile's slot in the window is its coordinates modulo WIN, and the world textures (skylight volume, ground map,
// shadow map) wrap around with the same period, so a tile always writes to the same place and nothing is ever moved.
// Only LW x LW of the WIN x WIN slots are filled: as many tiles as the draw distance needs (quality.js), 6 x 6 at
// 80 m, 7 x 7 at 105 m, all 8 x 8 at 135 m. The period stays WIN, so a slot and its place in the textures do not change.

// ---------------------------------------------------------------- tiles
// slots[s]: null, or { tx, tz, st: 0 waiting / 1 being generated / 2 loaded, ... } for the tile whose place that is
const slots = new Array(WIN * WIN).fill(null), order = new Array(WIN * WIN).fill(null);
let winX = 1e9, winZ = 1e9, nOrder = 0, nLoaded = 0, nWanted = 0, inflight = 0, coreVerts = 0;
const LW = VIEWD > 105 ? WIN : VIEWD > 80 ? 7 : 6;
const slotOf = (tx, tz) => (tx & (WIN - 1)) + WIN * (tz & (WIN - 1));
const tileAt = (tx, tz) => { const t = slots[slotOf(tx, tz)]; return t && t.st === 2 && t.tx === tx && t.tz === tz ? t : null; };

function dropTile(t) {
  if (t.st === 2) { nLoaded--; for (const b of [t.vb, t.ib, t.leafB, t.solB, t.miscB]) if (b) b.destroy(); }
  t.st = -1; // a result still on its way from a worker finds its tile gone
}
// Keeps the window centred on the camera. It moves a whole tile at a time, and only once the camera is 3/4 of a
// tile off centre, so swimming back and forth across a tile border does not load and drop the same row again.
function moveWindow(x, z) {
  // it runs up to 20 m ahead of a swimming camera, so tiles ahead get a head start
  const lv = hypot(F[VX], F[VZ]), lead = lv > 1 ? min(20, lv * 1.5) / lv : 0;
  const fx = (x + F[VX] * lead) / TW - LW / 2, fz = (z + F[VZ] * lead) / TW - LW / 2;
  if (abs(fx - winX) <= 0.75 && abs(fz - winZ) <= 0.75) return;
  winX = round(fx); winZ = round(fz); nWanted = 0;
  for (let s = 0; s < slots.length; s++) { const t = slots[s]; if (t && (t.tx < winX || t.tx >= winX + LW || t.tz < winZ || t.tz >= winZ + LW)) { dropTile(t); slots[s] = null; } }
  for (let tz = winZ; tz < winZ + LW; tz++) for (let tx = winX; tx < winX + LW; tx++) {
    const s = slotOf(tx, tz);
    if (!slots[s]) slots[s] = { tx, tz, st: 0, x0: tx * TW, z0: tz * TW, oy: tileOY(tx), ny: tileNY(tx), ylo: 0, yhi: 0, d2: 0, vis: false, vb: null, ib: null, leafB: null, solB: null, miscB: null };
    if (slots[s].st < 2) nWanted++;
  }
}

// How far from (x, z) the loaded world reaches: to the nearest tile of the window that is not there yet, or to the
// window's edge. The haze is drawn in to this distance (frame()), so a tile never appears in plain sight.
function reach(x, z) {
  let r = min(x - winX * TW, (winX + LW) * TW - x, z - winZ * TW, (winZ + LW) * TW - z);
  for (let s = 0; s < slots.length; s++) {
    const t = slots[s]; if (!t || t.st === 2) continue;
    const dx = max(t.x0 - x, x - t.x0 - TW, 0), dz = max(t.z0 - z, z - t.z0 - TW, 0), d = hypot(dx, dz);
    if (d < r) r = d;
  }
  return r;
}

// ---------------------------------------------------------------- step 1: density on the GPU
const DBYTES = NT * NYT * NT * 4; // room for a tall tile's block (the rift, math.js)
// a block's density is computed over 8 frames, a tall one's over 24
const slabsOf = (t) => (t.ny > NY ? 24 : 8);
const pDens = await CP({ layout: 'auto', compute: { module: mod(W_DENS), entryPoint: 'main' } });
const densU = new ArrayBuffer(48), densUu = new Uint32Array(densU), densUi = new Int32Array(densU);
densUu[0] = NT; densUu[2] = NT;
const PRIMCAP = 96; // rock shapes one block can be given (two vec4 each)
const densUB = device.createBuffer({ size: 48, usage: BU.UNIFORM | BU.COPY_DST }), densPrims = device.createBuffer({ size: PRIMCAP * 32, usage: BU.STORAGE | BU.COPY_DST });
const primData = new Float32Array(PRIMCAP * 8), HOMEPRIMS = primBuffer();
Q.writeBuffer(densPrims, 0, HOMEPRIMS);

// ---------------------------------------------------------------- the rock shapes a block is carved with
// fills primData with the shapes that can touch tile (tx, tz) and the counts in the uniforms
const FREACH = 100; // how far a formation's rock can reach from its cell (cellShapes, layout.js)
function tilePrims(tx, tz) {
  const x0 = tx * TW - MG * VS - FREACH, x1 = (tx + 1) * TW + MG * VS + FREACH, z0 = tz * TW - MG * VS - FREACH, z1 = (tz + 1) * TW + MG * VS + FREACH;
  const home = hypot((tx + 0.5) * TW, (tz + 0.5) * TW) < 420; // the hand-made shapes (and the clearings around them) reach this far
  const M = home ? MESAS.map((m) => m.slice(0, 8)) : [], A = home ? ARCHES.map((m) => [...m, 0]) : [], H = home ? HOLES.map((m) => [...m, 0]) : [], C = home ? CLEARS.map((m) => [m[0], m[1], m[2], m[3], m[4], m[5], 0, 0]) : [];
  for (let cz = floor(z0 / FC); cz <= floor(z1 / FC); cz++) for (let cx = floor(x0 / FC); cx <= floor(x1 / FC); cx++) { const f = cellShapes(cx, cz); M.push(...f.mesas); A.push(...f.arches); H.push(...f.holes); C.push(...f.clears); }
  let k = 0;
  const put = (p) => { if (k < PRIMCAP * 8) { primData.set(p, k); k += 8; } };
  for (const p of M) put(p); for (const p of A) put(p); for (const p of H) put(p); for (const p of C) put(p);
  densUu[8] = M.length; densUu[9] = A.length; densUu[10] = H.length; densUu[11] = C.length;
  Q.writeBuffer(densPrims, 0, primData, 0, max(k, 8));
}
const densOut = device.createBuffer({ size: DBYTES, usage: BU.STORAGE | BU.COPY_SRC });
const densBG = device.createBindGroup({ layout: pDens.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: densUB } }, { binding: 1, resource: { buffer: densOut } }, { binding: 2, resource: { buffer: densPrims } }] });
// read-back buffers: the density of a tile waits in one until it is mapped and handed to a worker
const readback = [0, 1, 2, 3].map(() => ({ b: device.createBuffer({ size: DBYTES, usage: BU.MAP_READ | BU.COPY_DST }), busy: false, t: null }));
let job = null, jobSlab = 0, jobRB = null;
function densSlab() {
  if (!jobSlab) tilePrims(job.tx, job.tz);
  const SLABS = slabsOf(job), SLAB = NT / SLABS, bytes = NT * job.ny * NT * 4;
  densUu[1] = job.ny; densUu[3] = jobSlab * SLAB; densUi[4] = job.tx * TILE - MG; densUi[5] = job.tz * TILE - MG; densUi[6] = (job.oy - OY) / VS;
  Q.writeBuffer(densUB, 0, densU);
  const e = device.createCommandEncoder(), c = e.beginComputePass();
  c.setPipeline(pDens); c.setBindGroup(0, densBG); c.dispatchWorkgroups(NT / 4, job.ny / 4, SLAB / 4); c.end();
  if (++jobSlab === SLABS) e.copyBufferToBuffer(densOut, 0, jobRB.b, 0, bytes);
  Q.submit([e.finish()]);
  if (jobSlab < SLABS) return;
  const rb = jobRB, t = job; job = null;
  rb.b.mapAsync(GPUMapMode.READ, 0, bytes).then(() => {
    const D = new Float32Array(rb.b.getMappedRange(0, bytes).slice(0));
    rb.b.unmap(); rb.busy = false;
    if (t.st !== 1) { inflight--; return; } // dropped meanwhile
    toWorker(t, D);
  }, () => { rb.busy = false; inflight--; });
}

// ---------------------------------------------------------------- step 2: the workers
const workers = [], ready = [];
function startWorkers(POSES, flyPts) {
  const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
  const n = max(1, min(3, (navigator.hardwareConcurrency || 4) - 2));
  for (let i = 0; i < n; i++) {
    const w = { w: new Worker(url), t: null };
    w.w.postMessage({ init: { LV, THIN, FLOAT, NAT, POSES, flyPts } });
    w.w.onmessage = (e) => { const t = w.t; w.t = null; inflight--; if (t.st === 1) install(t, e.data); if (ready.length) { const r = ready.shift(); give(w, r.t, r.D); } };
    w.w.onerror = (e) => { console.error('tile worker: ' + e.message); };
    workers.push(w);
  }
}
const give = (w, t, D) => { w.t = t; w.w.postMessage({ tx: t.tx, tz: t.tz, oy: t.oy, ny: t.ny, D }, [D.buffer]); };
function toWorker(t, D) { for (const w of workers) if (!w.t) { give(w, t, D); return; } ready.push({ t, D }); }

// ---------------------------------------------------------------- step 3: upload
const VT = TILE / 2, GT = 512 / WIN;
function install(t, m) {
  const g = (data, usage) => data.byteLength ? buf(data, usage) : null;
  t.vb = g(new Uint8Array(m.terr.vb), BU.VERTEX); t.ib = g(m.terr.ib, BU.INDEX);
  t.leafB = g(new Uint8Array(m.leaf.buf), BU.VERTEX); t.solB = g(m.sol.buf, BU.VERTEX); t.miscB = g(m.misc.buf, BU.VERTEX);
  t.terr = m.terr; m.terr.vb = m.terr.ib = null;
  t.big = m.leaf.parts[0]; t.bigF = m.leaf.parts[1]; t.small = m.leaf.parts[2];
  t.chunks = m.sol.meta.chunks; t.props = m.sol.meta.props; t.solids = m.sol.meta.solids; t.misc = m.misc.meta;
  t.CI = m.CI; t.CG = m.CG; t.cover = m.cover; t.ylo = min(m.ylo, t.oy + 6); t.yhi = max(m.yhi, t.oy + 26);
  const sx = t.tx & (WIN - 1), sz = t.tz & (WIN - 1);
  Q.writeTexture({ texture: tVol, origin: [sx * VT, 0, sz * VT] }, m.vol, { bytesPerRow: VT * 2, rowsPerImage: NY / 2 }, [VT, NY / 2, VT]);
  Q.writeTexture({ texture: tMap, origin: [sx * GT, sz * GT] }, m.gm, { bytesPerRow: GT * 4 }, [GT, GT]);
  t.st = 2; nLoaded++; nWanted--; coreVerts += m.nCore;
  if (shadowAll < 2) shadowAll = 1; else shadowQ.push(t);
}

// ---------------------------------------------------------------- the frame's share of the work
// Starts the nearest waiting tile when there is room in the pipeline and pushes the density job on by one slab.
// `fast` (while the loading screen is up) does as much as the pipeline takes.
function pump(fast) {
  for (let guard = 0; guard < 64; guard++) {
    if (!job && nWanted && inflight < workers.length + 1) {
      let rb = null; for (const r of readback) if (!r.busy) { rb = r; break; }
      let best = null, bd = 1e18;
      if (rb) for (let s = 0; s < slots.length; s++) { const t = slots[s]; if (t && t.st === 0) { const dx = t.x0 + TW / 2 - F[CX], dz = t.z0 + TW / 2 - F[CZ], d = dx * dx + dz * dz; if (d < bd) { bd = d; best = t; } } }
      if (best) { job = best; best.st = 1; jobSlab = 0; jobRB = rb; rb.busy = true; inflight++; }
    }
    if (!job) break;
    densSlab();
    if (!fast) break;
    while (job) densSlab();
  }
  if (shadowAll === 1 && !nWanted) { shadowFull(); shadowAll = 2; }
  else if (shadowQ.length) shadowNext();
}

// ---------------------------------------------------------------- shadows
// The shadow map is the world seen along the sun: a point (x, y, z) lands on (x, z) slid along the sun's direction
// down to y = 0, and its depth is its height. Slid like that the map wraps around like the other world textures:
// a new tile clears and redraws only its own patch.
const SHP = 480, SHM = 6; // period in metres (more than the window and its slant), margin around a tile
const pShClear = await (() => { const m = mod('@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { return vec4f(f32(i32(i & 1u) * 4 - 1), f32(i32(i >> 1u) * 4 - 1), 1., 1.); }');
  return RP({ layout: 'auto', vertex: { module: m, entryPoint: 'vs' }, primitive: { topology: 'triangle-list' }, depthStencil: { format: DEPTH, depthWriteEnabled: true, depthCompare: 'always' } }); })();
const shadowQ = []; let shadowAll = 0; // 0: nothing loaded yet, 1: draw the whole map once the first window is in, 2: tile by tile
const shadowPass = { colorAttachments: [], depthStencilAttachment: { view: tShadow.createView(), depthLoadOp: 'load', depthStoreOp: 'store' } };
const SKX = SUN[0] / SUN[1], SKZ = SUN[2] / SUN[1];
// m (16 floats, column-major): world -> shadow clip space, shifted by whole periods (ku, kv)
function shadowMatrix(m, o, ku, kv) {
  m[o] = 2 / SHP; m[o + 4] = -SKX * 2 / SHP; m[o + 8] = 0; m[o + 12] = -2 * ku - 1;
  m[o + 1] = 0; m[o + 5] = SKZ * 2 / SHP; m[o + 9] = -2 / SHP; m[o + 13] = 2 * kv + 1; // z runs down the map: keeps the triangles' winding
  m[o + 2] = 0; m[o + 6] = 0; m[o + 10] = 0; m[o + 14] = 0.5; // the depth comes from shz() in the shaders
  m[o + 3] = 0; m[o + 7] = 0; m[o + 11] = 0; m[o + 15] = 1;
}
shadowMatrix(UB, 16, 0, 0); // what the scene shaders look shadows up with
function shadowDraw(r, t) {
  if (t.ib) { r.setPipeline(pTerrSh); r.setVertexBuffer(0, t.vb); r.setVertexBuffer(1, ibIdent); r.setIndexBuffer(t.ib, 'uint32'); r.drawIndexed(t.terr.start[SUB * SUB] * 6, 1, 0, 0, 0); }
  if (t.solB) {
    r.setPipeline(pSolidSh); r.setVertexBuffer(0, vbMesh); r.setIndexBuffer(ibMesh, 'uint32'); r.setVertexBuffer(1, t.solB);
    for (let i = 0; i < 12; i++) { const n = t.solids[i * 2 + 1]; if (n) r.drawIndexed(meshes[i].ib.length, n, meshes[i].i0, meshes[i].v0, t.solids[i * 2]); }
    // small rocks, sponges and corals only on High: too much for a phone's driver
    if (SHADOW > 2048) for (let i = 0; i < NCHUNK; i++) { const s = t.chunks[i].start, n = s[SUB * SUB] - s[0]; if (n) r.drawIndexed(meshes[14 + i].ib.length, n, meshes[14 + i].i0, meshes[14 + i].v0, s[0]); }
    if (SHADOW > 2048) for (let i = 0; i < 6; i++) { const s = t.props[i].start, n = s[SUB * SUB] - s[0]; if (n) r.drawIndexed(meshes[4 + i].ib.length, n, meshes[4 + i].i0, meshes[4 + i].v0, s[0]); }
  }
  if (t.leafB) { const s = t.big.start, n = s[SUB * SUB] - s[0]; if (n) { r.setPipeline(pLeafSh); r.setVertexBuffer(0, t.leafB); r.draw(6, n, 0, s[0]); } }
}
// redraws the shadows of the world box x0..x1, y0..y1, z0..z1 from the loaded tiles tx0..tx1, tz0..tz1
function shadowRect(x0, x1, y0, y1, z0, z1, tx0, tx1, tz0, tz1) {
  const u0 = x0 - SKX * (SKX > 0 ? y1 : y0), u1 = x1 - SKX * (SKX > 0 ? y0 : y1), v0 = z0 - SKZ * (SKZ > 0 ? y1 : y0), v1 = z1 - SKZ * (SKZ > 0 ? y0 : y1);
  for (let kv = floor(v0 / SHP); kv <= floor(v1 / SHP); kv++) for (let ku = floor(u0 / SHP); ku <= floor(u1 / SHP); ku++) {
    const a0 = max(u0 / SHP - ku, 0), a1 = min(u1 / SHP - ku, 1), b0 = max(v0 / SHP - kv, 0), b1 = min(v1 / SHP - kv, 1);
    const px = floor(a0 * SHADOW), pw = min(SHADOW, Math.ceil(a1 * SHADOW)) - px, py = floor(b0 * SHADOW), ph = min(SHADOW, Math.ceil(b1 * SHADOW)) - py;
    if (pw <= 0 || ph <= 0) continue;
    shadowMatrix(UBS, 0, ku, kv); shadowMatrix(UBS, 16, ku, kv);
    Q.writeBuffer(uboS, 0, UBS);
    const e = device.createCommandEncoder(), r = e.beginRenderPass(shadowPass);
    r.setScissorRect(px, py, pw, ph);
    r.setPipeline(pShClear); r.draw(3);
    r.setBindGroup(0, bg0s);
    for (let tz = tz0; tz <= tz1; tz++) for (let tx = tx0; tx <= tx1; tx++) { const t = tileAt(tx, tz); if (t) shadowDraw(r, t); }
    r.end();
    Q.submit([e.finish()]);
  }
}
// redraws the shadows of the tiles tx0..tx1, tz0..tz1 (one, or a line of them with t's band of heights): their own
// rectangle of the map, from themselves and the tiles around them, whose shadows fall into it too
const shadowTiles = (t, tx0, tx1, tz0, tz1) => shadowRect(tx0 * TW - SHM, (tx1 + 1) * TW + SHM, t.oy - 2, min(t.oy + t.ny * VS + 2, 4), tz0 * TW - SHM, (tz1 + 1) * TW + SHM, tx0 - 1, tx1 + 1, tz0 - 1, tz1 + 1);
// The shadows of the tiles that have just come in, one rectangle a frame. A tile within the draw distance gets its
// own at once. The far ones (a row at the window's edge) wait until all of them are in and are then drawn as lines of
// up to 4 neighbours of one height: a line redraws far fewer tiles than its tiles would one by one.
// (Not the tall tiles of the rift: their rectangles are long and overlap, so they keep the order they come in.)
function shadowNext() {
  let t = null;
  for (let i = 0; i < shadowQ.length; i++) {
    const q = shadowQ[i]; if (q.st !== 2) { shadowQ.splice(i--, 1); continue; }
    if (!t && (!nWanted || q.ny > NY || hypot(max(q.x0 - F[CX], F[CX] - q.x0 - TW, 0), max(q.z0 - F[CZ], F[CZ] - q.z0 - TW, 0)) < VIEWD)) t = q;
  }
  if (!t) return;
  // the longer line through t of waiting tiles, along x or along z: from a to b tiles off t
  const at = (dx, dz) => shadowQ.find((q) => q.tx === t.tx + dx && q.tz === t.tz + dz && q.oy === t.oy && q.ny === t.ny && (q === t || t.ny === NY));
  let a = 0, b = 0, z = 0;
  for (let k = 0; k < 2; k++) {
    let lo = 0, hi = 0;
    while (hi - lo < 3 && at(k ? 0 : hi + 1, k ? hi + 1 : 0)) hi++;
    while (hi - lo < 3 && at(k ? 0 : lo - 1, k ? lo - 1 : 0)) lo--;
    if (hi - lo > b - a) { a = lo; b = hi; z = k; }
  }
  for (let i = a; i <= b; i++) shadowQ.splice(shadowQ.indexOf(at(z ? 0 : i, z ? i : 0)), 1);
  shadowTiles(t, t.tx + (z ? 0 : a), t.tx + (z ? 0 : b), t.tz + (z ? a : 0), t.tz + (z ? b : 0));
}
const shadowFull = () => { let lo = 1e9, hi = -1e9; for (let tx = winX; tx < winX + LW; tx++) { lo = min(lo, tileOY(tx)); hi = max(hi, tileOY(tx) + tileNY(tx) * VS); } shadowFullY(lo - 2, min(hi + 2, 4)); };
const shadowFullY = (y0, y1) => shadowRect(winX * TW - SHM, (winX + LW) * TW + SHM, y0, y1, winZ * TW - SHM, (winZ + LW) * TW + SHM, winX, winX + LW - 1, winZ, winZ + LW - 1);

// ---------------------------------------------------------------- drawing
// Sorts the loaded tiles nearest first and marks the ones whose box is in view.
function sortTiles() {
  const cx = F[CX], cy = F[CY], cz = F[CZ], fx = F[FX], fy = F[FY], fz = F[FZ], rx = F[RX], rz = F[RZ], ux = F[UX], uy = F[UY], uz = F[UZ];
  const tx = CTX || TANH * W / H, hw = TW * 0.5, ex = hw + 6;
  nOrder = 0;
  for (let s = 0; s < slots.length; s++) {
    const t = slots[s]; if (!t || t.st !== 2) continue;
    const px = t.x0 + hw - cx, pz = t.z0 + hw - cz, py = (t.ylo + t.yhi) * 0.5 - cy, ey = (t.yhi - t.ylo) * 0.5 + 6, hx = max(abs(px) - hw, 0), hz = max(abs(pz) - hw, 0);
    t.d2 = hx * hx + hz * hz;
    const lim = px * fx + py * fy + pz * fz + ex * abs(fx) + ey * abs(fy) + ex * abs(fz);
    t.vis = lim >= 0 && abs(px * rx + pz * rz) - ex * (abs(rx) + abs(rz)) <= lim * tx && abs(px * ux + py * uy + pz * uz) - ex * (abs(ux) + abs(uz)) - ey * abs(uy) <= lim * CTY;
    let i = nOrder++; while (i > 0 && order[i - 1].d2 > t.d2) { order[i] = order[i - 1]; i--; }
    order[i] = t;
  }
}
// Draws the cells of one cell-sorted part of a tile that are in view and within [minD, maxD) (scaled by `det`, but
// not for the terrain) as merged runs. indexed: 1 terrain quads, a mesh for instances of it, false for leaf strips.
function drawPart(r, t, part, mar, indexed, verts, minD, maxD) {
  const start = part.start, lo = part.lo, hi = part.hi;
  if (start[SUB * SUB] === start[0]) return;
  const cx = F[CX], cy = F[CY], cz = F[CZ], fx = F[FX], fy = F[FY], fz = F[FZ], rx = F[RX], rz = F[RZ], ux = F[UX], uy = F[UY], uz = F[UZ];
  const ds = indexed === 1 ? 1 : det * det;
  const tx = CTX || TANH * W / H, hw = CELLW * 0.5, ex = hw + mar, min2 = minD * minD * ds, max2 = maxD * maxD * ds;
  for (let k = 0; k < SUB; k++) {
    const row = k * SUB, pz = t.z0 + (k + 0.5) * CELLW - cz, hz = max(abs(pz) - hw, 0);
    let run = -1;
    for (let x = 0; x <= SUB; x++) {
      const c = row + x; let v = false;
      if (x < SUB) {
        const l = lo[c], h = hi[c];
        if (l <= h) {
          const px = t.x0 + (x + 0.5) * CELLW - cx, py = (l + h) * 0.5 - cy, ey = (h - l) * 0.5 + mar, hx = max(abs(px) - hw, 0), h2 = hx * hx + hz * hz;
          if (h2 < max2 && h2 >= min2) {
            const lim = px * fx + py * fy + pz * fz + ex * abs(fx) + ey * abs(fy) + ex * abs(fz);
            if (lim >= 0 && abs(px * rx + pz * rz) - ex * (abs(rx) + abs(rz)) <= lim * tx) v = abs(px * ux + py * uy + pz * uz) - ex * (abs(ux) + abs(uz)) - ey * abs(uy) <= lim * CTY;
          }
        }
      }
      if (v) { if (run < 0) run = c; } else if (run >= 0) {
        const a = start[run], n = start[c] - a;
        if (n > 0) { if (indexed === 1) r.drawIndexed(n * 6, 1, a * 6, 0, 0); else if (indexed) r.drawIndexed(indexed.ib.length, n, indexed.i0, indexed.v0, a); else r.draw(verts, n, 0, a); }
        run = -1;
      }
    }
  }
}

// ---------------------------------------------------------------- collision
// distance to the rock (1/127 m, > 0 in rock) at a voxel of the world (y counted from OY); water where nothing is
// loaded and above a tile's band of voxels, rock below it
function cv(x, y, z) {
  const t = slots[((x >> 6) & (WIN - 1)) + WIN * ((z >> 6) & (WIN - 1))];
  if (!t || t.st !== 2 || t.tx !== x >> 6 || t.tz !== z >> 6) return -127;
  y -= (t.oy - OY) / VS; if (y >= t.ny - 4) return -127; if (y < 4) return 127;
  const lx = x & 63, lz = z & 63, b = t.CI[(lx >> 2) + 16 * ((y >> 2) + t.ny / 4 * (lz >> 2))];
  return b > 1 ? t.CG[b * 64 - 128 + (lx & 3) + 4 * (y & 3) + 16 * (lz & 3)] : b * 254 - 127;
}

// ---------------------------------------------------------------- the sea floor under a point, before any tile is there
// (the viewpoints stand a little above the ground: their heights are worked out once, at load)
async function groundAt(x, z) {
  const NY = tileNY(floor(x / TW)); // (a tall tile's column in the rift)
  const n = 4 * NY * 4 * 4, out = device.createBuffer({ size: n, usage: BU.STORAGE | BU.COPY_SRC }), rb = device.createBuffer({ size: n, usage: BU.MAP_READ | BU.COPY_DST });
  const u = new ArrayBuffer(48), uu = new Uint32Array(u), ui = new Int32Array(u);
  uu[0] = 4; uu[1] = NY; uu[2] = 4; ui[4] = round(x / VS); ui[5] = round(z / VS); const oy = tileOY(floor(x / TW)); ui[6] = (oy - OY) / VS;
  uu[8] = MESAS.length; uu[9] = ARCHES.length; uu[10] = HOLES.length; uu[11] = CLEARS.length;
  const ub = buf(new Uint8Array(u), BU.UNIFORM);
  const bg = device.createBindGroup({ layout: pDens.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ub } }, { binding: 1, resource: { buffer: out } }, { binding: 2, resource: { buffer: densPrims } }] });
  const e = device.createCommandEncoder(), c = e.beginComputePass();
  c.setPipeline(pDens); c.setBindGroup(0, bg); c.dispatchWorkgroups(1, NY / 4, 1); c.end();
  e.copyBufferToBuffer(out, 0, rb, 0, n); Q.submit([e.finish()]);
  await rb.mapAsync(GPUMapMode.READ);
  const D = new Float32Array(rb.getMappedRange()); let y = seaBase(x);
  for (let g = NY - 2; g >= 0; g--) { const d = D[g * 4], da = D[(g + 1) * 4]; if (da <= 0 && d > 0) y = oy + (g + d / (d - da)) * VS; }
  rb.unmap(); rb.destroy(); out.destroy(); ub.destroy();
  return y;
}
