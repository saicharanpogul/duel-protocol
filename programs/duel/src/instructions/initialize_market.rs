use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount};

use crate::constants::*;
use crate::errors::DuelError;
use crate::events::MarketCreated;
use crate::state::*;

#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct InitializeMarket<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        init,
        payer = creator,
        space = Market::SIZE,
        seeds = [b"market", creator.key().as_ref(), &market_id.to_le_bytes()],
        bump,
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(
        init,
        payer = creator,
        space = Side::SIZE,
        seeds = [b"side", market.key().as_ref(), &[0u8]],
        bump,
    )]
    pub side_a: Box<Account<'info, Side>>,

    #[account(
        init,
        payer = creator,
        space = Side::SIZE,
        seeds = [b"side", market.key().as_ref(), &[1u8]],
        bump,
    )]
    pub side_b: Box<Account<'info, Side>>,

    #[account(
        init,
        payer = creator,
        mint::decimals = 6,
        mint::authority = market,
        seeds = [b"mint", market.key().as_ref(), &[0u8]],
        bump,
    )]
    pub token_mint_a: Box<Account<'info, Mint>>,

    #[account(
        init,
        payer = creator,
        mint::decimals = 6,
        mint::authority = market,
        seeds = [b"mint", market.key().as_ref(), &[1u8]],
        bump,
    )]
    pub token_mint_b: Box<Account<'info, Mint>>,

    #[account(
        init,
        payer = creator,
        token::mint = token_mint_a,
        token::authority = market,
        seeds = [b"token_vault", market.key().as_ref(), &[0u8]],
        bump,
    )]
    pub token_vault_a: Box<Account<'info, TokenAccount>>,

    #[account(
        init,
        payer = creator,
        token::mint = token_mint_b,
        token::authority = market,
        seeds = [b"token_vault", market.key().as_ref(), &[1u8]],
        bump,
    )]
    pub token_vault_b: Box<Account<'info, TokenAccount>>,

    /// SOL vault for Side A (program-owned PDA)
    #[account(
        init,
        payer = creator,
        space = SolVault::SIZE,
        seeds = [b"sol_vault", market.key().as_ref(), &[0u8]],
        bump,
    )]
    pub sol_vault_a: Account<'info, SolVault>,

    /// SOL vault for Side B (program-owned PDA)
    #[account(
        init,
        payer = creator,
        space = SolVault::SIZE,
        seeds = [b"sol_vault", market.key().as_ref(), &[1u8]],
        bump,
    )]
    pub sol_vault_b: Account<'info, SolVault>,

    /// Protocol fee recipient
    /// CHECK: Arbitrary fee account, no validation needed
    pub protocol_fee_account: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(
    ctx: Context<InitializeMarket>,
    market_id: u64,
    deadline: i64,
    twap_window: u64,
    twap_interval: u64,
    battle_tax_bps: u16,
    protocol_fee_bps: u16,
    sell_penalty_max_bps: u16,
    protection_activation_offset: u64,
    curve_params: CurveParams,
    total_supply_per_side: u64,
) -> Result<()> {
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // Validation
    require!(deadline > now, DuelError::InvalidMarketConfig);
    require!(
        twap_window > 0 && twap_window < ((deadline - now) as u64),
        DuelError::InvalidMarketConfig
    );
    require!(
        twap_interval >= MIN_TWAP_INTERVAL && twap_interval <= MAX_TWAP_INTERVAL,
        DuelError::InvalidMarketConfig
    );
    require!(battle_tax_bps <= MAX_BATTLE_TAX_BPS, DuelError::InvalidMarketConfig);
    require!(protocol_fee_bps <= MAX_PROTOCOL_FEE_BPS, DuelError::InvalidMarketConfig);
    require!(
        sell_penalty_max_bps <= MAX_SELL_PENALTY_BPS,
        DuelError::InvalidMarketConfig
    );
    require!(
        protection_activation_offset <= ((deadline - now) as u64),
        DuelError::InvalidMarketConfig
    );
    require!(curve_params.a > 0, DuelError::InvalidCurveParams);
    require!(
        curve_params.n >= MIN_CURVE_EXPONENT && curve_params.n <= MAX_CURVE_EXPONENT,
        DuelError::InvalidCurveParams
    );
    require!(curve_params.b > 0, DuelError::InvalidCurveParams);
    require!(total_supply_per_side > 0, DuelError::InvalidMarketConfig);

    let market = &mut ctx.accounts.market;
    let side_a = &mut ctx.accounts.side_a;
    let side_b = &mut ctx.accounts.side_b;

    // Initialize market state
    market.authority = ctx.accounts.creator.key();
    market.market_id = market_id;
    market.side_a = side_a.key();
    market.side_b = side_b.key();
    market.deadline = deadline;
    market.twap_window = twap_window;
    market.twap_interval = twap_interval;
    market.battle_tax_bps = battle_tax_bps;
    market.protocol_fee_bps = protocol_fee_bps;
    market.sell_penalty_max_bps = sell_penalty_max_bps;
    market.protection_activation_offset = protection_activation_offset;
    market.curve_params = curve_params;
    market.status = MarketStatus::Active;
    market.twap_samples_count = 0;
    market.last_sample_ts = 0;
    market.winner = None;
    market.final_twap_a = 0;
    market.final_twap_b = 0;
    market.protocol_fee_account = ctx.accounts.protocol_fee_account.key();
    market.bump = ctx.bumps.market;

    // Initialize Side A
    side_a.market = market.key();
    side_a.side_index = 0;
    side_a.token_mint = ctx.accounts.token_mint_a.key();
    side_a.token_reserve_vault = ctx.accounts.token_vault_a.key();
    side_a.sol_reserve_vault = ctx.accounts.sol_vault_a.key();
    side_a.total_supply = total_supply_per_side;
    side_a.circulating_supply = 0;
    side_a.peak_reserve = 0;
    side_a.twap_accumulator = 0;
    side_a.bump = ctx.bumps.side_a;

    // Initialize Side B
    side_b.market = market.key();
    side_b.side_index = 1;
    side_b.token_mint = ctx.accounts.token_mint_b.key();
    side_b.token_reserve_vault = ctx.accounts.token_vault_b.key();
    side_b.sol_reserve_vault = ctx.accounts.sol_vault_b.key();
    side_b.total_supply = total_supply_per_side;
    side_b.circulating_supply = 0;
    side_b.peak_reserve = 0;
    side_b.twap_accumulator = 0;
    side_b.bump = ctx.bumps.side_b;

    // Mint total supply into each token vault
    let market_key = market.key();
    let market_id_bytes = market_id.to_le_bytes();
    let bump = market.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        b"market",
        ctx.accounts.creator.key.as_ref(),
        &market_id_bytes,
        &[bump],
    ]];

    // Mint Side A tokens
    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.token_mint_a.to_account_info(),
                to: ctx.accounts.token_vault_a.to_account_info(),
                authority: market.to_account_info(),
            },
            signer_seeds,
        ),
        total_supply_per_side,
    )?;

    // Mint Side B tokens
    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.token_mint_b.to_account_info(),
                to: ctx.accounts.token_vault_b.to_account_info(),
                authority: market.to_account_info(),
            },
            signer_seeds,
        ),
        total_supply_per_side,
    )?;

    emit!(MarketCreated {
        market: market_key,
        authority: ctx.accounts.creator.key(),
        deadline,
        battle_tax_bps,
    });

    Ok(())
}
