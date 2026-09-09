import {InspectError, listEpisodes} from '@/lib/inspect';

export async function GET() {
  try {
    const data = await listEpisodes();
    return Response.json(data);
  } catch (err) {
    if (err instanceof InspectError) {
      return Response.json({error: err.message}, {status: 500});
    }
    return Response.json({error: '알 수 없는 오류입니다.'}, {status: 500});
  }
}
