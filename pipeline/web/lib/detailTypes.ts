export const DETAIL_STATUSES = ['brief', 'production', 'review', 'delivered'] as const;
export type DetailStatus = typeof DETAIL_STATUSES[number];
export const DETAIL_STATUS_LABELS: Record<DetailStatus, string> = {brief: '의뢰 접수', production: '제작 중', review: '검수 중', delivered: '납품 완료'};
export const DETAIL_VIDEO_SOURCES = ['image', 'sheet'] as const;
export type DetailVideoSource = typeof DETAIL_VIDEO_SOURCES[number];
export const DETAIL_VIDEO_SOURCE_LABELS: Record<DetailVideoSource, string> = {image: '섹션 이미지 사용', sheet: '제품 레퍼런스 시트'};
export const DETAIL_VIDEO_MIN_SECONDS = 2;
export const DETAIL_VIDEO_MAX_SECONDS = 12;
/** 섹션에 붙는 짧은 영상. 파일은 프로젝트 폴더 기준 상대 경로이고 HTML은 이 경로를 그대로 참조한다. */
export type DetailVideo = {
  source: DetailVideoSource;
  /** source: 'image' 일 때 i2v 시드로 쓸 이미지. 프로젝트 폴더 기준 상대 경로. */
  seed: string;
  /** 움직임 지시문. 상세페이지는 느린 푸시인·제형 흐름 정도가 기본이다. */
  motion: string;
  seconds: number;
  loop: boolean;
  file: string;
  poster: string;
};
export type DetailSection = {id: string; title: string; copy: string; visual: string; review: 'todo' | 'ready' | 'changes'; video?: DetailVideo};
const DETAIL_SECTION_REVIEW_LABELS: Record<DetailSection['review'], string> = {todo: '확인 전', ready: '확인됨', changes: '수정 필요'};
const DETAIL_CHECK_LABELS: Record<keyof DetailProject['checks'], string> = {facts: '제품 정보와 수치 확인', labels: '표기·주의 문구 확인', mobile: '375px 화면 확인', rights: '이미지·사용 권한 확인'};
export type DetailProject = {
  id: string; title: string; client: string; product: string; target: string; objective: string;
  keyMessage: string; facts: string; evidence: string; brand: string; referenceUrls: string;
  assetNotes: string; deliveryUrl: string; deadline: string; status: DetailStatus;
  sections: DetailSection[]; checks: {facts: boolean; labels: boolean; mobile: boolean; rights: boolean};
  revisionNote: string; createdAt: string; updatedAt: string; revision: number;
};
export function defaultDetailVideo(sectionId: string): DetailVideo {
  return {source: 'image', seed: `이미지/${sectionId}.png`, motion: '천천히 다가가는 카메라. 제품은 고정.', seconds: 4, loop: true, file: `영상/${sectionId}.mp4`, poster: `영상/${sectionId}.png`};
}
/** 프로젝트 폴더 기준 상대 경로를 /api/media 가 읽는 저장소 기준 경로로. */
export function detailMediaSrc(projectId: string, rel: string): string {
  return `/api/media?path=${encodeURIComponent(`상세페이지/${projectId}/${rel}`)}`;
}
export function sectionPrompt(project: DetailProject, section: DetailSection): string {
  return `상세페이지 제작 지시문\n제품: ${project.product || '미입력'}\n대상: ${project.target || '미입력'}\n브랜드·색상·스타일: ${project.brand || '미입력'}\n섹션: ${section.title}\n입력 카피: ${section.copy || '미입력'}\n이미지 연출: ${section.visual || '미입력'}\n확인된 제품 정보: ${project.facts || '미입력'}\n근거 자료: ${project.evidence || '미입력'}\n제공 자산·사용 조건: ${project.assetNotes || '미입력'}\n제약: 제품 외형과 로고를 보존. 카피 영역에 여백 확보. 미확인 수치·효능·후기를 만들지 않기. 원리 CGI는 개념 연출로 표시하고 제품 근거와 구분. 이미지는 문자 없이 제작하고 검수한 카피는 편집 단계에서 배치.`;
}
export function detailMarkdown(p: DetailProject): string {
  return `# ${p.title}\n\n고객: ${p.client}\n제품: ${p.product}\n상태: ${DETAIL_STATUS_LABELS[p.status]}\n납기: ${p.deadline}\n\n## 의뢰서\n\n대상: ${p.target}\n목적: ${p.objective}\n핵심 메시지: ${p.keyMessage}\n브랜드: ${p.brand}\n\n### 확인된 정보\n${p.facts}\n\n### 근거 자료\n${p.evidence}\n\n### 참고 링크\n${p.referenceUrls}\n\n### 제공 자산\n${p.assetNotes}\n\n${p.sections.map(s => `## ${s.title}\n\n${s.copy}\n\n검수: ${DETAIL_SECTION_REVIEW_LABELS[s.review]}\n\n### 제작 지시문\n${sectionPrompt(p, s)}`).join('\n\n')}\n\n## 최종 검수\n${(Object.entries(p.checks) as [keyof DetailProject['checks'], boolean][]).map(([key, checked]) => `- [${checked ? 'x' : ' '}] ${DETAIL_CHECK_LABELS[key]}`).join('\n')}\n\n수정 메모: ${p.revisionNote}\n납품 링크: ${p.deliveryUrl}\n`;
}
