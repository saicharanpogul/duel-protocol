use anchor_lang::prelude::*;

declare_id!("CgR6V1AxC7exDFNoh3Q5JP9aea9YuPqq283EwACUGpZE");

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod math;
pub mod state;

use instructions::*;

#[program]
pub mod duel {
    use super::*;

    pub fn initialize_market(
        ctx: Context<InitializeMarket>,
        market_id: u64,
        deadline: i64,
        twap_window: u64,
        twap_interval: u64,
        battle_tax_bps: u16,
        protocol_fee_bps: u16,
        sell_penalty_max_bps: u16,
        protection_activation_offset: u64,
        curve_params: state::CurveParams,
        total_supply_per_side: u64,
    ) -> Result<()> {
        instructions::initialize_market::handler(
            ctx,
            market_id,
            deadline,
            twap_window,
            twap_interval,
            battle_tax_bps,
            protocol_fee_bps,
            sell_penalty_max_bps,
            protection_activation_offset,
            curve_params,
            total_supply_per_side,
        )
    }

    pub fn buy_tokens(
        ctx: Context<BuyTokens>,
        side: u8,
        sol_amount: u64,
        min_tokens_out: u64,
    ) -> Result<()> {
        instructions::buy_tokens::handler(ctx, side, sol_amount, min_tokens_out)
    }

    pub fn sell_tokens(
        ctx: Context<SellTokens>,
        side: u8,
        token_amount: u64,
        min_sol_out: u64,
    ) -> Result<()> {
        instructions::sell_tokens::handler(ctx, side, token_amount, min_sol_out)
    }

    pub fn record_twap_sample(ctx: Context<RecordTwapSample>) -> Result<()> {
        instructions::record_twap_sample::handler(ctx)
    }

    pub fn resolve_market(ctx: Context<ResolveMarket>) -> Result<()> {
        instructions::resolve_market::handler(ctx)
    }

    pub fn sell_post_resolution(
        ctx: Context<SellPostResolution>,
        side: u8,
        token_amount: u64,
        min_sol_out: u64,
    ) -> Result<()> {
        instructions::sell_post_resolution::handler(ctx, side, token_amount, min_sol_out)
    }
}
