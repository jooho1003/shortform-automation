import json
from pathlib import Path
from faster_whisper import WhisperModel
OUT=Path(__file__).resolve().parent
model=WhisperModel('small',device='cpu',compute_type='int8',cpu_threads=4,num_workers=1,download_root='D:/VoiceStudio/models/whisper',local_files_only=True)
results={}
for name in ['source.wav','sagu-3B-my-acting.wav','sagu-3B-my-acting-fast.wav']:
    segments,info=model.transcribe(str(OUT/name),language='ko',beam_size=5,vad_filter=False,condition_on_previous_text=False)
    results[name]=[{'start':s.start,'end':s.end,'text':s.text} for s in segments]
    print(name,json.dumps(results[name],ensure_ascii=False),flush=True)
(OUT/'asr-check.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
