"use client";
import Link from "next/link";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { ArrowRight, BookOpen, CalendarDays, Check } from "lucide-react";
export default function SignInForm() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <main className="login-layout">
      <section className="login-story">
        <Link className="brand" href="/">
          <span className="brand-symbol">к.</span> класс
          <span className="brand-dot">/</span>
        </Link>
        <div>
          <span className="eyebrow">ПРОСТРАНСТВО ДЛЯ ЗАНЯТИЙ</span>
          <h1>
            Меньше рутины.
            <br />
            Больше открытий.
          </h1>
          <p>Всё для ваших занятий — в одном спокойном и понятном месте.</p>
          <div className="login-features">
            <span>
              <CalendarDays size={20} /> Расписание под рукой
            </span>
            <span>
              <BookOpen size={20} /> Задания и материалы
            </span>
            <span>
              <Check size={20} /> Понятный учёт оплат
            </span>
          </div>
        </div>
        <small>Учиться. Пробовать. Получаться.</small>
      </section>
      <section className="login-form-wrap">
        <form
          className="auth-card"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            const f = new FormData(e.currentTarget);
            try {
              await fetch("/api/classroom/logout", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: "{}",
              });
              const r = await signIn("credentials", {
                email: f.get("email"),
                password: f.get("password"),
                redirect: false,
              });
              if (r?.error) setError("Проверьте email и пароль.");
              else location.href = "/";
            } catch {
              setError("Не удалось войти. Попробуйте ещё раз.");
            } finally {
              setBusy(false);
            }
          }}
        >
          <span className="eyebrow">С ВОЗВРАЩЕНИЕМ</span>
          <h2>Войти в кабинет</h2>
          <p>Хорошее занятие начинается здесь.</p>
          <label>
            Email
            <input
              name="email"
              type="email"
              autoComplete="username"
              placeholder="you@example.com"
              required
            />
          </label>
          <label>
            Пароль
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="Ваш пароль"
              required
            />
          </label>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <button className="btn primary wide" disabled={busy}>
            {busy ? "Входим…" : "Продолжить"}
            <ArrowRight size={18} />
          </button>
          <div className="login-hint">
            Вы ученик? Откройте персональную ссылку, которую прислал
            преподаватель.
          </div>
        </form>
      </section>
    </main>
  );
}
