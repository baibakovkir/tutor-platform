import { z } from "zod";
import {
  actor,
  command,
  commandSchema,
  errorResponse,
} from "@/lib/games/service";
import { sameOrigin } from "@/lib/classroom/core";
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    sameOrigin(req);
    const a = await actor();
    const id = z
      .string()
      .uuid()
      .parse((await params).id);
    return Response.json(
      await command(a, id, commandSchema.parse(await req.json())),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
