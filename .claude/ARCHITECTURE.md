# Architecture Reference

## Market Lifecycle

```
CREATE -> ACTIVE -> TWAP_OBSERVATION -> RESOLVED -> [GRADUATED]
```

### Phase 1: CREATE
- `initialize_config` sets global admin and fee parameters (one time).
- `initialize_market` creates market + 2 sides + 2 token mints + 2 token vaults + 2 quote vaults + 2 Metaplex metadata accounts.
- Total supply minted into each side's token reserve vault.
- Quote vaults start empty.

### Phase 2: ACTIVE (creation to `deadline - twap_window`)
- `buy_tokens` and `sell_tokens` are open.
- No TWAP sampling.
- No sell penalties (unless `protection_activation_offset` exceeds `twap_window`).

### Phase 3: TWAP_OBSERVATION (`deadline - twap_window` to `deadline`)
- `buy_tokens` and `sell_tokens` still open.
- `record_twap_sample` (permissionless) can be called every `twap_interval` seconds.
- Sell penalties may activate during this phase.
- Status transitions to `TwapObservation` on first sample.

### Phase 4: RESOLVED (after `deadline`)
- `resolve_market` (permissionless TWAP), `resolve_with_oracle` (oracle), or `emergency_resolve` (draw fallback).
- Battle tax transferred from losing vault to winning vault (minus protocol + creator fees).
- `buy_tokens` and `sell_tokens` permanently disabled.
- `sell_post_resolution` enabled for all holders.

### Phase 5: GRADUATED (optional, post-resolution)
- `graduate_to_dex` creates a Meteora DAMM v2 pool via CPI.
- Residual quote reserve + remaining token reserve seed the pool.
- `claim_pool_fees` collects Meteora LP fees.
- `lock_position` / `remove_liquidity` / `close_position` manage LP.

---

## Account Layout

### ProgramConfig PDA
Seeds: `[b"config"]`

```rust
#[account]
pub struct ProgramConfig {
    pub admin: Pubkey,
    pub paused: bool,
    pub default_protocol_fee_bps: u16,
    pub protocol_fee_account: Pubkey,
    pub market_creation_fee: u64,
    pub min_market_duration: u64,
    pub bump: u8,
}
```

### Market PDA
Seeds: `[b"market", creator.key().as_ref(), &market_id.to_le_bytes()]`

```rust
#[account]
pub struct Market {
    pub authority: Pubkey,
    pub market_id: u64,
    pub side_a: Pubkey,
    pub side_b: Pubkey,
    pub quote_mint: Pubkey,
    pub deadline: i64,
    pub twap_window: u64,
    pub twap_interval: u64,
    pub battle_tax_bps: u16,
    pub protocol_fee_bps: u16,
    pub sell_penalty_max_bps: u16,
    pub protection_activation_offset: u64,
    pub curve_params: CurveParams,
    pub max_observation_change_per_update: u64,
    pub min_twap_spread_bps: u16,
    pub creator_fee_bps: u16,
    pub creator_fee_account: Pubkey,
    pub status: MarketStatus,
    pub twap_samples_count: u32,
    pub last_sample_ts: i64,
    pub winner: Option<u8>,
    pub final_twap_a: u64,
    pub final_twap_b: u64,
    pub protocol_fee_account: Pubkey,
    pub graduated_a: bool,
    pub graduated_b: bool,
    pub lp_lock_mode: LpLockMode,
    pub resolution_mode: ResolutionMode,
    pub oracle_authority: Pubkey,
    pub oracle_dispute_window: u64,
    pub emergency_window: u64,
    pub locked: bool,
    pub bump: u8,
}
```

### Side PDA
Seeds: `[b"side", market.key().as_ref(), &[side_index]]`

```rust
#[account]
pub struct Side {
    pub market: Pubkey,
    pub side_index: u8,
    pub token_mint: Pubkey,
    pub token_reserve_vault: Pubkey,
    pub quote_reserve_vault: Pubkey,
    pub total_supply: u64,
    pub circulating_supply: u64,
    pub peak_reserve: u64,
    pub twap_accumulator: u128,
    pub last_observation: u64,
    pub penalty_accumulated: u64,
    pub bump: u8,
}
```

### CurveParams

```rust
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CurveParams {
    pub a: u64,     // Steepness (scaled by 10^9)
    pub n: u8,      // Exponent (1 = linear, 2 = quadratic, 3 = cubic)
    pub b: u64,     // Base price in lamports
}
```

### Enums

```rust
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum MarketStatus {
    Active,
    TwapObservation,
    Resolved,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq)]
pub enum LpLockMode {
    Unlocked = 0,
    PermanentLock = 1,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq)]
pub enum ResolutionMode {
    Twap = 0,
    Oracle = 1,
    OracleWithTwapFallback = 2,
}
```

---

## Instructions (18 total)

### Admin
| Instruction | Signer | Description |
|---|---|---|
| `initialize_config` | admin (payer) | Create global config (one time) |
| `update_config` | admin | Update fees, pause, admin transfer |

### Market Creation
| Instruction | Signer | Description |
|---|---|---|
| `initialize_market` | creator (payer) | Create market + 2 sides + mints + vaults + metadata |

### Trading
| Instruction | Signer | Description |
|---|---|---|
| `buy_tokens` | buyer (payer) | Buy side tokens on bonding curve |
| `sell_tokens` | seller | Sell tokens pre-resolution (penalty may apply) |
| `sell_post_resolution` | seller | Sell tokens after resolution (no penalty) |

### TWAP & Resolution
| Instruction | Signer | Description |
|---|---|---|
| `record_twap_sample` | cranker (anyone) | Submit TWAP price sample |
| `resolve_market` | resolver (anyone) | Resolve via TWAP |
| `resolve_with_oracle` | oracle | Resolve via oracle authority |
| `emergency_resolve` | resolver (anyone) | Draw fallback after emergency window |

### DEX Graduation
| Instruction | Signer | Description |
|---|---|---|
| `graduate_to_dex` | authority (payer) | Create Meteora DAMM v2 pool via CPI |
| `claim_pool_fees` | authority/admin | Claim LP trading fees from Meteora |
| `lock_position` | authority/admin | Permanently lock LP position |
| `remove_liquidity` | authority/admin | Remove LP (only if Unlocked) |
| `close_position` | authority/admin | Close position NFT (only if Unlocked) |

### Cleanup
| Instruction | Signer | Description |
|---|---|---|
| `close_quote_vault` | closer | Close empty vaults, reclaim rent |
| `close_market` | authority/admin | Close market + side accounts |

---

## PDA Seeds

| Account | Seeds |
|---|---|
| Config | `[b"config"]` |
| Market | `[b"market", creator, market_id_le_bytes]` |
| Side | `[b"side", market, side_index]` |
| Mint | `[b"mint", market, side_index]` |
| Token Vault | `[b"token_vault", market, side_index]` |
| Quote Vault | `[b"quote_vault", market, side_index]` |
| Metadata | `[b"metadata", metadata_program, mint]` (Metaplex PDA) |

---

## Math Module

### Price: `price(supply, params) -> u64`
`price = a * supply^n / CURVE_SCALE + b`

### Reserve Integral: `reserve_integral(supply, params) -> u128`
`R(k) = a * k^(n+1) / ((n+1) * CURVE_SCALE) + b * k`

### Tokens Out (Buy): `tokens_out(quote_amount, supply, total_supply, params) -> u64`
Binary search: find `t` such that `R(supply + t) - R(supply) = quote_amount`

### Quote Out (Sell): `sol_out(token_amount, supply, params) -> u64`
`quote_out = R(supply) - R(supply - token_amount)`

### Sell Penalty: `sell_penalty_bps(reserve, peak, max_penalty) -> u16`
`penalty = BASE_SELL_FEE + max_penalty * (1 - reserve/peak)^2`

---

## Events

```rust
MarketCreated    { market, authority, deadline, battle_tax_bps, market_id, quote_mint }
TokensBought     { market, side, buyer, quote_amount, tokens_received, new_price }
TokensSold       { market, side, seller, token_amount, quote_received, penalty_applied, new_price }
TwapSampled      { market, price_a, price_b, observation_a, observation_b, sample_count, timestamp }
MarketResolved   { market, winner, is_draw, final_twap_a, final_twap_b, transfer_amount, protocol_fee, creator_fee, resolution_mode }
TokensGraduated  { market, side, dex_pool, sol_seeded, tokens_seeded }
ConfigUpdated    { admin, paused, default_protocol_fee_bps, market_creation_fee }
MarketClosed     { market, authority }
EmergencyResolved { market, resolver, timestamp }
```

---

## Error Codes

```rust
#[error_code]
pub enum DuelError {
    MarketExpired,               // Market has passed its deadline
    MarketNotExpired,            // Market has not reached its deadline yet
    MarketAlreadyResolved,       // Market is already resolved
    MarketNotResolved,           // Market is not resolved yet
    NotInTwapWindow,             // Not within TWAP observation window
    TwapSampleTooEarly,          // TWAP sample too early, interval not elapsed
    NoTwapSamples,               // No TWAP samples recorded
    InsufficientSolAmount,       // Insufficient SOL amount
    InsufficientTokenBalance,    // Insufficient token balance
    InsufficientReserve,         // Insufficient reserve for withdrawal
    SlippageExceeded,            // Slippage tolerance exceeded
    InvalidSide,                 // Invalid side index
    InvalidCurveParams,          // Invalid curve parameters
    InvalidMarketConfig,         // Invalid market configuration
    MathOverflow,                // Math overflow
    AlreadyGraduated,            // Side already graduated to DEX
    InsufficientReserveForGraduation, // Insufficient reserve for DEX graduation
    NotGraduated,                // Side must be graduated before vault closure
    LpLocked,                    // LP is permanently locked
    ProtocolPaused,              // Protocol is paused
    DrawResult,                  // TWAP spread below minimum threshold
    InvalidFeeConfig,            // Invalid fee configuration
    OracleNotAllowed,            // Oracle resolution not allowed
    TwapNotAllowed,              // TWAP resolution not allowed (oracle-only)
    OracleDisputeWindowActive,   // Oracle dispute window has not expired
    UnauthorizedOracle,          // Unauthorized oracle authority
    InvalidWinningSide,          // Invalid winning side (must be 0 or 1)
    ReentrancyLocked,            // Market locked (re-entrancy protection)
    EmergencyResolveTooEarly,    // Emergency resolution window not passed
}
```
