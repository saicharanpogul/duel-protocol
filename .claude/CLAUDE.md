# Duel Protocol

## Project Identity

Duel Protocol is a general-purpose on-chain primitive for community-scale competitive markets with self-contained liquidity and manipulation-resistant TWAP resolution. Built from scratch on Solana, inspired by Meteora DBC's curve architecture. Target users are fans and communities putting $5-$500 on opinions, not institutional traders. This is pump.fun meets Twitter polls meets fantasy sports, not Polymarket.

Repo: `duel-protocol` (monorepo)
License: MIT

## Tech Stack

- **Solana Program**: Rust + Anchor 0.32.1
- **SDK**: TypeScript (`@duel-protocol/sdk`)
- **Tests**: Anchor test suite (Rust integration tests + TypeScript client tests)
- **Solana CLI**: 2.1.x (Agave)
- **Token Standard**: SPL Token (Token-2022 reserved for future extensions)
- **Post-Resolution DEX Migration**: Meteora DAMM v2 via CPI
  - Program ID: `cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG`
  - Rust SDK: `@meteora-ag/cp-amm-sdk`
  - CPI examples: https://github.com/MeteoraAg/cpi-examples

## Monorepo Structure

```
duel-protocol/
├── .claude/                    # Claude project context (DO NOT gitignore)
│   ├── CLAUDE.md               # This file (primary instructions)
│   ├── ARCHITECTURE.md         # Detailed architecture and account layout
│   └── CONVENTIONS.md          # Code style, commit, and naming conventions
├── programs/
│   └── duel/                   # Core Anchor program
│       ├── src/
│       │   ├── lib.rs          # Program entrypoint and instruction dispatch
│       │   ├── state/          # Account data structures
│       │   ├── instructions/   # Instruction handlers
│       │   ├── errors.rs       # Custom error codes
│       │   ├── events.rs       # Event definitions
│       │   └── math/           # Bonding curve and TWAP math
│       └── Cargo.toml
├── sdk/                        # TypeScript SDK
│   ├── src/
│   │   ├── client.ts           # Main DuelClient class
│   │   ├── types.ts            # TypeScript types from IDL
│   │   ├── math.ts             # Client-side curve math (mirrors on-chain)
│   │   └── utils.ts            # PDA derivation, helpers
│   ├── package.json
│   └── tsconfig.json
├── tests/                      # Integration tests
│   ├── duel.ts                 # TypeScript integration tests
│   └── fixtures/               # Test fixtures and helpers
├── scripts/                    # Utility scripts (cranker, migration, etc.)
├── docs/                       # Documentation
│   └── THESIS.md               # Technical thesis
├── Anchor.toml
├── Cargo.toml                  # Workspace Cargo.toml
├── package.json                # Root package.json (workspace)
├── tsconfig.json
└── README.md
```

## Core Design Decisions (Non-Negotiable)

These decisions are finalized. Do not deviate without explicit instruction.

1. **Built from scratch.** No wrapping Meteora DBC or any external bonding curve program. The bonding curve lives inside our program. Meteora DAMM v2 is only used for post-resolution DEX graduation via CPI.

2. **Deadline enforcement at program level.** Buy and sell instructions check `Clock::get()?.unix_timestamp` against the market's deadline. After deadline, all trading is rejected. This is why we cannot use external bonding curve programs.

3. **Tokens are not burned.** Total supply is fixed at market creation. Tokens move between the pool's token reserve vault and participant wallets. Price is a function of circulating supply (tokens held by participants).

4. **Race-to-sell post-resolution.** battle_tax portion of losing reserve is dumped into the winning side's SOL reserve vault. No snapshot claims. Winners sell into a fatter curve. Early sellers get more. This is by design.

5. **TWAP resolution.** The side with the higher TWAP over the configurable observation window wins. No oracles for the base mechanism (oracle hybrid is a future extension).

6. **battle_tax is configurable per market.** Range: 0-100% (in basis points, 0-10000).

7. **Sell-side penalty activates at configurable offset before deadline.** `protection_activation_offset` parameter. Before that offset, selling is unrestricted.

## Development Workflow

### Commits

Commit after every meaningful unit of work. Use conventional commits:

```
feat(program): add market initialization instruction
feat(sdk): add DuelClient.createMarket method
fix(program): handle TWAP overflow in accumulator
test: add integration test for buy/sell lifecycle
docs: update architecture with settlement flow
refactor(program): extract curve math to separate module
```

### Building

```bash
anchor build                           # Build the program
anchor test                            # Run all tests
anchor deploy --provider.cluster devnet # Deploy to devnet
```

### Testing Priority

1. Unit tests for curve math (Rust, in math/ module)
2. Integration tests for full market lifecycle (create -> buy -> sell -> TWAP -> resolve -> sell_post_resolution)
3. Edge case tests (bank run, manipulation attempts, zero reserve, exact TWAP tie)
4. Migration tests (DAMM v2 graduation via CPI)

## Key References

- Technical Thesis: `docs/THESIS.md`
- Meteora DAMM v2 Rust SDK docs: https://docs.meteora.ag/integration/damm-v2-integration/damm-v2-sdk/damm-v2-rust-sdk
- Meteora CPI examples: https://github.com/MeteoraAg/cpi-examples
- Meteora DAMM v2 program repo: https://github.com/MeteoraAg/damm-v2
- Anchor docs: https://www.anchor-lang.com/docs
- Anchor 0.32.1 changelog: https://github.com/solana-foundation/anchor/releases

## What Claude Should Do

- Read `ARCHITECTURE.md` before touching any account structure or instruction logic.
- Read `CONVENTIONS.md` before writing any code.
- Commit after each completed instruction, module, or test file.
- Run `anchor build` after any program changes to verify compilation.
- Run `anchor test` after any instruction implementation to verify nothing broke.
- When implementing DAMM v2 migration, reference the Meteora CPI examples repo first.
- Never use em dashes in code comments, docs, or commit messages.
- Keep code comments concise. No fluff.
