// 원고 점검과 복사 패키지가 쓰는 순수 텍스트 함수. 파일 입출력이 없어 node --test로 바로 검증한다.

// 위치·정보 블록의 기호는 감탄 이모지 개수에서 따로 친다.
const INFO_SYMBOLS = new Set(['📍', '🗺', '⏰', '🅿', '☎', '📞']);

export function reactionEmojis(body: string): string[] {
  const text = body.replace(/\]\([^)]*\)/g, ']');
  return [...text.matchAll(/\p{Extended_Pictographic}/gu)].map((match) => match[0]).filter((emoji) => !INFO_SYMBOLS.has(emoji));
}

export function vaguePhrases(body: string, phrases: string[]): string[] {
  const text = body.replace(/\s+/g, ' ');
  return phrases.filter((phrase) => phrase && text.includes(phrase));
}

// 붙여넣기용 일반 텍스트. 외부 링크는 글자만 남기면 지도 링크가 사라지므로 URL을 함께 둔다.
export const readableBody = (body: string) => body
  .replace(/!\[([^\]]*)\]\([^)]+\)/g, (_match, alt: string) => alt ? `[이미지: ${alt}]` : '[이미지]')
  .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, url: string) => /^https?:\/\//.test(url) ? `${label} ${url}` : label)
  .replace(/^#{2,3}\s+/gm, '')
  .replace(/^>\s?/gm, '')
  .replace(/\*\*([^*\n]+)\*\*/g, '$1')
  .replace(/\n{3,}/g, '\n\n')
  .trim();
