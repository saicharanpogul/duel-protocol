use quasar_lang::prelude::*;
use quasar_lang::sysvars::Sysvar as SysvarTrait;

use crate::constants::*;
use crate::errors::DuelError;
use crate::events::MarketCreated;
use crate::state::*;

/// InitializeMarket creates the market and side PDAs, then initializes their state.
///
/// Quasar's derive(Accounts) cannot use instruction args in seed expressions for
/// the generated Bumps::_seeds() method. Because the market PDA seeds include
/// `market_id` (an instruction arg), the market and side accounts must be created
/// via manual system_program CPI with PDA signing. The accounts are passed as
/// mutable UncheckedAccounts and validated/initialized in the handler.
///
/// TODO: Token mint/vault/metadata creation requires additional accounts and CPI:
/// 1. Create token mints (mint_a, mint_b) via token program CPI
/// 2. Create token vaults (token_vault_a, token_vault_b) via token program CPI
/// 3. Create quote vaults (quote_vault_a, quote_vault_b) via token program CPI
/// 4. Mint total supply to token vaults
/// 5. Create Metaplex metadata for each side
#[derive(Accounts)]
pub struct InitializeMarket<'info> {
    pub creator: &'info mut Signer,

    /// Market account (PDA: [b"market", creator, &market_id.to_le_bytes()])
    /// Must be uninitialized. Created via system program CPI in handler.
    pub market: &'info mut UncheckedAccount,

    /// Side A account (PDA: [b"side", market, &[0u8]])
    /// Must be uninitialized. Created via system program CPI in handler.
    pub side_a: &'info mut UncheckedAccount,

    /// Side B account (PDA: [b"side", market, &[1u8]])
    /// Must be uninitialized. Created via system program CPI in handler.
    pub side_b: &'info mut UncheckedAccount,

    /// Quote token mint (WSOL)
    pub quote_mint: &'info UncheckedAccount,

    /// Protocol fee recipient, validated against config
    pub protocol_fee_account: &'info UncheckedAccount,

    /// Creator fee recipient
    pub creator_fee_account: &'info UncheckedAccount,

    /// Protocol config (pause check + market creation fee)
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: &'info Account<ProgramConfig>,

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
        _bumps: &InitializeMarketBumps,
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

        // Validate protocol fee account matches config
        require!(
            *self.protocol_fee_account.address() == self.config.protocol_fee_account,
            DuelError::InvalidFeeConfig
        );

        // Validate creator fee account is not default
        require!(
            *self.creator_fee_account.address() != Address::default(),
            DuelError::InvalidFeeConfig
        );

        // TODO: Create market PDA account via system_program.create_account CPI
        // Seeds: [b"market", creator.address(), &market_id.to_le_bytes()]
        // Space: size_of::<Market>() + 8 (discriminator)
        //
        // TODO: Create side A PDA account via system_program.create_account CPI
        // Seeds: [b"side", market.address(), &[0u8]]
        // Space: size_of::<Side>() + 8 (discriminator)
        //
        // TODO: Create side B PDA account via system_program.create_account CPI
        // Seeds: [b"side", market.address(), &[1u8]]
        // Space: size_of::<Side>() + 8 (discriminator)
        //
        // TODO: Initialize market state fields (version, bump, authority, market_id,
        //       side_a, side_b, quote_mint, deadline, twap_window, twap_interval,
        //       creator_fee_account, protocol_fee_account, status, etc.)
        //
        // TODO: Initialize side A and side B state fields (market, side_index,
        //       token_mint, token_reserve_vault, quote_reserve_vault, total_supply,
        //       circulating_supply, twap_accumulator, bump, etc.)
        //
        // TODO: Create token mints, token vaults, quote vaults via token program CPI
        // TODO: Mint TOTAL_SUPPLY_PER_SIDE tokens to each token vault
        // TODO: Create Metaplex metadata for each side token
        //
        // TODO: Charge market creation fee if configured:
        //   if self.config.market_creation_fee.get() > 0 {
        //       system_program.transfer(creator, protocol_fee_account, fee).invoke()?;
        //   }

        let market_addr = *self.market.address();

        emit!(MarketCreated {
            market: market_addr,
            authority: *self.creator.address(),
            deadline,
            market_id,
            quote_mint: *self.quote_mint.address(),
        });

        Ok(())
    }
}
