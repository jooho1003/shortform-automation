import hashlib
import json
import subprocess
from pathlib import Path
import numpy as np

SOURCE = Path('C:/Users/이주호/OneDrive/문서/소리 녹음/녹음 (89).m4a')
OUT = Path(__file__).resolve().parent
RATE = 48000

def run(args):
    return subprocess.run(args, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

def decode(path):
    return np.frombuffer(run(['ffmpeg','-v','error','-i',str(path),'-ac','1','-ar',str(RATE),'-f','f32le','pipe:1']).stdout, dtype='<f4').copy()

source_hash = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
x = decode(SOURCE)
# Keep speech and generous margins around detected silence. Remove only centers
# of four >1.2s gaps, retaining 0.80s of each gap before speeding up.
silences = [(4.556729,6.400688),(9.074375,10.659708),(12.970542,14.262333),(16.758937,18.567479)]
start, end = 0.20, 21.15
kept = []
cursor = start
removed = []
for a,b in silences:
    cut_start, cut_end = a+0.40,b-0.40
    kept.append((cursor,cut_start))
    removed.append((cut_start,cut_end))
    cursor = cut_end
kept.append((cursor,end))
parts = []
for a,b in kept:
    part=x[round(a*RATE):round(b*RATE)].copy()
    n=240
    part[:n] *= np.linspace(0,1,n)
    part[-n:] *= np.linspace(1,0,n)
    parts.append(part)
edited=np.concatenate(parts)
temp=OUT/'timing-edited.f32'
temp.write_bytes(edited.astype('<f4').tobytes())
base=OUT/'timing-edited.wav'
run(['ffmpeg','-v','error','-y','-f','f32le','-ar',str(RATE),'-ac','1','-i',str(temp),'-c:a','pcm_s24le',str(base)])
temp.unlink()
manifest={'source':str(SOURCE),'source_sha256':source_hash,'original_seconds':len(x)/RATE,'trim_bounds':[start,end],'removed_gap_centers':removed,'edited_seconds_before_speed':len(edited)/RATE,'qa_scope':'Signal/decode checks only; no listening judgement claimed.','variants':[]}
for name,pitch,speed in [('A-natural',3,1.12),('B-sagu',5,1.16),('C-cartoon',7,1.20)]:
    # Resampling raises pitch and vocal resonances together, like a speed-up.
    # Rubber Band then corrects only the tempo to the desired moderate speed.
    shifted_rate=round(RATE*2**(pitch/12))
    ratio=shifted_rate/RATE
    filters=(f'highpass=f=85,afftdn=nr=5:nf=-45:tn=1,'
             f'asetrate={shifted_rate},aresample={RATE},'
             f'rubberband=tempo={speed/ratio:.10f}:pitch=1:transients=mixed:detector=soft:pitchq=quality,'
             'equalizer=f=3200:t=q:w=0.8:g=-1.5,'
             'acompressor=threshold=0.12:ratio=2:attack=10:release=100:makeup=1,'
             'loudnorm=I=-17:TP=-2:LRA=9')
    wav=OUT/(name+'.wav')
    mp3=OUT/(name+'.mp3')
    run(['ffmpeg','-v','error','-y','-i',str(base),'-af',filters,'-ar',str(RATE),'-c:a','pcm_s24le',str(wav)])
    run(['ffmpeg','-v','error','-y','-i',str(wav),'-c:a','libmp3lame','-b:a','192k',str(mp3)])
    checks={}
    for path in (wav,mp3):
        samples=decode(path)
        assert np.isfinite(samples).all()
        peak=float(np.max(np.abs(samples)))
        clipped=int(np.count_nonzero(np.abs(samples)>=1))
        assert clipped==0, (path,peak)
        duration=len(samples)/RATE
        assert abs(duration-len(edited)/RATE/speed)<0.20
        checks[path.suffix]={'duration_seconds':duration,'peak_dbfs':float(20*np.log10(max(peak,1e-12))),'clipped_samples':clipped,'finite':True}
    manifest['variants'].append({'name':name,'pitch_semitones':pitch,'speed':speed,'filter':filters,'qa':checks})
assert hashlib.sha256(SOURCE.read_bytes()).hexdigest()==source_hash
(OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(manifest,ensure_ascii=True,indent=2))
