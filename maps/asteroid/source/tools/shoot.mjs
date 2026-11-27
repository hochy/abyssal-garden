// usage: node shoot.mjs <url> <outdir> name=js name=js ...   (js runs in the page before the capture)
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const [url, out, ...shots] = process.argv.slice(2);
const prof = out + '/../chrome-prof';
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--user-data-dir=' + prof, '--remote-debugging-port=9223', '--enable-unsafe-webgpu', '--use-angle=metal', '--hide-scrollbars', '--mute-audio', '--window-size=' + (process.env.SIZE || '1100,700'), 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, id = 0; const pend = new Map();
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, [res, rej]); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400)); return r.result.value; };
try {
  let tabs;
  for (let i = 0; i < 40 && !tabs; i++) { await sleep(250); try { tabs = await (await fetch('http://127.0.0.1:9223/json')).json(); } catch {} }
  ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { const [res, rej] = pend.get(d.id); pend.delete(d.id); d.error ? rej(new Error(d.error.message)) : res(d.result); } else if (d.method === 'Runtime.consoleAPICalled') console.log('console:', d.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300)); else if (d.method === 'Runtime.exceptionThrown') console.log('exception:', JSON.stringify(d.params.exceptionDetails).slice(0, 300)); };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url });
  if (url.includes('index.html')) { for (let i = 0; i < 240; i++) { await sleep(500); const c = await ev('document.body.className'); if (c !== 'l') { console.log('index state:', c, await ev("document.getElementById('s').textContent")); break; } } await sleep(1500); const img = await send('Page.captureScreenshot', { format: 'jpeg', quality: 80 }); writeFileSync(out + '/menu.jpg', Buffer.from(img.data, 'base64')); chrome.kill(); process.exit(0); }
  for (let i = 0; i < 240; i++) { await sleep(500); const s = await ev("typeof __step === 'function' ? 'ok' : document.body.className + '|' + document.getElementById('s').textContent"); if (s === 'ok') break; if (s.startsWith('l e')) throw new Error(s); if (i === 239) throw new Error('timeout ' + s); }
  for (const s of shots) {
    const k = s.indexOf('='), name = s.slice(0, k), js = s.slice(k + 1);
    // a name starting with + runs the js and waits 3 s of real frames (menus, transitions) instead of stepping by hand
    if (name[0] === '+') { await ev(js + '; 0'); await sleep(3000); } else { await ev(js + '; __step(2); 0'); await sleep(300); }
    if (name.startsWith('_')) { console.log(name, JSON.stringify(await ev(js))); continue; }
    const img = await send('Page.captureScreenshot', { format: 'jpeg', quality: 80 });
    writeFileSync(out + '/' + name + '.jpg', Buffer.from(img.data, 'base64')); console.log('saved', name);
  }
} catch (e) { console.log('FAILED', e.message); }
chrome.kill(); process.exit(0);
