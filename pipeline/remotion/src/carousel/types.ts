/**
 * 카드뉴스·인스타툰 캐러셀 공용 타입.
 *
 * 웹 콘솔 미리보기와 Remotion Still 렌더가 같은 컴포넌트를 쓴다(미리보기 = 출력물).
 * 이미지 경로는 저장소 루트 기준 상대 경로로 저장하고, 표시할 때 assetBase로 URL을 만든다.
 */

/** Graph API 캐러셀 기본값. 3:4(1080×1440)는 API 통과 확인 전까지 쓰지 않는다. */
export const SLIDE_WIDTH = 1080;
export const SLIDE_HEIGHT = 1350;
/** Graph API·Buffer 캐러셀 한도. 앱 수동 게시는 20장까지 되지만 자동 게시는 10장. */
export const API_MAX_SLIDES = 10;
export const HARD_MAX_SLIDES = 20;

export type CarouselTheme = {
  bg: string;
  fg: string;
  accent: string;
};

export type CardRole = 'cover' | 'body' | 'cta';

export type CardSlideData = {
  role: CardRole;
  eyebrow: string;
  title: string;
  body: string;
  /** 루트 기준 상대 경로. 글자 없는 배경·삽화 이미지. */
  image: string | null;
};

export type CardSlideProps = {
  slide: CardSlideData;
  index: number;
  total: number;
  theme: CarouselTheme;
  brand: string;
  /** 광고·협찬이면 표지에 '광고' 표기를 강제로 넣는다(추천·보증 심사지침). */
  sponsored: boolean;
  assetBase?: string;
};

export type BubbleKind = 'speech' | 'thought' | 'narration';

export type Bubble = {
  speaker: string;
  text: string;
  kind: BubbleKind;
  /** 패널 안 위치(%). 말풍선 중심 기준. */
  x: number;
  y: number;
};

export type ToonPanel = {
  /** 이미지 생성 지시(행동·구도만. 외형은 캐릭터 락 블록이 담당). */
  scene: string;
  image: string | null;
  bubbles: Bubble[];
};

export type ToonLayout = 'single' | 'two' | 'four';

export type ToonSlideData = {
  layout: ToonLayout;
  /** 말풍선·글씨까지 그려진 완성 페이지는 테두리와 별도 푸터 없이 표시한다. */
  fullBleed?: boolean;
  panels: ToonPanel[];
};

export type ToonSlideProps = {
  slide: ToonSlideData;
  index: number;
  total: number;
  title: string;
  sponsored: boolean;
  assetBase?: string;
};

export const PANELS_PER_LAYOUT: Record<ToonLayout, number> = {single: 1, two: 2, four: 4};
