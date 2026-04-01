use anchor_lang::prelude::*;

use crate::errors::DuelError;
use crate::events::CompareTwapSampled;
use crate::math::oracle;
use crate::state::*;

#[derive(Accounts)]
pub struct RecordCompareTwap<'info> {
    /// Anyone can crank (permissionless)
    pub cranker: Signer<'info>,

    #[account(mut)]
    pub compare_duel: Box<Account<'info, CompareDuel>>,

    /// Pyth price feed account for token A
    /// CHECK: Validated against compare_duel.oracle_a and by Pyth magic number
    #[account(
        constraint = oracle_a.key() == compare_duel.oracle_a @ DuelError::InvalidOracle,
    )]
    pub oracle_a: UncheckedAccount<'info>,

    /// Pyth price feed account for token B
    /// CHECK: Validated against compare_duel.oracle_b and by Pyth magic number
    #[account(
        constraint = oracle_b.key() == compare_duel.oracle_b @ DuelError::InvalidOracle,
    )]
    pub oracle_b: UncheckedAccount<'info>,
}

pub fn handler(ctx: Context<RecordCompareTwap>) -> Result<()> {
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    let duel = &mut ctx.accounts.compare_duel;

    // Must not be resolved
    require!(
        duel.status != MarketStatus::Resolved,
        DuelError::MarketAlreadyResolved
    );

    // Must be within TWAP observation window
    let twap_start = duel
        .deadline
        .checked_sub(duel.twap_window as i64)
        .ok_or(DuelError::MathOverflow)?;
    require!(now >= twap_start, DuelError::NotInTwapWindow);
    require!(now <= duel.deadline, DuelError::MarketExpired);

    // Check interval since last sample
    if duel.last_sample_ts > 0 {
        let elapsed = now
            .checked_sub(duel.last_sample_ts)
            .ok_or(DuelError::MathOverflow)?;
        require!(
            elapsed >= duel.twap_interval as i64,
            DuelError::TwapSampleTooEarly
        );
    }

    // Read and validate oracle prices
    let oracle_a_data = ctx.accounts.oracle_a.try_borrow_data()?;
    let price_a = oracle::get_oracle_price(&oracle_a_data)?;
    drop(oracle_a_data);

    let oracle_b_data = ctx.accounts.oracle_b.try_borrow_data()?;
    let price_b = oracle::get_oracle_price(&oracle_b_data)?;
    drop(oracle_b_data);

    // First sample: record start prices
    if duel.twap_samples_count == 0 {
        duel.start_price_a = price_a;
        duel.start_price_b = price_b;
    }

    // Accumulate TWAP
    duel.twap_accumulator_a = duel
        .twap_accumulator_a
        .checked_add(price_a as u128)
        .ok_or(DuelError::MathOverflow)?;
    duel.twap_accumulator_b = duel
        .twap_accumulator_b
        .checked_add(price_b as u128)
        .ok_or(DuelError::MathOverflow)?;

    // Update sample tracking
    duel.twap_samples_count = duel
        .twap_samples_count
        .checked_add(1)
        .ok_or(DuelError::MathOverflow)?;
    duel.last_sample_ts = now;

    // Transition status if Active
    if duel.status == MarketStatus::Active {
        duel.status = MarketStatus::TwapObservation;
    }

    let duel_key = duel.key();
    emit!(CompareTwapSampled {
        duel: duel_key,
        price_a,
        price_b,
        sample_count: duel.twap_samples_count,
        timestamp: now,
    });

    Ok(())
}
