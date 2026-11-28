// ============================================================================
// the creatures: ten species, their figures and their meshes
// ============================================================================
// Everything swims nose first along +x, y up, and is one unit long (the crab: one unit across its shell); the
// instance scales it to the species' length in metres. A vertex's aux (the normal's w, as code / 127) says what it
// belongs to, and the shader paints by that (W_CRIT in shaders.js):
//   100 body, 101 fin, 102 eye, 103 pale parts (the whale's flippers, the crab's claw fingers), 104 knobs,
//   105 fin tips, 106 the whale's flippers, 107 / 108 the plates of the crab's tail, 109 the crab's claws (114: their
//   dark finger tips), 115 the shark's lower teeth,
//   110 fins of the species' second fin colour (the tuna's dark ones beside its yellow ones), 111 the iris of an eye,
//   112 the lower jaw, 113 the floor of the mouth (the jaw's upper side): the shader swings these about the jaw's hinge
//   10..89: the crab's walking legs, leg number * 10 + how far out along the leg (0..9)

// real: the animal's real length in metres (the crab: the width of its shell), the figure shown to a player.
// The world of the game is bigger than life: its manta is 7-10 m across (8.4 m on average) where an oceanic manta
// averages 4.5 m, so everything here is drawn GSCALE = 8.4 / 4.5 times life size (len, metres in the game).
// spd: cruising speed, m/s (a dash is 1.8 times that); turn: rad/s; mode: 0 the tail beats side to side,
// 1 up and down, 2 walks; amp, freq, wave: the swimming wave (height, beats, how many radians along the body)
// top, bot: the depths it keeps between; floor: 1 stays close over the bottom; near: how many may be around the camera
const GSCALE = 8.4 / 4.5;
const CRIT = [
  { id: 'crab', real: 0.26, spd: 0.6, turn: 2.5, mode: 2, amp: 0, freq: 7, wave: 0, top: 3, bot: 170, floor: 1, near: 14 },
  { id: 'fry', real: 0.06, spd: 1.6, turn: 3.2, mode: 0, amp: 0.1, freq: 13, wave: 7, top: 2, bot: 50, floor: 0, near: 10 },
  { id: 'chromis', real: 0.09, spd: 2.1, turn: 2.8, mode: 0, amp: 0.09, freq: 11, wave: 6.5, top: 4, bot: 70, floor: 1, near: 6 },
  { id: 'perch', real: 0.45, spd: 2.7, turn: 2.2, mode: 0, amp: 0.085, freq: 8.5, wave: 6, top: 8, bot: 170, floor: 1, near: 4 },
  { id: 'barracuda', real: 1.3, spd: 3.4, turn: 1.9, mode: 0, amp: 0.07, freq: 7, wave: 5.5, top: 3, bot: 120, floor: 0, near: 3 },
  { id: 'grouper', real: 1.8, spd: 3.8, turn: 1.4, mode: 0, amp: 0.075, freq: 5, wave: 5, top: 15, bot: 320, floor: 1, near: 2 },
  { id: 'tuna', real: 2.0, spd: 4.8, turn: 1.3, mode: 0, amp: 0.06, freq: 6.5, wave: 4, top: 5, bot: 330, floor: 0, near: 3 },
  { id: 'dolphin', real: 2.8, spd: 6.5, turn: 1.5, mode: 1, amp: 0.075, freq: 5, wave: 4.5, top: 1.5, bot: 60, floor: 0, near: 3 },
  { id: 'shark', real: 4.6, spd: 5.5, turn: 0.9, mode: 0, amp: 0.085, freq: 3.2, wave: 4.5, top: 5, bot: 420, floor: 0, near: 2 },
  { id: 'whale', real: 16.5, spd: 3.2, turn: 0.22, mode: 1, amp: 0.06, freq: 1.4, wave: 3.8, top: 9, bot: 600, floor: 0, near: 1 },
];
for (const c of CRIT) c.len = c.real * GSCALE;
// Mouths. A fish's (and the shark's) lower jaw is a piece of its own, cut from the underside of the head along the
// line y = y0 + sl * (0.5 - x) between x = hx (the hinge) and x1 (the mouth's front; 0.5 = the tip of the snout). ext:
// how far the jaw juts past the snout; ang: how wide it opens, radians. The shader paints the lips along the same line.
// chin: the height of the chin at x1. The jaw is the wedge between the mouth's line and the line from the hinge to
// the chin: nothing at the hinge, the whole chin at the front. The rest of the head's underside stays where it is.
const JAWS = [null,
  { hx: 0.455, x1: 0.5, y0: -0.002, sl: -0.1, ext: 0, ang: 0.4, chin: -0.012 }, { hx: 0.465, x1: 0.5, y0: -0.006, sl: -0.15, ext: 0, ang: 0.45, chin: -0.018 }, { hx: 0.4, x1: 0.5, y0: -0.012, sl: -0.25, ext: 0.004, ang: 0.4, chin: -0.2 },
  { hx: 0.37, x1: 0.5, y0: -0.012, sl: -0.03, ext: 0.012, ang: 0.3, chin: -0.09 }, { hx: 0.355, x1: 0.5, y0: -0.018, sl: -0.28, ext: 0.012, ang: 0.4, chin: -0.056 }, { hx: 0.405, x1: 0.5, y0: -0.004, sl: -0.3, ext: 0.005, ang: 0.3, chin: -0.016 },
  null, null, null];
// The shark's mouth is not at the tip of its snout but under it: a crescent on the underside of the head, its bow
// towards the snout (xf: its front on the middle line), its corners behind (xh, at z = +-zc). The lower jaw is the
// plate inside the crescent, hinged along the line between the corners (yp: the height the shader swings it about).
const SHARKM = { xh: 0.385, xf: 0.447, zc: 0.05, yp: -0.046, ang: 0.42 };
const CRAB = 0, DOLPHIN = 7, WHALE = 9;
// how much further than the others a species' gurgle carries (heard, audio.js, and answered, bots.js): a dolphin's
// whistle twice, a whale's song three times as far
const gurFar = (s) => (s === WHALE ? 3 : s === DOLPHIN ? 2 : 1);
// who can eat whom: nothing longer than 60% of its own length; the whale eats no one
const eats = (a, b) => a !== b && a !== WHALE && CRIT[b].len <= CRIT[a].len * 0.6;

// ---------------------------------------------------------------- mesh helpers
const C_ = (code) => code / 127;
// a body: a row of elliptical sections [x, half-width, half-height, y offset]
function cLoft(m, S, seg, code) {
  const rings = [], n = S.length, a = C_(code);
  for (let k = 0; k < n; k++) {
    const q = S[k], ring = [];
    for (let s = 0; s < seg; s++) { const an = s / seg * TAU; ring.push(m.v(q[0], (q[3] || 0) + sin(an) * q[2], cos(an) * q[1], a)); }
    rings.push(ring);
  }
  for (let k = 0; k < n - 1; k++) for (let s = 0; s < seg; s++) { const s2 = (s + 1) % seg; m.quad(rings[k][s], rings[k + 1][s], rings[k + 1][s2], rings[k][s2]); }
  const f = S[0], l = S[n - 1], cf = m.v(f[0] + f[1] * 0.5, f[3] || 0, 0, a), cl = m.v(l[0] - l[1] * 0.5, l[3] || 0, 0, a);
  for (let s = 0; s < seg; s++) { m.tri(cf, rings[0][s], rings[0][(s + 1) % seg]); m.tri(cl, rings[n - 1][(s + 1) % seg], rings[n - 1][s]); }
}
// a thin fin: a fan over a flat outline of points [x, y, z, tip?]
function cFin(m, pts, code = 101, tip = 105) {
  let cx = 0, cy = 0, cz = 0; const n = pts.length;
  for (const p of pts) { cx += p[0] / n; cy += p[1] / n; cz += p[2] / n; }
  const c = m.v(cx, cy, cz, C_(code)); let first = 0, prev = 0;
  for (let i = 0; i < n; i++) { const v = m.v(pts[i][0], pts[i][1], pts[i][2], C_(pts[i][3] ? tip : code)); if (i) m.tri(c, prev, v); else first = v; prev = v; }
  m.tri(c, prev, first);
}
// a small blob, x along the body, at height y, pushed out to the side by z
function cBlob(m, x, y, z, r, code, flat = 1) { const n0 = m.p.length / 3; cLoft(m, [[x + r, r * 0.5 * flat, r * 0.5, y], [x, r * flat, r, y], [x - r, r * 0.5 * flat, r * 0.5, y]], 6, code); for (let k = n0; k < m.p.length / 3; k++) m.p[k * 3 + 2] += z; }
// smooths a short list of hand-placed sections into n (Catmull-Rom)
function cSections(K, n) {
  const out = [], m = K.length - 1;
  for (let j = 0; j < n; j++) {
    const f = j / (n - 1) * m, i = min(floor(f), m - 1), u = f - i, a = K[max(i - 1, 0)], b = K[i], c = K[i + 1], d = K[min(i + 2, m)], q = [];
    for (let o = 0; o < 4; o++) q.push(0.5 * (2 * b[o] + (c[o] - a[o]) * u + (2 * a[o] - 5 * b[o] + 4 * c[o] - d[o]) * u * u + (3 * b[o] - a[o] - 3 * c[o] + d[o]) * u * u * u));
    q[1] = max(q[1], 0.002); q[2] = max(q[2], 0.002);
    out.push(q);
  }
  return out;
}
// the top (sign 1) or bottom (-1) of a sectioned body at x, and its half-width there
function cEdge(S, x, sign) { for (let k = 0; k < S.length - 1; k++) if (x <= S[k][0] && x >= S[k + 1][0]) { const u = (S[k][0] - x) / (S[k][0] - S[k + 1][0]); return mix(S[k][3] + sign * S[k][2], S[k + 1][3] + sign * S[k + 1][2], u); } return 0; }
function cSide(S, x) { for (let k = 0; k < S.length - 1; k++) if (x <= S[k][0] && x >= S[k + 1][0]) { const u = (S[k][0] - x) / (S[k][0] - S[k + 1][0]); return mix(S[k][1], S[k + 1][1], u); } return 0; }
// eyes: plain dark ones, or with iris > 0 a pale iris that size with the dark pupil sitting on it
function cEyes(m, S, x, yk, r, iris = 0) {
  const y = cEdge(S, x, 1) * yk, z = cSide(S, x) * 0.86;
  // (a fish's eye lies nearly flat in the side of its head: a shallow dome, the pupil a shallower one on it)
  for (const s of [-1, 1]) { if (iris) { cBlob(m, x, y, (z + iris * 0.1) * s, iris, 111, 0.3); cBlob(m, x, y, (z + iris * 0.28) * s, r, 102, 0.3); } else cBlob(m, x, y, z * s, r, 102); }
}

// ---------------------------------------------------------------- the species
// a fin along the back (sign 1) or the belly (-1) from x0 back to x1: its edge stands h(t) off the body, t = 0..1
// along it; spikes > 0 notches the edge between that many spines
function cRowFin(m, S, x0, x1, h, n, sign = 1, code = 101, tip = 105, spikes = 0) {
  if (spikes) n = spikes * 2;
  let pb = 0, pe = 0;
  for (let i = 0; i <= n; i++) {
    const t = i / n, x = mix(x0, x1, t), e = cEdge(S, x, sign) - sign * 0.01, hh = h(t) * (spikes && (i & 1) === 0 && i > 0 && i < n ? 0.62 : 1);
    const vb = m.v(x, e, 0, C_(code)), ve = m.v(x - hh * 0.25, e + sign * (hh + 0.01), 0, C_(hh > 0.6 * h(0.5) ? tip : code));
    if (i) m.quad(pb, vb, ve, pe);
    pb = vb; pe = ve;
  }
}
// a pair of fins on the flanks: an outline [x, y, how far out] for the right one, mirrored for the left
// (the fin's root, its first and last point, is set a little inside the body's surface at that very height, so the
// fin grows out of the flank wherever on it the root is; the other points stand off from there)
function cPair(m, S, pts, code = 101, tip = 105) {
  const n = pts.length - 1, r0 = cRoot(S, pts[0][0], pts[0][1]), r1 = cRoot(S, pts[n][0], pts[n][1]);
  for (const s of [-1, 1]) cFin(m, pts.map((p, i) => (i === 0 ? [p[0], r0[0], r0[1] * s] : i === n ? [p[0], r1[0], r1[1] * s] : [p[0], p[1], (r0[1] + p[2]) * s, p[3]])), code, tip);
}
// a point just inside the body's surface at x, at height y (brought within the body if it is above or below it): [y, z]
function cRoot(S, x, y) {
  let q = S[0]; for (let k = 0; k < S.length - 1; k++) if (x <= S[k][0] && x >= S[k + 1][0]) { const u = (S[k][0] - x) / (S[k][0] - S[k + 1][0]); q = [0, 1, 2, 3].map((o) => mix(S[k][o], S[k + 1][o], u)); }
  const t = clamp((y - q[3]) / q[2], -0.93, 0.93);
  return [q[3] + t * q[2], q[1] * sqrt(1 - t * t) * 0.88];
}
// a tail fin: upright, from the stalk at x = -0.39 out to its two tips at height th; fork: how deep the notch is
// (0 a straight edge, below 0 a rounded fan); sweep: how far back the tips reach
function cTail(m, S, th, fork, sweep, code = 101, tip = 105) {
  const pt = cEdge(S, -0.39, 1), pb = cEdge(S, -0.39, -1), xe = -0.5, pts = [[-0.385, pt, 0]];
  if (fork < 0) { for (let i = 0; i <= 8; i++) { const a = (i / 8 - 0.5) * 2.5; pts.push([-0.465 - 0.04 * cos(a), -sin(a) / sin(1.25) * th, 0, i > 1 && i < 7 ? 1 : 0]); } }
  else pts.push([xe - sweep, th, 0, 1], [xe - sweep * 0.3 + fork * 0.03, th * 0.55, 0], [xe + fork * 0.075, 0, 0], [xe - sweep * 0.3 + fork * 0.03, -th * 0.55, 0], [xe - sweep, -th, 0, 1]);
  pts.push([-0.385, pb, 0]);
  cFin(m, pts, code, tip);
}

// The shark's lower jaw (SHARKM): a skin over the underside of the head inside the crescent of the mouth (112), lying
// on the head's own surface while shut; over it, inside the head, the floor of the mouth (113), and between the two
// along the crescent a low wall, the row of teeth (115) - so that swung down it is a solid jaw and not a flap.
function cSharkJaw(m, S) {
  const M = SHARKM;
  for (let k = 0; k < S.length - 1; k++) if (S[k][0] > M.xh - 0.02 && S[k][0] - S[k + 1][0] > 0.013) { const a = S[k], b = S[k + 1]; S.splice(k + 1, 0, [0, 1, 2, 3].map((o) => (a[o] + b[o]) / 2)); k--; }
  const at = (x) => { for (let k = 0; k < S.length - 1; k++) if (x <= S[k][0] && x >= S[k + 1][0]) { const u = (S[k][0] - x) / (S[k][0] - S[k + 1][0]); return [0, 1, 2, 3].map((o) => mix(S[k][o], S[k + 1][o], u)); } return S[0]; };
  const NU = 12, NV = 5, skin = [], floor = [], wall = [];
  for (let u = 0; u <= NU; u++) {
    const z = M.zc * (2 * u / NU - 1), xa = M.xf - (M.xf - M.xh) * (z / M.zc) ** 2, rs = [], rf = [];
    for (let v = 0; v <= NV; v++) {
      const x = mix(M.xh, xa, v / NV), q = at(x), c = clamp(z / q[1], -0.98, 0.98), dy = -sqrt(1 - c * c) * q[2];
      rs.push(m.v(x, q[3] + dy * 1.006, z * 1.006, C_(112)));
      rf.push(m.v(x, q[3] + dy + 0.007 * v / NV + 0.012 * sin(v / NV * PI) + 0.001, z * 0.97, C_(113)));
      if (v === NV) wall.push([m.v(x, q[3] + dy * 1.006, z * 1.006, C_(115)), m.v(x, q[3] + dy + 0.008, z * 0.97, C_(115))]);
    }
    skin.push(rs); floor.push(rf);
  }
  for (let u = 0; u < NU; u++) {
    for (let v = 0; v < NV; v++) { m.quad(skin[u][v], skin[u + 1][v], skin[u + 1][v + 1], skin[u][v + 1]); m.quad(floor[u][v], floor[u + 1][v], floor[u + 1][v + 1], floor[u][v + 1]); }
    m.quad(wall[u][0], wall[u + 1][0], wall[u + 1][1], wall[u][1]);
  }
}
// The lower jaw of species sp: a skin laid over the underside of the head, from the mouth's line down, between the
// hinge and the mouth's front. Shut, it is the head's own surface (a hair's breadth outside it); swung down by the
// shader, it uncovers the underside of the head, which is painted as the inside of the mouth there.
// (S gets more sections along the head first, so the jaw and the head under it are smooth: call before the loft.)
function cJaw(m, S, sp) {
  const j = JAWS[sp], my = (x) => j.y0 + j.sl * (0.5 - x), hy = my(j.hx), low = (x) => hy + (x - j.hx) * (j.chin - hy) / (j.x1 - j.hx);
  for (let k = 0; k < S.length - 1; k++) if (S[k][0] > j.hx - 0.02 && S[k][0] - S[k + 1][0] > 0.013) { const a = S[k], b = S[k + 1]; S.splice(k + 1, 0, [0, 1, 2, 3].map((o) => (a[o] + b[o]) / 2)); k--; }
  const at = (x) => { for (let k = 0; k < S.length - 1; k++) if (x <= S[k][0] && x >= S[k + 1][0]) { const u = (S[k][0] - x) / (S[k][0] - S[k + 1][0]); return [0, 1, 2, 3].map((o) => mix(S[k][o], S[k + 1][o], u)); } return S[0]; };
  const xs = []; for (let i = 0; i <= 10; i++) xs.push(mix(min(j.x1, S[0][0]), j.hx, i / 10));
  // Each ring: down the left flank from the mouth's line to the wedge's lower line, then up the right flank. Where
  // the lower line is under the head (towards the front) the two meet under the chin; further back they stay apart
  // and the head's own underside shows between them, untouched. The skin lies on the head's surface exactly, so
  // shut, with the same colour and the same light, it cannot be told from the head.
  const R = [], K = 5;
  for (const x of xs) {
    const q = at(x), st = clamp((my(x) - q[3]) / q[2], -0.98, 0.98), sl = clamp((low(x) - q[3]) / q[2], -1, st), ring = [];
    const put = (an) => ring.push(m.v(x, q[3] + sin(an) * q[2] * 1.006, cos(an) * q[1] * 1.006, C_(112)));
    for (let i = 0; i <= K; i++) put(mix(PI - Math.asin(st), PI - Math.asin(sl), i / K));
    for (let i = 0; i <= K; i++) put(mix(TAU + Math.asin(sl), TAU + Math.asin(st), i / K));
    R.push(ring);
  }
  for (let k = 0; k < R.length - 1; k++) for (let i = 0; i < 2 * K + 1; i++) if (i !== K) m.quad(R[k][i], R[k + 1][i], R[k + 1][i + 1], R[k][i + 1]);
  // Its top is closed by the floor of the mouth, from one edge to the other at the height of the mouth's line (with
  // vertices of its own, so the skin's shading is not touched). Shut, it is inside the head; open, the jaw is a
  // solid wedge and not a loose flap.
  let pa = 0, pb = 0;
  for (let k = 0; k < R.length; k++) {
    const x = xs[k], q = at(x), st = clamp((my(x) - q[3]) / q[2], -0.98, 0.98), y = q[3] + st * q[2] * 0.985 - 0.001, z = sqrt(1 - st * st) * q[1] * 0.985;
    const va = m.v(x, y, -z, C_(113)), vb = m.v(x, y, z, C_(113));
    if (k) m.quad(pa, va, vb, pb);
    pa = va; pb = vb;
  }
  // its front: closed to a point, which juts out past the snout by ext
  const q0 = at(xs[0]), tip = m.v(xs[0] + max(j.ext, 0.003), my(xs[0]) - (j.x1 < 0.49 ? q0[2] * 0.3 : 0.004), 0, C_(112));
  for (let i = 0; i < 2 * K + 1; i++) m.tri(tip, R[0][i], R[0][i + 1]);
}

// Малёк: a slender silver schooling fish (an anchovy, a silverside): one short fin mid-back, a forked tail
function meshFry() {
  const m = new Mesh(), S = cSections([[0.5, 0.006, 0.008, 0], [0.44, 0.03, 0.042, 0], [0.3, 0.05, 0.085, 0], [0.1, 0.055, 0.1, 0], [-0.1, 0.045, 0.085, 0], [-0.28, 0.025, 0.045, 0], [-0.4, 0.012, 0.022, 0]], 16);
  cJaw(m, S, 1);
  cLoft(m, S, 12, 100);
  cTail(m, S, 0.1, 1.1, 0.02);
  cRowFin(m, S, 0.04, -0.09, (t) => 0.055 * sin(PI * pow(t, 0.6)), 4);
  cRowFin(m, S, -0.16, -0.3, (t) => 0.035 * sin(PI * pow(t, 0.6)), 4, -1);
  cPair(m, S, [[0.24, -0.03, 0], [0.12, -0.075, 0.04, 1], [0.16, -0.025, 0]]);
  cEyes(m, S, 0.4, 0.2, 0.011, 0.02);
  return m;
}
// Хромис (a blue-green chromis, a damselfish): a deep oval body, a small mouth, one long fin down the whole back
// (low and spiny in front, taller behind), a deeply forked tail with pointed lobes
function meshChromis() {
  const m = new Mesh(), S = cSections([[0.5, 0.01, 0.012, 0], [0.45, 0.035, 0.07, 0], [0.35, 0.06, 0.16, 0], [0.18, 0.075, 0.225, 0], [0, 0.07, 0.22, 0], [-0.18, 0.05, 0.15, 0], [-0.32, 0.025, 0.07, 0], [-0.4, 0.012, 0.035, 0]], 18);
  cJaw(m, S, 2);
  cLoft(m, S, 14, 100);
  cTail(m, S, 0.17, 1.6, 0.045);
  cRowFin(m, S, 0.27, -0.06, (t) => 0.05 + 0.02 * t, 6, 1, 101, 105, 7);
  cRowFin(m, S, -0.07, -0.31, (t) => 0.06 * sin(PI * pow(t, 0.6)) + 0.012, 6);
  cRowFin(m, S, -0.04, -0.3, (t) => 0.055 * sin(PI * pow(t, 0.6)) + 0.01, 6, -1);
  cPair(m, S, [[0.2, -0.03, 0], [0.04, -0.07, 0.07, 1], [0.12, 0.0, 0]]);
  cPair(m, S, [[0.17, -0.17, 0], [0.07, -0.26, 0.015, 1], [0.11, -0.18, 0]]);
  cEyes(m, S, 0.39, 0.3, 0.016, 0.03);
  return m;
}
// Окунь (a sea perch, a rockfish): a big head with a big eye and mouth, a spiny fin with separate spines down the
// back and a rounded soft one behind it, broad fan-like pectorals, a square-cut tail
function meshPerch() {
  const m = new Mesh(), S = cSections([[0.5, 0.015, 0.02, -0.012], [0.44, 0.05, 0.075, -0.006], [0.34, 0.085, 0.14, 0], [0.2, 0.1, 0.175, 0.005], [0.02, 0.09, 0.165, 0.005], [-0.16, 0.065, 0.12, 0.003], [-0.3, 0.035, 0.065, 0], [-0.4, 0.02, 0.042, 0]], 18);
  cJaw(m, S, 3);
  cLoft(m, S, 14, 100);
  cTail(m, S, 0.14, 0.25, 0.0);
  cRowFin(m, S, 0.25, -0.1, (t) => 0.1 * sin(PI * pow(t, 0.5)) * (1 - 0.35 * t) + 0.015, 6, 1, 101, 105, 9);
  cRowFin(m, S, -0.11, -0.31, (t) => 0.095 * sin(PI * pow(t, 0.6)) + 0.012, 6);
  cRowFin(m, S, -0.1, -0.29, (t) => 0.08 * sin(PI * pow(t, 0.55)) + 0.01, 5, -1);
  cPair(m, S, [[0.24, -0.04, 0], [0.12, -0.13, 0.1, 1], [0.03, -0.06, 0.12, 1], [0.15, 0.0, 0]]);
  cPair(m, S, [[0.2, -0.15, 0], [0.08, -0.26, 0.02, 1], [0.12, -0.16, 0]]);
  cEyes(m, S, 0.38, 0.42, 0.018, 0.034);
  return m;
}
// Барракуда: a long tube of a fish; a long pointed head, the lower jaw jutting past the upper; two small fins far
// apart on the back, the second over the anal fin; a forked tail
function meshBarracuda() {
  const m = new Mesh(), S = cSections([[0.5, 0.005, 0.006, -0.014], [0.45, 0.016, 0.02, -0.008], [0.38, 0.03, 0.036, -0.002], [0.28, 0.043, 0.053, 0], [0.1, 0.052, 0.064, 0], [-0.08, 0.05, 0.062, 0], [-0.24, 0.038, 0.048, 0], [-0.35, 0.022, 0.03, 0], [-0.41, 0.014, 0.022, 0]], 22);
  cJaw(m, S, 4);
  cLoft(m, S, 12, 100);
  cTail(m, S, 0.1, 1.2, 0.03);
  cRowFin(m, S, 0.07, -0.01, (t) => 0.06 * sin(PI * pow(t, 0.4)) + 0.004, 4);
  cRowFin(m, S, -0.2, -0.29, (t) => 0.062 * sin(PI * pow(t, 0.4)) + 0.004, 4);
  cRowFin(m, S, -0.2, -0.29, (t) => 0.058 * sin(PI * pow(t, 0.4)) + 0.004, 4, -1);
  cPair(m, S, [[0.27, -0.025, 0], [0.19, -0.06, 0.03, 1], [0.22, -0.02, 0]]);
  cPair(m, S, [[0.08, -0.06, 0], [0.01, -0.105, 0.01, 1], [0.03, -0.062, 0]]);
  cEyes(m, S, 0.385, 0.3, 0.008, 0.015);
  return m;
}
// Групер: heavy and oblong; a huge head (a third of the fish) with a wide mouth and a heavy lower jaw; one long fin
// down the back, spiny in front; big rounded pectorals; a rounded tail
function meshGrouper() {
  const m = new Mesh(), S = cSections([[0.5, 0.03, 0.03, -0.022], [0.45, 0.075, 0.075, -0.016], [0.36, 0.11, 0.125, -0.006], [0.22, 0.125, 0.165, 0], [0.05, 0.12, 0.17, 0.003], [-0.12, 0.095, 0.145, 0.003], [-0.27, 0.06, 0.095, 0], [-0.36, 0.036, 0.062, 0], [-0.41, 0.028, 0.052, 0]], 20);
  cJaw(m, S, 5);
  cLoft(m, S, 16, 100);
  cTail(m, S, 0.13, -0.5, 0);
  cRowFin(m, S, 0.2, -0.1, (t) => 0.06 + 0.012 * sin(PI * t), 6, 1, 101, 101, 10);
  cRowFin(m, S, -0.11, -0.34, (t) => 0.085 * sin(PI * pow(t, 0.7)) + 0.012, 6, 1, 101, 101);
  cRowFin(m, S, -0.14, -0.33, (t) => 0.075 * sin(PI * pow(t, 0.7)) + 0.01, 5, -1, 101, 101);
  cPair(m, S, [[0.2, -0.05, 0], [0.1, -0.15, 0.1], [0.0, -0.13, 0.13], [-0.02, -0.05, 0.12], [0.1, 0.01, 0]], 101, 101);
  cPair(m, S, [[0.18, -0.15, 0], [0.07, -0.25, 0.03], [0.1, -0.16, 0]], 101, 101);
  cEyes(m, S, 0.37, 0.55, 0.011, 0.02);
  return m;
}
// Тунец (a yellowfin): a spindle; a spiny first fin on the back, then a tall sickle and a row of finlets, the same
// below; long pectorals; a thin keeled stalk and a tall crescent tail. The sickles and finlets are yellow (101),
// the rest dark (110).
function meshTuna() {
  const m = new Mesh(), S = cSections([[0.5, 0.004, 0.006, -0.006], [0.47, 0.014, 0.02, -0.006], [0.43, 0.027, 0.037, -0.006], [0.38, 0.043, 0.059, -0.007], [0.31, 0.064, 0.088, -0.009], [0.22, 0.086, 0.118, -0.011], [0.12, 0.098, 0.134, -0.012], [0, 0.094, 0.126, -0.01], [-0.12, 0.076, 0.1, -0.006], [-0.24, 0.048, 0.062, -0.002], [-0.33, 0.024, 0.028, 0], [-0.385, 0.016, 0.012, 0], [-0.41, 0.018, 0.009, 0]], 30);
  cJaw(m, S, 6);
  cLoft(m, S, 14, 100);
  cTail(m, S, 0.17, 1.6, 0.05, 110, 110);
  cRowFin(m, S, 0.2, 0.0, (t) => 0.11 * pow(1 - t, 1.5) * min(1, t * 9 + 0.35) + 0.006, 8, 1, 110, 110); // tall in front, falling away in a hollow curve
  for (const sg of [1, -1]) {
    const x0 = sg > 0 ? 0.01 : -0.03, e = cEdge(S, x0, sg) - sg * 0.01;
    cFin(m, [[x0, e, 0], [x0 - 0.06, e + sg * 0.1, 0], [x0 - 0.15, e + sg * 0.19, 0, 1], [x0 - 0.1, e + sg * 0.085, 0], [x0 - 0.08, cEdge(S, x0 - 0.08, sg) - sg * 0.01, 0]], 101, 101);
    for (let i = 0; i < 8; i++) { const x = x0 - 0.115 - i * 0.031, y = cEdge(S, x, sg) - sg * 0.004; cFin(m, [[x, y, 0], [x - 0.028, y + sg * 0.022, 0], [x - 0.024, y, 0]], 101, 101); }
  }
  cPair(m, S, [[0.2, -0.02, 0], [0.02, -0.055, 0.035], [0.15, -0.05, 0]], 110, 110);
  cPair(m, S, [[0.19, -0.125, 0], [0.12, -0.19, 0.008], [0.14, -0.13, 0]], 110, 110);
  cEyes(m, S, 0.405, 0.2, 0.008, 0.014);
  return m;
}
function meshDolphin() {
  const m = new Mesh();
  const S = cSections([[0.5, 0.01, 0.01, -0.012], [0.45, 0.024, 0.022, -0.012], [0.405, 0.036, 0.034, -0.008], [0.375, 0.07, 0.078, 0.006], [0.3, 0.098, 0.104, 0.004], [0.16, 0.116, 0.124, 0], [0, 0.114, 0.122, 0], [-0.15, 0.092, 0.102, 0.002], [-0.28, 0.058, 0.072, 0.004], [-0.38, 0.028, 0.042, 0.006], [-0.44, 0.014, 0.02, 0.006], [-0.47, 0.008, 0.01, 0.006]], 26);
  cLoft(m, S, 16, 100);
  cFin(m, [[-0.44, 0.006, 0], [-0.455, 0.006, 0.05], [-0.53, 0.006, 0.15, 1], [-0.5, 0.006, 0.06], [-0.49, 0.006, 0], [-0.5, 0.006, -0.06], [-0.53, 0.006, -0.15, 1], [-0.455, 0.006, -0.05]], 101, 101);
  cFin(m, [[0.04, cEdge(S, 0.04, 1) * 0.92, 0], [-0.06, cEdge(S, -0.06, 1) + 0.085, 0], [-0.13, cEdge(S, -0.13, 1) + 0.105, 0, 1], [-0.1, cEdge(S, -0.1, 1) * 0.92, 0]], 101, 101);
  cPair(m, S, [[0.24, -0.07, 0], [0.14, -0.15, 0.08], [0.07, -0.2, 0.12, 1], [0.15, -0.08, 0]], 101, 101);
  cEyes(m, S, 0.345, 0.12, 0.013);
  return m;
}
function meshShark() {
  const m = new Mesh();
  const S = cSections([[0.5, 0.008, 0.008, -0.01], [0.46, 0.03, 0.024, -0.008], [0.4, 0.062, 0.05, -0.004], [0.3, 0.096, 0.086, 0], [0.18, 0.116, 0.11, 0], [0.05, 0.116, 0.114, 0], [-0.1, 0.094, 0.098, 0.002], [-0.25, 0.058, 0.068, 0.006], [-0.36, 0.03, 0.04, 0.01], [-0.42, 0.016, 0.022, 0.012]], 26);
  cSharkJaw(m, S);
  cLoft(m, S, 16, 100);
  cFin(m, [[-0.41, 0.034, 0], [-0.52, 0.19, 0, 1], [-0.5, 0.11, 0], [-0.455, 0.02, 0], [-0.485, -0.1, 0, 1], [-0.41, -0.01, 0]], 101, 101);
  cFin(m, [[0.1, cEdge(S, 0.1, 1) * 0.92, 0], [-0.02, cEdge(S, -0.02, 1) + 0.13, 0, 1], [-0.045, cEdge(S, -0.04, 1) + 0.03, 0], [-0.06, cEdge(S, -0.06, 1) * 0.92, 0]], 101, 101);
  cFin(m, [[-0.26, cEdge(S, -0.26, 1) * 0.9, 0], [-0.31, cEdge(S, -0.31, 1) + 0.03, 0, 1], [-0.33, cEdge(S, -0.33, 1) * 0.9, 0]], 101, 101);
  cFin(m, [[-0.24, cEdge(S, -0.24, -1) * 0.9, 0], [-0.3, cEdge(S, -0.3, -1) - 0.03, 0, 1], [-0.32, cEdge(S, -0.32, -1) * 0.9, 0]], 101, 101);
  cPair(m, S, [[0.22, -0.055, 0], [0.1, -0.13, 0.13], [0.0, -0.17, 0.22, 1], [0.1, -0.06, 0]], 101, 101);
  cEyes(m, S, 0.4, 0.25, 0.008);
  return m;
}
// a humpback: a long flat-topped head over a deep lower jaw, knobs on the snout and chin, flippers a third of the
// body long with a scalloped front edge, a low fin on a hump two thirds back, broad flukes with a ragged edge
function meshWhale() {
  const m = new Mesh();
  const S = cSections([[0.5, 0.02, 0.012, -0.004], [0.47, 0.045, 0.026, -0.01], [0.42, 0.068, 0.045, -0.02], [0.36, 0.086, 0.066, -0.026], [0.29, 0.1, 0.086, -0.022], [0.21, 0.108, 0.1, -0.012], [0.1, 0.11, 0.108, -0.002],
    [-0.02, 0.1, 0.104, 0.002], [-0.15, 0.078, 0.086, 0.008], [-0.27, 0.05, 0.06, 0.012], [-0.36, 0.028, 0.038, 0.016], [-0.42, 0.015, 0.022, 0.018], [-0.455, 0.009, 0.012, 0.018]], 30);
  cLoft(m, S, 18, 100);
  // flukes: flat, swept back to pointed tips, a notch in the middle, a ragged trailing edge
  const y = 0.018, half = [[-0.445, 0.035], [-0.458, 0.075], [-0.48, 0.125], [-0.508, 0.168], [-0.54, 0.2], [-0.532, 0.16], [-0.518, 0.128], [-0.525, 0.1], [-0.511, 0.075], [-0.518, 0.05], [-0.505, 0.025]], fl = [[-0.425, y, 0]];
  for (const h of half) fl.push([h[0], y, h[1]]);
  fl.push([-0.494, y, 0]);
  for (let k = half.length - 1; k >= 0; k--) fl.push([half[k][0], y, -half[k][1]]);
  cFin(m, fl);
  const d1 = cEdge(S, -0.21, 1), d2 = cEdge(S, -0.25, 1);
  cFin(m, [[-0.14, cEdge(S, -0.14, 1) * 0.96, 0], [-0.19, d1 + 0.022, 0], [-0.222, d1 + 0.034, 0], [-0.228, d2 + 0.012, 0], [-0.25, d2 * 0.96, 0]]);
  // flippers: long narrow paddles, a third of the body, from low on the flank out and back; knobs scallop the front edge
  for (const s of [-1, 1]) {
    let pl = 0, pt = 0;
    for (let i = 0; i <= 12; i++) {
      const t = i / 12, cx = mix(0.19, -0.05, pow(t, 1.25)), cy = mix(-0.055, -0.15, t), cz = mix(0.055, 0.385, t), w = 0.062 * pow(1 - t, 0.55) * (0.75 + 0.25 * sin(PI * min(1, t * 2.2))) + 0.004;
      const vl = m.v(cx + w * (0.62 + 0.1 * sin(t * 26)), cy, cz * s, C_(106)), vt = m.v(cx - w * 0.38, cy, cz * s, C_(106));
      if (i) m.quad(pl, vl, vt, pt);
      pl = vl; pt = vt;
    }
  }
  for (let k = 0; k < 5; k++) { const kx = 0.47 - k * 0.032; cBlob(m, kx, cEdge(S, kx, 1) + 0.002, 0, 0.0075, 104); }
  for (let k = 0; k < 4; k++) { const sx = 0.45 - k * 0.036, sz = cSide(S, sx) * 0.62; for (const s of [-1, 1]) cBlob(m, sx, cEdge(S, sx, 1) * 0.72, sz * s, 0.0068, 104); }
  for (let k = 0; k < 3; k++) { const cx = 0.47 - k * 0.03; cBlob(m, cx, cEdge(S, cx, -1) - 0.001, 0, 0.0065, 103); }
  cEyes(m, S, 0.235, -0.44, 0.0095);
  return m;
}
function meshCrab() {
  const m = new Mesh(), S = [], N = 12;
  // the shell is wider (z) than long: a flattened dome
  for (let k = 0; k < N; k++) { const a = k / (N - 1) * PI, r = sin(a); S.push([cos(a) * 0.3, max(0.46 * pow(r, 0.7), 0.01), max(0.13 * pow(r, 0.8), 0.006), 0.02 * r]); }
  cLoft(m, S, 14, 100);
  let leg = 1;
  for (const s of [-1, 1]) {
    // the walking legs come out from under the rim of the shell, close together, and fan out: the first leans
    // forward, the last back. Each is thick where it leaves the body, rises to a knee and comes down to a pointed foot.
    for (let i = 0; i < 4; i++, leg++) {
      const x0 = 0.1 - i * 0.095, an = [0.42, 0.1, -0.3, -0.72][i], dx = sin(an), dz = cos(an) * s, L = leg;
      const at = (d, y) => [x0 + dx * d, y, 0.26 * s + dz * d];
      m.tube([at(0, -0.075), at(0.17, -0.065), at(0.33, 0.03), at(0.44, -0.07), at(0.5, -0.24)], (j) => [0.05, 0.048, 0.04, 0.027, 0.006][j], 7, true, (j) => C_(L * 10 + [0, 2, 5, 7, 9][j]));
    }
    // The claw: an arm out from under the front corner of the shell to the elbow and on to the wrist; a hand that
    // swells into a deep palm and points forward and in; a fixed finger that runs on from the palm's lower edge and
    // a moving one hinged on its top, arched over the first - both dark at the tips. An eye on a stalk.
    const wr = [0.46, 0.02, 0.52 * s];
    m.tube([[0.2, -0.04, 0.3 * s], [0.27, -0.02, 0.44 * s], [0.33, 0.0, 0.53 * s], wr], (j) => [0.05, 0.06, 0.058, 0.054][j], 7, true, () => C_(109));
    m.tube([wr, [0.54, 0.03, 0.455 * s], [0.62, 0.035, 0.37 * s], [0.68, 0.03, 0.3 * s]], (j) => [0.064, 0.086, 0.082, 0.055][j], 8, true, () => C_(109));
    m.tube([[0.66, 0.005, 0.32 * s], [0.73, -0.012, 0.245 * s], [0.79, -0.008, 0.185 * s], [0.83, 0.006, 0.15 * s]], (j) => [0.04, 0.03, 0.02, 0.005][j], 6, true, (j) => C_(j < 2 ? 109 : 114));
    m.tube([[0.655, 0.05, 0.325 * s], [0.72, 0.08, 0.25 * s], [0.79, 0.065, 0.185 * s], [0.835, 0.03, 0.148 * s]], (j) => [0.036, 0.03, 0.02, 0.005][j], 6, true, (j) => C_(j < 2 ? 109 : 114));
    m.tube([[0.27, 0.06, 0.09 * s], [0.31, 0.15, 0.1 * s]], (j) => 0.014 + j * 0.008, 5, true, () => C_(102));
  }
  // the tail: a flap of plates folded forward under the body and pressed to the shell's underside, each narrower
  // than the one before and lapping over the next. [x, y, half-width, half-thickness]
  const TP = [[-0.285, -0.046, 0.15, 0.014], [-0.24, -0.084, 0.17, 0.014], [-0.17, -0.106, 0.15, 0.013], [-0.09, -0.118, 0.12, 0.012], [-0.01, -0.122, 0.085, 0.011], [0.06, -0.119, 0.04, 0.009]];
  for (let k = 0; k < TP.length - 1; k++) {
    const a = TP[k], b = TP[k + 1], tl = hypot(b[0] - a[0], b[1] - a[1]), nx = -(b[1] - a[1]) / tl, ny = (b[0] - a[0]) / tl, code = C_(107 + (k & 1)), TN = 10;
    const ring = (p, w, t) => { const r = []; for (let s = 0; s < TN; s++) { const an = s / TN * TAU; r.push(m.v(p[0] + nx * sin(an) * t, p[1] + ny * sin(an) * t, cos(an) * w, code)); } return r; };
    const r0 = ring(a, a[2], a[3]), r1 = ring(b, (a[2] + b[2]) / 2, (a[3] + b[3]) / 2), end = m.v(b[0], b[1], 0, code);
    for (let s = 0; s < TN; s++) { const s1 = (s + 1) % TN; m.quad(r0[s], r0[s1], r1[s1], r1[s]); m.tri(end, r1[s], r1[s1]); }
  }
  return m;
}
// the ten meshes, in the order of CRIT
// (each species also gets `high`: how far its back stands over its middle line around the head, in body lengths -
// the camera over the head and the animal's shadow are sized by it)
const critMeshes = () => [meshCrab(), meshFry(), meshChromis(), meshPerch(), meshBarracuda(), meshGrouper(), meshTuna(), meshDolphin(), meshShark(), meshWhale()].map((m, s) => {
  let h = 0.05; for (let k = 0; k < m.p.length; k += 3) if (m.p[k] > 0.1 && m.p[k] < 0.4 && abs(m.p[k + 2]) < 0.2) h = max(h, m.p[k + 1]);
  CRIT[s].high = h; return m.build();
});
