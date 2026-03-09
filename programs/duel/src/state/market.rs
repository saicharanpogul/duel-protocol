use anchor_lang::prelude::*;

use super::CurveParams;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Debug)]
pub enum MarketStatus {
    Active,
    TwapObservation,
    Resolved,
}

#[account]
pub struct Market {
    /// Market creator
    pub authority: Pubkey,
    /// Unique ID per creator
    pub market_id: u64,
    /// Side A PDA
    pub side_a: Pubkey,
    /// Side B PDA
    pub side_b: Pubkey,
    /// Unix timestamp deadline
    pub deadline: i64,
    /// TWAP observation window in seconds
    pub twap_window: u64,
    /// TWAP sampling interval in seconds
    pub twap_interval: u64,
    /// Battle tax in basis points (0-10000)
    pub battle_tax_bps: u16,
    /// Protocol fee in basis points (0-500)
    pub protocol_fee_bps: u16,
    /// Max sell penalty in basis points (0-3000)
    pub sell_penalty_max_bps: u16,
    /// Seconds before deadline when sell penalty activates
    pub protection_activation_offset: u64,
    /// Bonding curve parameters
    pub curve_params: CurveParams,
    /// Current market status
    pub status: MarketStatus,
    /// Number of TWAP samples recorded
    pub twap_samples_count: u32,
    /// Timestamp of last TWAP sample
    pub last_sample_ts: i64,
    /// Winner side index (0 = A, 1 = B), None if not resolved
    pub winner: Option<u8>,
    /// Final TWAP for side A (lamports, price * 10^9 for precision)
    pub final_twap_a: u64,
    /// Final TWAP for side B
    pub final_twap_b: u64,
    /// Protocol fee recipient
    pub protocol_fee_account: Pubkey,
    /// Whether Side A has graduated to DEX
    pub graduated_a: bool,
    /// Whether Side B has graduated to DEX
    pub graduated_b: bool,
    /// PDA bump
    pub bump: u8,
}

impl Market {
    pub const SIZE: usize = 8  // discriminator
        + 32  // authority
        + 8   // market_id
        + 32  // side_a
        + 32  // side_b
        + 8   // deadline
        + 8   // twap_window
        + 8   // twap_interval
        + 2   // battle_tax_bps
        + 2   // protocol_fee_bps
        + 2   // sell_penalty_max_bps
        + 8   // protection_activation_offset
        + (8 + 1 + 8)  // curve_params (a, n, b)
        + 1   // status enum
        + 4   // twap_samples_count
        + 8   // last_sample_ts
        + (1 + 1)  // winner (Option<u8>)
        + 8   // final_twap_a
        + 8   // final_twap_b
        + 32  // protocol_fee_account
        + 1   // graduated_a
        + 1   // graduated_b
        + 1   // bump
        + 62; // padding (reduced from 64)
}
