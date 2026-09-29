import "server-only";
import { z } from "zod";
const schema = z.object({
  APP_URL: z.url(),
  GEMINI_API_KEY: z.string().min(1),
  GEMINI_MODEL: z.string().default("gemini-3.5-flash-lite"),
  GEMINI_FALLBACK_MODEL: z.string().default("gemini-2.5-flash"),
  DATABASE_DRIVER: z.enum(["postgres", "sqlite"]).default("postgres"),
  DATABASE_URL: z.string().default(""),
  SQLITE_PATH: z.string().min(1).default(".runtime/studysort.sqlite"),
  STORAGE_DRIVER: z.enum(["s3", "local"]).default("s3"),
  LOCAL_STORAGE_PATH: z.string().min(1).default(".runtime/storage"),
  S3_ENDPOINT: z.string().default(""),
  S3_REGION: z.string().default(""),
  S3_ACCESS_KEY_ID: z.string().default(""),
  S3_SECRET_ACCESS_KEY: z.string().default(""),
  S3_BUCKET: z.string().default("studysort"),
  SESSION_SECRET: z.string().min(32),
});
export function env() {
  const result = schema.safeParse(process.env);
  if (!result.success)
    throw new Error(
      `Server configuration is incomplete: ${result.error.issues.map((i) => i.path.join(".")).join(", ")}`,
    );
  const origin = new URL(result.data.APP_URL);
  if (result.data.STORAGE_DRIVER === "s3") {
    for (const key of [
      "S3_ENDPOINT",
      "S3_REGION",
      "S3_ACCESS_KEY_ID",
      "S3_SECRET_ACCESS_KEY",
      "S3_BUCKET",
    ] as const) {
      if (!result.data[key])
        throw new Error(`${key} is required when STORAGE_DRIVER=s3.`);
    }
    if (!z.url().safeParse(result.data.S3_ENDPOINT).success)
      throw new Error("S3_ENDPOINT must be a valid URL.");
  }
  if (result.data.STORAGE_DRIVER === "local" && process.env.VERCEL)
    throw new Error(
      "Local files cannot persist on Vercel. Use STORAGE_DRIVER=s3 for deployment.",
    );
  if (result.data.DATABASE_DRIVER === "postgres" && !result.data.DATABASE_URL)
    throw new Error("DATABASE_URL is required when DATABASE_DRIVER=postgres.");
  if (result.data.DATABASE_DRIVER === "sqlite" && process.env.VERCEL)
    throw new Error(
      "Local SQLite cannot persist on Vercel. Set DATABASE_DRIVER=postgres and DATABASE_URL for deployment.",
    );
  if (origin.pathname !== "/" || origin.search || origin.hash)
    throw new Error(
      "APP_URL must be an origin, without a path, query or fragment.",
    );
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if (!local && origin.protocol !== "https:")
    throw new Error("Public deployments require HTTPS.");
  if (
    !local &&
    (!process.env.INNGEST_EVENT_KEY ||
      !process.env.INNGEST_SIGNING_KEY ||
      process.env.INNGEST_DEV === "1")
  )
    throw new Error(
      "Production requires Inngest Cloud keys and INNGEST_DEV must be removed.",
    );
  return result.data;
}
