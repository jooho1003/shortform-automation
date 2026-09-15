import {execFile} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';

import {PIPELINE, REMOTION, ROOT, childEnv, pythonCommand} from '@/lib/paths';
import {ttsFetch} from '@/lib/tts';

export const dynamic = 'force-dynamic';

const execFileAsync = promisify(execFile);

interface Check {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  fix?: string;
  level: 'required' | 'optional';
}

async function version(cmd: string, args: string[], shell = false): Promise<string | null> {
  try {
    const {stdout, stderr} = await execFileAsync(cmd, args, {env: childEnv(), encoding: 'utf8', timeout: 20_000, windowsHide: true, shell});
    return (stdout || stderr).trim().split(/\r?\n/)[0] ?? '';
  } catch {
    return null;
  }
}

export async function GET() {
  const checks: Check[] = [];
  const win = process.platform === 'win32';
  const py = pythonCommand();
  const venv = fs.existsSync(path.join(PIPELINE, '.venv'));

  const pyv = await version(py.cmd, [...py.prefix, '--version']);
  checks.push({id: 'python', label: 'Python (venv)', ok: !!pyv && venv, detail: pyv ? `${pyv}${venv ? ' · .venv' : ' · venv 없음 (py 런처 사용 중)'}` : '실행 불가', fix: 'cd pipeline && py -3.10 -m venv .venv && .venv\\Scripts\\python -m pip install -r requirements.txt', level: 'required'});

  const deps = await version(py.cmd, [...py.prefix, '-c', "import yaml,yt_dlp,PIL,edge_tts,googleapiclient;print('ok')"]);
  checks.push({id: 'pydeps', label: 'Python 의존성 (pyyaml·yt-dlp·pillow·edge-tts·google-api)', ok: deps === 'ok', detail: deps === 'ok' ? '설치됨' : '일부 없음', fix: '.venv\\Scripts\\python -m pip install -r requirements.txt', level: 'required'});

  const whisper = await version(py.cmd, [...py.prefix, '-c', "import faster_whisper;print('ok')"]);
  checks.push({id: 'whisper', label: 'faster-whisper (유튜브 외 릴스 대본)', ok: whisper === 'ok', detail: whisper === 'ok' ? '설치됨' : '없음 — 유튜브 자동 자막만 사용 가능', fix: '.venv\\Scripts\\python -m pip install faster-whisper', level: 'optional'});

  const ff = await version('ffmpeg', ['-version']);
  checks.push({id: 'ffmpeg', label: 'ffmpeg', ok: !!ff, detail: ff ?? 'PATH에 없음', fix: 'winget install Gyan.FFmpeg 후 새 터미널', level: 'required'});

  const qwenPython = path.join(PIPELINE, '.venv-tts', win ? 'Scripts/python.exe' : 'bin/python');
  const qwenInstalled = fs.existsSync(qwenPython);
  checks.push({id:'qwen-env',label:'Qwen3 TTS 전용 환경',ok:qwenInstalled,detail:qwenInstalled?'.venv-tts 있음':'미설치',
    fix:'pipeline/tts-service/README.md 설치 순서 참고',level:'optional'});
  try {
    const response = await ttsFetch('capabilities',{},2500);
    const qwen = await response.json();
    checks.push({id:'qwen-service',label:'Qwen3 TTS 로컬 엔진',ok:response.ok&&qwen.available===true,
      detail:qwen.device ? `${qwen.device} · ${(qwen.models??[]).filter((m:{tested?:boolean})=>m.tested).length}개 모델 합성 확인` : '연결됨 · 첫 합성 시 GPU 확인',level:'optional'});
  } catch {
    checks.push({id:'qwen-service',label:'Qwen3 TTS 로컬 엔진',ok:false,detail:'연결 안 됨',fix:'음성 스튜디오 → 엔진 시작',level:'optional'});
  }

  const nm = fs.existsSync(path.join(PIPELINE, 'node_modules', 'remotion'));
  checks.push({id: 'remotion', label: 'Remotion (node_modules)', ok: nm, detail: nm ? '설치됨 (pipeline/node_modules)' : '없음', fix: 'cd pipeline && npm install', level: 'required'});

  const claude = await version('claude', ['--version'], win);
  checks.push({id: 'claude', label: 'claude CLI (기획·대본·분석)', ok: !!claude, detail: claude ?? '없음', fix: 'npm install -g @anthropic-ai/claude-code', level: 'required'});

  const codex = await version('codex', ['--version'], win);
  checks.push({id: 'codex', label: 'codex CLI (대안 초안·이미지 생성)', ok: !!codex, detail: codex ?? '없음', fix: 'npm install -g @openai/codex', level: 'optional'});

  const envFile = path.join(PIPELINE, '.env');
  const envKeys = new Set<string>();
  try {
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+)$/);
      if (m && m[2].trim() && !m[2].trim().startsWith('#')) envKeys.add(m[1]);
    }
  } catch {}
  const hasKey = (k: string) => !!process.env[k] || envKeys.has(k);
  for (const [k, label, level, fix] of [
    ['FAL_KEY', 'FAL_KEY (A안 영상 생성 · fal.ai)', 'optional', 'https://fal.ai/dashboard/keys 에서 발급 → pipeline/.env 에 FAL_KEY=...'],
    ['PEXELS_API_KEY', 'PEXELS_API_KEY (B안 stock 소재)', 'optional', 'https://www.pexels.com/api/ → pipeline/.env'],
    ['YOUTUBE_API_KEY', 'YOUTUBE_API_KEY (discover 단계)', 'optional', 'Google Cloud Console · YouTube Data API v3 → pipeline/.env'],
  ] as const) {
    checks.push({id: k, label, ok: hasKey(k), detail: hasKey(k) ? (process.env[k] ? '환경변수' : 'pipeline/.env') : '없음', fix, level});
  }
  const oauth = fs.existsSync(path.join(PIPELINE, 'secrets', 'client_secret.json'));
  const token = fs.existsSync(path.join(PIPELINE, 'secrets', 'youtube-token.json'));
  checks.push({id: 'oauth', label: 'YouTube OAuth (업로드)', ok: oauth, detail: oauth ? (token ? 'client_secret + 토큰 있음' : 'client_secret 있음 · 첫 업로드 때 브라우저 인증') : 'pipeline/secrets/client_secret.json 없음', fix: 'Google Cloud Console → OAuth 데스크톱 앱 클라이언트 → pipeline/secrets/client_secret.json', level: 'optional'});

  const chrome = fs.existsSync(path.join(PIPELINE, 'node_modules', '.remotion')) || fs.existsSync(path.join(REMOTION, 'node_modules', '.remotion'));
  checks.push({id: 'chrome', label: 'Remotion 헤드리스 크롬 (렌더)', ok: chrome, detail: chrome ? '내려받음' : '첫 렌더 때 자동 다운로드', level: 'optional'});

  return Response.json({root: ROOT, platform: process.platform, node: process.version, checks});
}
