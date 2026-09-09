import {getBacklog, getJob, isRunning, subscribe} from '@/lib/runner';
import type {JobEvent} from '@/lib/types';

export const dynamic = 'force-dynamic';

/** SSE. 접속 시 지금까지의 로그를 먼저 보내고, 이후 이벤트를 흘린다. */
export async function GET(_req: Request, {params}: {params: Promise<{id: string}>}) {
  const {id} = await params;
  if (!/^[\w-]+$/.test(id)) return new Response('bad id', {status: 400});
  const job = getJob(id);
  if (!job) return new Response('not found', {status: 404});

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (ev: JobEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      send({type: 'status', job});
      const backlog = getBacklog(id);
      if (backlog.length) send({type: 'log', stream: 'stdout', text: backlog.join('\n') + '\n'});

      if (!isRunning(id)) {
        send({type: 'end', job});
        controller.close();
        return;
      }
      const heartbeat = setInterval(() => controller.enqueue(encoder.encode(': ping\n\n')), 15000);
      const off = subscribe(id, (ev) => {
        send(ev);
        if (ev.type === 'end') {
          clearInterval(heartbeat);
          off?.();
          controller.close();
        }
      });
      if (!off) {
        clearInterval(heartbeat);
        send({type: 'end', job});
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive'},
  });
}
