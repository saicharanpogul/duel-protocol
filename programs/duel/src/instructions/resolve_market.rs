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
    /// CHECK: SOL vault PDA, validated by constraint
    pub sol_vault_a: SystemAccount<'info>,

    /// SOL vault for Side B
    #[account(
        mut,
        constraint = sol_vault_b.key() == side_b.sol_reserve_vault @ DuelError::InvalidSide,
    )]
    /// CHECK: SOL vault PDA, validated by constraint
    pub sol_vault_b: SystemAccount<'info>,

    /// Protocol fee recipient
    #[account(
        mut,
        constraint = protocol_fee_account.key() == market.protocol_fee_account @ DuelError::InvalidMarketConfig,
    )]
    /// CHECK: Fee account validated by market state
    pub protocol_fee_account: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<ResolveMarket>) -> Result<()> {
    let clock = Clock::get()?;
    let market = &mut ctx.accounts.market;

    // Must be past deadline
    require!(clock.unix_timestamp >= market.deadline, DuelError::MarketNotExpired);

    // Must not already be resolved
    require!(market.status != MarketStatus::Resolved, DuelError::MarketAlreadyResolved);

    // Must have TWAP samples
    require!(market.twap_samples_count > 0, DuelError::NoTwapSamples);

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

    // Determine winner (higher TWAP wins; tie goes to higher reserve)
    let winner: u8;
    if final_twap_a > final_twap_b {
        winner = 0;
    } else if final_twap_b > final_twap_a {
        winner = 1;
    } else {
        // Tie: higher SOL reserve wins
        let reserve_a = ctx.accounts.sol_vault_a.lamports();
        let reserve_b = ctx.accounts.sol_vault_b.lamports();
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

    let losing_reserve = losing_vault.lamports();
    let transfer_amount = (losing_reserve as u128)
        .checked_mul(market.battle_tax_bps as u128)
        .ok_or(DuelError::MathOverflow)?
        .checked_div(BPS_DENOMINATOR as u128)
        .ok_or(DuelError::MathOverflow)? as u64;

    let protocol_fee = (transfer_amount as u128)
        .checked_mul(market.protocol_fee_bps as u128)
        .ok_or(DuelError::MathOverflow)?
        .checked_div(BPS_DENOMINATOR as u128)
        .ok_or(DuelError::MathOverflow)? as u64;

    let transfer_to_winner = transfer_amount
        .checked_sub(protocol_fee)
        .ok_or(DuelError::MathOverflow)?;

    // Transfer SOL from losing vault to winning vault
    if transfer_to_winner > 0 {
        **losing_vault.to_account_info().try_borrow_mut_lamports()? -= transfer_to_winner;
        **winning_vault.to_account_info().try_borrow_mut_lamports()? += transfer_to_winner;
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
        final_twap_a,
        final_twap_b,
        transfer_amount: transfer_to_winner,
        protocol_fee,
    });

    Ok(())
}
