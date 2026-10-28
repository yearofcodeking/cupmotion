"""listen.py: "ears" for Claude (cupmotion). Needs: pip install faster-whisper librosa soundfile; ffmpeg in PATH. Transcribes speech (Whisper) and measures the rest of the sound in a video or audio file.

    python listen.py <file> [--model small|medium] [--lang ru|en|auto] [--out <dir>] [--no-speech]

The Whisper model (~0.5 GB for small) downloads once on first use into ~/.cupmotion/whisper-models
(or CUPMOTION_WHISPER_MODELS, e.g. to reuse models you already have).

Writes <name>.listen.md and <name>.listen.json next to the file (or into --out) and prints the report.
What it CAN do: speech to text with word times, loudness (LUFS / peak), level and brightness timeline, silence, tempo, key (rough),
strongest accents (onsets), clipping. What it CANNOT do: judge whether music sounds good or whether an SFX is tasteful.
"""
import argparse, json, os, re, subprocess, sys, tempfile, time
import numpy as np

sys.stdout.reconfigure(encoding='utf-8')
HERE = os.path.dirname(os.path.abspath(__file__))
MODELS = os.environ.get('CUPMOTION_WHISPER_MODELS') or os.path.join(os.path.expanduser('~'), '.cupmotion', 'whisper-models')
SR = 22050

ap = argparse.ArgumentParser()
ap.add_argument('file'); ap.add_argument('--model', default='small'); ap.add_argument('--lang', default='auto')
ap.add_argument('--out', default=None); ap.add_argument('--no-speech', action='store_true', help='skip Whisper (music / SFX only)')
a = ap.parse_args()
src = os.path.abspath(a.file); name = os.path.splitext(os.path.basename(src))[0]
out_dir = os.path.abspath(a.out) if a.out else os.path.dirname(src); os.makedirs(out_dir, exist_ok=True)

def ffprobe(*args):
    return subprocess.run(['ffprobe', '-v', 'error', *args, src], capture_output=True, text=True).stdout.strip()

has_audio = 'audio' in ffprobe('-show_entries', 'stream=codec_type', '-of', 'csv=p=0')
if not has_audio:
    print('В файле нет звуковой дорожки.'); sys.exit(0)
duration = float(ffprobe('-show_entries', 'format=duration', '-of', 'csv=p=0'))

tmp = tempfile.mkdtemp(prefix='listen_')
wav = os.path.join(tmp, 'a.wav')
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', src, '-vn', '-ac', '1', '-ar', str(SR), wav], check=True)
import librosa
y, _ = librosa.load(wav, sr=SR, mono=True)

R = {'file': src, 'duration_s': round(duration, 2)}
md = [f'# Прослушивание: {os.path.basename(src)}', '', f'Длительность: {duration:.2f} с']

# ---- loudness / peak (ffmpeg ebur128) ----
r = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', src, '-vn', '-af', 'ebur128=peak=true', '-f', 'null', '-'], capture_output=True, text=True).stderr
tail = r[r.rfind('Summary:'):] if 'Summary:' in r else r
def grab(pat):
    m = re.search(pat, tail); return float(m.group(1)) if m else None
R['lufs'] = grab(r'I:\s+(-?[\d.]+)\s+LUFS'); R['lra'] = grab(r'LRA:\s+(-?[\d.]+)\s+LU'); R['true_peak_dbfs'] = grab(r'Peak:\s+(-?[\d.]+)\s+dBFS')
md += ['', '## Громкость', f"- Интегральная: {R['lufs']} LUFS (цель для соцсетей −14), диапазон {R['lra']} LU, пик {R['true_peak_dbfs']} dBFS (цель ≤ −1)"]
clip = float((np.abs(y) > 0.999).mean())
R['clipping_share'] = round(clip, 6)
if clip > 1e-4: md.append(f'- Есть клиппинг: {clip * 100:.3f}% сэмплов у потолка')

# ---- level + brightness timeline, 0.5 s ----
hop = int(0.5 * SR); n = len(y) // hop
rms = [float(20 * np.log10(np.sqrt(np.mean(y[i * hop:(i + 1) * hop] ** 2)) + 1e-9)) for i in range(n)]
cent = librosa.feature.spectral_centroid(y=y[:n * hop], sr=SR, hop_length=hop)[0][:n] if n else []
R['timeline'] = [{'t': round(i * 0.5, 1), 'rms_db': round(rms[i], 1), 'centroid_hz': int(cent[i])} for i in range(n)]
md += ['', '## Уровень по 0.5 с (RMS дБ | яркость, Гц)', '```']
for i in range(0, n, 2):
    row = [f"{i * 0.5:5.1f}с {rms[i]:6.1f} дБ {int(cent[i]):5d} Гц"]
    if i + 1 < n: row.append(f"{(i + 1) * 0.5:5.1f}с {rms[i + 1]:6.1f} дБ {int(cent[i + 1]):5d} Гц")
    md.append('   '.join(row))
md.append('```')
silent = [i * 0.5 for i in range(n) if rms[i] < -55]
if silent: md.append(f"- Тишина (< −55 дБ) в моменты: {', '.join(f'{t:.1f}' for t in silent[:20])} с")

# ---- tempo, accents, key ----
env = librosa.onset.onset_strength(y=y, sr=SR)
for _path in ('feature.rhythm.tempo', 'feature.tempo', 'beat.tempo'):
    try:
        _fn = librosa
        for _p in _path.split('.'): _fn = getattr(_fn, _p)
        tempo = float(np.atleast_1d(_fn(onset_envelope=env, sr=SR))[0]); break
    except (AttributeError, TypeError):
        continue
else:
    tempo = float('nan')
fr = librosa.onset.onset_detect(onset_envelope=env, sr=SR, units='frames', backtrack=False)
times = librosa.frames_to_time(fr, sr=SR); strength = env[fr] if len(fr) else np.array([])
top = sorted(zip(times, strength), key=lambda p: -p[1])[:12]
top = sorted(top)
R['tempo_bpm_est'] = round(tempo, 1); R['accents'] = [{'t': round(float(t), 3), 'strength': round(float(s), 2), 'frame60': int(round(float(t) * 60))} for t, s in top]
chroma = librosa.feature.chroma_cqt(y=y, sr=SR).mean(axis=1)
maj = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]); mnr = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
best = max(((np.corrcoef(np.roll(p, k), chroma)[0, 1], names[k] + (' мажор' if p is maj else ' минор')) for p in (maj, mnr) for k in range(12)))
R['key_guess'] = best[1]; R['key_confidence'] = round(float(best[0]), 2)
md += ['', '## Ритм и ноты', f'- Темп (оценка): {tempo:.0f} BPM; тональность (грубо): {best[1]} (уверенность {best[0]:.2f}; для шума и эффектов не значима)',
       '- Самые сильные акценты (время, ближайший кадр при 60 fps): ' + ', '.join(f'{t:.2f} с (кадр {int(round(t * 60))})' for t, _ in top)]

# ---- speech ----
if not a.no_speech:
    from faster_whisper import WhisperModel
    t0 = time.time()
    model = WhisperModel(a.model, device='cpu', compute_type='int8', download_root=MODELS, cpu_threads=max(1, (os.cpu_count() or 4) - 1))
    y16, _ = librosa.load(wav, sr=16000, mono=True)    # an array, not a path: PyAV here rejects metadata_errors
    segs, info = model.transcribe(y16.astype(np.float32), language=None if a.lang == 'auto' else a.lang, vad_filter=True, word_timestamps=True, beam_size=5)
    segs = list(segs)
    speech_s = sum(s.end - s.start for s in segs)
    R['speech'] = {'language': info.language, 'language_prob': round(info.language_probability, 2), 'model': a.model, 'speech_seconds': round(speech_s, 1),
                   'asr_seconds': round(time.time() - t0, 1),
                   'segments': [{'start': round(s.start, 2), 'end': round(s.end, 2), 'text': s.text.strip(),
                                 'words': [{'w': w.word.strip(), 's': round(w.start, 2), 'e': round(w.end, 2)} for w in (s.words or [])]} for s in segs]}
    md += ['', f'## Речь (модель {a.model}, язык {info.language} {info.language_probability:.0%}, речи {speech_s:.1f} с из {duration:.1f} с)']
    if not segs: md.append('- Речь не найдена.')
    for s in segs: md.append(f'- [{s.start:6.2f} – {s.end:6.2f}] {s.text.strip()}')
    md += ['', f'Распознавание заняло {time.time() - t0:.0f} с.']

txt = '\n'.join(md)
open(os.path.join(out_dir, name + '.listen.md'), 'w', encoding='utf-8').write(txt)
json.dump(R, open(os.path.join(out_dir, name + '.listen.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(txt)
