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

### Anchor + SPL Token vs Quasar + pTokens

| Metric | Anchor + SPL Token | Quasar + pTokens | Improvement |
|---|---|---|---|
| **Binary size** | 654,912 bytes (639.6 KB) | 59,600 bytes (58.2 KB) | **11x smaller** |
| **Deploy cost** | 4.559 SOL (~$410) | 0.416 SOL (~$37) | **11x cheaper** |
| **Account deserialization** | Borsh (copy + heap allocate) | Zero-copy (pointer cast, no alloc) | **0 allocations** |
| **Runtime overhead** | ~180 KB base binary | ~0 KB base binary | **No bloat** |
| **Discriminators** | 8-byte SHA256 (auto) | 1-byte explicit | **8x less instruction data** |
| **TWAP min interval** | 10 seconds | 1 second (pTokens) | **10x denser sampling** |
| **TWAP resolution** | Simple accumulator mean | Trimmed mean (5% outlier rejection) | **More manipulation resistant** |
| **TWAP storage** | Single u128 accumulator | 360-slot ring buffer | **Granular price history** |
| **Token operations** | Individual SPL CPI per transfer | Batch CPI ready (pTokens) | **Fewer transactions** |
| **`no_std`** | No | Yes (default) | **No heap, no std** |

*Deploy cost = rent-exempt minimum for program account. SOL price estimated at ~$90.*

### What Each Optimization Brings

**Quasar** (program framework):
- `#![no_std]` zero-copy accounts: pointer-cast directly from the SVM input buffer, no deserialization, no heap allocation. This is why the binary is 11x smaller.
- Pod types for account fields (`.get()` to read, `PodU64::from()` to write)
- Method-style CPI: `.transfer().invoke()` instead of `CpiContext::new(...)`
- Explicit 1-byte discriminators instead of 8-byte SHA256 hashes

**pTokens (SIMD-0266)** (token standard):
- **Dense TWAP sampling**: With pTokens' cheaper transaction costs, TWAP can sample every 1 second instead of every 10 seconds. 720 samples in a 12-minute window vs 72. Makes last-second manipulation 10x harder.
- **Trimmed-mean TWAP**: 360-slot ring buffer stores individual price samples. At resolution, the top 5% and bottom 5% are discarded before averaging. A whale spiking the price for 30 seconds affects 0 samples instead of skewing the mean.
- **Batch CPI**: Feature-gated preparation for batching multiple token transfers in a single CPI call when pTokens launches on mainnet, reducing per-trade compute.

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
