'use client';

import {useMemo, useState} from 'react';

import type {PlanA, PlanCut} from '@/lib/types';

import './shot-guide.css';

type GuideFields = {
  startFrame: string;
  endFrame: string;
  cameraMove: string;
  soundEffect: string;
};

const EMPTY_FIELDS: GuideFields = {startFrame: '', endFrame: '', cameraMove: '', soundEffect: ''};

const PRESETS: Array<{label: string; fields: Partial<GuideFields>}> = [
  {label: '제품 클로즈업', fields: {cameraMove: '핵심 특징을 향해 천천히 밀어 들어가는 클로즈업', startFrame: '제품의 핵심 특징이 즉시 읽히는 구도'}},
  {label: '요리 손동작', fields: {cameraMove: '캐릭터 기준 앞발/손과 조리 대상의 접촉점을 따라가는 가까운 카메라', startFrame: '캐릭터 기준 앞발/손과 조리 대상의 접촉점이 보이는 구도'}},
  {label: '공간 이동', fields: {cameraMove: '물리적으로 한 방향으로 이동하며 전경과 목적지를 연결하는 카메라', startFrame: '전경과 이동 방향이 함께 읽히는 구도'}},
];

function duration(cut: PlanCut) {
  return Math.max(0, cut.end - cut.start).toFixed(1);
}

export default function ShotGuide({plan}: {plan: PlanA}) {
  const [cutNumber, setCutNumber] = useState(plan.cuts[0]?.n ?? 0);
  const [drafts, setDrafts] = useState<Record<number, GuideFields>>({});
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const cut = plan.cuts.find((item) => item.n === cutNumber) ?? plan.cuts[0];
  const fields = drafts[cutNumber] ?? EMPTY_FIELDS;

  const prompt = useMemo(() => {
    if (!cut) return '';
    const optional = (label: string, value: string) => value.trim() ? `${label}: ${value.trim()}` : '';
    return [
      `컷 ${cut.n} 연출 가이드`,
      `ACTION: ${cut.action}`,
      `CAMERA: ${cut.camera}`,
      `LENS: ${cut.lens || '기획안에 없음'}`,
      `DURATION: ${duration(cut)}초`,
      '',
      ...Object.entries(plan.locks).flatMap(([label, value]) => [`[${label}]`, value]),
      '',
      optional('시작 화면', fields.startFrame),
      optional('끝 화면', fields.endFrame),
      optional('카메라 이동', fields.cameraMove),
      optional('효과음', fields.soundEffect),
      '',
      '한 번의 연속된 단일 숏으로 연출한다. 동일한 캐릭터·소품·해부학을 유지하고 순간이동, 화면 속 문자, 분할 화면을 만들지 않는다.',
      '시작은 행동이 완료되기 전의 읽기 쉬운 프레임으로, 끝은 행동의 결과가 보이는 프레임으로 잡는다.',
      '애니메이션에서는 시선, 물체 접촉점, 배경 위치를 고정해 연결감을 확인한다. 감정은 “기쁨”처럼 추상적으로 쓰지 말고 캐릭터 해부학에 맞는 눈·귀·꼬리 등의 가시 반응으로 적는다.',
    ].filter(Boolean).join('\n');
  }, [cut, fields, plan.locks]);

  function update(name: keyof GuideFields, value: string) {
    setCopied(false);
    setCopyError('');
    setDrafts((current) => ({
      ...current,
      [cutNumber]: {...(current[cutNumber] ?? EMPTY_FIELDS), [name]: value},
    }));
  }

  function applyPreset(fieldsToApply: Partial<GuideFields>) {
    setCopied(false);
    setCopyError('');
    setDrafts((current) => {
      const previous = current[cutNumber] ?? EMPTY_FIELDS;
      const appended = Object.fromEntries(Object.entries(fieldsToApply).map(([name, value]) => [
        name,
        previous[name as keyof GuideFields] ? `${previous[name as keyof GuideFields]} · ${value}` : value,
      ])) as Partial<GuideFields>;
      return {...current, [cutNumber]: {...previous, ...appended}};
    });
  }

  async function copyPrompt() {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setCopyError('');
    } catch {
      setCopied(false);
      setCopyError('복사하지 못했습니다. 지시문을 직접 선택해 복사해 주세요.');
    }
  }

  return (
    <details className="card shot-guide">
      <summary>연출 가이드 <span>접기/펼치기</span></summary>
      <p className="faint shot-guide-note">이 입력은 편집용 가이드입니다. 생성 설정에 자동 적용되거나 저장되지 않습니다.</p>

      <div className="shot-guide-grid">
        <label className="lbl">컷 선택
          <select className="field" value={cutNumber} onChange={(event) => { setCutNumber(Number(event.target.value)); setCopied(false); setCopyError(''); }}>
            {plan.cuts.map((item) => <option key={item.n} value={item.n}>컷 {item.n} · {item.action}</option>)}
          </select>
        </label>
        <div className="shot-guide-cut-meta" aria-label="선택한 컷 정보">
          <span>액션: {cut?.action}</span><span>카메라: {cut?.camera}</span><span>렌즈: {cut?.lens || '미기재'}</span><span>길이: {cut ? `${duration(cut)}초` : ''}</span>
        </div>
      </div>

      <div className="shot-guide-presets" aria-label="연출 프리셋">
        {PRESETS.map((preset) => <button type="button" className="btn" key={preset.label} onClick={() => applyPreset(preset.fields)}>{preset.label}</button>)}
      </div>

      <div className="shot-guide-fields">
        <label className="lbl">시작 화면
          <input className="field" value={fields.startFrame} onChange={(event) => update('startFrame', event.target.value)} placeholder="행동이 시작되기 전, 무엇이 즉시 읽혀야 하는지" />
        </label>
        <label className="lbl">끝 화면
          <input className="field" value={fields.endFrame} onChange={(event) => update('endFrame', event.target.value)} placeholder="행동의 어떤 결과가 보이면 되는지" />
        </label>
        <label className="lbl">카메라 이동
          <input className="field" value={fields.cameraMove} onChange={(event) => update('cameraMove', event.target.value)} placeholder="물리적으로 이어지는 이동만 적기" />
        </label>
        <label className="lbl">효과음
          <input className="field" value={fields.soundEffect} onChange={(event) => update('soundEffect', event.target.value)} placeholder="장면의 접촉·움직임에 맞는 효과음 (선택)" />
        </label>
      </div>

      <div className="shot-guide-preview">
        <div className="row" style={{justifyContent: 'space-between'}}><strong>지시문 미리보기</strong><button type="button" className="btn" onClick={copyPrompt}>{copied ? '복사됨' : '복사'}</button></div>
        <p className="shot-guide-copy-status" aria-live="polite">{copyError}</p>
        <pre>{prompt}</pre>
      </div>

      <div className="shot-guide-checklist">
        <strong>검수 참고</strong>
        <ul>
          <li>첫 프레임에서 장면과 행동이 즉시 읽히는가</li>
          <li>자막과 음성의 의미·타이밍이 일치하는가</li>
          <li>효과음과 BGM의 볼륨 균형이 맞는가</li>
          <li>끝 장면이 다음 컷과 자연스럽게 연결되는가</li>
        </ul>
      </div>
    </details>
  );
}
