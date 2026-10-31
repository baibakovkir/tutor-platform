import { NextResponse } from "next/server";
import { rows } from "@/lib/classroom/core";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await rows("SELECT 1 FROM classroom_profiles LIMIT 1");
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
