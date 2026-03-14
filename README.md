# Duel Protocol

A general-purpose on-chain primitive for community-scale competitive markets with self-contained liquidity and manipulation-resistant TWAP resolution.

Two bonding curve tokens compete. The side with the higher time-weighted average price (TWAP) wins. A configurable portion of the losing side's reserve is transferred to the winning side. No external liquidity providers, no oracles (by default), no market makers. This is pump.fun meets Twitter polls meets fantasy sports.

## What This Is

A gamified engagement primitive where communities put skin in the game on opinions, debates, and competitions. The target user is a fan putting $5 to $500 on their side. The bonding curve is the market maker. The TWAP is the judge.

## What This Is Not

A prediction market for sophisticated traders. Duel does not produce calibrated probability signals, does not offer fixed payouts, and does not compete with Polymarket. See the [Technical Thesis](docs/THESIS.md) for honest limitations.

## How It Works

1. A market is created with two sides (Side A, Side B), each with its own bonding curve.
2. Participants buy and sell tokens on either curve. The bonding curve is the always-available counterparty.
3. During the final observation window, the protocol samples prices at fixed intervals.
4. At deadline, the side with the higher TWAP wins.
5. The losing side's reserve (battle_tax %) is dumped into the winning side's reserve.
6. Winners sell into a fatter curve to realize gains.
7. Winning tokens can graduate to Meteora DAMM v2 for continued DEX trading (Jupiter-compatible).

## Architecture

Built from scratch on Solana using Anchor 0.32.1. Post-resolution tokens graduate to Meteora DAMM v2 via CPI, making them immediately tradeable on Jupiter.

See [Technical Thesis](docs/THESIS.md) for full mechanism design.
See [Architecture Reference](.claude/ARCHITECTURE.md) for account layouts and instruction specs.

## Instructions (18)

| Category | Instructions |
|---|---|
| Admin | `initialize_config`, `update_config` |
| Market | `initialize_market` |
| Trading | `buy_tokens`, `sell_tokens`, `sell_post_resolution` |
| TWAP & Resolution | `record_twap_sample`, `resolve_market`, `resolve_with_oracle`, `emergency_resolve` |
| DEX Graduation | `graduate_to_dex`, `claim_pool_fees`, `lock_position`, `remove_liquidity`, `close_position` |
| Cleanup | `close_quote_vault`, `close_market` |

## Project Structure

```
programs/duel/     Anchor program (Rust) - 18 instructions, 22 error codes
sdk/               TypeScript SDK - 18 builders, 5 math helpers, event indexer
tests/             Integration tests - 85 tests across 8 suites
scripts/           Cranker daemon for TWAP sampling and resolution
app/               duels.fun frontend (Next.js)
example/           Developer reference app (Next.js)
docs/              Documentation and thesis
```

## SDK

```typescript
import {
  createDuelProgram,
  buildBuyTokensInstruction,
  buildResolveMarketInstruction,
  calculateTokensOut,
  calculateSentiment,
} from "@duel-protocol/sdk";
```

**18 instruction builders** covering the full lifecycle: config, market creation, trading, TWAP, resolution, graduation, LP management, and cleanup.

**5 math helpers** mirroring on-chain bonding curve: `calculateReserve`, `calculateTokensOut`, `calculateQuoteOut`, `calculateSentiment`, `calculateSellPenalty`.

**Event indexer** with real-time WebSocket subscription and historical backfill.

## Development

```bash
# Install dependencies
yarn install

# Build the program
anchor build

# Run all tests (85 tests)
anchor test

# Run tests without rebuilding
anchor test --skip-build

# Start TWAP cranker
RPC_URL=http://localhost:8899 npx ts-node scripts/cranker.ts
```

## Test Suites

| Suite | Tests | Coverage |
|---|---|---|
| Core lifecycle | 12 | Create, buy, sell, TWAP, resolve, sell post-resolution |
| Edge cases | 11 | Invalid inputs, slippage, double resolve, zero amounts |
| Capital efficiency | 11 | Bonding curve math, penalty timing, TWAP accuracy |
| DEX graduation | 7 | Meteora CPI, LP fees, double graduation prevention |
| Close market | 3 | Rejection gates, rent recovery |
| Protocol config | 8 | Pause/unpause, fee updates, admin transfer |
| TWAP advanced | 4 | Draw detection, creator fees, observation clamping |
| Game theory | 29 | Nash equilibrium, last-mover advantage, multi-market isolation |

## Use Cases

- Subjective debates (Messi vs Ronaldo, Vim vs Emacs)
- Creative battles (musicians, artists competing for fan support)
- Token launches via competition (battle as launch narrative, survivors graduate to DEX)
- Small DAO governance (50-person DAOs)
- Community-driven prediction
- Meme token head-to-head battles
- Competitive gaming and esports sentiment markets

## Status

Core protocol complete. 85/85 tests passing. SDK complete. Not audited. Do not use in production.

## License

MIT
