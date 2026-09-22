import React from 'react';
import {staticFile} from 'remotion';

import {SLIDE_HEIGHT, SLIDE_WIDTH, type CardSlideProps} from './types';

export const CAROUSEL_FONT = "'Pretendard', 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif";

export const carouselAsset = (assetBase: string | undefined, rel: string): string =>
  assetBase ? `${assetBase}${encodeURIComponent(rel)}` : staticFile(rel);

const titleSize = (text: string, cover: boolean) => {
  const n = text.length;
  if (cover) return n <= 12 ? 104 : n <= 22 ? 88 : 72;
  return n <= 16 ? 72 : n <= 28 ? 60 : 50;
};

export const AdMark: React.FC = () => (
  <div
    style={{
      position: 'absolute',
      top: 48,
      right: 56,
      padding: '8px 20px',
      borderRadius: 999,
      background: 'rgba(0,0,0,0.72)',
      color: '#fff',
      fontSize: 34,
      fontWeight: 800,
      letterSpacing: 1,
    }}
  >
    광고
  </div>
);

export const CardSlide: React.FC<CardSlideProps> = ({slide, index, total, theme, brand, sponsored, assetBase}) => {
  const cover = slide.role === 'cover';
  const cta = slide.role === 'cta';
  const img = slide.image ? carouselAsset(assetBase, slide.image) : null;

  return (
    <div
      style={{
        position: 'relative',
        width: SLIDE_WIDTH,
        height: SLIDE_HEIGHT,
        overflow: 'hidden',
        background: theme.bg,
        color: theme.fg,
        fontFamily: CAROUSEL_FONT,
        wordBreak: 'keep-all',
      }}
    >
      {img ? (
        <img
          src={img}
          alt=""
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: cover ? '100%' : '46%',
            objectFit: 'cover',
          }}
        />
      ) : null}
      {img && cover ? (
        <div style={{position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0) 30%, rgba(0,0,0,0.78) 100%)'}} />
      ) : null}

      <div
        style={{
          position: 'absolute',
          left: 88,
          right: 88,
          top: cover ? undefined : img ? '50%' : 150,
          bottom: cover ? 150 : undefined,
          display: 'flex',
          flexDirection: 'column',
          gap: 32,
          color: img && cover ? '#fff' : theme.fg,
          textAlign: cta ? 'center' : 'left',
          alignItems: cta ? 'center' : 'flex-start',
        }}
      >
        {slide.eyebrow ? (
          <div style={{fontSize: 36, fontWeight: 700, color: img && cover ? '#fff' : theme.accent}}>{slide.eyebrow}</div>
        ) : null}
        <div style={{fontSize: titleSize(slide.title, cover), fontWeight: 900, lineHeight: 1.22, whiteSpace: 'pre-line'}}>{slide.title}</div>
        {slide.body ? (
          <div style={{fontSize: 42, fontWeight: 500, lineHeight: 1.55, opacity: 0.9, whiteSpace: 'pre-line'}}>{slide.body}</div>
        ) : null}
        {cta ? (
          <div style={{marginTop: 24, padding: '20px 48px', borderRadius: 999, background: theme.accent, color: theme.bg, fontSize: 40, fontWeight: 800}}>
            저장해두고 다시 보기
          </div>
        ) : null}
      </div>

      <div
        style={{
          position: 'absolute',
          left: 88,
          right: 88,
          bottom: 56,
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 30,
          fontWeight: 600,
          color: img && cover ? '#fff' : theme.fg,
          opacity: 0.6,
        }}
      >
        <span>{brand}</span>
        <span>
          {index + 1} / {total}
        </span>
      </div>

      {sponsored && cover ? <AdMark /> : null}
    </div>
  );
};
