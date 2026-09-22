'use client';

import {useState} from 'react';

import {ToonSlide} from '@composition/carousel/ToonSlide';
import {HARD_MAX_SLIDES, PANELS_PER_LAYOUT, type Bubble, type ToonLayout, type ToonPanel, type ToonSlideData} from '@composition/carousel/types';
import type {InstatoonProject, ToonCharacter} from '@/lib/carousel';

import {CarouselMeta, LintBox, SaveBar} from './parts';
import {MEDIA_BASE, SlideFrame} from './SlideFrame';
import {useCarouselDoc, type Lint} from './useCarouselDoc';

const emptyPanel = (): ToonPanel => ({scene: '', image: null, bubbles: []});

/** 레이아웃 칸 수에 패널 배열을 맞춘다(남는 패널은 버리지 않고 뒤에 둔다 — 저장 시 서버가 자른다). */
const fit = (panels: ToonPanel[], layout: ToonLayout) => {
  const need = PANELS_PER_LAYOUT[layout];
  return panels.length >= need ? panels : [...panels, ...Array.from({length: need - panels.length}, emptyPanel)];
};

export function InstatoonEditor({project, lint: initialLint}: {project: InstatoonProject; lint: Lint}) {
  const {doc, patch, save, lint, dirty, saving, error} = useCarouselDoc(project, initialLint);
  const [sel, setSel] = useState(0);
  const slide = doc.slides[sel] ?? doc.slides[0];

  const setSlide = (fn: (s: ToonSlideData) => ToonSlideData) => patch((d) => ({...d, slides: d.slides.map((s, i) => (i === sel ? fn(s) : s))}));
  const setPanel = (pi: number, fn: (p: ToonPanel) => ToonPanel) => setSlide((s) => ({...s, panels: s.panels.map((p, i) => (i === pi ? fn(p) : p))}));
  const setBubble = (pi: number, bi: number, fn: (b: Bubble) => Bubble) => setPanel(pi, (p) => ({...p, bubbles: p.bubbles.map((b, i) => (i === bi ? fn(b) : b))}));
  const setChar = (ci: number, fn: (c: ToonCharacter) => ToonCharacter) => patch((d) => ({...d, characters: d.characters.map((c, i) => (i === ci ? fn(c) : c))}));

  const addSlide = () => {
    const at = sel + 1;
    patch((d) => {
      const slides = [...d.slides];
      slides.splice(at, 0, {layout: 'single', panels: [emptyPanel()]});
      return {...d, slides};
    });
    setSel(at);
  };

  const removeSlide = () => {
    if (doc.slides.length <= 1) return;
    patch((d) => ({...d, slides: d.slides.filter((_, i) => i !== sel)}));
    setSel(Math.max(0, sel - 1));
  };

  const render = (s: ToonSlideData, i: number) => (
    <ToonSlide slide={s} index={i} total={doc.slides.length} title={doc.title} sponsored={doc.sponsored} assetBase={MEDIA_BASE} />
  );

  const speakers = doc.characters.map((c) => c.name).filter(Boolean);

  return (
    <div className="grid" style={{gap: 16}}>
      <SaveBar dirty={dirty} saving={saving} error={error} onSave={save} count={doc.slides.length} />

      <div className="slide-strip">
        {doc.slides.map((s, i) => (
          <div key={i} style={{display: 'grid', gap: 4, justifyItems: 'center'}}>
            <SlideFrame width={132} active={i === sel} onClick={() => setSel(i)}>
              {render(s, i)}
            </SlideFrame>
            <span className="faint" style={{fontSize: 11}}>
              {i + 1}장 · {PANELS_PER_LAYOUT[s.layout]}컷
            </span>
          </div>
        ))}
        <button className="btn" style={{alignSelf: 'center'}} disabled={doc.slides.length >= HARD_MAX_SLIDES} onClick={addSlide}>
          + 장
        </button>
      </div>

      <div className="carousel-layout">
        <div className="grid" style={{gap: 16}}>
          <div className="card carousel-form">
            <div className="row" style={{justifyContent: 'space-between'}}>
              <strong>{sel + 1}장 콘티</strong>
              <div className="row">
                <select className="field" style={{width: 150}} value={slide.layout} onChange={(e) => setSlide((s) => ({layout: e.target.value as ToonLayout, panels: fit(s.panels, e.target.value as ToonLayout)}))}>
                  <option value="single">1컷(대형)</option>
                  <option value="two">2컷(위·아래)</option>
                  <option value="four">4컷(2×2)</option>
                </select>
                <button className="btn sm danger" onClick={removeSlide} disabled={doc.slides.length <= 1}>
                  장 삭제
                </button>
              </div>
            </div>

            {slide.panels.slice(0, PANELS_PER_LAYOUT[slide.layout]).map((p, pi) => (
              <div key={pi} className="panel-box">
                <label>
                  패널 {pi + 1} — 장면(행동·구도만. 외형은 캐릭터 락 블록이 담당)
                  <textarea className="field" value={p.scene} onChange={(e) => setPanel(pi, (x) => ({...x, scene: e.target.value}))} />
                </label>
                <label>
                  컷 이미지 경로
                  <input className="field mono" placeholder={`인스타툰/${doc.id}/컷/${String(sel + 1).padStart(2, '0')}-${pi + 1}.png`} value={p.image ?? ''} onChange={(e) => setPanel(pi, (x) => ({...x, image: e.target.value.trim() || null}))} />
                </label>
                {p.bubbles.map((b, bi) => (
                  <div key={bi} className="row" style={{alignItems: 'end'}}>
                    <select className="field" style={{width: 112}} value={b.kind} onChange={(e) => setBubble(pi, bi, (x) => ({...x, kind: e.target.value as Bubble['kind']}))}>
                      <option value="speech">대사</option>
                      <option value="thought">생각</option>
                      <option value="narration">나레이션</option>
                    </select>
                    <select className="field" style={{width: 100}} value={b.speaker} onChange={(e) => setBubble(pi, bi, (x) => ({...x, speaker: e.target.value}))}>
                      <option value="">—</option>
                      {speakers.map((n) => (
                        <option key={n}>{n}</option>
                      ))}
                    </select>
                    <input className="field" style={{flex: 1}} value={b.text} onChange={(e) => setBubble(pi, bi, (x) => ({...x, text: e.target.value}))} />
                    <input className="field" type="number" title="가로 %" style={{width: 64}} value={b.x} onChange={(e) => setBubble(pi, bi, (x) => ({...x, x: Number(e.target.value)}))} />
                    <input className="field" type="number" title="세로 %" style={{width: 64}} value={b.y} onChange={(e) => setBubble(pi, bi, (x) => ({...x, y: Number(e.target.value)}))} />
                    <button className="btn sm" onClick={() => setPanel(pi, (x) => ({...x, bubbles: x.bubbles.filter((_, i) => i !== bi)}))}>
                      ✕
                    </button>
                  </div>
                ))}
                <button
                  className="btn sm"
                  style={{justifySelf: 'start'}}
                  disabled={p.bubbles.length >= 6}
                  onClick={() => setPanel(pi, (x) => ({...x, bubbles: [...x.bubbles, {speaker: speakers[0] ?? '', text: '', kind: 'speech', x: 50, y: 18 + x.bubbles.length * 22}]}))}
                >
                  + 말풍선
                </button>
              </div>
            ))}
          </div>

          <div className="card carousel-form">
            <strong>작품 설정</strong>
            <div className="row">
              <label style={{width: 140}}>
                장르
                <select className="field" value={doc.genre} onChange={(e) => patch((d) => ({...d, genre: e.target.value as InstatoonProject['genre']}))}>
                  <option>일상툰</option>
                  <option>정보툰</option>
                  <option>광고툰</option>
                </select>
              </label>
              <label style={{flex: 1}}>
                한 줄 줄거리
                <input className="field" value={doc.logline} onChange={(e) => patch((d) => ({...d, logline: e.target.value}))} />
              </label>
            </div>
            <label>
              화풍(전 컷 공통)
              <textarea className="field" value={doc.style} onChange={(e) => patch((d) => ({...d, style: e.target.value}))} />
            </label>
          </div>

          <div className="card carousel-form">
            <div className="row" style={{justifyContent: 'space-between'}}>
              <strong>캐릭터</strong>
              <button
                className="btn sm"
                disabled={doc.characters.length >= 8}
                onClick={() => patch((d) => ({...d, characters: [...d.characters, {key: `c${d.characters.length + 1}`, name: '', lock: '', sheet: null}]}))}
              >
                + 캐릭터
              </button>
            </div>
            {doc.characters.map((c, ci) => (
              <div key={ci} className="panel-box">
                <div className="row">
                  <input className="field mono" style={{width: 90}} value={c.key} onChange={(e) => setChar(ci, (x) => ({...x, key: e.target.value}))} />
                  <input className="field" style={{flex: 1}} placeholder="이름" value={c.name} onChange={(e) => setChar(ci, (x) => ({...x, name: e.target.value}))} />
                  <button className="btn sm danger" disabled={doc.characters.length <= 1} onClick={() => patch((d) => ({...d, characters: d.characters.filter((_, i) => i !== ci)}))}>
                    삭제
                  </button>
                </div>
                <label>
                  락 블록 — 외형·헤어·의상·색·체형 (한 번 정하면 바꾸지 않음)
                  <textarea className="field" value={c.lock} onChange={(e) => setChar(ci, (x) => ({...x, lock: e.target.value}))} />
                </label>
                <label>
                  캐릭터 시트 이미지 (정면·3/4·측면 + 표정 4~6)
                  <input className="field mono" placeholder={`인스타툰/${doc.id}/캐릭터/${c.key}.png`} value={c.sheet ?? ''} onChange={(e) => setChar(ci, (x) => ({...x, sheet: e.target.value.trim() || null}))} />
                </label>
              </div>
            ))}
          </div>

          <CarouselMeta doc={doc} patch={patch} />
        </div>

        <div className="carousel-sticky grid" style={{gap: 12}}>
          <SlideFrame width={460}>{render(slide, sel)}</SlideFrame>
          <LintBox lint={lint} dirty={dirty} />
        </div>
      </div>
    </div>
  );
}
