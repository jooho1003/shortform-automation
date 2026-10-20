"""One-off Seed-VC inference; source performance + existing Sagu reference."""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ENGINE = ROOT/'pipeline/data/tools/seed-vc'
OUT = Path(__file__).resolve().parent
sys.path.insert(0,str(ENGINE/'local-deps'))
sys.path.insert(0,str(ENGINE))
os.chdir(ENGINE)
os.environ['HF_HUB_DISABLE_SYMLINKS_WARNING']='1'
os.environ['PYTHONIOENCODING']='utf-8'
import argparse
import torch
import soundfile as sf
import torchaudio
torch.set_num_threads(4)
torch.manual_seed(89)
# torchaudio 2.9 uses torchcodec for save; use equivalent PCM WAV export.
def save_pcm(path, tensor, sr, **kwargs):
    sf.write(path,tensor.detach().cpu().numpy().T,sr,subtype='PCM_24')
torchaudio.save=save_pcm
import inference
if '--cpu' in sys.argv:
    inference.device=torch.device('cpu')
args=argparse.Namespace(source=str(OUT/'source.wav'),target=str(OUT/'sagu-3B-reference.wav'),output=str(OUT/'raw'),diffusion_steps=30,length_adjust=1.0,inference_cfg_rate=0.7,f0_condition=False,auto_f0_adjust=False,semi_tone_shift=0,checkpoint=None,config=None,fp16=inference.device.type=='cuda')
print('DEVICE',inference.device,flush=True)
inference.main(args)
