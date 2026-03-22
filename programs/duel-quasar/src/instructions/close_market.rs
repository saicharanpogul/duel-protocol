use quasar_lang::prelude::*;

use crate::errors::DuelError;
use crate::events::MarketClosed;
use crate::state::*;

#[derive(Accounts)]
pub struct CloseMarket<'info> {
    /// Market creator or protocol admin
    pub authority: &'info mut Signer,

    #[account(mut, close = authority)]
    pub market: &'info mut Account<Market>,

    #[account(mut, close = authority)]
    pub side_a: &'info mut Account<Side>,

    #[account(mut, close = authority)]
    pub side_b: &'info mut Account<Side>,

    /// Protocol config (for admin check)
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: &'info Account<ProgramConfig>,

    pub system_program: &'info Program<System>,
}

impl<'info> CloseMarket<'info> {
    #[inline(always)]
    pub fn handler(&mut self) -> Result<(), ProgramError> {
        // Market must be resolved
        require!(
            self.market.status == STATUS_RESOLVED,
            DuelError::MarketNotResolved
        );

        // Authority must be market creator or protocol admin
        let authority_addr = self.authority.address();
        require!(
            self.market.authority == *authority_addr || self.config.admin == *authority_addr,
            DuelError::InvalidMarketConfig
        );

        // Side validation
        require!(
            self.side_a.market == *self.market.to_account_view().address(),
            DuelError::InvalidSide
        );
        require!(self.side_a.side_index == 0, DuelError::InvalidSide);
        require!(
            self.side_a.circulating_supply.get() == 0,
            DuelError::InsufficientTokenBalance
        );

        require!(
            self.side_b.market == *self.market.to_account_view().address(),
            DuelError::InvalidSide
        );
        require!(self.side_b.side_index == 1, DuelError::InvalidSide);
        require!(
            self.side_b.circulating_supply.get() == 0,
            DuelError::InsufficientTokenBalance
        );

        let market_key = *self.market.to_account_view().address();

        emit!(MarketClosed {
            market: market_key,
            authority: *self.authority.address(),
        });

        // close = authority handles rent recovery via epilogue

        Ok(())
    }
}
