import "server-only";
import postgres from "postgres";
import { env } from "@/lib/config";
import { createSqliteClient } from "./sqlite";
import type { SqlClient } from "./types";
const shared = globalThis as typeof globalThis & { studySortDatabase?: { key: string; sql: SqlClient } };
export function db(): SqlClient {
  const config = env();
  const key = config.DATABASE_DRIVER === "sqlite" ? `sqlite:${config.SQLITE_PATH}` : config.DATABASE_URL;
  if (shared.studySortDatabase?.key === key) return shared.studySortDatabase.sql;
  const sql = config.DATABASE_DRIVER === "sqlite" ? createSqliteClient(config.SQLITE_PATH).sql : postgres(config.DATABASE_URL, {
    prepare: false,
    max: 3,
    idle_timeout: 20,
    connect_timeout: 15,
    ssl: process.env.NODE_ENV === "production" ? "require" : undefined,
  }) as unknown as SqlClient;
  shared.studySortDatabase = { key, sql };
  return sql;
}
