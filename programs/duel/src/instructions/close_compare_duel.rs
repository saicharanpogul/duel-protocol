use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, CloseAccount, TokenAccount, TokenInterface};

use crate::errors::DuelError;
use crate::state::*;

#[derive(Accounts)]
pub struct CloseCompareDuel<'info> {
    /// Duel creator or protocol admin
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        close = authority,
        constraint = compare_duel.status == MarketStatus::Resolved @ DuelError::DuelNotResolved,
        constraint = compare_duel.authority == authority.key() || config.admin == authority.key() @ DuelError::InvalidMarketConfig,
    )]
    pub compare_duel: Account<'info, CompareDuel>,

    /// Pool vault A
    #[account(
        mut,
        constraint = pool_vault_a.key() == compare_duel.pool_vault_a @ DuelError::InvalidSide,
    )]
    pub pool_vault_a: InterfaceAccount<'info, TokenAccount>,

    /// Pool vault B
    #[account(
        mut,
        constraint = pool_vault_b.key() == compare_duel.pool_vault_b @ DuelError::InvalidSide,
    )]
    pub pool_vault_b: InterfaceAccount<'info, TokenAccount>,

    /// Protocol config (for admin check)
    #[account(
        seeds = [b"config"],
        bump = config.bump,
    )]
    pub config: Account<'info, ProgramConfig>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<CloseCompareDuel>) -> Result<()> {
    let duel = &ctx.accounts.compare_duel;

    // Build CompareDuel PDA signer seeds
    let authority_key = duel.authority;
    let duel_id_bytes = duel.duel_id.to_le_bytes();
    let bump = duel.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        b"compare_duel",
        authority_key.as_ref(),
        &duel_id_bytes,
        &[bump],
    ]];

    // Close vault A if empty
    if ctx.accounts.pool_vault_a.amount == 0 {
        token_interface::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            CloseAccount {
                account: ctx.accounts.pool_vault_a.to_account_info(),
                destination: ctx.accounts.authority.to_account_info(),
                authority: ctx.accounts.compare_duel.to_account_info(),
            },
            signer_seeds,
        ))?;
    }

    // Close vault B if empty
    if ctx.accounts.pool_vault_b.amount == 0 {
        token_interface::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            CloseAccount {
                account: ctx.accounts.pool_vault_b.to_account_info(),
                destination: ctx.accounts.authority.to_account_info(),
                authority: ctx.accounts.compare_duel.to_account_info(),
            },
            signer_seeds,
        ))?;
    }

    // CompareDuel account is closed via `close = authority` constraint

    Ok(())
}
