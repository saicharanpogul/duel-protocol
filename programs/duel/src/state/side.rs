use anchor_lang::prelude::*;

/// Maximum TWAP samples stored per side (ring buffer size).
/// 360 samples at 5s intervals = 30 minutes of data.
pub const MAX_TWAP_SAMPLES: usize = 360;

#[account]
pub struct Side {
    /// Parent market PDA
    pub market: Pubkey,
    /// Side index (0 = A, 1 = B)
    pub side_index: u8,
    /// Token mint for this side
    pub token_mint: Pubkey,
    /// Vault holding unsold/returned tokens
    pub token_reserve_vault: Pubkey,
    /// Vault holding quote tokens (WSOL, USDC, etc.) from buys
    pub quote_reserve_vault: Pubkey,
    /// Fixed total supply (set at creation)
    pub total_supply: u64,
    /// Tokens currently held by participants
    pub circulating_supply: u64,
    /// Historical max quote reserve (for sell penalty calc)
    pub peak_reserve: u64,
    /// Sum of price samples for TWAP (u128 to prevent overflow)
    pub twap_accumulator: u128,
    /// Last observation value for lagging TWAP (0 if disabled or first sample)
    pub last_observation: u64,
    /// Accumulated sell penalty (quote tokens retained in vault beyond curve math)
    pub penalty_accumulated: u64,
    /// Ring buffer of price samples for trimmed-mean TWAP
    pub twap_samples: [u64; MAX_TWAP_SAMPLES],
    /// Write index into ring buffer (wraps at MAX_TWAP_SAMPLES)
    pub twap_write_index: u16,
    /// Number of samples written (saturates at MAX_TWAP_SAMPLES)
    pub twap_sample_count: u16,
    /// PDA bump
    pub bump: u8,
}

impl Side {
    pub const SIZE: usize = 8  // discriminator
        + 32  // market
        + 1   // side_index
        + 32  // token_mint
        + 32  // token_reserve_vault
        + 32  // quote_reserve_vault
        + 8   // total_supply
        + 8   // circulating_supply
        + 8   // peak_reserve
        + 16  // twap_accumulator
        + 8   // last_observation
        + 8   // penalty_accumulated
        + (8 * MAX_TWAP_SAMPLES)  // twap_samples ring buffer
        + 2   // twap_write_index
        + 2   // twap_sample_count
        + 1   // bump
        + 16; // padding
}

