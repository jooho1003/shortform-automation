import React from 'react';
import {AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, staticFile} from 'remotion';

export type StudioClip = {path: string; kind: 'image' | 'video'; duration: number; trimStart: number; caption: string};
export type StudioProps = {clips: StudioClip[]; audio: string | null; ratio: string; preview?: boolean};
export const studioDimensions = (ratio: string) => ratio === '16:9' ? {width: 1920, height: 1080} : ratio === '1:1' ? {width: 1080, height: 1080} : {width: 1080, height: 1920};
export const studioFrames = (clips: StudioClip[]) => Math.max(1, clips.reduce((n, c) => n + Math.max(1, Math.round(c.duration * 30)), 0));

export const Studio: React.FC<StudioProps> = ({clips, audio, preview}) => {
  const src = (path: string) => preview ? `/api/media?path=${encodeURIComponent(path)}` : staticFile(path);
  let offset = 0;
  return <AbsoluteFill style={{backgroundColor: '#111315'}}>
    {clips.map((clip, i) => {
      const frames = Math.max(1, Math.round(clip.duration * 30));
      const from = offset;
      offset += frames;
      return <Sequence key={i} from={from} durationInFrames={frames}>
        {clip.kind === 'image' ? <Img src={src(clip.path)} style={{width: '100%', height: '100%', objectFit: 'cover'}} /> : <OffthreadVideo src={src(clip.path)} trimBefore={Math.round(clip.trimStart * 30)} muted={Boolean(audio)} style={{width: '100%', height: '100%', objectFit: 'cover'}} />}
        {clip.caption && <AbsoluteFill style={{justifyContent: 'flex-end', alignItems: 'center', padding: '8% 6%'}}><div style={{color: 'white', background: '#000b', borderRadius: 16, padding: '16px 24px', fontFamily: 'Malgun Gothic, sans-serif', fontSize: 48, fontWeight: 700, textAlign: 'center', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere'}}>{clip.caption}</div></AbsoluteFill>}
      </Sequence>;
    })}
    {audio && <Audio src={src(audio)} />}
  </AbsoluteFill>;
};
