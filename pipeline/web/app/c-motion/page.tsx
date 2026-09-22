import type {Metadata} from 'next';

import {CMotionStudio} from '@/components/c-motion/CMotionStudio';

export const metadata: Metadata = {
  title: 'C안 모션 숏폼 · 숏폼 콘솔',
  description: '지도와 캐릭터로 만드는 지식·역사 숏폼 샘플과 제작 설계',
};

export default function CMotionPage() {
  return <CMotionStudio />;
}
