import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { QueryTypes, type Transaction } from "sequelize";
import { sequelize } from "@/lib/db/index";
import { auth } from "../../../auth";
import { z } from "zod";
import { dateStr, timeStr } from "@/lib/validations";

export const COOKIE = "tutor_student";
export const digest = (s: string) =>
  createHash("sha256").update(s).digest("hex");
export const accessToken = () => randomBytes(32).toString("base64url");
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function rows<T extends object = Record<string, unknown>>(
  sql: string,
  replacements: Record<string, unknown> = {},
  transaction?: Transaction,
): Promise<T[]> {
  return sequelize.query<T>(sql, {
    replacements,
    type: QueryTypes.SELECT,
    transaction,
  });
}
export async function run(
  sql: string,
  replacements: Record<string, unknown> = {},
  transaction?: Transaction,
) {
  await sequelize.query(sql, { replacements, transaction });
}
export type Actor =
  | { role: "teacher"; ownerId: number }
  | { role: "student"; ownerId: number; studentId: number };
export async function actor(): Promise<Actor> {
  // A pupil cookie takes precedence, so teachers can test a pupil link safely.
  const token = (await cookies()).get(COOKIE)?.value;
  if (token) {
    const [student] = await rows<{ id: number; owner: number }>(
      `SELECT s.id,s."createdBy" AS owner FROM students s JOIN classroom_profiles p ON p.student_id=s.id WHERE p.access_hash=:hash AND s."deletedAt" IS NULL`,
      { hash: digest(token) },
    );
    if (student)
      return { role: "student", ownerId: student.owner, studentId: student.id };
  }
  const session = await auth();
  if (session?.user?.id)
    return { role: "teacher", ownerId: Number(session.user.id) };
  throw new HttpError(
    401,
    "Войдите в кабинет или откройте ссылку преподавателя.",
  );
}
export function teacher(a: Actor) {
  if (a.role !== "teacher")
    throw new HttpError(403, "Действие доступно преподавателю.");
}
export async function ownedStudent(
  a: Actor,
  studentId: number,
  transaction?: Transaction,
) {
  if (a.role === "student" && a.studentId !== studentId)
    throw new HttpError(404, "Ученик не найден.");
  const [s] = await rows<{ id: number }>(
    `SELECT id FROM students WHERE id=:id AND "createdBy"=:owner AND "deletedAt" IS NULL`,
    { id: studentId, owner: a.ownerId },
    transaction,
  );
  if (!s) throw new HttpError(404, "Ученик не найден.");
}
export function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  const expected = new URL(
    process.env.AUTH_URL || process.env.NEXT_PUBLIC_APP_URL || req.url,
  ).origin;
  if (!origin || origin !== expected)
    throw new HttpError(403, "Недопустимый источник запроса.");
}
export const safeUrl = z
  .string()
  .max(2000)
  .refine(
    (v) =>
      !v ||
      (/^https?:\/\//i.test(v) &&
        (() => {
          try {
            return !!new URL(v).hostname;
          } catch {
            return false;
          }
        })()),
    "Нужна ссылка http:// или https://",
  );
const text = z.string().trim().min(1).max(200);
export const studentInput = z.object({
  name: text,
  phone: z.string().max(100).default(""),
  subject: text.default("Индивидуальные занятия"),
  rate: z.coerce.number().int().min(0).max(1000000).default(1500),
  meetingUrl: safeUrl.default(""),
  notes: z.string().max(10000).default(""),
});
export const lessonInput = z
  .object({
    studentId: z.number().int().positive(),
    title: text,
    date: dateStr,
    start: timeStr,
    end: timeStr,
    price: z.coerce.number().int().min(0).max(1000000),
    meetingUrl: safeUrl.default(""),
    repeat: z.coerce.number().int().min(1).max(24).default(1),
  })
  .refine((v) => v.end > v.start, "Конец занятия должен быть позже начала.");
export const homeworkInput = z.object({
  studentId: z.number().int().positive(),
  title: text,
  body: z.string().max(20000).default(""),
  due: dateStr,
  exerciseId: z.number().int().positive().nullable().default(null),
  sessionId: z.number().int().positive().nullable().default(null),
});
export const exerciseInput = z
  .object({
    title: text,
    kind: z.enum(["choice", "short", "text"]),
    prompt: z.string().trim().min(1).max(10000),
    options: z.array(z.string().trim().min(1).max(1000)).max(8).default([]),
    answer: z.string().max(2000).default(""),
    explanation: z.string().max(5000).default(""),
  })
  .superRefine((v, ctx) => {
    if (
      v.kind === "choice" &&
      (v.options.length < 2 ||
        !/^\d+$/.test(v.answer) ||
        Number(v.answer) >= v.options.length)
    )
      ctx.addIssue({
        code: "custom",
        message: "Укажите минимум два варианта и номер правильного ответа.",
      });
    if (v.kind === "short" && !v.answer.trim())
      ctx.addIssue({ code: "custom", message: "Укажите эталонный ответ." });
  });
export function grade(
  kind: string,
  expected: string,
  response: string,
): boolean | null {
  if (kind === "text") return null;
  const normalize = (s: string) =>
    s.normalize("NFKC").trim().toLocaleLowerCase("ru").replace(/\s+/g, " ");
  return normalize(expected) === normalize(response);
}
