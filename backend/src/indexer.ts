/**
 * Duel Protocol — Production Indexer
 *
 * WebSocket-based real-time indexer with crash recovery.
 * Replaces the Supabase polling indexer with PostgreSQL + WS.
 *
 * Features:
 *   - Real-time event ingestion via connection.onLogs()
 *   - Full state sync from getProgramAccounts
 *   - Crash recovery: resumes from last_processed_slot
 *   - Auto-reconnect on WebSocket drops
 *   - Heartbeat tracking for health monitoring
 *
 * Usage:
 *   DATABASE_URL=... SOLANA_RPC_URL=... bun run src/indexer.ts
 */

import { Connection, PublicKey, Keypair, Transaction, VersionedTransaction } from "@solana/web3.js";
import { BorshCoder, EventParser, Program, AnchorProvider, Idl, type Wallet } from "@coral-xyz/anchor";
import { config } from "./config.js";
import * as db from "./db.js";

import IDL from "../../sdk/idl/duel.json";
import type { Duel } from "../../sdk/src/types.js";

// ─── Setup ────────────────────────────────────────────────────────

const DUEL_IDL = IDL as Idl;
const coder = new BorshCoder(DUEL_IDL);
const eventParser = new EventParser(config.programId, coder);

let connection: Connection;
let wsSubscriptionId: number | null = null;
let isShuttingDown = false;

// Heartbeat interval handle
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let syncInterval: ReturnType<typeof setInterval> | null = null;

// ─── Readonly Anchor Program ─────────────────────────────────────

const READONLY_KEYPAIR = Keypair.generate();
const READONLY_WALLET: Wallet = {
  payer: READONLY_KEYPAIR,
  publicKey: READONLY_KEYPAIR.publicKey,
  signTransaction: <T extends Transaction | VersionedTransaction>(tx: T) => Promise.resolve(tx),
  signAllTransactions: <T extends Transaction | VersionedTransaction>(txs: T[]) => Promise.resolve(txs),
};

function getProgram(): Program<Duel> {
  const provider = new AnchorProvider(connection, READONLY_WALLET, { commitment: "confirmed" });
  return new Program(DUEL_IDL, provider) as unknown as Program<Duel>;
}

function log(level: "INFO" | "WARN" | "ERROR", msg: string, data?: Record<string, unknown>) {
  const entry = { ts: new Date().toISOString(), level, service: "indexer", msg, ...data };
  console.log(JSON.stringify(entry));
}

// ─── Event Handlers ───────────────────────────────────────────────

async function handleEvent(name: string, data: any, slot: number): Promise<void> {
  try {
    switch (name) {
      case "MarketCreated": {
        await db.upsertMarket({
          pubkey: data.market.toBase58(),
          authority: data.authority.toBase58(),
          deadline: Number(data.deadline),
          battle_tax_bps: data.battleTaxBps,
          status: "active",
        });
        log("INFO", `MarketCreated: ${data.market.toBase58().slice(0, 8)}...`);
        // Full sync to get complete market data
        await syncSingleMarket(data.market);
        break;
      }

      case "TokensBought": {
        await db.insertTrade({
          market_pubkey: data.market.toBase58(),
          side: data.side,
          trader: data.buyer.toBase58(),
          trade_type: "buy",
          sol_amount: data.solAmount.toString(),
          token_amount: data.tokensReceived.toString(),
          price_after: data.newPrice.toString(),
          penalty_applied: "0",
          slot,
        });
        log("INFO", `TokensBought: ${data.buyer.toBase58().slice(0, 8)}...`, { slot });
        break;
      }

      case "TokensSold": {
        await db.insertTrade({
          market_pubkey: data.market.toBase58(),
          side: data.side,
          trader: data.seller.toBase58(),
          trade_type: "sell",
          sol_amount: data.solReceived?.toString() ?? data.quoteReceived?.toString() ?? "0",
          token_amount: data.tokenAmount.toString(),
          price_after: data.newPrice.toString(),
          penalty_applied: data.penaltyApplied?.toString() ?? "0",
          slot,
        });
        log("INFO", `TokensSold: ${data.seller.toBase58().slice(0, 8)}...`, { slot });
        break;
      }

      case "TwapSampled": {
        await db.insertTwapSample({
          market_pubkey: data.market.toBase58(),
          price_a: data.priceA.toString(),
          price_b: data.priceB.toString(),
          sample_count: data.sampleCount,
          slot,
        });
        log("INFO", `TwapSampled: sample #${data.sampleCount}`, { slot });
        break;
      }

      case "MarketResolved": {
        await db.upsertMarket({
          pubkey: data.market.toBase58(),
          status: "resolved",
          winner: data.winner,
          final_twap_a: data.finalTwapA.toString(),
          final_twap_b: data.finalTwapB.toString(),
          battle_tax_collected: data.transferAmount.toString(),
          protocol_fee_collected: data.protocolFee.toString(),
        });
        log("INFO", `MarketResolved: winner=side ${data.winner}`, { slot });
        break;
      }

      case "TokensGraduated": {
        await db.insertGraduation({
          market_pubkey: data.market.toBase58(),
          side: data.side,
          dex_pool: data.dexPool.toBase58(),
          sol_seeded: data.solSeeded.toString(),
          tokens_seeded: data.tokensSeeded.toString(),
          slot,
        });
        await db.upsertMarket({
          pubkey: data.market.toBase58(),
          graduated_side: data.side,
          dex_pool: data.dexPool.toBase58(),
        });
        log("INFO", `TokensGraduated → ${data.dexPool.toBase58().slice(0, 8)}...`, { slot });
        break;
      }
    }

    // Update last processed slot
    await db.setState("last_processed_slot", slot.toString());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log("ERROR", `Event handler error for ${name}`, { error: message, slot });
  }
}

// ─── Full State Sync ──────────────────────────────────────────────

function getMarketStatus(market: any): string {
  if (market.status?.resolved) return "resolved";
  const now = Date.now() / 1000;
  const twapStart = Number(market.deadline) - Number(market.twapWindow);
  if (now >= twapStart && now < Number(market.deadline)) return "twap";
  if (now >= Number(market.deadline)) return "twap";
  return "active";
}

async function syncSingleMarket(marketPubkey: PublicKey): Promise<void> {
  try {
    const program = getProgram();
    const market = await program.account.market.fetch(marketPubkey);

    let reserveA = 0, reserveB = 0, circulatingA = 0, circulatingB = 0;
    let tokenMintA: string | null = null, tokenMintB: string | null = null;

    try {
      const sideA = await program.account.side.fetch(market.sideA);
      const sideB = await program.account.side.fetch(market.sideB);
      circulatingA = sideA.circulatingSupply.toNumber();
      circulatingB = sideB.circulatingSupply.toNumber();
      tokenMintA = sideA.tokenMint.toBase58();
      tokenMintB = sideB.tokenMint.toBase58();

      const vA = await connection.getTokenAccountBalance(sideA.quoteReserveVault);
      const vB = await connection.getTokenAccountBalance(sideB.quoteReserveVault);
      reserveA = Number(vA.value.amount);
      reserveB = Number(vB.value.amount);
    } catch { /* Side fetch may fail for new markets */ }

    await db.upsertMarket({
      pubkey: marketPubkey.toBase58(),
      authority: market.authority.toBase58(),
      deadline: Number(market.deadline),
      battle_tax_bps: market.battleTaxBps,
      protocol_fee_bps: market.protocolFeeBps,
      sell_penalty_max_bps: market.sellPenaltyMaxBps,
      twap_window: Number(market.twapWindow),
      twap_interval: Number(market.twapInterval),
      status: getMarketStatus(market),
      winner: market.winner !== null && market.winner !== undefined ? market.winner : null,
      reserve_a: reserveA,
      reserve_b: reserveB,
      side_a_pubkey: market.sideA.toBase58(),
      side_b_pubkey: market.sideB.toBase58(),
      token_mint_a: tokenMintA,
      token_mint_b: tokenMintB,
      circulating_a: circulatingA,
      circulating_b: circulatingB,
      quote_mint: market.quoteMint.toBase58(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log("ERROR", `Failed to sync market ${marketPubkey.toBase58().slice(0, 8)}...`, { error: message });
  }
}

async function syncAllMarkets(): Promise<void> {
  log("INFO", "Syncing all markets from chain...");
  try {
    const program = getProgram();
    const allMarkets = await program.account.market.all();
    log("INFO", `Found ${allMarkets.length} markets on-chain`);

    for (const m of allMarkets) {
      await syncSingleMarket(m.publicKey);
    }

    log("INFO", `Synced ${allMarkets.length} markets`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log("ERROR", "Failed to sync markets", { error: message });
  }
}

// ─── Event Backfill (Crash Recovery) ──────────────────────────────

async function backfillFromSlot(): Promise<void> {
  const lastSlot = await db.getState("last_processed_slot");
  const startSlot = lastSlot ? parseInt(lastSlot, 10) : 0;

  log("INFO", `Backfilling events from slot ${startSlot}...`);

  try {
    const signatures = await connection.getSignaturesForAddress(
      config.programId,
      { limit: config.backfillLimit },
      "confirmed"
    );

    // Filter to signatures after our last processed slot
    const unprocessed = startSlot > 0
      ? signatures.filter((s) => s.slot > startSlot)
      : signatures;

    if (unprocessed.length === 0) {
      log("INFO", "No new transactions to backfill");
      return;
    }

    let processed = 0;

    for (let i = 0; i < unprocessed.length; i += 20) {
      const batch = unprocessed.slice(i, i + 20);
      const txs = await connection.getTransactions(
        batch.map((s) => s.signature),
        { commitment: "confirmed", maxSupportedTransactionVersion: 0 }
      );

      for (const tx of txs) {
        if (!tx || !tx.meta || tx.meta.err) continue;
        const logs = tx.meta.logMessages || [];

        for (const event of eventParser.parseLogs(logs)) {
          await handleEvent(event.name, event.data, tx.slot);
          processed++;
        }
      }
    }

    log("INFO", `Backfilled ${processed} events from ${unprocessed.length} txs`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log("ERROR", "Backfill failed", { error: message });
  }
}

// ─── WebSocket Listener (with auto-reconnect) ─────────────────────

function startEventListener(): void {
  log("INFO", `Subscribing to program logs via WebSocket...`);

  try {
    wsSubscriptionId = connection.onLogs(
      config.programId,
      (logInfo, ctx) => {
        if (logInfo.err) return;

        for (const event of eventParser.parseLogs(logInfo.logs)) {
          handleEvent(event.name, event.data, ctx.slot).catch((err) =>
            log("ERROR", `Event handler error`, { error: err.message })
          );
        }
      },
      "confirmed"
    );

    log("INFO", `WebSocket subscribed (id: ${wsSubscriptionId})`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log("ERROR", "WebSocket subscription failed, retrying in 5s...", { error: message });
    setTimeout(() => startEventListener(), 5000);
  }
}

// ─── Reserve Updater ──────────────────────────────────────────────

async function updateReserves(): Promise<void> {
  try {
    const markets = await db.getActiveMarkets();
    if (markets.length === 0) return;

    const program = getProgram();

    for (const m of markets) {
      try {
        if (!m.side_a_pubkey || !m.side_b_pubkey) continue;

        const sideA = await program.account.side.fetch(new PublicKey(m.side_a_pubkey));
        const sideB = await program.account.side.fetch(new PublicKey(m.side_b_pubkey));

        const vA = await connection.getTokenAccountBalance(sideA.quoteReserveVault);
        const vB = await connection.getTokenAccountBalance(sideB.quoteReserveVault);

        await db.upsertMarket({
          pubkey: m.pubkey,
          reserve_a: Number(vA.value.amount),
          reserve_b: Number(vB.value.amount),
          circulating_a: sideA.circulatingSupply.toNumber(),
          circulating_b: sideB.circulatingSupply.toNumber(),
        });
      } catch { /* Individual market update failure is non-fatal */ }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log("ERROR", "Reserve update failed", { error: message });
  }
}

// ─── Heartbeat ────────────────────────────────────────────────────

async function updateHeartbeat(): Promise<void> {
  try {
    await db.setState("indexer_heartbeat", Date.now().toString());
  } catch { /* Non-fatal */ }
}

// ─── Graceful Shutdown ────────────────────────────────────────────

async function shutdown(): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  log("INFO", "Shutting down indexer...");

  if (heartbeatInterval) clearInterval(heartbeatInterval);
  if (syncInterval) clearInterval(syncInterval);

  if (wsSubscriptionId !== null) {
    try {
      await connection.removeOnLogsListener(wsSubscriptionId);
    } catch { /* Already closed */ }
  }

  await db.closePool();
  log("INFO", "Indexer stopped");
  process.exit(0);
}

// ─── Main ─────────────────────────────────────────────────────────

async function main(): Promise<void> {
  log("INFO", "═══ DUEL PROTOCOL — Production Indexer ═══", {
    rpc: config.rpcUrl,
    program: config.programId.toBase58(),
  });

  // Initialize connection
  connection = new Connection(config.rpcUrl, {
    commitment: "confirmed",
    wsEndpoint: config.wsUrl,
  });

  // Run migrations
  await db.runMigrations();

  // 1. Full state sync
  await syncAllMarkets();

  // 2. Backfill from last processed slot (crash recovery)
  await backfillFromSlot();

  // 3. Start real-time WebSocket listener
  startEventListener();

  // 4. Periodic reserve updates
  syncInterval = setInterval(updateReserves, config.syncIntervalMs);

  // 5. Heartbeat every 10s
  heartbeatInterval = setInterval(updateHeartbeat, 10_000);
  await updateHeartbeat();

  log("INFO", `Indexer running. Reserve sync every ${config.syncIntervalMs / 1000}s`);

  // Graceful shutdown
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  log("ERROR", "Fatal error", { error: String(err) });
  process.exit(1);
});
