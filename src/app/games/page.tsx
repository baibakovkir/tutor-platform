"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  Copy,
  Flag,
  Gamepad2,
  HelpCircle,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  Sparkles,
  Trophy,
  Users,
  X,
} from "lucide-react";
import type { GameSet, Item, Kind, Mode, Room } from "@/lib/games/types";
import type { Snapshot } from "@/lib/classroom/types";
import "./games.css";
import { todayVN, addDaysStr } from "@/lib/time";
const kinds: Record<
  Kind,
  { label: string; description: string; symbol: string }
> = {
  pairs: {
    label: "Найди пару",
    description: "Открывайте карточки, запоминайте и находите связи.",
    symbol: "✦",
  },
  sentence: {
    label: "Собери фразу",
    description: "Расставьте слова и соберите английское предложение.",
    symbol: "Aa",
  },
  race: {
    label: "Гонка",
    description: "Отвечайте правильно и продвигайтесь к финишу.",
    symbol: "⚑",
  },
  quiz: {
    label: "Викторина",
    description: "Проверяйте знания по раундам или играйте в дуэль.",
    symbol: "?",
  },
  quest: {
    label: "Приключение",
    description: "Пять локаций, общая цель и разные задания.",
    symbol: "⌘",
  },
};
const modeNames: Record<Mode, string> = {
  guided: "Я ведущий",
  coop: "Играем вместе",
  duel: "Дуэль",
};
type SetSummary = Omit<GameSet, "items"> & {
  counts: Record<Item["type"], number>;
};
function matchesKind(item: Item | undefined, kind: Kind) {
  return (
    !!item &&
    (kind === "quest" ||
      (kind === "pairs"
        ? item.type === "pair"
        : kind === "sentence"
          ? item.type === "sentence"
          : ["choice", "text"].includes(item.type)))
  );
}
async function api<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    cache: "no-store",
    ...(body !== undefined
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const d = await r.json();
  if (!r.ok)
    throw Object.assign(new Error(d.error || "Не удалось загрузить данные."), {
      status: r.status,
    });
  return d;
}
export default function Games() {
  const [data, setData] = useState<Snapshot | null>(null),
    [sets, setSets] = useState<SetSummary[]>([]),
    [rooms, setRooms] = useState<Room[]>([]),
    [roomId, setRoomId] = useState(""),
    [tab, setTab] = useState<"library" | "rooms" | "history">("library"),
    [search, setSearch] = useState(""),
    [course, setCourse] = useState(""),
    [student, setStudent] = useState(""),
    [loading, setLoading] = useState(true),
    [connected, setConnected] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [chosen, setChosen] = useState<SetSummary | null>(null),
    [questSets, setQuestSets] = useState<string[]>([]),
    [kind, setKind] = useState<Kind>("pairs"),
    [mode, setMode] = useState<Mode>("guided"),
    [assigning, setAssigning] = useState<GameSet | null>(null),
    [assignmentIds, setAssignmentIds] = useState<string[]>([]),
    [launchItems, setLaunchItems] = useState<Item[]>([]),
    [launchIds, setLaunchIds] = useState<string[]>([]),
    [draft, setDraft] = useState<GameSet | null>(null),
    [editing, setEditing] = useState(false),
    [text, setText] = useState(""),
    [tokens, setTokens] = useState<string[]>([]),
    [clock, setClock] = useState(Date.now());
  const room = rooms.find((r) => r.id === roomId),
    s = room?.state;
  const isTeacher = data?.role === "teacher";
  const refresh = useCallback(async () => {
    try {
      const d = await api<Snapshot>("/api/classroom/snapshot");
      setData(d);
      const [r, ss] = await Promise.all([
        api<Room[]>("/api/games"),
        d.role === "teacher"
          ? api<SetSummary[]>("/api/games/sets")
          : Promise.resolve([]),
      ]);
      setRooms(r);
      const priority = (s: SetSummary) =>
        s.isCustom ? 0 : s.sourceKey?.startsWith("gogetter") ? 1 : 2;
      setSets(ss.sort((a, b) => priority(a) - priority(b) || a.unit - b.unit));
      if (d.role === "student") setTab("rooms");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("room")) setRoomId(params.get("room")!);
    if (params.get("student")) setStudent(params.get("student")!);
    void refresh();
    const source = new EventSource("/api/games/events");
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (e) => {
      setConnected(true);
      setRooms(JSON.parse(e.data));
    };
    source.addEventListener("revoked", () => {
      source.close();
      setConnected(false);
      setData(null);
      setError("Доступ завершён. Откройте актуальную ссылку кабинета.");
    });
    const t = setInterval(() => setClock(Date.now()), 1000);
    return () => {
      source.close();
      clearInterval(t);
    };
  }, [refresh]);
  useEffect(() => {
    setText("");
    setTokens([]);
  }, [roomId, s?.round, s?.stage]);
  const chosenId = chosen?.id;
  useEffect(() => {
    setQuestSets(chosenId ? Array(5).fill(chosenId) : []);
    setLaunchItems([]);
    setLaunchIds([]);
    let active = true;
    if (chosenId)
      api<GameSet>("/api/games/sets?id=" + encodeURIComponent(chosenId))
        .then((set) => {
          if (active) {
            setLaunchItems(set.items);
            setLaunchIds(set.items.map((i) => i.id));
            setKind((previous) =>
              matchesKind(
                set.items.find((i) => matchesKind(i, previous)),
                previous,
              )
                ? previous
                : set.items.some((i) => i.type === "pair")
                  ? "pairs"
                  : set.items.some((i) => i.type === "sentence")
                    ? "sentence"
                    : "quiz",
            );
          }
        })
        .catch((e) => setError(e.message));
    return () => {
      active = false;
    };
  }, [chosenId]);
  const clearLatest = useRef<() => void>(() => {});
  clearLatest.current = () => void sendCommand("clear");
  const autoClear =
    s?.activeKind === "pair" && s.opened.length === 2 && s.phase === "playing";
  const version = room?.version;
  useEffect(() => {
    if (!autoClear || busy || !connected) return;
    const t = setTimeout(() => clearLatest.current(), 1300);
    return () => clearTimeout(t);
  }, [autoClear, busy, connected, version]);
  const overlayOpen = !!chosen || !!draft || !!assigning;
  useEffect(() => {
    if (!overlayOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = setTimeout(
      () =>
        document
          .querySelector<HTMLElement>(
            ".game-overlay input,.game-overlay button",
          )
          ?.focus(),
      0,
    );
    const keyboard = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setChosen(null);
        setDraft(null);
        setAssigning(null);
      }
      if (e.key === "Tab") {
        const nodes = Array.from(
          document.querySelectorAll<HTMLElement>(
            ".game-overlay input,.game-overlay button,.game-overlay select,.game-overlay textarea",
          ),
        ).filter(
          (n) => !n.hasAttribute("disabled") && n.getClientRects().length,
        );
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => {
      clearTimeout(t);
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", keyboard);
      previous?.focus();
    };
  }, [overlayOpen]);
  function openRoom(id: string) {
    setRoomId(id);
    history.replaceState(null, "", "/games?room=" + id);
    setError("");
  }
  async function sendCommand(
    action:
      | "flip"
      | "clear"
      | "answer"
      | "next"
      | "pause"
      | "resume"
      | "finish"
      | "hint"
      | "mark",
    extra: Record<string, unknown> = {},
  ) {
    if (!room || busy) return;
    setBusy(true);
    if (action !== "clear") setError("");
    try {
      const command = {
        commandId: crypto.randomUUID(),
        version: room.version,
        action,
        ...extra,
      };
      try {
        await api(`/api/games/rooms/${room.id}/commands`, command);
      } catch (e) {
        if (
          action !== "answer" ||
          (e as Error & { status?: number }).status !== 409
        )
          throw e;
        const latestRooms = await api<Room[]>("/api/games");
        setRooms(latestRooms);
        const latest = latestRooms.find((r) => r.id === room.id);
        if (
          !latest ||
          latest.state.round !== room.state.round ||
          latest.state.stage !== room.state.stage ||
          !latest.state.canAnswer
        )
          throw e;
        await api(`/api/games/rooms/${room.id}/commands`, {
          ...command,
          version: latest.version,
        });
      }
      setRooms(await api<Room[]>("/api/games"));
      if (action === "answer") {
        setText("");
        setTokens([]);
      }
    } catch (e) {
      if (action !== "clear") setError((e as Error).message);
      try {
        setRooms(await api<Room[]>("/api/games"));
      } catch {}
    } finally {
      setBusy(false);
    }
  }
  async function launch(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!chosen) return;
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      const r = await api<{ id: string }>("/api/games", {
        setId: chosen.id,
        studentId: Number(f.get("student")),
        title: String(f.get("title")),
        kind,
        mode,
        lessonId: f.get("lesson") ? Number(f.get("lesson")) : null,
        timerSeconds: Number(f.get("timer")),
        stageSetIds: kind === "quest" ? questSets : undefined,
        itemIds: kind === "quest" ? undefined : launchIds,
        count: Number(f.get("count")),
      });
      await refresh();
      setChosen(null);
      openRoom(r.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function editSet(id: string, copy = true) {
    setError("");
    try {
      const d = await api<GameSet>(
        "/api/games/sets?id=" + encodeURIComponent(id),
      );
      setDraft({ ...d, title: copy ? d.title + " · моя копия" : d.title });
      setEditing(!copy);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function saveDraft() {
    if (!draft) return;
    setBusy(true);
    setError("");
    try {
      const r = await api<{ id: string }>("/api/games/sets", {
        ...draft,
        id: editing ? draft.id : undefined,
      });
      setDraft(null);
      setNotice("Набор сохранён в вашей библиотеке.");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function draftItem(index: number, patch: Partial<Item>) {
    if (draft)
      setDraft({
        ...draft,
        items: draft.items.map((i, k) =>
          k === index ? { ...i, ...patch } : i,
        ),
      });
  }
  const role = data?.role || "student";
  const pending = !!s?.answers[role];
  const canPlay = !!s?.canAnswer && connected && !busy;
  const selectedRooms = rooms.filter(
    (r) =>
      (!student || r.studentId === Number(student)) &&
      (tab === "history"
        ? r.state.phase === "finished"
        : r.state.phase !== "finished"),
  );
  if (loading)
    return (
      <main className="auth-page">
        <span className="brand-symbol">к.</span>
        <p>Открываем игровое пространство…</p>
      </main>
    );
  if (!data)
    return (
      <main className="auth-page">
        <div className="auth-card">
          <h1>Игровые занятия</h1>
          <p>
            {error ||
              "Откройте кабинет преподавателя или персональную ссылку ученика."}
          </p>
          <Link className="btn primary" href="/signin">
            Войти
          </Link>
        </div>
      </main>
    );
  return (
    <main className="games-shell">
      <header className="games-header">
        <Link href={isTeacher ? "/" : "/learn"}>
          <ArrowLeft size={17} />
          Кабинет
        </Link>
        <span className={"connection " + (connected ? "online" : "")}>
          <i />
          {connected ? "Общее поле подключено" : "Подключаемся…"}
        </span>
        <span>{data.name}</span>
      </header>
      <div className="games-title">
        <div>
          <span className="eyebrow">УЧИМСЯ, ПОКА ИГРАЕМ</span>
          <h1>{s ? s.title : "Задания и игры"}</h1>
          <p>
            {s
              ? `${room.studentName} · ${modeNames[s.mode]} · ${kinds[s.kind].label}`
              : "Одна встреча. Два участника. Много маленьких открытий."}
          </p>
        </div>
        {s ? (
          <button
            className="btn"
            onClick={() => {
              setRoomId("");
              history.replaceState(null, "", "/games");
            }}
          >
            <ArrowLeft size={16} />
            Все игры
          </button>
        ) : (
          isTeacher && (
            <button
              className="btn primary"
              onClick={() => {
                setEditing(false);
                setDraft({
                  id: "",
                  title: "Мой набор",
                  course: "Свои материалы",
                  unit: 0,
                  topic: "",
                  items: [
                    {
                      id: crypto.randomUUID(),
                      type: "pair",
                      prompt: "",
                      answer: "",
                      explanation: "",
                    },
                    {
                      id: crypto.randomUUID(),
                      type: "pair",
                      prompt: "",
                      answer: "",
                      explanation: "",
                    },
                  ],
                });
              }}
            >
              <Plus size={17} />
              Свой набор
            </button>
          )
        )}
      </div>
      {error && (
        <div className="notice error" role="alert">
          <span>{error}</span>
          <button
            className="icon-btn"
            aria-label="Скрыть ошибку"
            onClick={() => setError("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {notice && (
        <div role="status" className="notice success">
          {notice}
          <button
            className="icon-btn"
            aria-label="Скрыть"
            onClick={() => setNotice("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {!s ? (
        <>
          <div className="games-toolbar">
            <div className="segmented">
              {isTeacher && (
                <button
                  className={tab === "library" ? "selected" : ""}
                  onClick={() => setTab("library")}
                >
                  Библиотека
                </button>
              )}
              <button
                className={tab === "rooms" ? "selected" : ""}
                onClick={() => setTab("rooms")}
              >
                Текущие игры
              </button>
              <button
                className={tab === "history" ? "selected" : ""}
                onClick={() => setTab("history")}
              >
                История ученика
              </button>
            </div>
            {isTeacher && (
              <select
                aria-label="Ученик"
                className="filter-select"
                value={student}
                onChange={(e) => setStudent(e.target.value)}
              >
                <option value="">Все ученики</option>
                {data.students.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          {tab === "library" && isTeacher ? (
            <>
              <section className="game-intro">
                <div>
                  <Sparkles />
                  <h2>Выберите тему — придумайте своё приключение</h2>
                  <p>
                    Материалы по GoGetter 3 и Essential Grammar in Use. Каждый
                    набор подходит для разных игровых механик.
                  </p>
                </div>
                <div className="game-formats">
                  {Object.entries(kinds).map(([id, k]) => (
                    <span key={id}>
                      <b>{k.symbol}</b>
                      {k.label}
                    </span>
                  ))}
                </div>
              </section>
              <div className="games-toolbar">
                <label className="search-field">
                  <Search size={18} />
                  <input
                    aria-label="Найти тему"
                    placeholder="Поиск по теме или номеру раздела"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <select
                  aria-label="Учебник"
                  className="filter-select"
                  value={course}
                  onChange={(e) => setCourse(e.target.value)}
                >
                  <option value="">Все учебники и мои наборы</option>
                  {Array.from(new Set(sets.map((s) => s.course))).map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
                <span className="muted">
                  {
                    sets.filter(
                      (s) =>
                        (!course || s.course === course) &&
                        (s.title + " " + s.topic)
                          .toLowerCase()
                          .includes(search.toLowerCase()),
                    ).length
                  }{" "}
                  наборов
                </span>
              </div>
              <div className="games-library">
                {sets
                  .filter(
                    (s) =>
                      (!course || s.course === course) &&
                      (s.title + " " + s.topic)
                        .toLowerCase()
                        .includes(search.toLowerCase()),
                  )
                  .map((set) => (
                    <article className="panel game-set" key={set.id}>
                      <div className="card-topline">
                        <span className="pill lavender">
                          {set.isCustom && "Мой · "}
                          {set.sourceKey?.startsWith("essential")
                            ? "Murphy"
                            : set.sourceKey?.startsWith("gogetter")
                              ? "GoGetter 3"
                              : "Мой набор"}
                        </span>
                        <BookOpen size={19} />
                      </div>
                      <h2>{set.title}</h2>
                      <p>{set.topic}</p>
                      <div className="set-counts">
                        <span>{set.counts.pair} пар</span>
                        <span>{set.counts.sentence} фраз</span>
                        <span>{set.counts.choice} вопросов</span>
                      </div>
                      <div className="exercise-actions">
                        <button
                          className="btn primary"
                          onClick={() => {
                            setError("");
                            setChosen(set);
                          }}
                        >
                          <Play size={15} />
                          На урок
                        </button>
                        <button
                          className="btn"
                          onClick={async () => {
                            try {
                              const full = await api<GameSet>(
                                "/api/games/sets?id=" +
                                  encodeURIComponent(set.id),
                              );
                              setAssignmentIds(full.items.map((i) => i.id));
                              setAssigning(full);
                              setError("");
                            } catch (e) {
                              setError((e as Error).message);
                            }
                          }}
                        >
                          В ДЗ
                        </button>
                        <button
                          className="text-btn"
                          onClick={() => void editSet(set.id)}
                        >
                          <Copy size={14} />
                          Копировать
                        </button>
                        {
                          <button
                            className="text-btn"
                            onClick={() => void editSet(set.id, false)}
                          >
                            Изменить
                          </button>
                        }
                      </div>
                    </article>
                  ))}
              </div>
            </>
          ) : (
            <section className="room-list">
              {selectedRooms.map((r) => (
                <button
                  key={r.id}
                  className="panel room-card"
                  onClick={() => openRoom(r.id)}
                >
                  <span className="game-symbol">
                    {kinds[r.state.kind].symbol}
                  </span>
                  <span>
                    <strong>{r.state.title}</strong>
                    <small>
                      {r.studentName} · {modeNames[r.state.mode]} ·{" "}
                      {new Date(r.updatedAt).toLocaleDateString("ru-RU")}
                    </small>
                  </span>
                  <span
                    className={
                      "pill " +
                      (r.state.phase === "finished" ? "green" : "lavender")
                    }
                  >
                    {r.state.phase === "finished"
                      ? "Результаты"
                      : r.state.phase === "paused"
                        ? "Пауза"
                        : "Присоединиться"}
                  </span>
                  <ArrowRight size={17} />
                </button>
              ))}
              {!selectedRooms.length && (
                <div className="panel empty">
                  <Gamepad2 size={32} />
                  <h3>
                    {tab === "history"
                      ? "Завершённых игр пока нет"
                      : "Пока нет активных игр"}
                  </h3>
                  <p>
                    {isTeacher
                      ? "Выберите набор в библиотеке и пригласите ученика."
                      : "Преподаватель запустит игру, и она появится здесь автоматически."}
                  </p>
                </div>
              )}
            </section>
          )}
        </>
      ) : (
        <>
          <div className="game-layout">
            <section className="panel play-panel">
              <div className="play-top">
                <span className="pill lavender">
                  {s.kind === "quest"
                    ? `Локация ${s.stage + 1} / 5`
                    : `${s.activeKind === "pair" ? "Пары" : "Раунд"} ${s.activeKind === "pair" ? s.matched.length / 2 : s.round + 1} / ${s.total}`}
                </span>
                <span className="muted">
                  {s.phase === "finished"
                    ? "Завершено"
                    : s.phase === "paused"
                      ? "Пауза"
                      : s.revealed
                        ? "Разбор ответа"
                        : s.mode === "duel" && s.activeKind !== "pair"
                          ? "Отвечаем независимо"
                          : s.mode === "guided"
                            ? "Играет ученик"
                            : s.turn === "teacher"
                              ? "Ход преподавателя"
                              : "Ход ученика"}
                </span>
                {s.deadline && (
                  <strong className="countdown">
                    {Math.max(0, Math.ceil((s.deadline - clock) / 1000))} с
                  </strong>
                )}
              </div>
              {s.kind === "race" && (
                <Race room={room} shared={s.mode !== "duel"} />
              )}
              {s.kind === "quest" && (
                <div className="quest-map">
                  {s.stages.map((stage, i) => (
                    <div
                      key={i}
                      className={
                        "quest-stop " +
                        (i === s.stage
                          ? "current"
                          : i < s.stage
                            ? "complete"
                            : "")
                      }
                    >
                      <span>
                        {i < s.stage ? (
                          <Check size={20} />
                        ) : (
                          ["⌂", "⇄", "☕", "▤", "♧"][i]
                        )}
                      </span>
                      <small>{stage.title.split(" · ")[0]}</small>
                    </div>
                  ))}
                </div>
              )}
              {s.phase === "finished" ? (
                <div className="game-finale">
                  <span>
                    <Trophy size={52} />
                  </span>
                  <h2>
                    {s.kind === "quest"
                      ? "Приключение пройдено"
                      : "Игра завершена!"}
                  </h2>
                  <p>
                    {s.mode === "duel"
                      ? s.scores.teacher === s.scores.student
                        ? "Ничья — хороший повод для ещё одного раунда."
                        : s.scores.teacher > s.scores.student
                          ? "В этот раз победил преподаватель."
                          : "В этот раз победил ученик!"
                      : "Каждая попытка — ещё один шаг вперёд."}
                  </p>
                  {isTeacher && (
                    <button
                      className="btn primary"
                      onClick={() => {
                        const set = sets.find(
                          (x) =>
                            x.id === s.setId ||
                            x.sourceKey === s.setId ||
                            x.baseSetId === s.setId,
                        );
                        if (set) setChosen(set);
                        else
                          setError(
                            "Исходный набор недоступен. Выберите другой в библиотеке.",
                          );
                      }}
                    >
                      <RefreshCw size={16} />
                      Сыграть ещё раз
                    </button>
                  )}
                </div>
              ) : s.phase === "paused" ? (
                <div className="game-finale">
                  <Pause size={46} />
                  <h2>Небольшая пауза</h2>
                  <p>
                    Поле и результаты сохранены. Преподаватель продолжит игру.
                  </p>
                </div>
              ) : s.activeKind === "pair" ? (
                <>
                  <h2>
                    {s.kind === "quest"
                      ? s.stages[s.stage]?.title
                      : "Откройте две карточки и найдите пару"}
                  </h2>
                  <div className="memory-board">
                    {s.cards.map((c, i) => (
                      <button
                        className={
                          "memory-card " +
                          (c.text ? "flipped" : "") +
                          (c.matched ? " matched" : "")
                        }
                        key={c.id}
                        aria-label={c.text || `Открыть карточку ${i + 1}`}
                        disabled={
                          !canPlay ||
                          c.matched ||
                          s.opened.includes(c.id) ||
                          s.opened.length === 2
                        }
                        onClick={() => void sendCommand("flip", { card: c.id })}
                      >
                        <span>{c.text || "✦"}</span>
                      </button>
                    ))}
                  </div>
                  <p className="play-help">
                    {s.revealed
                      ? "Все пары найдены. Можно перейти дальше."
                      : s.lastMatch === false
                        ? "Не совпало. Запомните карточки и продолжайте."
                        : s.lastMatch === true
                          ? "Есть пара! Попробуйте найти следующую."
                          : "Оба участника видят одно поле. Открытые карточки закроются автоматически."}
                  </p>
                </>
              ) : s.item ? (
                <>
                  <h2 className="question-text">{s.item.prompt}</h2>
                  {s.revealed ? (
                    <div className="round-result">
                      <span className="pill green">Разбор раунда</span>
                      <h3>{s.expected}</h3>
                      <p>{s.explanation}</p>
                      {(["teacher", "student"] as const)
                        .filter((r) => s.answers[r])
                        .map((r) => (
                          <div className="answer-review" key={r}>
                            <strong>
                              {r === "teacher" ? "Преподаватель" : "Ученик"}
                            </strong>
                            <span>{s.answers[r]?.response}</span>
                            <span
                              className={
                                "pill " +
                                (s.answers[r]?.correct ? "green" : "amber")
                              }
                            >
                              {s.answers[r]?.correct ? "Верно" : "Повторим"}
                            </span>
                          </div>
                        ))}
                      {isTeacher ? (
                        <button
                          className="btn primary"
                          disabled={busy || !connected}
                          onClick={() => void sendCommand("next")}
                        >
                          Продолжить
                          <ArrowRight size={16} />
                        </button>
                      ) : (
                        <p className="muted">
                          Преподаватель откроет следующий раунд.
                        </p>
                      )}
                    </div>
                  ) : s.item.type === "text" &&
                    isTeacher &&
                    Object.values(s.answers).some((a) => a?.correct === null) &&
                    (s.mode !== "duel" ||
                      (s.answers.teacher && s.answers.student)) ? (
                    <div className="round-result">
                      <h3>Проверьте ответы</h3>
                      {(["teacher", "student"] as const)
                        .filter((r) => s.answers[r])
                        .map((r) => (
                          <div className="manual-answer" key={r}>
                            <strong>
                              {r === "teacher" ? "Преподаватель" : "Ученик"}
                            </strong>
                            <p>{s.answers[r]?.response}</p>
                            {s.answers[r]?.correct === null ? (
                              <div className="form-actions">
                                <button
                                  className="btn primary"
                                  disabled={busy || !connected}
                                  onClick={() =>
                                    void sendCommand("mark", {
                                      target: r,
                                      correct: true,
                                    })
                                  }
                                >
                                  Верно
                                </button>
                                <button
                                  className="btn"
                                  disabled={busy || !connected}
                                  onClick={() =>
                                    void sendCommand("mark", {
                                      target: r,
                                      correct: false,
                                    })
                                  }
                                >
                                  Нужно повторить
                                </button>
                              </div>
                            ) : (
                              <span className="pill green">Проверено</span>
                            )}
                          </div>
                        ))}
                    </div>
                  ) : pending ? (
                    <div className="waiting-answer">
                      <Check size={34} />
                      <h3>Ответ принят</h3>
                      <p>
                        {s.item.type === "text"
                          ? "Ожидаем проверку преподавателя."
                          : "Ждём второго участника. Результат откроется у обоих одновременно."}
                      </p>
                    </div>
                  ) : (
                    <>
                      {s.activeKind === "sentence" ? (
                        <>
                          <div
                            className="sentence-target"
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                              e.preventDefault();
                              const id = e.dataTransfer.getData("text/plain");
                              if (
                                canPlay &&
                                !tokens.includes(id) &&
                                s.item?.tokens?.some((t) => t.id === id)
                              )
                                setTokens([...tokens, id]);
                            }}
                          >
                            <span className="tiny-label">
                              ВАША ФРАЗА · НАЖМИТЕ НА СЛОВО, ЧТОБЫ ВЕРНУТЬ
                            </span>
                            <div>
                              {tokens.map((id, index) => (
                                <button
                                  key={id}
                                  className="word-token selected"
                                  disabled={!canPlay}
                                  onClick={() =>
                                    setTokens(tokens.filter((x) => x !== id))
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === "ArrowLeft" && index > 0) {
                                      e.preventDefault();
                                      const next = [...tokens];
                                      [next[index - 1], next[index]] = [
                                        next[index],
                                        next[index - 1],
                                      ];
                                      setTokens(next);
                                    }
                                    if (
                                      e.key === "ArrowRight" &&
                                      index < tokens.length - 1
                                    ) {
                                      e.preventDefault();
                                      const next = [...tokens];
                                      [next[index + 1], next[index]] = [
                                        next[index],
                                        next[index + 1],
                                      ];
                                      setTokens(next);
                                    }
                                  }}
                                >
                                  {
                                    s.item?.tokens?.find((t) => t.id === id)
                                      ?.text
                                  }
                                </button>
                              ))}
                            </div>
                            {!tokens.length && (
                              <p>
                                Перенесите слова сюда или нажимайте на них ниже
                              </p>
                            )}
                          </div>
                          <div className="word-bank">
                            {s.item.tokens
                              ?.filter((t) => !tokens.includes(t.id))
                              .map((t) => (
                                <button
                                  key={t.id}
                                  className="word-token"
                                  draggable={canPlay}
                                  disabled={!canPlay}
                                  onDragStart={(e) =>
                                    e.dataTransfer.setData("text/plain", t.id)
                                  }
                                  onClick={() => setTokens([...tokens, t.id])}
                                >
                                  {t.text}
                                </button>
                              ))}
                          </div>
                          <div className="play-submit">
                            <button
                              className="btn subtle"
                              disabled={!tokens.length || busy}
                              onClick={() => setTokens([])}
                            >
                              Сбросить
                            </button>
                            <button
                              className="btn primary"
                              disabled={
                                !canPlay ||
                                tokens.length !== s.item.tokens?.length
                              }
                              onClick={() =>
                                void sendCommand("answer", {
                                  answer: tokens
                                    .map(
                                      (id) =>
                                        s.item!.tokens!.find(
                                          (t) => t.id === id,
                                        )!.text,
                                    )
                                    .join(" "),
                                })
                              }
                            >
                              Проверить фразу
                              <Send size={16} />
                            </button>
                          </div>
                        </>
                      ) : s.item.options ? (
                        <div className="quiz-options">
                          {s.item.options.map((o, i) => (
                            <button
                              key={o}
                              disabled={!canPlay}
                              onClick={() =>
                                void sendCommand("answer", { answer: o })
                              }
                            >
                              <span>{"ABCDЕFGH"[i]}</span>
                              {o}
                              <ArrowRight size={16} />
                            </button>
                          ))}
                        </div>
                      ) : (
                        <form
                          className="free-answer"
                          onSubmit={(e) => {
                            e.preventDefault();
                            void sendCommand("answer", { answer: text });
                          }}
                        >
                          <label>
                            Ваш ответ
                            <input
                              value={text}
                              onChange={(e) => setText(e.target.value)}
                              required
                              maxLength={2000}
                              disabled={!canPlay}
                            />
                          </label>
                          <button className="btn primary" disabled={!canPlay}>
                            Ответить
                            <Send size={16} />
                          </button>
                        </form>
                      )}
                      {!canPlay && !pending && (
                        <p className="play-help">
                          {!connected
                            ? "Ждём восстановления связи."
                            : s.mode === "guided" && isTeacher
                              ? "Вы ведущий: наблюдайте за ответом ученика."
                              : "Сейчас ход другого участника."}
                        </p>
                      )}
                    </>
                  )}
                  {s.item.hint && (
                    <div className="hint-panel">
                      <HelpCircle size={18} />
                      <p>{s.item.hint}</p>
                    </div>
                  )}
                </>
              ) : null}
              {isTeacher && s.phase !== "finished" && (
                <div className="host-controls">
                  <button
                    className="btn"
                    disabled={busy || !connected}
                    onClick={() =>
                      void sendCommand(
                        s.phase === "paused" ? "resume" : "pause",
                      )
                    }
                  >
                    {s.phase === "paused" ? (
                      <Play size={15} />
                    ) : (
                      <Pause size={15} />
                    )}{" "}
                    {s.phase === "paused" ? "Продолжить" : "Пауза"}
                  </button>
                  {s.phase === "playing" && (
                    <>
                      <button
                        className="btn"
                        disabled={busy || !connected || s.hinted}
                        onClick={() => void sendCommand("hint")}
                      >
                        <HelpCircle size={15} />
                        Подсказка
                      </button>
                      <button
                        className="btn"
                        disabled={busy || !connected}
                        onClick={() => void sendCommand("next")}
                      >
                        {s.revealed ? "Дальше" : "Пропустить"}
                        <ArrowRight size={15} />
                      </button>
                    </>
                  )}
                  <button
                    className="text-btn"
                    disabled={busy || !connected}
                    onClick={() => {
                      if (confirm("Завершить игру и сохранить результаты?"))
                        void sendCommand("finish");
                    }}
                  >
                    Завершить
                  </button>
                </div>
              )}
            </section>
            <aside className="game-side">
              <section className="panel score-panel">
                <h2>{s.mode === "duel" ? "Счёт игры" : "Наш прогресс"}</h2>
                <div>
                  <span className="player-dot teacher-dot" />
                  Преподаватель<strong>{s.scores.teacher}</strong>
                </div>
                <div>
                  <span className="player-dot student-dot" />
                  Ученик<strong>{s.scores.student}</strong>
                </div>
                {s.mode === "coop" && (
                  <div className="shared-score">
                    Общий результат
                    <strong>{s.scores.teacher + s.scores.student}</strong>
                  </div>
                )}
                <p>
                  Один правильный ответ — один балл. Ошибки помогают понять, что
                  повторить.
                </p>
              </section>
              <section className="panel game-note">
                <Users size={22} />
                <h3>На связи</h3>
                <p>
                  {room.studentName} и преподаватель открывают эту игру каждый в
                  своём кабинете.
                </p>
                {data.lessons.find((l) => l.id === s.lessonId)?.meetingUrl && (
                  <a
                    className="btn wide"
                    href={
                      data.lessons.find((l) => l.id === s.lessonId)!.meetingUrl
                    }
                    target="_blank"
                    rel="noreferrer"
                  >
                    Открыть видеосвязь
                  </a>
                )}
              </section>
              {s.course && (
                <section className="panel game-note">
                  <BookOpen size={22} />
                  <h3>Материал</h3>
                  <p>
                    {s.course}
                    <br />
                    Раздел {s.unit}
                  </p>
                </section>
              )}
            </aside>
          </div>
          <section className="panel game-history">
            <div className="panel-head">
              <div>
                <h2>Попытки и обратная связь</h2>
                <p>
                  Ошибки и использованные подсказки сохраняются в истории
                  ученика
                </p>
              </div>
              {isTeacher &&
                s.phase === "finished" &&
                s.log.some((e) => !e.correct) && (
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const bank = await api<GameSet>(
                          `/api/games/rooms/${room.id}/repeat`,
                          {},
                        );
                        setEditing(false);
                        setDraft(bank);
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <RefreshCw size={15} />
                    Набор по ошибкам
                  </button>
                )}
            </div>
            {s.log.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Участник</th>
                      <th>Ответ</th>
                      <th>Результат</th>
                      <th>Разбор</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.log
                      .slice()
                      .reverse()
                      .map((e, i) => (
                        <tr key={i}>
                          <td>
                            {e.role === "teacher" ? "Преподаватель" : "Ученик"}
                            {e.hinted && <small>С подсказкой</small>}
                          </td>
                          <td className="history-response">{e.response}</td>
                          <td>
                            <span
                              className={
                                "pill " + (e.correct ? "green" : "amber")
                              }
                            >
                              {e.skipped
                                ? "Пропущено"
                                : e.correct
                                  ? "Верно"
                                  : "Повторить"}
                            </span>
                          </td>
                          <td className="history-response">
                            {e.expected}
                            <small>{e.explanation}</small>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="calm-empty">
                Здесь появятся результаты завершённых попыток.
              </div>
            )}
          </section>
        </>
      )}
      {chosen && (
        <div
          className="game-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Настроить игру"
        >
          <form className="panel launch-dialog" onSubmit={launch}>
            <div className="modal-head">
              <h2>Начнём игру</h2>
              <button
                type="button"
                className="icon-btn"
                aria-label="Закрыть"
                onClick={() => setChosen(null)}
              >
                <X size={20} />
              </button>
            </div>
            <div className="modal-content">
              {error && (
                <div role="alert" className="form-error">
                  {error}
                </div>
              )}
              <label className="field">
                Название
                <input
                  name="title"
                  defaultValue={chosen.title}
                  required
                  maxLength={200}
                />
              </label>
              <label className="field">
                Ученик
                <select
                  name="student"
                  aria-label="Ученик игры"
                  required
                  defaultValue={student || ""}
                  onChange={(e) => setStudent(e.target.value)}
                >
                  <option disabled value="">
                    Выберите ученика
                  </option>
                  {data.students.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="format-picker">
                {(Object.keys(kinds) as Kind[]).map((k) => (
                  <button
                    type="button"
                    className={kind === k ? "selected" : ""}
                    key={k}
                    onClick={() => {
                      setKind(k);
                      if (k === "quest" && mode === "duel") setMode("coop");
                    }}
                  >
                    <b>{kinds[k].symbol}</b>
                    <strong>{kinds[k].label}</strong>
                    <small>{kinds[k].description}</small>
                  </button>
                ))}
              </div>
              <label className="field">
                Как играем
                <select
                  aria-label="Режим игры"
                  value={mode}
                  onChange={(e) => setMode(e.target.value as Mode)}
                >
                  {(Object.keys(modeNames) as Mode[])
                    .filter((m) => kind !== "quest" || m !== "duel")
                    .map((m) => (
                      <option key={m} value={m}>
                        {modeNames[m]}
                      </option>
                    ))}
                </select>
              </label>
              {kind !== "quest" && (
                <details className="task-selection">
                  <summary>
                    Задания для игры ·{" "}
                    {
                      launchIds.filter((id) =>
                        matchesKind(
                          launchItems.find((i) => i.id === id),
                          kind,
                        ),
                      ).length
                    }{" "}
                    выбрано
                  </summary>
                  {launchItems
                    .filter((i) => matchesKind(i, kind))
                    .map((i) => (
                      <label key={i.id}>
                        <input
                          type="checkbox"
                          checked={launchIds.includes(i.id)}
                          onChange={(e) =>
                            setLaunchIds(
                              e.target.checked
                                ? [...launchIds, i.id]
                                : launchIds.filter((id) => id !== i.id),
                            )
                          }
                        />
                        <span>{i.prompt}</span>
                      </label>
                    ))}
                </details>
              )}
              {kind === "quest" && (
                <div className="quest-materials">
                  <h3>Материалы для локаций</h3>
                  <p className="muted small-text">
                    Соединяйте лексику и грамматику из разных наборов.
                  </p>
                  {[
                    "Дом · пары",
                    "Вокзал · фразы",
                    "Кафе · вопросы",
                    "Музей · фразы",
                    "Парк · вопросы",
                  ].map((title, index) => (
                    <label className="field" key={title}>
                      {title}
                      <select
                        value={questSets[index] || chosen.id}
                        onChange={(e) => {
                          const next = questSets.length
                            ? questSets.slice()
                            : Array(5).fill(chosen.id);
                          next[index] = e.target.value;
                          setQuestSets(next);
                        }}
                      >
                        {sets.map((set) => (
                          <option key={set.id} value={set.id}>
                            {set.title} ·{" "}
                            {set.sourceKey?.startsWith("gogetter")
                              ? "GoGetter"
                              : set.sourceKey?.startsWith("essential")
                                ? "Murphy"
                                : "Мой"}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              )}
              <div className="form-two">
                <label className="field">
                  Число заданий
                  <input
                    name="count"
                    type="number"
                    defaultValue={kind === "pairs" ? 6 : 8}
                    min={2}
                    max={kind === "pairs" ? 12 : 30}
                  />
                </label>
                <label className="field">
                  Таймер
                  <select
                    name="timer"
                    disabled={kind === "pairs"}
                    defaultValue="0"
                  >
                    <option value="0">Без ограничения</option>
                    <option value="30">30 секунд</option>
                    <option value="60">60 секунд</option>
                    <option value="120">2 минуты</option>
                  </select>
                </label>
              </div>
              <label className="field">
                Привязать к занятию
                <select
                  name="lesson"
                  defaultValue={
                    new URLSearchParams(
                      typeof location !== "undefined" ? location.search : "",
                    ).get("lesson") || ""
                  }
                >
                  <option value="">Без привязки</option>
                  {data.lessons
                    .filter((l) => !student || l.studentId === Number(student))
                    .map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.studentName} · {l.date} {l.start} · {l.title}
                      </option>
                    ))}
                </select>
              </label>
              <p className="muted small-text">
                Ученик увидит приглашение в своём кабинете. Для приключения
                используются пять готовых этапов из выбранного набора.
              </p>
              <button
                className="btn primary wide"
                disabled={busy || !data.students.length}
              >
                {busy ? "Создаём…" : "Создать общую комнату"}
                <Play size={16} />
              </button>
            </div>
          </form>
        </div>
      )}
      {assigning && (
        <div
          className="game-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Назначить из библиотеки"
        >
          <form
            className="panel launch-dialog"
            onSubmit={async (e) => {
              e.preventDefault();
              setError("");
              setBusy(true);
              const f = new FormData(e.currentTarget);
              try {
                await api("/api/library/homework", {
                  setId: assigning.id,
                  studentId: Number(f.get("student")),
                  title: String(f.get("title")),
                  body: String(f.get("body")),
                  due: String(f.get("due")),
                  itemIds: assignmentIds,
                });
                setAssigning(null);
                setNotice(
                  "Домашнее задание назначено. Оно появилось в кабинете ученика.",
                );
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="modal-head">
              <h2>Назначить домашнее задание</h2>
              <button
                type="button"
                className="icon-btn"
                aria-label="Закрыть"
                onClick={() => setAssigning(null)}
              >
                <X size={20} />
              </button>
            </div>
            <div className="modal-content">
              {error && (
                <div className="form-error" role="alert">
                  {error}
                </div>
              )}
              <label className="field">
                Название
                <input
                  name="title"
                  defaultValue={assigning.title}
                  required
                  maxLength={200}
                />
              </label>
              <label className="field">
                Ученик
                <select
                  name="student"
                  aria-label="Ученик ДЗ"
                  required
                  defaultValue={student || ""}
                >
                  <option value="" disabled>
                    Выберите ученика
                  </option>
                  {data.students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Срок
                <input
                  name="due"
                  type="date"
                  defaultValue={addDaysStr(todayVN(), 7)}
                  required
                />
              </label>
              <label className="field">
                Инструкция
                <textarea name="body" rows={2} maxLength={20000} />
              </label>
              <div className="card-topline">
                <strong>Задания · {assignmentIds.length}</strong>
                <button
                  className="text-btn"
                  type="button"
                  onClick={() =>
                    setAssignmentIds(
                      assignmentIds.length
                        ? []
                        : assigning.items.map((i) => i.id),
                    )
                  }
                >
                  {assignmentIds.length ? "Снять выбор" : "Выбрать все"}
                </button>
              </div>
              <div className="task-selection">
                {assigning.items.map((i) => (
                  <label key={i.id}>
                    <input
                      type="checkbox"
                      checked={assignmentIds.includes(i.id)}
                      onChange={(e) =>
                        setAssignmentIds(
                          e.target.checked
                            ? [...assignmentIds, i.id]
                            : assignmentIds.filter((id) => id !== i.id),
                        )
                      }
                    />
                    <span>
                      <small>
                        {i.type === "pair"
                          ? "Пара"
                          : i.type === "sentence"
                            ? "Фраза"
                            : "Вопрос"}
                      </small>
                      {i.prompt}
                    </span>
                  </label>
                ))}
              </div>
              <button
                className="btn primary"
                disabled={busy || !assignmentIds.length}
              >
                Назначить ДЗ
                <ArrowRight size={16} />
              </button>
              <p className="muted small-text">
                Сохранится текущая версия выбранных заданий. Последующие правки
                набора не изменят уже назначенное ДЗ.
              </p>
            </div>
          </form>
        </div>
      )}
      {draft && (
        <div
          className="game-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Редактор набора"
        >
          <section className="panel editor-dialog">
            <div className="modal-head">
              <h2>{editing ? "Редактировать набор" : "Моя копия набора"}</h2>
              <button
                className="icon-btn"
                aria-label="Закрыть"
                onClick={() => setDraft(null)}
              >
                <X size={20} />
              </button>
            </div>
            <div className="modal-content">
              {error && (
                <div className="form-error" role="alert">
                  {error}
                </div>
              )}
              <label className="field">
                Название
                <input
                  value={draft.title}
                  maxLength={200}
                  onChange={(e) =>
                    setDraft({ ...draft, title: e.target.value })
                  }
                />
              </label>
              <label className="field">
                Тема
                <input
                  value={draft.topic}
                  maxLength={200}
                  onChange={(e) =>
                    setDraft({ ...draft, topic: e.target.value })
                  }
                />
              </label>
              <p className="muted small-text">
                Пары — две связанные карточки. Фразы — условие и полное
                предложение. Вопросы — условие, правильный ответ и варианты,
                каждый с новой строки.
              </p>
              {draft.items.map((i, index) => (
                <div className="editor-item" key={i.id}>
                  <div className="card-topline">
                    <select
                      aria-label={`Тип задания ${index + 1}`}
                      value={
                        i.type === "choice" && !i.options ? "short" : i.type
                      }
                      onChange={(e) =>
                        draftItem(index, {
                          type:
                            e.target.value === "short"
                              ? "choice"
                              : (e.target.value as Item["type"]),
                          options:
                            e.target.value === "choice"
                              ? [i.answer || "Ответ", "Другой вариант"]
                              : undefined,
                        })
                      }
                    >
                      <option value="pair">Пара карточек</option>
                      <option value="sentence">Сборка фразы</option>
                      <option value="choice">Вопрос с вариантами</option>
                      <option value="short">Короткий ответ</option>
                      <option value="text">
                        Развёрнутый ответ · проверка преподавателя
                      </option>
                    </select>
                    <button
                      className="icon-btn"
                      aria-label={`Удалить задание ${index + 1}`}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          items: draft.items.filter((_, k) => k !== index),
                        })
                      }
                    >
                      <X size={17} />
                    </button>
                  </div>
                  <label className="field">
                    Условие / первая карточка
                    <textarea
                      rows={2}
                      value={i.prompt}
                      maxLength={2000}
                      onChange={(e) =>
                        draftItem(index, { prompt: e.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    Правильный ответ / вторая карточка
                    <input
                      value={i.answer}
                      maxLength={2000}
                      onChange={(e) =>
                        draftItem(index, { answer: e.target.value })
                      }
                    />
                  </label>
                  {i.type === "choice" && i.options && (
                    <label className="field">
                      Варианты, включая правильный
                      <textarea
                        rows={3}
                        value={i.options?.join("\n") || ""}
                        onChange={(e) =>
                          draftItem(index, {
                            options: e.target.value.split("\n"),
                          })
                        }
                      />
                    </label>
                  )}
                  <label className="field">
                    Объяснение
                    <input
                      value={i.explanation}
                      maxLength={3000}
                      onChange={(e) =>
                        draftItem(index, { explanation: e.target.value })
                      }
                    />
                  </label>
                </div>
              ))}
              <button
                className="btn"
                disabled={draft.items.length >= 150}
                onClick={() =>
                  setDraft({
                    ...draft,
                    items: [
                      ...draft.items,
                      {
                        id: crypto.randomUUID(),
                        type: "pair",
                        prompt: "",
                        answer: "",
                        explanation: "",
                      },
                    ],
                  })
                }
              >
                <Plus size={16} />
                Добавить задание
              </button>
              <div className="form-actions">
                <button
                  className="btn primary"
                  disabled={busy}
                  onClick={() => void saveDraft()}
                >
                  <Save size={16} />
                  Сохранить набор
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
      <footer className="app-footer">
        <span>класс / игровые занятия</span>
        <span>Учимся вместе ✦</span>
      </footer>
    </main>
  );
}
function Race({ room, shared }: { room: Room; shared: boolean }) {
  const s = room.state;
  const tracks = shared
    ? [
        {
          label: "Наша команда",
          score: s.scores.teacher + s.scores.student,
          color: "#7560d4",
        },
      ]
    : [
        { label: "Преподаватель", score: s.scores.teacher, color: "#7560d4" },
        { label: "Ученик", score: s.scores.student, color: "#42a898" },
      ];
  return (
    <div className="race-board">
      {tracks.map((t) => (
        <div className="race-track" key={t.label}>
          <div>
            <strong>{t.label}</strong>
            <span>
              {t.score} / {s.total}
            </span>
          </div>
          <div className="race-lane">
            <span
              className="race-car"
              style={{
                left: `${Math.min(95, (t.score / s.total) * 95)}%`,
                background: t.color,
              }}
            >
              ➜
            </span>
            <Flag size={23} />
          </div>
        </div>
      ))}
    </div>
  );
}
