use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::AccountMeta;

use crate::cpi::meteora_damm;
use crate::errors::DuelError;
use crate::state::*;

/// Permanently lock LP liquidity in a Meteora DAMM v2 position.
/// Can be called manually OR auto-called during graduation when lp_lock_mode == PermanentLock.
/// After locking, the liquidity cannot be removed — only fees can be claimed.
#[derive(Accounts)]
#[instruction(side: u8)]
pub struct LockPosition<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        constraint = market.status == MarketStatus::Resolved @ DuelError::MarketNotResolved,
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(
        constraint = side_account.market == market.key() @ DuelError::InvalidSide,
    )]
    pub side_account: Account<'info, Side>,

    // ─── Meteora DAMM v2 accounts ───

    /// Pool (mut)
    /// CHECK: Validated by Meteora program
    #[account(mut)]
    pub pool: UncheckedAccount<'info>,

    /// Position (mut)
    /// CHECK: Validated by Meteora program
    #[account(mut)]
    pub position: UncheckedAccount<'info>,

    /// Position NFT token account
    /// CHECK: Validated by Meteora program
    pub position_nft_account: UncheckedAccount<'info>,

    /// Event authority PDA
    /// CHECK: Validated by Meteora program
    pub event_authority: UncheckedAccount<'info>,

    /// Meteora DAMM v2 program
    /// CHECK: Validated against known program ID
    #[account(
        constraint = meteora_program.key() == meteora_damm::METEORA_DAMM_V2_PROGRAM_ID @ DuelError::InvalidMarketConfig,
    )]
    pub meteora_program: UncheckedAccount<'info>,
}

pub fn handler(ctx: Context<LockPosition>, side: u8, lock_liquidity: u128) -> Result<()> {
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
        AccountMeta::new(ctx.accounts.pool.key(), false),
        AccountMeta::new(ctx.accounts.position.key(), false),
        AccountMeta::new_readonly(ctx.accounts.position_nft_account.key(), false),
        AccountMeta::new_readonly(market.key(), true), // owner = market PDA
        AccountMeta::new_readonly(ctx.accounts.event_authority.key(), false),
        AccountMeta::new_readonly(ctx.accounts.meteora_program.key(), false),
    ];

    let account_infos = vec![
        ctx.accounts.pool.to_account_info(),
        ctx.accounts.position.to_account_info(),
        ctx.accounts.position_nft_account.to_account_info(),
        ctx.accounts.market.to_account_info(),
        ctx.accounts.event_authority.to_account_info(),
        ctx.accounts.meteora_program.to_account_info(),
    ];

    meteora_damm::invoke_permanent_lock_position(
        account_metas,
        account_infos,
        lock_liquidity,
        signer_seeds,
    )?;

    Ok(())
}
