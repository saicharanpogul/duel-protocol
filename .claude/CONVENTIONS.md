# Conventions

## Writing Style

- Never use em dashes. Use commas, periods, or parentheses instead.
- Keep comments concise. One line where possible.
- No fluff in docs or comments. Say what it does, not what it "aims to achieve."

## Rust / Anchor

### Naming
- Account structs: PascalCase (`Market`, `Side`, `CurveParams`)
- Instructions: snake_case (`initialize_market`, `buy_tokens`)
- Error variants: PascalCase (`MarketExpired`, `SlippageExceeded`)
- Constants: SCREAMING_SNAKE_CASE (`MAX_BATTLE_TAX_BPS`, `MIN_TWAP_INTERVAL`)
- Module files: snake_case (`bonding_curve.rs`, `twap.rs`)

### Structure
- Each instruction gets its own file in `instructions/`.
- Account validation structs live in the same file as their instruction handler.
- State structs live in `state/` with one file per major account type.
- Math functions live in `math/` with separate files for curve math, penalty math, and TWAP math.
- All constants in a single `constants.rs` file.

### Math Safety
- All arithmetic uses checked math (`checked_add`, `checked_mul`, `checked_div`).
- Intermediate calculations in u128 to prevent overflow.
- Return `DuelError::MathOverflow` on any overflow.
- Never use floating point. All basis point math uses integer division.
- Basis points: `amount * bps / 10000` (always divide last to preserve precision).

### Account Validation
- Use Anchor constraints wherever possible (`#[account(constraint = ...)]`).
- Custom validation logic in the instruction handler only when Anchor constraints are insufficient.
- Always validate PDA bumps.
- Always check account ownership.

### Error Handling
- Use `require!()` for precondition checks.
- Use `Result<()>` return types.
- Custom errors over generic Anchor errors.
- Error messages should be human readable and specific.

## TypeScript / SDK

### Naming
- Classes: PascalCase (`DuelClient`, `MarketState`)
- Methods: camelCase (`createMarket`, `buyTokens`)
- Constants: SCREAMING_SNAKE_CASE (`DUEL_PROGRAM_ID`)
- Files: camelCase (`duelClient.ts`, `curvemath.ts`)

### Patterns
- All public methods return `Promise<TransactionSignature>` or the relevant data type.
- PDA derivation functions are pure (no side effects, no network calls).
- Network calls (RPC) are separate from transaction building.
- Use `BN` from `@coral-xyz/anchor` for large number handling.

## Testing

### Naming
- Test files mirror the module they test.
- Describe blocks: feature name (`"initialize_market"`, `"buy_tokens"`)
- Test names: `it("should [expected behavior] when [condition]")`

### Coverage Requirements
- Every instruction: happy path + at least 2 error cases.
- Math module: unit tests for edge cases (zero, max values, overflow boundaries).
- Full lifecycle test: create -> buy both sides -> TWAP samples -> resolve -> sell post-resolution.
- Manipulation test: attempt last-second buy, verify TWAP resistance.

## Commits

### Format
```
type(scope): description

[optional body]
```

### Types
- `feat`: New instruction, SDK method, or feature
- `fix`: Bug fix
- `test`: Adding or updating tests
- `docs`: Documentation changes
- `refactor`: Code restructuring without behavior change
- `chore`: Build config, CI, dependencies

### Scopes
- `program`: Solana program code
- `sdk`: TypeScript SDK
- `math`: Math module (Rust or TS)
- `tests`: Test files
- `docs`: Documentation
- `ci`: CI/CD configuration

### Rules
- Commit after every completed instruction implementation.
- Commit after every completed test file.
- Commit after every meaningful refactor.
- Never commit broken builds. Run `anchor build` before committing program changes.
- Keep commits atomic. One logical change per commit.

## Dependencies

### Rust (Cargo.toml)
- `anchor-lang = "0.32.1"`
- `anchor-spl = "0.32.1"`
- `solana-program` (version matching Anchor 0.32.1 requirements)

### TypeScript (package.json)
- `@coral-xyz/anchor` (matching Anchor 0.32.1)
- `@solana/web3.js`
- `@solana/spl-token`
- `@meteora-ag/cp-amm-sdk` (for DAMM v2 graduation, SDK side)

## Security Mindset

- Assume every input is adversarial.
- Check all arithmetic for overflow before execution.
- Validate every account relationship (PDA derivation, ownership, mint authority).
- Never trust client-supplied data for critical calculations.
- Price is always derived from on-chain state (circulating supply), never from an external feed.
- TWAP accumulator uses u128, not u64.
- Sell penalty calculation must not allow negative results or underflow.
