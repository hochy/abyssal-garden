// ============================================================================
// world layout + procedural content generation (load-time only)
// ============================================================================
// The asteroid is a lumpy ball about R0 metres in radius at the origin (W_DENS). Places on it are unit directions.
const R0 = 54;
const nrm3 = (v) => { const l = hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const PAD = nrm3([0.15, 1, 0.2]), GATE = nrm3([-0.75, 0.45, -0.5]), GROVE = nrm3([0.8, 0.2, -0.55]), WOOD = nrm3([-0.5, 0.3, 0.8]), WRECK = [0, -0.954, -0.3], SHAFT = nrm3([0.55, -0.15, 0.82]);
// craters: direction, radius
const CRATERS = [[...GATE, 20], [...nrm3([0.9, 0.3, 0.3]), 11], [...nrm3([-0.2, 0.6, 0.8]), 9], [...nrm3([0.3, 0.5, -0.85]), 12], [...nrm3([-0.9, -0.3, 0.3]), 14],
  [...nrm3([0.5, -0.7, -0.5]), 10], [...nrm3([-0.4, -0.6, -0.7]), 8], [...nrm3([0.1, -0.5, 0.9]), 7], [...nrm3([-0.95, 0.2, 0.1]), 6], [...nrm3([0.6, 0.75, 0.3]), 5]];
// moonlets: start position, size, turn rate about the y axis, rock mesh
const MOONS = [[150, 26, 0, 10, -0.03, 0], [-105, -45, 118, 5, -0.045, 2], [60, 85, -175, 7, -0.02, 1]];
const mossAt = (x, y, z) => sstep(0.5, 0.64, fbm(x * 0.045, y * 0.045 + 7, z * 0.045, 3));
function primBuffer() { return new Float32Array(CRATERS.flat()); }

// ---------------------------------------------------------------- terrain mesh from the density grid
function buildTerrain(D) {
  const sn = surfaceNets(D, NX, NY, NZ), nv = sn.nv, gp = sn.pos;
  const smp = sampler3(D, NX, NY, NZ);
  const vb = new ArrayBuffer(nv * 16), vf = new Float32Array(vb), v8 = new Int8Array(vb);
  const wp = new Float32Array(nv * 3), wn = new Float32Array(nv * 3);
  for (let k = 0; k < nv; k++) {
    const x = gp[k * 3], y = gp[k * 3 + 1], z = gp[k * 3 + 2], e = 0.8;
    let nx = smp(x - e, y, z) - smp(x + e, y, z), ny = smp(x, y - e, z) - smp(x, y + e, z), nz = smp(x, y, z - e) - smp(x, y, z + e);
    const l = hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const X = OX + x * VS, Y = OY + y * VS, Z = OZ + z * VS;
    wp[k * 3] = vf[k * 4] = X; wp[k * 3 + 1] = vf[k * 4 + 1] = Y; wp[k * 3 + 2] = vf[k * 4 + 2] = Z;
    wn[k * 3] = nx; wn[k * 3 + 1] = ny; wn[k * 3 + 2] = nz;
    v8[k * 16 + 12] = round(nx * 127); v8[k * 16 + 13] = round(ny * 127); v8[k * 16 + 14] = round(nz * 127); v8[k * 16 + 15] = 127;
  }
  // bucket quads into the XZ culling grid
  const nq = sn.ni / 6, key = new Uint8Array(nq), cnt = new Uint32Array(CELLS * CELLS + 1);
  const lo = new Float32Array(CELLS * CELLS).fill(1e9), hi = new Float32Array(CELLS * CELLS).fill(-1e9);
  for (let q = 0; q < nq; q++) {
    const a = sn.idx[q * 6] * 3;
    const c = clamp(floor((wp[a] - OX) / CELLW), 0, CELLS - 1) + CELLS * clamp(floor((wp[a + 2] - OZ) / CELLW), 0, CELLS - 1);
    key[q] = c; cnt[c + 1]++;
    for (let j = 0; j < 6; j++) { const y = wp[sn.idx[q * 6 + j] * 3 + 1]; if (y < lo[c]) lo[c] = y; if (y > hi[c]) hi[c] = y; }
  }
  for (let c = 0; c < CELLS * CELLS; c++) cnt[c + 1] += cnt[c];
  const ib = new Uint32Array(sn.ni), fill = cnt.slice();
  for (let q = 0; q < nq; q++) { const o = fill[key[q]]++ * 6; for (let j = 0; j < 6; j++) ib[o + j] = sn.idx[q * 6 + j]; }
  return { vb, ib, nv, wp, wn, smp, start: cnt, lo, hi };
}

// ---------------------------------------------------------------- instance stores
function makeWorld(D, T) {
  const gi = (x, y, z) => x + NX * (y + NY * z);
  const smp = T.smp, Dw = (x, y, z) => smp((x - OX) / VS, (y - OY) / VS, (z - OZ) / VS);
  const nCells = CELLS * CELLS;
  const cellOf = (x, z) => clamp(floor((x - OX) / CELLW), 0, CELLS - 1) + CELLS * clamp(floor((z - OZ) / CELLW), 0, CELLS - 1);
  const cells = () => Array.from({ length: nCells }, () => []);
  const big = cells(), small = cells();
  let nth = 0;
  const leaf = (L, x, y, z, len, yaw, tilt, wid, hA, type, s1, s2, bend) => { if (!(nth++ % THIN)) L[cellOf(x, z)].push(x, y, z, len, yaw, tilt, wid * (1 + LV / 2), hA, type, s1, s2, bend); };
  // a blade growing along the direction n, leaning by up to `lean`
  const blade = (L, x, y, z, n, len, wid, type, lean) => { const v = nrm3([n[0] + rr(-lean, lean), n[1] + rr(-lean, lean), n[2] + rr(-lean, lean)]); leaf(L, x, y, z, len, atan2(v[2], v[0]), Math.acos(v[1]), wid, 0, type, rnd(), rnd(), rr(0.3, 0.8)); };
  const glints = [], glint = (...a) => { nth++ % THIN || glints.push(...a); };
  const solids = [], props = Array.from({ length: 6 }, cells), chunks = Array.from({ length: NCHUNK }, cells), bubbles = [];
  const solid = (mesh, x, y, z, sc, q, mat, seed, ts = 1, bob = 0) => { (mesh > 3 && mesh < 10 ? props[mesh - 4][cellOf(x, z)] : (solids[mesh] ||= [])).push(x, y, z, sc, q[0], q[1], q[2], q[3], mat, seed, ts, bob); };
  // radius of the surface along the direction n, and the point h metres above it
  const surf = (n) => { for (let r = 75; r > 2; r -= 0.3) if (Dw(n[0] * r, n[1] * r, n[2] * r) > 0) return r + 0.15; return R0; };
  const at = (n, h = 0) => { const r = surf(n) + h; return [n[0] * r, n[1] * r, n[2] * r]; };
  // the direction `d` metres along the ground from P, on the bearing a
  const around = (P, d, a) => { const t = nrm3([P[1], -P[0], 0]), b = [P[1] * t[2] - P[2] * t[1], P[2] * t[0] - P[0] * t[2], P[0] * t[1] - P[1] * t[0]], c = cos(a) * d, s = sin(a) * d; return nrm3([P[0] * R0 + t[0] * c + b[0] * s, P[1] * R0 + t[1] * c + b[1] * s, P[2] * R0 + t[2] * c + b[2] * s]); };
  const pickV = () => ((rnd() * T.nv) | 0) * 3;
  const qN = (n) => qMul(qFromY(n[0], n[1], n[2]), qAxis(0, 1, 0, rnd() * TAU));
  // metres along the ground from the place P
  const dist = (x, y, z, P) => Math.acos(clamp((x * P[0] + y * P[1] + z * P[2]) / (hypot(x, y, z) || 1), -1, 1)) * R0;
  const zoneOf = (x, y, z, P, r) => sstep(r, r * 0.45, dist(x, y, z, P));
  const keepClear = (x, y, z) => dist(x, y, z, PAD) < 14 || dist(x, y, z, GATE) < 8;

  // --- crystals and fungi
  rseed(1);
  const lamps = [];
  for (let i = 0; i < 75000; i++) {
    const k = pickV(), x = T.wp[k], y = T.wp[k + 1], z = T.wp[k + 2], n = [T.wn[k], T.wn[k + 1], T.wn[k + 2]], r = hypot(x, y, z), up = [x / r, y / r, z / r], o = n[0] * up[0] + n[1] * up[1] + n[2] * up[2];
    if (r > 40 && keepClear(x, y, z)) continue;
    const inside = r < 42, grove = zoneOf(x, y, z, GROVE, 42), wood = zoneOf(x, y, z, WOOD, 42);
    const cz = max(grove * 0.6, inside ? 0.5 : 0, sstep(0.6, 0.72, fbm(x * 0.04 + 9, y * 0.04, z * 0.04, 3)) * 0.5);
    const fz = inside ? 0.08 : max(wood, sstep(0.58, 0.7, fbm(x * 0.045 + 40, y * 0.045, z * 0.045, 3)) * 0.6);
    const u = rnd();
    if (u < cz * 0.15) {
      const giant = rnd() < 0.07, sc = rr(0.5, 1.5) * (giant ? 2.8 : 1) * (1 + grove * 0.4), tall = giant || rnd() < grove * 0.5;
      const hue = fract((grove > 0.2 ? 0.1 : r < 24 ? 0.9 : inside ? 0.68 : 0.45) + rr(-0.12, 0.12) + 1);
      solid(tall ? 9 : 7 + (rnd() * 2 | 0), x - n[0] * 0.15 * sc, y - n[1] * 0.15 * sc, z - n[2] * 0.15 * sc, sc, qN(n), 5, hue, 1, 0);
      for (let j = 0; j < 3; j++) glint(x + n[0] * sc * rr(0.3, 2) + rr(-1, 1) * sc, y + n[1] * sc * rr(0.3, 2) + rr(-1, 1) * sc, z + n[2] * sc * rr(0.3, 2) + rr(-1, 1) * sc, 0, rnd(), hue < 0.35 ? 0.7 : hue < 0.82 ? 0.9 : 0.1, rr(0.02, 0.05), 0);
    } else if (u < cz * 0.15 + fz * 0.17 && o > 0.4) {
      const giant = rnd() < 0.06, sc = rr(0.35, 1.3) * (giant ? 3.2 : 1) * (1 + wood * 0.6), v = nrm3([n[0] * 0.5 + up[0] * 0.8, n[1] * 0.5 + up[1] * 0.8, n[2] * 0.5 + up[2] * 0.8]);
      solid(4 + (rnd() * 3 | 0), x - v[0] * 0.08 * sc, y - v[1] * 0.08 * sc, z - v[2] * 0.08 * sc, sc, qN(v), 4, rnd(), 1, 0);
      if (rnd() < 0.05) lamps.push([x + up[0] * sc, y + up[1] * sc, z + up[2] * sc]);
    }
  }

  // --- ground cover: glowing moss tufts and short grass on open ground
  rseed(4);
  for (let i = 0; i < 330000; i++) {
    const k = pickV(), x = T.wp[k] + rr(-0.3, 0.3), y = T.wp[k + 1] + rr(-0.3, 0.3), z = T.wp[k + 2] + rr(-0.3, 0.3), r = hypot(x, y, z), up = [x / r, y / r, z / r];
    if (T.wn[k] * up[0] + T.wn[k + 1] * up[1] + T.wn[k + 2] * up[2] < 0.75 || keepClear(x, y, z)) continue;
    const m = mossAt(x, y, z), u = rnd(), bx = x - up[0] * 0.2, by = y - up[1] * 0.2, bz = z - up[2] * 0.2;
    if (m > 0.3 && u < m * 0.9) for (let j = 0; j < 4; j++) blade(small, bx, by, bz, up, rr(0.12, 0.34), rr(0.04, 0.08), rnd() < 0.7 ? 5 : 7, 0.5);
    else if (u < 0.04 + 0.22 * sstep(0.45, 0.6, fbm(x * 0.09, y * 0.09 + 9, z * 0.09, 2))) for (let j = 0; j < 5; j++) blade(big, bx, by, bz, up, rr(0.3, 1.0), rr(0.05, 0.1), rnd() < 0.7 ? 2 : 3, 0.4);
    if (m > 0.3 && rnd() < 0.04) glint(x + up[0] * 0.4, y + up[1] * 0.4, z + up[2] * 0.4, 0, rnd(), 0.82 + rnd() * 0.18, rr(0.01, 0.02), 0);
  }

  // --- loose rock: boulders half sunk in the surface, rubble on open ground
  rseed(10);
  for (let i = 0; i < 7000; i++) {
    const k = pickV(), x = T.wp[k], y = T.wp[k + 1], z = T.wp[k + 2];
    if (keepClear(x, y, z)) continue;
    const sc = 0.3 + 1.5 * pow(rnd(), 3), q = qRand();
    chunks[(sc > 1.15 ? 3 : 0) + (rnd() * 3 | 0)][cellOf(x, z)].push(x - T.wn[k] * sc * 0.25, y - T.wn[k + 1] * sc * 0.25, z - T.wn[k + 2] * sc * 0.25, sc, q[0], q[1], q[2], q[3], 1, rnd(), sc > 1.15 ? 0 : 96, 0);
  }
  rseed(11);
  for (let i = 0; i < 70000; i++) {
    const k = pickV(), x = T.wp[k] + rr(-0.3, 0.3), y = T.wp[k + 1] + rr(-0.3, 0.3), z = T.wp[k + 2] + rr(-0.3, 0.3), sc = 0.05 + 0.3 * pow(rnd(), 2), q = qRand();
    nth++ % THIN || chunks[6][cellOf(x, z)].push(x, y, z, sc, q[0], q[1], q[2], q[3], 1, rnd(), 44, 0);
  }

  // --- far debris, and three moonlets that circle the asteroid (a negative last value is their turn rate)
  rseed(8);
  for (let i = 0; i < 200; i++) { const d = nrm3([rr(-1, 1), rr(-0.6, 0.6), rr(-1, 1)]), r = rr(135, 210); solid(rnd() * 4 | 0, d[0] * r, d[1] * r, d[2] * r, rnd() < 0.1 ? rr(2.5, 6) : rr(0.3, 1.7), qRand(), 1, rnd(), 1, rr(0.1, 0.6)); }
  for (const m of MOONS) solid(m[5], m[0], m[1], m[2], m[3], qRand(), 1, rnd(), 1, m[4]);

  // --- set pieces: the gate, and crystal spires (a ring round the gate, a great cluster in the canyon)
  solid(27, ...at(GATE, -0.3), 1, qMul(qFromY(...GATE), qAxis(0, 1, 0, 0.75)), 7, 0.5, 1, 0);              // ring gate in the big crater
  const spire = (P, d, sc, hue, out) => { const v = nrm3([d[0] + (d[0] - P[0]) * out, d[1] + (d[1] - P[1]) * out, d[2] + (d[2] - P[2]) * out]), p = at(d, -0.12 * sc); solid(rnd() < 0.6 ? 10 : 21, ...p, sc, qN(v), 5, hue, 1, 0);
    for (let j = 0; j < 8; j++) glint(p[0] + v[0] * sc * rr(0.5, 2.6) + rr(-0.4, 0.4) * sc, p[1] + v[1] * sc * rr(0.5, 2.6) + rr(-0.4, 0.4) * sc, p[2] + v[2] * sc * rr(0.5, 2.6) + rr(-0.4, 0.4) * sc, 0, rnd(), hue < 0.35 ? 0.7 : hue < 0.82 ? 0.9 : 0.1, rr(0.03, 0.07), 0); };
  rseed(12);
  for (let i = 0; i < 9; i++) spire(GATE, around(GATE, 15 + (i % 2) * 3.5, i / 9 * TAU + 0.55), rr(2.2, 4.2), rr(0.05, 0.3), 2.5);
  for (let i = 0; i < 16; i++) spire(WRECK, around(WRECK, i ? rr(2, 13) : 0.5, i * 2.4), i ? rr(2, 6) : 9, rr(0.84, 0.99), i ? 6 : 0);

  // --- lanterns drifting up from the fungus woods, and jets from three vents
  rseed(13);
  for (const s of lamps) for (let i = 0; i < 14; i++) bubbles.push(s[0] + rr(-0.6, 0.6), s[1] + rr(-0.6, 0.6), s[2] + rr(-0.6, 0.6), rr(0.06, 0.2), rnd(), rr(1, 2.2), rr(8, 20), rr(0.05, 0.16));
  for (const v of [[0.9, 0.3, 0.3], [-0.9, -0.3, 0.3], [0.3, 0.5, -0.85]]) { const p = at(nrm3(v)); for (let i = 0; i < 520; i++) bubbles.push(p[0] + rr(-0.5, 0.5), p[1] + rr(-0.5, 0.5), p[2] + rr(-0.5, 0.5), rr(0.05, 0.14), rnd(), rr(9, 16), rr(16, 34), rr(0.2, 0.7)); }

  // --- pack leaves (36 bytes: 8 floats + 4 unorm8), sorted by culling cell
  const pack = (L, step = 1, wm = 1) => {
    let n = 0; const start = new Uint32Array(nCells + 1);
    for (let c = 0; c < nCells; c++) { start[c] = n; n += Math.ceil(L[c].length / 12 / step); }
    start[nCells] = n;
    const buf = new ArrayBuffer(max(n, 1) * 36), f = new Float32Array(buf), u8 = new Uint8Array(buf), lo = new Float32Array(nCells).fill(1e9), hi = new Float32Array(nCells).fill(-1e9);
    let k = 0;
    for (let c = 0; c < nCells; c++) { const a = L[c]; for (let i = 0; i < a.length; i += 12 * step, k++) {
      for (let j = 0; j < 8; j++) f[k * 9 + j] = a[i + j];
      f[k * 9 + 6] *= wm;
      u8[k * 36 + 32] = a[i + 8]; u8[k * 36 + 33] = a[i + 9] * 255; u8[k * 36 + 34] = a[i + 10] * 255; u8[k * 36 + 35] = a[i + 11] * 255;
      const y = a[i + 1], l = a[i + 3]; if (y - l < lo[c]) lo[c] = y - l; if (y + l > hi[c]) hi[c] = y + l;
    } }
    return { buf, n, start, lo, hi };
  };

  // --- half-res volume: r = openness (0.5 at the surface, 1 in the open)
  const hx = NX / 2, hy = NY / 2, hz = NZ / 2, volD = new Uint8Array(hx * hy * hz * 2);
  for (let z = 0; z < hz; z++) for (let y = 0; y < hy; y++) for (let x = 0; x < hx; x++) {
    const g0 = gi(x * 2, y * 2, z * 2), o = (x + hx * (y + hy * z)) * 2;
    const d = (D[g0] + D[g0 + 1] + D[g0 + NX] + D[g0 + NX + 1] + D[g0 + NX * NY] + D[g0 + NX * NY + 1] + D[g0 + NX * NY + NX] + D[g0 + NX * NY + NX + 1]) * 0.125;
    volD[o] = clamp(0.5 - d / 12, 0, 1) * 255; volD[o + 1] = 255;
  }
  const gm = new Uint8Array(512 * 512 * 4);

  // --- the ice ring (orbit radius, Kepler turn rate) and the wisps (orbit axis, radius)
  const fish = [];
  rseed(14);
  for (let i = 0; i < 7000; i++) { const r = rr(80, 124); if (r > 98 && r < 102) continue; fish.push(0, 0, 0, r, rnd(), sqrt(3.6 * R0 * R0 / (r * r * r)), rr(0.12, 0.5) * (rnd() < 0.05 ? 3 : 1), rnd()); }
  const mantas = [];
  for (let i = 0; i < 10; i++) mantas.push(...nrm3([rr(-1, 1), rr(-1, 1), rr(-1, 1)]), R0 + rr(12, 30), rnd() * TAU, rr(0.04, 0.09) * (rnd() < 0.5 ? -1 : 1), rr(0.8, 1.4), rnd());

  // --- drifting dust (also the seeds for the tail)
  const snow = new Float32Array(9000 * 4);
  for (let i = 0; i < snow.length; i++) snow[i] = rnd();

  const sol = { data: [], ranges: [] }; let si = 0;
  for (let m = 0; m < 28; m++) { const a = solids[m] || []; sol.ranges.push([si, a.length / 12]); si += a.length / 12; for (let i = 0; i < a.length; i++) sol.data.push(a[i]); }
  const packC = (L) => {
    let n = 0; const start = new Uint32Array(nCells + 1);
    for (let c = 0; c < nCells; c++) { start[c] = n; n += L[c].length / 12; }
    start[nCells] = n;
    const data = new Float32Array(max(n, 1) * 12), lo = new Float32Array(nCells).fill(1e9), hi = new Float32Array(nCells).fill(-1e9);
    let k = 0;
    for (let c = 0; c < nCells; c++) { const a = L[c]; for (let i = 0; i < a.length; i += 12) { for (let j = 0; j < 12; j++) data[k++] = a[i + j]; lo[c] = min(lo[c], a[i + 1] - 8); hi[c] = max(hi[c], a[i + 1] + 8); } }
    return { data, n, start, lo, hi };
  };
  return { at, glints: new Float32Array(glints), chunks: chunks.map(packC), props: props.map(packC), big: pack(big), bigF: pack(big, 2, 1.5), small: pack(small), solids: { data: new Float32Array(sol.data), ranges: sol.ranges }, bubbles: new Float32Array(bubbles), volD, gm, fish: new Float32Array(fish), mantas: new Float32Array(mantas), snow };
}
const fract = (x) => x - floor(x);

// ---------------------------------------------------------------- procedural meshes
// lumpy rock with a few dents
function meshRock(sd, sub = 2) {
  if (LV > 1 && sub > 1) sub--;
  rseed(100 + sd);
  const cr = []; for (let i = 0; i < 4; i++) { const q = qRand(), l = hypot(q[0], q[1], q[2]) || 1; cr.push([q[0] / l, q[1] / l, q[2] / l, rr(0.72, 0.9)]); }
  return icosphere(sub, (x, y, z) => {
    let r = 1 + (fbm(x * 1.3 + sd, y * 1.3, z * 1.3, 3) - 0.5) * 1.1;
    for (const c of cr) { const d = x * c[0] + y * c[1] + z * c[2]; if (d > c[3]) r -= (d - c[3]) * 2.2; }
    return [x * r, y * r * 0.78, z * r];
  });
}
// cluster of six-sided crystals with flat faces; aux = height along the crystal (0 base, 1 tip)
function meshCrystal(sd, n, tall) {
  rseed(300 + sd);
  const m = new Mesh();
  const nrm = (v) => { const l = hypot(...v) || 1; return v.map((c) => c / l); };
  for (let i = 0; i < n; i++) {
    const first = i === 0, d = nrm(first ? [rr(-0.12, 0.12), 1, rr(-0.12, 0.12)] : [rr(-1, 1), rr(0.5, 1.3), rr(-1, 1)]);
    const L = (first ? 1 : rr(0.3, 0.75)) * (tall ? 2.6 : 1.1), r = L * (tall ? 0.085 : 0.17) * rr(0.8, 1.2), ph = rnd() * TAU;
    const bx = first ? 0 : rr(-0.22, 0.22), bz = first ? 0 : rr(-0.22, 0.22);
    const t = nrm(abs(d[1]) < 0.9 ? [d[2], 0, -d[0]] : [1, 0, 0]), b = [d[1] * t[2] - d[2] * t[1], d[2] * t[0] - d[0] * t[2], d[0] * t[1] - d[1] * t[0]];
    const P = (a, h, rs) => [bx + d[0] * h * L + (t[0] * cos(a) + b[0] * sin(a)) * r * rs, d[1] * h * L - 0.1 + (t[1] * cos(a) + b[1] * sin(a)) * r * rs, bz + d[2] * h * L + (t[2] * cos(a) + b[2] * sin(a)) * r * rs];
    const tip = [bx + d[0] * L, d[1] * L - 0.1, bz + d[2] * L];
    for (let s = 0; s < 6; s++) {
      const a0 = ph + s / 6 * TAU, a1 = ph + (s + 1) / 6 * TAU;
      m.quad(m.v(...P(a0, 0, 1), 0), m.v(...P(a1, 0, 1), 0), m.v(...P(a1, 0.78, 0.9), 0.78), m.v(...P(a0, 0.78, 0.9), 0.78));
      m.tri(m.v(...P(a0, 0.78, 0.9), 0.78), m.v(...P(a1, 0.78, 0.9), 0.78), m.v(...tip, 1));
    }
  }
  return m;
}
// ring gate: a smooth torus on a round two-step plinth; the membrane inside has aux = -1
function meshGate() {
  const m = new Mesh(), R = 8.5, cy = R + 0.6, pts = [];
  for (let i = 0; i <= 96; i++) { const a = i / 96 * TAU; pts.push([cos(a) * R, cy + sin(a) * R, 0]); }
  m.tube(pts, 1.15, 18, false, () => 1);
  m.tube([[0, -1.6, 0], [0, -0.25, 0]], 6.4, 40, true, () => 1);
  m.tube([[0, -0.25, 0], [0, 0.45, 0]], 4.3, 40, true, () => 1);
  const c0 = m.v(0, cy, 0, -1), ring = [];
  for (let i = 0; i < 64; i++) { const a = i / 64 * TAU; ring.push(m.v(cos(a) * (R - 0.9), cy + sin(a) * (R - 0.9), 0, -1)); }
  for (let i = 0; i < 64; i++) m.tri(c0, ring[i], ring[(i + 1) % 64]);
  return m;
}
// wisp: a smooth ball of light
function meshWisp() { return icosphere(3, (x, y, z) => [x * 0.5, y * 0.5, z * 0.5]); }
function meshDart() {
  const m = new Mesh(), a = m.v(0.5, 0, 0), b = m.v(-0.5, 0, 0), r = [m.v(-0.1, 0.09, 0), m.v(-0.1, 0, 0.09), m.v(-0.1, -0.09, 0), m.v(-0.1, 0, -0.09)];
  for (let i = 0; i < 4; i++) { m.tri(a, r[i], r[(i + 1) % 4]); m.tri(b, r[(i + 1) % 4], r[i]); }
  return m;
}
function meshLathe(prof, seg, lump, ribs = 0) {
  const m = new Mesh(), rings = [];
  for (const [r, h, ao] of prof) { const ring = []; for (let s = 0; s < seg; s++) { const a = s / seg * TAU, rl = r * (1 + lump * (fbm(cos(a) * 1.5 + h * 2, h * 3, sin(a) * 1.5, 2) - 0.5) + 0.07 * cos(ribs * a + h * 1.5)); ring.push(m.v(cos(a) * rl, h, sin(a) * rl, ao)); } rings.push(ring); }
  for (let k = 0; k < rings.length - 1; k++) for (let s = 0; s < seg; s++) { const s2 = (s + 1) % seg; m.quad(rings[k][s], rings[k + 1][s], rings[k + 1][s2], rings[k][s2]); }
  return m;
}
