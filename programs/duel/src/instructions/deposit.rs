use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::errors::DuelError;
use crate::events::Deposited;
use crate::state::*;

#[derive(Accounts)]
pub struct DepositSol<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,

    #[account(
        mut,
        constraint = compare_duel.status == MarketStatus::Active @ DuelError::MarketAlreadyResolved,
    )]
    pub compare_duel: Box<Account<'info, CompareDuel>>,

    #[account(
        init,
        payer = depositor,
        space = Deposit::SIZE,
        seeds = [b"deposit", compare_duel.key().as_ref(), depositor.key().as_ref()],
        bump,
    )]
    pub deposit_record: Box<Account<'info, Deposit>>,

    /// WSOL vault for the selected side (A or B)
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

    /// Protocol config (pause check)
    #[account(
        seeds = [b"config"],
        bump = config.bump,
        constraint = !config.paused @ DuelError::ProtocolPaused,
    )]
    pub config: Box<Account<'info, ProgramConfig>>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<DepositSol>, side: u8, amount: u64) -> Result<()> {
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    let duel = &ctx.accounts.compare_duel;

    // Validate side
    require!(side <= 1, DuelError::InvalidSide);

    // Validate amount
    require!(amount >= duel.min_deposit, DuelError::DepositTooSmall);

    // Validate not past deposit cutoff (deadline - twap_window)
    let deposit_cutoff = duel
        .deadline
        .checked_sub(duel.twap_window as i64)
        .ok_or(DuelError::MathOverflow)?;
    require!(now < deposit_cutoff, DuelError::DepositPeriodEnded);

    // Validate pool_vault matches the selected side
    let expected_vault = if side == 0 {
        duel.pool_vault_a
    } else {
        duel.pool_vault_b
    };
    require!(
        ctx.accounts.pool_vault.key() == expected_vault,
        DuelError::InvalidSide
    );

    // Transfer WSOL from depositor to pool vault
    let quote_decimals = ctx.accounts.quote_mint.decimals;
    token_interface::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.depositor_wsol_account.to_account_info(),
                mint: ctx.accounts.quote_mint.to_account_info(),
                to: ctx.accounts.pool_vault.to_account_info(),
                authority: ctx.accounts.depositor.to_account_info(),
            },
        ),
        amount,
        quote_decimals,
    )?;

    // Update side totals
    let duel = &mut ctx.accounts.compare_duel;
    if side == 0 {
        duel.side_a_total = duel
            .side_a_total
            .checked_add(amount)
            .ok_or(DuelError::MathOverflow)?;
    } else {
        duel.side_b_total = duel
            .side_b_total
            .checked_add(amount)
            .ok_or(DuelError::MathOverflow)?;
    }

    // Initialize deposit record
    let deposit = &mut ctx.accounts.deposit_record;
    deposit.duel = duel.key();
    deposit.depositor = ctx.accounts.depositor.key();
    deposit.side = side;
    deposit.amount = amount;
    deposit.withdrawn = false;
    deposit.bump = ctx.bumps.deposit_record;

    emit!(Deposited {
        duel: duel.key(),
        depositor: ctx.accounts.depositor.key(),
        side,
        amount,
    });

    Ok(())
}
