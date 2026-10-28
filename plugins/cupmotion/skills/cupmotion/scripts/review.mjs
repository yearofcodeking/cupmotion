// Review images of a rendered film, for the critique loop (open them with Read and look).
//   node review.mjs <projectDir> [--video out/final.mp4] [--strip 4.2] [--loop]
// -> out/review_contact.png  2 frames/s, 6 across: pacing, variety, dead beats
//    out/review_phone.png    1 frame/s at 360px wide: readability in the Telegram feed
//    out/review_strip.png    12 consecutive frames from --strip t: pops, overlaps, jitter
//    out/loop_check.mp4      played twice back to back: the seam (with --loop)
import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const argv = process.argv.slice(2), dir = resolve(argv[0] || '.');
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const out = join(dir, 'out');
let video = resolve(dir, opt('video', 'out/final.mp4'));
if (!existsSync(video)) video = join(out, 'silent.mp4');

const dur = +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video]).toString();
const run = (args) => new Promise((ok, fail) => spawn('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' })
  .on('close', (c) => (c ? fail(new Error('ffmpeg ' + c)) : ok())));

const rowsC = Math.ceil((dur * 2) / 6), rowsP = Math.ceil(dur / 5);
await run(['-i', video, '-vf', `fps=2,scale=320:-1,tile=6x${rowsC}:padding=4`, '-frames:v', '1', join(out, 'review_contact.png')]);
await run(['-i', video, '-vf', `fps=1,scale=360:-1,tile=5x${rowsP}:padding=4`, '-frames:v', '1', join(out, 'review_phone.png')]);
const made = ['review_contact.png', 'review_phone.png'];
if (opt('strip')) {
  await run(['-ss', String(Math.max(0, +opt('strip') - 0.1)), '-i', video, '-vf', 'scale=320:-1,tile=6x2:padding=4', '-frames:v', '1', join(out, 'review_strip.png')]);
  made.push('review_strip.png');
}
if (argv.includes('--loop')) {
  await run(['-stream_loop', '1', '-i', video, '-c', 'copy', join(out, 'loop_check.mp4')]);
  made.push('loop_check.mp4');
}
console.log(`review (${dur.toFixed(2)}s): out/${made.join(', out/')}`);
