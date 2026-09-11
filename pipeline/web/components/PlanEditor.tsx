'use client';

import {Fragment, useState} from 'react';
import {useRouter} from 'next/navigation';
import type {Plan, PlanA, PlanComment, PlanCut, PlanLine} from '@/lib/types';

const TEMPLATE_B = `# 제목 후보

1. 

## 템플릿

브리핑 포커스

## 훅



## 대본

| # | 문장 | 소재 | 검색어 |
|---|---|---|---|
| 1 |  | clip |  |

## AI 댓글

| 시각 | 닉네임 | 내용 |
|---|---|---|

## 메타데이터

- 설명: 
- 태그: 
- 공개: unlisted
`;

const TEMPLATE_A = `# 시놉시스



## 락 블록

### CHARACTER


### COSTUME


### GLOBAL STYLE


### NEGATIVE


## 컷표

| 컷 | TC | 렌즈 | 액션 | 카메라 | 필수 |
|---|---|---|---|---|---|
| 1 | 0-5 | 35mm | | tracking | 필수 |

## 음향 설계

- 환경음: 
- 효과음: 
- 무음 구간: 

## 메타데이터

- 설명: 
- 태그: 
- 공개: unlisted
`;

export default function PlanEditor({
  dir,
  markdown,
  plan,
  planError,
  track,
}: {
  dir: string;
  markdown: string | null;
  plan: Plan | PlanA | null;
  planError: string | null;
  track: 'A' | 'B';
}) {
  // 두 트랙의 기획안은 필드가 겹치지 않는다. track이 아니라 모양으로 갈라야
  // 폴더명과 기획안 내용이 어긋나도 화면이 터지지 않는다.
  const planB = plan && 'lines' in plan ? plan : null;
  const planA = plan && 'cuts' in plan ? plan : null;
  const router = useRouter();
  const [text, setText] = useState(markdown ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = text !== (markdown ?? '');

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/plan', {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({dir, markdown: text}),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? '기획안을 저장하지 못했습니다.');
        return;
      }
      router.refresh();
    } catch {
      setError('요청 중 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  }

  function makeTemplate() {
    setText(track === 'A' ? TEMPLATE_A : TEMPLATE_B);
  }

  return (
    <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16}}>
      <div style={{display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0}}>
        <div className="row">
          <button className="btn primary" disabled={saving || !dirty} onClick={save}>
            저장
          </button>
          {dirty && <span className="badge warn">저장되지 않음</span>}
          {error && <span className="badge danger">{error}</span>}
        </div>
        {markdown === null ? (
          <div className="empty">
            기획안이 없습니다.
            <div style={{marginTop: 10}}>
              <button className="btn" onClick={makeTemplate}>
                빈 기획안 만들기
              </button>
            </div>
          </div>
        ) : null}
        <textarea className="editor" value={text} onChange={(e) => setText(e.target.value)} />
      </div>

      <div style={{minWidth: 0}}>
        {planError && (
          <div style={{display: 'flex', flexDirection: 'column', gap: 8}}>
            <span className="badge warn">{planError}</span>
            <span className="faint">
              {track === 'B'
                ? '기획안 형식(제목 후보/훅/대본 표/AI 댓글/메타데이터)을 확인하세요'
                : 'A안 기획안 형식(시놉시스/락 블록/컷표/음향 설계/메타데이터)을 확인하세요'}
            </span>
          </div>
        )}

        {plan && (
          <div style={{display: 'flex', flexDirection: 'column', gap: 14}}>
            <div>
              <div className="lbl">제목</div>
              <div>{plan.title}</div>
            </div>
            <div className="row">
              <span className="badge">{plan.template_name || plan.template_id}</span>
            </div>

            {planB && (
              <>
                <div>
                  <div className="lbl">훅</div>
                  <div>{planB.hook}</div>
                </div>

                <table className="tbl">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>문장</th>
                      <th>소재</th>
                      <th>검색어</th>
                    </tr>
                  </thead>
                  <tbody>
                    {planB.lines.map((line: PlanLine) => (
                      <tr key={line.n}>
                        <td>{line.n}</td>
                        <td>{line.text}</td>
                        <td>{line.source}</td>
                        <td>{line.queries.join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {planA && (
              <>
                <div>
                  <div className="lbl">시놉시스</div>
                  <div style={{whiteSpace: 'pre-line'}}>{planA.synopsis}</div>
                </div>

                <div>
                  <div className="lbl">락 블록</div>
                  <dl className="kv">
                    {Object.entries(planA.locks).map(([k, v]) => (
                      <Fragment key={k}>
                        <dt>{k}</dt>
                        <dd>{v}</dd>
                      </Fragment>
                    ))}
                  </dl>
                </div>

                <table className="tbl">
                  <thead>
                    <tr>
                      <th>컷</th>
                      <th>TC</th>
                      <th>렌즈</th>
                      <th>액션</th>
                      <th>카메라</th>
                      <th>필수</th>
                    </tr>
                  </thead>
                  <tbody>
                    {planA.cuts.map((cut: PlanCut) => (
                      <tr key={cut.n}>
                        <td>{cut.n}</td>
                        <td>
                          {cut.start}-{cut.end}
                        </td>
                        <td>{cut.lens}</td>
                        <td>{cut.action}</td>
                        <td>{cut.camera}</td>
                        <td>{cut.required ? '필수' : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div>
                  <div className="lbl">음향 설계</div>
                  <dl className="kv">
                    {Object.entries(planA.sound).map(([k, v]) => (
                      <Fragment key={k}>
                        <dt>{k}</dt>
                        <dd>{v}</dd>
                      </Fragment>
                    ))}
                  </dl>
                </div>
              </>
            )}

            {plan.comments.length > 0 && (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>시각</th>
                    <th>닉네임</th>
                    <th>내용</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.comments.map((c: PlanComment, i: number) => (
                    <tr key={i}>
                      <td>{c.at}</td>
                      <td>{c.nick}</td>
                      <td>{c.text}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <dl className="kv">
              {Object.entries(plan.meta).map(([k, v]) => (
                <Fragment key={k}>
                  <dt>{k}</dt>
                  <dd>{String(v)}</dd>
                </Fragment>
              ))}
            </dl>
          </div>
        )}
      </div>
    </div>
  );
}
