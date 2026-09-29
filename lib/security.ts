import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import { env } from "./config";
import { db } from "./database";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function sign(id: string) {
  return createHmac("sha256", env().SESSION_SECRET).update(id).digest("hex");
}
export function equal(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function checkOrigin(request: Request) {
  if (request.headers.get("origin") !== new URL(env().APP_URL).origin)
    throw new HttpError(403, "This request did not originate from StudySort.");
}
export async function authorize(id: string) {
  if (!z.uuid().safeParse(id).success)
    throw new HttpError(404, "Session not found.");
  const cookie = (await cookies()).get(`ss_${id}`)?.value;
  if (!cookie || !equal(cookie, sign(id)))
    throw new HttpError(
      403,
      "This session belongs to another browser or has expired.",
    );
  const rows =
    await db()`SELECT id, status, expires_at FROM sessions WHERE id = ${id}`;
  if (!rows.length || new Date(rows[0].expires_at).getTime() <= Date.now())
    throw new HttpError(
      410,
      "This session has expired. Start a new organization.",
    );
  return rows[0];
}
export async function setSessionCookie(id: string) {
  (await cookies()).set(`ss_${id}`, sign(id), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: `/api/sessions/${id}`,
    maxAge: 86400,
  });
}
export async function rateLimit(request: Request) {
  const ip =
    process.env.TRUST_PROXY === "1"
      ? (request.headers.get("x-vercel-forwarded-for") || "unknown")
          .split(",")[0]
          .trim()
      : "local";
  const hour = Math.floor(Date.now() / 3600000);
  for (const [key, limit] of [
    [`global:${hour}`, 100],
    [`ip:${sign(ip)}:${hour}`, 5],
  ] as const) {
    const rows =
      await db()`INSERT INTO request_budgets (key, count, expires_at) VALUES (${key}, 1, now() + interval '2 hours') ON CONFLICT (key) DO UPDATE SET count = request_budgets.count + 1 RETURNING count`;
    if (rows[0].count > limit)
      throw new HttpError(
        429,
        "Upload capacity reached. Please try again in the next hour.",
      );
  }
}
export async function parseBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "A request body is required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 100_000) {
        await reader.cancel();
        throw new HttpError(413, "Request is too large.");
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Request must contain valid JSON.");
  }
}
export function apiError(error: unknown): Response {
  if (error instanceof HttpError)
    return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof z.ZodError)
    return Response.json(
      { error: "Check the selected files: maximum 200 files, 25 MB per file." },
      { status: 400 },
    );
  console.error(
    "API operation failed",
    error instanceof Error ? error.name : "UnknownError",
  );
  return Response.json(
    {
      error:
        "The service is temporarily unavailable. Please retry. If this continues, contact the site operator.",
    },
    { status: 503 },
  );
}
