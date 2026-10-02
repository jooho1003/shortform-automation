const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const safeUrl = (raw: string, image = false): string | null => {
  const value = raw.trim();
  if (image && /^(?:\.\.\/)?이미지\/[A-Za-z0-9가-힣._-]+$/.test(value)) return value;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
};

export function renderInline(input: string): string {
  const tokens: string[] = [];
  const protect = (html: string) => {
    const key = `\u0000${tokens.length}\u0000`;
    tokens.push(html);
    return key;
  };
  let text = input.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt: string, raw: string) => {
    const src = safeUrl(raw, true);
    return src ? protect(`<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy">`) : escapeHtml(_m);
  });
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, raw: string) => {
    const href = safeUrl(raw);
    return href ? protect(`<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`) : escapeHtml(_m);
  });
  text = escapeHtml(text).replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  return text.replace(/\u0000(\d+)\u0000/g, (_m, index: string) => tokens[Number(index)] ?? '');
}

function isTableDivider(line: string): boolean {
  const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

const tableCells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());

export function markdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const output: string[] = [];
  let paragraph: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  const flushParagraph = () => {
    if (paragraph.length) output.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (list) output.push(`</${list}>`);
    list = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      flushParagraph();
      closeList();
      continue;
    }
    if (/^\s*---\s*$/.test(line)) {
      flushParagraph();
      closeList();
      output.push('<hr>');
      continue;
    }
    const heading = line.match(/^(##|###)\s+(.+)$/);
    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1].length;
      output.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      flushParagraph();
      closeList();
      const head = tableCells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(tableCells(lines[i]));
        i++;
      }
      i--;
      output.push(`<table><thead><tr>${head.map((cell) => `<th>${renderInline(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${head.map((_, index) => `<td>${renderInline(row[index] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (bullet || ordered) {
      flushParagraph();
      const nextList = bullet ? 'ul' : 'ol';
      if (list !== nextList) {
        closeList();
        list = nextList;
        output.push(`<${list}>`);
      }
      output.push(`<li>${renderInline((bullet ?? ordered)![1])}</li>`);
      continue;
    }
    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      closeList();
      const quoteLines = [quote[1]];
      while (i + 1 < lines.length && /^>\s?(.*)$/.test(lines[i + 1])) {
        quoteLines.push(lines[++i].replace(/^>\s?/, ''));
      }
      output.push(`<blockquote>${quoteLines.map(renderInline).join('<br>')}</blockquote>`);
      continue;
    }
    if (/^!\[[^\]]*\]\([^)]+\)$/.test(line.trim())) {
      flushParagraph();
      closeList();
      output.push(`<figure>${renderInline(line.trim())}</figure>`);
      continue;
    }
    closeList();
    paragraph.push(line.trim());
  }
  flushParagraph();
  closeList();
  return output.join('\n');
}

export function blogDocument(title: string, markdown: string): string {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{margin:0;background:#f4f5f7;color:#222;font-family:-apple-system,BlinkMacSystemFont,"Noto Sans KR",sans-serif}article{box-sizing:border-box;max-width:720px;margin:0 auto;background:#fff;min-height:100vh;padding:44px 36px;line-height:1.85;word-break:keep-all}h1{font-size:32px;line-height:1.35;margin:0 0 36px}h2{font-size:25px;margin:42px 0 16px}h3{font-size:20px;margin:30px 0 12px}p{margin:0 0 20px}strong{background:linear-gradient(transparent 62%,#dff5ea 0)}a{color:#16865a}blockquote{margin:24px 0;padding:15px 20px;border-left:4px solid #18a66a;background:#f4fbf7}ul,ol{padding-left:24px;margin:0 0 22px}li{margin:8px 0}hr{border:0;border-top:1px solid #ddd;margin:38px 0}table{border-collapse:collapse;width:100%;margin:24px 0;font-size:14px}th,td{border:1px solid #dfe3e8;padding:10px;text-align:left}th{background:#f5f7f9}img{display:block;max-width:100%;height:auto;margin:28px auto;border-radius:12px}figure{margin:28px 0}img[alt*="리트리버"]{width:220px;max-width:70%;border-radius:0}@media(max-width:640px){article{padding:28px 20px}h1{font-size:27px}}</style></head><body><article><h1>${escapeHtml(title)}</h1>${markdownToHtml(markdown)}</article></body></html>`;
}
