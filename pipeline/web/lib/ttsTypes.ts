export type VoiceMode = 'custom_voice' | 'voice_design' | 'voice_clone';
export interface TTSConfig {
  schemaVersion: 1;
  provider: 'qwen3-local';
  mode: VoiceMode;
  modelId: string;
  language: string;
  speaker?: string;
  instruct?: string;
  referenceId?: string;
  referenceHash?: string;
  postprocess: {speed: number; sentenceGapMs: number};
  pronunciations: Record<string, string>;
  generation: {seed: number | null; temperature?: number};
}
export interface VoicePreset {id: string; revision: number; name: string; config: TTSConfig; sampleId?: string | null; updatedAt: string}
export interface VoiceReference {id: string; name: string; text: string; durationMs: number; hash: string}
export interface TTSModel {id: string; mode: VoiceMode; size: string; instruct: boolean; loaded?: boolean; tested?: boolean; speakers?: string[]; languages?: string[]}
export interface TTSCapabilities {available: boolean; models?: TTSModel[]; speakers?: string[]; languages?: string[]; device?: string | null; error?: string; defaultConfig?: TTSConfig}
export interface TTSResult {
  audioKey: string; rawKey: string; audioUrl: string; durationMs: number; spokenText: string;
  config: TTSConfig; configHash: string; cacheHit: boolean; elapsedSeconds: number; peakMemoryMiB?: number;
}
export interface TTSJob {
  id: string; kind: 'preview' | 'prepare'; createdAt: string;
  status: 'queued' | 'loading' | 'generating' | 'postprocessing' | 'done' | 'failed' | 'cancelled' | 'interrupted';
  cancelRequested: boolean; error?: {code: string; message: string}; result?: TTSResult;
  request: {text?: string; config?: TTSConfig; modelId?: string};
}
export interface VoiceEpisodeKey {track: 'A' | 'B'; date: string; num: string}
export interface VoiceEpisode extends VoiceEpisodeKey {
  dir: string; title: string; text: string; usesTts: boolean; stale: boolean; hasTimeline: boolean;
  snapshot: {revision: number; preset: {id: string; revision: number; name: string} | null;
    config: TTSConfig | {provider: 'edge-tts'; voice: string}} | null;
}
export const TERMINAL_TTS = new Set<TTSJob['status']>(['done', 'failed', 'cancelled', 'interrupted']);
export const TTS_STATUS: Record<TTSJob['status'], string> = {queued:'대기 중',loading:'모델 준비 중',generating:'음성 생성 중',postprocessing:'음성 정리 중',done:'완료',failed:'실패',cancelled:'취소됨',interrupted:'중단됨'};
export const VOICE_MODE_LABEL: Record<VoiceMode, string> = {custom_voice:'기본 목소리',voice_design:'설명으로 만들기',voice_clone:'참조 음성 사용'};
export const START_VOICE: TTSConfig = {
  schemaVersion:1,provider:'qwen3-local',mode:'custom_voice',modelId:'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice',
  language:'Korean',speaker:'Sohee',postprocess:{speed:1,sentenceGapMs:180},
  pronunciations:{AI:'에이아이',MBC:'엠비씨',tvN:'티비엔',TOP3:'톱 쓰리'},generation:{seed:null},
};

export function voiceFingerprint(config: TTSConfig): string {
  // Seed is the take identity; changing a take does not mean the visible voice settings changed.
  return JSON.stringify({mode:config.mode,modelId:config.modelId,language:config.language,
    speaker:config.speaker??null,instruct:config.instruct??'',referenceId:config.referenceId??null,
    referenceHash:config.referenceHash??null,speed:config.postprocess.speed,gap:config.postprocess.sentenceGapMs,
    temperature:config.generation.temperature??null,
    pronunciations:Object.entries(config.pronunciations).sort(([a],[b])=>a.localeCompare(b))});
}

export async function ttsApi<T>(endpoint: string, options: {method?: string; json?: unknown; form?: FormData; signal?: AbortSignal} = {}): Promise<T> {
  const response = await fetch('/api/tts/' + endpoint, {method:options.method ?? (options.json || options.form ? 'POST' : 'GET'),
    headers:options.json ? {'Content-Type':'application/json'} : undefined,
    body:options.form ?? (options.json ? JSON.stringify(options.json) : undefined), signal:options.signal,cache:'no-store'});
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : '음성 요청을 처리하지 못했습니다.');
  return data as T;
}
