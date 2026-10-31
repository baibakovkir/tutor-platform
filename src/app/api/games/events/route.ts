import {
  actor,
  roomRows,
  toPublic,
  expireRooms,
  errorResponse,
} from "@/lib/games/service";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    await actor();
  } catch (e) {
    return errorResponse(e);
  }
  let timer: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let previous = "";
      let running = false;
      const close = () => {
        closed = true;
        clearInterval(timer);
        try {
          controller.close();
        } catch {}
      };
      async function tick() {
        if (running || closed) return;
        running = true;
        try {
          const a = await actor();
          await expireRooms(a);
          const data = JSON.stringify(
            (await roomRows(a)).map((r) => toPublic(r, a)),
          );
          if (!closed) {
            controller.enqueue(
              encoder.encode(
                data !== previous
                  ? "data: " + data + "\n\n"
                  : ": heartbeat\n\n",
              ),
            );
            previous = data;
          }
        } catch {
          if (!closed) {
            controller.enqueue(encoder.encode("event: revoked\ndata: {}\n\n"));
            close();
          }
        } finally {
          running = false;
        }
      }
      timer = setInterval(() => void tick(), 1000);
      void tick();
      req.signal.addEventListener("abort", close, { once: true });
      if (req.signal.aborted) close();
    },
    cancel() {
      closed = true;
      clearInterval(timer);
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
