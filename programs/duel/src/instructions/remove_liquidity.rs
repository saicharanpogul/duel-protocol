use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::AccountMeta;
use anchor_spl::token_interface::TokenAccount;

use crate::cpi::meteora_damm::{self, RemoveLiquidityParams};
use crate::errors::DuelError;
use crate::state::*;

/// Remove liquidity from a Meteora DAMM v2 pool.
/// Only available when lp_lock_mode == Unlocked.
/// When PermanentLock, this instruction is blocked.
#[derive(Accounts)]
#[instruction(side: u8)]
pub struct RemoveLiquidity<'info> {
    /// Market creator or protocol admin
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        constraint = market.status == MarketStatus::Resolved @ DuelError::MarketNotResolved,
        constraint = market.lp_lock_mode == LpLockMode::Unlocked @ DuelError::LpLocked,
        constraint = market.authority == authority.key() || config.admin == authority.key() @ DuelError::InvalidMarketConfig,
    )]
    pub market: Box<Account<'info, Market>>,

    /// Protocol config (for admin check)
    #[account(
        seeds = [b"config"],
        bump = config.bump,
    )]
    pub config: Account<'info, ProgramConfig>,

    #[account(
        constraint = side_account.market == market.key() @ DuelError::InvalidSide,
    )]
    pub side_account: Account<'info, Side>,

    /// Token mint for this side
    /// CHECK: Validated via side_account
    pub token_mint: UncheckedAccount<'info>,

    /// WSOL mint
    /// CHECK: Validated by Meteora program
    pub wsol_mint: UncheckedAccount<'info>,

    // ─── Meteora DAMM v2 accounts ───

    /// CHECK: pool authority constant
    #[account(
        constraint = pool_authority.key() == meteora_damm::POOL_AUTHORITY @ DuelError::InvalidMarketConfig,
    )]
    pub pool_authority: UncheckedAccount<'info>,

    /// CHECK: Validated by Meteora
    #[account(mut)]
    pub pool: UncheckedAccount<'info>,

    /// CHECK: Validated by Meteora
    #[account(mut)]
    pub position: UncheckedAccount<'info>,

    /// Token A account to receive withdrawn tokens
    #[account(mut)]
    pub token_a_account: InterfaceAccount<'info, TokenAccount>,

    /// Token B account to receive withdrawn WSOL
    #[account(mut)]
    pub token_b_account: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: Validated by Meteora
    #[account(mut)]
    pub token_a_vault: UncheckedAccount<'info>,

    /// CHECK: Validated by Meteora
    #[account(mut)]
    pub token_b_vault: UncheckedAccount<'info>,

    /// Position NFT token account
    /// CHECK: Validated by Meteora
    pub position_nft_account: UncheckedAccount<'info>,

    /// Token A program
    /// CHECK: Validated by Meteora
    pub token_a_program: UncheckedAccount<'info>,

    /// Token B program
    /// CHECK: Validated by Meteora
    pub token_b_program: UncheckedAccount<'info>,

    /// Event authority PDA
    /// CHECK: Validated by Meteora
    pub event_authority: UncheckedAccount<'info>,

    /// CHECK: Validated against known program ID
    #[account(
        constraint = meteora_program.key() == meteora_damm::METEORA_DAMM_V2_PROGRAM_ID @ DuelError::InvalidMarketConfig,
    )]
    pub meteora_program: UncheckedAccount<'info>,
}

pub fn handler(
    ctx: Context<RemoveLiquidity>,
    side: u8,
    liquidity_delta: u128,
    min_token_a: u64,
    min_token_b: u64,
) -> Result<()> {
    require!(side <= 1, DuelError::InvalidSide);

    let market = &ctx.accounts.market;
    let graduated = if side == 0 { market.graduated_a } else { market.graduated_b };
    require!(graduated, DuelError::NotGraduated);

    // Market PDA signer seeds
    let authority_key = market.authority;
    let market_id_bytes = market.market_id.to_le_bytes();
    let bump = market.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        b"market",
        authority_key.as_ref(),
        &market_id_bytes,
        &[bump],
    ]];

    let account_metas = vec![
        AccountMeta::new_readonly(ctx.accounts.pool_authority.key(), false),
        AccountMeta::new(ctx.accounts.pool.key(), false),
        AccountMeta::new(ctx.accounts.position.key(), false),
        AccountMeta::new(ctx.accounts.token_a_account.key(), false),
        AccountMeta::new(ctx.accounts.token_b_account.key(), false),
        AccountMeta::new(ctx.accounts.token_a_vault.key(), false),
        AccountMeta::new(ctx.accounts.token_b_vault.key(), false),
        AccountMeta::new_readonly(ctx.accounts.token_mint.key(), false),
        AccountMeta::new_readonly(ctx.accounts.wsol_mint.key(), false),
        AccountMeta::new_readonly(ctx.accounts.position_nft_account.key(), false),
        AccountMeta::new_readonly(market.key(), true), // owner = market PDA
        AccountMeta::new_readonly(ctx.accounts.token_a_program.key(), false),
        AccountMeta::new_readonly(ctx.accounts.token_b_program.key(), false),
        AccountMeta::new_readonly(ctx.accounts.event_authority.key(), false),
        AccountMeta::new_readonly(ctx.accounts.meteora_program.key(), false),
    ];

    let account_infos = vec![
        ctx.accounts.pool_authority.to_account_info(),
        ctx.accounts.pool.to_account_info(),
        ctx.accounts.position.to_account_info(),
        ctx.accounts.token_a_account.to_account_info(),
        ctx.accounts.token_b_account.to_account_info(),
        ctx.accounts.token_a_vault.to_account_info(),
        ctx.accounts.token_b_vault.to_account_info(),
        ctx.accounts.token_mint.to_account_info(),
        ctx.accounts.wsol_mint.to_account_info(),
        ctx.accounts.position_nft_account.to_account_info(),
        ctx.accounts.market.to_account_info(),
        ctx.accounts.token_a_program.to_account_info(),
        ctx.accounts.token_b_program.to_account_info(),
        ctx.accounts.event_authority.to_account_info(),
        ctx.accounts.meteora_program.to_account_info(),
    ];

    meteora_damm::invoke_remove_liquidity(
        account_metas,
        account_infos,
        RemoveLiquidityParams {
            liquidity_delta,
            token_a_amount_threshold: min_token_a,
            token_b_amount_threshold: min_token_b,
        },
        signer_seeds,
    )?;

    Ok(())
}
