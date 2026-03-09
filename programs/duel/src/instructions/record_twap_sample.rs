use anchor_lang::prelude::*;

use crate::errors::DuelError;
use crate::events::TwapSampled;
use crate::math::bonding_curve;
use crate::state::*;

#[derive(Accounts)]
pub struct RecordTwapSample<'info> {
    /// Anyone can crank (permissionless)
    pub cranker: Signer<'info>,

    #[account(mut)]
    pub market: Account<'info, Market>,

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

pub fn handler(ctx: Context<RecordTwapSample>) -> Result<()> {
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    let market = &mut ctx.accounts.market;

    // Must not be resolved
    require!(market.status != MarketStatus::Resolved, DuelError::MarketAlreadyResolved);

    // Must be within TWAP observation window
    let twap_start = market.deadline - (market.twap_window as i64);
    require!(now >= twap_start, DuelError::NotInTwapWindow);
    require!(now <= market.deadline, DuelError::MarketExpired);

    // Check interval since last sample
    if market.last_sample_ts > 0 {
        let elapsed = now - market.last_sample_ts;
        require!(elapsed >= market.twap_interval as i64, DuelError::TwapSampleTooEarly);
    }

    // Calculate current prices
    let side_a = &mut ctx.accounts.side_a;
    let side_b = &mut ctx.accounts.side_b;

    let price_a = bonding_curve::price(side_a.circulating_supply, &market.curve_params)?;
    let price_b = bonding_curve::price(side_b.circulating_supply, &market.curve_params)?;

    // Update accumulators
    side_a.twap_accumulator = side_a
        .twap_accumulator
        .checked_add(price_a as u128)
        .ok_or(DuelError::MathOverflow)?;
    side_b.twap_accumulator = side_b
        .twap_accumulator
        .checked_add(price_b as u128)
        .ok_or(DuelError::MathOverflow)?;

    // Update market state
    market.twap_samples_count = market
        .twap_samples_count
        .checked_add(1)
        .ok_or(DuelError::MathOverflow)?;
    market.last_sample_ts = now;

    // Transition status if Active
    if market.status == MarketStatus::Active {
        market.status = MarketStatus::TwapObservation;
    }

    emit!(TwapSampled {
        market: market.key(),
        price_a,
        price_b,
        sample_count: market.twap_samples_count,
        timestamp: now,
    });

    Ok(())
}
