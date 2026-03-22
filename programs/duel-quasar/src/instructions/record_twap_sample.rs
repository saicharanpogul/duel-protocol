use quasar_lang::prelude::*;
use quasar_lang::sysvars::Sysvar as SysvarTrait;

use crate::errors::DuelError;
use crate::events::TwapSampled;
use crate::math;
use crate::state::*;

#[derive(Accounts)]
pub struct RecordTwapSample<'info> {
    /// Anyone can crank (permissionless)
    pub cranker: &'info Signer,

    #[account(mut)]
    pub market: &'info mut Account<Market>,

    #[account(mut)]
    pub side_a: &'info mut Account<Side>,

    #[account(mut)]
    pub side_b: &'info mut Account<Side>,
}

impl<'info> RecordTwapSample<'info> {
    #[inline(always)]
    pub fn handler(&mut self) -> Result<(), ProgramError> {
        let clock = Clock::get()?;
        let now = clock.unix_timestamp.get();

        // Side validation
        require!(
            self.side_a.market == *self.market.to_account_view().address(),
            DuelError::InvalidSide
        );
        require!(self.side_a.side_index == 0, DuelError::InvalidSide);
        require!(
            self.side_b.market == *self.market.to_account_view().address(),
            DuelError::InvalidSide
        );
        require!(self.side_b.side_index == 1, DuelError::InvalidSide);

        // Must not be resolved
        require!(
            self.market.status != STATUS_RESOLVED,
            DuelError::MarketAlreadyResolved
        );

        // Must be within TWAP observation window
        let deadline = self.market.deadline.get();
        let twap_window = self.market.twap_window.get() as i64;
        let twap_start = deadline - twap_window;
        require!(now >= twap_start, DuelError::NotInTwapWindow);
        require!(now <= deadline, DuelError::MarketExpired);

        // Check interval since last sample
        let last_ts = self.market.last_sample_ts.get();
        if last_ts > 0 {
            let elapsed = now - last_ts;
            let interval = self.market.twap_interval.get() as i64;
            require!(elapsed >= interval, DuelError::TwapSampleTooEarly);
        }

        // Calculate current spot prices using default curve params
        let params = CurveParams::default_params();
        let supply_a = self.side_a.circulating_supply.get();
        let supply_b = self.side_b.circulating_supply.get();

        let price_a = math::price(supply_a, &params)?;
        let price_b = math::price(supply_b, &params)?;

        // Update accumulators with raw spot prices
        let acc_a = self.side_a.twap_accumulator.get();
        let new_acc_a = acc_a
            .checked_add(price_a as u128)
            .ok_or(DuelError::MathOverflow)?;
        self.side_a.twap_accumulator = PodU128::from(new_acc_a);

        let acc_b = self.side_b.twap_accumulator.get();
        let new_acc_b = acc_b
            .checked_add(price_b as u128)
            .ok_or(DuelError::MathOverflow)?;
        self.side_b.twap_accumulator = PodU128::from(new_acc_b);

        // Update market state
        let samples = self.market.twap_samples_count.get();
        let new_samples = samples
            .checked_add(1)
            .ok_or(DuelError::MathOverflow)?;
        self.market.twap_samples_count = PodU32::from(new_samples);
        self.market.last_sample_ts = PodI64::from(now);

        // Transition status if Active
        if self.market.status == STATUS_ACTIVE {
            self.market.status = STATUS_TWAP_OBSERVATION;
        }

        let market_key = *self.market.to_account_view().address();

        emit!(TwapSampled {
            market: market_key,
            price_a,
            price_b,
            sample_count: new_samples as u64,
            timestamp: now,
        });

        Ok(())
    }
}
