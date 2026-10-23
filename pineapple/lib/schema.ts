// Idempotent schema. Runs once per server instance (see lib/db.ts).
export const SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS settings (
    id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    customer_name text NOT NULL DEFAULT '',
    customer_phone text NOT NULL DEFAULT '',
    delivery_address text NOT NULL DEFAULT '',
    payment_method text NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash', 'card')),
    max_budget_czk integer NOT NULL DEFAULT 600,
    agent_id text,
    phone_number_id text,
    llm_token_hash text,
    llm_secret_id text,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `INSERT INTO settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`,
  // Columns added after the first release (no-ops on fresh databases).
  `ALTER TABLE settings ADD COLUMN IF NOT EXISTS llm_token_hash text`,
  `ALTER TABLE settings ADD COLUMN IF NOT EXISTS llm_secret_id text`,

  `CREATE TABLE IF NOT EXISTS auth_state (
    id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    failed_count integer NOT NULL DEFAULT 0,
    locked_until timestamptz
  )`,
  `INSERT INTO auth_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING`,

  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash text PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS restaurants (
    id serial PRIMARY KEY,
    name text NOT NULL,
    phone text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_name text NOT NULL,
    restaurant_phone text NOT NULL,
    items text NOT NULL,
    budget_czk integer NOT NULL,
    delivery_address text NOT NULL,
    customer_name text NOT NULL,
    customer_phone text NOT NULL,
    payment_method text NOT NULL,
    status text NOT NULL DEFAULT 'draft',
    conversation_id text UNIQUE,
    call_sid text,
    el_status text,
    call_started_at timestamptz,
    call_ended_at timestamptz,
    last_synced_at timestamptz,
    order_confirmed boolean,
    total_czk double precision,
    eta_minutes integer,
    notes text,
    summary text,
    transcript jsonb,
    error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders (created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS orders_call_started_at_idx ON orders (call_started_at)`,
  // Hard guarantee of "one call at a time": at most one order can be dialing, on a call, or
  // waiting for its result. (v2 adds 'processing'; the v1 index is dropped after v2 exists.)
  `CREATE UNIQUE INDEX IF NOT EXISTS orders_one_active_call_v2 ON orders ((true)) WHERE status IN ('dialing', 'calling', 'processing')`,
  `DROP INDEX IF EXISTS orders_one_active_call`,
];
