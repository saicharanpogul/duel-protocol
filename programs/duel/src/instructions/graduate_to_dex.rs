use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::AccountMeta;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use anchor_spl::associated_token::AssociatedToken;

use crate::cpi::meteora_damm;
use crate::errors::DuelError;
use crate::events::TokensGraduated;
use crate::state::*;

/// Minimum SOL reserve (in lamports) required to graduate
pub const MIN_GRADUATION_RESERVE: u64 = 100_000_000; // 0.1 SOL

#[derive(Accounts)]
pub struct GraduateToDex<'info> {
    /// Market creator or permissionless caller — pays rent for new accounts
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        constraint = market.status == MarketStatus::Resolved @ DuelError::MarketNotResolved,
    )]
    pub market: Box<Account<'info, Market>>,

    /// Side account being graduated
    #[account(
        mut,
        constraint = side_account.market == market.key() @ DuelError::InvalidSide,
    )]
    pub side_account: Account<'info, Side>,

    /// Token mint for this side
    #[account(
        mut,
        constraint = token_mint.key() == side_account.token_mint @ DuelError::InvalidSide,
    )]
    pub token_mint: InterfaceAccount<'info, Mint>,

    /// Token vault for this side (source of tokens to seed pool)
    #[account(
        mut,
        constraint = token_vault.key() == side_account.token_reserve_vault @ DuelError::InvalidSide,
    )]
    pub token_vault: InterfaceAccount<'info, TokenAccount>,

    /// SOL vault — checked for minimum reserve
    #[account(
        mut,
        constraint = sol_vault.key() == side_account.sol_reserve_vault @ DuelError::InvalidSide,
    )]
    pub sol_vault: Account<'info, SolVault>,

    // ──── Meteora DAMM v2 accounts ────

    /// WSOL mint (So11111111111111111111111111111111111111112)
    /// CHECK: Validated by Meteora program
    pub wsol_mint: UncheckedAccount<'info>,

    /// Position NFT mint — a new keypair, signer
    /// CHECK: Will be initialized by Meteora program (Token-2022)
    #[account(mut, signer)]
    pub position_nft_mint: UncheckedAccount<'info>,

    /// Position NFT token account — PDA: ["position_nft_account", position_nft_mint]
    /// CHECK: Initialized by Meteora program
    #[account(mut)]
    pub position_nft_account: UncheckedAccount<'info>,

    /// Pool authority (const PDA of DAMM v2)
    /// CHECK: Validated against known address
    #[account(
        constraint = pool_authority.key() == meteora_damm::POOL_AUTHORITY @ DuelError::InvalidMarketConfig,
    )]
    pub pool_authority: UncheckedAccount<'info>,

    /// Meteora pool PDA: ["customizable_pool", max(mintA, mintB), min(mintA, mintB)]
    /// CHECK: Created by Meteora CPI
    #[account(mut)]
    pub pool: UncheckedAccount<'info>,

    /// Position PDA: ["position", position_nft_mint]
    /// CHECK: Created by Meteora CPI
    #[account(mut)]
    pub position: UncheckedAccount<'info>,

    /// Token A vault for the pool — PDA: ["token_vault", token_a_mint, pool]
    /// CHECK: Created by Meteora CPI
    #[account(mut)]
    pub token_a_vault: UncheckedAccount<'info>,

    /// Token B vault for the pool — PDA: ["token_vault", token_b_mint, pool]
    /// CHECK: Created by Meteora CPI
    #[account(mut)]
    pub token_b_vault: UncheckedAccount<'info>,

    /// Market PDA's token A account (pre-created, holds tokens to seed)
    /// CHECK: ATA for market PDA
    #[account(mut)]
    pub payer_token_a: UncheckedAccount<'info>,

    /// Market PDA's WSOL account (pre-created and funded with wrapped SOL)
    /// CHECK: ATA for market PDA
    #[account(mut)]
    pub payer_token_b: UncheckedAccount<'info>,

    /// Token A's token program (SPL Token or Token-2022)
    /// CHECK: Validated by Meteora program
    pub token_a_program: UncheckedAccount<'info>,

    /// Token B's token program (SPL Token for WSOL)
    /// CHECK: Validated by Meteora program
    pub token_b_program: UncheckedAccount<'info>,

    /// Token-2022 program (for position NFT)
    /// CHECK: Validated against known address
    #[account(
        constraint = token_2022_program.key() == meteora_damm::TOKEN_2022_PROGRAM_ID @ DuelError::InvalidMarketConfig,
    )]
    pub token_2022_program: UncheckedAccount<'info>,

    /// Event authority PDA: ["__event_authority"] of DAMM v2
    /// CHECK: Validated by Meteora program
    pub event_authority: UncheckedAccount<'info>,

    /// Meteora DAMM v2 program
    /// CHECK: Validated against known program ID
    #[account(
        constraint = meteora_program.key() == meteora_damm::METEORA_DAMM_V2_PROGRAM_ID @ DuelError::InvalidMarketConfig,
    )]
    pub meteora_program: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<GraduateToDex>, side: u8) -> Result<()> {
    let market = &ctx.accounts.market;

    // Validate side index
    require!(side <= 1, DuelError::InvalidSide);

    // Check not already graduated
    let already_graduated = if side == 0 { market.graduated_a } else { market.graduated_b };
    require!(!already_graduated, DuelError::AlreadyGraduated);

    // Check minimum reserve
    let sol_balance = ctx.accounts.sol_vault.to_account_info().lamports();
    let rent_exempt = Rent::get()?.minimum_balance(SolVault::SIZE);
    let available_sol = sol_balance.saturating_sub(rent_exempt);
    require!(available_sol >= MIN_GRADUATION_RESERVE, DuelError::InsufficientReserve);

    // Get remaining tokens in vault
    let tokens_available = ctx.accounts.token_vault.amount;
    require!(tokens_available > 0, DuelError::InsufficientTokenBalance);

    // Build market PDA signer seeds
    let market_key = market.key();
    let authority_key = market.authority;
    let market_id_bytes = market.market_id.to_le_bytes();
    let bump = market.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        b"market",
        authority_key.as_ref(),
        &market_id_bytes,
        &[bump],
    ]];

    // ─── Transfer tokens from token vault to payer_token_a ───
    // Uses token_interface::transfer_checked for Token-2022 compat
    let decimals = ctx.accounts.token_mint.decimals;

    anchor_spl::token_interface::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            anchor_spl::token_interface::TransferChecked {
                from: ctx.accounts.token_vault.to_account_info(),
                mint: ctx.accounts.token_mint.to_account_info(),
                to: ctx.accounts.payer_token_a.to_account_info(),
                authority: ctx.accounts.market.to_account_info(),
            },
            signer_seeds,
        ),
        tokens_available,
        decimals,
    )?;

    // Client is expected to pre-fund payer_token_b (WSOL ATA) with SOL from their wallet.
    // After the Meteora CPI, the program refunds sol_vault balance to authority.

    // ─── Compute sqrt_price for the pool ───
    let sqrt_price = compute_sqrt_price_q64(available_sol, tokens_available);

    // Use max liquidity from the seed amounts
    let liquidity = compute_initial_liquidity(available_sol, tokens_available, sqrt_price);

    let params = meteora_damm::InitializeCustomizablePoolParameters::with_simple_fee(
        25, // 0.25% trade fee
        sqrt_price,
        liquidity,
    );

    // Build Meteora CPI account metas (19 accounts)
    let account_metas = vec![
        AccountMeta::new_readonly(market_key, true),                             // 0: creator (market PDA, signer)
        AccountMeta::new(ctx.accounts.position_nft_mint.key(), true),            // 1: position_nft_mint (signer)
        AccountMeta::new(ctx.accounts.position_nft_account.key(), false),        // 2: position_nft_account
        AccountMeta::new(ctx.accounts.authority.key(), true),                    // 3: payer (authority = wallet, signer)
        AccountMeta::new_readonly(ctx.accounts.pool_authority.key(), false),     // 4: pool_authority
        AccountMeta::new(ctx.accounts.pool.key(), false),                        // 5: pool
        AccountMeta::new(ctx.accounts.position.key(), false),                    // 6: position
        AccountMeta::new_readonly(ctx.accounts.token_mint.key(), false),         // 7: token_a_mint
        AccountMeta::new_readonly(ctx.accounts.wsol_mint.key(), false),          // 8: token_b_mint
        AccountMeta::new(ctx.accounts.token_a_vault.key(), false),               // 9: token_a_vault
        AccountMeta::new(ctx.accounts.token_b_vault.key(), false),               // 10: token_b_vault
        AccountMeta::new(ctx.accounts.payer_token_a.key(), false),               // 11: payer_token_a
        AccountMeta::new(ctx.accounts.payer_token_b.key(), false),               // 12: payer_token_b
        AccountMeta::new_readonly(ctx.accounts.token_a_program.key(), false),    // 13: token_a_program
        AccountMeta::new_readonly(ctx.accounts.token_b_program.key(), false),    // 14: token_b_program
        AccountMeta::new_readonly(ctx.accounts.token_2022_program.key(), false), // 15: token_2022_program
        AccountMeta::new_readonly(ctx.accounts.system_program.key(), false),     // 16: system_program
        AccountMeta::new_readonly(ctx.accounts.event_authority.key(), false),    // 17: event_authority
        AccountMeta::new_readonly(ctx.accounts.meteora_program.key(), false),    // 18: program (self)
    ];

    let account_infos = vec![
        ctx.accounts.market.to_account_info(),             // 0: creator = market PDA
        ctx.accounts.position_nft_mint.to_account_info(),  // 1: position_nft_mint
        ctx.accounts.position_nft_account.to_account_info(), // 2: position_nft_account
        ctx.accounts.authority.to_account_info(),           // 3: payer = authority (wallet)
        ctx.accounts.pool_authority.to_account_info(),      // 4: pool_authority
        ctx.accounts.pool.to_account_info(),                // 5: pool
        ctx.accounts.position.to_account_info(),            // 6: position
        ctx.accounts.token_mint.to_account_info(),          // 7: token_a_mint
        ctx.accounts.wsol_mint.to_account_info(),           // 8: token_b_mint
        ctx.accounts.token_a_vault.to_account_info(),       // 9: token_a_vault
        ctx.accounts.token_b_vault.to_account_info(),       // 10: token_b_vault
        ctx.accounts.payer_token_a.to_account_info(),       // 11: payer_token_a
        ctx.accounts.payer_token_b.to_account_info(),       // 12: payer_token_b
        ctx.accounts.token_a_program.to_account_info(),     // 13: token_a_program
        ctx.accounts.token_b_program.to_account_info(),     // 14: token_b_program
        ctx.accounts.token_2022_program.to_account_info(),  // 15: token_2022_program
        ctx.accounts.system_program.to_account_info(),      // 16: system_program
        ctx.accounts.event_authority.to_account_info(),     // 17: event_authority
        ctx.accounts.meteora_program.to_account_info(),     // 18: program (self)
    ];

    meteora_damm::invoke_init_customizable_pool(
        account_metas,
        account_infos,
        params,
        signer_seeds,
    )?;

    // ─── Refund SOL vault balance to authority ───
    let refund_amount = available_sol;
    **ctx.accounts.sol_vault.to_account_info().try_borrow_mut_lamports()? -= refund_amount;
    **ctx.accounts.authority.to_account_info().try_borrow_mut_lamports()? += refund_amount;

    // Mark side as graduated
    let market = &mut ctx.accounts.market;
    if side == 0 {
        market.graduated_a = true;
    } else {
        market.graduated_b = true;
    }

    emit!(TokensGraduated {
        market: market.key(),
        side,
        dex_pool: ctx.accounts.pool.key(),
        sol_seeded: available_sol,
        tokens_seeded: tokens_available,
    });

    Ok(())
}

/// Compute sqrt_price in Q64.64 format: sqrt(sol_amount / token_amount) * 2^64
fn compute_sqrt_price_q64(sol_amount: u64, token_amount: u64) -> u128 {
    if token_amount == 0 || sol_amount == 0 {
        return 1u128 << 64; // Default to 1.0
    }
    let price_f = (sol_amount as f64) / (token_amount as f64);
    let sqrt_price_f = price_f.sqrt();
    (sqrt_price_f * ((1u128 << 64) as f64)) as u128
}

/// Compute initial liquidity from seed amounts and sqrt_price
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
