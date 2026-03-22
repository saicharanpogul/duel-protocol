use quasar_lang::prelude::*;

use crate::constants::*;
use crate::errors::DuelError;
use crate::events::ConfigUpdated;
use crate::state::ProgramConfig;

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    pub admin: &'info Signer,
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: &'info mut Account<ProgramConfig>,
    /// New protocol fee account. Pass Address::default() to skip update.
    pub new_protocol_fee_account: &'info UncheckedAccount,
    /// New admin. Pass Address::default() to skip update.
    pub new_admin: &'info UncheckedAccount,
}

impl<'info> UpdateConfig<'info> {
    #[inline(always)]
    pub fn handler(
        &mut self,
        paused: u8,
        trade_fee_bps: u16,
        creator_fee_split_bps: u16,
        market_creation_fee: u64,
        min_market_duration: u64,
    ) -> Result<(), ProgramError> {
        // Verify admin
        require!(
            self.config.admin == *self.admin.address(),
            DuelError::InvalidMarketConfig
        );

        // Update pause flag (0xff = no change sentinel)
        if paused <= 1 {
            self.config.paused = paused;
        }

        if trade_fee_bps > 0 {
            require!(trade_fee_bps <= MAX_TRADE_FEE_BPS, DuelError::InvalidFeeConfig);
            self.config.trade_fee_bps = PodU16::from(trade_fee_bps);
        }

        if creator_fee_split_bps > 0 {
            require!(
                creator_fee_split_bps <= BPS_DENOMINATOR as u16,
                DuelError::InvalidFeeConfig
            );
            self.config.creator_fee_split_bps = PodU16::from(creator_fee_split_bps);
        }

        if market_creation_fee > 0 {
            self.config.market_creation_fee = PodU64::from(market_creation_fee);
        }

        if min_market_duration > 0 {
            require!(
                min_market_duration >= MIN_MARKET_DURATION,
                DuelError::InvalidMarketConfig
            );
            self.config.min_market_duration = PodU64::from(min_market_duration);
        }

        // Update protocol fee account if non-default address provided
        let new_fee_addr = self.new_protocol_fee_account.address();
        if *new_fee_addr != Address::default() {
            self.config.protocol_fee_account = *new_fee_addr;
        }

        // Update admin if non-default address provided
        let new_admin_addr = self.new_admin.address();
        if *new_admin_addr != Address::default() {
            self.config.admin = *new_admin_addr;
        }

        emit!(ConfigUpdated {
            admin: self.config.admin,
            paused: self.config.paused as u64,
            trade_fee_bps: self.config.trade_fee_bps.get() as u64,
            creator_fee_split_bps: self.config.creator_fee_split_bps.get() as u64,
            market_creation_fee: self.config.market_creation_fee.get(),
        });

        Ok(())
    }
}
