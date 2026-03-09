use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::errors::DuelError;
use crate::events::TokensSold;
use crate::math::{bonding_curve, penalty};
use crate::state::*;

#[derive(Accounts)]
#[instruction(side: u8)]
pub struct SellTokens<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,

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

    /// Seller's token account
    #[account(mut)]
    pub seller_token_account: Account<'info, TokenAccount>,

    /// SOL vault for the selected side
    #[account(
        mut,
        constraint = sol_vault.key() == side_account.sol_reserve_vault @ DuelError::InvalidSide,
    )]
    pub sol_vault: Account<'info, SolVault>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(
    ctx: Context<SellTokens>,
    side: u8,
    token_amount: u64,
    min_sol_out: u64,
) -> Result<()> {
    let clock = Clock::get()?;
    let market = &ctx.accounts.market;

    // Deadline check
    require!(clock.unix_timestamp < market.deadline, DuelError::MarketExpired);
    require!(token_amount > 0, DuelError::InsufficientTokenBalance);

    let side_account = &ctx.accounts.side_account;

    // Calculate raw SOL out
    let raw_sol = bonding_curve::sol_out(
        token_amount,
        side_account.circulating_supply,
        &market.curve_params,
    )?;

    // Apply sell penalty if within protection window
    let penalty_bps;
    let penalty_active = clock.unix_timestamp >= (market.deadline - market.protection_activation_offset as i64);

    if penalty_active {
        let current_reserve = ctx.accounts.sol_vault.to_account_info().lamports();
        penalty_bps = penalty::sell_penalty_bps(
            current_reserve,
            side_account.peak_reserve,
            market.sell_penalty_max_bps,
        )?;
    } else {
        penalty_bps = 0;
    }

    let sol_after_penalty = if penalty_bps > 0 {
        penalty::apply_sell_penalty(raw_sol, penalty_bps)?
    } else {
        raw_sol
    };

    // Slippage check
    require!(sol_after_penalty >= min_sol_out, DuelError::SlippageExceeded);

    // Check vault has enough SOL
    let vault_balance = ctx.accounts.sol_vault.to_account_info().lamports();
    require!(vault_balance >= sol_after_penalty, DuelError::InsufficientReserve);

    // Transfer tokens from seller to vault
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.seller_token_account.to_account_info(),
                to: ctx.accounts.token_vault.to_account_info(),
                authority: ctx.accounts.seller.to_account_info(),
            },
        ),
        token_amount,
    )?;

    // Transfer SOL from vault to seller (direct lamport manipulation)
    **ctx.accounts.sol_vault.to_account_info().try_borrow_mut_lamports()? -= sol_after_penalty;
    **ctx.accounts.seller.to_account_info().try_borrow_mut_lamports()? += sol_after_penalty;

    // Update side state
    let side_account = &mut ctx.accounts.side_account;
    side_account.circulating_supply = side_account
        .circulating_supply
        .checked_sub(token_amount)
        .ok_or(DuelError::MathOverflow)?;

    // Penalty SOL stays in the reserve (locked)
    let penalty_amount = raw_sol.checked_sub(sol_after_penalty).ok_or(DuelError::MathOverflow)?;

    // Calculate new price for event
    let new_price = bonding_curve::price(side_account.circulating_supply, &market.curve_params)?;

    emit!(TokensSold {
        market: market.key(),
        side,
        seller: ctx.accounts.seller.key(),
        token_amount,
        sol_received: sol_after_penalty,
        penalty_applied: penalty_amount,
        new_price,
    });

    Ok(())
}
