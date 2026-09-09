/**
 * 편 폴더(dir) → 산출물·게이트 파일 절대 경로.
 *
 * Python shortform/paths.py의 Episode 프로퍼티와 1:1로 대응한다. 파일명이 바뀌면 그쪽을 먼저 고치고
 * 여기를 맞춘다.
 */
import {resolveInRoot} from './safePath';

const DIR_RE = /^\d{4}-\d{2}-\d{2}\/[AB]-\d{1,3}-[^/\\]+$/;

export class InvalidEpisodeDir extends Error {}

/** 편 폴더 상대 경로(dir)가 올바른 모양인지 검사한다. 아니면 InvalidEpisodeDir. */
export function assertEpisodeDir(dir: string): void {
  if (typeof dir !== 'string' || !DIR_RE.test(dir)) {
    throw new InvalidEpisodeDir('올바르지 않은 편 폴더 경로입니다.');
  }
}

export interface EpisodePaths {
  plan_md: string;
  plan_ok: string;
  plan_fix: string;
  clips_dir: string;
  clip_list: string;
  contact_sheet: string;
  clips_ok: string;
  clips_fix: string;
  assets_dir: string;
  timeline: string;
  video_dir: string;
  final_mp4: string;
  upload_ok: string;
  result_json: string;
  state_json: string;
  logs_dir: string;
}

/** 편 폴더(dir, ROOT 상대)의 산출물·게이트 파일 절대 경로 모음. dir이 올바르지 않으면 InvalidEpisodeDir,
 *  ROOT 밖을 가리키면 PathDenied. */
export function episodePaths(dir: string): EpisodePaths {
  assertEpisodeDir(dir);
  const join = (...parts: string[]) => resolveInRoot([dir, ...parts].join('/'));
  return {
    plan_md: join('01-기획안.md'),
    plan_ok: join('01-기획-승인.txt'),
    plan_fix: join('01-기획-수정요청.txt'),
    clips_dir: join('02-이미지'),
    clip_list: join('02-이미지', '클립목록.json'),
    contact_sheet: join('02-이미지', '컨택트시트.png'),
    clips_ok: join('02-이미지-승인.txt'),
    clips_fix: join('02-이미지-수정요청.txt'),
    assets_dir: join('03-소재'),
    timeline: join('03-소재', '타임라인.json'),
    video_dir: join('04-영상'),
    final_mp4: join('04-영상', 'final.mp4'),
    upload_ok: join('04-업로드-승인.txt'),
    result_json: join('05-업로드결과.json'),
    state_json: join('상태.json'),
    logs_dir: join('로그'),
  };
}
