// ============================================================================
// tile generator: everything that grows on one tile of the world (runs in the workers, see stream.js)
// ============================================================================
// A tile is TILE x TILE voxels of sea floor (48 m). It is built from a block of density samples that reaches MG
// voxels past its edges, so normals, skylight, collision and kelp shadows match the neighbours'. Every random
// choice is seeded from where it happens (the tile, or the 2.3 m cell a kelp column stands in): leaving and coming
// back builds the same place again.

let LV = 0, THIN = 1, FLOAT = 0, NAT = 0, POSES = [], flyPts = [];
// The original spread a fixed number of tries over all the terrain vertices of its one world (about NVW of them).
// A tile gets the same number of tries per vertex.
const NVW = 700000;
const KC = 2.3; // kelp columns stand one to a cell of this size

// --- hand-made dressing of the home region (world coordinates; far from home only the noise-driven rules apply)
const KELPZ = [[-32, -5, 13, 0.85], [0, -86, 46, 1], [72, -26, 27, 0.9], [-60, -4, 11, 0.8], [0, -36, 12, 0.55], [-17, -8, 6, 0.8], [15, -8, 6, 0.8], [-4, 120, 20, 0.4], [-45, -63, 15, 0.9], [62, -26, 12, 0.9], [-100, 70, 30, 0.8], [100, 60, 30, 0.8], [-95, -90, 32, 0.8], [105, -85, 30, 0.7]];
const NOKELP = [[-5, -106.5, 8], [4.6, -109.4, 10], [14.2, -112.3, 12], [-26, -100, 6], [-20.5, -101.7, 4.5], [-14.8, -104.5, 6], [-7.5, -107.8, 7], [4, 112, 11], [2, 4, 15], [42, 22, 12], [6, 78, 19], [-58, -16, 8], [9, -66, 9], [8, -76, 8]];
const kelpDens = (x, z) => {
  for (const p of NOKELP) if (hypot(x - p[0], z - p[1]) < p[2]) return 0;
  let d = sstep(0.52, 0.64, fbm(x * 0.022, 4, z * 0.022, 3)) * 0.5;
  for (const p of KELPZ) d = max(d, p[3] * sstep(p[2], p[2] * 0.75, hypot(x - p[0], z - p[1])));
  return d * sstep(-100, -65, seaBase(x)); // kelp needs light: none below about 90 m
};
const HOT = [[0, 5, 30], [42, 30, 24], [6, 82, 34], [-58, 10, 24], [4, -88, 30], [-36, 44, 18], [-46, -60, 20]];
const hot = (x, z) => { let h = 0.4; for (const p of HOT) h = max(h, sstep(p[2], p[2] * 0.4, hypot(x - p[0], z - p[1]))); return h; };
const ZS = [[-58, 8, 30, 1], [0, 0, 30, 0.7], [6, 84, 36, 0.9], [4, -88, 22, 0.6], [44, 20, 24, 0.5]];
const zw = (x, z) => { let h = 0.45; for (const p of ZS) h = max(h, p[3] * sstep(p[2], p[2] * 0.4, hypot(x - p[0], z - p[1]))); return h; };
// dense sponge / coral gardens: x, z, radius, count
const GARDENS = [[-68, -6, 9, 260], [-66, 6, 7, 160], [16, 72, 7, 200], [-6, 74, 6, 120], [-13, -2, 6, 80], [8, -88, 8, 160], [44, 12, 7, 120], [-62, 22, 6, 140], [-47, 40, 6, 140], [-30, 47, 6, 120], [-12, 48, 5, 100], [14, 28, 6, 140], [28, 45, 6, 120], [-36, -76, 6, 130], [-49, -58, 6, 130], [-58, -38, 6, 120]];
// floating boulder clusters: x, y, z, count, radius
const BOULD = [[-11, -11, -105, 14, 5], [-56, -19, -18, 18, 6], [10, -13, -88, 22, 7], [24, -15, -24, 22, 7], [-18, -12, 4, 14, 6], [30, -14, 30, 16, 6], [36, -12, -70, 22, 8], [-30, -13, -84, 16, 7], [-58, -14, 0, 14, 6], [19, -13, 98, 18, 6], [62, -9, 34, 14, 6]];
const VENTS = [[4, -44, -3], [4.5, -44, -3.5], [-1, -44, 2], [2, -44, -1], [5.5, -44, -7], [3, -44, -9], [6, -44, -90], [8, -44, -84], [4, -44, -93], [-9, -44, 3], [5, -35, -86], [9, -37, -92], [40, -44, 20], [-56, -44, 12], [10, -44, 80], [-2, -44, 30], [0, -44, -30], [12, -44, 2], [6, -44, -2], [46, -44, 30], [-20, -44, -103], [-52, -44, -12], [4, -44, 70], [9, -44, -74], [4, -44, -78], [14, -44, 26], [26, -44, 40], [-45, -44, -64], [-55, -44, -40], [-58, -44, 22], [-40, -44, 40], [-14, -44, 45], [-1, -44, -9], [-7, -44, -6]];
// fish schools: x, y, z, radius, count, size, direction, (seed)
const SCH = [[-2, -36, -10, 15, 520, 0.3, 1, 0.945], [8, -30, -70, 22, 420, 0.32, -1], [48, -30, 14, 18, 360, 0.3, 1], [-58, -30, -8, 11, 420, 0.28, -1, 0.3], [8, -36, 84, 16, 320, 0.28, 1],
  [-90, -28, -70, 25, 300, 0.3, 1], [95, -30, 70, 25, 300, 0.3, -1], [0, -22, 20, 30, 380, 0.34, -1], [-30, -30, -100, 18, 300, 0.3, 1], [16, -36, 30, 12, 300, 0.3, 1], [-48, -34, -58, 12, 300, 0.3, -1], [-45, -35, 38, 14, 320, 0.3, 1]];
const MANTAS = [[1, -28, 3.5, 14, 3.012, 0.085, 3.6, 0.1], [49, -31, 24.5, 5, 0.029, -0.08, 3.7, 0.4], [0, -14, -80, 34, 0.3, 0.06, 5.2, 0.7], [-50, -18, 20, 26, 5, -0.075, 3.8, 0.55], [10, -16, 86, 26, 2.2, 0.07, 4.4, 0.85], [20, -11, -20, 46, 4.2, -0.045, 5.6, 0.25]];
const HOME = 215; // tiles further than this from the origin get their fish, mantas and floating boulders from the tile's own dice
const rel = (i, f, r) => { const p = POSES[i]; let fx = p[3] - p[0], fz = p[5] - p[2]; const l = hypot(fx, fz); fx /= l; fz /= l; return [p[0] + fx * f - fz * r, p[2] + fz * f + fx * r]; };
// hand-placed kelp columns framing the viewpoints, by the cell they stand in: x, z, kind, density
let HANDCOL = null;
const handColumns = () => {
  HANDCOL = new Map();
  for (const p of [[...rel(0, 11, -8.5), 0], [...rel(0, 16, -10.5), 0], [...rel(0, 21, -9), 0], [...rel(0, 9, 7), 0], [...rel(0, 14, 9.5), 0], [...rel(0, 19, 8), 0], [...rel(0, 26, 6), 0],
    [...rel(5, 6.5, 5.2), 1], [...rel(5, 12, 7), 1], [...rel(5, 15, -8), 0], [...rel(5, 22, -5), 1], [...rel(3, 12, -5.5), 0], [...rel(3, 16, 5.5), 0], [...rel(3, 20, -4.5), 0], [...rel(3, 25, 6), 0], [...rel(3, 13, 8), 0], [...rel(3, 30, -7), 0], [24, 62, 1], [-6, 96, 1], [20, 96, 2], [-10, 70, 0], [16, 52, 1],
    [...rel(4, 15, -9), 0, 1.2], [...rel(4, 19, -13), 0, 1.2], [...rel(4, 23, -8.5), 0, 1.2], [...rel(4, 25, -15), 0, 1.2],
    [...rel(4, 25, 0.5), 2, 1.2], [...rel(4, 27, -3), 2, 1.2], [...rel(4, 28, 3.5), 2, 1.2], [...rel(4, 31, 0), 0, 1.3], [...rel(4, 33, -5), 0, 1.3], [...rel(4, 33, 5), 0, 1.3], [...rel(4, 21, 9), 0, 1.2], [...rel(4, 27, 11), 0, 1.2],
    [...rel(2, 6.5, -5.5), 0, 1.5], [...rel(2, 9.5, -8), 0, 1.3], [...rel(2, 8, 6), 0, 1.4], [...rel(2, 12, 3.6), 0, 1.3], [...rel(2, 17, -2.5), 0, 1.2], [...rel(2, 21, 4), 0, 1.2], [...rel(2, 12, -4.5), 2, 1.2], [...rel(2, 27, -9), 0, 1.2], [...rel(2, 30, 8.5), 0, 1.2], [...rel(2, 37, -3), 0, 1.1],
    [...rel(2, 13.5, 6.5), 0, 1.3], [...rel(2, 14.5, -7), 0, 1.3], [...rel(2, 6.5, 6.5), 0, 1.3], [...rel(2, 9, -8), 2, 1.3]]) {
    const k = floor(p[0] / KC) + ',' + floor(p[1] / KC);
    if (!HANDCOL.has(k)) HANDCOL.set(k, p);
  }
};

// ---------------------------------------------------------------- one tile
// OY: the height of the block's lowest voxels (tileOY: the 60 m band of voxels follows the sea floor)
// ny: the block's height in voxels, when it is not the usual 80 (tileNY: the tall tiles of the rift)
function genTile(tx, tz, D, OY, ny) {
  const NY = ny || 80, tall = NY > 80;
  const BX = (tx * TILE - MG) * VS, BZ = (tz * TILE - MG) * VS;                 // corner of the block
  const X0 = tx * TW, Z0 = tz * TW, X1 = X0 + TW, Z1 = Z0 + TW;                  // the tile itself
  const XC = X0 + TW / 2, ZC = Z0 + TW / 2, nCells = SUB * SUB, SL = NT * NY;
  const gi = (x, y, z) => x + NT * (y + NY * z);
  const own = (x, z) => x >= X0 && x < X1 && z >= Z0 && z < Z1;
  const cellOf = (x, z) => clamp(floor((x - X0) / CELLW), 0, SUB - 1) + SUB * clamp(floor((z - Z0) / CELLW), 0, SUB - 1);
  const home = hypot(XC, ZC) < HOME, base = seaBase(XC), dk = deepK(XC), sk = shoreK(XC), pl = plainK(XC);
  // how deep-water the life at height y is: the tile's own figure, but down the rift's walls it rises to 1 within 90 m
  const dkAt = tall ? (y) => max(dk, clamp((base - 8 - y) / 90, 0, 1)) : () => dk;

  // rock connected to the seabed: each column's unbroken run up from the bottom is, and the rock above a gap
  // (overhangs, specks) is when it touches rock that is, or leaves the block. What never connects is a speck of noise
  // floating in the water (surface nets would make it a small box), so it becomes water
  {
    const R = new Uint8Array(D.length), b = new Uint8Array(NT), L = [];
    for (let i = 0, z = 0; z < NT; z++) {
      b.fill(1);
      for (let y = 0; y < NY; y++) for (let x = 0; x < NT; x++, i++) {
        if (D[i] <= 0) b[x] = 0; else if (b[x] || x === 0 || x === NT - 1 || z === 0 || z === NT - 1) R[i] = 1; else L.push(i);
      }
    }
    for (let k = 1; k; L.reverse()) { k = 0; for (const i of L) if (!R[i] && (R[i + 1] || R[i - 1] || R[i + NT] || R[i - NT] || R[i + SL] || R[i - SL])) R[i] = k = 1; }
    for (const i of L) if (!R[i]) D[i] = -D[i];
  }

  // --- terrain mesh: surface nets over the block, keeping the quads that belong to cubes of this tile
  const smp = sampler3(D, NT, NY, NT);
  const Dw = (x, y, z) => smp((x - BX) / VS, (y - OY) / VS, (z - BZ) / VS);
  let T;
  {
    const sn = surfaceNets(D, NT, NY, NT), gp = sn.pos, nqAll = sn.ni / 6;
    const mine = (k) => { const x = gp[k * 3] | 0, z = gp[k * 3 + 2] | 0; return x >= MG && x < MG + TILE && z >= MG && z < MG + TILE; };
    const map = new Int32Array(sn.nv).fill(-1); let nv = 0, nq = 0;
    for (let q = 0; q < nqAll; q++) if (mine(sn.idx[q * 6])) { nq++; for (let j = 0; j < 6; j++) { const v = sn.idx[q * 6 + j]; if (map[v] < 0) map[v] = nv++; } }
    const vb = new ArrayBuffer(nv * 16), vf = new Float32Array(vb), v8 = new Int8Array(vb);
    const wp = new Float32Array(nv * 3), wn = new Float32Array(nv * 3), core = new Uint32Array(nv); let nCore = 0;
    for (let v = 0; v < sn.nv; v++) {
      const k = map[v]; if (k < 0) continue;
      const x = gp[v * 3], y = gp[v * 3 + 1], z = gp[v * 3 + 2], e = 0.8;
      let nx = smp(x - e, y, z) - smp(x + e, y, z), ny = smp(x, y - e, z) - smp(x, y + e, z), nz = smp(x, y, z - e) - smp(x, y, z + e);
      const l = hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      wp[k * 3] = vf[k * 4] = BX + x * VS; wp[k * 3 + 1] = vf[k * 4 + 1] = OY + y * VS; wp[k * 3 + 2] = vf[k * 4 + 2] = BZ + z * VS;
      wn[k * 3] = nx; wn[k * 3 + 1] = ny; wn[k * 3 + 2] = nz;
      v8[k * 16 + 12] = round(nx * 127); v8[k * 16 + 13] = round(ny * 127); v8[k * 16 + 14] = round(nz * 127); v8[k * 16 + 15] = 127;
      if (mine(v)) core[nCore++] = k;
    }
    // bucket the quads into the tile's culling cells
    const key = new Uint8Array(nq), start = new Uint32Array(nCells + 1), lo = new Float32Array(nCells).fill(1e9), hi = new Float32Array(nCells).fill(-1e9);
    const quad = new Uint32Array(nq);
    for (let q = 0, n = 0; q < nqAll; q++) {
      if (!mine(sn.idx[q * 6])) continue;
      const a = map[sn.idx[q * 6]] * 3, c = cellOf(wp[a], wp[a + 2]);
      quad[n] = q; key[n++] = c; start[c + 1]++;
      for (let j = 0; j < 6; j++) { const y = wp[map[sn.idx[q * 6 + j]] * 3 + 1]; if (y < lo[c]) lo[c] = y; if (y > hi[c]) hi[c] = y; }
    }
    for (let c = 0; c < nCells; c++) start[c + 1] += start[c];
    const ib = new Uint32Array(nq * 6), fill = start.slice();
    for (let n = 0; n < nq; n++) { const o = fill[key[n]]++ * 6, q = quad[n] * 6; for (let j = 0; j < 6; j++) ib[o + j] = map[sn.idx[q + j]]; }
    T = { vb, ib, nv, wp, wn, core: core.subarray(0, nCore), start, lo, hi };
  }
  const rate = T.core.length / NVW; // tries per try of the original

  // --- instance stores
  const big = Array.from({ length: nCells }, () => []), small = Array.from({ length: nCells }, () => []);
  // Medium and Low keep every 2nd / 4th leaf (but every kelp stem), made wider; the random stream is the same
  let nth = 0, nrk = 0, npl = 0;
  // rocks scattered over the ground, and leaves (after the Plants setting's own thinning): all of them on High,
  // 3 of 4 on Medium, every 2nd on Low (the same ones, fewer)
  const part = (n) => (LV > 1 ? n & 1 : LV ? n & 3 : 1), rock = () => part(nrk++);
  const leaf = (L, x, y, z, len, yaw, tilt, wid, hA, type, s1, s2, bend) => { if (type === 1 || (!(nth++ % THIN) && part(npl++))) L[cellOf(x, z)].push(x, y, z, len, yaw, tilt, type === 1 ? wid : wid * (1 + Math.log2(THIN) / 2), hA, type, s1, s2, bend); };
  const glints = [];
  const glint = (...a) => { nth++ % THIN || glints.push(...a); };
  const solids = []; // per mesh id: arrays of 12 floats
  const props = Array.from({ length: 6 }, () => Array.from({ length: nCells }, () => []));
  // What a creature can hide behind although one swims straight through it: the loose boulders, the kelp, the ship.
  // 4 floats each: x, y, z and the radius of a ball; for a column of kelp the radius is minus its height (from y up).
  // It is only looked at by hunters (botSees, bots.js): nothing collides with any of it.
  const cover = [];
  const solid = (mesh, x, y, z, sc, q, mat, seed, ts = 1, bob = 0) => { if (mesh < 4 && sc >= 0.8) cover.push(x, y, z, sc * 0.85); (mesh > 3 && mesh < 10 ? props[mesh - 4][cellOf(x, z)] : (solids[mesh] ||= [])).push(x, y, z, sc, q[0], q[1], q[2], q[3], mat, seed, ts, bob); };
  const chunks = Array.from({ length: NCHUNK }, () => Array.from({ length: nCells }, () => []));
  const bubbles = [], HN = NT / 2, kelpAbs = new Float32Array(HN * (NY / 2) * HN);

  // --- surface queries
  const fl = [];
  const floorsAt = (x, z) => {
    const ix = clamp(round((x - BX) / VS), 1, NT - 2), iz = clamp(round((z - BZ) / VS), 1, NT - 2);
    fl.length = 0; let ceil = 3;
    for (let gy = NY - 2; gy >= 0; gy--) {
      const d = D[gi(ix, gy, iz)], da = D[gi(ix, gy + 1, iz)];
      if (da <= 0 && d > 0) { const y = OY + (gy + d / (d - da)) * VS; fl.push(y, min(ceil, 0) - y); } else if (da > 0 && d <= 0) ceil = OY + (gy + 0.5) * VS;
    }
    return fl;
  };
  const grad = (x, y, z) => {
    const e = 0.6; let nx = Dw(x - e, y, z) - Dw(x + e, y, z), ny = Dw(x, y - e, z) - Dw(x, y + e, z), nz = Dw(x, y, z - e) - Dw(x, y, z + e);
    const l = hypot(nx, ny, nz) || 1; return [nx / l, ny / l, nz / l];
  };
  // march from outside along -n to the surface
  const snap = (x, y, z, n) => {
    let px = x + n[0] * 2.5, py = y + n[1] * 2.5, pz = z + n[2] * 2.5, prev = Dw(px, py, pz);
    if (prev > 0) return null;
    for (let i = 0; i < 24; i++) {
      const qx = px - n[0] * 0.25, qy = py - n[1] * 0.25, qz = pz - n[2] * 0.25, d = Dw(qx, qy, qz);
      if (d > 0) { const t = prev / (prev - d); const p = [mix(px, qx, t), mix(py, qy, t), mix(pz, qz, t)]; return p.concat(grad(p[0], p[1], p[2])); }
      px = qx; py = qy; pz = qz; prev = d;
    }
    return null;
  };
  const gy = (x, z) => { const f = floorsAt(x, z); return f.length ? f[f.length - 2] : -45; };
  // a random terrain vertex of this tile (every vertex of the world belongs to exactly one tile)
  const pickV = () => T.core[(rnd() * T.core.length) | 0] * 3;
  const tangent = (n) => { let t = abs(n[1]) < 0.9 ? [n[2], 0, -n[0]] : [1, 0, 0]; const l = hypot(...t); t = t.map((v) => v / l); return [t, [n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0]]]; };
  // the scripted camera path and the viewpoints are kept clear; only the ones near this tile matter here
  const fly = flyPts.filter((p) => p[0] > X0 - 22 && p[0] < X1 + 22 && p[2] > Z0 - 22 && p[2] < Z1 + 22);
  const poses = POSES.filter((p) => p[0] > X0 - 22 && p[0] < X1 + 22 && p[2] > Z0 - 22 && p[2] < Z1 + 22);
  const nearFly = (x, y, z, r) => { for (const p of fly) if (hypot(x - p[0], z - p[2]) < r && y < p[1] + 3 && y > p[1] - 13) return true; return false; };
  const nearPose = (x, z, r = 3) => { for (const p of poses) if (hypot(x - p[0], z - p[2]) < r) return true; return false; };
  const tries = (n) => { const f = n * rate, k = floor(f); return k + (rnd() < f - k ? 1 : 0); };
  // share of a disc (x, z, r) that lies on this tile, from 256 points of a fixed pattern
  const share = (x, z, r) => { if (x + r < X0 || x - r > X1 || z + r < Z0 || z - r > Z1) return 0; let n = 0; for (let i = 0; i < 256; i++) { const a = i * 2.39996, q = sqrt((i + 0.5) / 256) * r; if (own(x + cos(a) * q, z + sin(a) * q)) n++; } return n / 256; };

  // --- kelp columns
  const column = (x, y, z, H, kind, dens, mine) => {
    if (mine) {
      const strands = 2 + (rnd() < 0.6) + (rnd() < 0.3), ph = rnd() * TAU, tw = rr(0.1, 0.28), sr = rr(0.2, 0.55), sc = rr(0.75, 1.25);
      const la = rnd() * TAU, lm = rr(0, 0.11), full = rr(0.55, 1.3) * dens;
      const stem = (s, h) => { const a = ph + s * TAU / strands + h * tw, r = sr * (1 - 0.6 * h / H), ln = lm * h * h / H; return [x + cos(a) * r + cos(la) * ln, z + sin(a) * r + sin(la) * ln, a]; };
      for (let s = 0; s < strands; s++) for (let h = 0; h < H - 1; h += 1.7) { const p = stem(s, h); leaf(big, p[0], y + h, p[1], 2.1, p[2] + PI / 2, 0.1, 0.17, h, 1, rnd(), rnd(), 0.3); }
      const n = floor(H * 30 * full);
      for (let i = 0; i < n; i++) {
        const t = pow(rnd(), 0.9), h = t * H, p = stem((rnd() * strands) | 0, h);
        const L = ((0.55 + 0.75 * rnd() * rnd()) * (1 - 0.5 * t * t) * sc + 0.25) * (kind === 1 ? 1.25 : 1.15);
        const tilt = mix(rr(0.4, 1.0), rr(0.15, 0.45), t);
        const type = kind === 1 ? (rnd() < 0.8 ? 3 : 4) : kind === 2 ? (rnd() < 0.5 ? 4 : 0) : 0;
        leaf(big, p[0], y + h, p[1], L, rnd() * TAU, tilt, L * (kind === 1 ? rr(0.09, 0.13) : rr(0.15, 0.21)) + 0.03, h, type, rnd(), rnd(), rr(0.38, 0.95));
      }
      for (let i = floor(H * (kind === 1 ? 16 : 13)); i > 0; i--) { const h = rnd() * H, a = rnd() * TAU, r = rr(0.15, 0.8) * (1 - 0.5 * h / H), ln = lm * h * h / H; glint(x + cos(a) * r + cos(la) * ln, y + h, z + sin(a) * r + sin(la) * ln, h, rnd(), kind === 1 ? rnd() : rnd() * 0.6, rr(0.018, 0.05), 0); }
    }
    // light absorption footprint for the skylight bake (also of the neighbours' columns that stand in the margin)
    const hx = round((x - BX) / VS / 2), hz = round((z - BZ) / VS / 2);
    for (let hy = floor((y - OY) / VS / 2); hy <= floor((y + H - OY) / VS / 2); hy++) {
      if (hy >= 0 && hy < NY / 2 && hx >= 0 && hx < HN && hz >= 0 && hz < HN) kelpAbs[hx + HN * (hy + NY / 2 * hz)] += 0.17;
    }
  };
  const tryColumn = (x, z, kind, force, dens) => {
    const f = floorsAt(x, z); const c = [];
    for (let i = 0; i < f.length; i += 2) if (f[i + 1] > 9) c.push(i);
    if (!c.length) return;
    const i = c[(rnd() * c.length) | 0], y = f[i], room = f[i + 1];
    if (grad(x, y, z)[1] < 0.55) return;
    if (!force && fly.some((p) => hypot(x - p[0], z - p[2]) < 5)) return;
    const H = min(room - rr(0.8, 5), force ? rr(30, 42) : rr(15, 40));
    if (own(x, z)) cover.push(x, y, z, -H);
    column(x, y - 0.3, z, H, kind, dens, own(x, z));
  };
  // each cell rolls its own dice, so this tile and its neighbours agree on the columns along their border
  for (let cz = floor((BZ + 1.5) / KC), cz1 = floor((BZ + (NT - 1) * VS - 1.5) / KC); cz <= cz1; cz++) for (let cx = floor((BX + 1.5) / KC), cx1 = floor((BX + (NT - 1) * VS - 1.5) / KC); cx <= cx1; cx++) {
    seedAt(cx, cz, 1);
    const h = HANDCOL.get(cx + ',' + cz);
    if (h) { tryColumn(h[0], h[1], h[2], true, h[3] || 1); continue; }
    const x = (cx + rnd()) * KC, z = (cz + rnd()) * KC;
    if (rnd() >= 1 - exp(-0.87 * kelpDens(x, z))) continue;
    if (tall && abs(x - riftX(z)) < 34) continue; // kelp stands on the rift's rims, not down in it
    tryColumn(x, z, zoneP(x, z) > 0.5 && rnd() < 0.5 ? 1 : rnd() < 0.03 ? 2 : 0, false, 1);
  }

  // --- clusters of ribbon leaves on the ground
  const meadow = (x, z) => sstep(0.5, 0.62, fbm(x * 0.05, 21, z * 0.05, 2)); // where the sea grass of the natural colours grows
  const cluster = (x, y, z, n, type, lmin, lmax, wmin, wmax, tmax, sway) => {
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU, r = rnd() * 0.5, L = rr(lmin, lmax);
      leaf(big, x + cos(a) * r, y - 0.15, z + sin(a) * r, L, a, rr(0.05, tmax), rr(wmin, wmax), sway, type, rnd(), rnd(), rr(0.3, 0.8));
    }
  };
  if (T.core.length) {
    seedAt(tx, tz, 3);
    for (let i = tries(40000); i > 0; i--) {
      const k = pickV(), x = T.wp[k], y = T.wp[k + 1], z = T.wp[k + 2], ny = T.wn[k + 1];
      if (y > -6) continue;
      const h = max(hot(x, z), 1.5 * sk) * (1 - 0.92 * pl) * (1 - 0.5 * dkAt(y)), zp = zoneP(x, z) * (1 - pl), u = rnd();
      if (nearFly(x, y, z, 4) || hypot(x + 1, z - 2) < 9 || nearPose(x, z, 8)) continue;
      if (ny > 0.75 && u < 0.10 * h) cluster(x, y, z, 8 + rnd() * 14 | 0, 2, 1.0, 3.0, 0.13, 0.26, 0.6, 2.5);
      else if (ny > 0.6 && u < 0.10 * h + 0.07 * max(zp, h * 0.4)) cluster(x, y, z, 10 + rnd() * 18 | 0, rnd() < 0.8 ? 3 : 4, 0.9, 2.6, 0.14, 0.28, 0.9, 1.5);
      else if (ny < -0.35 && u < 0.5 * max(zp, 0.2)) { // hanging fronds
        const n = 12 + rnd() * 20 | 0;
        for (let j = 0; j < n; j++) leaf(big, x + rr(-0.6, 0.6), y + 0.2, z + rr(-0.6, 0.6), rr(0.8, 3.2), rnd() * TAU, PI - rr(0, 0.4), rr(0.08, 0.18), 0, zp > 0.3 || rnd() < 0.5 ? 6 : 0, rnd(), rnd(), rr(0.3, 0.6));
      } else if (ny > -0.2 && ny < 0.8 && u < 0.07) { // wall tufts
        const yaw = atan2(T.wn[k + 2], T.wn[k]), n = 5 + rnd() * 7 | 0;
        for (let j = 0; j < n; j++) leaf(big, x, y, z, rr(0.5, 1.4), yaw + rr(-0.9, 0.9), rr(0.3, 1.1), rr(0.06, 0.12), 0.5, zp > 0.4 && rnd() < 0.6 ? 3 : 0, rnd(), rnd(), rr(0.2, 0.6));
      } else if (NAT && ny > 0.8 && u > 0.985 && meadow(x, z) > 0.3) cluster(x, y, z, 4 + rnd() * 6 | 0, 8, 1.6, 3.6, 0.1, 0.16, 0.22, 2.2); // (natural colours: tall green ribbons in the sea grass)
    }
    // --- ground cover: dense carpets of small tufts in the magenta patches (45 tries per square metre of a patch)
    seedAt(tx, tz, 4);
    for (const p of MAGENTA) {
      const ax = max(X0, p[0] - p[2]), bx = min(X1, p[0] + p[2]), az = max(Z0, p[1] - p[2]), bz = min(Z1, p[1] + p[2]);
      if (ax >= bx || az >= bz) continue;
      for (let i = (bx - ax) * (bz - az) * 45; i > 0; i--) {
        const x = rr(ax, bx), z = rr(az, bz);
        if (hypot(x - p[0], z - p[1]) > p[2] || rnd() > magAt(x, z) + 0.12 || nearPose(x, z)) continue;
        const f = floorsAt(x, z); if (!f.length) continue;
        const y = f[f.length - 2]; if (grad(x, y, z)[1] < 0.7) continue;
        const nl = 2 + (rnd() * 3 | 0), yw = rnd() * TAU;
        for (let j = 0; j < nl; j++) leaf(small, x, y - 0.03, z, rr(0.08, 0.26), yw + j * TAU / nl + rr(-0.4, 0.4), rr(0.15, 0.85), rr(0.035, 0.07), 0, 5, rnd(), rnd(), rr(0.3, 0.7));
        if (rnd() < 0.3) for (let j = 0; j < 2; j++) leaf(small, x + rr(-0.2, 0.2), y - 0.04, z + rr(-0.2, 0.2), rr(0.2, 0.55), rnd() * TAU, rr(0.05, 0.6), rr(0.03, 0.06), 0, 7, rnd(), rnd(), rr(0.3, 0.8));
        if (rnd() < 0.3) glint(x, y + rr(0.08, 0.22), z, 0, rnd(), 0.82 + rnd() * 0.18, rr(0.01, 0.02), 0);
      }
    }
    seedAt(tx, tz, 5);
    for (let i = tries(620000); i > 0; i--) {
      const k = pickV(), ny = T.wn[k + 1];
      if (ny < 0.72) continue;
      const x = T.wp[k] + rr(-0.45, 0.45), z = T.wp[k + 2] + rr(-0.45, 0.45), y = T.wp[k + 1];
      if (y > -1.5 || nearPose(x, z)) continue;
      const m = magAt(x, z) * (1 - 0.85 * pl), zp = max(zoneP(x, z), 0.7 * sk) * (1 - pl), u = rnd();
      if (m > 0.3 && u < m * 0.9) for (let j = 0; j < 4; j++) leaf(small, x + rr(-0.1, 0.1), y - 0.05, z + rr(-0.1, 0.1), rr(0.12, 0.34), rnd() * TAU, rr(0.05, 0.75), rr(0.04, 0.08), 0, 5, rnd(), rnd(), rr(0.3, 0.7));
      else if (u < m * 0.9 + 0.5 * max(zp, hot(x, z)) * sstep(0.42, 0.6, fbm(x * 0.09, 9, z * 0.09, 2))) for (let j = 0; j < 3; j++) leaf(small, x + rr(-0.1, 0.1), y - 0.05, z + rr(-0.1, 0.1), rr(0.25, 0.7), rnd() * TAU, rr(0.1, 0.8), rr(0.05, 0.1), 0, 7, rnd(), rnd(), rr(0.3, 0.8));
      else if (NAT && u > 0.9 && rnd() < meadow(x, z)) for (let j = 0; j < 3; j++) leaf(small, x + rr(-0.12, 0.12), y - 0.05, z + rr(-0.12, 0.12), rr(0.3, 0.9), rnd() * TAU, rr(0.03, 0.3), rr(0.035, 0.06), 0, 8, rnd(), rnd(), rr(0.2, 0.5)); // (natural colours: meadows of sea grass on the sand)
    }
  }

  // --- sponges and coral (clustered on rock)
  const spots = [];
  if (T.core.length) {
    seedAt(tx, tz, 6);
    for (let i = tries(13000); i > 0; i--) {
      const k = pickV(), x = T.wp[k], y = T.wp[k + 1], z = T.wp[k + 2];
      if (y > -5 || T.wn[k + 1] < -0.15 || rnd() > max(zw(x, z), 0.9 * sstep(0.1, 0.4, sk) * sstep(1, 0.7, sk)) * (1 - 0.8 * pl) * (1 - 0.4 * dkAt(y) - (tall ? 0.45 * dkAt(y) : 0)) || nearFly(x, y, z, 3)) continue;
      const n0 = [T.wn[k], T.wn[k + 1], T.wn[k + 2]], [t1, t2] = tangent(n0), coral = T.wn[k + 1] > 0.85 || rnd() < 0.35, cnt = coral ? 2 + rnd() * 5 | 0 : 3 + rnd() * 9 | 0, sd = rnd();
      for (let j = 0; j < cnt; j++) {
        const a = rr(-1, 1) * (0.5 + cnt * 0.13), b = rr(-1, 1) * (0.5 + cnt * 0.13);
        const s = snap(x + t1[0] * a + t2[0] * b, y + t1[1] * a + t2[1] * b, z + t1[2] * a + t2[2] * b, n0);
        if (!s) continue;
        let ux = s[3], uy = s[4] + (coral ? 0.9 : 1.1), uz = s[5]; const l = hypot(ux, uy, uz); ux /= l; uy /= l; uz /= l;
        const q = qMul(qFromY(ux, uy, uz), qAxis(0, 1, 0, rnd() * TAU)), sc = coral ? rr(0.5, 1.5) : rr(0.35, 0.9) * (rnd() < 0.1 ? 1.6 : 1);
        solid(coral ? 7 + (rnd() * 3 | 0) : 4 + (rnd() * 3 | 0), s[0] - ux * 0.12 * sc, s[1] - uy * 0.12 * sc, s[2] - uz * 0.12 * sc, sc, q, coral ? 5 : 4, fract(sd + rr(-0.03, 0.03)), 1, 0);
      }
      if (!coral && rnd() < 0.3) spots.push([x + n0[0], y + n0[1] + 0.5, z + n0[2]]);
    }
    // dense sponge / coral gardens: this tile's share of each
    seedAt(tx, tz, 7);
    for (const g of GARDENS) {
      const goal = round(g[3] * share(g[0], g[1], g[2])); let made = 0;
      for (let i = 0; i < 60000 && made < goal; i++) {
        const k = pickV(), x = T.wp[k], y = T.wp[k + 1], z = T.wp[k + 2];
        if (hypot(x - g[0], z - g[1]) > g[2] || y > -14 || T.wn[k + 1] < -0.1 || nearFly(x, y, z, 2.2)) continue;
        made++;
        const coral = T.wn[k + 1] > 0.85 || rnd() < 0.3, nx = T.wn[k], ny = T.wn[k + 1] + (coral ? 0.9 : 1.1), nz = T.wn[k + 2], l = hypot(nx, ny, nz);
        const sc = coral ? rr(0.5, 1.4) : rr(0.35, 0.9) * (rnd() < 0.15 ? 1.7 : 1);
        solid(coral ? 7 + (rnd() * 3 | 0) : 4 + (rnd() * 3 | 0), x - nx / l * 0.1 * sc, y - ny / l * 0.1 * sc, z - nz / l * 0.1 * sc, sc, qMul(qFromY(nx / l, ny / l, nz / l), qAxis(0, 1, 0, rnd() * TAU)), coral ? 5 : 4, rnd(), 1, 0);
      }
    }
  }
  // --- rocks: floating boulder clusters + scattered ground rocks
  {
    const cl = [];
    if (!FLOAT) ; // (World: Floating rocks is off)
    else if (home) { BOULD.forEach((b, i) => { if (own(b[0], b[2])) cl.push([b, i]); }); }
    else { seedAt(tx, tz, 8); if (rnd() < 0.22) cl.push([[rr(X0, X1), min(base + rr(25, 36), -9), rr(Z0, Z1), 10 + rnd() * 12 | 0, rr(5, 9)], -1]); }
    for (const [b, i] of cl) {
      if (i >= 0) seedAt(i, 77, 8);
      for (let n = 0; n < b[3]; n++) {
        const sc = rnd() < 0.12 ? rr(1.8, 3.2) : rr(0.35, 1.5);
        const x = b[0] + rr(-1, 1) * b[4], y = b[1] + rr(-1, 1) * b[4] * 0.6, z = b[2] + rr(-1, 1) * b[4];
        const bob = rr(0.12, 0.4), sd = rnd(), q0 = qRand(), m0 = rnd() * 4 | 0, ok = Dw(x, y, z) <= -sc;
        if (ok) solid(m0, x, min(y, -2 - sc), z, sc, q0, 1, sd, 1, bob);
        if (sc > 1.1) for (let j = 0; j < 7; j++) { const m = rnd() * 4 | 0, ox = rr(-1.6, 1.6), oy = rr(-1.4, 1), oz = rr(-1.6, 1.6), s2 = rr(0.1, 0.35), q = qRand(); if (ok) solid(m, x + ox * sc, min(y, -2 - sc) + oy * sc, z + oz * sc, s2, q, 1, sd, 1, bob); }
      }
    }
  }
  if (T.core.length) {
    seedAt(tx, tz, 9);
    for (let i = tries(2600 * (1 - 0.8 * sk)); i > 0; i--) {
      const k = pickV(); if (T.wn[k + 1] < 0.7 || nearFly(T.wp[k], T.wp[k + 1], T.wp[k + 2], 6)) continue;
      const sc = rr(0.25, 1.3) * (rnd() < 0.1 ? 2 : 1);
      const m = rnd() * 4 | 0, q = qRand(), sd = rnd();
      if (rock()) solid(m, T.wp[k], T.wp[k + 1] + sc * 0.2, T.wp[k + 2], sc, q, 1, sd, 1, 0);
    }
    seedAt(tx, tz, 10);
    for (let i = tries(60000 * (1 - 0.85 * sk) * (1 - 0.5 * pl)); i > 0; i--) {
      const k = pickV(), x = T.wp[k], y = T.wp[k + 1], z = T.wp[k + 2], ny = T.wn[k + 1];
      if (y > -3 || (ny > 0.8 && rnd() < 0.6) || nearFly(x, y, z, 3.5)) continue;
      const sc = (0.35 + 2.1 * pow(rnd(), 2.6)) * (ny > 0.8 ? 0.5 : 1), q = qRand(), m = (sc > 1.15 ? 3 : 0) + (rnd() * 3 | 0), sd = rnd();
      if (!rock()) continue;
      if (sc >= 0.8) cover.push(x, y, z, sc * 0.85);
      chunks[m][cellOf(x, z)].push(x - T.wn[k] * sc * 0.3, y - ny * sc * 0.3, z - T.wn[k + 2] * sc * 0.3, sc, q[0], q[1], q[2], q[3], 1, sd, sc > 1.15 ? 0 : 96, 0);
    }
    seedAt(tx, tz, 11);
    // pebbles and rubble on the sea floor: sparse on the sand; on the plain they are nodules, lying in fields
    for (let i = tries(170000 * (1 - 0.8 * sk) * (1 + 1.2 * pl) * (NAT ? 1.5 : 1)); i > 0; i--) {
      const k = pickV(), x = T.wp[k] + rr(-0.4, 0.4), z = T.wp[k + 2] + rr(-0.4, 0.4), y = T.wp[k + 1];
      if (T.wn[k + 1] < 0.8 || nearFly(x, y, z, 1.3)) continue;
      if (pl > 0 && rnd() < pl * (1 - sstep(0.45, 0.6, fbm(x * 0.012, 33, z * 0.012, 2)))) continue;
      const sc = 0.05 + 0.3 * pow(rnd(), 2), q = qRand();
      nth++ % THIN || chunks[6][cellOf(x, z)].push(x, y - sc * 0.25, z, sc, q[0], q[1], q[2], q[3], 1, rnd(), 30, 0); // (30: they have no size left where their cells stop being drawn, main.js)
    }
  }
  // --- set pieces of the home region (each list is rolled whole, from its own seed; a tile keeps what stands on it)
  if (home) {
    if (own(-5, -4)) solid(10, -5, gy(-5, -4) - 0.6, -4, 1, qMul(qAxis(0, 1, 0, 1.2), qMul(qAxis(0, 0, 1, 0.16), qAxis(1, 0, 0, -0.3))), 2, 0.3, 1, 0);          // whale fluke
    if (own(59.5, 6)) for (let i = -2; i <= 2; i++) cover.push(59.5, -25, 6 + i * 7, 5.5); // the ship's hull: 34 m long, lying along z
    if (own(59.5, 6)) solid(11, SHIPAT[0], SHIPAT[1], SHIPAT[2], 1, SHIPQ, 3, 0.5, 1, 0); // ship hull
    // barrel sponges in front of viewpoint 4, small sponges around the fluke base
    rseed(12);
    for (const b of [[7, 3.2, 1.3, 4], [8.4, 4.6, 1.0, 6], [9.6, 2.6, 1.5, 4], [11, 5, 1.1, 5], [8, -3.6, 1.2, 4], [12.5, 2, 1.2, 6], [9, 3.9, 0.8, 4]]) {
      const p = rel(3, b[0], b[1]), c = POSES[3]; let ux = (c[0] - p[0]) * 0.07, uz = (c[2] - p[1]) * 0.07; const l = hypot(ux, 1, uz), sd = rnd();
      if (own(p[0], p[1])) solid(b[3], p[0], gy(p[0], p[1]) - 0.1, p[1], b[2], qFromY(ux / l, 1 / l, uz / l), 4, sd, 1, 0);
    }
    for (let i = 0; i < 9; i++) { const a = rnd() * TAU; const x = -5 + cos(a) * rr(1.2, 2.6), z = -4 + sin(a) * rr(1.5, 4), sc = rr(0.4, 0.9), ya = rnd() * 6, sd = rnd(); if (own(x, z)) solid(6, x, gy(x, z) + 0.05, z, sc, qAxis(0, 1, 0, ya), 4, sd, 1, 0); }
  }

  // --- bubbles
  {
    const vents = [];
    if (home) VENTS.forEach((v, i) => { if (own(v[0], v[2])) vents.push([v, i]); });
    seedAt(tx, tz, 13);
    for (const s of spots) if (rnd() < 0.28) vents.push([s, -1]);
    if (pl > 0) for (let cz = floor((Z0 - 20) / FC); cz <= floor((Z1 + 20) / FC); cz++) for (let cx = floor((X0 - 20) / FC); cx <= floor((X1 + 20) / FC); cx++) {
      for (const v of cellShapes(cx, cz).vents) if (own(v[0], v[2])) {
        seedAt(round(v[0] * 7), round(v[2] * 7), 16);
        vents.push([v, -2]);
        // a shimmer of sparks over the mouth, and tube worms around the foot
        for (let i = 0; i < 26; i++) glint(v[0] + rr(-0.8, 0.8), v[1] + rr(-0.5, 5) , v[2] + rr(-0.8, 0.8), 0, rnd(), 0.82 + rnd() * 0.18, rr(0.02, 0.05), 0);
        for (let i = 0; i < 7; i++) { const a = rnd() * TAU, d = rr(1.5, 4.5), x = v[0] + cos(a) * d, z = v[2] + sin(a) * d; solid(9, x, gy(x, z) - 0.1, z, rr(0.5, 1.1), qAxis(0, 1, 0, rnd() * TAU), 5, 0.02 + rnd() * 0.12, 1, 0); }
      }
    }
    for (const [v, vi] of vents) {
      if (vi >= 0) seedAt(vi, 78, 13);
      const n = 90 + rnd() * 70 | 0, y0 = v[1] === -44 ? gy(v[0], v[2]) : v[1];
      for (let i = 0; i < n; i++) {
        const sz = rnd() < 0.24 ? rr(0.1, 0.3) : rr(0.025, 0.08);
        bubbles.push(v[0] + rr(-0.3, 0.3), y0, v[2] + rr(-0.3, 0.3), sz, rnd(), rr(1.1, 2.4) * (0.6 + sz * 3), -y0 - 0.2, rr(0.05, 0.16));
      }
    }
  }

  // --- fish schools + mantas: the hand-placed ones at home, elsewhere wherever a tile's dice find open water
  const fish = [], mantas = [];
  // open water around a ring of radius r (and h up and down) at x, y, z
  const open = (x, y, z, r, h, need) => { if (Dw(x, y, z) > -need) return false; for (let i = 0; i < 12; i++) { const a = i * TAU / 12, d = Dw(x + cos(a) * r, y + (i & 1 ? h : -h), z + sin(a) * r * 0.75); if (d > -need) return false; } return true; };
  if (home) {
    SCH.forEach((s, i) => { if (!own(s[0], s[2])) return; seedAt(i, 79, 14); const ss = s[7] === undefined ? rnd() : s[7]; for (let n = 0; n < s[4]; n++) fish.push(s[0], s[1], s[2], s[3], rnd(), s[6] * 1.9 / s[3], s[5], ss); });
    for (const m of MANTAS) if (own(m[0], m[2])) mantas.push(...m);
  } else {
    seedAt(tx, tz, 14);
    if (rnd() < 0.55 * (1 - 0.82 * dk)) for (let t = 0; t < 14; t++) {
      const x = rr(X0, X1), z = rr(Z0, Z1), y = min(base + rr(8, 24), -6), R = rr(8, 11.5);
      if (!open(x, y, z, R, 2.5, 1.5)) continue;
      const n = (220 + rnd() * 260) * (1 - 0.55 * dk) | 0, dir = rnd() < 0.5 ? 1 : -1, sz = rr(0.27, 0.34), ss = rnd();
      for (let i = 0; i < n; i++) fish.push(x, y, z, R, rnd(), dir * 1.9 / R, sz, ss);
      break;
    }
    seedAt(tx, tz, 15);
    if (rnd() < 0.045 * (1 - dk)) for (let t = 0; t < 14; t++) {
      const x = rr(X0, X1), z = rr(Z0, Z1), y = min(base + rr(18, 34), -8), R = rr(8, 11);
      if (!open(x, y, z, R, 3.5, 3)) continue;
      mantas.push(x, y, z, R, rnd() * TAU, (rnd() < 0.5 ? 1 : -1) * rr(0.055, 0.085), rr(3.4, 5), rnd());
      break;
    }
  }

  // --- pack: one buffer per vertex format, each part sorted by culling cell
  // leaves (36 bytes: 8 floats + 4 unorm8): all, every 2nd wider (far), small
  const leafParts = [[big, 1, 1], [big, 2, 1.5], [small, 1, 1]], leafMeta = [];
  let nLeaf = 0;
  for (const [L, step] of leafParts) for (let c = 0; c < nCells; c++) nLeaf += Math.ceil(L[c].length / 12 / step);
  const leafBuf = new ArrayBuffer(nLeaf * 36), lf = new Float32Array(leafBuf), l8 = new Uint8Array(leafBuf);
  {
    let k = 0;
    for (const [L, step, wm] of leafParts) {
      const start = new Uint32Array(nCells + 1), lo = new Float32Array(nCells).fill(1e9), hi = new Float32Array(nCells).fill(-1e9);
      for (let c = 0; c < nCells; c++) {
        start[c] = k; const a = L[c];
        for (let i = 0; i < a.length; i += 12 * step, k++) {
          for (let j = 0; j < 8; j++) lf[k * 9 + j] = a[i + j];
          if (step === 1 && L === big && (i / 12 & 1)) lf[k * 9 + 6] *= -1; // marks the leaves the far set leaves out (see LODW in the leaf shader)
          l8[k * 36 + 32] = a[i + 8]; l8[k * 36 + 33] = a[i + 9] * 255; l8[k * 36 + 34] = a[i + 10] * 255; l8[k * 36 + 35] = a[i + 11] * 255;
          const y = a[i + 1], l = a[i + 3]; if (y - l < lo[c]) lo[c] = y - l; if (y + l > hi[c]) hi[c] = y + l;
        }
      }
      start[nCells] = k;
      leafMeta.push({ start, lo, hi });
    }
  }
  // solid instances (12 floats): rock chunks and pebbles, sponges and corals, then the set pieces by mesh id
  let nSol = 0;
  for (const L of chunks) for (const a of L) nSol += a.length / 12;
  for (const L of props) for (const a of L) nSol += a.length / 12;
  for (let m = 0; m < 12; m++) nSol += (solids[m] || []).length / 12;
  const solBuf = new Float32Array(nSol * 12), solMeta = { chunks: [], props: [], solids: [] };
  {
    let k = 0;
    const packC = (L) => {
      const start = new Uint32Array(nCells + 1), lo = new Float32Array(nCells).fill(1e9), hi = new Float32Array(nCells).fill(-1e9);
      for (let c = 0; c < nCells; c++) { start[c] = k; const a = L[c]; for (let i = 0; i < a.length; i += 12, k++) { for (let j = 0; j < 12; j++) solBuf[k * 12 + j] = a[i + j]; lo[c] = min(lo[c], a[i + 1] - 3); hi[c] = max(hi[c], a[i + 1] + 3); } }
      start[nCells] = k;
      return { start, lo, hi };
    };
    for (const L of chunks) solMeta.chunks.push(packC(L));
    for (const L of props) solMeta.props.push(packC(L));
    for (let m = 0; m < 12; m++) { const a = solids[m] || []; solMeta.solids.push(k, a.length / 12); solBuf.set(a, k * 12); k += a.length / 12; }
  }
  // 8-float instances: bubbles, glints, fish, mantas
  const miscBuf = new Float32Array(bubbles.length + glints.length + fish.length + mantas.length), miscMeta = [];
  { let k = 0; for (const a of [bubbles, glints, fish, mantas]) { miscBuf.set(a, k); miscMeta.push(k / 8, a.length / 8); k += a.length; } }

  // --- half-res volume of the tile: r = openness, g = skylight (worked out over the whole block, so that the
  // light coming down at a slant from over the neighbours is there). The block's layers start at OY, a whole number
  // of voxels; the texture's follow the smooth gridBase(x), so every column is resampled onto those.
  const VT = TILE / 2, hy = NY / 2, VL = 40, vol = new Uint8Array(VT * VL * VT * 2); // the texture has VL layers whatever the block's height
  {
    let Lp = new Float32Array(HN * HN).fill(1), Ln = new Float32Array(HN * HN), tmp = new Float32Array(HN * HN);
    const op = new Float32Array(VT * hy * VT), sky = new Float32Array(VT * hy * VT);
    for (let y = hy - 1; y >= 0; y--) {
      for (let z = 0; z < HN; z++) for (let x = 0; x < HN; x++) { const i = x + HN * z; tmp[i] = (Lp[x > 0 ? i - 1 : i] + 2 * Lp[i] + Lp[x < HN - 1 ? i + 1 : i]) * 0.25; }
      for (let z = 0; z < HN; z++) for (let x = 0; x < HN; x++) {
        const i = x + HN * z, b = (tmp[z > 0 ? i - HN : i] + 2 * tmp[i] + tmp[z < HN - 1 ? i + HN : i]) * 0.25;
        const g0 = gi(x * 2, y * 2, z * 2);
        const d = (D[g0] + D[g0 + 1] + D[g0 + NT] + D[g0 + NT + 1] + D[g0 + SL] + D[g0 + SL + 1] + D[g0 + SL + NT] + D[g0 + SL + NT + 1]) * 0.125;
        Ln[i] = b * clamp(0.5 - d / 1.5, 0, 1) * (1 - min(kelpAbs[x + HN * (y + hy * z)], 0.5));
        const vx = x - MG / 2, vz = z - MG / 2;
        if (vx >= 0 && vx < VT && vz >= 0 && vz < VT) { const o = vx + VT * (y + hy * vz); op[o] = clamp(0.5 - d / 12, 0, 1); sky[o] = min(1, b); }
      }
      const t = Lp; Lp = Ln; Ln = t;
    }
    for (let vx = 0; vx < VT; vx++) {
      const gx = X0 + (vx + 0.5) * 1.5, sh = (gridBase(gx) - OY) / 1.5, st = bandH(gx) / 60; // layers between the two bands; a tall band's layers are further apart
      for (let vz = 0; vz < VT; vz++) for (let y = 0; y < VL; y++) {
        const f = clamp(tall ? (y + 0.5) * st - 0.5 + sh : y + sh, 0, hy - 1), y0 = floor(f), y1 = min(y0 + 1, hy - 1), k = f - y0, a = vx + VT * (y0 + hy * vz), b = vx + VT * (y1 + hy * vz), o = (vx + VT * (y + VL * vz)) * 2;
        vol[o] = mix(op[a], op[b], k) * 255; vol[o + 1] = mix(sky[a], sky[b], k) * 255;
      }
    }
  }
  // --- ground map of the tile: r magenta cover, g shore sand, b purple zone, a sediment
  const GT = 512 / WIN, gm = new Uint8Array(GT * GT * 4);
  for (let j = 0; j < GT; j++) for (let i = 0; i < GT; i++) {
    const x = X0 + (i + 0.5) / GT * TW, z = Z0 + (j + 0.5) / GT * TW, o = (i + GT * j) * 4;
    const pk = plainK(x);
    gm[o] = magAt(x, z) * (1 - 0.85 * pk) * 255; gm[o + 1] = sstep(0.12, 0.5, shoreK(x) + 0.25 * (fbm(x * 0.02, 5, z * 0.02, 2) - 0.5)) * 255;
    gm[o + 2] = zoneL(x, z) * (1 - pk) * 255; gm[o + 3] = max(sstep(0.42, 0.6, fbm(x * 0.04, 3, z * 0.04, 3)), 0.9 * pk) * 255;
  }
  // --- distance to the rock for the camera's collision, in 1/127 m (> 0 in rock, clamped to ±1 m), kept only in the
  // 4x4x4-voxel bricks near the surface. CI per brick: 0 all water, 1 all rock, n brick n-2 in CG.
  const CB = TILE / 4, CI = new Uint16Array(CB * (NY / 4) * CB);
  let CG = new Int8Array(64 * 1024), nb = 0;
  for (let bz = 0; bz < CB; bz++) for (let by = 1; by < NY / 4 - 1; by++) for (let bx = 0; bx < CB; bx++) {
    if (nb * 64 + 64 > CG.length) { const g2 = new Int8Array(CG.length * 2); g2.set(CG); CG = g2; }
    let lo = 127, hi = -127;
    for (let z = 0; z < 4; z++) for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const i = MG + bx * 4 + x + NT * (by * 4 + y + NY * (MG + bz * 4 + z)), gz = D[i + SL] - D[i - SL];
      const gx = D[i + 1] - D[i - 1], g = D[i + NT] - D[i - NT], l = sqrt(gx * gx + g * g + gz * gz) / 1.5;
      const q = round(clamp(D[i] / max(l, 0.05), -1, 1) * 127);
      CG[nb * 64 + x + 4 * y + 16 * z] = q; if (q < lo) lo = q; if (q > hi) hi = q;
    }
    CI[bx + CB * (by + NY / 4 * bz)] = lo === hi && lo * lo === 16129 ? +(lo > 0) : (nb++, nb + 1);
  }
  CG = CG.slice(0, nb * 64);

  let ylo = 1e9, yhi = -1e9;
  for (let c = 0; c < nCells; c++) { ylo = min(ylo, T.lo[c]); yhi = max(yhi, T.hi[c]); }
  for (const m of leafMeta) for (let c = 0; c < nCells; c++) { ylo = min(ylo, m.lo[c]); yhi = max(yhi, m.hi[c]); }
  return {
    tx, tz, OY, nCore: T.core.length, ylo, yhi,
    terr: { vb: T.vb, ib: T.ib, start: T.start, lo: T.lo, hi: T.hi },
    leaf: { buf: leafBuf, parts: leafMeta }, sol: { buf: solBuf, meta: solMeta }, misc: { buf: miscBuf, meta: miscMeta },
    vol, gm, CI, CG, cover: new Float32Array(cover),
  };
}

// ---------------------------------------------------------------- worker protocol
// { init: {LV, THIN, FLOAT, NAT, POSES, flyPts} } once, then { tx, tz, oy, ny, D: Float32Array } per tile -> the tile, its buffers transferred
onmessage = (e) => {
  const m = e.data;
  if (m.init) { LV = m.init.LV; THIN = m.init.THIN; FLOAT = m.init.FLOAT; NAT = m.init.NAT; POSES = m.init.POSES; flyPts = m.init.flyPts; handColumns(); return; }
  const t = genTile(m.tx, m.tz, m.D, m.oy, m.ny);
  postMessage(t, [t.terr.vb, t.terr.ib.buffer, t.leaf.buf, t.sol.buf.buffer, t.misc.buf.buffer, t.vol.buffer, t.gm.buffer, t.CI.buffer, t.CG.buffer]);
};
