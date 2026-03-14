/**
 * Duel Protocol — Supabase Indexer
 *
 * Listens to on-chain events via WebSocket, syncs market state from
 * getProgramAccounts, and writes everything to Supabase for fast reads.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... SOLANA_RPC_URL=... bun run scripts/indexer.ts
 */

import { Connection, PublicKey, Keypair, Transaction, VersionedTransaction } from "@solana/web3.js";
import { BorshCoder, EventParser, Program, AnchorProvider, Idl, type Wallet } from "@coral-xyz/anchor";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import IDL from "../sdk/idl/duel.json";
import type { Duel } from "../sdk/src/types";

// ─── Config ───────────────────────────────────────────────────────

const RPC_URL = process.env.SOLANA_RPC_URL || "http://localhost:8999";
const WS_URL = process.env.SOLANA_WS_URL || RPC_URL.replace("http", "ws");
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const PROGRAM_ID = new PublicKey("CgR6V1AxC7exDFNoh3Q5JP9aea9YuPqq283EwACUGpZE");
const BACKFILL_LIMIT = parseInt(process.env.BACKFILL_LIMIT || "1000");
const SYNC_INTERVAL_MS = parseInt(process.env.SYNC_INTERVAL_MS || "60000"); // 1 min

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars");
  process.exit(1);
}

// ─── Clients ──────────────────────────────────────────────────────

const connection = new Connection(RPC_URL, {
  commitment: "confirmed",
  wsEndpoint: WS_URL,
});

const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const DUEL_IDL = IDL as Idl;
const coder = new BorshCoder(DUEL_IDL);
const eventParser = new EventParser(PROGRAM_ID, coder);

/** Minimal wallet for readonly Anchor provider */
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

// ─── Supabase Writers ─────────────────────────────────────────────

async function upsertMarket(data: Record<string, any>) {
  const { error } = await supabase.from("markets").upsert(data, { onConflict: "pubkey" });
  if (error) console.error("[DB] upsertMarket error:", error.message);
}

async function insertTrade(data: Record<string, any>) {
  const { error } = await supabase.from("trades").insert(data);
  if (error) console.error("[DB] insertTrade error:", error.message);
}

async function insertTwapSample(data: Record<string, any>) {
  const { error } = await supabase.from("twap_samples").insert(data);
  if (error) console.error("[DB] insertTwapSample error:", error.message);
}

async function insertGraduation(data: Record<string, any>) {
  const { error } = await supabase.from("graduations").insert(data);
  if (error) console.error("[DB] insertGraduation error:", error.message);
}

// ─── Event Handlers ───────────────────────────────────────────────

async function handleEvent(name: string, data: any, slot: number) {
  switch (name) {
    case "MarketCreated": {
      await upsertMarket({
        pubkey: data.market.toBase58(),
        authority: data.authority.toBase58(),
        deadline: Number(data.deadline),
        battle_tax_bps: data.battleTaxBps,
        status: "active",
        name_a: "",
        name_b: "",
        symbol_a: "",
        symbol_b: "",
      });
      console.log(`[Event] MarketCreated: ${data.market.toBase58()}`);
      // Immediately sync full market data
      await syncSingleMarket(data.market);
      break;
    }

    case "TokensBought": {
      await insertTrade({
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
      console.log(`[Event] TokensBought: ${data.buyer.toBase58().slice(0, 8)}... on market ${data.market.toBase58().slice(0, 8)}...`);
      break;
    }

    case "TokensSold": {
      await insertTrade({
        market_pubkey: data.market.toBase58(),
        side: data.side,
        trader: data.seller.toBase58(),
        trade_type: "sell",
        sol_amount: data.solReceived.toString(),
        token_amount: data.tokenAmount.toString(),
        price_after: data.newPrice.toString(),
        penalty_applied: data.penaltyApplied.toString(),
        slot,
      });
      console.log(`[Event] TokensSold: ${data.seller.toBase58().slice(0, 8)}...`);
      break;
    }

    case "TwapSampled": {
      await insertTwapSample({
        market_pubkey: data.market.toBase58(),
        price_a: data.priceA.toString(),
        price_b: data.priceB.toString(),
        sample_count: data.sampleCount,
        slot,
      });
      console.log(`[Event] TwapSampled: market ${data.market.toBase58().slice(0, 8)}... sample #${data.sampleCount}`);
      break;
    }

    case "MarketResolved": {
      await upsertMarket({
        pubkey: data.market.toBase58(),
        status: "resolved",
        winner: data.winner,
        final_twap_a: data.finalTwapA.toString(),
        final_twap_b: data.finalTwapB.toString(),
        battle_tax_collected: data.transferAmount.toString(),
        protocol_fee_collected: data.protocolFee.toString(),
      });
      console.log(`[Event] MarketResolved: ${data.market.toBase58().slice(0, 8)}... winner=side ${data.winner}`);
      break;
    }

    case "TokensGraduated": {
      await insertGraduation({
        market_pubkey: data.market.toBase58(),
        side: data.side,
        dex_pool: data.dexPool.toBase58(),
        sol_seeded: data.solSeeded.toString(),
        tokens_seeded: data.tokensSeeded.toString(),
        slot,
      });
      await upsertMarket({
        pubkey: data.market.toBase58(),
        graduated_side: data.side,
        dex_pool: data.dexPool.toBase58(),
      });
      console.log(`[Event] TokensGraduated: ${data.market.toBase58().slice(0, 8)}... → ${data.dexPool.toBase58().slice(0, 8)}...`);
      break;
    }
  }
}

// ─── Full State Sync ──────────────────────────────────────────────

function getMarketStatus(market: any): string {
  if (market.status?.resolved) return "resolved";
  const now = Date.now() / 1000;
  const twapStart = Number(market.deadline) - Number(market.twapWindow);
  if (now >= twapStart && now < Number(market.deadline)) return "twap";
  if (now >= Number(market.deadline)) return "twap"; // past deadline, not resolved yet
  return "active";
}

async function syncSingleMarket(marketPubkey: PublicKey) {
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
    } catch { }

    await upsertMarket({
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
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Sync] Failed to sync market ${marketPubkey.toBase58().slice(0, 8)}...:`, message);
  }
}

async function syncAllMarkets() {
  console.log("[Sync] Syncing all markets from chain...");
  try {
    const program = getProgram();
    const allMarkets = await program.account.market.all();
    console.log(`[Sync] Found ${allMarkets.length} markets on-chain`);

    for (const m of allMarkets) {
      await syncSingleMarket(m.publicKey);
    }

    console.log(`[Sync] ✅ Synced ${allMarkets.length} markets`);
  } catch (err: any) {
    console.error("[Sync] Failed to sync markets:", err.message);
  }
}

// ─── Event Backfill ───────────────────────────────────────────────

async function backfillEvents() {
  console.log(`[Backfill] Fetching last ${BACKFILL_LIMIT} transactions...`);

  try {
    const signatures = await connection.getSignaturesForAddress(
      PROGRAM_ID,
      { limit: BACKFILL_LIMIT },
      "confirmed"
    );

    let processed = 0;

    for (let i = 0; i < signatures.length; i += 20) {
      const batch = signatures.slice(i, i + 20);
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

    console.log(`[Backfill] ✅ Processed ${processed} events from ${signatures.length} txs`);
  } catch (err: any) {
    console.error("[Backfill] Failed:", err.message);
  }
}

// ─── WebSocket Listener ───────────────────────────────────────────

function startEventListener() {
  console.log(`[Listener] Subscribing to program logs: ${PROGRAM_ID.toBase58()}`);

  const subId = connection.onLogs(
    PROGRAM_ID,
    (logInfo, ctx) => {
      if (logInfo.err) return;

      for (const event of eventParser.parseLogs(logInfo.logs)) {
        handleEvent(event.name, event.data, ctx.slot).catch((err) =>
          console.error(`[Listener] Event handler error:`, err.message)
        );
      }
    },
    "confirmed"
  );

  console.log(`[Listener] ✅ Subscribed (id: ${subId})`);
  return subId;
}

// ─── Reserve Updater ──────────────────────────────────────────────
// Periodically re-syncs reserves from chain (vault balances change with every trade)

async function updateReserves() {
  try {
    const { data: markets } = await supabase
      .from("markets")
      .select("pubkey, side_a_pubkey, side_b_pubkey")
      .in("status", ["active", "twap"]);

    if (!markets || markets.length === 0) return;

    const program = getProgram();

    for (const m of markets) {
      try {
        const sideA = await program.account.side.fetch(new PublicKey(m.side_a_pubkey));
        const sideB = await program.account.side.fetch(new PublicKey(m.side_b_pubkey));

        const vA = await connection.getTokenAccountBalance(sideA.quoteReserveVault);
        const vB = await connection.getTokenAccountBalance(sideB.quoteReserveVault);

        await upsertMarket({
          pubkey: m.pubkey,
          reserve_a: Number(vA.value.amount),
          reserve_b: Number(vB.value.amount),
          circulating_a: sideA.circulatingSupply.toNumber(),
          circulating_b: sideB.circulatingSupply.toNumber(),
        });
      } catch { }
    }
  } catch (err: any) {
    console.error("[Reserves] Update failed:", err.message);
  }
}

// ─── Main ─────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════");
  console.log("  DUEL PROTOCOL — Supabase Indexer");
  console.log("═══════════════════════════════════════════════");
  console.log(`  RPC:      ${RPC_URL}`);
  console.log(`  Supabase: ${SUPABASE_URL}`);
  console.log(`  Program:  ${PROGRAM_ID.toBase58()}`);
  console.log("═══════════════════════════════════════════════\n");

  // 1. Full state sync from chain
  await syncAllMarkets();

  // 2. Backfill recent events
  await backfillEvents();

  // 3. Start real-time listener
  startEventListener();

  // 4. Periodic reserve updates
  setInterval(updateReserves, SYNC_INTERVAL_MS);

  console.log(`\n[Main] ✅ Indexer running. Reserve sync every ${SYNC_INTERVAL_MS / 1000}s`);
  console.log("[Main] Press Ctrl+C to stop\n");

  // Keep alive
  process.on("SIGINT", () => {
    console.log("\n[Main] Shutting down...");
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
