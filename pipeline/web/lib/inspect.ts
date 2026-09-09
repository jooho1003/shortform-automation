/**
 * `python -m shortform inspect ...` 브리지.
 *
 * 파일 규약·기획안 파서를 TS로 다시 쓰지 않는다. 읽기는 전부 Python이 하고 JSON만 받는다.
 * 그래서 planfile.py가 바뀌어도 웹이 어긋나지 않는다.
 */
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

import {PIPELINE, childEnv, pythonCommand} from './paths';
import type {ConfigInfo, EpisodeDetail, EpisodeList, ResearchInfo, Track} from './types';

const execFileAsync = promisify(execFile);

export class InspectError extends Error {
  constructor(message: string, public readonly stderr: string) {
    super(message);
  }
}

async function inspect<T>(args: string[]): Promise<T> {
  const py = pythonCommand();
  try {
    const {stdout} = await execFileAsync(py.cmd, [...py.prefix, '-m', 'shortform', 'inspect', ...args], {
      cwd: PIPELINE,
      env: childEnv(),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    });
    return JSON.parse(stdout) as T;
  } catch (err) {
    const e = err as {stderr?: string; stdout?: string; message: string};
    throw new InspectError(`inspect ${args.join(' ')} 실패: ${(e.stderr || e.message).slice(-800)}`, e.stderr || '');
  }
}

export const listEpisodes = () => inspect<EpisodeList>(['list']);

export const getEpisode = (track: Track, date: string, num: string) =>
  inspect<EpisodeDetail>(['episode', '--track', track, '--date', date, '--episode', num]);

export const getConfig = () => inspect<ConfigInfo>(['config']);

export const getResearch = () => inspect<ResearchInfo>(['research']);
