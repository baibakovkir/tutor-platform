import { z } from "zod";
import { actor, roomRows, errorResponse } from "@/lib/games/service";
import { teacher, sameOrigin, HttpError } from "@/lib/classroom/core";
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    sameOrigin(req);
    const a = await actor();
    teacher(a);
    const id = z
      .string()
      .uuid()
      .parse((await params).id);
    const [room] = await roomRows(a, id);
    if (!room) throw new HttpError(404, "Игра не найдена.");
    const ids = new Set(
      room.state.log.filter((e) => !e.correct).map((e) => e.itemId),
    );
    const items = room.state.items.filter((i) => ids.has(i.id));
    if (items.length < 2)
      throw new HttpError(
        400,
        "Для набора нужны хотя бы два разных задания. Можно скопировать исходный набор и добавить упражнения.",
      );
    return Response.json(
      {
        id: "",
        title: ("Повторение · " + room.state.title).slice(0, 200),
        course: room.state.course,
        unit: room.state.unit || 0,
        topic: "Повторение после игры",
        items,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
