import assert from "node:assert/strict";
import { checkLibrary, checkLibraryBrowser } from "./library.mjs";
import { checkGames, checkGamesBrowser } from "./games.mjs";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import pg from "pg";
import bcrypt from "bcryptjs";
const base = process.env.TUTOR_TEST_URL || "http://localhost:3000";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname))
  throw new Error("Integration fixtures must run against a local test server.");
if (!process.env.DATABASE_URL)
  throw new Error("Set DATABASE_URL to the disposable test database.");
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const prefix = "integration-" + randomUUID(),
  password = "test-only-LongPassword42";
const owners = [],
  fileIds = [];
class Client {
  constructor() {
    this.jar = new Map();
  }
  async fetch(
    url,
    body,
    method = body === undefined ? "GET" : "POST",
    origin = base,
  ) {
    const r = await fetch(base + url, {
      method,
      headers: {
        Cookie: [...this.jar].map(([k, v]) => k + "=" + v).join("; "),
        Origin: origin,
        ...(body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
      },
      body:
        body === undefined
          ? undefined
          : body instanceof FormData
            ? body
            : JSON.stringify(body),
      redirect: "manual",
    });
    for (const c of r.headers.getSetCookie()) {
      const pair = c.split(";")[0],
        idx = pair.indexOf("=");
      this.jar.set(pair.slice(0, idx), pair.slice(idx + 1));
    }
    return r;
  }
  async call(url, body, method, expected = 200) {
    const r = await this.fetch("/api/classroom/" + url, body, method);
    const data = await r.json();
    assert.equal(r.status, expected, JSON.stringify(data));
    return data;
  }
  async login(email) {
    const r = await this.fetch("/api/auth/csrf");
    const { csrfToken } = await r.json();
    const form = new URLSearchParams({
      csrfToken,
      email,
      password,
      callbackUrl: base,
      json: "true",
    });
    const response = await fetch(base + "/api/auth/callback/credentials", {
      method: "POST",
      headers: {
        Cookie: [...this.jar].map(([k, v]) => k + "=" + v).join("; "),
        Origin: base,
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Auth-Return-Redirect": "1",
      },
      body: form,
      redirect: "manual",
    });
    for (const c of response.headers.getSetCookie()) {
      const pair = c.split(";")[0],
        idx = pair.indexOf("=");
      this.jar.set(pair.slice(0, idx), pair.slice(idx + 1));
    }
    assert.ok(
      [...this.jar.keys()].some((k) => k.includes("session-token")),
      "Login did not return session cookie",
    );
  }
}
const teacher = new Client(),
  otherTeacher = new Client(),
  pupil = new Client(),
  otherPupil = new Client(),
  anon = new Client();
const pass = (s) => console.log("PASS " + s);
let browser;
try {
  for (let n = 0; n < 2; n++) {
    const email = `${prefix}-${n}@example.test`;
    const result = await db.query(
      'INSERT INTO users(email,name,"passwordHash","createdAt","updatedAt") VALUES($1,$2,$3,now(),now()) RETURNING id',
      [
        email,
        n ? "Другой преподаватель" : "Кирилл",
        await bcrypt.hash(password, 12),
      ],
    );
    owners.push(result.rows[0].id);
    await (n ? otherTeacher : teacher).login(email);
  }
  await anon.call("snapshot", undefined, "GET", 401);
  pass("anonymous access denied; real credentials sign-in");
  const s = await teacher.call(
    "students",
    {
      name: "Анна Смирнова",
      phone: "@anna",
      subject: "Программирование",
      rate: 2000,
      meetingUrl: "https://meet.example.test/anna",
      notes: "private teacher note",
    },
    "POST",
    201,
  );
  const s2 = await teacher.call(
    "students",
    { name: "Михаил Петров", subject: "Математика", rate: 1500 },
    "POST",
    201,
  );
  await otherTeacher.call(`students/${s.id}/invite`, {}, "POST", 404);
  assert.equal(
    (await otherTeacher.call("snapshot", undefined, "GET")).students.length,
    0,
  );
  pass("teacher ownership isolation");
  await teacher.call(
    "students",
    { name: "Bad link", meetingUrl: "javascript:alert(1)" },
    "POST",
    400,
  );
  const lesson = {
    studentId: s.id,
    title: "Знакомство с SQL",
    date: "2027-01-05",
    start: "16:00",
    end: "17:00",
    price: 2000,
    repeat: 4,
  };
  await teacher.call("lessons", lesson, "POST", 201);
  await teacher.call(
    "lessons",
    { ...lesson, studentId: s2.id, repeat: 1 },
    "POST",
    409,
  );
  await teacher.call(
    "lessons",
    { ...lesson, date: "2026-12-29", repeat: 2 },
    "POST",
    409,
  );
  let state = await teacher.call("snapshot", undefined, "GET");
  assert.equal(
    state.lessons.length,
    4,
    "Repeated schedule conflict must roll back every lesson",
  );
  await teacher.call(
    "lessons",
    { ...lesson, date: "2027-02-30", repeat: 1 },
    "POST",
    400,
  );
  await teacher.call(
    "lessons",
    { ...lesson, start: "17:00", end: "16:00" },
    "POST",
    400,
  );
  const concurrent = await Promise.all([
    teacher.fetch("/api/classroom/lessons", {
      ...lesson,
      date: "2027-02-09",
      repeat: 1,
    }),
    teacher.fetch("/api/classroom/lessons", {
      ...lesson,
      date: "2027-02-09",
      repeat: 1,
    }),
  ]);
  assert.deepEqual(concurrent.map((r) => r.status).sort(), [201, 409]);
  pass(
    "repeated lessons, atomic rollback, date validation, concurrent conflict protection",
  );
  const l = state.lessons[0];
  assert.equal(l.meetingUrl, "https://meet.example.test/anna");
  await teacher.call(
    `lessons/${l.id}`,
    { payment: "paid", attended: true },
    "PATCH",
  );
  state = await teacher.call("snapshot", undefined, "GET");
  assert.equal(state.lessons[0].payment, "paid");
  assert.equal(state.lessons[0].attended, true);
  pass("per-lesson payment, attendance, default meeting URL");
  await teacher.call(
    `lessons/${l.id}/move`,
    { ...lesson, date: "2027-01-06", repeat: 1 },
    "POST",
  );
  await teacher.call(
    `lessons/${l.id}/move`,
    { ...lesson, date: "2027-01-12", repeat: 1 },
    "POST",
    409,
  );
  state = await teacher.call("snapshot", undefined, "GET");
  const moved = state.lessons.find((item) => item.id === l.id);
  assert.equal(moved.date, "2027-01-06");
  assert.equal(moved.payment, "paid");
  assert.equal(moved.attended, true);
  pass("rescheduling preserves payments and attendance and rejects overlaps");

  const exercise = state.exercises.find((e) => e.kind === "choice");
  const short = state.exercises.find(
    (e) => e.kind === "short" && e.answer === "went",
  );
  const hw = await teacher.call(
    "homework",
    {
      studentId: s.id,
      sessionId: l.id,
      title: "Практика после занятия",
      body: "Выполните задание. https://example.test/material",
      due: "2027-01-12",
      exerciseId: exercise.id,
    },
    "POST",
    201,
  );
  const hw2 = await teacher.call(
    "homework",
    { studentId: s2.id, title: "Личное задание Михаила", due: "2027-01-13" },
    "POST",
    201,
  );
  const shortHw = await teacher.call(
    "homework",
    {
      studentId: s.id,
      title: "Глаголы",
      due: "2027-01-13",
      exerciseId: short.id,
    },
    "POST",
    201,
  );
  const file = new FormData();
  file.set(
    "file",
    new File(["Учебный материал"], "материал.txt", { type: "text/plain" }),
  );
  await teacher.call(`homework/${hw.id}/files`, file, "POST", 201);
  state = await teacher.call("snapshot", undefined, "GET");
  fileIds.push(...state.files.map((f) => f.id));
  const link = (await teacher.call(`students/${s.id}/invite`, {})).link;
  const token = link.split("#")[1];
  assert.equal(
    (await pupil.fetch("/api/portal/access", { token })).status,
    200,
  );
  const link2 = (await teacher.call(`students/${s2.id}/invite`, {})).link;
  assert.equal(
    (
      await otherPupil.fetch("/api/portal/access", {
        token: link2.split("#")[1],
      })
    ).status,
    200,
  );
  const ps = await pupil.call("snapshot", undefined, "GET");
  assert.equal(ps.students.length, 1);
  assert.equal(ps.students[0].id, s.id);
  assert.equal(ps.students[0].notes, "");
  assert.ok(ps.homework.every((h) => h.student_id === s.id));
  assert.equal(ps.exercises.length, 0);
  assert.ok(!("answer" in ps.homework[0]));
  assert.ok(!("explanation" in ps.homework[0]));
  await pupil.call("students", { name: "Not allowed" }, "POST", 403);
  await pupil.call(
    `homework/${hw2.id}/submit`,
    { response: "bad" },
    "POST",
    404,
  );
  const fileId = state.files[0].id;
  assert.equal(
    (await anon.fetch("/api/classroom/files/" + fileId)).status,
    401,
  );
  assert.equal(
    (await otherPupil.fetch("/api/classroom/files/" + fileId)).status,
    404,
  );
  const download = await pupil.fetch("/api/classroom/files/" + fileId);
  assert.equal(await download.text(), "Учебный материал");
  assert.ok(
    download.headers.get("content-disposition").startsWith("attachment;"),
  );
  pass(
    "student isolation, hidden answer keys, protected private file downloads",
  );
  const bad = await pupil.call(`homework/${hw.id}/submit`, {
    response: exercise.answer === "0" ? "1" : "0",
  });
  assert.equal(bad.correct, false);
  assert.equal(bad.explanation, "");
  const good = await pupil.call(`homework/${hw.id}/submit`, {
    response: exercise.answer,
  });
  assert.equal(good.correct, true);
  const normalized = await pupil.call(`homework/${shortHw.id}/submit`, {
    response: "  WENT  ",
  });
  assert.equal(normalized.correct, true);
  await teacher.call(
    `homework/${hw.id}`,
    { feedback: "Отличная работа!", status: "reviewed" },
    "PATCH",
  );
  const reviewed = await pupil.call("snapshot", undefined, "GET");
  assert.equal(
    reviewed.homework.find((h) => h.id === hw.id).feedback,
    "Отличная работа!",
  );
  pass(
    "wrong/correct answers, normalized grading, attempt history, teacher feedback",
  );
  const forged = await teacher.fetch(
    "/api/classroom/students",
    { name: "CSRF" },
    "POST",
    "https://attacker.example",
  );
  assert.equal(forged.status, 403);
  const custom = await teacher.call(
    "exercises",
    {
      title: "Новая практика",
      kind: "short",
      prompt: "Сколько будет 2+2?",
      answer: "4",
    },
    "POST",
    201,
  );
  assert.ok(custom.id);
  await teacher.call(
    "exercises",
    {
      title: "Некорректный тест",
      kind: "choice",
      prompt: "Вопрос",
      options: ["A"],
      answer: "99",
    },
    "POST",
    400,
  );
  pass("CSRF protection and custom template validation");
  const gameFixture = await checkGames({
    teacher,
    otherTeacher,
    pupil,
    otherPupil,
    studentId: s.id,
    lessonId: l.id,
    restart:
      process.env.TUTOR_TEST_RESTART === "1"
        ? () =>
            new Promise((resolve, reject) => {
              const timer = setTimeout(
                () => reject(new Error("Restart hook timeout")),
                30000,
              );
              process.once("message", (message) => {
                clearTimeout(timer);
                if (message === "ready") resolve();
                else reject(new Error("Restart failed"));
              });
              process.send({ type: "restart" });
            })
        : undefined,
  });
  const libraryFixture = await checkLibrary({
    teacher,
    otherTeacher,
    pupil,
    otherPupil,
    studentId: s.id,
  });
  if (process.env.PLAYWRIGHT_MODULE) {
    const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox"],
      ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
        ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
        : {}),
    });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1050 },
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + "/signin");
    await page.locator("input[name=email]").fill(`${prefix}-0@example.test`);
    await page.locator("input[name=password]").fill(password);
    await page.getByRole("button", { name: "Продолжить" }).click();
    await page.getByRole("heading", { name: /Здравствуйте, Кирилл/ }).waitFor();
    await mkdir("artifacts", { recursive: true });
    await page.screenshot({
      path: "artifacts/overview-desktop.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "Ученики", exact: true }).click();
    await page
      .getByRole("heading", { name: "Анна Смирнова", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Добавить ученика", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByLabel("Имя ученика")
      .fill("Елена Тестовая");
    await page
      .getByRole("dialog")
      .getByLabel("Предмет", { exact: true })
      .fill("Английский язык");
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await page
      .getByRole("heading", { name: "Елена Тестовая", exact: true })
      .waitFor();
    pass("browser login and student creation");
    await page.getByRole("button", { name: "Расписание", exact: true }).click();
    await page.locator(".week-navigation h2").waitFor();
    await page
      .getByRole("button", { name: "Новое занятие", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByLabel("Ученик", { exact: true })
      .selectOption(String(s.id));
    await page
      .getByRole("dialog")
      .getByLabel("Тема занятия", { exact: true })
      .fill("Тема из браузера");
    assert.equal(
      await page
        .getByRole("dialog")
        .getByLabel("Стоимость занятия, ₽")
        .inputValue(),
      "2000",
    );
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await page
      .locator(".calendar-event")
      .filter({ hasText: "Тема из браузера" })
      .waitFor();
    await page
      .locator(".calendar-event")
      .filter({ hasText: "Тема из браузера" })
      .click();
    await page
      .getByRole("button", { name: "Изменить время и тему", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByLabel("Тема занятия", { exact: true })
      .fill("Новая тема из браузера");
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await page
      .locator(".calendar-event")
      .filter({ hasText: "Новая тема из браузера" })
      .waitFor();
    pass("browser lesson creation, student rate default, lesson editing");

    await page.screenshot({
      path: "artifacts/schedule-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Обзор", exact: true }).click();
    await page.screenshot({
      path: "artifacts/overview-mobile.png",
      fullPage: true,
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      "Mobile page must fit viewport",
    );
    const pupilContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const pupilPage = await pupilContext.newPage();
    pupilPage.on("pageerror", (e) => errors.push(e.message));
    await pupilPage.goto(link);
    await pupilPage.getByRole("heading", { name: /Привет, Анна/ }).waitFor();
    assert.equal(new URL(pupilPage.url()).hash, "");
    await pupilPage
      .getByRole("button", { name: "Домашние задания", exact: true })
      .click();
    await pupilPage
      .getByRole("heading", { name: "Глаголы", exact: true })
      .waitFor();
    const card = pupilPage.locator(".homework-card").filter({
      has: pupilPage.getByRole("heading", { name: "Глаголы", exact: true }),
    });
    await card.getByRole("button").click();
    await pupilPage
      .getByRole("dialog")
      .getByLabel("Ваш короткий ответ")
      .fill("went");
    await pupilPage.getByRole("button", { name: "Отправить ответ" }).click();
    await pupilPage.getByRole("status").filter({ hasText: "Верно!" }).waitFor();
    await pupilPage.screenshot({
      path: "artifacts/pupil-mobile.png",
      fullPage: true,
    });
    await checkLibraryBrowser({ page, pupilPage, base, studentId: s.id, db });
    await checkGamesBrowser({ page, pupilPage, base, studentId: s.id, db });
    assert.deepEqual(errors, []);
    await context.close();
    await pupilContext.close();
    pass(
      "mobile layout, pupil invitation redemption, homework submission, no browser errors",
    );
  }
  const revokedStream = await pupil.fetch("/api/games/events");
  const revokedReader = revokedStream.body.getReader();
  await revokedReader.read();
  await teacher.call(`students/${s.id}/invite`, {});
  let revokedText = "";
  try {
    for (
      let attempt = 0;
      attempt < 8 && !revokedText.includes("event: revoked");
      attempt++
    ) {
      const chunk = await revokedReader.read();
      if (chunk.done) break;
      revokedText += new TextDecoder().decode(chunk.value);
    }
    assert.ok(
      revokedText.includes("event: revoked"),
      "Rotated link must terminate active game stream",
    );
  } finally {
    await revokedReader.cancel();
  }
  pass("active game stream is revoked with the student invitation");

  await pupil.call("snapshot", undefined, "GET", 401);
  assert.equal(
    (await pupil.fetch("/api/portal/access", { token })).status,
    401,
  );
  pass("rotating invitation revokes old links and active sessions");
  await teacher.call(`students/${s2.id}`, {}, "DELETE");
  await otherPupil.call("snapshot", undefined, "GET", 401);
  pass("archiving revokes student access");
  await teacher.call(
    "password",
    { current: "wrong", password: "new-only-TestPassword99" },
    "POST",
    400,
  );
  await teacher.call(
    "password",
    { current: password, password: "new-only-TestPassword99" },
    "POST",
  );
  await teacher.call("snapshot", undefined, "GET", 401);
  pass("password change revokes existing teacher sessions");
  console.log("All integration checks passed.");
} finally {
  await browser?.close();
  // Delete only records belonging to the two disposable fixture owners.
  if (owners.length) {
    await db.query("DELETE FROM game_rooms WHERE owner_id=ANY($1)", [owners]);
    await db.query(
      "DELETE FROM learning_attempts WHERE homework_id IN (SELECT id FROM classroom_homework WHERE owner_id=ANY($1))",
      [owners],
    );
    const files = await db.query(
      "SELECT f.id FROM classroom_files f JOIN classroom_homework h ON h.id=f.homework_id WHERE h.owner_id=ANY($1)",
      [owners],
    );
    await db.query(
      "DELETE FROM classroom_files WHERE homework_id IN (SELECT id FROM classroom_homework WHERE owner_id=ANY($1))",
      [owners],
    );
    await db.query(
      "DELETE FROM classroom_attempts WHERE homework_id IN (SELECT id FROM classroom_homework WHERE owner_id=ANY($1))",
      [owners],
    );
    await db.query("DELETE FROM classroom_homework WHERE owner_id=ANY($1)", [
      owners,
    ]);
    await db.query("DELETE FROM game_sets WHERE owner_id=ANY($1)", [owners]);
    await db.query("DELETE FROM classroom_exercises WHERE owner_id=ANY($1)", [
      owners,
    ]);
    await db.query(
      'DELETE FROM classroom_profiles WHERE student_id IN (SELECT id FROM students WHERE "createdBy"=ANY($1))',
      [owners],
    );
    await db.query('DELETE FROM bills WHERE "createdBy"=ANY($1)', [owners]);
    await db.query('DELETE FROM students WHERE "createdBy"=ANY($1)', [owners]);
    await db.query("DELETE FROM users WHERE id=ANY($1)", [owners]);
    if (process.env.UPLOAD_DIR)
      for (const f of files.rows)
        await rm(process.env.UPLOAD_DIR + "/" + f.id, { force: true });
  }
  await db.end();
}
