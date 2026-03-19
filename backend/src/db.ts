import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;

// ─── Pool ─────────────────────────────────────────────────────────

let pool: pg.Pool;

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: config.databaseUrl,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });

    pool.on("error", (err) => {
      console.error("[DB] Pool error:", err.message);
    });
  }
  return pool;
}

// ─── Query Helpers ────────────────────────────────────────────────

export async function query<T extends pg.QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<pg.QueryResult<T>> {
  return getPool().query<T>(text, params);
}

// ─── Market Operations ────────────────────────────────────────────

export async function upsertMarket(data: Record<string, any>): Promise<void> {
  const keys = Object.keys(data);
  const values = Object.values(data);
  const setClauses = keys
    .filter((k) => k !== "pubkey")
    .map((k, i) => `${k} = $${keys.indexOf(k) + 1}`)
    .join(", ");

  const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");

  await query(
    `INSERT INTO markets (${keys.join(", ")})
     VALUES (${placeholders})
     ON CONFLICT (pubkey) DO UPDATE SET ${setClauses}, updated_at = NOW()`,
    values
  );
}

export async function insertTrade(data: Record<string, any>): Promise<void> {
  const keys = Object.keys(data);
  const values = Object.values(data);
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");

  await query(
    `INSERT INTO trades (${keys.join(", ")}) VALUES (${placeholders})`,
    values
  );
}

export async function insertTwapSample(data: Record<string, any>): Promise<void> {
  const keys = Object.keys(data);
  const values = Object.values(data);
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");

  await query(
    `INSERT INTO twap_samples (${keys.join(", ")}) VALUES (${placeholders})`,
    values
  );
}

// ─── Indexer State ────────────────────────────────────────────────

export async function getState(key: string): Promise<string | null> {
  const result = await query<{ value: string }>(
    `SELECT value FROM indexer_state WHERE key = $1`,
    [key]
  );
  return result.rows[0]?.value ?? null;
}

export async function setState(key: string, value: string): Promise<void> {
  await query(
    `INSERT INTO indexer_state (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
    [key, value]
  );
}

// ─── Active Markets ───────────────────────────────────────────────

export async function getActiveMarkets(): Promise<
  { pubkey: string; side_a_pubkey: string; side_b_pubkey: string }[]
> {
  const result = await query<{
    pubkey: string;
    side_a_pubkey: string;
    side_b_pubkey: string;
  }>(
    `SELECT pubkey, side_a_pubkey, side_b_pubkey
     FROM markets WHERE status IN ('active', 'twap')`
  );
  return result.rows;
}

// ─── Migration Runner ─────────────────────────────────────────────

export async function runMigrations(): Promise<void> {
  const fs = await import("fs");
  const path = await import("path");

  const migrationsDir = path.resolve(import.meta.dir, "../migrations");
  const files = fs.readdirSync(migrationsDir).sort();

  for (const file of files) {
    if (!file.endsWith(".sql")) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
    console.log(`[DB] Running migration: ${file}`);
    await query(sql);
    console.log(`[DB] ✅ Migration complete: ${file}`);
  }
}

// ─── Shutdown ─────────────────────────────────────────────────────

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    console.log("[DB] Pool closed");
  }
}
