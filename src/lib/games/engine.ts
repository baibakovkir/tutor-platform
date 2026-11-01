import { createHmac } from "node:crypto";
import type {
  Role,
  Mode,
  Kind,
  Item,
  State,
  Command,
  PublicState,
  Card,
} from "./types";
export class GameError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const normalize = (s: string) =>
  s
    .normalize("NFKC")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .trim()
    .toLocaleLowerCase("en")
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/, "");
// Stable shuffle using a private server seed; card IDs never encode their pair.
function hash(s: string) {
  let n = 2166136261;
  for (const c of s) n = Math.imul(n ^ c.charCodeAt(0), 16777619);
  return n >>> 0;
}
function shuffle<T>(xs: T[], seed: string) {
  const a = [...xs];
  let n = hash(seed);
  for (let i = a.length - 1; i > 0; i--) {
    n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
    const j = n % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const other = (r: Role): Role => (r === "teacher" ? "student" : "teacher");
export function activeType(s: State): Item["type"] {
  return s.kind === "pairs"
    ? "pair"
    : s.kind === "sentence"
      ? "sentence"
      : s.kind === "quest"
        ? s.stages[s.stage]?.type || "choice"
        : "choice";
}
export function activeItems(s: State) {
  if (s.kind === "quest") {
    const ids = new Set(s.stages[s.stage]?.itemIds);
    return s.items.filter((i) => ids.has(i.id));
  }
  return s.items;
}
export function makeCards(items: Item[], seed: string): Card[] {
  return shuffle(
    items.flatMap((i, k) => [
      {
        id:
          "c" +
          createHmac("sha256", seed)
            .update("a" + k)
            .digest("hex")
            .slice(0, 20),
        pair: i.id,
        text: i.prompt,
      },
      {
        id:
          "c" +
          createHmac("sha256", seed)
            .update("b" + k)
            .digest("hex")
            .slice(0, 20),
        pair: i.id,
        text: i.answer,
      },
    ]),
    seed,
  );
}
function prepareStage(s: State, now: number) {
  s.round = 0;
  s.answers = {};
  s.revealed = false;
  s.hinted = false;
  s.opened = [];
  s.matched = [];
  s.lastMatch = null;
  s.cards =
    activeType(s) === "pair"
      ? makeCards(activeItems(s), s.seed + ":" + s.stage)
      : [];
  s.deadline =
    s.timerSeconds && activeType(s) !== "pair"
      ? now + s.timerSeconds * 1000
      : null;
}
export function createState(
  input: {
    kind: Kind;
    mode: Mode;
    title: string;
    items: Item[];
    setId?: string | null;
    course?: string;
    unit?: number | null;
    lessonId?: number | null;
    timerSeconds?: number;
    stageItems?: Item[][];
  },
  seed: string,
  now = Date.now(),
): State {
  if (input.kind === "quest" && input.mode === "duel")
    throw new GameError(400, "Приключение доступно вместе или с ведущим.");
  const type =
    input.kind === "pairs"
      ? "pair"
      : input.kind === "sentence"
        ? "sentence"
        : "choice";
  const items =
    input.kind === "quest"
      ? input.stageItems?.flat() || input.items
      : input.items.filter(
          (i) => i.type === type || (type === "choice" && i.type === "text"),
        );
  if (items.length < 1)
    throw new GameError(400, "Нужно хотя бы одно задание подходящего типа.");
  const stages: State["stages"] =
    input.kind === "quest"
      ? [
          {
            title: "Дом · найдите ключ",
            type: "pair",
            itemIds: items
              .filter((i) => i.type === "pair")
              .slice(0, 3)
              .map((i) => i.id),
          },
          {
            title: "Вокзал · соберите маршрут",
            type: "sentence",
            itemIds: items
              .filter((i) => i.type === "sentence")
              .slice(0, 2)
              .map((i) => i.id),
          },
          {
            title: "Кафе · сделайте заказ",
            type: "choice",
            itemIds: items
              .filter((i) => i.type === "choice" || i.type === "text")
              .slice(0, 2)
              .map((i) => i.id),
          },
          {
            title: "Музей · расшифруйте записку",
            type: "sentence",
            itemIds: items
              .filter((i) => i.type === "sentence")
              .slice(2, 4)
              .map((i) => i.id),
          },
          {
            title: "Парк · откройте финал",
            type: "choice",
            itemIds: items
              .filter((i) => i.type === "choice" || i.type === "text")
              .slice(2, 4)
              .map((i) => i.id),
          },
        ]
      : [];
  if (input.kind === "quest" && input.stageItems) {
    for (let i = 0; i < stages.length; i++)
      stages[i].itemIds = input.stageItems[i]?.map((item) => item.id) || [];
  }
  if (stages.some((s) => s.itemIds.length < 2))
    throw new GameError(400, "Для квеста нужны 3 пары, 4 фразы и 4 вопроса.");
  const s: State = {
    schema: 2,
    title: input.title,
    kind: input.kind,
    mode: input.mode,
    phase: "playing",
    turn: "student",
    round: 0,
    scores: { teacher: 0, student: 0 },
    answers: {},
    opened: [],
    matched: [],
    cards: [],
    items,
    log: [],
    revealed: false,
    hinted: false,
    lastMatch: null,
    setId: input.setId || null,
    course: input.course || "Свои материалы",
    unit: input.unit ?? null,
    lessonId: input.lessonId ?? null,
    timerSeconds: input.timerSeconds || 0,
    deadline: null,
    remainingMs: null,
    stages,
    stage: 0,
    commandIds: [],
    seed,
    revision: 0,
  };
  prepareStage(s, now);
  return s;
}
function record(
  s: State,
  role: Role,
  response: string,
  correct: boolean,
  skipped = false,
) {
  const i = activeItems(s)[s.round];
  if (!i) return;
  s.log.push({
    round: s.kind === "quest" ? s.stage * 100 + s.round : s.round,
    itemId: i.id,
    role,
    response,
    correct,
    expected: i.answer,
    explanation: i.explanation,
    hinted: s.hinted,
    skipped,
  });
  if (correct) s.scores[role]++;
}
function reveal(s: State) {
  s.revealed = true;
  s.deadline = null;
}
function ready(s: State) {
  return s.mode === "duel"
    ? !!s.answers.teacher &&
        !!s.answers.student &&
        s.answers.teacher.correct !== null &&
        s.answers.student.correct !== null
    : s.answers[s.mode === "guided" ? "student" : s.turn]?.correct != null;
}
function advance(s: State, now: number) {
  if (
    (s.kind === "quest" && s.round + 1 >= activeItems(s).length) ||
    (s.kind === "quest" && activeType(s) === "pair")
  ) {
    s.stage++;
    if (s.stage >= s.stages.length) {
      s.phase = "finished";
      return;
    }
    prepareStage(s, now);
    return;
  }
  s.round++;
  if (s.round >= activeItems(s).length) {
    s.phase = "finished";
    return;
  }
  s.answers = {};
  s.revealed = false;
  s.hinted = false;
  if (s.mode === "coop") s.turn = other(s.turn);
  s.deadline = s.timerSeconds ? now + s.timerSeconds * 1000 : null;
}
export function timeoutState(s: State, now = Date.now()): boolean {
  if (s.phase !== "playing" || s.revealed || !s.deadline || now < s.deadline)
    return false;
  const roles: Role[] =
    s.mode === "duel"
      ? ["teacher", "student"]
      : [s.mode === "guided" ? "student" : s.turn];
  for (const r of roles)
    if (!s.answers[r]) {
      s.answers[r] = { response: "Время вышло", correct: false };
      record(s, r, "Время вышло", false);
    }
  if (Object.values(s.answers).some((a) => a?.correct === null))
    s.deadline = null;
  else reveal(s);
  return true;
}
export function applyCommand(
  state: State,
  c: Command,
  role: Role,
  now = Date.now(),
): State {
  const s = structuredClone(state);
  if (s.commandIds.includes(c.commandId)) return s;
  if (s.phase === "finished")
    throw new GameError(409, "Игра завершена. Создайте новую игру.");
  if (
    ["pause", "resume", "finish", "next", "mark"].includes(c.action) &&
    role !== "teacher"
  )
    throw new GameError(403, "Управляет преподаватель.");
  if (c.action === "pause") {
    if (s.phase !== "playing") throw new GameError(409, "Игра уже на паузе.");
    s.remainingMs = s.deadline ? Math.max(0, s.deadline - now) : null;
    s.deadline = null;
    s.phase = "paused";
  } else if (c.action === "resume") {
    if (s.phase !== "paused") throw new GameError(409, "Игра не на паузе.");
    s.phase = "playing";
    if (s.remainingMs !== null) s.deadline = now + s.remainingMs;
    s.remainingMs = null;
  } else if (c.action === "finish") {
    for (const r of ["teacher", "student"] as Role[])
      if (s.answers[r]?.correct === null) {
        record(s, r, s.answers[r]!.response, false, true);
        s.answers[r]!.correct = false;
      }
    s.phase = "finished";
    reveal(s);
  } else {
    if (s.phase !== "playing") throw new GameError(409, "Игра на паузе.");
    if (c.action === "next") {
      if (activeType(s) === "pair") {
        if (s.matched.length !== s.cards.length) {
          for (const i of activeItems(s))
            if (
              !s.matched.some(
                (id) => s.cards.find((c) => c.id === id)?.pair === i.id,
              )
            )
              s.log.push({
                round: s.stage * 100,
                itemId: i.id,
                role: "student",
                correct: false,
                response: "Пропущено",
                expected: i.answer,
                explanation: i.explanation,
                hinted: s.hinted,
                skipped: true,
              });
        }
        if (s.kind === "quest") advance(s, now);
        else {
          s.phase = "finished";
          s.deadline = null;
        }
      } else {
        if (!s.revealed) {
          const roles: Role[] =
            s.mode === "duel"
              ? ["teacher", "student"]
              : [s.mode === "guided" ? "student" : s.turn];
          for (const r of roles)
            if (!s.answers[r]) record(s, r, "Пропущено", false, true);
        }
        advance(s, now);
      }
    } else if (c.action === "mark") {
      const item = activeItems(s)[s.round];
      const target = c.target;
      if (
        item?.type !== "text" ||
        !target ||
        typeof c.correct !== "boolean" ||
        !s.answers[target] ||
        s.answers[target]!.correct !== null
      )
        throw new GameError(409, "Нет ответа для проверки.");
      if (s.mode === "duel" && (!s.answers.student || !s.answers.teacher))
        throw new GameError(409, "Сначала должны ответить оба участника.");
      s.answers[target]!.correct = c.correct;
      record(s, target, s.answers[target]!.response, c.correct);
      if (ready(s)) reveal(s);
    } else if (c.action === "hint") {
      s.hinted = true;
    } else if (c.action === "clear") {
      if (activeType(s) !== "pair" || s.opened.length !== 2)
        throw new GameError(409, "Нечего закрывать.");
      s.opened = [];
      s.lastMatch = null;
    } else {
      if (s.mode === "guided" && role !== "student")
        throw new GameError(403, "В этом режиме отвечает ученик.");
      if (s.mode !== "guided" && s.mode !== "duel" && s.turn !== role)
        throw new GameError(409, "Ход другого участника.");
      if (c.action === "flip") {
        if (activeType(s) !== "pair")
          throw new GameError(400, "Сейчас другое задание.");
        if (s.mode === "duel" && s.turn !== role)
          throw new GameError(409, "Ход другого участника.");
        if (s.opened.length === 2)
          throw new GameError(409, "Сначала закройте открытые карточки.");
        const card = s.cards.find((x) => x.id === c.card);
        if (!card || s.matched.includes(card.id) || s.opened.includes(card.id))
          throw new GameError(400, "Недоступная карточка.");
        s.opened.push(card.id);
        if (s.opened.length === 2) {
          const pair = s.cards.find((x) => x.id === s.opened[0])!.pair;
          s.lastMatch = pair === card.pair;
          if (s.lastMatch) {
            s.matched.push(...s.opened);
            s.scores[role]++;
            const i = s.items.find((i) => i.id === pair)!;
            s.log.push({
              round: s.stage * 100,
              itemId: i.id,
              role,
              correct: true,
              response: i.prompt,
              expected: i.answer,
              explanation: i.explanation,
              hinted: s.hinted,
            });
            if (s.matched.length === s.cards.length) {
              if (s.kind === "quest") {
                s.revealed = true;
              } else s.phase = "finished";
            }
          } else {
            const i = s.items.find((i) => i.id === pair)!;
            s.log.push({
              round: s.stage * 100,
              itemId: i.id,
              role,
              correct: false,
              response: card.text,
              expected: i.answer,
              explanation: i.explanation,
              hinted: s.hinted,
            });
            if (s.mode !== "guided") s.turn = other(role);
          }
        }
      } else if (c.action === "answer") {
        if (activeType(s) === "pair" || s.revealed)
          throw new GameError(409, "Этот раунд уже закончен.");
        if (s.answers[role]) throw new GameError(409, "Ответ уже принят.");
        const i = activeItems(s)[s.round];
        if (!i) throw new GameError(400, "Нет задания.");
        const response = String(c.answer || "").trim();
        if (!response) throw new GameError(400, "Напишите ответ.");
        const correct =
          i.type === "text"
            ? null
            : [i.answer, ...(i.alternatives || [])].some(
                (a) => normalize(a) === normalize(response),
              );
        s.answers[role] = { response, correct };
        if (correct !== null) record(s, role, response, correct);
        if (
          i.type === "text" &&
          (s.mode !== "duel" || (s.answers.teacher && s.answers.student))
        )
          s.deadline = null;
        if (ready(s)) reveal(s);
      } else throw new GameError(400, "Неизвестный ход.");
    }
  }
  s.commandIds.push(c.commandId);
  s.revision++;
  return s;
}
export function publicState(s: State, role: Role): PublicState {
  const { items, cards, answers, seed, commandIds, ...rest } = s;
  void commandIds;
  void items;
  const current = activeItems(s)[s.round];
  const type = activeType(s);
  const publicItem = current
    ? (({ answer, alternatives, ...item }) => {
        void alternatives;
        return {
          ...item,
          explanation: s.revealed ? item.explanation : "",
          hint: s.hinted ? item.hint : undefined,
          options: item.options
            ? shuffle(item.options, seed + current.id)
            : undefined,
          tokens:
            type === "sentence"
              ? shuffle(
                  answer.split(/\s+/).map((text, i) => ({
                    id:
                      "w" +
                      createHmac("sha256", seed)
                        .update(current.id + ":" + i)
                        .digest("hex")
                        .slice(0, 20),
                    text,
                  })),
                  seed + current.id,
                )
              : undefined,
        };
      })(current)
    : null;
  const a: PublicState["answers"] = {};
  for (const r of ["teacher", "student"] as Role[])
    if (answers[r])
      a[r] = {
        submitted: true,
        ...(s.revealed ||
        r === role ||
        (role === "teacher" &&
          current?.type === "text" &&
          (s.mode !== "duel" || (!!answers.teacher && !!answers.student)))
          ? {
              response: answers[r]!.response,
              ...(s.revealed || current?.type === "text"
                ? { correct: answers[r]!.correct }
                : {}),
            }
          : {}),
      };
  const visibleScores = { ...s.scores };
  if (!s.revealed && type !== "pair")
    for (const r of ["teacher", "student"] as Role[])
      if (answers[r]?.correct) visibleScores[r]--;
  return {
    ...rest,
    scores: visibleScores,
    log: s.log
      .filter(
        (e) =>
          s.revealed ||
          s.phase === "finished" ||
          type === "pair" ||
          e.itemId !== current?.id,
      )
      .map((e) =>
        type === "pair" &&
        !e.correct &&
        s.phase !== "finished" &&
        !s.matched.some(
          (id) => cards.find((c) => c.id === id)?.pair === e.itemId,
        )
          ? { ...e, expected: "", explanation: "" }
          : e,
      ),
    cards: cards.map((c) => ({
      id: c.id,
      text: s.opened.includes(c.id) || s.matched.includes(c.id) ? c.text : null,
      matched: s.matched.includes(c.id),
    })),
    item: publicItem,
    answers: a,
    total: activeItems(s).length,
    expected: s.revealed ? current?.answer : undefined,
    explanation: s.revealed ? current?.explanation : undefined,
    activeKind: type,
    canAnswer:
      s.phase === "playing" &&
      !s.revealed &&
      (s.mode !== "guided" || role === "student") &&
      (s.mode === "duel"
        ? type !== "pair" || s.turn === role
        : s.mode === "guided" || s.turn === role) &&
      !answers[role],
    race: visibleScores,
  };
}
