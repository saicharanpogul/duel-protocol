import { Hono } from "hono";
import * as db from "../db.js";
import { config } from "../config.js";

export const healthRoutes = new Hono();

interface HealthStatus {
  status: "ok" | "degraded" | "unhealthy";
  uptime: number;
  services: {
    database: { status: string; latencyMs?: number };
    indexer: { status: string; lastHeartbeat?: string; staleSec?: number };
    cranker: { status: string; lastHeartbeat?: string; staleSec?: number };
  };
}

const startTime = Date.now();

// GET /health — overall health check
healthRoutes.get("/", async (c) => {
  const now = Date.now();
  const health: HealthStatus = {
    status: "ok",
    uptime: Math.floor((now - startTime) / 1000),
    services: {
      database: { status: "unknown" },
      indexer: { status: "unknown" },
      cranker: { status: "unknown" },
    },
  };

  // Check database
  try {
    const dbStart = Date.now();
    await db.query("SELECT 1");
    health.services.database = {
      status: "ok",
      latencyMs: Date.now() - dbStart,
    };
  } catch {
    health.services.database = { status: "unhealthy" };
    health.status = "unhealthy";
  }

  // Check indexer heartbeat
  try {
    const hb = await db.getState("indexer_heartbeat");
    if (hb && hb !== "0") {
      const staleSec = Math.floor((now - parseInt(hb, 10)) / 1000);
      health.services.indexer = {
        status: staleSec < config.heartbeatStaleMs / 1000 ? "ok" : "stale",
        lastHeartbeat: new Date(parseInt(hb, 10)).toISOString(),
        staleSec,
      };
      if (staleSec >= config.heartbeatStaleMs / 1000) health.status = "degraded";
    } else {
      health.services.indexer = { status: "not_started" };
    }
  } catch {
    health.services.indexer = { status: "unknown" };
  }

  // Check cranker heartbeat
  try {
    const hb = await db.getState("cranker_heartbeat");
    if (hb && hb !== "0") {
      const staleSec = Math.floor((now - parseInt(hb, 10)) / 1000);
      health.services.cranker = {
        status: staleSec < config.heartbeatStaleMs / 1000 ? "ok" : "stale",
        lastHeartbeat: new Date(parseInt(hb, 10)).toISOString(),
        staleSec,
      };
      if (staleSec >= config.heartbeatStaleMs / 1000) health.status = "degraded";
    } else {
      health.services.cranker = { status: "not_started" };
    }
  } catch {
    health.services.cranker = { status: "unknown" };
  }

  const httpStatus = health.status === "unhealthy" ? 503 : 200;
  return c.json(health, httpStatus);
});

// GET /health/ready — simple readiness probe for Docker/k8s
healthRoutes.get("/ready", async (c) => {
  try {
    await db.query("SELECT 1");
    return c.json({ status: "ready" }, 200);
  } catch {
    return c.json({ status: "not_ready" }, 503);
  }
});

// GET /health/live — simple liveness probe
healthRoutes.get("/live", (c) => {
  return c.json({ status: "alive", uptime: Math.floor((Date.now() - startTime) / 1000) });
});
