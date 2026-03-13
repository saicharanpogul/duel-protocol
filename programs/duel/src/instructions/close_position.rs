use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::AccountMeta;

use crate::cpi::meteora_damm;
use crate::errors::DuelError;
use crate::state::*;

/// Close a Meteora DAMM v2 position — burns position NFT, closes position account.
/// Only available when lp_lock_mode == Unlocked and position is empty.
#[derive(Accounts)]
#[instruction(side: u8)]
pub struct ClosePosition<'info> {
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

    // ─── Meteora DAMM v2 accounts ───

    /// Position NFT mint (mut)
    /// CHECK: Validated by Meteora
    #[account(mut)]
    pub position_nft_mint: UncheckedAccount<'info>,

    /// Position NFT token account (mut)
    /// CHECK: Validated by Meteora
    #[account(mut)]
    pub position_nft_account: UncheckedAccount<'info>,

    /// Pool (mut)
    /// CHECK: Validated by Meteora
    #[account(mut)]
    pub pool: UncheckedAccount<'info>,

    /// Position (mut, close)
    /// CHECK: Validated by Meteora
    #[account(mut)]
    pub position: UncheckedAccount<'info>,

    /// Pool authority
    /// CHECK: Validated against known address
    #[account(
        constraint = pool_authority.key() == meteora_damm::POOL_AUTHORITY @ DuelError::InvalidMarketConfig,
    )]
    pub pool_authority: UncheckedAccount<'info>,

    /// Rent receiver
    /// CHECK: Receives rent from closed accounts
    #[account(mut)]
    pub rent_receiver: UncheckedAccount<'info>,

    /// Token-2022 program (for NFT burning)
    /// CHECK: Validated against known program ID
    #[account(
        constraint = token_2022_program.key() == meteora_damm::TOKEN_2022_PROGRAM_ID @ DuelError::InvalidMarketConfig,
    )]
    pub token_2022_program: UncheckedAccount<'info>,

    /// Event authority PDA
    /// CHECK: Validated by Meteora
    pub event_authority: UncheckedAccount<'info>,

    /// Meteora DAMM v2 program
    /// CHECK: Validated against known program ID
    #[account(
        constraint = meteora_program.key() == meteora_damm::METEORA_DAMM_V2_PROGRAM_ID @ DuelError::InvalidMarketConfig,
    )]
    pub meteora_program: UncheckedAccount<'info>,
}

pub fn handler(ctx: Context<ClosePosition>, side: u8) -> Result<()> {
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
        AccountMeta::new(ctx.accounts.position_nft_mint.key(), false),
        AccountMeta::new(ctx.accounts.position_nft_account.key(), false),
        AccountMeta::new(ctx.accounts.pool.key(), false),
        AccountMeta::new(ctx.accounts.position.key(), false),
        AccountMeta::new_readonly(ctx.accounts.pool_authority.key(), false),
        AccountMeta::new(ctx.accounts.rent_receiver.key(), false),
        AccountMeta::new_readonly(market.key(), true), // owner = market PDA
        AccountMeta::new_readonly(ctx.accounts.token_2022_program.key(), false),
        AccountMeta::new_readonly(ctx.accounts.event_authority.key(), false),
        AccountMeta::new_readonly(ctx.accounts.meteora_program.key(), false),
    ];

    let account_infos = vec![
        ctx.accounts.position_nft_mint.to_account_info(),
        ctx.accounts.position_nft_account.to_account_info(),
        ctx.accounts.pool.to_account_info(),
        ctx.accounts.position.to_account_info(),
        ctx.accounts.pool_authority.to_account_info(),
        ctx.accounts.rent_receiver.to_account_info(),
        ctx.accounts.market.to_account_info(),
        ctx.accounts.token_2022_program.to_account_info(),
        ctx.accounts.event_authority.to_account_info(),
        ctx.accounts.meteora_program.to_account_info(),
    ];

    meteora_damm::invoke_close_position(
        account_metas,
        account_infos,
        signer_seeds,
    )?;

    Ok(())
}
