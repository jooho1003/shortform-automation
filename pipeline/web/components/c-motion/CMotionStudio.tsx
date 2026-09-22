'use client';

import Link from 'next/link';
import {useRef, useState} from 'react';

import styles from './c-motion.module.css';

const sampleVideo = '/api/media?path=' + encodeURIComponent('2026-09-15/C-01-트리스탄다쿠냐-설계/04-영상/sample-12s.mp4');

const scenes = [
  {
    id: 'C01',
    range: '0–6초',
    start: 0,
    title: '작은 점에서 시작',
    copy: '남대서양 한가운데, 지도에서도 잘 보이지 않는 섬 하나.',
    motion: '전체 지도 확대 · 항로 그리기 · 위치 고정',
  },
  {
    id: 'C02',
    range: '6–12초',
    start: 6,
    title: '질문으로 전환',
    copy: '이름은 트리스탄다쿠냐. 이 외딴곳에는 어떻게 마을이 생겼을까요?',
    motion: '섬 항공 배경 전환 · 느린 확대 · 인물 순차 등장',
  },
] as const;

const productionSteps = [
  ['01', '사실·대본', '주장마다 출처를 연결하고 45–65초 분량으로 압축'],
  ['02', '지도·인물', '지도, 배경, 투명 캐릭터를 독립 자산으로 준비'],
  ['03', '음성·타이밍', 'TTS 길이를 측정한 뒤 컷과 자막 시간을 확정'],
  ['04', '모션·렌더', '지도 확대, 항로, 등장 프리셋으로 60fps 렌더'],
] as const;

export function CMotionStudio() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [selected, setSelected] = useState(0);
  const scene = scenes[selected];

  function selectScene(index: number) {
    setSelected(index);
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = scenes[index].start;
    void video.play().catch(() => undefined);
  }

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>C안 · 지도/역사 설명형</span>
          <h1>한 장의 지도가<br/>60초 이야기로<br/>움직입니다.</h1>
          <p>지도 확대, 항로, 인물, 큰 자막을 재사용 가능한 모션으로 묶은 첫 샘플입니다.</p>
        </div>
        <div className={styles.status}>
          <span className={styles.liveDot} />
          샘플 렌더 완료
        </div>
      </header>

      <section className={styles.studio} aria-label="C안 샘플 플레이어">
        <div className={styles.playerShell}>
          <video ref={videoRef} src={sampleVideo} controls playsInline preload="metadata" aria-label="트리스탄다쿠냐 C안 12초 샘플" />
          <div className={styles.playerMeta}><span>1080 × 1920</span><span>60 FPS</span><span>12 SEC</span></div>
        </div>

        <div className={styles.scenePanel}>
          <div className={styles.panelHead}>
            <div><span>SCENE FLOW</span><strong>샘플 컷 구성</strong></div>
            <a href={sampleVideo} download className="btn">MP4 열기</a>
          </div>
          <div className={styles.timeline} aria-hidden="true"><span className={selected === 0 ? styles.activeBar : ''}/><span className={selected === 1 ? styles.activeBar : ''}/></div>
          <div className={styles.sceneList}>
            {scenes.map((item, index) => (
              <button key={item.id} type="button" className={index === selected ? styles.selectedScene : ''} onClick={() => selectScene(index)} aria-pressed={index === selected}>
                <span className={styles.sceneId}>{item.id}</span>
                <span><strong>{item.title}</strong><small>{item.range} · {item.motion}</small></span>
              </button>
            ))}
          </div>
          <div className={styles.scriptCard}>
            <span>선택한 장면의 내레이션</span>
            <p>“{scene.copy}”</p>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionTitle}><span>PRODUCTION SYSTEM</span><h2>이제 한 편이 아니라 포맷으로 만듭니다.</h2></div>
        <div className={styles.stepGrid}>
          {productionSteps.map(([number, title, description]) => (
            <article key={number}><span>{number}</span><h3>{title}</h3><p>{description}</p></article>
          ))}
        </div>
      </section>

      <section className={styles.assetSection}>
        <div>
          <span className={styles.eyebrow}>첫 적용 콘텐츠</span>
          <h2>트리스탄다쿠냐<br/>60초 본편 설계</h2>
        </div>
        <div className={styles.assetDetails}>
          <dl><div><dt>목표 길이</dt><dd>60초</dd></div><div><dt>장면</dt><dd>10컷</dd></div><div><dt>자산 방식</dt><dd>지도 + 생성 이미지 + TTS</dd></div></dl>
          <p>샘플에서 확인한 확대·전환 강도를 기준으로 1815년부터 1827년까지 정착 이야기를 확장합니다.</p>
          <Link href="/" className="btn primary">회차 목록으로</Link>
        </div>
      </section>
    </div>
  );
}
