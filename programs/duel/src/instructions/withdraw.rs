use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::errors::DuelError;
use crate::events::Withdrawn;
use crate::state::*;

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,

    #[account(
        constraint = compare_duel.status == MarketStatus::Resolved @ DuelError::DuelNotResolved,
    )]
    pub compare_duel: Box<Account<'info, CompareDuel>>,

    #[account(
        mut,
        constraint = deposit_record.duel == compare_duel.key() @ DuelError::InvalidMarketConfig,
        constraint = deposit_record.depositor == depositor.key() @ DuelError::InvalidMarketConfig,
        constraint = !deposit_record.withdrawn @ DuelError::AlreadyWithdrawn,
    )]
    pub deposit_record: Box<Account<'info, Deposit>>,

    /// Winning side's pool vault (or vault matching deposit side for draw)
    #[account(
        mut,
        constraint = (pool_vault.key() == compare_duel.pool_vault_a || pool_vault.key() == compare_duel.pool_vault_b) @ DuelError::InvalidSide,
    )]
    pub pool_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Depositor's WSOL token account
    #[account(mut)]
    pub depositor_wsol_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Quote token mint (WSOL)
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<Withdraw>) -> Result<()> {
    let duel = &ctx.accounts.compare_duel;
    let deposit = &ctx.accounts.deposit_record;

    let payout: u64;

    if let Some(winning_side) = duel.winner {
        // There is a winner
        if deposit.side == winning_side {
            // Winner: proportional share of net_pool
            let winning_side_total = if winning_side == 0 {
                duel.side_a_total
            } else {
                duel.side_b_total
            };

            // Validate the correct vault is passed (winner's vault)
            let expected_vault = if winning_side == 0 {
                duel.pool_vault_a
            } else {
                duel.pool_vault_b
            };
            require!(
                ctx.accounts.pool_vault.key() == expected_vault,
                DuelError::InvalidSide
            );

            // payout = (deposit_amount * net_pool) / winning_side_total
            payout = (deposit.amount as u128)
                .checked_mul(duel.net_pool as u128)
                .ok_or(DuelError::MathOverflow)?
                .checked_div(winning_side_total as u128)
                .ok_or(DuelError::MathOverflow)? as u64;
        } else {
            // Loser: zero payout
            payout = 0;
        }
    } else {
        // Draw: full refund from the depositor's side vault
        let expected_vault = if deposit.side == 0 {
            duel.pool_vault_a
        } else {
            duel.pool_vault_b
        };
        require!(
            ctx.accounts.pool_vault.key() == expected_vault,
            DuelError::InvalidSide
        );

        payout = deposit.amount;
    }

    // Transfer payout if > 0
    if payout > 0 {
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

        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.pool_vault.to_account_info(),
                    mint: ctx.accounts.quote_mint.to_account_info(),
                    to: ctx.accounts.depositor_wsol_account.to_account_info(),
                    authority: ctx.accounts.compare_duel.to_account_info(),
                },
                signer_seeds,
            ),
            payout,
            quote_decimals,
        )?;
    }

    // Mark deposit as withdrawn
    let deposit = &mut ctx.accounts.deposit_record;
    deposit.withdrawn = true;

    let duel_key = ctx.accounts.compare_duel.key();
    emit!(Withdrawn {
        duel: duel_key,
        depositor: ctx.accounts.depositor.key(),
        payout,
    });

    Ok(())
}
