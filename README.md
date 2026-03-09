# Duel Protocol

A general-purpose on-chain primitive for binary outcome markets with self-contained liquidity and manipulation-resistant TWAP resolution.

Two bonding curve tokens compete. The side with the higher time-weighted average price (TWAP) wins. A configurable portion of the losing side's reserve is transferred to the winning side. No external liquidity providers, no oracles, no market makers.

## How It Works

1. A market is created with two sides (Side A, Side B), each with its own bonding curve.
2. Participants buy and sell tokens on either curve. The bonding curve is the always-available counterparty.
3. During the final observation window, the protocol samples prices at fixed intervals.
4. At deadline, the side with the higher TWAP wins.
5. The losing side's reserve (battle_tax %) is dumped into the winning side's reserve.
6. Winners sell into a fatter curve to realize gains.

## Use Cases

- Prediction markets (yes/no outcomes with built-in liquidity)
- Governance (futarchy-style TWAP-resolved proposals)
- Content curation and creative battles
- Competitive gaming and esports sentiment markets
- Dispute resolution with economic skin in the game
- Meme token head-to-head battles

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
