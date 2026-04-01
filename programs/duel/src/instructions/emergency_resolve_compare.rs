use anchor_lang::prelude::*;

use crate::errors::DuelError;
use crate::events::CompareResolved;
use crate::state::*;

#[derive(Accounts)]
pub struct EmergencyResolveCompare<'info> {
    /// Anyone can trigger emergency resolution after the window passes
    #[account(mut)]
    pub resolver: Signer<'info>,

    #[account(
        mut,
        constraint = compare_duel.status != MarketStatus::Resolved @ DuelError::MarketAlreadyResolved,
    )]
    pub compare_duel: Box<Account<'info, CompareDuel>>,

    /// Protocol config
    #[account(
        seeds = [b"config"],
        bump = config.bump,
    )]
    pub config: Account<'info, ProgramConfig>,
}

/// Emergency resolution for Compare Duel.
///
/// If `deadline + emergency_window` has passed and the duel is still unresolved,
/// anyone can call this to resolve as a draw (winner = None).
/// All depositors can then withdraw their full deposits.
pub fn handler(ctx: Context<EmergencyResolveCompare>) -> Result<()> {
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    let duel = &ctx.accounts.compare_duel;

    // Must be past deadline
    require!(now >= duel.deadline, DuelError::MarketNotExpired);

    // Must be past emergency window
    let emergency_deadline = duel
        .deadline
        .checked_add(duel.emergency_window as i64)
        .ok_or(DuelError::MathOverflow)?;
    require!(now >= emergency_deadline, DuelError::EmergencyResolveTooEarly);

    // Resolve as draw
    let total_pool = duel
        .side_a_total
        .checked_add(duel.side_b_total)
        .ok_or(DuelError::MathOverflow)?;

    let duel = &mut ctx.accounts.compare_duel;
    duel.status = MarketStatus::Resolved;
    duel.winner = None;
    duel.net_pool = total_pool; // Full refund, no fees on emergency draw

    let duel_key = duel.key();
    emit!(CompareResolved {
        duel: duel_key,
        winner: None,
        perf_a_bps: 0,
        perf_b_bps: 0,
        net_pool: total_pool,
    });

    Ok(())
}
