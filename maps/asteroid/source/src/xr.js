// ============================================================================
// VR for 15 Eunomia: "Enter VR" in headset browsers with WebXR and WebGPU
// ============================================================================
// Rendering is Abyssal Garden VR's (the WebXR/WebGPU binding, or a WebGL session with one copy per eye). Moving is
// the game's own: the headset's sticks and buttons stand in for the keys, and step() (main.js) walks, jumps, flies
// and lands exactly as on the desktop, on the asteroid's own gravity. The headset rides on that body: its "floor"
// is the ground under you (up is G, away from the asteroid), and turning turns the heading H about it.
//
// Controllers: move stick walk / thrust where you look  ·  other stick left/right turn, up thrust up (jump), down
//              thrust down  ·  grip boost  ·  A / X jump  ·  trigger walk where you look
// Hands:       pinch and hold to walk / thrust where you look
// URL options: ?xrscale= ?xrdet= ?xrbloom=1 ?xrgl=1 as in Abyssal Garden VR.
{
  const bVR = $('v'), bOpt = $('vo'), note = $('vn');
  const URLQ = new URLSearchParams(location.search);
  const XSCALE = +URLQ.get('xrscale') || [0.9, 0.75, 0.7][LV];
  const XDET = +URLQ.get('xrdet') || [1, 0.8, 0.6][LV];
  const XBLOOM = URLQ.get('xrbloom') === '1';
  // comfort options and controller mapping shared with the other maps (same keys in localStorage)
  const VDEF = { move: 'left', point: 0, fast: 1, next: 4 };
  let opt = { snap: true, vig: true, ...VDEF };
  try { opt = { ...opt, ...JSON.parse(localStorage.abyssalVR || '{}') }; } catch {}
  const optB = bOpt.querySelectorAll('.vt');
  const showOpt = () => {
    optB[0].textContent = opt.snap ? 'Snap turn' : 'Smooth turn';
    optB[1].textContent = opt.vig ? 'Vignette on' : 'Vignette off';
    keep('abyssalVR', JSON.stringify(opt));
  };
  // the start page starts the game on any click: these buttons only do their own thing
  for (const b of [bVR, ...optB]) b.addEventListener('click', (e) => e.stopPropagation());
  optB[0].onclick = (e) => { e.stopPropagation(); opt.snap = !opt.snap; showOpt(); };
  optB[1].onclick = (e) => { e.stopPropagation(); opt.vig = !opt.vig; showOpt(); };
  const say2 = (m) => { note.textContent = m; note.hidden = !m; };
  navigator.xr?.isSessionSupported('immersive-vr').then((ok) => { if (ok) { bOpt.hidden = false; showOpt(); } }).catch(() => 0);

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
  const held = new Set(); // input sources with select held: a hand's pinch
  const { sign, asin } = Math;
  const dz = (v) => (abs(v) < 0.15 ? 0 : (v - sign(v) * 0.15) / 0.85); // thumbstick dead zone
  // the rig: the play space's heading in the world (square to the body's up G); its origin is the head at entry
  const HR = new Float64Array(3), H0 = new Float64Array(3), Wv = new Float64Array(3);
  // a vector (x, y, z) of the play space into the world: x along the right, y along up G, z along the back
  const toW = (x, y, z) => {
    const gx = F[GX], gy = F[GY], gz = F[GZ], hx = HR[0], hy = HR[1], hz = HR[2];
    const rx = hy * gz - hz * gy, ry = hz * gx - hx * gz, rz = hx * gy - hy * gx;
    Wv[0] = rx * x + gx * y - hx * z; Wv[1] = ry * x + gy * y - hy * z; Wv[2] = rz * x + gz * y - hz * z;
  };
  // keep the rig's heading square to up (up eases as you walk round the asteroid)
  const squareHR = () => {
    const gx = F[GX], gy = F[GY], gz = F[GZ], d = HR[0] * gx + HR[1] * gy + HR[2] * gz;
    let x = HR[0] - gx * d, y = HR[1] - gy * d, z = HR[2] - gz * d; const l = hypot(x, y, z);
    if (l < 1e-4) { x = F[HX]; y = F[HY]; z = F[HZ]; } else { x /= l; y /= l; z /= l; }
    HR[0] = x; HR[1] = y; HR[2] = z;
  };
  const turnHR = (a) => { // about up G
    const gx = F[GX], gy = F[GY], gz = F[GZ], hx = HR[0], hy = HR[1], hz = HR[2];
    const rx = hy * gz - hz * gy, ry = hz * gx - hx * gz, rz = hx * gy - hy * gx, c = cos(a), s = sin(a);
    HR[0] = hx * c + rx * s; HR[1] = hy * c + ry * s; HR[2] = hz * c + rz * s;
  };

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
      W = 0; resize(); ui(true); bVR.textContent = 'Enter VR';
    });
    ui(false); started = 1; bVR.textContent = 'Back in VR';
    s.requestAnimationFrame(xrFrame);
  }
  bVR.onclick = (e) => { e.stopPropagation(); enter(); };

  let xLast = 0, xDyn = 0, xN = 0, xG = 0, xGN = 0, xLog = 0, turnHeld = false, vig = 0;
  function xrFrame(now, xf) {
    const s = xf.session;
    s.requestAnimationFrame(xrFrame);
    let dt = xLast ? (now - xLast) / 1000 : 0; xLast = now; if (dt > 0.1) dt = 0.1;
    const pose = xf.getViewerPose(xref);
    if (!pose || !pose.views.length) return;
    const hm = pose.transform.matrix;
    if (place) { // the rig faces where the game was looking; the head as it is now is the body's eye
      HR[0] = F[HX]; HR[1] = F[HY]; HR[2] = F[HZ]; squareHR();
      const hyaw = atan2(-hm[8], -hm[10]); turnHR(-hyaw); // so that looking ahead in the headset is the old heading
      H0[0] = hm[12]; H0[1] = hm[13]; H0[2] = hm[14]; place = false;
    }

    // ---- input: sticks and buttons become the game's keys
    let mx = 0, my = 0, tx = 0, ty = 0, fast = 0, jump = false, go = false;
    for (const src of s.inputSources) {
      const gp = src.gamepad;
      if (gp && gp.axes.length >= 4) {
        const ax = dz(gp.axes[2]), ay = dz(gp.axes[3]), b = gp.buttons;
        if (src.handedness === opt.move) { mx = ax; my = ay; } else { tx = ax; ty = ay; }
        if (b[opt.fast]?.pressed) fast = 1;
        if (b[opt.next]?.pressed) jump = true;
        if (b[opt.point]?.pressed) go = true;
      } else if (held.has(src)) go = true;
    }
    if (opt.snap) {
      if (!turnHeld && abs(tx) > 0.7) { turnHR(sign(tx) * PI / 6); turnHeld = true; }
      else if (abs(tx) < 0.3) turnHeld = false;
    } else turnHR(tx * 1.6 * dt);
    // the game moves along its heading H and pitch: make those the head's
    toW(-hm[8], -hm[9], -hm[10]);
    { const gx = F[GX], gy = F[GY], gz = F[GZ], s1 = Wv[0] * gx + Wv[1] * gy + Wv[2] * gz;
      let x = Wv[0] - gx * s1, y = Wv[1] - gy * s1, z = Wv[2] - gz * s1; const l = hypot(x, y, z);
      if (l > 1e-3) { F[HX] = x / l; F[HY] = y / l; F[HZ] = z / l; }
      F[PIT] = asin(s1 > 1 ? 1 : s1 < -1 ? -1 : s1); }
    kf = go ? 1 : max(0, -my); kb = max(0, my); kr = max(0, mx); kl = max(0, -mx);
    ku = jump || ty < -0.5 ? 1 : 0; kd = ty > 0.5 ? 1 : 0; ks = fast;
    if (!menu) step(dt); else F[TIME] += dt;
    squareHR();

    // comfort vignette: closes in with speed and smooth turning
    const turning = opt.snap ? 0 : abs(tx);
    const want = opt.vig ? min(1, hypot(F[VX], F[VY], F[VZ]) / 8) * 0.75 + turning * 0.75 : 0;
    vig += (min(want, 0.9) - vig) * (1 - exp(-dt * 6));

    // ---- culling: one wide frustum around the head
    toW(-hm[8], -hm[9], -hm[10]); F[FX] = Wv[0]; F[FY] = Wv[1]; F[FZ] = Wv[2];
    toW(hm[0], hm[1], hm[2]); F[RX] = Wv[0]; F[RY] = Wv[1]; F[RZ] = Wv[2];
    toW(hm[4], hm[5], hm[6]); F[UX] = Wv[0]; F[UY] = Wv[1]; F[UZ] = Wv[2];
    CTX = CTY = 1.7;
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
      toW(m[12] - H0[0], m[13] - H0[1], m[14] - H0[2]); const ex = F[CX] + Wv[0], ey = F[CY] + Wv[1], ez = F[CZ] + Wv[2];
      toW(m[0], m[1], m[2]); const rx = Wv[0], ry = Wv[1], rz = Wv[2];
      toW(m[4], m[5], m[6]); const ux = Wv[0], uy = Wv[1], uz = Wv[2];
      toW(-m[8], -m[9], -m[10]);
      // P is the usual perspective matrix: x_ndc = P[0] * x / depth - P[8] (and y with P[5], P[9])
      setCam(ex, ey, ez, rx, ry, rz, ux, uy, uz, Wv[0], Wv[1], Wv[2], P[0], P[5], P[8], P[9]);
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
