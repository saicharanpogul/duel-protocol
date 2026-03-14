# Devnet Deployment Guide

## Prerequisites

```bash
# Solana CLI (2.1.x Agave)
solana --version

# Anchor CLI (0.32.1)
anchor --version

# Set cluster to devnet
solana config set --url https://api.devnet.solana.com
```

## 1. Fund Your Wallet

```bash
# Check your wallet address
solana address

# Airdrop devnet SOL (2 SOL per request, may need multiple)
solana airdrop 2
solana airdrop 2
```

## 2. Build and Deploy

```bash
# Build the program
anchor build

# Deploy to devnet
anchor deploy --provider.cluster devnet

# Verify deployment
solana program show CgR6V1AxC7exDFNoh3Q5JP9aea9YuPqq283EwACUGpZE
```

## 3. Initialize Config

The protocol requires a one-time config initialization before any markets can be created.

```bash
# Run the initialization script (or via SDK)
npx ts-node -e "
const { Connection, Keypair, PublicKey } = require('@solana/web3.js');
const { AnchorProvider, Program, Wallet, BN } = require('@coral-xyz/anchor');
const { readFileSync } = require('fs');
const IDL = require('./sdk/idl/duel.json');

async function main() {
  const keypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(
      require('os').homedir() + '/.config/solana/id.json', 'utf-8'
    )))
  );
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  const provider = new AnchorProvider(connection, new Wallet(keypair), {});
  const program = new Program(IDL, provider);

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('config')], program.programId
  );

  const tx = await program.methods
    .initializeConfig(125, new BN(0))  // 1.25% default fee, free market creation
    .accounts({
      admin: keypair.publicKey,
      config: configPda,
      protocolFeeAccount: keypair.publicKey,  // protocol fees go to admin for now
      systemProgram: require('@solana/web3.js').SystemProgram.programId,
    })
    .rpc();

  console.log('Config initialized:', tx);
  console.log('Config PDA:', configPda.toBase58());
}
main();
"
```

## 4. Create a Test Market

```bash
# Use the example app or write a script using the SDK:
# buildInitializeMarketInstruction(program, creator, marketId, params)
#
# Key params for a quick test market:
#   deadline: now + 120 seconds (2 minutes)
#   twapWindow: 60 seconds
#   twapInterval: 10 seconds
#   battleTaxBps: 5000 (50%)
#   totalSupplyPerSide: 1_000_000 (1M tokens, 6 decimals)
#   curveParams: { a: 1_000_000, n: 1, b: 1_000 }
```

## 5. Start the Cranker

```bash
# Fund a cranker keypair (can be same as deployer)
RPC_URL=https://api.devnet.solana.com npx ts-node scripts/cranker.ts
```

The cranker will:
- Poll every 5 seconds for active markets
- Submit TWAP samples when the interval elapses
- Resolve markets once past deadline with sufficient samples

## 6. Interact via SDK

```typescript
import { createDuelProgram, buildBuyTokensInstruction } from "@duel-protocol/sdk";

// Buy tokens on Side A
const { preInstructions, instruction } = await buildBuyTokensInstruction(
  program, marketPubkey, 0, new BN(1_000_000_000), new BN(0), buyerPubkey
);
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `RPC_URL` | `http://localhost:8899` | Solana RPC endpoint |
| `CRANKER_KEYPAIR` | `~/.config/solana/id.json` | Cranker wallet keypair |
| `POLL_INTERVAL_MS` | `5000` | Cranker poll interval |
| `DRY_RUN` | `false` | Log actions without sending txs |

## Troubleshooting

**"Account not found"** — Config not initialized. Run step 3.

**"ProtocolPaused"** — Admin paused the protocol. Use `update_config` to unpause.

**"InsufficientReserve"** — Market doesn't have enough quote tokens. Buy more first.

**"TwapSampleTooEarly"** — Wait for `twap_interval` seconds between samples.

**"MarketNotExpired"** — Can't resolve before deadline. Wait or use a shorter deadline.
