import {loadCatalog} from '@/lib/clients';

export async function GET() {
  try {
    const catalog = await loadCatalog();
    return Response.json(catalog);
  } catch (err) {
    return Response.json({error: err instanceof Error ? err.message : '알 수 없는 오류입니다.'}, {status: 500});
  }
}
