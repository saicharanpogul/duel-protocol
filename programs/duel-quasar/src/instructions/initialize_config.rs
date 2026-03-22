use quasar_lang::prelude::*;

use crate::constants::*;
use crate::errors::DuelError;
use crate::events::ConfigUpdated;
use crate::state::ProgramConfig;

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    pub admin: &'info mut Signer,
    #[account(init, payer = admin, seeds = [b"config"], bump)]
    pub config: &'info mut Account<ProgramConfig>,
    /// Protocol fee recipient
    pub protocol_fee_account: &'info UncheckedAccount,
    pub system_program: &'info Program<System>,
    pub rent: &'info Sysvar<Rent>,
}

impl<'info> InitializeConfig<'info> {
    #[inline(always)]
    pub fn handler(
        &mut self,
        trade_fee_bps: u16,
        creator_fee_split_bps: u16,
        market_creation_fee: u64,
        bumps: &InitializeConfigBumps,
    ) -> Result<(), ProgramError> {
        require!(
            trade_fee_bps <= MAX_TRADE_FEE_BPS,
            DuelError::InvalidFeeConfig
        );
        require!(
            creator_fee_split_bps <= BPS_DENOMINATOR as u16,
            DuelError::InvalidFeeConfig
        );

        self.config.admin = *self.admin.address();
        self.config.paused = 0;
        self.config.protocol_fee_account = *self.protocol_fee_account.address();
        self.config.market_creation_fee = PodU64::from(market_creation_fee);
        self.config.min_market_duration = PodU64::from(MIN_MARKET_DURATION);
        self.config.trade_fee_bps = PodU16::from(trade_fee_bps);
        self.config.creator_fee_split_bps = PodU16::from(creator_fee_split_bps);
        self.config.bump = bumps.config;
        self.config._reserved = [0u8; 64];

        emit!(ConfigUpdated {
            admin: *self.admin.address(),
            paused: 0,
            trade_fee_bps: trade_fee_bps as u64,
            creator_fee_split_bps: creator_fee_split_bps as u64,
            market_creation_fee,
        });

        Ok(())
    }
}
