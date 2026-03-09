/// Local interface for Meteora DAMM v2 CPI.
/// Uses the Local Interface Pattern to avoid external crate dependencies.
/// Program ID: cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG
use anchor_lang::prelude::*;
use anchor_lang::solana_program::{instruction::Instruction, program::invoke_signed};

/// Meteora DAMM v2 program ID
pub const METEORA_DAMM_V2_PROGRAM_ID: Pubkey =
    pubkey!("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG");

/// Meteora Vault program ID (used for dynamic vaults)
pub const METEORA_VAULT_PROGRAM_ID: Pubkey =
    pubkey!("24Uqj9JCLxUeoC3hGfh5W3s9FM9uCHDS2SG3LYwBpyTi");

/// Metaplex Token Metadata program ID
pub const METAPLEX_PROGRAM_ID: Pubkey =
    pubkey!("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

/// 8-byte discriminator for `initialize_customizable_permissionless_constant_product_pool`
/// From the actual Meteora DAMM v2 IDL: [145, 24, 172, 194, 219, 125, 3, 190]
pub const INIT_CUSTOMIZABLE_POOL_DISCRIMINATOR: [u8; 8] =
    [0x91, 0x18, 0xac, 0xc2, 0xdb, 0x7d, 0x03, 0xbe];

/// CustomizableParams — matches the Meteora DAMM v2 IDL struct exactly.
///
/// Fields:
/// - trade_fee_numerator: u32 — Trading fee numerator (denominator is 1_000_000_000)
/// - activation_point: Option<u64> — When pool starts trading (slot or timestamp)
/// - has_alpha_vault: bool — Whether pool supports alpha vault
/// - activation_type: u8 — 0 = Slot, 1 = Timestamp
/// - padding: [u8; 90] — Reserved for future use
#[derive(AnchorSerialize)]
pub struct CustomizableParams {
    pub trade_fee_numerator: u32,
    pub activation_point: Option<u64>,
    pub has_alpha_vault: bool,
    pub activation_type: u8,
    pub padding: [u8; 90],
}

impl CustomizableParams {
    /// Create default params with a given trade fee in BPS.
    /// Converts BPS to fee numerator (denominator = 1_000_000_000).
    /// e.g., 25 BPS = 0.25% = 2_500_000 / 1_000_000_000
    pub fn with_fee_bps(fee_bps: u32) -> Self {
        Self {
            trade_fee_numerator: fee_bps * 100_000, // BPS * 100_000 = numerator (denom 1B)
            activation_point: None,                  // trade immediately
            has_alpha_vault: false,
            activation_type: 0,                      // Slot-based
            padding: [0u8; 90],
        }
    }
}

/// Build the CPI instruction for Meteora DAMM v2 `initialize_customizable_permissionless_constant_product_pool`.
///
/// Account order (25 accounts, matching IDL):
///  0. pool (writable)
///  1. lp_mint (writable)
///  2. token_a_mint
///  3. token_b_mint
///  4. a_vault (writable)
///  5. b_vault (writable)
///  6. a_token_vault (writable)
///  7. b_token_vault (writable)
///  8. a_vault_lp_mint (writable)
///  9. b_vault_lp_mint (writable)
/// 10. a_vault_lp (writable)
/// 11. b_vault_lp (writable)
/// 12. payer_token_a (writable)
/// 13. payer_token_b (writable)
/// 14. payer_pool_lp (writable)
/// 15. protocol_token_a_fee (writable)
/// 16. protocol_token_b_fee (writable)
/// 17. payer (writable, signer)
/// 18. rent
/// 19. mint_metadata (writable)
/// 20. metadata_program
/// 21. vault_program
/// 22. token_program
/// 23. associated_token_program
/// 24. system_program
pub fn build_init_customizable_pool_ix(
    accounts: Vec<AccountMeta>,
    token_a_amount: u64,
    token_b_amount: u64,
    params: CustomizableParams,
) -> Result<Instruction> {
    let mut data = Vec::with_capacity(8 + 8 + 8 + 128);
    data.extend_from_slice(&INIT_CUSTOMIZABLE_POOL_DISCRIMINATOR);

    // Serialize args: token_a_amount, token_b_amount, params
    token_a_amount.serialize(&mut data)?;
    token_b_amount.serialize(&mut data)?;
    params.serialize(&mut data)?;

    Ok(Instruction {
        program_id: METEORA_DAMM_V2_PROGRAM_ID,
        accounts,
        data,
    })
}

/// Invoke the Meteora DAMM v2 customizable pool initialization via CPI with PDA signer.
pub fn invoke_init_customizable_pool<'info>(
    accounts: Vec<AccountMeta>,
    account_infos: Vec<AccountInfo<'info>>,
    token_a_amount: u64,
    token_b_amount: u64,
    params: CustomizableParams,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    let ix = build_init_customizable_pool_ix(accounts, token_a_amount, token_b_amount, params)?;
    invoke_signed(&ix, &account_infos, signer_seeds)?;
    Ok(())
}
