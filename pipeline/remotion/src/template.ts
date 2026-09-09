export type TemplateId = 'briefing-focus' | 'feed-card-light' | 'feed-card-dark';

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
