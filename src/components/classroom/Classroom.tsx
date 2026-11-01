"use client";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { signOut } from "next-auth/react";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  CreditCard,
  ExternalLink,
  FileText,
  GraduationCap,
  Gamepad2,
  LayoutDashboard,
  Link2,
  LogOut,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Users,
  Video,
  X,
} from "lucide-react";
import type {
  Snapshot,
  Student,
  Lesson,
  Homework,
  Exercise,
} from "@/lib/classroom/types";
import { addDaysStr, todayVN, weekStartStr } from "@/lib/time";

type Tab =
  | "overview"
  | "schedule"
  | "students"
  | "homework"
  | "exercises"
  | "payments"
  | "settings";
type Modal =
  | { kind: "student"; student?: Student }
  | { kind: "lesson"; lesson?: Lesson; editing?: boolean }
  | { kind: "homework"; exercise?: Exercise; lesson?: Lesson }
  | { kind: "exercise"; exercise?: Exercise }
  | { kind: "work"; homework: Homework }
  | { kind: "invite"; name: string; link: string }
  | { kind: "archive"; student: Student };
const nav = [
  { id: "overview", label: "Обзор", icon: LayoutDashboard },
  { id: "schedule", label: "Расписание", icon: CalendarDays },
  { id: "students", label: "Ученики", icon: Users },
  { id: "homework", label: "Домашние задания", icon: BookOpen },
  { id: "exercises", label: "Библиотека заданий", icon: Sparkles },
  { id: "payments", label: "Оплаты", icon: CreditCard },
] as const;
const money = (n: number | string) =>
  new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(Number(n));
const date = (
  s: string,
  opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "long" },
) => new Date(s + "T12:00:00").toLocaleDateString("ru-RU", opts);
const statusLabel = {
  assigned: "Назначено",
  submitted: "На проверке",
  reviewed: "Проверено",
};
const kindLabel = {
  choice: "Выбор ответа",
  short: "Короткий ответ",
  text: "Развёрнутый ответ",
};
const initials = (s: string) =>
  s
    .split(" ")
    .slice(0, 2)
    .map((x) => x[0])
    .join("")
    .toUpperCase();
async function request<T = Record<string, unknown>>(
  url: string,
  body?: unknown,
  method = "POST",
): Promise<T> {
  const r = await fetch("/api/classroom/" + url, {
    method,
    headers:
      body instanceof FormData ? {} : { "Content-Type": "application/json" },
    ...(method === "GET"
      ? {}
      : { body: body instanceof FormData ? body : JSON.stringify(body ?? {}) }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "Не удалось выполнить действие.");
  return data;
}
function Empty({
  icon: Icon = BookOpen,
  title,
  children,
  action,
}: {
  icon?: typeof BookOpen;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon size={27} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      {label}
      {children}
    </label>
  );
}
function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button
          type="button"
          className="icon-btn"
          aria-label="Закрыть"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export default function Classroom({ pupil = false }: { pupil?: boolean }) {
  const [data, setData] = useState<Snapshot | null>(null),
    [tab, setTab] = useState<Tab>("overview"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [modal, setModal] = useState<Modal | null>(null),
    [search, setSearch] = useState(""),
    [studentFilter, setStudentFilter] = useState(""),
    [week, setWeek] = useState(weekStartStr(todayVN())),
    [payFilter, setPayFilter] = useState("all"),
    [hwFilter, setHwFilter] = useState("all");
  const [librarySets, setLibrarySets] = useState<
    { id: string; title: string; course: string }[]
  >([]);
  useEffect(() => {
    fetch("/api/games/sets", { cache: "no-store" })
      .then(async (r) => {
        if (r.ok) setLibrarySets(await r.json());
      })
      .catch(() => {});
  }, []);
  const [activeGames, setActiveGames] = useState<
    {
      id: string;
      studentName: string;
      state: { title: string; phase: string };
    }[]
  >([]);
  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const r = await fetch("/api/games", { cache: "no-store" });
        if (r.ok) {
          const games = await r.json();
          if (alive)
            setActiveGames(
              games.filter(
                (g: { state: { phase: string } }) =>
                  g.state.phase !== "finished",
              ),
            );
        }
      } catch {}
    };
    void check();
    const t = setInterval(() => void check(), 10000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/classroom/snapshot", { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) {
        if (r.status === 401) setData(null);
        throw new Error(d.error);
      }
      setData(d);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 60000);
    const visible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [refresh]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  const perform = async (
    fn: () => Promise<unknown>,
    message = "Сохранено",
    close = false,
  ) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
      if (message) setNotice(message);
      if (close) setModal(null);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const open = (m: Modal) => {
    setError("");
    setModal(m);
  };
  if (loading)
    return (
      <div className="app-loading">
        <span className="brand-symbol">к.</span>
        <p>Открываем пространство для занятий…</p>
      </div>
    );
  if (!data)
    return (
      <main className="auth-page">
        <div className="auth-card">
          <h1>Войдите в кабинет</h1>
          <p>{error}</p>
          <a className="btn primary" href="/signin">
            Вход для преподавателя
          </a>
          <p className="muted">
            Ученикам нужна персональная ссылка преподавателя.
          </p>
          <button className="btn" onClick={() => void refresh()}>
            Попробовать снова
          </button>
        </div>
      </main>
    );
  const isTeacher = data.role === "teacher";
  if (pupil && isTeacher)
    return (
      <main className="auth-page">
        <div className="auth-card">
          <h2>Нужна ссылка ученика</h2>
          <p>Откройте персональную ссылку из карточки ученика.</p>
          <Link href="/">Вернуться в кабинет преподавателя</Link>
        </div>
      </main>
    );
  const today = todayVN(),
    weekEnd = addDaysStr(week, 6);
  const active = data.lessons.filter((l) => !l.cancelled);
  const selected = (id: number) =>
    !studentFilter || id === Number(studentFilter);
  const filtered = active.filter((l) => selected(l.studentId));
  const paymentLessons = data.lessons.filter((l) => selected(l.studentId));
  const upcoming = filtered.filter((l) => l.date >= today).slice(0, 5);
  const pending = data.homework.filter((h) => h.status === "submitted");
  const unpaid = active.filter((l) => l.payment === "unpaid");
  const shownHomework = data.homework.filter(
    (h) =>
      selected(h.student_id) && (hwFilter === "all" || h.status === hwFilter),
  );
  const weekLessons = filtered.filter(
    (l) => l.date >= week && l.date <= weekEnd,
  );
  const weekTitle = `${date(week, { day: "numeric", month: "short" }).replace(".", "")} — ${date(weekEnd, { day: "numeric", month: "short" }).replace(".", "")}`;
  const invite = async (s: Student) => {
    await perform(async () => {
      const r = await request<{ link: string }>(`students/${s.id}/invite`);
      open({ kind: "invite", name: s.name, link: r.link });
    }, "Персональная ссылка создана");
  };
  const lessonRow = (l: Lesson, compact = false) => (
    <div className={"lesson-row " + (compact ? "compact" : "")} key={l.id}>
      <div className="lesson-time">
        <strong>{l.start}</strong>
        <span>{l.end}</span>
      </div>
      <span className={"avatar color-" + (l.studentId % 5)}>
        {initials(l.studentName)}
      </span>
      <div className="lesson-main">
        <strong>{isTeacher ? l.studentName : l.title}</strong>
        <span>
          {isTeacher ? l.title : date(l.date)}
          <i />{" "}
          {date(l.date, { weekday: "short", day: "numeric", month: "short" })}
        </span>
      </div>
      <span className={"pill " + (l.payment === "paid" ? "green" : "amber")}>
        <span className="status-dot" />
        {l.payment === "paid" ? "Оплачено" : "Не оплачено"}
      </span>
      {l.attended && <span className="pill neutral">Проведено</span>}
      <div className="row-actions">
        {l.meetingUrl && (
          <a
            className="icon-btn video-btn"
            href={l.meetingUrl}
            target="_blank"
            rel="noreferrer"
            title="Подключиться к занятию"
          >
            <Video size={18} />
          </a>
        )}
        {isTeacher && (
          <button
            className="icon-btn"
            title="Открыть занятие"
            aria-label={"Открыть занятие " + l.studentName}
            onClick={() => open({ kind: "lesson", lesson: l })}
          >
            <ArrowUpRight size={18} />
          </button>
        )}
      </div>
    </div>
  );
  const studentSelect = (name = "studentId", value?: number) => (
    <select
      name={name}
      aria-label="Ученик"
      required
      defaultValue={value || studentFilter || ""}
      onChange={(e) => {
        if (modal?.kind === "lesson") {
          const s = data.students.find((s) => s.id === Number(e.target.value));
          const price = e.currentTarget.form?.elements.namedItem("price");
          if (price instanceof HTMLInputElement)
            price.value = String(s?.rate ?? 1500);
        }
      }}
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
  );
  const studentFilterControl = (
    <select
      className="filter-select"
      aria-label="Фильтр по ученику"
      value={studentFilter}
      onChange={(e) => setStudentFilter(e.target.value)}
    >
      <option value="">Все ученики</option>
      {data.students.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
  const handleForm = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!modal) return;
    const form = e.currentTarget;
    const f = new FormData(form);
    const get = (key: string) => String(f.get(key) || "");
    if (modal.kind === "student")
      await perform(
        () =>
          request(
            "students" + (modal.student ? "/" + modal.student.id : ""),
            {
              name: get("name"),
              phone: get("phone"),
              subject: get("subject"),
              rate: Number(get("rate")),
              meetingUrl: get("meetingUrl"),
              notes: get("notes"),
            },
            modal.student ? "PATCH" : "POST",
          ),
        "Ученик сохранён",
        true,
      );
    if (modal.kind === "lesson" && (!modal.lesson || modal.editing))
      await perform(
        () =>
          request(
            modal.lesson ? `lessons/${modal.lesson.id}/move` : "lessons",
            {
              studentId: Number(get("studentId")),
              title: get("title"),
              date: get("date"),
              start: get("start"),
              end: get("end"),
              price: Number(get("price")),
              meetingUrl: get("meetingUrl"),
              repeat: Number(get("repeat") || 1),
            },
          ),
        modal.lesson ? "Занятие обновлено" : "Занятия добавлены в расписание",
        true,
      );
    if (modal.kind === "homework")
      await perform(
        async () => {
          const created = await request<{ id: number }>("homework", {
            studentId: Number(get("studentId")),
            title: get("title"),
            body: get("body"),
            due: get("due"),
            learningSetId: get("learningSetId") || null,
            exerciseId: get("exerciseId") ? Number(get("exerciseId")) : null,
            sessionId: modal.lesson?.id || null,
          });
          const file = f.get("file");
          if (file instanceof File && file.size) {
            const upload = new FormData();
            upload.set("file", file);
            try {
              await request(`homework/${created.id}/files`, upload);
            } catch (err) {
              setModal(null);
              await refresh();
              throw new Error(
                "ДЗ создано, но файл не прикреплён: " +
                  (err as Error).message +
                  " Откройте задание и добавьте файл повторно.",
              );
            }
          }
        },
        "Домашнее задание назначено",
        true,
      );
    if (modal.kind === "exercise")
      await perform(
        () =>
          request("exercises", {
            title: get("title"),
            kind: get("kind"),
            prompt: get("prompt"),
            options: get("options")
              .split("\n")
              .map((x) => x.trim())
              .filter(Boolean),
            answer:
              get("kind") === "choice"
                ? String(Number(get("answer")) - 1)
                : get("answer"),
            explanation: get("explanation"),
          }),
        "Задание добавлено в библиотеку",
        true,
      );
    if (modal.kind === "work") {
      if (isTeacher)
        await perform(
          () =>
            request(
              `homework/${modal.homework.id}`,
              { feedback: get("feedback"), status: get("status") },
              "PATCH",
            ),
          "Проверка сохранена",
          true,
        );
      else
        await perform(
          async () => {
            const r = await request<{
              correct: boolean | null;
              explanation: string;
            }>(`homework/${modal.homework.id}/submit`, {
              response: get("response"),
            });
            setNotice(
              r.correct === true
                ? "Верно! " + r.explanation
                : r.correct === false
                  ? "Пока неверно. Попробуйте ещё раз или обсудите с преподавателем."
                  : "Ответ отправлен преподавателю.",
            );
          },
          "",
          true,
        );
    }
  };
  const currentWork =
    modal?.kind === "work"
      ? data.homework.find((h) => h.id === modal.homework.id) || modal.homework
      : null;
  return (
    <div className="workspace">
      <aside className="sidebar">
        <a className="brand" href={isTeacher ? "/" : "/learn"}>
          <span className="brand-symbol">к.</span> класс
          <span className="brand-dot">/</span>
        </a>
        <div className="space-label">
          {isTeacher ? "КАБИНЕТ ПРЕПОДАВАТЕЛЯ" : "МОЙ КАБИНЕТ"}
        </div>
        <nav aria-label="Основная навигация">
          {nav
            .filter(
              (n) => n.id !== "exercises" && (isTeacher || n.id !== "students"),
            )
            .map((n) => (
              <button
                className={"nav-item " + (tab === n.id ? "active" : "")}
                key={n.id}
                onClick={() => {
                  setTab(n.id);
                  setSearch("");
                }}
              >
                <n.icon size={19} />
                {n.label}
                {n.id === "homework" && isTeacher && pending.length > 0 && (
                  <span className="nav-count">{pending.length}</span>
                )}
              </button>
            ))}
          <Link className="nav-item" href="/games">
            <Gamepad2 size={19} />
            Задания и игры
          </Link>
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <span className="mini-spark">✦</span>
            <strong>
              Маленькие шаги.
              <br />
              Большой прогресс.
            </strong>
            <p>
              Для всего, что получается
              <br />с каждой новой встречей.
            </p>
          </div>
          {isTeacher && (
            <button
              className={"nav-item " + (tab === "settings" ? "active" : "")}
              onClick={() => setTab("settings")}
            >
              <Settings2 size={19} />
              Настройки
            </button>
          )}
          <button
            className="profile"
            onClick={() =>
              void perform(async () => {
                await request("logout");
                if (isTeacher) await signOut({ callbackUrl: "/signin" });
                else location.href = "/signin";
              }, "")
            }
            title="Выйти из кабинета"
          >
            <span className="avatar purple">{initials(data.name)}</span>
            <span>
              <strong>{data.name}</strong>
              <small>{isTeacher ? "Преподаватель" : "Ученик"}</small>
            </span>
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <div className="workspace-body">
        <header className="topbar">
          <span>
            {isTeacher ? "Моё пространство" : "Пространство ученика"}
            <span className="topbar-slash">/</span>
            <strong>
              {nav.find((n) => n.id === tab)?.label || "Настройки"}
            </strong>
          </span>
          <div className="topbar-right">
            <span className="timezone">
              <span />
              Москва, UTC+3
            </span>
            <span className="avatar small purple">{initials(data.name)}</span>
          </div>
        </header>
        <main className="main">
          {activeGames.length > 0 && (
            <Link
              className="notice success"
              href={"/games?room=" + activeGames[0].id}
            >
              <Gamepad2 size={20} />
              <span>
                {isTeacher ? "Продолжить игру" : "Вас ждёт игра"}:{" "}
                {activeGames[0].state.title}
                {activeGames.length > 1
                  ? ` · ещё ${activeGames.length - 1}`
                  : ""}
              </span>
              <ArrowRight size={17} />
            </Link>
          )}
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                {tab === "overview"
                  ? date(today, {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                    })
                  : "Всё важное — рядом"}
              </span>
              <h1>
                {tab === "overview"
                  ? `${isTeacher ? "Здравствуйте" : "Привет"}, ${data.name.split(" ")[0]} ${isTeacher ? "" : "👋"}`
                  : nav.find((n) => n.id === tab)?.label || "Настройки"}
              </h1>
              <p>
                {
                  {
                    overview: "Хороший день, чтобы узнать что-то новое.",
                    schedule: "Время для занятий, планов и новых открытий.",
                    students: "За каждым именем — свой путь к результату.",
                    homework: "Продолжаем учиться между встречами.",
                    exercises: "Ваша копилка идей для интересных занятий.",
                    payments: "Все занятия и оплаты — на виду.",
                    settings: "Ваше пространство, ваши настройки.",
                  }[tab]
                }
              </p>
            </div>
            {isTeacher && ["overview", "schedule"].includes(tab) && (
              <button
                className="btn primary"
                onClick={() => open({ kind: "lesson" })}
              >
                <Plus size={18} />
                Новое занятие
              </button>
            )}
            {isTeacher && tab === "students" && (
              <button
                className="btn primary"
                onClick={() => open({ kind: "student" })}
              >
                <Plus size={18} />
                Добавить ученика
              </button>
            )}
            {isTeacher && tab === "homework" && (
              <button
                className="btn primary"
                onClick={() => open({ kind: "homework" })}
              >
                <Plus size={18} />
                Назначить ДЗ
              </button>
            )}
            {isTeacher && tab === "exercises" && (
              <button
                className="btn primary"
                onClick={() => open({ kind: "exercise" })}
              >
                <Plus size={18} />
                Создать задание
              </button>
            )}
          </div>
          {error && (
            <div role="alert" className="notice error">
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
              <CheckCircle2 size={18} />
              {notice}
            </div>
          )}
          {tab === "overview" && (
            <>
              <div className="stats">
                <div className="stat">
                  <span className="stat-icon lavender">
                    <CalendarDays size={21} />
                  </span>
                  <span>Занятий на этой неделе</span>
                  <strong>
                    {
                      active.filter(
                        (l) =>
                          l.date >= weekStartStr(today) &&
                          l.date <= addDaysStr(weekStartStr(today), 6),
                      ).length
                    }
                    <small>время для роста</small>
                  </strong>
                </div>
                <div className="stat">
                  <span className="stat-icon mint">
                    <Users size={21} />
                  </span>
                  <span>{isTeacher ? "Учеников" : "Предстоящих занятий"}</span>
                  <strong>
                    {isTeacher
                      ? data.students.length
                      : active.filter((l) => l.date >= today).length}
                    <small>
                      {isTeacher ? "учимся вместе" : "в вашем расписании"}
                    </small>
                  </strong>
                </div>
                <div className="stat">
                  <span className="stat-icon peach">
                    <BookOpen size={21} />
                  </span>
                  <span>
                    {isTeacher ? "Ждут проверки" : "Домашних заданий"}
                  </span>
                  <strong>
                    {isTeacher
                      ? pending.length
                      : data.homework.filter((h) => h.status === "assigned")
                          .length}
                    <small>
                      {isTeacher ? "домашние задания" : "ждут вашего ответа"}
                    </small>
                  </strong>
                </div>
                <div className="stat">
                  <span className="stat-icon butter">
                    <CreditCard size={21} />
                  </span>
                  <span>Ожидают оплаты</span>
                  <strong>
                    {money(unpaid.reduce((a, l) => a + Number(l.price), 0))}
                    <small>{unpaid.length} занятий</small>
                  </strong>
                </div>
              </div>
              <div className="overview-grid">
                <section className="panel upcoming-panel">
                  <div className="panel-head">
                    <div>
                      <h2>
                        Ближайшие занятия{" "}
                        <span className="count">{upcoming.length}</span>
                      </h2>
                      <p>Встречи, которые уже в планах</p>
                    </div>
                    <button
                      className="text-btn"
                      onClick={() => setTab("schedule")}
                    >
                      Всё расписание
                      <ArrowRight size={16} />
                    </button>
                  </div>
                  {upcoming.length ? (
                    upcoming.map((l) => lessonRow(l, true))
                  ) : (
                    <Empty
                      icon={CalendarDays}
                      title="Здесь начнётся ваше расписание"
                      action={
                        isTeacher ? (
                          <button
                            className="btn"
                            onClick={() => open({ kind: "lesson" })}
                          >
                            <Plus size={16} />
                            Запланировать занятие
                          </button>
                        ) : undefined
                      }
                    >
                      {isTeacher
                        ? "Добавьте ученика и выберите время первой встречи."
                        : "Преподаватель скоро добавит занятия."}
                    </Empty>
                  )}
                  <div className="panel-foot">
                    <span className="status-dot purple-dot" />
                    Все занятия по московскому времени
                  </div>
                </section>
                <section className="inspiration">
                  <div className="inspiration-top">
                    <span className="tiny-label">УЧИТЬСЯ С ИНТЕРЕСОМ</span>
                    <Sparkles size={21} />
                  </div>
                  <h2>
                    От «не понимаю»
                    <br />
                    до «я умею».
                  </h2>
                  <p>
                    {isTeacher
                      ? "Добавьте немного практики: готовые задания уже в библиотеке."
                      : "Пробуйте, ошибайтесь и задавайте вопросы. Каждый шаг имеет значение."}
                  </p>
                  <div className="abstract-books" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                    <i>✦</i>
                    <b>✧</b>
                  </div>
                  <button
                    className="btn"
                    onClick={() =>
                      isTeacher ? location.assign("/games") : setTab("homework")
                    }
                  >
                    {isTeacher ? "Открыть библиотеку" : "Мои задания"}
                    <ArrowUpRight size={17} />
                  </button>
                </section>
                <section className="panel overview-homework">
                  <div className="panel-head">
                    <div>
                      <h2>{isTeacher ? "На проверке" : "Домашняя практика"}</h2>
                      <p>
                        {isTeacher
                          ? "Обратная связь помогает двигаться дальше"
                          : "Немного практики до следующей встречи"}
                      </p>
                    </div>
                    <button
                      className="text-btn"
                      onClick={() => setTab("homework")}
                    >
                      Все задания
                      <ArrowRight size={16} />
                    </button>
                  </div>
                  {(isTeacher
                    ? pending
                    : data.homework.filter((h) => h.status !== "reviewed")
                  )
                    .slice(0, 3)
                    .map((h) => (
                      <button
                        key={h.id}
                        className="work-preview"
                        onClick={() => open({ kind: "work", homework: h })}
                      >
                        <span className="file-icon">
                          <FileText size={20} />
                        </span>
                        <span>
                          <strong>{h.title}</strong>
                          <small>
                            {isTeacher
                              ? h.studentName
                              : "До " + date(h.due_date)}
                          </small>
                        </span>
                        <span
                          className={
                            "pill " +
                            (h.status === "submitted" ? "lavender" : "neutral")
                          }
                        >
                          {statusLabel[h.status]}
                        </span>
                        <ChevronRight size={16} />
                      </button>
                    ))}
                  {!(
                    isTeacher
                      ? pending
                      : data.homework.filter((h) => h.status !== "reviewed")
                  ).length && (
                    <div className="calm-empty">
                      <CheckCircle2 size={24} />
                      <span>
                        {isTeacher
                          ? "Всё проверено. Можно выдохнуть."
                          : "Все задания выполнены. Отличная работа!"}
                      </span>
                    </div>
                  )}
                </section>
              </div>
            </>
          )}
          {tab === "schedule" && (
            <section className="panel calendar-panel">
              <div className="calendar-toolbar">
                <div className="week-navigation">
                  <button
                    className="icon-btn"
                    aria-label="Предыдущая неделя"
                    onClick={() => setWeek(addDaysStr(week, -7))}
                  >
                    <ChevronLeft size={20} />
                  </button>
                  <h2>{weekTitle}</h2>
                  <button
                    className="icon-btn"
                    aria-label="Следующая неделя"
                    onClick={() => setWeek(addDaysStr(week, 7))}
                  >
                    <ChevronRight size={20} />
                  </button>
                  <button
                    className="btn subtle"
                    onClick={() => setWeek(weekStartStr(today))}
                  >
                    Сегодня
                  </button>
                </div>
                {isTeacher && studentFilterControl}
              </div>
              <div className="calendar-grid">
                {Array.from({ length: 7 }, (_, i) => {
                  const d = addDaysStr(week, i);
                  return (
                    <div
                      className={"calendar-day " + (d === today ? "today" : "")}
                      key={d}
                    >
                      <div className="day-label">
                        <span>{date(d, { weekday: "short" })}</span>
                        <strong>{date(d, { day: "numeric" })}</strong>
                      </div>
                      <div className="day-lessons">
                        {weekLessons
                          .filter((l) => l.date === d)
                          .map((l) => (
                            <button
                              key={l.id}
                              className={
                                "calendar-event color-" + (l.studentId % 5)
                              }
                              onClick={() =>
                                isTeacher
                                  ? open({ kind: "lesson", lesson: l })
                                  : l.meetingUrl
                                    ? window.open(
                                        l.meetingUrl,
                                        "_blank",
                                        "noopener,noreferrer",
                                      )
                                    : setNotice(
                                        l.title + " · " + l.start + "–" + l.end,
                                      )
                              }
                            >
                              <span>
                                {l.start} — {l.end}
                              </span>
                              <strong>
                                {isTeacher ? l.studentName : l.title}
                              </strong>
                              <small>{l.title}</small>
                              <span className={"event-payment " + l.payment}>
                                {l.payment === "paid" ? (
                                  <Check size={12} />
                                ) : (
                                  <Clock3 size={12} />
                                )}{" "}
                                {l.payment === "paid"
                                  ? "Оплачено"
                                  : "Не оплачено"}
                              </span>
                            </button>
                          ))}
                        {!weekLessons.some((l) => l.date === d) && (
                          <span className="day-free">—</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {!weekLessons.length && (
                <div className="calendar-empty">
                  На этой неделе пока нет занятий. Выберите другую неделю
                  {isTeacher ? " или добавьте встречу" : ""}.
                </div>
              )}
              <div className="panel-foot">
                <span className="status-dot purple-dot" />
                Москва, UTC+3 <span className="legend-spacer" />
                <span className="status-dot green-dot" />
                Оплачено
                <span className="status-dot amber-dot" />
                Ожидает оплаты
              </div>
            </section>
          )}
          {tab === "students" && isTeacher && (
            <>
              <div className="toolbar">
                <div className="search-field">
                  <Search size={18} />
                  <input
                    placeholder="Найти по имени или телефону"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    aria-label="Поиск учеников"
                  />
                </div>
                <span className="muted">Всего: {data.students.length}</span>
              </div>
              <div className="student-grid">
                {data.students
                  .filter((s) =>
                    (s.name + " " + s.phone)
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  )
                  .map((s) => (
                    <article className="panel student-card" key={s.id}>
                      <div className="student-card-top">
                        <span className={"avatar large color-" + (s.id % 5)}>
                          {initials(s.name)}
                        </span>
                        <span className="pill green">Занимаемся</span>
                      </div>
                      <h2>{s.name}</h2>
                      <p>{s.subject}</p>
                      <div className="student-meta">
                        <span>
                          <CalendarDays size={15} />
                          {
                            active.filter(
                              (l) => l.studentId === s.id && l.date >= today,
                            ).length
                          }{" "}
                          предстоящих занятий
                        </span>
                        <span>
                          <CreditCard size={15} />
                          {money(s.rate)} / занятие
                        </span>
                        {s.phone && <span>{s.phone}</span>}
                      </div>
                      <div className="student-card-actions">
                        <Link
                          className="icon-btn"
                          title="Игры и результаты"
                          aria-label={"Игры " + s.name}
                          href={"/games?student=" + s.id}
                        >
                          <Gamepad2 size={18} />
                        </Link>
                        <button
                          className="btn subtle"
                          onClick={() => open({ kind: "student", student: s })}
                        >
                          Карточка
                          <ArrowUpRight size={15} />
                        </button>
                        <button
                          className="icon-btn"
                          title={
                            s.invited
                              ? "Обновить ссылку кабинета"
                              : "Создать ссылку кабинета"
                          }
                          aria-label={"Ссылка для " + s.name}
                          disabled={busy}
                          onClick={() => void invite(s)}
                        >
                          <Link2 size={18} />
                        </button>
                        <button
                          className="icon-btn"
                          title="Расписание ученика"
                          aria-label={"Расписание " + s.name}
                          onClick={() => {
                            setStudentFilter(String(s.id));
                            setTab("schedule");
                          }}
                        >
                          <CalendarDays size={18} />
                        </button>
                      </div>
                    </article>
                  ))}
              </div>
              {!data.students.length && (
                <section className="panel">
                  <Empty
                    icon={Users}
                    title="Давайте знакомиться"
                    action={
                      <button
                        className="btn primary"
                        onClick={() => open({ kind: "student" })}
                      >
                        <Plus size={16} />
                        Добавить первого ученика
                      </button>
                    }
                  >
                    Создайте карточку ученика, а затем отправьте ему ссылку на
                    личный кабинет.
                  </Empty>
                </section>
              )}
            </>
          )}
          {tab === "homework" && (
            <>
              <div className="toolbar">
                <div className="segmented">
                  {(["all", "assigned", "submitted", "reviewed"] as const).map(
                    (s) => (
                      <button
                        key={s}
                        className={hwFilter === s ? "selected" : ""}
                        onClick={() => setHwFilter(s)}
                      >
                        {s === "all" ? "Все" : statusLabel[s]}
                      </button>
                    ),
                  )}
                </div>
                {isTeacher && studentFilterControl}
              </div>
              <div className="homework-grid">
                {shownHomework.map((h) => (
                  <article className="panel homework-card" key={h.id}>
                    <div className="card-topline">
                      <span
                        className={
                          "pill " +
                          (h.status === "reviewed"
                            ? "green"
                            : h.status === "submitted"
                              ? "lavender"
                              : "neutral")
                        }
                      >
                        {statusLabel[h.status]}
                      </span>
                      {h.due_date < today && h.status === "assigned" && (
                        <span className="overdue">Срок прошёл</span>
                      )}
                    </div>
                    <h2>{h.title}</h2>
                    <p className="clamp">
                      {h.body || h.prompt || "Практика по пройденной теме"}
                    </p>
                    {h.exercise_id && (
                      <span className="exercise-tag">
                        <Sparkles size={14} />
                        {kindLabel[h.kind!]}
                      </span>
                    )}
                    <div className="homework-meta">
                      <span>{isTeacher ? h.studentName : "Моя практика"}</span>
                      <span>
                        <Clock3 size={14} />
                        До {date(h.due_date)}
                      </span>
                    </div>
                    <button
                      className="btn subtle wide"
                      onClick={() => open({ kind: "work", homework: h })}
                    >
                      {isTeacher
                        ? h.status === "submitted"
                          ? "Проверить работу"
                          : "Открыть задание"
                        : h.status === "assigned"
                          ? "Приступить"
                          : "Посмотреть ответ"}
                      <ArrowRight size={16} />
                    </button>
                  </article>
                ))}
              </div>
              {!shownHomework.length && (
                <section className="panel">
                  <Empty title="Пока без домашних заданий">
                    {isTeacher
                      ? "Назначьте практику: текст, файлы или интерактивное задание из библиотеки."
                      : "Здесь появятся задания и материалы от преподавателя."}
                  </Empty>
                </section>
              )}
            </>
          )}
          {tab === "exercises" && isTeacher && (
            <>
              <div className="library-banner">
                <div>
                  <span className="eyebrow">СОБИРАЙТЕ СВОЮ КОЛЛЕКЦИЮ</span>
                  <h2>Один шаблон — много открытий</h2>
                  <p>
                    Готовые задания для старта. Копируйте, меняйте содержание и
                    назначайте ученикам.
                  </p>
                </div>
                <Sparkles size={46} />
              </div>
              <div className="toolbar">
                <div className="search-field">
                  <Search size={18} />
                  <input
                    placeholder="Найти задание"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    aria-label="Поиск заданий"
                  />
                </div>
                <span className="muted">
                  {data.exercises.length} заданий · 3 типа шаблонов
                </span>
              </div>
              <div className="exercise-grid">
                {data.exercises
                  .filter((e) =>
                    (e.title + " " + e.prompt)
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  )
                  .map((e) => (
                    <article className="panel exercise-card" key={e.id}>
                      <div className="card-topline">
                        <span
                          className={
                            "exercise-type " +
                            (e.kind === "choice"
                              ? "lavender"
                              : e.kind === "short"
                                ? "mint"
                                : "peach")
                          }
                        >
                          {e.kind === "choice" ? (
                            <CheckCircle2 size={21} />
                          ) : e.kind === "short" ? (
                            <FileText size={21} />
                          ) : (
                            <BookOpen size={21} />
                          )}
                        </span>
                        <span className="tiny-label">
                          {e.owner_id ? "МОЁ ЗАДАНИЕ" : "СТАРТОВАЯ КОЛЛЕКЦИЯ"}
                        </span>
                      </div>
                      <h2>{e.title}</h2>
                      <p className="clamp">{e.prompt}</p>
                      <span className="exercise-tag">
                        {kindLabel[e.kind]}
                        {e.kind !== "text"
                          ? " · Автопроверка"
                          : " · Проверяет преподаватель"}
                      </span>
                      <div className="exercise-actions">
                        <button
                          className="btn subtle"
                          onClick={() =>
                            open({ kind: "homework", exercise: e })
                          }
                        >
                          Назначить
                          <ArrowUpRight size={15} />
                        </button>
                        <button
                          className="text-btn"
                          onClick={() =>
                            open({ kind: "exercise", exercise: e })
                          }
                        >
                          Копировать
                        </button>
                      </div>
                    </article>
                  ))}
              </div>
              <a
                className="resource-link"
                href="https://sql-learn.baibakovkir.space"
                target="_blank"
                rel="noreferrer"
              >
                <span className="stat-icon lavender">
                  <GraduationCap size={23} />
                </span>
                <span>
                  <strong>Практика SQL</strong>
                  <small>Ваш отдельный тренажёр с учебником и заданиями</small>
                </span>
                <ExternalLink size={18} />
              </a>
            </>
          )}
          {tab === "payments" && (
            <>
              <div className="payment-summary">
                <div>
                  <span>Оплачено за всё время</span>
                  <strong>
                    {money(
                      data.lessons
                        .filter((l) => l.payment === "paid")
                        .reduce((a, l) => a + Number(l.price), 0),
                    )}
                  </strong>
                </div>
                <div>
                  <span>Ожидается за все занятия</span>
                  <strong>
                    {money(unpaid.reduce((a, l) => a + Number(l.price), 0))}
                  </strong>
                </div>
                <div>
                  <span>Долг за прошедшие занятия</span>
                  <strong>
                    {money(
                      unpaid
                        .filter((l) => l.date < today)
                        .reduce((a, l) => a + Number(l.price), 0),
                    )}
                  </strong>
                </div>
              </div>
              <section className="panel">
                <div className="toolbar panel-toolbar">
                  <div className="segmented">
                    {[
                      ["all", "Все"],
                      ["paid", "Оплачено"],
                      ["unpaid", "Не оплачено"],
                    ].map(([id, label]) => (
                      <button
                        key={id}
                        className={payFilter === id ? "selected" : ""}
                        onClick={() => setPayFilter(id)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {isTeacher && studentFilterControl}
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Занятие</th>
                        <th>Дата и время</th>
                        <th>Сумма</th>
                        <th>Статус</th>
                        {isTeacher && <th />}
                      </tr>
                    </thead>
                    <tbody>
                      {paymentLessons
                        .filter(
                          (l) => payFilter === "all" || l.payment === payFilter,
                        )
                        .slice()
                        .reverse()
                        .map((l) => (
                          <tr key={l.id}>
                            <td>
                              <strong>{l.studentName}</strong>
                              <small>
                                {l.title}
                                {l.cancelled ? " · Отменено" : ""}
                              </small>
                            </td>
                            <td>
                              {date(l.date)}
                              <small>
                                {l.start}–{l.end}
                              </small>
                            </td>
                            <td className="money">{money(l.price)}</td>
                            <td>
                              <span
                                className={
                                  "pill " +
                                  (l.payment === "paid" ? "green" : "amber")
                                }
                              >
                                {l.payment === "paid"
                                  ? "Оплачено"
                                  : "Не оплачено"}
                              </span>
                            </td>
                            {isTeacher && (
                              <td>
                                <button
                                  className="text-btn"
                                  disabled={busy}
                                  onClick={() =>
                                    void perform(
                                      () =>
                                        request(
                                          `lessons/${l.id}`,
                                          {
                                            payment:
                                              l.payment === "paid"
                                                ? "unpaid"
                                                : "paid",
                                          },
                                          "PATCH",
                                        ),
                                      "Статус оплаты обновлён",
                                    )
                                  }
                                >
                                  {l.payment === "paid"
                                    ? "Отменить отметку"
                                    : "Отметить оплату"}
                                </button>
                              </td>
                            )}
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                {!filtered.length && (
                  <Empty icon={CreditCard} title="Оплаты появятся здесь">
                    Стоимость и статус оплаты привязаны к каждому занятию.
                  </Empty>
                )}
                <div className="panel-foot">
                  Учёт оплат вручную. Отметка «Оплачено» не списывает деньги.
                </div>
              </section>
            </>
          )}
          {tab === "settings" && isTeacher && (
            <section className="panel settings-panel">
              <h2>Безопасность кабинета</h2>
              <p className="muted">
                Измените пароль для входа. Минимум 12 символов.
              </p>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const form = e.currentTarget,
                    f = new FormData(form);
                  if (f.get("password") !== f.get("confirm")) {
                    setError("Новые пароли не совпадают.");
                    return;
                  }
                  if (
                    await perform(
                      () =>
                        request("password", {
                          current: f.get("current"),
                          password: f.get("password"),
                        }),
                      "Пароль изменён",
                    )
                  )
                    await signOut({ callbackUrl: "/signin" });
                }}
              >
                <Field label="Текущий пароль">
                  <input
                    name="current"
                    type="password"
                    autoComplete="current-password"
                    required
                  />
                </Field>
                <Field label="Новый пароль">
                  <input
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={72}
                    required
                  />
                </Field>
                <Field label="Повторите новый пароль">
                  <input
                    name="confirm"
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={72}
                    required
                  />
                </Field>
                <button className="btn primary" disabled={busy}>
                  Изменить пароль
                </button>
              </form>
              <hr />
              <h3>Как дать доступ ученику</h3>
              <p>
                Откройте «Ученики» и нажмите на значок ссылки. Отправьте ссылку
                ученику: она открывает только его личный кабинет. Создание новой
                ссылки отзывает предыдущую и выход из старых сеансов ученика.
              </p>
              <h3>Время и валюта</h3>
              <p>
                Расписание: Москва (UTC+3). Стоимость занятий: российские рубли.
              </p>
              <a
                className="text-btn"
                href="https://sql-learn.baibakovkir.space"
                target="_blank"
                rel="noreferrer"
              >
                Открыть SQL-тренажёр
                <ExternalLink size={15} />
              </a>
            </section>
          )}

          <footer className="app-footer">
            <span>класс / пространство для занятий</span>
            <span>Пусть всё получится ✦</span>
          </footer>
        </main>
      </div>
      {modal && (
        <Dialog
          title={
            modal.kind === "student"
              ? modal.student
                ? "Карточка ученика"
                : "Новый ученик"
              : modal.kind === "lesson"
                ? modal.lesson
                  ? "Занятие"
                  : "Новое занятие"
                : modal.kind === "homework"
                  ? "Назначить домашнее задание"
                  : modal.kind === "exercise"
                    ? "Создать задание"
                    : modal.kind === "invite"
                      ? "Личный кабинет ученика"
                      : modal.kind === "archive"
                        ? "Архивировать ученика?"
                        : "Домашнее задание"
          }
          onClose={() => setModal(null)}
        >
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          {modal.kind === "invite" ? (
            <div className="modal-content">
              <p>
                Отправьте ссылку ученику <strong>{modal.name}</strong>. Она даёт
                доступ только к его занятиям, ДЗ и оплатам.
              </p>
              <p className="muted">
                Новая ссылка уже заменила предыдущую. Скопируйте её перед
                закрытием окна.
              </p>
              <input
                aria-label="Персональная ссылка"
                readOnly
                value={modal.link}
                onFocus={(e) => e.target.select()}
              />
              <div className="form-actions">
                <button
                  className="btn primary"
                  onClick={() => {
                    navigator.clipboard
                      .writeText(modal.link)
                      .then(() => setNotice("Ссылка скопирована"))
                      .catch(() =>
                        setError("Выделите ссылку и скопируйте вручную."),
                      );
                  }}
                >
                  <Link2 size={16} />
                  Скопировать
                </button>
                <a
                  className="btn"
                  href={modal.link}
                  target="_blank"
                  rel="noreferrer"
                >
                  Открыть
                  <ExternalLink size={16} />
                </a>
              </div>
            </div>
          ) : modal.kind === "archive" ? (
            <div className="modal-content">
              <p>
                Ученик <strong>{modal.student.name}</strong> исчезнет из
                активного списка. Его персональная ссылка перестанет работать.
                История останется в базе.
              </p>
              <div className="form-actions">
                <button className="btn" onClick={() => setModal(null)}>
                  Назад
                </button>
                <button
                  className="btn danger"
                  disabled={busy}
                  onClick={() =>
                    void perform(
                      () =>
                        request(`students/${modal.student.id}`, {}, "DELETE"),
                      "Ученик перенесён в архив",
                      true,
                    )
                  }
                >
                  Архивировать
                </button>
              </div>
            </div>
          ) : modal.kind === "lesson" && modal.lesson && !modal.editing ? (
            <div className="modal-content">
              <div className="lesson-detail-heading">
                <span
                  className={
                    "avatar large color-" + (modal.lesson.studentId % 5)
                  }
                >
                  {initials(modal.lesson.studentName)}
                </span>
                <div>
                  <h3>{modal.lesson.studentName}</h3>
                  <p>{modal.lesson.title}</p>
                </div>
              </div>
              <div className="lesson-details">
                <span>
                  <CalendarDays size={17} />
                  {date(modal.lesson.date, {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </span>
                <span>
                  <Clock3 size={17} />
                  {modal.lesson.start}–{modal.lesson.end} · Москва
                </span>
                <span>
                  <CreditCard size={17} />
                  {money(modal.lesson.price)} ·{" "}
                  {modal.lesson.payment === "paid" ? "Оплачено" : "Не оплачено"}
                </span>
              </div>
              {modal.lesson.meetingUrl && (
                <a
                  className="btn primary wide"
                  href={modal.lesson.meetingUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Video size={17} />
                  Подключиться к занятию
                </a>
              )}
              <div className="detail-actions">
                <button
                  className="btn"
                  onClick={() =>
                    open({
                      kind: "lesson",
                      lesson: modal.lesson,
                      editing: true,
                    })
                  }
                >
                  <CalendarDays size={16} />
                  Изменить время и тему
                </button>
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => {
                    const l = modal.lesson!;
                    void perform(
                      () =>
                        request(
                          `lessons/${l.id}`,
                          { payment: l.payment === "paid" ? "unpaid" : "paid" },
                          "PATCH",
                        ),
                      "Статус оплаты обновлён",
                      true,
                    );
                  }}
                >
                  <CreditCard size={16} />
                  {modal.lesson.payment === "paid"
                    ? "Отменить отметку оплаты"
                    : "Отметить оплату"}
                </button>
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => {
                    const l = modal.lesson!;
                    void perform(
                      () =>
                        request(
                          `lessons/${l.id}`,
                          { attended: !l.attended },
                          "PATCH",
                        ),
                      "Статус занятия обновлён",
                      true,
                    );
                  }}
                >
                  <Check size={16} />
                  {modal.lesson.attended
                    ? "Снять отметку проведения"
                    : "Отметить проведённым"}
                </button>
                <button
                  className="btn"
                  onClick={() =>
                    open({ kind: "homework", lesson: modal.lesson })
                  }
                >
                  <BookOpen size={16} />
                  Назначить домашнее задание
                </button>
                <Link
                  className="btn"
                  href={`/games?student=${modal.lesson.studentId}&lesson=${modal.lesson.id}`}
                >
                  <Gamepad2 size={16} />
                  Запустить игру по этому занятию
                </Link>
                <button
                  className="btn subtle"
                  onClick={() =>
                    void perform(
                      () =>
                        request(
                          `lessons/${modal.lesson!.id}`,
                          { cancelled: true },
                          "PATCH",
                        ),
                      "Занятие отменено",
                      true,
                    )
                  }
                  disabled={busy}
                >
                  Отменить занятие
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleForm} className="modal-content">
              {modal.kind === "student" && (
                <>
                  <div className="form-two">
                    <Field label="Имя ученика">
                      <input
                        name="name"
                        defaultValue={modal.student?.name}
                        required
                        maxLength={200}
                        placeholder="Имя и фамилия"
                      />
                    </Field>
                    <Field label="Телефон / контакт">
                      <input
                        name="phone"
                        defaultValue={modal.student?.phone}
                        maxLength={100}
                        placeholder="+7… или @username"
                      />
                    </Field>
                  </div>
                  <Field label="Предмет">
                    <input
                      name="subject"
                      defaultValue={
                        modal.student?.subject || "Программирование"
                      }
                      required
                      maxLength={200}
                    />
                  </Field>
                  <Field label="Стоимость занятия, ₽">
                    <input
                      type="number"
                      name="rate"
                      min={0}
                      max={1000000}
                      defaultValue={modal.student?.rate ?? 1500}
                      required
                    />
                  </Field>
                  <Field label="Ссылка для видеосвязи">
                    <input
                      name="meetingUrl"
                      type="url"
                      defaultValue={modal.student?.meetingUrl}
                      placeholder="https://meet.google.com/…"
                    />
                  </Field>
                  <Field label="Личные заметки · видны только вам">
                    <textarea
                      name="notes"
                      defaultValue={modal.student?.notes}
                      maxLength={10000}
                      rows={3}
                    />
                  </Field>
                  {modal.student && (
                    <div className="student-modal-tools">
                      <button
                        type="button"
                        className="text-btn"
                        disabled={busy}
                        onClick={() => void invite(modal.student!)}
                      >
                        <Link2 size={16} />
                        {modal.student.invited
                          ? "Создать новую ссылку кабинета"
                          : "Создать ссылку кабинета"}
                      </button>
                      <button
                        type="button"
                        className="text-btn text-danger"
                        onClick={() =>
                          open({ kind: "archive", student: modal.student! })
                        }
                      >
                        В архив
                      </button>
                    </div>
                  )}
                </>
              )}
              {modal.kind === "lesson" && (!modal.lesson || modal.editing) && (
                <>
                  <Field label="Ученик">
                    {modal.lesson ? (
                      <>
                        <input readOnly value={modal.lesson.studentName} />
                        <input
                          type="hidden"
                          name="studentId"
                          value={modal.lesson.studentId}
                        />
                      </>
                    ) : (
                      studentSelect()
                    )}
                  </Field>
                  <Field label="Тема занятия">
                    <input
                      name="title"
                      required
                      maxLength={200}
                      placeholder="Например, основы SQL"
                      defaultValue={modal.lesson?.title}
                    />
                  </Field>
                  <Field label="Дата">
                    <input
                      type="date"
                      name="date"
                      required
                      defaultValue={modal.lesson?.date || today}
                    />
                  </Field>
                  <div className="form-two">
                    <Field label="Начало · Москва">
                      <input
                        type="time"
                        name="start"
                        defaultValue={modal.lesson?.start || "16:00"}
                        required
                      />
                    </Field>
                    <Field label="Конец · Москва">
                      <input
                        type="time"
                        name="end"
                        defaultValue={modal.lesson?.end || "17:00"}
                        required
                      />
                    </Field>
                  </div>
                  <div className="form-two">
                    <Field label="Стоимость занятия, ₽">
                      <input
                        name="price"
                        type="number"
                        min={0}
                        max={1000000}
                        defaultValue={
                          modal.lesson?.price ??
                          data.students.find(
                            (s) => s.id === Number(studentFilter),
                          )?.rate ??
                          1500
                        }
                        required
                      />
                    </Field>
                    <Field label="Повторять еженедельно">
                      <select
                        name="repeat"
                        disabled={!!modal.lesson}
                        defaultValue="1"
                      >
                        <option value="1">Не повторять</option>
                        {[2, 4, 8, 12, 24].map((n) => (
                          <option key={n} value={n}>
                            {n} недель
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <Field label="Ссылка для видеосвязи">
                    <input
                      type="url"
                      name="meetingUrl"
                      defaultValue={modal.lesson?.meetingUrl}
                      placeholder="Оставьте пустой — возьмём из карточки ученика"
                    />
                  </Field>
                  <p className="muted small-text">
                    При повторении все занятия создаются сразу. Пересечения с
                    другими встречами проверяются автоматически.
                  </p>
                </>
              )}
              {modal.kind === "homework" && (
                <>
                  <Field label="Ученик">
                    {studentSelect("studentId", modal.lesson?.studentId)}
                  </Field>
                  <Field label="Название">
                    <input
                      name="title"
                      required
                      maxLength={200}
                      defaultValue={modal.exercise?.title}
                      placeholder="Что практикуем?"
                    />
                  </Field>
                  <Field label="Описание и ссылки">
                    <textarea
                      name="body"
                      rows={4}
                      maxLength={20000}
                      placeholder="Что сделать, на что обратить внимание, полезные ссылки…"
                    />
                  </Field>
                  <Field label="Срок сдачи">
                    <input
                      type="date"
                      name="due"
                      defaultValue={addDaysStr(today, 7)}
                      required
                    />
                  </Field>
                  <Field label="Набор из общей библиотеки · необязательно">
                    <select name="learningSetId" defaultValue="">
                      <option value="">Только текст и материалы</option>
                      {librarySets.map((set) => (
                        <option key={set.id} value={set.id}>
                          {set.title} · {set.course}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <p className="muted small-text">
                    Отдельные задания можно выбрать через кнопку «В ДЗ» в общей
                    библиотеке.
                  </p>
                  <Field label="Прикрепить материал · до 20 МБ">
                    <input type="file" name="file" />
                  </Field>
                  <p className="muted small-text">
                    Другие файлы можно добавить после создания задания.
                  </p>
                </>
              )}
              {modal.kind === "exercise" && (
                <ExerciseFields exercise={modal.exercise} />
              )}
              {modal.kind === "work" && currentWork && (
                <>
                  <div className="card-topline">
                    <span
                      className={
                        "pill " +
                        (currentWork.status === "reviewed"
                          ? "green"
                          : "lavender")
                      }
                    >
                      {statusLabel[currentWork.status]}
                    </span>
                    <span className="muted">
                      До {date(currentWork.due_date)}
                    </span>
                  </div>
                  <h3 className="work-title">{currentWork.title}</h3>
                  {currentWork.learning_set_id && (
                    <Link
                      className="btn primary wide"
                      href={"/practice/" + currentWork.id}
                    >
                      {isTeacher
                        ? "Посмотреть ответы ученика"
                        : "Выполнить задания"}{" "}
                      · {currentWork.learning_count} заданий
                      <ArrowRight size={16} />
                    </Link>
                  )}
                  {isTeacher && (
                    <p className="muted">{currentWork.studentName}</p>
                  )}
                  <div className="prose-text">
                    <LinkText text={currentWork.body} />
                  </div>
                  {currentWork.exercise_id && (
                    <div className="exercise-prompt">
                      <span className="exercise-tag">
                        <Sparkles size={14} />
                        {kindLabel[currentWork.kind!]}
                      </span>
                      <p>{currentWork.prompt}</p>
                      {isTeacher &&
                        currentWork.options?.map((o, i) => (
                          <p key={i}>
                            {i + 1}. {o}
                          </p>
                        ))}
                    </div>
                  )}
                  <div className="attachments">
                    {data.files
                      .filter((f) => f.homework_id === currentWork.id)
                      .map((f) => (
                        <a
                          key={f.id}
                          className="attachment"
                          href={"/api/classroom/files/" + f.id}
                        >
                          <FileText size={19} />
                          <span>
                            <strong>{f.name}</strong>
                            <small>
                              {f.student_upload ? "Ответ ученика" : "Материал"}{" "}
                              · {(f.size / 1024).toFixed(0)} КБ
                            </small>
                          </span>
                          <ArrowDownToLine size={16} />
                        </a>
                      ))}
                  </div>
                  <label className="upload-control">
                    <Plus size={16} />
                    Прикрепить файл
                    <input
                      type="file"
                      disabled={busy}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          if (file.size > 20 * 1024 * 1024) {
                            setError("Максимальный размер файла — 20 МБ.");
                            return;
                          }
                          const form = new FormData();
                          form.set("file", file);
                          void perform(
                            () =>
                              request(`homework/${currentWork.id}/files`, form),
                            "Файл прикреплён",
                          );
                        }
                        e.target.value = "";
                      }}
                    />
                  </label>
                  {currentWork.submission && (
                    <div className="submission">
                      <strong>Ответ ученика</strong>
                      <p>
                        {currentWork.kind === "choice"
                          ? currentWork.options?.[
                              Number(currentWork.submission)
                            ] || currentWork.submission
                          : currentWork.submission}
                      </p>
                    </div>
                  )}
                  {data.attempts.some(
                    (t) => t.homework_id === currentWork.id,
                  ) && (
                    <div className="attempt-history">
                      <strong>Попытки</strong>
                      {data.attempts
                        .filter((t) => t.homework_id === currentWork.id)
                        .slice(0, 5)
                        .map((t) => (
                          <div key={t.id}>
                            <span>
                              {currentWork.kind === "choice"
                                ? currentWork.options?.[Number(t.response)] ||
                                  t.response
                                : t.response}
                            </span>
                            <span
                              className={
                                "pill " +
                                (t.correct === true
                                  ? "green"
                                  : t.correct === false
                                    ? "amber"
                                    : "neutral")
                              }
                            >
                              {t.correct === true
                                ? "Верно"
                                : t.correct === false
                                  ? "Неверно"
                                  : "Ручная проверка"}
                            </span>
                          </div>
                        ))}
                    </div>
                  )}
                  {currentWork.feedback && (
                    <div className="feedback">
                      <strong>Комментарий преподавателя</strong>
                      <p>{currentWork.feedback}</p>
                    </div>
                  )}
                  {isTeacher ? (
                    <>
                      <Field label="Обратная связь">
                        <textarea
                          name="feedback"
                          rows={4}
                          maxLength={10000}
                          defaultValue={currentWork.feedback}
                          placeholder="Что получилось и над чем ещё поработать?"
                        />
                      </Field>
                      <Field label="Результат проверки">
                        <select name="status" defaultValue="reviewed">
                          <option value="reviewed">Проверено</option>
                          <option value="assigned">Вернуть на доработку</option>
                        </select>
                      </Field>
                    </>
                  ) : currentWork.learning_set_id ? (
                    <p className="muted">
                      Ответы отправляются в наборе по кнопке выше.
                    </p>
                  ) : currentWork.kind === "choice" ? (
                    <fieldset className="choices">
                      <legend>Выберите ответ</legend>
                      {currentWork.options?.map((option, i) => (
                        <label key={i}>
                          <input
                            type="radio"
                            name="response"
                            value={i}
                            required
                            defaultChecked={
                              currentWork.submission === String(i)
                            }
                          />
                          <span>{option}</span>
                        </label>
                      ))}
                    </fieldset>
                  ) : (
                    <Field
                      label={
                        currentWork.kind === "short"
                          ? "Ваш короткий ответ"
                          : "Ваш ответ"
                      }
                    >
                      <textarea
                        name="response"
                        rows={currentWork.kind === "short" ? 2 : 5}
                        maxLength={20000}
                        required
                        defaultValue={currentWork.submission}
                        placeholder={
                          currentWork.kind === "short"
                            ? "Введите ответ"
                            : "Напишите ответ. Если приложили файл, укажите это здесь."
                        }
                      />
                    </Field>
                  )}
                </>
              )}
              <div className="form-actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() => setModal(null)}
                >
                  Закрыть
                </button>
                <button
                  hidden={
                    modal.kind === "work" &&
                    !isTeacher &&
                    !!currentWork?.learning_set_id
                  }
                  className="btn primary"
                  disabled={
                    busy ||
                    (modal.kind === "lesson" && !data.students.length) ||
                    (modal.kind === "homework" && !data.students.length)
                  }
                >
                  {busy
                    ? "Сохраняем…"
                    : modal.kind === "work"
                      ? isTeacher
                        ? "Сохранить проверку"
                        : "Отправить ответ"
                      : modal.kind === "homework"
                        ? "Назначить задание"
                        : "Сохранить"}
                  <ArrowRight size={16} />
                </button>
              </div>
            </form>
          )}
        </Dialog>
      )}
    </div>
  );
}
function ExerciseFields({ exercise }: { exercise?: Exercise }) {
  const [kind, setKind] = useState(exercise?.kind || "choice");
  return (
    <>
      <Field label="Название">
        <input
          name="title"
          defaultValue={exercise ? exercise.title + " · копия" : ""}
          required
          maxLength={200}
        />
      </Field>
      <Field label="Тип шаблона">
        <select
          name="kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as Exercise["kind"])}
        >
          <option value="choice">Выбор ответа · автопроверка</option>
          <option value="short">Короткий ответ · автопроверка</option>
          <option value="text">Развёрнутый ответ · ручная проверка</option>
        </select>
      </Field>
      <Field label="Условие">
        <textarea
          name="prompt"
          rows={4}
          required
          maxLength={10000}
          defaultValue={exercise?.prompt}
        />
      </Field>
      {kind === "choice" && (
        <Field label="Варианты ответа · каждый с новой строки (от 2 до 8)">
          <textarea
            name="options"
            rows={4}
            required
            defaultValue={exercise?.options.join("\n") || ""}
          />
        </Field>
      )}
      {kind !== "text" && (
        <Field
          label={
            kind === "choice"
              ? "Номер правильного варианта, начиная с 1"
              : "Эталонный ответ"
          }
        >
          <input
            name="answer"
            type={kind === "choice" ? "number" : "text"}
            min={kind === "choice" ? 1 : undefined}
            max={kind === "choice" ? 8 : undefined}
            required
            defaultValue={
              exercise
                ? kind === "choice"
                  ? Number(exercise.answer) + 1
                  : exercise.answer
                : ""
            }
          />
        </Field>
      )}
      <Field label="Объяснение после правильного ответа">
        <textarea
          name="explanation"
          rows={3}
          maxLength={5000}
          defaultValue={exercise?.explanation}
        />
      </Field>
      <p className="muted small-text">
        Короткие ответы сравниваются без учёта регистра и лишних пробелов.
        Развёрнутый ответ проверяет преподаватель.
      </p>
    </>
  );
}
function LinkText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(https?:\/\/[^\s]+)/g).map((s, i) =>
        /^https?:\/\//i.test(s) ? (
          <a key={i} href={s} target="_blank" rel="noreferrer">
            {s}
          </a>
        ) : (
          s
        ),
      )}
    </>
  );
}
