import hashlib
import json
import subprocess
from pathlib import Path
import numpy as np

OUT=Path(__file__).resolve().parent
ROOT=OUT.parents[1]
def run(cmd):
    return subprocess.run(cmd,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
def stats(path):
    data=np.frombuffer(run(['ffmpeg','-v','error','-i',str(path),'-ac','1','-ar','24000','-f','f32le','pipe:1']).stdout,dtype='<f4')
    assert len(data)>24000 and np.isfinite(data).all()
    peak=float(np.max(np.abs(data)))
    clipped=int(np.count_nonzero(np.abs(data)>=1))
    assert clipped==0
    return {'seconds':len(data)/24000,'peak_dbfs':20*np.log10(max(peak,1e-12)),'clipped_samples':clipped,'sha256':sha(path)}
raws=list((OUT/'raw').glob('*.wav'))
assert len(raws)==1, raws
raw=raws[0]
manifest={'method':'Seed-VC v1 offline voice conversion, source recording + Sagu 3B reference','seed':89,'diffusion_steps':30,'cfg_rate':0.7,'length_adjust':1.0,'f0_condition':False,'source_original':'C:/Users/이주호/OneDrive/문서/소리 녹음/녹음 (89).m4a','reference_original':'C:/Users/이주호/Documents/Codex/2026-10-06/d/outputs/sagu-3B-younger-playful-20261007.wav','raw':stats(raw),'source_preprocessed':stats(OUT/'source.wav'),'reference_sha256':sha(OUT/'sagu-3B-reference.wav'),'qa_note':'Decode, signal integrity and ASR checks are not subjective listening or a guarantee of identical voice/performance.','outputs':[]}
manifest['engine_commit']=run(['git','-C',str(ROOT/'pipeline/data/tools/seed-vc'),'rev-parse','HEAD']).stdout.decode().strip()
for label,speed in [('sagu-3B-my-acting',1.0),('sagu-3B-my-acting-fast',1.2)]:
    wav=OUT/(label+'.wav')
    mp3=OUT/(label+'.mp3')
    filt=f'atempo={speed},loudnorm=I=-17:TP=-2:LRA=9'
    run(['ffmpeg','-v','error','-y','-i',str(raw),'-af',filt,'-ar','48000','-c:a','pcm_s24le',str(wav)])
    run(['ffmpeg','-v','error','-y','-i',str(wav),'-c:a','libmp3lame','-b:a','192k',str(mp3)])
    entry={'name':label,'speed':speed,'pitch_shift':0,'wav':stats(wav),'mp3':stats(mp3)}
    assert abs(entry['wav']['seconds']-manifest['raw']['seconds']/speed)<0.2
    manifest['outputs'].append(entry)
(OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(manifest,ensure_ascii=True,indent=2))
