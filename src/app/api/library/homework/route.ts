import { z } from "zod";
import { actor, getSet, errorResponse } from "@/lib/games/service";
import {
  teacher,
  sameOrigin,
  ownedStudent,
  rows,
  HttpError,
} from "@/lib/classroom/core";
import { dateStr } from "@/lib/validations";
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const a = await actor();
    teacher(a);
    const b = z
      .object({
        setId: z.string().min(1).max(100),
        studentId: z.number().int().positive(),
        itemIds: z.array(z.string()).min(1).max(150).optional(),
        title: z.string().trim().min(1).max(200),
        body: z.string().max(20000).default(""),
        due: dateStr,
      })
      .parse(await req.json());
    await ownedStudent(a, b.studentId);
    const set = await getSet(a, b.setId);
    const items = b.itemIds
      ? set.items.filter((i) => b.itemIds!.includes(i.id))
      : set.items;
    if (
      !items.length ||
      (b.itemIds && items.length !== new Set(b.itemIds).size)
    )
      throw new HttpError(400, "Выберите задания из набора.");
    const snapshot = { ...set, items };
    const [created] = await rows<{ id: number }>(
      `INSERT INTO classroom_homework(student_id,owner_id,title,body,due_date,learning_set_id,learning_snapshot) VALUES(:student,:owner,:title,:body,:due,:set,CAST(:snapshot AS jsonb)) RETURNING id`,
      {
        student: b.studentId,
        owner: a.ownerId,
        title: b.title,
        body: b.body,
        due: b.due,
        set: set.id,
        snapshot: JSON.stringify(snapshot),
      },
    );
    return Response.json(created, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
