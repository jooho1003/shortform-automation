import fs from 'node:fs';
import fsp from 'node:fs/promises';
import {Readable} from 'node:stream';

import {resolveInRoot, PathDenied} from '@/lib/safePath';

export const dynamic = 'force-dynamic';

const CONTENT_TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  json: 'application/json',
  txt: 'text/plain; charset=utf-8',
  md: 'text/plain; charset=utf-8',
  vtt: 'text/plain; charset=utf-8',
  srt: 'text/plain; charset=utf-8',
  pdf: 'application/pdf',
};

function contentTypeFor(abs: string): string {
  const ext = abs.split('.').pop()?.toLowerCase() ?? '';
  return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

async function resolveTarget(req: Request): Promise<{abs: string} | {error: string; status: number}> {
  const url = new URL(req.url);
  const rel = url.searchParams.get('path');
  if (!rel) {
    return {error: 'path가 필요합니다.', status: 400};
  }
  let abs: string;
  try {
    abs = resolveInRoot(rel);
  } catch (err) {
    if (err instanceof PathDenied) {
      return {error: err.message, status: 403};
    }
    throw err;
  }
  let stat: fs.Stats;
  try {
    stat = await fsp.stat(abs);
  } catch {
    return {error: '파일을 찾을 수 없습니다.', status: 404};
  }
  if (!stat.isFile()) {
    return {error: '파일을 찾을 수 없습니다.', status: 404};
  }
  return {abs};
}

export async function HEAD(req: Request) {
  const target = await resolveTarget(req);
  if ('error' in target) {
    return Response.json({error: target.error}, {status: target.status});
  }
  const stat = await fsp.stat(target.abs);
  return new Response(null, {
    status: 200,
    headers: {
      'Content-Type': contentTypeFor(target.abs),
      'Content-Length': String(stat.size),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    },
  });
}

export async function GET(req: Request) {
  const target = await resolveTarget(req);
  if ('error' in target) {
    return Response.json({error: target.error}, {status: target.status});
  }
  const {abs} = target;
  const stat = await fsp.stat(abs);
  const size = stat.size;
  const contentType = contentTypeFor(abs);

  const rangeHeader = req.headers.get('range');
  if (rangeHeader) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (!match || (match[1] === '' && match[2] === '')) {
      return new Response(null, {
        status: 416,
        headers: {'Content-Range': `bytes */${size}`},
      });
    }
    let start: number;
    let end: number;
    if (match[1] === '') {
      const suffixLength = parseInt(match[2], 10);
      start = Math.max(size - suffixLength, 0);
      end = size - 1;
    } else {
      start = parseInt(match[1], 10);
      end = match[2] === '' ? size - 1 : parseInt(match[2], 10);
    }
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start < 0 || end >= size) {
      return new Response(null, {
        status: 416,
        headers: {'Content-Range': `bytes */${size}`},
      });
    }
    const stream = fs.createReadStream(abs, {start, end});
    const body = Readable.toWeb(stream) as ReadableStream;
    return new Response(body, {
      status: 206,
      headers: {
        'Content-Type': contentType,
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(end - start + 1),
        'Cache-Control': 'no-store',
      },
    });
  }

  const stream = fs.createReadStream(abs);
  const body = Readable.toWeb(stream) as ReadableStream;
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(size),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    },
  });
}
