'use client';

import Link from 'next/link';
import {usePathname} from 'next/navigation';

const items: {href: string; label: string; icon: string; section?: string}[] = [
  {href: '/studio', label: 'Take Studio', icon: '◈', section: '제작 스튜디오'},
  {href: '/', label: '회차', icon: '🎬', section: '파이프라인'},
  {href: '/research', label: '조사·구간', icon: '🔎'},
  {href: '/voices', label: '음성 스튜디오', icon: '🎙️'},
  {href: '/c-motion', label: 'C안 모션', icon: '🗺️'},
  {href: '/reels', label: '릴스 기획', icon: '✨', section: '기획'},
  {href: '/blog', label: '블로그', icon: '✍️'},
  {href: '/cardnews', label: '카드뉴스', icon: '🗂️'},
  {href: '/instatoon', label: '인스타툰', icon: '💬'},
  {href: '/clients', label: '외주', icon: '🤝', section: '운영'},
  {href: '/detail-pages', label: '상세페이지 의뢰서', icon: '📄'},
  {href: '/jobs', label: '작업 로그', icon: '📜'},
  {href: '/settings', label: '환경 점검', icon: '🩺', section: '설정'},
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="nav">
      <div className="brand">
        숏폼 콘솔
        <small>shortform-automation · localhost</small>
      </div>
      {items.map((it) => {
        const active = it.href === '/' ? pathname === '/' || pathname.startsWith('/ep/') : pathname.startsWith(it.href);
        return (
          <div key={it.href}>
            {it.section ? <div className="section">{it.section}</div> : null}
            <Link href={it.href} className={active ? 'active' : ''}>
              <span>{it.icon}</span>
              <span>{it.label}</span>
            </Link>
          </div>
        );
      })}
      <div className="spacer" />
      <div className="faint" style={{fontSize: 11, padding: '0 10px'}}>
        SSOT는 파일입니다. 이 화면은 같은 폴더를 읽고 씁니다.
      </div>
    </nav>
  );
}
