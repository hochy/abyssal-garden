// ============================================================================
// the menu's size: an early script, run as soon as the menu is on the page (before the game's own script)
// ============================================================================
// The menu is laid out in rem, and the page's rem is fitted to the screen: a unit (a tenth of a rem) is 1 px on a
// 844x390 phone, more on a bigger screen (up to 1.6 px), never under 1 px on a touch screen (an option stays 44 px
// high) nor under 0.8 px elsewhere. The page is the screen turned on its side where a phone is held upright. In the
// menu the title is as wide as the column under it. What does not fit under the tabs scrolls (#sc) under a rail of
// its own (#rl): its thumb can be dragged, the rail tapped.
function fitMenu() {
  const $ = (id) => document.getElementById(id), b = document.body, h1 = $('m').firstElementChild;
  const u = Math.min(Math.max(Math.min(b.clientWidth / 844, b.clientHeight / 390), matchMedia('(pointer:coarse)').matches ? 1 : 0.8), 1.6);
  document.documentElement.style.fontSize = 10 * u + 'px';
  h1.style.fontSize = '';
  const w = $('dr').offsetWidth; if (w && !b.classList.contains('l')) h1.style.fontSize = parseFloat(getComputedStyle(h1).fontSize) * w / h1.scrollWidth + 'px';
  menuRail();
}
// the rail: shown only when what is open is longer than the area; the area's edges fade where there is more
function menuRail() {
  const $ = (id) => document.getElementById(id), a = $('a'), s = $('sc'), r = $('rl'), t = $('rt'), ch = s.clientHeight, sh = s.scrollHeight, y = s.scrollTop, can = sh > ch + 1;
  r.hidden = !can; a.classList.toggle('t', can && y > 2); a.classList.toggle('b', can && y < sh - ch - 2);
  if (can) { const rh = r.clientHeight, th = Math.max(rh * ch / sh, rh * 0.18); t.style.height = th + 'px'; t.style.top = (rh - th) * y / (sh - ch) + 'px'; }
}
{
  const $ = (id) => document.getElementById(id), s = $('sc'), r = $('rl'), t = $('rt'), ro = new ResizeObserver(() => menuRail());
  s.addEventListener('scroll', menuRail, { passive: true });
  [s, ...s.children].forEach((e) => ro.observe(e));
  // dragging the thumb, or a press on the rail, scrolls there (where the page is turned on its side, the rail's top is
  // at the screen's right)
  r.addEventListener('pointerdown', (e) => {
    const turn = matchMedia('(orientation:portrait) and (pointer:coarse)').matches, at = (ev, q) => (turn ? q.right - ev.clientX : ev.clientY - q.top);
    const rb = r.getBoundingClientRect(), tb = t.getBoundingClientRect(), th = turn ? tb.width : tb.height, size = (turn ? rb.width : rb.height) - th;
    const grab = e.target === t ? at(e, tb) : th / 2, go = (ev) => { s.scrollTop = Math.min(Math.max((at(ev, rb) - grab) / size, 0), 1) * (s.scrollHeight - s.clientHeight); };
    go(e); r.setPointerCapture(e.pointerId); r.onpointermove = go; r.onpointerup = r.onpointercancel = () => { r.onpointermove = null; };
  });
}
// a first visit's question is up from the first paint (quality.js asks it once the game's script runs)
try { localStorage.abyssalInf || !navigator.gpu || /offscreen/.test(location.hash) || (document.getElementById('l').className = 'z'); } catch {}
// refitted whenever the page's size changes (Safari on an iPhone gives the page its new size after the resize event
// of a turn of the screen)
fitMenu(); new ResizeObserver(() => fitMenu()).observe(document.body);
