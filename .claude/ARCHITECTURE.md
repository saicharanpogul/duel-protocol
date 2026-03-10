# Architecture Reference

## Market Lifecycle

```
CREATE -> ACTIVE -> TWAP_OBSERVATION -> RESOLVED -> [GRADUATED]
```

### Phase 1: CREATE
- `initialize_market` is called with all config params.
- Two token mints are created (Side A, Side B).
- Total supply for each side is minted into their respective token reserve vaults.
- SOL reserve vaults start empty.
- Market status: `Active`.

### Phase 2: ACTIVE (creation to `deadline - twap_window`)
- `buy_tokens` and `sell_tokens` are open.
- No TWAP sampling.
- No sell penalties (unless `protection_activation_offset` exceeds `twap_window`).

### Phase 3: TWAP_OBSERVATION (`deadline - twap_window` to `deadline`)
- `buy_tokens` and `sell_tokens` are still open.
- `record_twap_sample` can be called every `twap_interval` seconds.
- Sell penalties may activate during this phase depending on `protection_activation_offset`.
- Status transitions to `TwapObservation` automatically on first sample or when timestamp enters window.

### Phase 4: RESOLVED (after `deadline`)
- `resolve_market` is called (permissionless, anyone can trigger).
- TWAP is finalized. Winner determined.
- `battle_tax * R_loser * (1 - protocol_fee)` SOL transferred from losing vault to winning vault.
- Protocol fee sent to protocol fee account.
- Status: `Resolved`.
- `buy_tokens` and `sell_tokens` are permanently disabled.
- `sell_post_resolution` is enabled for all holders.

### Phase 5: GRADUATED (optional, post-resolution)
- `graduate_to_dex` creates a Meteora DAMM v2 pool via CPI.
- Residual SOL reserve + remaining token reserve seed the pool.
- Only available if side has residual reserve (`battle_tax < 100%`).

---

## Account Layout

### Market PDA
Seeds: `[b"market", creator.key().as_ref(), &market_id.to_le_bytes()]`

```rust
#[account]
pub struct Market {
    pub authority: Pubkey,           // Creator
    pub market_id: u64,              // Unique ID per creator
    pub side_a: Pubkey,              // Side A PDA
    pub side_b: Pubkey,              // Side B PDA
    pub deadline: i64,               // Unix timestamp
    pub twap_window: u64,            // Seconds
    pub twap_interval: u64,          // Seconds
    pub battle_tax_bps: u16,         // 0-10000
    pub protocol_fee_bps: u16,       // 0-500
    pub sell_penalty_max_bps: u16,   // 0-3000
    pub protection_activation_offset: u64, // Seconds before deadline
    pub curve_params: CurveParams,
    pub max_observation_change_per_update: u64, // 0 = disabled (raw price TWAP)
    pub min_twap_spread_bps: u16,    // 0 = disabled (any TWAP difference resolves)
    pub status: MarketStatus,
    pub twap_samples_count: u32,
    pub last_sample_ts: i64,
    pub winner: Option<u8>,          // 0 = Side A, 1 = Side B
    pub final_twap_a: u64,           // Lamports (price * 10^9 for precision)
    pub final_twap_b: u64,
    pub protocol_fee_account: Pubkey,
    pub bump: u8,
}
```

### Side PDA
Seeds: `[b"side", market.key().as_ref(), &[side_index]]`

```rust
#[account]
pub struct Side {
    pub market: Pubkey,
    pub side_index: u8,              // 0 = A, 1 = B
    pub token_mint: Pubkey,
    pub token_reserve_vault: Pubkey, // Holds unsold/returned tokens
    pub sol_reserve_vault: Pubkey,   // Holds SOL from buys
    pub total_supply: u64,           // Fixed at creation
    pub circulating_supply: u64,     // Tokens held by participants
    pub peak_reserve: u64,           // Historical max SOL reserve (for sell penalty calc)
    pub twap_accumulator: u128,      // Sum of price samples (or lagging observations)
    pub last_observation: u64,       // Last observation value (for lagging TWAP, 0 if disabled)
    pub bump: u8,
}
```

### CurveParams

```rust
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CurveParams {
    pub a: u64,     // Steepness (scaled by 10^9)
    pub n: u8,      // Exponent (1 = linear, 2 = quadratic)
    pub b: u64,     // Base price in lamports
}
```

### MarketStatus

```rust
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum MarketStatus {
    Active,
    TwapObservation,
    Resolved,
}
```

---

## Instruction Specs

### initialize_market

**Signers**: creator (payer)
**Accounts**: market (init PDA), side_a (init PDA), side_b (init PDA), token_mint_a (init), token_mint_b (init), token_vault_a (init ATA), token_vault_b (init ATA), sol_vault_a (init PDA), sol_vault_b (init PDA), protocol_fee_account, system_program, token_program, rent

**Params**:
```rust
pub struct InitializeMarket {
    pub market_id: u64,
    pub deadline: i64,
    pub twap_window: u64,
    pub twap_interval: u64,
    pub battle_tax_bps: u16,
    pub protocol_fee_bps: u16,
    pub sell_penalty_max_bps: u16,
    pub protection_activation_offset: u64,
    pub curve_params: CurveParams,
    pub total_supply_per_side: u64,
}
```

**Validation**:
- `deadline > Clock::get()?.unix_timestamp`
- `twap_window > 0 && twap_window < (deadline - now)`
- `twap_interval >= 10 && twap_interval <= 300`
- `battle_tax_bps <= 10000`
- `protocol_fee_bps <= 500`
- `sell_penalty_max_bps <= 3000`
- `protection_activation_offset <= (deadline - now)`
- `curve_params.a > 0`
- `curve_params.n >= 1 && curve_params.n <= 3`
- `curve_params.b > 0`
- `total_supply_per_side > 0`

**Actions**:
1. Create market PDA.
2. Create both side PDAs.
3. Create token mints (program is mint authority).
4. Mint `total_supply_per_side` tokens into each side's token reserve vault.
5. Initialize all state fields.

### buy_tokens

**Signers**: buyer (payer)
**Params**: `side: u8, sol_amount: u64, min_tokens_out: u64`

**Validation**:
- Market status != Resolved
- `Clock::get()?.unix_timestamp < deadline`
- `sol_amount > 0`
- Slippage check: `tokens_out >= min_tokens_out`

**Actions**:
1. Calculate tokens out from curve math given current circulating supply and SOL amount.
2. Transfer SOL from buyer to side's SOL reserve vault.
3. Transfer tokens from side's token reserve vault to buyer.
4. Update `circulating_supply`.
5. Update `peak_reserve` if new reserve exceeds previous peak.
6. Emit BuyEvent.

### sell_tokens

**Signers**: seller
**Params**: `side: u8, token_amount: u64, min_sol_out: u64`

**Validation**:
- Market status != Resolved
- `Clock::get()?.unix_timestamp < deadline`
- `token_amount > 0`
- Seller has sufficient token balance
- Slippage check after penalty: `sol_out_after_penalty >= min_sol_out`

**Actions**:
1. Calculate SOL out from curve math given current circulating supply and token amount.
2. Apply sell penalty if within protection window: `penalty = base_fee + max_penalty * (1 - r/r_peak)^2`
3. `sol_out_after_penalty = sol_out * (1 - penalty_rate)`
4. Transfer tokens from seller to side's token reserve vault.
5. Transfer SOL (after penalty) from side's SOL reserve vault to seller.
6. Penalty SOL stays in the reserve (it is not extracted, it remains as locked reserve).
7. Update `circulating_supply`.
8. Emit SellEvent.

### record_twap_sample

**Signers**: cranker (anyone, permissionless)
**Params**: none

**Validation**:
- Timestamp is within TWAP observation window: `now >= deadline - twap_window && now <= deadline`
- At least `twap_interval` seconds since `last_sample_ts`

**Actions**:
1. Calculate current spot price for both sides from curve math.
2. If `max_observation_change_per_update > 0` (lagging TWAP enabled):
   a. Clamp each side's observation toward spot price by at most `max_observation_change_per_update`.
   b. Update `last_observation` for each side.
   c. Add observation values (not raw prices) to respective `twap_accumulator`.
3. If `max_observation_change_per_update == 0` (standard TWAP):
   a. Add raw spot prices to respective `twap_accumulator`.
4. Increment `twap_samples_count`.
5. Update `last_sample_ts`.
6. If market status is `Active`, transition to `TwapObservation`.
7. Emit TwapSampleEvent.

### resolve_market

**Signers**: resolver (anyone, permissionless)
**Params**: none

**Validation**:
- `Clock::get()?.unix_timestamp >= deadline`
- Market status != Resolved
- `twap_samples_count > 0`

**Actions**:
1. Calculate `final_twap_a = side_a.twap_accumulator / twap_samples_count`.
2. Calculate `final_twap_b = side_b.twap_accumulator / twap_samples_count`.
3. If `min_twap_spread_bps > 0`: check that the winning TWAP exceeds the losing TWAP by at least `min_twap_spread_bps`. If neither side meets the threshold, resolve as a draw (no reserve transfer, both sides retain their reserves, minus protocol fee on both).
4. Determine winner (higher TWAP wins; if tie, higher reserve wins).
5. Calculate transfer: `transfer_amount = losing_side.sol_reserve * battle_tax_bps / 10000`.
6. Calculate fee: `fee = transfer_amount * protocol_fee_bps / 10000`.
7. Transfer `transfer_amount - fee` SOL from losing vault to winning vault.
8. Transfer `fee` SOL from losing vault to protocol fee account.
9. Update market status to `Resolved`.
10. Set `winner` (or `None` for draw).
11. Emit ResolveEvent.

### sell_post_resolution

**Signers**: seller
**Params**: `side: u8, token_amount: u64, min_sol_out: u64`

**Validation**:
- Market status == Resolved
- `token_amount > 0`
- Seller has sufficient balance
- Side has sufficient SOL reserve
- Slippage check: `sol_out >= min_sol_out`

**Actions**:
1. Calculate SOL out from curve math (no sell penalty post-resolution).
2. Transfer tokens from seller to side's token reserve vault.
3. Transfer SOL from side's SOL reserve vault to seller.
4. Update `circulating_supply`.
5. Emit SellPostResolutionEvent.

### graduate_to_dex

**Signers**: authority (market creator) or permissionless (configurable)
**Params**: `side: u8`

**Validation**:
- Market status == Resolved
- Side has residual SOL reserve > minimum threshold
- Side has tokens remaining in reserve vault
- Not already graduated

**Actions**:
1. Create Meteora DAMM v2 pool via CPI using `initialize_customizable_pool`.
2. Transfer residual SOL reserve to the new pool as quote token liquidity.
3. Transfer remaining token reserve to the new pool as base token liquidity.
4. Lock LP position (permanent lock or vesting based on config).
5. Emit GraduateEvent.

---

## Math Module

### Price Calculation

```rust
// Price at given circulating supply
pub fn price(supply: u64, params: &CurveParams) -> u64 {
    // price = a * supply^n + b
    // All math in u128 to prevent overflow
    // Result in lamports
}
```

### Tokens Out (Buy)

```rust
// Given SOL amount, calculate tokens received
pub fn tokens_out(sol_amount: u64, current_supply: u64, params: &CurveParams) -> u64 {
    // Solve: R(supply + tokens) - R(supply) = sol_amount
    // R(k) = a * k^(n+1) / (n+1) + b * k
    // Use binary search or analytical inverse for integer math
}
```

### SOL Out (Sell)

```rust
// Given token amount, calculate SOL received
pub fn sol_out(token_amount: u64, current_supply: u64, params: &CurveParams) -> u64 {
    // sol = R(supply) - R(supply - token_amount)
    // Direct calculation from reserve integral
}
```

### Sell Penalty

```rust
// Calculate sell penalty rate (in basis points)
pub fn sell_penalty_bps(
    current_reserve: u64,
    peak_reserve: u64,
    max_penalty_bps: u16,
    base_fee_bps: u16,
) -> u16 {
    // penalty = base_fee + max_penalty * (1 - r/r_peak)^2
    // Returns basis points
}
```

---

## Events

```rust
#[event]
pub struct MarketCreated {
    pub market: Pubkey,
    pub authority: Pubkey,
    pub deadline: i64,
    pub battle_tax_bps: u16,
}

#[event]
pub struct TokensBought {
    pub market: Pubkey,
    pub side: u8,
    pub buyer: Pubkey,
    pub sol_amount: u64,
    pub tokens_received: u64,
    pub new_price: u64,
}

#[event]
pub struct TokensSold {
    pub market: Pubkey,
    pub side: u8,
    pub seller: Pubkey,
    pub token_amount: u64,
    pub sol_received: u64,
    pub penalty_applied: u64,
    pub new_price: u64,
}

#[event]
pub struct TwapSampled {
    pub market: Pubkey,
    pub price_a: u64,
    pub price_b: u64,
    pub sample_count: u32,
    pub timestamp: i64,
}

#[event]
pub struct MarketResolved {
    pub market: Pubkey,
    pub winner: u8,
    pub final_twap_a: u64,
    pub final_twap_b: u64,
    pub transfer_amount: u64,
    pub protocol_fee: u64,
}

#[event]
pub struct TokensGraduated {
    pub market: Pubkey,
    pub side: u8,
    pub dex_pool: Pubkey,
    pub sol_seeded: u64,
    pub tokens_seeded: u64,
}
```

---

## Error Codes

```rust
#[error_code]
pub enum DuelError {
    #[msg("Market has passed its deadline")]
    MarketExpired,
    #[msg("Market has not reached its deadline yet")]
    MarketNotExpired,
    #[msg("Market is already resolved")]
    MarketAlreadyResolved,
    #[msg("Market is not resolved yet")]
    MarketNotResolved,
    #[msg("Not within TWAP observation window")]
    NotInTwapWindow,
    #[msg("TWAP sample too early, interval not elapsed")]
    TwapSampleTooEarly,
    #[msg("No TWAP samples recorded")]
    NoTwapSamples,
    #[msg("Insufficient SOL amount")]
    InsufficientSolAmount,
    #[msg("Insufficient token balance")]
    InsufficientTokenBalance,
    #[msg("Insufficient reserve for withdrawal")]
    InsufficientReserve,
    #[msg("Slippage tolerance exceeded")]
    SlippageExceeded,
    #[msg("Invalid side index")]
    InvalidSide,
    #[msg("Invalid curve parameters")]
    InvalidCurveParams,
    #[msg("Invalid market configuration")]
    InvalidMarketConfig,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Side already graduated to DEX")]
    AlreadyGraduated,
    #[msg("Insufficient reserve for DEX graduation")]
    InsufficientReserveForGraduation,
}
```
