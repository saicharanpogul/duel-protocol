use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, TokenAccount, TokenInterface, TransferChecked, Mint};

use crate::constants::BPS_DENOMINATOR;
use crate::errors::DuelError;
use crate::events::MarketResolved;
use crate::math::twap;
use crate::state::*;

#[derive(Accounts)]
pub struct ResolveMarket<'info> {
    /// Anyone can resolve (permissionless)
    pub resolver: Signer<'info>,

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

pub fn handler(ctx: Context<ResolveMarket>) -> Result<()> {
    let clock = Clock::get()?;

    // Read all needed values from market immutably first
    let market_key;
    let deadline;
    let status;
    let twap_window;
    let twap_interval;
    let twap_samples_count;
    let min_twap_spread_bps;
    let battle_tax_bps;
    let creator_fee_bps;
    let protocol_fee_bps;
    let market_id_bytes;
    let bump;
    let authority_key;

    {
        let market = &ctx.accounts.market;
        market_key = market.key();
        deadline = market.deadline;
        status = market.status.clone();
        twap_window = market.twap_window;
        twap_interval = market.twap_interval;
        twap_samples_count = market.twap_samples_count;
        min_twap_spread_bps = market.min_twap_spread_bps;
        battle_tax_bps = market.battle_tax_bps;
        creator_fee_bps = market.creator_fee_bps;
        protocol_fee_bps = market.protocol_fee_bps;
        market_id_bytes = market.market_id.to_le_bytes();
        bump = market.bump;
        authority_key = market.authority;

        // Resolution mode check:
        // - Oracle-only: cannot use TWAP resolution at all
        // - OracleWithTwapFallback: TWAP only after dispute window expires
        // - Twap: always allowed
        match market.resolution_mode {
            ResolutionMode::Oracle => {
                return Err(DuelError::TwapNotAllowed.into());
            }
            ResolutionMode::OracleWithTwapFallback => {
                let dispute_end = market.deadline + market.oracle_dispute_window as i64;
                require!(
                    clock.unix_timestamp > dispute_end,
                    DuelError::OracleDisputeWindowActive
                );
            }
            ResolutionMode::Twap => {
                // Always allowed
            }
        }
    }

    // Must be past deadline
    require!(clock.unix_timestamp >= deadline, DuelError::MarketNotExpired);

    // Must not already be resolved
    require!(status != MarketStatus::Resolved, DuelError::MarketAlreadyResolved);

    // Must have sufficient TWAP samples
    let min_samples = ((twap_window / twap_interval).max(1) / 2).max(1) as u32;
    require!(twap_samples_count >= min_samples, DuelError::NoTwapSamples);

    let samples = twap_samples_count as u128;

    // Calculate final TWAPs — use trimmed mean if sufficient ring buffer samples
    let final_twap_a = if ctx.accounts.side_a.twap_sample_count >= 20 {
        twap::trimmed_mean(
            &ctx.accounts.side_a.twap_samples,
            ctx.accounts.side_a.twap_sample_count,
            5, // trim 5% from each tail
        )?
    } else {
        // Fallback to accumulator-based simple mean
        ctx.accounts.side_a
            .twap_accumulator
            .checked_div(samples)
            .ok_or(DuelError::MathOverflow)? as u64
    };
    let final_twap_b = if ctx.accounts.side_b.twap_sample_count >= 20 {
        twap::trimmed_mean(
            &ctx.accounts.side_b.twap_samples,
            ctx.accounts.side_b.twap_sample_count,
            5,
        )?
    } else {
        ctx.accounts.side_b
            .twap_accumulator
            .checked_div(samples)
            .ok_or(DuelError::MathOverflow)? as u64
    };

    // Check for draw
    let is_draw = if min_twap_spread_bps > 0 {
        let higher = final_twap_a.max(final_twap_b);
        let lower = final_twap_a.min(final_twap_b);
        if higher == 0 {
            true
        } else {
            let spread_bps = ((higher - lower) as u128)
                .checked_mul(BPS_DENOMINATOR as u128)
                .ok_or(DuelError::MathOverflow)?
                .checked_div(higher as u128)
                .ok_or(DuelError::MathOverflow)? as u16;
            spread_bps < min_twap_spread_bps
        }
    } else {
        final_twap_a == final_twap_b && {
            let reserve_a = ctx.accounts.quote_vault_a.amount;
            let reserve_b = ctx.accounts.quote_vault_b.amount;
            reserve_a == reserve_b
        }
    };

    if is_draw {
        let market = &mut ctx.accounts.market;
        market.status = MarketStatus::Resolved;
        market.winner = None;
        market.final_twap_a = final_twap_a;
        market.final_twap_b = final_twap_b;

        emit!(MarketResolved {
            market: market_key,
            winner: 255,
            is_draw: true,
            final_twap_a,
            final_twap_b,
            transfer_amount: 0,
            protocol_fee: 0,
            creator_fee: 0,
            resolution_mode: 0,
        });

        return Ok(());
    }

    // Determine winner
    let winner: u8;
    if final_twap_a > final_twap_b {
        winner = 0;
    } else if final_twap_b > final_twap_a {
        winner = 1;
    } else {
        let reserve_a = ctx.accounts.quote_vault_a.amount;
        let reserve_b = ctx.accounts.quote_vault_b.amount;
        if reserve_a >= reserve_b {
            winner = 0;
        } else {
            winner = 1;
        }
    }

    // Calculate transfer amounts
    let losing_reserve = if winner == 0 {
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

    // Build signer seeds (using extracted values, no borrow on market)
    let signer_seeds: &[&[&[u8]]] = &[&[
        b"market",
        authority_key.as_ref(),
        &market_id_bytes,
        &[bump],
    ]];

    let quote_decimals = ctx.accounts.quote_mint.decimals;

    let (losing_vault, winning_vault) = if winner == 0 {
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

    // Update market state (mutable borrow only at the end)
    let market = &mut ctx.accounts.market;
    market.status = MarketStatus::Resolved;
    market.winner = Some(winner);
    market.final_twap_a = final_twap_a;
    market.final_twap_b = final_twap_b;

    emit!(MarketResolved {
        market: market_key,
        winner,
        is_draw: false,
        final_twap_a,
        final_twap_b,
        transfer_amount: transfer_to_winner,
        protocol_fee,
        creator_fee,
        resolution_mode: 0,
    });

    Ok(())
}
