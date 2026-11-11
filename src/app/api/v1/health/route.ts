import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** Liveness + database check. No authentication. */
export async function GET(): Promise<Response> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok", database: "ok" });
  } catch {
    return Response.json({ status: "error", database: "unreachable" }, { status: 503 });
  }
}
