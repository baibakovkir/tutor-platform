export type Role = "teacher" | "student";
export type Mode = "guided" | "coop" | "duel";
export type Kind = "pairs" | "sentence" | "race" | "quiz" | "quest";
export type Item = {
  id: string;
  type: "pair" | "sentence" | "choice";
  prompt: string;
  answer: string;
  options?: string[];
  alternatives?: string[];
  explanation: string;
  sourceSetId?: string;
  sourceItemId?: string;
  hint?: string;
};
export type GameSet = {
  id: string;
  title: string;
  course: string;
  unit: number;
  topic: string;
  sourcePage?: number;
  items: Item[];
};
export type Card = { id: string; pair: string; text: string };
export type Answer = { response: string; correct: boolean };
export type Entry = {
  round: number;
  itemId: string;
  role: Role;
  correct: boolean;
  response: string;
  expected: string;
  explanation: string;
  hinted: boolean;
  skipped?: boolean;
};
export type State = {
  schema: 2;
  title: string;
  kind: Kind;
  mode: Mode;
  phase: "playing" | "paused" | "finished";
  turn: Role;
  round: number;
  scores: Record<Role, number>;
  answers: Partial<Record<Role, Answer>>;
  opened: string[];
  matched: string[];
  cards: Card[];
  items: Item[];
  log: Entry[];
  revealed: boolean;
  hinted: boolean;
  lastMatch: boolean | null;
  setId: string | null;
  course: string;
  unit: number | null;
  lessonId: number | null;
  timerSeconds: number;
  deadline: number | null;
  remainingMs: number | null;
  stages: { title: string; type: Item["type"]; itemIds: string[] }[];
  stage: number;
  commandIds: string[];
  seed: string;
  revision: number;
};
export type Command = {
  commandId: string;
  version: number;
  action:
    | "flip"
    | "clear"
    | "answer"
    | "next"
    | "pause"
    | "resume"
    | "finish"
    | "hint";
  card?: string;
  answer?: string;
};
export type PublicItem = Omit<Item, "answer" | "alternatives"> & {
  tokens?: { id: string; text: string }[];
};
export type PublicState = Omit<
  State,
  "cards" | "items" | "answers" | "seed" | "commandIds"
> & {
  cards: { id: string; text: string | null; matched: boolean }[];
  item: PublicItem | null;
  answers: Partial<
    Record<Role, { submitted: boolean; response?: string; correct?: boolean }>
  >;
  total: number;
  expected?: string;
  explanation?: string;
  activeKind: Item["type"];
  canAnswer: boolean;
  race: Record<Role, number>;
};
export type Room = {
  id: string;
  studentId: number;
  studentName: string;
  version: number;
  state: PublicState;
  updatedAt: string;
};
