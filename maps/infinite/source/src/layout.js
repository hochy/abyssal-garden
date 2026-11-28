// ============================================================================
// world layout: the hand-made home region, shared by the page and the tile workers
// ============================================================================

// designed rock masses: ax, az, bx, bz, radius, top, overhang, waist
const MESAS = [
  [-37, -42, -33, -22, 9, -7, 3.5, 2], [-29, -15, -33, 5, 12, -14, 3, 2], [-36, 11, -30, 27, 9, -5, 4, 2],   // west wall of the main canyon
  [30, -45, 35, -27, 9, -9, 4, 2], [37, -20, 31, -3, 11, -16, 3, 2], [32, 5, 35, 9, 7, -8, 4, 2],          // east wall
  [19, -15, 19, -15, 4.4, -6, 2, 1.5],   // pillar with window
  [6, -88, 6, -88, 10, -34, 0, 0],       // mound in the kelp basin
  [0, -106, 0, -106, 8, 3, 2, 2],        // pillar reaching the surface
  [44, 6, 47, -8, 7, -17, 3, 1],         // ship supports
  [33, 29, 37, 12, 9, -19, -6.5, 0],     // sloped sunlit wall beside the wreck
  [74, 14, 74, 14, 8, -15, 3, 1],
  [-84, -34, -80, -12, 10, -7, 6, 2], [-78, -6, -83, 12, 12, -13, 5, 2], [-82, 18, -79, 32, 9, -8, 6, 2],   // sponge canyon west wall
  [-17, 62, -19, 78, 10, -6, 9, 3], [-21, 84, -18, 100, 11, -9, 8, 3],     // grotto overhang cliff
  [22, 67, 24, 80, 7, -11, 6, 2],        // grotto coral rock
  [-16, 122, 34, 122, 9, -27, 3, 2],     // grotto far wall
];
// vertical ring arches: cx, cy, cz, yaw, major radius, minor radius, y squash
const ARCHES = [
  [-23, -9.5, -16, 0.3, 4.2, 1.4, 1.2],
  [0, -45, -34, 1.57, 14, 2.7, 1.2],
  [-40, -45, 44, 1.57, 10, 2.2, 1.3],
];
// carved tunnels: ax, ay, az, radius, bx, by, bz
const HOLES = [
  [19, -21, -23, 2.5, 19, -21, -7],
  [9, -37, 108, 4.2, 9, -34, 136],
];
// regions kept free of random mesas: ax, az, bx, bz, radius, softness
const CLEARS = [
  [0, -45, 0, 35, 22, 10], [0, -86, 0, -86, 46, 12], [42, 24, 74, 6, 22, 10], [72, -26, 72, -26, 26, 10],
  [-60, -36, -60, 36, 13, 8], [-60, 42, -18, 46, 12, 8], [4, 58, 8, 100, 24, 10], [-34, -74, -56, -46, 11, 8],
];
const PURPLE = [6, 84];
// the purple grotto at home, and far from home purple reaches that the noise lays out
const zoneP = (x, z) => max(sstep(44, 26, hypot(x - PURPLE[0], z - PURPLE[1])), sstep(0.6, 0.7, fbm(x * 0.005, 21, z * 0.005, 2)) * sstep(260, 420, hypot(x, z)));
// The purple water and light keep to the shelf: where the sea floor goes down (deepK) and in the rift the zone's own
// light, which dies out a few dozen metres down, would leave the deep black, so there the water stays as it is
// everywhere else. The purple growth (gen.js) still follows zoneP.
const zoneL = (x, z) => zoneP(x, z) * (1 - sstep(0.08, 0.4, deepK(x))) * sstep(RHW, RHW + RTW + 40, abs(x - riftX(z)));
const MAGENTA = [[14, 6, 13], [-4, 20, 9], [6, 84, 30], [-58, 8, 10], [50, 30, 12], [8, -70, 10], [-12, -98, 9], [-36, 44, 9], [-46, -60, 9], [24, 42, 8], [-56, 26, 9], [-44, 38, 8], [-10, 44, 8], [12, 24, 8], [-50, -45, 8]];
const magAt = (x, z) => {
  let m = sstep(0.54, 0.66, fbm(x * 0.03, 7, z * 0.03, 3)) * 0.9;
  for (const p of MAGENTA) m = max(m, sstep(p[2], p[2] * 0.45, hypot(x - p[0], z - p[1])));
  return m * sstep(0.3, 0.55, fbm(x * 0.17, 1, z * 0.17, 2) + m * 0.25);
};

// ---------------------------------------------------------------- rock formations far from home
// The home region's walls, arches and tunnels are listed by hand, above. Everywhere else the world is cut into
// cells of FC metres and each cell rolls, from its own seed, whether it holds a formation, and which depends on
// where on the sea's profile it lies:
//   shelf: an arch standing on the sea floor, a pillar with a window, a canyon between two walls, a spire that
//          reaches the surface, a wall with tunnels
//   slope: outcrops and walls that follow the fall line, windows through them
//   plain: fields of hydrothermal chimneys (their tops are in `vents`: gen.js makes them steam), lone arches
// They are the same kinds of shapes as at home, so the density shader carves them the same way. A block is given
// the shapes of all cells near enough to touch it; a cell's shapes are always the same, whoever asks.
const FC = 160, featCache = new Map();
function cellShapes(cx, cz) {
  const key = cx + ',' + cz; let f = featCache.get(key);
  if (f) return f;
  f = { mesas: [], arches: [], holes: [], clears: [], vents: [] };
  if (featCache.size > 400) featCache.clear();
  featCache.set(key, f);
  seedAt(cx, cz, 31);
  const x = (cx + rr(0.2, 0.8)) * FC, z = (cz + rr(0.2, 0.8)) * FC, base = seaBase(x), kind = rnd(), a = rnd() * PI;
  if (cx === floor(RIFX / FC)) { // the rift runs through this column of cells: vents on its bed, here and there
    if (rnd() < 0.55) { const vz = (cz + rr(0.25, 0.75)) * FC, vx = riftX(vz); ventField(f, vx, vz, seaBase(vx) - riftDepth(vz), 11, 5); }
    return f;
  }
  if (hypot(x, z) < 330 || base > -20 || abs(x - gorgeX(z)) < 70 || abs(x - riftX(z)) < 80) return f; // home is hand-made; the shallows stay open sand; none in the gorge
  const sl = slopeK(x), pl = plainK(x), lid = gridBase(x) + 54; // rock can't stand taller than the band of voxels
  const top = (h) => min(base + h, -4, lid);
  // each formation stands in a clearing: the noise's plateaus are kept away from it (ax, az, bx, bz, radius, softness)
  if (pl > 0.5) {
    if (kind < 0.3) { // a vent field: a handful of chimneys on a mound
      ventField(f, x, z, base, 15);
    } else if (kind < 0.4) { const R = rr(8, 13); f.arches.push([x, base + rr(-0.5, 1.5), z, a, R, rr(1.9, 2.6), rr(1.1, 1.3), 0]); f.clears.push([x, z, x, z, R + 16, 12, 0, 0]); }
    return f;
  }
  const along = sl > 0.35 ? rr(-0.25, 0.25) : a, ca = cos(along), sa = sin(along); // on the slope walls run down the fall line
  if (kind < 0.2 && sl < 0.6) { const R = min(rr(8, 15), -base * 0.45); f.arches.push([x, base + rr(-0.5, 1.5), z, a, R, rr(1.9, 2.8), rr(1.1, 1.35), 0]); f.clears.push([x, z, x, z, R + 16, 12, 0, 0]); }
  else if (kind < 0.36) { // pillar with a window
    const r = rr(4.5, 8), hy = base + rr(10, 16);
    f.mesas.push([x, z, x, z, r, top(rr(24, 36)), rr(1.5, 3), rr(1, 2)]);
    f.holes.push([x - ca * (r + 5), hy, z - sa * (r + 5), rr(2.2, 3.2), x + ca * (r + 5), hy + rr(-1.5, 1.5), z + sa * (r + 5), 0]);
    f.clears.push([x, z, x, z, r + 20, 12, 0, 0]);
  } else if (kind < 0.54) { // canyon: two walls side by side
    const L = rr(20, 34), gap = rr(9, 13);
    f.clears.push([x - ca * L, z - sa * L, x + ca * L, z + sa * L, gap + 30, 12, 0, 0]);
    for (const s of [-1, 1]) { const r = rr(8, 11), ox = -sa * (gap + r) * s, oz = ca * (gap + r) * s, k = rr(-6, 6); f.mesas.push([x + ox - ca * L + ca * k, z + oz - sa * L + sa * k, x + ox + ca * L + ca * k, z + oz + sa * L + sa * k, r, top(rr(26, 38)), rr(3, 6), 2]); }
  } else if (kind < 0.62) { if (base > -75) { f.mesas.push([x, z, x, z, rr(5, 8), 3, 2, 2]); f.clears.push([x, z, x, z, 26, 12, 0, 0]); } } // spire reaching the surface
  else if (kind < 0.76) { // a wall with one or two tunnels through it
    const L = rr(22, 32), r = rr(8, 10);
    f.clears.push([x - ca * L, z - sa * L, x + ca * L, z + sa * L, r + 22, 12, 0, 0]);
    f.mesas.push([x - ca * L, z - sa * L, x + ca * L, z + sa * L, r, top(rr(18, 26)), rr(2, 4), 1.5]);
    for (let i = 0, n = 1 + (rnd() < 0.5 ? 1 : 0); i < n; i++) { const k = rr(-0.6, 0.6) * L, hx = x + ca * k, hz = z + sa * k, hy = base + rr(4, 9); f.holes.push([hx + sa * (r + 6), hy, hz - ca * (r + 6), rr(2.6, 4), hx - sa * (r + 6), hy + rr(-1, 1), hz + ca * (r + 6), 0]); }
  }
  return f;
}

// a vent field: a handful of chimneys on a mound, in a clearing
function ventField(f, x, z, base, hmax, spread = 13) {
  for (let i = 0, n = 4 + (rnd() * 6 | 0); i < n; i++) {
    const d = rr(0, spread), b = rnd() * TAU, vx = x + cos(b) * d, vz = z + sin(b) * d, h = rr(5, hmax);
    f.mesas.push([vx, vz, vx, vz, rr(0.9, 1.7), base + h, 0, rr(0, 0.4)]); f.vents.push([vx, base + h + 0.6, vz]);
  }
  f.clears.push([x, z, x, z, 34, 12, 0, 0]);
}
function primBuffer() {
  const a = [];
  for (const m of MESAS) a.push(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7]);
  for (const m of ARCHES) a.push(m[0], m[1], m[2], m[3], m[4], m[5], m[6], 0);
  for (const m of HOLES) a.push(m[0], m[1], m[2], m[3], m[4], m[5], m[6], 0);
  for (const m of CLEARS) a.push(m[0], m[1], m[2], m[3], m[4], m[5], 0, 0);
  return new Float32Array(a);
}
