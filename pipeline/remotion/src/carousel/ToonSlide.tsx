import React from 'react';

import {AdMark, CAROUSEL_FONT, carouselAsset} from './CardSlide';
import {PANELS_PER_LAYOUT, SLIDE_HEIGHT, SLIDE_WIDTH, type Bubble, type ToonPanel, type ToonSlideProps} from './types';

const GUTTER = 24;

const BubbleView: React.FC<{bubble: Bubble}> = ({bubble}) => {
  const narration = bubble.kind === 'narration';
  const thought = bubble.kind === 'thought';
  return (
    <div
      style={{
        position: 'absolute',
        left: `${bubble.x}%`,
        top: `${bubble.y}%`,
        transform: 'translate(-50%, -50%)',
        width: 'max-content',
        maxWidth: '78%',
        boxSizing: 'border-box',
        padding: narration ? '14px 22px' : '18px 30px',
        background: narration ? '#fff8d6' : '#fff',
        border: '4px solid #111',
        borderRadius: narration ? 6 : thought ? 48 : 999,
        borderStyle: thought ? 'dashed' : 'solid',
        color: '#111',
        fontSize: 38,
        fontWeight: narration ? 600 : 800,
        lineHeight: 1.35,
        textAlign: 'center',
        whiteSpace: 'pre-line',
        wordBreak: 'keep-all',
      }}
    >
      {bubble.text}
    </div>
  );
};

const PanelView: React.FC<{panel: ToonPanel | undefined; assetBase?: string}> = ({panel, assetBase}) => (
  <div style={{position: 'relative', overflow: 'hidden', border: '5px solid #111', borderRadius: 10, background: '#f1f1ee'}}>
    {panel?.image ? (
      <img src={carouselAsset(assetBase, panel.image)} alt="" style={{position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover'}} />
    ) : (
      <div style={{position: 'absolute', inset: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', fontSize: 30, textAlign: 'center', whiteSpace: 'pre-line'}}>
        {panel?.scene || '(장면 미정)'}
      </div>
    )}
    {panel?.bubbles.map((b, i) => <BubbleView key={i} bubble={b} />)}
  </div>
);

export const ToonSlide: React.FC<ToonSlideProps> = ({slide, index, total, title, sponsored, assetBase}) => {
  const count = PANELS_PER_LAYOUT[slide.layout];
  const grid: React.CSSProperties =
    slide.layout === 'single'
      ? {gridTemplateColumns: '1fr', gridTemplateRows: '1fr'}
      : slide.layout === 'two'
        ? {gridTemplateColumns: '1fr', gridTemplateRows: '1fr 1fr'}
        : {gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr'};

  return (
    <div
      style={{
        position: 'relative',
        width: SLIDE_WIDTH,
        height: SLIDE_HEIGHT,
        background: '#fff',
        fontFamily: CAROUSEL_FONT,
        padding: 40,
        paddingBottom: 90,
        boxSizing: 'border-box',
      }}
    >
      <div style={{display: 'grid', gap: GUTTER, width: '100%', height: '100%', ...grid}}>
        {Array.from({length: count}, (_, i) => (
          <PanelView key={i} panel={slide.panels[i]} assetBase={assetBase} />
        ))}
      </div>
      <div style={{position: 'absolute', left: 48, right: 48, bottom: 28, display: 'flex', justifyContent: 'space-between', color: '#777', fontSize: 28, fontWeight: 600}}>
        <span>{title}</span>
        <span>
          {index + 1} / {total}
        </span>
      </div>
      {sponsored && index === 0 ? <AdMark /> : null}
    </div>
  );
};
