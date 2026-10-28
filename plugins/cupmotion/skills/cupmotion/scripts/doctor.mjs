// cupmotion doctor: checks what the studio needs and, with --install, sets it up once.
//   node doctor.mjs              проверить
//   node doctor.mjs --install    поставить playwright-core в ~/.cupmotion (без скачивания браузера: берётся Chrome или Edge)
//   node doctor.mjs --install --ears   плюс «уши»: pip install faster-whisper librosa soundfile (для listen.py и beats.py)
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2), install = args.includes('--install'), ears = args.includes('--ears');
const HOME = join(homedir(), '.cupmotion');
const os = platform();
const hint = {
  ffmpeg: { win32: 'winget install Gyan.FFmpeg', darwin: 'brew install ffmpeg', linux: 'sudo apt install ffmpeg' },
  chrome: { win32: 'установи Google Chrome или Microsoft Edge', darwin: 'установи Google Chrome', linux: 'npx playwright-core install chromium' },
  python: { win32: 'winget install Python.Python.3.12', darwin: 'brew install python', linux: 'sudo apt install python3 python3-pip' },
};
let bad = 0;
const ok = (m) => console.log('  OK   ' + m);
const no = (m, fix) => { bad++; console.log('  НЕТ  ' + m + (fix ? `\n       как исправить: ${fix}` : '')); };
const has = (cmd, a = ['-version']) => { try { execFileSync(cmd, a, { stdio: 'ignore' }); return true; } catch { return false; } };

console.log('cupmotion doctor\n');
const [maj] = process.versions.node.split('.').map(Number);
maj >= 18 ? ok(`Node ${process.versions.node}`) : no(`Node ${process.versions.node} (нужен 18+)`, 'https://nodejs.org');
has('ffmpeg') && has('ffprobe') ? ok('ffmpeg и ffprobe') : no('ffmpeg / ffprobe не найдены в PATH', hint.ffmpeg[os] || hint.ffmpeg.linux);

const loadPw = () => { for (const m of ['playwright-core', 'playwright']) { try { return createRequire(join(HOME, 'package.json'))(m); } catch {} } return null; };
let pw = loadPw();
if (!pw && install) {
  mkdirSync(HOME, { recursive: true });
  if (!existsSync(join(HOME, 'package.json'))) writeFileSync(join(HOME, 'package.json'), '{ "name": "cupmotion-tools", "private": true }\n');
  console.log('  ...  ставлю playwright-core в ' + HOME);
  spawnSync('npm', ['install', 'playwright-core', '--prefix', HOME, '--no-fund', '--no-audit'], { stdio: 'inherit', shell: true, env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' } });
  pw = loadPw();
}
if (!pw) no('playwright-core (нужен для захвата кадров)', 'node doctor.mjs --install');
else {
  ok('playwright-core в ' + HOME);
  let browser = null;
  for (const channel of ['chrome', 'msedge', undefined]) {
    try { const b = await pw.chromium.launch(channel ? { channel } : {}); await b.close(); browser = channel || 'chromium'; break; } catch {}
  }
  browser ? ok('браузер для рендера: ' + browser) : no('нет Chrome / Edge / Chromium для рендера', hint.chrome[os] || hint.chrome.linux);
}

console.log('\nНеобязательно — «уши» (расшифровка речи и анализ звука, scripts/listen.py):');
const py = ['python', 'python3', 'py'].find((c) => has(c, ['--version']));
if (!py) console.log('  нет Python — ' + (hint.python[os] || hint.python.linux));
else {
  const probe = () => spawnSync(py, ['-c', 'import faster_whisper, librosa'], { stdio: 'ignore' }).status === 0;
  if (!probe() && install && ears) spawnSync(py, ['-m', 'pip', 'install', '--user', 'faster-whisper', 'librosa', 'soundfile'], { stdio: 'inherit' });
  probe() ? console.log(`  OK   ${py} + faster-whisper + librosa`) : console.log(`  нет faster-whisper — node doctor.mjs --install --ears  (или: ${py} -m pip install faster-whisper librosa soundfile)`);
}
console.log(bad ? `\nНе хватает: ${bad}. Исправь пункты выше и запусти снова.` : '\nВсё готово к рендеру.');
process.exit(bad ? 1 : 0);
