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
        mut,
        constraint = market.status == MarketStatus::Resolved @ DuelError::MarketNotResolved,
        constraint = !market.locked @ DuelError::MarketAlreadyResolved,
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

    /// Quote token mint
    #[account(
        constraint = quote_mint.key() == market.quote_mint @ DuelError::InvalidMarketConfig,
    )]
    pub quote_mint: InterfaceAccount<'info, Mint>,

    /// Quote vault for the selected side
    #[account(
        mut,
        constraint = quote_vault.key() == side_account.quote_reserve_vault @ DuelError::InvalidSide,
    )]
    pub quote_vault: InterfaceAccount<'info, TokenAccount>,

    /// Seller's quote token account
    #[account(mut)]
    pub seller_quote_account: InterfaceAccount<'info, TokenAccount>,

    /// Protocol config (pause check)
    #[account(
        seeds = [b"config"],
        bump = config.bump,
        constraint = !config.paused @ DuelError::ProtocolPaused,
    )]
    pub config: Account<'info, ProgramConfig>,

    pub token_program: Interface<'info, TokenInterface>,
    /// Quote token program
    pub quote_token_program: Interface<'info, TokenInterface>,
}

pub fn handler(
    ctx: Context<SellPostResolution>,
    side: u8,
    token_amount: u64,
    min_quote_out: u64,
) -> Result<()> {
    require!(token_amount > 0, DuelError::InsufficientTokenBalance);

    let market = &ctx.accounts.market;
    let side_account = &ctx.accounts.side_account;

    // Calculate quote out (no penalty post-resolution)
    let quote_amount = bonding_curve::sol_out(
        token_amount,
        side_account.circulating_supply,
        &market.curve_params,
    )?;

    // Slippage check
    require!(quote_amount >= min_quote_out, DuelError::SlippageExceeded);

    // Check vault has enough quote tokens
    let vault_balance = ctx.accounts.quote_vault.amount;
    require!(vault_balance >= quote_amount, DuelError::InsufficientReserve);

    // Extract signer seed values (immutable borrow)
    let market_id_bytes = ctx.accounts.market.market_id.to_le_bytes();
    let bump = ctx.accounts.market.bump;
    let authority_key = ctx.accounts.market.authority;
    let signer_seeds: &[&[&[u8]]] = &[&[
        b"market",
        authority_key.as_ref(),
        &market_id_bytes,
        &[bump],
    ]];

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

    // Transfer quote tokens from vault to seller (Market PDA signs)
    let quote_decimals = ctx.accounts.quote_mint.decimals;

    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.quote_token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.quote_vault.to_account_info(),
                mint: ctx.accounts.quote_mint.to_account_info(),
                to: ctx.accounts.seller_quote_account.to_account_info(),
                authority: ctx.accounts.market.to_account_info(),
            },
            signer_seeds,
        ),
        quote_amount,
        quote_decimals,
    )?;

    // Update side state
    let side_account = &mut ctx.accounts.side_account;
    side_account.circulating_supply = side_account
        .circulating_supply
        .checked_sub(token_amount)
        .ok_or(DuelError::MathOverflow)?;

    // Calculate new price for event
    let market = &ctx.accounts.market;
    let new_price = bonding_curve::price(side_account.circulating_supply, &market.curve_params)?;
    let market_key = market.key();

    emit!(TokensSold {
        market: market_key,
        side,
        seller: ctx.accounts.seller.key(),
        token_amount,
        sol_received: quote_amount,
        penalty_applied: 0,
        new_price,
    });

    Ok(())
}
