// cupmotion: render a seek(t) film (index.html with window.seek, window.DUR) to video, or stills for review.
//
//   node render.mjs <projectDir> [--fps 60] [--sub 2] [--dur <from window.DUR>] [--w 1920] [--h 1080]
//                                [--from 0] [--to <dur>] [--out out/silent.mp4] [--jpeg] [--sel '#c']
//   node render.mjs <projectDir> --stills beats|every:0.5|1.6|1,2.5,4   -> out/stills/*.png + out/contact.png
//     beats = one frame per beat (beats.js or 120 BPM), every:S = one frame every S seconds, numbers = exact times
//     contact sheet: --thumb <px width per tile, 480> --cols <tiles per row, 6>
// --sel is the CSS selector of the stage element that is captured (default #c).
//
// --sub N renders N subframes per frame and blends them (motion blur). 1 = off, fastest.
// --jpeg captures JPEG q95 instead of PNG: ~2x faster, fine for drafts.
// Also writes out/cues.json from window.CUES (sound event times for the film's own audio script).
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

// playwright-core lives in ~/.cupmotion (installed once by doctor.mjs --install) or in the project folder.
function loadChromium() {
  for (const base of [join(homedir(), '.cupmotion', 'package.json'), join(process.cwd(), 'package.json')]) {
    for (const mod of ['playwright-core', 'playwright']) {
      try { return createRequire(base)(mod).chromium; } catch {}
    }
  }
  console.error('Нет playwright-core. Запусти один раз: node <папка скилла>/scripts/doctor.mjs --install'); process.exit(1);
}
const chromium = loadChromium();
const argv = process.argv.slice(2);
const dir = resolve(argv[0] || '.');
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const flag = (k) => argv.includes('--' + k);
const W = +opt('w', 1920), H = +opt('h', 1080);
const FPS = +opt('fps', 60), SUB = Math.max(1, +opt('sub', 2));
const out = join(dir, 'out');
mkdirSync(out, { recursive: true });

// The Playwright CDN is unreachable from here, so use the system browsers.
async function launch() {
  for (const channel of ['chrome', 'msedge', undefined]) {
    try { return await chromium.launch(channel ? { channel } : {}); } catch {}
  }
  throw new Error('No browser: install Chrome or Edge');
}

const run = (cmd, args, opts = {}) => new Promise((ok, fail) => {
  const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'inherit'], ...opts });
  p.on('close', (c) => (c ? fail(new Error(`${cmd} exited ${c}`)) : ok()));
});

const browser = await launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error('PAGE ERROR:', e.message));
await page.goto(pathToFileURL(join(dir, 'index.html')).href + `?w=${W}&h=${H}`);
await page.evaluate(() => document.fonts.ready);
await page.evaluate(() => window.READY);              // optional promise: custom fonts, images (see template)
const DUR = +opt('dur', await page.evaluate(() => window.DUR || 10));
const cues = await page.evaluate(() => window.CUES || []);
writeFileSync(join(out, 'cues.json'), JSON.stringify(cues, null, 1));

const type = flag('jpeg') ? 'jpeg' : 'png';
const SEL = opt('sel', '#c');                          // the stage element that is captured
const grab = () => page.locator(SEL).screenshot(type === 'jpeg' ? { type, quality: 95 } : { type });

const stills = opt('stills');
if (stills) {
  let times;
  if (stills === 'beats') { const step = 60 / +opt('bpm', 120); times = []; for (let t = 0; t < DUR; t += step) times.push(+t.toFixed(3)); }
  else if (stills.startsWith('every:')) { const step = +stills.slice(6); times = []; for (let t = 0; t < DUR; t += step) times.push(+t.toFixed(3)); }
  else times = stills.split(',').map(Number);
  const sdir = join(out, 'stills');
  if (existsSync(sdir)) rmSync(sdir, { recursive: true });
  mkdirSync(sdir);
  for (const [i, t] of times.entries()) {
    await page.evaluate((t) => window.seek(t), t);
    writeFileSync(join(sdir, String(i).padStart(3, '0') + '.png'), await page.locator(SEL).screenshot({ type: 'png' }));
  }
  const cols = Math.min(+opt('cols', 6), times.length), rows = Math.ceil(times.length / cols), thumb = +opt('thumb', 480);
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', join(sdir, '%03d.png'),
    '-vf', `scale=${thumb}:-1,tile=${cols}x${rows}:padding=4`,
    '-frames:v', '1', join(out, 'contact.png')]);
  console.log(`stills: ${times.length} frames at [${times.join(', ')}] -> out/contact.png`);
  await browser.close();
  process.exit(0);
}

const from = +opt('from', 0), to = +opt('to', DUR);
const file = resolve(dir, opt('out', `out/silent${W === 1920 && H === 1080 ? '' : `_${W}x${H}`}.mp4`));
// tmix averages SUB consecutive subframes; select keeps one frame per group.
const vf = SUB > 1 ? ['-vf', `tmix=frames=${SUB},select='eq(mod(n\\,${SUB})\\,${SUB - 1})',setpts=N/${FPS}/TB`] : [];
const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS * SUB), '-i', '-',
  ...vf, '-r', String(FPS), '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p',
  '-movflags', '+faststart', file], { stdio: ['pipe', 'inherit', 'inherit'] });

const total = Math.round((to - from) * FPS * SUB), t0 = Date.now();
for (let i = 0; i < total; i++) {
  await page.evaluate((t) => window.seek(t), from + i / (FPS * SUB));
  if (!ff.stdin.write(await grab())) await new Promise((r) => ff.stdin.once('drain', r));
  if (i % (FPS * SUB) === 0) process.stdout.write(`\r${(i / (FPS * SUB)).toFixed(0)}s / ${(to - from).toFixed(1)}s`);
}
ff.stdin.end();
await new Promise((r) => ff.on('close', r));
await browser.close();
console.log(`\rdone: ${file} (${((Date.now() - t0) / 1000).toFixed(1)}s render time)`);
