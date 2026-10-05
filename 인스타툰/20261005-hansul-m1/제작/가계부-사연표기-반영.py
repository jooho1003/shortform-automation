import json, shutil
from pathlib import Path
from datetime import datetime,timezone
root=Path.cwd()
base=root/'shortform-automation/인스타툰'
rec=json.loads((base/'20261005-hansul-m1/제작/가계부-사연표기-수정기록.json').read_text(encoding='utf-8'))
for e in rec['edits']:
    b=base/f"20261005-hansul-m{e['part']}"
    filename=('04-수정01.png' if e['page']==4 else ('01-수정02.png' if e['part']==1 else '01-수정01.png'))
    shutil.copy2(e['path'],b/'컷'/filename)
    relative=f"인스타툰/20261005-hansul-m{e['part']}/컷/{filename}"
    for path in [b/'프로젝트.json',b/'제작/최종콘티.json']:
        data=json.loads(path.read_text(encoding='utf-8'))
        data=json.loads(json.dumps(data,ensure_ascii=False).replace('창작 사연','사연'))
        if 'slides' in data:
            data['slides'][e['page']-1]['panels'][0]['image']=relative
            data['updated_at']=datetime.now(timezone.utc).isoformat()
            data['caption']=data['caption'].replace('※ 사연입니다.','사연')
        else:
            next(c for c in data['cards'] if c['page']==e['page'])['image']=relative
        path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
path=root/'한술툰/기획/결혼생활-취업약속-개별장-콘티.json'
path.write_text(path.read_text(encoding='utf-8').replace('창작 사연','사연'),encoding='utf-8')
path=root/'한술툰/기획/한술툰-설계.md'
path.write_text(path.read_text(encoding='utf-8').replace('새 창작 사연 〈취업하면 다 해준다던 남편〉','독자 사연 〈취업하면 다 해준다던 남편〉')+'\n- 〈취업하면 다 해준다던 남편〉은 독자 사연이며 표지·캡션에는 “사연”으로만 표기한다.\n',encoding='utf-8')
print('Updated notebook and three cover footers; project captions and storyboards now say 사연.')
