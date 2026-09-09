import {staticFile} from 'remotion';

export type TemplateId = 'briefing-focus' | 'feed-card-light' | 'feed-card-dark';

/**
 * 소재 파일 URL.
 *
 * 렌더(remotion render)에서는 render.py가 public/ep/에 옮겨 둔 파일을 staticFile로 읽는다.
 * 웹 콘솔의 Player에서는 타임라인에 assetBase(예: "/api/media?path=<회차>/03-소재/")를 넣어
 * 회차 폴더의 파일을 그대로 서빙받는다. assetBase가 없으면 기존 렌더 동작과 완전히 같다.
 */
export const resolveAsset = (assetBase: string | undefined, name: string): string =>
  assetBase ? `${assetBase}${encodeURIComponent(name)}` : staticFile(`ep/${name}`);

export type TemplateResolution =
  | {kind: 'valid'; id: TemplateId; theme: 'legacy' | 'light' | 'dark'}
  | {kind: 'invalid'; id: string};

export const resolveTemplate = (id = 'briefing-focus'): TemplateResolution => {
  if (id === 'briefing-focus') {
    return {kind: 'valid', id, theme: 'legacy'};
  }

  if (id === 'feed-card-light') {
    return {kind: 'valid', id, theme: 'light'};
  }

  if (id === 'feed-card-dark') {
    return {kind: 'valid', id, theme: 'dark'};
  }

  return {kind: 'invalid', id};
};

export const resolveTimelineTemplate = (timeline: {
  template?: string;
  templateName?: string;
}): TemplateResolution => resolveTemplate(timeline.template);

export const selectComment = <T extends {at: number}>(
  comments: readonly T[],
  now: number
): T | null => {
  if (comments.length === 0) {
    return null;
  }

  const ordered = [...comments].sort((left, right) => left.at - right.at);
  let selected = ordered[0];

  for (const comment of ordered) {
    if (comment.at > now) {
      break;
    }
    selected = comment;
  }

  return selected;
};
