/**
 * R2 객체 서빙.
 *
 * 버킷은 공개하지 않는다. 이 함수가 바인딩으로 직접 읽어 내려 주고, 앞단 인증은
 * Cloudflare Access 가 맡는다(대시보드 설정, 코드 없음).
 *
 * 영상 탐색(seek)이 되려면 Range 요청을 처리해야 한다. R2 SDK 의 range 옵션을 쓰고
 * 206 과 Content-Range 를 돌려준다.
 */

const IMMUTABLE = 'private, max-age=604800';
const NO_CACHE = 'private, no-cache';
// 발행 쪽(shortform/steps/archive_publish.py)이 모든 키에 붙이는 접두사.
// URL 에는 저장소 상대 경로만 넣고 여기서 붙인다.
const PREFIX = 'archive/';
const INDEX_PATH = 'index.json';
// 기획안·자막 같은 문서는 새 탭에서 바로 읽혀야 한다. 저장된 타입이 octet-stream 이거나
// charset 이 빠져 있으면 한글이 깨지므로(nosniff 라 브라우저가 추측도 안 한다) 여기서 고정한다.
// text/markdown 은 브라우저에 따라 내려받기로 가서 text/plain 으로 보낸다.
const PLAIN_TEXT = /\.(md|srt|txt)$/i;

function displayType(rel, stored) {
  if (PLAIN_TEXT.test(rel)) return 'text/plain; charset=utf-8';
  const isText = stored.startsWith('text/') || stored.startsWith('application/json');
  return isText && !/charset=/i.test(stored) ? `${stored}; charset=utf-8` : stored;
}

function notFound(message) {
  return new Response(message, {status: 404, headers: {'Content-Type': 'text/plain; charset=utf-8'}});
}

/** "bytes=0-1023" 형태만 받는다. 파싱 못 하면 전체를 보낸다. */
function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec((header || '').trim());
  if (!match || (match[1] === '' && match[2] === '')) return null;
  let start;
  let end;
  if (match[1] === '') {
    start = Math.max(size - parseInt(match[2], 10), 0);
    end = size - 1;
  } else {
    start = parseInt(match[1], 10);
    end = match[2] === '' ? size - 1 : parseInt(match[2], 10);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start < 0 || end >= size) return 'invalid';
  return {start, end};
}

export async function onRequestGet(context) {
  const {request, env, params} = context;
  const bucket = env.ARCHIVE;
  if (!bucket) return new Response('R2 바인딩(ARCHIVE)이 없습니다.', {status: 500});

  const segments = Array.isArray(params.path) ? params.path : [params.path];
  // 경로 세그먼트는 각각 인코딩되어 온다. 한글 키를 되살리고 상위 이동은 막는다.
  let decoded;
  try {
    decoded = segments.map((s) => decodeURIComponent(s));
  } catch {
    // 깨진 퍼센트 인코딩. 500 으로 새어 나가지 않게 여기서 막는다.
    return new Response('잘못된 경로입니다.', {status: 400, headers: {'Content-Type': 'text/plain; charset=utf-8'}});
  }
  if (decoded.some((s) => !s || s === '.' || s === '..')) {
    return new Response('잘못된 경로입니다.', {status: 400, headers: {'Content-Type': 'text/plain; charset=utf-8'}});
  }
  const rel = decoded.join('/');
  const key = PREFIX + rel;

  const head = await bucket.head(key);
  if (!head) return notFound(`없는 파일입니다: ${key}`);

  const size = head.size;
  const contentType = displayType(rel, head.httpMetadata?.contentType || 'application/octet-stream');
  const isIndex = rel === INDEX_PATH;
  const baseHeaders = {
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': isIndex ? NO_CACHE : IMMUTABLE,
    // 아카이브 HTML 은 자기 자신만 열면 된다. 스크립트 실행을 막아 두면
    // 나중에 외부 HTML 을 올려도 뷰어 세션을 건드릴 수 없다.
    'X-Content-Type-Options': 'nosniff',
  };

  const range = parseRange(request.headers.get('range'), size);
  if (range === 'invalid') {
    return new Response(null, {status: 416, headers: {'Content-Range': `bytes */${size}`}});
  }
  if (range) {
    const object = await bucket.get(key, {range: {offset: range.start, length: range.end - range.start + 1}});
    if (!object) return notFound(key);
    return new Response(object.body, {
      status: 206,
      headers: {
        ...baseHeaders,
        'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
        'Content-Length': String(range.end - range.start + 1),
      },
    });
  }

  const object = await bucket.get(key);
  if (!object) return notFound(key);
  return new Response(object.body, {
    status: 200,
    headers: {...baseHeaders, 'Content-Length': String(size)},
  });
}
