use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, TokenAccount, TokenInterface, CloseAccount};

use crate::errors::DuelError;
use crate::state::*;

#[derive(Accounts)]
#[instruction(side: u8)]
pub struct CloseQuoteVault<'info> {
    /// Anyone can close -- rent goes to rent_receiver
    #[account(mut)]
    pub closer: Signer<'info>,

    #[account(
        constraint = market.status == MarketStatus::Resolved @ DuelError::MarketNotResolved,
    )]
    pub market: Account<'info, Market>,

    #[account(
        constraint = side_account.market == market.key() @ DuelError::InvalidSide,
        constraint = side_account.side_index == side @ DuelError::InvalidSide,
    )]
    pub side_account: Account<'info, Side>,

    /// Quote vault to close
    #[account(
        mut,
        constraint = quote_vault.key() == side_account.quote_reserve_vault @ DuelError::InvalidSide,
    )]
    pub quote_vault: InterfaceAccount<'info, TokenAccount>,

    /// Token vault to close (optional -- only if empty)
    #[account(
        mut,
        constraint = token_vault.key() == side_account.token_reserve_vault @ DuelError::InvalidSide,
    )]
    pub token_vault: InterfaceAccount<'info, TokenAccount>,

    /// Receives rent from closed accounts
    /// CHECK: Any account can receive rent
    #[account(mut)]
    pub rent_receiver: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    /// Quote token program (may differ for Token-2022)
    pub quote_token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<CloseQuoteVault>, side: u8) -> Result<()> {
    require!(side <= 1, DuelError::InvalidSide);

    let market = &ctx.accounts.market;

    // Build market PDA signer seeds
    let authority_key = market.authority;
    let market_id_bytes = market.market_id.to_le_bytes();
    let bump = market.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        b"market",
        authority_key.as_ref(),
        &market_id_bytes,
        &[bump],
    ]];

    // Close quote vault if empty
    let quote_vault = &ctx.accounts.quote_vault;
    if quote_vault.amount == 0 {
        token_interface::close_account(CpiContext::new_with_signer(
            ctx.accounts.quote_token_program.to_account_info(),
            CloseAccount {
                account: ctx.accounts.quote_vault.to_account_info(),
                destination: ctx.accounts.rent_receiver.to_account_info(),
                authority: ctx.accounts.market.to_account_info(),
            },
            signer_seeds,
        ))?;
    }

    // Close token vault if empty
    let token_vault = &ctx.accounts.token_vault;
    if token_vault.amount == 0 {
        token_interface::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            CloseAccount {
                account: ctx.accounts.token_vault.to_account_info(),
                destination: ctx.accounts.rent_receiver.to_account_info(),
                authority: ctx.accounts.market.to_account_info(),
            },
            signer_seeds,
        ))?;
    }

    Ok(())
}
