// ============================================================================
// the menu's creature panel: who to play
// ============================================================================
// A row of the ten species (and the free camera of old), a model of the chosen one to turn around, and what a player
// should know before diving as it: how big and how fast it is, where it lives, what it eats and what eats it.
// The model is drawn with the game's own creature shader (the part of W_CRIT marked CRIT_SHARED), on a small canvas
// of its own.
const CRITINFO = [
  { kind: 'walks the sea floor', food: ['molluscs', 'worms'], note: 'The only one that does not swim: it keeps to the floor and the rocks, between the gorge and the shore. It walks sideways: whichever way you steer, it turns a side to it. Shift twice and it darts to the side the view is turned to. Right mouse button: claws up - the perch and the barracuda back off. Off an edge it sinks to the floor below, and until it lands it can only look around.' },
  { kind: 'fish I, in schools', food: ['plankton'], note: 'A slender silver fish, the smallest of all. Nearly everything is a danger to it.' },
  { kind: 'fish II, on the reef', food: ['plankton', 'algae'], note: 'A blue-green chromis: a deep oval body, a forked tail. Keeps close to the bottom and its hiding places.' },
  { kind: 'fish III, on the bottom', food: [], note: 'A sea perch: a big head, a spiny fin down its back. Hunts the two small fish among the rocks.' },
  { kind: 'fish IV, in ambush', food: [], note: 'A long silver tube with a pointed head: hangs still in mid-water and darts.' },
  { kind: 'fish V, alone', food: [], note: 'Heavy and spotted, with a huge head and mouth. Lives in grottoes down to the deep.' },
  { kind: 'fish VI, of the open sea', food: [], note: 'A yellowfin tuna: a dark blue spindle with yellow sickles, fast and never still.' },
  { kind: 'mammal', food: [], note: 'The fastest. Its tail beats up and down. Swim up through the surface at speed and it leaps.' },
  { kind: 'hunter', food: [], note: 'The top of the chain: it can eat everything but the whale.' },
  { kind: 'gentle giant', food: ['plankton', 'krill'], note: 'A humpback. It eats none of the others, and nothing eats it. Slow to turn. Up through the surface at speed and it breaches.' },
];
let pickOpen = false, pickSel = -1, pickYaw = 0.5, pickPit = 0.14, pickGrab = false, pickTouched = false, pickGpu = null;
const pickLen = (l) => (l < 1 ? round(l * 100) + ' cm' : round(l * 10) / 10 + ' m');
// a species' side view (the crab's: from in front) as a path of its mesh's triangles, one unit long
const pickPaths = [];
function pickPath(s) {
  if (pickPaths[s]) return pickPaths[s];
  const m = meshes[CRIT0 + s], f = new Float32Array(m.vb), p = new Path2D(), front = s === CRAB;
  for (let t = 0; t < m.ib.length; t += 3) {
    const q = []; for (let k = 0; k < 3; k++) { const v = m.ib[t + k] * 4; q.push(front ? f[v + 2] : -f[v], -f[v + 1]); }
    // every triangle turned the same way round, or those facing away would cut holes in the ones facing the eye
    if ((q[2] - q[0]) * (q[5] - q[1]) - (q[4] - q[0]) * (q[3] - q[1]) < 0) { const a = q[2], b = q[3]; q[2] = q[4]; q[3] = q[5]; q[4] = a; q[5] = b; }
    p.moveTo(q[0], q[1]); p.lineTo(q[2], q[3]); p.lineTo(q[4], q[5]); p.closePath();
  }
  return (pickPaths[s] = p);
}
function pickThumb(cv, s, on) {
  const d = min(devicePixelRatio || 1, 2), w = 64, h = 30; cv.width = w * d; cv.height = h * d;
  const x = cv.getContext('2d'); x.setTransform(d, 0, 0, d, 0, 0); x.fillStyle = on ? '#03131c' : '#e8fbff';
  if (s < 0) { x.beginPath(); x.arc(w / 2, h / 2, 9, 0, TAU); x.arc(w / 2, h / 2, 4.5, 0, TAU, true); x.fill(); x.fillRect(w / 2 - 14, h / 2 - 1, 28, 2); return; } // (a lens: the free camera)
  x.translate(w / 2, s === CRAB ? 13 : 15); x.scale(s === CRAB ? 38 : 56, s === CRAB ? 38 : 56); x.fill(pickPath(s));
}
const pickChips = (list, cls) => list.map((t) => '<i class=' + cls + '>' + t + '</i>').join('');
// what the panel says of species s (-1: the free camera)
function pickInfo(s) {
  if (s < 0) return '<h3>Free camera</h3><p class=k>no body, as before</p><p class=n>Swim anywhere as an eye in the water, through the kelp and under the rocks. Nothing hunts you and you hunt nothing. The sonar shows who is around: pale for the harmless, through amber, to red for the great hunters.</p>';
  const c = CRIT[s], t = CRITINFO[s], all = CRIT.map((q, i) => i), prey = all.filter((o) => eats(s, o)), foes = all.filter((o) => eats(o, s));
  return '<h3>' + CRITNAME[s] + '</h3><p class=k>' + t.kind + '</p>'
    + '<p class=t><span><b>' + pickLen(c.real) + '</b>' + (s === CRAB ? 'across the shell' : 'long') + '</span>'
    + '<span><b>' + c.spd.toFixed(1) + ' / ' + (c.spd * 1.8).toFixed(1) + '</b>m/s, and in a dash</span><span><b>' + c.top + '–' + c.bot + ' m</b>the depths it keeps to</span></p>'
    + '<p class=l>It eats</p><p class=c>' + (pickChips(prey.map((o) => CRITNAME[o]), 'e') + pickChips(t.food, 'f') || '<i>no one</i>') + '</p>'
    + '<p class=l>It is eaten by</p><p class=c>' + (pickChips(foes.map((o) => CRITNAME[o]), 'd') || '<i>no one</i>') + '</p>'
    + '<p class=n>' + t.note + '</p>';
}
// shows species s in the panel; it becomes the choice
function pickShow(s) {
  pickSel = s; meChoose(s);
  [...$('cs').children].forEach((b, i) => { const on = i - 1 === s; b.className = on ? 'on' : ''; pickThumb(b.firstChild, i - 1, on); });
  pickName();
  if (!pickTouched) pickYaw = 0.5;
  $('ci').innerHTML = pickInfo(s);
}
// the creature button: the chosen one's picture and name, under what the button does
function pickName() { $('cn').textContent = pickSel < 0 ? 'Free camera' : CRITNAME[pickSel]; pickThumb($('ct'), pickSel, false); }
// the panel opened and closed (main.js: it is one of the menu's panes)
function pickClose() { if (!pickOpen) return; pickOpen = false; pickName(); }
function pickOpenUp() { pickOpen = true; $('cb').classList.remove('n'); pickShow(pickSel); }
// builds the row of species and wires the panel (once the meshes are there)
function pickInit() {
  const row = $('cs');
  for (let s = -1; s < CRIT.length; s++) {
    const b = document.createElement('button'), cv = document.createElement('canvas'), n = document.createElement('span');
    n.textContent = s < 0 ? 'Free' : CRITNAME[s]; b.append(cv, n); b.onclick = () => pickShow(s); row.appendChild(b);
  }
  pickSel = mePick; pickName();
  // nothing chosen on any visit yet: the button draws the eye until the panel has been opened once
  try { if (localStorage.abyssalInfMe == null) $('cb').classList.add('n'); } catch {}
  const cv = $('cv');
  cv.addEventListener('pointerdown', (e) => { pickGrab = pickTouched = true; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointerup', () => { pickGrab = false; });
  cv.addEventListener('pointermove', (e) => { if (pickGrab) { pickYaw -= e.movementX * 0.008; pickPit = clamp(pickPit + e.movementY * 0.006, -1.3, 1.3); } });
  if (!OFF) pickMake().catch(() => {}); // (no model then, the panel works without it)
}
// The model's pipeline is built asynchronously, in the background from the start (pickInit): built synchronously on
// the first choice of a species, it held the whole page for a moment (and longer where the driver compiles slowly).
// Until it is there the canvas stays empty; the rest of the panel works meanwhile.
async function pickMake() {
  const cv = $('cv'), fmt = navigator.gpu.getPreferredCanvasFormat(), ctx = cv.getContext('webgpu'); ctx.configure({ device, format: fmt, alphaMode: 'premultiplied' });
  const module = device.createShaderModule({ code: `
struct G { vp: mat4x4f, eye: vec4f };
@group(0) @binding(0) var<uniform> g: G;
fn sat(x: f32) -> f32 { return clamp(x, 0., 1.); }
fn ss(a: f32, b: f32, x: f32) -> f32 { let t = clamp((x - a) / (b - a), 0., 1.); return t * t * (3. - 2. * t); }
` + W_CRIT.slice(W_CRIT.indexOf('/*CRIT_SHARED*/'), W_CRIT.indexOf('/*CRIT_SHARED_END*/')) + `
@fragment fn fs(i: CO) -> @location(0) vec4f {
  let V = normalize(g.eye.xyz - i.wp); var n = normalize(i.n); let face = dot(n, V); if (face < 0.) { n = -n; }
  let on = normalize(i.on); let alb = critAlb(i.sp, i.code, i.op, on.y, on.y * face > 0., i.gape);
  let L = normalize(vec3f(.25, 1., .3)); let d = max(dot(n, L), 0.);
  var c = alb * (vec3f(.16, .34, .42) * (.75 + .35 * n.y) + vec3f(1., .96, .84) * d);
  c += vec3f(.25, .6, .7) * pow(1. - max(dot(n, V), 0.), 3.) * .25 + vec3f(1.) * pow(max(dot(n, normalize(L + V)), 0.), 40.) * .2;
  return vec4f(pow(c, vec3f(.4545)), 1.);
}` });
  const pipe = await device.createRenderPipelineAsync({ layout: 'auto',
    vertex: { module, entryPoint: 'vs', buffers: [{ arrayStride: 16, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'snorm8x4' }] },
      { arrayStride: 32, stepMode: 'instance', attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x4' }, { shaderLocation: 3, offset: 16, format: 'float32x4' }] }] },
    fragment: { module, entryPoint: 'fs', targets: [{ format: fmt }] }, primitive: { cullMode: 'none' }, depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' }, multisample: { count: 4 } });
  const ub = device.createBuffer({ size: 80, usage: BU.UNIFORM | BU.COPY_DST }), ib = device.createBuffer({ size: 32, usage: BU.VERTEX | BU.COPY_DST });
  pickGpu = { fmt, ctx, pipe, ub, ib, bind: device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ub } }] }), w: 0, h: 0, msaa: null, depth: null };
}
// draws the chosen species' model (called every frame while the panel is open)
function pickDraw(now) {
  if (!pickOpen || OFF || !pickGpu) return;
  const cv = $('cv'), w = cv.clientWidth, h = cv.clientHeight, d = min(devicePixelRatio || 1, 2), W = max(1, round(w * d)), H = max(1, round(h * d));
  if (!w) return;
  const P = pickGpu;
  if (P.w !== W || P.h !== H) {
    P.w = W; P.h = H; cv.width = W; cv.height = H;
    if (P.msaa) { P.msaa.destroy(); P.depth.destroy(); }
    P.msaa = device.createTexture({ size: [W, H], format: P.fmt, sampleCount: 4, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    P.depth = device.createTexture({ size: [W, H], format: 'depth24plus', sampleCount: 4, usage: GPUTextureUsage.RENDER_ATTACHMENT });
  }
  if (pickSel < 0) {
    const e = device.createCommandEncoder();
    e.beginRenderPass({ colorAttachments: [{ view: P.msaa.createView(), resolveTarget: P.ctx.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'discard' }],
      depthStencilAttachment: { view: P.depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard' } }).end();
    Q.submit([e.finish()]); return;
  }
  if (!pickGrab && !pickTouched) pickYaw += 0.004;
  // the camera circles the animal, which is one unit long whatever the species
  const s = pickSel, c = CRIT[s], t = now / 1000, D = s === CRAB ? 2.7 : 1.95, ex = sin(pickYaw) * cos(pickPit) * D, ey = sin(pickPit) * D, ez = cos(pickYaw) * cos(pickPit) * D;
  const f = 1 / Math.tan(0.3), asp = w / h, zn = 0.1, zf = 20, fa = min(f, f * asp * 0.62);
  const fl = hypot(ex, ey, ez), fx = -ex / fl, fy = -ey / fl, fz = -ez / fl; let rx = -fz, rz = fx; const rl = hypot(rx, rz) || 1; rx /= rl; rz /= rl;
  const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy, A = zf / (zf - zn), B = -zn * zf / (zf - zn), de = fx * ex + fy * ey + fz * ez;
  const U = new Float32Array(20);
  U.set([rx * fa / asp, ux * fa, fx * A, fx, 0, uy * fa, fy * A, fy, rz * fa / asp, uz * fa, fz * A, fz, -(rx * ex + rz * ez) * fa / asp, -(ux * ex + uy * ey + uz * ez) * fa, -de * A + B, -de]);
  U.set([ex, ey, ez, 0], 16);
  Q.writeBuffer(P.ub, 0, U);
  Q.writeBuffer(P.ib, 0, new Float32Array([0, 0, 0, 0, 0, (t * c.freq) % (TAU * 64), 1, s + 0.5 + 0.45 * sin(t * 0.5) * 0.5]));
  const e = device.createCommandEncoder(), m = meshes[CRIT0 + s];
  const r = e.beginRenderPass({ colorAttachments: [{ view: P.msaa.createView(), resolveTarget: P.ctx.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'discard' }],
    depthStencilAttachment: { view: P.depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard' } });
  r.setPipeline(P.pipe); r.setBindGroup(0, P.bind); r.setVertexBuffer(0, vbMesh); r.setVertexBuffer(1, P.ib); r.setIndexBuffer(ibMesh, 'uint32'); r.drawIndexed(m.ib.length, 1, m.i0, m.v0, 0); r.end();
  Q.submit([e.finish()]);
}
