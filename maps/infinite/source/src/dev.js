// ============================================================================
// development tools: only in dev.html (npm run build:dev), never in index.html
// ============================================================================
//   F    fly the camera along the scripted path (FLY in main.js), one minute through the whole world
//   B    the same flight as a benchmark: the resolution stays fixed, every frame is timed, the result is shown at the end
//   F, B or 1-6 during a flight stop it
{
  const LOGN = 1 << 16, logFrame = new Float32Array(LOGN), logGpu = new Float32Array(LOGN);
  let flying = false, bench = false, last = 0, nFrame = 0, nGpu = 0;
  const stop = () => { flying = bench = false; dynT = 0; };
  const report = () => {
    const st = (a, n) => { const s = Array.from(a.subarray(0, n)).sort((x, y) => x - y); let sum = 0; for (const v of s) sum += v; return { n, avg: sum / n, p99: s[min(n - 1, floor(n * 0.99))], max: s[n - 1] }; };
    const fm = (o) => `avg ${o.avg.toFixed(2)}  p99 ${o.p99.toFixed(2)}  max ${o.max.toFixed(2)} ms`;
    const f = st(logFrame, nFrame);
    info.textContent = `Fly-through ${W}x${H}, ${f.n} frames\nframe  ${fm(f)}\nGPU    ${nGpu ? fm(st(logGpu, nGpu)) : 'timestamp-query unavailable'}`;
  };
  // frame() moves the free camera and then calls render(): step in between and put the camera on the path instead
  const draw = render;
  render = () => {
    if (flying) {
      const dtr = F[LAST] - last; last = F[LAST];
      F[FLT] += min(dtr / 1000, 0.1); flyAt();
      if (bench) { if (nFrame < LOGN) logFrame[nFrame++] = dtr; if (F[GPU] > 0 && nGpu < LOGN) logGpu[nGpu++] = F[GPU]; }
      if (F[FLT] >= FLYT) { if (bench) report(); stop(); }
    }
    draw();
  };
  addEventListener('keydown', (e) => {
    if (menu || e.repeat) return;
    if (e.code === 'KeyF' || e.code === 'KeyB') {
      if (flying) stop();
      else {
        flying = true; bench = e.code === 'KeyB'; F[FLT] = 0; last = F[LAST]; nFrame = nGpu = 0;
        // a benchmark hides the stats line and holds the resolution: dynT at -Infinity keeps frame() from tuning it
        if (bench) { hud = false; info.textContent = ''; dynT = -Infinity; }
      }
    } else if (/Digit[0-9]/.test(e.code)) stop();
  });
}
// hooks for automated tests (see #offscreen in gpu.js): the state of the streaming, moving the camera, reading a frame back
window.abyssal = {
  state: () => ({ x: F[CX], y: F[CY], z: F[CZ], loaded: nLoaded, wanted: nWanted, inflight, coreVerts, winX, winZ, w: W, h: H, fmt: FMT }),
  look: (x, y, z, tx, ty, tz) => { lookAt(x, y, z, tx, ty, tz); F[VX] = F[VY] = F[VZ] = 0; },
  pose: (i) => lookAt(...(i < 6 ? POSES[i] : DEEPS[i - 6])),
  rays: (v) => { RAYS = v; },
  // the creatures: how many of each species; and a row of the given species held still in front of the camera, `d` metres away
  bots: () => { const n = new Array(CRIT.length).fill(0); for (const b of bots) n[b.s]++; return n; },
  park: (list, d, gap) => { botHold = true; bots.length = 0; list.forEach((s, i) => { const o = (i - (list.length - 1) / 2) * gap; botAdd(s, [F[CX] + F[FX] * d + F[RX] * o, F[CY] + F[FY] * d, F[CZ] + F[FZ] * d + F[RZ] * o], atan2(F[RZ], F[RX]) + 0.5); }); },
  free: () => { botHold = false; bots.length = 0; },
  pop: (first = true) => { botPopulate(first); return bots.length; },
  crabsNear: () => bots.filter((b) => !b.me && b.s === 0 && !b.gone).map((b) => +hypot(b.x - F[CX], b.z - F[CZ]).toFixed(0)).sort((a, b) => a - b),
  sonar: () => { body.className = 'g'; sonarT = 1; sonarDraw($('sn'), 1); },
  // play species s (-1: the free camera) and swim n frames with the given keys and turn of the view per frame
  play: (s) => { meChoose(s); meSync(); hudWho(); return me ? [me.x, me.y, me.z] : null; },
  // the collision fields at the nose of the player's creature: [rock (above 0: inside), metres to the ship's timbers]
  nose: () => { const L = CRIT[me.s].len * 0.45, cp = cos(me.pit), x = me.x + cos(me.yaw) * cp * L, y = me.y + sin(me.pit) * L, z = me.z + sin(me.yaw) * cp * L; return [rockD(x, y, z), shipD(x, y, z), shipR(me.s)]; },
  drive: (n, mf, mr = 0, dyw = 0, fast = false) => { for (let i = 0; i < n; i++) meStep(1 / 30, dyw, 0, mf, mr, 0, fast); return [me.x, me.y, me.z, me.v, F[CX], F[CY], F[CZ]].map((v) => +v.toFixed(2)); },
  picker: (s) => { body.className = 'm'; if (!pickOpen) $('cb').click(); pickShow(s); },
  // the view's pitch and the camera's zoom while playing; the menu as it is laid out (for tests of its fit)
  pitch: (p) => { F[PIT] = p; },
  zoom: (z) => { meZoom = z; },
  mePit: () => (me ? me.pit : 0),
  // survival: the left button once; health, lost claws, the last message; set the health
  act: () => { meActT = 0; meAct(); return [+meHP.toFixed(3), meLost, meMsg]; },
  crabs: (lost) => { meLost = lost; const o = botAdd(0, [me.x + 0.55 * Math.cos(me.yaw) + 0.3, me.y, me.z + 0.55 * Math.sin(me.yaw)], 1); o.dead = 30; o.age = 9; const q = botAdd(0, [me.x + 0.55 * Math.cos(me.yaw) - 0.5, me.y, me.z + 0.55 * Math.sin(me.yaw) + 0.4], 2); q.lost = 2; q.age = 9; q.next = 99; q.v = 0; },
  // a fight of crabs: a rival beside the player's crab; claws up or down; n frames of both; how the fight stands
  rival: (d = 0.4, a = 0) => { for (const b of bots) if (!b.me && b.s === 0) b.gone = true; const q = botAdd(0, [me.x + d * cos(me.yaw + a), me.y, me.z + d * sin(me.yaw + a)], 2); q.age = 9; q.next = 99; q.v = 0; return bots.length; },
  // the floor a crab stands on at x, z (null: none)
  floor: (x, z) => floorBelow(x, min(seaBase(x) + 22, -2), z, seaBase(x) - 60),
  block: (on) => { me.gur = !!on; },
  rivalHp: (hp) => { for (const b of bots) if (!b.me && b.s === 0) b.hp = hp; },
  sim: (n) => { botHold = false; for (let i = 0; i < n; i++) { meStep(1 / 30, 0, 0, 0, 0, 0, false); botStep(1 / 30); } },
  fight: () => ({ hp: +meHP.toFixed(3), lost: meLost, down: +meDown.toFixed(2), back: me ? me.dead || 0 : -1, msg: meMsg, at: me ? [+me.x.toFixed(2), +me.z.toFixed(2)] : null, rivals: bots.filter((b) => !b.me && b.s === 0 && !b.gone).map((b) => ({ hp: +(b.hp === undefined ? 1 : b.hp).toFixed(3), lost: b.lost || 0, dead: b.dead ? 1 : 0, d: +hypot(b.x - me.x, b.z - me.z).toFixed(2) })) }),
  life: (hp) => { if (hp !== undefined) meHP = hp; return [+meHP.toFixed(3), meLost, meMsg, me ? me.s : -1]; },
  shade: (k) => { shadeK = k; },
  net: (go) => { if (go) netConnect(); return { on: netOn, id: netId, names: [...netNames], peers: [...netPeers.values()].map((b) => [b.id, b.name, b.s, +b.x.toFixed(1), +b.y.toFixed(1), +b.z.toFixed(1), b.gur]) }; },
  meAt: () => (me ? [me.x, me.y, me.z, me.yaw] : null),
  netTick: (n = 1) => { meAway = false; for (let i = 0; i < n; i++) { netFrame(0.125); botStep(1 / 30); } },
  ship: (x, y, z) => +shipD(x, y, z).toFixed(2),
  // the ship's field against its own mesh: the distance at every 50th vertex put into the world (should be near 0),
  // and how much of the box is within 0.3 m of a timber
  shipCheck: () => { const P = shipMesh.p, q = SHIPQ, out = []; let near = 0; for (const v of shipG) if (v < 12) near++;
    for (let i = 0; i < P.length; i += 150) { const x = P[i], y = P[i + 1], z = P[i + 2], tx = 2 * (q[1] * z - q[2] * y), ty = 2 * (q[2] * x - q[0] * z), tz = 2 * (q[0] * y - q[1] * x);
      out.push(shipD(SHIPAT[0] + x + q[3] * tx + q[1] * tz - q[2] * ty, SHIPAT[1] + y + q[3] * ty + q[2] * tx - q[0] * tz, SHIPAT[2] + z + q[3] * tz + q[0] * ty - q[1] * tx)); }
    return { n: out.length, max: Math.max(...out), mean: out.reduce((a, b) => a + b, 0) / out.length, share: near / shipG.length }; },
  audio: () => (AC ? [AC.state, +AC.currentTime.toFixed(2)] : null),
  // gurgling on or off, and n frames of the creatures' lives without drawing them
  // one of the player's own kind d metres off, the player gurgling for n frames: did it answer?
  reply: (d, n = 90) => { botHold = false; botAdd(me.s, [me.x + d, me.y, me.z], 0); const b = bots[bots.length - 1]; b.mode = 0; b.rc = 0; me.gur = true; let r = false; for (let i = 0; i < n; i++) { botReplies(1 / 30); r = r || b.rw > 0 || b.rt > 0; } me.gur = false; bots.splice(bots.indexOf(b), 1); return r; },
  gur: (on, n = 0) => { menu = false; kg = on ? 1 : 0; if (me) me.gur = !!on; for (let i = 0; i < n; i++) { F[TIME] += 1 / 30; botStep(1 / 30); } return me ? [me.talk, gurN] : null; },
  menu: () => { ui(true); const m = $('m'), h = m.firstElementChild, a = $('a'), f = $('f'); return { H: m.clientHeight, W: m.clientWidth, font: m.style.fontSize, titleTop: h.offsetTop, titleW: h.offsetWidth, bottom: a.offsetTop + a.offsetHeight, links: f.style.display === 'none' ? null : f.offsetTop, highs: CRIT.map((c) => +c.high.toFixed(3)) }; },
  hide: (v) => { HIDE = v; },
  lod: (v) => { if (v) lk = lkT = v; return [+lk.toFixed(2), +lkT.toFixed(2), +F[GPU].toFixed(2)]; }, // the detail distances, times v (and what they are now, with the GPU time)
  // offscreen: one frame of `ms` milliseconds, finished on the GPU; and the streaming run to the end without drawing
  step: async (ms) => { frame(F[LAST] + ms); await Q.onSubmittedWorkDone(); },
  // stands the camera `up` metres above the sea floor at x, z, looking along (dx, dz)
  stand: async (x, z, up, dx, dz) => { const y = Math.min(await groundAt(x, z) + up, -1.6); lookAt(x, y, z, x + dx * 30, y - 2, z + dz * 30); F[VX] = F[VY] = F[VZ] = 0; return y; },
  // the nearest far-from-home formation of a kind ('arches', 'holes', 'mesas') around x, z: its first shape
  find: (kind, x, z) => { let best = null, bd = 1e18; for (let cz = -8; cz <= 8; cz++) for (let cx = -8; cx <= 8; cx++) { const f = cellShapes(floor(x / FC) + cx, floor(z / FC) + cz)[kind]; if (f.length) { const p = f[0], px = p[0], pz = kind === 'mesas' ? p[1] : p[2], d = hypot(px - x, pz - z); if (d < bd) { bd = d; best = [px, pz, f.length]; } } } return best; },
  // what a frame does for the streaming, without drawing
  tick: async (x, z) => { F[CX] = x; F[CZ] = z; moveWindow(x, z); pump(false); await new Promise((r) => setTimeout(r, 16)); return nWanted; },
  settle: async () => { moveWindow(F[CX], F[CZ]); while (nWanted || shadowQ.length || shadowAll < 2) { pump(true); await new Promise((r) => setTimeout(r, 8)); } },
  grab: async () => {
    const bpr = (W * 4 + 255) & ~255, b = device.createBuffer({ size: bpr * H, usage: BU.MAP_READ | BU.COPY_DST }), e = device.createCommandEncoder();
    e.copyTextureToBuffer({ texture: tOff }, { buffer: b, bytesPerRow: bpr }, [W, H]); Q.submit([e.finish()]);
    await b.mapAsync(GPUMapMode.READ);
    const src = new Uint8Array(b.getMappedRange()); let s = '';
    for (let y = 0; y < H; y++) s += String.fromCharCode.apply(null, src.subarray(y * bpr, y * bpr + W * 4));
    b.unmap(); b.destroy();
    return btoa(s);
  },
};
