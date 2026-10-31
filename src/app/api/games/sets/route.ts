import { randomUUID } from "node:crypto";
import {
  actor,
  sets,
  getSet,
  setSchema,
  errorResponse,
} from "@/lib/games/service";
import {
  teacher,
  sameOrigin,
  rows,
  run,
  HttpError,
} from "@/lib/classroom/core";
import { z } from "zod";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    const a = await actor();
    teacher(a);
    const id = new URL(req.url).searchParams.get("id");
    return Response.json(
      id
        ? await getSet(a, id)
        : (await sets(a)).map(({ items, ...s }) => ({
            ...s,
            counts: {
              pair: items.filter((i) => i.type === "pair").length,
              sentence: items.filter((i) => i.type === "sentence").length,
              choice: items.filter((i) => i.type === "choice").length,
            },
          })),
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
    const b = await req.json();
    const payload = setSchema.parse(b);
    const id = b.id ? z.string().uuid().parse(b.id) : randomUUID();
    if (b.id) {
      const own = await rows(
        "SELECT id FROM game_sets WHERE id=:id AND owner_id=:owner",
        { id, owner: a.ownerId },
      );
      if (!own.length)
        throw new HttpError(
          404,
          "Можно редактировать только собственную копию.",
        );
      await run(
        "UPDATE game_sets SET title=:title,payload=CAST(:payload AS jsonb),updated_at=now() WHERE id=:id AND owner_id=:owner",
        {
          id,
          owner: a.ownerId,
          title: payload.title,
          payload: JSON.stringify({ ...payload, id }),
        },
      );
    } else
      await run(
        "INSERT INTO game_sets(id,owner_id,title,payload) VALUES(:id,:owner,:title,CAST(:payload AS jsonb))",
        {
          id,
          owner: a.ownerId,
          title: payload.title,
          payload: JSON.stringify({ ...payload, id }),
        },
      );
    return Response.json({ id }, { status: b.id ? 200 : 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
