// ============================================================================
// renderer: device, samplers, textures, pipelines
// ============================================================================
const $ = (id) => document.getElementById(id);
const canvas = $('c'), info = $('i'), body = document.body;
// fitMenu, the menu's size, is in fit.js: the early script, run before this one
// a phone held upright gets the page turned on its side (see template.html)
const rot = matchMedia('(orientation:portrait) and (pointer:coarse)');
// loading bar: each stage glides it to `to` (the share done) over ~`ms` on the compositor, so it moves while this
// thread is busy
let loaded = 0, dead; // dead: the graphics device was lost
const say = (m, to, ms) => {
  if (!dead) $('s').textContent = m;
  const a = $('b').animate({ transform: [`scaleX(${loaded})`, `scaleX(${to})`] }, { duration: ms, fill: 'forwards', easing: 'cubic-bezier(.3,.5,.5,1)' });
  loaded = to;
  // go on once the animation runs: one not started before the thread gets busy stays stuck (timer: hidden tabs)
  return new Promise((r) => { a.ready.then(() => setTimeout(r)); setTimeout(r, document.hidden ? 0 : 1e3); });
};
const fail = (m) => { throw new Error(m, { cause: 1 }); }; // cause marks a message that is shown as it is
// the advice to use Chrome: only where there is no WebGPU and the browser is not Chromium-based (only those have userAgentData)
$('w').hidden = !!navigator.gpu || !!navigator.userAgentData;
if (!navigator.gpu) fail('This scene needs WebGPU. Try a current Chrome or Edge.');
// xrCompatible: the same device has to drive a headset later (xr.js); browsers without WebXR ignore it
const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance', xrCompatible: !!navigator.xr });
if (!adapter) fail('No WebGPU adapter found.');
const hasTS = adapter.features.has('timestamp-query');
const device = await adapter.requestDevice({ requiredFeatures: hasTS ? ['timestamp-query'] : [] });
// ?debug in the address: what the browser says about its GPU and the first errors, on the page itself (a phone has
// no console to read them from)
const DBG = /[?&#]debug/.test(location.href), dbgLog = [];
const dbg = (m) => {
  if (!DBG || dbgLog.length > 9) return;
  dbgLog.push(('' + m).slice(0, 1500));
  let d = $('dbg'); if (!d) { d = document.createElement('pre'); d.id = 'dbg'; d.style.cssText = 'position:fixed;left:0;top:0;right:0;max-height:70%;overflow:hidden;margin:0;padding:6px;z-index:99;font:10px/1.3 monospace;color:#fff;background:#0008;pointer-events:none;white-space:pre-wrap;word-break:break-all'; body.appendChild(d); }
  d.textContent = dbgLog.join('\n\n');
};
if (DBG) {
  const i = adapter.info || {};
  dbg('WebGPU debug · ' + [i.vendor, i.architecture, i.device, i.description].filter(Boolean).join(' / ') + '\n' + navigator.userAgent + '\nfeatures: ' + [...adapter.features].join(' ') + '\ncanvas: ' + navigator.gpu.getPreferredCanvasFormat() + ', dpr ' + devicePixelRatio + ', ' + innerWidth + 'x' + innerHeight);
  addEventListener('error', (e) => dbg('JS: ' + e.message + ' @' + e.lineno + ':' + e.colno));
  addEventListener('unhandledrejection', (e) => dbg('Promise: ' + (e.reason && e.reason.message || e.reason)));
}
device.addEventListener('uncapturederror', (e) => { console.error('GPU: ' + e.error.message); dbg('GPU: ' + e.error.message); });
// (and which pipeline an error belongs to: a failed one is named by its number, its entry points and the start of
// its vertex stage - one built asynchronously by what its promise is rejected with, the picker's plain one by its
// own error scopes)
if (DBG) {
  const src = new WeakMap(), mk = device.createShaderModule.bind(device); let n = 0;
  device.createShaderModule = (d) => { const m = mk(d); src.set(m, d.code); m.getCompilationInfo().then((ci) => { for (const g of ci.messages) if (g.type === 'error') dbg('WGSL: ' + g.message + ' @' + g.lineNum + ': ' + d.code.split('\n')[g.lineNum - 1]); }); return m; };
  for (const f of ['createRenderPipeline', 'createComputePipeline']) {
    const make = device[f].bind(device), makeA = device[f + 'Async'].bind(device);
    const teller = (d) => {
      const k = ++n, st = d.vertex || d.compute, code = src.get(st.module) || '', at = code.indexOf('fn ' + st.entryPoint);
      return (e) => { if (e) dbg('PIPELINE ' + k + ' (' + f.slice(6, 13) + ') ' + st.entryPoint + (d.fragment ? ' / ' + d.fragment.entryPoint + ' -> ' + d.fragment.targets.map((q) => q.format).join(',') : '') + ': ' + e.message + '\n' + code.slice(max(0, at - 260), at + 420)); };
    };
    device[f] = (d) => {
      const say = teller(d); device.pushErrorScope('validation'); device.pushErrorScope('internal');
      const p = make(d);
      device.popErrorScope().then(say); device.popErrorScope().then(say);
      return p;
    };
    device[f + 'Async'] = (d) => { const say = teller(d); return makeA(d).catch((e) => { say(e); throw e; }); };
  }
}
// out of memory or a GPU timeout: reload a level lower, or on Low say what happened
device.lost.then((l) => {
  if (l.reason === 'destroyed') return; // the page is closing
  if (LV < 2) { keep('abyssalInf', LV + 1); location.reload(); }
  dead = body.className = 'l e'; $('s').textContent = 'The graphics device was lost. Reload the page to try again.';
});
const ctx = canvas.getContext('webgpu'), FMT = navigator.gpu.getPreferredCanvasFormat();
// #offscreen: draw into a texture instead of the canvas (for automated tests where a canvas can't be presented; dev.js reads it back)
const OFF = location.hash.includes('offscreen'); let tOff = null;
const Q = device.queue, HDR = 'rgba16float', DEPTH = 'depth32float';
const TU = GPUTextureUsage, BU = GPUBufferUsage, SS = GPUShaderStage;

const mod = (code) => device.createShaderModule({ code });
const buf = (data, usage) => { const b = device.createBuffer({ size: (data.byteLength + 3) & ~3, usage: usage | BU.COPY_DST }); Q.writeBuffer(b, 0, data.buffer || data, data.byteOffset || 0, data.byteLength); return b; };
const tex = (w, h, format, usage, o = {}) => device.createTexture({ size: [w, h, o.d || 1], format, usage, mipLevelCount: o.mips || 1, sampleCount: o.samples || 1, dimension: o.d ? '3d' : '2d' });

// ---------------------------------------------------------------- static resources
const sRep = device.createSampler({ addressModeU: 'repeat', addressModeV: 'repeat', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', maxAnisotropy: [8, 4, 1][LV] });
const sClamp = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
// the world textures and the shadow map wrap around (see stream.js)
const sWrap = device.createSampler({ addressModeU: 'repeat', addressModeV: 'repeat', addressModeW: 'repeat', magFilter: 'linear', minFilter: 'linear' });
const sCmp = device.createSampler({ compare: 'less-equal', addressModeU: 'repeat', addressModeV: 'repeat', magFilter: 'linear', minFilter: 'linear' });
const tShadow = tex(SHADOW, SHADOW, DEPTH, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING);
const tDummy = tex(1, 1, DEPTH, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING);
const tWater = tex(WATER, WATER, HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING, { mips: 5 });
const tDetail = tex(1024, 1024, 'rgba8unorm', TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING, { mips: 11 });
const VOLN = WIN * TILE / 2; // the loaded window at half resolution
const tVol = tex(VOLN, NY / 2, 'rg8unorm', TU.TEXTURE_BINDING | TU.COPY_DST, { d: VOLN });
const tMap = tex(512, 512, 'rgba8unorm', TU.TEXTURE_BINDING | TU.COPY_DST);
// the simulated waves (waves.js fills them; every scene shader reads them for the light they focus): a layer for a cascade
const wtex = () => (GFX[7] ? device.createTexture({ size: [WN, WN, WC], format: HDR, mipLevelCount: WLOG + 1, usage: TU.TEXTURE_BINDING | TU.STORAGE_BINDING }) : null), tWD = wtex(), tWS = wtex();

// (after the 60 floats of the scene: two vec4 for each creature that casts a shadow, see critSh in shaders.js; then
// xr and xo of struct G at UXR, only non-zero in VR: xr.js)
const UXR = 60 + CSN * 8;
const UB = new Float32Array(UXR + 8), UBS = new Float32Array(UXR + 8);
const ubo = device.createBuffer({ size: UB.byteLength, usage: BU.UNIFORM | BU.COPY_DST }), uboS = device.createBuffer({ size: UB.byteLength, usage: BU.UNIFORM | BU.COPY_DST });
const WT = new Float32Array(4), uboW = device.createBuffer({ size: 16, usage: BU.UNIFORM | BU.COPY_DST });

const VF = SS.VERTEX | SS.FRAGMENT;
const bgl0 = device.createBindGroupLayout({ entries: [
  { binding: 0, visibility: VF, buffer: {} },
  { binding: 1, visibility: VF, sampler: {} }, { binding: 2, visibility: VF, sampler: {} }, { binding: 3, visibility: VF, sampler: { type: 'comparison' } },
  { binding: 4, visibility: VF, texture: { sampleType: 'depth' } },
  { binding: 5, visibility: VF, texture: {} }, { binding: 6, visibility: VF, texture: {} },
  { binding: 7, visibility: VF, texture: { viewDimension: '3d' } }, { binding: 8, visibility: VF, texture: {} },
  ...(tWD ? [9, 10].map((binding) => ({ binding, visibility: VF, texture: { viewDimension: '2d-array' } })) : [])] });
const mkBG0 = (u, sh) => device.createBindGroup({ layout: bgl0, entries: [
  { binding: 0, resource: { buffer: u } }, { binding: 1, resource: sRep }, { binding: 2, resource: sWrap }, { binding: 3, resource: sCmp },
  { binding: 4, resource: sh.createView() }, { binding: 5, resource: tWater.createView() }, { binding: 6, resource: tDetail.createView() },
  { binding: 7, resource: tVol.createView() }, { binding: 8, resource: tMap.createView() },
  ...(tWD ? [{ binding: 9, resource: tWD.createView() }, { binding: 10, resource: tWS.createView() }] : [])] });
const bg0 = mkBG0(ubo, tShadow), bg0s = mkBG0(uboS, tDummy);
const pl0 = device.createPipelineLayout({ bindGroupLayouts: [bgl0] });

const bglBlit = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: SS.FRAGMENT, texture: {} }, { binding: 1, visibility: SS.FRAGMENT, sampler: {} }] });
const plBlit = device.createPipelineLayout({ bindGroupLayouts: [bglBlit] });
const mBlit = mod(W_BLIT);
// Pipelines are built asynchronously (RP, CP give a promise): the plain calls compile on the main thread of the
// browser's GPU process, and a slow shader build there (a damaged driver shader cache did it in Edge) freezes every
// tab until the browser's watchdog kills the process.
const RP = (d) => device.createRenderPipelineAsync(d), CP = (d) => device.createComputePipelineAsync(d);
const blitPipe = (entry, format, add) => RP({ layout: plBlit, vertex: { module: mBlit, entryPoint: 'vs' },
  fragment: { module: mBlit, entryPoint: entry, targets: [{ format, blend: add ? { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } } : undefined }] } });
const qBlit = [blitPipe('fsMip', 'rgba8unorm'), blitPipe('fsMip', HDR), blitPipe('fsDown0', HDR), blitPipe('fsDown', HDR), blitPipe('fsUp', HDR, true)];
const blitBG = (view) => device.createBindGroup({ layout: bglBlit, entries: [{ binding: 0, resource: view }, { binding: 1, resource: sClamp }] });
const colorAtt = (view, clear) => ({ view, loadOp: clear ? 'clear' : 'load', storeOp: 'store', clearValue: [0, 0, 0, 0] });

// vertex layouts
const A = (shaderLocation, offset, format) => ({ shaderLocation, offset, format });
const vbSolid = { arrayStride: 16, attributes: [A(0, 0, 'float32x3'), A(1, 12, 'snorm8x4')] };
const ibSolid = { arrayStride: 48, stepMode: 'instance', attributes: [A(2, 0, 'float32x4'), A(3, 16, 'float32x4'), A(4, 32, 'float32x4')] };
const ibLeaf = { arrayStride: 36, stepMode: 'instance', attributes: [A(0, 0, 'float32x4'), A(1, 16, 'float32x4'), A(2, 32, 'unorm8x4')] };
const ibAnim = { arrayStride: 32, stepMode: 'instance', attributes: [A(2, 0, 'float32x4'), A(3, 16, 'float32x4')] };
const ibBub = { arrayStride: 32, stepMode: 'instance', attributes: [A(0, 0, 'float32x4'), A(1, 16, 'float32x4')] };
const ibSnow = { arrayStride: 16, stepMode: 'instance', attributes: [A(0, 0, 'float32x4')] };

const scenePipe = (m, vsE, fsE, buffers, o = {}) => RP({ layout: pl0,
  vertex: { module: m, entryPoint: vsE, buffers, constants: o.constants },
  fragment: { module: m, entryPoint: fsE, targets: [{ format: HDR, blend: o.blend }] },
  primitive: { topology: o.strip ? 'triangle-strip' : 'triangle-list', cullMode: o.cull || 'none' },
  depthStencil: { format: DEPTH, depthWriteEnabled: !o.blend, depthCompare: 'greater' }, multisample: { count: AA } });
const shadowPipe = (m, vsE, buffers, o = {}) => RP({ layout: pl0,
  vertex: { module: m, entryPoint: vsE, buffers, constants: o.constants },
  primitive: { topology: o.strip ? 'triangle-strip' : 'triangle-list', cullMode: o.cull || 'none' },
  depthStencil: { format: DEPTH, depthWriteEnabled: true, depthCompare: 'less', depthBias: 2, depthBiasSlopeScale: 1.5 } });

await say('Compiling shaders…', 0.05, 300);
const mSolid = mod(W_SOLID), mLeaf = mod(W_LEAF), mAnim = mod(W_ANIM), mSurf = mod(W_SURF), mSpr = mod(W_SPR);
const mWater = mod(W_WATER), mRays = mod(W_RAYS), mPost = mod(W_POST), mRB = mod(W_RBLUR);
const ADD = { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } };
// the composite: an explicit layout, so the VR composite (xr.js, the same shader into the headset's format) shares its
// bind group; SRGB: the target encodes sRGB itself, so the shader skips its own gamma
const FTX = (texture) => ({ visibility: SS.FRAGMENT, texture });
const plPost = device.createPipelineLayout({ bindGroupLayouts: [device.createBindGroupLayout({ entries: [{ binding: 0, visibility: SS.FRAGMENT, buffer: {} }, { binding: 1, visibility: SS.FRAGMENT, sampler: {} },
  { binding: 2, ...FTX({}) }, { binding: 3, ...FTX({}) }, { binding: 4, ...FTX({}) }, { binding: 5, ...FTX({ sampleType: 'depth', multisampled: AA > 1 }) }] })] });
const postPipe = (format) => RP({ layout: plPost, vertex: { module: mPost, entryPoint: 'vs' },
  fragment: { module: mPost, entryPoint: 'fs', targets: [{ format }], constants: { SRGB: format.endsWith('-srgb') ? 1 : 0 } } });
const fullPipe = (m, format) => RP({ layout: 'auto', vertex: { module: m, entryPoint: 'vs' }, fragment: { module: m, entryPoint: 'fs', targets: [{ format }] } });
// (all of them are started together and waited for once)
const [pMip8, pMip16, pDown0, pDown, pUp, pTerrain, pSolid, pLeaf, pLeaf5, pLeafS, pLeafF, pFish, pManta, pCrit, pSurf, pBack, pBub, pSnow, pGl,
  pSolidSh, pTerrSh, pLeafSh, pWater, pRB, pRays, pPost] = await Promise.all([...qBlit,
  scenePipe(mSolid, 'vs', 'fs', [vbSolid, ibSolid], { cull: 'back' }),
  scenePipe(mSolid, 'vs', 'fs', [vbSolid, ibSolid]),
  scenePipe(mLeaf, 'vs', 'fs', [ibLeaf], { strip: true, constants: { ROWS: 9 } }),
  scenePipe(mLeaf, 'vs', 'fs', [ibLeaf], { strip: true, constants: { ROWS: 5 } }),
  scenePipe(mLeaf, 'vs', 'fs', [ibLeaf], { strip: true, constants: { ROWS: 3, FAR: 70, LODW: 0 } }),
  scenePipe(mLeaf, 'vs', 'fs', [ibLeaf], { strip: true, constants: { ROWS: 3 } }),
  scenePipe(mAnim, 'vsFish', 'fsFish', [vbSolid, ibAnim]),
  scenePipe(mAnim, 'vsManta', 'fsManta', [vbSolid, ibAnim]),
  scenePipe(mod(W_CRIT), 'vs', 'fs', [vbSolid, ibAnim]),
  scenePipe(mSurf, 'vs', 'fs', [], { strip: true }), scenePipe(mSurf, 'vsB', 'fsB', [], { strip: true }),
  scenePipe(mSpr, 'vsBub', 'fsBub', [ibBub], { strip: true, blend: { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } } }),
  scenePipe(mSpr, 'vsSnow', 'fsSnow', [ibSnow], { strip: true, blend: ADD }),
  // (no constants here: vsGl uses none of the module's overrides, and Safari fails to build a vertex stage that is given
  // one it does not use - "Vertex library failed creation" - which leaves every frame black)
  scenePipe(mLeaf, 'vsGl', 'fsGl', [ibBub], { strip: true, blend: ADD }),
  shadowPipe(mSolid, 'vs', [vbSolid, ibSolid]), shadowPipe(mSolid, 'vs', [vbSolid, ibSolid], { cull: 'front' }),
  shadowPipe(mLeaf, 'vs', [ibLeaf], { strip: true, constants: { ROWS: 3 } }),
  fullPipe(mWater, HDR), fullPipe(mRB, HDR), fullPipe(mRays, HDR), postPipe(FMT)]);
const plPostBGL = pPost.getBindGroupLayout(0);

const bgWater = device.createBindGroup({ layout: pWater.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uboW } }] });
const waterViews = [0, 1, 2, 3, 4].map((m) => tWater.createView({ baseMipLevel: m, mipLevelCount: 1 }));
const waterBG = waterViews.map((v) => blitBG(v));
const waterPass = waterViews.map((v) => ({ colorAttachments: [colorAtt(v, true)] }));



// ---------------------------------------------------------------- sun
const SUN = (() => { const v = [0.27, 1, -0.24], l = hypot(...v); return v.map((c) => c / l); })();
for (let i = 0; i < 3; i++) { UB[48 + i] = UBS[48 + i] = SUN[i]; }
UBS[32] = 0; UBS[33] = -20; UBS[34] = 0; UBS[35] = 0; UBS[58] = 1; UBS[53] = 1; UB[UXR] = UB[UXR + 1] = 0.5;
// one instance that leaves a mesh where it is: the terrain is drawn with the solids' pipeline
const ibIdent = buf(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0]), BU.VERTEX);
