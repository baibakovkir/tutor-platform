"use client";
import { useEffect, useState, use } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, Send, BookOpen } from "lucide-react";
import "../../games/games.css";
type Task = {
  id: string;
  type: string;
  prompt: string;
  options?: string[];
  tokens?: { id: string; text: string }[];
  answer?: string;
  explanation?: string;
  last?: { response: string; correct: boolean };
  attempts: { id: string; response: string; correct: boolean }[];
};
type Work = {
  id: number;
  title: string;
  body: string;
  due: string;
  status: string;
  feedback: string;
  role: string;
  studentName: string;
  sourceTitle: string;
  items: Task[];
  completed: number;
};
export default function Practice({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [work, setWork] = useState<Work | null>(null),
    [index, setIndex] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [response, setResponse] = useState(""),
    [tokens, setTokens] = useState<string[]>([]);
  useEffect(() => {
    fetch("/api/library/homework/" + id, { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        setWork(d);
      })
      .catch((e) => setError(e.message));
  }, [id]);
  useEffect(() => {
    setResponse("");
    setTokens([]);
  }, [index]);
  const task = work?.items[index];
  async function submit(value: string) {
    if (!task) return;
    setError("");
    setBusy(true);
    try {
      const r = await fetch("/api/library/homework/" + id, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commandId: crypto.randomUUID(),
          itemId: task.id,
          response: value,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setWork(d);
      setResponse("");
      setTokens([]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function mark(attemptId: string, correct: boolean) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/library/homework/" + id, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attemptId, correct }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setWork(d);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="games-shell">
      <header className="games-header">
        <Link href={work?.role === "teacher" ? "/" : "/learn"}>
          <ArrowLeft size={17} />
          Кабинет
        </Link>
        <span>Домашняя практика</span>
      </header>
      <div className="games-title">
        <div>
          <span className="eyebrow">В СВОЁМ ТЕМПЕ</span>
          <h1>{work?.title || "Домашнее задание"}</h1>
          <p>
            {work?.sourceTitle}
            {work &&
              " · До " +
                new Date(work.due + "T12:00:00").toLocaleDateString("ru-RU")}
          </p>
        </div>
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {work && task && (
        <>
          <div className="games-toolbar">
            <span className="pill lavender">
              Выполнено {work.completed} / {work.items.length}
            </span>
            <span className="muted">
              {work.role === "teacher"
                ? work.studentName
                : "Ответы сохраняются автоматически"}
            </span>
          </div>
          {work.body && (
            <section className="panel game-note">
              <p style={{ whiteSpace: "pre-wrap" }}>{work.body}</p>
            </section>
          )}
          <div className="game-layout">
            <section className="panel play-panel">
              <div className="play-top">
                <span>
                  Задание {index + 1} / {work.items.length}
                </span>
                <span className="pill neutral">
                  {task.type === "pair"
                    ? "Найдите соответствие"
                    : task.type === "sentence"
                      ? "Соберите фразу"
                      : "Выберите ответ"}
                </span>
              </div>
              <h2>{task.prompt}</h2>
              {work.role === "teacher" ? (
                <div className="round-result">
                  <h3>
                    {task.type === "text"
                      ? "Ответ проверяется преподавателем"
                      : "Правильный ответ: " + task.answer}
                  </h3>
                  <p>{task.explanation}</p>
                </div>
              ) : task.type === "sentence" ? (
                <>
                  <div className="sentence-target">
                    <div>
                      {tokens.map((token) => (
                        <button
                          className="word-token selected"
                          key={token}
                          onClick={() =>
                            setTokens(tokens.filter((t) => t !== token))
                          }
                        >
                          {task.tokens?.find((t) => t.id === token)?.text}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="word-bank">
                    {task.tokens
                      ?.filter((t) => !tokens.includes(t.id))
                      .map((t) => (
                        <button
                          key={t.id}
                          className="word-token"
                          onClick={() => setTokens([...tokens, t.id])}
                        >
                          {t.text}
                        </button>
                      ))}
                  </div>
                  <div className="play-submit">
                    <button className="btn" onClick={() => setTokens([])}>
                      Сбросить
                    </button>
                    <button
                      className="btn primary"
                      disabled={busy || tokens.length !== task.tokens?.length}
                      onClick={() =>
                        void submit(
                          tokens
                            .map(
                              (t) => task.tokens!.find((w) => w.id === t)!.text,
                            )
                            .join(" "),
                        )
                      }
                    >
                      Проверить фразу
                      <Send size={16} />
                    </button>
                  </div>
                </>
              ) : task.options ? (
                <div className="quiz-options">
                  {task.options.map((o, i) => (
                    <button
                      key={o}
                      disabled={busy}
                      onClick={() => void submit(o)}
                    >
                      <span>{i + 1}</span>
                      {o}
                    </button>
                  ))}
                </div>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submit(response);
                  }}
                >
                  <textarea
                    rows={task.type === "text" ? 5 : 2}
                    value={response}
                    onChange={(e) => setResponse(e.target.value)}
                    required
                    maxLength={2000}
                  />
                  <button className="btn primary" disabled={busy}>
                    Отправить
                  </button>
                </form>
              )}
              {task.last && (
                <div className="round-result" role="status">
                  <span
                    className={
                      "pill " + (task.last.correct ? "green" : "amber")
                    }
                  >
                    {task.last.correct === null
                      ? "На проверке"
                      : task.last.correct
                        ? "Верно"
                        : "Нужно повторить"}
                  </span>
                  <p>Ваш ответ: {task.last.response}</p>
                  <h3>{task.answer}</h3>
                  <p>{task.explanation}</p>
                  {work.role === "teacher" &&
                    task.type === "text" &&
                    task.last.correct === null && (
                      <div className="form-actions">
                        <button
                          className="btn primary"
                          disabled={busy}
                          onClick={() => void mark(task.attempts[0].id, true)}
                        >
                          Верно
                        </button>
                        <button
                          className="btn"
                          disabled={busy}
                          onClick={() => void mark(task.attempts[0].id, false)}
                        >
                          Нужно повторить
                        </button>
                      </div>
                    )}
                  <small className="muted">
                    Попыток: {task.attempts.length}
                  </small>
                </div>
              )}
              <div className="play-submit">
                <button
                  className="btn"
                  disabled={!index}
                  onClick={() => setIndex(index - 1)}
                >
                  <ArrowLeft size={16} />
                  Назад
                </button>
                <button
                  className="btn primary"
                  disabled={index === work.items.length - 1}
                  onClick={() => setIndex(index + 1)}
                >
                  Дальше
                  <ArrowRight size={16} />
                </button>
              </div>
              {work.completed === work.items.length && (
                <div className="notice success">
                  <Check size={20} />
                  Все ответы отправлены преподавателю.
                </div>
              )}
            </section>
            <aside className="panel score-panel">
              <h2>
                <BookOpen size={18} /> Задания
              </h2>
              <div className="practice-index">
                {work.items.map((t, i) => (
                  <button
                    className={"btn " + (index === i ? "primary" : "")}
                    key={t.id}
                    onClick={() => setIndex(i)}
                  >
                    {i + 1}
                    {t.last && <Check size={12} />}
                  </button>
                ))}
              </div>
              {work.feedback && (
                <>
                  <h3>Комментарий преподавателя</h3>
                  <p>{work.feedback}</p>
                </>
              )}
            </aside>
          </div>
        </>
      )}
      {!work && !error && <p>Загружаем задания…</p>}
    </main>
  );
}
