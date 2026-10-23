import "server-only";
import { neon } from "@neondatabase/serverless";
import { buildQuery } from "./sql-template";
import { SCHEMA_STATEMENTS } from "./schema";

export type Row = Record<string, unknown>;
type QueryFn = (text: string, params: unknown[]) => Promise<Row[]>;

let queryFn: QueryFn | undefined;
let schemaReady: Promise<void> | undefined;

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

async function getQueryFn(): Promise<QueryFn> {
  if (queryFn) return queryFn;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Add a Neon database in Vercel (see README).");

  if (isLocalHost(new URL(url).hostname)) {
    // Local development against plain Postgres: Neon's HTTP driver only talks to Neon,
    // so fall back to node-postgres (a dev dependency, never used on Vercel).
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: url, max: 3 });
    queryFn = async (text, params) => (await pool.query(text, params)).rows as Row[];
  } else {
    const sql = neon(url);
    queryFn = async (text, params) => (await sql.query(text, params)) as Row[];
  }
  return queryFn;
}

async function runSchema(run: QueryFn): Promise<void> {
  for (const statement of SCHEMA_STATEMENTS) {
    await run(statement, []);
  }
}

/** Creates tables on first use, so setup from an iPhone needs no migration step. */
function ensureSchema(run: QueryFn): Promise<void> {
  schemaReady ??= runSchema(run).catch(async () => {
    // Two cold starts racing on CREATE ... IF NOT EXISTS can collide once; retry after a beat.
    await new Promise((resolve) => setTimeout(resolve, 400));
    await runSchema(run);
  });
  // Don't cache a failure forever (e.g. database briefly unreachable).
  schemaReady.catch(() => {
    schemaReady = undefined;
  });
  return schemaReady;
}

/** Runs a parameterized query. Values are always sent as bind parameters, never spliced into SQL. */
export async function sql<T = Row>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]> {
  const run = await getQueryFn();
  await ensureSchema(run);
  const { text, params } = buildQuery(strings, values);
  return (await run(text, params)) as T[];
}

export function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "23505";
}
