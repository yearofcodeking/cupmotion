# python beats.py song.wav > beats.json   (анимация читает этот файл)
import sys, json, numpy as np, librosa

y, sr = librosa.load(sys.argv[1], sr=None, mono=True)
tempo, frames = librosa.beat.beat_track(y=y, sr=sr, units="frames")
beats = librosa.frames_to_time(frames, sr=sr).round(3).tolist()

onset = librosa.onset.onset_strength(y=y, sr=sr)
peaks = librosa.util.peak_pick(onset, pre_max=3, post_max=3, pre_avg=3,
                               post_avg=5, delta=0.5, wait=10)
json.dump({
    "bpm": float(np.atleast_1d(tempo)[0]),
    "beats": beats,                                   # смены состояний
    "downbeats": beats[::4],                          # большие моменты
    "hits": librosa.frames_to_time(peaks, sr=sr).round(3).tolist(),  # SFX
}, sys.stdout, indent=1)
