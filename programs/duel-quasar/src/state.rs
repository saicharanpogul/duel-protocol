use quasar_lang::prelude::*;

// MarketStatus as u8 constants (enums can't be stored in account structs)
pub const STATUS_ACTIVE: u8 = 0;
pub const STATUS_TWAP_OBSERVATION: u8 = 1;
pub const STATUS_RESOLVED: u8 = 2;

#[account(discriminator = 1)]
pub struct Market {
    /// Account version for future upgrades
    pub version: u8,
    /// PDA bump
    pub bump: u8,
    /// Market creator
    pub authority: Address,
    /// Unique ID per creator
    pub market_id: u64,
    /// Side A PDA
    pub side_a: Address,
    /// Side B PDA
    pub side_b: Address,
    /// Quote token mint (WSOL)
    pub quote_mint: Address,
    /// Unix timestamp deadline
    pub deadline: i64,
    /// TWAP observation window in seconds
    pub twap_window: u64,
    /// TWAP sampling interval in seconds
    pub twap_interval: u64,
    /// Creator fee recipient
    pub creator_fee_account: Address,
    /// Protocol fee recipient
    pub protocol_fee_account: Address,
    /// Current market status (STATUS_ACTIVE / STATUS_TWAP_OBSERVATION / STATUS_RESOLVED)
    pub status: u8,
    /// Number of TWAP samples recorded
    pub twap_samples_count: u32,
    /// Timestamp of last TWAP sample
    pub last_sample_ts: i64,
    /// Whether a winner has been set (0 = no, 1 = yes)
    pub has_winner: u8,
    /// Winner side index (0 = A, 1 = B), only valid if has_winner == 1
    pub winner: u8,
    /// Final TWAP for side A
    pub final_twap_a: u64,
    /// Final TWAP for side B
    pub final_twap_b: u64,
    /// Emergency resolution window in seconds after deadline
    pub emergency_window: u64,
    /// Re-entrancy lock (0 = unlocked, 1 = locked)
    pub locked: u8,
    /// Reserved for future fields
    pub _reserved: [u8; 128],
}

#[account(discriminator = 2)]
pub struct Side {
    /// Parent market PDA
    pub market: Address,
    /// Side index (0 = A, 1 = B)
    pub side_index: u8,
    /// Token mint for this side
    pub token_mint: Address,
    /// Vault holding unsold/returned tokens
    pub token_reserve_vault: Address,
    /// Vault holding quote tokens (WSOL) from buys
    pub quote_reserve_vault: Address,
    /// Fixed total supply (set at creation)
    pub total_supply: u64,
    /// Tokens currently held by participants
    pub circulating_supply: u64,
    /// Sum of price samples for TWAP (u128 to prevent overflow)
    pub twap_accumulator: u128,
    /// PDA bump
    pub bump: u8,
    /// Reserved for future fields
    pub _reserved: [u8; 32],
}

#[account(discriminator = 3)]
pub struct ProgramConfig {
    /// Admin authority (can pause, update config, transfer admin)
    pub admin: Address,
    /// Emergency pause flag (0 = unpaused, 1 = paused)
    pub paused: u8,
    /// Protocol fee recipient (WSOL token account)
    pub protocol_fee_account: Address,
    /// Market creation fee in lamports (0 = free)
    pub market_creation_fee: u64,
    /// Minimum market duration in seconds
    pub min_market_duration: u64,
    /// Trade fee in basis points (applied to every buy/sell)
    pub trade_fee_bps: u16,
    /// Creator's share of trade fee in basis points (e.g., 5000 = 50%)
    pub creator_fee_split_bps: u16,
    /// PDA bump
    pub bump: u8,
    /// Reserved for future fields
    pub _reserved: [u8; 64],
}

/// Bonding curve parameters. Hardcoded via constants, not user-configurable.
/// Kept as a struct for math module compatibility.
pub struct CurveParams {
    /// Steepness coefficient (scaled by CURVE_SCALE)
    pub a: u64,
    /// Exponent (2 = quadratic)
    pub n: u8,
    /// Base price in lamports
    pub b: u64,
}

impl CurveParams {
    pub fn default_params() -> Self {
        use crate::constants::*;
        Self {
            a: CURVE_A,
            n: CURVE_N,
            b: CURVE_B,
        }
    }
}
