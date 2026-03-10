use anchor_lang::prelude::*;

use crate::errors::DuelError;
use crate::state::*;

#[derive(Accounts)]
#[instruction(side: u8)]
pub struct CloseMarket<'info> {
    /// Market creator or protocol admin
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        close = authority,
        constraint = market.status == MarketStatus::Resolved @ DuelError::MarketNotResolved,
        constraint = market.authority == authority.key() || config.admin == authority.key() @ DuelError::InvalidMarketConfig,
    )]
    pub market: Account<'info, Market>,

    #[account(
        mut,
        close = authority,
        constraint = side_a.market == market.key() @ DuelError::InvalidSide,
        constraint = side_a.side_index == 0 @ DuelError::InvalidSide,
        constraint = side_a.circulating_supply == 0 @ DuelError::InsufficientTokenBalance,
    )]
    pub side_a: Account<'info, Side>,

    #[account(
        mut,
        close = authority,
        constraint = side_b.market == market.key() @ DuelError::InvalidSide,
        constraint = side_b.side_index == 1 @ DuelError::InvalidSide,
        constraint = side_b.circulating_supply == 0 @ DuelError::InsufficientTokenBalance,
    )]
    pub side_b: Account<'info, Side>,

    /// Protocol config (for admin check)
    #[account(
        seeds = [b"config"],
        bump = config.bump,
    )]
    pub config: Account<'info, ProgramConfig>,

    pub system_program: Program<'info, System>,
}

pub fn handler(_ctx: Context<CloseMarket>, _side: u8) -> Result<()> {
    // All validation is in account constraints.
    // Anchor's `close = authority` handles rent recovery.
    Ok(())
}
