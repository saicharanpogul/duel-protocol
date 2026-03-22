use quasar_lang::prelude::*;
use quasar_lang::sysvars::Sysvar as SysvarTrait;

use crate::errors::DuelError;
use crate::events::EmergencyResolved;
use crate::state::*;

#[derive(Accounts)]
pub struct EmergencyResolve<'info> {
    /// Anyone can trigger emergency resolution after the window passes
    pub resolver: &'info mut Signer,

    #[account(mut)]
    pub market: &'info mut Account<Market>,

    /// Protocol config
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: &'info Account<ProgramConfig>,

    #[account(mut)]
    pub side_a: &'info mut Account<Side>,

    #[account(mut)]
    pub side_b: &'info mut Account<Side>,
}

impl<'info> EmergencyResolve<'info> {
    #[inline(always)]
    pub fn handler(&mut self) -> Result<(), ProgramError> {
        let clock = Clock::get()?;
        let now = clock.unix_timestamp.get();

        // Status check
        require!(
            self.market.status != STATUS_RESOLVED,
            DuelError::MarketAlreadyResolved
        );

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

        let deadline = self.market.deadline.get();

        // Must be past deadline
        require!(now >= deadline, DuelError::MarketNotExpired);

        // Must be past emergency window
        let emergency_window = self.market.emergency_window.get() as i64;
        let emergency_deadline = deadline
            .checked_add(emergency_window)
            .ok_or(DuelError::MathOverflow)?;
        require!(now >= emergency_deadline, DuelError::EmergencyResolveTooEarly);

        // Resolve as draw -- no winner, no battle tax
        self.market.status = STATUS_RESOLVED;
        self.market.has_winner = 0;
        self.market.winner = 0;
        self.market.final_twap_a = PodU64::from(0u64);
        self.market.final_twap_b = PodU64::from(0u64);

        let market_key = *self.market.to_account_view().address();

        emit!(EmergencyResolved {
            market: market_key,
            resolver: *self.resolver.address(),
            timestamp: now,
        });

        Ok(())
    }
}
