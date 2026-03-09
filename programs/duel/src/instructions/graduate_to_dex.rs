use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::AccountMeta;
use anchor_spl::token::{Mint, Token, TokenAccount};
use anchor_spl::associated_token::AssociatedToken;

use crate::cpi::meteora_damm;
use crate::errors::DuelError;
use crate::events::TokensGraduated;
use crate::state::*;

/// Minimum SOL reserve (in lamports) required to graduate
pub const MIN_GRADUATION_RESERVE: u64 = 100_000_000; // 0.1 SOL

#[derive(Accounts)]
pub struct GraduateToDex<'info> {
    /// Market creator or permissionless resolver
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
    pub token_mint: Account<'info, Mint>,

    /// Token vault for this side (source of tokens to seed pool)
    #[account(
        mut,
        constraint = token_vault.key() == side_account.token_reserve_vault @ DuelError::InvalidSide,
    )]
    pub token_vault: Account<'info, TokenAccount>,

    /// SOL vault for this side (source of SOL to seed pool)
    #[account(
        mut,
        constraint = sol_vault.key() == side_account.sol_reserve_vault @ DuelError::InvalidSide,
    )]
    pub sol_vault: Account<'info, SolVault>,

    // ---- Meteora DAMM v2 accounts ----
    // All validated by the Meteora program itself during CPI.

    /// WSOL mint (So11111111111111111111111111111111111111112)
    /// CHECK: Validated by Meteora program
    pub wsol_mint: UncheckedAccount<'info>,

    /// Meteora pool account (PDA created/validated by Meteora)
    /// CHECK: Created by Meteora CPI
    #[account(mut)]
    pub pool: UncheckedAccount<'info>,

    /// Pool LP token mint (PDA derived by Meteora)
    /// CHECK: Created by Meteora CPI
    #[account(mut)]
    pub lp_mint: UncheckedAccount<'info>,

    /// Dynamic vault for token A
    /// CHECK: Created/validated by Meteora vault program
    #[account(mut)]
    pub a_vault: UncheckedAccount<'info>,

    /// Dynamic vault for token B (WSOL)
    /// CHECK: Created/validated by Meteora vault program
    #[account(mut)]
    pub b_vault: UncheckedAccount<'info>,

    /// Token vault account of vault A
    /// CHECK: Validated by Meteora program
    #[account(mut)]
    pub a_token_vault: UncheckedAccount<'info>,

    /// Token vault account of vault B
    /// CHECK: Validated by Meteora program
    #[account(mut)]
    pub b_token_vault: UncheckedAccount<'info>,

    /// LP token mint of vault A
    /// CHECK: Validated by Meteora program
    #[account(mut)]
    pub a_vault_lp_mint: UncheckedAccount<'info>,

    /// LP token mint of vault B
    /// CHECK: Validated by Meteora program
    #[account(mut)]
    pub b_vault_lp_mint: UncheckedAccount<'info>,

    /// LP token account of vault A (pool holds vault LP to track deposit)
    /// CHECK: Validated by Meteora program
    #[account(mut)]
    pub a_vault_lp: UncheckedAccount<'info>,

    /// LP token account of vault B (pool holds vault LP to track deposit)
    /// CHECK: Validated by Meteora program
    #[account(mut)]
    pub b_vault_lp: UncheckedAccount<'info>,

    /// Market PDA's token A account for seeding the pool
    /// CHECK: ATA for market PDA
    #[account(mut)]
    pub payer_token_a: UncheckedAccount<'info>,

    /// Market PDA's WSOL account for seeding the pool
    /// CHECK: ATA for market PDA
    #[account(mut)]
    pub payer_token_b: UncheckedAccount<'info>,

    /// Market PDA's LP token account to receive LP tokens
    /// CHECK: ATA for market PDA
    #[account(mut)]
    pub payer_pool_lp: UncheckedAccount<'info>,

    /// Protocol fee token account for token A
    /// CHECK: Validated by Meteora program
    #[account(mut)]
    pub protocol_token_a_fee: UncheckedAccount<'info>,

    /// Protocol fee token account for token B
    /// CHECK: Validated by Meteora program
    #[account(mut)]
    pub protocol_token_b_fee: UncheckedAccount<'info>,

    /// LP mint metadata (Metaplex)
    /// CHECK: Created by Meteora program
    #[account(mut)]
    pub mint_metadata: UncheckedAccount<'info>,

    /// Metaplex Token Metadata program
    /// CHECK: Validated by Meteora program
    pub metadata_program: UncheckedAccount<'info>,

    /// Meteora Vault program
    /// CHECK: Validated by Meteora program
    pub vault_program: UncheckedAccount<'info>,

    /// Meteora DAMM v2 program
    /// CHECK: Validated against known program ID
    #[account(
        constraint = meteora_program.key() == meteora_damm::METEORA_DAMM_V2_PROGRAM_ID @ DuelError::InvalidMarketConfig,
    )]
    pub meteora_program: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
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

    // Transfer SOL from SolVault to payer_token_b (WSOL account)
    let sol_to_seed = available_sol;
    **ctx.accounts.sol_vault.to_account_info().try_borrow_mut_lamports()? -= sol_to_seed;
    **ctx.accounts.payer_token_b.to_account_info().try_borrow_mut_lamports()? += sol_to_seed;

    // Transfer tokens from token vault to payer_token_a using market PDA as signer
    anchor_spl::token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            anchor_spl::token::Transfer {
                from: ctx.accounts.token_vault.to_account_info(),
                to: ctx.accounts.payer_token_a.to_account_info(),
                authority: ctx.accounts.market.to_account_info(),
            },
            signer_seeds,
        ),
        tokens_available,
    )?;

    // Build Meteora CPI account metas (25 accounts, matching IDL order)
    let account_metas = vec![
        AccountMeta::new(ctx.accounts.pool.key(), false),                    // 0: pool
        AccountMeta::new(ctx.accounts.lp_mint.key(), false),                 // 1: lp_mint
        AccountMeta::new_readonly(ctx.accounts.token_mint.key(), false),     // 2: token_a_mint
        AccountMeta::new_readonly(ctx.accounts.wsol_mint.key(), false),      // 3: token_b_mint
        AccountMeta::new(ctx.accounts.a_vault.key(), false),                 // 4: a_vault
        AccountMeta::new(ctx.accounts.b_vault.key(), false),                 // 5: b_vault
        AccountMeta::new(ctx.accounts.a_token_vault.key(), false),           // 6: a_token_vault
        AccountMeta::new(ctx.accounts.b_token_vault.key(), false),           // 7: b_token_vault
        AccountMeta::new(ctx.accounts.a_vault_lp_mint.key(), false),         // 8: a_vault_lp_mint
        AccountMeta::new(ctx.accounts.b_vault_lp_mint.key(), false),         // 9: b_vault_lp_mint
        AccountMeta::new(ctx.accounts.a_vault_lp.key(), false),              // 10: a_vault_lp
        AccountMeta::new(ctx.accounts.b_vault_lp.key(), false),              // 11: b_vault_lp
        AccountMeta::new(ctx.accounts.payer_token_a.key(), false),           // 12: payer_token_a
        AccountMeta::new(ctx.accounts.payer_token_b.key(), false),           // 13: payer_token_b
        AccountMeta::new(ctx.accounts.payer_pool_lp.key(), false),           // 14: payer_pool_lp
        AccountMeta::new(ctx.accounts.protocol_token_a_fee.key(), false),    // 15: protocol_token_a_fee
        AccountMeta::new(ctx.accounts.protocol_token_b_fee.key(), false),    // 16: protocol_token_b_fee
        AccountMeta::new(market_key, true),                                   // 17: payer (market PDA = signer)
        AccountMeta::new_readonly(ctx.accounts.rent.key(), false),           // 18: rent
        AccountMeta::new(ctx.accounts.mint_metadata.key(), false),           // 19: mint_metadata
        AccountMeta::new_readonly(ctx.accounts.metadata_program.key(), false), // 20: metadata_program
        AccountMeta::new_readonly(ctx.accounts.vault_program.key(), false),  // 21: vault_program
        AccountMeta::new_readonly(ctx.accounts.token_program.key(), false),  // 22: token_program
        AccountMeta::new_readonly(ctx.accounts.associated_token_program.key(), false), // 23: ata_program
        AccountMeta::new_readonly(ctx.accounts.system_program.key(), false), // 24: system_program
    ];

    // Collect all account infos for the CPI
    let account_infos = vec![
        ctx.accounts.pool.to_account_info(),
        ctx.accounts.lp_mint.to_account_info(),
        ctx.accounts.token_mint.to_account_info(),
        ctx.accounts.wsol_mint.to_account_info(),
        ctx.accounts.a_vault.to_account_info(),
        ctx.accounts.b_vault.to_account_info(),
        ctx.accounts.a_token_vault.to_account_info(),
        ctx.accounts.b_token_vault.to_account_info(),
        ctx.accounts.a_vault_lp_mint.to_account_info(),
        ctx.accounts.b_vault_lp_mint.to_account_info(),
        ctx.accounts.a_vault_lp.to_account_info(),
        ctx.accounts.b_vault_lp.to_account_info(),
        ctx.accounts.payer_token_a.to_account_info(),
        ctx.accounts.payer_token_b.to_account_info(),
        ctx.accounts.payer_pool_lp.to_account_info(),
        ctx.accounts.protocol_token_a_fee.to_account_info(),
        ctx.accounts.protocol_token_b_fee.to_account_info(),
        ctx.accounts.market.to_account_info(),
        ctx.accounts.rent.to_account_info(),
        ctx.accounts.mint_metadata.to_account_info(),
        ctx.accounts.metadata_program.to_account_info(),
        ctx.accounts.vault_program.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.associated_token_program.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
        ctx.accounts.meteora_program.to_account_info(),
    ];

    let params = meteora_damm::CustomizableParams::with_fee_bps(25); // 0.25% trade fee

    meteora_damm::invoke_init_customizable_pool(
        account_metas,
        account_infos,
        tokens_available,
        sol_to_seed,
        params,
        signer_seeds,
    )?;

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
        sol_seeded: sol_to_seed,
        tokens_seeded: tokens_available,
    });

    Ok(())
}
