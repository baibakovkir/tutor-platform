import {
  actor,
  roomRows,
  toPublic,
  createRoom,
  roomSchema,
  errorResponse,
} from "@/lib/games/service";
import { teacher, sameOrigin } from "@/lib/classroom/core";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const a = await actor();
    return Response.json(
      (await roomRows(a)).map((r) => toPublic(r, a)),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const a = await actor();
    teacher(a);
    return Response.json(
      await createRoom(a, roomSchema.parse(await req.json())),
      { status: 201 },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
