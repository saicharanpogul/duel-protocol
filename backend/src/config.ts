import { PublicKey } from "@solana/web3.js";

// ─── Environment ──────────────────────────────────────────────────

function env(key: string, fallback?: string): string {
  const val = process.env[key] ?? fallback;
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  return raw ? parseInt(raw, 10) : fallback;
}

// ─── Config ───────────────────────────────────────────────────────

export const config = {
  // Solana
  rpcUrl: env("SOLANA_RPC_URL", "http://localhost:8899"),
  wsUrl: env("SOLANA_WS_URL", env("SOLANA_RPC_URL", "http://localhost:8899").replace("http", "ws")),
  programId: new PublicKey("CgR6V1AxC7exDFNoh3Q5JP9aea9YuPqq283EwACUGpZE"),

  // PostgreSQL
  databaseUrl: env("DATABASE_URL", "postgresql://duel:duel@localhost:5432/duel"),

  // Server
  port: envInt("PORT", 3000),

  // Cranker
  crankerKeypairPath: env("CRANKER_KEYPAIR", "./cranker-keypair.json"),
  pollIntervalMs: envInt("POLL_INTERVAL_MS", 5000),
  dryRun: process.env.DRY_RUN === "true",

  // Indexer
  backfillLimit: envInt("BACKFILL_LIMIT", 1000),
  syncIntervalMs: envInt("SYNC_INTERVAL_MS", 60000),

  // Health
  heartbeatStaleMs: 60_000, // Consider unhealthy after 60s without heartbeat
} as const;
