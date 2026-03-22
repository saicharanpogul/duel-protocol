use quasar_lang::prelude::*;
use quasar_lang::sysvars::Sysvar as SysvarTrait;
use quasar_spl::{InterfaceAccount, Mint, Token, TokenCpi, TokenInterface};

use crate::constants::*;
use crate::errors::DuelError;
use crate::events::MarketCreated;
use crate::state::*;

/// Token Metadata program ID
const TOKEN_METADATA_PROGRAM_ID: Address =
    address!("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

/// CreateMetadataAccountV3 instruction discriminator
const CREATE_METADATA_V3_DISCRIMINATOR: u8 = 33;

/// Market account space: 8 (discriminator) + size_of::<Market>()
const MARKET_SPACE: u64 = (8 + core::mem::size_of::<Market>()) as u64;

#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct InitializeMarket<'info> {
    pub creator: &'info mut Signer,

    /// Market account (PDA: [b"market", creator, &market_id.to_le_bytes()])
    /// Created manually via system_program CPI because seeds include an
    /// instruction arg, which the Bumps::_seeds() method cannot reference.
    pub market: &'info mut UncheckedAccount,

    /// Side A PDA: seeds = [b"side", market, &[0u8]]
    #[account(
        init,
        payer = creator,
        seeds = [b"side", market, &[0u8]],
        bump
    )]
    pub side_a: &'info mut Account<Side>,

    /// Side B PDA: seeds = [b"side", market, &[1u8]]
    #[account(
        init,
        payer = creator,
        seeds = [b"side", market, &[1u8]],
        bump
    )]
    pub side_b: &'info mut Account<Side>,

    /// Token mint A
    #[account(
        init,
        payer = creator,
        mint::decimals = TOKEN_DECIMALS,
        mint::authority = market,
        seeds = [b"mint", market, &[0u8]],
        bump
    )]
    pub token_mint_a: &'info mut InterfaceAccount<Mint>,

    /// Token mint B
    #[account(
        init,
        payer = creator,
        mint::decimals = TOKEN_DECIMALS,
        mint::authority = market,
        seeds = [b"mint", market, &[1u8]],
        bump
    )]
    pub token_mint_b: &'info mut InterfaceAccount<Mint>,

    /// Token vault A (holds side A tokens)
    #[account(
        init,
        payer = creator,
        token::mint = token_mint_a,
        token::authority = market,
        seeds = [b"token_vault", market, &[0u8]],
        bump
    )]
    pub token_vault_a: &'info mut InterfaceAccount<Token>,

    /// Token vault B (holds side B tokens)
    #[account(
        init,
        payer = creator,
        token::mint = token_mint_b,
        token::authority = market,
        seeds = [b"token_vault", market, &[1u8]],
        bump
    )]
    pub token_vault_b: &'info mut InterfaceAccount<Token>,

    /// Quote token mint (WSOL)
    pub quote_mint: &'info InterfaceAccount<Mint>,

    /// Quote vault for Side A
    #[account(
        init,
        payer = creator,
        token::mint = quote_mint,
        token::authority = market,
        seeds = [b"quote_vault", market, &[0u8]],
        bump
    )]
    pub quote_vault_a: &'info mut InterfaceAccount<Token>,

    /// Quote vault for Side B
    #[account(
        init,
        payer = creator,
        token::mint = quote_mint,
        token::authority = market,
        seeds = [b"quote_vault", market, &[1u8]],
        bump
    )]
    pub quote_vault_b: &'info mut InterfaceAccount<Token>,

    /// Protocol config (pause check + market creation fee)
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: &'info Account<ProgramConfig>,

    /// Protocol fee recipient, validated against config
    #[account(constraint = *protocol_fee_account.address() == config.protocol_fee_account @ DuelError::InvalidFeeConfig)]
    pub protocol_fee_account: &'info mut UncheckedAccount,

    /// Creator fee recipient
    #[account(constraint = *creator_fee_account.address() != Address::default() @ DuelError::InvalidFeeConfig)]
    pub creator_fee_account: &'info UncheckedAccount,

    /// Metadata account for token A (created by Metaplex CPI)
    pub metadata_a: &'info mut UncheckedAccount,

    /// Metadata account for token B (created by Metaplex CPI)
    pub metadata_b: &'info mut UncheckedAccount,

    /// Metaplex Token Metadata program
    #[account(constraint = *token_metadata_program.address() == TOKEN_METADATA_PROGRAM_ID @ DuelError::InvalidMarketConfig)]
    pub token_metadata_program: &'info UncheckedAccount,

    pub token_program: &'info Interface<TokenInterface>,
    /// Quote token program (may differ for Token-2022)
    pub quote_token_program: &'info Interface<TokenInterface>,
    pub system_program: &'info Program<System>,
    pub rent: &'info Sysvar<Rent>,
}

impl<'info> InitializeMarket<'info> {
    #[inline(always)]
    pub fn handler(
        &mut self,
        market_id: u64,
        deadline: i64,
        twap_window: u64,
        twap_interval: u64,
        bumps: &InitializeMarketBumps,
    ) -> Result<(), ProgramError> {
        // Check protocol is not paused
        require!(self.config.paused == 0, DuelError::ProtocolPaused);

        let clock = Clock::get()?;
        let now = clock.unix_timestamp.get();

        // Validation
        require!(deadline > now, DuelError::InvalidMarketConfig);
        let duration = (deadline - now) as u64;
        require!(
            duration >= self.config.min_market_duration.get(),
            DuelError::InvalidMarketConfig
        );
        require!(
            twap_window > 0 && twap_window < duration,
            DuelError::InvalidMarketConfig
        );
        require!(
            twap_interval >= MIN_TWAP_INTERVAL && twap_interval <= MAX_TWAP_INTERVAL,
            DuelError::InvalidMarketConfig
        );

        // Derive market PDA and validate
        let creator_key = *self.creator.address();
        let market_id_bytes = market_id.to_le_bytes();
        let (expected_market, market_bump) =
            quasar_lang::pda::based_try_find_program_address(
                &[b"market", creator_key.as_ref(), market_id_bytes.as_ref()],
                &crate::ID,
            )?;
        require!(
            *self.market.address() == expected_market,
            DuelError::InvalidMarketConfig
        );

        // Create market PDA account via system_program CPI
        let rent = Rent::get()?;
        let lamports = rent.try_minimum_balance(MARKET_SPACE as usize)?;

        let market_bump_byte = [market_bump];
        let market_seeds = [
            Seed::from(b"market" as &[u8]),
            Seed::from(creator_key.as_ref()),
            Seed::from(market_id_bytes.as_ref()),
            Seed::from(market_bump_byte.as_ref()),
        ];

        self.system_program
            .create_account(
                self.creator,
                self.market,
                lamports,
                MARKET_SPACE,
                &crate::ID,
            )
            .invoke_signed(&market_seeds)?;

        // Charge market creation fee if configured
        let creation_fee = self.config.market_creation_fee.get();
        if creation_fee > 0 {
            self.system_program
                .transfer(self.creator, self.protocol_fee_account, creation_fee)
                .invoke()?;
        }

        let market_key = *self.market.address();
        let side_a_key = *self.side_a.to_account_view().address();
        let side_b_key = *self.side_b.to_account_view().address();

        // Write Market data to the newly created account using raw pointer access
        {
            let view = self.market.to_account_view();
            let ptr = view.data_ptr() as *mut u8;
            let len = view.data_len();

            // Verify we have enough space
            require!(len >= MARKET_SPACE as usize, DuelError::InvalidMarketConfig);

            // SAFETY: Account was just created with correct space via CPI,
            // data region is valid for writes, and no borrows are active.
            unsafe {
                // Write 8-byte discriminator (Market = 1)
                core::ptr::copy_nonoverlapping(1u64.to_le_bytes().as_ptr(), ptr, 8);

                // Cast the data after discriminator as Market struct and write fields
                let market_ptr = ptr.add(8) as *mut Market;
                let m = &mut *market_ptr;

                m.version = 1;
                m.bump = market_bump;
                m.authority = creator_key;
                m.market_id = PodU64::from(market_id);
                m.side_a = side_a_key;
                m.side_b = side_b_key;
                m.quote_mint = *self.quote_mint.to_account_view().address();
                m.deadline = PodI64::from(deadline);
                m.twap_window = PodU64::from(twap_window);
                m.twap_interval = PodU64::from(twap_interval);
                m.creator_fee_account = *self.creator_fee_account.address();
                m.protocol_fee_account = *self.protocol_fee_account.address();
                m.status = STATUS_ACTIVE;
                m.twap_samples_count = PodU32::from(0u32);
                m.last_sample_ts = PodI64::from(0i64);
                m.has_winner = 0;
                m.winner = 0;
                m.final_twap_a = PodU64::from(0u64);
                m.final_twap_b = PodU64::from(0u64);
                m.emergency_window = PodU64::from(DEFAULT_EMERGENCY_WINDOW);
                m.locked = 0;
                m._reserved = [0u8; 128];
            }
        }

        // Initialize Side A
        self.side_a.market = market_key;
        self.side_a.side_index = 0;
        self.side_a.token_mint = *self.token_mint_a.to_account_view().address();
        self.side_a.token_reserve_vault = *self.token_vault_a.to_account_view().address();
        self.side_a.quote_reserve_vault = *self.quote_vault_a.to_account_view().address();
        self.side_a.total_supply = PodU64::from(TOTAL_SUPPLY_PER_SIDE);
        self.side_a.circulating_supply = PodU64::from(0u64);
        self.side_a.twap_accumulator = PodU128::from(0u128);
        self.side_a.bump = bumps.side_a;
        self.side_a._reserved = [0u8; 32];

        // Initialize Side B
        self.side_b.market = market_key;
        self.side_b.side_index = 1;
        self.side_b.token_mint = *self.token_mint_b.to_account_view().address();
        self.side_b.token_reserve_vault = *self.token_vault_b.to_account_view().address();
        self.side_b.quote_reserve_vault = *self.quote_vault_b.to_account_view().address();
        self.side_b.total_supply = PodU64::from(TOTAL_SUPPLY_PER_SIDE);
        self.side_b.circulating_supply = PodU64::from(0u64);
        self.side_b.twap_accumulator = PodU128::from(0u128);
        self.side_b.bump = bumps.side_b;
        self.side_b._reserved = [0u8; 32];

        // Build PDA signer seeds for minting and metadata CPI
        let bump_byte = [market_bump];
        let seeds = [
            Seed::from(b"market" as &[u8]),
            Seed::from(creator_key.as_ref()),
            Seed::from(market_id_bytes.as_ref()),
            Seed::from(bump_byte.as_ref()),
        ];

        // Mint total supply to each token vault
        self.token_program
            .mint_to(
                self.token_mint_a,
                self.token_vault_a,
                self.market,
                TOTAL_SUPPLY_PER_SIDE,
            )
            .invoke_signed(&seeds)?;

        self.token_program
            .mint_to(
                self.token_mint_b,
                self.token_vault_b,
                self.market,
                TOTAL_SUPPLY_PER_SIDE,
            )
            .invoke_signed(&seeds)?;

        // Create Metaplex metadata for Side A
        create_metadata_v3_cpi(
            self.metadata_a.to_account_view(),
            self.token_mint_a.to_account_view(),
            self.market.to_account_view(),
            self.creator.to_account_view(),
            self.market.to_account_view(),
            self.system_program.to_account_view(),
            self.rent.to_account_view(),
            &seeds,
        )?;

        // Create Metaplex metadata for Side B
        create_metadata_v3_cpi(
            self.metadata_b.to_account_view(),
            self.token_mint_b.to_account_view(),
            self.market.to_account_view(),
            self.creator.to_account_view(),
            self.market.to_account_view(),
            self.system_program.to_account_view(),
            self.rent.to_account_view(),
            &seeds,
        )?;

        emit!(MarketCreated {
            market: market_key,
            authority: creator_key,
            deadline,
            market_id,
            quote_mint: *self.quote_mint.to_account_view().address(),
        });

        Ok(())
    }
}

/// Build and invoke CreateMetadataAccountV3 CPI using BufCpiCall.
/// Creates minimal metadata (empty name/symbol/uri, is_mutable=true).
fn create_metadata_v3_cpi(
    metadata: &AccountView,
    mint: &AccountView,
    mint_authority: &AccountView,
    payer: &AccountView,
    update_authority: &AccountView,
    system_program: &AccountView,
    rent: &AccountView,
    seeds: &[Seed],
) -> Result<(), ProgramError> {
    use quasar_lang::cpi::{BufCpiCall, InstructionAccount};

    // Build CreateMetadataAccountV3 instruction data:
    // discriminator=33, then borsh-serialized args with empty strings
    let mut data = [0u8; 256];
    let mut pos = 0;

    // Discriminator
    data[pos] = CREATE_METADATA_V3_DISCRIMINATOR;
    pos += 1;

    // name: empty string (len=0 as u32 LE)
    data[pos..pos + 4].copy_from_slice(&0u32.to_le_bytes());
    pos += 4;

    // symbol: empty string
    data[pos..pos + 4].copy_from_slice(&0u32.to_le_bytes());
    pos += 4;

    // uri: empty string
    data[pos..pos + 4].copy_from_slice(&0u32.to_le_bytes());
    pos += 4;

    // seller_fee_basis_points: 0
    data[pos..pos + 2].copy_from_slice(&0u16.to_le_bytes());
    pos += 2;

    // creators: None
    data[pos] = 0;
    pos += 1;

    // collection: None
    data[pos] = 0;
    pos += 1;

    // uses: None
    data[pos] = 0;
    pos += 1;

    // is_mutable: true
    data[pos] = 1;
    pos += 1;

    // collection_details: None
    data[pos] = 0;
    pos += 1;

    let call = BufCpiCall::<7, 256>::new(
        &TOKEN_METADATA_PROGRAM_ID,
        [
            InstructionAccount::writable(metadata.address()),
            InstructionAccount::readonly(mint.address()),
            InstructionAccount::readonly_signer(mint_authority.address()),
            InstructionAccount::writable_signer(payer.address()),
            InstructionAccount::readonly_signer(update_authority.address()),
            InstructionAccount::readonly(system_program.address()),
            InstructionAccount::readonly(rent.address()),
        ],
        [
            metadata,
            mint,
            mint_authority,
            payer,
            update_authority,
            system_program,
            rent,
        ],
        data,
        pos,
    );

    call.invoke_signed(seeds)?;

    Ok(())
}
