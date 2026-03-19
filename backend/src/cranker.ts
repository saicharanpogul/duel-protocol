/**
 * Duel Protocol — Production TWAP Cranker
 *
 * Daemon that submits TWAP samples and resolves markets.
 * Permissionless — anyone can run this.
 *
 * Features:
 *   - Crash recovery: checks all markets on startup
 *   - Balance monitoring with warnings
 *   - Heartbeat tracking for health checks
 *   - Graceful shutdown (finishes current tx)
 *
 * Usage:
 *   DATABASE_URL=... SOLANA_RPC_URL=... CRANKER_KEYPAIR=./key.json bun run src/cranker.ts
 */

import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { AnchorProvider, Program, Wallet, BN, Idl } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { readFileSync } from "fs";
import { config } from "./config.js";
import * as db from "./db.js";

import IDL from "../../sdk/idl/duel.json";
import type { Duel } from "../../sdk/src/types.js";

// ─── State ────────────────────────────────────────────────────────

let isShuttingDown = false;
let isProcessing = false;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let pollInterval: ReturnType<typeof setInterval> | null = null;

// Stats
let totalSamples = 0;
let totalResolutions = 0;
let totalErrors = 0;

// ─── Setup ────────────────────────────────────────────────────────

function loadKeypair(path: string): Keypair {
  const raw = readFileSync(path, "utf-8");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
}

function log(level: "INFO" | "WARN" | "ERROR" | "ACTION", msg: string, data?: Record<string, unknown>) {
  const entry = { ts: new Date().toISOString(), level, service: "cranker", msg, ...data };
  console.log(JSON.stringify(entry));
}

// ─── Market Helpers ───────────────────────────────────────────────

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

function isResolved(status: MarketData["account"]["status"]): boolean {
  return "resolved" in status;
}

function isOracleOnly(mode: MarketData["account"]["resolutionMode"]): boolean {
  return "oracle" in mode;
}

// ─── Cranker Loop ─────────────────────────────────────────────────

async function crankerLoop(program: Program<Duel>, cranker: Keypair): Promise<void> {
  if (isProcessing || isShuttingDown) return;
  isProcessing = true;

  try {
    const now = Math.floor(Date.now() / 1000);

    let markets: MarketData[];
    try {
      const raw = await program.account.market.all();
      markets = raw as unknown as MarketData[];
    } catch (err) {
      log("ERROR", "Failed to fetch markets", { error: String(err) });
      totalErrors++;
      return;
    }

    const activeMarkets = markets.filter((m) => !isResolved(m.account.status));

    if (activeMarkets.length === 0) return;

    for (const market of activeMarkets) {
      if (isShuttingDown) break;

      const { deadline, twapWindow, twapInterval, lastSampleTs, twapSamplesCount, sideA, sideB, resolutionMode, oracleDisputeWindow } = market.account;

      const dl = deadline.toNumber();
      const twWindow = twapWindow.toNumber();
      const twInterval = twapInterval.toNumber();
      const lastSample = lastSampleTs.toNumber();
      const marketKey = market.publicKey.toBase58().slice(0, 8);

      // ── TWAP Sampling ──
      const twapStart = dl - twWindow;
      const inTwapWindow = now >= twapStart && now <= dl;
      const intervalElapsed = lastSample === 0 || now - lastSample >= twInterval;

      if (inTwapWindow && intervalElapsed) {
        log("ACTION", `TWAP sample: ${marketKey}`, {
          market: market.publicKey.toBase58(),
          samples: twapSamplesCount,
        });

        if (!config.dryRun) {
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
            totalSamples++;
          } catch (err) {
            log("WARN", `TWAP sample failed: ${marketKey}`, { error: String(err) });
            totalErrors++;
          }
        }
        continue;
      }

      // ── Resolution ──
      if (now >= dl && !isResolved(market.account.status)) {
        if (isOracleOnly(resolutionMode)) continue;

        if ("oracleWithTwapFallback" in resolutionMode) {
          const disputeEnd = dl + oracleDisputeWindow.toNumber();
          if (now < disputeEnd) continue;
        }

        const minSamples = Math.max(1, Math.floor(Math.max(1, twWindow / twInterval) / 2));
        if (twapSamplesCount < minSamples) {
          log("WARN", `Insufficient TWAP samples: ${marketKey}`, {
            have: twapSamplesCount,
            need: minSamples,
          });
          continue;
        }

        try {
          const sideAData = await program.account.side.fetch(sideA);
          const sideBData = await program.account.side.fetch(sideB);

          log("ACTION", `Resolving market: ${marketKey}`, {
            market: market.publicKey.toBase58(),
            samples: twapSamplesCount,
          });

          if (!config.dryRun) {
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
            totalResolutions++;
          }
        } catch (err) {
          log("WARN", `Resolution failed: ${marketKey}`, { error: String(err) });
          totalErrors++;
        }
      }
    }
  } finally {
    isProcessing = false;
  }
}

// ─── Heartbeat ────────────────────────────────────────────────────

async function updateHeartbeat(): Promise<void> {
  try {
    await db.setState("cranker_heartbeat", Date.now().toString());
  } catch { /* Non-fatal */ }
}

// ─── Balance Monitor ──────────────────────────────────────────────

async function checkBalance(connection: Connection, cranker: Keypair): Promise<void> {
  try {
    const balance = await connection.getBalance(cranker.publicKey);
    const solBalance = balance / 1e9;
    log("INFO", `Cranker balance: ${solBalance.toFixed(4)} SOL`, {
      lamports: balance,
      totalSamples,
      totalResolutions,
      totalErrors,
    });
    if (balance < 10_000_000) {
      log("WARN", "⚠️ Low cranker balance! Fund with at least 0.01 SOL");
    }
  } catch { /* Non-fatal */ }
}

// ─── Graceful Shutdown ────────────────────────────────────────────

async function shutdown(): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  log("INFO", "Shutting down cranker...", { totalSamples, totalResolutions, totalErrors });

  // Wait for current processing to finish (up to 10s)
  const maxWait = 10_000;
  const start = Date.now();
  while (isProcessing && Date.now() - start < maxWait) {
    await new Promise((r) => setTimeout(r, 100));
  }

  if (heartbeatInterval) clearInterval(heartbeatInterval);
  if (pollInterval) clearInterval(pollInterval);

  await db.closePool();
  log("INFO", "Cranker stopped");
  process.exit(0);
}

// ─── Main ─────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const cranker = loadKeypair(config.crankerKeypairPath);
  const connection = new Connection(config.rpcUrl, "confirmed");
  const wallet = new Wallet(cranker);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  const program = new Program(IDL as Idl, provider) as unknown as Program<Duel>;

  log("INFO", "═══ DUEL PROTOCOL — Production Cranker ═══", {
    rpc: config.rpcUrl,
    cranker: cranker.publicKey.toBase58(),
    pollInterval: config.pollIntervalMs,
    dryRun: config.dryRun,
  });

  // Run migrations (idempotent)
  await db.runMigrations();

  // Check balance
  await checkBalance(connection, cranker);

  // Heartbeat every 10s
  heartbeatInterval = setInterval(updateHeartbeat, 10_000);
  await updateHeartbeat();

  // Balance check every 5 minutes
  setInterval(() => checkBalance(connection, cranker), 300_000);

  // Poll loop
  const tick = async () => {
    try {
      await crankerLoop(program, cranker);
    } catch (err) {
      log("ERROR", "Cranker loop error", { error: String(err) });
      totalErrors++;
    }
  };

  await tick();
  pollInterval = setInterval(tick, config.pollIntervalMs);

  // Graceful shutdown
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  log("ERROR", "Fatal error", { error: String(err) });
  process.exit(1);
});
