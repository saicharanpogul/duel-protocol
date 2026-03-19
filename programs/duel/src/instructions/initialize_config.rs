use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::DuelError;
use crate::events::ConfigUpdated;
use crate::state::ProgramConfig;

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = ProgramConfig::SIZE,
        seeds = [b"config"],
        bump,
    )]
    pub config: Account<'info, ProgramConfig>,

    /// CHECK: Protocol fee recipient, stored in config
    pub protocol_fee_account: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitializeConfig>,
    trade_fee_bps: u16,
    creator_fee_split_bps: u16,
    market_creation_fee: u64,
) -> Result<()> {
    require!(
        trade_fee_bps <= MAX_TRADE_FEE_BPS,
        DuelError::InvalidFeeConfig
    );
    require!(
        creator_fee_split_bps <= BPS_DENOMINATOR as u16,
        DuelError::InvalidFeeConfig
    );

    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.admin.key();
    config.paused = false;
    config.protocol_fee_account = ctx.accounts.protocol_fee_account.key();
    config.market_creation_fee = market_creation_fee;
    config.min_market_duration = MIN_MARKET_DURATION;
    config.trade_fee_bps = trade_fee_bps;
    config.creator_fee_split_bps = creator_fee_split_bps;
    config.bump = ctx.bumps.config;
    config._reserved = [0u8; 64];

    emit!(ConfigUpdated {
        admin: config.admin,
        paused: config.paused,
        trade_fee_bps: config.trade_fee_bps,
        creator_fee_split_bps: config.creator_fee_split_bps,
        market_creation_fee: config.market_creation_fee,
    });

    Ok(())
}
