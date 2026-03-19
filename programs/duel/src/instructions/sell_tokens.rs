use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, TokenAccount, TokenInterface, TransferChecked, Mint};

use crate::constants::*;
use crate::errors::DuelError;
use crate::events::TokensSold;
use crate::math::bonding_curve;
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
    pub market: Box<Account<'info, Market>>,

    #[account(
        mut,
        constraint = side_account.market == market.key() @ DuelError::InvalidSide,
        constraint = side_account.side_index == side @ DuelError::InvalidSide,
    )]
    pub side_account: Box<Account<'info, Side>>,

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

    /// Protocol fee recipient (WSOL token account)
    #[account(
        mut,
        constraint = protocol_fee_account.key() == config.protocol_fee_account @ DuelError::InvalidFeeConfig,
    )]
    pub protocol_fee_account: InterfaceAccount<'info, TokenAccount>,

    /// Creator fee recipient (WSOL token account)
    #[account(
        mut,
        constraint = creator_fee_account.key() == market.creator_fee_account @ DuelError::InvalidFeeConfig,
    )]
    pub creator_fee_account: InterfaceAccount<'info, TokenAccount>,

    /// Protocol config (pause check + fee rates)
    #[account(
        seeds = [b"config"],
        bump = config.bump,
        constraint = !config.paused @ DuelError::ProtocolPaused,
    )]
    pub config: Box<Account<'info, ProgramConfig>>,

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

    // Calculate raw quote out from bonding curve
    let params = CurveParams::default_params();
    let raw_quote = bonding_curve::sol_out(
        token_amount,
        side_account.circulating_supply,
        &params,
    )?;

    // Calculate trade fees on the output
    let config = &ctx.accounts.config;
    let trade_fee = (raw_quote as u128)
        .checked_mul(config.trade_fee_bps as u128)
        .ok_or(DuelError::MathOverflow)?
        .checked_div(BPS_DENOMINATOR as u128)
        .ok_or(DuelError::MathOverflow)? as u64;

    let creator_fee = (trade_fee as u128)
        .checked_mul(config.creator_fee_split_bps as u128)
        .ok_or(DuelError::MathOverflow)?
        .checked_div(BPS_DENOMINATOR as u128)
        .ok_or(DuelError::MathOverflow)? as u64;

    let protocol_fee = trade_fee
        .checked_sub(creator_fee)
        .ok_or(DuelError::MathOverflow)?;

    let net_quote = raw_quote
        .checked_sub(trade_fee)
        .ok_or(DuelError::MathOverflow)?;

    // Slippage check
    require!(net_quote >= min_quote_out, DuelError::SlippageExceeded);

    // Check vault has enough quote tokens for all transfers
    let total_out = raw_quote; // net_quote + protocol_fee + creator_fee = raw_quote
    let vault_balance = ctx.accounts.quote_vault.amount;
    require!(vault_balance >= total_out, DuelError::InsufficientReserve);

    // Extract signer seed values
    let market_id_bytes = ctx.accounts.market.market_id.to_le_bytes();
    let bump = ctx.accounts.market.bump;
    let authority_key = ctx.accounts.market.authority;
    let signer_seeds: &[&[&[u8]]] = &[&[
        b"market",
        authority_key.as_ref(),
        &market_id_bytes,
        &[bump],
    ]];

    // Transfer tokens from seller to vault
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

    let quote_decimals = ctx.accounts.quote_mint.decimals;

    // Transfer net_quote from quote vault to seller (Market PDA signs)
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
        net_quote,
        quote_decimals,
    )?;

    // Transfer protocol fee from quote vault to protocol fee account
    if protocol_fee > 0 {
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.quote_token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.quote_vault.to_account_info(),
                    mint: ctx.accounts.quote_mint.to_account_info(),
                    to: ctx.accounts.protocol_fee_account.to_account_info(),
                    authority: ctx.accounts.market.to_account_info(),
                },
                signer_seeds,
            ),
            protocol_fee,
            quote_decimals,
        )?;
    }

    // Transfer creator fee from quote vault to creator fee account
    if creator_fee > 0 {
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.quote_token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.quote_vault.to_account_info(),
                    mint: ctx.accounts.quote_mint.to_account_info(),
                    to: ctx.accounts.creator_fee_account.to_account_info(),
                    authority: ctx.accounts.market.to_account_info(),
                },
                signer_seeds,
            ),
            creator_fee,
            quote_decimals,
        )?;
    }

    // Update side state
    let side_account = &mut ctx.accounts.side_account;
    side_account.circulating_supply = side_account
        .circulating_supply
        .checked_sub(token_amount)
        .ok_or(DuelError::MathOverflow)?;

    // Calculate new price for event
    let new_price = bonding_curve::price(side_account.circulating_supply, &params)?;
    let market_key = ctx.accounts.market.key();

    emit!(TokensSold {
        market: market_key,
        side,
        seller: ctx.accounts.seller.key(),
        token_amount,
        quote_received: net_quote,
        fee_amount: trade_fee,
        new_price,
    });

    // Release re-entrancy lock
    ctx.accounts.market.locked = false;

    Ok(())
}
