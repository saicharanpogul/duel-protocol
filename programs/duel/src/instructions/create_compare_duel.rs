use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::errors::DuelError;
use crate::events::CompareDuelCreated;
use crate::math::oracle;
use crate::state::*;

#[derive(Accounts)]
#[instruction(duel_id: u64)]
pub struct CreateCompareDuel<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        init,
        payer = creator,
        space = CompareDuel::SIZE,
        seeds = [b"compare_duel", creator.key().as_ref(), &duel_id.to_le_bytes()],
        bump,
    )]
    pub compare_duel: Box<Account<'info, CompareDuel>>,

    /// Quote token mint (WSOL)
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,

    /// WSOL vault for Side A deposits
    #[account(
        init,
        payer = creator,
        token::mint = quote_mint,
        token::authority = compare_duel,
        token::token_program = token_program,
        seeds = [b"compare_vault", compare_duel.key().as_ref(), &[0u8]],
        bump,
    )]
    pub pool_vault_a: Box<InterfaceAccount<'info, TokenAccount>>,

    /// WSOL vault for Side B deposits
    #[account(
        init,
        payer = creator,
        token::mint = quote_mint,
        token::authority = compare_duel,
        token::token_program = token_program,
        seeds = [b"compare_vault", compare_duel.key().as_ref(), &[1u8]],
        bump,
    )]
    pub pool_vault_b: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Pyth price feed account for token A
    /// CHECK: Validated by reading Pyth magic number from account data
    pub oracle_a: UncheckedAccount<'info>,

    /// Pyth price feed account for token B
    /// CHECK: Validated by reading Pyth magic number from account data
    pub oracle_b: UncheckedAccount<'info>,

    /// Protocol config (pause check + fee rates)
    #[account(
        seeds = [b"config"],
        bump = config.bump,
        constraint = !config.paused @ DuelError::ProtocolPaused,
    )]
    pub config: Box<Account<'info, ProgramConfig>>,

    /// CHECK: Validated against config.protocol_fee_account
    #[account(
        constraint = protocol_fee_account.key() == config.protocol_fee_account @ DuelError::InvalidFeeConfig,
    )]
    pub protocol_fee_account: UncheckedAccount<'info>,

    /// Creator fee recipient
    /// CHECK: Stored on duel, validated at resolution time
    #[account(
        constraint = creator_fee_account.key() != Pubkey::default() @ DuelError::InvalidFeeConfig,
    )]
    pub creator_fee_account: UncheckedAccount<'info>,

    /// Token A mint (existing token, e.g. $BONK)
    /// CHECK: Stored on duel for reference
    pub token_a_mint: UncheckedAccount<'info>,

    /// Token B mint (existing token, e.g. $WIF)
    /// CHECK: Stored on duel for reference
    pub token_b_mint: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(
    ctx: Context<CreateCompareDuel>,
    duel_id: u64,
    deadline: i64,
    twap_window: u64,
    twap_interval: u64,
    min_deposit: u64,
) -> Result<()> {
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // Validate deadline
    require!(deadline > now, DuelError::InvalidMarketConfig);
    let duration = (deadline - now) as u64;
    require!(
        duration >= ctx.accounts.config.min_market_duration,
        DuelError::InvalidMarketConfig
    );

    // Validate TWAP parameters
    require!(
        twap_window > 0 && twap_window < duration,
        DuelError::InvalidMarketConfig
    );
    require!(
        twap_interval >= MIN_TWAP_INTERVAL && twap_interval <= MAX_TWAP_INTERVAL,
        DuelError::InvalidMarketConfig
    );

    // Validate min_deposit
    let effective_min_deposit = if min_deposit > 0 {
        min_deposit
    } else {
        DEFAULT_MIN_DEPOSIT
    };

    // Oracle accounts are validated during TWAP sampling (record_compare_twap),
    // not at creation. This allows creating duels before oracles are live.

    // Token mints must be different
    require!(
        ctx.accounts.token_a_mint.key() != ctx.accounts.token_b_mint.key(),
        DuelError::InvalidMarketConfig
    );

    // Charge market creation fee if configured
    if ctx.accounts.config.market_creation_fee > 0 {
        anchor_lang::system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.creator.to_account_info(),
                    to: ctx.accounts.protocol_fee_account.to_account_info(),
                },
            ),
            ctx.accounts.config.market_creation_fee,
        )?;
    }

    // Initialize CompareDuel state
    let duel = &mut ctx.accounts.compare_duel;
    duel.version = 1;
    duel.bump = ctx.bumps.compare_duel;
    duel.authority = ctx.accounts.creator.key();
    duel.duel_id = duel_id;
    duel.token_a_mint = ctx.accounts.token_a_mint.key();
    duel.token_b_mint = ctx.accounts.token_b_mint.key();
    duel.oracle_a = ctx.accounts.oracle_a.key();
    duel.oracle_b = ctx.accounts.oracle_b.key();
    duel.pool_vault_a = ctx.accounts.pool_vault_a.key();
    duel.pool_vault_b = ctx.accounts.pool_vault_b.key();
    duel.side_a_total = 0;
    duel.side_b_total = 0;
    duel.deadline = deadline;
    duel.twap_window = twap_window;
    duel.twap_interval = twap_interval;
    duel.start_price_a = 0;
    duel.start_price_b = 0;
    duel.twap_accumulator_a = 0;
    duel.twap_accumulator_b = 0;
    duel.twap_samples_count = 0;
    duel.last_sample_ts = 0;
    duel.status = MarketStatus::Active;
    duel.winner = None;
    duel.net_pool = 0;
    duel.min_deposit = effective_min_deposit;
    duel.creator_fee_account = ctx.accounts.creator_fee_account.key();
    duel.protocol_fee_account = ctx.accounts.protocol_fee_account.key();
    duel.emergency_window = DEFAULT_EMERGENCY_WINDOW;
    duel._reserved = [0u8; 64];

    emit!(CompareDuelCreated {
        duel: duel.key(),
        authority: ctx.accounts.creator.key(),
        token_a_mint: ctx.accounts.token_a_mint.key(),
        token_b_mint: ctx.accounts.token_b_mint.key(),
        deadline,
    });

    Ok(())
}
