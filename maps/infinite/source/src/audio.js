// ============================================================================
// audio: procedural underwater ambience (no sample files)
// ============================================================================
// A fixed Web Audio graph, built on the first click / key / touch and driven by a 10 Hz timer, not the frame loop.
// Layers: rumble, surface wash, water rush (follows camera speed), drone, bubbles, chimes and distant whale calls;
// and the gurgling of the players' creatures.
let AC, OUT, muted = false;
const VOL = 0.78; // master level: about -18.5 LUFS, peaks near -5.5 dBFS
// (the levels of the sound panel, SND, are read in quality.js: the menu needs them before this file has run)
function sndApply() {
  keep('abyssalInfSnd', SND.join());
  if (!AC) return;
  const t = AC.currentTime;
  OUT.gain.setTargetAtTime(muted ? 0 : VOL * SNDLV[SND[0]], t, 0.08);
  SNDG.forEach((g, i) => { g.dry.gain.setTargetAtTime(SNDLV[SND[i + 1]], t, 0.08); g.wet.gain.setTargetAtTime(SNDLV[SND[i + 1]], t, 0.08); });
}
function mkSound(ac) {
  const sr = ac.sampleRate;
  // node of class C with options o, connected to every node / param in `to`; sources start at once
  const N = (C, o, ...to) => { const n = new C(ac, o); for (const d of to) n.connect(d); if (n.start) n.start(); return n; };
  const G = (gain, ...to) => N(GainNode, { gain }, ...to);
  const BQ = (type, frequency, Q, ...to) => N(BiquadFilterNode, { type, frequency, Q }, ...to);
  const lfo = (frequency, depth, to) => N(OscillatorNode, { frequency }, G(depth, to));
  const noise = (secs, f) => { const n = sr * secs | 0, b = new AudioBuffer({ length: n, numberOfChannels: 2, sampleRate: sr }); f(b.getChannelData(0), n); f(b.getChannelData(1), n); return b; };
  // seamless brown noise loop (the end cross-fades into the start)
  const nb = noise(11, (d, n) => { for (let i = 0, b = 0; i < n + 4096; i++) { b = (b + 0.02 * (rnd() * 2 - 1)) / 1.02; if (i < n) d[i] = b * 3.5; else { const k = (i - n) / 4096; d[i - n] = d[i - n] * k + b * 3.5 * (1 - k); } } });
  // reverb impulse: 5 s of noise that fades out and gets darker
  const ir = noise(5, (d, n) => { for (let i = 0, b = 0; i < n; i++) { const t = i / sr; b += (rnd() * 2 - 1 - b) * (0.04 + 0.5 * exp(-t * 2)); d[i] = b * (1 - exp(-t * 30)) * exp(-t * 1.5) * (1 - i / n); } });

  const lim = N(DynamicsCompressorNode, { threshold: -6, knee: 6, ratio: 20, attack: 0.003, release: 0.3 }, ac.destination);
  const out = OUT = G(0, lim), wet = N(ConvolverNode, { buffer: ir }, out);
  // the four groups the sound panel sets the level of: each a dry bus and a bus into the reverb
  const grp = (i) => ({ dry: G(SNDLV[SND[i]], out), wet: G(SNDLV[SND[i]], wet) });
  const gWater = grp(1), gMusic = grp(2), gLife = grp(3), gGur = grp(4); SNDG = [gWater, gMusic, gLife, gGur];
  const src = (playbackRate, ...to) => N(AudioBufferSourceNode, { buffer: nb, loop: true, playbackRate }, ...to);
  // rumble
  const rum = G(0.34, gWater.dry); src(1, BQ('lowpass', 150, 0.7, rum)); lfo(0.07, 0.11, rum.gain); lfo(0.113, 0.08, rum.gain);
  // surface wash + water rush: the same noise played at another speed, so the loops never line up
  const wash = G(0.25, gWater.dry), wave = G(1, wash), rush = G(0, gWater.dry), rushF = BQ('bandpass', 300, 0.9, rush);
  src(0.63, BQ('bandpass', 420, 0.5, wave), rushF); lfo(0.09, 0.3, wave.gain); lfo(0.151, 0.25, wave.gain);
  // drone: stacked fifths on D, each note a pair of slightly detuned sines that slowly beat
  const pad = G(1, gMusic.dry, G(1.5, gMusic.wet));
  [73.42, 110, 164.81, 246.94, 369.99].forEach((f, i) => { const g = G(0.022 - i * 0.003, pad); N(OscillatorNode, { frequency: f }, g); N(OscillatorNode, { frequency: f + rr(0.03, 0.11) }, g); });
  // pooled voices: oscillator -> envelope -> pan -> dry + reverb
  // (lp: the oscillator goes through a low-pass of its own, v.f - a soft buzz with overtones, for the deep voices)
  const pool = (n, send, type, to, lp) => Array.from({ length: n }, () => { const p = N(StereoPannerNode, {}, to.dry, G(send, to.wet)), g = G(0, p), f = lp ? BQ('lowpass', 800, 0.8, g) : null; return { p, g, f, o: N(OscillatorNode, { type }, f || g) }; });
  const bub = pool(4, 0.12, undefined, gLife), chime = pool(3, 1.2, undefined, gMusic), whale = pool(2, 2, 'triangle', gLife);
  // Gurgling (bots.js): the voices of the players' creatures. A gurgle is heard a ship's length away (GURFAR metres),
  // fainter with distance, and from the side it comes from. Every species is as loud to the ear as the others: a
  // note's level is set against how well its pitch is heard (the A-weighting curve), so the shark's rumble and the
  // fry's squeak come out alike.
  const gurS = pool(10, 0.18, undefined, gGur), gurW = pool(6, 0.35, 'sawtooth', gGur, true), gurQ = pool(4, 0.1, 'square', gGur), gurC = pool(3, 0.5, 'square', gGur), gurL = pool(4, 1.3, 'sawtooth', gGur, true), GURFAR = 34, GURVOL = 0.3;
  const aw = (f) => { const f2 = f * f; return 1.2589 * 148693636 * f2 * f2 / ((f2 + 424.36) * sqrt((f2 + 11599.3) * (f2 + 544496.4)) * (f2 + 148693636)); };
  const loud = (f) => clamp(1 / aw(f), 0.7, 3.5);
  // a voice from a pool, cleared of what it was still to play, panned
  const voice = (vs, t, pan) => { const v = vs.shift(); vs.push(v); v.o.frequency.cancelScheduledValues(t); v.g.gain.cancelScheduledValues(t); if (v.f) v.f.frequency.cancelScheduledValues(t); v.p.pan.setValueAtTime(pan, t); return v; };
  // a note with a pitch that follows the points in `fs` (evenly spaced over dur) and swells in and out
  const sing = (v, t, fs, dur, vol, att, rel) => {
    const f = v.o.frequency, g = v.g.gain;
    f.setValueAtTime(fs[0], t); for (let i = 1; i < fs.length; i++) f.linearRampToValueAtTime(fs[i], t + dur * i / (fs.length - 1));
    if (v.f) { v.f.frequency.setValueAtTime(min(fs[0] * 5, 3000), t); }
    g.setValueAtTime(0, t); g.linearRampToValueAtTime(vol, t + att); g.setValueAtTime(vol, t + dur - rel); g.linearRampToValueAtTime(0, t + dur);
  };
  // the plain gurglers: [pool, lowest and highest pitch of a note, how far it glides (from, to: times the pitch), its
  // length, notes a second]. The dolphin and the whale have voices of their own below.
  const GUR = [[gurQ, 650, 1100, 0.6, 0.9, 0.028, 15], [gurS, 1500, 2400, 1.5, 2.2, 0.04, 11], [gurS, 1050, 1700, 1.4, 2.0, 0.05, 9], [gurS, 600, 950, 1.3, 1.9, 0.08, 7],
    [gurS, 480, 800, 0.55, 0.8, 0.1, 6], [gurW, 130, 220, 1.2, 1.7, 0.17, 4], [gurS, 360, 560, 1.5, 2.3, 0.07, 8], null, [gurW, 85, 140, 0.65, 0.9, 0.24, 3], null];
  // the dolphin, as dolphins sound: whistles that climb and fall between 4 and 11 kHz, and trains of clicks that
  // quicken into a creak. Returns how long until its next sound.
  const dolphin = (t, pan, k) => {
    if (rnd() < 0.6) {
      const v = voice(gurS, t, pan), a = rr(4200, 7500), b = a * rr(1.25, 1.7), d = rr(0.25, 0.6), up = rnd() < 0.7;
      sing(v, t, up ? [a, b * 0.92, b, b * 0.85] : [b, a * 1.1, a, a * 1.2], d, GURVOL * 0.55 * k, 0.03, 0.06);
      return d + rr(0.05, 0.3);
    }
    const v = voice(gurC, t, pan), g = v.g.gain; let tt = t, gap = rr(0.035, 0.055);
    v.o.frequency.setValueAtTime(rr(2600, 3800), t); g.setValueAtTime(0, t);
    for (let n = 14 + rnd() * 22 | 0; n--;) { g.setValueAtTime(GURVOL * 0.42 * k, tt); g.setValueAtTime(0, tt + 0.0022); tt += gap; gap = max(0.006, gap * 0.88); }
    return tt - t + rr(0.1, 0.35);
  };
  // the humpback's song: long moans that slide and waver, rising cries, and strings of low grunts
  const humpback = (t, pan, k) => {
    const r = rnd();
    if (r < 0.5) { // a moan
      const v = voice(gurL, t, pan), a = rr(110, 260), b = a * rr(0.6, 1.6), d = rr(0.9, 1.9), fs = [];
      for (let i = 0; i <= 24; i++) { const u = i / 24; fs.push(mix(a, b, u * u * (3 - 2 * u)) * (1 + 0.035 * sin(u * d * 34))); }
      sing(v, t, fs, d, GURVOL * 0.5 * loud((a + b) * 1.5) * k, d * 0.25, d * 0.35);
      return d * rr(0.8, 1.1);
    }
    if (r < 0.8) { // a cry
      const v = voice(gurS, t, pan), a = rr(380, 800), d = rr(0.4, 0.85);
      sing(v, t, [a, a * 1.1, a * rr(1.5, 2.4), a * rr(1.3, 2.2)], d, GURVOL * 0.8 * loud(a * 1.5) * k, d * 0.3, d * 0.3);
      return d + rr(0.1, 0.4);
    }
    let tt = t; // grunts
    for (let n = 2 + rnd() * 4 | 0; n--;) { const v = voice(gurW, tt, pan), a = rr(60, 95); sing(v, tt, [a, a * 0.8], 0.16, GURVOL * 0.5 * loud(a * 3) * k, 0.02, 0.08); tt += rr(0.2, 0.3); }
    return tt - t + rr(0.2, 0.5);
  };
  // The sound of each species' bite (the crab's: of its claws; the whale's: of its gulp), as chosen by ear from a page
  // of variants. Each is a short list of events made of two bricks: bn, noise through a band-pass whose centre
  // glides, and bt, a tone - which may growl (fm: [ratio, depth in Hz]) and flutter (trem: Hz). k is the pitch of the
  // species (small animals high), d how long its sounds are.
  const white = noise(1, (d, n) => { for (let i = 0; i < n; i++) d[i] = rnd() * 2 - 1; });
  const bn = (at, dur, f0, f1, q, vol) => ({ n: 1, at, dur, f0, f1, q, vol }), bt = (at, dur, wave, f0, f1, vol, x) => Object.assign({ at, dur, wave, f0, f1, vol }, x);
  // (att: a brick that swells in instead of striking; mid: a pitch a tone passes halfway)
  const rise = (k, d) => [bt(0, 0.16 * d, 'sine', 240 * k, 820 * k, 0.6, { att: 0.03 }), bt(0.15 * d, 0.05, 'sine', 820 * k, 1300 * k, 0.3, { att: 0.012 })]; // a bubble comes up
  const BITE = [
    [1.7, (k) => [0, 1, 2, 3, 4, 5].map((i) => bn(i * 0.014, 0.008, 3200 * k, 2600 * k, 4, 0.75))], // crab: the dry crackle of its claws
    [3.2, rise], [2.5, rise], [1.5, rise], [1.25, rise], [0.62, rise], [1.0, rise], // fry, chromis, perch, barracuda, grouper, tuna: a bubble comes up, each at its own pitch
    [1.3, () => [bn(0, 0.02, 3300, 2400, 1.5, 0.9), bt(0.03, 0.14, 'sine', 5200, 8200, 0.3)]], // dolphin: a click and a whistle
    [0.5, (k, d) => [bt(0, 0.3 * d, 'sawtooth', 85 * k, 70 * k, 0.6, { att: 0.07, fm: [0.5, 18 * k], trem: 22 }), bt(0.28 * d, 0.18 * d, 'sine', 185 * k, 240 * k, 0.6, { att: 0.03, mid: 115 * k })]], // shark: a purr and a gulp
    [0.34, (k, d) => [Object.assign(bn(0, 0.22 * d, 700 * k, 450 * k, 0.7, 0.5), { att: 0.09 * d }), bt(0.2 * d, 0.18 * d, 'sine', 180 * k, 235 * k, 0.7, { att: 0.03, mid: 110 * k })]]]; // whale: a breath and a gulp
  let biteEnd = 0; // (a long one is not begun again over itself)
  const bite = (sp, t0) => {
    if (t0 < biteEnd) return;
    const k = BITE[sp][0], ev = BITE[sp][1](k, 1 / sqrt(k)); let len = 0;
    for (const e of ev) {
      const at = t0 + e.at, end = at + e.dur * 3 + 0.05, g = G(0, gGur.dry, G(0.15, gGur.wet)), V = e.vol * GURVOL * 2; len = max(len, e.at + e.dur);
      g.gain.setValueAtTime(0, at);
      const att = e.att !== undefined ? e.att : min(0.004, e.dur * 0.3);
      if (e.dur > 0.3) { g.gain.linearRampToValueAtTime(V, at + max(0.04, att)); g.gain.setValueAtTime(V, at + e.dur * 0.75); g.gain.linearRampToValueAtTime(0, at + e.dur); }
      else { g.gain.linearRampToValueAtTime(V, at + att); g.gain.setTargetAtTime(0, at + max(att, e.dur * 0.4), e.dur / 3); }
      if (e.n) {
        const f = new BiquadFilterNode(ac, { type: 'bandpass', frequency: e.f0, Q: e.q }), src = new AudioBufferSourceNode(ac, { buffer: white, loop: true });
        f.frequency.setValueAtTime(e.f0, at); f.frequency.exponentialRampToValueAtTime(max(e.f1, 20), at + e.dur); src.connect(f); f.connect(g); src.start(at, rnd() * 0.5); src.stop(end);
      } else {
        const o = new OscillatorNode(ac, { type: e.wave, frequency: e.f0 }); o.frequency.setValueAtTime(e.f0, at); if (e.mid) o.frequency.exponentialRampToValueAtTime(e.mid, at + e.dur * 0.5); o.frequency.exponentialRampToValueAtTime(max(e.f1, 20), at + e.dur);
        if (e.fm) { const m = new OscillatorNode(ac, { frequency: e.f0 * e.fm[0] }), mg = new GainNode(ac, { gain: e.fm[1] }); m.connect(mg); mg.connect(o.frequency); m.start(at); m.stop(end); }
        let last = o;
        if (e.wave !== 'sine') { last = new BiquadFilterNode(ac, { type: 'lowpass', frequency: min(e.f0 * 5, 5000), Q: 0.7 }); o.connect(last); }
        if (e.trem) { const tg = new GainNode(ac, { gain: 0.6 }), l = new OscillatorNode(ac, { frequency: e.trem }), lg = new GainNode(ac, { gain: 0.4 }); l.connect(lg); lg.connect(tg.gain); l.start(at); l.stop(end); last.connect(tg); last = tg; }
        last.connect(g); o.start(at); o.stop(end);
      }
    }
    if (len > 0.4) biteEnd = t0 + len;
  };
  const gurgle = (b, t) => {
    const q = GUR[b.s], ex = me ? me.x : F[CX], ey = me ? me.y : F[CY], ez = me ? me.z : F[CZ], dx = b.x - ex, dy = b.y - ey, dz = b.z - ez, d = hypot(dx, dy, dz);
    if (!(b.gt > t - 0.3)) b.gt = t; // (just begun, or back after a pause)
    // (a bot that answers is some way off and would be lost under the player's own voice: it is heard 1.6 times louder)
    const near = max(0, 1 - d / (GURFAR * gurFar(b.s))), k = near * near * (b.me || b.net ? 1 : 1.6), pan = clamp((dx * cos(F[YAW]) + dz * sin(F[YAW])) / max(d, 0.001) * min(1, d / 4), -0.9, 0.9);
    while (b.gt < t + 0.1) {
      if (!k) { b.gt += 0.2; continue; }
      if (b.s === DOLPHIN) { b.gt += dolphin(b.gt, pan, k); continue; }
      if (b.s === WHALE) { b.gt += humpback(b.gt, pan, k); continue; }
      const v = voice(q[0], b.gt, pan), f0 = rr(q[1], q[2]), dur = q[5] * rr(0.8, 1.3), f = v.o.frequency, g = v.g.gain;
      // (the buzzing voices are heard by their overtones, the square one is harsh as it is)
      const vol = GURVOL * loud(q[0] === gurW ? f0 * 3 : f0) * (q[0] === gurQ ? 0.45 : q[0] === gurW ? 0.6 : 1) * k * rr(0.7, 1);
      f.setValueAtTime(f0, b.gt); f.exponentialRampToValueAtTime(f0 * rr(q[3], q[4]), b.gt + dur);
      if (v.f) v.f.frequency.setValueAtTime(f0 * 5, b.gt);
      g.setValueAtTime(0, b.gt); g.linearRampToValueAtTime(vol, b.gt + min(0.008, dur * 0.3)); g.setTargetAtTime(0, b.gt + dur * 0.35, dur / 4);
      b.gt += rr(0.6, 1.4) / q[6];
    }
  };
  // one note: pitch glides f0 -> f1 over dur, level rises to vol in att then dies away
  const play = (vs, t, f0, f1, dur, vol, att) => {
    const v = vs.shift(), f = v.o.frequency, g = v.g.gain; vs.push(v);
    v.p.pan.setValueAtTime(rr(-0.7, 0.7), t);
    f.setValueAtTime(f0, t); f.exponentialRampToValueAtTime(f1, t + dur);
    g.setValueAtTime(0, t); g.linearRampToValueAtTime(vol, t + att); g.setTargetAtTime(0, t + att, (dur - att) / 5);
  };
  const NOTES = [0, 2, 5, 7, 9, 12, 14, 17, 19]; // D major pentatonic, in semitones above A4
  let lt = ac.currentTime, tB = lt + 1.5, tC = lt + 5, tW = lt + 12, lx = F[CX], ly = F[CY], lz = F[CZ];
  out.gain.setTargetAtTime(VOL * SNDLV[SND[0]], lt, 1);
  return () => {
    const now = ac.currentTime, t = now + 0.05, dt = now - lt;
    if (dt <= 0) return;
    let v = hypot(F[CX] - lx, F[CY] - ly, F[CZ] - lz) / dt; if (v > 60) v = 0; // ignore jumps to a viewpoint
    lt = now; lx = F[CX]; ly = F[CY]; lz = F[CZ];
    rush.gain.setTargetAtTime(0.5 * pow(min(v / 26, 1), 1.2), t, 0.3); rushF.frequency.setTargetAtTime(220 + v * 14, t, 0.3);
    const s = clamp(1 + ly / 30, 0, 1); wash.gain.setTargetAtTime(0.25 + 0.55 * s * s, t, 0.5);
    for (const b of bots) if (b.gur) gurgle(b, t);
    while (sfx.length) { // what the creature in play has just done or suffered (bots.js: survival)
      const [k, sp] = sfx.shift();
      if (k === 'bite') bite(sp, t);
      if (k === 'eat') for (let i = 0; i < 3; i++) sing(voice(gurS, t + 0.12 + i * 0.07, 0), t + 0.12 + i * 0.07, [500 + i * 150, 900 + i * 220], 0.06, GURVOL * 0.7, 0.008, 0.03);
      if (k === 'nibble') sing(voice(gurS, t, 0), t, [900, 1400], 0.05, GURVOL * 0.5, 0.006, 0.03);
      if (k === 'hurt') sing(voice(gurW, t, 0), t, [190, 120, 85], 0.32, GURVOL * 2, 0.01, 0.2);
    }
    if (t > tB) { // a burst of 1-6 bubbles: short rising blips, smaller bubbles higher and shorter
      let tt = t;
      for (let n = 1 + rnd() * rnd() * 6 | 0; n--;) { const f = rr(380, 1300); play(bub, tt, f, f * rr(1.4, 2.2), 0.05 + 40 / f, rr(0.03, 0.08), 0.006); tt += rr(0.07, 0.2); }
      tB = tt + rr(0.5, 5);
    }
    if (t > tC) { const f = 440 * pow(2, NOTES[rnd() * 9 | 0] / 12); play(chime, t, f, f, 5, rr(0.02, 0.04), 0.03); tC = t + rr(2.5, 9); }
    if (t > tW) { // a phrase of 2-3 slow glides
      let tt = t;
      for (let n = 2 + rnd() * 2 | 0; n--;) { const f = rr(170, 380), d = rr(1.6, 3.2); play(whale, tt, f, f * rr(0.6, 1.7), d, 0.08, d * 0.4); tt += d * 0.8; }
      tW = tt + rr(20, 50);
    }
  };
}
// called on every click / key / touch: builds the graph once and resumes it when the browser allows
function sound() {
  if (!AC) {
    // an iPhone takes Web Audio for "ambient" sound, which its ring/silent switch mutes: say that it is playback
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
    AC = new AudioContext({ latencyHint: 'playback' }); setInterval(mkSound(AC), 100);
    if (DBG) setInterval(() => { const s = 'audio: ' + AC.state + ', ' + AC.sampleRate + ' Hz, session ' + (navigator.audioSession ? navigator.audioSession.type : 'n/a'); if (s !== sound.s) dbg(sound.s = s); }, 1500);
  }
  // (iOS has a state of its own, "interrupted", and refuses a resume that does not come from a tap: the next one tries again)
  // After the screen was locked, or the page was away, an iPhone's context says "running" again and stays silent:
  // the first tap after that stops it and starts it anew.
  if (acBack && !document.hidden) { acBack = false; dbg('audio: restarted after the page was away'); sndLv(0, 0.005); AC.suspend().then(() => AC.resume()).then(() => sndLv(sndOn(), 0.3)).catch((e) => dbg('audio restart: ' + e.message)); }
  else if (AC.state !== 'running' && !document.hidden) AC.resume().catch((e) => dbg('audio resume: ' + e.message));
}
let acBack = false;
// the master level: where it should be, and a glide to a value with the time constant k (seconds)
const sndOn = () => (muted ? 0 : VOL * SNDLV[SND[0]]);
const sndLv = (v, k) => { if (OUT) { OUT.gain.cancelScheduledValues(AC.currentTime); OUT.gain.setTargetAtTime(v, AC.currentTime, k); } };
const mute = () => { muted = !muted; OUT.gain.setTargetAtTime(muted ? 0 : VOL * SNDLV[SND[0]], AC.currentTime, 0.08); };
// the page goes out of sight: the sound fades in a twentieth of a second before it stops (cut off at once it clicks),
// and comes back as gently
document.addEventListener('visibilitychange', () => {
  if (!AC) return;
  if (document.hidden) { sndLv(0, 0.012); setTimeout(() => { if (document.hidden) AC.suspend(); }, 70); }
  else { acBack = true; AC.resume().then(() => sndLv(sndOn(), 0.3)).catch(() => {}); }
});
