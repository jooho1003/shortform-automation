const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const repo = path.resolve(__dirname, '../..');
  const studioFile = path.join(__dirname, 'hansul.json');
  const initial = await fs.readFile(studioFile, 'utf8');
  const studio = JSON.parse(initial);
  const episode = studio.episodes.find(e => e.part === 3 && e.arc === 1);
  assert.equal(episode.editorId, null);
  const draft = Object.fromEntries(['topic','cards','caption','brief','feedback','topicMode','storyboardMode'].map(k => [k, episode[k]]));
  draft.cards[6].dialogue = '보리: 케이크값 6만 8천 원은 오늘 보내 줘.\n수진: 겨우 그 돈 때문에 친구한테 이래?\n보리: 적은 돈이면 지금 보내 줘. 내가 대신 낸 돈이잖아.';
  draft.cards[9].dialogue = '수진 메시지: 아직 삐졌어?\n보리: 미소야, 그래서 어떻게 됐어?\n끝표기: -끝-';
  draft.cards[9].scene = '작은 상단 컷에 수진의 아직 삐졌어? 알림. 큰 하단 컷에서 보리는 휴대폰을 뒤집어 내려놓고 맞은편 미소를 바라보며 질문한다. 수진에게 답하는 말로 읽히지 않게 말풍선 꼬리와 시선을 미소 쪽으로 연결한다. 같은 한술 식당, 다음 이야기 예고 없음.';
  const response = await fetch('http://localhost:3123/api/instatoon/hansul', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({action:'approve',revision:studio.revision,episodeId:episode.id,draft})});
  const result = await response.json();
  assert.ok(response.ok, JSON.stringify(result));
  const updated = result.studio.episodes.find(e => e.id === episode.id);
  const dir = path.join(repo, '인스타툰', updated.editorId);
  for (const sub of ['제작','컷','캐릭터','출력']) await fs.mkdir(path.join(dir,sub),{recursive:true});
  await fs.writeFile(path.join(dir,'제작/연결전-작업실.json'), initial);
  const previous = path.join(repo,'인스타툰/20261002-jnll7');
  await fs.copyFile(path.join(previous,'캐릭터/01-보리-수진-미소-기준.png'),path.join(dir,'캐릭터/01-보리-수진-미소-기준.png'));
  const board = {part:3,totalParts:3,projectId:updated.editorId,title:updated.topic.title,cards:updated.cards,caption:updated.caption};
  await fs.writeFile(path.join(dir,'제작/최종콘티.json'),JSON.stringify(board,null,2));
  await fs.writeFile(path.join(dir,'출력/캡션.txt'),updated.caption+'\n');
  const oldPlan = JSON.parse(await fs.readFile(path.join(previous,'제작/생성계획.json'),'utf8'));
  const common = oldPlan.common.replace('part 2 of an existing story','the FINAL part 3 of an existing story') + ' Keep portrait 4:5 canvas strictly, not 3:4 or 2:3. Text and art are all in the generated image.';
  const prompts = [
    'COVER. Large hand-lettered title at top exactly "네가 부탁한 케이크로\\n왜 우리를 무시해?" and peach circular badge "3/3". Middle-lower symbolic composition Bori LEFT with upright posture, lowered calm brows and firmly small closed mouth holds phone, Sujin RIGHT frozen with raised eyebrows, round uncertain eyes and small open mouth. Between them floating cake photo motif with exactly three strawberries, not physically meeting: two separate soft home backgrounds fading into white. Bori scarf mustard, Sujin lavender. No speech bubbles. Bottom tiny footer "한술툰 · 창작 사연". Decisive, satisfying finale cover; warm handdrawn illustration, spacious typography.',
    'Continuation immediately after prior part. Header "우리 셋". Upper half two large pale yellow Bori chat messages, correct avatar and name "보리": "네 부탁으로 내가 가게에서 찾아다 줬어." and "돈도 내가 먼저 냈고." Beside them small receipt insert with ONLY "68,000원". Lower half separate home reaction vignettes: Bori confident serious face holding phone left, Miso peach no scarf surprised raised eyebrows right. Tiny Sujin avatar near header frozen. No three characters physically together. No extra dialogue. Spacious readable text.',
    'Header "우리 셋". Upper-middle alternating chat: lavender Sujin avatar name "수진", message "남친이 바빠서 내가 고른 건데, 그게 뭐?" Then yellow Bori avatar name "보리", message "네가 고른 건 괜찮아.\\n부탁할 수도 있지." Lower reaction pair in separate homes: Sujin right defensive furrowed brow small open speaking mouth, one paw raised as excuse; Bori left composed calm lowered eyebrows slight open mouth, no smile. Warm empty cream areas separate homes. Clearly chat not face-to-face.',
    'Header "우리 셋". Main emotional confrontation. Three large handdrawn chat bubbles with exact avatars/names in reading order: yellow Bori "그런데 미소가 말하면 왜 구걸이야?"; yellow Bori "너도 직접 골랐으면서, 우린 왜 무시해?"; pale peach Miso "난 진짜 내가 이상한 줄 알았어." Lower area Miso close-up holding phone, inner brows lifted, mouth down, hurt but finding support. Small separate Bori serious determined side vignette and tiny Sujin silent worried avatar. Do not depict three in same room. No extra quoted old message. Give dialogue priority with large legible text.',
    'Header "우리 셋". Lavender Sujin avatar name "수진": "내가 부러워서 그래?\\n생일에 꼭 망신을 줘야 해?" Below yellow Bori avatar name "보리": "네 생일도 축하했고,\\n케이크도 가져다줬어." and second Bori bubble "그걸로 친구를 깎아내리지만 말라는 거야." Lower scene medium closeup Bori on same couch calmly resolute with flat brows, short firm mouth and upright shoulders. Small Sujin phone reaction inset resentful half-lidded glare and pout. Restrained expressions, no explosion effects. Mobile-readable lettering.',
    'Header "우리 셋". Lavender Sujin avatar name "수진", message "난 너희 걱정돼서 말한 거지." Then yellow Bori avatar name "보리", two messages "난 약속을 기다리다 속상해서 말했어." and "그때 네가 한 말은\\n전부 내 잘못이라는 거였어." Lower large Bori face vulnerability visible: inner brows slightly lifted, small parted mouth, eyes steady not avoiding, holding phone; a small faint wordless memory vignette of Bori alone at a cafe table looking at clock (no new characters/text). Sujin tiny inset averted eyes, closed mouth, no smile. No extra invented narration.',
    'Transition header "수진 · 개인톡". Three messages upper two-thirds: Bori yellow with name/avatar "보리": "케이크값 6만 8천 원은 오늘 보내 줘."; Sujin lavender with name/avatar "수진": "겨우 그 돈 때문에 친구한테 이래?"; Bori yellow "적은 돈이면 지금 보내 줘.\\n내가 대신 낸 돈이잖아." Bottom Bori firm lowered brows and short closed mouth phone lowered slightly, Sujin small separated frustrated face. No receipt needed. Speech attribution unambiguous. No bank/account numbers. Satisfying firm reply not yelling.',
    'Quiet resolution. Top small handdrawn notification box ONLY "68,000원 받음". Under it header "수진 · 개인톡", one Bori yellow chat with correct bluegray avatar and name "보리": "돈 받았어.\\n앞으로 이런 부탁은 안 들어줄게." Lower large scene Bori sitting back on cream sofa putting phone on wooden side table, shoulders and ears relaxing, soft closed mouth and eyes relieved, not smug. Bottom separate narration box exact "돈을 돌려받았다고,\\n없던 일이 되지는 않았다." No additional bank text, no end marker yet.',
    'Time tag "며칠 뒤". Cozy simple Korean small restaurant, background discreet wooden sign "한술 식당". Bori LEFT mustard scarf and Miso RIGHT peach no accessories sitting opposite at small wooden table with two rice bowls, soup bowls, simple side dishes and wooden spoons. No cake, no Sujin. Miso upper-right speech bubble to Miso "나 또 연애 얘기해도 돼?" Miso cautious slightly tilted shy mouth and raised inner brow. Bori left reply bubble "그럼. 무슨 일 있었어?" Bori warm gently curved eyes open friendly mouth turning toward Miso. Phone face down near Bori not central. All bubbles tails precise. Soft cream sage pink setting, not detailed realism.',
    'FINAL SLIDE, TWO sequential beats. Upper quarter small inset close-up phone notification attributed "수진" with tiny taupe lavender avatar and exact "아직 삐졌어?". Tiny time-transition implied below by white space, no written transition. Lower three-quarters SAME cozy restaurant with Bori LEFT and Miso RIGHT opposite each other and same rice/soup dishes. Bori places phone FACE DOWN on table with one paw and looks directly at Miso warmly; large speech bubble with tail clearly to Bori facing Miso exact "미소야, 그래서 어떻게 됐어?" Miso relieved smiling, speaking gesture with one paw. The line is addressed to Miso, NOT a reply to Sujin notification. Bori calm relaxed expression different from earlier conflict. Bottom clean white strip centered "-끝-". No CTA, no nextpart teaser, no additional narration, no 3/3 or slide number here.'
  ];
  const plan = {common, references:[path.join(dir,'캐릭터/01-보리-수진-미소-기준.png'),path.join(previous,'컷/10-완성.png')],slides:prompts.map((prompt,i)=>({page:i+1,prompt}))};
  await fs.writeFile(path.join(dir,'제작/생성계획.json'),JSON.stringify(plan,null,2));
  await fs.writeFile(path.join(__dirname,'part3-production.json'),JSON.stringify({id:updated.editorId,dir},null,2));
  console.log(JSON.stringify({id:updated.editorId,dir,revision:result.studio.revision}));
})().catch(e=>{console.error(e);process.exitCode=1});
