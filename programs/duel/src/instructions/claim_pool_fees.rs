use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::AccountMeta;
use anchor_spl::token_interface::{TokenAccount, TokenInterface};

use crate::cpi::meteora_damm;
use crate::errors::DuelError;
use crate::state::*;

#[derive(Accounts)]
pub struct ClaimPoolFees<'info> {
    /// Market creator or protocol admin
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        constraint = market.status == MarketStatus::Resolved @ DuelError::MarketNotResolved,
        constraint = market.winner.is_some() @ DuelError::EmergencyOnlyOperation,
        constraint = market.authority == authority.key() || config.admin == authority.key() @ DuelError::InvalidMarketConfig,
    )]
    pub market: Box<Account<'info, Market>>,

    /// Protocol config (for admin check)
    #[account(
        seeds = [b"config"],
        bump = config.bump,
    )]
    pub config: Account<'info, ProgramConfig>,

    /// Token mint for the winning side
    /// CHECK: Validated via Meteora program
    pub token_mint: UncheckedAccount<'info>,

    /// WSOL mint
    /// CHECK: Validated by Meteora program
    pub wsol_mint: UncheckedAccount<'info>,

    // ---- Meteora DAMM v2 accounts ----

    /// Pool authority (const PDA of DAMM v2)
    /// CHECK: Validated against known address
    #[account(
        constraint = pool_authority.key() == meteora_damm::POOL_AUTHORITY @ DuelError::InvalidMarketConfig,
    )]
    pub pool_authority: UncheckedAccount<'info>,

    /// Meteora pool
    /// CHECK: Validated by Meteora program
    pub pool: UncheckedAccount<'info>,

    /// Position PDA
    /// CHECK: Validated by Meteora program
    #[account(mut)]
    pub position: UncheckedAccount<'info>,

    /// Fee receiver's token A account (receives claimed token fees)
    #[account(mut)]
    pub fee_receiver_token_a: InterfaceAccount<'info, TokenAccount>,

    /// Fee receiver's token B account (receives claimed WSOL fees)
    #[account(mut)]
    pub fee_receiver_token_b: InterfaceAccount<'info, TokenAccount>,

    /// Pool's token A vault
    /// CHECK: Validated by Meteora program
    #[account(mut)]
    pub token_a_vault: UncheckedAccount<'info>,

    /// Pool's token B vault
    /// CHECK: Validated by Meteora program
    #[account(mut)]
    pub token_b_vault: UncheckedAccount<'info>,

    /// Position NFT token account (market PDA is the authority)
    /// CHECK: Validated by Meteora program
    pub position_nft_account: UncheckedAccount<'info>,

    /// Token A program
    /// CHECK: Validated by Meteora program
    pub token_a_program: UncheckedAccount<'info>,

    /// Token B program
    /// CHECK: Validated by Meteora program
    pub token_b_program: UncheckedAccount<'info>,

    /// Event authority PDA of DAMM v2
    /// CHECK: Validated by Meteora program
    pub event_authority: UncheckedAccount<'info>,

    /// Meteora DAMM v2 program
    /// CHECK: Validated against known program ID
    #[account(
        constraint = meteora_program.key() == meteora_damm::METEORA_DAMM_V2_PROGRAM_ID @ DuelError::InvalidMarketConfig,
    )]
    pub meteora_program: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<ClaimPoolFees>) -> Result<()> {
    let market = &ctx.accounts.market;

    // Build market PDA signer seeds (market PDA is the position NFT owner)
    let authority_key = market.authority;
    let market_id_bytes = market.market_id.to_le_bytes();
    let bump = market.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        b"market",
        authority_key.as_ref(),
        &market_id_bytes,
        &[bump],
    ]];

    // Build Meteora CPI for claim_position_fee (14 accounts)
    let account_metas = vec![
        AccountMeta::new_readonly(ctx.accounts.pool_authority.key(), false),     // 0: pool_authority
        AccountMeta::new_readonly(ctx.accounts.pool.key(), false),              // 1: pool
        AccountMeta::new(ctx.accounts.position.key(), false),                   // 2: position (mut)
        AccountMeta::new(ctx.accounts.fee_receiver_token_a.key(), false),       // 3: token_a_account (mut)
        AccountMeta::new(ctx.accounts.fee_receiver_token_b.key(), false),       // 4: token_b_account (mut)
        AccountMeta::new(ctx.accounts.token_a_vault.key(), false),              // 5: token_a_vault (mut)
        AccountMeta::new(ctx.accounts.token_b_vault.key(), false),              // 6: token_b_vault (mut)
        AccountMeta::new_readonly(ctx.accounts.token_mint.key(), false),        // 7: token_a_mint
        AccountMeta::new_readonly(ctx.accounts.wsol_mint.key(), false),         // 8: token_b_mint
        AccountMeta::new_readonly(ctx.accounts.position_nft_account.key(), false), // 9: position_nft_account
        AccountMeta::new_readonly(market.key(), true),                          // 10: owner (market PDA, signer)
        AccountMeta::new_readonly(ctx.accounts.token_a_program.key(), false),   // 11: token_a_program
        AccountMeta::new_readonly(ctx.accounts.token_b_program.key(), false),   // 12: token_b_program
        AccountMeta::new_readonly(ctx.accounts.event_authority.key(), false),   // 13: event_authority
        AccountMeta::new_readonly(ctx.accounts.meteora_program.key(), false),   // 14: program (self)
    ];

    let account_infos = vec![
        ctx.accounts.pool_authority.to_account_info(),
        ctx.accounts.pool.to_account_info(),
        ctx.accounts.position.to_account_info(),
        ctx.accounts.fee_receiver_token_a.to_account_info(),
        ctx.accounts.fee_receiver_token_b.to_account_info(),
        ctx.accounts.token_a_vault.to_account_info(),
        ctx.accounts.token_b_vault.to_account_info(),
        ctx.accounts.token_mint.to_account_info(),
        ctx.accounts.wsol_mint.to_account_info(),
        ctx.accounts.position_nft_account.to_account_info(),
        ctx.accounts.market.to_account_info(),
        ctx.accounts.token_a_program.to_account_info(),
        ctx.accounts.token_b_program.to_account_info(),
        ctx.accounts.event_authority.to_account_info(),
        ctx.accounts.meteora_program.to_account_info(),
    ];

    meteora_damm::invoke_claim_position_fee(
        account_metas,
        account_infos,
        signer_seeds,
    )?;

    Ok(())
}
