use anchor_lang::prelude::*;

use crate::constants::MAX_PROTOCOL_FEE_BPS;
use crate::errors::DuelError;
use crate::state::ProgramConfig;

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    #[account(
        constraint = admin.key() == config.admin @ DuelError::InvalidMarketConfig,
    )]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"config"],
        bump = config.bump,
    )]
    pub config: Account<'info, ProgramConfig>,

    /// CHECK: Optional new protocol fee account, only used if provided
    pub new_protocol_fee_account: Option<UncheckedAccount<'info>>,

    /// CHECK: Optional new admin, only used if provided
    pub new_admin: Option<UncheckedAccount<'info>>,
}

pub fn handler(
    ctx: Context<UpdateConfig>,
    paused: Option<bool>,
    default_protocol_fee_bps: Option<u16>,
    market_creation_fee: Option<u64>,
    min_market_duration: Option<u64>,
) -> Result<()> {
    let config = &mut ctx.accounts.config;

    if let Some(paused_val) = paused {
        config.paused = paused_val;
    }

    if let Some(fee_bps) = default_protocol_fee_bps {
        require!(fee_bps <= MAX_PROTOCOL_FEE_BPS, DuelError::InvalidFeeConfig);
        config.default_protocol_fee_bps = fee_bps;
    }

    if let Some(fee) = market_creation_fee {
        config.market_creation_fee = fee;
    }

    if let Some(duration) = min_market_duration {
        require!(duration >= 10, DuelError::InvalidMarketConfig); // minimum 10 seconds
        config.min_market_duration = duration;
    }

    if let Some(ref new_fee_account) = ctx.accounts.new_protocol_fee_account {
        config.protocol_fee_account = new_fee_account.key();
    }

    if let Some(ref new_admin_account) = ctx.accounts.new_admin {
        config.admin = new_admin_account.key();
    }

    Ok(())
}
