use anchor_lang::prelude::*;

/// Global protocol configuration, owned by admin.
/// PDA: [b"config"]
#[account]
pub struct ProgramConfig {
    /// Admin authority (can pause, update config, transfer admin)
    pub admin: Pubkey,
    /// Emergency pause flag
    pub paused: bool,
    /// Default protocol fee in basis points
    pub default_protocol_fee_bps: u16,
    /// Protocol fee recipient
    pub protocol_fee_account: Pubkey,
    /// Market creation fee in lamports (0 = free)
    pub market_creation_fee: u64,
    /// Minimum market duration in seconds (admin-configurable)
    pub min_market_duration: u64,
    /// PDA bump
    pub bump: u8,
}

impl ProgramConfig {
    pub const SIZE: usize = 8  // discriminator
        + 32  // admin
        + 1   // paused
        + 2   // default_protocol_fee_bps
        + 32  // protocol_fee_account
        + 8   // market_creation_fee
        + 8   // min_market_duration
        + 1   // bump
        + 24; // padding (reduced from 32)
}
