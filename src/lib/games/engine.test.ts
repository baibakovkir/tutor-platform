import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  createState,
  applyCommand,
  publicState,
  activeItems,
  timeoutState,
  normalize,
} from "./engine";
import type { Item, State, Role, Kind, Mode, Command } from "./types";
import bank from "../../../content/games/bank.json";
const items = bank[0].items as Item[];
const make = (kind: Kind = "quiz", mode: Mode = "guided", timerSeconds = 0) =>
  createState(
    { title: "English", kind, mode, items, timerSeconds },
    "private-seed",
    1000,
  );
const move = (
  s: State,
  role: Role,
  action: Command["action"],
  extra: Partial<Command> = {},
) =>
  applyCommand(
    s,
    { commandId: randomUUID(), version: 0, action, ...extra },
    role,
    1500,
  );
describe("game rules and privacy", () => {
  it("starts memory with shuffled opaque cards and hidden answers", () => {
    const s = make("pairs");
    const p = publicState(s, "student");
    expect(p.cards).toHaveLength(12);
    expect(p.cards.every((c) => c.text === null)).toBe(true);
    expect(JSON.stringify(p)).not.toContain("private-seed");
    expect(p).not.toHaveProperty("items");
    expect(p).not.toHaveProperty("seed");
    expect(p.canAnswer).toBe(true);
    expect(publicState(s, "teacher").canAnswer).toBe(false);
  });
  it("rejects teacher answers in guided mode", () => {
    expect(() => move(make(), "teacher", "answer", { answer: "am" })).toThrow(
      "ученик",
    );
  });
  it("holds duel answers and scores until both respond", () => {
    let s = make("quiz", "duel");
    s = move(s, "teacher", "answer", { answer: s.items[0].answer });
    const p = publicState(s, "student");
    expect(p.answers.teacher).toEqual({ submitted: true });
    expect(p.scores.teacher).toBe(0);
    expect(p.expected).toBeUndefined();
    expect(p.log).toHaveLength(0);
    s = move(s, "student", "answer", { answer: s.items[0].answer });
    expect(s.revealed).toBe(true);
    expect(publicState(s, "student").scores).toEqual({
      teacher: 1,
      student: 1,
    });
    expect(publicState(s, "student").expected).toBe(s.items[0].answer);
  });
  it("rejects duplicate submissions but idempotent command replay succeeds", () => {
    const s = make("quiz", "duel");
    const command: Command = {
      commandId: randomUUID(),
      version: 0,
      action: "answer",
      answer: s.items[0].answer,
    };
    const after = applyCommand(s, command, "student", 1000);
    expect(applyCommand(after, command, "student", 1001)).toEqual(after);
    expect(() =>
      move(after, "student", "answer", { answer: "another" }),
    ).toThrow("уже принят");
  });
  it("cooperation alternates actors between rounds", () => {
    let s = make("quiz", "coop");
    expect(() => move(s, "teacher", "answer", { answer: "a" })).toThrow("Ход");
    s = move(s, "student", "answer", { answer: s.items[0].answer });
    expect(s.revealed).toBe(true);
    s = move(s, "teacher", "next");
    expect(s.turn).toBe("teacher");
    expect(s.round).toBe(1);
    expect(s.revealed).toBe(false);
  });
  it("wrong memory pair passes the turn and does not reveal the missing mate", () => {
    let s = make("pairs", "duel");
    const a = s.cards[0],
      b = s.cards.find((c) => c.pair !== a.pair)!;
    s = move(s, "student", "flip", { card: a.id });
    s = move(s, "student", "flip", { card: b.id });
    expect(s.turn).toBe("teacher");
    expect(publicState(s, "student").log[0].expected).toBe("");
    expect(() => move(s, "teacher", "flip", { card: s.cards[2].id })).toThrow(
      "закройте",
    );
    s = move(s, "teacher", "clear");
    expect(s.opened).toHaveLength(0);
  });
  it("a matching pair scores once and keeps the turn", () => {
    let s = make("pairs", "duel");
    const a = s.cards[0],
      b = s.cards.find((c) => c.pair === a.pair && c.id !== a.id)!;
    s = move(s, "student", "flip", { card: a.id });
    s = move(s, "student", "flip", { card: b.id });
    expect(s.scores.student).toBe(1);
    expect(s.matched).toHaveLength(2);
    expect(s.turn).toBe("student");
    s = move(s, "teacher", "clear");
    expect(() => move(s, "student", "flip", { card: a.id })).toThrow(
      "Недоступная",
    );
  });
  it("finishes memory after all pairs", () => {
    let s = make("pairs");
    for (const item of s.items) {
      for (const card of s.cards.filter((c) => c.pair === item.id))
        s = move(s, "student", "flip", { card: card.id });
      if (s.phase !== "finished") s = move(s, "student", "clear");
    }
    expect(s.phase).toBe("finished");
    expect(s.scores.student).toBe(6);
    expect(() => move(s, "teacher", "resume")).toThrow("завершена");
  });
  it("pausing freezes timer and blocks moves", () => {
    let s = make("quiz", "guided", 30);
    s = move(s, "teacher", "pause");
    expect(s.remainingMs).toBe(29500);
    expect(() => move(s, "student", "answer", { answer: "is" })).toThrow(
      "паузе",
    );
    expect(timeoutState(s, 100000)).toBe(false);
    s = applyCommand(
      s,
      { commandId: randomUUID(), version: 0, action: "resume" },
      "teacher",
      100000,
    );
    expect(s.deadline).toBe(129500);
  });
  it("server timeout reveals incorrect unanswered attempts exactly once", () => {
    const s = make("quiz", "duel", 30);
    expect(timeoutState(s, 30999)).toBe(false);
    expect(timeoutState(s, 31000)).toBe(true);
    expect(s.log).toHaveLength(2);
    expect(s.revealed).toBe(true);
    expect(timeoutState(s, 40000)).toBe(false);
  });
  it("student cannot advance, pause or finish a room", () => {
    for (const action of ["next", "pause", "resume", "finish"] as const)
      expect(() => move(make(), "student", action)).toThrow("преподаватель");
  });
  it("keeps the original set snapshot and token identities for repeated words", () => {
    const s = make("sentence");
    const original = s.items[0].answer;
    items[0].prompt += "";
    expect(s.items[0].answer).toBe(original);
    const tokens = publicState(s, "student").item!.tokens!;
    expect(new Set(tokens.map((t) => t.id)).size).toBe(tokens.length);
    expect(publicState(s, "student").item).not.toHaveProperty("answer");
  });
  it("normalizes case, punctuation and apostrophes without dropping grammar words", () => {
    expect(normalize("  I’m READY! ")).toBe("i'm ready");
    expect(normalize("She is here.")).not.toBe(normalize("She here."));
  });
  it("quest has five distinct stages and can be completed cooperatively", () => {
    let s = make("quest", "coop");
    expect(s.stages.map((s) => s.type)).toEqual([
      "pair",
      "sentence",
      "choice",
      "sentence",
      "choice",
    ]);
    for (const i of activeItems(s)) {
      for (const c of s.cards.filter((c) => c.pair === i.id))
        s = move(s, s.turn, "flip", { card: c.id });
      if (!s.revealed) s = move(s, "teacher", "clear");
    }
    s = move(s, "teacher", "next");
    for (let stage = 1; stage < 5; stage++) {
      expect(s.stage).toBe(stage);
      for (let round = 0; round < 2; round++) {
        const item = activeItems(s)[s.round];
        s = move(s, s.turn, "answer", { answer: item.answer });
        s = move(s, "teacher", "next");
      }
    }
    expect(s.phase).toBe("finished");
    expect(s.scores.student + s.scores.teacher).toBe(11);
  });
  it("quest has no duel mode and skipping records work left unfinished", () => {
    expect(() => make("quest", "duel")).toThrow("Приключение");
    let s = make("quest");
    s = move(s, "teacher", "next");
    expect(s.stage).toBe(1);
    expect(s.log.filter((e) => e.skipped)).toHaveLength(3);
  });
  it("race uses accepted answer scores and finishes all questions", () => {
    let s = make("race");
    for (let n = 0; n < s.items.length; n++) {
      s = move(s, "student", "answer", { answer: s.items[n].answer });
      s = move(s, "teacher", "next");
    }
    expect(s.phase).toBe("finished");
    expect(s.scores.student).toBe(8);
  });
});
describe("room completion and configured adventures", () => {
  it("finishing a partially answered duel reveals and preserves the accepted score", () => {
    let s = make("quiz", "duel");
    s = move(s, "student", "answer", { answer: s.items[0].answer });
    expect(publicState(s, "teacher").scores.student).toBe(0);
    s = move(s, "teacher", "finish");
    expect(publicState(s, "teacher").scores.student).toBe(1);
    expect(publicState(s, "teacher").log).toHaveLength(1);
  });
  it("uses cryptographic identifiers for shuffled cards and tokens", () => {
    const s = make("sentence");
    expect(
      publicState(s, "student").item!.tokens!.every((t) =>
        /^w[0-9a-f]{20}$/.test(t.id),
      ),
    ).toBe(true);
    expect(make("pairs").cards.every((c) => /^c[0-9a-f]{20}$/.test(c.id))).toBe(
      true,
    );
  });
  it("uses explicitly configured stage snapshots rather than the default bank", () => {
    const stageItems = (
      ["pair", "sentence", "choice", "sentence", "choice"] as const
    ).map((type, stage) =>
      items
        .filter((i) => i.type === type)
        .slice(0, type === "pair" ? 3 : 2)
        .map((i) => ({ ...i, id: `stage${stage}:${i.id}` })),
    );
    const s = createState(
      { title: "Mixed", kind: "quest", mode: "guided", items: [], stageItems },
      "private",
    );
    expect(s.items).toHaveLength(11);
    expect(s.stages[3].itemIds).toEqual(stageItems[3].map((i) => i.id));
    expect(activeItems(s)).toEqual(stageItems[0]);
  });
});
describe("complete authored curriculum", () => {
  it("covers nine GoGetter sections and all 115 Essential units", () => {
    expect(
      bank.filter((s) => s.id.startsWith("gogetter")).map((s) => s.unit),
    ).toEqual(Array.from({ length: 9 }, (_, i) => i));
    expect(
      bank.filter((s) => s.id.startsWith("essential")).map((s) => s.unit),
    ).toEqual(Array.from({ length: 115 }, (_, i) => i + 1));
  });
  it("has correct keys, unique contexts and sufficient activities in every unit", () => {
    for (const set of bank) {
      const items = set.items as Item[];
      expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
      expect(
        items.filter((i) => i.type === "pair").length,
      ).toBeGreaterThanOrEqual(6);
      expect(items.filter((i) => i.type === "sentence")).toHaveLength(8);
      expect(items.filter((i) => i.type === "choice")).toHaveLength(8);
      expect(
        new Set(items.filter((i) => i.type === "sentence").map((i) => i.answer))
          .size,
      ).toBe(8);
      for (const i of items) {
        expect(i.answer.trim()).not.toBe("");
        expect(i.explanation).not.toBe("");
        expect(i.prompt + i.answer).not.toMatch(/[{}\[\]~]/);
        if (i.type === "choice") {
          expect(i.options).toContain(i.answer);
          expect(new Set(i.options).size).toBe(i.options!.length);
        }
      }
    }
  });
  it("every set supports all five game mechanics", () => {
    for (const set of bank)
      for (const kind of [
        "pairs",
        "sentence",
        "quiz",
        "race",
        "quest",
      ] as Kind[])
        expect(() =>
          createState(
            {
              title: set.title,
              kind,
              mode: "guided",
              items: set.items as Item[],
            },
            "seed",
          ),
        ).not.toThrow();
  });
});
