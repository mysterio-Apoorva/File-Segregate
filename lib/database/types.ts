/** The parameterized-query subset shared by PostgreSQL and local SQLite. */
export interface DatabaseRow {
  id: string;
  status: string;
  expires_at: string;
  count: number;
  content: string;
  storage_key: string;
  [column: string]: unknown;
}
export interface SqlClient {
  <Rows extends object[] = DatabaseRow[]>(strings: TemplateStringsArray, ...values: unknown[]): Promise<Rows>;
  json(value: unknown): unknown;
  begin<Result>(callback: (transaction: SqlClient) => Promise<Result>): Promise<Result>;
}
