// Bundles src/*.js into the single self-contained ../index.html
//   npm run build            minified
//   npm run build:readable   unminified, for debugging
//   npm run build:dev        ../dev.html: unminified, plus the development tools in src/dev.js
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILES = ['quality.js', 'math.js', 'creatures.js', 'shaders.js', 'layout.js', 'meshes.js', 'gpu.js', 'waves.js', 'stream.js', 'bots.js', 'net.js', 'picker.js', 'main.js', 'xr.js', 'audio.js']; // concatenation order matters
const WORKER = ['math.js', 'layout.js', 'gen.js']; // the tile generator: runs in web workers, carried in the page as a string
const EARLY = ['fit.js']; // a small script of its own, run as soon as the menu is on the page: the menu's size
const dev = process.argv.includes('--dev'), readable = dev || process.argv.includes('--readable');
const out = dev ? 'dev.html' : 'index.html';
if (dev) FILES.push('dev.js');

const read = (list) => list.map((f) => readFileSync(path.join(here, 'src', f), 'utf8')).join('\n');
let js = read(FILES), worker = read(WORKER), early = read(EARLY);
const tpl = readFileSync(path.join(here, 'template.html'), 'utf8');
// everything runs inside one async function; startup errors are shown on screen
const wrap = (body) => `(async()=>{${body}\n})().catch(e=>{console.error(e);document.body.className='l e';document.getElementById('s').textContent=(e.cause?'':'Failed to start: ')+e.message});`;

let html;
if (readable) {
  html = tpl.replace('/*EARLY*/', () => early).replace('/*SCRIPT*/', () => wrap(`const WORKER_SRC = ${JSON.stringify(worker)};\n` + js));
} else {
  // shrink the WGSL inside /*wgsl*/ template literals, then minify the JS and the page's CSS
  const minWgsl = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\s+/g, ' ').replace(/ ?([{}()\[\];,:=+\-*\/<>&|!%@]) ?/g, '$1').trim();
  const min = (s) => transformSync(s, { minify: true, target: 'es2022', legalComments: 'none' }).code.trim();
  js = js.replace(/\/\*wgsl\*\/`([^`]*)`/g, (_, w) => '`' + minWgsl(w) + '`');
  worker = min(worker);
  const code = min(wrap(`const WORKER_SRC = ${JSON.stringify(worker)};\n` + js));
  const css = (_, s) => '<style>' + transformSync(s, { loader: 'css', minify: true }).code.trim();
  html = tpl.replace(/<style>([^]*?)(?=<\/style>)/, css).replace(/>\s+</g, '><').replace(/<script>\s+/g, '<script>').replace(/\s+<\/script>/g, '</script>').replace('/*EARLY*/', () => min(early)).replace('/*SCRIPT*/', () => code);
}
writeFileSync(path.join(here, '..', out), html);
// (this copy has no multiplayer server, so no copy of the build for one)
const gz = gzipSync(Buffer.from(html), { level: 9 }).length;
console.log(`${out}: ${(html.length / 1024).toFixed(1)} kB${readable ? ' (readable)' : ''}, ${(gz / 1024).toFixed(1)} kB gzipped`);
