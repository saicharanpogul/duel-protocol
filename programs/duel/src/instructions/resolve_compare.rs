use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::constants::*;
use crate::errors::DuelError;
use crate::events::CompareResolved;
use crate::state::*;

#[derive(Accounts)]
pub struct ResolveCompare<'info> {
    /// Anyone can trigger resolution (permissionless)
    #[account(mut)]
    pub resolver: Signer<'info>,

    #[account(
        mut,
        constraint = compare_duel.status != MarketStatus::Resolved @ DuelError::MarketAlreadyResolved,
    )]
    pub compare_duel: Box<Account<'info, CompareDuel>>,

    /// WSOL vault for Side A
    #[account(
        mut,
        constraint = pool_vault_a.key() == compare_duel.pool_vault_a @ DuelError::InvalidSide,
    )]
    pub pool_vault_a: Box<InterfaceAccount<'info, TokenAccount>>,

    /// WSOL vault for Side B
    #[account(
        mut,
        constraint = pool_vault_b.key() == compare_duel.pool_vault_b @ DuelError::InvalidSide,
    )]
    pub pool_vault_b: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Protocol fee recipient (WSOL token account)
    #[account(
        mut,
        constraint = protocol_fee_account.key() == compare_duel.protocol_fee_account @ DuelError::InvalidFeeConfig,
    )]
    pub protocol_fee_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Creator fee recipient (WSOL token account)
    #[account(
        mut,
        constraint = creator_fee_account.key() == compare_duel.creator_fee_account @ DuelError::InvalidFeeConfig,
    )]
    pub creator_fee_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Quote token mint (WSOL)
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,

    /// Protocol config (fee rates)
    #[account(
        seeds = [b"config"],
        bump = config.bump,
    )]
    pub config: Box<Account<'info, ProgramConfig>>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<ResolveCompare>) -> Result<()> {
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    let duel = &ctx.accounts.compare_duel;

    // Must be past deadline
    require!(now >= duel.deadline, DuelError::MarketNotExpired);

    // Must have sufficient TWAP samples (at least half the expected count, min 1)
    let min_samples = ((duel.twap_window / duel.twap_interval).max(1) / 2).max(1) as u32;
    require!(
        duel.twap_samples_count >= min_samples,
        DuelError::NoTwapSamples
    );

    // Both sides must have deposits
    require!(duel.side_a_total > 0 && duel.side_b_total > 0, DuelError::OneSideEmpty);

    // Calculate final TWAPs
    let samples = duel.twap_samples_count as u128;
    let twap_a = duel
        .twap_accumulator_a
        .checked_div(samples)
        .ok_or(DuelError::MathOverflow)? as u64;
    let twap_b = duel
        .twap_accumulator_b
        .checked_div(samples)
        .ok_or(DuelError::MathOverflow)? as u64;

    // Calculate performance as signed percentage change (scaled by 10^9)
    let start_a = duel.start_price_a;
    let start_b = duel.start_price_b;
    require!(start_a > 0 && start_b > 0, DuelError::NoTwapSamples);

    let perf_a: i128 = ((twap_a as i128)
        .checked_sub(start_a as i128)
        .ok_or(DuelError::MathOverflow)?)
    .checked_mul(1_000_000_000i128)
    .ok_or(DuelError::MathOverflow)?
    .checked_div(start_a as i128)
    .ok_or(DuelError::MathOverflow)?;

    let perf_b: i128 = ((twap_b as i128)
        .checked_sub(start_b as i128)
        .ok_or(DuelError::MathOverflow)?)
    .checked_mul(1_000_000_000i128)
    .ok_or(DuelError::MathOverflow)?
    .checked_div(start_b as i128)
    .ok_or(DuelError::MathOverflow)?;

    // Higher performance wins
    let winner: Option<u8> = if perf_a > perf_b {
        Some(0)
    } else if perf_b > perf_a {
        Some(1)
    } else {
        None // Exact tie = draw
    };

    // Build CompareDuel PDA signer seeds
    let authority_key = duel.authority;
    let duel_id_bytes = duel.duel_id.to_le_bytes();
    let bump = duel.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        b"compare_duel",
        authority_key.as_ref(),
        &duel_id_bytes,
        &[bump],
    ]];

    let quote_decimals = ctx.accounts.quote_mint.decimals;
    let total_pool = duel
        .side_a_total
        .checked_add(duel.side_b_total)
        .ok_or(DuelError::MathOverflow)?;

    let net_pool: u64;

    if let Some(winning_side) = winner {
        // Transfer loser's vault SOL to winner's vault
        let (loser_vault_info, winner_vault_info, loser_amount) = if winning_side == 0 {
            (
                ctx.accounts.pool_vault_b.to_account_info(),
                ctx.accounts.pool_vault_a.to_account_info(),
                ctx.accounts.pool_vault_b.amount,
            )
        } else {
            (
                ctx.accounts.pool_vault_a.to_account_info(),
                ctx.accounts.pool_vault_b.to_account_info(),
                ctx.accounts.pool_vault_a.amount,
            )
        };

        if loser_amount > 0 {
            token_interface::transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: loser_vault_info,
                        mint: ctx.accounts.quote_mint.to_account_info(),
                        to: winner_vault_info,
                        authority: ctx.accounts.compare_duel.to_account_info(),
                    },
                    signer_seeds,
                ),
                loser_amount,
                quote_decimals,
            )?;
        }

        // Calculate fees on total pool
        let config = &ctx.accounts.config;
        let trade_fee = (total_pool as u128)
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

        // Transfer fees from winner's vault
        let winner_vault_info_for_fees = if winning_side == 0 {
            ctx.accounts.pool_vault_a.to_account_info()
        } else {
            ctx.accounts.pool_vault_b.to_account_info()
        };

        if protocol_fee > 0 {
            token_interface::transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: winner_vault_info_for_fees.clone(),
                        mint: ctx.accounts.quote_mint.to_account_info(),
                        to: ctx.accounts.protocol_fee_account.to_account_info(),
                        authority: ctx.accounts.compare_duel.to_account_info(),
                    },
                    signer_seeds,
                ),
                protocol_fee,
                quote_decimals,
            )?;
        }

        if creator_fee > 0 {
            token_interface::transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: winner_vault_info_for_fees,
                        mint: ctx.accounts.quote_mint.to_account_info(),
                        to: ctx.accounts.creator_fee_account.to_account_info(),
                        authority: ctx.accounts.compare_duel.to_account_info(),
                    },
                    signer_seeds,
                ),
                creator_fee,
                quote_decimals,
            )?;
        }

        net_pool = total_pool
            .checked_sub(trade_fee)
            .ok_or(DuelError::MathOverflow)?;
    } else {
        // Draw: no fees, no transfers between vaults. Deposits refunded.
        net_pool = total_pool;
    }

    // Update duel state
    let duel = &mut ctx.accounts.compare_duel;
    duel.status = MarketStatus::Resolved;
    duel.winner = winner;
    duel.net_pool = net_pool;

    // Truncate perf values to i64 range for event (they are scaled by 10^9)
    let perf_a_bps = perf_a.clamp(i64::MIN as i128, i64::MAX as i128) as i64;
    let perf_b_bps = perf_b.clamp(i64::MIN as i128, i64::MAX as i128) as i64;

    let duel_key = duel.key();
    emit!(CompareResolved {
        duel: duel_key,
        winner,
        perf_a_bps,
        perf_b_bps,
        net_pool,
    });

    Ok(())
}
