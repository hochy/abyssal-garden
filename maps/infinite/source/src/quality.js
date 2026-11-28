// ============================================================================
// quality level, chosen before anything is built
// ============================================================================
// LV: 0 High, 1 Medium, 2 Low. Medium and Low keep every 2nd / 4th leaf, glint and pebble and bake fewer shadows;
// of the leaves left and of the scattered rocks they keep 3 of 4 / every 2nd. Low also uses coarser meshes and cheaper filtering. A level sets
// every graphics setting: Low to its least, Medium to the middle, High to the most (see gdef).
// localStorage.abyssalInf = "level,pixels,detail". abyssalLoad is set while the world is built: still set on the next
// visit means that load crashed the tab, so this one runs a level lower.
const mob = matchMedia('(pointer:coarse)').matches, mem = navigator.deviceMemory;
const keep = (k, v) => { try { localStorage[k] = v; } catch {} };
let SV = [], LV, bad;
try { SV = (localStorage.abyssalInf || '').split(','); bad = localStorage.abyssalInfLoad; } catch {}
LV = SV[0] ? +SV[0] : mob || mem <= 4 ? 2 : 1; // a first visit: Medium on a computer, Low on every phone (its memory says nothing of its graphics chip)
if (bad && LV < 2) { SV = [++LV]; keep('abyssalInf', LV); }
// A first visit asks which level to build, before anything is compiled: three buttons on the loading screen (#z in
// template.html), Low lit for everyone. The answer is kept at once, so the question comes that one time and the
// menu's Detail row takes over. (Not asked where there is nothing to build, nor of dev.html#offscreen's automation.)
const z = document.getElementById('z'), zl = document.getElementById('l');
if (!SV[0] && navigator.gpu && !/offscreen/.test(location.hash)) {
  const bs = [...z.querySelectorAll('button')];
  bs[0].className = 'on'; zl.className = 'z'; bs[0].focus();
  LV = await new Promise((ok) => bs.forEach((b, i) => (b.onclick = () => ok(2 - i))));
  keep('abyssalInf', LV);
}
zl.className = ''; // (fit.js, the early script, puts the question up before this script is read)
// water: 0 lagoon (the original's green-blue haze), 1 clear, 2 crystal (blue and far-seeing, like an aquarium; the default);
// localStorage.abyssalInfWater. sig: scattering, kd: absorption on the way down, col: the water's colour, amb: skylight
let WQ = 2; try { const v = localStorage.abyssalInfWater; if (v != null && v !== '') WQ = Math.min(2, Math.max(0, +v | 0)); } catch {}
const WATERQ = [
  { sig: '.058, .0235, .0195', kd: '.056, .0245, .0170', col: '.16, .58, .90', amb: '.22, .60, .80', zs: 1 },
  { sig: '.041, .0168, .0135', kd: '.056, .0215, .0150', col: '.12, .52, .98', amb: '.18, .55, .90', zs: 0.72 },
  { sig: '.019, .0079, .0062', kd: '.056, .0180, .0125', col: '.08, .44, 1.08', amb: '.14, .48, 1.0', zs: 0.36 },
][WQ];
// graphics settings: each one follows the detail level until it is set by hand in the menu's graphics panel.
// localStorage.abyssalInfGfx = "distance,resolution,plants,shadows,smoothing,rays,animal shadows,surface,frame rate", an option's number or empty.
//   distance   0 near (80 m), 1 medium (105 m), 2 far (135 m): where the water's haze closes over everything
//   resolution 0 auto (tuned for 60 fps), 1 50%, 2 75%, 3 100% of the window's pixels
//   plants     0 sparse (every 4th leaf, glint and pebble), 1 medium (every 2nd), 2 dense; of these Medium keeps 3 of 4 leaves and Low every 2nd (gen.js)
//   shadows    0 low (1024), 1 medium (2048), 2 high (4096, and rocks cast them too)
//   smoothing  0 off, 1 4x anti-aliasing
//   rays       0 off, 1 low (12 steps), 2 high (34 steps)
//   animal shadows  0 off, 1 few (the 8 creatures that matter most to the view), 2 all (24)
//   surface    0 flat (a level sheet with a moving water texture), 1 waves (a simulated sea, waves.js); flat on Low
//   frame rate 0 30 a second (Low), 1 60 (Medium), 2 as many as the screen shows (High); auto resolution aims for 30 with the first, else for 60
let GS = []; try { GS = (localStorage.abyssalInfGfx || '').split(','); } catch {}
if (bad) { GS = []; keep('abyssalInfGfx', ''); } // the last load crashed: back to the level's own settings
const gset = (i, n, d) => (GS[i] !== undefined && GS[i] !== '' && +GS[i] >= 0 && +GS[i] < n ? +GS[i] : d);
const gdef = (lv) => [2 - lv, 0, 2 - lv, 2 - lv, lv ? 0 : 1, 2 - lv, 2 - lv, lv > 1 ? 0 : 1, 2 - lv]; // what a detail level picks: Low the least of everything, Medium the middle (waves, no smoothing), High the most
const GFX = gdef(LV).map((d, i) => gset(i, [3, 4, 3, 3, 2, 3, 3, 2, 3][i], d));
const VIEWD = [80, 105, 135][GFX[0]], RESQ = [0, 0.5, 0.75, 1][GFX[1]];
const THIN = 4 >> GFX[2], SHADOW = 1024 << GFX[3], AA = GFX[4] ? 4 : 1, WATER = LV > 1 ? 256 : 512, RAYN = [2, 12, 34][GFX[5]], CSN = [0, 8, 24][GFX[6]];
// the simulated waves (waves.js): WC cascades of WN x WN samples (WN = 2 ^ WLOG), patches of WL metres, a sea that
// repeats after WLOOP seconds and runs at WSPD of its real speed (calmer light on the ground)
const WN = 128, WLOG = 7, WC = 3, WL = [89, 17.3, 3.7], WLOOP = 600, WSPD = 0.6;
// World settings (the menu's World panel, with the water above): localStorage.abyssalInfWorld = "creatures,time,colours".
//   creatures 0 few (half as many), 1 medium, 2 many (twice as many); with few of them to eat, health drains half as fast
//   time      0 morning, 1 noon, 2 evening, 3 night: what the sun's light (sun), the water's own (sky) and the sky seen
//             through the surface (win) are multiplied by (nat: see LITK in shaders.js). With Surface: Waves the sky
//             in that window is drawn for the hour (W_SKY in shaders.js): zen and hor are its colour overhead and at
//             the horizon, cl the colour of a sunlit cloud, cov how much of it the clouds cover. The sun stays where it is: under water its light comes
//             down steeply at any hour, and the baked shadows and skylight stay true.
//   colours   0 vivid (magenta carpets, turquoise and violet leaves), 1 natural (the greens, browns and reds of a sea,
//             sand on level ground, thin algae, and warmer light on rock and sand)
//   floating rocks  0 off, 1 on: the clusters of boulders that hang in the water (gen.js)
let WS = []; try { WS = (localStorage.abyssalInfWorld || '').split(','); } catch {}
const WORLD = [3, 4, 2, 2].map((n, i) => (WS[i] !== undefined && WS[i] !== '' && +WS[i] >= 0 && +WS[i] < n ? +WS[i] | 0 : i < 3 ? 1 : 0));
const POPK = [0.5, 1, 2][WORLD[0]], NAT = WORLD[2], FLOAT = WORLD[3];
const DAYQ = [
  { sun: '.98, .80, .58', sky: '.70, .80, .88', win: '.95, .86, .78', nat: '1.65, .70, .46', zen: '.20, .50, .98', hor: '1.05, .84, .68', cl: '1.25, 1.05, .9', cov: 0.34 },
  { sun: '1., 1., 1.', sky: '1., 1., 1.', win: '1., 1., 1.', nat: '1.7, .64, .36', zen: '.2, .75, 1.3', hor: '.6, 1.07, 1.3', cl: '1.35, 1.35, 1.3', cov: 0.3 },
  { sun: '.95, .50, .28', sky: '.52, .48, .62', win: '.90, .50, .40', nat: '1.6, .84, .66', zen: '.17, .25, .6', hor: '1.2, .55, .27', cl: '1.3, .62, .42', cov: 0.38 },
  { sun: '.11, .16, .27', sky: '.13, .18, .30', win: '.05, .08, .17', nat: '1.6, .84, .66', zen: '.008, .03, .12', hor: '.03, .07, .2', cl: '.06, .09, .2', cov: 0.28 },
][WORLD[1]];
// What is shown over the scene (the last row of the World panel): localStorage.abyssalInfHud, 0 off or 1 on. It is the sonar
// and, at the bottom left, the creature's name, its bars and the messages. It takes effect at once.
let HUD = 1; try { if (localStorage.abyssalInfHud === '0') HUD = 0; } catch {}
// Sound settings (the menu's sound panel): localStorage.abyssalInfSnd = "volume,water,music,sea life,gurgling", each
// 0 off, 1 low, 2 medium, 3 high. Water: rumble, surface wash, rush. Music: the drone and the chimes. Sea life: the
// stock bubbles and the distant whale calls. Gurgling: the players' creatures. They take effect at once.
const SNDLV = [0, 0.45, 1, 1.8], SND = [1, 1, 2, 2, 3]; let SNDG = null; // until set: a low volume, quiet water, loud gurgling
try { (localStorage.abyssalInfSnd || '').split(',').forEach((v, i) => { if (i < 5 && v !== '' && +v >= 0 && +v <= 3) SND[i] = +v; }); } catch {}
