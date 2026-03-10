use anchor_lang::prelude::*;

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
    /// Vault holding SOL from buys
    pub sol_reserve_vault: Pubkey,
    /// Fixed total supply (set at creation)
    pub total_supply: u64,
    /// Tokens currently held by participants
    pub circulating_supply: u64,
    /// Historical max SOL reserve (for sell penalty calc)
    pub peak_reserve: u64,
    /// Sum of price samples for TWAP (u128 to prevent overflow)
    pub twap_accumulator: u128,
    /// Last observation value for lagging TWAP (0 if disabled or first sample)
    pub last_observation: u64,
    /// PDA bump
    pub bump: u8,
}

impl Side {
    pub const SIZE: usize = 8  // discriminator
        + 32  // market
        + 1   // side_index
        + 32  // token_mint
        + 32  // token_reserve_vault
        + 32  // sol_reserve_vault
        + 8   // total_supply
        + 8   // circulating_supply
        + 8   // peak_reserve
        + 16  // twap_accumulator
        + 8   // last_observation
        + 1   // bump
        + 24; // padding (reduced from 32)
}
