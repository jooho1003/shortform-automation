export type StudioAsset = {id: string; name: string; path: string; kind: 'image' | 'video' | 'audio'; sha256: string; duration: number};
export type Take = {id: string; assetId: string; createdAt: string; inputHash: string; stale: boolean};
export type Shot = {id: string; title: string; prompt: string; caption: string; camera: string; style: string; duration: number; trimStart: number; refs: string[]; selectedTakeId: string | null; takes: Take[]};
export type StudioRun = {id: string; kind: string; status: 'queued' | 'running' | 'unknown' | 'done' | 'failed'; message: string; createdAt: string; estimatedUsd: number | null};
export type StudioProject = {id: string; title: string; brief: string; narrationText?: string; audioNeedsReview?: boolean; ratio: string; stage: number; revision: number; updatedAt: string; planApproved: boolean; source: {track: string; date: string; num: string} | null; shots: Shot[]; assets: StudioAsset[]; audioId: string | null; layout: Record<string, {x: number; y: number}>; runs: StudioRun[]; exports: {id: string; assetId: string; createdAt: string; archive?: boolean}[]};
export type StudioSummary = {id: string; title: string; shots: number; exports: number; updatedAt: string};
export type StudioQuote = {kind: string; shotId?: string; fingerprint: string; provider: string; estimatedUsd: number | null};
