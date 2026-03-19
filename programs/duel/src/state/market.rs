use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Debug)]
pub enum MarketStatus {
    Active,
    TwapObservation,
    Resolved,
}

#[account]
pub struct Market {
    /// Account version for future upgrades
    pub version: u8,
    /// PDA bump
    pub bump: u8,
    /// Market creator
    pub authority: Pubkey,
    /// Unique ID per creator
    pub market_id: u64,
    /// Side A PDA
    pub side_a: Pubkey,
    /// Side B PDA
    pub side_b: Pubkey,
    /// Quote token mint (WSOL)
    pub quote_mint: Pubkey,
    /// Unix timestamp deadline
    pub deadline: i64,
    /// TWAP observation window in seconds
    pub twap_window: u64,
    /// TWAP sampling interval in seconds
    pub twap_interval: u64,
    /// Creator fee recipient
    pub creator_fee_account: Pubkey,
    /// Protocol fee recipient
    pub protocol_fee_account: Pubkey,
    /// Current market status
    pub status: MarketStatus,
    /// Number of TWAP samples recorded
    pub twap_samples_count: u32,
    /// Timestamp of last TWAP sample
    pub last_sample_ts: i64,
    /// Winner side index (0 = A, 1 = B), None if not resolved or emergency draw
    pub winner: Option<u8>,
    /// Final TWAP for side A
    pub final_twap_a: u64,
    /// Final TWAP for side B
    pub final_twap_b: u64,
    /// Emergency resolution window in seconds after deadline
    pub emergency_window: u64,
    /// Re-entrancy lock
    pub locked: bool,
    /// Reserved for future fields
    pub _reserved: [u8; 128],
}

impl Market {
    pub const SIZE: usize = 8  // discriminator
        + 1   // version
        + 1   // bump
        + 32  // authority
        + 8   // market_id
        + 32  // side_a
        + 32  // side_b
        + 32  // quote_mint
        + 8   // deadline
        + 8   // twap_window
        + 8   // twap_interval
        + 32  // creator_fee_account
        + 32  // protocol_fee_account
        + 1   // status enum
        + 4   // twap_samples_count
        + 8   // last_sample_ts
        + 2   // winner (Option<u8>)
        + 8   // final_twap_a
        + 8   // final_twap_b
        + 8   // emergency_window
        + 1   // locked
        + 128; // _reserved
}
