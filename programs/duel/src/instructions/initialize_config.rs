use anchor_lang::prelude::*;

use crate::constants::MAX_PROTOCOL_FEE_BPS;
use crate::errors::DuelError;
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
    default_protocol_fee_bps: u16,
    market_creation_fee: u64,
) -> Result<()> {
    require!(
        default_protocol_fee_bps <= MAX_PROTOCOL_FEE_BPS,
        DuelError::InvalidFeeConfig
    );

    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.admin.key();
    config.paused = false;
    config.default_protocol_fee_bps = default_protocol_fee_bps;
    config.protocol_fee_account = ctx.accounts.protocol_fee_account.key();
    config.market_creation_fee = market_creation_fee;
    config.min_market_duration = crate::constants::MIN_MARKET_DURATION;
    config.bump = ctx.bumps.config;

    Ok(())
}
