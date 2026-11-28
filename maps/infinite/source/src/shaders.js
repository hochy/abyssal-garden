// ============================================================================
// WGSL sources
// ============================================================================

const W_NOISE = /*wgsl*/`
fn ss(a: f32, b: f32, x: f32) -> f32 { let t = clamp((x - a) / (b - a), 0., 1.); return t * t * (3. - 2. * t); }
fn h31(p: vec3f) -> f32 { var q = fract(p * vec3f(.1031, .1030, .0973)); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
fn h33(p: vec3f) -> vec3f { var q = fract(p * vec3f(.1031, .1030, .0973)); q += dot(q, q.yxz + 33.33); return fract((q.xxy + q.yxx) * q.zyx); }
fn vn(p: vec3f) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3. - 2. * f);
  return mix(mix(mix(h31(i), h31(i + vec3f(1., 0., 0.)), u.x), mix(h31(i + vec3f(0., 1., 0.)), h31(i + vec3f(1., 1., 0.)), u.x), u.y),
             mix(mix(h31(i + vec3f(0., 0., 1.)), h31(i + vec3f(1., 0., 1.)), u.x), mix(h31(i + vec3f(0., 1., 1.)), h31(i + vec3f(1., 1., 1.)), u.x), u.y), u.z);
}
fn fbm(p: vec3f, n: i32) -> f32 {
  var a = .5; var s = 0.; var q = p;
  for (var i = 0; i < n; i++) { s += a * vn(q); q = q * 2.03 + vec3f(17.1, 31.7, 5.3); a *= .5; }
  return s / (1. - 2. * a);
}
fn wor(p: vec3f) -> f32 {
  let i = floor(p); let f = fract(p); var d = 9.;
  for (var x = -1; x <= 1; x++) { for (var y = -1; y <= 1; y++) { for (var z = -1; z <= 1; z++) {
    let o = vec3f(f32(x), f32(y), f32(z)); let r = o + h33(i + o) - f; d = min(d, dot(r, r));
  } } }
  return sqrt(d);
}
`;

// ---------------------------------------------------------------- the sea's profile (see math.js)
const SEA_WGSL = /*wgsl*/`
fn sm01(t: f32) -> f32 { let c = clamp(t, 0., 1.); return c * c * (3. - 2. * c); }
fn deepS(x: f32) -> f32 { return clamp((-x - ${DEEP0}.) / ${DEEPW}., 0., 1.); }
fn seaBase(x: f32) -> f32 { return ${SEA0} + ${SHOREH}. * sm01((x - ${SHORE0}.) / ${SHOREW}.) - ${DEEPH}. * sm01(deepS(x)); }
fn deepK(x: f32) -> f32 { return clamp((${SEA0} - seaBase(x)) / 150., 0., 1.); }
fn shoreK(x: f32) -> f32 { return sm01((x - ${SHORE0}.) / ${SHOREW}.); }
fn slopeK(x: f32) -> f32 { let s = deepS(x); return 4. * s * (1. - s); }
fn plainK(x: f32) -> f32 { return sm01((deepS(x) - .8) / .2); }
fn gorgeK(x: f32) -> f32 { return sm01(1. - (abs(x - (${GORX}.)) - 80.) / 80.); }
fn riftE(x: f32) -> f32 { return ${RIFE}. * sm01(1. - (abs(x - (${RIFX}.)) - ${RHW}.) / ${RTW}.); }
fn bandH(x: f32) -> f32 { return 60. + riftE(x); }
fn gridBase(x: f32) -> f32 { return seaBase(x) - 10.5 - 10. * deepK(x) - 14. * slopeK(x) - 34. * gorgeK(x) - riftE(x); }
`;

// ---------------------------------------------------------------- terrain density (compute)
const W_DENS = W_NOISE + SEA_WGSL + /*wgsl*/`
// n: block size in voxels and the first z slice of this dispatch; b: world voxel index of the block's corner (x, z, y)
struct U { n: vec4u, b: vec4i, c: vec4u };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read_write> D: array<f32>;
@group(0) @binding(2) var<storage, read> P: array<vec4f>;
fn smax(a: f32, b: f32, k: f32) -> f32 { let h = max(k - abs(a - b), 0.) / k; return max(a, b) + h * h * k * .25; }
fn smin(a: f32, b: f32, k: f32) -> f32 { return -smax(-a, -b, k); }
fn seg2(p: vec2f, a: vec2f, b: vec2f) -> f32 { let pa = p - a; let ba = b - a; let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0., 1.); return length(pa - ba * h); }
fn seg3(p: vec3f, a: vec3f, b: vec3f) -> f32 { let pa = p - a; let ba = b - a; let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0., 1.); return length(pa - ba * h); }
fn dens(p: vec3f) -> f32 {
  let w = vec3f(fbm(p * .04 + 11., 3), fbm(p * .04 + 47., 3), fbm(p * .04 + 83., 3)) - .5;
  let q = p + w * vec3f(15., 6., 15.);
  // --- the sea floor. On the shelf (home) it rolls gently; each zone of the profile shapes it its own way:
  let dk = deepK(q.x); let sk = shoreK(q.x); let sl = slopeK(q.x); let pl = plainK(q.x);
  var g0 = seaBase(q.x) + 7. * (1. - .55 * sk) * (1. - .7 * pl) * (fbm(vec3f(q.xz * .011, 3.), 4) - .5) + 1.6 * (1. - .75 * sk) * (1. - .5 * pl) * (fbm(vec3f(q.xz * .07, 9.), 3) - .5);
  // shore: sand bars lying along the coast, with troughs between them
  g0 += ss(.2, .55, sk) * 1.5 * sin(q.x * .075 + 2.2 * sin(q.z * .011) + 1.3 * sin(q.z * .0037));
  // slope: canyons running down it (a ridged noise across the slope marks their beds), and between them the
  // slope steps down in terraces
  let cz = q.z * .0042 + .35 * sin(q.x * .0021);
  let can = ss(.72, .97, 1. - abs(2. * fbm(vec3f(cz, 4.7, .3), 3) - 1.));
  let tr = q.x * .024 + 3. * fbm(vec3f(q.xz * .006, 7.), 2);
  g0 += sl * (3.5 * (ss(.3, .7, fract(tr)) - fract(tr)) * (1. - can) - 14. * can);
  // abyssal plain: flat sediment with long low hills lying across it, here and there a knoll
  g0 += pl * (15. * (fbm(vec3f(q.x * .0065, q.z * .0022, 14.), 3) - .5)
    + 24. * ss(.34, .04, wor(vec3f(q.xz * .0046, 3.3))) * ss(.56, .68, fbm(vec3f(q.xz * .0016, 51.), 2)));
  // the gorge (math.js): its bed winds, widens and narrows and is deeper in places; the distance to it is jostled
  // by a noise that changes with height too, so the walls bulge, overhang and step back
  let gc = ${GORX}. + 26. * sin(q.z * .0071 + 1.3) + 13. * sin(q.z * .019) + 6. * sin(q.z * .047 + 2.);
  let gd = abs(q.x - gc) - 7. - 9. * fbm(vec3f(q.z * .012, 3.3, 8.), 2) + 9. * (fbm(p * vec3f(.06, .09, .06) + 31., 3) - .5);
  let gk = ss(5., 0., gd);
  g0 -= ${GORD}. * (.72 + .28 * sin(q.z * .0093 + .6) * sin(q.z * .0031)) * gk;
  // the rift (math.js): 200 m down. It narrows towards its bed, steps out in ledges every 30 m or so, and its walls
  // are pushed about by a slow noise (bulges, overhangs) and a finer one
  let rdep = ${RIFD}. * (.82 + .18 * sin(q.z * .0061 + 2.) * sin(q.z * .0023));
  let rh = clamp((p.y - seaBase(q.x) + rdep) / rdep, 0., 1.);
  let rwid = (8. + 12. * fbm(vec3f(q.z * .009, 5.1, 2.), 2)) * (.45 + .55 * rh) + 4. * (ss(.4, .6, fract(p.y * .031 + 2. * fbm(vec3f(q.z * .01, 1., 7.), 2))) - .5);
  let rgd = abs(q.x - (${RIFX}.) - 6. * sin(q.z * .011 + .7) - 4. * sin(q.z * .027)) - rwid
    + 12. * (fbm(p * vec3f(.035, .05, .035) + 57., 3) - .5) + 5. * (fbm(p * .11 + 13., 2) - .5);
  let rk2 = ss(6., 0., rgd);
  g0 -= rdep * rk2;
  let tn = 3. * (fbm(vec3f(q.xz * .09, 2.), 3) - .5);
  var dm = -1e3; var de = 1e3;
  var k = 0u;
  for (var i = 0u; i < u.c.x; i++) {
    let a = P[k]; let b = P[k + 1u]; k += 2u;
    let yr = clamp((p.y - g0) / (b.y - g0), 0., 1.3);
    var e = seg2(q.xz, a.xy, a.zw) - b.x;
    e -= b.z * ss(.3, .92, yr) + 3. * (1. - yr) * (1. - yr) - b.w * ss(.0, .5, yr) * (1. - ss(.5, 1., yr));
    dm = smax(dm, smin(-e, b.y + tn - p.y, 3.), 2.5);
    de = min(de, e);
  }
  var clr = 0.;
  let kc = (u.c.x + u.c.y + u.c.z) * 2u;
  for (var i = 0u; i < u.c.w; i++) {
    let a = P[kc + i * 2u]; let b = P[kc + i * 2u + 1u];
    clr = max(clr, 1. - ss(0., b.y, seg2(q.xz, a.xy, a.zw) - b.x));
  }
  let n = fbm(vec3f(q.xz * .0125, 1.7), 4);
  // plateaus: rare near the shore (where one breaks the surface it is an islet), lower in the deep
  let po = .1 * sk + .07 * pl;
  let plat = ss(.5 + po, .565 + po, n) * (1. - clr) * (1. - .6 * sl);
  var th = g0 + plat * (26. + 17. * fbm(vec3f(q.xz * .03, 5.), 2)) * (1. - .4 * dk) * (1. - .5 * sl);
  if (gorgeK(q.x) > 0.) { th = min(th, gridBase(q.x) + 52.); } // by the gorge the band is lower: plateaus end under its top
  var d = smax(g0 + 4.5 * ss(10., 0., de) - p.y, dm, 3.);
  d = smax(d, (th - p.y) * .7, 3.);
  k = u.c.x * 2u;
  for (var i = 0u; i < u.c.y; i++) {
    let a = P[k]; let b = P[k + 1u]; k += 2u;
    var r = p + w * 3. - a.xyz;
    let cs = cos(a.w); let sn = sin(a.w);
    r = vec3f(cs * r.x + sn * r.z, r.y / b.z, -sn * r.x + cs * r.z);
    d = smax(d, b.y - length(vec2f(length(r.xy) - b.x, r.z)), 1.5);
  }
  let hg = p.y - g0;
  // rock: worn smooth in the shallows, rough and ledged on the slope, blanketed by sediment on the plain
  let gw = max(4. * gk * (1. - gk), 4. * rk2 * (1. - rk2)); // on the walls of the gorge and the rift: bare rough rock
  let rk = max(mix(.25, 1., ss(.5, 5., hg)), gw) * (1. - .7 * sk) * (1. + .6 * sl) * (1. - .45 * pl);
  d += rk * ((.5 - wor(p * .17 + w * 2.)) * 3.4 + (.5 - wor(p * .41 + 7.)) * 1.3 + (fbm(p * .3, 3) - .5) * 2.2);
  d += rk * 2.2 * (abs(fract(p.y * .21 + w.y * 2.2) - .5) - .25);
  // fields of pillow lava on the plain: the floor swells into rounded lobes
  d += pl * ss(.58, .72, fbm(vec3f(q.xz * .0041, 90.), 2)) * (1. - ss(.5, 5., hg)) * 2.6 * (.42 - wor(p * vec3f(.5, .62, .5)));
  for (var i = 0u; i < u.c.z; i++) {
    let a = P[k]; let b = P[k + 1u]; k += 2u;
    d = smin(d, seg3(p + w * 2., a.xyz, b.xyz) - a.w, 2.);
  }
  // caves in the walls of the gorge and the rift: winding tunnels (where two noises both cross their middle),
  // only in the rock beside the drop, under its rim and above its bed
  let cvz = max(ss(30., 9., gd) * (1. - gk) * ss(-5., -10., hg) * ss(-${GORD}., -${GORD}. + 5., hg - 4.),
    ss(34., 10., rgd) * (1. - rk2) * ss(-6., -12., hg) * ss(.02, .06, rh));
  if (cvz > 0.) {
    let c1 = fbm(p * vec3f(.028, .05, .028) + 71., 2) - .5; let c2 = fbm(p * vec3f(.031, .045, .031) + 19., 2) - .5;
    let m = cvz * ss(.075, .035, abs(c1)) * ss(.085, .04, abs(c2));
    if (d > -4.) { d -= (d + 4.) * m; }
  }
  return min(d, 3. - p.y);
}
// A block is filled a few z slices per dispatch (stream.js spreads them over frames). The position comes from the
// voxel's whole-number index in the world, so a voxel gets exactly the same density whichever block it is part of.
@compute @workgroup_size(4, 4, 4) fn main(@builtin(global_invocation_id) id: vec3u) {
  let z = id.z + u.n.w;
  if (id.x >= u.n.x || id.y >= u.n.y || z >= u.n.z) { return; }
  var d = dens(vec3f(f32(u.b.x + i32(id.x)) * ${VS}, ${OY}. + f32(u.b.z + i32(id.y)) * ${VS}, f32(u.b.y + i32(z)) * ${VS}));
  if (id.y == u.n.y - 1u) { d = -1.; }
  D[id.x + u.n.x * (id.y + u.n.y * z)] = d;
}
`;

// ---------------------------------------------------------------- fullscreen helpers
const W_FS = /*wgsl*/`
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { return vec4f(f32(i32(i & 1u) * 4 - 1), f32(i32(i >> 1u) * 4 - 1), 0., 1.); }
`;

// rock detail texture (tileable): rg = slope, b = height, a = mottling
const W_DETAIL = W_NOISE + W_FS + /*wgsl*/`
fn hp(p: vec2f, per: f32) -> f32 { return h31(vec3f(p - per * floor(p / per), per)); }
fn tn(p: vec2f, per: f32) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3. - 2. * f);
  return mix(mix(hp(i, per), hp(i + vec2f(1., 0.), per), u.x), mix(hp(i + vec2f(0., 1.), per), hp(i + vec2f(1., 1.), per), u.x), u.y);
}
fn tf(uv: vec2f, per: f32, n: i32) -> f32 { var a = .5; var s = 0.; var pr = per; for (var i = 0; i < n; i++) { s += a * tn(uv * pr + f32(i) * 7.3, pr); pr *= 2.; a *= .5; } return s / (1. - 2. * a); }
fn tw(p: vec2f, per: f32) -> vec3f {
  let i = floor(p); let f = fract(p); var d = vec2f(9.); var id = 0.;
  for (var x = -1; x <= 1; x++) { for (var y = -1; y <= 1; y++) {
    let o = vec2f(f32(x), f32(y)); let c = i + o; let cw = c - per * floor(c / per);
    let hh = h33(vec3f(cw, per)); let r = o + hh.xy - f; let l = dot(r, r);
    if (l < d.x) { d.y = d.x; d.x = l; id = hh.z; } else if (l < d.y) { d.y = l; }
  } }
  return vec3f(sqrt(d), id);
}
fn H(uv: vec2f) -> f32 {
  let wq = uv + .11 * (vec2f(tf(uv, 3., 4), tf(uv + .5, 3., 4)) - .5);
  let f = tf(wq, 3., 8);
  let r1 = 1. - abs(tf(wq + 1.7, 5., 6) * 2. - 1.);
  let cr = min(abs(tf(wq + 4.1, 4., 5) * 2. - 1.) * 7., 1.);
  let cr2 = min(abs(tf(wq.yx + 2.3, 9., 4) * 2. - 1.) * 9., 1.);
  let pt = tw(wq * 29., 29.);
  let pit = (1. - ss(.0, .34, pt.x)) * step(.62, pt.z);
  return f * .50 + r1 * r1 * .24 + cr * cr2 * .26 - pit * .07;
}
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = fc.xy / 1024.; let e = 1. / 1024.;
  let h = H(uv);
  let gx = H(uv + vec2f(e, 0.)) - H(uv - vec2f(e, 0.)); let gy = H(uv + vec2f(0., e)) - H(uv - vec2f(0., e));
  let s = clamp(vec2f(gx, gy) * 1024. * .5 * .075, vec2f(-1.), vec2f(1.));
  return vec4f(-s * .5 + .5, h, tf(uv + 3.7, 3., 5));
}
`;

// blit / mip / bloom chain
const W_BLIT = W_FS + /*wgsl*/`
@group(0) @binding(0) var t: texture_2d<f32>;
@group(0) @binding(1) var s: sampler;
fn uvOf(fc: vec4f, k: f32) -> vec2f { return fc.xy * k / vec2f(textureDimensions(t)); }
@fragment fn fsMip(@builtin(position) fc: vec4f) -> @location(0) vec4f { return textureSampleLevel(t, s, uvOf(fc, 2.), 0.); }
fn kar(c: vec3f) -> vec4f { let w = 1. / (1. + max(c.r, max(c.g, c.b))); return vec4f(c * w, w); }
@fragment fn fsDown0(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = uvOf(fc, 2.); let e = 1. / vec2f(textureDimensions(t));
  let a = kar(min(textureSampleLevel(t, s, uv + e * vec2f(-1., -1.), 0.).rgb, vec3f(24.)));
  let b = kar(min(textureSampleLevel(t, s, uv + e * vec2f(1., -1.), 0.).rgb, vec3f(24.)));
  let c = kar(min(textureSampleLevel(t, s, uv + e * vec2f(-1., 1.), 0.).rgb, vec3f(24.)));
  let d = kar(min(textureSampleLevel(t, s, uv + e * vec2f(1., 1.), 0.).rgb, vec3f(24.)));
  let m = a + b + c + d;
  return vec4f(m.rgb / m.a, 1.);
}
@fragment fn fsDown(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = uvOf(fc, 2.); let e = 1. / vec2f(textureDimensions(t));
  return (textureSampleLevel(t, s, uv + e * vec2f(-1., -1.), 0.) + textureSampleLevel(t, s, uv + e * vec2f(1., -1.), 0.)
        + textureSampleLevel(t, s, uv + e * vec2f(-1., 1.), 0.) + textureSampleLevel(t, s, uv + e * vec2f(1., 1.), 0.)) * .25;
}
@fragment fn fsUp(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = uvOf(fc, .5); let e = .75 / vec2f(textureDimensions(t));
  return (textureSampleLevel(t, s, uv + e * vec2f(-1., -1.), 0.) + textureSampleLevel(t, s, uv + e * vec2f(1., -1.), 0.)
        + textureSampleLevel(t, s, uv + e * vec2f(-1., 1.), 0.) + textureSampleLevel(t, s, uv + e * vec2f(1., 1.), 0.)) * .25;
}
`;

// animated water texture: r = caustic, ba = surface slope
const W_WATER = W_FS + /*wgsl*/`
@group(0) @binding(0) var<uniform> tm: vec4f;
fn caus(uv: vec2f, t: f32) -> f32 {
  let p = uv * 6.2831853;
  var i = p; var c = 0.;
  for (var n = 1; n <= 5; n++) {
    let tt = t * (1. - 3.5 / f32(n));
    i = p + vec2f(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    let s = sin(i.x + tt); let k = cos(i.y + tt);
    c += abs(s * k) / (1.25 * sqrt(s * s + k * k) + 1e-4);
  }
  c = 1.17 - pow(c / 5., 1.4);
  return pow(abs(c), 8.);
}
const WK = array<vec3f, 10>(vec3f(1., 2., 1.), vec3f(-2., 1., .9), vec3f(3., 1., .6), vec3f(1., -4., .5), vec3f(4., 3., .4),
  vec3f(-3., 5., .32), vec3f(6., -2., .28), vec3f(5., 7., .2), vec3f(-8., 3., .18), vec3f(2., 11., .14));
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = fc.xy / ${WATER}.; let t = tm.x;
  let c = caus(uv, t * .45 + 23.);
  let wu = uv + .02 * vec2f(sin(6.2831853 * (uv.y * 2. + .1 * t)), cos(6.2831853 * (uv.x * 3. - .07 * t)));
  var s = vec2f(0.);
  for (var i = 0; i < 10; i++) {
    let k = WK[i];
    s += k.xy * k.z * cos(dot(k.xy, wu) * 6.2831853 + t * (.5 + .35 * sqrt(length(k.xy))) * select(-1., 1., (i & 1) == 0) + f32(i) * 1.7);
  }
  return vec4f(c, c, s * .06);
}
`;

// ---------------------------------------------------------------- shared scene code
const S_G = SEA_WGSL + /*wgsl*/`
// xr: lens centre in the view (uv) and comfort vignette strength; xo: the view's viewport origin in its target.
// Both only matter in VR (xr.js); on the desktop they are (.5, .5, 0) and 0.
struct G { vp: mat4x4f, sm: mat4x4f, cam: vec4f, right: vec4f, up: vec4f, fwd: vec4f, sun: vec4f, res: vec4f, mis: vec4f${CSN ? ', cs: array<vec4f, ' + CSN * 2 + '>' : ''}, xr: vec4f, xo: vec4f };
const SIG = vec3f(${WATERQ.sig});
const KD = vec3f(${WATERQ.kd});
const DAYK = vec3f(${DAYQ.sky});
const WCOL = vec3f(${WATERQ.col}) * DAYK;
const KDZ = vec3f(.034, .023, .018);
const PCOL = vec3f(${NAT ? '.44, .66, .92' : '.58, .66, .98'}) * DAYK;
const SUNT = vec3f(${DAYQ.sun}); const SUNC = vec3f(1.7, 1.6, 1.45) * SUNT;
// the natural colours give the light on things back some of the red the water took and take out some green, so
// that sand is sand-coloured and rock is grey and brown, not turquoise (LITK: the sun's light, set for each time of
// day in DAYQ.nat; LITA: the water's)
const LITK = vec3f(${NAT ? DAYQ.nat : '1., 1., 1.'}); const LITA = vec3f(${NAT ? '1.1, .62, .54' : '1., 1., 1.'});
const TAU = 6.2831853;
const LOW = ${LV > 1};
fn sat(x: f32) -> f32 { return clamp(x, 0., 1.); }
fn ss(a: f32, b: f32, x: f32) -> f32 { let t = clamp((x - a) / (b - a), 0., 1.); return t * t * (3. - 2. * t); }
fn ign(p: vec2f) -> f32 { return fract(52.9829189 * fract(dot(p, vec2f(.06711056, .00583715)))); }
fn hs(x: f32) -> f32 { return fract(sin(x * 127.1) * 43758.5453); }
fn kd(z: f32) -> vec3f { return mix(KD, KDZ, z); }
fn sg(z: f32) -> vec3f { return mix(SIG, vec3f(.034, .026, .022) * ${WATERQ.zs}, z); }
fn fin(c: vec3f) -> vec4f { return vec4f(min(max(c, vec3f(0.)), vec3f(40.)), 1.); }
const KDF = vec3f(.043, .045, .042);
fn fogIn(ro: vec3f, rd: vec3f, d: f32, z: f32, sun: vec3f) -> vec3f {
  let k = mix(KD, KDF, z);
  let a = sg(z) - k * rd.y;
  let I = (1. - exp(-a * d)) / a;
  let mu = max(dot(rd, sun), 0.);
  let m2 = mu * mu;
  return mix(WCOL, PCOL, z) * sg(z) * exp(k * ro.y) * I * (1.22 + .3 * m2 * m2);
}
`;

const S_B = S_G + /*wgsl*/`
@group(0) @binding(0) var<uniform> g: G;
@group(0) @binding(1) var sR: sampler;
@group(0) @binding(2) var sC: sampler;
@group(0) @binding(3) var sS: sampler_comparison;
@group(0) @binding(4) var tSh: texture_depth_2d;
@group(0) @binding(5) var tW: texture_2d<f32>;
@group(0) @binding(6) var tD: texture_2d<f32>;
@group(0) @binding(7) var tV: texture_3d<f32>;
@group(0) @binding(8) var tM: texture_2d<f32>;
${GFX[7] ? '@group(0) @binding(9) var tWD: texture_2d_array<f32>; @group(0) @binding(10) var tWS: texture_2d_array<f32>;' : ''}
// the shadow map and the world textures below wrap around: they hold the loaded window of an endless world
// shadow depth: height within a 70 m band that follows the sea floor
// shadow depth: height within the band of voxels (and 4 m over, 6 m under it)
fn shz(p: vec3f) -> f32 { let h = bandH(p.x); return (gridBase(p.x) + (h + 4.) - p.y) / (h + 10.); }
fn shUV(p: vec3f) -> vec3f { let s = g.sm * vec4f(p, 1.); return vec3f(s.x * .5 + .5, .5 - s.y * .5, shz(p) - .0025); }
fn shadow1(p: vec3f) -> f32 { let s = shUV(p); return textureSampleCompareLevel(tSh, sS, s.xy, s.z); }
// The shadows of the creatures (bots.js: botShadows). They move, so they are not in the baked map: each animal is a
// capsule - g.cs holds its two ends, its radius (first w) and how dark it is (second w) - and a point is in its shade
// by how near the sun's ray from the point passes it. The higher the animal swims over the point, the softer and
// (slowly) the fainter the shade: the light under water comes from all around the sun.
fn critSh(p: vec3f) -> f32 {
  var s = 1.;
${CSN ? `  let L = g.sun.xyz;
  for (var i = 0; i < ${CSN}; i++) {
    let a = g.cs[2 * i]; let b = g.cs[2 * i + 1];
    if (a.w <= 0.) { break; }
    let pa = a.xyz - p; let ba = b.xyz - a.xyz;
    let qa = pa - L * dot(pa, L); let qb = ba - L * dot(ba, L);
    let t = sat(-dot(qa, qb) / max(dot(qb, qb), 1e-4));
    let h = dot(pa + ba * t, L);
    if (h > 0.) {
      let d = length(qa + qb * t); let w = a.w * .3 + h * .045;
      s *= 1. - b.w * ss(a.w + w, a.w - w, d) * sat(h / a.w) * a.w / (a.w + h * .02);
    }
  }` : ''}
  return s;
}
fn shadow4(p: vec3f) -> f32 {
  let s = shUV(p); let e = 1.8 / ${SHADOW}.;
  return (textureSampleCompareLevel(tSh, sS, s.xy + vec2f(-e, -e), s.z) + textureSampleCompareLevel(tSh, sS, s.xy + vec2f(e, -e), s.z)
        + textureSampleCompareLevel(tSh, sS, s.xy + vec2f(-e, e), s.z) + textureSampleCompareLevel(tSh, sS, s.xy + vec2f(e, e), s.z)) * .25;
}
fn shadow9(p: vec3f) -> f32 {
  if (LOW) { return shadow1(p); }
  // 4 x 4 taps one texel apart: each tap is already an average over a texel, so together they cover 4 x 4 texels
  // evenly (taps further apart leave strips between them, and the edge of a leaf's shadow comes out as a lattice)
  let s = shUV(p); let e = 1. / ${SHADOW}.; var a = 0.;
  for (var x = 0; x < 4; x++) { for (var y = 0; y < 4; y++) { a += textureSampleCompareLevel(tSh, sS, s.xy + (vec2f(f32(x), f32(y)) - 1.5) * e, s.z); } }
  return a / 16.;
}
fn cuv(p: vec3f) -> vec2f { return p.xz - g.sun.xz * (p.y / g.sun.y); }
// The water texture repeats every few metres, which shows as a lattice on open sand and on the surface. unrep bends
// the coordinates with the (much larger) detail noise and gives a slow change of strength in z; turn rotates a
// second layer off the first one's axes.
fn unrep(q: vec2f) -> vec3f { let n = textureSampleLevel(tD, sR, q * .0067, 0.); let m = textureSampleLevel(tD, sR, q.yx * .019 + .31, 0.); return vec3f(q + (n.rg - .5) * 3.2 + (m.rg - .5) * 1.1, .62 + .76 * m.b); }
fn turn(q: vec2f) -> vec2f { return vec2f(.8 * q.x - .6 * q.y, .6 * q.x + .8 * q.y); }
${GFX[7] ? `// Surface: Waves - the light follows the simulated sea (waves.js). A ray of sunlight that enters the water at x comes
// down at x + a * slope(x), a growing with the depth, so the light at a point is 1 / |det(1 + a * H)|, H the
// curvature of the surface over it: bright lines where the waves focus it. Each cascade is read at a mip that widens
// with the depth (deep down only the larger waves still draw a pattern), and the colours part a little.
fn wcur(q: vec2f, h: f32) -> vec3f {
  var WLV = vec3f(${WL}); var H = vec3f(0.);
  for (var c = 0; c < ${WC}; c++) {
    let lod = log2(max((h * .035 + .35) * ${WN}. / WLV[c], 1.));
    if (lod < 6.) { let u = q / WLV[c]; H += vec3f(textureSampleLevel(tWS, sR, u, c, lod).zw, textureSampleLevel(tWD, sR, u, c, lod).w) * ss(6., 5., lod); }
  }
  return H;
}
fn caus(p: vec3f, d: f32) -> vec3f {
  let h = max(0. - p.y / g.sun.y, 0.); let H = wcur(cuv(p), h);
  let a = (h + 10.) * .42 / sqrt(1. + h * h * .003) * vec3f(.96, 1., 1.04);
  let det = (1. + a * H.x) * (1. + a * H.y) - a * a * H.z * H.z;
  let c = min(.62 + .95 / sqrt(det * det + .1), vec3f(2.8));
  return mix(c, vec3f(.33), ss(35., 100., d));
}
fn caus2(p: vec3f, d: f32) -> f32 { return min(caus(p, d).g, 2.6); }` : `fn caus(p: vec3f, d: f32) -> vec3f {
  let w = unrep(cuv(p)); let q = w.xy;
  let o = vec2f(.004, .0025);
  ${LV > 1 ? 'let a = vec3f(textureSample(tW, sR, q / 3.3).r);' : 'let a = vec3f(textureSample(tW, sR, q / 3.3 + o).r, textureSample(tW, sR, q / 3.3).r, textureSample(tW, sR, q / 3.3 - o).r);'}
  let b = textureSample(tW, sR, turn(q) / 6.9 + .37).r;
  let c = min(pow(a, vec3f(2.3)) * 5. * (.45 + b * 1.3) * w.z, vec3f(4.));
  return mix(c, vec3f(.33), ss(35., 100., d));
}
fn caus2(p: vec3f, d: f32) -> f32 {
  let w = unrep(cuv(p)); let q = w.xy;
  let c = min(pow(textureSample(tW, sR, q / 4.1).r, 1.4) * 2.6 * (.45 + textureSample(tW, sR, turn(q) / 6.9 + .37).r * 1.3) * w.z, 2.6);
  return mix(c, .33, ss(35., 100., d));
}`}
fn sunE(y: f32, z: f32) -> vec3f { return SUNC * LITK * exp(kd(z) * (min(y, 0.) / g.sun.y)) * (.5 + .5 * sat(-y / 30.)); }
// the skylight volume is 60 m tall and follows the sea floor like the voxel band; above and below it the edge layer holds
fn vol(p: vec3f) -> vec4f { return textureSampleLevel(tV, sC, vec3f(p.x / ${SPAN}., clamp((p.y - gridBase(p.x)) / bandH(p.x), .0125, .9875), p.z / ${SPAN}.), 0.); }
fn amb(p: vec3f, n: vec3f, sky: f32, z: f32) -> vec3f {
  let up = n.y * .5 + .5;
  return mix(vec3f(${WATERQ.amb}), vec3f(.34, .56, .82), z) * DAYK * LITA * exp(kd(z) * min(p.y, 0.) * 1.2) * (.3 + .7 * sky) * (.24 + .76 * up * up) * 1.3 * (.55 + .45 * sat(-p.y / 30.)) + vec3f(.003, .010, .016) * (1. + 4. * g.mis.w);
}
fn zone(p: vec3f) -> f32 { return mix(g.sun.w, textureSampleLevel(tM, sC, p.xz / ${SPAN}., 0.).b, .2); }
fn side(p: vec3f, n: vec3f, open: f32, z: f32) -> vec3f { return mix(WCOL, PCOL, z) * exp(kd(z) * min(p.y, 0.)) * open * (1. - abs(n.y)) * .7; }
// skylight at most 150 m along the ray: past that, terrain and the background behind it (vsB) get the same haze
fn fog(c: vec3f, wp: vec3f, z: f32) -> vec3f {
  let v = wp - g.cam.xyz; let d = length(v); let rd = v / d;
  // Past the curtain (100..135 m) a thing no longer shows, and the water in front of it is taken as deep as the
  // open water's behind everything (fsB, 600 m), so it can't stand out against that either. Looking up, the water
  // ends at the surface.
  // Past it everything gets the open water's values (its zone, full skylight) too: what is drawn there, and where
  // the loaded tiles end, cannot be told from the water behind. g.mis.z draws the curtain in (see frame()).
  let cu = ss(100. * g.mis.z, 135. * g.mis.z, d);
  var de = mix(d, 600., cu);
  if (rd.y > 1e-3) { de = min(de, max(-g.cam.y / rd.y, d)); }
  return c * exp(-sg(z) * d) * (1. - cu) + fogIn(g.cam.xyz, rd, de, mix(z, g.sun.w, cu), g.sun.xyz) * (.58 + .42 * mix(vol(g.cam.xyz + rd * min(d, 150.)).g, 1., cu))
    + vec3f(.0007, .0026, .0048) * (g.mis.w * (1. - exp(-.025 * de))); // in the dark of the deep the water itself glows a little: shapes stand out against it
}
fn qrot(q: vec4f, v: vec3f) -> vec3f { return v + 2. * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
// How much of a small thing is there at the distance d, when its kind is drawn up to lim metres (times the draw
// distance in g.mis.z): it grows from nothing over the last quarter of its own range, and that range is between 4/5
// and all of lim by the thing's random number h, so a field of them comes in one by one, not as a front. The draw
// calls leave a cell out at lim (drawPart), where every one of its things has no size left.
fn grow(d: f32, lim: f32, h: f32) -> f32 { let l = lim * g.mis.z * (.8 + .2 * h); return 1. - ss(l * .75, l, d); }
`;

// ---------------------------------------------------------------- solid meshes (terrain, rocks, set pieces, sponges, coral)
const W_SOLID = S_B + /*wgsl*/`
struct VI { @location(0) p: vec3f, @location(1) n: vec4f, @location(2) a: vec4f, @location(3) b: vec4f, @location(4) c: vec4f };
struct VO { @builtin(position) cp: vec4f, @location(0) wp: vec3f, @location(1) n: vec3f, @location(2) op: vec3f, @location(3) on: vec3f,
  @location(4) @interpolate(flat) m: vec4f, @location(5) @interpolate(flat) q: vec4f, @location(6) ao: f32 };
@vertex fn vs(i: VI) -> VO {
  var o: VO;
  var sc = i.a.w;
  if (i.c.x < 1.5 && i.c.z > 1.5 && g.res.x > 0.) { sc *= grow(distance(i.a.xyz, g.cam.xyz), i.c.z, fract(i.c.y * 17.3)); }
  if (i.c.x > 3.5 && g.res.x > 0.) { sc *= grow(distance(i.a.xyz, g.cam.xyz), 130., fract(i.c.y * 17.3)); } // sponges, corals: they grow in behind the curtain
  var w = i.a.xyz + qrot(i.b, i.p * sc);
  w.y += sin(g.cam.w * .3 + i.c.y * 40.) * i.c.w;
  o.cp = g.vp * vec4f(w, 1.); o.wp = w; o.n = qrot(i.b, i.n.xyz); o.op = i.p * i.a.w + i.c.y * 37.; o.on = i.n.xyz;
  if (g.res.x == 0.) { o.cp.z = shz(w); } // shadow pass
  o.m = i.c; o.q = i.b; o.ao = i.n.w;
  return o;
}
struct TP { h: f32, c: f32, n: vec3f };
fn tri(p: vec3f, n: vec3f, s: f32) -> TP {
  var w = pow(abs(n), vec3f(4.)); w /= (w.x + w.y + w.z);
  let x = textureSample(tD, sR, p.zy * s); let y = textureSample(tD, sR, p.xz * s); let z = textureSample(tD, sR, p.xy * s);
  var o: TP;
  o.h = x.b * w.x + y.b * w.y + z.b * w.z;
  o.c = x.a * w.x + y.a * w.y + z.a * w.z;
  let a = x.rg * 2. - 1.; let b = y.rg * 2. - 1.; let c = z.rg * 2. - 1.;
  o.n = vec3f(0., a.y, a.x) * w.x + vec3f(b.x, 0., b.y) * w.y + vec3f(c.x, c.y, 0.) * w.z;
  return o;
}
@fragment fn fs(i: VO, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  let mat = i32(i.m.x + .5); let sd = i.m.y; let fl_ = select(-1., 1., ff);
  let on = normalize(i.on) * fl_; let n0 = normalize(i.n) * fl_;
  let dist = length(i.wp - g.cam.xyz);
  let ts = select(1., i.m.z, mat >= 2);
  // Far from the origin a 32-bit float can't hold "position times texture scale" finely enough (at 3 km the finest
  // texture already broke into blocks). The textures repeat, so the position is wrapped first: every 100 m for the
  // rock textures and every 1000 m for the large-scale ones - whole numbers of repeats for each scale used.
  let o1 = i.op - floor(i.op / 100.) * 100.; let o2 = i.op - floor(i.op / 1000.) * 1000.;
  let A = tri(o1, on, .1 * ts); let B = tri(o1, on, .43 * ts); let C = tri(o1, on, 1.9 * ts);
  // (Low leaves out what costs texture reads and hardly shows at its resolution: the finest rock detail up close, here,
  // the colour fringes of the light pattern, and the reads only the fluke and the ship need are made for them alone)
  ${LV > 1 ? 'let F = C; let fk = 0.;' : 'let F = tri(o1, on, 6.7 * ts); let fk = ss(10. * g.res.y, 1.5 * g.res.y, dist) * f32(mat <= 1);'}
  ${LV > 1 ? 'let lw = log2(max(length(dpdx(i.op)), length(dpdy(i.op))) * 1024.);' : 'let Wd = textureSample(tD, sR, vec2f(o2.x * .06, (o2.y + o2.z) * .7));'}
  let big = textureSample(tD, sR, o2.xz * .013 + o2.y * .021).a;
  let big2 = textureSample(tD, sR, o2.zx * .031 + o2.y * .043 + .37).a;
  var sgro = 0.;
${NAT ? '  let gw = max(fwidth(o1.x), fwidth(o1.z));' : ''}
  ${LV > 1 ? '' : 'let sk = textureSample(tD, sR, vec2f((o2.x + o2.z) * .33, o2.y * .035)); let sk2 = textureSample(tD, sR, vec2f((o2.x - o2.z) * 1.1, o2.y * .11));'}
  let gm = textureSampleLevel(tM, sC, i.wp.xz / ${SPAN}., 0.);
  let ca = caus(i.wp, dist);
  let hgt = A.h * .5 + B.h * .35 + C.h * .15;
  var bump = 1.7; var gloss = .1; var alb = vec3f(0.); var emi = vec3f(0.); var vao = 1.; var flu = 0.; var sandK = 0.;
  let flt = ss(.72, .93, n0.y);
  if (mat <= 1) {
    // layered rock: grey / olive / brown beds, warm encrustation patches, algae on up-facing parts
    let st = i.op.y * .55 + A.h * 1.6 + big * 5. + big2 * 3.;
    let bed = hs(floor(st)); let sf = fract(st);
    alb = mix(vec3f(.11, .12, .13), vec3f(.33, .30, .25), sat(A.c * 1.5 - .25));
    alb = mix(alb, mix(vec3f(.26, .19, .10), vec3f(.20, .22, .14), bed), ss(.42, .66, big) * .7);
    alb *= mix(.72, 1.15, bed) * (1. - .45 * ss(.12, .0, sf) * (1. - abs(on.y)));
    let enc = ss(.46, .6, big2 * .6 + B.c * .5) * ss(.3, .6, hgt);
    alb = mix(alb, mix(vec3f(.34, .07, .10), vec3f(.40, .25, .07), ss(.45, .6, A.c)) * (.5 + .8 * B.h), enc * .75);
    alb = mix(alb, vec3f(.50, .50, .46) * (.5 + .7 * C.h), ss(.60, .70, B.c * .6 + C.c * .5) * .5);
    let alg = ss(-.1, .6, n0.y) * ss(.3, .52, B.c * .55 + big * .5);
    alb = mix(alb, vec3f(${NAT ? '.07, .10, .04' : '.035, .14, .07'}), alg * ${NAT ? '.35' : '.8'}); // (natural: thin olive algae, the rock shows through)
    alb *= (.22 + 1.3 * hgt) * mix(1., .62 + .76 * F.h, fk);
    sgro = -ss(.14, .0, sf) * (1. - abs(on.y)) * 1.2;
    if (mat == 0) {
${NAT ? `      // natural colours: level ground is sand, matt, with grains that show up close; in patches it is coarser and
      // greyer, a gravel of dark and pale stones, and where the sediment lies it is darker and damp
      sandK = ss(.6, .9, n0.y);
      let grv = 1. - ss(.22, .5, big * .6 + A.c * .5);
      let gq = floor(o1.xz * 350.); let grn = fract(sin(dot(gq, vec2f(12.9898, 78.233))) * 43758.5) * ss(.7, .3, gw * 350.); // (gone before a grain is smaller than a pixel)
      var snd = mix(vec3f(.36, .29, .17), vec3f(.56, .47, .30), sat(F.c * .7 + C.c * .5 + big2 * .5 - .35)) * (.8 + .3 * B.h);
      snd = mix(snd, vec3f(.27, .25, .21) * (.6 + .8 * C.h), grv * .7);
      snd = mix(snd, mix(vec3f(.10, .10, .09), vec3f(.66, .62, .54), ss(.4, .6, B.c)), ss(mix(.60, .50, grv), mix(.68, .60, grv), F.h * .6 + C.h * .4) * .35);
      let sq = floor(o1.xz * 70.); let sh = fract(sin(dot(sq, vec2f(41.31, 17.77))) * 24634.63);
      snd = mix(snd, mix(vec3f(.09, .09, .08), vec3f(.70, .66, .58), step(.5, fract(sh * 57.))), step(mix(.95, .84, grv), sh) * ss(.2 + .25 * fract(sh * 13.), .12, length(fract(o1.xz * 70.) - .5)) * ss(16., 5., dist) * .75);
      snd *= 1. + (grn - .5) * .5;
      alb = mix(alb, snd, sandK);
      alb = mix(alb, vec3f(.24, .21, .15) * (.7 + .5 * B.h), flt * gm.a * .45);
      bump = mix(bump, .55, sandK); gloss = mix(gloss, .03, sandK);
` : `      alb = mix(alb, vec3f(.13, .15, .14) * (.55 + .6 * B.h), flt * gm.a * .7);
`}
      alb = mix(alb, vec3f(.40, .34, .23) * (.7 + .5 * B.h) * (.85 + .3 * C.h) * mix(.3, 1., sat(-i.wp.y / 22.)), ss(.55, .9, n0.y) * gm.g); // pale sand towards the shore
      let mg = flt * sat(gm.r * 1.5 - .45 + (B.c - .5) * 1.6) * ss(.35, .6, A.h) * ss(-34., -40., i.wp.y);
      alb = mix(alb, vec3f(${NAT ? '.15, .07, .03' : '.20, .02, .12'}) * (.4 + .9 * B.h), mg * ${NAT ? '.45' : '.8'});
      flu = mg * .35;
      alb = mix(alb, alb * vec3f(${NAT ? '.9, 1., 1.1' : '.85, .8, 1.4'}) + vec3f(${NAT ? '.0, .01, .02' : '.015, .0, .05'}), gm.b * .8);
    }
${NAT ? `    // natural colours: the pebbles are stones of their own, grey, sandy, pale and rust-brown
    if (mat == 1 && i.m.z > 1.5 && i.m.z < 50.) { let ph = fract(sd * 9.7); alb = mix(alb, mix(mix(vec3f(.22, .21, .20), vec3f(.52, .47, .38), fract(ph * 5.)), vec3f(.26, .13, .07), step(.82, ph)) * (.45 + .9 * B.h), .7); bump = .9; }
` : ''}  } else if (mat == 2) {
    // whale fluke: smooth pale stone with dark streaks running along its length
    ${LV > 1 ? 'let sk = textureSampleLevel(tD, sR, vec2f((o2.x + o2.z) * .33, o2.y * .035), lw - 1.1); let sk2 = textureSampleLevel(tD, sR, vec2f((o2.x - o2.z) * 1.1, o2.y * .11), lw + .6);' : ''}
    alb = mix(vec3f(.42, .47, .48), vec3f(.10, .13, .15), ss(.40, .62, sk.a * .6 + sk2.b * .5)) * (.75 + .3 * B.h);
    alb = mix(alb, vec3f(.60, .64, .62), ss(.62, .75, sk2.a) * .5);
    gloss = .9; bump = .3;
  } else if (mat == 3) {
    ${LV > 1 ? 'let Wd = textureSampleLevel(tD, sR, vec2f(o2.x * .06, (o2.y + o2.z) * .7), lw);' : ''}
    alb = mix(vec3f(.13, .085, .05), vec3f(.36, .25, .14), Wd.b) * (.6 + .5 * B.h);
    let pk = fract(atan2(i.op.z, 2. - i.op.y) * 7.);
    alb *= .35 + .65 * ss(0., .12, min(pk, 1. - pk));
    alb = mix(alb, vec3f(.08, .22, .16), ss(.5, .7, A.c) * .6);
    gloss = .2; bump = .7;
  } else if (mat == 4) {
    let hue = fract(sd * 7.31);
    alb = mix(vec3f(.60, .17, .08), vec3f(.64, .35, .10), fract(hue * 3.));
    if (hue > .75) { alb = vec3f(${NAT ? '.50, .38, .14' : '.44, .18, .42'}); }
    alb *= (.45 + .75 * B.h) * (.7 + .3 * C.h);
    vao = i.ao * i.ao; gloss = .2; bump = 1.4; flu = .55;
  } else {
    let hue = fract(sd * 5.73);
    alb = mix(vec3f(.80, .08, .10), vec3f(${NAT ? '.86, .30, .16' : '.90, .22, .40'}), fract(hue * 4.));
    if (hue > .7) { alb = vec3f(.88, .42, .10); }
    if (hue > .9) { alb = vec3f(${NAT ? '.84, .62, .30' : '.55, .22, .75'}); }
    alb *= (.4 + .8 * B.h) * (.5 + .9 * i.ao * i.ao);
    alb = mix(alb, vec3f(1., .75, .6), ss(.8, 1., i.ao) * .35);
    emi = alb * .01; flu = .75; gloss = .25; bump = 1.5;
  }
  let rip = select(0., flt * max(max(gm.a, gm.g), sandK * .6) * cos((i.wp.x * .8 + i.wp.z * .35) * 5. + A.c * 9.) * .65, mat == 0);
  let N = normalize(qrot(i.q, normalize(on + (A.n * .85 + B.n * .65 + C.n * .45 * ss(60. * g.res.y, 12. * g.res.y, dist) + F.n * .5 * fk) * bump + vec3f(.8, sgro, .35) * vec3f(rip, 1., rip))));
  let L = g.sun.xyz; let V = normalize(g.cam.xyz - i.wp);
  let v1 = vol(i.wp + n0 * 1.5); let v2 = vol(i.wp + n0 * 4.5);
  let ao = (sat((v1.r - .5) * 8.) * .55 + sat((v2.r - .5) * 2.7) * .45) * vao * ss(.12, .6, hgt + sandK * .4);
  let z = zone(i.wp);
  let E = sunE(i.wp.y, z) * shadow9(i.wp + n0 * .35) * critSh(i.wp);
  let ndl = sat(dot(N, L));
  let am = (amb(i.wp, N, v1.g, z) + side(i.wp, N, sat((v2.r - .5) * 2.7), z)) * ao;
  let dl = E * ndl * (.10 + mix(vec3f(.33), ca, ss(.1, .45, dot(n0, L))) * 2.5);
  var c = alb * (dl + am) + emi + alb * flu * dot(dl + am, vec3f(.1, .5, .5));
  let H = normalize(V + L);
  c += E * (.25 + ca) * pow(sat(dot(N, H)), mix(10., 70., gloss)) * gloss * ndl * 1.8;
  c += (amb(i.wp, reflect(-V, N), v1.g, z) + side(i.wp, reflect(-V, N), sat((v2.r - .5) * 2.7), z)) * ao * (.08 + gloss) * .6 * pow(1. - sat(dot(N, V)), 2.5);
  return fin(fog(c, i.wp, z));
}
`;

// ---------------------------------------------------------------- leaves (kelp, grasses, ground cover)
const W_LEAF = S_B + /*wgsl*/`
override ROWS: f32 = 7.;
override FAR: f32 = 150.;
override LODW: f32 = 1.; // 1: the kelp's sets, which change into each other with distance; 0: ground cover
struct LI { @location(0) a: vec4f, @location(1) b: vec4f, @location(2) c: vec4f };
struct LO { @builtin(position) cp: vec4f, @location(0) wp: vec3f, @location(1) n: vec3f, @location(2) uv: vec2f,
  @location(3) @interpolate(flat) col: vec3f, @location(4) @interpolate(flat) pr: vec4f,
  @location(5) @interpolate(flat) sd: vec2f, @location(6) @interpolate(flat) spc: vec3f };
fn sway(p: vec2f, h: f32, t: f32) -> vec2f {
  let ph = dot(p, vec2f(.031, .017));
  let a = .024 * pow(max(h, 0.), 1.25);
  return a * (vec2f(sin(t * .5 + ph + h * .09), cos(t * .37 + ph * 1.3 + h * .07)) + .35 * vec2f(sin(t * 1.3 + ph * 3. + h * .3), cos(t * 1.1 + ph * 2. + h * .23)));
}
fn shape2(v: f32) -> f32 { return sin(3.14159 * sat(v)); }
fn pal(h: f32) -> vec3f {
  if (h < .3) { return vec3f(1., .62, .08); }
  if (h < .6) { return vec3f(.12, 1., .22); }
  if (h < .8) { return vec3f(.2, .85, 1.); }
  return vec3f(${NAT ? '1., .8, .5' : '1., .3, .8'});
}
@vertex fn vs(@builtin(vertex_index) vi: u32, i: LI) -> LO {
  var o: LO;
  let u = f32(vi & 1u) * 2. - 1.; let v = sin(f32(vi >> 1u) / (ROWS - 1.) * 1.5708);
  let ty = i32(i.c.x * 255. + .5); let s1 = i.c.y; let s2 = i.c.z;
  let t = g.cam.w;
  let len = i.a.w; let hA = i.b.w;
  let cy = cos(i.b.x); let sy = sin(i.b.x); let ct = cos(i.b.y); let st = sin(i.b.y);
  let d = vec3f(st * cy, ct, st * sy); let pe = vec3f(ct * cy, -st, ct * sy); let sd = vec3f(-sy, 0., cy);
  // per type: x sparkle prob, y translucency, z iridescence, w emissive
  var col = vec3f(0.); var pr = vec4f(0.); var spc = vec3f(0.); var shp = vec2f(.75, .7); var wav = 1.; var fls = 1.;
  let hsel = hs(s1 * 13.7 + s2 * 71.3);
  switch ty {
    case 0 { col = mix(vec3f(.11, .125, .022), vec3f(.04, .10, .04), s1); col = mix(col, vec3f(.25, .17, .025), step(.72, s2)); pr = vec4f(.24, .9, 0., 0.); spc = pal(hsel * .72); shp = vec2f(.5, .32); wav = 1.9; }
    case 1 { col = vec3f(.10, .11, .035); pr = vec4f(0., .2, 0., 0.); shp = vec2f(.05, .1); wav = .3; fls = .3; }
    case 2 { col = mix(vec3f(${NAT ? '.06, .18, .07' : '.05, .20, .16'}), vec3f(${NAT ? '.13, .25, .10' : '.12, .26, .22'}), s1); col = mix(col, vec3f(${NAT ? '.24, .17, .05' : '.30, .14, .24'}), step(.85, s2)); pr = vec4f(.05, 1.0, .25, 0.); spc = vec3f(.6, 1., .9); shp = vec2f(.45, .35); wav = 2.2; }
    case 3 { col = mix(vec3f(.02, .05, .065), vec3f(.05, .03, .08), s1); col = mix(col, vec3f(${NAT ? '.05, .07, .03' : '.09, .03, .09'}), step(.8, s2)); pr = vec4f(.2, .85, .55, .02); spc = mix(vec3f(${NAT ? '.9, .8, .4' : '.5, .35, 1.'}), vec3f(.2, 1., .7), step(.6, hsel)); shp = vec2f(.7, .6); wav = 2.4; }
    case 4 { col = mix(vec3f(.30, .15, .02), vec3f(.42, .25, .04), s1); pr = vec4f(.2, 1., .1, 0.); spc = vec3f(1., .85, .5); shp = vec2f(.5, .4); wav = 1.8; }
    case 5 { col = mix(vec3f(${NAT ? '.40, .10, .05' : '.85, .05, .40'}), vec3f(${NAT ? '.26, .20, .05' : '.60, .10, .80'}), step(.7, s1)); col = mix(col, vec3f(${NAT ? '.55, .20, .07' : '.95, .25, .55'}), step(.75, s2)); pr = vec4f(.22, .8, 0., ${NAT ? '.06' : '.30'}); spc = vec3f(${NAT ? '1., .7, .4' : '1., .35, .8'}); shp = vec2f(.6, .6); fls = 2.; }
    case 6 { col = mix(vec3f(.80, .16, .16), vec3f(${NAT ? '.84, .36, .20' : '.92, .36, .42'}), s1); pr = vec4f(.06, 1., 0., .10); spc = vec3f(1., .5, .5); shp = vec2f(.4, .3); wav = 2.; }
${NAT ? `    case 8 { col = mix(vec3f(.07, .30, .05), vec3f(.20, .44, .08), s1); col = mix(col, vec3f(.30, .34, .08), step(.8, s2)); pr = vec4f(0., 1., 0., 0.); spc = vec3f(.6, 1., .5); shp = vec2f(.35, .25); wav = 1.6; }
` : ''}    default { col = mix(vec3f(${NAT ? '.06, .26, .10' : '.05, .40, .36'}), vec3f(${NAT ? '.15, .37, .14' : '.10, .52, .58'}), s1); pr = vec4f(.1, .9, .2, .04); spc = vec3f(${NAT ? '.5, 1., .6' : '.3, 1., .9'}); shp = vec2f(.6, .5); }
  }
  pr.x = step(hs(s1 * 91.7 + s2 * 37.1 + i.b.x), pr.x);
  let k = (i.c.w - .3) * 2.0 + sin(t * (.8 + s1) * fls + s2 * 40. + hA * .25) * .10 * fls;
  let wph = v * (3. + 5. * s2) + s1 * 30. + t * 1.1;
  let wv = sin(wph) * .12 * wav;
  let kq = k * 1.7; let ka = select(kq, .06, abs(kq) < .06);
  let sK = sin(ka * v); let cK = cos(ka * v);
  let c = i.a.xyz + len * (d * (sK / ka) + pe * ((1. - cK) / ka + wv * v));
  let sl = sK + wv + cos(wph) * .10 * wav * v * (3. + 5. * s2);
  let N = normalize(pe * cK - d * sl); let T0 = normalize(d * cK + pe * sl);
  let tw = (s1 - .5) * 2.4 * v + sin(t * .9 + s2 * 20.) * .25 * v;
  let S = sd * cos(tw) + N * sin(tw); let N2 = N * cos(tw) - sd * sin(tw);
  let shape = pow(max(sin(3.14159 * pow(v, shp.x)), 0.), shp.y);
  let shp_ = g.res.x == 0.;
  let cd = distance(i.a.xyz, g.cam.xyz); let far = FAR * g.mis.z;
  // Between 44 and 58 m every second leaf (negative width) thins away while the others widen by half: at 58 m, where
  // the draw calls change over to the far set (those wider leaves alone), the two look the same.
  let lz = g.mis.z * g.res.y; // (g.res.y: how many times further than usual things get their detail, lk in main.js)
  let lod = select(ss(44. * lz, 58. * lz, cd) * LODW, 0., shp_);
  let bz = abs(i.b.z) * select(mix(1., 1.5, lod), 1. - lod, i.b.z < 0.);
  let nearK = select(1. - ss(26. * g.res.y, 40. * g.res.y, cd), 0., shp_);
  let farK = select(select(1. - ss(far * .8, far, cd), grow(cd, FAR, s2), LODW == 0.) * ss(.6, 2.2, distance(c, g.cam.xyz)) * ss(len * 1.1 + .5, len * 2.2 + 1.2, distance(i.a.xyz + d * (len * .5), g.cam.xyz)), 1., shp_);
  let ruf = sin(v * 10. + s2 * 30. + t * .6) * bz * .36 * u * shape2(v) * nearK;
  var p = c + S * (u * farK * select(bz * .5 * shape, select(max(bz * .5, .09) * shape, 0., ty == 1), shp_));
  p += N2 * ruf;
  let sw = sway(i.a.xz, hA + (p.y - i.a.y), t);
  p.x += sw.x; p.z += sw.y;
  o.cp = g.vp * vec4f(p, 1.); if (shp_) { o.cp.z = shz(p); }
  o.wp = p; o.n = normalize(N2 + S * u * .55 - T0 * cos(v * 10. + s2 * 30. + t * .6) * u * .7 * nearK); o.uv = vec2f(u, v);
  o.col = col; o.pr = pr; o.sd = vec2f(s1, s2); o.spc = spc;
  return o;
}
struct GO { @builtin(position) cp: vec4f, @location(0) uv: vec2f, @location(1) @interpolate(flat) col: vec3f };
@vertex fn vsGl(@builtin(vertex_index) vi: u32, @location(0) a: vec4f, @location(1) b: vec4f) -> GO {
  var o: GO; let q = vec2f(f32(vi & 1u), f32(vi >> 1u)) * 2. - 1.; let t = g.cam.w;
  var p = a.xyz; let sw = sway(a.xz, a.w, t); p.x += sw.x; p.z += sw.y;
  p += .1 * vec3f(sin(t * .7 + b.x * 50.), sin(t * .9 + b.x * 70.), cos(t * .8 + b.x * 90.));
  let d = length(p - g.cam.xyz);
  if (d > 120. || dot(p - g.cam.xyz, g.fwd.xyz) < -1.) { o.cp = vec4f(0., 0., 2., 1.); return o; }
  let tw = pow(.5 + .5 * sin(t * (.35 + .9 * hs(b.x)) + b.x * 100.), 4.);
  let sz = min(max(b.z, d * .0026), d * .0045);
  let w = p + (g.right.xyz * q.x + g.up.xyz * q.y) * sz;
  o.cp = g.vp * vec4f(w, 1.); o.uv = q;
  let z = zone(p);
  let lit = .3 + 1.8 * shadow1(p) * sunE(p.y, z).g;
  let e = b.z / sz;
  o.col = pal(b.y) * (.12 + tw * 1.7) * lit * e * e * exp(-SIG.g * d) * ss(.4, 1.5, d) * ss(88. * g.mis.z, 50. * g.mis.z, d) * 17.; // gone well before the kelp they hang on is
  return o;
}
@fragment fn fsGl(i: GO) -> @location(0) vec4f {
  let r = dot(i.uv, i.uv);
  return vec4f(min(i.col * exp(-r * 7.) * (1. - ss(.7, 1., r)), vec3f(10.)), 0.);
}
@fragment fn fs(i: LO, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  let dist = length(i.wp - g.cam.xyz);
  let ca = caus2(i.wp, dist);
  var n = normalize(i.n); if (!ff) { n = -n; }
  let V = normalize(g.cam.xyz - i.wp); let L = g.sun.xyz;
  let z = zone(i.wp);
  let lt = textureSample(tD, sR, vec2f(i.uv.x * .13 + i.sd.x * 3.7, i.uv.y * .8 + i.sd.y * 5.3));
  let vv = vol(i.wp + vec3f(0., .8, 0.));
  let E = sunE(i.wp.y, z) * shadow1(i.wp + L * .3);
  let ndl = dot(n, L);
  var alb = i.col * (.72 + .28 * ss(0., .25, abs(i.uv.x))) * mix(.5, 1.12, i.uv.y) * (1. - .45 * ss(30. * g.res.y, 8. * g.res.y, dist) * ss(.6, 1., sin(i.uv.y * 40. - abs(i.uv.x) * 7. + i.sd.x * 40.))) * (.58 + .42 * ss(0., .13, abs(i.uv.x))) * (.5 + 1.0 * lt.b) * (.65 + .7 * lt.a);
  let ndv = sat(dot(n, V));
  let ir = .5 + .5 * cos(TAU * (vec3f(0., .33, .67) + ndv * 1.1 + i.sd.x * .22 + i.uv.y * .5 + .55));
  alb = mix(alb, alb * .5 + ir * vec3f(.15, .13, .30), i.pr.z * (1. - ndv) * .8);
  let tr = (max(-ndl, 0.) * .85 + .15) * i.pr.y;
  let trc = alb * mix(vec3f(1.), vec3f(1.5, 1.4, .75), sat(i.pr.y) * (1. - i.pr.z));
  let aov = sat((vv.r - .5) * 6.) * mix(.4, 1., i.uv.y);
  let am = (amb(i.wp, n, vv.g, z) + amb(i.wp, -n, vv.g, z) * i.pr.y * .55 * vec3f(1.1, 1.15, .7) + side(i.wp, n, sat((vv.r - .5) * 4.), z) * .6) * (.3 + .7 * aov);
  var c = E * (.06 + ca * 1.5) * (alb * max(ndl, 0.) + trc * tr) + alb * am;
  let H = normalize(V + L);
  c += E * (pow(sat(dot(n, H)), 40.) * (.45 + ir * i.pr.z * 2.) + pow(sat(dot(n, H)), 9.) * .07) + am * ir * i.pr.z * pow(1. - ndv, 3.) * 1.5;
  c += E * trc * i.pr.y * pow(sat(dot(-V, L)), 3.) * 1.2;
  c += alb * i.pr.w * (.5 + 3. * dot(am + E * .3, vec3f(.1, .5, .5)));
  // sparkle: whole-leaf glints that twinkle slowly
  let tw = pow(.5 + .5 * sin(g.cam.w * (.5 + i.sd.y * 1.4) + i.sd.x * 90.), 5.);
  let m = ss(.2, .0, abs(i.uv.y - (.35 + .45 * i.sd.y))) * (1. - i.uv.x * i.uv.x);
  let lit = .35 + E.g * 1.2;
  c += i.spc * i.pr.x * (.1 + tw) * m * lit * .6;
  return fin(fog(c, i.wp, z));
}
`;

// ---------------------------------------------------------------- fish + mantas
const W_ANIM = S_B + /*wgsl*/`
struct VI { @location(0) p: vec3f, @location(1) n: vec4f, @location(2) a: vec4f, @location(3) b: vec4f };
struct VO { @builtin(position) cp: vec4f, @location(0) wp: vec3f, @location(1) n: vec3f, @location(2) op: vec3f, @location(3) @interpolate(flat) sd: f32, @location(4) lt: f32 };
@vertex fn vsFish(i: VI) -> VO {
  var o: VO;
  let s = i.b.x; let h = vec3f(hs(s), hs(s + .37), hs(s + .71));
  let R = i.a.w; let t = g.cam.w;
  let ta = t * i.b.y + i.b.w * 6.3 + (h.x - .5) * (26. / R);
  let ph = i.b.w * 17.;
  let P = i.a.xyz + vec3f(R * cos(ta), 2.2 * sin(3. * ta + ph), R * .6 * sin(ta));
  let T = normalize(vec3f(-R * sin(ta), 6.6 * cos(3. * ta + ph), R * .6 * cos(ta))) * sign(i.b.y);
  let S = normalize(cross(vec3f(0., 1., 0.), T)); let Up = cross(T, S);
  let off = S * ((h.y - .5) * 5. + sin(t * .6 + s * 40.) * .5) + Up * ((h.z - .5) * 3.2 + cos(t * .5 + s * 31.) * .4);
  var l = i.p * i.b.z * (.75 + .5 * h.z);
  l.z += sin(t * 9. + s * 50. + l.x * 5.) * .22 * (.25 * i.b.z - l.x);
  let w = P + off + T * l.x + Up * l.y + S * l.z;
  o.cp = g.vp * vec4f(w, 1.); o.wp = w; o.n = T * i.n.x + Up * i.n.y + S * i.n.z; o.op = i.p; o.sd = s;
  o.lt = shadow1(w);
  return o;
}
@fragment fn fsFish(i: VO) -> @location(0) vec4f {
  let n = normalize(i.n); let L = g.sun.xyz; let V = normalize(g.cam.xyz - i.wp);
  let z = zone(i.wp); let vv = vol(i.wp);
  var alb = mix(vec3f(.50, .68, .80), vec3f(.10, .22, .40), ss(-.05, .2, i.op.y));
  alb = mix(alb, vec3f(.95, .8, .3), step(.86, fract(i.sd * 7.7)) * .6);
  let E = sunE(i.wp.y, z) * i.lt;
  var c = alb * (E * (.25 + .75 * sat(dot(n, L))) + amb(i.wp, n, vv.g, z) * 1.3);
  c += E * pow(sat(dot(n, normalize(V + L))), 24.) * 1.6 + vec3f(.3, .6, .7) * pow(1. - sat(dot(n, V)), 3.) * .25 * vv.g;
  return fin(fog(c, i.wp, z));
}
@vertex fn vsManta(i: VI) -> VO {
  var o: VO;
  let t = g.cam.w; let R = i.a.w; let sz = i.b.z;
  let ta = t * i.b.y + i.b.x;
  let P = i.a.xyz + vec3f(R * cos(ta), 2.5 * sin(2. * ta + i.b.w), R * .75 * sin(ta));
  let T = normalize(vec3f(-R * sin(ta), 5. * cos(2. * ta + i.b.w) * 1., R * .75 * cos(ta))) * sign(i.b.y);
  var S = normalize(cross(vec3f(0., 1., 0.), T)); var Up = cross(T, S);
  let bank = -.28 * sign(i.b.y);
  let S2 = S * cos(bank) + Up * sin(bank); Up = Up * cos(bank) - S * sin(bank); S = S2;
  let u = i.n.w; let au = abs(u);
  let fp = t * 1.25 + i.b.w * 5. - au * 1.2;
  let amp = .36 * pow(au, 1.6);
  var l = i.p;
  l.y += amp * sin(fp) - .1 * sin(t * 1.25 + i.b.w * 5.);
  let tail = ss(-.5, -1.9, l.z) * step(au, .001);
  l.x += tail * sin(t * .8 + l.z * 2.) * .12;
  let sl = (.576 * pow(au, .6) * sin(fp) - .43 * pow(au, 1.6) * cos(fp)) * sign(u);
  let ln = normalize(vec3f(i.n.x - sl * i.n.y, i.n.y + sl * i.n.x, i.n.z));
  let w = P + (S * l.x + Up * l.y + T * l.z) * sz;
  o.cp = g.vp * vec4f(w, 1.); o.wp = w; o.n = S * ln.x + Up * ln.y + T * ln.z; o.op = i.p; o.sd = i.b.w;
  o.lt = 1.;
  return o;
}
@fragment fn fsManta(i: VO) -> @location(0) vec4f {
  let dist = length(i.wp - g.cam.xyz);
  let ca = caus(i.wp, dist);
  let tx = textureSample(tD, sR, i.op.xz * .9 + i.sd);
  let n = normalize(i.n + (vec3f(tx.r, 0., tx.g) - vec3f(.5, 0., .5)) * .5); let L = g.sun.xyz; let V = normalize(g.cam.xyz - i.wp);
  let z = zone(i.wp); let vv = vol(i.wp);
  let top = ss(-.2, .25, normalize(i.n).y);
  let au = abs(i.op.x);
  let gill = ss(.25, .0, abs(au - .13) * 8.) * ss(.04, .12, i.op.z) * ss(.34, .26, i.op.z) * ss(.2, .8, sin(i.op.z * 110.));
  var belly = vec3f(.13, .17, .21) * (.6 + .6 * tx.b) * (1. - .7 * gill);
  belly = mix(belly, vec3f(.05, .08, .11), sat(ss(.45, .9, au + tx.a * .35) + ss(-.1, -.4, i.op.z + tx.b * .2) * .7));
  var back = vec3f(.04, .065, .10) + vec3f(.10, .16, .2) * ss(.5, .75, tx.a);
  back = mix(back, vec3f(.36, .46, .52), ss(.25, .0, abs(au - .26) * 3.5 + abs(i.op.z - .12) * 5.) * .8);
  var alb = mix(belly, back, top);
  let E = sunE(i.wp.y, z) * shadow4(i.wp + n * .3);
  let ndv = sat(dot(n, V));
  let ir = .5 + .5 * cos(TAU * (vec3f(0., .33, .67) + ndv * 1.1 + tx.a * 1.5 + .55));
  let fillN = vec3f(n.x, abs(n.y) * .55 + .25, n.z);
  var c = alb * (E * sat(dot(n, L)) * (.3 + ca) + amb(i.wp, fillN, vv.g, z) * 1.1 + side(i.wp, n, 1., z) * .8);
  c += ir * vec3f(.35, .16, .6) * (.07 + .22 * tx.b) * (.4 + E.g * .2 * ca.g) * (1. - top * .3);
  c += E * pow(sat(dot(n, normalize(V + L))), 30.) * .5 * (.3 + ca);
  let sky = amb(i.wp, vec3f(0., 1., 0.), vv.g, z);
  c += alb * sky * ca * .45 * (1. - top) + sky * pow(1. - ndv, 3.) * .35;
  return fin(fog(c, i.wp, z));
}
`;

// ---------------------------------------------------------------- the creatures (creatures.js, bots.js)
// instance a: position, yaw; b: pitch, phase of the swimming beat, length in metres, species + 0.5 + 0.45 * turn
const W_CRIT = S_B + /*wgsl*/`
/*CRIT_SHARED*/
struct CI { @location(0) p: vec3f, @location(1) n: vec4f, @location(2) a: vec4f, @location(3) b: vec4f };
struct CO { @builtin(position) cp: vec4f, @location(0) wp: vec3f, @location(1) n: vec3f, @location(2) op: vec3f, @location(3) on: vec3f,
  @location(4) @interpolate(flat) sp: u32, @location(5) @interpolate(flat) code: u32, @location(6) @interpolate(flat) gape: f32 };
@vertex fn vs(i: CI) -> CO {
  var o: CO;
  let sp = u32(floor(i.b.w)); let turn = (fract(i.b.w) - .5) / .45;
  var SW = array<vec4f, 10>(${CRIT.map((c) => `vec4f(${c.mode}., ${c.amp}, ${c.wave}, 0.)`).join(', ')});
  let sw = SW[sp]; let code = u32(round(i.n.w * 127.));
  var l = i.p; var n = i.n.xyz;
  // the phase of the beat carries one more number, in thousands: how much the animal is "talking" (0..15, bots.js)
  let tk = floor(i.b.y / 1000.); let bph = i.b.y - tk * 1000.; let talk = tk / 15.;
  // the crab never tips, so its pitch slot says what has become of it instead: 1, 2 a claw torn off (+z, -z side), 4 dead
  let pit = select(i.b.x, 0., sp == 0u); let lost = select(0u, u32(i.b.x + .5), sp == 0u);
  if (lost >= 4u) { l.y = -l.y; n.y = -n.y; } // (a dead crab lies on its back)
  // the lower jaw swings down about its hinge: mostly shut, now and then a slow gape (0..1)
  let gape = max(pow(.5 + .5 * sin(bph * .25 + f32(sp)), 8.), talk); o.gape = gape;
  if (code == 112u || code == 113u || code == 115u) {
    var JW = array<vec3f, 10>(${JAWS.map((j, s) => (j ? `vec3f(${j.hx}, ${(j.y0 + j.sl * (0.5 - j.hx)).toFixed(4)}, ${j.ang})` : s === 8 ? `vec3f(${SHARKM.xh}, ${SHARKM.yp}, ${SHARKM.ang})` : 'vec3f(0.)')).join(', ')});
    let j = JW[sp]; let a = j.z * gape; let d = l.xy - j.xy;
    l = vec3f(j.x + d.x * cos(a) + d.y * sin(a), j.y - d.x * sin(a) + d.y * cos(a), l.z);
  }
  if (sp == 0u && (code == 109u || code == 114u)) {
    // a torn-off claw is drawn into its shoulder and gone; the crab lifts the others (a threat) about its shoulders
    if ((i.p.z > 0. && (lost & 1u) != 0u) || (i.p.z < 0. && (lost & 2u) != 0u)) { l = vec3f(.2, l.y * .001 - .04, sign(i.p.z) * .3); }
    let a = talk * 1.05; let d = l.xy - vec2f(.2, -.04);
    l = vec3f(.2 + d.x * cos(a) - d.y * sin(a), -.04 + d.x * sin(a) + d.y * cos(a), l.z);
    n = vec3f(n.x * cos(a) - n.y * sin(a), n.x * sin(a) + n.y * cos(a), n.z);
  }
  if (sw.x < 1.5) {
    // a wave runs down the body and grows towards the tail; in a turn the body bends into it
    let s = .5 - l.x; let sc = clamp(s, 0., 1.); let w = pow(sc, 1.7) * 1.5 - .05; let ph = bph - s * sw.z;
    let off = sw.y * w * sin(ph); let sl = sw.y * (2.55 * pow(sc, .7) * sin(ph) - w * sw.z * cos(ph));
    let bend = turn * .16; l.z += bend * sc * sc; n = normalize(vec3f(n.x + 2. * bend * sc * n.z, n.y, n.z - 2. * bend * sc * n.x));
    if (sw.x < .5) { l.z += off; n = normalize(vec3f(n.x + sl * n.z, n.y, n.z - sl * n.x)); }
    else { l.y += off; n = normalize(vec3f(n.x + sl * n.y, n.y - sl * n.x, n.z)); }
  } else if (code < 90u) {
    // the crab's legs step in two alternating sets; it walks sideways, so they swing along z
    let limb = f32(code / 10u); let k = f32(code % 10u) / 9.; let ph = bph + limb * 3.14159 + step(4.5, limb) * 1.57;
    l.y += max(sin(ph), 0.) * .1 * k * k; l.z += cos(ph) * .07 * k * k;
  }
  let cy = cos(i.a.w); let sy = sin(i.a.w); let cp = cos(pit); let sp2 = sin(pit);
  let F = vec3f(cy * cp, sp2, sy * cp); var S = vec3f(-sy, 0., cy); var U = vec3f(-cy * sp2, cp, -sy * sp2);
  let bank = turn * select(.45, 0., sw.x > 1.5);
  let S2 = S * cos(bank) + U * sin(bank); U = U * cos(bank) - S * sin(bank); S = S2;
  let w = i.a.xyz + (F * l.x + U * l.y + S * l.z) * i.b.z;
  o.cp = g.vp * vec4f(w, 1.); o.wp = w; o.n = F * n.x + U * n.y + S * n.z; o.op = i.p; o.on = i.n.xyz; o.sp = sp; o.code = code;
  return o;
}
fn ch3(p: vec3f) -> f32 { return fract(sin(dot(p, vec3f(127.1, 311.7, 74.7))) * 43758.5453); }
fn cvn(p: vec3f) -> f32 { let i = floor(p); var f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(mix(ch3(i), ch3(i + vec3f(1., 0., 0.)), f.x), mix(ch3(i + vec3f(0., 1., 0.)), ch3(i + vec3f(1., 1., 0.)), f.x), f.y),
    mix(mix(ch3(i + vec3f(0., 0., 1.)), ch3(i + vec3f(1., 0., 1.)), f.x), mix(ch3(i + vec3f(0., 1., 1.)), ch3(i + vec3f(1., 1., 1.)), f.x), f.y), f.z); }
fn cfb(p: vec3f) -> f32 { return cvn(p) * .5 + cvn(p * 2.03) * .3 + cvn(p * 4.1) * .2; }
// a species' colours: back, flank, belly, fins, fin tips; then its markings, painted in the body's own coordinates
fn critAlb(sp: u32, code0: u32, r: vec3f, up: f32, top: bool, gape: f32) -> vec3f {
  let code = select(code0, 100u, code0 == 112u); // the lower jaw is painted as the body it was cut from
  var BK = array<vec3f, 10>(vec3f(.5, .16, .08), vec3f(.1, .22, .4), vec3f(.08, .3, .42), vec3f(.5, .12, .1), vec3f(.14, .22, .26), vec3f(.26, .2, .13), vec3f(.02, .05, .13), vec3f(.2, .27, .35), vec3f(.3, .34, .39), vec3f(.13, .17, .23));
  var FK = array<vec3f, 10>(vec3f(.78, .3, .14), vec3f(.5, .68, .8), vec3f(.15, .55, .6), vec3f(.82, .3, .24), vec3f(.66, .74, .78), vec3f(.5, .4, .26), vec3f(.5, .6, .7), vec3f(.33, .42, .5), vec3f(.46, .5, .55), vec3f(.2, .26, .33));
  var BL = array<vec3f, 10>(vec3f(.92, .72, .5), vec3f(.86, .92, .95), vec3f(.7, .85, .8), vec3f(.95, .75, .68), vec3f(.92, .95, .96), vec3f(.8, .74, .6), vec3f(.9, .93, .94), vec3f(.6, .66, .7), vec3f(.93, .94, .94), vec3f(.78, .81, .82));
  var FN = array<vec3f, 10>(vec3f(.78, .3, .14), vec3f(.35, .5, .62), vec3f(.25, .7, .68), vec3f(.7, .2, .16), vec3f(.1, .12, .16), vec3f(.3, .23, .15), vec3f(.95, .78, .12), vec3f(.18, .24, .31), vec3f(.27, .31, .36), vec3f(.12, .16, .22));
  var TP = array<vec3f, 10>(vec3f(.78, .3, .14), vec3f(.35, .5, .62), vec3f(.5, .9, .85), vec3f(.95, .5, .3), vec3f(.8, .85, .88), vec3f(.3, .23, .15), vec3f(.9, .8, .3), vec3f(.18, .24, .31), vec3f(.27, .31, .36), vec3f(.12, .16, .22));
  if (code == 102u) { return vec3f(.02, .02, .03); }
  if (code0 == 113u) { return vec3f(.16, .04, .05); }
  if (code0 == 115u) { return mix(vec3f(.42, .36, .34), vec3f(.88, .86, .78), step(.4, fract(r.z * 240.))); } // a row of teeth
  if (code == 111u) { return select(vec3f(.8, .82, .78), vec3f(.85, .7, .25), sp == 3u || sp == 5u); } // the iris: silver, golden for the perch and the grouper
  let n = cfb(r * 9.); let n2 = cfb(r * 23. + 7.);
  if (sp == 0u) { // crab
    var c = mix(BL[0], mix(BK[0], FK[0], ss(0., .1, r.y)), ss(-.05, -.01, r.y)); // pale underneath, the shell darker at its rim
    if (code < 90u) { c = select(BK[0], FK[0], (code / 10u) % 2u == 0u); }
    if (code == 109u) { c = mix(BL[0], FK[0], ss(-.03, .03, up)); } if (code == 114u) { c = vec3f(.1, .07, .07); } if (code == 103u) { c = BL[0]; }  if (code == 107u) { c = BL[0] * .97; } if (code == 108u) { c = BL[0] * .8; }
    c *= .72 + .55 * n2;
    return mix(c, vec3f(.96, .82, .62), ss(.6, .68, cfb(r * 30.)) * step(.02, r.y) * .6 * step(99.5, f32(code)) * step(f32(code), 100.5));
  }
  if (code == 103u) { return vec3f(.84, .87, .89); }
  if (code == 106u) { return select(vec3f(.84, .87, .89), vec3f(.1, .13, .17), top); } // the whale's flippers: dark above, white below
  if (code == 110u) { return vec3f(.07, .1, .2); }
  if (code == 104u) { return vec3f(.3, .34, .37); }
  // countershading by height on the body: the belly's colour up to b.x..b.y, the back's from b.z..b.w, the flank's between
  var CB = array<vec4f, 10>(vec4f(0.), vec4f(-.05, -.01, .02, .06), vec4f(-.15, -.05, .08, .18), vec4f(-.1, -.03, .05, .13), vec4f(-.03, -.005, .012, .035), vec4f(-.12, -.05, .04, .12),
    vec4f(-.07, -.03, -.005, .03), vec4f(-.07, -.02, 0., .05), vec4f(-.05, -.03, -.02, 0.), vec4f(-.09, -.04, -.03, 0.));
  let cb = CB[sp];
  var c = mix(mix(BL[sp], FK[sp], ss(cb.x, cb.y, r.y)), BK[sp], ss(cb.z, cb.w, r.y));
  if (code == 101u) { c = FN[sp]; } if (code == 105u) { c = TP[sp]; }
  if (sp == 1u) { c = mix(c, vec3f(.75, .97, 1.), ss(.022, 0., abs(r.y - .012)) * .85 * ss(-.4, -.3, r.x)); }
  else if (sp == 2u) { c *= .86 + .2 * sin(r.x * 150.) * sin(r.y * 150. + r.x * 75.); c = mix(c, vec3f(.1, .8, .9), ss(.35, .7, n) * .35 * ss(-.36, -.3, r.x)); }
  else if (sp == 3u) { let b = ss(.2, .6, sin((r.x + (n - .5) * .09) * 50.)) * ss(-.05, .05, r.y); c = mix(c, c * .28, b * .75) * (.85 + .3 * n2); }
  else if (sp == 4u) {
    let ch = ss(.45, .8, sin((r.x - abs(r.y - .02) * 1.3) * 88.)) * ss(-.004, .03, r.y); c = mix(c, vec3f(.1, .14, .17), ch * .6);
    c = mix(c, vec3f(.04), ss(.7, .74, cfb(r * vec3f(40., 60., 40.))) * step(r.y, 0.) * step(r.x, .05) * .75);
  }
  else if (sp == 5u) { c *= .78 + .45 * n; c = mix(c, vec3f(.2, .11, .06), ss(.6, .66, cvn(r * vec3f(64., 64., 30.))) * .8); }
  else if (sp == 6u) {
    c = mix(c, vec3f(.95, .8, .25), ss(.016, .004, abs(r.y - .008)) * .55 * ss(-.4, -.25, r.x) * step(99.5, f32(code)) * step(f32(code), 100.5));
    c = mix(c, c * .8, ss(.3, .8, sin(r.x * 130.)) * step(r.y, -.02) * .5);
  }
  else if (sp == 7u) { let bl = ss(.035, 0., abs(r.y - .012 - .045 * sin(r.x * 5. + .6))); c = mix(c, vec3f(.5, .57, .63), bl * .6 * ss(-.42, -.1, r.x)) * (.92 + .16 * n); }
  else if (sp == 8u) {
    if (code == 100u) {
      let e = r.y + .035 - (cfb(r * vec3f(26., 3., 3.)) - .5) * .05; c = mix(vec3f(.93, .94, .94), vec3f(.34, .38, .43) * (.8 + .4 * n), ss(-.006, .006, e));
      c = mix(c, vec3f(.16, .18, .2), ss(.66, .72, n2) * .35 * step(0., e));
    }
  }
  else if (sp == 9u) {
    // the stone fluke's colours (solids, mat 2): pale grey, dark streaks along the body, light patches; a grooved pale throat
    // the throat's grooves run back to about the navel, each ending in its own place
    let ga = atan2(r.y, r.z); if (code == 100u && r.y < -.035) { c = mix(c, vec3f(.38, .42, .46), .75 * ss(.1, .4, sin(ga * 24.)) * ss(-.1 + .06 * sin(ga * 7.), -.02 + .06 * sin(ga * 7.), r.x)); }
    let st = ss(.40, .62, cfb(r * vec3f(3., 26., 26.)) * .6 + cfb(r * vec3f(6., 50., 50.) + 3.) * .5);
    var stone = mix(vec3f(.42, .47, .48), vec3f(.10, .13, .15), st) * (.75 + .3 * n2); stone = mix(stone, vec3f(.60, .64, .62), ss(.62, .75, cfb(r * 14. + 11.)) * .5);
    if (code == 100u || code == 104u) { c = mix(stone, c, ss(-.02, -.07, r.y) * .9); } // (the fins keep their own plain dark)
  }
  // the edge of the gill cover: a curved line behind the head of a fish; the shark's five gill slits
  if (sp >= 1u && sp <= 6u && code == 100u) {
    var GX = array<vec2f, 7>(vec2f(0.), vec2f(.3, .09), vec2f(.31, .2), vec2f(.27, .16), vec2f(.31, .055), vec2f(.24, .15), vec2f(.29, .12));
    let gx = GX[sp]; let gy = r.y / gx.y;
    c = mix(c, c * .45, .7 * ss(.007, .002, abs(r.x - gx.x - .045 * gy * gy + .03)) * ss(1., .8, abs(gy))); // bowed towards the tail
  }
  if (sp == 8u && code == 100u) { c = mix(c, c * .4, .8 * ss(.6, .9, sin((r.x - .2) * 314.)) * step(.2, r.x) * step(r.x, .3) * ss(.045, .035, abs(r.y + .012))); }
  // the mouth: a darker cut from the tip of the snout back; the blowhole(s) on top of the head
  var MO = array<vec4f, 10>(${JAWS.map((j, s) => (j ? `vec4f(${j.hx}, ${j.y0}, ${j.sl}, ${j.x1})` : s === 7 ? 'vec4f(.385, -.014, .05, .5)' : s === 9 ? 'vec4f(.25, -.006, -.17, .5)' : s === 8 ? 'vec4f(9., 0., 0., 0.)' : 'vec4f(0.)')).join(', ')});
  let mo = MO[sp]; let my = mo.y + mo.z * (.5 - r.x); let mw = select(.004, .007, sp == 9u);
  if (sp > 0u) { c = mix(c, c * .3 + vec3f(.05, .05, .06), .8 * ss(mw, mw * .3, abs(r.y - my)) * step(mo.x, r.x) * step(r.x, mo.w + .004)); }
  // under that line, down to the jaw's lower line, the head itself is the inside of the mouth: the jaw (112) lies over it until it opens
  var CH = array<f32, 10>(${JAWS.map((j) => (j ? j.chin : 0)).join(', ')});
  let hy = mo.y + mo.z * (.5 - mo.x); let low = hy + (r.x - mo.x) * (CH[sp] - hy) / (mo.w - mo.x);
  if (code0 == 100u && sp != 7u && sp != 9u && sp > 0u && r.x > mo.x && r.x < mo.w + .004 && r.y < my - .003 && r.y > low - .003) { c = mix(c, vec3f(.16, .04, .05), ss(.02, .2, gape)); } // (shut, it is skin like the rest)
  if (sp == 8u && r.y < -.015) {
    // the shark's: a crescent under the snout (SHARKM, creatures.js); inside it, under the jaw's plate, the mouth
    let ax = r.z / ${SHARKM.zc}; let xa = ${SHARKM.xf} - ${(SHARKM.xf - SHARKM.xh).toFixed(4)} * ax * ax;
    if (abs(ax) < 1.02) {
      if (code0 == 100u && r.x > ${SHARKM.xh} && r.x < xa) { c = mix(c, vec3f(.16, .04, .05), ss(.02, .2, gape)); }
      let slope = ${(2 * (SHARKM.xf - SHARKM.xh) / SHARKM.zc).toFixed(3)} * ax;
      c = mix(c, c * .25 + vec3f(.04, .04, .05), .85 * ss(.0034, .0012, abs(r.x - xa) / sqrt(1. + slope * slope)) * step(${SHARKM.xh} - .003, r.x));
    }
  }
  if (sp == 7u || sp == 9u) {
    let bx = select(.315, .27, sp == 9u); let bl = select(.013, .015, sp == 9u); let bg = select(0., .006, sp == 9u);
    c = mix(c, vec3f(.02), ss(1., .6, length(vec2f((r.x - bx) / bl, (abs(r.z) - bg) / (bl * .45)))) * step(.02, r.y));
  }
  return c;
}
/*CRIT_SHARED_END*/
@fragment fn fs(i: CO) -> @location(0) vec4f {
  let dist = length(i.wp - g.cam.xyz);
  let L = g.sun.xyz; let V = normalize(g.cam.xyz - i.wp);
  // a fin is one sheet seen from either side: light it, and paint it, by the side that faces the eye
  var n = normalize(i.n); let face = dot(n, V); if (face < 0.) { n = -n; }
  let z = zone(i.wp); let vv = vol(i.wp); let ca = caus(i.wp, dist);
  let on = normalize(i.on);
  let crab = i.sp == 0u;
  let alb = critAlb(i.sp, i.code, i.op, on.y, on.y * face > 0., i.gape) * .9;
  let E = sunE(i.wp.y, z) * shadow1(i.wp + n * .3);
  let fillN = vec3f(n.x, abs(n.y) * .55 + .25, n.z);
  let lit = E * sat(dot(n, L)) * (.3 + ca) + amb(i.wp, fillN, vv.g, z) * 1.5 + side(i.wp, n, 1., z) * 1.1;
  // So that the animals stand out from the rock (the crab most of all: small, and red where the water has taken the
  // red out of the light), they keep some of their own hue whatever the light's colour, at the brightness the light
  // gives them; and in dim light (lw: how much of it there is) some of it comes back in their colour, as it does
  // from the corals. In full sun that second part fades out, or they would be washed out at noon.
  let LUM = vec3f(.2126, .7152, .0722); let lw = dot(lit, vec3f(.1, .5, .5));
  var c = alb * lit;
  c = mix(c, alb * (dot(c, LUM) / max(dot(alb, LUM), .04)), select(.3, .65, crab));
  c += alb * select(.4, 1.3, crab) * lw * exp(-lw / .45);
  let wet = select(.35, 1., i.code == 102u);
  c += E * pow(sat(dot(n, normalize(V + L))), 40.) * .35 * wet * (.3 + ca);
  let sky = amb(i.wp, vec3f(0., 1., 0.), vv.g, z);
  c += sky * pow(1. - sat(dot(n, V)), 3.) * .22;
  return fin(fog(c, i.wp, z));
}
`;

// ---------------------------------------------------------------- water surface seen from below
// The surface is drawn in one of two ways (surfW(0), surfW(1)): flat, a sheet at sea level whose slopes come from the
// water texture, or as waves (waves.js): a fan of rings around the camera (a: a vertex's place from it) lifted by
// the simulated displacement tWD, each cascade read at the mip that suits the rings' spacing there and left out
// where the rings are too coarse for it, with the slopes from tWS. p0 is the place before the waves moved it
// sideways: the place the textures are read at.
const W_SFV = /*wgsl*/`
@vertex fn vs(@builtin(vertex_index) i: u32) -> VO {
  var o: VO;
  let p = vec2f(f32(i & 1u), f32(i >> 1u)) * 2. - 1.;
  let far = max(900., -g.cam.y * 60.); // wide enough to reach the horizon from any depth
  o.wp = vec3f(g.cam.x + p.x * far, 0., g.cam.z + p.y * far);
  o.cp = g.vp * vec4f(o.wp, 1.);
  return o;
}
`;
const W_SWV = /*wgsl*/`
@vertex fn vs(@location(0) a: vec2f) -> VO {
  var o: VO;
  let far = max(900., -g.cam.y * 60.);
  let r = length(a); let q = a * (min(r, far) / max(r, 1e-4));
  let p = g.cam.xz + q;
  let sp = max(r * .1, .02);
  var WLV = vec3f(${WL});
  var d = vec3f(0.);
  for (var c = 0; c < ${WC}; c++) {
    let lod = log2(max(sp * ${WN}. / WLV[c], 1.));
    if (lod < 5.5) { d += textureSampleLevel(tWD, sR, p / WLV[c], c, lod).xyz * ss(5.5, 4.5, lod); }
  }
  d *= ss(300., 120., r);
  o.p0 = p; o.wp = vec3f(p.x + d.x, d.y, p.y + d.z);
  o.cp = g.vp * vec4f(o.wp, 1.);
  return o;
}
`;
const W_SFS = 'let s2 = textureSample(tW, sR, turn(wq) / 4.7 + .2).ba; let s = (textureSample(tW, sR, wq / 13.).ba + vec2f(.8 * s2.x + .6 * s2.y, .8 * s2.y - .6 * s2.x) * .7 + textureSample(tW, sR, wq / 37. + .6).ba * .8) * fl;';
const W_SWS = 'let s = (' + WL.map((l, c) => 'textureSample(tWS, sR, i.p0 / ' + l + ', ' + c + ').xy' + (c > 1 ? ' * .6' : '')).join(' + ') + ') * (-1.7 * fl);';
// The sky in the window overhead. Flat: a gradient, with the slow, large waves of the water texture's blurred levels
// standing in for clouds.
const W_SKYF = /*wgsl*/`let sunv = 1.;
  let cl = textureSampleLevel(tW, sR, rr.xz / max(rr.y, .2) * .11 + vec2f(g.cam.w * .004, g.cam.w * .0015) + i.wp.xz * .0007, 3.).ba;
  let cloud = ss(.06, .2, cl.x + cl.y * .6) * ss(.15, .6, upk);
  var skyc = mix(vec3f(.46, .82, 1.) * 1.3, vec3f(.15, .58, 1.) * 1.3, pow(upk, .7)) * vec3f(${DAYQ.win}) + vec3f(1., .9, .7) * SUNT * pow(sd, 6.) * .22;
  skyc = mix(skyc, vec3f(1.3, 1.3, 1.27) * vec3f(${DAYQ.win}), cloud * .4);`;
// Waves: the sky of the hour (DAYQ: its colour overhead and at the horizon, the colour of a sunlit cloud, how much
// the clouds cover), stars at night, and the low cloud layer of web-ocean (js/wgsl/sky.js there): cumulus 2 km up,
// drifting slowly, each cloud darker where more cloud lies between it and the sun and with a bright lining around
// the sun. The sun's disc is hidden behind them (sunv).
const W_SKY = /*wgsl*/`
const KROT = mat2x2f(.8, .6, 0. - .6, .8);
fn kHash(v: u32) -> u32 { let s = v * 747796405u + 2891336453u; let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u; return (w >> 22u) ^ w; }
fn kCell(i: vec2i) -> u32 { return kHash(u32(i.x) * 1664525u + kHash(u32(i.y) + 1013904223u)); }
fn kGrad(i: vec2i) -> vec2f { let a = f32(kCell(i)) * (6.2831853 / 4294967296.); return vec2f(cos(a), sin(a)); }
fn kNoise(p: vec2f) -> f32 {
  let i = vec2i(floor(p)); let f = p - floor(p);
  let u = f * f * f * (f * (f * 6. - 15.) + 10.);
  return mix(mix(dot(kGrad(i), f), dot(kGrad(i + vec2i(1, 0)), f - vec2f(1., 0.)), u.x),
             mix(dot(kGrad(i + vec2i(0, 1)), f - vec2f(0., 1.)), dot(kGrad(i + vec2i(1, 1)), f - vec2f(1., 1.)), u.x), u.y);
}
fn kFbm(p: vec2f, oct: i32) -> f32 {
  var s = 0.; var a = .5; var q = p;
  for (var i = 0; i < oct; i++) {
    var n = kNoise(q);
    if (i >= 2) { n = mix(n, abs(n) * 2. - .38, .35); }
    s += a * n; q = KROT * q * 2.03 + vec2f(13.1, 7.7); a *= .5;
  }
  return s;
}
fn kEdge(q: vec2f, oct: i32) -> f32 {
  var p = q * .38 + vec2f(g.cam.w * .004, g.cam.w * .0012);
  p += vec2f(kNoise(p * .3 + vec2f(1.7, 9.2)), kNoise(p * .3 + vec2f(8.3, 2.8))) * 1.4;
  return kFbm(p * vec2f(1., 1.7), oct) * 1.3 + .5 + kNoise(q * .05 + vec2f(3.1, 1.3)) * .7 - ${1 - DAYQ.cov};
}
`;
const W_SKYW = /*wgsl*/`var sunv = 1.;
  var skyc = mix(vec3f(${DAYQ.hor}), vec3f(${DAYQ.zen}), pow(upk, .6)) + vec3f(1., .9, .7) * SUNT * pow(sd, 6.) * .22;
  if (max(win3.x, max(win3.y, win3.z)) > .002 && rr.y > .02) {
${WORLD[1] > 2 ? `    let sq = rr.xz / (1. + rr.y) * 70.; let sh = kCell(vec2i(floor(sq)));
    let sp = fract(sq) - .2 - vec2f(f32(sh & 255u), f32((sh >> 8u) & 255u)) * (.6 / 255.);
    skyc += vec3f(.55, .65, .85) * step(.9, f32(sh >> 16u) / 65535.) * ss(.14, .02, length(sp)) * (.3 + f32((sh >> 12u) & 15u) / 15.);
` : ''}    let ct = 2. / max(rr.y, .05); let far = ss(36., 18., ct);
    let cq = rr.xz * ct * 2.2 + g.cam.xz * .001;
    let cd = sat(kEdge(cq, 5) / .45) * far;
    if (cd > .002) {
      let sx = g.sun.xz / max(length(g.sun.xz), 1e-4);
      let s1 = sat(kEdge(cq + sx * .25, 3) / .45) * far;
      let tau = cd * 2.4; let al = 1. - exp(0. - tau);
      let cc = vec3f(${DAYQ.cl}) * (.58 + .42 * exp(0. - (cd * .5 + s1 * 1.6) * 1.1)) + vec3f(1., .93, .8) * SUNT * pow(sd, 10.) * tau * exp(0. - tau) * 1.6;
      skyc = mix(skyc, cc, al); sunv = 1. - al;
    }
  }`;
const surfW = (wv) => S_B + /*wgsl*/`
struct VO { @builtin(position) cp: vec4f, @location(0) wp: vec3f${wv ? ', @location(1) p0: vec2f' : ''} };
${wv ? W_SKY + W_SWV : W_SFV}
@fragment fn fs(i: VO) -> @location(0) vec4f {
  let v = i.wp - g.cam.xyz; let d = length(v); let V = v / d;
  let fl = ss(260., 60., d);
  let wq = unrep(i.wp.xz).xy;
  ${wv ? W_SWS : W_SFS}
  let n = normalize(vec3f(-s.x * .8, -1., -s.y * .8));
  let ci = sat(dot(V, -n));
  let k = 1. - 1.769 * (1. - ci * ci);
  // Snell's window: the sky is seen where the light can still get through; its edge comes a little apart into
  // colours (red bends least), and is the brightest part of it
  let win3 = vec3f(ss(0., .22, 1. - 1.757 * (1. - ci * ci)), ss(0., .22, k), ss(0., .22, 1. - 1.781 * (1. - ci * ci)));
  let rim = ss(0., .07, k) * ss(.3, .07, k);
  let rr = refract(V, n, 1.33);
  let sd = max(dot(rr, g.sun.xyz), 0.);
  let fr = pow(1. - sqrt(max(k, 0.)), 5.);
  // the sky in it: deeper blue overhead, pale towards its edge, a glow around the sun, and clouds drifting over
  // (the slow, large waves of the water texture's blurred levels stand in for them)
  let upk = sat(rr.y);
  ${wv ? W_SKYW : W_SKYF}
  // the wave slopes tilt the view of it: bright and dark bands, and glints on the steepest of them
  let glint = pow(sat(length(s) * 1.5 - .5), 3.) * (.4 + 1.6 * pow(sd, 4.));
  let sky = (skyc * ${wv ? 'clamp(1. + 1.8 * (s.x * .6 - s.y * .8), .62, 1.9)' : 'clamp(1. + 3.8 * (s.x * .6 - s.y * .8), .25, 3.)'} + vec3f(1., .95, .85) * SUNT * ((pow(sd, 60.) * 1.3 + pow(sd, 500.) * 12.) * sunv + glint) + vec3f(1., .97, .9) * vec3f(${DAYQ.win}) * rim * .3) * (1. - fr);
  let z = zone(g.cam.xyz + V * min(d, 150.)); // the ground map only covers the loaded window
  // outside the window the surface is a mirror of the water below: it shimmers with the light that plays on it
  let R = reflect(V, n);
  let shim = ${wv ? '0.' : 'textureSample(tW, sR, wq / 9. + vec2f(.3, .7)).r * fl'}; // (off with the waves for now: being judged)
  let refl = fogIn(i.wp, R, 300., z, g.sun.xyz) * (1.05 + .8 * shim) + vec3f(.012, .045, .045) * exp(g.cam.y * .04) * (.5 + shim);
  let c = mix(refl, sky, win3);
  return fin(fog(c, i.wp, z));
}
// behind everything: where no terrain is drawn (it fades out by 135 m) the water looks as it does far away
@vertex fn vsB(@builtin(vertex_index) i: u32) -> VO {
  var o: VO;
  let p = vec2f(f32(i & 1u), f32(i >> 1u)) * 2. - 1.;
  o.wp = g.cam.xyz + g.fwd.xyz + g.right.xyz * (p.x * g.right.w) + g.up.xyz * (p.y * g.up.w);
  o.cp = vec4f(p, 1e-7, 1.);
  return o;
}
@fragment fn fsB(i: VO) -> @location(0) vec4f {
  let p = g.cam.xyz + normalize(i.wp - g.cam.xyz) * 600.;
  return fin(fog(vec3f(0.), p, g.sun.w));
}
`;
const W_SURF = surfW(0);

// ---------------------------------------------------------------- sprites: bubbles (alpha) and drifting particles (additive)
const W_SPR = S_B + /*wgsl*/`
struct VO { @builtin(position) cp: vec4f, @location(0) uv: vec2f, @location(1) @interpolate(flat) pr: vec4f, @location(2) wp: vec3f };
fn quad(i: u32) -> vec2f { return vec2f(f32(i & 1u), f32(i >> 1u)) * 2. - 1.; }
@vertex fn vsBub(@builtin(vertex_index) vi: u32, @location(0) a: vec4f, @location(1) b: vec4f) -> VO {
  var o: VO; let q = quad(vi); let t = g.cam.w;
  let life = fract(t * b.y / b.z + b.x);
  let h = life * b.z;
  var p = a.xyz + vec3f(0., h, 0.);
  let wob = b.w * (.3 + h * .035);
  p.x += sin(t * 1.7 + b.x * 50. + h * .6) * wob + sin(h * .13 + b.x * 9.) * b.w * 2.;
  p.z += cos(t * 1.3 + b.x * 33. + h * .5) * wob + cos(h * .11 + b.x * 7.) * b.w * 2.;
  let sz = a.w * (.55 + .7 * life) * ss(0., .03, life) * ss(0., -1.2, p.y);
  let w = p + (g.right.xyz * q.x + g.up.xyz * q.y) * sz;
  o.cp = g.vp * vec4f(w, 1.); o.uv = q; o.wp = p;
  // (a negative wobble marks a gurgled bubble, bots.js: it wobbles the same, mirrored)
  o.pr = vec4f(b.x, sz, shadow1(p), step(b.w, 0.));
  return o;
}
@fragment fn fsBub(i: VO) -> @location(0) vec4f {
  let t = g.cam.w;
  let an = atan2(i.uv.y, i.uv.x + 1e-4);
  let big = ss(.04, .22, i.pr.y);
  let r = length(i.uv) / (.9 + big * .05 * sin(an * 3. + t * 5. + i.pr.x * 40.) + big * .02 * sin(an * 5. - t * 7.));
  let aa = fwidth(r) * 1.5;
  let disc = 1. - ss(1. - aa, 1., r);
  let rim = ss(.55, .98, r);
  let hl = ss(.34, .0, length(i.uv - vec2f(-.36, .42))) + .5 * ss(.2, .0, length(i.uv - vec2f(.4, -.42)));
  let z = zone(i.wp);
  let E = sunE(i.wp.y, z) * (.25 + .75 * i.pr.z);
  let hi = fogIn(i.wp, vec3f(0., 1., 0.), 80., z, g.sun.xyz) * 1.5;
  let lo = fogIn(i.wp, vec3f(0., -1., 0.), 80., z, g.sun.xyz);
  var c = mix(lo, hi, ss(-.5, .8, i.uv.y + rim * .4)) * (.5 + 1.2 * rim) + E * hl * 1.6;
  var al = disc * sat(.03 + rim * rim * rim * .9 + hl);
  let v = i.wp - g.cam.xyz; let d = length(v);
  // the stock bubbles dim into the water's own colour close to the eye; a gurgled one is watched from close by and stays bright
  let T = exp(-SIG.g * d) * mix(ss(1.2, 3., d), 1., i.pr.w);
  c = c * T + fogIn(g.cam.xyz, v / d, d, z, g.sun.xyz) * (1. - T);
  al *= mix(.35, 1., T) * ss(100. * g.mis.z, 64. * g.mis.z, d);
  return vec4f(min(max(c * al, vec3f(0.)), vec3f(20.)), al);
}
@vertex fn vsSnow(@builtin(vertex_index) vi: u32, @location(0) a: vec4f) -> VO {
  var o: VO; let q = quad(vi); let t = g.cam.w;
  let B = 44.;
  var p = a.xyz * B + vec3f(t * .22, t * .05, t * .13) + .5 * vec3f(sin(t * .3 + a.x * 60.), sin(t * .23 + a.y * 50.), cos(t * .27 + a.z * 70.));
  p = g.cam.xyz + (fract((p - g.cam.xyz) / B + .5) - .5) * B;
  let d = length(p - g.cam.xyz);
  let sz = (.012 + .045 * a.w * a.w * a.w);
  let w = p + (g.right.xyz * q.x + g.up.xyz * q.y) * max(sz, d * .0011);
  o.cp = g.vp * vec4f(w, 1.); o.uv = q; o.wp = p;
  let fade = ss(B * .5, B * .32, d) * ss(.6, 2.5, d) * min(1., sz / (d * .0011)) * ss(-.3, -1.5, p.y);
  let tw = .6 + .4 * sin(t * (1. + a.w * 2.) + a.x * 100.);
  o.pr = vec4f(fade * tw, shadow1(p), a.w, d);
  return o;
}
@fragment fn fsSnow(i: VO) -> @location(0) vec4f {
  let r = length(i.uv);
  let m = ss(1., .2, r);
  let z = zone(i.wp);
  let c = (sunE(i.wp.y, z) * i.pr.y * .8 + amb(i.wp, vec3f(0., 1., 0.), 1., z) * .3) * mix(vec3f(1.), vec3f(.7, 1., .9), i.pr.z);
  return vec4f(min(max(c * m * m * i.pr.x * exp(-SIG.g * i.pr.w), vec3f(0.)), vec3f(8.)), 0.);
}
`;

// ---------------------------------------------------------------- volumetric light shafts (half res)
// With Surface: Waves the shafts are the light the two larger cascades focus (as caus does, by the sum of the
// curvatures alone), read coarser than the caustics: a shaft is the path of a bright patch through the water.
// The depth it is worked out for is held between 12 and 45 m: the shafts reach the surface and the deep, as the
// flat surface's do (the water's glow at any depth is theirs).
const W_RWV = 'let hh = clamp(0. - p.y / sx.y, 12., 45.); let lp = textureSampleLevel(tW, sR, q / ' + WL[0] + ', 0, log2(max(hh * ' + WN * 0.06 / WL[0] + ', 2.))).zw + textureSampleLevel(tW, sR, q / ' + WL[1] + ', 1, log2(max(hh * ' + WN * 0.06 / WL[1] + ', 4.))).zw; let pat = ss(.7, 1.8, 1. / max(abs(1. + hh * .25 * (lp.x + lp.y)), .25));';
const W_RAYS = S_G + W_FS + /*wgsl*/`
@group(0) @binding(0) var<uniform> g: G;
@group(0) @binding(1) var sR: sampler;
@group(0) @binding(2) var sS: sampler_comparison;
@group(0) @binding(3) var tSh: texture_depth_2d;
@group(0) @binding(4) var tW: texture_2d${GFX[7] ? '_array' : ''}<f32>;
@group(0) @binding(5) var tDp: texture_depth${AA > 1 ? '_multisampled' : ''}_2d;
@group(0) @binding(6) var tV: texture_3d<f32>;
@group(0) @binding(7) var sC: sampler;
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let dp = textureLoad(tDp, vec2i(fc.xy) * 2, 0);
  let uv = fc.xy * 2. * g.res.zw;
  let nd = vec2f(uv.x * 2. - 1., 1. - uv.y * 2.);
  let rv = g.fwd.xyz + g.right.xyz * (nd.x * g.right.w) + g.up.xyz * (nd.y * g.up.w);
  let rl = length(rv); let rd = rv / rl;
  // open water to the horizon has no depth: keep its distance within what the half-float target holds (the blur divides by it)
  let zl = min(g.fwd.w / max(dp, 1e-6), 3e4);
  var tm = min(zl * rl, 120.);
  if (rd.y > 1e-4) { tm = min(tm, -g.cam.y / rd.y); }
  let ro = g.cam.xyz; let sx = g.sun.xyz; let k = kd(g.sun.w); let sgz = sg(g.sun.w);
  let dt = tm / ${RAYN}.;
  let j = ign(fc.xy);
  var acc = vec3f(0.);
  for (var n = 0; n < ${RAYN}; n++) {
    let t = (f32(n) + j) * dt;
    let p = ro + rd * t;
    let s = g.sm * vec4f(p, 1.);
    let vis = textureSampleCompareLevel(tSh, sS, vec2f(s.x * .5 + .5, .5 - s.y * .5), (gridBase(p.x) + (bandH(p.x) + 4.) - p.y) / (bandH(p.x) + 10.) - .002);
    let q = p.xz - sx.xz * (p.y / sx.y);
    ${GFX[7] ? W_RWV : 'let pat = ss(.3, .7, textureSampleLevel(tW, sR, q / 27., 2.5).r) * ss(.15, .6, textureSampleLevel(tW, sR, q.yx / 11. + .3, 2.).r);'}
    let o = textureSampleLevel(tV, sC, vec3f(p.x / ${SPAN}., clamp((p.y - gridBase(p.x)) / bandH(p.x), .0125, .9875), p.z / ${SPAN}.), 0.).r;
    let mist = sat(1. - (o - .5) * 3.4);
    acc += exp(-sgz * t + k * (p.y / sx.y)) * (vis * (.012 + pat * 6.) * (1. + 1.2 * mist * mist));
  }
  let mu = max(dot(rd, sx), 0.);
  let ph = mix(.2 + 2.0 * mu * mu * mu, .8, g.sun.w);
  let wc = mix(WCOL + vec3f(.04, .07, .05), PCOL + vec3f(.28, .16, .12), g.sun.w);
  return vec4f(min(acc * dt * sgz * wc * SUNC * ph * g.mis.y * (1. - .55 * g.sun.w), vec3f(20.)), zl);
}
`;
// depth-aware 3x3 blur of the half-res shafts (hides the sampling dither)
const W_RBLUR = W_FS + /*wgsl*/`
@group(0) @binding(0) var tR: texture_2d<f32>;
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let p = vec2i(fc.xy); let mx = vec2i(textureDimensions(tR)) - 1;
  let c = textureLoad(tR, p, 0);
  var acc = vec3f(0.); var ws = 0.;
  for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
    let r = textureLoad(tR, clamp(p + vec2i(x, y) , vec2i(0), mx), 0);
    let w = 1. / (.03 + abs(r.a - c.a) / c.a);
    acc += r.rgb * w; ws += w;
  } }
  return vec4f(acc / ws, c.a);
}
`;

// ---------------------------------------------------------------- final composite
const W_POST = S_G + W_FS + /*wgsl*/`
@group(0) @binding(0) var<uniform> g: G;
@group(0) @binding(1) var sC: sampler;
@group(0) @binding(2) var tS: texture_2d<f32>;
@group(0) @binding(3) var tR: texture_2d<f32>;
@group(0) @binding(4) var tB: texture_2d<f32>;
@group(0) @binding(5) var tDp: texture_depth${AA > 1 ? '_multisampled' : ''}_2d;
fn tmap(x: vec3f) -> vec3f { return sat3((x * (2.51 * x + .03)) / (x * (2.43 * x + .59) + .14)); }
fn sat3(x: vec3f) -> vec3f { return clamp(x, vec3f(0.), vec3f(1.)); }
override SRGB = 0.;
@fragment fn fs(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let fc = fp.xy - g.xo.xy;
  let px = vec2i(fc);
  let uv = fc * g.res.zw;
  let zf = g.fwd.w / max(textureLoad(tDp, px, 0), 1e-6);
  // depth-aware upsample of the half-res shafts
  let h = fc * .5 - .5; let b = floor(h); let f = h - b; let bi = vec2i(b);
  let mx = vec2i(textureDimensions(tR)) - 1;
  var acc = vec3f(0.); var ws = 0.;
  for (var k = 0; k < 4; k++) {
    let o = vec2i(k & 1, k >> 1);
    let r = textureLoad(tR, clamp(bi + o, vec2i(0), mx), 0);
    let bw = mix(1. - f.x, f.x, f32(o.x)) * mix(1. - f.y, f.y, f32(o.y));
    let w = (bw + .02) / (.02 + abs(r.a - zf) / zf);
    acc += r.rgb * w; ws += w;
  }
  var c = textureLoad(tS, px, 0).rgb + acc / ws;
  let bl = textureSampleLevel(tB, sC, uv, 0.).rgb;
  c = mix(c, bl, .06) + bl * .03;
  c *= g.mis.x;
  let q = uv - g.xr.xy;
  c *= 1. - dot(q, q) * .55;
  c *= 1. - g.xr.z * ss(.1, .36, length(q)); // comfort vignette while moving in VR
  c = tmap(c);
  let l0 = dot(c, vec3f(.2126, .7152, .0722));
  let l = mix(l0, l0 * l0 * (3. - 2. * l0), .55);
  c *= l / max(l0, 1e-4);
  c = mix(c, vec3f(l), ss(.55, 1., l) * .1);
  c = mix(vec3f(l), c, .93) + vec3f(.008, .002, 0.);
  if (SRGB < .5) { c = pow(max(c, vec3f(0.)), vec3f(1. / 2.2)); }
  let n = ign(fc) + ign(fc + 37.) - 1.;
  return vec4f(c + n / 255., 1.);
}
`;
