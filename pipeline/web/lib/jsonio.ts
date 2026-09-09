/**
 * Python 쪽과 같은 모양으로 파일을 쓴다.
 *
 * state.py / clips.py는 `json.dumps(obj, ensure_ascii=False, indent=2)` + UTF-8(BOM 없음)로 쓴다.
 * JSON.stringify(obj, null, 2)가 같은 바이트를 만든다(비ASCII 비이스케이프, 구분자 동일).
 * 형식이 달라지면 git diff가 지저분해지므로 여기 헬퍼 외의 방법으로 JSON을 쓰지 않는다.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

export async function readJson<T>(abs: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(abs, 'utf8');
    return JSON.parse(raw.replace(/^﻿/, '')) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function writeJsonLikePython(abs: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(abs), {recursive: true});
  await fs.writeFile(abs, JSON.stringify(data, null, 2), 'utf8');
}

export async function writeText(abs: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(abs), {recursive: true});
  await fs.writeFile(abs, text, 'utf8');
}

export async function readText(abs: string): Promise<string | null> {
  try {
    return (await fs.readFile(abs, 'utf8')).replace(/^﻿/, '');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function exists(abs: string): Promise<boolean> {
  try {
    await fs.access(abs);
    return true;
  } catch {
    return false;
  }
}

export async function removeIfExists(abs: string): Promise<boolean> {
  try {
    await fs.unlink(abs);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}
