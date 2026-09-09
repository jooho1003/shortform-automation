/**
 * 릴스 기획(숏부스터식) 데이터 계약. SSOT는 파일:
 *
 *   릴스기획/라이브러리.json                 레퍼런스 릴스 목록(즐겨찾기·태그)
 *   릴스기획/<id>/프로젝트.json              프로젝트 메타 + 레퍼런스 + 고객 설문 스냅샷
 *   릴스기획/<id>/원본.mp4 · 자막.vtt         yt-dlp가 받은 원본과 자동 자막(있을 때)
 *   릴스기획/<id>/분석.json · 분석.srt        타임스탬프 대본(+LLM 구조 분석)
 *   릴스기획/<id>/기획안.json · 기획안.md     LLM 산출물(구조화) + 사람이 읽는 렌더
 *   릴스기획/<id>/프레임/NN.jpg              스토리보드 프레임(ffmpeg 추출)
 *   릴스기획/<id>/로그/                      claude·codex·python 잡 로그
 */
import type {ClientSurvey} from './clientTypes';

export type ReelProvider = 'youtube' | 'instagram' | 'tiktok' | 'other';

export interface ReelMeta {
  url: string;
  provider: ReelProvider;
  video_id: string;
  title: string;
  author: string;
  views: number | null;
  likes: number | null;
  duration: number | null;
  thumb: string | null;
  upload_date: string | null;
}

export interface LibraryItem extends ReelMeta {
  id: string;
  tags: string[];
  favorite: boolean;
  note: string;
  added: string;
}

export interface Library {
  items: LibraryItem[];
}

export type ReelProjectStatus = 'new' | 'fetched' | 'analyzed' | 'planned' | 'exported';

export interface ReelProject {
  id: string;
  title: string;
  status: ReelProjectStatus;
  client: string | null; // 외주 고객 slug
  reference: ReelMeta;
  local_video: string | null; // ROOT 상대 (릴스기획/<id>/원본.mp4)
  survey: ClientSurvey | null; // 고객 설문 스냅샷 또는 직접 입력
  brand_name: string; // 대본에 쓸 브랜드/계정 이름
  created: string;
  updated: string;
}

export interface TranscriptCue {
  start: number;
  end: number;
  text: string;
}

export interface ReelAnalysis {
  source: 'youtube-auto-subs' | 'whisper' | 'manual';
  language: string;
  transcript: TranscriptCue[];
  /** LLM 구조 분석 */
  structure: {
    hook: string; // 0~2초 훅 문구와 왜 먹히는지
    flow: {tc: string; role: string; summary: string}[]; // 구간별 역할(문제 제기·전개·반전·CTA)
    why_it_works: string[];
    tone: string;
    cta: string;
    duration_sec: number;
  } | null;
  analyzed_at: string;
}

export interface StoryboardFrame {
  n: number;
  tc: number; // 초
  frame: string | null; // ROOT 상대 프레임 이미지
  caption: string; // 화면 자막/문구
  direction: string; // 연출 지시
}

export interface ReelPlan {
  version: number;
  target_seconds: 15 | 30 | 50;
  thumbnail_titles: string[]; // 3안
  thumbnail_style: string;
  storyboard: StoryboardFrame[];
  shooting_guide: string; // 마크다운
  script: string; // 대본(문장 단위 줄바꿈)
  caption: string; // 캡션 문구
  hashtags: string[];
  notes: string;
  provider: 'claude' | 'codex';
  generated_at: string;
  revisions: {at: string; instructions: string; target_seconds: number; provider: string}[];
}

export interface ReviseRequest {
  instructions: string; // 수정 방향
  target_seconds?: 15 | 30 | 50;
  thumbnail_style?: string;
  must_include?: string;
  must_exclude?: string;
  provider?: 'claude' | 'codex';
}
