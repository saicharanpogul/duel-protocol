# Duel Protocol

A general-purpose on-chain primitive for community-scale competitive markets with self-contained liquidity and manipulation-resistant TWAP resolution.

Two bonding curve tokens compete. The side with the higher time-weighted average price (TWAP) wins. A configurable portion of the losing side's reserve is transferred to the winning side. No external liquidity providers, no oracles, no market makers. This is pump.fun meets Twitter polls meets fantasy sports.

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

## Use Cases

- Subjective debates (Messi vs Ronaldo, Vim vs Emacs)
- Creative battles (musicians, artists, content creators competing for fan support)
- Token launches via competition (battle as launch narrative, survivors graduate to DEX)
- Small DAO governance (50-person DAOs that can't afford Polymarket infrastructure)
- Community-driven prediction (is this project legit?)
- Meme token head-to-head battles
- Competitive gaming and esports sentiment markets

## Architecture

Built from scratch on Solana using Anchor 0.32.1. Post-resolution tokens can optionally graduate to Meteora DAMM v2 for continued DEX trading.

See [Technical Thesis](docs/THESIS.md) for full mechanism design.

## Project Structure

```
programs/duel/     Anchor program (Rust)
sdk/               TypeScript SDK
tests/             Integration tests
scripts/           Utility scripts
docs/              Documentation and thesis
.claude/           Project context for AI-assisted development
```

## Development

```bash
# Install dependencies
yarn install

# Build the program
anchor build

# Run tests
anchor test

# Deploy to devnet
anchor deploy --provider.cluster devnet
```

## Status

Work in progress. Not audited. Do not use in production.

## License

MIT
