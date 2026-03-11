use anchor_lang::prelude::*;

use super::CurveParams;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Debug)]
pub enum MarketStatus {
    Active,
    TwapObservation,
    Resolved,
}

/// LP lock mode — configurable at market creation.
/// Determines whether LP liquidity can be withdrawn after graduation.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Debug)]
pub enum LpLockMode {
    /// LP can be withdrawn via remove_liquidity + close_position
    Unlocked = 0,
    /// LP is permanently locked at graduation — only fees are claimable
    PermanentLock = 1,
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
    /// Quote token mint (WSOL, USDC, etc.)
    pub quote_mint: Pubkey,
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
    /// Max observation change per TWAP update (0 = raw price, >0 = lagging filter)
    pub max_observation_change_per_update: u64,
    /// Min TWAP spread in bps to determine winner (0 = any difference, >0 = draw if below)
    pub min_twap_spread_bps: u16,
    /// Creator fee in basis points (deducted from transfer before protocol fee)
    pub creator_fee_bps: u16,
    /// Creator fee recipient
    pub creator_fee_account: Pubkey,
    /// Current market status
    pub status: MarketStatus,
    /// Number of TWAP samples recorded
    pub twap_samples_count: u32,
    /// Timestamp of last TWAP sample
    pub last_sample_ts: i64,
    /// Winner side index (0 = A, 1 = B), None if not resolved or draw
    pub winner: Option<u8>,
    /// Final TWAP for side A (quote token units, price * 10^9 for precision)
    pub final_twap_a: u64,
    /// Final TWAP for side B
    pub final_twap_b: u64,
    /// Protocol fee recipient
    pub protocol_fee_account: Pubkey,
    /// Whether Side A has graduated to DEX
    pub graduated_a: bool,
    /// Whether Side B has graduated to DEX
    pub graduated_b: bool,
    /// LP lock mode (set at creation, governs post-graduation LP behavior)
    pub lp_lock_mode: LpLockMode,
    /// Re-entrancy lock (prevents concurrent buy/sell during CPI)
    pub locked: bool,
    /// PDA bump
    pub bump: u8,
}

impl Market {
    pub const SIZE: usize = 8  // discriminator
        + 32  // authority
        + 8   // market_id
        + 32  // side_a
        + 32  // side_b
        + 32  // quote_mint
        + 8   // deadline
        + 8   // twap_window
        + 8   // twap_interval
        + 2   // battle_tax_bps
        + 2   // protocol_fee_bps
        + 2   // sell_penalty_max_bps
        + 8   // protection_activation_offset
        + (8 + 1 + 8)  // curve_params (a, n, b)
        + 8   // max_observation_change_per_update
        + 2   // min_twap_spread_bps
        + 2   // creator_fee_bps
        + 32  // creator_fee_account
        + 1   // status enum
        + 4   // twap_samples_count
        + 8   // last_sample_ts
        + (1 + 1)  // winner (Option<u8>)
        + 8   // final_twap_a
        + 8   // final_twap_b
        + 32  // protocol_fee_account
        + 1   // graduated_a
        + 1   // graduated_b
        + 1   // lp_lock_mode
        + 1   // locked
        + 1   // bump
        + 16; // padding (reduced for new fields)
}
