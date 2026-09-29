import postgres from "postgres";
import { readFile } from "node:fs/promises";
import { createSqliteClient } from "../lib/database/sqlite";
if (process.env.DATABASE_DRIVER === "sqlite") {
  if (process.env.VERCEL) throw new Error("Local SQLite is not supported on Vercel.");
  const client = createSqliteClient(process.env.SQLITE_PATH || ".runtime/studysort.sqlite");
  await client.close();
  console.log("SQLite schema ready. No database credentials required.");
} else {
const url = process.env.DATABASE_URL;
if (!url) throw new Error("Set DATABASE_URL in .env.local first.");
const sql = postgres(url, { prepare: false, max: 1, ssl: "require" });
try {
  await sql.begin(async (tx) => {
    await tx.unsafe(
      await readFile(
        new URL("../migrations/001_initial.sql", import.meta.url),
        "utf8",
      ),
    );
  });
  console.log("Database migration applied.");
} finally {
  await sql.end();
}
}
