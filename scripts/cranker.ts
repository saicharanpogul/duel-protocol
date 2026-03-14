#!/usr/bin/env ts-node

/**
 * Duel Protocol TWAP Cranker
 *
 * Daemon that automatically submits TWAP samples and resolves markets.
 * Permissionless — anyone can run this. The cranker pays ~0.000005 SOL per tx.
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

import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { AnchorProvider, Program, Wallet, BN } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID, NATIVE_MINT } from "@solana/spl-token";
import { readFileSync } from "fs";
import { homedir } from "os";
import { resolve } from "path";
import { Duel } from "../target/types/duel";
import IDL from "../sdk/idl/duel.json";

// ─── Config ────────────────────────────────────────────────────────────

const RPC_URL = process.env.RPC_URL || "http://localhost:8899";
const KEYPAIR_PATH =
  process.env.CRANKER_KEYPAIR ||
  resolve(homedir(), ".config/solana/id.json");
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_MS || "5000", 10);
const DRY_RUN = process.env.DRY_RUN === "true";

const PROGRAM_ID = new PublicKey(
  "CgR6V1AxC7exDFNoh3Q5JP9aea9YuPqq283EwACUGpZE"
);

// ─── Setup ─────────────────────────────────────────────────────────────

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

// ─── Market State Helpers ──────────────────────────────────────────────

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
    resolutionMode: { twap: {} } | { oracle: {} } | { oracleWithTwapFallback: {} };
    oracleDisputeWindow: BN;
    bump: number;
  };
}

function isActive(status: MarketData["account"]["status"]): boolean {
  return "active" in status;
}

function isTwapObservation(status: MarketData["account"]["status"]): boolean {
  return "twapObservation" in status;
}

function isResolved(status: MarketData["account"]["status"]): boolean {
  return "resolved" in status;
}

function isOracleOnly(mode: MarketData["account"]["resolutionMode"]): boolean {
  return "oracle" in mode;
}

// ─── Cranker Logic ─────────────────────────────────────────────────────

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
      resolutionMode,
      oracleDisputeWindow,
    } = market.account;

    const dl = deadline.toNumber();
    const twWindow = twapWindow.toNumber();
    const twInterval = twapInterval.toNumber();
    const lastSample = lastSampleTs.toNumber();
    const marketKey = market.publicKey.toBase58().slice(0, 8);

    // ── TWAP Sampling ──
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

    // ── Resolution ──
    if (now >= dl && !isResolved(market.account.status)) {
      // Oracle-only markets can't be TWAP-resolved
      if (isOracleOnly(resolutionMode)) {
        log("INFO", `Skipping oracle-only market: ${marketKey}`);
        continue;
      }

      // OracleWithTwapFallback: only resolve after dispute window
      if ("oracleWithTwapFallback" in resolutionMode) {
        const disputeEnd = dl + oracleDisputeWindow.toNumber();
        if (now < disputeEnd) {
          log("INFO", `Waiting for dispute window: ${marketKey}`, {
            disputeEnds: new Date(disputeEnd * 1000).toISOString(),
          });
          continue;
        }
      }

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

      // Fetch side data for quote vaults
      try {
        const sideAData = await program.account.side.fetch(sideA);
        const sideBData = await program.account.side.fetch(sideB);

        log("ACTION", `Resolving market: ${marketKey}`, {
          market: market.publicKey.toBase58(),
          samples: twapSamplesCount,
        });

        if (!DRY_RUN) {
          const tx = await program.methods
            .resolveMarket()
            .accountsStrict({
              resolver: cranker.publicKey,
              market: market.publicKey,
              sideA,
              sideB,
              quoteMint: market.account.quoteMint,
              quoteVaultA: sideAData.quoteReserveVault,
              quoteVaultB: sideBData.quoteReserveVault,
              protocolFeeAccount: market.account.protocolFeeAccount,
              creatorFeeAccount: market.account.creatorFeeAccount,
              quoteTokenProgram: TOKEN_PROGRAM_ID,
            })
            .signers([cranker])
            .rpc();
          log("INFO", `Market resolved: ${marketKey}`, { tx });
        }
      } catch (err) {
        log("WARN", `Resolution failed: ${marketKey}`, {
          error: String(err),
        });
      }
    }
  }
}

// ─── Main ──────────────────────────────────────────────────────────────

async function main() {
  const cranker = loadKeypair(KEYPAIR_PATH);
  const connection = new Connection(RPC_URL, "confirmed");
  const wallet = new Wallet(cranker);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  const program = new Program(IDL as any, provider) as unknown as Program<Duel>;

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
