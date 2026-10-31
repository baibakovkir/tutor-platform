import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  actor,
  ownedStudent,
  rows,
  run,
  HttpError,
  type Actor,
} from "@/lib/classroom/core";
import { sequelize } from "@/lib/db/index";
import {
  applyCommand,
  createState,
  publicState,
  timeoutState,
  GameError,
} from "./engine";
import type { GameSet, State, Command, Room } from "./types";
import bank from "../../../content/games/bank.json";
export const itemSchema = z
  .object({
    id: z.string().min(1).max(120),
    type: z.enum(["pair", "sentence", "choice"]),
    prompt: z.string().trim().min(1).max(2000),
    answer: z.string().trim().min(1).max(2000),
    options: z.array(z.string().min(1).max(2000)).min(2).max(8).optional(),
    alternatives: z.array(z.string().min(1).max(2000)).max(10).optional(),
    explanation: z.string().max(3000).default(""),
    hint: z.string().max(1000).optional(),
  })
  .superRefine((i, c) => {
    if (
      i.type === "choice" &&
      (!i.options ||
        !i.options.includes(i.answer) ||
        new Set(i.options).size !== i.options.length)
    )
      c.addIssue({
        code: "custom",
        message: "Варианты должны быть уникальны и содержать правильный ответ.",
      });
  });
export const setSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    course: z.string().trim().max(150).default("Свои материалы"),
    unit: z.number().int().min(0).max(1000).default(0),
    topic: z.string().max(200).default(""),
    items: z.array(itemSchema).min(2).max(150),
  })
  .superRefine((s, c) => {
    if (new Set(s.items.map((i) => i.id)).size !== s.items.length)
      c.addIssue({
        code: "custom",
        message: "Идентификаторы заданий должны быть уникальны.",
      });
  });
export const roomSchema = z.object({
  studentId: z.number().int().positive(),
  setId: z.string().min(1).max(100),
  title: z.string().trim().min(1).max(200),
  kind: z.enum(["pairs", "sentence", "race", "quiz", "quest"]),
  mode: z.enum(["guided", "coop", "duel"]),
  lessonId: z.number().int().positive().nullable().optional(),
  timerSeconds: z.number().int().min(0).max(300).default(0),
  count: z.number().int().min(2).max(30).default(8),
  stageSetIds: z.array(z.string().min(1).max(100)).length(5).optional(),
});
export const commandSchema = z.object({
  commandId: z.string().uuid(),
  version: z.number().int().min(0),
  action: z.enum([
    "flip",
    "clear",
    "answer",
    "next",
    "pause",
    "resume",
    "finish",
    "hint",
  ]),
  card: z.string().max(100).optional(),
  answer: z.string().max(2000).optional(),
});
export type RoomRow = {
  id: string;
  student_id: number;
  student_name: string;
  version: number;
  state: State;
  updated_at: string;
};
export async function sets(a: Actor) {
  const custom =
    a.role === "teacher"
      ? await rows<{ id: string; payload: GameSet }>(
          "SELECT id,payload FROM game_sets WHERE owner_id=:owner ORDER BY updated_at DESC",
          { owner: a.ownerId },
        )
      : [];
  return [
    ...(bank as GameSet[]),
    ...custom.map((x) => ({ ...x.payload, id: x.id })),
  ];
}
export async function getSet(a: Actor, id: string) {
  const set = (await sets(a)).find((s) => s.id === id);
  if (!set) throw new HttpError(404, "Набор не найден.");
  return set;
}
export async function roomRows(a: Actor, id?: string): Promise<RoomRow[]> {
  return rows<RoomRow>(
    `SELECT r.*,s.name AS student_name FROM game_rooms r JOIN students s ON s.id=r.student_id WHERE r.owner_id=:owner AND s."deletedAt" IS NULL ${a.role === "student" ? "AND r.student_id=:student" : ""} ${id ? "AND r.id=:id" : ""} ORDER BY r.updated_at DESC LIMIT 100`,
    { owner: a.ownerId, student: a.role === "student" ? a.studentId : 0, id },
  );
}
export function toPublic(r: RoomRow, a: Actor): Room {
  return {
    id: r.id,
    studentId: r.student_id,
    studentName: r.student_name,
    version: r.version,
    updatedAt: r.updated_at,
    state: publicState(r.state, a.role),
  };
}
export async function createRoom(a: Actor, input: z.infer<typeof roomSchema>) {
  await ownedStudent(a, input.studentId);
  if (input.lessonId) {
    const l = await rows(
      `SELECT b.id FROM bill_sessions bs JOIN bills b ON b.id=bs."billId" WHERE bs.id=:id AND b."createdBy"=:owner AND b."studentId"=:student AND b."deletedAt" IS NULL`,
      { id: input.lessonId, owner: a.ownerId, student: input.studentId },
    );
    if (!l.length) throw new HttpError(404, "Занятие не найдено.");
  }
  const set = await getSet(a, input.setId);
  const items = set.items
    .filter(
      (i) =>
        input.kind === "quest" ||
        i.type ===
          (input.kind === "pairs"
            ? "pair"
            : input.kind === "sentence"
              ? "sentence"
              : "choice"),
    )
    .slice(
      0,
      input.kind === "pairs"
        ? Math.min(input.count, 12)
        : input.kind === "quest"
          ? 150
          : input.count,
    );
  let stageItems: GameSet["items"][] | undefined;
  if (input.kind === "quest" && input.stageSetIds) {
    stageItems = [];
    const stageTypes = ["pair", "sentence", "choice", "sentence", "choice"];
    for (let stage = 0; stage < 5; stage++) {
      const source = await getSet(a, input.stageSetIds[stage]);
      stageItems.push(
        source.items
          .filter((i) => i.type === stageTypes[stage])
          .slice(0, stage === 0 ? 3 : 2)
          .map((i) => ({
            ...i,
            id: `stage-${stage}:${i.id}`,
            sourceSetId: source.id,
            sourceItemId: i.id,
          })),
      );
    }
  }
  const state = createState(
    { ...input, items, stageItems, course: set.course, unit: set.unit },
    randomUUID(),
  );
  const id = randomUUID();
  await run(
    "INSERT INTO game_rooms(id,owner_id,student_id,state) VALUES(:id,:owner,:student,CAST(:state AS jsonb))",
    {
      id,
      owner: a.ownerId,
      student: input.studentId,
      state: JSON.stringify(state),
    },
  );
  return { id };
}
export async function command(a: Actor, id: string, c: Command) {
  return sequelize.transaction(async (transaction) => {
    const [r] = await rows<RoomRow>(
      `SELECT r.* FROM game_rooms r WHERE r.id=:id AND r.owner_id=:owner FOR UPDATE`,
      { id, owner: a.ownerId },
      transaction,
    );
    if (!r) throw new HttpError(404, "Комната не найдена.");
    await ownedStudent(a, r.student_id, transaction);
    if (r.state.schema !== 2)
      throw new HttpError(
        409,
        "Комната создана старой версией. Создайте новую.",
      );
    if (r.state.commandIds.includes(c.commandId))
      return { ok: true, version: r.version };
    if (r.version !== c.version)
      throw new HttpError(
        409,
        "Поле изменилось. Оно обновлено — повторите ход.",
      );
    if (timeoutState(r.state)) {
      await run(
        "UPDATE game_rooms SET state=CAST(:state AS jsonb),version=version+1,updated_at=now() WHERE id=:id",
        { id, state: JSON.stringify(r.state) },
        transaction,
      );
      return { ok: true, version: r.version + 1 };
    }
    const state = applyCommand(r.state, c, a.role);
    await run(
      "UPDATE game_rooms SET state=CAST(:state AS jsonb),version=version+1,updated_at=now() WHERE id=:id",
      { id, state: JSON.stringify(state) },
      transaction,
    );
    return { ok: true, version: r.version + 1 };
  });
}
export async function expireRooms(a: Actor) {
  const list = await roomRows(a);
  for (const r of list) {
    if (
      r.state.phase !== "playing" ||
      !r.state.deadline ||
      r.state.deadline > Date.now()
    )
      continue;
    await sequelize.transaction(async (transaction) => {
      const [live] = await rows<RoomRow>(
        "SELECT * FROM game_rooms WHERE id=:id FOR UPDATE",
        { id: r.id },
        transaction,
      );
      if (live && timeoutState(live.state))
        await run(
          "UPDATE game_rooms SET state=CAST(:state AS jsonb),version=version+1,updated_at=now() WHERE id=:id",
          { id: r.id, state: JSON.stringify(live.state) },
          transaction,
        );
    });
  }
}
export function errorResponse(e: unknown) {
  if (e instanceof HttpError || e instanceof GameError)
    return Response.json({ error: e.message }, { status: e.status });
  if (e instanceof z.ZodError)
    return Response.json(
      { error: e.issues.map((i) => i.message).join(" ") },
      { status: 400 },
    );
  console.error("[games]", e);
  return Response.json(
    { error: "Не удалось выполнить действие." },
    { status: 500 },
  );
}
export { actor };
