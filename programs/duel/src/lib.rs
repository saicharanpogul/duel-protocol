use anchor_lang::prelude::*;

declare_id!("CgR6V1AxC7exDFNoh3Q5JP9aea9YuPqq283EwACUGpZE");

pub mod constants;
pub mod cpi;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod math;
pub mod state;

use instructions::*;

#[allow(deprecated)]
#[program]
pub mod duel {
    use super::*;

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        trade_fee_bps: u16,
        creator_fee_split_bps: u16,
        market_creation_fee: u64,
    ) -> Result<()> {
        instructions::initialize_config::handler(ctx, trade_fee_bps, creator_fee_split_bps, market_creation_fee)
    }

    pub fn update_config(
        ctx: Context<UpdateConfig>,
        paused: Option<bool>,
        trade_fee_bps: Option<u16>,
        creator_fee_split_bps: Option<u16>,
        market_creation_fee: Option<u64>,
        min_market_duration: Option<u64>,
    ) -> Result<()> {
        instructions::update_config::handler(ctx, paused, trade_fee_bps, creator_fee_split_bps, market_creation_fee, min_market_duration)
    }

    pub fn initialize_market(
        ctx: Context<InitializeMarket>,
        market_id: u64,
        deadline: i64,
        twap_window: u64,
        twap_interval: u64,
        name_a: String,
        symbol_a: String,
        uri_a: String,
        name_b: String,
        symbol_b: String,
        uri_b: String,
    ) -> Result<()> {
        instructions::initialize_market::handler(
            ctx,
            market_id,
            deadline,
            twap_window,
            twap_interval,
            name_a,
            symbol_a,
            uri_a,
            name_b,
            symbol_b,
            uri_b,
        )
    }

    pub fn buy_tokens(
        ctx: Context<BuyTokens>,
        side: u8,
        quote_amount: u64,
        min_tokens_out: u64,
    ) -> Result<()> {
        instructions::buy_tokens::handler(ctx, side, quote_amount, min_tokens_out)
    }

    pub fn sell_tokens(
        ctx: Context<SellTokens>,
        side: u8,
        token_amount: u64,
        min_quote_out: u64,
    ) -> Result<()> {
        instructions::sell_tokens::handler(ctx, side, token_amount, min_quote_out)
    }

    pub fn record_twap_sample(ctx: Context<RecordTwapSample>) -> Result<()> {
        instructions::record_twap_sample::handler(ctx)
    }

    pub fn resolve_and_graduate(
        ctx: Context<ResolveAndGraduate>,
        expected_winner: u8,
    ) -> Result<()> {
        instructions::resolve_and_graduate::handler(ctx, expected_winner)
    }

    pub fn sell_post_resolution(
        ctx: Context<SellPostResolution>,
        side: u8,
        token_amount: u64,
        min_quote_out: u64,
    ) -> Result<()> {
        instructions::sell_post_resolution::handler(ctx, side, token_amount, min_quote_out)
    }

    pub fn close_quote_vault(
        ctx: Context<CloseQuoteVault>,
        side: u8,
    ) -> Result<()> {
        instructions::close_quote_vault::handler(ctx, side)
    }

    pub fn claim_pool_fees(
        ctx: Context<ClaimPoolFees>,
    ) -> Result<()> {
        instructions::claim_pool_fees::handler(ctx)
    }

    pub fn close_market(
        ctx: Context<CloseMarket>,
        side: u8,
    ) -> Result<()> {
        instructions::close_market::handler(ctx, side)
    }

    pub fn emergency_resolve(
        ctx: Context<EmergencyResolve>,
    ) -> Result<()> {
        instructions::emergency_resolve::handler(ctx)
    }
}
