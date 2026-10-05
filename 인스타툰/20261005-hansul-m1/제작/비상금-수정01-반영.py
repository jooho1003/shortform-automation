import json, shutil
from pathlib import Path
from datetime import datetime, timezone
root=Path.cwd()
base=root/'shortform-automation/인스타툰/20261005-hansul-m1'
record=json.loads((base/'제작/비상금-수정01-생성기록.json').read_text(encoding='utf-8'))
project_path=base/'프로젝트.json'
board_path=base/'제작/최종콘티.json'
for src,name in [(project_path,'비상금-수정전-프로젝트.json'),(board_path,'비상금-수정전-콘티.json')]:
    dst=base/'제작'/name
    if not dst.exists(): shutil.copy2(src,dst)
project=json.loads(project_path.read_text(encoding='utf-8'))
board=json.loads(board_path.read_text(encoding='utf-8'))
central_path=root/'한술툰/기획/결혼생활-취업약속-개별장-콘티.json'
central=json.loads(central_path.read_text(encoding='utf-8'))
for c in record['changes']:
    page=c['page']
    filename=f'{page:02d}-수정01.png'
    shutil.copy2(c['path'],base/'컷'/filename)
    relative=f'인스타툰/20261005-hansul-m1/컷/{filename}'
    panel=project['slides'][page-1]['panels'][0]
    panel['scene']=c['scene']+'\n'+c['dialogue']
    panel['image']=relative
    for cards in [board['cards'],central['parts'][0]['cards']]:
        card=next(x for x in cards if x['page']==page)
        card['scene']=c['scene']
        card['dialogue']=c['dialogue']
        if cards is board['cards']: card['image']=relative
project['updated_at']=datetime.now(timezone.utc).isoformat()
for path,data in [(project_path,project),(board_path,board),(central_path,central)]:
    path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
assert len(project['slides'])==10
for c in record['changes']:
    image=project['slides'][c['page']-1]['panels'][0]['image']
    assert (root/'shortform-automation'/image).is_file()
print('Updated and verified pages 3, 7, 8, 9, 10; 10 slides retained.')
