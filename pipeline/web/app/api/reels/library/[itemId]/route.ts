import {removeLibraryItem, updateLibraryItem} from '@/lib/reels';
import {jsonBody, reelsErrorResponse} from '@/lib/reelsApi';

export const dynamic = 'force-dynamic';

export async function PUT(req: Request, {params}: {params: Promise<{itemId: string}>}) {
  try {
    const {itemId} = await params;
    const body = await jsonBody<{tags?: string[]; favorite?: boolean; note?: string}>(req);
    return Response.json({item: await updateLibraryItem(itemId, body)});
  } catch (err) {
    return reelsErrorResponse(err);
  }
}

export async function DELETE(_req: Request, {params}: {params: Promise<{itemId: string}>}) {
  try {
    const {itemId} = await params;
    await removeLibraryItem(itemId);
    return Response.json({ok: true});
  } catch (err) {
    return reelsErrorResponse(err);
  }
}
