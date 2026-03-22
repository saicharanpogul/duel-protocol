use quasar_lang::prelude::*;
use quasar_lang::sysvars::Sysvar as SysvarTrait;
use quasar_spl::{InterfaceAccount, Mint, Token, TokenCpi, TokenInterface};

use crate::constants::*;
use crate::errors::DuelError;
use crate::events::MarketResolved;
use crate::state::*;

/// Token Metadata program ID
const TOKEN_METADATA_PROGRAM_ID: Address =
    address!("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

/// UpdateMetadataAccountV2 instruction discriminator
const UPDATE_METADATA_V2_DISCRIMINATOR: u8 = 15;

/// Meteora DAMM v2 Program ID
const METEORA_DAMM_V2_PROGRAM_ID: Address =
    address!("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG");

/// Token-2022 Program ID
const TOKEN_2022_PROGRAM_ID: Address =
    address!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

/// Pool authority (const PDA of DAMM v2)
const POOL_AUTHORITY: Address =
    address!("HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC");

/// Discriminators for Meteora DAMM v2 CPIs
const INIT_CUSTOMIZABLE_POOL_DISCRIMINATOR: [u8; 8] = [20, 161, 241, 24, 189, 221, 180, 2];
const PERMANENT_LOCK_POSITION_DISCRIMINATOR: [u8; 8] = [165, 176, 125, 6, 231, 171, 186, 213];

/// Metadata field storage: name (max 32), symbol (max 14), uri (max 200)
struct MetadataFields {
    name: [u8; 64],
    name_len: usize,
    symbol: [u8; 16],
    symbol_len: usize,
    uri: [u8; 256],
    uri_len: usize,
}

#[derive(Accounts)]
pub struct ResolveAndGraduate<'info> {
    pub resolver: &'info mut Signer,

    #[account(mut)]
    pub market: &'info mut Account<Market>,

    /// Protocol config
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: &'info Account<ProgramConfig>,

    #[account(mut)]
    pub side_a: &'info mut Account<Side>,

    #[account(mut)]
    pub side_b: &'info mut Account<Side>,

    /// Quote vault for Side A
    #[account(mut)]
    pub quote_vault_a: &'info mut InterfaceAccount<Token>,

    /// Quote vault for Side B
    #[account(mut)]
    pub quote_vault_b: &'info mut InterfaceAccount<Token>,

    /// Token vault for Side A
    #[account(mut)]
    pub token_vault_a: &'info mut InterfaceAccount<Token>,

    /// Token vault for Side B
    #[account(mut)]
    pub token_vault_b: &'info mut InterfaceAccount<Token>,

    /// Token mint for Side A
    #[account(mut)]
    pub token_mint_a: &'info mut InterfaceAccount<Mint>,

    /// Token mint for Side B
    #[account(mut)]
    pub token_mint_b: &'info mut InterfaceAccount<Mint>,

    /// Quote token mint (WSOL)
    pub quote_mint: &'info InterfaceAccount<Mint>,

    /// Resolver's ATA for winning side tokens (pre-created by caller)
    #[account(mut)]
    pub market_token_ata: &'info mut UncheckedAccount,

    /// Resolver's WSOL ATA (pre-created by caller)
    #[account(mut)]
    pub market_wsol_ata: &'info mut UncheckedAccount,

    // --- Meteora DAMM v2 accounts ---

    /// Initialized by Meteora CPI
    #[account(mut)]
    pub pool: &'info mut UncheckedAccount,

    /// New keypair, signer for Meteora CPI
    #[account(mut)]
    pub position_nft_mint: &'info mut Signer,

    /// Created by Meteora CPI
    #[account(mut)]
    pub position_nft_account: &'info mut UncheckedAccount,

    /// Created by Meteora CPI
    #[account(mut)]
    pub position: &'info mut UncheckedAccount,

    /// Created by Meteora CPI
    #[account(mut)]
    pub pool_token_vault_a: &'info mut UncheckedAccount,

    /// Created by Meteora CPI
    #[account(mut)]
    pub pool_token_vault_b: &'info mut UncheckedAccount,

    /// Validated against known pool authority constant
    #[account(constraint = *pool_authority.address() == POOL_AUTHORITY @ DuelError::InvalidMarketConfig)]
    pub pool_authority: &'info UncheckedAccount,

    /// Validated by Meteora program
    pub event_authority: &'info UncheckedAccount,

    /// Validated against known Meteora DAMM v2 program ID
    #[account(constraint = *meteora_program.address() == METEORA_DAMM_V2_PROGRAM_ID @ DuelError::InvalidMarketConfig)]
    pub meteora_program: &'info UncheckedAccount,

    // --- Losing token metadata (for [DEFEATED] update) ---

    /// Validated in handler by deriving expected metadata PDA for losing side mint
    #[account(mut)]
    pub losing_token_metadata: &'info mut UncheckedAccount,

    /// Validated against known Metaplex Token Metadata program ID
    #[account(constraint = *token_metadata_program.address() == TOKEN_METADATA_PROGRAM_ID @ DuelError::InvalidMarketConfig)]
    pub token_metadata_program: &'info UncheckedAccount,

    // --- Programs ---
    pub token_program: &'info Interface<TokenInterface>,
    pub quote_token_program: &'info Interface<TokenInterface>,

    /// Validated against known Token-2022 program ID
    #[account(constraint = *token_2022_program.address() == TOKEN_2022_PROGRAM_ID @ DuelError::InvalidMarketConfig)]
    pub token_2022_program: &'info UncheckedAccount,

    pub system_program: &'info Program<System>,
}

impl<'info> ResolveAndGraduate<'info> {
    #[inline(always)]
    pub fn handler(&mut self, expected_winner: u8) -> Result<(), ProgramError> {
        let clock = Clock::get()?;
        let now = clock.unix_timestamp.get();

        // ---- Phase 1: Validate and determine winner via TWAP ----

        // Status check
        require!(
            self.market.status != STATUS_RESOLVED,
            DuelError::MarketAlreadyResolved
        );

        // Side validation
        require!(
            self.side_a.market == *self.market.to_account_view().address(),
            DuelError::InvalidSide
        );
        require!(self.side_a.side_index == 0, DuelError::InvalidSide);
        require!(
            self.side_b.market == *self.market.to_account_view().address(),
            DuelError::InvalidSide
        );
        require!(self.side_b.side_index == 1, DuelError::InvalidSide);

        // Quote vault validation
        require!(
            *self.quote_vault_a.to_account_view().address() == self.side_a.quote_reserve_vault,
            DuelError::InvalidSide
        );
        require!(
            *self.quote_vault_b.to_account_view().address() == self.side_b.quote_reserve_vault,
            DuelError::InvalidSide
        );

        // Token vault validation
        require!(
            *self.token_vault_a.to_account_view().address() == self.side_a.token_reserve_vault,
            DuelError::InvalidSide
        );
        require!(
            *self.token_vault_b.to_account_view().address() == self.side_b.token_reserve_vault,
            DuelError::InvalidSide
        );

        // Token mint validation
        require!(
            *self.token_mint_a.to_account_view().address() == self.side_a.token_mint,
            DuelError::InvalidSide
        );
        require!(
            *self.token_mint_b.to_account_view().address() == self.side_b.token_mint,
            DuelError::InvalidSide
        );

        // Quote mint validation
        require!(
            *self.quote_mint.to_account_view().address() == self.market.quote_mint,
            DuelError::InvalidMarketConfig
        );

        let market_key = *self.market.to_account_view().address();
        let deadline = self.market.deadline.get();
        let twap_window = self.market.twap_window.get();
        let twap_interval = self.market.twap_interval.get();
        let twap_samples_count = self.market.twap_samples_count.get();
        let market_id_bytes = self.market.market_id.get().to_le_bytes();
        let bump = self.market.bump;
        let authority_key = self.market.authority;

        // Deadline must have passed
        require!(now >= deadline, DuelError::MarketNotExpired);

        // Must have sufficient TWAP samples (at least half the expected count, min 1)
        let min_samples = ((twap_window / twap_interval).max(1) / 2).max(1) as u32;
        require!(twap_samples_count >= min_samples, DuelError::NoTwapSamples);

        let samples = twap_samples_count as u128;

        // Calculate final TWAPs
        let final_twap_a = self
            .side_a
            .twap_accumulator
            .get()
            .checked_div(samples)
            .ok_or(DuelError::MathOverflow)? as u64;
        let final_twap_b = self
            .side_b
            .twap_accumulator
            .get()
            .checked_div(samples)
            .ok_or(DuelError::MathOverflow)? as u64;

        // Determine winner (no draws -- higher TWAP wins, reserve tiebreaker)
        let winner: u8 = if final_twap_a > final_twap_b {
            0
        } else if final_twap_b > final_twap_a {
            1
        } else {
            // Exact tie: side with higher reserve wins, side A wins if equal
            let reserve_a = self.quote_vault_a.amount();
            let reserve_b = self.quote_vault_b.amount();
            if reserve_a >= reserve_b {
                0
            } else {
                1
            }
        };

        // Validate expected winner matches actual winner
        require!(winner == expected_winner, DuelError::WinnerMismatch);

        // Build market PDA signer seeds
        let bump_byte = [bump];
        let seeds = [
            Seed::from(b"market" as &[u8]),
            Seed::from(authority_key.as_ref()),
            Seed::from(market_id_bytes.as_ref()),
            Seed::from(bump_byte.as_ref()),
        ];

        let quote_decimals = self.quote_mint.decimals();

        // ---- Phase 2: Transfer 100% of losing reserve to winning vault ----

        let loser_reserve = if winner == 0 {
            self.quote_vault_b.amount()
        } else {
            self.quote_vault_a.amount()
        };

        if loser_reserve > 0 {
            if winner == 0 {
                self.quote_token_program
                    .transfer_checked(
                        self.quote_vault_b,
                        self.quote_mint,
                        self.quote_vault_a,
                        &*self.market,
                        loser_reserve,
                        quote_decimals,
                    )
                    .invoke_signed(&seeds)?;
            } else {
                self.quote_token_program
                    .transfer_checked(
                        self.quote_vault_a,
                        self.quote_mint,
                        self.quote_vault_b,
                        &*self.market,
                        loser_reserve,
                        quote_decimals,
                    )
                    .invoke_signed(&seeds)?;
            }
        }

        // ---- Phase 3: Prepare winning side tokens and quote for Meteora pool ----

        // Read updated balances after transfer
        let sol_for_pool = if winner == 0 {
            self.quote_vault_a.amount()
        } else {
            self.quote_vault_b.amount()
        };
        require!(
            sol_for_pool >= MIN_GRADUATION_RESERVE,
            DuelError::InsufficientReserveForGraduation
        );

        let tokens_available = if winner == 0 {
            self.token_vault_a.amount()
        } else {
            self.token_vault_b.amount()
        };
        require!(tokens_available > 0, DuelError::InsufficientTokenBalance);

        let token_decimals = if winner == 0 {
            self.token_mint_a.decimals()
        } else {
            self.token_mint_b.decimals()
        };

        // Transfer tokens from winning token vault to market_token_ata
        if winner == 0 {
            self.token_program
                .transfer_checked(
                    self.token_vault_a,
                    self.token_mint_a,
                    self.market_token_ata,
                    &*self.market,
                    tokens_available,
                    token_decimals,
                )
                .invoke_signed(&seeds)?;
        } else {
            self.token_program
                .transfer_checked(
                    self.token_vault_b,
                    self.token_mint_b,
                    self.market_token_ata,
                    &*self.market,
                    tokens_available,
                    token_decimals,
                )
                .invoke_signed(&seeds)?;
        }

        // Transfer ALL quote from winning vault to market_wsol_ata
        if winner == 0 {
            self.quote_token_program
                .transfer_checked(
                    self.quote_vault_a,
                    self.quote_mint,
                    self.market_wsol_ata,
                    &*self.market,
                    sol_for_pool,
                    quote_decimals,
                )
                .invoke_signed(&seeds)?;
        } else {
            self.quote_token_program
                .transfer_checked(
                    self.quote_vault_b,
                    self.quote_mint,
                    self.market_wsol_ata,
                    &*self.market,
                    sol_for_pool,
                    quote_decimals,
                )
                .invoke_signed(&seeds)?;
        }

        // ---- Phase 4: Initialize Meteora DAMM v2 pool ----

        let sqrt_price = compute_sqrt_price_q64(sol_for_pool, tokens_available);
        let liquidity = compute_initial_liquidity(sol_for_pool, tokens_available, sqrt_price);

        let winning_token_mint_view = if winner == 0 {
            self.token_mint_a.to_account_view()
        } else {
            self.token_mint_b.to_account_view()
        };

        invoke_init_customizable_pool(
            self.market.to_account_view(),
            self.position_nft_mint.to_account_view(),
            self.position_nft_account.to_account_view(),
            self.resolver.to_account_view(),
            self.pool_authority.to_account_view(),
            self.pool.to_account_view(),
            self.position.to_account_view(),
            winning_token_mint_view,
            self.quote_mint.to_account_view(),
            self.pool_token_vault_a.to_account_view(),
            self.pool_token_vault_b.to_account_view(),
            self.market_token_ata.to_account_view(),
            self.market_wsol_ata.to_account_view(),
            self.token_program.to_account_view(),
            self.quote_token_program.to_account_view(),
            self.token_2022_program.to_account_view(),
            self.system_program.to_account_view(),
            self.event_authority.to_account_view(),
            self.meteora_program.to_account_view(),
            sqrt_price,
            liquidity,
            &seeds,
        )?;

        // ---- Phase 5: Permanently lock all liquidity ----

        invoke_permanent_lock_position(
            self.pool.to_account_view(),
            self.position.to_account_view(),
            self.position_nft_account.to_account_view(),
            self.market.to_account_view(),
            self.event_authority.to_account_view(),
            self.meteora_program.to_account_view(),
            liquidity,
            &seeds,
        )?;

        // ---- Phase 6: Update losing token metadata to "[DEFEATED]" ----

        let losing_mint_addr = if winner == 0 {
            *self.token_mint_b.to_account_view().address()
        } else {
            *self.token_mint_a.to_account_view().address()
        };

        // Validate that losing_token_metadata matches the expected PDA for the losing mint
        let (expected_metadata_pda, _) = quasar_lang::pda::based_try_find_program_address(
            &[
                b"metadata",
                TOKEN_METADATA_PROGRAM_ID.as_ref(),
                losing_mint_addr.as_ref(),
            ],
            &TOKEN_METADATA_PROGRAM_ID,
        )?;
        require!(
            *self.losing_token_metadata.address() == expected_metadata_pda,
            DuelError::InvalidMarketConfig
        );

        // Read existing metadata fields from account data
        let metadata_view = self.losing_token_metadata.to_account_view();
        let fields = read_metadata_fields(metadata_view)?;

        // Build defeated name: append " [DEFEATED]", capped at 32 chars (Metaplex limit)
        let defeated_suffix = b" [DEFEATED]";
        let max_name_len: usize = 32;
        let mut defeated_name = [0u8; 64];
        let defeated_name_len;

        if fields.name_len + defeated_suffix.len() <= max_name_len {
            // Name + suffix fits
            defeated_name[..fields.name_len].copy_from_slice(&fields.name[..fields.name_len]);
            defeated_name[fields.name_len..fields.name_len + defeated_suffix.len()]
                .copy_from_slice(defeated_suffix);
            defeated_name_len = fields.name_len + defeated_suffix.len();
        } else {
            // Truncate name to fit
            let truncated_len = max_name_len - defeated_suffix.len();
            let actual_truncate = if truncated_len > fields.name_len {
                fields.name_len
            } else {
                truncated_len
            };
            defeated_name[..actual_truncate].copy_from_slice(&fields.name[..actual_truncate]);
            defeated_name[actual_truncate..actual_truncate + defeated_suffix.len()]
                .copy_from_slice(defeated_suffix);
            defeated_name_len = actual_truncate + defeated_suffix.len();
        };

        update_metadata_v2_cpi(
            self.losing_token_metadata.to_account_view(),
            self.market.to_account_view(),
            self.token_metadata_program.to_account_view(),
            &defeated_name[..defeated_name_len],
            &fields.symbol[..fields.symbol_len],
            &fields.uri[..fields.uri_len],
            &seeds,
        )?;

        // ---- Phase 7: Update market state ----

        self.market.status = STATUS_RESOLVED;
        self.market.has_winner = 1;
        self.market.winner = winner;
        self.market.final_twap_a = PodU64::from(final_twap_a);
        self.market.final_twap_b = PodU64::from(final_twap_b);

        // ---- Phase 8: Emit event ----

        emit!(MarketResolved {
            market: market_key,
            winner: winner as u64,
            final_twap_a,
            final_twap_b,
            loser_reserve_transferred: loser_reserve,
            dex_pool: *self.pool.address(),
            sol_seeded: sol_for_pool,
            tokens_seeded: tokens_available,
        });

        Ok(())
    }
}

/// Compute sqrt_price in Q64.64 format: sqrt(sol_amount / token_amount) * 2^64
/// Uses integer-only Newton's method (deterministic, BPF-safe).
fn compute_sqrt_price_q64(sol_amount: u64, token_amount: u64) -> u128 {
    if token_amount == 0 || sol_amount == 0 {
        return 1u128 << 64; // Default to 1.0
    }

    let sol = sol_amount as u128;
    let tok = token_amount as u128;

    // Compute (sol << 64) / tok, then isqrt, then shift left by 32
    // This gives sqrt(sol/tok) * 2^64
    let scaled = sol.checked_shl(64).unwrap_or(u128::MAX) / tok;
    let sqrt_scaled = isqrt_u128(scaled);
    sqrt_scaled.checked_shl(32).unwrap_or(u128::MAX).max(1)
}

/// Integer square root via Newton's method (deterministic, BPF-safe).
fn isqrt_u128(n: u128) -> u128 {
    if n <= 1 {
        return n;
    }
    let mut x = n;
    let mut y = (x + 1) / 2;
    while y < x {
        x = y;
        y = (x + n / x) / 2;
    }
    x
}

/// Compute initial liquidity from seed amounts and sqrt_price.
/// For a full-range position: L = min(amount_a * sqrt_price / 2^64, amount_b * 2^64 / sqrt_price)
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

/// Build and invoke initialize_customizable_pool on Meteora DAMM v2 via BufCpiCall.
fn invoke_init_customizable_pool(
    market: &AccountView,
    position_nft_mint: &AccountView,
    position_nft_account: &AccountView,
    payer: &AccountView,
    pool_authority: &AccountView,
    pool: &AccountView,
    position: &AccountView,
    token_a_mint: &AccountView,
    token_b_mint: &AccountView,
    token_a_vault: &AccountView,
    token_b_vault: &AccountView,
    payer_token_a: &AccountView,
    payer_token_b: &AccountView,
    token_a_program: &AccountView,
    token_b_program: &AccountView,
    token_2022_program: &AccountView,
    system_program: &AccountView,
    event_authority: &AccountView,
    meteora_program: &AccountView,
    sqrt_price: u128,
    liquidity: u128,
    seeds: &[Seed],
) -> Result<(), ProgramError> {
    use quasar_lang::cpi::{BufCpiCall, InstructionAccount};

    // Build the instruction data buffer
    // Layout: 8-byte discriminator + serialized InitializeCustomizablePoolParameters
    let mut data = [0u8; 512];
    let mut pos = 0;

    // Discriminator (8 bytes)
    data[pos..pos + 8].copy_from_slice(&INIT_CUSTOMIZABLE_POOL_DISCRIMINATOR);
    pos += 8;

    // PoolFeeParameters:
    //   base_fee: BaseFeeParameters (30 bytes raw)
    //   dynamic_fee: Option<DynamicFeeParameters> (1 byte None tag)

    // BaseFeeParameters.data (30 bytes):
    // cliffFeeNumerator = bps * 100_000
    let cliff_fee_numerator = (GRADUATION_POOL_FEE_BPS as u64) * 100_000;
    data[pos..pos + 8].copy_from_slice(&cliff_fee_numerator.to_le_bytes());
    pos += 8;
    // firstFactor (u32) = 0
    data[pos..pos + 4].copy_from_slice(&0u32.to_le_bytes());
    pos += 4;
    // secondFactor (u64) = 0
    data[pos..pos + 8].copy_from_slice(&0u64.to_le_bytes());
    pos += 8;
    // thirdFactor (u64) = 0
    data[pos..pos + 8].copy_from_slice(&0u64.to_le_bytes());
    pos += 8;
    // baseFeeMode (u8) = 0 + padding (1 byte)
    data[pos] = 0;
    pos += 1;
    data[pos] = 0;
    pos += 1;

    // dynamic_fee: None (Option tag = 0)
    data[pos] = 0;
    pos += 1;

    // sqrt_min_price: u128 (MIN_SQRT_PRICE)
    let sqrt_min_price: u128 = 4_295_048_016;
    data[pos..pos + 16].copy_from_slice(&sqrt_min_price.to_le_bytes());
    pos += 16;

    // sqrt_max_price: u128 (MAX_SQRT_PRICE)
    let sqrt_max_price: u128 = 79_226_673_521_066_979_257_578_248_091;
    data[pos..pos + 16].copy_from_slice(&sqrt_max_price.to_le_bytes());
    pos += 16;

    // has_alpha_vault: bool (false)
    data[pos] = 0;
    pos += 1;

    // liquidity: u128
    data[pos..pos + 16].copy_from_slice(&liquidity.to_le_bytes());
    pos += 16;

    // sqrt_price: u128
    data[pos..pos + 16].copy_from_slice(&sqrt_price.to_le_bytes());
    pos += 16;

    // activation_type: u8 (0 = Slot-based)
    data[pos] = 0;
    pos += 1;

    // collect_fee_mode: u8 (0)
    data[pos] = 0;
    pos += 1;

    // activation_point: Option<u64> (None)
    data[pos] = 0;
    pos += 1;

    let call = BufCpiCall::<19, 512>::new(
        &METEORA_DAMM_V2_PROGRAM_ID,
        [
            InstructionAccount::readonly_signer(market.address()),       // 0: creator (market PDA, signer)
            InstructionAccount::writable_signer(position_nft_mint.address()), // 1: position_nft_mint (signer)
            InstructionAccount::writable(position_nft_account.address()), // 2: position_nft_account
            InstructionAccount::writable_signer(payer.address()),        // 3: payer (resolver, signer)
            InstructionAccount::readonly(pool_authority.address()),       // 4: pool_authority
            InstructionAccount::writable(pool.address()),                // 5: pool
            InstructionAccount::writable(position.address()),            // 6: position
            InstructionAccount::readonly(token_a_mint.address()),        // 7: token_a_mint
            InstructionAccount::readonly(token_b_mint.address()),        // 8: token_b_mint
            InstructionAccount::writable(token_a_vault.address()),       // 9: token_a_vault
            InstructionAccount::writable(token_b_vault.address()),       // 10: token_b_vault
            InstructionAccount::writable(payer_token_a.address()),       // 11: payer_token_a
            InstructionAccount::writable(payer_token_b.address()),       // 12: payer_token_b
            InstructionAccount::readonly(token_a_program.address()),     // 13: token_a_program
            InstructionAccount::readonly(token_b_program.address()),     // 14: token_b_program
            InstructionAccount::readonly(token_2022_program.address()),  // 15: token_2022_program
            InstructionAccount::readonly(system_program.address()),      // 16: system_program
            InstructionAccount::readonly(event_authority.address()),     // 17: event_authority
            InstructionAccount::readonly(meteora_program.address()),     // 18: program (self)
        ],
        [
            market,
            position_nft_mint,
            position_nft_account,
            payer,
            pool_authority,
            pool,
            position,
            token_a_mint,
            token_b_mint,
            token_a_vault,
            token_b_vault,
            payer_token_a,
            payer_token_b,
            token_a_program,
            token_b_program,
            token_2022_program,
            system_program,
            event_authority,
            meteora_program,
        ],
        data,
        pos,
    );

    call.invoke_signed(seeds)?;

    Ok(())
}

/// Build and invoke permanent_lock_position on Meteora DAMM v2 via BufCpiCall.
fn invoke_permanent_lock_position(
    pool: &AccountView,
    position: &AccountView,
    position_nft_account: &AccountView,
    owner: &AccountView,
    event_authority: &AccountView,
    meteora_program: &AccountView,
    permanent_lock_liquidity: u128,
    seeds: &[Seed],
) -> Result<(), ProgramError> {
    use quasar_lang::cpi::{BufCpiCall, InstructionAccount};

    // Instruction data: 8-byte discriminator + 16-byte u128 liquidity
    let mut data = [0u8; 32];
    let mut pos = 0;

    data[pos..pos + 8].copy_from_slice(&PERMANENT_LOCK_POSITION_DISCRIMINATOR);
    pos += 8;
    data[pos..pos + 16].copy_from_slice(&permanent_lock_liquidity.to_le_bytes());
    pos += 16;

    let call = BufCpiCall::<6, 32>::new(
        &METEORA_DAMM_V2_PROGRAM_ID,
        [
            InstructionAccount::writable(pool.address()),                // 0: pool (mut)
            InstructionAccount::writable(position.address()),            // 1: position (mut)
            InstructionAccount::readonly(position_nft_account.address()), // 2: position_nft_account
            InstructionAccount::readonly_signer(owner.address()),        // 3: owner (market PDA, signer)
            InstructionAccount::readonly(event_authority.address()),     // 4: event_authority
            InstructionAccount::readonly(meteora_program.address()),     // 5: program
        ],
        [
            pool,
            position,
            position_nft_account,
            owner,
            event_authority,
            meteora_program,
        ],
        data,
        pos,
    );

    call.invoke_signed(seeds)?;

    Ok(())
}

/// Read name, symbol, and URI from a Metaplex metadata account's raw data.
///
/// Metaplex metadata layout (borsh):
///   key: u8 (1 byte)
///   update_authority: Pubkey (32 bytes)
///   mint: Pubkey (32 bytes)
///   data.name: String (4-byte LE length + bytes)
///   data.symbol: String (4-byte LE length + bytes)
///   data.uri: String (4-byte LE length + bytes)
fn read_metadata_fields(account: &AccountView) -> Result<MetadataFields, ProgramError> {
    let ptr = account.data_ptr() as *const u8;
    let len = account.data_len();
    let mut offset: usize = 1 + 32 + 32; // skip key + update_authority + mint

    let mut fields = MetadataFields {
        name: [0u8; 64],
        name_len: 0,
        symbol: [0u8; 16],
        symbol_len: 0,
        uri: [0u8; 256],
        uri_len: 0,
    };

    // Read name
    if offset + 4 > len {
        return Err(ProgramError::InvalidAccountData);
    }
    let name_byte_len = unsafe {
        let mut buf = [0u8; 4];
        core::ptr::copy_nonoverlapping(ptr.add(offset), buf.as_mut_ptr(), 4);
        u32::from_le_bytes(buf) as usize
    };
    offset += 4;
    if offset + name_byte_len > len {
        return Err(ProgramError::InvalidAccountData);
    }
    // Copy name bytes, stripping null padding
    let copy_name_len = if name_byte_len > 64 { 64 } else { name_byte_len };
    unsafe {
        core::ptr::copy_nonoverlapping(ptr.add(offset), fields.name.as_mut_ptr(), copy_name_len);
    }
    // Find actual length (trim null bytes)
    fields.name_len = 0;
    for i in 0..copy_name_len {
        if fields.name[i] == 0 {
            break;
        }
        fields.name_len = i + 1;
    }
    offset += name_byte_len;

    // Read symbol
    if offset + 4 > len {
        return Err(ProgramError::InvalidAccountData);
    }
    let symbol_byte_len = unsafe {
        let mut buf = [0u8; 4];
        core::ptr::copy_nonoverlapping(ptr.add(offset), buf.as_mut_ptr(), 4);
        u32::from_le_bytes(buf) as usize
    };
    offset += 4;
    if offset + symbol_byte_len > len {
        return Err(ProgramError::InvalidAccountData);
    }
    let copy_symbol_len = if symbol_byte_len > 16 { 16 } else { symbol_byte_len };
    unsafe {
        core::ptr::copy_nonoverlapping(
            ptr.add(offset),
            fields.symbol.as_mut_ptr(),
            copy_symbol_len,
        );
    }
    fields.symbol_len = 0;
    for i in 0..copy_symbol_len {
        if fields.symbol[i] == 0 {
            break;
        }
        fields.symbol_len = i + 1;
    }
    offset += symbol_byte_len;

    // Read uri
    if offset + 4 > len {
        return Err(ProgramError::InvalidAccountData);
    }
    let uri_byte_len = unsafe {
        let mut buf = [0u8; 4];
        core::ptr::copy_nonoverlapping(ptr.add(offset), buf.as_mut_ptr(), 4);
        u32::from_le_bytes(buf) as usize
    };
    offset += 4;
    if offset + uri_byte_len > len {
        return Err(ProgramError::InvalidAccountData);
    }
    let copy_uri_len = if uri_byte_len > 256 { 256 } else { uri_byte_len };
    unsafe {
        core::ptr::copy_nonoverlapping(ptr.add(offset), fields.uri.as_mut_ptr(), copy_uri_len);
    }
    fields.uri_len = 0;
    for i in 0..copy_uri_len {
        if fields.uri[i] == 0 {
            break;
        }
        fields.uri_len = i + 1;
    }

    Ok(fields)
}

/// Build and invoke UpdateMetadataAccountV2 CPI using BufCpiCall.
fn update_metadata_v2_cpi(
    metadata: &AccountView,
    update_authority: &AccountView,
    token_metadata_program: &AccountView,
    name: &[u8],
    symbol: &[u8],
    uri: &[u8],
    seeds: &[Seed],
) -> Result<(), ProgramError> {
    use quasar_lang::cpi::{BufCpiCall, InstructionAccount};

    let mut data = [0u8; 512];
    let mut pos = 0;

    // Discriminator
    data[pos] = UPDATE_METADATA_V2_DISCRIMINATOR;
    pos += 1;

    // data: Option<DataV2> = Some(...)
    data[pos] = 1; // Some tag
    pos += 1;

    // name: String (4-byte len + bytes)
    data[pos..pos + 4].copy_from_slice(&(name.len() as u32).to_le_bytes());
    pos += 4;
    data[pos..pos + name.len()].copy_from_slice(name);
    pos += name.len();

    // symbol: String
    data[pos..pos + 4].copy_from_slice(&(symbol.len() as u32).to_le_bytes());
    pos += 4;
    data[pos..pos + symbol.len()].copy_from_slice(symbol);
    pos += symbol.len();

    // uri: String
    data[pos..pos + 4].copy_from_slice(&(uri.len() as u32).to_le_bytes());
    pos += 4;
    data[pos..pos + uri.len()].copy_from_slice(uri);
    pos += uri.len();

    // seller_fee_basis_points: u16 = 0
    data[pos..pos + 2].copy_from_slice(&0u16.to_le_bytes());
    pos += 2;

    // creators: Option<Vec<Creator>> = None
    data[pos] = 0;
    pos += 1;

    // collection: Option<Collection> = None
    data[pos] = 0;
    pos += 1;

    // uses: Option<Uses> = None
    data[pos] = 0;
    pos += 1;

    // new_update_authority: Option<Pubkey> = None
    data[pos] = 0;
    pos += 1;

    // primary_sale_happened: Option<bool> = None
    data[pos] = 0;
    pos += 1;

    // is_mutable: Option<bool> = None
    data[pos] = 0;
    pos += 1;

    let call = BufCpiCall::<3, 512>::new(
        &TOKEN_METADATA_PROGRAM_ID,
        [
            InstructionAccount::writable(metadata.address()),
            InstructionAccount::readonly_signer(update_authority.address()),
            InstructionAccount::readonly(token_metadata_program.address()),
        ],
        [metadata, update_authority, token_metadata_program],
        data,
        pos,
    );

    call.invoke_signed(seeds)?;

    Ok(())
}
