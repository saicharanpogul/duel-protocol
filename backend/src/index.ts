/**
 * Duel Protocol — Production API Server
 *
 * Hono-based REST API for frontend consumption.
 * Serves market data, trades, TWAP samples, and health checks.
 *
 * Usage:
 *   DATABASE_URL=... PORT=3000 bun run src/index.ts
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { config } from "./config.js";
import { runMigrations, closePool } from "./db.js";
import { healthRoutes } from "./routes/health.js";
import { marketRoutes } from "./routes/markets.js";
import { tradeRoutes } from "./routes/trades.js";

// ─── App ──────────────────────────────────────────────────────────

const app = new Hono();

// Middleware
app.use("*", cors());
app.use("*", logger());

// Routes
app.route("/health", healthRoutes);
app.route("/api/markets", marketRoutes);
app.route("/api/trades", tradeRoutes);

// Root
app.get("/", (c) => {
  return c.json({
    name: "Duel Protocol API",
    version: "0.1.0",
    docs: {
      health: "/health",
      markets: "/api/markets",
      market_detail: "/api/markets/:id",
      market_stats: "/api/markets/:id/stats",
      trades: "/api/trades/:marketId",
      trader: "/api/trades/trader/:address",
      twap: "/api/trades/twap/:marketId",
    },
  });
});

// 404
app.notFound((c) => c.json({ error: "Not found" }, 404));

// Error handler
app.onError((err, c) => {
  console.error("[API] Error:", err.message);
  return c.json({ error: "Internal server error" }, 500);
});

// ─── Server ───────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════");
  console.log("  DUEL PROTOCOL — Production API Server");
  console.log("═══════════════════════════════════════════════");
  console.log(`  Port:     ${config.port}`);
  console.log(`  Database: ${config.databaseUrl.replace(/\/\/.*@/, "//***@")}`);
  console.log("═══════════════════════════════════════════════\n");

  // Run migrations (idempotent)
  await runMigrations();

  // Start server
  const server = Bun.serve({
    port: config.port,
    fetch: app.fetch,
  });

  console.log(`[API] ✅ Server running on http://localhost:${server.port}`);

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\n[API] Shutting down...");
    server.stop();
    await closePool();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[API] Fatal error:", err);
  process.exit(1);
});

export default app;
