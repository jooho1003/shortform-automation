import React from 'react';
import {AbsoluteFill} from 'remotion';

export type BlogThumbProps = {
  title: string;
  keyword: string;
  niche: string;
};

export const BlogThumb: React.FC<BlogThumbProps> = ({title, keyword, niche}) => {
  return (
    <AbsoluteFill
      style={{
        boxSizing: 'border-box',
        background: 'linear-gradient(135deg, #effbf4 0%, #d8f3e5 54%, #fff8df 100%)',
        color: '#14372a',
        fontFamily: 'Arial, "Malgun Gothic", sans-serif',
        padding: 72,
        overflow: 'hidden',
      }}
    >
      <div style={{position: 'absolute', width: 430, height: 430, borderRadius: 999, background: '#19a866', right: -90, top: -120, opacity: 0.13}} />
      <div style={{position: 'absolute', width: 300, height: 300, borderRadius: 999, background: '#ffc83d', right: 120, bottom: -140, opacity: 0.24}} />
      <div style={{display: 'flex', alignItems: 'center', gap: 18, fontWeight: 700, fontSize: 30, color: '#16865a'}}>
        <span style={{width: 44, height: 8, borderRadius: 99, background: '#18a66a'}} />
        {niche}
      </div>
      <div style={{marginTop: 52, maxWidth: 850, fontSize: 64, lineHeight: 1.18, fontWeight: 900, letterSpacing: -2.8, wordBreak: 'keep-all'}}>{title}</div>
      <div style={{position: 'absolute', left: 72, bottom: 66, display: 'inline-flex', alignItems: 'center', padding: '16px 28px', borderRadius: 999, background: '#14372a', color: 'white', fontSize: 27, fontWeight: 700}}>
        {keyword}
      </div>
      <div style={{position: 'absolute', right: 78, bottom: 58, width: 190, height: 145, borderRadius: 32, background: 'rgba(255,255,255,.72)', border: '3px solid rgba(20,55,42,.12)', transform: 'rotate(-4deg)', display: 'grid', placeItems: 'center', fontSize: 76}}>
        ✍️
      </div>
    </AbsoluteFill>
  );
};
