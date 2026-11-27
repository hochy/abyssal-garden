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

// ---------------------------------------------------------------- terrain density (compute)
const W_DENS = W_NOISE + /*wgsl*/`
struct U { n: vec4u, o: vec4f, c: vec4u };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read_write> D: array<f32>;
@group(0) @binding(2) var<storage, read> P: array<vec4f>;
fn smax(a: f32, b: f32, k: f32) -> f32 { let h = max(k - abs(a - b), 0.) / k; return max(a, b) + h * h * k * .25; }
fn smin(a: f32, b: f32, k: f32) -> f32 { return -smax(-a, -b, k); }
fn seg2(p: vec2f, a: vec2f, b: vec2f) -> f32 { let pa = p - a; let ba = b - a; let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0., 1.); return length(pa - ba * h); }
fn seg3(p: vec3f, a: vec3f, b: vec3f) -> f32 { let pa = p - a; let ba = b - a; let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0., 1.); return length(pa - ba * h); }
fn horn(p: vec3f, a: vec3f, b: vec3f, r: f32) -> f32 {
  let pa = p - a; let ba = b - a; let h = clamp(dot(pa, ba) / dot(ba, ba), 0., 1.);
  return r * (1. - .85 * h) - length(pa - ba * h);
}
fn dens(p: vec3f) -> f32 {
  let w = vec3f(fbm(p * .04 + 11., 3), fbm(p * .04 + 47., 3), fbm(p * .04 + 83., 3)) - .5;
  let q = p + w * 14.;
  let len = length(q); let qn = q / max(len, 1e-3);
  var d = 54. - length(q * vec3f(1., 1.07, .94)) + (fbm(p * .035 + 5., 4) - .5) * 16.;
  let PADD = vec3f(.1455, .9703, .1941);
  let ph = dot(p, PADD); let pad = ss(17., 9., length(p - PADD * ph)) * step(30., ph);
  d += ((.5 - wor(p * .11 + w * 2.)) * 3.4 + (fbm(p * .3, 3) - .5) * 1.6 - 3.2 * ss(.3, .05, wor(q * .06 + 9.))) * (1. - pad);
  d = mix(d, 53. - ph, pad);
  for (var i = 0u; i < u.c.x; i++) {
    let c = P[i]; let t = length(qn - c.xyz) * 54. / c.w;
    d -= c.w * (.42 * max(1. - t * t, 0.) - .11 * exp(-pow((t - 1.06) / .13, 2.))) * ss(30., 44., len);
  }
  // a canyon round the southern half, a shaft through the middle, a hollow core
  let cd = max(max(abs(dot(q, vec3f(0., .3, -.954))) - (4.5 + 4.5 * ss(40., 56., len)), 40. + (fbm(q * .06 + 3., 3) - .5) * 5. - len), 14. + dot(q, vec3f(0., .954, .3)));
  d = smin(d, cd, 3.);
  let SH = vec3f(.5507, -.1502, .8211); let sh = dot(p, SH);
  d = smin(d, length(p + w * 3. - SH * sh) - (6. + 2.5 * ss(30., 60., abs(sh))), 3.);
  d = smin(d, length(p) - 15. - (fbm(p * .15, 3) - .5) * 6., 3.);
  d = smax(d, horn(p + w * 2., vec3f(29., 23., -28.), vec3f(40., 52., -30.), 5.), 2.);
  d = smax(d, horn(p + w * 2., vec3f(38., -6., -30.), vec3f(58., -18., -38.), 4.), 2.);
  d = smax(d, horn(p + w * 2., vec3f(-20., -30., 36.), vec3f(-30., -46., 46.), 4.5), 2.);
  return d;
}
// dispatched in slabs along z (u.n.w = first z of the slab): one long dispatch can trip a mobile GPU's watchdog
@compute @workgroup_size(4, 4, 4) fn main(@builtin(global_invocation_id) gid: vec3u) {
  let id = gid + vec3u(0u, 0u, u.n.w);
  if (any(id >= u.n.xyz)) { return; }
  var d = dens(u.o.xyz + vec3f(id) * u.o.w);
  if (any(id == vec3u(0u)) || any(id == u.n.xyz - vec3u(1u))) { d = -1.; }
  D[id.x + u.n.x * (id.y + u.n.y * id.z)] = d;
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
const S_G = /*wgsl*/`
// xr: lens centre in the view (uv) and comfort vignette strength; xo: the view's viewport origin in its target.
// Both only matter in VR (xr.js); on the desktop they are (.5, .5, 0) and 0.
struct G { vp: mat4x4f, sm: mat4x4f, cam: vec4f, right: vec4f, up: vec4f, fwd: vec4f, sun: vec4f, res: vec4f, mis: vec4f, xr: vec4f, xo: vec4f };
const SIG = vec3f(.0030, .0034, .0030);
const WCOL = vec3f(.016, .022, .06);
const SUNC = vec3f(2.1, 1.8, 1.4);
const PD = vec3f(-.6217, .5014, -.6017);
const TAU = 6.2831853;
const LOW = ${LV > 1};
fn sat(x: f32) -> f32 { return clamp(x, 0., 1.); }
fn ss(a: f32, b: f32, x: f32) -> f32 { let t = clamp((x - a) / (b - a), 0., 1.); return t * t * (3. - 2. * t); }
fn ign(p: vec2f) -> f32 { return fract(52.9829189 * fract(dot(p, vec2f(.06711056, .00583715)))); }
fn hs(x: f32) -> f32 { return fract(sin(x * 127.1) * 43758.5453); }
fn fin(c: vec3f) -> vec4f { return vec4f(min(max(c, vec3f(0.)), vec3f(40.)), 1.); }
fn fogIn(ro: vec3f, rd: vec3f, d: f32, z: f32, sun: vec3f) -> vec3f {
  let mu = max(dot(rd, sun), 0.); let m2 = mu * mu;
  return WCOL * (1. - exp(-SIG * d)) * (1. + vec3f(2., 1.4, .8) * m2 * m2 * m2);
}
fn cpal(h: f32) -> vec3f {
  if (h < .35) { return vec3f(.10, .75, 1.); }
  if (h < .6) { return vec3f(.45, .25, 1.); }
  if (h < .82) { return vec3f(1., .2, .65); }
  return vec3f(1., .6, .12);
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
fn shUV(p: vec3f) -> vec3f { let s = g.sm * vec4f(p, 1.); return vec3f(s.x * .5 + .5, .5 - s.y * .5, s.z - .0007); }
fn shadow1(p: vec3f) -> f32 { let s = shUV(p); return textureSampleCompareLevel(tSh, sS, s.xy, s.z); }
fn shadow4(p: vec3f) -> f32 {
  let s = shUV(p); let e = 1.8 / ${SHADOW}.;
  return (textureSampleCompareLevel(tSh, sS, s.xy + vec2f(-e, -e), s.z) + textureSampleCompareLevel(tSh, sS, s.xy + vec2f(e, -e), s.z)
        + textureSampleCompareLevel(tSh, sS, s.xy + vec2f(-e, e), s.z) + textureSampleCompareLevel(tSh, sS, s.xy + vec2f(e, e), s.z)) * .25;
}
fn shadow9(p: vec3f) -> f32 {
  if (LOW) { return shadow1(p); }
  let s = shUV(p); let e = 2.1 / ${SHADOW}.; var a = 0.;
  for (var x = -1; x <= 1; x++) { for (var y = -1; y <= 1; y++) { a += textureSampleCompareLevel(tSh, sS, s.xy + vec2f(f32(x), f32(y)) * e, s.z); } }
  return a / 9.;
}
fn caus(p: vec3f, d: f32) -> vec3f { return vec3f(.36); }
fn caus2(p: vec3f, d: f32) -> f32 { return .36; }
fn sunE(y: f32, z: f32) -> vec3f { return SUNC; }
fn vol(p: vec3f) -> vec4f { return textureSampleLevel(tV, sC, (p + 76.8) / 153.6, 0.); }
// nebula light from all round, warm light off the giant, a little from below
fn amb(p: vec3f, n: vec3f, sky: f32, z: f32) -> vec3f {
  return vec3f(.055, .075, .17) * (.4 + .6 * (n.y * .5 + .5)) * (.45 + .55 * sky) + vec3f(.30, .18, .11) * sat(dot(n, PD) * .6 + .3) * .3
       + vec3f(.012, .012, .026);
}
fn zone(p: vec3f) -> f32 { return 0.; }
fn side(p: vec3f, n: vec3f, open: f32, z: f32) -> vec3f { return vec3f(.03, .04, .09) * open * (1. - abs(n.y)) * .7; }
fn fog(c: vec3f, wp: vec3f, z: f32) -> vec3f {
  let v = wp - g.cam.xyz; let d = length(v);
  return c * exp(-SIG * d) + fogIn(g.cam.xyz, v / d, d, z, g.sun.xyz);
}
fn qrot(q: vec4f, v: vec3f) -> vec3f { return v + 2. * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
fn qmul(a: vec4f, b: vec4f) -> vec4f { return vec4f(a.w * b.xyz + b.w * a.xyz + cross(a.xyz, b.xyz), a.w * b.w - dot(a.xyz, b.xyz)); }
`;

// ---------------------------------------------------------------- solid meshes (terrain, rocks, set pieces, sponges, coral)
const W_SOLID = S_B + /*wgsl*/`
struct VI { @location(0) p: vec3f, @location(1) n: vec4f, @location(2) a: vec4f, @location(3) b: vec4f, @location(4) c: vec4f };
struct VO { @builtin(position) cp: vec4f, @location(0) wp: vec3f, @location(1) n: vec3f, @location(2) op: vec3f, @location(3) on: vec3f,
  @location(4) @interpolate(flat) m: vec4f, @location(5) @interpolate(flat) q: vec4f, @location(6) ao: f32 };
@vertex fn vs(i: VI) -> VO {
  var o: VO;
  var sc = i.a.w;
  if (i.c.x < 1.5 && i.c.z > 1.5 && g.res.x > 0.) { sc *= 1. - ss(i.c.z * .7, i.c.z, distance(i.a.xyz, g.cam.xyz) / g.mis.z); }
  var ctr = i.a.xyz; var qb = i.b;
  if (i.c.w < 0.) { // a moonlet: turns about the y axis, and stays out of the baked shadow map
    let an = g.cam.w * i.c.w; let cs = cos(an); let sn = sin(an);
    ctr = vec3f(cs * ctr.x + sn * ctr.z, ctr.y, -sn * ctr.x + cs * ctr.z);
    qb = qmul(vec4f(0., sin(an * .5), 0., cos(an * .5)), i.b);
    if (g.res.x == 0.) { sc = 0.; }
  } else { ctr.y += sin(g.cam.w * .3 + i.c.y * 40.) * i.c.w; }
  let w = ctr + qrot(qb, i.p * sc);
  o.cp = g.vp * vec4f(w, 1.); o.wp = w; o.n = qrot(qb, i.n.xyz); o.op = i.p * i.a.w + i.c.y * 37.; o.on = i.n.xyz;
  o.m = i.c; o.q = qb; o.ao = i.n.w;
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
  let A = tri(i.op, on, .1 * ts); let B = tri(i.op, on, .43 * ts); let C = tri(i.op, on, 1.9 * ts); let F = tri(i.op, on, 6.7 * ts); let fk = ss(10., 1.5, dist) * f32(mat <= 1);
  let Wd = textureSample(tD, sR, vec2f(i.op.x * .06, (i.op.y + i.op.z) * .7));
  let big = textureSample(tD, sR, i.op.xz * .013 + i.op.y * .021).a;
  let big2 = textureSample(tD, sR, i.op.zx * .031 + i.op.y * .043 + .37).a;
  var sgro = 0.;
  let sk = textureSample(tD, sR, vec2f((i.op.x + i.op.z) * .33, i.op.y * .035));
  let sk2 = textureSample(tD, sR, vec2f((i.op.x - i.op.z) * 1.1, i.op.y * .11));
  let gm = textureSample(tM, sC, i.wp.xz / 384. + .5);
  let ca = caus(i.wp, dist);
  let hgt = A.h * .5 + B.h * .35 + C.h * .15;
  var bump = 1.7; var gloss = .1; var alb = vec3f(0.); var emi = vec3f(0.); var vao = 1.; var flu = 0.;
  let flt = ss(.72, .93, n0.y);
  var iri = 0.;
  let lp = (i.op - sd * 37.) * i.m.z;
  if (mat <= 1) {
    // asteroid rock: dark stone, pale dust on open ground, rusty patches, glowing mineral veins on the walls
    let rdl = normalize(i.wp);
    let open = ss(.5, .9, dot(n0, rdl));
    let rock = mix(vec3f(.07, .068, .075), vec3f(.17, .145, .125), sat(A.c * 1.4 - .2)) * (.45 + 1.2 * hgt);
    let dust = mix(vec3f(.085, .08, .082), vec3f(.14, .128, .125), B.c) * (.55 + .6 * C.h);
    alb = mix(rock, dust, open * ss(.25, .55, big + B.h * .3));
    alb = mix(alb, vec3f(.34, .18, .10) * (.5 + B.h), ss(.6, .75, big2) * .35);
    alb *= mix(1., .62 + .76 * F.h, fk);
    let vein = ss(.007, .0015, abs(big * .55 + B.c * .45 + A.h * .25 - .62)) * (1. - open) * f32(mat == 0);
    emi = mix(vec3f(.1, .8, 1.), vec3f(.9, .25, .9), ss(.4, .6, big2)) * vein * (.5 + .5 * sin(g.cam.w * .5 + big * 30.)) * 1.3;
    if (mat == 0) {
      let mg = open * sat(ss(.5, .66, big * .6 + big2 * .5) * 1.5 - .45 + (B.c - .5) * 1.6) * ss(.35, .6, A.h);
      alb = mix(alb, vec3f(.16, .03, .12) * (.4 + .9 * B.h), mg * .28);
      flu = mg * .35;
    }
  } else if (mat == 7) {
    let c2 = lp.xy - vec2f(0., 9.1); let r = length(c2); let a = atan2(c2.y, c2.x);
    if (i.ao < -.5) {
      // the gate's membrane: a slow bright swirl
      let s1 = textureSampleLevel(tD, sR, vec2f(a / TAU * 3. + g.cam.w * .02 + r * .17, r * .12 - g.cam.w * .05), 1.);
      let s2 = textureSampleLevel(tD, sR, vec2f(a / TAU * 5. - g.cam.w * .03 - r * .26, r * .27 + g.cam.w * .08), 1.);
      let e = pow(s1.b * s2.b * 2.2, 2.2) + .7 * pow(r / 7.6, 6.);
      alb = vec3f(0.); gloss = 0.; bump = 0.;
      emi = mix(vec3f(.15, .1, .9), vec3f(.2, .95, 1.), s1.a) * e * 2.6 + vec3f(1., .5, .9) * pow(s2.a * s1.b * 1.6, 5.) * 2.;
    } else if (lp.y < .55 && r > 8.) {
      alb = vec3f(.09, .09, .11) * (.5 + .8 * B.h); gloss = .5; bump = .6;
    } else {
      // the ring: dark brushed metal with engraved grooves and one bright channel running round each face
      let tr = r - 8.5;
      alb = vec3f(.11, .115, .13) * (.7 + .5 * B.h) * (1. - .55 * ss(.05, .0, abs(fract(tr * 2.4) - .5)));
      let run = .5 + .5 * sin(a * 3. - g.cam.w * 1.2);
      emi = mix(vec3f(.2, .9, 1.), vec3f(.7, .3, 1.), run) * ss(.1, .03, abs(tr)) * step(.5, abs(lp.z)) * (.5 + 1.4 * run * run);
      gloss = .9; bump = .2; iri = .25;
    }
  } else if (mat == 4) {
    // fungi: pale stalk, dark cap with glowing spots, bright gills underneath
    let gc = cpal(fract(sd * 3.3));
    let capm = ss(.85, 1., i.ao);
    alb = mix(vec3f(.30, .27, .36), gc * .16 + vec3f(.03, .02, .06), capm) * (.5 + .7 * B.h);
    let spot = ss(.62, .72, C.c) * capm;
    emi = gc * (ss(.45, .1, i.ao) * 2.4 + spot * 1.2) * (.7 + .3 * sin(g.cam.w * .9 + sd * 40.));
    vao = .4 + .6 * i.ao; gloss = .35; bump = .8; flu = .3;
  } else if (mat == 5) {
    // crystals: brighter toward the tip
    let gc = cpal(sd);
    alb = gc * gc * .25;
    emi = gc * gc * (.07 + .75 * i.ao * i.ao * i.ao) * (.75 + .25 * sin(g.cam.w * .7 + sd * 50. + i.wp.x * .3));
    gloss = 1.; bump = .12; iri = .5;
  }
  let rip = 0.;
  let N = normalize(qrot(i.q, normalize(on + (A.n * .85 + B.n * .65 + C.n * .45 * ss(60., 12., dist) + F.n * .5 * fk) * bump + vec3f(.8, sgro, .35) * vec3f(rip, 1., rip))));
  let L = g.sun.xyz; let V = normalize(g.cam.xyz - i.wp);
  let v1 = vol(i.wp + n0 * 1.5); let v2 = vol(i.wp + n0 * 4.5);
  let ao = (sat((v1.r - .5) * 8.) * .55 + sat((v2.r - .5) * 2.7) * .45) * vao * ss(.12, .6, hgt);
  let z = zone(i.wp);
  let E = sunE(i.wp.y, z) * shadow9(i.wp + n0 * .35);
  let ndl = sat(dot(N, L));
  let am = (amb(i.wp, N, v1.g, z) + side(i.wp, N, sat((v2.r - .5) * 2.7), z)) * ao;
  let dl = E * ndl * (.10 + mix(vec3f(.33), ca, ss(.1, .45, dot(n0, L))) * 2.5);
  var c = alb * (dl + am) + emi + alb * flu * dot(dl + am, vec3f(.1, .5, .5));
  let H = normalize(V + L);
  c += E * (.25 + ca) * pow(sat(dot(N, H)), mix(10., 70., gloss)) * gloss * ndl * 1.8;
  c += (amb(i.wp, reflect(-V, N), v1.g, z) + side(i.wp, reflect(-V, N), sat((v2.r - .5) * 2.7), z)) * ao * (.08 + gloss) * .6 * pow(1. - sat(dot(N, V)), 2.5);
  let ndv = sat(dot(N, V));
  c += iri * (.5 + .5 * cos(TAU * (vec3f(0., .33, .67) + ndv * 1.3 + sd))) * (am * 2. + E * ndl * .3 + .02) * (1. - ndv * .6);
  return fin(fog(c, i.wp, z));
}
`;

// ---------------------------------------------------------------- leaves (kelp, grasses, ground cover)
const W_LEAF = S_B + /*wgsl*/`
override ROWS: f32 = 7.;
override FAR: f32 = 150.;
struct LI { @location(0) a: vec4f, @location(1) b: vec4f, @location(2) c: vec4f };
struct LO { @builtin(position) cp: vec4f, @location(0) wp: vec3f, @location(1) n: vec3f, @location(2) uv: vec2f,
  @location(3) @interpolate(flat) col: vec3f, @location(4) @interpolate(flat) pr: vec4f,
  @location(5) @interpolate(flat) sd: vec2f, @location(6) @interpolate(flat) spc: vec3f };
fn sway(p: vec2f, h: f32, t: f32) -> vec2f {
  let ph = dot(p, vec2f(.031, .017));
  let a = .011 * pow(max(h, 0.), 1.25);
  return a * (vec2f(sin(t * .5 + ph + h * .09), cos(t * .37 + ph * 1.3 + h * .07)) + .35 * vec2f(sin(t * 1.3 + ph * 3. + h * .3), cos(t * 1.1 + ph * 2. + h * .23)));
}
fn shape2(v: f32) -> f32 { return sin(3.14159 * sat(v)); }
fn pal(h: f32) -> vec3f {
  if (h < .3) { return vec3f(1., .62, .08); }
  if (h < .6) { return vec3f(.12, 1., .22); }
  if (h < .8) { return vec3f(.2, .85, 1.); }
  return vec3f(1., .3, .8);
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
    case 0 { col = mix(vec3f(.02, .11, .15), vec3f(.03, .06, .18), s1); col = mix(col, vec3f(.16, .04, .22), step(.72, s2)); pr = vec4f(.24, .9, .12, .10); spc = pal(hsel * .72); shp = vec2f(.5, .32); wav = 1.9; }
    case 1 { col = vec3f(.05, .07, .10); pr = vec4f(0., .2, 0., 0.); shp = vec2f(.05, .1); wav = .3; fls = .3; }
    case 2 { col = mix(vec3f(.03, .13, .22), vec3f(.07, .17, .30), s1); col = mix(col, vec3f(.26, .10, .30), step(.8, s2)); pr = vec4f(.05, 1.0, .25, .08); spc = vec3f(.6, 1., .9); shp = vec2f(.45, .35); wav = 2.2; }
    case 3 { col = mix(vec3f(.02, .05, .065), vec3f(.05, .03, .08), s1); col = mix(col, vec3f(.09, .03, .09), step(.8, s2)); pr = vec4f(.2, .85, .55, .06); spc = mix(vec3f(.5, .35, 1.), vec3f(.2, 1., .7), step(.6, hsel)); shp = vec2f(.7, .6); wav = 2.4; }
    case 4 { col = mix(vec3f(.30, .15, .02), vec3f(.42, .25, .04), s1); pr = vec4f(.2, 1., .1, .12); spc = vec3f(1., .85, .5); shp = vec2f(.5, .4); wav = 1.8; }
    case 5 { col = mix(vec3f(.85, .05, .40), vec3f(.60, .10, .80), step(.7, s1)); col = mix(col, vec3f(.95, .25, .55), step(.75, s2)); pr = vec4f(.22, .8, 0., .30); spc = vec3f(1., .35, .8); shp = vec2f(.6, .6); fls = 2.; }
    case 6 { col = mix(vec3f(.80, .16, .16), vec3f(.92, .36, .42), s1); pr = vec4f(.06, 1., 0., .16); spc = vec3f(1., .5, .5); shp = vec2f(.4, .3); wav = 2.; }
    default { col = mix(vec3f(.05, .40, .36), vec3f(.10, .52, .58), s1); pr = vec4f(.1, .9, .2, .16); spc = vec3f(.3, 1., .9); shp = vec2f(.6, .5); }
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
  let nearK = select(1. - ss(26., 40., cd), 0., shp_);
  let farK = select((1. - ss(far * .8, far, cd)) * ss(.6, 2.2, distance(c, g.cam.xyz)) * ss(len * 1.1 + .5, len * 2.2 + 1.2, distance(i.a.xyz + d * (len * .5), g.cam.xyz)), 1., shp_);
  let ruf = sin(v * 10. + s2 * 30. + t * .6) * i.b.z * .36 * u * shape2(v) * nearK;
  var p = c + S * (u * farK * select(i.b.z * .5 * shape, select(max(i.b.z * .5, .09) * shape, 0., ty == 1), shp_));
  p += N2 * ruf;
  let sw = sway(i.a.xz, hA + (p.y - i.a.y), t);
  p.x += sw.x; p.z += sw.y;
  o.cp = g.vp * vec4f(p, 1.); o.wp = p; o.n = normalize(N2 + S * u * .55 - T0 * cos(v * 10. + s2 * 30. + t * .6) * u * .7 * nearK); o.uv = vec2f(u, v);
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
  o.col = pal(b.y) * (.12 + tw * 1.7) * lit * e * e * exp(-SIG.g * d) * ss(.4, 1.5, d) * 17.;
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
  var alb = i.col * (.72 + .28 * ss(0., .25, abs(i.uv.x))) * mix(.5, 1.12, i.uv.y) * (1. - .45 * ss(30., 8., dist) * ss(.6, 1., sin(i.uv.y * 40. - abs(i.uv.x) * 7. + i.sd.x * 40.))) * (.58 + .42 * ss(0., .13, abs(i.uv.x))) * (.5 + 1.0 * lt.b) * (.65 + .7 * lt.a);
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
  c += alb * i.pr.w * (1.6 + 3. * dot(am + E * .3, vec3f(.1, .5, .5)));
  // sparkle: whole-leaf glints that twinkle slowly
  let tw = pow(.5 + .5 * sin(g.cam.w * (.5 + i.sd.y * 1.4) + i.sd.x * 90.), 5.);
  let m = ss(.2, .0, abs(i.uv.y - (.35 + .45 * i.sd.y))) * (1. - i.uv.x * i.uv.x);
  let lit = .35 + E.g * 1.2;
  c += i.spc * i.pr.x * (.1 + tw) * m * lit * .6;
  return fin(fog(c, i.wp, z));
}
`;

// ---------------------------------------------------------------- ice ring + wisps
const W_ANIM = S_B + /*wgsl*/`
struct VI { @location(0) p: vec3f, @location(1) n: vec4f, @location(2) a: vec4f, @location(3) b: vec4f };
struct VO { @builtin(position) cp: vec4f, @location(0) wp: vec3f, @location(1) n: vec3f, @location(2) op: vec3f, @location(3) @interpolate(flat) sd: f32, @location(4) lt: f32 };
// a shard of the ring: circles the asteroid in a tilted plane, tumbling; dark where the asteroid's shadow falls
@vertex fn vsFish(i: VI) -> VO {
  var o: VO;
  let s = i.b.x; let R = i.a.w; let t = g.cam.w;
  let ta = t * i.b.y + s * TAU * 7.;
  let pr = vec3f(R * cos(ta), (hs(s * 3.3) - .5) * 2.5, R * sin(ta));
  let P = vec3f(pr.x, .94 * pr.y - .34 * pr.z, .34 * pr.y + .94 * pr.z);
  let an = t * (.3 + hs(s) * 1.2) + s * 40.; let c = cos(an); let sn = sin(an);
  let l = i.p * i.b.z * (1.5 + distance(P, g.cam.xyz) * .02) * vec3f(1., .5 + hs(s + .2), .6 + hs(s + .4));
  let w = P + vec3f(c * l.x - sn * l.y, sn * l.x + c * l.y, l.z);
  o.cp = g.vp * vec4f(w, 1.); o.wp = w; o.n = vec3f(c * i.n.x - sn * i.n.y, sn * i.n.x + c * i.n.y, i.n.z); o.op = i.p; o.sd = s;
  let along = dot(P, g.sun.xyz);
  o.lt = 1. - step(along, 0.) * ss(56., 50., length(P - g.sun.xyz * along));
  return o;
}
@fragment fn fsFish(i: VO, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  var n = normalize(i.n); if (!ff) { n = -n; }
  let V = normalize(g.cam.xyz - i.wp); let L = g.sun.xyz;
  let alb = mix(vec3f(.62, .74, .86), vec3f(.86, .82, .76), hs(i.sd * 9.1));
  let c = alb * (SUNC * sat(dot(n, L)) * i.lt * .8 + amb(i.wp, n, 1., 0.)) + SUNC * i.lt * pow(sat(dot(n, normalize(V + L))), 50.) * 2.5;
  return fin(fog(c, i.wp, 0.));
}
// a wisp: circles on a great circle about its own axis
@vertex fn vsManta(i: VI) -> VO {
  var o: VO;
  let n = i.a.xyz; let t = g.cam.w; let ta = t * i.b.y + i.b.x;
  var A = cross(n, vec3f(0., 1., 0.)); if (dot(A, A) < 1e-4) { A = vec3f(1., 0., 0.); } A = normalize(A); let B = cross(n, A);
  let Up = A * cos(ta) + B * sin(ta); let T = (B * cos(ta) - A * sin(ta)) * sign(i.b.y); let S = cross(Up, T);
  let P = Up * (i.a.w + 1.5 * sin(t * .7 + i.b.w * 20.));
  var l = i.p; var ln = i.n.xyz;
  if (i.n.w > .5) {
    let an = t * 1.6 + i.b.w * 9.; let c = cos(an); let s = sin(an);
    l = vec3f(l.x, c * l.y - s * l.z, s * l.y + c * l.z); ln = vec3f(ln.x, c * ln.y - s * ln.z, s * ln.y + c * ln.z);
  }
  let w = P + (S * l.x + Up * l.y + T * l.z) * i.b.z;
  o.cp = g.vp * vec4f(w, 1.); o.wp = w; o.n = S * ln.x + Up * ln.y + T * ln.z; o.op = i.p; o.sd = i.b.w; o.lt = i.n.w;
  return o;
}
@fragment fn fsManta(i: VO, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  var n = normalize(i.n); if (!ff) { n = -n; }
  let V = normalize(g.cam.xyz - i.wp); let L = g.sun.xyz;
  let col = cpal(fract(i.sd * 3.7));
  let pulse = .5 + .5 * sin(g.cam.w * 2. + i.sd * 30.);
  // a wisp: a ball of light, brightest at its edge
  let f = 1. - abs(dot(n, V));
  var c = col * (.5 + 3.5 * f * f) * (.7 + .6 * pulse) * (.7 + .3 * shadow1(i.wp)) + vec3f(1.2) * pow(1. - f, 6.) + amb(i.wp, n, 1., 0.) * .2 + SUNC * sat(dot(n, L)) * .03;
  return fin(fog(c, i.wp, 0.));
}
`;

// ---------------------------------------------------------------- sky: stars, nebula, ringed giant, the star
const S_NEB = /*wgsl*/`
fn h3(p: vec3f) -> f32 { var q = fract(p * vec3f(.1031, .1030, .0973)); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
fn h3v(p: vec3f) -> vec3f { var q = fract(p * vec3f(.1031, .1030, .0973)); q += dot(q, q.yxz + 33.33); return fract((q.xxy + q.yxx) * q.zyx); }
fn n3(p: vec3f) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3. - 2. * f);
  return mix(mix(mix(h3(i), h3(i + vec3f(1., 0., 0.)), u.x), mix(h3(i + vec3f(0., 1., 0.)), h3(i + vec3f(1., 1., 0.)), u.x), u.y),
             mix(mix(h3(i + vec3f(0., 0., 1.)), h3(i + vec3f(1., 0., 1.)), u.x), mix(h3(i + vec3f(0., 1., 1.)), h3(i + vec3f(1., 1., 1.)), u.x), u.y), u.z);
}
fn fb(p: vec3f, n: i32) -> f32 {
  var a = .5; var s = 0.; var q = p;
  for (var i = 0; i < n; i++) { s += a * n3(q); q = q * 2.03 + vec3f(17.1, 31.7, 5.3); a *= .5; }
  return s / (1. - 2. * a);
}
fn nebula(rd: vec3f) -> vec3f {
  let w = vec3f(fb(rd * 2.1 + 3., 3), fb(rd * 2.1 + 11., 3), fb(rd * 2.1 + 19., 3)) - .5;
  let a = fb(rd * 1.5 + w * 1.6, 5);
  let b = fb(rd * 3.1 - w * 2. + 40., 4);
  let t = fb(rd * 2.6 + w + 70., 4);
  var c = mix(vec3f(.05, .04, .26), vec3f(.62, .08, .30), ss(.45, .78, b)) * pow(ss(.42, .82, a), 1.5) * .95;
  c += vec3f(.02, .22, .32) * pow(ss(.46, .84, t), 1.5) * .8;
  c += vec3f(.9, .5, .25) * pow(ss(.6, .95, a * b * 2.2), 2.) * .35;
  c *= .15 + .85 * ss(.28, .6, fb(rd * 5.3 + w * 3. + 9., 4));
  let gb = dot(rd, vec3f(.36, .8, .48));
  return c + vec3f(.50, .46, .42) * exp(-gb * gb * 30.) * (.15 + .85 * fb(rd * 8., 4)) * ss(.3, .55, fb(rd * 14. + w * 4., 3)) * .7;
}
`;
// the nebula is baked once into the upper half of a lat-long map: too many noise octaves to redo per pixel per frame
const W_SKYB = /*wgsl*/`fn ss(a: f32, b: f32, x: f32) -> f32 { let t = clamp((x - a) / (b - a), 0., 1.); return t * t * (3. - 2. * t); }
` + S_NEB + W_FS + /*wgsl*/`
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let ph = (fc.x / ${SKYW}. - .5) * 6.2831853; let th = fc.y / ${SKYW / 2}. * 3.14159265;
  return vec4f(nebula(vec3f(sin(th) * cos(ph), cos(th), sin(th) * sin(ph))), 1.);
}
`;
const W_SURF = S_B + S_NEB + /*wgsl*/`
@group(0) @binding(9) var tK: texture_2d<f32>;
struct VO { @builtin(position) cp: vec4f, @location(0) wp: vec3f };
fn stars(rd: vec3f, sc: f32) -> vec3f {
  let p = rd * sc; let i = floor(p); let h = h3v(i);
  let d = length(p - i - (.2 + .6 * h));
  let b = pow(h3(i + 7.3), 12.);
  let tw = .7 + .3 * sin(g.cam.w * (1. + 3. * h.x) + h.y * 40.);
  return mix(vec3f(.65, .78, 1.), vec3f(1., .78, .55), h.z * h.z) * (ss(.12, 0., d) * (.35 + 40. * b) * tw);
}
const PAX = vec3f(.3549, .9127, .2028);
fn giant(rd: vec3f, bg: vec3f) -> vec3f {
  let C = PD * 10.; let R = 3.3; let L = vec3f(.737, .527, .423);
  let b = dot(rd, C); let h = b * b - dot(C, C) + R * R;
  var col = bg; var tp = 1e9;
  if (h > 0.) {
    tp = b - sqrt(h);
    let n = (rd * tp - C) / R;
    let lat = dot(n, PAX);
    let wob = fb(n * 2.5 + vec3f(0., lat * 5., 0.), 4);
    let band = .5 + .5 * sin(lat * 19. + wob * 4.5);
    var alb = mix(vec3f(.86, .46, .22), vec3f(.26, .16, .44), band);
    alb = mix(alb, vec3f(.95, .82, .62), ss(.55, .85, fb(n * vec3f(2., 10., 2.) + 5., 3)) * .55);
    let lit = ss(-.12, .55, dot(n, L));
    let rim = pow(1. - sat(dot(n, -rd)), 3.);
    let pc = alb * alb * (lit * 1.15 + .01) + vec3f(.30, .32, .95) * rim * (.06 + lit * .7);
    col = mix(bg * (1. - ss(0., .35, h)), pc, ss(0., .22, h));
  }
  let dn = dot(rd, PAX);
  let tr = dot(C, PAX) / dn;
  if (tr > 0. && (tr < tp)) {
    let q = rd * tr - C; let r = length(q) / R;
    let qs = dot(q, L); let sh = select(1., ss(R * .92, R * 1.06, length(q - L * qs)), qs < 0.);
    let gap = .3 + .7 * ss(.2, .5, fb(vec3f(r * 17., 3., 1.), 3)) * (1. - .85 * ss(.035, .0, abs(r - 1.93)));
    let dens = ss(1.32, 1.4, r) * ss(2.2, 2.08, r) * gap;
    col = mix(col, mix(vec3f(.80, .68, .58), vec3f(.55, .58, .80), ss(1.5, 2.4, r)) * (.02 + .30 * sh), dens * .6);
  }
  return col;
}
// a small lit globe: direction of its centre, angular size
fn ball(rd: vec3f, dir: vec3f, rad: f32, alb: vec3f, L: vec3f, bg: vec3f) -> vec3f {
  let c = dot(rd, dir); let k = rad * rad - 1. + c * c;
  if (c < 0. || k < 0.) { return bg; }
  let n = normalize(rd * (c - sqrt(k)) - dir);
  return mix(bg, alb * (ss(-.1, .6, dot(n, L)) * 1.5 + .008), ss(0., rad * rad * .2, k));
}
fn sky(rd: vec3f) -> vec3f {
  let nb = textureSampleLevel(tK, sR, vec2f(atan2(rd.z, rd.x) / TAU + .5, clamp(acos(clamp(rd.y, -1., 1.)) / 3.14159265, .002, .998)), 0.).rgb;
  let gb = dot(rd, vec3f(.36, .8, .48));
  var c = nb + (stars(rd, 70.) + stars(rd, 150.) * .7 + stars(rd, 310.) * .4) * (1. - .6 * sat(dot(nb, vec3f(.6)))) * (1. + 2.5 * exp(-gb * gb * 30.));
  if (dot(rd, PD) > .7) {
    c = giant(rd, c);
    c = ball(rd, vec3f(-.301, .622, -.723), .019, vec3f(.75, .70, .62), vec3f(.737, .527, .423), c);
    c = ball(rd, vec3f(-.860, .380, -.340), .011, vec3f(.55, .62, .70), vec3f(.737, .527, .423), c);
  }
  c = ball(rd, vec3f(.548, .249, .798), .034, vec3f(.30, .58, .95), g.sun.xyz, c);
  let mu = max(dot(rd, g.sun.xyz), 0.);
  return c + SUNC * (ss(.99965, .9999, mu) * 40. + pow(mu, 900.) * 3. + pow(mu, 40.) * .22 + pow(mu, 6.) * .05);
}
// drawn behind everything. The dust lies below y = 0, so the sky is seen through the path up to that level:
// clear overhead, lost in haze toward the horizon, where the terrain (which stops at ~240 m) fades into the same haze
@vertex fn vsB(@builtin(vertex_index) i: u32) -> VO {
  var o: VO;
  let p = vec2f(f32(i & 1u), f32(i >> 1u)) * 2. - 1.;
  o.wp = g.cam.xyz + g.fwd.xyz + g.right.xyz * (p.x * g.right.w) + g.up.xyz * (p.y * g.up.w);
  o.cp = vec4f(p, 1e-7, 1.);
  return o;
}
@fragment fn fsB(i: VO) -> @location(0) vec4f {
  return fin(sky(normalize(i.wp - g.cam.xyz)));
}
`;

// ---------------------------------------------------------------- sprites: bubbles (alpha) and drifting particles (additive)
const W_SPR = S_B + /*wgsl*/`
struct VO { @builtin(position) cp: vec4f, @location(0) uv: vec2f, @location(1) @interpolate(flat) pr: vec4f, @location(2) wp: vec3f };
fn quad(i: u32) -> vec2f { return vec2f(f32(i & 1u), f32(i >> 1u)) * 2. - 1.; }
@vertex fn vsBub(@builtin(vertex_index) vi: u32, @location(0) a: vec4f, @location(1) b: vec4f) -> VO {
  var o: VO; let q = quad(vi); let t = g.cam.w;
  let life = fract(t * .35 * b.y / b.z + b.x);
  let h = life * b.z;
  var p = a.xyz + normalize(a.xyz) * h;
  let wob = b.w * (.3 + h * .035);
  p.x += sin(t * 1.7 + b.x * 50. + h * .6) * wob + sin(h * .13 + b.x * 9.) * b.w * 2.;
  p.z += cos(t * 1.3 + b.x * 33. + h * .5) * wob + cos(h * .11 + b.x * 7.) * b.w * 2.;
  let sz = a.w * 1.25 * step(hs(b.x * 3.1), .45) * ss(0., .03, life) * ss(1., .9, life);
  let w = p + (g.right.xyz * q.x + g.up.xyz * q.y) * sz;
  o.cp = g.vp * vec4f(w, 1.); o.uv = q; o.wp = p;
  o.pr = vec4f(b.x, sz, shadow1(p), 0.);
  return o;
}
@fragment fn fsBub(i: VO) -> @location(0) vec4f {
  let r = dot(i.uv, i.uv);
  let hue = fract(i.pr.x * 7.3);
  var col = mix(vec3f(.15, .85, 1.), vec3f(1., .55, .12), step(.55, hue));
  if (hue > .88) { col = vec3f(1., .25, .7); }
  let pulse = .55 + .45 * sin(g.cam.w * (1. + hue * 2.) + i.pr.x * 50.);
  let d = length(i.wp - g.cam.xyz);
  let c = col * (exp(-r * 12.) * 2.2 + exp(-r * 3.) * .2) * (1. - ss(.6, 1., r)) * pulse * exp(-SIG.g * d) * ss(.8, 2.5, d);
  return vec4f(min(c, vec3f(20.)), 0.);
}
// the tail: dust and gas blown off the asteroid, streaming away from the star and spreading as it goes
@vertex fn vsTail(@builtin(vertex_index) vi: u32, @location(0) a: vec4f) -> VO {
  var o: VO; let q = quad(vi);
  let life = fract(a.w + g.cam.w * (.015 + .025 * a.x));
  let L = -g.sun.xyz; let A = normalize(cross(L, vec3f(0., 1., 0.))); let B = cross(L, A);
  let ang = a.y * TAU + life * 1.5;
  let p = L * (48. + life * 110. + life * life * 520.) + (A * cos(ang) + B * sin(ang)) * (6. + 30. * sqrt(a.z)) * (.5 + 2.2 * life);
  let d = length(p - g.cam.xyz);
  let sz = (.5 + 1.6 * a.x) * (1. + 4. * life);
  let w = p + L * (q.x * sz * 5.) + normalize(cross(L, p - g.cam.xyz)) * (q.y * sz);
  o.cp = g.vp * vec4f(w, 1.); o.uv = q; o.wp = p;
  o.pr = vec4f(ss(0., .06, life) * (1. - life) * ss(12., 50., d), a.y, a.x, d);
  return o;
}
@fragment fn fsTail(i: VO) -> @location(0) vec4f {
  let r = dot(i.uv, i.uv);
  let c = mix(vec3f(.20, .55, 1.), vec3f(.75, .80, 1.), step(.62, i.pr.y)) * exp(-r * 4.) * (1. - ss(.5, 1., r)) * i.pr.x * .045;
  return vec4f(c, 0.);
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
  let fade = ss(B * .5, B * .32, d) * ss(.6, 2.5, d) * min(1., sz / (d * .0011));
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
const W_RAYS = S_G + W_FS + /*wgsl*/`
@group(0) @binding(0) var<uniform> g: G;
@group(0) @binding(1) var sR: sampler;
@group(0) @binding(2) var sS: sampler_comparison;
@group(0) @binding(3) var tSh: texture_depth_2d;
@group(0) @binding(4) var tW: texture_2d<f32>;
@group(0) @binding(5) var tDp: texture_depth${AA > 1 ? '_multisampled' : ''}_2d;
@group(0) @binding(6) var tV: texture_3d<f32>;
@group(0) @binding(7) var sC: sampler;
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let dp = textureLoad(tDp, vec2i(fc.xy) * 2, 0);
  let uv = fc.xy * 2. * g.res.zw;
  let nd = vec2f(uv.x * 2. - 1., 1. - uv.y * 2.);
  let rv = g.fwd.xyz + g.right.xyz * (nd.x * g.right.w) + g.up.xyz * (nd.y * g.up.w);
  let rl = length(rv); let rd = rv / rl;
  let zl = g.fwd.w / max(dp, 1e-6);
  let ro = g.cam.xyz; let sx = g.sun.xyz;
  let b = dot(ro, rd); let h = b * b - dot(ro, ro) + 86. * 86.;
  var acc = vec3f(textureSampleLevel(tW, sR, vec2f(0.), 4.).r * 0. + textureSampleLevel(tV, sC, vec3f(.5), 0.).r * 0.);
  if (h > 0.) {
    let sq = sqrt(h); let t0 = max(-b - sq, 0.); let t1 = min(-b + sq, zl * rl);
    if (t1 > t0) {
      let dt = (t1 - t0) / ${RAYN}.; let j = ign(fc.xy);
      let mu = max(dot(rd, sx), 0.);
      for (var n = 0; n < ${RAYN}; n++) {
        let p = ro + rd * (t0 + (f32(n) + j) * dt); let r = length(p);
        let s = g.sm * vec4f(p, 1.);
        let vis = textureSampleCompareLevel(tSh, sS, vec2f(s.x * .5 + .5, .5 - s.y * .5), s.z - .0006);
        acc += min(exp((54. - r) / 7.), 1.) * ss(20., 46., r) * (vis * (.35 + 1.8 * mu * mu * mu) * vec3f(.35, .58, .95) + vec3f(.03, .08, .16));
      }
      acc *= dt * SUNC * mix(.0008, .012, ss(4., 70., length(ro) - 54.));
    }
  }
  // the gas tail: a widening glow along the line away from the star, at the point where this ray passes closest to it
  let bb = -dot(rd, sx); let dd = dot(rd, ro); let ee = -dot(sx, ro); let den = max(1. - bb * bb, .03);
  let tt = max((bb * ee - dd) / den, 0.); let ts = ee + bb * tt;
  if (ts > 20. && tt < zl * rl) {
    let wd = 9. + .11 * ts; let dm = length(ro + rd * tt + sx * ts);
    acc += vec3f(.22, .45, 1.) * exp(-dm * dm / (wd * wd)) * ss(20., 90., ts) * exp(-ts / 320.) * min(wd / sqrt(den), 90.) * .0012 * ss(0., 30., tt);
  }
  return vec4f(min(acc * g.mis.y, vec3f(20.)), zl);
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
  c = mix(c, bl, .09) + bl * .05;
  c *= g.mis.x;
  let q = uv - g.xr.xy;
  c *= 1. - dot(q, q) * .55;
  c *= 1. - g.xr.z * ss(.1, .36, length(q)); // comfort vignette while moving in VR
  c = tmap(c);
  let l0 = dot(c, vec3f(.2126, .7152, .0722));
  let l = mix(l0, l0 * l0 * (3. - 2. * l0), .68);
  c *= l / max(l0, 1e-4);
  c = mix(c, vec3f(l), ss(.55, 1., l) * .1);
  c = mix(vec3f(l), c, .93) + vec3f(.008, .002, 0.);
  if (SRGB < .5) { c = pow(max(c, vec3f(0.)), vec3f(1. / 2.2)); }
  let n = ign(fc) + ign(fc + 37.) - 1.;
  return vec4f(c + n / 255., 1.);
}
`;
