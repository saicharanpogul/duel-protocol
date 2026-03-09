use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::errors::DuelError;
use crate::events::TokensBought;
use crate::math::bonding_curve;
use crate::state::*;

#[derive(Accounts)]
#[instruction(side: u8)]
pub struct BuyTokens<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    #[account(
        mut,
        constraint = market.status != MarketStatus::Resolved @ DuelError::MarketAlreadyResolved,
    )]
    pub market: Account<'info, Market>,

    #[account(
        mut,
        constraint = side_account.market == market.key() @ DuelError::InvalidSide,
        constraint = side_account.side_index == side @ DuelError::InvalidSide,
    )]
    pub side_account: Account<'info, Side>,

    /// Token vault for the selected side
    #[account(
        mut,
        constraint = token_vault.key() == side_account.token_reserve_vault @ DuelError::InvalidSide,
    )]
    pub token_vault: Account<'info, TokenAccount>,

    /// Buyer's token account for the selected side
    #[account(mut)]
    pub buyer_token_account: Account<'info, TokenAccount>,

    /// SOL vault for the selected side
    #[account(
        mut,
        constraint = sol_vault.key() == side_account.sol_reserve_vault @ DuelError::InvalidSide,
    )]
    /// CHECK: SOL vault PDA, validated by constraint
    pub sol_vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(
    ctx: Context<BuyTokens>,
    side: u8,
    sol_amount: u64,
    min_tokens_out: u64,
) -> Result<()> {
    let clock = Clock::get()?;
    let market = &ctx.accounts.market;

    // Deadline check
    require!(clock.unix_timestamp < market.deadline, DuelError::MarketExpired);
    require!(sol_amount > 0, DuelError::InsufficientSolAmount);

    let side_account = &ctx.accounts.side_account;

    // Calculate tokens out
    let tokens = bonding_curve::tokens_out(
        sol_amount,
        side_account.circulating_supply,
        side_account.total_supply,
        &market.curve_params,
    )?;

    // Slippage check
    require!(tokens >= min_tokens_out, DuelError::SlippageExceeded);
    require!(tokens > 0, DuelError::InsufficientSolAmount);

    // Transfer SOL from buyer to SOL vault
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.buyer.to_account_info(),
                to: ctx.accounts.sol_vault.to_account_info(),
            },
        ),
        sol_amount,
    )?;

    // Transfer tokens from vault to buyer (Market PDA signs)
    let market_id_bytes = market.market_id.to_le_bytes();
    let bump = market.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        b"market",
        market.authority.as_ref(),
        &market_id_bytes,
        &[bump],
    ]];

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.token_vault.to_account_info(),
                to: ctx.accounts.buyer_token_account.to_account_info(),
                authority: ctx.accounts.market.to_account_info(),
            },
            signer_seeds,
        ),
        tokens,
    )?;

    // Update side state
    let side_account = &mut ctx.accounts.side_account;
    side_account.circulating_supply = side_account
        .circulating_supply
        .checked_add(tokens)
        .ok_or(DuelError::MathOverflow)?;

    // Update peak reserve
    let new_reserve = ctx.accounts.sol_vault.lamports();
    if new_reserve > side_account.peak_reserve {
        side_account.peak_reserve = new_reserve;
    }

    // Calculate new price for event
    let new_price = bonding_curve::price(side_account.circulating_supply, &market.curve_params)?;

    emit!(TokensBought {
        market: market.key(),
        side,
        buyer: ctx.accounts.buyer.key(),
        sol_amount,
        tokens_received: tokens,
        new_price,
    });

    Ok(())
}
