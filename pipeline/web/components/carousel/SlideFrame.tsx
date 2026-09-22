'use client';

import type {ReactNode} from 'react';

import {SLIDE_HEIGHT, SLIDE_WIDTH} from '@composition/carousel/types';

/** 1080×1350 원본 크기 컴포넌트를 축소해 보여준다. 출력물과 같은 레이아웃. */
export function SlideFrame({width, children, active, onClick}: {width: number; children: ReactNode; active?: boolean; onClick?: () => void}) {
  const scale = width / SLIDE_WIDTH;
  return (
    <div
      onClick={onClick}
      className={`slide-frame ${active ? 'active' : ''}`}
      style={{width, height: SLIDE_HEIGHT * scale, cursor: onClick ? 'pointer' : undefined}}
    >
      <div style={{transform: `scale(${scale})`, transformOrigin: 'top left', width: SLIDE_WIDTH, height: SLIDE_HEIGHT}}>{children}</div>
    </div>
  );
}

export const MEDIA_BASE = '/api/media?path=';
