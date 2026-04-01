use anchor_lang::prelude::*;

use crate::errors::DuelError;
use crate::state::*;

#[derive(Accounts)]
pub struct CloseDeposit<'info> {
    /// Depositor receives rent back
    #[account(mut)]
    pub depositor: Signer<'info>,

    #[account(
        mut,
        close = depositor,
        constraint = deposit_record.depositor == depositor.key() @ DuelError::InvalidMarketConfig,
        constraint = deposit_record.withdrawn @ DuelError::DuelNotResolved,
    )]
    pub deposit_record: Account<'info, Deposit>,

    #[account(
        constraint = compare_duel.key() == deposit_record.duel @ DuelError::InvalidMarketConfig,
        constraint = compare_duel.status == MarketStatus::Resolved @ DuelError::DuelNotResolved,
    )]
    pub compare_duel: Account<'info, CompareDuel>,

    pub system_program: Program<'info, System>,
}

pub fn handler(_ctx: Context<CloseDeposit>) -> Result<()> {
    // All validation is in account constraints.
    // Anchor's `close = depositor` handles rent recovery.
    Ok(())
}
