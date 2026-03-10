use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, TokenAccount, TokenInterface, TransferChecked, Mint};

use crate::errors::DuelError;
use crate::events::TokensSold;
use crate::math::bonding_curve;
use crate::state::*;

#[derive(Accounts)]
#[instruction(side: u8)]
pub struct SellPostResolution<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,

    #[account(
        constraint = market.status == MarketStatus::Resolved @ DuelError::MarketNotResolved,
    )]
    pub market: Account<'info, Market>,

    #[account(
        mut,
        constraint = side_account.market == market.key() @ DuelError::InvalidSide,
        constraint = side_account.side_index == side @ DuelError::InvalidSide,
    )]
    pub side_account: Account<'info, Side>,

    /// Token mint for the selected side (needed for transfer_checked)
    #[account(
        constraint = token_mint.key() == side_account.token_mint @ DuelError::InvalidSide,
    )]
    pub token_mint: InterfaceAccount<'info, Mint>,

    /// Token vault for the selected side
    #[account(
        mut,
        constraint = token_vault.key() == side_account.token_reserve_vault @ DuelError::InvalidSide,
    )]
    pub token_vault: InterfaceAccount<'info, TokenAccount>,

    /// Seller's token account
    #[account(mut)]
    pub seller_token_account: InterfaceAccount<'info, TokenAccount>,

    /// SOL vault for the selected side
    #[account(
        mut,
        constraint = sol_vault.key() == side_account.sol_reserve_vault @ DuelError::InvalidSide,
    )]
    pub sol_vault: Account<'info, SolVault>,

    /// Protocol config (pause check)
    #[account(
        seeds = [b"config"],
        bump = config.bump,
        constraint = !config.paused @ DuelError::ProtocolPaused,
    )]
    pub config: Account<'info, ProgramConfig>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(
    ctx: Context<SellPostResolution>,
    side: u8,
    token_amount: u64,
    min_sol_out: u64,
) -> Result<()> {
    require!(token_amount > 0, DuelError::InsufficientTokenBalance);

    let market = &ctx.accounts.market;
    let side_account = &ctx.accounts.side_account;

    // Calculate SOL out (no penalty post-resolution)
    let sol_amount = bonding_curve::sol_out(
        token_amount,
        side_account.circulating_supply,
        &market.curve_params,
    )?;

    // Slippage check
    require!(sol_amount >= min_sol_out, DuelError::SlippageExceeded);

    // Check vault has enough SOL
    let vault_balance = ctx.accounts.sol_vault.to_account_info().lamports();
    require!(vault_balance >= sol_amount, DuelError::InsufficientReserve);

    // Transfer tokens from seller to vault (transfer_checked for Token-2022 compat)
    let decimals = ctx.accounts.token_mint.decimals;

    token_interface::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.seller_token_account.to_account_info(),
                mint: ctx.accounts.token_mint.to_account_info(),
                to: ctx.accounts.token_vault.to_account_info(),
                authority: ctx.accounts.seller.to_account_info(),
            },
        ),
        token_amount,
        decimals,
    )?;

    // Transfer SOL from vault to seller
    **ctx.accounts.sol_vault.to_account_info().try_borrow_mut_lamports()? -= sol_amount;
    **ctx.accounts.seller.to_account_info().try_borrow_mut_lamports()? += sol_amount;

    // Update side state
    let side_account = &mut ctx.accounts.side_account;
    side_account.circulating_supply = side_account
        .circulating_supply
        .checked_sub(token_amount)
        .ok_or(DuelError::MathOverflow)?;

    // Calculate new price for event
    let new_price = bonding_curve::price(side_account.circulating_supply, &market.curve_params)?;

    emit!(TokensSold {
        market: market.key(),
        side,
        seller: ctx.accounts.seller.key(),
        token_amount,
        sol_received: sol_amount,
        penalty_applied: 0,
        new_price,
    });

    Ok(())
}
