use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, TokenAccount, TokenInterface, TransferChecked, Mint};

use crate::constants::BPS_DENOMINATOR;
use crate::errors::DuelError;
use crate::events::MarketResolved;
use crate::state::*;

#[derive(Accounts)]
pub struct ResolveWithOracle<'info> {
    /// Oracle authority — must match market.oracle_authority
    pub oracle: Signer<'info>,

    #[account(mut)]
    pub market: Account<'info, Market>,

    #[account(
        mut,
        constraint = side_a.market == market.key() @ DuelError::InvalidSide,
        constraint = side_a.side_index == 0 @ DuelError::InvalidSide,
    )]
    pub side_a: Account<'info, Side>,

    #[account(
        mut,
        constraint = side_b.market == market.key() @ DuelError::InvalidSide,
        constraint = side_b.side_index == 1 @ DuelError::InvalidSide,
    )]
    pub side_b: Account<'info, Side>,

    /// Quote token mint
    #[account(
        constraint = quote_mint.key() == market.quote_mint @ DuelError::InvalidMarketConfig,
    )]
    pub quote_mint: InterfaceAccount<'info, Mint>,

    /// Quote vault for Side A
    #[account(
        mut,
        constraint = quote_vault_a.key() == side_a.quote_reserve_vault @ DuelError::InvalidSide,
    )]
    pub quote_vault_a: InterfaceAccount<'info, TokenAccount>,

    /// Quote vault for Side B
    #[account(
        mut,
        constraint = quote_vault_b.key() == side_b.quote_reserve_vault @ DuelError::InvalidSide,
    )]
    pub quote_vault_b: InterfaceAccount<'info, TokenAccount>,

    /// Protocol fee recipient (quote token account)
    #[account(
        mut,
        constraint = protocol_fee_account.key() == market.protocol_fee_account @ DuelError::InvalidMarketConfig,
    )]
    pub protocol_fee_account: InterfaceAccount<'info, TokenAccount>,

    /// Creator fee recipient (quote token account)
    #[account(
        mut,
        constraint = creator_fee_account.key() == market.creator_fee_account @ DuelError::InvalidMarketConfig,
    )]
    pub creator_fee_account: InterfaceAccount<'info, TokenAccount>,

    /// Quote token program
    pub quote_token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<ResolveWithOracle>, winning_side: u8) -> Result<()> {
    let clock = Clock::get()?;

    // Read market values immutably
    let market_key;
    let oracle_authority;
    let resolution_mode;
    let deadline;
    let status;
    let oracle_dispute_window;
    let battle_tax_bps;
    let creator_fee_bps;
    let protocol_fee_bps;
    let market_id_bytes;
    let bump;
    let authority_key;

    {
        let market = &ctx.accounts.market;
        market_key = market.key();
        oracle_authority = market.oracle_authority;
        resolution_mode = market.resolution_mode;
        deadline = market.deadline;
        status = market.status.clone();
        oracle_dispute_window = market.oracle_dispute_window;
        battle_tax_bps = market.battle_tax_bps;
        creator_fee_bps = market.creator_fee_bps;
        protocol_fee_bps = market.protocol_fee_bps;
        market_id_bytes = market.market_id.to_le_bytes();
        bump = market.bump;
        authority_key = market.authority;
    }

    // Validate oracle authority
    require!(
        ctx.accounts.oracle.key() == oracle_authority,
        DuelError::UnauthorizedOracle
    );

    // Must not be pure TWAP mode
    require!(
        resolution_mode != ResolutionMode::Twap,
        DuelError::OracleNotAllowed
    );

    // Must be past deadline
    require!(clock.unix_timestamp >= deadline, DuelError::MarketNotExpired);

    // Must not already be resolved
    require!(status != MarketStatus::Resolved, DuelError::MarketAlreadyResolved);

    // Must be within dispute window (for oracle mode)
    if oracle_dispute_window > 0 {
        let dispute_end = deadline + oracle_dispute_window as i64;
        require!(
            clock.unix_timestamp <= dispute_end,
            DuelError::OracleDisputeWindowActive
        );
    }

    // Validate winning side
    require!(winning_side <= 1, DuelError::InvalidWinningSide);

    // Calculate transfer amounts (same logic as TWAP resolution)
    let losing_reserve = if winning_side == 0 {
        ctx.accounts.quote_vault_b.amount
    } else {
        ctx.accounts.quote_vault_a.amount
    };

    let transfer_amount = (losing_reserve as u128)
        .checked_mul(battle_tax_bps as u128)
        .ok_or(DuelError::MathOverflow)?
        .checked_div(BPS_DENOMINATOR as u128)
        .ok_or(DuelError::MathOverflow)? as u64;

    let creator_fee = (transfer_amount as u128)
        .checked_mul(creator_fee_bps as u128)
        .ok_or(DuelError::MathOverflow)?
        .checked_div(BPS_DENOMINATOR as u128)
        .ok_or(DuelError::MathOverflow)? as u64;

    let after_creator = transfer_amount
        .checked_sub(creator_fee)
        .ok_or(DuelError::MathOverflow)?;

    let protocol_fee = (after_creator as u128)
        .checked_mul(protocol_fee_bps as u128)
        .ok_or(DuelError::MathOverflow)?
        .checked_div(BPS_DENOMINATOR as u128)
        .ok_or(DuelError::MathOverflow)? as u64;

    let transfer_to_winner = after_creator
        .checked_sub(protocol_fee)
        .ok_or(DuelError::MathOverflow)?;

    // Build signer seeds
    let signer_seeds: &[&[&[u8]]] = &[&[
        b"market",
        authority_key.as_ref(),
        &market_id_bytes,
        &[bump],
    ]];

    let quote_decimals = ctx.accounts.quote_mint.decimals;

    let (losing_vault, winning_vault) = if winning_side == 0 {
        (
            ctx.accounts.quote_vault_b.to_account_info(),
            ctx.accounts.quote_vault_a.to_account_info(),
        )
    } else {
        (
            ctx.accounts.quote_vault_a.to_account_info(),
            ctx.accounts.quote_vault_b.to_account_info(),
        )
    };

    // Transfer quote tokens from losing vault to winning vault
    if transfer_to_winner > 0 {
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.quote_token_program.to_account_info(),
                TransferChecked {
                    from: losing_vault.clone(),
                    mint: ctx.accounts.quote_mint.to_account_info(),
                    to: winning_vault.clone(),
                    authority: ctx.accounts.market.to_account_info(),
                },
                signer_seeds,
            ),
            transfer_to_winner,
            quote_decimals,
        )?;
    }

    // Transfer creator fee
    if creator_fee > 0 {
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.quote_token_program.to_account_info(),
                TransferChecked {
                    from: losing_vault.clone(),
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

    // Transfer protocol fee
    if protocol_fee > 0 {
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.quote_token_program.to_account_info(),
                TransferChecked {
                    from: losing_vault.clone(),
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

    // Update market state
    let market = &mut ctx.accounts.market;
    market.status = MarketStatus::Resolved;
    market.winner = Some(winning_side);
    // For oracle resolution, TWAPs are not used but we record 0
    market.final_twap_a = 0;
    market.final_twap_b = 0;

    emit!(MarketResolved {
        market: market_key,
        winner: winning_side,
        is_draw: false,
        final_twap_a: 0,
        final_twap_b: 0,
        transfer_amount: transfer_to_winner,
        protocol_fee,
        creator_fee,
    });

    Ok(())
}
