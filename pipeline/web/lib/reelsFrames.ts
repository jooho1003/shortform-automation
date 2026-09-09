/**
 * 스토리보드 프레임 추출(ffmpeg)과 SRT 빌드.
 */
import fs from 'node:fs';
import fs2 from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';

import {REELS, relFromRoot} from './paths';
import type {TranscriptCue} from './reelsTypes';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, {windowsHide: true});
    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg 실패(code=${code}): ${stderr.slice(-2000)}`));
    });
  });
}

/** 프로젝트의 원본.mp4에서 지정한 시각들의 프레임을 jpg로 추출한다. 반환은 ROOT 상대 경로 목록. */
export async function extractFrames(id: string, times: number[]): Promise<string[]> {
  const projectDir = path.join(REELS, id);
  const video = path.join(projectDir, '원본.mp4');
  if (!fs.existsSync(video)) {
    throw new Error('원본 영상이 없습니다');
  }
  const frameDir = path.join(projectDir, '프레임');
  await fs2.mkdir(frameDir, {recursive: true});

  const results: string[] = [];
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    const out = path.join(frameDir, `${pad2(i + 1)}.jpg`);
    await runFfmpeg([
      '-y',
      '-loglevel',
      'error',
      '-ss',
      String(t),
      '-i',
      video,
      '-frames:v',
      '1',
      '-vf',
      'scale=540:-2',
      '-q:v',
      '3',
      out,
    ]);
    results.push(relFromRoot(out));
  }
  return results;
}

function srtTimestamp(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const rem = ms % 1000;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)},${String(rem).padStart(3, '0')}`;
}

/** 표준 SRT 문자열을 만든다. */
export function buildSrt(cues: TranscriptCue[]): string {
  return cues
    .map((cue, i) => {
      const idx = i + 1;
      return `${idx}\n${srtTimestamp(cue.start)} --> ${srtTimestamp(cue.end)}\n${cue.text}\n`;
    })
    .join('\n');
}
