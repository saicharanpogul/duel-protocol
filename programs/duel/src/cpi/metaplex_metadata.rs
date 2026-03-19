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

/// Discriminator for UpdateMetadataAccountV2 (instruction index 15)
pub const UPDATE_METADATA_V2_DISCRIMINATOR: u8 = 15;

/// UpdateMetadataAccountV2 args (borsh-serialized after discriminator)
#[derive(AnchorSerialize)]
pub struct UpdateMetadataAccountV2Args {
    pub data: Option<DataV2>,
    pub new_update_authority: Option<Pubkey>,
    pub primary_sale_happened: Option<bool>,
    pub is_mutable: Option<bool>,
}

/// Build and invoke UpdateMetadataAccountV2 CPI.
///
/// Updates metadata fields on an existing Metaplex metadata account.
/// The update_authority (market PDA) must sign via invoke_signed.
///
/// Accounts:
/// 0. metadata (writable) - Metadata PDA
/// 1. update_authority (signer) - Current update authority
pub fn update_metadata_v2<'info>(
    metadata: AccountInfo<'info>,
    update_authority: AccountInfo<'info>,
    token_metadata_program: AccountInfo<'info>,
    data: DataV2,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    let args = UpdateMetadataAccountV2Args {
        data: Some(data),
        new_update_authority: None,
        primary_sale_happened: None,
        is_mutable: None,
    };

    let mut ix_data = Vec::with_capacity(512);
    ix_data.push(UPDATE_METADATA_V2_DISCRIMINATOR);
    args.serialize(&mut ix_data)?;

    let accounts = vec![
        AccountMeta::new(metadata.key(), false),
        AccountMeta::new_readonly(update_authority.key(), true),
    ];

    let ix = Instruction {
        program_id: TOKEN_METADATA_PROGRAM_ID,
        accounts,
        data: ix_data,
    };

    let account_infos = &[
        metadata,
        update_authority,
        token_metadata_program,
    ];

    invoke_signed(&ix, account_infos, signer_seeds)?;

    Ok(())
}

/// Read name, symbol, and URI from a Metaplex metadata account's raw data.
///
/// Metaplex metadata layout (borsh):
///   key: u8 (1 byte)
///   update_authority: Pubkey (32 bytes)
///   mint: Pubkey (32 bytes)
///   data.name: String (4-byte LE length + bytes, padded with nulls to 32 chars)
///   data.symbol: String (4-byte LE length + bytes, padded with nulls to 10 chars)
///   data.uri: String (4-byte LE length + bytes, padded with nulls to 200 chars)
///   data.seller_fee_basis_points: u16
///   ... (rest not needed)
pub fn read_metadata_fields(data: &[u8]) -> Result<(String, String, String)> {
    let mut offset: usize = 1 + 32 + 32; // skip key + update_authority + mint

    // Read name
    let name = read_borsh_string(data, &mut offset)?;
    // Read symbol
    let symbol = read_borsh_string(data, &mut offset)?;
    // Read uri
    let uri = read_borsh_string(data, &mut offset)?;

    Ok((
        name.trim_end_matches('\0').to_string(),
        symbol.trim_end_matches('\0').to_string(),
        uri.trim_end_matches('\0').to_string(),
    ))
}

/// Read a borsh-serialized String from raw bytes at the given offset.
/// Advances offset past the string.
fn read_borsh_string(data: &[u8], offset: &mut usize) -> Result<String> {
    require!(
        *offset + 4 <= data.len(),
        anchor_lang::error::ErrorCode::AccountDidNotDeserialize
    );
    let len = u32::from_le_bytes(
        data[*offset..*offset + 4]
            .try_into()
            .map_err(|_| anchor_lang::error::ErrorCode::AccountDidNotDeserialize)?,
    ) as usize;
    *offset += 4;
    require!(
        *offset + len <= data.len(),
        anchor_lang::error::ErrorCode::AccountDidNotDeserialize
    );
    let s = String::from_utf8_lossy(&data[*offset..*offset + len]).to_string();
    *offset += len;
    Ok(s)
}
