use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::AccountMeta;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::constants::*;
use crate::cpi::{meteora_damm, metaplex_metadata};
use crate::errors::DuelError;
use crate::events::MarketResolved;
use crate::state::*;

#[derive(Accounts)]
pub struct ResolveAndGraduate<'info> {
    #[account(mut)]
    pub resolver: Signer<'info>,

    #[account(
        mut,
        constraint = market.status != MarketStatus::Resolved @ DuelError::MarketAlreadyResolved,
    )]
    pub market: Box<Account<'info, Market>>,

    /// Protocol config
    #[account(
        seeds = [b"config"],
        bump = config.bump,
    )]
    pub config: Box<Account<'info, ProgramConfig>>,

    #[account(
        mut,
        constraint = side_a.market == market.key() @ DuelError::InvalidSide,
        constraint = side_a.side_index == 0 @ DuelError::InvalidSide,
    )]
    pub side_a: Box<Account<'info, Side>>,

    #[account(
        mut,
        constraint = side_b.market == market.key() @ DuelError::InvalidSide,
        constraint = side_b.side_index == 1 @ DuelError::InvalidSide,
    )]
    pub side_b: Box<Account<'info, Side>>,

    // Quote vaults for both sides
    #[account(
        mut,
        constraint = quote_vault_a.key() == side_a.quote_reserve_vault @ DuelError::InvalidSide,
    )]
    pub quote_vault_a: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = quote_vault_b.key() == side_b.quote_reserve_vault @ DuelError::InvalidSide,
    )]
    pub quote_vault_b: Box<InterfaceAccount<'info, TokenAccount>>,

    // Token vaults for both sides
    #[account(
        mut,
        constraint = token_vault_a.key() == side_a.token_reserve_vault @ DuelError::InvalidSide,
    )]
    pub token_vault_a: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = token_vault_b.key() == side_b.token_reserve_vault @ DuelError::InvalidSide,
    )]
    pub token_vault_b: Box<InterfaceAccount<'info, TokenAccount>>,

    // Token mints for both sides
    #[account(
        mut,
        constraint = token_mint_a.key() == side_a.token_mint @ DuelError::InvalidSide,
    )]
    pub token_mint_a: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        constraint = token_mint_b.key() == side_b.token_mint @ DuelError::InvalidSide,
    )]
    pub token_mint_b: Box<InterfaceAccount<'info, Mint>>,

    // Quote mint (WSOL)
    #[account(
        constraint = quote_mint.key() == market.quote_mint @ DuelError::InvalidMarketConfig,
    )]
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,

    /// Market PDA's ATA for winning side tokens (pre-created by caller)
    /// CHECK: Validated as token account during transfer CPI
    #[account(mut)]
    pub market_token_ata: UncheckedAccount<'info>,

    /// Market PDA's WSOL ATA (pre-created by caller)
    /// CHECK: Validated as token account during transfer CPI
    #[account(mut)]
    pub market_wsol_ata: UncheckedAccount<'info>,

    // --- Meteora DAMM v2 accounts ---

    /// CHECK: Initialized by Meteora CPI
    #[account(mut)]
    pub pool: UncheckedAccount<'info>,

    /// CHECK: New keypair, signer for Meteora CPI
    #[account(mut, signer)]
    pub position_nft_mint: UncheckedAccount<'info>,

    /// CHECK: Created by Meteora CPI
    #[account(mut)]
    pub position_nft_account: UncheckedAccount<'info>,

    /// CHECK: Created by Meteora CPI
    #[account(mut)]
    pub position: UncheckedAccount<'info>,

    /// CHECK: Created by Meteora CPI
    #[account(mut)]
    pub pool_token_vault_a: UncheckedAccount<'info>,

    /// CHECK: Created by Meteora CPI
    #[account(mut)]
    pub pool_token_vault_b: UncheckedAccount<'info>,

    /// CHECK: Validated against known pool authority constant
    #[account(
        constraint = pool_authority.key() == meteora_damm::POOL_AUTHORITY @ DuelError::InvalidMarketConfig,
    )]
    pub pool_authority: UncheckedAccount<'info>,

    /// CHECK: Validated by Meteora program
    pub event_authority: UncheckedAccount<'info>,

    /// CHECK: Validated against known Meteora DAMM v2 program ID
    #[account(
        constraint = meteora_program.key() == meteora_damm::METEORA_DAMM_V2_PROGRAM_ID @ DuelError::InvalidMarketConfig,
    )]
    pub meteora_program: UncheckedAccount<'info>,

    // --- Losing token metadata (for [DEFEATED] update) ---

    /// CHECK: Validated in handler by deriving expected metadata PDA for losing side mint
    #[account(mut)]
    pub losing_token_metadata: UncheckedAccount<'info>,

    /// CHECK: Validated against known Metaplex Token Metadata program ID
    #[account(
        constraint = token_metadata_program.key() == metaplex_metadata::TOKEN_METADATA_PROGRAM_ID @ DuelError::InvalidMarketConfig,
    )]
    pub token_metadata_program: UncheckedAccount<'info>,

    // --- Programs ---
    pub token_program: Interface<'info, TokenInterface>,
    pub quote_token_program: Interface<'info, TokenInterface>,

    /// CHECK: Validated against known Token-2022 program ID
    #[account(
        constraint = token_2022_program.key() == meteora_damm::TOKEN_2022_PROGRAM_ID @ DuelError::InvalidMarketConfig,
    )]
    pub token_2022_program: UncheckedAccount<'info>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<ResolveAndGraduate>, expected_winner: u8) -> Result<()> {
    let clock = Clock::get()?;

    // ---- Phase 1: Validate and determine winner via TWAP ----

    let market_key = ctx.accounts.market.key();
    let deadline = ctx.accounts.market.deadline;
    let twap_window = ctx.accounts.market.twap_window;
    let twap_interval = ctx.accounts.market.twap_interval;
    let twap_samples_count = ctx.accounts.market.twap_samples_count;
    let market_id_bytes = ctx.accounts.market.market_id.to_le_bytes();
    let bump = ctx.accounts.market.bump;
    let authority_key = ctx.accounts.market.authority;

    // Deadline must have passed
    require!(clock.unix_timestamp >= deadline, DuelError::MarketNotExpired);

    // Must have sufficient TWAP samples (at least half the expected count, min 1)
    let min_samples = ((twap_window / twap_interval).max(1) / 2).max(1) as u32;
    require!(twap_samples_count >= min_samples, DuelError::NoTwapSamples);

    let samples = twap_samples_count as u128;

    // Calculate final TWAPs
    let final_twap_a = ctx.accounts.side_a
        .twap_accumulator
        .checked_div(samples)
        .ok_or(DuelError::MathOverflow)? as u64;
    let final_twap_b = ctx.accounts.side_b
        .twap_accumulator
        .checked_div(samples)
        .ok_or(DuelError::MathOverflow)? as u64;

    // Determine winner (no draws -- higher TWAP wins, reserve tiebreaker)
    let winner: u8 = if final_twap_a > final_twap_b {
        0
    } else if final_twap_b > final_twap_a {
        1
    } else {
        // Exact tie: side with higher reserve wins, side A wins if equal
        let reserve_a = ctx.accounts.quote_vault_a.amount;
        let reserve_b = ctx.accounts.quote_vault_b.amount;
        if reserve_a >= reserve_b { 0 } else { 1 }
    };

    // Validate expected winner matches actual winner
    require!(winner == expected_winner, DuelError::WinnerMismatch);

    // Build market PDA signer seeds
    let signer_seeds: &[&[&[u8]]] = &[&[
        b"market",
        authority_key.as_ref(),
        &market_id_bytes,
        &[bump],
    ]];

    let quote_decimals = ctx.accounts.quote_mint.decimals;

    // ---- Phase 2: Transfer 100% of losing reserve to winning vault ----

    let (losing_vault_info, winning_vault_info) = if winner == 0 {
        (
            ctx.accounts.quote_vault_b.to_account_info(),
            ctx.accounts.quote_vault_a.to_account_info(),
        )
    } else {
        (
            ctx.accounts.quote_vault_a.to_account_info(),
            ctx.accounts.quote_vault_b.to_account_info(),
        )
    };

    let loser_reserve = if winner == 0 {
        ctx.accounts.quote_vault_b.amount
    } else {
        ctx.accounts.quote_vault_a.amount
    };

    if loser_reserve > 0 {
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.quote_token_program.to_account_info(),
                TransferChecked {
                    from: losing_vault_info,
                    mint: ctx.accounts.quote_mint.to_account_info(),
                    to: winning_vault_info,
                    authority: ctx.accounts.market.to_account_info(),
                },
                signer_seeds,
            ),
            loser_reserve,
            quote_decimals,
        )?;
    }

    // ---- Phase 3: Prepare winning side tokens and quote for Meteora pool ----

    // Reload winning quote vault to get updated balance after transfer
    if winner == 0 {
        ctx.accounts.quote_vault_a.reload()?;
    } else {
        ctx.accounts.quote_vault_b.reload()?;
    }

    let sol_for_pool = if winner == 0 {
        ctx.accounts.quote_vault_a.amount
    } else {
        ctx.accounts.quote_vault_b.amount
    };
    require!(sol_for_pool >= MIN_GRADUATION_RESERVE, DuelError::InsufficientReserveForGraduation);

    let tokens_available = if winner == 0 {
        ctx.accounts.token_vault_a.amount
    } else {
        ctx.accounts.token_vault_b.amount
    };
    require!(tokens_available > 0, DuelError::InsufficientTokenBalance);

    // Transfer tokens from winning token vault to market_token_ata
    let token_decimals = if winner == 0 {
        ctx.accounts.token_mint_a.decimals
    } else {
        ctx.accounts.token_mint_b.decimals
    };

    let (winning_token_vault_info, winning_token_mint_info) = if winner == 0 {
        (
            ctx.accounts.token_vault_a.to_account_info(),
            ctx.accounts.token_mint_a.to_account_info(),
        )
    } else {
        (
            ctx.accounts.token_vault_b.to_account_info(),
            ctx.accounts.token_mint_b.to_account_info(),
        )
    };

    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: winning_token_vault_info,
                mint: winning_token_mint_info.clone(),
                to: ctx.accounts.market_token_ata.to_account_info(),
                authority: ctx.accounts.market.to_account_info(),
            },
            signer_seeds,
        ),
        tokens_available,
        token_decimals,
    )?;

    // Transfer ALL quote from winning vault to market_wsol_ata
    let winning_quote_vault_info = if winner == 0 {
        ctx.accounts.quote_vault_a.to_account_info()
    } else {
        ctx.accounts.quote_vault_b.to_account_info()
    };

    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.quote_token_program.to_account_info(),
            TransferChecked {
                from: winning_quote_vault_info,
                mint: ctx.accounts.quote_mint.to_account_info(),
                to: ctx.accounts.market_wsol_ata.to_account_info(),
                authority: ctx.accounts.market.to_account_info(),
            },
            signer_seeds,
        ),
        sol_for_pool,
        quote_decimals,
    )?;

    // ---- Phase 4: Initialize Meteora DAMM v2 pool ----

    let sqrt_price = compute_sqrt_price_q64(sol_for_pool, tokens_available);
    let liquidity = compute_initial_liquidity(sol_for_pool, tokens_available, sqrt_price);

    let params = meteora_damm::InitializeCustomizablePoolParameters::with_simple_fee(
        GRADUATION_POOL_FEE_BPS,
        sqrt_price,
        liquidity,
    );

    // Token A = winning side's token, Token B = WSOL (quote mint)
    let init_pool_metas = vec![
        AccountMeta::new_readonly(market_key, true),                             // 0: creator (market PDA, signer)
        AccountMeta::new(ctx.accounts.position_nft_mint.key(), true),            // 1: position_nft_mint (signer)
        AccountMeta::new(ctx.accounts.position_nft_account.key(), false),        // 2: position_nft_account
        AccountMeta::new(ctx.accounts.resolver.key(), true),                     // 3: payer (resolver, signer)
        AccountMeta::new_readonly(ctx.accounts.pool_authority.key(), false),     // 4: pool_authority
        AccountMeta::new(ctx.accounts.pool.key(), false),                        // 5: pool
        AccountMeta::new(ctx.accounts.position.key(), false),                    // 6: position
        AccountMeta::new_readonly(winning_token_mint_info.key(), false),         // 7: token_a_mint
        AccountMeta::new_readonly(ctx.accounts.quote_mint.key(), false),         // 8: token_b_mint (WSOL)
        AccountMeta::new(ctx.accounts.pool_token_vault_a.key(), false),          // 9: token_a_vault
        AccountMeta::new(ctx.accounts.pool_token_vault_b.key(), false),          // 10: token_b_vault
        AccountMeta::new(ctx.accounts.market_token_ata.key(), false),            // 11: payer_token_a
        AccountMeta::new(ctx.accounts.market_wsol_ata.key(), false),             // 12: payer_token_b
        AccountMeta::new_readonly(ctx.accounts.token_program.key(), false),      // 13: token_a_program
        AccountMeta::new_readonly(ctx.accounts.quote_token_program.key(), false), // 14: token_b_program
        AccountMeta::new_readonly(ctx.accounts.token_2022_program.key(), false), // 15: token_2022_program
        AccountMeta::new_readonly(ctx.accounts.system_program.key(), false),     // 16: system_program
        AccountMeta::new_readonly(ctx.accounts.event_authority.key(), false),    // 17: event_authority
        AccountMeta::new_readonly(ctx.accounts.meteora_program.key(), false),    // 18: program (self)
    ];

    let init_pool_infos = vec![
        ctx.accounts.market.to_account_info(),
        ctx.accounts.position_nft_mint.to_account_info(),
        ctx.accounts.position_nft_account.to_account_info(),
        ctx.accounts.resolver.to_account_info(),
        ctx.accounts.pool_authority.to_account_info(),
        ctx.accounts.pool.to_account_info(),
        ctx.accounts.position.to_account_info(),
        winning_token_mint_info.clone(),
        ctx.accounts.quote_mint.to_account_info(),
        ctx.accounts.pool_token_vault_a.to_account_info(),
        ctx.accounts.pool_token_vault_b.to_account_info(),
        ctx.accounts.market_token_ata.to_account_info(),
        ctx.accounts.market_wsol_ata.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.quote_token_program.to_account_info(),
        ctx.accounts.token_2022_program.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
        ctx.accounts.event_authority.to_account_info(),
        ctx.accounts.meteora_program.to_account_info(),
    ];

    meteora_damm::invoke_init_customizable_pool(
        init_pool_metas,
        init_pool_infos,
        params,
        signer_seeds,
    )?;

    // ---- Phase 5: Permanently lock all liquidity ----

    let lock_metas = vec![
        AccountMeta::new(ctx.accounts.pool.key(), false),                         // 0: pool (mut)
        AccountMeta::new(ctx.accounts.position.key(), false),                     // 1: position (mut)
        AccountMeta::new_readonly(ctx.accounts.position_nft_account.key(), false), // 2: position_nft_account
        AccountMeta::new_readonly(market_key, true),                              // 3: owner (market PDA, signer)
        AccountMeta::new_readonly(ctx.accounts.event_authority.key(), false),     // 4: event_authority
        AccountMeta::new_readonly(ctx.accounts.meteora_program.key(), false),     // 5: program
    ];

    let lock_infos = vec![
        ctx.accounts.pool.to_account_info(),
        ctx.accounts.position.to_account_info(),
        ctx.accounts.position_nft_account.to_account_info(),
        ctx.accounts.market.to_account_info(),
        ctx.accounts.event_authority.to_account_info(),
        ctx.accounts.meteora_program.to_account_info(),
    ];

    meteora_damm::invoke_permanent_lock_position(
        lock_metas,
        lock_infos,
        liquidity,
        signer_seeds,
    )?;

    // ---- Phase 6: Update losing token metadata to "[DEFEATED]" ----

    let losing_mint_key = if winner == 0 {
        ctx.accounts.token_mint_b.key()
    } else {
        ctx.accounts.token_mint_a.key()
    };

    // Validate that losing_token_metadata matches the expected PDA for the losing mint
    let (expected_metadata_pda, _) = metaplex_metadata::find_metadata_pda(&losing_mint_key);
    require!(
        ctx.accounts.losing_token_metadata.key() == expected_metadata_pda,
        DuelError::InvalidMarketConfig
    );

    // Read existing metadata fields from account data
    let metadata_data = ctx.accounts.losing_token_metadata.try_borrow_data()?;
    let (current_name, current_symbol, current_uri) =
        metaplex_metadata::read_metadata_fields(&metadata_data)?;
    drop(metadata_data);

    // Build defeated name, capped at 32 chars (Metaplex limit)
    let defeated_suffix = " [DEFEATED]";
    let max_name_len = 32;
    let defeated_name = if current_name.len() + defeated_suffix.len() <= max_name_len {
        format!("{}{}", current_name, defeated_suffix)
    } else {
        let truncated_len = max_name_len - defeated_suffix.len();
        format!("{}{}", &current_name[..truncated_len], defeated_suffix)
    };

    let updated_data = metaplex_metadata::DataV2 {
        name: defeated_name,
        symbol: current_symbol,
        uri: current_uri,
        seller_fee_basis_points: 0,
        creators: None,
        collection: None,
        uses: None,
    };

    metaplex_metadata::update_metadata_v2(
        ctx.accounts.losing_token_metadata.to_account_info(),
        ctx.accounts.market.to_account_info(),
        ctx.accounts.token_metadata_program.to_account_info(),
        updated_data,
        signer_seeds,
    )?;

    // ---- Phase 7: Update market state ----

    let market = &mut ctx.accounts.market;
    market.status = MarketStatus::Resolved;
    market.winner = Some(winner);
    market.final_twap_a = final_twap_a;
    market.final_twap_b = final_twap_b;

    // ---- Phase 8: Emit event ----

    emit!(MarketResolved {
        market: market_key,
        winner,
        final_twap_a,
        final_twap_b,
        loser_reserve_transferred: loser_reserve,
        dex_pool: ctx.accounts.pool.key(),
        sol_seeded: sol_for_pool,
        tokens_seeded: tokens_available,
    });

    Ok(())
}

/// Compute sqrt_price in Q64.64 format: sqrt(sol_amount / token_amount) * 2^64
/// Uses integer-only Newton's method (deterministic, BPF-safe).
fn compute_sqrt_price_q64(sol_amount: u64, token_amount: u64) -> u128 {
    if token_amount == 0 || sol_amount == 0 {
        return 1u128 << 64; // Default to 1.0
    }

    let sol = sol_amount as u128;
    let tok = token_amount as u128;

    // Compute (sol << 64) / tok, then isqrt, then shift left by 32
    // This gives sqrt(sol/tok) * 2^64
    let scaled = sol.checked_shl(64).unwrap_or(u128::MAX) / tok;
    let sqrt_scaled = isqrt_u128(scaled);
    sqrt_scaled.checked_shl(32).unwrap_or(u128::MAX).max(1)
}

/// Integer square root via Newton's method (deterministic, BPF-safe).
fn isqrt_u128(n: u128) -> u128 {
    if n <= 1 {
        return n;
    }
    let mut x = n;
    let mut y = (x + 1) / 2;
    while y < x {
        x = y;
        y = (x + n / x) / 2;
    }
    x
}

/// Compute initial liquidity from seed amounts and sqrt_price.
/// For a full-range position: L = min(amount_a * sqrt_price / 2^64, amount_b * 2^64 / sqrt_price)
fn compute_initial_liquidity(sol_amount: u64, token_amount: u64, sqrt_price: u128) -> u128 {
    let l_from_a = (token_amount as u128)
        .checked_mul(sqrt_price)
        .unwrap_or(u128::MAX)
        / (1u128 << 64);
    let l_from_b = (sol_amount as u128)
        .checked_mul(1u128 << 64)
        .unwrap_or(u128::MAX)
        / sqrt_price.max(1);

    l_from_a.min(l_from_b).max(1)
}
