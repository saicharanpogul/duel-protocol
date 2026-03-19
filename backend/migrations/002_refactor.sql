-- Duel Protocol — Refactor migration
-- Aligns schema with refactored program events:
--   - MarketResolved now includes graduation data (TokensGraduated removed)
--   - battle_tax_bps and sell_penalty_max_bps removed from market account
--   - penalty_applied renamed to fee_amount in trades
--   - graduations table dropped (merged into markets)

BEGIN;

-- ─── Markets: remove obsolete columns ────────────────────────────
ALTER TABLE markets DROP COLUMN IF EXISTS battle_tax_bps;
ALTER TABLE markets DROP COLUMN IF EXISTS sell_penalty_max_bps;
ALTER TABLE markets DROP COLUMN IF EXISTS protocol_fee_bps;
ALTER TABLE markets DROP COLUMN IF EXISTS creator_fee_bps;
ALTER TABLE markets DROP COLUMN IF EXISTS battle_tax_collected;
ALTER TABLE markets DROP COLUMN IF EXISTS protocol_fee_collected;
ALTER TABLE markets DROP COLUMN IF EXISTS graduated_side;
ALTER TABLE markets DROP COLUMN IF EXISTS resolution_mode;

-- ─── Markets: add graduation columns from MarketResolved ─────────
ALTER TABLE markets ADD COLUMN IF NOT EXISTS sol_seeded TEXT DEFAULT '0';
ALTER TABLE markets ADD COLUMN IF NOT EXISTS tokens_seeded TEXT DEFAULT '0';
ALTER TABLE markets ADD COLUMN IF NOT EXISTS loser_reserve_transferred TEXT DEFAULT '0';

-- dex_pool already exists from 001, no action needed

-- ─── Trades: rename penalty_applied to fee_amount ────────────────
ALTER TABLE trades RENAME COLUMN penalty_applied TO fee_amount;

-- ─── Drop graduations table (merged into MarketResolved) ─────────
DROP TABLE IF EXISTS graduations;

COMMIT;
