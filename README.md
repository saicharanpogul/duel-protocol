# Duel Protocol

Two tokens enter. One survives. The winner graduates to DEX.

A competitive memecoin launch primitive on Solana where conflict IS the distribution mechanism. Both communities spend real SOL backing their side. At resolution, the winner takes all liquidity and graduates to Jupiter via Meteora DAMM v2. The loser dies.

## How It Works

1. A duel is created with two sides (Side A vs Side B), each with a bonding curve token
2. Users buy and sell tokens on either side. Bonding curve is the market maker. No LPs needed.
3. During the TWAP observation window, prices are sampled at fixed intervals
4. At deadline, the side with the higher time-weighted average price wins
5. 100% of the loser's SOL reserve is transferred to the winner
6. Winner's token graduates to Meteora DAMM v2 (Jupiter-tradable). LP permanently locked.
7. Loser's token metadata is updated to [DEFEATED]

## Architecture

| Component | Stack | Description |
|---|---|---|
| Program (Anchor) | Rust, Anchor 0.31.1 | 12 instructions, bonding curve, TWAP resolution |
| Program (Quasar) | Rust, Quasar | Same logic, 11x smaller binary, 11x cheaper deploy |
| SDK | TypeScript | Instruction builders, math helpers, event indexer |
| Frontend | Next.js 16, React 19 | Trading UI with bonding curve charts |
| Backend | Hono, PostgreSQL | REST API, event indexer, TWAP cranker |
| Cranker | TypeScript | Permissionless TWAP sampling and resolution |

## Anchor vs Quasar Comparison

The protocol is implemented in both [Anchor](https://www.anchor-lang.com/) and [Quasar](https://quasar-lang.com/) for direct comparison. Same logic, same instructions, same state layout.

### Binary Size & Deploy Cost

| Metric | Anchor | Quasar | Improvement |
|---|---|---|---|
| Binary size | 654,912 bytes (639.6 KB) | 59,600 bytes (58.2 KB) | **11x smaller** |
| Deploy cost | 4.559 SOL (~$684) | 0.416 SOL (~$63) | **11x cheaper** |

*Deploy cost = rent-exempt minimum for program account. SOL price estimated at $150.*

### Why Quasar is Smaller

Quasar programs are `#![no_std]` with zero-copy account handling. Accounts are pointer-cast directly from the SVM input buffer with no deserialization, no heap allocation, and no copies. This eliminates the Borsh serialization overhead and Anchor runtime that inflate binary size.

### Key Differences

| Feature | Anchor | Quasar |
|---|---|---|
| Account deserialization | Borsh (copy + allocate) | Zero-copy (pointer cast) |
| Runtime overhead | ~180KB base | ~0KB base |
| `no_std` | No | Yes (default) |
| Account types | `Pubkey` | `Address` |
| Integer fields | Native types | Pod types (`.get()` / `PodU64::from()`) |
| Enums in accounts | Supported | Use `u8` constants |
| CPI pattern | `CpiContext::new(...)` | `.transfer().invoke()` |
| Discriminators | Auto (8-byte SHA256) | Explicit (`discriminator = N`) |
| Context type | `Context<T>` | `Ctx<T>` |
| Return type | `Result<()>` | `Result<(), ProgramError>` |
| String/Vec in accounts | Heap-allocated | `String<'a, N>` / `Vec<'a, T, N>` (inline) |

### pTokens (SIMD-0266) Optimizations

The `ptokens` branch adds optimizations enabled by Solana's pToken standard:

- **Dense TWAP sampling**: MIN_TWAP_INTERVAL reduced from 10s to 1s (viable with cheaper pToken transactions)
- **Trimmed-mean TWAP**: 360-slot ring buffer with 5% outlier rejection from each tail, more manipulation-resistant than simple accumulator-based TWAP
- **Batch CPI preparation**: Feature-gated blocks for future batch token operations when pTokens launches on mainnet

## Instructions (12)

| Category | Instructions |
|---|---|
| Admin | `initialize_config`, `update_config` |
| Market | `initialize_market` |
| Trading | `buy_tokens`, `sell_tokens` |
| TWAP & Resolution | `record_twap_sample`, `resolve_and_graduate`, `emergency_resolve` |
| Post-Resolution | `sell_post_resolution` (emergency draw only) |
| DEX | `claim_pool_fees` |
| Cleanup | `close_quote_vault`, `close_market` |

## Economics

- **1B tokens per side**, 0 decimals, quadratic bonding curve (`price = k^2 / 10^9 + 1`)
- **1% trade fee** on every buy and sell, split 50/50 between protocol and market creator
- **Winner takes all**: 100% of loser's SOL reserve transferred to winner at resolution
- **LP permanently locked** on Meteora DAMM v2 after graduation
- **Creator incentive**: 50% of trade fees + 75% of post-graduation LP fees

## Project Structure

```
programs/duel/              Anchor program (Rust) - 12 instructions
programs/duel-quasar/       Quasar program (Rust) - same 12 instructions, 11x smaller
sdk/                        TypeScript SDK - instruction builders, math, indexer
tests/                      Integration tests - 74 tests across 8 suites
scripts/                    Cranker daemon + curve simulator
app/                        duels.fun frontend (Next.js)
backend/                    REST API, event indexer, cranker (Docker)
docs/                       Technical thesis
```

## Development

```bash
# Install dependencies
bun install

# Build Anchor program
anchor build

# Build Quasar program
cd programs/duel-quasar && quasar build

# Run tests (74 passing)
anchor test

# Start frontend
cd app && npm run dev

# Start cranker
ANCHOR_PROVIDER_URL=http://localhost:8899 bun run scripts/cranker.ts
```

## Test Suites (74 tests)

| Suite | Description |
|---|---|
| Core lifecycle | Create, buy, sell, TWAP, resolve + graduate |
| Edge cases | Invalid inputs, slippage, double resolve, wrong winner |
| Capital efficiency | Trade fees, roundtrip, multi-buyer, winner takes all |
| DEX graduation | Meteora DAMM v2 E2E, LP lock, fee claims |
| Protocol config | Pause, fee updates, admin transfer |
| Close market | Closure gates, rent recovery |
| Emergency | Emergency resolve rejection |

## Status

Core protocol complete. 74/74 tests passing. Anchor + Quasar implementations. SDK complete. Not audited.

## License

MIT
