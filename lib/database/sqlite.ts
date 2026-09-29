import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { DatabaseRow, SqlClient } from "./types";
import { SQLITE_SCHEMA } from "./sqlite-schema";

const JSON_VALUE = Symbol("json-parameter");
const jsonColumns = new Set(["analysis", "metadata", "extraction_metadata", "semantic_fingerprint", "result"]);
function bind(value: unknown): SQLInputValue {
  if (typeof value === "object" && value !== null && JSON_VALUE in value) return JSON.stringify(value[JSON_VALUE]);
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "bigint") return value;
  throw new Error("Unsupported SQLite parameter. Use sql.json() for JSON values.");
}
function dialect(query: string): string {
  // Translate only the PostgreSQL constructs used by this application's static
  // templates. User input is bound separately and never interpolated into SQL.
  return query.replace(/\bnow\(\)(?:\s*([+-])\s*interval\s*'(\d+) (hours?|minutes?)')?/gi,
    (_match, sign: string | undefined, amount: string, unit: string) =>
      `strftime('%Y-%m-%dT%H:%M:%fZ','now'${sign ? `,'${sign}${amount} ${unit}'` : ""})`,
  ).replace(/\s+FOR UPDATE\s*$/i, "");
}
export function createSqliteClient(filename: string): { sql: SqlClient; close: () => Promise<void> } {
  if (filename !== ":memory:") mkdirSync(dirname(resolve(filename)), { recursive: true });
  const connection = new DatabaseSync(filename);
  connection.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;");
  connection.function("gen_random_uuid", () => randomUUID());
  connection.exec(SQLITE_SCHEMA);
  // Serialize async transactions on this connection: unrelated requests must
  // never execute inside another request's open transaction.
  let queue: Promise<unknown> = Promise.resolve();
  function serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.then(operation); queue = result.catch(() => undefined); return result;
  }
  async function run<Rows extends object[] = DatabaseRow[]>(strings: TemplateStringsArray, ...values: unknown[]): Promise<Rows> {
    const query = dialect(strings.join("?"));
    const rows = connection.prepare(query).all(...values.map(bind));
    return rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key,
      jsonColumns.has(key) && typeof value === "string" ? JSON.parse(value) : key === "visual" ? Boolean(value) : value,
    ]))) as Rows;
  }
  const json = (value: unknown) => ({ [JSON_VALUE]: value });
  const transaction: SqlClient = Object.assign(run, {
    json,
    begin: async <T,>(callback: (tx: SqlClient) => Promise<T>) => {
      connection.exec("SAVEPOINT nested_transaction");
      try { const result = await callback(transaction); connection.exec("RELEASE nested_transaction"); return result; }
      catch (error) { connection.exec("ROLLBACK TO nested_transaction; RELEASE nested_transaction"); throw error; }
    },
  });
  const sql: SqlClient = Object.assign(
    <Rows extends object[] = DatabaseRow[]>(strings: TemplateStringsArray, ...values: unknown[]) => serialized(() => run<Rows>(strings, ...values)),
    { json, begin: <T,>(callback: (tx: SqlClient) => Promise<T>) => serialized(async () => {
      connection.exec("BEGIN IMMEDIATE");
      try { const result = await callback(transaction); connection.exec("COMMIT"); return result; }
      catch (error) { connection.exec("ROLLBACK"); throw error; }
    }) },
  );
  return { sql, close: () => serialized(async () => { connection.close(); }) };
}
