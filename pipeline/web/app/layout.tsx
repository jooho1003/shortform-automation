import type {Metadata} from 'next';
import type {ReactNode} from 'react';

import {Nav} from '@/components/Nav';

import './globals.css';

export const metadata: Metadata = {
  title: '숏폼 콘솔',
  description: '숏폼 자동화 파이프라인 로컬 콘솔',
};

export default function RootLayout({children}: {children: ReactNode}) {
  return (
    <html lang="ko">
      <body>
        <div className="shell">
          <Nav />
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
