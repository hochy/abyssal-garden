// ============================================================================
// VR: "Enter VR" for headset browsers with WebXR and WebGPU
// ============================================================================
// Two ways to reach the headset. Where the browser has the WebXR/WebGPU binding (Quest Browser), the composite
// writes straight into the headset's layer. Elsewhere (and if the binding is refused) the session is a plain WebGL
// one: each eye is drawn into a WebGPU canvas, which WebGL then copies into the headset's framebuffer. That costs one
// copy per eye but works in any browser that has both WebXR and WebGPU (idea from strayer/abyssal-garden-vr, MIT).
// The world, the shaders and the passes are the desktop ones. Each frame, for each eye: the camera comes from the
// headset (setCam with that eye's off-centre frustum), the passes run into our own targets at the eye's size, and the
// composite writes into the headset's projection layer.
// Moving around moves a "rig" (the play space) through the world. The head moves freely inside it; collide() keeps
// the head out of the rock and the rig follows, so leaning into a wall pushes you back out.
//
// Controllers (defaults; the player can change them in the menu's VR controls):
//               left stick swim (in the direction you look)  ·  other stick left/right turn, up/down rise/sink
//               grip  swim faster  ·  trigger  swim where the controller points  ·  A / X  next viewpoint
// Hands:        pinch and hold to swim where the hand points
//
// URL options for tuning on the headset (no rebuild needed):
//   ?xrscale=0.7   resolution of the headset's layer (1 = the headset's default; lower is faster and blurrier)
//   ?xrdet=0.6     starting draw distance for plants and rocks (0.4 to 1); it then adapts to the frame time
//   ?xrbloom=1     keep the bloom glow (off in VR by default: 11 extra full-screen passes per eye)
// The console (chrome://inspect from a computer) gets a line with the frame rate and GPU time every 2 seconds.
{
  const bVR = $('v'), bOpt = $('x'), note = $('y');
  const URLQ = new URLSearchParams(location.search);
  const XSCALE = +URLQ.get('xrscale') || [0.9, 0.75, 0.7][LV]; // Low 0.7: tested smooth on a Quest 3
  const XDET = +URLQ.get('xrdet') || [1, 0.8, 0.6][LV];
  const XBLOOM = URLQ.get('xrbloom') === '1';
  // comfort options and controller mapping, kept between visits. Buttons are xr-standard gamepad indices
  // (0 trigger, 1 grip, 3 stick press, 4 A / X, 5 B / Y); -1 is off. move: the hand whose stick swims.
  const VDEF = { move: 'left', point: 0, fast: 1, next: 4 };
  let opt = { snap: true, vig: true, ...VDEF };
  try { opt = { ...opt, ...JSON.parse(localStorage.abyssalVR || '{}') }; } catch {}
  const BTN = { 0: 'Trigger', 1: 'Grip', 3: 'Stick press', 4: 'A / X', 5: 'B / Y', '-1': 'Off' };
  const CHOICES = { point: [0, 1, -1], fast: [1, 0, 3, 5, 4, -1], next: [4, 5, 3, -1] };
  const vB = $('r').querySelectorAll('[data-v]');
  const showMap = () => {
    for (const b of vB) {
      const a = b.dataset.v;
      b.textContent = a === 'move' ? (opt.move === 'left' ? 'Left stick' : 'Right stick') : a === 'turn' ? (opt.move === 'left' ? 'Right stick' : 'Left stick') : BTN[opt[a]];
    }
    keep('abyssalVR', JSON.stringify(opt));
  };
  // each click steps to the next choice, skipping buttons another action already uses
  for (const b of vB) if (b.tagName === 'BUTTON') b.onclick = () => {
    const a = b.dataset.v;
    if (a === 'move') opt.move = opt.move === 'left' ? 'right' : 'left';
    else {
      const c = CHOICES[a], used = ['point', 'fast', 'next'].filter((o) => o !== a).map((o) => opt[o]);
      let i = c.indexOf(opt[a]);
      do i = (i + 1) % c.length; while (c[i] >= 0 && used.includes(c[i]));
      opt[a] = c[i];
    }
    showMap();
  };
  $('vx').onclick = () => { Object.assign(opt, VDEF); showMap(); };
  showMap();
  const optB = bOpt.querySelectorAll('button');
  const showOpt = () => {
    optB[0].textContent = opt.snap ? 'Snap turn' : 'Smooth turn'; optB[0].className = 'on';
    optB[1].textContent = opt.vig ? 'Vignette on' : 'Vignette off'; optB[1].className = opt.vig ? 'on' : '';
    keep('abyssalVR', JSON.stringify(opt));
  };
  optB[0].onclick = () => { opt.snap = !opt.snap; showOpt(); };
  optB[1].onclick = () => { opt.vig = !opt.vig; showOpt(); };
  const say2 = (m) => { note.textContent = m; note.hidden = !m; };

  // offer VR only where the browser says it can do immersive VR at all; whether it can do it with WebGPU only shows
  // when the session is requested
  // (the VR controls list stays visible on large screens either way; with VR it shows on any screen)
  navigator.xr?.isSessionSupported('immersive-vr').then((ok) => { if (ok) { bVR.hidden = bOpt.hidden = false; $('r').classList.add('vr'); showOpt(); } }).catch(() => 0);

  let xb, layer, xref, pPostXR, passXR, deskDet = det, place = true;
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
  const rig = new Float64Array(4); // play-space origin in the world (x, y, z) and its turn about the vertical (w)
  const held = new Set(); // input sources with select held: a hand's pinch
  // rotate (x, y, z) by the rig's turn: the result is in R[0..2]
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
      if (!pPostXR || passXR.fmt !== fmt) { pPostXR = postPipe(fmt); passXR = { fmt, colorAttachments: [{ view: null, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] }; }
      xref = await s.requestReferenceSpace('local');
    } catch (e) { s.end().catch(() => 0); return say2('VR did not start: ' + e.message); }
    console.log('[xr] session through ' + (glL ? 'WebGL (copy per eye)' : 'the WebGPU binding'));
    xs = s; place = true; held.clear(); deskDet = det; det = XDET; xDyn = xN = xG = xGN = 0;
    s.addEventListener('selectstart', (e) => held.add(e.inputSource));
    s.addEventListener('selectend', (e) => held.delete(e.inputSource));
    s.addEventListener('end', () => {
      xs = null; CTX = 0; CTY = TANH; det = deskDet; UB[60] = UB[61] = 0.5; UB[62] = UB[64] = UB[65] = 0;
      W = 0; resize(); ui(true);
    });
    ui(false);
    s.requestAnimationFrame(xrFrame);
  }
  bVR.onclick = enter;

  let xLast = 0, xDyn = 0, xN = 0, xG = 0, xGN = 0, xLog = 0, turnHeld = false, btnHeld = false, vig = 0, pose6 = 0;
  function xrFrame(now, xf) {
    const s = xf.session;
    s.requestAnimationFrame(xrFrame);
    let dt = xLast ? (now - xLast) / 1000 : 0; xLast = now; if (dt > 0.1) dt = 0.1;
    const pose = xf.getViewerPose(xref);
    if (!pose || !pose.views.length) return;
    F[TIME] += dt;

    // ---- head in the play space; its forward and right vectors
    const hm = pose.transform.matrix, hx = hm[12], hy = hm[13], hz = hm[14];
    const hfx = -hm[8], hfy = -hm[9], hfz = -hm[10], hyaw = atan2(hfx, -hfz);
    if (place) { // put the head where the desktop camera was, looking the same way
      rig[3] = F[YAW] - hyaw; rot(hx, hy, hz); rig[0] = F[CX] - R[0]; rig[1] = F[CY] - R[1]; rig[2] = F[CZ] - R[2];
      F[VX] = F[VY] = F[VZ] = 0; place = false;
    }
    rot(hx, hy, hz); F[CX] = rig[0] + R[0]; F[CY] = rig[1] + R[1]; F[CZ] = rig[2] + R[2];

    // ---- input
    let mx = 0, my = 0, tx = 0, ty = 0, fast = 0, px = 0, py = 0, pz = 0, btn = false;
    for (const src of s.inputSources) {
      const gp = src.gamepad;
      let point = false;
      if (gp && gp.axes.length >= 4) { // a controller: its buttons as mapped in the menu
        const ax = dz(gp.axes[2]), ay = dz(gp.axes[3]), b = gp.buttons;
        if (src.handedness === opt.move) { mx = ax; my = ay; } else { tx = ax; ty = ay; }
        if (b[opt.fast]?.pressed) fast = 1;
        if (b[opt.next]?.pressed) btn = true;
        point = !!b[opt.point]?.pressed;
      } else point = held.has(src); // a hand: pinch
      if (point) { const p = xf.getPose(src.targetRaySpace, xref); if (p) { const m = p.transform.matrix; px -= m[8]; py -= m[9]; pz -= m[10]; } }
    }
    // the next of the six viewpoints (A / X unless remapped)
    if (btn && !btnHeld) { pose6 = (pose6 + 1) % POSES.length; lookAt(...POSES[pose6]); place = true; }
    btnHeld = btn;
    if (place) return; // re-placed next frame
    // turning pivots about the head: the head's world position stays, the rig turns under it
    let turning = 0;
    if (opt.snap) {
      if (!turnHeld && abs(tx) > 0.7) { rig[3] += sign(tx) * PI / 6; turnHeld = true; }
      else if (abs(tx) < 0.3) turnHeld = false;
    } else { rig[3] += tx * 1.6 * dt; turning = abs(tx); }

    // ---- swim: velocity eases toward the wanted one, as on the desktop, but slower
    const hl = hypot(hm[0], hm[2]) || 1, hrx = hm[0] / hl, hrz = hm[2] / hl; // head right, kept level
    let dx = hfx * -my + hrx * mx, dy = hfy * -my - ty, dzz = hfz * -my + hrz * mx;
    const pl = hypot(px, py, pz); if (pl > 0) { dx += px / pl; dy += py / pl; dzz += pz / pl; }
    const dl = hypot(dx, dy, dzz); if (dl > 1) { dx /= dl; dy /= dl; dzz /= dl; }
    rot(dx, dy, dzz);
    const sp = fast ? 9 : 3, k = 1 - exp(-dt * 4.5);
    const vx = F[VX] + (R[0] * sp - F[VX]) * k, vy = F[VY] + (R[1] * sp - F[VY]) * k, vz = F[VZ] + (R[2] * sp - F[VZ]) * k;
    let x = F[CX] + vx * dt, y = F[CY] + vy * dt, z = F[CZ] + vz * dt;
    const rad = sqrt(x * x + z * z); if (rad > 150) { x *= 150 / rad; z *= 150 / rad; }
    y = y < -52 ? -52 : y > -1.2 ? -1.2 : y;
    F[VX] = vx; F[VY] = vy; F[VZ] = vz; F[MX] = x - F[CX]; F[MY] = y - F[CY]; F[MZ] = z - F[CZ];
    collide();
    rot(hx, hy, hz); rig[0] = F[CX] - R[0]; rig[1] = F[CY] - R[1]; rig[2] = F[CZ] - R[2];
    // the desktop view picks up from here when VR ends
    F[YAW] = rig[3] + hyaw; F[PIT] = asin(clamp(hfy, -1, 1));

    // comfort vignette: closes in with speed and smooth turning
    const want = opt.vig ? min(1, hypot(vx, vy, vz) / 6) * 0.75 + turning * 0.75 : 0;
    vig += (min(want, 0.9) - vig) * (1 - exp(-dt * 6));

    // ---- culling: one wide frustum around the head (level, so wide enough for both eyes at any roll)
    basis(F[YAW], F[PIT]); CTX = CTY = 1.7;

    // ---- draw distance follows the GPU time (or the frame time) to hold the headset's frame rate
    xDyn += dt; xN++;
    if (xDyn > 1) {
      const per = xDyn / xN * 1000, g = xGN ? xG / xGN : 0, budget = 1000 / (s.frameRate || 72);
      const load = g || per; // with GPU timing the budget is for both eyes' GPU work
      if (load > budget * (g ? 0.9 : 1.1)) det = max(DETMIN, det * 0.9);
      else if (load < budget * (g ? 0.65 : 0.8)) det = min(1, det * 1.04);
      if ((xLog += xDyn) > 2) { console.log(`[xr] ${(xN / xDyn).toFixed(0)} fps  frame ${per.toFixed(1)} ms  GPU ${g ? g.toFixed(1) + ' ms' : 'n/a'}  draw distance ${det.toFixed(2)}  ${W}x${H} per eye`); xLog = 0; }
      xDyn = xN = xG = xGN = 0;
    }
    if (F[GPU] > 0) { xG += F[GPU]; xGN++; F[GPU] = 0; }

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
      rot(m[12], m[13], m[14]); const ex = rig[0] + R[0], ey = rig[1] + R[1], ez = rig[2] + R[2];
      rot(m[0], m[1], m[2]); const rx = R[0], ry = R[1], rz = R[2];
      rot(m[4], m[5], m[6]); const ux = R[0], uy = R[1], uz = R[2];
      rot(-m[8], -m[9], -m[10]);
      // P is the usual perspective matrix: x_ndc = P[0] * x / depth - P[8] (and y with P[5], P[9])
      setCam(ex, ey, ez, rx, ry, rz, ux, uy, uz, R[0], R[1], R[2], P[0], P[5], P[8], P[9]);
      UB[60] = (1 - P[8]) / 2; UB[61] = (1 + P[9]) / 2; UB[62] = vig; UB[64] = vp.x; UB[65] = vp.y;
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
  }
}
