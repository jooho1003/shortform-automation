/**
 * 외주 고객 관리 타입 계약.
 *
 * SSOT는 flat 파일이다: 외주/<slug>/고객.json, 외주/<slug>/<YYYY-MM>/월간.json.
 * 패키지 카탈로그는 pipeline/config/packages.yaml. 계약 시점 스냅샷은 Client.package에 복사해 둔다
 * (카탈로그가 나중에 바뀌어도 이미 계약한 고객의 조건은 바뀌지 않는다).
 */

export type ClientStatus = 'lead' | 'contracted' | 'active' | 'paused' | 'ended';

/** 사전설문 8항목 (숏부스터 설문 화면 기준) */
export interface ClientSurvey {
  industry: string; // 업종/서비스 분야
  main_product: string; // 대표 상품 또는 핵심 서비스
  instagram_url: string; // 현재 운영 중인 인스타그램 계정 URL
  external_channels: string; // 운영 중인 외부 채널 링크
  key_message: string; // 어필하고 싶은 핵심 메시지 및 강점
  target: string; // 타깃 고객층 (성별/연령대/주요 니즈)
  purpose: string; // 계정 운영 목적
  tone: string; // 지향하는 콘텐츠 방향 또는 톤앤매너
}

export interface ClientPackage {
  id: string;
  name: string;
  monthly_reels: number;
  monthly_edits: number;
  monthly_uploads: number;
  community_mgmt: boolean;
  hashtag_setup: boolean;
  profile_setup: boolean;
  price: number;
  event_price: number;
}

export interface Client {
  slug: string;
  name: string;
  contact: {person: string; phone: string; email: string; kakao: string};
  survey: ClientSurvey;
  /** 계약 시점 카탈로그 스냅샷. 계약 전이면 null. */
  package: ClientPackage | null;
  contract: {start: string; end: string; status: ClientStatus; event_price_applied: boolean; notes: string};
  profile_setup: {done: boolean; notes: string};
  created: string; // ISO
  updated: string; // ISO
}

export type DeliverableStatus = 'planned' | 'scripted' | 'shot' | 'edited' | 'uploaded';

export interface Deliverable {
  id: string; // short random id
  title: string;
  type: 'reel' | 'story' | 'other';
  reels_project: string | null; // e.g. "릴스기획/<id>" (ROOT-relative)
  episode: string | null; // e.g. "2026-09-08/B-01-…" (ROOT-relative)
  status: DeliverableStatus;
  due: string | null; // YYYY-MM-DD
  uploaded_url: string | null;
  notes: string;
}

export interface ClientMonth {
  month: string; // YYYY-MM
  stage: 1 | 2 | 3 | 4; // 진행 절차 단계
  items: Deliverable[];
  report: {done: boolean; file: string | null; notes: string};
  memo: string;
  updated: string;
}

export interface PackageCatalog {
  packages: ClientPackage[];
  stages: {id: number; name: string}[];
  notes: string[];
}
