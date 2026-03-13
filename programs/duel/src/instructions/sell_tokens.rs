use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, TokenAccount, TokenInterface, TransferChecked, Mint};

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
    ctx: Context<SellTokens>,
    side: u8,
    token_amount: u64,
    min_quote_out: u64,
) -> Result<()> {
    let clock = Clock::get()?;
    let market = &ctx.accounts.market;

    // Deadline check
    require!(clock.unix_timestamp < market.deadline, DuelError::MarketExpired);
    require!(token_amount > 0, DuelError::InsufficientTokenBalance);

    // Activate re-entrancy lock
    let market = &mut ctx.accounts.market;
    require!(!market.locked, DuelError::ReentrancyLocked);
    market.locked = true;

    let side_account = &ctx.accounts.side_account;

    // Calculate raw quote out
    let raw_quote = bonding_curve::sol_out(
        token_amount,
        side_account.circulating_supply,
        &market.curve_params,
    )?;

    // Apply sell penalty if within protection window
    let penalty_bps;
    let penalty_active = clock.unix_timestamp >= (market.deadline - market.protection_activation_offset as i64);

    if penalty_active {
        let current_reserve = ctx.accounts.quote_vault.amount;
        penalty_bps = penalty::sell_penalty_bps(
            current_reserve,
            side_account.peak_reserve,
            market.sell_penalty_max_bps,
        )?;
    } else {
        penalty_bps = 0;
    }

    let quote_after_penalty = if penalty_bps > 0 {
        penalty::apply_sell_penalty(raw_quote, penalty_bps)?
    } else {
        raw_quote
    };

    // Slippage check
    require!(quote_after_penalty >= min_quote_out, DuelError::SlippageExceeded);

    // Check vault has enough quote tokens
    let vault_balance = ctx.accounts.quote_vault.amount;
    require!(vault_balance >= quote_after_penalty, DuelError::InsufficientReserve);

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
        quote_after_penalty,
        quote_decimals,
    )?;

    // Update side state
    let side_account = &mut ctx.accounts.side_account;
    side_account.circulating_supply = side_account
        .circulating_supply
        .checked_sub(token_amount)
        .ok_or(DuelError::MathOverflow)?;

    // Track penalty accumulated on side (for proper redemption math)
    let penalty_amount = raw_quote.checked_sub(quote_after_penalty).ok_or(DuelError::MathOverflow)?;
    side_account.penalty_accumulated = side_account
        .penalty_accumulated
        .checked_add(penalty_amount)
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
        quote_received: quote_after_penalty,
        penalty_applied: penalty_amount,
        new_price,
    });

    // Release re-entrancy lock
    ctx.accounts.market.locked = false;

    Ok(())
}
