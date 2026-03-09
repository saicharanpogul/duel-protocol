# Duel Protocol — Example E2E Tester

A self-contained web UI for testing the full Duel Protocol lifecycle on localnet.

## Prerequisites

1. **Solana CLI** + **Anchor CLI** installed
2. **Phantom wallet** browser extension, set to **localhost:8899**

## Usage

1. Start the localnet validator with the program deployed:
   ```bash
   # From the repo root
   anchor build
   anchor localnet  # or: solana-test-validator --reset
   anchor deploy --provider.cluster localnet
   ```

2. Airdrop SOL to your Phantom wallet:
   ```bash
   solana airdrop 10 <YOUR_PHANTOM_PUBKEY> --url localhost
   ```

3. Serve the example app:
   ```bash
   # From the repo root
   npx -y serve .
   # Then open http://localhost:3000/example/
   ```

4. Connect Phantom and test the full lifecycle:
   - **Create Market** → sets up both sides with bonding curves
   - **Buy Side A / B** → purchase tokens using SOL
   - **Sell Side A / B** → sell tokens back for SOL
   - **Record TWAP** → crank the TWAP oracle (wait for observation window)
   - **Resolve** → determine winner after deadline
   - **Sell Post-Resolution** → winners cash out at boosted curve

## Architecture

- `index.html` — Layout with market creator, trading panels, action buttons
- `style.css` — Dark theme with Inter font, responsive grid
- `app.js` — All logic: wallet, PDAs, 7 instruction calls, auto-refresh
- No build step — uses CDN-loaded `@solana/web3.js` and `@coral-xyz/anchor`
