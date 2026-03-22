use quasar_lang::prelude::*;
use quasar_lang::sysvars::Sysvar as SysvarTrait;
use quasar_spl::{Token, TokenInterface, InterfaceAccount, Mint, TokenCpi};

use crate::constants::*;
use crate::errors::DuelError;
use crate::events::TokensBought;
use crate::math;
use crate::state::*;

#[derive(Accounts)]
pub struct BuyTokens<'info> {
    pub buyer: &'info mut Signer,

    #[account(mut)]
    pub market: &'info mut Account<Market>,

    #[account(mut)]
    pub side_account: &'info mut Account<Side>,

    /// Token mint for the selected side
    pub token_mint: &'info InterfaceAccount<Mint>,

    /// Token vault for the selected side
    #[account(mut)]
    pub token_vault: &'info mut InterfaceAccount<Token>,

    /// Buyer's token account for the selected side
    #[account(mut)]
    pub buyer_token_account: &'info mut InterfaceAccount<Token>,

    /// Quote token mint (WSOL)
    pub quote_mint: &'info InterfaceAccount<Mint>,

    /// Quote vault for the selected side
    #[account(mut)]
    pub quote_vault: &'info mut InterfaceAccount<Token>,

    /// Buyer's quote token account (WSOL ATA)
    #[account(mut)]
    pub buyer_quote_account: &'info mut InterfaceAccount<Token>,

    /// Protocol fee recipient (WSOL token account)
    #[account(mut)]
    pub protocol_fee_account: &'info mut InterfaceAccount<Token>,

    /// Creator fee recipient (WSOL token account)
    #[account(mut)]
    pub creator_fee_account: &'info mut InterfaceAccount<Token>,

    /// Protocol config
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: &'info Account<ProgramConfig>,

    pub token_program: &'info Interface<TokenInterface>,
    /// Quote token program
    pub quote_token_program: &'info Interface<TokenInterface>,
}

impl<'info> BuyTokens<'info> {
    #[inline(always)]
    pub fn handler(
        &mut self,
        side: u8,
        quote_amount: u64,
        min_tokens_out: u64,
        _bumps: &BuyTokensBumps,
    ) -> Result<(), ProgramError> {
        // Protocol pause check
        require!(self.config.paused == 0, DuelError::ProtocolPaused);

        let clock = Clock::get()?;
        let now = clock.unix_timestamp.get();

        // Deadline check
        require!(now < self.market.deadline.get(), DuelError::MarketExpired);
        // Status check
        require!(
            self.market.status != STATUS_RESOLVED,
            DuelError::MarketAlreadyResolved
        );
        require!(quote_amount > 0, DuelError::InsufficientSolAmount);

        // Side validation
        require!(
            self.side_account.market == *self.market.to_account_view().address(),
            DuelError::InvalidSide
        );
        require!(self.side_account.side_index == side, DuelError::InvalidSide);

        // Token mint validation
        require!(
            *self.token_mint.to_account_view().address() == self.side_account.token_mint,
            DuelError::InvalidSide
        );

        // Token vault validation
        require!(
            *self.token_vault.to_account_view().address() == self.side_account.token_reserve_vault,
            DuelError::InvalidSide
        );

        // Quote mint validation
        require!(
            *self.quote_mint.to_account_view().address() == self.market.quote_mint,
            DuelError::InvalidMarketConfig
        );

        // Quote vault validation
        require!(
            *self.quote_vault.to_account_view().address() == self.side_account.quote_reserve_vault,
            DuelError::InvalidSide
        );

        // Fee account validations
        require!(
            *self.protocol_fee_account.to_account_view().address() == self.config.protocol_fee_account,
            DuelError::InvalidFeeConfig
        );
        require!(
            *self.creator_fee_account.to_account_view().address() == self.market.creator_fee_account,
            DuelError::InvalidFeeConfig
        );

        // Re-entrancy lock
        require!(self.market.locked == 0, DuelError::ReentrancyLocked);
        self.market.locked = 1;

        // Calculate trade fees
        let trade_fee_bps_val = self.config.trade_fee_bps.get() as u128;
        let trade_fee = ((quote_amount as u128)
            .checked_mul(trade_fee_bps_val)
            .ok_or(DuelError::MathOverflow)?
            .checked_div(BPS_DENOMINATOR as u128)
            .ok_or(DuelError::MathOverflow)?) as u64;

        let creator_fee_split = self.config.creator_fee_split_bps.get() as u128;
        let creator_fee = ((trade_fee as u128)
            .checked_mul(creator_fee_split)
            .ok_or(DuelError::MathOverflow)?
            .checked_div(BPS_DENOMINATOR as u128)
            .ok_or(DuelError::MathOverflow)?) as u64;

        let protocol_fee = trade_fee
            .checked_sub(creator_fee)
            .ok_or(DuelError::MathOverflow)?;

        let net_quote = quote_amount
            .checked_sub(trade_fee)
            .ok_or(DuelError::MathOverflow)?;

        // Calculate tokens out using bonding curve
        let params = CurveParams::default_params();
        let current_supply = self.side_account.circulating_supply.get();
        let total_supply = self.side_account.total_supply.get();
        let tokens = math::tokens_out(net_quote, current_supply, total_supply, &params)?;

        // Slippage check
        require!(tokens >= min_tokens_out, DuelError::SlippageExceeded);
        require!(tokens > 0, DuelError::InsufficientSolAmount);

        let quote_decimals = self.quote_mint.decimals();
        let token_decimals = self.token_mint.decimals();

        // Transfer net_quote from buyer to quote vault
        self.quote_token_program
            .transfer_checked(
                self.buyer_quote_account,
                self.quote_mint,
                self.quote_vault,
                self.buyer,
                net_quote,
                quote_decimals,
            )
            .invoke()?;

        // Transfer protocol fee from buyer to protocol fee account
        if protocol_fee > 0 {
            self.quote_token_program
                .transfer_checked(
                    self.buyer_quote_account,
                    self.quote_mint,
                    self.protocol_fee_account,
                    self.buyer,
                    protocol_fee,
                    quote_decimals,
                )
                .invoke()?;
        }

        // Transfer creator fee from buyer to creator fee account
        if creator_fee > 0 {
            self.quote_token_program
                .transfer_checked(
                    self.buyer_quote_account,
                    self.quote_mint,
                    self.creator_fee_account,
                    self.buyer,
                    creator_fee,
                    quote_decimals,
                )
                .invoke()?;
        }

        // Transfer tokens from vault to buyer (Market PDA signs)
        let market_id_bytes = self.market.market_id.get().to_le_bytes();
        let bump_byte = [self.market.bump];
        let authority_key = self.market.authority;
        let seeds = [
            Seed::from(b"market" as &[u8]),
            Seed::from(authority_key.as_ref()),
            Seed::from(market_id_bytes.as_ref()),
            Seed::from(bump_byte.as_ref()),
        ];

        self.token_program
            .transfer_checked(
                self.token_vault,
                self.token_mint,
                self.buyer_token_account,
                &*self.market,
                tokens,
                token_decimals,
            )
            .invoke_signed(&seeds)?;

        // Update side state
        let new_supply = current_supply
            .checked_add(tokens)
            .ok_or(DuelError::MathOverflow)?;
        self.side_account.circulating_supply = PodU64::from(new_supply);

        // Calculate new price for event
        let new_price = math::price(new_supply, &params)?;
        let market_key = *self.market.to_account_view().address();

        emit!(TokensBought {
            market: market_key,
            side: side as u64,
            buyer: *self.buyer.address(),
            quote_amount,
            tokens_received: tokens,
            fee_amount: trade_fee,
            new_price,
        });

        // Release re-entrancy lock
        self.market.locked = 0;

        Ok(())
    }
}
