import { Hono } from "hono";
import * as db from "../db.js";

export const tradeRoutes = new Hono();

// GET /api/trades/:marketId — trades for a market
tradeRoutes.get("/:marketId", async (c) => {
  const marketId = c.req.param("marketId");
  const limit = Math.min(parseInt(c.req.query("limit") || "50", 10), 200);
  const offset = parseInt(c.req.query("offset") || "0", 10);
  const side = c.req.query("side"); // 0 | 1
  const tradeType = c.req.query("type"); // buy | sell

  let whereClause = "WHERE market_pubkey = $1";
  const params: any[] = [marketId];

  if (side !== undefined) {
    params.push(parseInt(side, 10));
    whereClause += ` AND side = $${params.length}`;
  }

  if (tradeType) {
    params.push(tradeType);
    whereClause += ` AND trade_type = $${params.length}`;
  }

  params.push(limit, offset);

  const result = await db.query(
    `SELECT * FROM trades ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  const countParams = params.slice(0, -2);
  const countResult = await db.query(
    `SELECT COUNT(*) as total FROM trades ${whereClause.replace(/LIMIT.*$/, "")}`,
    countParams
  );

  return c.json({
    trades: result.rows,
    total: parseInt(countResult.rows[0].total, 10),
    limit,
    offset,
  });
});

// GET /api/trades/trader/:address — trades by a specific trader
tradeRoutes.get("/trader/:address", async (c) => {
  const address = c.req.param("address");
  const limit = Math.min(parseInt(c.req.query("limit") || "50", 10), 200);
  const offset = parseInt(c.req.query("offset") || "0", 10);

  const result = await db.query(
    `SELECT * FROM trades WHERE trader = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [address, limit, offset]
  );

  return c.json({
    trades: result.rows,
    limit,
    offset,
  });
});

// GET /api/twap/:marketId — TWAP samples for a market
tradeRoutes.get("/twap/:marketId", async (c) => {
  const marketId = c.req.param("marketId");
  const limit = Math.min(parseInt(c.req.query("limit") || "100", 10), 500);

  const result = await db.query(
    `SELECT * FROM twap_samples WHERE market_pubkey = $1 ORDER BY created_at DESC LIMIT $2`,
    [marketId, limit]
  );

  return c.json({ samples: result.rows });
});
