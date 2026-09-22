import {CarouselHome} from '@/components/carousel/CarouselHome';
import {listCarousels} from '@/lib/carousel';

export const dynamic = 'force-dynamic';

export default async function CardNewsPage() {
  const projects = await listCarousels('cardnews');
  return (
    <>
      <div className="page-head">
        <div>
          <h1>카드뉴스</h1>
          <p>주제 → 원고(표지·본문·CTA) → 글자 없는 배경 이미지 → 1080×1350 슬라이드 → 캡션·게시. 파일은 카드뉴스/ 폴더.</p>
        </div>
      </div>
      <CarouselHome kind="cardnews" projects={projects} />
    </>
  );
}
