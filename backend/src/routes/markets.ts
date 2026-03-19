import { Hono } from "hono";
import * as db from "../db.js";

export const marketRoutes = new Hono();

// GET /api/markets — list markets with optional filters
marketRoutes.get("/", async (c) => {
  const status = c.req.query("status"); // active | twap | resolved
  const limit = Math.min(parseInt(c.req.query("limit") || "50", 10), 200);
  const offset = parseInt(c.req.query("offset") || "0", 10);

  let whereClause = "";
  const params: any[] = [];

  if (status) {
    params.push(status);
    whereClause = `WHERE status = $${params.length}`;
  }

  params.push(limit, offset);
  const result = await db.query(
    `SELECT * FROM markets ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  // Get total count
  const countResult = await db.query(
    `SELECT COUNT(*) as total FROM markets ${whereClause}`,
    status ? [status] : []
  );

  return c.json({
    markets: result.rows,
    total: parseInt(countResult.rows[0].total, 10),
    limit,
    offset,
  });
});

// GET /api/markets/:id — single market detail
marketRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");

  const result = await db.query("SELECT * FROM markets WHERE pubkey = $1", [id]);

  if (result.rows.length === 0) {
    return c.json({ error: "Market not found" }, 404);
  }

  const market = result.rows[0];

  // Get recent trades
  const trades = await db.query(
    `SELECT * FROM trades WHERE market_pubkey = $1 ORDER BY created_at DESC LIMIT 20`,
    [id]
  );

  // Get TWAP samples
  const twap = await db.query(
    `SELECT * FROM twap_samples WHERE market_pubkey = $1 ORDER BY created_at DESC LIMIT 100`,
    [id]
  );

  return c.json({
    market,
    recentTrades: trades.rows,
    twapSamples: twap.rows,
  });
});

// GET /api/markets/:id/stats — market statistics
marketRoutes.get("/:id/stats", async (c) => {
  const id = c.req.param("id");

  const buyCount = await db.query(
    `SELECT COUNT(*) as count, COALESCE(SUM(sol_amount::numeric), 0) as volume
     FROM trades WHERE market_pubkey = $1 AND trade_type = 'buy'`,
    [id]
  );

  const sellCount = await db.query(
    `SELECT COUNT(*) as count, COALESCE(SUM(sol_amount::numeric), 0) as volume
     FROM trades WHERE market_pubkey = $1 AND trade_type = 'sell'`,
    [id]
  );

  const uniqueTraders = await db.query(
    `SELECT COUNT(DISTINCT trader) as count FROM trades WHERE market_pubkey = $1`,
    [id]
  );

  return c.json({
    buys: { count: parseInt(buyCount.rows[0].count, 10), volume: buyCount.rows[0].volume },
    sells: { count: parseInt(sellCount.rows[0].count, 10), volume: sellCount.rows[0].volume },
    uniqueTraders: parseInt(uniqueTraders.rows[0].count, 10),
  });
});
