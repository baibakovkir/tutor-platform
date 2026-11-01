import type { GameSet } from "./types";
export function legacySet(
  e: {
    id: number;
    title: string;
    kind: string;
    prompt: string;
    options: string[];
    answer: string;
    explanation: string;
  },
  id: string,
): GameSet {
  const type = e.kind === "text" ? "text" : "choice";
  return {
    id,
    title: e.title,
    course: "Ранее созданные задания",
    topic: e.title,
    unit: 0,
    items: [
      {
        id: "legacy-" + e.id,
        type,
        prompt: e.prompt,
        answer:
          e.kind === "choice"
            ? e.options[Number(e.answer)] || e.answer
            : e.answer,
        options: e.kind === "choice" ? e.options : undefined,
        explanation: e.explanation || "Ответ проверяет преподаватель.",
      },
    ],
  };
}
