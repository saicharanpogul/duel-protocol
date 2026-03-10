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

    // Calculate current spot prices
    let side_a = &mut ctx.accounts.side_a;
    let side_b = &mut ctx.accounts.side_b;

    let price_a = bonding_curve::price(side_a.circulating_supply, &market.curve_params)?;
    let price_b = bonding_curve::price(side_b.circulating_supply, &market.curve_params)?;

    // Determine observation values (lagging or raw)
    let max_change = market.max_observation_change_per_update;
    let (obs_a, obs_b) = if max_change > 0 {
        // Lagging observation: clamp toward spot price by at most max_change
        let obs_a = if market.twap_samples_count == 0 {
            // First sample: use raw price
            price_a
        } else {
            clamp_observation(side_a.last_observation, price_a, max_change)
        };
        let obs_b = if market.twap_samples_count == 0 {
            price_b
        } else {
            clamp_observation(side_b.last_observation, price_b, max_change)
        };
        // Store observations for next sample
        side_a.last_observation = obs_a;
        side_b.last_observation = obs_b;
        (obs_a, obs_b)
    } else {
        // Standard TWAP: use raw spot prices
        (price_a, price_b)
    };

    // Update accumulators with observation values
    side_a.twap_accumulator = side_a
        .twap_accumulator
        .checked_add(obs_a as u128)
        .ok_or(DuelError::MathOverflow)?;
    side_b.twap_accumulator = side_b
        .twap_accumulator
        .checked_add(obs_b as u128)
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
        observation_a: obs_a,
        observation_b: obs_b,
        sample_count: market.twap_samples_count,
        timestamp: now,
    });

    Ok(())
}

/// Clamp observation toward spot price by at most max_change per update.
/// If spot > observation: observation moves up by min(spot - observation, max_change)
/// If spot < observation: observation moves down by min(observation - spot, max_change)
fn clamp_observation(current_observation: u64, spot_price: u64, max_change: u64) -> u64 {
    if spot_price > current_observation {
        let delta = spot_price - current_observation;
        current_observation.saturating_add(delta.min(max_change))
    } else {
        let delta = current_observation - spot_price;
        current_observation.saturating_sub(delta.min(max_change))
    }
}
