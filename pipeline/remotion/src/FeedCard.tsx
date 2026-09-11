import React from 'react';
import {
  AbsoluteFill,
  Audio,
  OffthreadVideo,
  Sequence,
  useCurrentFrame,
} from 'remotion';

import type {Line, Timeline} from './Short';
import {resolveAsset, selectComment} from './template';

const FONT = "'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif";
const AVATAR_COLORS = ['#e8590c', '#2f9e44', '#1971c2', '#9c36b5', '#c2255c', '#0c8599'];

const clamp = (lines: number): React.CSSProperties => ({
  display: '-webkit-box',
  WebkitBoxOrient: 'vertical',
  WebkitLineClamp: lines,
  overflow: 'hidden',
});

const subtitleFontSize = (text: string) => {
  if (text.length <= 18) {
    return 60;
  }
  if (text.length <= 30) {
    return 52;
  }
  return 44;
};

const ActiveSubtitle: React.FC<{line: Line | undefined; now: number}> = ({line, now}) => {
  if (!line) {
    return null;
  }

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: 190,
        boxSizing: 'border-box',
        padding: '0 48px 30px',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        background: 'linear-gradient(to bottom, transparent, rgba(0,0,0,0.82))',
        color: '#fff',
        fontFamily: FONT,
        fontSize: subtitleFontSize(line.text),
        fontWeight: 800,
        lineHeight: 1.15,
        textAlign: 'center',
        textShadow: '0 3px 10px rgba(0,0,0,0.9)',
        wordBreak: 'keep-all',
        ...clamp(3),
      }}
    >
      <span>
        {line.words.length > 0
          ? line.words.map((word, index) => (
              <React.Fragment key={`${word.start}-${index}`}>
                <span style={{color: now >= word.start && now < word.end ? '#ffd43b' : '#fff'}}>
                  {word.text}
                </span>
                {index < line.words.length - 1 ? ' ' : null}
              </React.Fragment>
            ))
          : line.text}
      </span>
    </div>
  );
};

export const FeedCard: React.FC<Timeline & {theme: 'light' | 'dark'}> = ({
  fps,
  title,
  hook,
  lines,
  comments,
  narration,
  bgm,
  channelLabel,
  theme,
  assetBase,
}) => {
  const asset = (name: string) => resolveAsset(assetBase, name);
  const frame = useCurrentFrame();
  const now = frame / fps;
  const activeLine = lines.find((line) => now >= line.start && now < line.end);
  const comment = selectComment(comments, now);
  const commentIndex = comment ? comments.indexOf(comment) : 0;
  const isLight = theme === 'light';
  const toFrames = (seconds: number) => Math.round(seconds * fps);

  return (
    <AbsoluteFill style={{backgroundColor: '#11131c'}}>
      <div
        style={{
          position: 'absolute',
          left: 36,
          top: 32,
          width: 1008,
          height: 1856,
          borderRadius: 58,
          overflow: 'hidden',
          fontFamily: FONT,
          backgroundColor: isLight ? '#fff' : '#000',
          backgroundImage: isLight
            ? 'linear-gradient(#e8ebf0 1px, transparent 1px), linear-gradient(90deg, #e8ebf0 1px, transparent 1px)'
            : undefined,
          backgroundSize: isLight ? '32px 32px' : undefined,
          color: isLight ? '#111827' : '#fff',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: '100%',
            height: 330,
            boxSizing: 'border-box',
            padding: '34px 64px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 20,
            textAlign: 'center',
            borderBottom: isLight ? undefined : '1px solid #161616',
          }}
        >
          <div
            style={{
              width: '100%',
              fontSize: 54,
              fontWeight: 800,
              lineHeight: 1.08,
              ...clamp(2),
            }}
          >
            {title}
          </div>
          <div
            style={{
              width: '100%',
              color: isLight ? '#2563eb' : '#22d3ee',
              fontSize: 60,
              fontWeight: 900,
              lineHeight: 1.08,
              ...clamp(2),
            }}
          >
            {hook}
          </div>
        </div>

        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 330,
            width: '100%',
            height: 850,
            overflow: 'hidden',
            backgroundColor: '#000',
          }}
        >
          {lines.map((line) => (
            <Sequence
              key={line.n}
              from={toFrames(line.start)}
              durationInFrames={Math.max(1, toFrames(line.end - line.start))}
            >
              <OffthreadVideo
                src={asset(line.clip)}
                // 내레이션이 없으면 원음이 콘텐츠다. 있으면 클립 소리는 방해만 된다.
                muted={Boolean(narration)}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: line.mediaLayout === 'portrait' ? 'contain' : 'cover',
                  objectPosition: line.mediaLayout === 'portrait' ? '50% 50%' : '50% 28%',
                  backgroundColor: '#000',
                }}
              />
            </Sequence>
          ))}
          <ActiveSubtitle line={activeLine} now={now} />
        </div>

        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 1180,
            width: '100%',
            height: 176,
            boxSizing: 'border-box',
            display: 'flex',
            alignItems: 'center',
            gap: 22,
            padding: '22px 48px',
            backgroundColor: comment ? (isLight ? '#fff' : '#f4f4f5') : 'transparent',
            borderTop: !isLight && comment ? '1px solid #161616' : undefined,
            borderBottom: !isLight && comment ? '1px solid #161616' : undefined,
            color: '#111',
          }}
        >
          {comment ? (
            <>
              <div
                style={{
                  width: 82,
                  height: 82,
                  borderRadius: '50%',
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: AVATAR_COLORS[commentIndex % AVATAR_COLORS.length],
                  color: '#fff',
                  fontSize: 36,
                  fontWeight: 800,
                }}
              >
                {comment.nick.slice(0, 1)}
              </div>
              <div style={{minWidth: 0, flex: 1}}>
                <div
                  style={{
                    marginBottom: 8,
                    overflow: 'hidden',
                    color: '#606770',
                    fontSize: 24,
                    fontWeight: 700,
                    lineHeight: 1.1,
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {comment.nick}
                </div>
                <div
                  style={{
                    fontSize: 34,
                    fontWeight: 650,
                    lineHeight: 1.2,
                    ...clamp(2),
                  }}
                >
                  {comment.text}
                </div>
              </div>
            </>
          ) : null}
        </div>

        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 1356,
            width: '100%',
            height: 112,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxSizing: 'border-box',
            borderBottom: isLight ? undefined : '1px solid #161616',
            color: isLight ? '#334155' : '#fff',
            fontSize: 30,
            fontWeight: 800,
            letterSpacing: 5,
          }}
        >
          {channelLabel || 'SHORTFORM'}
        </div>
      </div>

      {narration ? <Audio src={asset(narration)} /> : null}
      {bgm ? <Audio src={asset(bgm)} volume={0.1} loop /> : null}
    </AbsoluteFill>
  );
};
