import path from 'node:path';
import Link from 'next/link';

import {readJson} from '@/lib/jsonio';
import {REELS} from '@/lib/paths';
import type {ReelProject, ReelPlan} from '@/lib/reelsTypes';

import {PrintButton} from './PrintButton';
import './print.css';

export const dynamic = 'force-dynamic';

function formatTc(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatNum(n: number | null): string {
  if (n === null || n === undefined) return '-';
  return n.toLocaleString('ko-KR');
}

function GuideBlock({markdown}: {markdown: string}) {
  const lines = markdown.split(/\r?\n/);
  const nodes: React.ReactNode[] = [];
  let listBuf: string[] = [];

  function flushList(key: string) {
    if (listBuf.length > 0) {
      nodes.push(
        <ul key={key}>
          {listBuf.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      );
      listBuf = [];
    }
  }

  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('- ')) {
      listBuf.push(trimmed.slice(2));
      return;
    }
    flushList(`ul-${i}`);
    if (trimmed.startsWith('## ')) {
      nodes.push(<h4 key={i}>{trimmed.slice(3)}</h4>);
    } else if (trimmed.length > 0) {
      nodes.push(<p key={i}>{trimmed}</p>);
    }
  });
  flushList('ul-end');

  return <>{nodes}</>;
}

export default async function ReelPrintPage({params}: {params: Promise<{id: string}>}) {
  const {id} = await params;
  const projectDir = path.join(REELS, id);
  const project = await readJson<ReelProject>(path.join(projectDir, '프로젝트.json'));
  const plan = await readJson<ReelPlan>(path.join(projectDir, '기획안.json'));

  if (!project) {
    return (
      <div className="print-root">
        <p>프로젝트를 찾을 수 없습니다.</p>
      </div>
    );
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="print-root">
      <div className="no-print print-actions">
        <PrintButton />
        <a className="btn" href={`/api/reels/${id}/srt`}>
          SRT 내려받기
        </a>
        <Link className="btn" href={`/reels/${id}`}>
          ← 프로젝트
        </Link>
      </div>

      <header className="print-header">
        <h1>릴스 기획안 가이드라인</h1>
        <div className="print-header-meta">
          <div className="print-title">{project.title || project.brand_name}</div>
          <div className="print-sub">
            <span>{today}</span>
            {project.client && <span> · {project.client}</span>}
          </div>
        </div>
      </header>

      {!plan ? (
        <section className="print-section">
          <p>기획안이 아직 없습니다.</p>
        </section>
      ) : (
        <>
          <section className="print-section">
            <h2>
              <span className="chip">01</span> 원본 레퍼런스
            </h2>
            <div className="ref-block">
              {project.reference.thumb && (
                <img
                  className="ref-thumb"
                  src={project.reference.thumb}
                  referrerPolicy="no-referrer"
                  alt=""
                />
              )}
              <div className="ref-meta">
                <div className="ref-title">{project.reference.title}</div>
                <div className="ref-author">{project.reference.author}</div>
                <div className="ref-stats">
                  조회수 {formatNum(project.reference.views)} · 좋아요 {formatNum(project.reference.likes)} · 길이{' '}
                  {project.reference.duration ? `${project.reference.duration}초` : '-'}
                </div>
                <a href={project.reference.url} className="ref-url">
                  {project.reference.url}
                </a>
              </div>
            </div>
          </section>

          <section className="print-section">
            <h2>
              <span className="chip">02</span> 스토리보드
            </h2>
            <div className="storyboard-grid">
              {plan.storyboard.map((frame) => (
                <div className="frame-card" key={frame.n}>
                  {frame.frame ? (
                    <img src={`/api/media?path=${encodeURIComponent(frame.frame)}`} alt={`frame ${frame.n}`} />
                  ) : (
                    <div className="frame-placeholder">{formatTc(frame.tc)}</div>
                  )}
                  <div className="frame-tc">{formatTc(frame.tc)}</div>
                  <div className="frame-caption">{frame.caption}</div>
                  <div className="frame-direction">{frame.direction}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="print-section">
            <h2>
              <span className="chip">03</span> 썸네일 제목
            </h2>
            <div className="thumb-box">
              {plan.thumbnail_titles.map((t, i) => (
                <div className="thumb-line" key={i}>
                  {i + 1}. {t}
                </div>
              ))}
              <div className="thumb-style">{plan.thumbnail_style}</div>
            </div>
          </section>

          <section className="print-section">
            <h2>
              <span className="chip">04</span> 촬영 가이드
            </h2>
            <GuideBlock markdown={plan.shooting_guide} />
          </section>

          <section className="print-section">
            <h2>
              <span className="chip">05</span> 대본
            </h2>
            {plan.script.split(/\r?\n/).map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </section>

          <section className="print-section">
            <h2>
              <span className="chip">06</span> 캡션 문구
            </h2>
            <p className="caption-text">
              {plan.caption.split(/\r?\n/).map((line, i, arr) => (
                <span key={i}>
                  {line}
                  {i < arr.length - 1 && <br />}
                </span>
              ))}
            </p>
            <p className="hashtags">{plan.hashtags.join(' ')}</p>
          </section>
        </>
      )}
    </div>
  );
}
