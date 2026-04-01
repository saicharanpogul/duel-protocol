use anchor_lang::prelude::*;

#[account]
pub struct Deposit {
    /// Parent CompareDuel PDA
    pub duel: Pubkey,
    /// Depositor wallet
    pub depositor: Pubkey,
    /// Side index: 0 = A, 1 = B
    pub side: u8,
    /// SOL deposited (lamports)
    pub amount: u64,
    /// Whether the deposit has been withdrawn
    pub withdrawn: bool,
    /// PDA bump
    pub bump: u8,
}

impl Deposit {
    pub const SIZE: usize = 8  // discriminator
        + 32  // duel
        + 32  // depositor
        + 1   // side
        + 8   // amount
        + 1   // withdrawn
        + 1;  // bump
}
