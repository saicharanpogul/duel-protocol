-- Duel Protocol — PostgreSQL Schema
-- Run: bun run migrate

BEGIN;

-- ─── Markets ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS markets (
    pubkey          TEXT PRIMARY KEY,
    authority       TEXT NOT NULL,
    market_id       BIGINT,
    deadline        BIGINT NOT NULL,
    battle_tax_bps  INT DEFAULT 0,
    protocol_fee_bps INT DEFAULT 0,
    creator_fee_bps INT DEFAULT 0,
    sell_penalty_max_bps INT DEFAULT 0,
    twap_window     BIGINT DEFAULT 0,
    twap_interval   BIGINT DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'active',
    winner          SMALLINT,
    final_twap_a    TEXT DEFAULT '0',
    final_twap_b    TEXT DEFAULT '0',
    battle_tax_collected TEXT DEFAULT '0',
    protocol_fee_collected TEXT DEFAULT '0',
    side_a_pubkey   TEXT,
    side_b_pubkey   TEXT,
    token_mint_a    TEXT,
    token_mint_b    TEXT,
    reserve_a       BIGINT DEFAULT 0,
    reserve_b       BIGINT DEFAULT 0,
    circulating_a   BIGINT DEFAULT 0,
    circulating_b   BIGINT DEFAULT 0,
    quote_mint      TEXT,
    graduated_side  SMALLINT,
    dex_pool        TEXT,
    resolution_mode TEXT DEFAULT 'twap',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_markets_status ON markets(status);
CREATE INDEX IF NOT EXISTS idx_markets_deadline ON markets(deadline);
CREATE INDEX IF NOT EXISTS idx_markets_authority ON markets(authority);

-- ─── Trades ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trades (
    id              SERIAL PRIMARY KEY,
    market_pubkey   TEXT NOT NULL REFERENCES markets(pubkey),
    side            SMALLINT NOT NULL,
    trader          TEXT NOT NULL,
    trade_type      TEXT NOT NULL CHECK (trade_type IN ('buy', 'sell')),
    sol_amount      TEXT NOT NULL,
    token_amount    TEXT NOT NULL,
    price_after     TEXT NOT NULL,
    penalty_applied TEXT DEFAULT '0',
    slot            BIGINT NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trades_market ON trades(market_pubkey);
CREATE INDEX IF NOT EXISTS idx_trades_trader ON trades(trader);
CREATE INDEX IF NOT EXISTS idx_trades_slot ON trades(slot);

-- ─── TWAP Samples ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS twap_samples (
    id              SERIAL PRIMARY KEY,
    market_pubkey   TEXT NOT NULL REFERENCES markets(pubkey),
    price_a         TEXT NOT NULL,
    price_b         TEXT NOT NULL,
    sample_count    INT NOT NULL,
    slot            BIGINT NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_twap_market ON twap_samples(market_pubkey);

-- ─── Graduations ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS graduations (
    id              SERIAL PRIMARY KEY,
    market_pubkey   TEXT NOT NULL REFERENCES markets(pubkey),
    side            SMALLINT NOT NULL,
    dex_pool        TEXT NOT NULL,
    sol_seeded      TEXT NOT NULL,
    tokens_seeded   TEXT NOT NULL,
    slot            BIGINT NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_grad_market ON graduations(market_pubkey);

-- ─── Indexer State ────────────────────────────────────────────────
-- Stores cursor positions and heartbeats for crash recovery
CREATE TABLE IF NOT EXISTS indexer_state (
    key             TEXT PRIMARY KEY,
    value           TEXT NOT NULL,
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Seed initial state rows
INSERT INTO indexer_state (key, value)
VALUES
    ('last_processed_slot', '0'),
    ('indexer_heartbeat', '0'),
    ('cranker_heartbeat', '0')
ON CONFLICT (key) DO NOTHING;

COMMIT;
