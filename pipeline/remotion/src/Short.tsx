import React from 'react';
import {
  AbsoluteFill,
  Audio,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

import {FeedCard} from './FeedCard';
import {resolveTimelineTemplate} from './template';

export type Word = {text: string; start: number; end: number};

export type Line = {
  n: number;
  text: string;
  start: number;
  end: number;
  words: Word[];
  clip: string;
  mediaLayout?: 'landscape' | 'portrait';
};

export type CommentCard = {at: number; nick: string; text: string};

export type Timeline = {
  fps: number;
  width: number;
  height: number;
  durationSec: number;
  title: string;
  hook: string;
  lines: Line[];
  comments: CommentCard[];
  narration: string;
  bgm: string | null;
  template?: string;
  templateName?: string;
  channelLabel?: string;
};

const FONT = "'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif";
const CARD_SECONDS = 3.4;
const AVATAR_COLORS = ['#e8590c', '#2f9e44', '#1971c2', '#9c36b5', '#c2255c', '#0c8599'];

const asset = (name: string) => staticFile(`ep/${name}`);

/** 문장 자막. 지금 읽고 있는 단어만 노란색으로 띄운다. */
const Subtitles: React.FC<{lines: Line[]}> = ({lines}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const now = frame / fps;

  const line = lines.find((l) => now >= l.start && now < l.end);
  if (!line) {
    return null;
  }

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'flex-end',
        alignItems: 'center',
        paddingBottom: 520,
        paddingLeft: 70,
        paddingRight: 70,
      }}
    >
      <div
        style={{
          fontFamily: FONT,
          fontSize: 74,
          fontWeight: 800,
          lineHeight: 1.28,
          textAlign: 'center',
          color: '#ffffff',
          textShadow: '0 6px 18px rgba(0,0,0,0.85), 0 0 3px rgba(0,0,0,0.9)',
          WebkitTextStroke: '3px rgba(0,0,0,0.55)',
          // 한국어는 어절 안에서 끊기면 읽기 나빠진다. 띄어쓰기에서만 줄을 넘긴다.
          wordBreak: 'keep-all',
          overflowWrap: 'break-word',
        }}
      >
        {line.words.length > 0
          ? line.words.map((word, index) => {
              const active = now >= word.start && now < word.end;
              return (
                <span
                  key={index}
                  style={{
                    color: active ? '#ffd43b' : '#ffffff',
                    display: 'inline-block', // 어절 단위로만 줄바꿈되게
                    marginRight: 18,
                  }}
                >
                  {word.text}
                </span>
              );
            })
          : line.text}
      </div>
    </AbsoluteFill>
  );
};

/** 댓글 카드. 화면 아래에서 스프링으로 올라온다. */
const Comment: React.FC<{comment: CommentCard; index: number}> = ({comment, index}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const rise = spring({frame, fps, config: {damping: 200}, durationInFrames: 12});
  const fade = interpolate(
    frame,
    [0, 8, CARD_SECONDS * fps - 10, CARD_SECONDS * fps],
    [0, 1, 1, 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}
  );
  const color = AVATAR_COLORS[index % AVATAR_COLORS.length];

  return (
    <AbsoluteFill style={{justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 210}}>
      <div
        style={{
          opacity: fade,
          transform: `translateY(${interpolate(rise, [0, 1], [90, 0])}px)`,
          width: 900,
          display: 'flex',
          gap: 22,
          alignItems: 'flex-start',
          background: 'rgba(255,255,255,0.97)',
          borderRadius: 28,
          padding: '26px 30px',
          boxShadow: '0 14px 40px rgba(0,0,0,0.45)',
          fontFamily: FONT,
        }}
      >
        <div
          style={{
            width: 66,
            height: 66,
            flexShrink: 0,
            borderRadius: '50%',
            background: color,
            color: '#fff',
            fontSize: 32,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {comment.nick.slice(0, 1)}
        </div>
        <div>
          <div style={{fontSize: 28, fontWeight: 700, color: '#606770', marginBottom: 8}}>
            {comment.nick}
          </div>
          <div style={{fontSize: 38, fontWeight: 600, color: '#111', lineHeight: 1.35}}>
            {comment.text}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const LegacyShort: React.FC<Timeline> = ({
  fps,
  lines,
  comments,
  narration,
  bgm,
}) => {
  const toFrames = (seconds: number) => Math.round(seconds * fps);

  return (
    <AbsoluteFill style={{backgroundColor: '#000'}}>
      {lines.map((line) => (
        <Sequence
          key={line.n}
          from={toFrames(line.start)}
          durationInFrames={Math.max(1, toFrames(line.end - line.start))}
        >
          <OffthreadVideo
            src={asset(line.clip)}
            muted
            style={{width: '100%', height: '100%', objectFit: 'cover'}}
          />
        </Sequence>
      ))}

      {/* 자막이 어떤 배경에서도 읽히도록 아래쪽을 어둡게 깐다 */}
      <AbsoluteFill
        style={{
          background:
            'linear-gradient(to bottom, rgba(0,0,0,0.30) 0%, rgba(0,0,0,0) 26%, rgba(0,0,0,0) 44%, rgba(0,0,0,0.55) 100%)',
        }}
      />

      <Subtitles lines={lines} />

      {comments.map((comment, index) => (
        <Sequence
          key={index}
          from={toFrames(comment.at)}
          durationInFrames={toFrames(CARD_SECONDS)}
        >
          <Comment comment={comment} index={index} />
        </Sequence>
      ))}

      {narration ? <Audio src={asset(narration)} /> : null}
      {bgm ? <Audio src={asset(bgm)} volume={0.1} loop /> : null}
    </AbsoluteFill>
  );
};

const InvalidTemplate: React.FC<{id: string}> = ({id}) => (
  <AbsoluteFill
    style={{
      backgroundColor: '#d00000',
      color: '#fff',
      fontFamily: FONT,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 70,
      boxSizing: 'border-box',
      textAlign: 'center',
      fontSize: 64,
      fontWeight: 800,
      lineHeight: 1.2,
    }}
  >
    Unknown template: {id}
  </AbsoluteFill>
);

export const Short: React.FC<Timeline> = (props) => {
  const template = resolveTimelineTemplate(props);

  if (template.kind === 'invalid') {
    return <InvalidTemplate id={template.id} />;
  }

  if (template.theme === 'legacy') {
    return <LegacyShort {...props} />;
  }

  return <FeedCard {...props} theme={template.theme} />;
};
