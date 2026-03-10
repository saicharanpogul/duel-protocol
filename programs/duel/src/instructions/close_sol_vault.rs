use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, TokenAccount, TokenInterface, CloseAccount};

use crate::errors::DuelError;
use crate::state::*;

#[derive(Accounts)]
#[instruction(side: u8)]
pub struct CloseSolVault<'info> {
    /// Anyone can close — rent goes to rent_receiver
    #[account(mut)]
    pub closer: Signer<'info>,

    #[account(
        constraint = market.status == MarketStatus::Resolved @ DuelError::MarketNotResolved,
    )]
    pub market: Account<'info, Market>,

    #[account(
        constraint = side_account.market == market.key() @ DuelError::InvalidSide,
        constraint = side_account.side_index == side @ DuelError::InvalidSide,
    )]
    pub side_account: Account<'info, Side>,

    /// SOL vault to close
    #[account(
        mut,
        constraint = sol_vault.key() == side_account.sol_reserve_vault @ DuelError::InvalidSide,
        close = rent_receiver,
    )]
    pub sol_vault: Account<'info, SolVault>,

    /// Token vault to close (optional — only if empty)
    #[account(
        mut,
        constraint = token_vault.key() == side_account.token_reserve_vault @ DuelError::InvalidSide,
    )]
    pub token_vault: InterfaceAccount<'info, TokenAccount>,

    /// Receives rent from closed accounts
    /// CHECK: Any account can receive rent
    #[account(mut)]
    pub rent_receiver: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<CloseSolVault>, side: u8) -> Result<()> {
    require!(side <= 1, DuelError::InvalidSide);

    let market = &ctx.accounts.market;

    // Side must be graduated
    let graduated = if side == 0 { market.graduated_a } else { market.graduated_b };
    require!(graduated, DuelError::NotGraduated);

    // SOL vault must be drained (only rent-exempt minimum remains)
    // The `close = rent_receiver` attribute handles closing the SOL vault
    // and transferring remaining lamports to rent_receiver.

    // Close token vault if empty
    let token_vault = &ctx.accounts.token_vault;
    if token_vault.amount == 0 {
        // Build market PDA signer seeds for token vault authority
        let authority_key = market.authority;
        let market_id_bytes = market.market_id.to_le_bytes();
        let bump = market.bump;
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"market",
            authority_key.as_ref(),
            &market_id_bytes,
            &[bump],
        ]];

        token_interface::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            CloseAccount {
                account: ctx.accounts.token_vault.to_account_info(),
                destination: ctx.accounts.rent_receiver.to_account_info(),
                authority: ctx.accounts.market.to_account_info(),
            },
            signer_seeds,
        ))?;
    }

    Ok(())
}
