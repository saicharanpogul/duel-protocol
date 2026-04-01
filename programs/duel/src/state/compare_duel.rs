use anchor_lang::prelude::*;

use crate::state::MarketStatus;

#[account]
pub struct CompareDuel {
    /// Account version for future upgrades
    pub version: u8,
    /// PDA bump
    pub bump: u8,
    /// Duel creator
    pub authority: Pubkey,
    /// Unique ID per creator
    pub duel_id: u64,
    /// Existing token mint A (e.g., $BONK)
    pub token_a_mint: Pubkey,
    /// Existing token mint B (e.g., $WIF)
    pub token_b_mint: Pubkey,
    /// Pyth price feed for token A
    pub oracle_a: Pubkey,
    /// Pyth price feed for token B
    pub oracle_b: Pubkey,
    /// WSOL vault for Side A deposits
    pub pool_vault_a: Pubkey,
    /// WSOL vault for Side B deposits
    pub pool_vault_b: Pubkey,
    /// Total SOL deposited on Side A (lamports)
    pub side_a_total: u64,
    /// Total SOL deposited on Side B (lamports)
    pub side_b_total: u64,
    /// Unix timestamp deadline
    pub deadline: i64,
    /// TWAP observation window in seconds
    pub twap_window: u64,
    /// TWAP sampling interval in seconds
    pub twap_interval: u64,
    /// Price at first TWAP sample for token A (scaled 10^9)
    pub start_price_a: u64,
    /// Price at first TWAP sample for token B (scaled 10^9)
    pub start_price_b: u64,
    /// TWAP price accumulator for token A
    pub twap_accumulator_a: u128,
    /// TWAP price accumulator for token B
    pub twap_accumulator_b: u128,
    /// Number of TWAP samples recorded
    pub twap_samples_count: u32,
    /// Timestamp of last TWAP sample
    pub last_sample_ts: i64,
    /// Current duel status (reuses Mode 1 MarketStatus enum)
    pub status: MarketStatus,
    /// Winner side index: None = draw/unresolved, Some(0) = A, Some(1) = B
    pub winner: Option<u8>,
    /// Total pool minus fees, set at resolution (used by withdraw)
    pub net_pool: u64,
    /// Minimum deposit in lamports
    pub min_deposit: u64,
    /// Creator fee recipient (WSOL token account)
    pub creator_fee_account: Pubkey,
    /// Protocol fee recipient (WSOL token account)
    pub protocol_fee_account: Pubkey,
    /// Emergency resolution window in seconds after deadline
    pub emergency_window: u64,
    /// Reserved for future fields
    pub _reserved: [u8; 64],
}

impl CompareDuel {
    pub const SIZE: usize = 8  // discriminator
        + 1   // version
        + 1   // bump
        + 32  // authority
        + 8   // duel_id
        + 32  // token_a_mint
        + 32  // token_b_mint
        + 32  // oracle_a
        + 32  // oracle_b
        + 32  // pool_vault_a
        + 32  // pool_vault_b
        + 8   // side_a_total
        + 8   // side_b_total
        + 8   // deadline
        + 8   // twap_window
        + 8   // twap_interval
        + 8   // start_price_a
        + 8   // start_price_b
        + 16  // twap_accumulator_a
        + 16  // twap_accumulator_b
        + 4   // twap_samples_count
        + 8   // last_sample_ts
        + 1   // status (enum)
        + 2   // winner (Option<u8>)
        + 8   // net_pool
        + 8   // min_deposit
        + 32  // creator_fee_account
        + 32  // protocol_fee_account
        + 8   // emergency_window
        + 64; // _reserved
}
