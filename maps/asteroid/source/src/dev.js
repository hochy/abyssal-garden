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
    } else if (/Digit[1-6]/.test(e.code)) stop();
  });
  window.__cam = (...a) => lookAt(...a);
  window.__gpu = () => [F[GPU], W, H, det];
  window.__st = () => [F[CX], F[CY], F[CZ], grounded, alt, F[VX], F[VY], F[VZ], thr];
  // run n frames of 1/60 s by hand (a hidden tab gets no animation frames), with the menu and its blur out of the way
  window.__step = (n = 1) => {
    if (!window.__css) { window.__css = document.head.appendChild(document.createElement('style')); window.__css.textContent = 'canvas{transition:none!important;filter:none!important;transform:none!important;opacity:1!important}#m{display:none!important}'; }
    menu = false; started = land = 1; hs = 4; const raf = window.requestAnimationFrame; window.requestAnimationFrame = () => 0;
    for (let i = 0; i < n; i++) frame(F[LAST] + 1000 / 60);
    window.requestAnimationFrame = raf;
  };
  window.__title = () => { started = land = 0; };
  window.__eval = (c) => eval(c);
  window.__key = (code, v) => key({ code }, v);
  window.__pose = (i) => lookAt(...POSES[i]);
  window.__fly = (t) => { F[FLT] = t; flyAt(); };
  const qv = new URLSearchParams(location.search).get('v');
  if (qv !== null) setTimeout(() => { started = land = 1; ui(false); lookAt(...POSES[+qv]); }, 500);
}
