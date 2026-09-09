import React from 'react';
import {Composition} from 'remotion';

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

export const RemotionRoot: React.FC = () => {
  return (
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
  );
};
