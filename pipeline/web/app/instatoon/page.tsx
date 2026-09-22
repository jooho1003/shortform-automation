import {CarouselHome} from '@/components/carousel/CarouselHome';
import {listCarousels} from '@/lib/carousel';

export const dynamic = 'force-dynamic';

export default async function InstatoonPage() {
  const projects = await listCarousels('instatoon');
  return (
    <>
      <div className="page-head">
        <div>
          <h1>인스타툰</h1>
          <p>캐릭터 락 블록·시트 → 콘티(장·패널·대사) → 시트 참조 컷 생성 → 말풍선은 코드로 합성 → 게시. 파일은 인스타툰/ 폴더.</p>
        </div>
      </div>
      <CarouselHome kind="instatoon" projects={projects} />
    </>
  );
}
