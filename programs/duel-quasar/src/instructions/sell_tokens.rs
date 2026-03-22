use quasar_lang::prelude::*;
use quasar_lang::sysvars::Sysvar as SysvarTrait;
use quasar_spl::{Token, TokenInterface, InterfaceAccount, Mint, TokenCpi};

use crate::constants::*;
use crate::errors::DuelError;
use crate::events::TokensSold;
use crate::math;
use crate::state::*;

#[derive(Accounts)]
pub struct SellTokens<'info> {
    pub seller: &'info mut Signer,

    #[account(mut)]
    pub market: &'info mut Account<Market>,

    #[account(mut)]
    pub side_account: &'info mut Account<Side>,

    /// Token mint for the selected side
    pub token_mint: &'info InterfaceAccount<Mint>,

    /// Token vault for the selected side
    #[account(mut)]
    pub token_vault: &'info mut InterfaceAccount<Token>,

    /// Seller's token account
    #[account(mut)]
    pub seller_token_account: &'info mut InterfaceAccount<Token>,

    /// Quote token mint
    pub quote_mint: &'info InterfaceAccount<Mint>,

    /// Quote vault for the selected side
    #[account(mut)]
    pub quote_vault: &'info mut InterfaceAccount<Token>,

    /// Seller's quote token account
    #[account(mut)]
    pub seller_quote_account: &'info mut InterfaceAccount<Token>,

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

impl<'info> SellTokens<'info> {
    #[inline(always)]
    pub fn handler(
        &mut self,
        side: u8,
        token_amount: u64,
        min_quote_out: u64,
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
        require!(token_amount > 0, DuelError::InsufficientTokenBalance);

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

        let current_supply = self.side_account.circulating_supply.get();

        // Calculate raw quote out from bonding curve
        let params = CurveParams::default_params();
        let raw_quote = math::sol_out(token_amount, current_supply, &params)?;

        // Calculate trade fees on the output
        let trade_fee_bps_val = self.config.trade_fee_bps.get() as u128;
        let trade_fee = ((raw_quote as u128)
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

        let net_quote = raw_quote
            .checked_sub(trade_fee)
            .ok_or(DuelError::MathOverflow)?;

        // Slippage check
        require!(net_quote >= min_quote_out, DuelError::SlippageExceeded);

        // Check vault has enough quote tokens
        let vault_balance = self.quote_vault.amount();
        require!(vault_balance >= raw_quote, DuelError::InsufficientReserve);

        // Build market PDA signer seeds
        let market_id_bytes = self.market.market_id.get().to_le_bytes();
        let bump_byte = [self.market.bump];
        let authority_key = self.market.authority;
        let seeds = [
            Seed::from(b"market" as &[u8]),
            Seed::from(authority_key.as_ref()),
            Seed::from(market_id_bytes.as_ref()),
            Seed::from(bump_byte.as_ref()),
        ];

        let token_decimals = self.token_mint.decimals();
        let quote_decimals = self.quote_mint.decimals();

        // Transfer tokens from seller to vault
        self.token_program
            .transfer_checked(
                self.seller_token_account,
                self.token_mint,
                self.token_vault,
                self.seller,
                token_amount,
                token_decimals,
            )
            .invoke()?;

        // Transfer net_quote from quote vault to seller (Market PDA signs)
        self.quote_token_program
            .transfer_checked(
                self.quote_vault,
                self.quote_mint,
                self.seller_quote_account,
                &*self.market,
                net_quote,
                quote_decimals,
            )
            .invoke_signed(&seeds)?;

        // Transfer protocol fee from quote vault to protocol fee account
        if protocol_fee > 0 {
            self.quote_token_program
                .transfer_checked(
                    self.quote_vault,
                    self.quote_mint,
                    self.protocol_fee_account,
                    &*self.market,
                    protocol_fee,
                    quote_decimals,
                )
                .invoke_signed(&seeds)?;
        }

        // Transfer creator fee from quote vault to creator fee account
        if creator_fee > 0 {
            self.quote_token_program
                .transfer_checked(
                    self.quote_vault,
                    self.quote_mint,
                    self.creator_fee_account,
                    &*self.market,
                    creator_fee,
                    quote_decimals,
                )
                .invoke_signed(&seeds)?;
        }

        // Update side state
        let new_supply = current_supply
            .checked_sub(token_amount)
            .ok_or(DuelError::MathOverflow)?;
        self.side_account.circulating_supply = PodU64::from(new_supply);

        // Calculate new price for event
        let new_price = math::price(new_supply, &params)?;
        let market_key = *self.market.to_account_view().address();

        emit!(TokensSold {
            market: market_key,
            side: side as u64,
            seller: *self.seller.address(),
            token_amount,
            quote_received: net_quote,
            fee_amount: trade_fee,
            new_price,
        });

        // Release re-entrancy lock
        self.market.locked = 0;

        Ok(())
    }
}
