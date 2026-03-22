use quasar_lang::prelude::*;
use quasar_spl::{InterfaceAccount, Token, TokenInterface};

use crate::errors::DuelError;
use crate::state::*;

/// SPL Token CloseAccount instruction index
const TOKEN_CLOSE_ACCOUNT_IX: u8 = 9;

#[derive(Accounts)]
#[instruction(side: u8)]
pub struct CloseQuoteVault<'info> {
    /// Anyone can close -- rent goes to rent_receiver
    pub closer: &'info mut Signer,

    #[account(
        constraint = market.status == STATUS_RESOLVED @ DuelError::MarketNotResolved,
    )]
    pub market: &'info Account<Market>,

    #[account(
        constraint = side_account.market == *market.to_account_view().address() @ DuelError::InvalidSide,
        constraint = side_account.side_index == side @ DuelError::InvalidSide,
    )]
    pub side_account: &'info Account<Side>,

    /// Quote vault to close
    #[account(
        mut,
        constraint = *quote_vault.to_account_view().address() == side_account.quote_reserve_vault @ DuelError::InvalidSide,
    )]
    pub quote_vault: &'info mut InterfaceAccount<Token>,

    /// Token vault to close (optional -- only if empty)
    #[account(
        mut,
        constraint = *token_vault.to_account_view().address() == side_account.token_reserve_vault @ DuelError::InvalidSide,
    )]
    pub token_vault: &'info mut InterfaceAccount<Token>,

    /// Receives rent from closed accounts
    #[account(mut)]
    pub rent_receiver: &'info mut UncheckedAccount,

    pub token_program: &'info Interface<TokenInterface>,
    /// Quote token program (may differ for Token-2022)
    pub quote_token_program: &'info Interface<TokenInterface>,
}

impl<'info> CloseQuoteVault<'info> {
    #[inline(always)]
    pub fn handler(&mut self, side: u8) -> Result<(), ProgramError> {
        require!(side <= 1, DuelError::InvalidSide);

        // Build market PDA signer seeds
        let authority_key = self.market.authority;
        let market_id_bytes = self.market.market_id.get().to_le_bytes();
        let bump_byte = [self.market.bump];
        let seeds = [
            Seed::from(b"market" as &[u8]),
            Seed::from(authority_key.as_ref()),
            Seed::from(market_id_bytes.as_ref()),
            Seed::from(bump_byte.as_ref()),
        ];

        // Close quote vault if empty
        if self.quote_vault.amount() == 0 {
            close_token_account_cpi(
                self.quote_vault.to_account_view(),
                self.rent_receiver.to_account_view(),
                self.market.to_account_view(),
                self.quote_token_program.to_account_view(),
                &seeds,
            )?;
        }

        // Close token vault if empty
        if self.token_vault.amount() == 0 {
            close_token_account_cpi(
                self.token_vault.to_account_view(),
                self.rent_receiver.to_account_view(),
                self.market.to_account_view(),
                self.token_program.to_account_view(),
                &seeds,
            )?;
        }

        Ok(())
    }
}

/// Close a token account via raw CPI to SPL Token's CloseAccount instruction.
/// SPL Token CloseAccount (index=9) accounts:
///   0: account to close (writable)
///   1: destination for remaining SOL (writable)
///   2: authority (signer)
fn close_token_account_cpi(
    account: &AccountView,
    destination: &AccountView,
    authority: &AccountView,
    token_program: &AccountView,
    seeds: &[Seed],
) -> Result<(), ProgramError> {
    use quasar_lang::cpi::{BufCpiCall, InstructionAccount};

    let data = [TOKEN_CLOSE_ACCOUNT_IX; 1];

    let call = BufCpiCall::<3, 1>::new(
        token_program.address(),
        [
            InstructionAccount::writable(account.address()),
            InstructionAccount::writable(destination.address()),
            InstructionAccount::readonly_signer(authority.address()),
        ],
        [account, destination, authority],
        data,
        1,
    );

    call.invoke_signed(seeds)?;

    Ok(())
}
