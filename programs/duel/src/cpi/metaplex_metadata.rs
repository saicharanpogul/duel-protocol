/// Local interface for Metaplex Token Metadata program CPI.
/// Uses the Local Interface Pattern to avoid mpl-token-metadata crate dependency.
/// Program ID: metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s
use anchor_lang::prelude::*;
use anchor_lang::solana_program::{instruction::Instruction, program::invoke_signed};

/// Metaplex Token Metadata program ID
pub const TOKEN_METADATA_PROGRAM_ID: Pubkey =
    pubkey!("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

/// Discriminator for CreateMetadataAccountV3 (instruction index 33)
pub const CREATE_METADATA_V3_DISCRIMINATOR: u8 = 33;

/// Metadata data payload
#[derive(AnchorSerialize)]
pub struct DataV2 {
    pub name: String,
    pub symbol: String,
    pub uri: String,
    pub seller_fee_basis_points: u16,
    pub creators: Option<Vec<Creator>>,
    pub collection: Option<Collection>,
    pub uses: Option<Uses>,
}

#[derive(AnchorSerialize)]
pub struct Creator {
    pub address: Pubkey,
    pub verified: bool,
    pub share: u8,
}

#[derive(AnchorSerialize)]
pub struct Collection {
    pub verified: bool,
    pub key: Pubkey,
}

#[derive(AnchorSerialize)]
pub struct Uses {
    pub use_method: u8, // 0 = Burn, 1 = Multiple, 2 = Single
    pub remaining: u64,
    pub total: u64,
}

/// CreateMetadataAccountV3 args
#[derive(AnchorSerialize)]
pub struct CreateMetadataAccountV3Args {
    pub data: DataV2,
    pub is_mutable: bool,
    pub collection_details: Option<u8>, // None = no collection details
}

/// Derive the metadata PDA for a given mint.
pub fn find_metadata_pda(mint: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            b"metadata",
            TOKEN_METADATA_PROGRAM_ID.as_ref(),
            mint.as_ref(),
        ],
        &TOKEN_METADATA_PROGRAM_ID,
    )
}

/// Build and invoke CreateMetadataAccountV3 CPI.
///
/// Accounts:
/// 0. metadata (writable) - Metadata PDA
/// 1. mint - Token mint
/// 2. mint_authority (signer) - Mint authority
/// 3. payer (writable, signer) - Payer for rent
/// 4. update_authority (signer) - Update authority
/// 5. system_program
/// 6. rent (optional, but included for compatibility)
pub fn create_metadata_v3<'info>(
    metadata: AccountInfo<'info>,
    mint: AccountInfo<'info>,
    mint_authority: AccountInfo<'info>,
    payer: AccountInfo<'info>,
    update_authority: AccountInfo<'info>,
    system_program: AccountInfo<'info>,
    rent: AccountInfo<'info>,
    token_metadata_program: AccountInfo<'info>,
    name: String,
    symbol: String,
    uri: String,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    let args = CreateMetadataAccountV3Args {
        data: DataV2 {
            name,
            symbol,
            uri,
            seller_fee_basis_points: 0,
            creators: None,
            collection: None,
            uses: None,
        },
        is_mutable: true,
        collection_details: None,
    };

    // Serialize: discriminator byte + borsh-serialized args
    let mut data = Vec::with_capacity(256);
    data.push(CREATE_METADATA_V3_DISCRIMINATOR);
    args.serialize(&mut data)?;

    let accounts = vec![
        AccountMeta::new(metadata.key(), false),
        AccountMeta::new_readonly(mint.key(), false),
        AccountMeta::new_readonly(mint_authority.key(), true), // signer
        AccountMeta::new(payer.key(), true),                   // signer
        AccountMeta::new_readonly(update_authority.key(), true), // signer
        AccountMeta::new_readonly(system_program.key(), false),
        AccountMeta::new_readonly(rent.key(), false),
    ];

    let ix = Instruction {
        program_id: TOKEN_METADATA_PROGRAM_ID,
        accounts,
        data,
    };

    let account_infos = &[
        metadata,
        mint,
        mint_authority,
        payer,
        update_authority,
        system_program,
        rent,
        token_metadata_program,
    ];

    invoke_signed(&ix, account_infos, signer_seeds)?;

    Ok(())
}
