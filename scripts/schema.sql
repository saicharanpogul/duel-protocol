-- ═══════════════════════════════════════════════
-- DUELS PROTOCOL — Supabase Schema
-- Run this in your Supabase SQL editor
-- ═══════════════════════════════════════════════

-- Markets table
CREATE TABLE IF NOT EXISTS markets (
  id BIGSERIAL PRIMARY KEY,
  pubkey TEXT UNIQUE NOT NULL,
  authority TEXT NOT NULL,
  name_a TEXT NOT NULL,
  name_b TEXT NOT NULL,
  symbol_a TEXT NOT NULL,
  symbol_b TEXT NOT NULL,
  deadline BIGINT NOT NULL,
  battle_tax_bps INT NOT NULL DEFAULT 0,
  protocol_fee_bps INT NOT NULL DEFAULT 0,
  sell_penalty_max_bps INT NOT NULL DEFAULT 0,
  twap_window BIGINT NOT NULL DEFAULT 0,
  twap_interval BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active', -- active, twap, resolved
  winner INT, -- 0 = side A, 1 = side B, NULL = unresolved
  reserve_a BIGINT NOT NULL DEFAULT 0,
  reserve_b BIGINT NOT NULL DEFAULT 0,
  side_a_pubkey TEXT,
  side_b_pubkey TEXT,
  token_mint_a TEXT,
  token_mint_b TEXT,
  circulating_a BIGINT NOT NULL DEFAULT 0,
  circulating_b BIGINT NOT NULL DEFAULT 0,
  final_twap_a BIGINT,
  final_twap_b BIGINT,
  battle_tax_collected BIGINT,
  protocol_fee_collected BIGINT,
  graduated_side INT, -- which side graduated (0 or 1)
  dex_pool TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trades table
CREATE TABLE IF NOT EXISTS trades (
  id BIGSERIAL PRIMARY KEY,
  market_pubkey TEXT NOT NULL REFERENCES markets(pubkey),
  side INT NOT NULL, -- 0 = A, 1 = B
  trader TEXT NOT NULL,
  trade_type TEXT NOT NULL, -- 'buy' or 'sell'
  sol_amount BIGINT NOT NULL DEFAULT 0,
  token_amount BIGINT NOT NULL DEFAULT 0,
  price_after BIGINT NOT NULL DEFAULT 0,
  penalty_applied BIGINT NOT NULL DEFAULT 0,
  slot BIGINT NOT NULL DEFAULT 0,
  tx_signature TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- TWAP Samples
CREATE TABLE IF NOT EXISTS twap_samples (
  id BIGSERIAL PRIMARY KEY,
  market_pubkey TEXT NOT NULL REFERENCES markets(pubkey),
  price_a BIGINT NOT NULL,
  price_b BIGINT NOT NULL,
  sample_count INT NOT NULL,
  slot BIGINT NOT NULL DEFAULT 0,
  sampled_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- DEX Graduations
CREATE TABLE IF NOT EXISTS graduations (
  id BIGSERIAL PRIMARY KEY,
  market_pubkey TEXT NOT NULL REFERENCES markets(pubkey),
  side INT NOT NULL,
  dex_pool TEXT NOT NULL,
  sol_seeded BIGINT NOT NULL,
  tokens_seeded BIGINT NOT NULL,
  slot BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ═══════════ Indexes ═══════════

-- Markets: filter by status, sort by created_at/deadline
CREATE INDEX IF NOT EXISTS idx_markets_status ON markets(status);
CREATE INDEX IF NOT EXISTS idx_markets_created_at ON markets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_markets_deadline ON markets(deadline);
CREATE INDEX IF NOT EXISTS idx_markets_authority ON markets(authority);

-- Trades: queries by market, by trader, recent trades
CREATE INDEX IF NOT EXISTS idx_trades_market ON trades(market_pubkey, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trades_trader ON trades(trader, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trades_recent ON trades(created_at DESC);

-- TWAP: by market
CREATE INDEX IF NOT EXISTS idx_twap_market ON twap_samples(market_pubkey, sampled_at DESC);

-- Graduations: by market
CREATE INDEX IF NOT EXISTS idx_grad_market ON graduations(market_pubkey);

-- ═══════════ Row Level Security ═══════════

ALTER TABLE markets ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE twap_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE graduations ENABLE ROW LEVEL SECURITY;

-- Public read access (anon key can read)
CREATE POLICY "Public read markets" ON markets FOR SELECT USING (true);
CREATE POLICY "Public read trades" ON trades FOR SELECT USING (true);
CREATE POLICY "Public read twap" ON twap_samples FOR SELECT USING (true);
CREATE POLICY "Public read graduations" ON graduations FOR SELECT USING (true);

-- Only service_role can write (indexer uses service_role key)
CREATE POLICY "Service write markets" ON markets FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service write trades" ON trades FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service write twap" ON twap_samples FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service write graduations" ON graduations FOR ALL USING (true) WITH CHECK (true);

-- ═══════════ Updated_at trigger ═══════════

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER markets_updated_at
  BEFORE UPDATE ON markets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
