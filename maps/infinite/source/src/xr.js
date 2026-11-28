// ============================================================================
// VR for Abyssal Infinite: "Enter VR" in headset browsers with WebXR and WebGPU
// ============================================================================
// Rendering is Abyssal Garden VR's: the WebXR/WebGPU binding where the browser has it (Quest Browser), else a WebGL
// session with one copy per eye. The world, the shaders and the passes are the desktop ones; each eye gets its own
// off-centre camera (setCam) and its own pass of draw() into the headset's layer.
// Playing is the game's own: the headset's sticks and buttons stand in for the keys and step() (main.js) swims the
// creature, runs the bots and streams the world exactly as on the desktop. The camera rides behind the creature, as
// the desktop's does, but along the play space's heading (turned with the other stick), not the head's: looking
// around never swings the camera. The head moves freely about that point. With no creature chosen (Free camera)
// you swim yourself, where you look.
// This copy is solo: there is no server, the sea is shared only with the bots.
//
// Controllers (the stick and buttons follow the VR controls chosen on Abyssal Garden VR's start page):
//   move stick swim where you look  ·  other stick left/right turn, up/down rise/sink
//   trigger bite, strike, feed  ·  grip faster  ·  A / X burst of speed  ·  B / Y gurgle (block, for the crab)
// Hands: pinch and hold to swim where you look
// URL options: ?xrscale= ?xrdet= ?xrbloom=1 ?xrgl=1 as in Abyssal Garden VR.
{
  const bVR = $('v'), bOpt = $('vo'), note = $('vn');
  const URLQ = new URLSearchParams(location.search);
  const XSCALE = +URLQ.get('xrscale') || [0.9, 0.75, 0.7][LV];
  const XDET = min(DET0, +URLQ.get('xrdet') || [1, 0.8, 0.6][LV]), DETMIN = 0.3;
  const XBLOOM = URLQ.get('xrbloom') === '1';
  // comfort options and controller mapping shared with the other maps (same key in localStorage)
  const VDEF = { move: 'left', point: 0, fast: 1, next: 4 };
  let opt = { snap: true, vig: true, ...VDEF };
  try { opt = { ...opt, ...JSON.parse(localStorage.abyssalVR || '{}') }; } catch {}
  // gurgle: B / Y, or the first face button the other actions leave free
  const gurB = [5, 4, 3].find((b) => b !== opt.point && b !== opt.fast && b !== opt.next) ?? -1;
  const BTN = { 0: 'Trigger', 1: 'Grip', 3: 'Stick press', 4: 'A / X', 5: 'B / Y', '-1': 'Off' };
  for (const b of $('r').querySelectorAll('[data-x]')) {
    const a = b.dataset.x;
    b.textContent = a === 'move' ? (opt.move === 'left' ? 'Left stick' : 'Right stick') : a === 'turn' ? (opt.move === 'left' ? 'Right stick' : 'Left stick') : BTN[a === 'gur' ? gurB : opt[a]];
  }
  const optB = bOpt.querySelectorAll('.vt');
  const showOpt = () => {
    optB[0].textContent = opt.snap ? 'Snap turn' : 'Smooth turn';
    optB[1].textContent = opt.vig ? 'Vignette on' : 'Vignette off';
    keep('abyssalVR', JSON.stringify(opt));
  };
  optB[0].onclick = () => { opt.snap = !opt.snap; showOpt(); };
  optB[1].onclick = () => { opt.vig = !opt.vig; showOpt(); };
  const say2 = (m) => { note.textContent = m; note.hidden = !m; };
  navigator.xr?.isSessionSupported('immersive-vr').then((ok) => { if (ok) { bOpt.hidden = false; $('nm').hidden = true; $('r').classList.add('vr'); showOpt(); fitMenu(); } }).catch(() => 0);

  let xb, layer, xref, pPostXR, passXR, place = true;
  // the WebGL path: a WebGPU canvas per eye, and a WebGL program that draws it over the eye's viewport
  let gl = null, glL = null, xc, xctx, xcW = 0, xcH = 0;
  function glInit() {
    xc = document.createElement('canvas'); xctx = xc.getContext('webgpu');
    gl = document.createElement('canvas').getContext('webgl2', { xrCompatible: true, alpha: false, antialias: false, depth: false });
    const p = gl.createProgram(), sh = (t, src) => { const o = gl.createShader(t); gl.shaderSource(o, src); gl.compileShader(o); gl.attachShader(p, o); };
    sh(gl.VERTEX_SHADER, 'attribute vec2 p;varying vec2 u;void main(){u=vec2(p.x,-p.y)*.5+.5;gl_Position=vec4(p,0,1);}');
    sh(gl.FRAGMENT_SHADER, 'precision mediump float;uniform sampler2D t;varying vec2 u;void main(){gl_FragColor=vec4(texture2D(t,u).rgb,1);}');
    gl.bindAttribLocation(p, 0, 'p'); gl.linkProgram(p); gl.useProgram(p);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    gl.enable(gl.SCISSOR_TEST);
  }
  // the rig: the play space's turn about the vertical (rig[3]); the head at placement (H0) is the game's camera point
  const rig = new Float64Array(4), H0 = new Float64Array(3), A0 = new Float64Array(3);
  let camOff = 0; // the head's heading in the play space at placement: the camera stays behind the creature that way
  const held = new Set(); // input sources with select held: a hand's pinch
  const R = new Float64Array(3);
  const rot = (x, y, z) => { const c = cos(rig[3]), s = sin(rig[3]); R[0] = x * c - z * s; R[1] = y; R[2] = x * s + z * c; };
  const { sign, asin } = Math;
  const dz = (v) => (abs(v) < 0.15 ? 0 : (v - sign(v) * 0.15) / 0.85); // thumbstick dead zone

  async function enter() {
    sound(); say2('');
    let s = null;
    // the binding first (no copy), then a WebGL session (?xrgl=1 forces that one, for testing)
    if (typeof XRGPUBinding !== 'undefined' && URLQ.get('xrgl') !== '1')
      s = await navigator.xr.requestSession('immersive-vr', { requiredFeatures: ['webgpu'], optionalFeatures: ['hand-tracking'] }).catch(() => null);
    glL = null;
    try {
      if (!s) s = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['hand-tracking'] });
    } catch (e) { return say2('VR did not start: ' + e.message); }
    try {
      let fmt;
      if (s.enabledFeatures ? s.enabledFeatures.includes('webgpu') : typeof XRGPUBinding !== 'undefined' && URLQ.get('xrgl') !== '1') {
        xb = new XRGPUBinding(s, device);
        fmt = xb.getPreferredColorFormat();
        layer = xb.createProjectionLayer({ colorFormat: fmt, scaleFactor: XSCALE });
        s.updateRenderState({ layers: [layer] });
      } else {
        if (!gl) glInit();
        await gl.makeXRCompatible();
        glL = new XRWebGLLayer(s, gl, { framebufferScaleFactor: XSCALE, antialias: false, depth: false, alpha: false });
        s.updateRenderState({ baseLayer: glL });
        fmt = navigator.gpu.getPreferredCanvasFormat(); xcW = 0;
      }
      if (!pPostXR || passXR.fmt !== fmt) { pPostXR = await postPipe(fmt); passXR = { fmt, colorAttachments: [{ view: null, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] }; }
      xref = await s.requestReferenceSpace('local');
    } catch (e) { s.end().catch(() => 0); return say2('VR did not start: ' + e.message); }
    console.log('[xr] session through ' + (glL ? 'WebGL (copy per eye)' : 'the WebGPU binding'));
    if (menu) go(true); // the dive as the Dive button starts it, the creature from the menu's panel
    xs = s; place = true; held.clear(); xrDet = XDET; det = min(det, XDET); xDyn = xN = xG = xGN = 0;
    s.addEventListener('selectstart', (e) => held.add(e.inputSource));
    s.addEventListener('selectend', (e) => held.delete(e.inputSource));
    s.addEventListener('end', () => {
      xs = null; CTX = 0; CTY = TANH; xrDet = 1; meCamY = meCamP = null;
      UB[UXR] = UB[UXR + 1] = 0.5; UB[UXR + 2] = UB[UXR + 4] = UB[UXR + 5] = 0;
      W = 0; resize(); release(); ui(true); bVR.textContent = 'Enter VR';
    });
    ui(false); bVR.textContent = 'Back in VR';
    s.requestAnimationFrame(xrFrame);
  }
  bVR.onclick = enter;

  let xLast = 0, xDyn = 0, xN = 0, xG = 0, xGN = 0, xLog = 0, turnHeld = false, burstHeld = false, vig = 0;
  function xrFrame(now, xf) {
    const s = xf.session;
    s.requestAnimationFrame(xrFrame);
    let dt = xLast ? (now - xLast) / 1000 : 0; xLast = now; if (dt > 0.1) dt = 0.1;
    const pose = xf.getViewerPose(xref);
    if (!pose || !pose.views.length) return;

    // ---- the head in the play space, its forward
    const hm = pose.transform.matrix, hfx = -hm[8], hfy = -hm[9], hfz = -hm[10], hyaw = atan2(hfx, -hfz);
    if (place) { // looking ahead in the headset is where the game was looking
      rig[3] = F[YAW] - hyaw; camOff = hyaw; H0[0] = hm[12]; H0[1] = hm[13]; H0[2] = hm[14];
      vig = 0; place = false;
    }

    // ---- input: the sticks and buttons become the game's keys
    let mx = 0, my = 0, tx = 0, ty = 0, fast = 0, bite = 0, gur = 0, burst = false, pinch = false;
    for (const src of s.inputSources) {
      const gp = src.gamepad;
      if (gp && gp.axes.length >= 4) {
        const ax = dz(gp.axes[2]), ay = dz(gp.axes[3]), b = gp.buttons;
        if (src.handedness === opt.move) { mx = ax; my = ay; } else { tx = ax; ty = ay; }
        if (b[opt.fast]?.pressed) fast = 1;
        if (b[opt.point]?.pressed) bite = 1;
        if (b[opt.next]?.pressed) burst = true;
        if (b[gurB]?.pressed) gur = 1;
      } else if (held.has(src)) pinch = true;
    }
    // turning turns the play space, and the camera with it round the creature (at once: no slide)
    let da = 0, turning = 0;
    if (opt.snap) {
      if (!turnHeld && abs(tx) > 0.7) { da = sign(tx) * PI / 6; turnHeld = true; }
      else if (abs(tx) < 0.3) turnHeld = false;
    } else { da = tx * 1.6 * dt; turning = abs(tx); }
    if (da) {
      rig[3] += da;
      if (me) { const c = cos(da), sn = sin(da), x = F[CX] - me.x, z = F[CZ] - me.z; F[CX] = me.x + x * c - z * sn; F[CZ] = me.z + x * sn + z * c; }
    }
    // the view the game steers by is the head's; its camera sits behind along the play space's heading, a little above
    rot(hfx, hfy, hfz); F[YAW] = atan2(R[0], -R[2]); F[PIT] = asin(clamp(R[1], -1, 1));
    meCamY = rig[3] + camOff; meCamP = -0.3;
    kf = pinch ? 1 : max(0, -my); kb = max(0, my); kr = max(0, mx); kl = max(0, -mx); ku = max(0, -ty); kd = max(0, ty);
    ks = fast; kbt = bite; kg = gur;
    if (burst && !burstHeld) meBurst();
    burstHeld = burst;
    mdx = mdy = lkx = lky = l2x = l2y = 0; tId = jId = -1; jmx = jmy = tN = 0; // (no mouse or fingers in VR)
    step(dt, now);

    // comfort vignette: closes in with speed and smooth turning
    const sp = me ? abs(me.v) : hypot(F[VX], F[VY], F[VZ]);
    const want = opt.vig ? min(1, sp / 6) * 0.75 + turning * 0.75 : 0;
    vig += (min(want, 0.9) - vig) * (1 - exp(-dt * 6));

    // ---- draw distance follows the GPU time (or the frame time) to hold the headset's frame rate
    xDyn += dt; xN++;
    if (xDyn > 1) {
      const per = xDyn / xN * 1000, g = xGN ? xG / xGN : 0, budget = 1000 / (s.frameRate || 72);
      const load = g || per;
      if (load > budget * (g ? 0.9 : 1.1)) xrDet = max(DETMIN, xrDet * 0.9);
      else if (load < budget * (g ? 0.65 : 0.8)) xrDet = min(DET0, xrDet * 1.04);
      if ((xLog += xDyn) > 2) { console.log(`[xr] ${(xN / xDyn).toFixed(0)} fps  frame ${per.toFixed(1)} ms  GPU ${g ? g.toFixed(1) + ' ms' : 'n/a'}  draw distance ${det.toFixed(2)}  ${W}x${H} per eye`); xLog = 0; }
      xDyn = xN = xG = xGN = 0;
    }
    if (F[GPU] > 0) { xG += F[GPU]; xGN++; F[GPU] = 0; }

    // ---- the head in the world: the game's camera point plus how far the head has moved since placement. The
    // drawing (culling, shadows of the creatures) is from there; the game's own point is put back after.
    A0[0] = F[CX]; A0[1] = F[CY]; A0[2] = F[CZ];
    rot(hm[12] - H0[0], hm[13] - H0[1], hm[14] - H0[2]);
    F[CX] += R[0]; F[CY] += R[1]; F[CZ] += R[2];
    basis(F[YAW], F[PIT]); CTX = CTY = 1.7; // one wide frustum round the head (level: wide enough for both eyes at any roll)
    botShadows(UB);

    // ---- both eyes
    const views = pose.views;
    for (let i = 0; i < views.length; i++) {
      const v = views[i], sub = glL ? null : xb.getViewSubImage(layer, v), gvp = glL && glL.getViewport(v);
      const vp = glL ? { x: 0, y: 0, width: gvp.width, height: gvp.height } : sub.viewport;
      if (glL && (xcW !== vp.width || xcH !== vp.height)) {
        xc.width = xcW = vp.width; xc.height = xcH = vp.height; xctx.configure({ device, format: passXR.fmt, alphaMode: 'opaque' });
      }
      if (vp.width !== W || vp.height !== H) makeTargets(vp.width, vp.height);
      const m = v.transform.matrix, P = v.projectionMatrix;
      rot(m[12] - H0[0], m[13] - H0[1], m[14] - H0[2]); const ex = A0[0] + R[0], ey = A0[1] + R[1], ez = A0[2] + R[2];
      rot(m[0], m[1], m[2]); const rx = R[0], ry = R[1], rz = R[2];
      rot(m[4], m[5], m[6]); const ux = R[0], uy = R[1], uz = R[2];
      rot(-m[8], -m[9], -m[10]);
      // P is the usual perspective matrix: x_ndc = P[0] * x / depth - P[8] (and y with P[5], P[9])
      setCam(ex, ey, ez, rx, ry, rz, ux, uy, uz, R[0], R[1], R[2], P[0], P[5], P[8], P[9]);
      UB[UXR] = (1 - P[8]) / 2; UB[UXR + 1] = (1 + P[9]) / 2; UB[UXR + 2] = vig; UB[UXR + 4] = vp.x; UB[UXR + 5] = vp.y;
      Q.writeBuffer(ubo, 0, UB);
      const e = device.createCommandEncoder();
      passXR.colorAttachments[0].view = glL ? xctx.getCurrentTexture().createView() : sub.colorTexture.createView(sub.getViewDescriptor());
      draw(e, i === 0, i === views.length - 1, pPostXR, passXR, vp, XBLOOM);
      Q.submit([e.finish()]);
      if (glL) { // copy this eye's canvas into the headset's framebuffer
        gl.bindFramebuffer(gl.FRAMEBUFFER, glL.framebuffer);
        gl.viewport(gvp.x, gvp.y, gvp.width, gvp.height); gl.scissor(gvp.x, gvp.y, gvp.width, gvp.height);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, xc);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    }
    F[CX] = A0[0]; F[CY] = A0[1]; F[CZ] = A0[2];
  }
}
