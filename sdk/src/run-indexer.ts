#!/usr/bin/env npx ts-node
/**
 * Duel Protocol Analytics Indexer — CLI Runner
 *
 * Usage:
 *   npx ts-node sdk/src/run-indexer.ts                    # default: localhost + backfill
 *   npx ts-node sdk/src/run-indexer.ts --rpc <URL>        # custom RPC
 *   npx ts-node sdk/src/run-indexer.ts --no-backfill      # skip backfill, listen only
 *   npx ts-node sdk/src/run-indexer.ts --limit 500        # backfill last 500 txs
 */
import { Connection } from "@solana/web3.js";
import { DuelIndexer } from "./indexer";

async function main() {
  const args = process.argv.slice(2);
  const rpcIdx = args.indexOf("--rpc");
  const rpcUrl = rpcIdx >= 0 ? args[rpcIdx + 1] : "http://localhost:8899";

  const noBackfill = args.includes("--no-backfill");
  const limitIdx = args.indexOf("--limit");
  const backfillLimit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : 1000;

  const wsUrl = rpcUrl.replace("http", "ws");
  const connection = new Connection(rpcUrl, { wsEndpoint: wsUrl, commitment: "confirmed" });

  console.log("═══════════════════════════════════════════════════");
  console.log("  Duel Protocol — Analytics Indexer");
  console.log("═══════════════════════════════════════════════════");
  console.log(`  RPC: ${rpcUrl}`);
  console.log(`  WS:  ${wsUrl}`);
  console.log("");

  const indexer = new DuelIndexer(connection);

  // Register a logger for all events
  indexer.onEvent((event, slot) => {
    const ts = new Date().toISOString();
    console.log(`[${ts}] slot=${slot} ${event.name}`, JSON.stringify(event.data, bigIntReplacer, 0).substring(0, 120));
  });

  // Backfill historical data
  if (!noBackfill) {
    await indexer.backfill(backfillLimit);
    printSnapshot(indexer);
  }

  // Start real-time listener
  await indexer.start();
  console.log("\n[Indexer] Listening for events... (Ctrl+C to stop)\n");

  // Print snapshot every 30 seconds
  const interval = setInterval(() => {
    printSnapshot(indexer);
  }, 30_000);

  // Graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\n[Indexer] Shutting down...");
    clearInterval(interval);
    await indexer.stop();
    printSnapshot(indexer);
    process.exit(0);
  });
}

function printSnapshot(indexer: DuelIndexer) {
  const snap = indexer.getSnapshot();
  console.log("\n┌─────────────────────────────────────────────────┐");
  console.log("│  Duel Protocol — Analytics Snapshot             │");
  console.log("├─────────────────────────────────────────────────┤");
  console.log(`│  Markets:       ${String(snap.global.totalMarkets).padStart(10)}            │`);
  console.log(`│  Resolved:      ${String(snap.global.marketsResolved).padStart(10)}            │`);
  console.log(`│  Buys:          ${String(snap.global.totalBuys).padStart(10)}            │`);
  console.log(`│  Sells:         ${String(snap.global.totalSells).padStart(10)}            │`);
  console.log(`│  Volume (SOL):  ${formatSol(snap.global.totalVolumeSol).padStart(10)}            │`);
  console.log(`│  Fees (SOL):    ${formatSol(snap.global.totalFees).padStart(10)}            │`);
  console.log(`│  Traders:       ${String(snap.global.uniqueTraders).padStart(10)}            │`);
  console.log(`│  Events:        ${String(snap.global.eventsProcessed).padStart(10)}            │`);
  console.log("└─────────────────────────────────────────────────┘");

  if (snap.markets.length > 0) {
    console.log("\n  Markets:");
    for (const m of snap.markets) {
      const status = m.resolved ? (m.dexPool ? "graduated" : "resolved") : "pending";
      console.log(`    ${status} ${m.market.substring(0, 8)}... | buys=${m.totalBuys} sells=${m.totalSells} vol=${formatSol(m.totalVolumeSol)} traders=${m.uniqueTraders}`);
    }
  }
}

function formatSol(lamportsStr: string): string {
  const lamports = BigInt(lamportsStr);
  const sol = Number(lamports) / 1e9;
  return sol.toFixed(4);
}

function bigIntReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

main().catch(console.error);
