"use client";
import { useEffect, useState, useRef } from "react";
export default function Page() {
  const [error, setError] = useState("");
  const redeemed = useRef(false);
  useEffect(() => {
    if (redeemed.current) return;
    redeemed.current = true;
    const token = location.hash.slice(1);
    history.replaceState(null, "", "/join");
    fetch("/api/portal/access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        location.replace("/learn");
      })
      .catch((e) => setError(e.message));
  }, []);
  return (
    <main className="auth-page">
      <div className="auth-card">
        <span className="brand-symbol">к.</span>
        <h1>
          {error ? "Не удалось открыть кабинет" : "Открываем ваш кабинет"}
        </h1>
        <p>{error || "Расписание и задания уже ждут вас."}</p>
        {error && <a href="/signin">Вход для преподавателя</a>}
      </div>
    </main>
  );
}
