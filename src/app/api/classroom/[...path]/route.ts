import { NextResponse } from "next/server";
import { ZodError, z } from "zod";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import { sequelize, Student, Bill, BillSession, User } from "@/lib/db/index";
import {
  actor,
  teacher,
  ownedStudent,
  rows,
  run,
  HttpError,
  sameOrigin,
  studentInput,
  lessonInput,
  homeworkInput,
  exerciseInput,
  digest,
  accessToken,
  grade,
  COOKIE,
  type Actor,
} from "@/lib/classroom/core";
import { addDaysStr } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const uploadDir =
  process.env.UPLOAD_DIR || path.join(process.cwd(), "storage/uploads");
type Context = { params: Promise<{ path: string[] }> };
const idSchema = z.coerce.number().int().positive();
async function homework(a: Actor, id: number) {
  const [h] = await rows<{
    id: number;
    student_id: number;
    exercise_id: number | null;
  }>(
    `SELECT h.* FROM classroom_homework h JOIN students s ON s.id=h.student_id WHERE h.id=:id AND h.owner_id=:owner AND s."deletedAt" IS NULL`,
    { id, owner: a.ownerId },
  );
  if (!h) throw new HttpError(404, "Задание не найдено.");
  await ownedStudent(a, h.student_id);
  return h;
}
async function lesson(a: Actor, id: number) {
  const [l] = await rows<{ id: number; billId: number; studentId: number }>(
    `SELECT bs.id, b.id AS "billId", b."studentId" FROM bill_sessions bs JOIN bills b ON b.id=bs."billId" JOIN students s ON s.id=b."studentId" WHERE bs.id=:id AND b."createdBy"=:owner AND b."deletedAt" IS NULL AND s."deletedAt" IS NULL`,
    { id, owner: a.ownerId },
  );
  if (!l) throw new HttpError(404, "Занятие не найдено.");
  return l;
}
async function snapshot(a: Actor) {
  const filter = a.role === "student" ? " AND s.id=:student" : "";
  const bind = {
    owner: a.ownerId,
    student: a.role === "student" ? a.studentId : 0,
  };
  const students = await rows(
    `SELECT s.id,s.name,s.phone,s.color,p.subject,p.rate,p.meeting_url AS "meetingUrl",${a.role === "teacher" ? "COALESCE(p.notes,'')" : "''"} AS notes,(p.access_hash IS NOT NULL) AS invited FROM students s LEFT JOIN classroom_profiles p ON p.student_id=s.id WHERE s."createdBy"=:owner AND s."deletedAt" IS NULL${filter} ORDER BY s.name`,
    bind,
  );
  const lessons = await rows(
    `SELECT bs.id,b."studentId",s.name AS "studentName",bs."scheduledDate" AS date,bs."startTime" AS start,bs."endTime" AS end,bs."isAttended" AS attended,b."totalAmount" AS price,b.status AS payment,COALESCE(l.title,p.subject,'Занятие') AS title,COALESCE(NULLIF(l.meeting_url,''),p.meeting_url,'') AS "meetingUrl",COALESCE(l.cancelled,false) AS cancelled FROM bill_sessions bs JOIN bills b ON b.id=bs."billId" JOIN students s ON s.id=b."studentId" LEFT JOIN classroom_lessons l ON l.session_id=bs.id LEFT JOIN classroom_profiles p ON p.student_id=s.id WHERE b."createdBy"=:owner AND b."deletedAt" IS NULL AND s."deletedAt" IS NULL${filter} ORDER BY bs."scheduledDate",bs."startTime"`,
    bind,
  );
  const hw = await rows(
    `SELECT h.*,s.name AS "studentName",e.title AS "exerciseTitle",e.kind,e.prompt,e.options${a.role === "teacher" ? ",e.answer,e.explanation" : ""} FROM classroom_homework h JOIN students s ON s.id=h.student_id LEFT JOIN classroom_exercises e ON e.id=h.exercise_id WHERE h.owner_id=:owner AND s."deletedAt" IS NULL${filter} ORDER BY h.due_date,h.id DESC`,
    bind,
  );
  const files = await rows(
    `SELECT f.* FROM classroom_files f JOIN classroom_homework h ON h.id=f.homework_id JOIN students s ON s.id=h.student_id WHERE h.owner_id=:owner AND s."deletedAt" IS NULL${filter} ORDER BY f.created_at`,
    bind,
  );
  const attempts = await rows(
    `SELECT t.* FROM classroom_attempts t JOIN classroom_homework h ON h.id=t.homework_id JOIN students s ON s.id=h.student_id WHERE h.owner_id=:owner AND s."deletedAt" IS NULL${filter} ORDER BY t.created_at DESC`,
    bind,
  );
  const exercises =
    a.role === "teacher"
      ? await rows(
          "SELECT * FROM classroom_exercises WHERE owner_id IS NULL OR owner_id=:owner ORDER BY id",
          bind,
        )
      : [];
  const [user] = await rows<{ name: string; email: string }>(
    "SELECT name,email FROM users WHERE id=:owner",
    bind,
  );
  return {
    role: a.role,
    name:
      a.role === "teacher" ? user?.name || "Преподаватель" : students[0]?.name,
    students,
    lessons,
    homework: hw,
    files,
    attempts,
    exercises,
  };
}
async function handle(req: Request, context: Context) {
  const { path: parts } = await context.params;
  const [resource, rawId, action] = parts;
  const a = await actor();
  if (req.method !== "GET") sameOrigin(req);
  if (resource === "snapshot" && req.method === "GET")
    return NextResponse.json(await snapshot(a));
  if (resource === "logout" && req.method === "POST") {
    const res = NextResponse.json({ ok: true });
    res.cookies.set(COOKIE, "", { maxAge: 0, path: "/" });
    return res;
  }
  if (resource === "files" && req.method === "GET") {
    const uuid = z.string().uuid().parse(rawId);
    const [f] = await rows<{ homework_id: number; name: string }>(
      "SELECT * FROM classroom_files WHERE id=:id",
      { id: uuid },
    );
    if (!f) throw new HttpError(404, "Файл не найден.");
    await homework(a, f.homework_id);
    let data: Buffer;
    try {
      data = await readFile(path.join(uploadDir, uuid));
    } catch {
      throw new HttpError(404, "Файл отсутствует в хранилище.");
    }
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(f.name)}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  }
  if (
    resource === "homework" &&
    rawId &&
    action === "files" &&
    req.method === "POST"
  ) {
    const id = idSchema.parse(rawId);
    await homework(a, id);
    if (Number(req.headers.get("content-length") || 0) > 21 * 1024 * 1024)
      throw new HttpError(413, "Максимальный размер файла — 20 МБ.");
    const form = await req.formData();
    const f = form.get("file");
    if (!(f instanceof File) || !f.size || f.size > 20 * 1024 * 1024)
      throw new HttpError(400, "Выберите файл размером до 20 МБ.");
    const uuid = randomUUID();
    await mkdir(uploadDir, { recursive: true, mode: 0o700 });
    await writeFile(
      path.join(uploadDir, uuid),
      Buffer.from(await f.arrayBuffer()),
      { mode: 0o600, flag: "wx" },
    );
    try {
      await run(
        "INSERT INTO classroom_files(id,homework_id,student_upload,name,size) VALUES (:id,:hw,:student,:name,:size)",
        {
          id: uuid,
          hw: id,
          student: a.role === "student",
          name: f.name.replace(/[\x00-\x1f\x7f]/g, "").slice(0, 255) || "Файл",
          size: f.size,
        },
      );
    } catch (error) {
      await unlink(path.join(uploadDir, uuid));
      throw error;
    }
    return NextResponse.json({ ok: true }, { status: 201 });
  }
  const body =
    req.method === "GET"
      ? {}
      : await req.json().catch(() => {
          throw new HttpError(400, "Некорректный JSON.");
        });
  if (
    resource === "homework" &&
    rawId &&
    action === "submit" &&
    req.method === "POST"
  ) {
    if (a.role !== "student")
      throw new HttpError(403, "Отправка доступна ученику.");
    const h = await homework(a, idSchema.parse(rawId));
    const { response } = z
      .object({
        response: z.string().trim().min(1, "Напишите ответ.").max(20000),
      })
      .parse(body);
    let correct: boolean | null = null;
    let explanation = "";
    await sequelize.transaction(async (transaction) => {
      if (h.exercise_id) {
        const [e] = await rows<{
          kind: string;
          answer: string;
          explanation: string;
          options: string[];
        }>(
          "SELECT * FROM classroom_exercises WHERE id=:id",
          { id: h.exercise_id },
          transaction,
        );
        if (
          e.kind === "choice" &&
          (!/^\d+$/.test(response) || Number(response) >= e.options.length)
        )
          throw new HttpError(400, "Выберите вариант ответа.");
        correct = grade(e.kind, e.answer, response);
        explanation = correct === true ? e.explanation : "";
        await run(
          "INSERT INTO classroom_attempts(homework_id,response,correct) VALUES (:id,:response,:correct)",
          { id: h.id, response, correct },
          transaction,
        );
      }
      await run(
        `UPDATE classroom_homework SET submission=:response,status='submitted',feedback='' WHERE id=:id`,
        { response, id: h.id },
        transaction,
      );
    });
    return NextResponse.json({ ok: true, correct, explanation });
  }
  teacher(a);
  if (resource === "students" && req.method === "POST" && !rawId) {
    const s = studentInput.parse(body);
    const student = await sequelize.transaction(async (transaction) => {
      const model = await Student.create(
        {
          name: s.name,
          phone: s.phone,
          subject: "english",
          type: "online",
          createdBy: a.ownerId,
        },
        { transaction },
      );
      await run(
        `INSERT INTO classroom_profiles(student_id,subject,rate,meeting_url,notes) VALUES(:id,:subject,:rate,:url,:notes)`,
        {
          id: model.id,
          subject: s.subject,
          rate: s.rate,
          url: s.meetingUrl,
          notes: s.notes,
        },
        transaction,
      );
      return model;
    });
    return NextResponse.json({ id: student.id }, { status: 201 });
  }
  if (resource === "students" && rawId) {
    const id = idSchema.parse(rawId);
    await ownedStudent(a, id);
    if (action === "invite" && req.method === "POST") {
      const token = accessToken();
      await run(
        "UPDATE classroom_profiles SET access_hash=:hash WHERE student_id=:id",
        { hash: digest(token), id },
      );
      return NextResponse.json({
        link: `${process.env.AUTH_URL || new URL(req.url).origin}/join#${token}`,
      });
    }
    if (req.method === "PATCH") {
      const s = studentInput.parse(body);
      await sequelize.transaction(async (transaction) => {
        await Student.update(
          { name: s.name, phone: s.phone },
          { where: { id, createdBy: a.ownerId }, transaction },
        );
        await run(
          "UPDATE classroom_profiles SET subject=:subject,rate=:rate,meeting_url=:url,notes=:notes WHERE student_id=:id",
          {
            id,
            subject: s.subject,
            rate: s.rate,
            url: s.meetingUrl,
            notes: s.notes,
          },
          transaction,
        );
      });
      return NextResponse.json({ ok: true });
    }
    if (req.method === "DELETE") {
      await Student.update(
        { deletedAt: new Date() },
        { where: { id, createdBy: a.ownerId } },
      );
      return NextResponse.json({ ok: true });
    }
  }
  if (resource === "lessons" && req.method === "POST" && !rawId) {
    const l = lessonInput.parse(body);
    await sequelize.transaction(async (transaction) => {
      await ownedStudent(a, l.studentId, transaction);
      await run(
        "SELECT pg_advisory_xact_lock(:owner)",
        { owner: a.ownerId },
        transaction,
      );
      for (let i = 0; i < l.repeat; i++) {
        const date = addDaysStr(l.date, 7 * i);
        const clash = await rows(
          `SELECT bs.id FROM bill_sessions bs JOIN bills b ON b.id=bs."billId" JOIN students s ON s.id=b."studentId" LEFT JOIN classroom_lessons l ON l.session_id=bs.id WHERE b."createdBy"=:owner AND b."deletedAt" IS NULL AND s."deletedAt" IS NULL AND COALESCE(l.cancelled,false)=false AND bs."scheduledDate"=:date AND bs."startTime" < :end AND bs."endTime" > :start`,
          { owner: a.ownerId, date, start: l.start, end: l.end },
          transaction,
        );
        if (clash.length)
          throw new HttpError(
            409,
            `В расписании уже есть занятие ${date} в это время.`,
          );
        const bill = await Bill.create(
          {
            studentId: l.studentId,
            sessionCount: 1,
            totalAmount: l.price,
            status: "unpaid",
            paidAt: null,
            notes: null,
            startDate: date,
            createdBy: a.ownerId,
            deletedAt: null,
          },
          { transaction },
        );
        const bs = await BillSession.create(
          {
            billId: bill.id,
            scheduledDate: date,
            startTime: l.start,
            endTime: l.end,
            notes: null,
          },
          { transaction },
        );
        await run(
          "INSERT INTO classroom_lessons(session_id,title,meeting_url) VALUES(:id,:title,:url)",
          { id: bs.id, title: l.title, url: l.meetingUrl },
          transaction,
        );
      }
    });
    return NextResponse.json({ ok: true }, { status: 201 });
  }
  if (
    resource === "lessons" &&
    rawId &&
    action === "move" &&
    req.method === "POST"
  ) {
    const existing = await lesson(a, idSchema.parse(rawId));
    const l = lessonInput.parse(body);
    if (l.studentId !== existing.studentId)
      throw new HttpError(
        400,
        "Нельзя сменить ученика у существующего занятия.",
      );
    await sequelize.transaction(async (transaction) => {
      await run(
        "SELECT pg_advisory_xact_lock(:owner)",
        { owner: a.ownerId },
        transaction,
      );
      const clash = await rows(
        `SELECT bs.id FROM bill_sessions bs JOIN bills b ON b.id=bs."billId" JOIN students s ON s.id=b."studentId" LEFT JOIN classroom_lessons l ON l.session_id=bs.id WHERE b."createdBy"=:owner AND b."deletedAt" IS NULL AND s."deletedAt" IS NULL AND COALESCE(l.cancelled,false)=false AND bs.id != :id AND bs."scheduledDate"=:date AND bs."startTime" < :end AND bs."endTime" > :start`,
        {
          owner: a.ownerId,
          id: existing.id,
          date: l.date,
          start: l.start,
          end: l.end,
        },
        transaction,
      );
      if (clash.length)
        throw new HttpError(409, "Это время уже занято. Выберите другое.");
      await BillSession.update(
        { scheduledDate: l.date, startTime: l.start, endTime: l.end },
        { where: { id: existing.id }, transaction },
      );
      await Bill.update(
        { totalAmount: l.price, startDate: l.date },
        { where: { id: existing.billId, createdBy: a.ownerId }, transaction },
      );
      await run(
        "UPDATE classroom_lessons SET title=:title,meeting_url=:url WHERE session_id=:id",
        { id: existing.id, title: l.title, url: l.meetingUrl },
        transaction,
      );
    });
    return NextResponse.json({ ok: true });
  }
  if (resource === "lessons" && rawId && req.method === "PATCH") {
    const l = await lesson(a, idSchema.parse(rawId));
    const change = z
      .object({
        payment: z.enum(["paid", "unpaid"]).optional(),
        attended: z.boolean().optional(),
        cancelled: z.boolean().optional(),
      })
      .parse(body);
    await sequelize.transaction(async (transaction) => {
      if (change.payment !== undefined)
        await Bill.update(
          {
            status: change.payment,
            paidAt: change.payment === "paid" ? new Date() : null,
          },
          { where: { id: l.billId, createdBy: a.ownerId }, transaction },
        );
      if (change.attended !== undefined)
        await BillSession.update(
          { isAttended: change.attended },
          { where: { id: l.id }, transaction },
        );
      if (change.cancelled !== undefined) {
        await run(
          "SELECT pg_advisory_xact_lock(:owner)",
          { owner: a.ownerId },
          transaction,
        );
        if (!change.cancelled)
          throw new HttpError(
            400,
            "Создайте новое занятие для восстановления отменённого.",
          );
        await run(
          "UPDATE classroom_lessons SET cancelled=true WHERE session_id=:id",
          { id: l.id },
          transaction,
        );
      }
    });
    return NextResponse.json({ ok: true });
  }
  if (resource === "homework" && req.method === "POST" && !rawId) {
    const h = homeworkInput.parse(body);
    await ownedStudent(a, h.studentId);
    if (h.exerciseId) {
      const e = await rows(
        "SELECT id FROM classroom_exercises WHERE id=:id AND (owner_id=:owner OR owner_id IS NULL)",
        { id: h.exerciseId, owner: a.ownerId },
      );
      if (!e.length) throw new HttpError(404, "Шаблон не найден.");
    }
    if (h.sessionId) {
      const l = await lesson(a, h.sessionId);
      if (l.studentId !== h.studentId)
        throw new HttpError(400, "Занятие принадлежит другому ученику.");
    }
    const [created] = await rows<{ id: number }>(
      `INSERT INTO classroom_homework(student_id,owner_id,session_id,title,body,due_date,exercise_id) VALUES(:student,:owner,:session,:title,:body,:due,:exercise) RETURNING id`,
      {
        student: h.studentId,
        owner: a.ownerId,
        session: h.sessionId,
        title: h.title,
        body: h.body,
        due: h.due,
        exercise: h.exerciseId,
      },
    );
    return NextResponse.json(created, { status: 201 });
  }
  if (resource === "homework" && rawId && req.method === "PATCH") {
    const h = await homework(a, idSchema.parse(rawId));
    const change = z
      .object({
        feedback: z.string().max(10000),
        status: z.enum(["assigned", "reviewed"]),
      })
      .parse(body);
    await run(
      "UPDATE classroom_homework SET feedback=:feedback,status=:status WHERE id=:id",
      { ...change, id: h.id },
    );
    return NextResponse.json({ ok: true });
  }
  if (resource === "exercises" && req.method === "POST") {
    const e = exerciseInput.parse(body);
    const [created] = await rows<{ id: number }>(
      `INSERT INTO classroom_exercises(owner_id,title,kind,prompt,options,answer,explanation) VALUES(:owner,:title,:kind,:prompt,CAST(:options AS jsonb),:answer,:explanation) RETURNING id`,
      { ...e, owner: a.ownerId, options: JSON.stringify(e.options) },
    );
    return NextResponse.json(created, { status: 201 });
  }
  if (resource === "password" && req.method === "POST") {
    const p = z
      .object({
        current: z.string().max(200),
        password: z.string().min(12, "Минимум 12 символов.").max(72),
      })
      .parse(body);
    const u = await User.findByPk(a.ownerId);
    if (!u?.passwordHash || !(await bcrypt.compare(p.current, u.passwordHash)))
      throw new HttpError(400, "Текущий пароль неверен.");
    await u.update({ passwordHash: await bcrypt.hash(p.password, 12) });
    return NextResponse.json({ ok: true });
  }
  throw new HttpError(404, "Действие не найдено.");
}
async function dispatch(req: Request, ctx: Context) {
  try {
    const response = await handle(req, ctx);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    if (error instanceof HttpError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    if (error instanceof ZodError)
      return NextResponse.json(
        { error: error.issues.map((i) => i.message).join(" ") },
        { status: 400 },
      );
    console.error("[classroom]", error);
    return NextResponse.json(
      { error: "Не удалось выполнить действие. Попробуйте ещё раз." },
      { status: 500 },
    );
  }
}
export {
  dispatch as GET,
  dispatch as POST,
  dispatch as PATCH,
  dispatch as DELETE,
};
