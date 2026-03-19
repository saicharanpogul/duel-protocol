use anchor_lang::prelude::*;

use crate::errors::DuelError;
use crate::events::EmergencyResolved;
use crate::state::{Market, MarketStatus, ProgramConfig, Side};

#[derive(Accounts)]
pub struct EmergencyResolve<'info> {
    /// Anyone can trigger emergency resolution after the window passes
    #[account(mut)]
    pub resolver: Signer<'info>,

    #[account(
        mut,
        constraint = market.status != MarketStatus::Resolved @ DuelError::MarketAlreadyResolved,
    )]
    pub market: Box<Account<'info, Market>>,

    /// Protocol config
    #[account(
        seeds = [b"config"],
        bump = config.bump,
    )]
    pub config: Account<'info, ProgramConfig>,

    #[account(
        mut,
        constraint = side_a.market == market.key() @ DuelError::InvalidSide,
        constraint = side_a.side_index == 0 @ DuelError::InvalidSide,
    )]
    pub side_a: Account<'info, Side>,

    #[account(
        mut,
        constraint = side_b.market == market.key() @ DuelError::InvalidSide,
        constraint = side_b.side_index == 1 @ DuelError::InvalidSide,
    )]
    pub side_b: Account<'info, Side>,
}

/// Emergency resolution -- draw fallback when TWAP cranking fails.
///
/// If `deadline + emergency_window` has passed and the market is still unresolved,
/// anyone can call this to resolve as a draw (winner = None).
/// Users can then sell their tokens at bonding curve rate via sell_post_resolution.
pub fn handler(ctx: Context<EmergencyResolve>) -> Result<()> {
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    let market = &ctx.accounts.market;

    // Must be past deadline
    require!(now >= market.deadline, DuelError::MarketNotExpired);

    // Must be past emergency window
    let emergency_deadline = market.deadline
        .checked_add(market.emergency_window as i64)
        .ok_or(DuelError::MathOverflow)?;
    require!(now >= emergency_deadline, DuelError::EmergencyResolveTooEarly);

    // Resolve as draw -- no winner, no battle tax
    let market = &mut ctx.accounts.market;
    market.status = MarketStatus::Resolved;
    market.winner = None; // Draw
    market.final_twap_a = 0;
    market.final_twap_b = 0;

    let market_key = market.key();
    emit!(EmergencyResolved {
        market: market_key,
        resolver: ctx.accounts.resolver.key(),
        timestamp: now,
    });

    Ok(())
}
