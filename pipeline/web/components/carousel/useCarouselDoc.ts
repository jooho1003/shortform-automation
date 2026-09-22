'use client';

import {useCallback, useState} from 'react';

import {api} from '@/lib/client';
import type {CarouselProject} from '@/lib/carousel';

export type Lint = {level: 'error' | 'warn'; msg: string}[];

/** 편집 상태 + 저장. 저장은 명시적으로(자동 저장 없음) — 파일이 SSOT라 외부 수정과 섞이지 않게. */
export function useCarouselDoc<P extends CarouselProject>(initial: P, initialLint: Lint) {
  const [doc, setDoc] = useState<P>(initial);
  const [lint, setLint] = useState<Lint>(initialLint);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = useCallback((fn: (d: P) => P) => {
    setDoc((d) => fn(d));
    setDirty(true);
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await api<{project: P; lint: Lint}>(`/api/carousel/${doc.kind}/${doc.id}`, {method: 'PUT', json: doc});
      setDoc(res.project);
      setLint(res.lint);
      setDirty(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [doc]);

  return {doc, patch, save, lint, dirty, saving, error};
}
