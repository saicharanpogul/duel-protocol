use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};

/// Meteora DAMM v2 Program ID
pub const METEORA_DAMM_V2_PROGRAM_ID: Pubkey =
    anchor_lang::solana_program::pubkey!("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG");

/// Token-2022 Program ID (for position NFT)
pub const TOKEN_2022_PROGRAM_ID: Pubkey =
    anchor_lang::solana_program::pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

/// Pool authority (const PDA of DAMM v2)
pub const POOL_AUTHORITY: Pubkey =
    anchor_lang::solana_program::pubkey!("HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC");

/// Discriminator for `initialize_customizable_pool`
/// sha256("global:initialize_customizable_pool")[0..8]
pub const INIT_CUSTOMIZABLE_POOL_DISCRIMINATOR: [u8; 8] = [20, 161, 241, 24, 189, 221, 180, 2];

// ── Serialization helpers for sqrt price (Q64.64 u128) ──

/// PoolFeeParameters — contains BaseFeeParameters and optional DynamicFeeParameters
/// BaseFeeParameters is just [u8; 30] raw data
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct PoolFeeParameters {
    pub base_fee: BaseFeeParameters,
    pub dynamic_fee: Option<DynamicFeeParameters>,
}

/// Raw 30-byte base fee data
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct BaseFeeParameters {
    pub data: [u8; 30],
}

/// Dynamic fee parameters (optional)
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct DynamicFeeParameters {
    pub data: [u8; 34],
}

/// Full params for initialize_customizable_pool
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct InitializeCustomizablePoolParameters {
    pub pool_fees: PoolFeeParameters,
    pub sqrt_min_price: u128,
    pub sqrt_max_price: u128,
    pub has_alpha_vault: bool,
    pub liquidity: u128,
    pub sqrt_price: u128,
    pub activation_type: u8,
    pub collect_fee_mode: u8,
    pub activation_point: Option<u64>,
}

impl InitializeCustomizablePoolParameters {
    /// Create simple params with a basic constant fee
    /// fee_bps is the trade fee in basis points (e.g., 25 = 0.25%)
    pub fn with_simple_fee(
        fee_bps: u16,
        sqrt_price: u128,
        liquidity: u128,
    ) -> Self {
        // BaseFeeParameters.data is a 30-byte layout:
        //   [0..8]   cliffFeeNumerator (u64 LE) - fee numerator = bps * 100_000
        //   [8..12]  firstFactor (u32 LE) - number of periods (0 = constant)
        //   [12..20] secondFactor (u64 LE) - period frequency (0 = constant)
        //   [20..28] thirdFactor (u64 LE) - reduction factor (0 = constant)
        //   [28..29] baseFeeMode (u8) - 0 = FeeSchedulerLinear
        //   [29]     padding
        let mut base_fee_data = [0u8; 30];
        // cliffFeeNumerator = bps * 100_000 (SDK: bpsToFeeNumerator)
        let cliff_fee_numerator = (fee_bps as u64) * 100_000;
        base_fee_data[0..8].copy_from_slice(&cliff_fee_numerator.to_le_bytes());

        Self {
            pool_fees: PoolFeeParameters {
                base_fee: BaseFeeParameters { data: base_fee_data },
                dynamic_fee: None,
            },
            // DAMM v2 valid range from SDK constants
            sqrt_min_price: 4_295_048_016u128,                  // MIN_SQRT_PRICE
            sqrt_max_price: 79_226_673_521_066_979_257_578_248_091u128, // MAX_SQRT_PRICE
            has_alpha_vault: false,
            liquidity,
            sqrt_price,
            activation_type: 0, // Slot-based activation
            collect_fee_mode: 0,
            activation_point: None, // Activate immediately
        }
    }
}

/// Invoke the `initialize_customizable_pool` instruction via CPI.
///
/// Account order (19 accounts):
///  0: creator                    (readonly)
///  1: position_nft_mint          (writable, signer)
///  2: position_nft_account       (writable)
///  3: payer                      (writable, signer — market PDA)
///  4: pool_authority             (readonly)
///  5: pool                       (writable)
///  6: position                   (writable)
///  7: token_a_mint               (readonly)
///  8: token_b_mint               (readonly)
///  9: token_a_vault              (writable)
/// 10: token_b_vault              (writable)
/// 11: payer_token_a              (writable)
/// 12: payer_token_b              (writable)
/// 13: token_a_program            (readonly)
/// 14: token_b_program            (readonly)
/// 15: token_2022_program         (readonly)
/// 16: system_program             (readonly)
/// 17: event_authority             (readonly)
/// 18: program                    (readonly — DAMM v2 itself)
pub fn invoke_init_customizable_pool(
    account_metas: Vec<AccountMeta>,
    account_infos: Vec<AccountInfo>,
    params: InitializeCustomizablePoolParameters,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    // Serialize: discriminator + borsh-serialized params
    let mut data = Vec::with_capacity(256);
    data.extend_from_slice(&INIT_CUSTOMIZABLE_POOL_DISCRIMINATOR);
    params.serialize(&mut data)?;

    let ix = Instruction {
        program_id: METEORA_DAMM_V2_PROGRAM_ID,
        accounts: account_metas,
        data,
    };

    invoke_signed(&ix, &account_infos, signer_seeds)?;
    Ok(())
}

/// Discriminator for `claim_position_fee`
/// sha256("global:claim_position_fee")[0..8]
pub const CLAIM_POSITION_FEE_DISCRIMINATOR: [u8; 8] = [180, 38, 154, 17, 133, 33, 162, 211];

/// Invoke the `claim_position_fee` instruction via CPI.
///
/// Account order (14 accounts):
///  0: pool_authority              (readonly)
///  1: pool                        (readonly)
///  2: position                    (writable)
///  3: token_a_account             (writable — receives fees)
///  4: token_b_account             (writable — receives fees)
///  5: token_a_vault               (writable)
///  6: token_b_vault               (writable)
///  7: token_a_mint                (readonly)
///  8: token_b_mint                (readonly)
///  9: position_nft_account        (readonly)
/// 10: owner                       (signer — market PDA)
/// 11: token_a_program             (readonly)
/// 12: token_b_program             (readonly)
/// 13: event_authority             (readonly)
/// 14: program                     (readonly — DAMM v2 itself)
pub fn invoke_claim_position_fee(
    account_metas: Vec<AccountMeta>,
    account_infos: Vec<AccountInfo>,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    // No params — just the discriminator
    let data = CLAIM_POSITION_FEE_DISCRIMINATOR.to_vec();

    let ix = Instruction {
        program_id: METEORA_DAMM_V2_PROGRAM_ID,
        accounts: account_metas,
        data,
    };

    invoke_signed(&ix, &account_infos, signer_seeds)?;
    Ok(())
}
