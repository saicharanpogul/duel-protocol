use anchor_lang::prelude::*;

/// Global protocol configuration, owned by admin.
/// PDA: [b"config"]
#[account]
pub struct ProgramConfig {
    /// Admin authority (can pause, update config, transfer admin)
    pub admin: Pubkey,
    /// Emergency pause flag
    pub paused: bool,
    /// Protocol fee recipient (WSOL token account)
    pub protocol_fee_account: Pubkey,
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

impl ProgramConfig {
    pub const SIZE: usize = 8  // discriminator
        + 32  // admin
        + 1   // paused
        + 32  // protocol_fee_account
        + 8   // market_creation_fee
        + 8   // min_market_duration
        + 2   // trade_fee_bps
        + 2   // creator_fee_split_bps
        + 1   // bump
        + 64; // _reserved
}
