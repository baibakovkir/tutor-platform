import { NextResponse } from "next/server";
import {
  COOKIE,
  digest,
  rows,
  sameOrigin,
  HttpError,
} from "@/lib/classroom/core";
export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const { token } = await req.json();
    if (typeof token !== "string" || !/^[\w-]{43}$/.test(token))
      throw new HttpError(
        401,
        "Ссылка недействительна. Попросите преподавателя прислать новую.",
      );
    const result = await rows(
      `SELECT p.student_id FROM classroom_profiles p JOIN students s ON s.id=p.student_id WHERE p.access_hash=:hash AND s."deletedAt" IS NULL`,
      { hash: digest(token) },
    );
    if (!result.length)
      throw new HttpError(
        401,
        "Ссылка отозвана. Попросите преподавателя прислать новую.",
      );
    const res = NextResponse.json({ ok: true });
    res.cookies.set(COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 90,
    });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof HttpError ? e.message : "Не удалось открыть кабинет.",
      },
      { status: e instanceof HttpError ? e.status : 400 },
    );
  }
}
