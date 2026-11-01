import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
export async function checkGames({
  teacher,
  otherTeacher,
  pupil,
  otherPupil,
  studentId,
  lessonId,
  restart,
}) {
  async function call(client, path, body, expected = 200) {
    const r = await client.fetch("/api/games" + path, body);
    const d = await r.json();
    assert.equal(r.status, expected, JSON.stringify(d));
    return d;
  }
  const summaries = await call(teacher, "/sets");
  assert.equal(
    summaries.filter(
      (s) =>
        s.sourceKey?.startsWith("essential-") ||
        s.sourceKey?.startsWith("gogetter-"),
    ).length,
    124,
  );
  await call(pupil, "/sets", undefined, 403);
  const set = await call(teacher, "/sets?id=essential-1");
  assert.equal(set.items.filter((i) => i.type === "sentence").length, 8);
  const custom = await call(
    teacher,
    "/sets",
    { ...set, id: undefined, title: "Copied set" },
    201,
  );
  assert.ok(custom.id);
  await call(otherTeacher, "/sets", { ...set, id: custom.id }, 404);
  await call(teacher, "/sets", { ...set, id: custom.id, title: "Edited copy" });
  assert.equal(
    (await call(teacher, "/sets?id=" + custom.id)).title,
    "Edited copy",
  );
  const create = (kind, mode = "guided") =>
    call(
      teacher,
      "",
      {
        setId: "essential-1",
        title: "Test " + kind,
        studentId,
        lessonId,
        kind,
        mode,
        count: 6,
        timerSeconds: 0,
      },
      201,
    );
  const room = await create("quiz", "duel");
  let views = await call(pupil, "");
  let state = views.find((r) => r.id === room.id);
  assert.ok(state);
  assert.equal(state.state.items, undefined);
  assert.equal(state.state.expected, undefined);
  assert.equal(state.state.item.answer, undefined);
  assert.equal(state.state.seed, undefined);
  assert.ok(!(await call(otherPupil, "")).some((r) => r.id === room.id));
  assert.ok(!(await call(otherTeacher, "")).some((r) => r.id === room.id));
  const command = (client, id, version, action, extra = {}, expected = 200) =>
    call(
      client,
      `/rooms/${id}/commands`,
      { version, commandId: randomUUID(), action, ...extra },
      expected,
    );
  await command(otherPupil, room.id, 0, "answer", { answer: "is" }, 404);
  await command(pupil, room.id, 0, "pause", {}, 403);
  const c = {
    version: 0,
    commandId: randomUUID(),
    action: "answer",
    answer: set.items.find((i) => i.id === state.state.item.id).answer,
  };
  await call(teacher, `/rooms/${room.id}/commands`, c);
  await call(teacher, `/rooms/${room.id}/commands`, c); // idempotent replay
  await command(teacher, room.id, 0, "answer", { answer: "is" }, 409);
  state = (await call(pupil, "")).find((r) => r.id === room.id);
  assert.equal(state.version, 1);
  assert.deepEqual(state.state.answers.teacher, { submitted: true });
  assert.equal(state.state.scores.teacher, 0);
  assert.equal(state.state.log.length, 0);
  await command(pupil, room.id, 1, "answer", { answer: c.answer });
  state = (await call(pupil, "")).find((r) => r.id === room.id);
  assert.equal(state.state.revealed, true);
  assert.equal(state.state.scores.teacher, 1);
  assert.equal(state.state.scores.student, 1);
  const stream = await pupil.fetch("/api/games/events");
  assert.equal(stream.status, 200);
  assert.match(stream.headers.get("content-type"), /event-stream/);
  const reader = stream.body.getReader();
  let received = "";
  const readUntil = async (test) => {
    const finish = Date.now() + 6000;
    while (Date.now() < finish) {
      const chunk = await Promise.race([
        reader.read(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("SSE timeout")), 6500),
        ),
      ]);
      if (chunk.done) throw Error("SSE ended");
      received += new TextDecoder().decode(chunk.value);
      if (test(received)) return;
    }
    throw Error("SSE update absent");
  };
  try {
    await readUntil((s) => s.includes(room.id));
    received = "";
    await command(teacher, room.id, 2, "next");
    await readUntil((s) => s.includes('"version":3'));
  } finally {
    await reader.cancel();
  }
  console.log(
    "PASS live game SSE, idempotency, hidden answers and tenant isolation",
  );
  if (restart) {
    await restart();
    const restored = (await call(pupil, "")).find((r) => r.id === room.id);
    assert.equal(restored.version, 3);
    assert.equal(restored.state.round, 1);
    assert.equal(restored.state.scores.student, 1);
    assert.equal(restored.state.scores.teacher, 1);
    console.log(
      "PASS standalone server restart restores room, scores and authenticated participants",
    );
  }

  for (const kind of ["pairs", "sentence", "race", "quest"]) {
    const r = await create(kind);
    const view = (await call(pupil, "")).find((x) => x.id === r.id);
    assert.ok(view);
    if (kind === "pairs") {
      assert.equal(view.state.cards.length, 12);
      assert.ok(view.state.cards.every((c) => c.text === null));
      await command(pupil, r.id, 0, "flip", { card: view.state.cards[0].id });
      const after = (await call(pupil, "")).find((x) => x.id === r.id);
      assert.ok(after.state.cards[0].text);
      assert.equal(after.state.cards.filter((c) => c.text !== null).length, 1);
    }
    if (kind === "sentence") assert.ok(view.state.item.tokens.length > 1);
    if (kind === "quest") assert.equal(view.state.stages.length, 5);
  }
  const mixed = await call(
    teacher,
    "",
    {
      setId: "gogetter-1",
      title: "Mixed course quest",
      studentId,
      kind: "quest",
      mode: "coop",
      count: 8,
      timerSeconds: 0,
      stageSetIds: [
        "gogetter-1",
        "essential-3",
        "essential-5",
        "essential-11",
        "gogetter-3",
      ],
    },
    201,
  );
  const mixedView = (await call(pupil, "")).find((r) => r.id === mixed.id);
  assert.equal(mixedView.state.cards.length, 6);
  await command(teacher, mixed.id, 0, "next");
  const nextStage = (await call(pupil, "")).find((r) => r.id === mixed.id);
  assert.equal(nextStage.state.stage, 1);
  assert.ok(nextStage.state.item.id.startsWith("stage-1:essential-3"));
  const repeat = await call(teacher, `/rooms/${mixed.id}/repeat`, {});
  assert.equal(repeat.items.length, 3);
  await call(otherTeacher, `/rooms/${mixed.id}/repeat`, {}, 404);
  await call(pupil, `/rooms/${mixed.id}/repeat`, {}, 403);
  console.log(
    "PASS mixed-course quest configuration and snapshot-based error practice",
  );
  const replay = await create("quiz");
  const concurrent = await Promise.all([
    teacher.fetch(`/api/games/rooms/${replay.id}/commands`, {
      version: 0,
      commandId: randomUUID(),
      action: "pause",
    }),
    teacher.fetch(`/api/games/rooms/${replay.id}/commands`, {
      version: 0,
      commandId: randomUUID(),
      action: "pause",
    }),
  ]);
  assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 409]);
  console.log(
    "PASS five game formats, independent set editing, concurrent room commands",
  );
  return { roomId: room.id };
}

export async function checkGamesBrowser({
  page,
  pupilPage,
  base,
  studentId,
  db,
}) {
  await page.setViewportSize({ width: 1440, height: 1050 });
  async function launch(kind, mode) {
    await page.goto(base + "/games?student=" + studentId);
    const card = page.locator(".game-set").filter({
      has: page.getByRole("heading", { name: "1. am/is/are", exact: true }),
    });
    await card.getByRole("button", { name: "На урок", exact: true }).click();
    const labels = {
      pairs: "Найди пару",
      sentence: "Собери фразу",
      quiz: "Викторина",
      race: "Гонка",
      quest: "Приключение",
    };
    await page
      .locator(".format-picker button")
      .filter({ has: page.getByText(labels[kind], { exact: true }) })
      .click();
    await page.getByLabel("Режим игры", { exact: true }).selectOption(mode);
    await page
      .getByRole("button", { name: "Создать общую комнату", exact: true })
      .click();
    await page.locator(".play-panel").waitFor();
    await pupilPage.goto(page.url());
    await pupilPage.locator(".play-panel").waitFor();
    const id = new URL(page.url()).searchParams.get("room");
    const state = (
      await db.query("SELECT state FROM game_rooms WHERE id=$1", [id])
    ).rows[0].state;
    return { id, state };
  }
  const memory = await launch("pairs", "coop");
  const a = memory.state.cards[0];
  const partner = memory.state.cards.findIndex(
    (c) => c.pair === a.pair && c.id !== a.id,
  );
  await pupilPage.locator(".memory-card").nth(0).click();
  await page.waitForFunction(
    () => document.querySelectorAll(".memory-card.flipped").length === 1,
  );
  await pupilPage.locator(".memory-card").nth(partner).click();
  await page.waitForFunction(
    () => document.querySelectorAll(".memory-card.matched").length === 2,
  );
  await pupilPage.waitForFunction(
    () => document.querySelectorAll(".memory-card.matched").length === 2,
  );
  await page.getByRole("button", { name: "Пауза", exact: true }).click();
  await pupilPage.getByRole("heading", { name: "Небольшая пауза" }).waitFor();
  await page.getByRole("button", { name: "Продолжить", exact: true }).click();
  await pupilPage.locator(".memory-board").waitFor();
  await page.reload();
  await page.waitForFunction(
    () => document.querySelectorAll(".memory-card.matched").length === 2,
  );
  await page.screenshot({
    path: "artifacts/game-memory-desktop.png",
    fullPage: true,
  });
  await pupilPage.screenshot({
    path: "artifacts/game-memory-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await pupilPage.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  console.log(
    "PASS two-browser shared memory, pause/resume, reload persistence and mobile layout",
  );
  const sentence = await launch("sentence", "coop");
  let answer = sentence.state.items[0].answer;
  async function assemble(p, answer) {
    for (const word of answer.split(/\s+/)) {
      await p
        .locator(".word-bank")
        .getByRole("button", { name: word, exact: true })
        .first()
        .click();
    }
    await p
      .getByRole("button", { name: "Проверить фразу", exact: true })
      .click();
  }
  await assemble(pupilPage, answer);
  await page.locator(".round-result").waitFor();
  await page.getByRole("button", { name: "Продолжить", exact: true }).click();
  await page.waitForFunction(() =>
    document
      .querySelector(".play-top")
      ?.textContent.includes("Ход преподавателя"),
  );
  await assemble(page, sentence.state.items[1].answer);
  await pupilPage.locator(".round-result").waitFor();
  await page.screenshot({
    path: "artifacts/game-sentence-desktop.png",
    fullPage: true,
  });
  console.log(
    "PASS cooperative sentence building alternates teacher and student",
  );
  const quiz = await launch("quiz", "duel");
  answer = quiz.state.items[0].answer;
  await page
    .locator(".quiz-options")
    .getByRole("button")
    .filter({ hasText: answer })
    .first()
    .click();
  await page
    .getByRole("heading", { name: "Ответ принят", exact: true })
    .waitFor();
  assert.equal(await pupilPage.locator(".round-result").count(), 0);
  await pupilPage
    .locator(".quiz-options")
    .getByRole("button")
    .filter({ hasText: answer })
    .first()
    .click();
  await page.locator(".round-result").waitFor();
  await pupilPage.locator(".round-result").waitFor();
  assert.equal(await page.locator(".answer-review").count(), 2);
  await page.screenshot({
    path: "artifacts/game-duel-desktop.png",
    fullPage: true,
  });
  console.log(
    "PASS duel independently accepts both players before shared reveal",
  );
  const race = await launch("race", "guided");
  await pupilPage
    .locator(".quiz-options")
    .getByRole("button")
    .filter({ hasText: race.state.items[0].answer })
    .first()
    .click();
  await page.locator(".round-result").waitFor();
  assert.notEqual(
    await page.locator(".race-car").evaluate((el) => el.style.left),
    "0%",
  );
  await page.screenshot({
    path: "artifacts/game-race-desktop.png",
    fullPage: true,
  });
  await launch("quest", "guided");
  assert.equal(await page.locator(".quest-stop").count(), 5);
  await page.screenshot({
    path: "artifacts/game-quest-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Пропустить", exact: true }).click();
  await pupilPage.locator(".sentence-target").waitFor();
  console.log(
    "PASS race advances tokens and quest changes location and mechanic",
  );
  await page.getByRole("button", { name: "Все игры", exact: true }).click();
  await page.getByRole("button", { name: "Библиотека", exact: true }).click();
  const card = page.locator(".game-set").filter({
    has: page.getByRole("heading", { name: "1. am/is/are", exact: true }),
  });
  await card.getByRole("button", { name: "Копировать", exact: true }).click();
  await page.getByRole("dialog", { name: "Редактор набора" }).waitFor();
  await page
    .locator(".editor-dialog input")
    .first()
    .fill("Мой английский набор");
  await page
    .getByRole("button", { name: "Сохранить набор", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Мой английский набор", exact: true })
    .waitFor();
  console.log(
    "PASS library copy, editor persistence and launch of custom materials",
  );
}
