import { createHmac } from "node:crypto";
import { z } from "zod";
import { sequelize } from "@/lib/db/index";
import { actor, errorResponse } from "@/lib/games/service";
import { normalize } from "@/lib/games/engine";
import type { GameSet } from "@/lib/games/types";
import {
  ownedStudent,
  rows,
  run,
  sameOrigin,
  HttpError,
  type Actor,
} from "@/lib/classroom/core";
export const dynamic = "force-dynamic";
type Work = {
  id: number;
  student_id: number;
  studentName: string;
  title: string;
  body: string;
  due_date: string;
  status: string;
  feedback: string;
  learning_snapshot: GameSet | null;
};
async function work(a: Actor, id: number) {
  const [h] = await rows<Work>(
    `SELECT h.*,s.name AS "studentName" FROM classroom_homework h JOIN students s ON s.id=h.student_id WHERE h.id=:id AND h.owner_id=:owner AND s."deletedAt" IS NULL`,
    { id, owner: a.ownerId },
  );
  if (!h?.learning_snapshot) throw new HttpError(404, "Набор ДЗ не найден.");
  await ownedStudent(a, h.student_id);
  return h;
}
const hash = (s: string) =>
  createHmac("sha256", process.env.AUTH_SECRET!).update(s).digest("hex");
async function view(a: Actor, h: Work) {
  const attempts = await rows<{
    id: string;
    item_id: string;
    response: string;
    correct: boolean | null;
    created_at: string;
  }>(
    "SELECT * FROM learning_attempts WHERE homework_id=:id ORDER BY created_at DESC",
    { id: h.id },
  );
  const snapshot = h.learning_snapshot!;
  const items = snapshot.items.map((i) => {
    const last = attempts.find((x) => x.item_id === i.id);
    const reveal = a.role === "teacher" || (!!last && last.correct !== null);
    const options =
      i.type === "pair"
        ? snapshot.items.filter((x) => x.type === "pair").length > 1
          ? snapshot.items.filter((x) => x.type === "pair").map((x) => x.answer)
          : undefined
        : i.options;
    return {
      id: i.id,
      type: i.type,
      prompt: i.prompt,
      options: options
        ? Array.from(new Set(options)).sort((x, y) =>
            hash(h.id + ":" + x).localeCompare(hash(h.id + ":" + y)),
          )
        : undefined,
      tokens:
        i.type === "sentence"
          ? i.answer
              .split(/\s+/)
              .map((text, index) => ({
                id: hash(h.id + ":" + i.id + ":" + index).slice(0, 20),
                text,
              }))
              .sort((x, y) => x.id.localeCompare(y.id))
          : undefined,
      answer: reveal ? i.answer : undefined,
      explanation: reveal ? i.explanation : undefined,
      last,
      attempts: attempts.filter((x) => x.item_id === i.id),
    };
  });
  return {
    id: h.id,
    title: h.title,
    body: h.body,
    due: h.due_date,
    status: h.status,
    feedback: h.feedback,
    studentName: h.studentName,
    role: a.role,
    sourceTitle: snapshot.title,
    items,
    completed: items.filter((i) => i.last).length,
  };
}
export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const a = await actor();
    const id = z.coerce
      .number()
      .int()
      .positive()
      .parse((await params).id);
    return Response.json(await view(a, await work(a, id)), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    sameOrigin(req);
    const a = await actor();
    if (a.role !== "student")
      throw new HttpError(403, "Ответы отправляет ученик.");
    const id = z.coerce
      .number()
      .int()
      .positive()
      .parse((await params).id);
    const h = await work(a, id);
    const b = z
      .object({
        commandId: z.string().uuid(),
        itemId: z.string().min(1).max(120),
        response: z.string().trim().min(1).max(2000),
      })
      .parse(await req.json());
    const item = h.learning_snapshot!.items.find((i) => i.id === b.itemId);
    if (!item) throw new HttpError(404, "Задание не найдено.");
    await sequelize.transaction(async (transaction) => {
      await run(
        "SELECT id FROM classroom_homework WHERE id=:id FOR UPDATE",
        { id },
        transaction,
      );
      const [old] = await rows<{ homework_id: number; item_id: string }>(
        "SELECT homework_id,item_id FROM learning_attempts WHERE id=:id",
        { id: b.commandId },
        transaction,
      );
      if (old) {
        if (old.homework_id !== id || old.item_id !== item.id)
          throw new HttpError(409, "Идентификатор ответа уже использован.");
        return;
      }
      const correct =
        item.type === "text"
          ? null
          : [item.answer, ...(item.alternatives || [])].some(
              (answer) => normalize(answer) === normalize(b.response),
            );
      await run(
        "INSERT INTO learning_attempts(id,homework_id,item_id,response,correct) VALUES(:id,:homework,:item,:response,:correct)",
        {
          id: b.commandId,
          homework: id,
          item: item.id,
          response: b.response,
          correct,
        },
        transaction,
      );
      const [total] = await rows<{ n: string }>(
        "SELECT count(DISTINCT item_id) AS n FROM learning_attempts WHERE homework_id=:id",
        { id },
        transaction,
      );
      if (Number(total.n) === h.learning_snapshot!.items.length)
        await run(
          `UPDATE classroom_homework SET status='submitted' WHERE id=:id`,
          { id },
          transaction,
        );
    });
    return Response.json(await view(a, await work(a, id)), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    sameOrigin(req);
    const a = await actor();
    if (a.role !== "teacher")
      throw new HttpError(403, "Проверяет преподаватель.");
    const id = z.coerce
      .number()
      .int()
      .positive()
      .parse((await params).id);
    const h = await work(a, id);
    const b = z
      .object({ attemptId: z.string().uuid(), correct: z.boolean() })
      .parse(await req.json());
    const [attempt] = await rows<{ item_id: string }>(
      "SELECT item_id FROM learning_attempts WHERE id=:id AND homework_id=:homework",
      { id: b.attemptId, homework: id },
    );
    if (
      !attempt ||
      h.learning_snapshot!.items.find((i) => i.id === attempt.item_id)?.type !==
        "text"
    )
      throw new HttpError(404, "Ответ для ручной проверки не найден.");
    await run(
      "UPDATE learning_attempts SET correct=:correct WHERE id=:id AND homework_id=:homework",
      { correct: b.correct, id: b.attemptId, homework: id },
    );
    return Response.json(await view(a, await work(a, id)), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
