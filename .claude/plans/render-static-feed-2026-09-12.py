"""Render this batch's static feed-card chrome once, then composite its moving clip.

Only valid for these single-clip, no-comment, no-narration, no-BGM feed cards.
Uses the current FeedCard.tsx geometry; not a general pipeline replacement.
"""
import json
import math
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PIPELINE = ROOT / 'pipeline'
sys.path.insert(0, str(PIPELINE))
from shortform.paths import Episode
from shortform.steps.render import _stage, STAGE
from shortform import state

assert STAGE.resolve() == (PIPELINE / 'remotion/public/ep').resolve()
CLI = PIPELINE / 'node_modules/@remotion/cli/remotion-cli.js'

for num in sys.argv[1:]:
    ep = Episode.find('2026-09-12', 'B', num)
    payload = json.loads((ep.assets_dir / '타임라인.json').read_text(encoding='utf-8'))
    assert payload['template'] == 'feed-card-light'
    assert len(payload['lines']) == 1 and not payload['comments']
    assert not payload['narration'] and not payload['bgm']
    assert payload['lines'][0]['mediaLayout'] == 'landscape'
    clip = ep.assets_dir / payload['lines'][0]['clip']
    ep.video_dir.mkdir(parents=True, exist_ok=True)
    background = ep.video_dir / 'frame-layout.png'
    entry = json.loads(ep.clip_list.read_text(encoding='utf-8'))[0]
    origin = entry['candidates'][entry['chosen']]['start']
    source = PIPELINE / 'data/cache/thd1ztcy53s-src.mp4'
    channel_reference = Episode.find('2026-09-12', 'B', '03').video_dir / 'frame-layout.png'
    with (ep.video_dir / 'render.log').open('w', encoding='utf-8') as log:
        if not background.exists():
            # B02 already has a reviewed full Remotion render.
            if ep.final_mp4.exists():
                subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
                                '-i', str(ep.final_mp4), '-frames:v', '1', str(background)],
                               stdout=log, stderr=log, check=True)
            else:
                props = _stage(ep, payload)
                props_path = ep.video_dir / 'render-props.json'
                props_path.write_text(json.dumps(props, ensure_ascii=False), encoding='utf-8')
                subprocess.run(['node', str(CLI), 'still', 'Short', str(background),
                                '--props=' + str(props_path), '--frame=0', '--log=error'],
                               cwd=PIPELINE / 'remotion', stdout=log, stderr=log, check=True)
        frames = math.ceil(payload['durationSec'] * 30)
        print(f'{num}: composite {frames} frames', flush=True)
        # Keep the full source width so baked-in captions and people are visible.
        # Reuse the reviewed B03 channel stripe: two stills had incomplete font glyphs.
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
                        '-loop', '1', '-framerate', '30', '-i', str(background),
                        '-ss', str(origin), '-t', str(frames / 30), '-i', str(source),
                        '-loop', '1', '-framerate', '30', '-i', str(channel_reference),
                        '-filter_complex_threads', '2', '-filter_complex',
                        '[2:v]crop=1008:112:36:1388[ch];[0:v][ch]overlay=36:1388[base];'
                        '[1:v]fps=30,split=2[bg][fg];'
                        '[bg]scale=1008:850:force_original_aspect_ratio=increase,crop=1008:850,boxblur=25:2[b];'
                        '[fg]scale=1008:568[f];[b][f]overlay=0:141[v];'
                        '[base][v]overlay=36:362:shortest=1[out]',
                        '-map', '[out]', '-map', '1:a:0', '-frames:v', str(frames),
                        '-t', str(frames / 30), '-r', '30', '-c:v', 'libx264',
                        '-preset', 'veryfast', '-crf', '18', '-threads', '2',
                        '-c:a', 'aac', '-b:a', '192k', '-pix_fmt', 'yuv420p',
                        '-movflags', '+faststart', str(ep.final_mp4)],
                       stdout=log, stderr=log, check=True)
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
                        '-ss', '1', '-i', str(ep.final_mp4), '-frames:v', '1',
                        str(ep.video_dir / 'thumb.jpg')], stdout=log, stderr=log, check=True)
    state.mark_done(ep, 'render')
    print(f'{num}: done {ep.final_mp4}', flush=True)
