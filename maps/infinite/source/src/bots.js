// ============================================================================
// the creatures around the camera: bots that swim, hunt, flee, and are replaced as the camera moves on
// ============================================================================
// There is no population of the whole world: a few dozen creatures live around the camera. One that falls behind
// (or gets too far away) is dropped, and new ones come in from behind the water's haze, mostly ahead. Which species
// come is a matter of depth: each keeps to its own range (CRIT, creatures.js), so the company changes on the way down.
// How many creatures there are around one player. The limits go together with the server's (server/src/sea.js):
//   PEERMAX  other players shown at once: the server tells of no more than its SHOWN nearest (keep the two equal)
//   BOTN     bots around the camera when no other player is near (by detail level, times the World panel's choice)
//   BOTMIN   bots that stay however many players there are, so the sea is never only players
//   BOTMAX   room in the instance buffer: the player, PEERMAX others and BOTN bots (for the moment before the bots
//            make room), with a few to spare
// Bots fill what the players leave: BOTN less the players near, but not under BOTMIN (botPopulate).
const PEERMAX = 40, BOTN = round([26, 20, 14][LV] * POPK), BOTMIN = round([8, 6, 4][LV] * POPK), BOTMAX = 46 + BOTN;
// (POPK: the World panel's "creatures" - half, as is, twice; a species' own limit, CRIT.near, grows and shrinks with it)
const nearN = (s) => Math.ceil(CRIT[s].near * POPK);
let me = null; // the bot the player is, when playing a creature (see the end of this file)
const bots = [], botData = new Float32Array(BOTMAX * 8), botBuf = device.createBuffer({ size: BOTMAX * 32, usage: BU.VERTEX | BU.COPY_DST });
const botStart = new Uint32Array(CRIT.length + 1); // where each species' instances start in the buffer
let botTick = 0, botSeed = 1, botHold = false; // botHold: dev.js arranges them by hand and they stay put
const brnd = () => { botSeed = (botSeed + 0x6D2B79F5) | 0; let t = Math.imul(botSeed ^ (botSeed >>> 15), 1 | botSeed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const brr = (a, b) => a + (b - a) * brnd();
const wrapA = (a) => a - TAU * round(a / TAU);

// rock at a point? (within about a metre of it, or inside; water where nothing is loaded yet)
// the collision field at a point, between its 8 nearest lattice values like the camera's own (sd, main.js): above 0
// inside rock, -1 in open water (and where nothing is loaded yet)
function rockD(x, y, z) {
  x /= VS; y = (y - OY) / VS; z /= VS;
  const ix = floor(x), iy = floor(y), iz = floor(z), u = x - ix, v = y - iy, a = cv(ix, iy, iz), b = cv(ix, iy + 1, iz), c = cv(ix, iy, iz + 1), d = cv(ix, iy + 1, iz + 1);
  const p = a + (cv(ix + 1, iy, iz) - a) * u, q = b + (cv(ix + 1, iy + 1, iz) - b) * u, r = c + (cv(ix + 1, iy, iz + 1) - c) * u, s = d + (cv(ix + 1, iy + 1, iz + 1) - d) * u;
  const e = p + (q - p) * v; return (e + (r + (s - r) * v - e) * (z - iz)) / 127;
}
const rockAt = (x, y, z) => rockD(x, y, z) > -0.7; // rock here or close by
const inRock = (x, y, z) => rockD(x, y, z) > 0;
// The sunken ship is a mesh and not part of the rock, so it gets a field of its own: how far it is from a point to
// the nearest of its timbers (planks, ribs, masts), in a box around the ship, a value every quarter of a metre.
// shipBuild makes it from the mesh once (main.js): the triangles are marked in the lattice, then distances spread
// out from them (two sweeps, up to 3 m). An animal is stopped where that distance is less than its own thickness
// (shipR), so the small ones slip through a breach or a gap in the deck that the large ones cannot.
const SHIPC = 0.25, SHIPLO = [-20, -9.5, -7], SHIPN = [192, 104, 56]; let shipG = null;
function shipBuild(m) {
  const [nx, ny, nz] = SHIPN, g = new Uint8Array(nx * ny * nz).fill(255), U = 40; // (a unit is 1/40 m, 255: far)
  const mark = (x, y, z) => { const i = floor((x - SHIPLO[0]) / SHIPC), j = floor((y - SHIPLO[1]) / SHIPC), k = floor((z - SHIPLO[2]) / SHIPC); if (i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz) g[(k * ny + j) * nx + i] = 0; };
  for (let t = 0; t < m.i.length; t += 3) {
    const a = m.i[t] * 3, b = m.i[t + 1] * 3, c = m.i[t + 2] * 3, P = m.p;
    const e1 = hypot(P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]), e2 = hypot(P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]), n = max(1, Math.ceil(max(e1, e2) / 0.11));
    for (let u = 0; u <= n; u++) for (let v = 0; v <= n - u; v++) { const s = u / n, r = v / n, q = 1 - s - r; mark(P[a] * q + P[b] * s + P[c] * r, P[a + 1] * q + P[b + 1] * s + P[c + 1] * r, P[a + 2] * q + P[b + 2] * s + P[c + 2] * r); }
  }
  // distances: each cell from its neighbours already passed, forwards and then backwards
  const st = SHIPC * U, d1 = round(st), d2 = round(st * 1.414), d3 = round(st * 1.732), cap = 120;
  for (let pass = 0; pass < 2; pass++) {
    const s = pass ? -1 : 1;
    for (let kk = 0; kk < nz; kk++) for (let jj = 0; jj < ny; jj++) for (let ii = 0; ii < nx; ii++) {
      const k = pass ? nz - 1 - kk : kk, j = pass ? ny - 1 - jj : jj, i = pass ? nx - 1 - ii : ii, o = (k * ny + j) * nx + i; let d = g[o]; if (!d) continue;
      for (let dk = -1; dk <= 0; dk++) for (let dj = -1; dj <= (dk ? 1 : 0); dj++) for (let di = -1; di <= (dk || dj ? 1 : -1); di++) {
        const a = i + di * s, b = j + dj * s, c = k + dk * s; if (a < 0 || b < 0 || c < 0 || a >= nx || b >= ny || c >= nz) continue;
        const w = g[(c * ny + b) * nx + a] + ((di && dj && dk) ? d3 : (di && dj) || (di && dk) || (dj && dk) ? d2 : d1); if (w < d) d = w;
      }
      g[o] = min(d, cap);
    }
  }
  shipG = g;
}
// metres from a point of the world to the nearest timber of the ship (9: nowhere near it)
function shipD(x, y, z) {
  if (!shipG) return 9;
  x -= SHIPAT[0]; y -= SHIPAT[1]; z -= SHIPAT[2];
  if (x * x + y * y + z * z > 1300) return 9;
  // into the ship's own frame: turned back by its rotation
  const qx = -SHIPQ[0], qy = -SHIPQ[1], qz = -SHIPQ[2], qw = SHIPQ[3], tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  const lx = (x + qw * tx + qy * tz - qz * ty - SHIPLO[0]) / SHIPC - 0.5, ly = (y + qw * ty + qz * tx - qx * tz - SHIPLO[1]) / SHIPC - 0.5, lz = (z + qw * tz + qx * ty - qy * tx - SHIPLO[2]) / SHIPC - 0.5;
  const [nx, ny, nz] = SHIPN, i = floor(lx), j = floor(ly), k = floor(lz);
  if (i < 0 || j < 0 || k < 0 || i >= nx - 1 || j >= ny - 1 || k >= nz - 1) return 9;
  const u = lx - i, v = ly - j, w = lz - k, o = (k * ny + j) * nx + i, o2 = o + nx * ny, g = shipG;
  const a = g[o] + (g[o + 1] - g[o]) * u, b = g[o + nx] + (g[o + nx + 1] - g[o + nx]) * u, c = g[o2] + (g[o2 + 1] - g[o2]) * u, d = g[o2 + nx] + (g[o2 + nx + 1] - g[o2 + nx]) * u;
  const e = a + (b - a) * v; return (e + (c + (d - c) * v - e) * w) / 40;
}
// how thick a species is to the ship's timbers: half the height of its body (the crab's: about half its shell)
const shipR = (s) => clamp(CRIT[s].len * (s === CRAB ? 0.3 : (CRIT[s].high || 0.15) * 0.9), 0.07, 1.4);
// the floor under (x, z): the first rock below y0, looked for down to y1; null if there is none
function floorBelow(x, y0, z, y1) {
  if (inRock(x, y0, z)) return null;
  for (let y = y0 - 0.4; y > y1; y -= 0.4) if (inRock(x, y, z)) { let a = y, b = y + 0.4; for (let i = 0; i < 6; i++) { const m = (a + b) / 2; if (inRock(x, m, z)) a = m; else b = m; } return b; }
  return null;
}
// room for a body of radius r at a point
// inside the ship's hull (roughly: the box around it, in its own frame)? Nothing big is put there: it could not get out
function shipBox(x, y, z) {
  x -= SHIPAT[0]; y -= SHIPAT[1]; z -= SHIPAT[2];
  const qx = -SHIPQ[0], qy = -SHIPQ[1], qz = -SHIPQ[2], qw = SHIPQ[3], tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  return abs(x + qw * tx + qy * tz - qz * ty) < 18 && abs(y + qw * ty + qz * tx - qx * tz + 2) < 6.5 && abs(z + qw * tz + qx * ty - qy * tx) < 6.2;
}
const roomAt = (x, y, z, r) => !(r > 1 && shipBox(x, y, z)) && shipD(x, y, z) > min(r, 1) && !rockAt(x, y, z) && !rockAt(x + r, y, z) && !rockAt(x - r, y, z) && !rockAt(x, y, z + r) && !rockAt(x, y, z - r) && !rockAt(x, y - r, z) && y + r < -0.8;

// ---------------------------------------------------------------- who lives here
// how much each species wants to be around at this depth of the camera (d) over this depth of water (wd)
function botWeights(d, wd, w) {
  const band = (s, k) => { const c = CRIT[s]; w[s] = wd > c.top + 2 && d < c.bot + 30 ? k : 0; };
  band(0, wd < 170 && F[CX] > GORX - 160 ? 9 : 0); // the crab: from the gorge to the shore
  band(1, 2.2); band(2, 3); band(3, 3); band(4, 2); band(5, d > 150 ? 2.5 : 1.5); band(6, 1.6); band(7, 1.3);
  band(8, d > 100 ? 1.3 : 0.7); band(9, wd > 60 ? 0.3 : 0);
}
const botW = new Float32Array(CRIT.length), botCount = new Int32Array(CRIT.length);
// How far from the camera a species lives. A small animal is only something to see from close by, so the small ones
// come in, and stay, near the camera (they grow from nothing as they come, see botStep: at that distance a fish of a
// few centimetres is a few pixels); only the big ones come in from behind the haze. The crab is given 30 m, more than
// its size would: it sits still on the floor, and a clearing should have its crabs before the camera is over them.
const botRange = (s, far) => (s === CRAB ? min(30, far + 4) : clamp(CRIT[s].len * 45, 14, far + 4));
// a place for a newcomer of species s at distance r0..r1 from the camera, around the direction `dir` (± spread)
function botPlace(s, r0, r1, dir, spread) {
  const c = CRIT[s];
  for (let t = 0; t < 6; t++) {
    const a = dir + brr(-spread, spread), r = brr(r0, r1), x = F[CX] + cos(a) * r, z = F[CZ] + sin(a) * r;
    if (!tileAt(floor(x / TW), floor(z / TW))) continue;
    const top = -c.top, bot = max(-c.bot, seaBase(x) + 1);
    if (bot > top) continue;
    if (s === CRAB) { if (x < GORX - 30) continue; const f = floorBelow(x, min(seaBase(x) + 22, -2), z, seaBase(x) - 60); if (f !== null && f < -3) return [x, f, z]; continue; }
    // near the camera's own depth when that is within the species' range, close over the bottom for those that live there
    let y = c.floor ? max(bot, seaBase(x) + brr(2, 11)) : clamp(F[CY] + brr(-22, 22), bot, top);
    y = clamp(y, bot, top);
    if (roomAt(x, y, z, c.len * 0.5 + 0.8)) return [x, y, z];
  }
  return null;
}
function botAdd(s, p, yaw) {
  const c = CRIT[s];
  const b = { s, x: p[0], y: p[1], z: p[2], yaw, pit: 0, ty: yaw, tp: 0, wy: 0, wp: 0, v: c.spd * 0.7, ph: brnd() * TAU, turn: 0, k: brr(0.85, 1.15),
    age: 0, stuck: 0, tries: 0, gone: false, next: brr(1, 5), mode: 0, mt: 0, tgt: null, cool: brr(2, 10), air: brr(15, 50), vy: 0, n: bots.length };
  bots.push(b); return b;
}
// keeps the company at BOTN: drops the far ones, brings new ones in from behind the haze
function botPopulate(first) {
  const far = det * 135, vx = F[VX], vz = F[VZ], sp = hypot(vx, vz);
  for (let i = bots.length - 1; i >= 0; i--) {
    const b = bots[i], dx = b.x - F[CX], dz = b.z - F[CZ], d = hypot(dx, b.y - F[CY], dz);
    // out of reach, or left behind by a camera that swims away from it
    const rg = botRange(b.s, far);
    // (another player stays for as long as the server speaks of it, net.js)
    if (b.me || (b.net && !b.gone)) continue;
    // (a crab is too small to see from further, and a slow walker - a crab itself - must not keep the old ones)
    if (b.gone || d > rg * 1.5 + 30 || (d > rg + 12 && (b.s === CRAB || (sp > 2 && dx * vx + dz * vz < 0)))) { bots[i] = bots[bots.length - 1]; bots.pop(); }
  }
  const d = -F[CY], wd = -seaBase(F[CX]);
  botWeights(d, wd, botW); botCount.fill(0);
  for (const b of bots) if (!b.me) botCount[b.s]++;
  let peers = 0, own = 0; for (const b of bots) { if (b.net) peers++; else if (!b.me && !b.gone) own++; }
  const want = round(clamp(BOTN - peers, BOTMIN, BOTN) * (1 - 0.55 * clamp((d - 200) / 250, 0, 1)));
  // players have come and the bots are too many: one leaves each time, the farthest first
  if (peers && own > want) {
    let out = null, od = -1;
    for (const b of bots) if (!b.me && !b.net && !b.gone && !b.dead) { const q = hypot(b.x - F[CX], b.y - F[CY], b.z - F[CZ]); if (q > od) { od = q; out = b; } }
    if (out) out.gone = true;
  }
  const crabs = botW[CRAB] > 0;
  for (let n = first ? 60 : 3; n > 0 && own < want; n--) {
    let sum = 0; for (let s = 0; s < CRIT.length; s++) { if (botCount[s] >= nearN(s)) botW[s] = 0; sum += botW[s]; }
    if (sum <= 0) break;
    let pick = brnd() * sum, s = 0; while (s < CRIT.length - 1 && (pick -= botW[s]) > 0) s++;
    // ahead of a moving camera, anywhere around a still one; at first all through the water in view
    const rg = botRange(s, far), dir = sp > 1 ? atan2(vz, vx) : brnd() * TAU, p = first ? botPlace(s, min(10, rg * 0.5), rg * 0.9, brnd() * TAU, PI) : botPlace(s, rg, rg + max(6, rg * 0.15), dir, sp > 1 ? 1.5 : PI);
    if (!p) continue;
    // the small ones come a few together
    const group = s === 1 ? 4 + (brnd() * 4 | 0) : s === 2 || s === 7 ? 1 + (brnd() * 3 | 0) : 1, yaw = first ? brnd() * TAU : atan2(F[CZ] - p[2], F[CX] - p[0]) + brr(-1, 1);
    for (let g = 0; g < group && botCount[s] < nearN(s) && bots.length < BOTMAX; g++) {
      const q = g ? [p[0] + brr(-1, 1) * (1 + CRIT[s].len * 2), p[1] + brr(-0.6, 0.6) * (1 + CRIT[s].len), p[2] + brr(-1, 1) * (1 + CRIT[s].len * 2)] : p;
      if (g && !roomAt(q[0], q[1], q[2], CRIT[s].len * 0.5 + 0.5)) continue;
      botAdd(s, q, yaw + brr(-0.3, 0.3)); botCount[s]++; own++;
    }
  }
  // Where crabs live there are always a few around (more for a player who is a crab and looks for a fight), also
  // when the company is full and the camera too slow for anyone to leave: then the farthest of the others makes room.
  for (let n = first ? 30 : 1; n > 0 && crabs && botCount[CRAB] < (me && me.s === CRAB ? 6 : 4) && bots.length < BOTMAX; n--) {
    const rg = botRange(CRAB, far), go = sp > 0.2, p = first ? botPlace(CRAB, 4, rg * 0.9, brnd() * TAU, PI) : botPlace(CRAB, go ? rg : rg * 0.5, rg + 6, go ? atan2(vz, vx) : brnd() * TAU, go ? 1.5 : PI);
    if (!p) continue;
    if (own >= want) { let out = null, od = -1; for (const b of bots) if (!b.me && !b.net && !b.gone && !b.dead && b.s !== CRAB) { const q = hypot(b.x - F[CX], b.y - F[CY], b.z - F[CZ]); if (q > od) { od = q; out = b; } } if (out) out.gone = true; } else own++;
    botAdd(CRAB, p, brnd() * TAU); botCount[CRAB]++;
  }
}

// ---------------------------------------------------------------- how they move
function botSwim(b, c, dt) {
  b.next -= dt; b.cool -= dt; b.mt -= dt;
  // --- wedged, or in the rock: it backs out the way it came, tail first, then picks a way that is open and goes on
  if (b.mode === 5) {
    const cp = cos(b.pit), fx = cos(b.yaw) * cp, fy = sin(b.pit), fz = sin(b.yaw) * cp, v = max(0.4, c.spd * 0.35);
    const nx = b.x - fx * v * dt, ny = min(b.y - fy * v * dt, -0.7 - c.len * 0.12), nz = b.z - fz * v * dt, inside = inRock(b.x, b.y, b.z);
    if (inside || !inRock(nx, ny, nz)) { b.x = nx; b.y = ny; b.z = nz; } else b.mt = 0; // (rock behind as well: stop backing)
    b.v = 0; b.wy *= 1 - min(1, dt * 3); b.wp *= 1 - min(1, dt * 3); b.turn = clamp(b.wy / c.turn, -1, 1); b.ph -= dt * c.freq * 0.45;
    if (b.mt <= 0 && !inside) {
      // the first open heading, looking further and further round from where it was going, level and then upwards
      const L = 1.5 + c.len * 1.3, side = (b.n & 1) * 2 - 1; let found = false;
      for (const dp of [0, 0.5, -0.4]) { for (const da of [0.7, -0.7, 1.4, -1.4, 2.1, -2.1, PI]) { const y = b.yaw + da * side, q = cos(dp); if (!rockAt(b.x + cos(y) * q * L, b.y + sin(dp) * L, b.z + sin(y) * q * L) && !rockAt(b.x + cos(y) * q * L * 0.5, b.y + sin(dp) * L * 0.5, b.z + sin(y) * q * L * 0.5)) { b.ty = y; b.tp = dp; found = true; break; } } if (found) break; }
      if (!found) b.ty = b.yaw + PI;
      b.mode = 0; b.next = 3; b.stuck = 0;
    } else if (b.mt < -6) b.gone = true; // (rock all around and no way back: only then is it taken away)
    return;
  }
  // --- what it wants: wander, or chase, or flee
  let speed = c.spd * 0.72 * b.k;
  if (b.mode && b.mode !== 5 && (b.mt <= 0 || !b.tgt || bots[b.tgt.n] !== b.tgt)) { b.mode = 0; b.tgt = null; }
  if (b.mode === 1) { // after prey
    const t = b.tgt, dx = t.x - b.x, dy = t.y - b.y, dz = t.z - b.z, d = hypot(dx, dy, dz);
    b.ty = atan2(dz, dx); b.tp = atan2(dy, hypot(dx, dz)); speed = c.spd * 1.5;
    if (d < c.len * 0.45 + CRIT[t.s].len * 0.5 + 0.3) { b.mode = 0; b.cool = t.me ? brr(2.5, 5) : brr(10, 20); b.next = 0; botBite(b, t); } // caught up with it: a bite (see survival, below)
  } else if (b.mode === 2) { // away from a hunter
    const t = b.tgt, dx = b.x - t.x, dz = b.z - t.z;
    b.ty = atan2(dz, dx) + b.k * 3 - 3; b.tp = clamp((b.y - t.y) * 0.1, -0.4, 0.4); speed = c.spd * 1.8;
  } else if (b.next <= 0) {
    b.next = brr(2, 7); b.ty = b.yaw + brr(-1.3, 1.3); b.tp = brr(-0.22, 0.22);
    // not too far from the camera: those that stray turn back towards it
    const dx = F[CX] - b.x, dz = F[CZ] - b.z, lim = max(12, botRange(b.s, det * 135) * 0.6); if (dx * dx + dz * dz > lim * lim && brnd() < 0.75) { b.ty = atan2(dz, dx) + brr(-0.9, 0.9); b.tp = clamp((F[CY] - b.y) * 0.05, -0.3, 0.3); }
  }
  // --- its depths: between its own limits, over the floor, under the surface
  const top = -c.top, bot = max(-c.bot, seaBase(b.x) + 1 + c.len * 0.5);
  if (b.s === DOLPHIN || b.s === WHALE) { // up for air now and then: the dolphin leaps, the whale rolls at the surface
    b.air -= dt;
    if (b.air < 0) { b.tp = b.s === DOLPHIN ? 0.75 : 0.3; if (b.s === DOLPHIN) speed = c.spd * 1.5; if (b.y > (b.s === DOLPHIN ? -0.4 : -2.2) || b.air < -25) { b.air = brr(25, 70); if (b.s === DOLPHIN && b.y > -0.6) { b.vy = max(speed * sin(b.pit), 2.5); b.mode = 3; } else b.tp = -0.3; } }
    else if (b.y > top && b.tp > -0.1) b.tp = -0.3;
  } else if (b.y > top && b.tp > -0.1) b.tp = -0.3;
  if (b.y < bot && b.tp < 0.1) b.tp = 0.35;
  if (c.floor && b.mode === 0) { const over = b.y - seaBase(b.x); if (over > 16 && b.tp > -0.1) b.tp = -0.25; }
  // --- rock ahead: turn to where there is room
  const L = 1.2 + c.len * 1.1 + speed * 0.5, cp = cos(b.pit), fx = cos(b.yaw) * cp, fy = sin(b.pit), fz = sin(b.yaw) * cp;
  let hurry = 1;
  // (the way has to be clear for the whole width and height of the body, not just for its nose)
  const R = c.len * 0.13, SR = shipR(b.s), wide = (x, y, z, yw) => rockAt(x, y, z) || shipD(x, y, z) < SR + 0.5 || (R > 0.25 && (rockAt(x - sin(yw) * R, y, z + cos(yw) * R) || rockAt(x + sin(yw) * R, y, z - cos(yw) * R) || rockAt(x, y + R, z) || rockAt(x, y - R, z)));
  if (wide(b.x + fx * L, b.y + fy * L, b.z + fz * L, b.yaw)) {
    hurry = 2.5; const side = (b.n & 1) * 2 - 1;
    const free = (da, dp) => { const y = b.yaw + da, p = b.pit + dp, q = cos(p); return !wide(b.x + cos(y) * q * L, b.y + sin(p) * L, b.z + sin(y) * q * L, y); };
    if (free(0, 0.7)) b.tp = 0.7; else if (free(side * 0.9, 0)) b.ty = b.yaw + side * 0.9; else if (free(-side * 0.9, 0)) b.ty = b.yaw - side * 0.9; else if (free(0, -0.7)) b.tp = -0.7; else b.ty = b.yaw + PI * side * 0.9;
    b.next = max(b.next, 1.2);
  }
  // --- turn and go
  // The turning itself has weight: the rate of turn eases towards what the heading asks for (slower for a bigger
  // body), so a change of mind swings the animal round instead of snapping it.
  const top2 = c.turn * hurry, ease = min(1, dt * hurry / (0.22 + c.len * 0.06)), pmax = b.s === WHALE ? 0.35 : 0.95;
  b.wy += (clamp(wrapA(b.ty - b.yaw) * 1.6, -top2, top2) - b.wy) * ease;
  b.wp += (clamp((clamp(b.tp, -pmax, pmax) - b.pit) * 1.6, -top2 * 0.7, top2 * 0.7) - b.wp) * ease;
  b.yaw += b.wy * dt; b.pit += b.wp * dt;
  b.turn = clamp(b.wy / c.turn, -1, 1);
  b.v += (speed - b.v) * min(1, dt * 1.5);
  const nx = b.x + cos(b.yaw) * cos(b.pit) * b.v * dt, ny = min(b.y + sin(b.pit) * b.v * dt, b.s === DOLPHIN || b.s === WHALE ? -0.2 - c.len * 0.03 : -0.7 - c.len * 0.12), nz = b.z + sin(b.yaw) * cos(b.pit) * b.v * dt;
  if (inRock(nx, ny, nz) || (R > 0.25 && rockD(nx, ny, nz) > -0.35) || (shipD(nx, ny, nz) < SR && shipD(nx, ny, nz) <= shipD(b.x, b.y, b.z))) { b.ty = b.yaw + PI; b.v *= 0.5; b.stuck += dt; } else { b.x = nx; b.y = ny; b.z = nz; b.stuck = max(0, b.stuck - dt * 0.5); }
  // Wedged in the rock, or inside it (the world loaded around it, or it squeezed in): it backs out (mode 5, above)
  // for about its own length. One that keeps getting wedged in the same hole is taken away in the end.
  if (b.stuck > 1.2 || inRock(b.x, b.y, b.z)) {
    b.stuck = 0; b.tgt = null;
    if (++b.tries > 5) b.gone = true; else { b.mode = 5; b.mt = min(4, 0.6 + c.len * 1.2 / max(0.4, c.spd * 0.35)); }
  } else if (b.tries && b.next > 2.9) b.tries = max(0, b.tries - 0.02);
  b.ph += dt * c.freq * (0.35 + 0.65 * b.v / c.spd);
}
// a leap: out of the water on the speed it had, back in an arc
function botLeap(b, c, dt) {
  b.vy -= 9.8 * dt; const h = b.v * cos(b.pit);
  b.x += cos(b.yaw) * h * dt; b.z += sin(b.yaw) * h * dt; b.y += b.vy * dt; b.ph += dt * c.freq * 0.5;
  // the dolphin's nose follows its arc; the whale is too heavy to turn over in the air and falls back nearly as it rose
  const arc = atan2(b.vy, max(h, 0.5)); b.pit = b.s === WHALE ? b.pit + clamp(arc - b.pit, -0.4 * dt, 0.4 * dt) : arc;
  if (b.y < -0.7 && b.vy < 0) { b.mode = 0; b.tp = -0.4; b.next = 1.5; }
}
// the crab walks the floor sideways, stops, goes on; at an edge it steps off and sinks to the floor below
function botCrab(b, c, dt) {
  b.next -= dt;
  if (b.lost) { if ((b.clawT = (b.clawT || 0) + dt) >= CLAWT) { b.clawT = 0; b.lost = growClaw(b.lost); } }
  // struck by the player's crab: it turns on it, closes in and strikes back for a while (survival, below)
  const angry = b.anger > 0 && me && me.s === CRAB && meDown <= 0;
  if (angry) {
    b.anger -= dt; b.strikeT = (b.strikeT === undefined ? 0.8 : b.strikeT) - dt;
    const dx = me.x - b.x, dz = me.z - b.z, d = hypot(dx, dz); b.ty = atan2(dz, dx); b.next = 1; b.v = d > REACH * 0.7 ? c.spd : 0;
    if (d < REACH && ahead(b, me) && b.strikeT <= 0 && (b.lost || 0) !== 3) { b.strikeT = brr(0.9, 1.7); b.snap = 0.28; crabStrikesBack(b); }
  }
  if (b.next <= 0) { b.next = brr(1.5, 6); b.ty = b.yaw + brr(-1.4, 1.4); b.v = brnd() < 0.3 ? 0 : c.spd * brr(0.5, 1); if (brnd() < 0.5) b.k = -b.k; }
  b.wy += (clamp(wrapA(b.ty - b.yaw) * 2, -c.turn, c.turn) - b.wy) * min(1, dt * 4); b.yaw += b.wy * dt;
  // it faces along yaw and walks to its side
  // (kx, kz: what is left of the shove a strike gave it)
  const dir = angry ? b.yaw : b.yaw + (b.k > 0 ? PI / 2 : -PI / 2), nx = b.x + (cos(dir) * b.v + (b.kx || 0)) * dt, nz = b.z + (sin(dir) * b.v + (b.kz || 0)) * dt;
  if (b.kx || b.kz) { const k = exp(-dt * 8); b.kx *= k; b.kz *= k; if (abs(b.kx) + abs(b.kz) < 0.05) b.kx = b.kz = 0; }
  const f = floorBelow(nx, b.y + 0.7, nz, b.y - 1.5);
  if (f === null) {
    if (inRock(nx, b.y + 0.7, nz) || shipD(nx, b.y + 0.15, nz) < 0.12) { b.ty = b.yaw + PI * 0.6; b.next = 2; } // a wall: turn away
    else { b.x = nx; b.z = nz; b.y -= 1.1 * dt; b.mode = 4; } // nothing underfoot: down it goes
  } else if (shipD(nx, b.y + 0.15, nz) < 0.12 && shipD(nx, b.y + 0.15, nz) <= shipD(b.x, b.y + 0.15, b.z)) { b.ty = b.yaw + PI * 0.6; b.next = 2; } // a timber of the ship
  else { b.x = nx; b.z = nz; b.y += (f - b.y) * min(1, dt * 10); b.mode = 0; }
  b.ph += dt * c.freq * (b.mode === 4 ? 0.2 : b.v / c.spd) * (b.k > 0 ? 1 : -1);
}
// can a see p? Not through rock: the straight line between them is walked in steps of a metre and a half. And not
// through what only gives cover (a tile's `cover` list, gen.js): a loose boulder on the line, the ship, or kelp -
// two columns of it on the line, or one that p is right inside. None of these stop anyone swimming.
function botSees(a, p) {
  const dx = p.x - a.x, dy = p.y - a.y, dz = p.z - a.z, len = hypot(dx, dy, dz), n = min(24, floor(len / 1.5));
  for (let i = 1; i < n; i++) { const k = i / n; if (inRock(a.x + dx * k, a.y + dy * k, a.z + dz * k)) return false; }
  if (len < 0.5) return true;
  const l2 = len * len, tx0 = floor((min(a.x, p.x) - 6) / TW), tx1 = floor((max(a.x, p.x) + 6) / TW), tz0 = floor((min(a.z, p.z) - 6) / TW), tz1 = floor((max(a.z, p.z) + 6) / TW);
  let kelp = 0;
  for (let tz = tz0; tz <= tz1; tz++) for (let tx = tx0; tx <= tx1; tx++) {
    const t = tileAt(tx, tz), C = t && t.cover; if (!C) continue;
    for (let i = 0; i < C.length; i += 4) {
      const cx = C[i] - a.x, cy = C[i + 1] - a.y, cz = C[i + 2] - a.z, r = C[i + 3];
      if (r > 0) {
        // a ball: hidden if the line passes through it (unless the hunter itself is in it)
        if (cx * cx + cy * cy + cz * cz < r * r) continue;
        const k = clamp((cx * dx + cy * dy + cz * dz) / l2, 0, 1), ex = cx - dx * k, ey = cy - dy * k, ez = cz - dz * k;
        if (ex * ex + ey * ey + ez * ez < r * r) return false;
      } else {
        // a column of kelp, 1.3 m around its stem, from its foot up
        const h2 = dx * dx + dz * dz, k = h2 > 0.01 ? clamp((cx * dx + cz * dz) / h2, 0, 1) : 1, ex = cx - dx * k, ez = cz - dz * k, y = dy * k - cy;
        if (ex * ex + ez * ez < 1.7 && y > 0 && y < -r) { if (k > 0.97 || ++kelp > 1) return false; }
      }
    }
  }
  return true;
}
// hunters pick prey they can see, prey bolts from a hunter that is on it or close
// a crab with its claws up (gurgling, see below) is left alone by hunters up to seven times its length: the perch
// and the barracuda turn away from it, the grouper and the bigger ones are not impressed
const botScared = (a, p) => p.s === CRAB && p.gur && (p.me ? meLost : p.lost || 0) !== 3 && CRIT[a.s].len <= CRIT[CRAB].len * 7; // (it takes a claw to threaten with)
function botMinds() {
  for (const a of bots) {
    if (a.s === CRAB || a.mode === 3 || a.mode === 5 || a.me || a.net) continue;
    // a hunter that cannot see its prey any more (rock between them) gives it up after a moment
    if (a.mode === 1 && a.tgt && botScared(a, a.tgt)) { a.mode = 2; a.mt = brr(2, 3.5); a.blind = 0; continue; }
    if (a.mode === 1 && a.tgt) { if (botSees(a, a.tgt)) a.blind = 0; else if ((a.blind = (a.blind || 0) + 0.5) > 1.2) { a.mode = 0; a.tgt = null; a.blind = 0; a.cool = brr(6, 12); a.next = 0; } }
    if (a.mode === 0 && a.cool <= 0) {
      let best = null, bd = 16 + CRIT[a.s].len * 2;
      for (const p of bots) if (eats(a.s, p.s) && p.mode !== 3 && !p.net && !botScared(a, p)) { const d = hypot(p.x - a.x, p.y - a.y, p.z - a.z); if (d < bd && botSees(a, p)) { bd = d; best = p; } }
      if (best && brnd() < 0.5) { a.mode = 1; a.tgt = best; a.mt = brr(4, 8); } else a.cool = brr(1, 4);
    }
  }
  for (const p of bots) {
    if (p.s === CRAB || p.mode === 3 || p.mode === 1 || p.mode === 5 || p.me) continue;
    for (const a of bots) if (eats(a.s, p.s)) {
      const d = hypot(p.x - a.x, p.y - a.y, p.z - a.z);
      if (d < 3 + CRIT[a.s].len || (a.tgt === p && d < 10 + CRIT[a.s].len)) { p.mode = 2; p.tgt = a; p.mt = brr(2, 3.5); break; }
    }
  }
}
// one frame of their lives, and the instance buffer for drawing them
function botStep(dt) {
  if (dt > 0.1) dt = 0.1;
  botTick += dt;
  if (botHold) dt = 0;
  else if (!bots.length || botTick > 0.5) { const first = !bots.length; botTick = 0; botPopulate(first); for (let i = 0; i < bots.length; i++) bots[i].n = i; botMinds(); }
  if (!botHold) for (const b of bots) { const c = CRIT[b.s]; b.age += dt; if (b.snap > 0) b.snap -= dt; if (b.me) continue; if (b.net) { netMove(b, dt); continue; } if (b.dead) { b.dead -= dt; if (b.dead <= 0) { b.dead = 0; b.hp = 0.25; b.lost = 3; b.clawT = 0; } continue; } if (b.s === CRAB) botCrab(b, c, dt); else if (b.mode === 3) botLeap(b, c, dt); else botSwim(b, c, dt); }
  if (!botHold) { botReplies(dt); for (const b of bots) { if (b.gur || b.talk) botGurgle(b, dt); if (b.snap > 0) b.talk = max(b.talk || 0, sin(clamp(b.snap / 0.28, 0, 1) * PI)); } }
  gurFill();
  // sorted by species: one draw call each
  let k = 0;
  for (let s = 0; s < CRIT.length; s++) {
    botStart[s] = k;
    for (const b of bots) if (b.s === s && k < BOTMAX) {
      const o = k++ * 8, c = CRIT[s];
      botData[o] = b.x; botData[o + 1] = b.s === CRAB ? b.y + c.len * (b.dead ? 0.13 : 0.24) : b.y; botData[o + 2] = b.z; botData[o + 3] = b.yaw;
      // (the crab's pitch slot: its lost claws and whether it is dead, see the creature shader)
      botData[o + 4] = b.s === CRAB ? (b.me ? meLost : b.lost || 0) + (b.dead ? 4 : 0) : b.pit; botData[o + 5] = b.ph % (TAU * 64) + 1000 * round(15 * clamp(b.talk || 0, 0, 1)); botData[o + 6] = b.gone ? 0 : c.len * (botHold ? 1 : min(1, b.age / 1.5)); botData[o + 7] = s + 0.5 + 0.45 * clamp(b.turn, -1, 1); // (a newcomer grows from nothing in a second and a half)
    }
  }
  botStart[CRIT.length] = k;
  if (k) Q.writeBuffer(botBuf, 0, botData, 0, k * 8);
}
// draws them (the mesh buffers are bound by the caller): crit0 is the first creature mesh's place among the meshes
// which creatures cast a shadow this frame (the graphics settings say how many may: CSN): those that are largest
// to the eye. Each as a capsule along its body (the crab's: across it), written after the scene's uniforms.
const botShade = []; let shadeK = 0.88; // (how dark the middle of a shadow is)
function botShadows(U) {
  if (!CSN) return;
  botShade.length = 0;
  for (const b of bots) { const c = CRIT[b.s], d = hypot(b.x - F[CX], b.y - F[CY], b.z - F[CZ]); if (d < 150) { b.sk = c.len / (d + 3); botShade.push(b); } }
  botShade.sort((p, q) => q.sk - p.sk);
  for (let i = 0; i < CSN; i++) {
    const o = 60 + i * 8, b = botShade[i];
    if (!b) { U[o + 3] = 0; continue; }
    const c = CRIT[b.s], crab = b.s === CRAB, g = botHold ? 1 : min(1, b.age / 1.5), l = c.len * g, r = l * (crab ? 0.3 : (c.high || 0.12) * 0.9), hl = max(l * (crab ? 0.42 : 0.5) - r, 0);
    const a = crab ? b.yaw + PI / 2 : b.yaw, cp = crab ? 1 : cos(b.pit), ax = cos(a) * cp * hl, ay = crab ? 0 : sin(b.pit) * hl, az = sin(a) * cp * hl, y = crab ? b.y + c.len * 0.24 : b.y;
    U[o] = b.x + ax; U[o + 1] = y + ay; U[o + 2] = b.z + az; U[o + 3] = r;
    U[o + 4] = b.x - ax; U[o + 5] = y - ay; U[o + 6] = b.z - az; U[o + 7] = shadeK * g;
  }
}
function botDraw(r, crit0) {
  if (!botStart[CRIT.length]) return;
  r.setPipeline(pCrit); r.setVertexBuffer(1, botBuf);
  for (let s = 0; s < CRIT.length; s++) { const n = botStart[s + 1] - botStart[s], m = meshes[crit0 + s]; if (n) r.drawIndexed(m.ib.length, n, m.i0, m.v0, botStart[s]); }
}

// ---------------------------------------------------------------- gurgling
// The players' joke of a language. While a player holds the button its creature (b.gur) gurgles: the mouth works
// (b.talk, 0..1, drawn by the creature shader; the crab's claws go up instead), bubbles leave it for the surface, and
// audio.js makes each species' own noise where it is. Bots do not start it, but one of the player's own kind answers
// (botReplies); and see botScared for what the crab's raised claws do.
const GURMAX = 192, gurBub = [], gurData = new Float32Array(GURMAX * 8), gurBuf = device.createBuffer({ size: GURMAX * 32, usage: BU.VERTEX | BU.COPY_DST });
const GURBEAT = [3, 16, 14, 11, 9, 6, 11, 13, 4.5, 2.6]; // how fast each species' mouth works
// where the gurgle comes out: the mouth (the crab's: between its claws)
const gurMouth = (b) => { const c = CRIT[b.s], cp = cos(b.pit), d = c.len * (b.s === CRAB ? 0.32 : 0.46); return [b.x + cos(b.yaw) * cp * d, (b.s === CRAB ? b.y + c.len * 0.3 : b.y + sin(b.pit) * d - c.len * 0.02), b.z + sin(b.yaw) * cp * d]; };
function botGurgle(b, dt) {
  if (!b.gur) { b.talk = max(0, (b.talk || 0) - dt * 5); return; }
  b.gph = (b.gph || 0) + dt * GURBEAT[b.s];
  const aim = b.s === CRAB ? 0.92 + 0.08 * sin(b.gph * 4) : 0.3 + 0.7 * abs(sin(b.gph));
  b.talk = (b.talk || 0) + (aim - (b.talk || 0)) * min(1, dt * (b.s === CRAB ? 7 : 30));
  // bubbles: as the stock ones (vsBub, shaders.js), each started at the mouth now. life = fract(t * speed / height + seed)
  // (their size and wobble follow the species' length; the crab's are the shark's)
  const L = CRIT[b.s === CRAB ? 8 : b.s].len;
  b.gb = (b.gb || 0) + dt * (5 + 5 * Math.random());
  while (b.gb >= 1) {
    b.gb--;
    const p = gurMouth(b), h = min(-p[1] - 0.2, 14); if (h < 0.5) break;
    const sz = clamp(L * 0.035, 0.006, 0.3) * (0.6 + 0.8 * Math.random()), spd = (1.1 + 1.3 * Math.random()) * (0.6 + sz * 3), seed = ((-F[TIME] * spd / h) % 1 + 1) % 1;
    if (gurBub.length >= GURMAX) gurBub.shift();
    gurBub.push([p[0], p[1], p[2], sz, seed, spd, h, -min(0.012 + L * 0.004, 0.06), F[TIME] + h / spd * 0.985]);
  }
}
// A gurgle is answered by the gurgler's own kind: a bot of the same species close by (and not busy hunting or
// fleeing) waits a moment, gurgles back for a second or three, and may do so again while the gurgling keeps on. A
// crab stops for it and turns to the one it answers, claws up. It answers the player and, in the shared sea, the
// other players alike (each browser has its own bots, so each sees its own answer).
const gurWho = [];
function botReplies(dt) {
  gurWho.length = 0; for (const p of bots) if ((p.me || p.net) && p.gur && !p.gone) gurWho.push(p);
  for (const b of bots) {
    if (b.me || b.net) continue;
    if (b.rw > 0) { b.rw -= dt; if (b.rw <= 0) { b.gur = true; b.rt = brr(1.2, 2.8); } }
    else if (b.rt > 0) { b.rt -= dt; if (b.rt <= 0) { b.gur = false; b.rc = brr(0.8, 2.5); } }
    else {
      b.rc = (b.rc || 0) - dt;
      if (b.rc <= 0 && (b.mode === 0 || b.mode === 4)) for (const p of gurWho) {
        // how far away its own kind still answers
        if (p.s === b.s && hypot(b.x - p.x, b.y - p.y, b.z - p.z) < (p.s === CRAB ? 6 : 12 + CRIT[p.s].len * 3) * gurFar(p.s)) { b.rw = brr(0.4, 1.3); b.rto = p; break; }
      }
    }
    if (b.s === CRAB && (b.rw > 0 || b.rt > 0) && b.mode === 0 && b.rto) { b.v = 0; b.next = max(b.next, 0.6); b.ty = atan2(b.rto.z - b.z, b.rto.x - b.x); }
  }
}
// the live bubbles, as instances for the bubble pipeline
let gurN = 0;
function gurFill() {
  while (gurBub.length && gurBub[0][8] < F[TIME]) gurBub.shift();
  gurN = 0;
  for (const q of gurBub) if (q[8] >= F[TIME]) { gurData.set(q.slice(0, 8), gurN++ * 8); }
  if (gurN) Q.writeBuffer(gurBuf, 0, gurData, 0, gurN * 8);
}
function gurDraw(r) { if (gurN) { r.setVertexBuffer(0, gurBuf); r.draw(4, gurN); } }

// ---------------------------------------------------------------- the sonar
// A soft disc in the corner of the screen, the camera in its middle, ahead at the top. Every creature within SONAR
// metres is an echo: a wide blur when it is far, drawn together into a sharp dot as it nears, and fading out with the
// disc towards its rim. Its colour is what it is to the creature in play: one that can be eaten, one that can eat, or
// neither; with the free camera, how much of a hunter it is. Close by, the dot's size tells the animal's, and a tick whether it is above or below.
const SONAR = 100, SONARCOL = { food: [87, 227, 216], danger: [255, 122, 102], other: [157, 180, 200] }, CRITNAME = ['Crab', 'Fry', 'Chromis', 'Sea perch', 'Barracuda', 'Grouper', 'Tuna', 'Dolphin', 'Shark', 'Whale'];
let sonarT = 0, sonarR = SONAR;
// its range: 100, 50 or 25 m across the disc's radius (the Z key, or a tap on the disc), kept between visits
try { const v = +localStorage.abyssalInfSonar; if (v === 50 || v === 25) sonarR = v; } catch {}
function sonarZoom() { sonarR = sonarR > 30 ? sonarR / 2 : SONAR; keep('abyssalInfSonar', sonarR); }
// how much of a hunter each species is: the share of the others it can eat (the free camera's sonar shows that)
const CRITHUNT = CRIT.map((c, s) => CRIT.filter((q, o) => eats(s, o)).length / 7);
function sonarDraw(cv, dt) {
  if ((sonarT += dt) < 0.033) return;
  sonarT = 0;
  const w = cv.clientWidth, d = min(window.devicePixelRatio || 1, 2);
  if (!w) return;
  if (cv.width !== round(w * d)) { cv.width = round(w * d); cv.height = round(w * d); }
  const x = cv.getContext('2d'), cx = w / 2, R = w / 2 - 2, cy = R + 2;
  x.setTransform(d, 0, 0, d, 0, 0); x.clearRect(0, 0, w, w);
  let g = x.createRadialGradient(cx, cy, 0, cx, cy, R);
  g.addColorStop(0, 'rgba(60,190,200,0.20)'); g.addColorStop(0.55, 'rgba(40,150,170,0.13)'); g.addColorStop(0.85, 'rgba(30,120,140,0.05)'); g.addColorStop(1, 'rgba(30,120,140,0)');
  x.fillStyle = g; x.beginPath(); x.arc(cx, cy, R, 0, TAU); x.fill();
  // ahead on the screen is where the view looks; the middle is the player's creature, or the free camera
  const hx = sin(F[YAW]), hz = -cos(F[YAW]), rx = cos(F[YAW]), rz = sin(F[YAW]), ox = me ? me.x : F[CX], oy = me ? me.y : F[CY], oz = me ? me.z : F[CZ];
  // The way home (the first viewpoint): a green haze at the rim, on the side home lies; it fades as home comes
  // within the sonar's range and is gone near it.
  { const dx = POSES[0][0] - ox, dz = POSES[0][2] - oz, r = hypot(dx, dz), a = clamp((r - SONAR * 0.5) / (SONAR * 0.5), 0, 1);
    // A crescent: what of the disc lies outside a larger circle (3.25 R) pushed away from home - thickest towards
    // home (0.13 R), thinning to points 35 degrees either side; soft on its inner edge, and dimmed again at the rim like the disc itself.
    if (a > 0) { const ux = (dx * rx + dz * rz) / r, uy = -(dx * hx + dz * hz) / r, t = R * 0.13, q = R * 3.25, px = cx - ux * R * 2.38, py = cy - uy * R * 2.38, al = (k) => 'rgba(110,240,140,' + (k * a).toFixed(3) + ')';
      x.save(); x.beginPath(); x.arc(cx, cy, R, 0, TAU); x.clip();
      g = x.createRadialGradient(px, py, q, px, py, q + t); g.addColorStop(0, al(0)); g.addColorStop(0.4, al(0.1)); g.addColorStop(0.78, al(0.5)); g.addColorStop(1, al(0.12));
      x.fillStyle = g; x.beginPath(); x.arc(cx, cy, R, 0, TAU); x.fill(); x.restore(); } }
  x.font = '600 ' + max(9, R * 0.085) + 'px system-ui, sans-serif'; x.textAlign = 'center'; x.fillStyle = 'rgba(127,243,255,0.5)'; x.fillText(sonarR + ' m', cx, cy + R * 0.86); // the range
  const seen = [];
  for (const b of bots) { if (b.me) continue; const dx = b.x - ox, dz = b.z - oz, r = hypot(dx, dz); if (r < sonarR) seen.push([r, dx, dz, b]); }
  seen.sort((a, b) => b[0] - a[0]); // the far ones first, the near sharp ones over them
  for (const [r, dx, dz, b] of seen) {
    const d01 = r / sonarR, rim = 1 - pow(max(0, (d01 - 0.72) / 0.28), 1.5) * (1) , px = cx + (dx * rx + dz * rz) * R * 0.9 / sonarR, py = cy - (dx * hx + dz * hz) * R * 0.9 / sonarR;
    // playing a creature: what it can eat, what can eat it, the rest. The free camera: from pale for the harmless through amber to red for the great hunters
    const hk = CRITHUNT[b.s], col = me ? SONARCOL[eats(me.s, b.s) ? 'food' : eats(b.s, me.s) ? 'danger' : 'other'] : hk < 0.5 ? [mix(157, 240, hk * 2), mix(180, 190, hk * 2), mix(200, 90, hk * 2)] : [mix(240, 255, hk * 2 - 1), mix(190, 90, hk * 2 - 1), mix(90, 80, hk * 2 - 1)];
    const rgba = (a) => 'rgba(' + round(col[0]) + ',' + round(col[1]) + ',' + round(col[2]) + ',' + a + ')';
    const blur = pow(d01, 1.25), soft = R * (0.022 + 0.2 * blur), core = max(1.6, R * (0.011 + 0.012 * min(Math.log(1 + CRIT[b.s].real * 4) / 2.2, 1.6))) * (1 - blur * 0.7);
    g = x.createRadialGradient(px, py, 0, px, py, soft);
    g.addColorStop(0, rgba((0.85 - 0.5 * blur) * rim)); g.addColorStop(0.35 + 0.3 * (1 - blur), rgba((0.4 - 0.28 * blur) * rim)); g.addColorStop(1, rgba(0));
    x.fillStyle = g; x.beginPath(); x.arc(px, py, soft, 0, TAU); x.fill();
    if (b.net && b.name) { x.font = '600 ' + max(9, R * 0.085) + 'px system-ui, sans-serif'; x.textAlign = 'center'; x.fillStyle = 'rgba(255,255,255,' + (0.9 * rim).toFixed(2) + ')'; x.fillText(b.name, px, py - core - R * 0.035); } // another player: its name
    const sharp = 1 - min(1, blur * 2.4); // only the near third of the range gets a hard dot
    if (sharp > 0.02) {
      x.fillStyle = rgba(sharp * rim); x.beginPath(); x.arc(px, py, core, 0, TAU); x.fill();
      x.strokeStyle = 'rgba(255,255,255,' + 0.55 * sharp * rim + ')'; x.lineWidth = max(1, R * 0.004); x.beginPath(); x.arc(px, py, core, 0, TAU); x.stroke();
      const dy = b.y - oy;
      if (abs(dy) > 4 && sharp > 0.5) { const s = dy > 0 ? -1 : 1, ax = px + core + R * 0.03, k = R * 0.02; x.fillStyle = rgba(rim); x.beginPath(); x.moveTo(ax, py + s * k); x.lineTo(ax - k * 0.8, py - s * k * 0.5); x.lineTo(ax + k * 0.8, py - s * k * 0.5); x.closePath(); x.fill(); }
    }
  }
  // the player: a small arrow pointing ahead; under the disc, who the colours are for
  x.fillStyle = '#e6f7fa'; x.beginPath(); x.moveTo(cx, cy - R * 0.045); x.lineTo(cx - R * 0.028, cy + R * 0.03); x.lineTo(cx, cy + R * 0.014); x.lineTo(cx + R * 0.028, cy + R * 0.03); x.closePath(); x.fill();
}

// ---------------------------------------------------------------- playing a creature
// The player's creature is a bot like the others, only steered by the player: it turns, swims and is drawn by the
// same rules, with its species' speed, turning and size, and the others hunt it or flee from it as they would one of
// their own. The view looks where the mouse points; the body follows as fast as that body can turn, and the camera
// rides behind it. mePick: the species chosen in the menu, -1 for the free camera of old.
let mePick = -1, meStamina = 1, meZoom = 0.5, meBurstT = 0; // meZoom: 0 the view from over the head .. 2 far behind (0.5 until the wheel is turned)
try { const z = +localStorage.abyssalInfZoom; if (z >= 0 && z <= 2) meZoom = z; } catch {}
// VR (xr.js) puts the camera behind the creature along the play space's heading, not the head's, and a little above:
// meCamY, meCamP stand in for the view's yaw and pitch there (null: the view's own)
let meCamY = null, meCamP = null;
function meZoomBy(d) { meZoom = clamp(meZoom + d, 0, 2); keep('abyssalInfZoom', meZoom.toFixed(2)); }
// a burst: a second of top speed whatever the keys say, for nearly half of the stamina
// (not while the crab is falling)
let meDart = 0, meLeapT = 0;
function meBurst() {
  if (!me || me.mode === 4 || meStamina <= 0.3 || meBurstT > 0) return;
  meBurstT = me.s === CRAB ? 0.6 : 1; meStamina -= 0.4;
  // the crab darts sideways: to the side the view is turned to (straight ahead or behind: the side it last walked to)
  if (me.s === CRAB) { const d = wrapA(F[YAW] - PI / 2 - me.yaw); if (abs(sin(d)) > 0.15) me.k = d > 0 ? 1 : -1; meDart = me.yaw + me.k * PI / 2; }
}
try { const v = localStorage.abyssalInfMe; if (v !== undefined && v !== null && v !== '' && +v >= -1 && +v < CRIT.length) mePick = +v | 0; } catch {}
function meChoose(s) { mePick = s; keep('abyssalInfMe', s); }
// how far behind its creature the camera rides
const meFar = (s) => 1.3 + CRIT[s].len * (s === CRAB ? 3.2 : 1.9);
// makes the creature in play match the choice: at the camera's place, looking where it looks
function meSync() {
  if (me && me.s === mePick) return;
  if (me) { const i = bots.indexOf(me); if (i >= 0) { bots[i] = bots[bots.length - 1]; bots.pop(); } me = null; }
  if (mePick < 0) return;
  // It appears ahead of the camera, where the camera will be looking at it from; if a body that size has no room
  // there, in the nearest open water around (higher up first).
  const c = CRIT[mePick], R = max(0.3, c.len * 0.1), far = meFar(mePick), cp = cos(F[PIT]), fx = sin(F[YAW]) * cp, fy = sin(F[PIT]), fz = -cos(F[YAW]) * cp;
  let p = [F[CX] + fx * far, min(F[CY] + fy * far, -1 - c.len * 0.2), F[CZ] + fz * far];
  if (!roomAt(p[0], p[1], p[2], R * 1.5 + 0.5)) {
    let found = false;
    for (let k = 1; k <= 8 && !found; k++) for (let i = 0; i < 12 && !found; i++) {
      const a = i / 12 * TAU, e = (i % 3) * 0.5, r = k * (1 + c.len * 0.35), q = [F[CX] + cos(a) * cos(e) * r, min(F[CY] + sin(e) * r, -1 - c.len * 0.2), F[CZ] + sin(a) * cos(e) * r];
      if (roomAt(q[0], q[1], q[2], R * 1.5 + 0.5)) { p = q; found = true; }
    }
  }
  me = botAdd(mePick, p, F[YAW] - PI / 2); me.me = true; me.age = 9; me.v = 0; meStamina = 1;
  if (mePick === CRAB) F[PIT] = min(F[PIT], -0.3); // (the crab is looked at from above)
}
// after the camera was put somewhere (the viewpoint keys): the creature goes there too
function meWarp() { if (!me) return; me.x = F[CX]; me.y = min(F[CY], -1 - CRIT[me.s].len * 0.2); me.z = F[CZ]; me.yaw = me.ty = F[YAW] - PI / 2; me.pit = 0; me.v = 0; me.mode = 0; me.wy = me.wp = 0; }
// rock in the way of a body of radius r at a point?
const meBlocked = (x, y, z, r) => rockD(x, y, z) > -0.45 || (r > 0.6 && (inRock(x + r, y, z) || inRock(x - r, y, z) || inRock(x, y, z + r) || inRock(x, y, z - r) || inRock(x, y - r, z) || inRock(x, y + r, z)));
// One frame of the player's creature. dyw, dpt: the turn of the view this frame (radians); mf, mr, mu: the keys
// forward-back, right-left, up-down (-1..1); fast: the dash key.
function meStep(dt, dyw, dpt, mf, mr, mu, fast) {
  if (meLifeStep(dt)) return; // (died and came back: the new body starts with the next frame)
  const b = me, c = CRIT[b.s], R = max(0.3, c.len * 0.1);
  F[YAW] += dyw; F[PIT] = clamp(F[PIT] - dpt, -1.35, 1.35);
  const vyaw = F[YAW], vpit = F[PIT];
  // a dash can be held for nearly ten seconds; the stamina comes back in six and a half
  const burst = meBurstT > 0; meBurstT -= dt;
  // The keys steer by the view, as in other third-person games (the character turns to the way it moves): W swims the
  // way the view looks, S back towards the eye, A and D to the view's left and right, and the body turns to the way it
  // goes by the shorter way round. The way is taken from the view every frame, so turning the view while a key is
  // held steers the body with it. With no key held the body keeps its heading and the view is free to look around it.
  const go = hypot(mf, mr) > 0, way = vyaw - PI / 2 + atan2(mr, mf);
  const dash = burst || (fast && meStamina > 0.02 && (go || mu !== 0)); meStamina = clamp(meStamina + (burst ? 0 : dash ? -dt / 9.6 : dt / 6.5), 0, 1);
  if (b.s === CRAB) {
    // the crab: on the floor. It walks sideways, so it turns the nearer of its sides to the way it is steered (and
    // is slower until it has); off an edge it sinks, and until it lands it can only look around
    // (the ship's timbers are floor and wall to it as the rock is: it walks the deck and cannot pass a plank)
    const SR = shipR(CRAB), onShip = shipD(b.x, b.y - 0.06, b.z) < SR, wall = (x, z) => { const d = shipD(x, b.y + SR + 0.14, z); return d < SR && d <= shipD(b.x, b.y + SR + 0.14, b.z); };
    const f = floorBelow(b.x, b.y + 0.9, b.z, b.y - 1.3), sp = c.spd * (dash ? 1.8 : 1), air = f === null && !onShip;
    let dir = way, v = 0, turnTo = 0;
    if (go) { const d = wrapA(way - b.yaw); b.k = d >= 0 ? 1 : -1; turnTo = wrapA(way - b.k * PI / 2 - b.yaw); v = sp * (0.45 + 0.55 * abs(sin(d))); }
    else if (meHeld || b.gur || meActT > 0) turnTo = wrapA(vyaw - PI / 2 - b.yaw); // striking or blocking: its claws to where the view looks
    if (burst) { dir = meDart; v = c.spd * 3.2; turnTo = 0; }
    if (meDown > 0) { v = 0; turnTo = 0; } // beaten: on its back
    b.wy += (clamp(turnTo * 4, -c.turn, c.turn) - b.wy) * min(1, dt * 6); b.yaw += b.wy * dt;
    const k = air ? 0.12 : 1, vx = cos(dir) * v * k + meKX, vz = sin(dir) * v * k + meKZ, kk = exp(-dt * 8); meKX *= kk; meKZ *= kk; // (meKX, meKZ: the shove of a strike)
    const nx = min(b.x + vx * dt, SHOREX), nz = b.z + vz * dt;
    // a step to (x, z), if nothing stands there
    const step = (x, z) => {
      if (air) { if (inRock(x, b.y, z) || wall(x, z)) return 0; }
      else if (wall(x, z)) return 0;
      else if (!(onShip && (f === null || f < b.y - 0.3))) { // (on the ship's timbers, the floor well below, it just walks)
        const g = floorBelow(x, b.y + 0.9, z, b.y - 1.3);
        if (g !== null) b.y += (min(g, -0.6) - b.y) * min(1, dt * 12); else if (inRock(x, b.y + 0.9, z)) return 0;
      }
      b.x = x; b.z = z; return 1;
    };
    // against a wall it slides along it: the part of the step that is free is taken
    step(nx, nz) || step(nx, b.z) || step(b.x, nz);
    if (air) { if (!inRock(b.x, b.y - 1.6 * dt, b.z)) b.y -= 1.6 * dt; b.mode = 4; } else b.mode = 0;
    b.v = hypot(vx, vz); b.ph += dt * c.freq * min(b.v / c.spd, 2.5) * (b.k < 0 ? -1 : 1) + (air ? dt * 1.5 : 0); b.turn = 0;
  } else if (b.mode === 3) botLeap(b, c, dt);
  else {
    // the body turns to the way it is steered; it tips as the view does when going with it (the other way when
    // coming back at the eye), and E and Q tip it further, or by themselves send it up or down
    const pmax = b.s === WHALE ? 0.6 : 1.2, ease = min(1, dt / (0.16 + c.len * 0.035)), top = c.turn * 1.6;
    if (go) { b.ty = way; b.tp = clamp(vpit * mf / hypot(mf, mr) + mu * 0.7, -pmax, pmax); }
    else { b.ty = b.yaw; b.tp = clamp(mu * 0.9, -pmax, pmax); }
    // the whale comes up to the surface level and lies along it; only at a dash does it keep its nose up and breach
    if (b.s === WHALE && !dash && b.tp > 0) b.tp = min(b.tp, 0.55 * clamp((-0.77 - c.len * 0.02 - b.y) / (c.len * 0.22), 0, 1));
    meLeapT -= dt;
    b.wy += (clamp(wrapA(b.ty - b.yaw) * 2.2, -top, top) - b.wy) * ease;
    b.wp += (clamp((b.tp - b.pit) * 2.2, -top * 0.8, top * 0.8) - b.wp) * ease;
    b.yaw += b.wy * dt; b.pit += b.wp * dt; b.turn = clamp(b.wy / c.turn, -1, 1);
    // (slower through a sharp turn, so that it comes about in less room)
    const want = burst ? c.spd * 2.5 : go || mu !== 0 ? c.spd * (dash ? 1.8 : 1) * (0.4 + 0.6 * max(0, cos(wrapA(b.ty - b.yaw)))) : c.spd * 0.1;
    b.v += (want - b.v) * min(1, dt * (burst ? 9 : 2.4));
    const cp = cos(b.pit), air = b.s === DOLPHIN || b.s === WHALE, ceil = air ? -0.15 - c.len * 0.02 : -0.5 - c.len * 0.1, floorY = gridBase(b.x) + 3;
    const dx = cos(b.yaw) * cp * b.v * dt, dy = sin(b.pit) * b.v * dt, dz = sin(b.yaw) * cp * b.v * dt;
    // up through the surface with speed: the dolphin and the whale leap
    if (air && meLeapT <= 0 && b.y + dy > ceil && b.pit > (b.s === WHALE ? 0.3 : 0.2) && b.v > c.spd * (b.s === WHALE ? 1.3 : 0.85)) { b.vy = b.v * sin(b.pit) + 1; b.mode = 3; meLeapT = b.s === WHALE ? 4 : 1.2; }
    // Rock in the way (or the ship's timbers, where the body is too thick to pass them; a step that leads away from
    // them is always free): the body slides along it. The part of the step that goes into the surface is dropped and
    // the rest is taken, and a step straight into a wall is turned up along it, so that the body climbs over what it
    // ran into instead of standing there. Only what the step lost slows it down.
    // The body is long, so its nose is stopped too (hx, hy, hz: from the middle of the body to it), or the head would
    // go through a wall the body slides along; a step that takes the nose out again is always free.
    let x = b.x, y = b.y, z = b.z, hit = 0;
    const HL = c.len * 0.45, hx = cos(b.yaw) * cp * HL, hy = sin(b.pit) * HL, hz = sin(b.yaw) * cp * HL, SN = max(0.07, shipR(b.s) * 0.6), NR = -0.3;
    const SR = shipR(b.s), sd0 = shipD(x, y, z), hr0 = rockD(x + hx, y + hy, z + hz), hs0 = shipD(x + hx, y + hy, z + hz);
    const body = (px, py, pz) => { if (meBlocked(px, py, pz, R)) return true; const d = shipD(px, py, pz); return d < SR && d <= sd0; };
    const noseR = (px, py, pz) => { const d = rockD(px + hx, py + hy, pz + hz); return d > NR && d >= hr0; }, noseS = (px, py, pz) => { const d = shipD(px + hx, py + hy, pz + hz); return d < SN && d <= hs0; };
    const blocked = (px, py, pz) => body(px, py, pz) || noseR(px, py, pz) || noseS(px, py, pz);
    const fx = min(x + dx, SHOREX), fy = clamp(y + dy, floorY, ceil), fz = z + dz;
    if (!blocked(fx, fy, fz)) { x = fx; y = fy; z = fz; }
    else {
      // the surface's normal, out into the water: down the slope of the field that stopped the step, taken where the
      // body touches (a thick body: at each of its sides that is in rock)
      const h = 0.3, rk = meBlocked(fx, fy, fz, R); let fd = rockD, sg = -1;
      let nx = 0, ny = 0, nz = 0;
      const lean = (px, py, pz) => { const gx = fd(px + h, py, pz) - fd(px - h, py, pz), gy = fd(px, py + h, pz) - fd(px, py - h, pz), gz = fd(px, py, pz + h) - fd(px, py, pz - h), l = sg / (hypot(gx, gy, gz) || 1); nx += gx * l; ny += gy * l; nz += gz * l; };
      if (rk && (R <= 0.6 || rockD(fx, fy, fz) > -0.45)) lean(fx, fy, fz);
      if (rk && R > 0.6) {
        if (inRock(fx + R, fy, fz)) lean(fx + R, fy, fz); if (inRock(fx - R, fy, fz)) lean(fx - R, fy, fz);
        if (inRock(fx, fy + R, fz)) lean(fx, fy + R, fz); if (inRock(fx, fy - R, fz)) lean(fx, fy - R, fz);
        if (inRock(fx, fy, fz + R)) lean(fx, fy, fz + R); if (inRock(fx, fy, fz - R)) lean(fx, fy, fz - R);
      }
      if (noseR(fx, fy, fz)) lean(fx + hx, fy + hy, fz + hz);
      fd = shipD; sg = 1;
      if (!rk && body(fx, fy, fz)) lean(fx, fy, fz);
      if (noseS(fx, fy, fz)) lean(fx + hx, fy + hy, fz + hz);
      const nl = hypot(nx, ny, nz), sx = fx - x, sy = fy - y, sz = fz - z, sl = hypot(sx, sy, sz);
      let slid = 0;
      if (nl > 1e-5 && sl > 1e-6) {
        nx /= nl; ny /= nl; nz /= nl;
        const into = min(0, sx * nx + sy * ny + sz * nz);
        let px = sx - nx * into, py = sy - ny * into, pz = sz - nz * into, pl = hypot(px, py, pz);
        // (head on: up along the wall, as far as the wall is one)
        const ul = sqrt(max(0, 1 - ny * ny)), lack = 0.4 * sl - pl;
        if (lack > 0 && ul > 0.3) { px -= nx * ny / ul * lack; py += ul * lack; pz -= nz * ny / ul * lack; pl = hypot(px, py, pz); }
        // (a little off the surface, and further off where it is rough)
        if (pl > 1e-6) for (let off = 0.004; off < 0.2 && !slid; off *= 5) {
          const qx = min(x + px + nx * off, SHOREX), qy = clamp(y + py + ny * off, floorY, ceil), qz = z + pz + nz * off;
          if (!blocked(qx, qy, qz)) { x = qx; y = qy; z = qz; slid = 1; b.v *= 1 - min(1, dt * 3 * max(0, 1 - pl / sl)); }
        }
      }
      // (a corner the slide does not fit into: each direction of the step by itself, where it is free)
      if (!slid) {
        if (!blocked(fx, y, z)) x = fx; else hit++;
        if (!blocked(x, fy, z)) y = fy; else hit++;
        if (!blocked(x, y, fz)) z = fz; else hit++;
        b.v *= 1 - min(1, dt * 4 * hit);
      }
    }
    // (already in rock, say after a viewpoint key: let it out the way it is heading)
    if (hit === 3 && inRock(b.x, b.y, b.z)) { x = b.x + dx; y = clamp(b.y + dy, floorY, ceil); z = b.z + dz; }
    // (the nose turned into a wall: the body is pushed back from it, as fast as a turn can bring the nose in)
    { const px = x + hx, py = y + hy, pz = z + hz, inR = rockD(px, py, pz) > NR, fd = inR ? rockD : shipD;
      if (inR || shipD(px, py, pz) < SN) {
        const h = 0.3, gx = fd(px + h, py, pz) - fd(px - h, py, pz), gy = fd(px, py + h, pz) - fd(px, py - h, pz), gz = fd(px, py, pz + h) - fd(px, py, pz - h), k = (inR ? -1 : 1) * (HL * top + 1) * dt / (hypot(gx, gy, gz) || 1);
        const qx = min(x + gx * k, SHOREX), qy = clamp(y + gy * k, floorY, ceil), qz = z + gz * k;
        if (!body(qx, qy, qz)) { x = qx; y = qy; z = qz; }
      } }
    b.x = x; b.y = y; b.z = z;
    b.ph += dt * c.freq * (0.3 + 0.7 * abs(b.v) / c.spd) * (b.v < 0 ? -0.6 : 1);
  }
  // The camera: behind the creature along the view and a little above it. Where rock is in the way of that place it
  // rides higher instead (straight above, if it comes to that), and only then nearer; never inside the animal.
  // The mouse wheel moves it in and out (meZoom): all the way in it sits over the animal's head.
  // The line to it is checked from a point clear of the floor the animal may be standing on.
  const zoom = max(meZoom, 0.12), far = meFar(b.s) * zoom, up = (c.len * 0.3 + 0.25) * min(1, zoom + 0.3), lift = max(0.55, c.len * 0.14); let bk = -1, tx = 0, ty = 0, tz = 0;
  const cyaw = meCamY ?? vyaw, cpit = meCamP ?? vpit;
  for (const el of [-1.35, 0.3, 0.65, 1.0, 1.4]) {
    const e2 = max(-cpit, el), ce = cos(e2), ox = -sin(cyaw) * ce, oy = sin(e2), oz = cos(cyaw) * ce;
    let k = 1; for (let i = 1; i <= 12; i++) { const q = i / 12; if (rockD(b.x + ox * far * q, b.y + lift + (up - lift) * q + oy * far * q, b.z + oz * far * q) > -0.35) { k = (i - 1) / 12; break; } }
    if (k >= bk) { bk = k; const kk = max(k, 0.3); tx = b.x + ox * far * kk; ty = min(b.y + lift + (up - lift) * kk + oy * far * kk, -0.6); tz = b.z + oz * far * kk; }
    if (k > 0.8) break;
  }
  // the body as the camera must stay out of it: its line from nose to tail, its up, and its thickness with room for
  // the near plane of the view (which cuts into anything closer than some 0.2 m)
  const cpB = cos(b.pit), fxB = cos(b.yaw) * cpB, fyB = sin(b.pit), fzB = sin(b.yaw) * cpB, uxB = -sin(b.pit) * cos(b.yaw), uyB = cpB, uzB = -sin(b.pit) * sin(b.yaw);
  const byB = b.s === CRAB ? b.y + c.len * 0.24 : b.y, high = c.high || 0.17, clear = high * c.len * 1.15 + 0.24;
  if (meZoom < 0.12) { // over the head: above the back, and as far forward as still leaves the head in the view below
    const q = meZoom / 0.12, at = min(c.len * 0.2, c.len * 0.5 - clear * 2.25), hx = b.x + fxB * at + uxB * clear, hy = byB + fyB * at + uyB * clear, hz = b.z + fzB * at + uzB * clear;
    tx = mix(hx, tx, q); ty = min(mix(hy, ty, q), -0.3); tz = mix(hz, tz, q);
  }
  { // never inside the animal: pushed out from its line, upwards where there is no other way to tell
    const rx = tx - b.x, ry = ty - byB, rz = tz - b.z, al = clamp(rx * fxB + ry * fyB + rz * fzB, -c.len * 0.5, c.len * 0.5);
    let ox = rx - fxB * al, oy = ry - fyB * al, oz = rz - fzB * al; const d = hypot(ox, oy, oz), wide = b.s === CRAB ? c.len * 0.55 + 0.24 : clear;
    if (d < wide) { if (d < 0.01) { ox = uxB; oy = uyB; oz = uzB; } else { ox /= d; oy /= d; oz /= d; } if (oy < 0.3) { oy = 0.3; const l = hypot(ox, oy, oz); ox /= l; oy /= l; oz /= l; } tx = b.x + fxB * al + ox * wide; ty = min(byB + fyB * al + oy * wide, -0.3); tz = b.z + fzB * al + oz * wide; }
  }
  // never under the floor: out of the rock upwards, if it still ended up in it
  for (let i = 0; i < 12 && rockD(tx, ty, tz) > -0.25; i++) ty += 0.3;
  const e = min(1, dt * 10);
  F[CX] += (tx - F[CX]) * e; F[CY] += (ty - F[CY]) * e; F[CZ] += (tz - F[CZ]) * e;
  F[VX] = cos(b.yaw) * cos(b.pit) * b.v; F[VY] = sin(b.pit) * b.v; F[VZ] = sin(b.yaw) * cos(b.pit) * b.v;
}

// ---------------------------------------------------------------- survival
// The creature in play has health (meHP, 0..1). It runs down by itself, slowly: seven minutes from full to nothing.
// Food brings it back, a bite takes a piece of it away, and at nothing the creature dies and the player comes back
// as a new one of the same kind. The left mouse button (held: again and again) is what the mouth is for:
//   a hunter bites - a creature it can eat (eats(), creatures.js) within reach of its mouth is eaten whole;
//   the fry and the chromis pick plankton from the water, the whale strains it while it swims;
//   the crab strikes another crab that is close with its claws - a struck crab fights back, either may lose a claw
//   (it grows back in time), a beaten one lies on its back and can be eaten - and where no crab is
//   near it picks food from the floor.
// Hunters that catch the player bite it; among themselves the bots eat what they catch.
// A fight of crabs (the same numbers are in the servers, for a fight between players: server/src/sea.js and
// server/openresty/sea.lua): a strike takes STRIKE of the other's health, less with one claw gone, and shoves it
// back; a crab that holds its claws up (the gurgle button) takes BLOCK of that and keeps its claws, but cannot
// strike meanwhile; a strike that is not blocked tears a claw off once in CLAWP times. A beaten crab - the player's
// too - lies on its back for DOWN seconds: eaten by then it dies, left alone it gets up with a quarter of its health.
// A crab that got up has lost both claws; a lost claw grows back in CLAWT seconds, one at a time. A crab's new life
// begins weak, so that the eaten one does not come straight back at its wounded winner: a third of its health and
// one claw.
// REACH: how far apart two crabs may be for a strike to land, middle to middle, 0.53 m: the claws' tips are 0.83 of
// a shell's width (0.31 m) ahead of the middle (meshCrab, creatures.js), so two crabs face to face have their claws
// on each other's, and a crab turned away is reached on its shell. And the claws are at the front: the other crab has to be ahead (FRONT: the cosine of how far
// off the crab's heading it may be). A crab that strikes or holds its claws up turns to where the view looks.
const STRIKE = 0.14, STRIKE1 = 0.085, BLOCK = 0.3, CLAWP = 0.1, DOWN = 8, SHOVE = 1.5, CLAWT = 45, REACH = CRIT[CRAB].len * 1.42, FRONT = 0.64;
let meHP = 1, meLost = 0, meActT = 0, meHeld = 0, meAway = false, meMsg = '', meMsgT = 0, meHurtT = -9, meCause = '', meDown = 0, meKX = 0, meKZ = 0, meClawT = 0;
// is crab o ahead of crab b, where its claws are?
const ahead = (b, o) => { const dx = o.x - b.x, dz = o.z - b.z, d = hypot(dx, dz); return d < 0.05 || (cos(b.yaw) * dx + sin(b.yaw) * dz) / d > FRONT; };
// (a claw back: of two lost, either)
const growClaw = (l) => (l === 3 ? (Math.random() < 0.5 ? 1 : 2) : 0);
const meBlocks = () => me && me.s === CRAB && me.gur && meLost !== 3 && meDown <= 0;
// the player's crab is beaten: onto its back
function meBeaten(by) { meHP = 0.02; meDown = DOWN; me.dead = 1; me.v = 0; meKX = meKZ = 0; for (const b of bots) b.anger = 0; meSay('Beaten by ' + by + ' · on your back'); }
// a strike shoves the struck one away from (x, z)
const shove = (b, x, z) => { const dx = b.x - x, dz = b.z - z, d = hypot(dx, dz) || 1; return [dx / d * SHOVE, dz / d * SHOVE]; };
const loseClaw = (l) => l | (l & 1 ? 2 : l & 2 ? 1 : Math.random() < 0.5 ? 1 : 2);
const sfx = [], fx = (k, s) => { if (sfx.length < 8) sfx.push([k, s]); }; // (sounds for audio.js to make; 'bite' with the species whose bite it is)
const meSay = (t) => { meMsg = t; meMsgT = 4; };
const aName = (s) => 'a ' + CRITNAME[s].toLowerCase();
const meFeed = (k) => { meHP = min(1, meHP + k); };
// one frame of it; true if the creature died and a new one took its place
function meLifeStep(dt) {
  meActT -= dt; meMsgT -= dt; meHurtT -= dt;
  // (on its back it does not starve; left alone it gets up)
  if (meDown > 0) { meDown -= dt; if (meDown <= 0 && meHP > 0) { meHP = 0.25; me.dead = 0; meLost = 3; meClawT = 0; meSay('Back on your feet · both claws lost'); } } else meHP -= dt / (POPK < 1 ? 840 : 420); // (few creatures to eat: it drains half as fast)
  if (meLost && meDown <= 0) { if ((meClawT += dt) >= CLAWT) { meClawT = 0; meLost = growClaw(meLost); meSay(meLost ? 'A claw has grown back' : 'Both claws are back'); } } else meClawT = 0;
  if (meHP <= 0) {
    meDown = 0; meKX = meKZ = 0;
    const s = me.s, why = meHurtT > -1.5 && meCause ? meCause : 'Starved';
    for (const b of bots) if (b.tgt === me) { b.tgt = null; b.mode = 0; b.cool = brr(8, 14); }
    const i = bots.indexOf(me); if (i >= 0) { bots[i] = bots[bots.length - 1]; bots.pop(); } me = null;
    meHP = s === CRAB ? 0.3 : 0.6; meLost = s === CRAB ? (Math.random() < 0.5 ? 1 : 2) : 0; meClawT = 0; meStamina = 1; meCause = ''; meSync(); meSay(why + ' · a new ' + CRITNAME[s].toLowerCase() + ' now'); fx('hurt');
    return true;
  }
  if (meHeld && meDown <= 0) meAct();
  return false;
}
function meHurt(d, s) { if (!me || meAway) return; meHP -= d; meHurtT = 0; meCause = 'Eaten by ' + aName(s); meSay('Bitten by ' + aName(s)); fx('hurt'); }
// a hunter has caught up with its prey
function botBite(a, t) {
  a.snap = 0.28;
  if (t.net) return; // (another player: its own browser's bots see to it)
  if (t.me) { if (!meAway) fx('bite', a.s); meHurt(clamp(0.16 + 0.07 * CRIT[a.s].len / CRIT[t.s].len, 0.2, 0.55), a.s); if (meHP <= 0) meCause = 'Eaten by ' + aName(a.s); }
  else t.gone = true;
}
function crabStrikesBack(b) {
  if (meAway) return;
  const blk = meBlocks();
  meHurt((b.lost ? STRIKE1 : STRIKE) * 0.5 * (blk ? BLOCK : 1), CRAB); meCause = 'Beaten by a crab'; meSay(blk ? 'Blocked a crab\'s strike' : 'Struck by a crab');
  [meKX, meKZ] = shove(me, b.x, b.z);
  if (!blk && Math.random() < CLAWP && meLost !== 3) { meLost = loseClaw(meLost); meSay('Lost a claw'); }
  if (meHP <= 0) meBeaten('a crab');
  fx('bite', CRAB);
}
// the left mouse button
function meAct() {
  if (!me || meActT > 0 || meDown > 0 || meBlocks()) return; // (a crab with its claws up is blocking: no strike)
  meActT = 0.55; me.snap = 0.28; const c = CRIT[me.s];
  if (me.s === CRAB) {
    // the nearest crab within reach; one that stands (not a beaten one, to be eaten) has to be ahead, at the claws
    let o = null, od = REACH, side = false;
    for (const b of bots) if (b !== me && b.s === CRAB && !b.gone) { const d = hypot(b.x - me.x, b.y - me.y, b.z - me.z); if (d < od) { if (b.dead || ahead(me, b)) { od = d; o = b; } else side = true; } }
    if (!o && side) { if (meLost !== 3) meSay('Turn your claws to it'); return; }
    // (another player's crab: the server sees to the strike, and to the meal if that one lies beaten)
    if (o && o.net) { fx(o.dead ? 'nibble' : 'bite', CRAB); if (meLost === 3 && !o.dead) { meSay('No claws to strike with'); return; } netSend({ t: 'bite', to: o.id }); if (!o.dead) meSay((o.gur && o.lost !== 3 ? 'Blocked by ' : 'Struck ') + (o.name || 'a crab')); return; }
    if (o && o.dead) { o.gone = true; meFeed(0.45); meSay('Ate the beaten crab'); fx('nibble'); fx('eat'); }
    else if (o) {
      if (meLost === 3) { meSay('No claws to strike with'); return; }
      const blk = o.gur && (o.lost || 0) !== 3; // (it had its claws up)
      fx('bite', CRAB); o.hp = (o.hp === undefined ? 1 : o.hp) - (meLost ? STRIKE1 : STRIKE) * (blk ? BLOCK : 1); o.anger = 8; o.rw = o.rt = 0; o.gur = false;
      [o.kx, o.kz] = shove(o, me.x, me.z);
      if (o.hp <= 0) { o.dead = DOWN; o.anger = 0; o.v = 0; o.kx = o.kz = 0; meSay('Crab beaten · eat it'); }
      else if (!blk && Math.random() < CLAWP && (o.lost || 0) !== 3) { o.lost = loseClaw(o.lost || 0); meSay('Tore off its claw'); }
      else if (blk) meSay('The crab blocked it');
    } else if (me.mode === 0) { meFeed(0.05); fx('nibble'); }
    return;
  }
  fx('bite', me.s);
  if (me.s === WHALE) { if (abs(me.v) > c.spd * 0.3) meFeed(0.03); return; }
  if (me.s === 1 || me.s === 2) { meFeed(0.035); return; }
  const m = gurMouth(me); let p = null, pd = 1e9;
  for (const b of bots) if (b !== me && !b.gone && eats(me.s, b.s)) { const d = hypot(b.x - m[0], b.y - m[1], b.z - m[2]) - CRIT[b.s].len * 0.5; if (d < 0.3 + c.len * 0.12 && d < pd) { pd = d; p = b; } }
  if (p && p.net) { netSend({ t: 'bite', to: p.id }); meSay('Bit ' + (p.name || aName(p.s))); return; } // (another player: the server decides, net.js)
  if (p) { fx('eat'); p.gone = true; meFeed(clamp(0.1 + 0.6 * CRIT[p.s].len / c.len, 0.1, 0.5)); meSay('Ate ' + aName(p.s)); }
}
