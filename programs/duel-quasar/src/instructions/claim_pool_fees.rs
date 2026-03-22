use quasar_lang::prelude::*;
use quasar_spl::{InterfaceAccount, Token, TokenInterface};

use crate::errors::DuelError;
use crate::state::*;

/// Meteora DAMM v2 Program ID
const METEORA_DAMM_V2_PROGRAM_ID: Address =
    address!("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG");

/// Pool authority (const PDA of DAMM v2)
const POOL_AUTHORITY: Address =
    address!("HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC");

/// Discriminator for `claim_position_fee`
/// sha256("global:claim_position_fee")[0..8]
const CLAIM_POSITION_FEE_DISCRIMINATOR: [u8; 8] = [180, 38, 154, 17, 133, 33, 162, 211];

#[derive(Accounts)]
pub struct ClaimPoolFees<'info> {
    /// Market creator or protocol admin
    pub authority: &'info mut Signer,

    #[account(
        constraint = market.status == STATUS_RESOLVED @ DuelError::MarketNotResolved,
        constraint = market.has_winner == 1 @ DuelError::EmergencyOnlyOperation,
    )]
    pub market: &'info Account<Market>,

    /// Protocol config (for admin check)
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: &'info Account<ProgramConfig>,

    /// Token mint for the winning side
    pub token_mint: &'info UncheckedAccount,

    /// WSOL mint
    pub wsol_mint: &'info UncheckedAccount,

    // ---- Meteora DAMM v2 accounts ----

    /// Pool authority (const PDA of DAMM v2)
    #[account(constraint = *pool_authority.address() == POOL_AUTHORITY @ DuelError::InvalidMarketConfig)]
    pub pool_authority: &'info UncheckedAccount,

    /// Meteora pool
    pub pool: &'info UncheckedAccount,

    /// Position PDA
    #[account(mut)]
    pub position: &'info mut UncheckedAccount,

    /// Fee receiver's token A account (receives claimed token fees)
    #[account(mut)]
    pub fee_receiver_token_a: &'info mut InterfaceAccount<Token>,

    /// Fee receiver's token B account (receives claimed WSOL fees)
    #[account(mut)]
    pub fee_receiver_token_b: &'info mut InterfaceAccount<Token>,

    /// Pool's token A vault
    #[account(mut)]
    pub token_a_vault: &'info mut UncheckedAccount,

    /// Pool's token B vault
    #[account(mut)]
    pub token_b_vault: &'info mut UncheckedAccount,

    /// Position NFT token account (market PDA is the authority)
    pub position_nft_account: &'info UncheckedAccount,

    /// Token A program
    pub token_a_program: &'info UncheckedAccount,

    /// Token B program
    pub token_b_program: &'info UncheckedAccount,

    /// Event authority PDA of DAMM v2
    pub event_authority: &'info UncheckedAccount,

    /// Meteora DAMM v2 program
    #[account(constraint = *meteora_program.address() == METEORA_DAMM_V2_PROGRAM_ID @ DuelError::InvalidMarketConfig)]
    pub meteora_program: &'info UncheckedAccount,

    pub token_program: &'info Interface<TokenInterface>,
}

impl<'info> ClaimPoolFees<'info> {
    #[inline(always)]
    pub fn handler(&mut self) -> Result<(), ProgramError> {
        // Authority must be market creator or protocol admin
        let authority_addr = self.authority.address();
        require!(
            self.market.authority == *authority_addr || self.config.admin == *authority_addr,
            DuelError::InvalidMarketConfig
        );

        // Build market PDA signer seeds (market PDA is the position NFT owner)
        let authority_key = self.market.authority;
        let market_id_bytes = self.market.market_id.get().to_le_bytes();
        let bump_byte = [self.market.bump];
        let seeds = [
            Seed::from(b"market" as &[u8]),
            Seed::from(authority_key.as_ref()),
            Seed::from(market_id_bytes.as_ref()),
            Seed::from(bump_byte.as_ref()),
        ];

        invoke_claim_position_fee(
            self.pool_authority.to_account_view(),
            self.pool.to_account_view(),
            self.position.to_account_view(),
            self.fee_receiver_token_a.to_account_view(),
            self.fee_receiver_token_b.to_account_view(),
            self.token_a_vault.to_account_view(),
            self.token_b_vault.to_account_view(),
            self.token_mint.to_account_view(),
            self.wsol_mint.to_account_view(),
            self.position_nft_account.to_account_view(),
            self.market.to_account_view(),
            self.token_a_program.to_account_view(),
            self.token_b_program.to_account_view(),
            self.event_authority.to_account_view(),
            self.meteora_program.to_account_view(),
            &seeds,
        )?;

        Ok(())
    }
}

/// Build and invoke claim_position_fee on Meteora DAMM v2 via BufCpiCall.
fn invoke_claim_position_fee(
    pool_authority: &AccountView,
    pool: &AccountView,
    position: &AccountView,
    token_a_account: &AccountView,
    token_b_account: &AccountView,
    token_a_vault: &AccountView,
    token_b_vault: &AccountView,
    token_a_mint: &AccountView,
    token_b_mint: &AccountView,
    position_nft_account: &AccountView,
    owner: &AccountView,
    token_a_program: &AccountView,
    token_b_program: &AccountView,
    event_authority: &AccountView,
    meteora_program: &AccountView,
    seeds: &[Seed],
) -> Result<(), ProgramError> {
    use quasar_lang::cpi::{BufCpiCall, InstructionAccount};

    // No params, just the discriminator
    let mut data = [0u8; 8];
    data[..8].copy_from_slice(&CLAIM_POSITION_FEE_DISCRIMINATOR);

    let call = BufCpiCall::<15, 8>::new(
        &METEORA_DAMM_V2_PROGRAM_ID,
        [
            InstructionAccount::readonly(pool_authority.address()),       // 0: pool_authority
            InstructionAccount::readonly(pool.address()),                // 1: pool
            InstructionAccount::writable(position.address()),            // 2: position (mut)
            InstructionAccount::writable(token_a_account.address()),     // 3: token_a_account (mut)
            InstructionAccount::writable(token_b_account.address()),     // 4: token_b_account (mut)
            InstructionAccount::writable(token_a_vault.address()),       // 5: token_a_vault (mut)
            InstructionAccount::writable(token_b_vault.address()),       // 6: token_b_vault (mut)
            InstructionAccount::readonly(token_a_mint.address()),        // 7: token_a_mint
            InstructionAccount::readonly(token_b_mint.address()),        // 8: token_b_mint
            InstructionAccount::readonly(position_nft_account.address()), // 9: position_nft_account
            InstructionAccount::readonly_signer(owner.address()),        // 10: owner (market PDA, signer)
            InstructionAccount::readonly(token_a_program.address()),     // 11: token_a_program
            InstructionAccount::readonly(token_b_program.address()),     // 12: token_b_program
            InstructionAccount::readonly(event_authority.address()),     // 13: event_authority
            InstructionAccount::readonly(meteora_program.address()),     // 14: program (self)
        ],
        [
            pool_authority,
            pool,
            position,
            token_a_account,
            token_b_account,
            token_a_vault,
            token_b_vault,
            token_a_mint,
            token_b_mint,
            position_nft_account,
            owner,
            token_a_program,
            token_b_program,
            event_authority,
            meteora_program,
        ],
        data,
        8,
    );

    call.invoke_signed(seeds)?;

    Ok(())
}
