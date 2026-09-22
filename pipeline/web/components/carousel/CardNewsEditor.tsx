'use client';

import {useState} from 'react';

import {CardSlide} from '@composition/carousel/CardSlide';
import {API_MAX_SLIDES, HARD_MAX_SLIDES, type CardRole, type CardSlideData} from '@composition/carousel/types';
import type {CardNewsProject} from '@/lib/carousel';

import {CarouselMeta, LintBox, SaveBar} from './parts';
import {MEDIA_BASE, SlideFrame} from './SlideFrame';
import {useCarouselDoc, type Lint} from './useCarouselDoc';

const ROLE_LABEL: Record<CardRole, string> = {cover: '표지', body: '본문', cta: 'CTA'};

export function CardNewsEditor({project, lint: initialLint}: {project: CardNewsProject; lint: Lint}) {
  const {doc, patch, save, lint, dirty, saving, error} = useCarouselDoc(project, initialLint);
  const [sel, setSel] = useState(0);
  const slide = doc.slides[sel] ?? doc.slides[0];

  const setSlide = (fn: (s: CardSlideData) => CardSlideData) =>
    patch((d) => ({...d, slides: d.slides.map((s, i) => (i === sel ? fn(s) : s))}));

  const addSlide = () => {
    const at = Math.max(1, doc.slides.length - (doc.slides.at(-1)?.role === 'cta' ? 1 : 0));
    patch((d) => {
      const slides = [...d.slides];
      slides.splice(at, 0, {role: 'body', eyebrow: '', title: '', body: '', image: null});
      return {...d, slides};
    });
    setSel(at);
  };

  const move = (dir: -1 | 1) => {
    const to = sel + dir;
    if (to < 0 || to >= doc.slides.length) return;
    patch((d) => {
      const slides = [...d.slides];
      [slides[sel], slides[to]] = [slides[to], slides[sel]];
      return {...d, slides};
    });
    setSel(to);
  };

  const remove = () => {
    if (doc.slides.length <= 1) return;
    patch((d) => ({...d, slides: d.slides.filter((_, i) => i !== sel)}));
    setSel(Math.max(0, sel - 1));
  };

  const render = (s: CardSlideData, i: number) => (
    <CardSlide slide={s} index={i} total={doc.slides.length} theme={doc.theme} brand={doc.brand_name} sponsored={doc.sponsored} assetBase={MEDIA_BASE} />
  );

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
              {i + 1}. {ROLE_LABEL[s.role]}
              {i === API_MAX_SLIDES ? ' ⚠' : ''}
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
              <strong>{sel + 1}장 편집</strong>
              <div className="row">
                <button className="btn sm" onClick={() => move(-1)} disabled={sel === 0}>
                  ←
                </button>
                <button className="btn sm" onClick={() => move(1)} disabled={sel === doc.slides.length - 1}>
                  →
                </button>
                <button className="btn sm danger" onClick={remove} disabled={doc.slides.length <= 1}>
                  삭제
                </button>
              </div>
            </div>
            <label>
              역할
              <select className="field" value={slide.role} onChange={(e) => setSlide((s) => ({...s, role: e.target.value as CardRole}))}>
                <option value="cover">표지 — 후킹 제목</option>
                <option value="body">본문 — 한 장 한 메시지</option>
                <option value="cta">CTA — 저장·팔로우 유도</option>
              </select>
            </label>
            <label>
              머리말(작은 글씨)
              <input className="field" value={slide.eyebrow} onChange={(e) => setSlide((s) => ({...s, eyebrow: e.target.value}))} />
            </label>
            <label>
              제목 <span className="faint">{slide.title.length}자</span>
              <textarea className="field" value={slide.title} onChange={(e) => setSlide((s) => ({...s, title: e.target.value}))} />
            </label>
            <label>
              본문 <span className="faint">2~3줄 권장</span>
              <textarea className="field" value={slide.body} onChange={(e) => setSlide((s) => ({...s, body: e.target.value}))} />
            </label>
            <label>
              배경 이미지 (저장소 기준 경로, 글자 없는 이미지)
              <input className="field mono" placeholder={`카드뉴스/${doc.id}/이미지/${String(sel + 1).padStart(2, '0')}.png`} value={slide.image ?? ''} onChange={(e) => setSlide((s) => ({...s, image: e.target.value.trim() || null}))} />
            </label>
          </div>

          <div className="card carousel-form">
            <strong>테마</strong>
            <div className="row">
              {(['bg', 'fg', 'accent'] as const).map((k) => (
                <label key={k} style={{gridAutoFlow: 'column', alignItems: 'center'}}>
                  {k === 'bg' ? '배경' : k === 'fg' ? '글자' : '강조'}
                  <input type="color" value={doc.theme[k]} onChange={(e) => patch((d) => ({...d, theme: {...d.theme, [k]: e.target.value}}))} />
                </label>
              ))}
            </div>
            <label>
              주제
              <input className="field" value={doc.topic} onChange={(e) => patch((d) => ({...d, topic: e.target.value}))} />
            </label>
            <label>
              타깃 독자
              <input className="field" placeholder="예: 20대 후반 사무직, 피부 고민 초보" value={doc.audience} onChange={(e) => patch((d) => ({...d, audience: e.target.value}))} />
            </label>
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
