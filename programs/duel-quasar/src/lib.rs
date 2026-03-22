#![cfg_attr(not(test), no_std)]

use quasar_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod math;
pub mod state;

use instructions::*;

declare_id!("J7pWj28bnEz7AEANx8o6q3MuC5Ugcqa2EXo7RAFdcb3G");

#[program]
mod duel_quasar {
    use super::*;

    #[instruction(discriminator = 0)]
    pub fn initialize_config(
        ctx: Ctx<InitializeConfig>,
        trade_fee_bps: u16,
        creator_fee_split_bps: u16,
        market_creation_fee: u64,
    ) -> Result<(), ProgramError> {
        ctx.accounts
            .handler(trade_fee_bps, creator_fee_split_bps, market_creation_fee, &ctx.bumps)
    }

    #[instruction(discriminator = 1)]
    pub fn update_config(
        ctx: Ctx<UpdateConfig>,
        paused: u8,
        trade_fee_bps: u16,
        creator_fee_split_bps: u16,
        market_creation_fee: u64,
        min_market_duration: u64,
    ) -> Result<(), ProgramError> {
        ctx.accounts.handler(
            paused,
            trade_fee_bps,
            creator_fee_split_bps,
            market_creation_fee,
            min_market_duration,
        )
    }

    #[instruction(discriminator = 2)]
    pub fn initialize_market(
        ctx: Ctx<InitializeMarket>,
        market_id: u64,
        deadline: i64,
        twap_window: u64,
        twap_interval: u64,
    ) -> Result<(), ProgramError> {
        ctx.accounts
            .handler(market_id, deadline, twap_window, twap_interval, &ctx.bumps)
    }

    #[instruction(discriminator = 3)]
    pub fn buy_tokens(
        ctx: Ctx<BuyTokens>,
        side: u8,
        quote_amount: u64,
        min_tokens_out: u64,
    ) -> Result<(), ProgramError> {
        ctx.accounts
            .handler(side, quote_amount, min_tokens_out, &ctx.bumps)
    }

    #[instruction(discriminator = 4)]
    pub fn sell_tokens(
        ctx: Ctx<SellTokens>,
        side: u8,
        token_amount: u64,
        min_quote_out: u64,
    ) -> Result<(), ProgramError> {
        ctx.accounts.handler(side, token_amount, min_quote_out)
    }

    #[instruction(discriminator = 5)]
    pub fn record_twap_sample(ctx: Ctx<RecordTwapSample>) -> Result<(), ProgramError> {
        ctx.accounts.handler()
    }

    #[instruction(discriminator = 6)]
    pub fn sell_post_resolution(
        ctx: Ctx<SellPostResolution>,
        side: u8,
        token_amount: u64,
        min_quote_out: u64,
    ) -> Result<(), ProgramError> {
        ctx.accounts.handler(side, token_amount, min_quote_out)
    }

    #[instruction(discriminator = 7)]
    pub fn emergency_resolve(ctx: Ctx<EmergencyResolve>) -> Result<(), ProgramError> {
        ctx.accounts.handler()
    }

    #[instruction(discriminator = 8)]
    pub fn close_market(ctx: Ctx<CloseMarket>) -> Result<(), ProgramError> {
        ctx.accounts.handler()
    }

    #[instruction(discriminator = 9)]
    pub fn resolve_and_graduate(
        ctx: Ctx<ResolveAndGraduate>,
        expected_winner: u8,
    ) -> Result<(), ProgramError> {
        ctx.accounts.handler(expected_winner)
    }

    #[instruction(discriminator = 10)]
    pub fn claim_pool_fees(ctx: Ctx<ClaimPoolFees>) -> Result<(), ProgramError> {
        ctx.accounts.handler()
    }

    #[instruction(discriminator = 11)]
    pub fn close_quote_vault(
        ctx: Ctx<CloseQuoteVault>,
        side: u8,
    ) -> Result<(), ProgramError> {
        ctx.accounts.handler(side)
    }
}

#[cfg(test)]
mod tests;
