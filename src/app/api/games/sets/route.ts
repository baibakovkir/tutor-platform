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
import { sequelize } from "@/lib/db/index";
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
              choice: items.filter((i) => ["choice", "text"].includes(i.type))
                .length,
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
    let id: string = randomUUID();
    await sequelize.transaction(async (transaction) => {
      if (b.id) {
        const requested = z.string().uuid().parse(b.id);
        const [source] = await rows<{ id: string; owner_id: number | null }>(
          "SELECT id,owner_id FROM game_sets WHERE id=:id AND (owner_id=:owner OR owner_id IS NULL) FOR UPDATE",
          { id: requested, owner: a.ownerId },
          transaction,
        );
        if (!source) throw new HttpError(404, "Набор не найден.");
        if (source.owner_id !== null) {
          id = source.id;
          await run(
            "UPDATE game_sets SET title=:title,payload=CAST(:payload AS jsonb),updated_at=now() WHERE id=:id",
            {
              id,
              title: payload.title,
              payload: JSON.stringify({ ...payload, id }),
            },
            transaction,
          );
        } else {
          const [own] = await rows<{ id: string }>(
            "SELECT id FROM game_sets WHERE owner_id=:owner AND base_set_id=:base",
            { owner: a.ownerId, base: source.id },
            transaction,
          );
          id = own?.id || randomUUID();
          await run(
            `INSERT INTO game_sets(id,owner_id,title,payload,base_set_id) VALUES(:id,:owner,:title,CAST(:payload AS jsonb),:base) ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,payload=EXCLUDED.payload,updated_at=now()`,
            {
              id,
              owner: a.ownerId,
              title: payload.title,
              payload: JSON.stringify({ ...payload, id }),
              base: source.id,
            },
            transaction,
          );
        }
      } else
        await run(
          "INSERT INTO game_sets(id,owner_id,title,payload) VALUES(:id,:owner,:title,CAST(:payload AS jsonb))",
          {
            id,
            owner: a.ownerId,
            title: payload.title,
            payload: JSON.stringify({ ...payload, id }),
          },
          transaction,
        );
    });
    return Response.json({ id }, { status: b.id ? 200 : 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
