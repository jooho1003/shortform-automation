"""Extract frames from the user's local video for design review, without changing it."""
import base64
import json
import subprocess
from pathlib import Path

base = Path(__file__).resolve().parent
story = json.loads((base.parent / '01-스토리설계.json').read_text(encoding='utf-8'))
source = story['reference']['path']
probe = subprocess.run(
    ['ffprobe', '-v', 'error', '-show_format', '-show_streams', '-of', 'json', source],
    check=True, capture_output=True, encoding='utf-8',
)
(base / '메타데이터.json').write_text(probe.stdout, encoding='utf-8')
scenes = story['scenes']
for scene in scenes:
    output = base / f"{scene['id']}-참고.jpg"
    if not output.exists():
        subprocess.run([
            'ffmpeg', '-hide_banner', '-loglevel', 'error', '-n',
            '-ss', str(scene['referenceAtSec']), '-i', source,
            '-frames:v', '1', '-vf', 'scale=270:480', '-q:v', '4', str(output),
        ], check=True)
    scene['image'] = 'data:image/jpeg;base64,' + base64.b64encode(output.read_bytes()).decode('ascii')

visual = Path('C:/Users/이주호/.codex/visualizations/2026/09/14/01a0a187-35c6-7ae3-bb8f-d3e4c8d175e3/c-storyboard.html')
markup = visual.read_text(encoding='utf-8')
payload = json.dumps(scenes, ensure_ascii=False).replace('<', '\\u003c')
if '__STORY_DATA__' in markup:
    markup = markup.replace('__STORY_DATA__', payload)
    visual.write_text(markup, encoding='utf-8')
assert visual.stat().st_size < 1_000_000
assert '__STORY_DATA__' not in visual.read_text(encoding='utf-8')
print(json.dumps({'frames': len(scenes), 'visual_bytes': visual.stat().st_size}, ensure_ascii=False))
