import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
export async function checkLibrary({
  teacher,
  otherTeacher,
  pupil,
  otherPupil,
  studentId,
}) {
  async function call(client, path, body, expected = 200) {
    const r = await client.fetch(path, body);
    const d = await r.json();
    assert.equal(r.status, expected, JSON.stringify(d));
    return d;
  }
  const base = await call(teacher, "/api/games/sets?id=essential-1");
  assert.match(base.id, /^[0-9a-f-]{36}$/);
  const chosen = base.items.filter((i) => i.type === "choice").slice(0, 2);
  const hw = await call(
    teacher,
    "/api/library/homework",
    {
      setId: base.id,
      studentId,
      title: "Единый набор для ДЗ",
      due: "2027-01-20",
      itemIds: chosen.map((i) => i.id),
    },
    201,
  );
  let view = await call(pupil, "/api/library/homework/" + hw.id);
  assert.equal(view.items.length, 2);
  assert.ok(
    view.items.every(
      (i) => i.answer === undefined && i.explanation === undefined,
    ),
  );
  const snapshot = await teacher.call("snapshot", undefined, "GET");
  const record = snapshot.homework.find((h) => h.id === hw.id);
  assert.equal(record.learning_count, 2);
  assert.equal(record.learning_snapshot, undefined);
  const room = await call(
    teacher,
    "/api/games",
    {
      setId: base.id,
      studentId,
      title: "Та же карточка на уроке",
      kind: "quiz",
      mode: "guided",
      itemIds: [chosen[0].id],
      count: 1,
    },
    201,
  );
  const before = (await call(pupil, "/api/games")).find(
    (r) => r.id === room.id,
  );
  assert.equal(before.state.total, 1);
  const edited = {
    ...base,
    items: base.items.map((i) =>
      i.id === chosen[0].id
        ? { ...i, prompt: "Choose the verb: " + i.prompt }
        : i,
    ),
  };
  const own = await call(teacher, "/api/games/sets", edited);
  assert.notEqual(own.id, base.id);
  assert.equal(
    (await call(teacher, "/api/games/sets")).filter(
      (s) => s.sourceKey === "essential-1",
    ).length,
    1,
  );
  assert.equal(
    (await call(teacher, "/api/games/sets?id=" + base.id)).items[0].prompt,
    edited.items[0].prompt,
  );
  assert.equal(
    (await call(otherTeacher, "/api/games/sets?id=" + base.id)).items[0].prompt,
    base.items[0].prompt,
  );
  view = await call(pupil, "/api/library/homework/" + hw.id);
  assert.equal(view.items[0].prompt, chosen[0].prompt);
  assert.equal(
    (await call(pupil, "/api/games")).find((r) => r.id === room.id).state.item
      .prompt,
    chosen[0].prompt,
  );
  const newer = await call(
    teacher,
    "/api/library/homework",
    {
      setId: base.id,
      studentId,
      title: "Исправленная версия",
      due: "2027-01-21",
      itemIds: [chosen[0].id],
    },
    201,
  );
  assert.equal(
    (await call(pupil, "/api/library/homework/" + newer.id)).items[0].prompt,
    edited.items[0].prompt,
  );
  await call(otherPupil, "/api/library/homework/" + hw.id, undefined, 404);
  await call(otherTeacher, "/api/library/homework/" + hw.id, undefined, 404);
  await call(
    pupil,
    "/api/library/homework",
    { setId: base.id, studentId, title: "No", due: "2027-01-20" },
    403,
  );
  const command = {
    commandId: randomUUID(),
    itemId: chosen[0].id,
    response: chosen[0].answer,
  };
  view = await call(pupil, "/api/library/homework/" + hw.id, command);
  assert.equal(view.completed, 1);
  assert.equal(view.items[0].last.correct, true);
  assert.equal(view.status, "assigned");
  view = await call(pupil, "/api/library/homework/" + hw.id, command);
  assert.equal(view.items[0].attempts.length, 1);
  view = await call(pupil, "/api/library/homework/" + hw.id, {
    commandId: randomUUID(),
    itemId: chosen[1].id,
    response: "wrong",
  });
  assert.equal(view.completed, 2);
  assert.equal(view.status, "submitted");
  assert.equal(view.items[1].last.correct, false);
  const teacherView = await call(teacher, "/api/library/homework/" + hw.id);
  assert.equal(teacherView.items[0].answer, chosen[0].answer);
  await teacher.call(
    `homework/${hw.id}`,
    { feedback: "Хорошо! Повтори второе задание.", status: "reviewed" },
    "PATCH",
  );
  assert.equal(
    (await call(pupil, "/api/library/homework/" + hw.id)).feedback,
    "Хорошо! Повтори второе задание.",
  );
  console.log(
    "PASS one database library: edit isolation, single-item lesson/homework, immutable snapshots, private auto-graded attempts and teacher feedback",
  );
  const manual = await call(
    teacher,
    "/api/games/sets",
    {
      title: "Объясни своими словами",
      course: "Свои материалы",
      unit: 0,
      topic: "Ручная проверка",
      items: [
        {
          id: "free-answer",
          type: "text",
          prompt: "Explain why you enjoy learning English.",
          answer: "",
          explanation: "Оцените связность и корректность ответа.",
        },
      ],
    },
    201,
  );
  const manualHw = await call(
    teacher,
    "/api/library/homework",
    {
      setId: manual.id,
      studentId,
      title: "Письменный ответ",
      due: "2027-01-25",
    },
    201,
  );
  const submitted = await call(pupil, "/api/library/homework/" + manualHw.id, {
    commandId: randomUUID(),
    itemId: "free-answer",
    response: "I enjoy learning because I can meet new people.",
  });
  assert.equal(submitted.items[0].last.correct, null);
  assert.equal(submitted.status, "submitted");
  const gradedResponse = await teacher.fetch(
    "/api/library/homework/" + manualHw.id,
    { attemptId: submitted.items[0].attempts[0].id, correct: true },
    "PATCH",
  );
  assert.equal(gradedResponse.status, 200);
  assert.equal(
    (await call(pupil, "/api/library/homework/" + manualHw.id)).items[0].last
      .correct,
    true,
  );
  const manualRoom = await call(
    teacher,
    "/api/games",
    {
      setId: manual.id,
      studentId,
      title: "Обсуждение на уроке",
      kind: "quiz",
      mode: "guided",
      count: 1,
    },
    201,
  );
  await call(pupil, `/api/games/rooms/${manualRoom.id}/commands`, {
    commandId: randomUUID(),
    version: 0,
    action: "answer",
    answer: "Learning languages is fun.",
  });
  const waiting = (await call(teacher, "/api/games")).find(
    (r) => r.id === manualRoom.id,
  );
  assert.equal(waiting.state.revealed, false);
  assert.equal(waiting.state.answers.student.correct, null);
  await call(teacher, `/api/games/rooms/${manualRoom.id}/commands`, {
    commandId: randomUUID(),
    version: 1,
    action: "mark",
    target: "student",
    correct: true,
  });
  const marked = (await call(pupil, "/api/games")).find(
    (r) => r.id === manualRoom.id,
  );
  assert.equal(marked.state.revealed, true);
  assert.equal(marked.state.scores.student, 1);
  console.log(
    "PASS manual answers use the same library for homework and teacher-graded live games",
  );
  return { homeworkId: hw.id };
}

export async function checkLibraryBrowser({
  page,
  pupilPage,
  base,
  studentId,
  db,
}) {
  await page.goto(base + "/games?student=" + studentId);
  const card = page.locator(".game-set").filter({
    has: page.getByRole("heading", { name: "1. am/is/are", exact: true }),
  });
  await card.getByRole("button", { name: "В ДЗ", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Назначить из библиотеки" });
  await dialog
    .getByLabel("Название", { exact: true })
    .fill("Набор домой из карточки");
  await dialog
    .getByRole("button", { name: "Снять выбор", exact: true })
    .click();
  for (let i = 0; i < 3; i++)
    await dialog.locator(".task-selection input").nth(i).check();
  await dialog
    .getByRole("button", { name: "Назначить ДЗ", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Домашнее задание назначено" })
    .waitFor();
  const hw = (
    await db.query(
      "SELECT id,learning_snapshot FROM classroom_homework WHERE student_id=$1 AND title=$2",
      [studentId, "Набор домой из карточки"],
    )
  ).rows[0];
  assert.equal(hw.learning_snapshot.items.length, 3);
  await pupilPage.goto(base + "/learn");
  await pupilPage
    .getByRole("button", { name: "Домашние задания", exact: true })
    .click();
  const workCard = pupilPage.locator(".homework-card").filter({
    has: pupilPage.getByRole("heading", {
      name: "Набор домой из карточки",
      exact: true,
    }),
  });
  await workCard.getByRole("button").click();
  await pupilPage.getByRole("link", { name: /Выполнить задания/ }).click();
  await pupilPage.locator(".play-panel").waitFor();
  let task = hw.learning_snapshot.items[0];
  await pupilPage
    .locator(".quiz-options button")
    .filter({ hasText: task.answer })
    .first()
    .click();
  await pupilPage.getByRole("status").filter({ hasText: "Верно" }).waitFor();
  await pupilPage.getByRole("button", { name: "Дальше", exact: true }).click();
  task = hw.learning_snapshot.items[1];
  for (const word of task.answer.split(/\s+/))
    await pupilPage
      .locator(".word-bank")
      .getByRole("button", { name: word, exact: true })
      .first()
      .click();
  await pupilPage
    .getByRole("button", { name: "Проверить фразу", exact: true })
    .click();
  await pupilPage.getByRole("status").filter({ hasText: "Верно" }).waitFor();
  await pupilPage.getByRole("button", { name: "Дальше", exact: true }).click();
  task = hw.learning_snapshot.items[2];
  await pupilPage.locator(".play-panel form textarea").fill(task.answer);
  await pupilPage
    .getByRole("button", { name: "Отправить", exact: true })
    .click();
  await pupilPage
    .getByText("Все ответы отправлены преподавателю.", { exact: true })
    .waitFor();
  await pupilPage.reload();
  await pupilPage.getByText("Выполнено 3 / 3", { exact: true }).waitFor();
  assert.equal(
    await pupilPage.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await pupilPage.screenshot({
    path: "artifacts/library-homework-mobile.png",
    fullPage: true,
  });
  await page.goto(base + "/practice/" + hw.id);
  await page.getByText("Выполнено 3 / 3", { exact: true }).waitFor();
  await page.screenshot({
    path: "artifacts/library-teacher-review.png",
    fullPage: true,
  });
  console.log(
    "PASS shared library card assigns selected tasks, pupil completes quiz/sentence/pair, teacher sees persisted answers",
  );
}
