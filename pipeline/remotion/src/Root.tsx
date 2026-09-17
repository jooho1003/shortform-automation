import React from 'react';
import {Composition, Still} from 'remotion';

import {BlogThumb, type BlogThumbProps} from './blog/Thumb';
import {Short, Timeline} from './Short';

const fallback: Timeline = {
  fps: 30,
  width: 1080,
  height: 1920,
  durationSec: 3,
  title: '미리보기',
  hook: '',
  lines: [],
  comments: [],
  narration: '',
  bgm: null,
};

const blogThumbFallback: BlogThumbProps = {
  title: '한 번 만들어 두면 일이 줄어드는 콘텐츠 자동화',
  keyword: '콘텐츠 자동화',
  niche: '1인 사업자의 AI 제작 노트',
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
    <Still id="BlogThumb" component={BlogThumb} defaultProps={blogThumbFallback} width={1200} height={630} />
    <Composition
      id="Short"
      component={Short}
      defaultProps={fallback}
      fps={30}
      width={1080}
      height={1920}
      durationInFrames={90}
      calculateMetadata={({props}) => ({
        fps: props.fps,
        width: props.width,
        height: props.height,
        durationInFrames: Math.max(1, Math.ceil(props.durationSec * props.fps)),
      })}
    />
    </>
  );
};
