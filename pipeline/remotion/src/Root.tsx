import React from 'react';
import {Composition, Still} from 'remotion';

import {CardSlide} from './carousel/CardSlide';
import {ToonSlide} from './carousel/ToonSlide';
import {SLIDE_HEIGHT, SLIDE_WIDTH, type CardSlideProps, type ToonSlideProps} from './carousel/types';
import {GeoStory, type GeoStoryProps} from './c-motion/GeoStory';
import {BlogThumb, type BlogThumbProps} from './blog/Thumb';
import {Short, Timeline} from './Short';
import {Studio, studioDimensions, studioFrames, type StudioProps} from './Studio';

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

const cardFallback: CardSlideProps = {
  slide: {role: 'cover', eyebrow: '', title: '미리보기', body: '', image: null},
  index: 0,
  total: 1,
  theme: {bg: '#111318', fg: '#f5f5f2', accent: '#ffd43b'},
  brand: '',
  sponsored: false,
};

const toonFallback: ToonSlideProps = {
  slide: {layout: 'single', panels: []},
  index: 0,
  total: 1,
  title: '미리보기',
  sponsored: false,
};

const geoStoryFallback: GeoStoryProps = {};
const blogThumbFallback: BlogThumbProps = {
  title: '한 번 만들어 두면 일이 줄어드는 콘텐츠 자동화',
  keyword: '콘텐츠 자동화',
  niche: '1인 사업자의 AI 제작 노트',
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
    <Composition id="Studio" component={Studio} defaultProps={{clips: [], audio: null, ratio: '9:16'} as StudioProps} fps={30} width={1080} height={1920} durationInFrames={30} calculateMetadata={({props}) => ({...studioDimensions(props.ratio), durationInFrames: studioFrames(props.clips)})} />
    <Still id="CardSlide" component={CardSlide} defaultProps={cardFallback} width={SLIDE_WIDTH} height={SLIDE_HEIGHT} />
    <Still id="ToonSlide" component={ToonSlide} defaultProps={toonFallback} width={SLIDE_WIDTH} height={SLIDE_HEIGHT} />
    <Still id="BlogThumb" component={BlogThumb} defaultProps={blogThumbFallback} width={1200} height={630} />
    <Composition
      id="GeoStorySample"
      component={GeoStory}
      defaultProps={geoStoryFallback}
      fps={60}
      width={1080}
      height={1920}
      durationInFrames={720}
    />
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
