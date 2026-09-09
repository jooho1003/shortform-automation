'use client';

import {Player, type PlayerRef} from '@remotion/player';
import {useMemo, useRef} from 'react';

import {Short} from '@composition/Short';
import type {Timeline} from '@/lib/types';

/**
 * 렌더 없이 브라우저에서 타임라인을 재생한다.
 *
 * 타임라인의 clip/narration/bgm은 03-소재 기준 상대 경로다. assetBase로
 * "/api/media?path=<회차>/03-소재/" 를 넣으면 컴포지션이 그 뒤에 파일명을 붙여 요청한다.
 * bgm은 pipeline/assets/bgm/ 에 있으므로 상대 경로로 올려 보낸다(경계 가드는 ROOT 안이면 통과).
 */
export function PlayerPane({timeline, episodeDir, height = 640}: {timeline: Timeline; episodeDir: string; height?: number}) {
  const ref = useRef<PlayerRef>(null);
  const props = useMemo<Timeline>(() => {
    const assetBase = '/api/media?path=' + encodeURIComponent(`${episodeDir}/03-소재/`);
    return {
      ...timeline,
      assetBase,
      bgm: timeline.bgm ? `../../../pipeline/assets/bgm/${timeline.bgm}` : null,
    };
  }, [timeline, episodeDir]);

  const fps = timeline.fps || 30;
  const durationInFrames = Math.max(1, Math.ceil((timeline.durationSec || 1) * fps));
  const width = Math.round((height * (timeline.width || 1080)) / (timeline.height || 1920));

  return (
    <div className="row" style={{alignItems: 'flex-start', gap: 16}}>
      <div style={{width, height, borderRadius: 12, overflow: 'hidden', background: '#000', flexShrink: 0}}>
        <Player
          ref={ref}
          component={Short}
          inputProps={props}
          durationInFrames={durationInFrames}
          fps={fps}
          compositionWidth={timeline.width || 1080}
          compositionHeight={timeline.height || 1920}
          style={{width, height}}
          controls
          loop
          clickToPlay
          showVolumeControls
          acknowledgeRemotionLicense
        />
      </div>
      <div className="card" style={{flex: 1, minWidth: 240}}>
        <div className="kv">
          <dt>길이</dt>
          <dd>{(timeline.durationSec ?? 0).toFixed(1)}초 · {durationInFrames}f @ {fps}fps</dd>
          <dt>템플릿</dt>
          <dd>{timeline.templateName ?? timeline.template ?? '브리핑 포커스'}</dd>
          <dt>라인</dt>
          <dd>{timeline.lines?.length ?? 0}개</dd>
          <dt>댓글 카드</dt>
          <dd>{timeline.comments?.length ?? 0}개</dd>
          <dt>내레이션</dt>
          <dd>{timeline.narration || '없음'}</dd>
          <dt>BGM</dt>
          <dd>{timeline.bgm || '없음'}</dd>
        </div>
        <p className="faint" style={{marginBottom: 0}}>
          같은 React 컴포넌트가 렌더에도 쓰입니다. 여기서 보이는 그대로 mp4가 나옵니다(폰트·코덱 차이 제외).
        </p>
      </div>
    </div>
  );
}
