// Mux picture + music + SFX into the final file, loudness-normalized for social (-14 LUFS).
//   node mix.mjs <projectDir> [--video out/silent.mp4] [--music audio/music.wav] [--music-gain 0.8] [--out out/final.mp4]
// Music defaults to the first file found in audio/. SFX = out/sfx.wav if present (rendered by the film's own audio script).
// Two-pass loudnorm: pass 1 measures, pass 2 applies linearly (single pass misses by 1-2 dB on short clips).
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readdirSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const argv = process.argv.slice(2), dir = resolve(argv[0] || '.');
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const video = resolve(dir, opt('video', 'out/silent.mp4'));
const out = resolve(dir, opt('out', 'out/final.mp4'));
const audioDir = join(dir, 'audio');
const found = existsSync(audioDir) && readdirSync(audioDir).find((f) => /\.(wav|mp3|m4a|flac|ogg|aac)$/i.test(f));
const music = opt('music') ? resolve(dir, opt('music')) : found ? join(audioDir, found) : null;
const sfx = existsSync(join(dir, 'out', 'sfx.wav')) ? join(dir, 'out', 'sfx.wav') : null;

const inputs = [video, music, sfx].filter(Boolean);
if (inputs.length === 1) { copyFileSync(video, out); console.log('no audio, copied picture ->', out); process.exit(0); }

const dur = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video]).toString().trim();
const parts = [], labels = [];
if (music) { parts.push(`[1:a]volume=${opt('music-gain', 0.8)}[m]`); labels.push('[m]'); }
if (sfx) { parts.push(`[${music ? 2 : 1}:a]volume=1.0[s]`); labels.push('[s]'); }
const mixed = labels.length > 1 ? `${labels.join('')}amix=inputs=${labels.length}:duration=longest:normalize=0,` : `${labels[0]}anull,`;
const LN = 'loudnorm=I=-14:TP=-1.5:LRA=11';
const ins = inputs.flatMap((f) => ['-i', f]);

const run = (args, capture) => new Promise((ok, fail) => {
  const p = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', capture ? 'pipe' : 'inherit'] });
  let err = ''; if (capture) p.stderr.on('data', (d) => (err += d));
  p.on('close', (c) => (c ? fail(new Error('ffmpeg exited ' + c + '\n' + err.slice(-2000))) : ok(err)));
});

// pass 1: measure the mix over the length of the picture
const log = await run(['-hide_banner', ...ins, '-t', dur, '-filter_complex', [...parts, `${mixed}${LN}:print_format=json[a]`].join(';'),
  '-map', '[a]', '-f', 'null', '-'], true);
const m = JSON.parse(log.slice(log.lastIndexOf('{'), log.lastIndexOf('}') + 1));
const measured = `measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;

// pass 2: apply
// alimiter catches the peaks loudnorm's linear mode lets through (booms, impacts)
await run(['-y', '-loglevel', 'error', ...ins, '-filter_complex', [...parts, `${mixed}${LN}:${measured},alimiter=limit=0.7:level=false,aresample=48000[a]`].join(';'),
  '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', out]);
console.log(`mix: ${inputs.length - 1} audio source(s), measured ${m.input_i} LUFS -> -14 -> ${out}`);
