use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, MintTo, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::cpi::metaplex_metadata;
use crate::errors::DuelError;
use crate::events::MarketCreated;
use crate::state::*;
use anchor_lang::system_program;

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
        mint::decimals = TOKEN_DECIMALS,
        mint::authority = market,
        mint::token_program = token_program,
        seeds = [b"mint", market.key().as_ref(), &[0u8]],
        bump,
    )]
    pub token_mint_a: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        payer = creator,
        mint::decimals = TOKEN_DECIMALS,
        mint::authority = market,
        mint::token_program = token_program,
        seeds = [b"mint", market.key().as_ref(), &[1u8]],
        bump,
    )]
    pub token_mint_b: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        payer = creator,
        token::mint = token_mint_a,
        token::authority = market,
        token::token_program = token_program,
        seeds = [b"token_vault", market.key().as_ref(), &[0u8]],
        bump,
    )]
    pub token_vault_a: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init,
        payer = creator,
        token::mint = token_mint_b,
        token::authority = market,
        token::token_program = token_program,
        seeds = [b"token_vault", market.key().as_ref(), &[1u8]],
        bump,
    )]
    pub token_vault_b: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Quote token mint (WSOL)
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,

    /// Quote token program (may differ from side token program for Token-2022)
    pub quote_token_program: Interface<'info, TokenInterface>,

    /// Quote vault for Side A
    #[account(
        init,
        payer = creator,
        token::mint = quote_mint,
        token::authority = market,
        token::token_program = quote_token_program,
        seeds = [b"quote_vault", market.key().as_ref(), &[0u8]],
        bump,
    )]
    pub quote_vault_a: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Quote vault for Side B
    #[account(
        init,
        payer = creator,
        token::mint = quote_mint,
        token::authority = market,
        token::token_program = quote_token_program,
        seeds = [b"quote_vault", market.key().as_ref(), &[1u8]],
        bump,
    )]
    pub quote_vault_b: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: Validated against config.protocol_fee_account
    #[account(
        constraint = protocol_fee_account.key() == config.protocol_fee_account @ DuelError::InvalidFeeConfig,
    )]
    pub protocol_fee_account: UncheckedAccount<'info>,

    /// Program config (pause check + market creation fee)
    #[account(
        seeds = [b"config"],
        bump = config.bump,
        constraint = !config.paused @ DuelError::ProtocolPaused,
    )]
    pub config: Box<Account<'info, ProgramConfig>>,

    /// Metadata account for token A
    /// CHECK: Created by Metaplex CPI, validated by seeds
    #[account(
        mut,
        seeds = [b"metadata", metaplex_metadata::TOKEN_METADATA_PROGRAM_ID.as_ref(), token_mint_a.key().as_ref()],
        bump,
        seeds::program = metaplex_metadata::TOKEN_METADATA_PROGRAM_ID,
    )]
    pub metadata_a: UncheckedAccount<'info>,

    /// Metadata account for token B
    /// CHECK: Created by Metaplex CPI, validated by seeds
    #[account(
        mut,
        seeds = [b"metadata", metaplex_metadata::TOKEN_METADATA_PROGRAM_ID.as_ref(), token_mint_b.key().as_ref()],
        bump,
        seeds::program = metaplex_metadata::TOKEN_METADATA_PROGRAM_ID,
    )]
    pub metadata_b: UncheckedAccount<'info>,

    /// Metaplex Token Metadata Program
    /// CHECK: Validated against known program ID
    #[account(
        constraint = token_metadata_program.key() == metaplex_metadata::TOKEN_METADATA_PROGRAM_ID @ DuelError::InvalidMarketConfig,
    )]
    pub token_metadata_program: UncheckedAccount<'info>,

    /// Creator fee recipient -- must be a valid account
    /// CHECK: Stored on market, validated at trade time
    #[account(
        constraint = creator_fee_account.key() != Pubkey::default() @ DuelError::InvalidFeeConfig,
    )]
    pub creator_fee_account: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(
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
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // Validation
    require!(deadline > now, DuelError::InvalidMarketConfig);
    let duration = (deadline - now) as u64;
    require!(
        duration >= ctx.accounts.config.min_market_duration,
        DuelError::InvalidMarketConfig
    );
    require!(
        twap_window > 0 && twap_window < duration,
        DuelError::InvalidMarketConfig
    );
    require!(
        twap_interval >= MIN_TWAP_INTERVAL && twap_interval <= MAX_TWAP_INTERVAL,
        DuelError::InvalidMarketConfig
    );

    // Charge market creation fee if configured
    let creation_fee = ctx.accounts.config.market_creation_fee;
    if creation_fee > 0 {
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.creator.to_account_info(),
                    to: ctx.accounts.protocol_fee_account.to_account_info(),
                },
            ),
            creation_fee,
        )?;
    }

    let market = &mut ctx.accounts.market;
    let side_a = &mut ctx.accounts.side_a;
    let side_b = &mut ctx.accounts.side_b;

    // Initialize market state
    market.version = 1;
    market.bump = ctx.bumps.market;
    market.authority = ctx.accounts.creator.key();
    market.market_id = market_id;
    market.side_a = side_a.key();
    market.side_b = side_b.key();
    market.quote_mint = ctx.accounts.quote_mint.key();
    market.deadline = deadline;
    market.twap_window = twap_window;
    market.twap_interval = twap_interval;
    market.creator_fee_account = ctx.accounts.creator_fee_account.key();
    market.protocol_fee_account = ctx.accounts.protocol_fee_account.key();
    market.status = MarketStatus::Active;
    market.twap_samples_count = 0;
    market.last_sample_ts = 0;
    market.winner = None;
    market.final_twap_a = 0;
    market.final_twap_b = 0;
    market.emergency_window = DEFAULT_EMERGENCY_WINDOW;
    market.locked = false;
    market._reserved = [0u8; 128];

    // Initialize Side A
    side_a.market = market.key();
    side_a.side_index = 0;
    side_a.token_mint = ctx.accounts.token_mint_a.key();
    side_a.token_reserve_vault = ctx.accounts.token_vault_a.key();
    side_a.quote_reserve_vault = ctx.accounts.quote_vault_a.key();
    side_a.total_supply = TOTAL_SUPPLY_PER_SIDE;
    side_a.circulating_supply = 0;
    side_a.twap_accumulator = 0;
    side_a.bump = ctx.bumps.side_a;
    side_a._reserved = [0u8; 32];

    // Initialize Side B
    side_b.market = market.key();
    side_b.side_index = 1;
    side_b.token_mint = ctx.accounts.token_mint_b.key();
    side_b.token_reserve_vault = ctx.accounts.token_vault_b.key();
    side_b.quote_reserve_vault = ctx.accounts.quote_vault_b.key();
    side_b.total_supply = TOTAL_SUPPLY_PER_SIDE;
    side_b.circulating_supply = 0;
    side_b.twap_accumulator = 0;
    side_b.bump = ctx.bumps.side_b;
    side_b._reserved = [0u8; 32];

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
    token_interface::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.token_mint_a.to_account_info(),
                to: ctx.accounts.token_vault_a.to_account_info(),
                authority: market.to_account_info(),
            },
            signer_seeds,
        ),
        TOTAL_SUPPLY_PER_SIDE,
    )?;

    // Mint Side B tokens
    token_interface::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.token_mint_b.to_account_info(),
                to: ctx.accounts.token_vault_b.to_account_info(),
                authority: market.to_account_info(),
            },
            signer_seeds,
        ),
        TOTAL_SUPPLY_PER_SIDE,
    )?;

    // Create Metaplex metadata for Side A
    metaplex_metadata::create_metadata_v3(
        ctx.accounts.metadata_a.to_account_info(),
        ctx.accounts.token_mint_a.to_account_info(),
        market.to_account_info(),
        ctx.accounts.creator.to_account_info(),
        market.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
        ctx.accounts.rent.to_account_info(),
        ctx.accounts.token_metadata_program.to_account_info(),
        name_a,
        symbol_a,
        uri_a,
        signer_seeds,
    )?;

    // Create Metaplex metadata for Side B
    metaplex_metadata::create_metadata_v3(
        ctx.accounts.metadata_b.to_account_info(),
        ctx.accounts.token_mint_b.to_account_info(),
        market.to_account_info(),
        ctx.accounts.creator.to_account_info(),
        market.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
        ctx.accounts.rent.to_account_info(),
        ctx.accounts.token_metadata_program.to_account_info(),
        name_b,
        symbol_b,
        uri_b,
        signer_seeds,
    )?;

    emit!(MarketCreated {
        market: market_key,
        authority: ctx.accounts.creator.key(),
        deadline,
        market_id,
        quote_mint: ctx.accounts.quote_mint.key(),
    });

    Ok(())
}
