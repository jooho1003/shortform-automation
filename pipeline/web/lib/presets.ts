/**
 * 자주 쓰는 잡 사양. UI는 이 이름으로 요청하고 서버가 인자를 만든다(클라이언트가 임의 인자를 못 넣게).
 */
import type {JobSpec, StepName, Track} from './types';

export interface EpisodeKey {
  track: Track;
  date: string;
  num: string;
  /** ROOT 상대 회차 폴더. 로그를 여기 '로그/'에 남긴다. */
  dir: string;
}

const DANGEROUS_STEPS: StepName[] = ['upload', 'video']; // upload=외부 발신, video=fal 과금

export function stepJob(ep: EpisodeKey, step: StepName, force = false, confirmed = false): JobSpec {
  const args = ['run', '--track', ep.track, '--date', ep.date, '--episode', ep.num, '--only', step];
  if (force) args.push('--force');
  return {
    kind: 'python',
    title: `${ep.track}-${ep.num} ${step}`,
    args,
    logDir: `${ep.dir}/로그`,
    dangerous: DANGEROUS_STEPS.includes(step),
    confirmed,
  };
}

export function statusJob(ep: EpisodeKey): JobSpec {
  return {kind: 'python', title: `${ep.track}-${ep.num} status`, args: ['status', '--track', ep.track, '--date', ep.date, '--episode', ep.num], logDir: `${ep.dir}/로그`};
}

export function researchJob(): JobSpec {
  return {kind: 'python', title: '주간 조사', args: ['research']};
}

export function discoverJob(): JobSpec {
  return {kind: 'python', title: '레퍼런스 발굴', args: ['discover']};
}

export function segmentsJob(source: string, date: string): JobSpec {
  return {kind: 'python', title: `구간 후보 ${source}`, args: ['segments', '--source', source, '--date', date]};
}

export function remotionRenderJob(ep: EpisodeKey): JobSpec {
  // render 단계는 python이 npx remotion render를 부르므로 stepJob(ep,'render')를 쓴다. 이건 확인용.
  return stepJob(ep, 'render');
}

export type PresetName = 'step' | 'status' | 'research' | 'discover' | 'segments';
