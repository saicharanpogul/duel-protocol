# ─── Duel Protocol Backend ─────────────────────────────────────────
# Multi-stage Bun build for minimal image size

FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
COPY backend/package.json backend/bun.lock* ./backend/
COPY sdk/package.json ./sdk/
COPY sdk/idl/ ./sdk/idl/
COPY sdk/src/ ./sdk/src/
RUN cd backend && bun install --frozen-lockfile 2>/dev/null || bun install

# Copy source
COPY backend/ ./backend/

# ─── API Server ────────────────────────────────────────────────────
FROM base AS server
WORKDIR /app/backend
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/health/live || exit 1
CMD ["bun", "run", "src/index.ts"]

# ─── Indexer ───────────────────────────────────────────────────────
FROM base AS indexer
WORKDIR /app/backend
CMD ["bun", "run", "src/indexer.ts"]

# ─── Cranker ───────────────────────────────────────────────────────
FROM base AS cranker
WORKDIR /app/backend
CMD ["bun", "run", "src/cranker.ts"]
