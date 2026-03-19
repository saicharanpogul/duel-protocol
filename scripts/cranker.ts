#!/usr/bin/env ts-node

/**
 * Duel Protocol TWAP Cranker
 *
 * Daemon that automatically submits TWAP samples and resolves+graduates markets.
 * Permissionless -- anyone can run this. The cranker pays ~0.000005 SOL per sample tx,
 * and more for resolve_and_graduate (pool creation + position NFT rent).
 *
 * Usage:
 *   CRANKER_KEYPAIR=./cranker-keypair.json RPC_URL=https://api.devnet.solana.com npx ts-node scripts/cranker.ts
 *
 * Environment:
 *   RPC_URL              - Solana RPC endpoint (default: http://localhost:8899)
 *   CRANKER_KEYPAIR      - Path to keypair file (default: ~/.config/solana/id.json)
 *   POLL_INTERVAL_MS     - Poll interval in ms (default: 5000)
 *   DRY_RUN              - If "true", log actions without sending txs
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  ComputeBudgetProgram,
  Transaction,
} from "@solana/web3.js";
import { AnchorProvider, Program, Wallet, BN, Idl } from "@coral-xyz/anchor";
import {
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import { readFileSync } from "fs";
import { homedir } from "os";
import { resolve } from "path";
import type { Duel } from "../sdk/src/types";
import IDL from "../sdk/idl/duel.json";
import {
  deriveDammV2Accounts,
  findConfigPda,
  findMintPda,
  findMetadataPda,
} from "../sdk/src/pda";
import {
  METEORA_DAMM_V2_PROGRAM_ID,
  WSOL_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_METADATA_PROGRAM_ID,
} from "../sdk/src/constants";

// -- Config --

const RPC_URL = process.env.RPC_URL || "http://localhost:8899";
const KEYPAIR_PATH =
  process.env.CRANKER_KEYPAIR ||
  resolve(homedir(), ".config/solana/id.json");
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_MS || "5000", 10);
const DRY_RUN = process.env.DRY_RUN === "true";

const PROGRAM_ID = new PublicKey(
  "CgR6V1AxC7exDFNoh3Q5JP9aea9YuPqq283EwACUGpZE"
);

const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);

// -- Setup --

function loadKeypair(path: string): Keypair {
  const raw = readFileSync(path, "utf-8");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
}

function log(
  level: "INFO" | "WARN" | "ERROR" | "ACTION",
  msg: string,
  data?: Record<string, unknown>
) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...data,
  };
  console.log(JSON.stringify(entry));
}

// -- Market State Helpers --

interface MarketData {
  publicKey: PublicKey;
  account: {
    authority: PublicKey;
    marketId: BN;
    sideA: PublicKey;
    sideB: PublicKey;
    quoteMint: PublicKey;
    deadline: BN;
    twapWindow: BN;
    twapInterval: BN;
    status: { active: {} } | { twapObservation: {} } | { resolved: {} };
    twapSamplesCount: number;
    lastSampleTs: BN;
    protocolFeeAccount: PublicKey;
    creatorFeeAccount: PublicKey;
    bump: number;
  };
}

interface SideData {
  market: PublicKey;
  sideIndex: number;
  tokenMint: PublicKey;
  tokenReserveVault: PublicKey;
  quoteReserveVault: PublicKey;
  totalSupply: BN;
  circulatingSupply: BN;
  twapAccumulator: BN;
  bump: number;
}

function isResolved(status: MarketData["account"]["status"]): boolean {
  return "resolved" in status;
}

/**
 * Determine the expected winner based on TWAP accumulators.
 * Returns 0 (side A wins) or 1 (side B wins).
 */
function determineExpectedWinner(
  sideAData: SideData,
  sideBData: SideData,
  twapSamplesCount: number,
  quoteVaultAAmount: bigint,
  quoteVaultBAmount: bigint
): number {
  const samples = BigInt(twapSamplesCount);
  if (samples === 0n) return 0;

  const accA = BigInt(sideAData.twapAccumulator.toString());
  const accB = BigInt(sideBData.twapAccumulator.toString());

  const finalTwapA = accA / samples;
  const finalTwapB = accB / samples;

  if (finalTwapA > finalTwapB) return 0;
  if (finalTwapB > finalTwapA) return 1;

  // Exact tie: side with higher reserve wins, side A wins if equal
  if (quoteVaultAAmount >= quoteVaultBAmount) return 0;
  return 1;
}

/**
 * Ensure an ATA exists. Returns the ATA address and any pre-instruction needed.
 */
async function ensureAta(
  connection: Connection,
  payer: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
  allowOwnerOffCurve: boolean = false
): Promise<{ ata: PublicKey; createIx: ReturnType<typeof createAssociatedTokenAccountInstruction> | null }> {
  const ata = await getAssociatedTokenAddress(mint, owner, allowOwnerOffCurve);
  const info = await connection.getAccountInfo(ata);
  if (info) {
    return { ata, createIx: null };
  }
  return {
    ata,
    createIx: createAssociatedTokenAccountInstruction(payer, ata, owner, mint),
  };
}

// -- Cranker Logic --

async function crankerLoop(
  program: Program<Duel>,
  cranker: Keypair
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  // Fetch all markets
  let markets: MarketData[];
  try {
    const raw = await program.account.market.all();
    markets = raw as unknown as MarketData[];
  } catch (err) {
    log("ERROR", "Failed to fetch markets", {
      error: String(err),
    });
    return;
  }

  // Filter to actionable markets
  const activeMarkets = markets.filter(
    (m) => !isResolved(m.account.status)
  );

  if (activeMarkets.length === 0) {
    return; // Nothing to do
  }

  log("INFO", `Found ${activeMarkets.length} active market(s)`, {
    total: markets.length,
  });

  for (const market of activeMarkets) {
    const {
      deadline,
      twapWindow,
      twapInterval,
      lastSampleTs,
      twapSamplesCount,
      sideA,
      sideB,
    } = market.account;

    const dl = deadline.toNumber();
    const twWindow = twapWindow.toNumber();
    const twInterval = twapInterval.toNumber();
    const lastSample = lastSampleTs.toNumber();
    const marketKey = market.publicKey.toBase58().slice(0, 8);

    // -- TWAP Sampling --
    const twapStart = dl - twWindow;
    const inTwapWindow = now >= twapStart && now <= dl;
    const intervalElapsed =
      lastSample === 0 || now - lastSample >= twInterval;

    if (inTwapWindow && intervalElapsed) {
      log("ACTION", `TWAP sample: ${marketKey}`, {
        market: market.publicKey.toBase58(),
        samples: twapSamplesCount,
      });

      if (!DRY_RUN) {
        try {
          const tx = await program.methods
            .recordTwapSample()
            .accountsStrict({
              cranker: cranker.publicKey,
              market: market.publicKey,
              sideA,
              sideB,
            })
            .signers([cranker])
            .rpc();
          log("INFO", `TWAP sample submitted: ${marketKey}`, { tx });
        } catch (err) {
          log("WARN", `TWAP sample failed: ${marketKey}`, {
            error: String(err),
          });
        }
      }
      continue; // Don't try resolution in the same tick as sampling
    }

    // -- Resolution + Graduation --
    if (now >= dl && !isResolved(market.account.status)) {
      // Need minimum samples
      const minSamples = Math.max(
        1,
        Math.floor(Math.max(1, twWindow / twInterval) / 2)
      );
      if (twapSamplesCount < minSamples) {
        log("WARN", `Insufficient TWAP samples: ${marketKey}`, {
          have: twapSamplesCount,
          need: minSamples,
        });
        continue;
      }

      try {
        // Fetch side data for TWAP calculation and account addresses
        const sideAData = await program.account.side.fetch(sideA) as unknown as SideData;
        const sideBData = await program.account.side.fetch(sideB) as unknown as SideData;

        // Fetch quote vault balances for tiebreaker
        const quoteVaultAInfo = await program.provider.connection.getTokenAccountBalance(sideAData.quoteReserveVault);
        const quoteVaultBInfo = await program.provider.connection.getTokenAccountBalance(sideBData.quoteReserveVault);
        const quoteVaultAAmount = BigInt(quoteVaultAInfo.value.amount);
        const quoteVaultBAmount = BigInt(quoteVaultBInfo.value.amount);

        // Determine expected winner
        const expectedWinner = determineExpectedWinner(
          sideAData,
          sideBData,
          twapSamplesCount,
          quoteVaultAAmount,
          quoteVaultBAmount
        );

        const winningSideData = expectedWinner === 0 ? sideAData : sideBData;
        const losingSideData = expectedWinner === 0 ? sideBData : sideAData;
        const winningTokenMint = winningSideData.tokenMint;
        const losingTokenMint = losingSideData.tokenMint;

        log("ACTION", `Resolving+graduating market: ${marketKey}`, {
          market: market.publicKey.toBase58(),
          samples: twapSamplesCount,
          expectedWinner,
          twapA: sideAData.twapAccumulator.toString(),
          twapB: sideBData.twapAccumulator.toString(),
        });

        if (!DRY_RUN) {
          const connection = program.provider.connection;

          // Create market PDA's ATAs for winning token and WSOL (if not exist)
          const marketTokenAta = await ensureAta(
            connection,
            cranker.publicKey,
            market.publicKey,
            winningTokenMint,
            true // allowOwnerOffCurve for PDA owner
          );
          const marketWsolAta = await ensureAta(
            connection,
            cranker.publicKey,
            market.publicKey,
            NATIVE_MINT,
            true
          );

          // Send ATA creation txs if needed
          const ataIxs = [marketTokenAta.createIx, marketWsolAta.createIx].filter(Boolean);
          if (ataIxs.length > 0) {
            const ataTx = new Transaction();
            for (const ix of ataIxs) {
              if (ix) ataTx.add(ix);
            }
            const ataSig = await program.provider.sendAndConfirm!(ataTx, [cranker]);
            log("INFO", `Created ATAs for market PDA: ${marketKey}`, { tx: ataSig });
          }

          // Generate new keypair for position NFT mint
          const positionNftMint = Keypair.generate();

          // Derive all Meteora DAMM v2 PDAs
          const damm = deriveDammV2Accounts(
            winningTokenMint,
            positionNftMint.publicKey,
            WSOL_MINT
          );

          // Derive losing token metadata PDA
          const [losingTokenMetadata] = findMetadataPda(losingTokenMint);

          // Derive config PDA
          const [configPda] = findConfigPda();

          // Derive token mints (they are already in side data, but we need the actual accounts)
          const tokenMintA = sideAData.tokenMint;
          const tokenMintB = sideBData.tokenMint;

          // Build resolve_and_graduate transaction with compute budget
          const tx = await program.methods
            .resolveAndGraduate(expectedWinner)
            .accountsStrict({
              resolver: cranker.publicKey,
              market: market.publicKey,
              config: configPda,
              sideA,
              sideB,
              quoteVaultA: sideAData.quoteReserveVault,
              quoteVaultB: sideBData.quoteReserveVault,
              tokenVaultA: sideAData.tokenReserveVault,
              tokenVaultB: sideBData.tokenReserveVault,
              tokenMintA,
              tokenMintB,
              quoteMint: market.account.quoteMint,
              marketTokenAta: marketTokenAta.ata,
              marketWsolAta: marketWsolAta.ata,
              pool: damm.pool,
              positionNftMint: positionNftMint.publicKey,
              positionNftAccount: damm.positionNftAccount,
              position: damm.position,
              poolTokenVaultA: damm.tokenAVault,
              poolTokenVaultB: damm.tokenBVault,
              poolAuthority: damm.poolAuthority,
              eventAuthority: damm.eventAuthority,
              meteoraProgram: METEORA_DAMM_V2_PROGRAM_ID,
              losingTokenMetadata,
              tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
              tokenProgram: TOKEN_PROGRAM_ID,
              quoteTokenProgram: TOKEN_PROGRAM_ID,
              token2022Program: TOKEN_2022_PROGRAM_ID,
              associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
              systemProgram: SystemProgram.programId,
            })
            .preInstructions([
              ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
            ])
            .signers([cranker, positionNftMint])
            .rpc();

          log("INFO", `Market resolved+graduated: ${marketKey}`, {
            tx,
            winner: expectedWinner,
            pool: damm.pool.toBase58(),
          });
        }
      } catch (err) {
        log("WARN", `Resolution+graduation failed: ${marketKey}`, {
          error: String(err),
        });
      }
    }
  }
}

// -- Main --

async function main() {
  const cranker = loadKeypair(KEYPAIR_PATH);
  const connection = new Connection(RPC_URL, "confirmed");
  const wallet = new Wallet(cranker);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  const program = new Program(IDL as Idl, provider) as unknown as Program<Duel>;

  log("INFO", "Duel Protocol TWAP Cranker started", {
    rpc: RPC_URL,
    cranker: cranker.publicKey.toBase58(),
    pollInterval: POLL_INTERVAL,
    dryRun: DRY_RUN,
  });

  // Check cranker balance
  const balance = await connection.getBalance(cranker.publicKey);
  log("INFO", `Cranker balance: ${(balance / 1e9).toFixed(4)} SOL`);
  if (balance < 10_000_000) {
    log("WARN", "Low cranker balance! Fund with at least 0.01 SOL");
  }

  // Poll loop
  const tick = async () => {
    try {
      await crankerLoop(program, cranker);
    } catch (err) {
      log("ERROR", "Cranker loop error", { error: String(err) });
    }
  };

  // Run immediately then on interval
  await tick();
  setInterval(tick, POLL_INTERVAL);
}

main().catch((err) => {
  log("ERROR", "Fatal error", { error: String(err) });
  process.exit(1);
});
