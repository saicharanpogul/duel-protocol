/// Local interface for Meteora DAMM v2 CPI.
/// Uses the Local Interface Pattern to avoid external crate dependencies.
/// Program ID: cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG
use anchor_lang::prelude::*;
use anchor_lang::solana_program::{instruction::Instruction, program::invoke_signed};

/// Meteora DAMM v2 program ID
pub const METEORA_DAMM_V2_PROGRAM_ID: Pubkey =
    pubkey!("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG");

/// 8-byte discriminator for `initialize_customizable_permissionless_constant_product_pool`
/// Computed as: sha256("global:initialize_customizable_permissionless_constant_product_pool")[0..8]
pub const INIT_POOL_DISCRIMINATOR: [u8; 8] = [0x61, 0xda, 0x3b, 0xed, 0x7a, 0x2b, 0xd5, 0x0e];

/// Parameters for pool initialization
#[derive(AnchorSerialize)]
pub struct InitPoolParams {
    /// Trade fee BPS for the pool
    pub trade_fee_bps: u64,
    /// Token A amount to seed
    pub token_a_amount: u64,
    /// Token B amount to seed (SOL in our case, wrapped)
    pub token_b_amount: u64,
}

/// Build the CPI instruction for Meteora DAMM v2 pool initialization.
///
/// The accounts follow Meteora's `initialize_customizable_permissionless_constant_product_pool`:
/// 1. pool (writable) - Pool PDA
/// 2. pool_authority - Pool authority PDA
/// 3. token_a_mint - Token A mint  
/// 4. token_b_mint - Token B mint (WSOL)
/// 5. token_a_vault (writable) - Pool's token A vault
/// 6. token_b_vault (writable) - Pool's token B vault
/// 7. lp_mint (writable) - LP token mint
/// 8. payer (writable, signer) - Payer for rent
/// 9. creator_token_a (writable) - Creator's token A account (where tokens come from)
/// 10. creator_token_b (writable) - Creator's token B account (where SOL comes from)
/// 11. creator_lp_token (writable) - Creator's LP token account
/// 12. token_program - SPL Token program
/// 13. associated_token_program - Associated Token program
/// 14. system_program - System program
/// 15. rent - Rent sysvar
pub fn build_init_pool_ix(
    accounts: Vec<AccountMeta>,
    params: InitPoolParams,
) -> Result<Instruction> {
    let mut data = Vec::with_capacity(8 + 24);
    data.extend_from_slice(&INIT_POOL_DISCRIMINATOR);
    params.serialize(&mut data)?;

    Ok(Instruction {
        program_id: METEORA_DAMM_V2_PROGRAM_ID,
        accounts,
        data,
    })
}

/// Invoke the Meteora DAMM v2 pool initialization via CPI with PDA signer.
pub fn invoke_init_pool<'info>(
    accounts: Vec<AccountMeta>,
    account_infos: Vec<AccountInfo<'info>>,
    params: InitPoolParams,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    let ix = build_init_pool_ix(accounts, params)?;
    invoke_signed(&ix, &account_infos, signer_seeds)?;
    Ok(())
}
