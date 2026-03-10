use anchor_lang::prelude::*;

use crate::constants::BPS_DENOMINATOR;
use crate::errors::DuelError;
use crate::events::MarketResolved;
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

    /// SOL vault for Side A
    #[account(
        mut,
        constraint = sol_vault_a.key() == side_a.sol_reserve_vault @ DuelError::InvalidSide,
    )]
    pub sol_vault_a: Account<'info, SolVault>,

    /// SOL vault for Side B
    #[account(
        mut,
        constraint = sol_vault_b.key() == side_b.sol_reserve_vault @ DuelError::InvalidSide,
    )]
    pub sol_vault_b: Account<'info, SolVault>,

    /// Protocol fee recipient
    #[account(
        mut,
        constraint = protocol_fee_account.key() == market.protocol_fee_account @ DuelError::InvalidMarketConfig,
    )]
    /// CHECK: Fee account validated by market state
    pub protocol_fee_account: UncheckedAccount<'info>,

    /// Creator fee recipient
    #[account(
        mut,
        constraint = creator_fee_account.key() == market.creator_fee_account @ DuelError::InvalidMarketConfig,
    )]
    /// CHECK: Fee account validated by market state
    pub creator_fee_account: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<ResolveMarket>) -> Result<()> {
    let clock = Clock::get()?;
    let market = &mut ctx.accounts.market;

    // Must be past deadline
    require!(clock.unix_timestamp >= market.deadline, DuelError::MarketNotExpired);

    // Must not already be resolved
    require!(market.status != MarketStatus::Resolved, DuelError::MarketAlreadyResolved);

    // Must have sufficient TWAP samples to prevent manipulation
    let min_samples = (market.twap_window / market.twap_interval).max(1) as u32;
    require!(market.twap_samples_count >= min_samples, DuelError::NoTwapSamples);

    let samples = market.twap_samples_count as u128;

    // Calculate final TWAPs
    let side_a = &ctx.accounts.side_a;
    let side_b = &ctx.accounts.side_b;

    let final_twap_a = side_a
        .twap_accumulator
        .checked_div(samples)
        .ok_or(DuelError::MathOverflow)? as u64;
    let final_twap_b = side_b
        .twap_accumulator
        .checked_div(samples)
        .ok_or(DuelError::MathOverflow)? as u64;

    // Check for draw: if TWAP spread is below min_twap_spread_bps threshold
    let is_draw = if market.min_twap_spread_bps > 0 {
        let higher = final_twap_a.max(final_twap_b);
        let lower = final_twap_a.min(final_twap_b);
        if higher == 0 {
            // Both zero: draw
            true
        } else {
            // spread_bps = (higher - lower) * 10000 / higher
            let spread_bps = ((higher - lower) as u128)
                .checked_mul(BPS_DENOMINATOR as u128)
                .ok_or(DuelError::MathOverflow)?
                .checked_div(higher as u128)
                .ok_or(DuelError::MathOverflow)? as u16;
            spread_bps < market.min_twap_spread_bps
        }
    } else {
        // No min spread: only exact tie with equal reserves is a draw
        final_twap_a == final_twap_b && {
            let reserve_a = ctx.accounts.sol_vault_a.to_account_info().lamports();
            let reserve_b = ctx.accounts.sol_vault_b.to_account_info().lamports();
            reserve_a == reserve_b
        }
    };

    if is_draw {
        // Draw: no reserve transfer, both sides keep their reserves
        market.status = MarketStatus::Resolved;
        market.winner = None;
        market.final_twap_a = final_twap_a;
        market.final_twap_b = final_twap_b;

        emit!(MarketResolved {
            market: market.key(),
            winner: 255, // sentinel for draw
            is_draw: true,
            final_twap_a,
            final_twap_b,
            transfer_amount: 0,
            protocol_fee: 0,
            creator_fee: 0,
        });

        return Ok(());
    }

    // Determine winner (higher TWAP wins; tie goes to higher reserve)
    let winner: u8;
    if final_twap_a > final_twap_b {
        winner = 0;
    } else if final_twap_b > final_twap_a {
        winner = 1;
    } else {
        // Exact tie: higher SOL reserve wins
        let reserve_a = ctx.accounts.sol_vault_a.to_account_info().lamports();
        let reserve_b = ctx.accounts.sol_vault_b.to_account_info().lamports();
        if reserve_a >= reserve_b {
            winner = 0;
        } else {
            winner = 1;
        }
    }

    // Calculate transfer amounts
    let (losing_vault, winning_vault) = if winner == 0 {
        (
            &ctx.accounts.sol_vault_b,
            &ctx.accounts.sol_vault_a,
        )
    } else {
        (
            &ctx.accounts.sol_vault_a,
            &ctx.accounts.sol_vault_b,
        )
    };

    let losing_reserve = losing_vault.to_account_info().lamports();
    let transfer_amount = (losing_reserve as u128)
        .checked_mul(market.battle_tax_bps as u128)
        .ok_or(DuelError::MathOverflow)?
        .checked_div(BPS_DENOMINATOR as u128)
        .ok_or(DuelError::MathOverflow)? as u64;

    // Creator fee: deducted first from transfer_amount
    let creator_fee = (transfer_amount as u128)
        .checked_mul(market.creator_fee_bps as u128)
        .ok_or(DuelError::MathOverflow)?
        .checked_div(BPS_DENOMINATOR as u128)
        .ok_or(DuelError::MathOverflow)? as u64;

    // Protocol fee: deducted from remaining after creator fee
    let after_creator = transfer_amount
        .checked_sub(creator_fee)
        .ok_or(DuelError::MathOverflow)?;

    let protocol_fee = (after_creator as u128)
        .checked_mul(market.protocol_fee_bps as u128)
        .ok_or(DuelError::MathOverflow)?
        .checked_div(BPS_DENOMINATOR as u128)
        .ok_or(DuelError::MathOverflow)? as u64;

    let transfer_to_winner = after_creator
        .checked_sub(protocol_fee)
        .ok_or(DuelError::MathOverflow)?;

    // Transfer SOL from losing vault to winning vault
    if transfer_to_winner > 0 {
        **losing_vault.to_account_info().try_borrow_mut_lamports()? -= transfer_to_winner;
        **winning_vault.to_account_info().try_borrow_mut_lamports()? += transfer_to_winner;
    }

    // Transfer creator fee
    if creator_fee > 0 {
        **losing_vault.to_account_info().try_borrow_mut_lamports()? -= creator_fee;
        **ctx.accounts.creator_fee_account.to_account_info().try_borrow_mut_lamports()? += creator_fee;
    }

    // Transfer protocol fee
    if protocol_fee > 0 {
        **losing_vault.to_account_info().try_borrow_mut_lamports()? -= protocol_fee;
        **ctx.accounts.protocol_fee_account.to_account_info().try_borrow_mut_lamports()? += protocol_fee;
    }

    // Update market state
    market.status = MarketStatus::Resolved;
    market.winner = Some(winner);
    market.final_twap_a = final_twap_a;
    market.final_twap_b = final_twap_b;

    emit!(MarketResolved {
        market: market.key(),
        winner,
        is_draw: false,
        final_twap_a,
        final_twap_b,
        transfer_amount: transfer_to_winner,
        protocol_fee,
        creator_fee,
    });

    Ok(())
}

