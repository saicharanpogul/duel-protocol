import {
  Connection,
  PublicKey,
  Logs,
  Context,
} from "@solana/web3.js";
import { BorshCoder, EventParser, Program, Event } from "@coral-xyz/anchor";
import { Duel } from "../../target/types/duel";
import IDL from "../idl/duel.json";
import { PROGRAM_ID } from "./constants";

// ─── Event Types ───────────────────────────────────────────────────────

export interface MarketCreatedEvent {
  market: PublicKey;
  authority: PublicKey;
  deadline: bigint;
  battleTaxBps: number;
}

export interface TokensBoughtEvent {
  market: PublicKey;
  side: number;
  buyer: PublicKey;
  solAmount: bigint;
  tokensReceived: bigint;
  newPrice: bigint;
}

export interface TokensSoldEvent {
  market: PublicKey;
  side: number;
  seller: PublicKey;
  tokenAmount: bigint;
  solReceived: bigint;
  penaltyApplied: bigint;
  newPrice: bigint;
}

export interface TwapSampledEvent {
  market: PublicKey;
  priceA: bigint;
  priceB: bigint;
  sampleCount: number;
  timestamp: bigint;
}

export interface MarketResolvedEvent {
  market: PublicKey;
  winner: number;
  finalTwapA: bigint;
  finalTwapB: bigint;
  transferAmount: bigint;
  protocolFee: bigint;
}

export interface TokensGraduatedEvent {
  market: PublicKey;
  side: number;
  dexPool: PublicKey;
  solSeeded: bigint;
  tokensSeeded: bigint;
}

export type DuelEvent =
  | { name: "MarketCreated"; data: MarketCreatedEvent }
  | { name: "TokensBought"; data: TokensBoughtEvent }
  | { name: "TokensSold"; data: TokensSoldEvent }
  | { name: "TwapSampled"; data: TwapSampledEvent }
  | { name: "MarketResolved"; data: MarketResolvedEvent }
  | { name: "TokensGraduated"; data: TokensGraduatedEvent };

// ─── Analytics State ───────────────────────────────────────────────────

export interface MarketAnalytics {
  market: string;
  authority: string;
  deadline: number;
  battleTaxBps: number;
  createdAt: number; // unix timestamp when we saw the event
  totalBuys: number;
  totalSells: number;
  totalVolumeSol: bigint;
  totalTokensTraded: bigint;
  totalPenalties: bigint;
  uniqueTraders: Set<string>;
  twapSamples: number;
  resolved: boolean;
  winner: number | null;
  finalTwapA: bigint | null;
  finalTwapB: bigint | null;
  protocolFee: bigint | null;
  battleTaxCollected: bigint | null;
  graduated: { side: number; dexPool: string; solSeeded: bigint; tokensSeeded: bigint }[];
  priceHistory: { side: number; price: bigint; timestamp: number }[];
}

export interface GlobalAnalytics {
  totalMarkets: number;
  totalBuys: number;
  totalSells: number;
  totalVolumeSol: bigint;
  totalProtocolFees: bigint;
  totalPenalties: bigint;
  totalGraduations: number;
  marketsResolved: number;
  uniqueTraders: Set<string>;
  eventsProcessed: number;
}

// ─── Indexer Service ───────────────────────────────────────────────────

export type EventCallback = (event: DuelEvent, slot: number) => void;

export class DuelIndexer {
  private connection: Connection;
  private eventParser: EventParser;
  private subscriptionId: number | null = null;
  private callbacks: EventCallback[] = [];

  /** Per-market analytics */
  public markets: Map<string, MarketAnalytics> = new Map();

  /** Global aggregate analytics */
  public global: GlobalAnalytics = {
    totalMarkets: 0,
    totalBuys: 0,
    totalSells: 0,
    totalVolumeSol: BigInt(0),
    totalProtocolFees: BigInt(0),
    totalPenalties: BigInt(0),
    totalGraduations: 0,
    marketsResolved: 0,
    uniqueTraders: new Set(),
    eventsProcessed: 0,
  };

  constructor(connection: Connection) {
    this.connection = connection;
    const coder = new BorshCoder(IDL as any);
    this.eventParser = new EventParser(PROGRAM_ID, coder);
  }

  /**
   * Register a callback for all parsed events.
   */
  onEvent(callback: EventCallback): void {
    this.callbacks.push(callback);
  }

  /**
   * Parse events from raw transaction logs.
   * Useful for backfilling historical data.
   */
  parseEvents(logs: string[]): DuelEvent[] {
    const events: DuelEvent[] = [];
    for (const event of this.eventParser.parseLogs(logs)) {
      const mapped = this.mapEvent(event);
      if (mapped) events.push(mapped);
    }
    return events;
  }

  /**
   * Process a batch of events and update analytics.
   */
  processEvents(events: DuelEvent[], slot: number): void {
    for (const event of events) {
      this.updateAnalytics(event);
      this.global.eventsProcessed++;
      for (const cb of this.callbacks) {
        cb(event, slot);
      }
    }
  }

  /**
   * Start subscribing to on-chain logs via WebSocket.
   * Events are parsed and analytics updated in real-time.
   */
  async start(): Promise<void> {
    if (this.subscriptionId !== null) {
      console.warn("Indexer already running");
      return;
    }

    console.log(`[DuelIndexer] Subscribing to program: ${PROGRAM_ID.toBase58()}`);

    this.subscriptionId = this.connection.onLogs(
      PROGRAM_ID,
      (logInfo: Logs, ctx: Context) => {
        if (logInfo.err) return; // skip failed txs

        const events = this.parseEvents(logInfo.logs);
        this.processEvents(events, ctx.slot);
      },
      "confirmed"
    );

    console.log(`[DuelIndexer] Listening (subscription #${this.subscriptionId})`);
  }

  /**
   * Stop the WebSocket subscription.
   */
  async stop(): Promise<void> {
    if (this.subscriptionId !== null) {
      await this.connection.removeOnLogsListener(this.subscriptionId);
      this.subscriptionId = null;
      console.log("[DuelIndexer] Stopped");
    }
  }

  /**
   * Backfill analytics by fetching confirmed signatures for the program.
   * @param limit - Maximum number of transactions to fetch
   */
  async backfill(limit = 1000): Promise<number> {
    console.log(`[DuelIndexer] Backfilling last ${limit} transactions...`);

    const signatures = await this.connection.getSignaturesForAddress(
      PROGRAM_ID,
      { limit },
      "confirmed"
    );

    let processed = 0;

    // Process in batches of 20 to avoid rate limits
    for (let i = 0; i < signatures.length; i += 20) {
      const batch = signatures.slice(i, i + 20);

      const txs = await this.connection.getTransactions(
        batch.map((s) => s.signature),
        { commitment: "confirmed", maxSupportedTransactionVersion: 0 }
      );

      for (const tx of txs) {
        if (!tx || !tx.meta || tx.meta.err) continue;

        const logs = tx.meta.logMessages || [];
        const events = this.parseEvents(logs);
        this.processEvents(events, tx.slot);
        processed += events.length;
      }
    }

    console.log(`[DuelIndexer] Backfill complete: ${processed} events from ${signatures.length} txs`);
    return processed;
  }

  /**
   * Get a snapshot of the current analytics state.
   */
  getSnapshot(): {
    global: {
      totalMarkets: number;
      totalBuys: number;
      totalSells: number;
      totalVolumeSol: string;
      totalProtocolFees: string;
      totalPenalties: string;
      totalGraduations: number;
      marketsResolved: number;
      uniqueTraders: number;
      eventsProcessed: number;
    };
    markets: {
      market: string;
      authority: string;
      deadline: number;
      totalBuys: number;
      totalSells: number;
      totalVolumeSol: string;
      uniqueTraders: number;
      resolved: boolean;
      winner: number | null;
      protocolFee: string | null;
      graduated: number;
    }[];
  } {
    return {
      global: {
        totalMarkets: this.global.totalMarkets,
        totalBuys: this.global.totalBuys,
        totalSells: this.global.totalSells,
        totalVolumeSol: this.global.totalVolumeSol.toString(),
        totalProtocolFees: this.global.totalProtocolFees.toString(),
        totalPenalties: this.global.totalPenalties.toString(),
        totalGraduations: this.global.totalGraduations,
        marketsResolved: this.global.marketsResolved,
        uniqueTraders: this.global.uniqueTraders.size,
        eventsProcessed: this.global.eventsProcessed,
      },
      markets: Array.from(this.markets.values()).map((m) => ({
        market: m.market,
        authority: m.authority,
        deadline: m.deadline,
        totalBuys: m.totalBuys,
        totalSells: m.totalSells,
        totalVolumeSol: m.totalVolumeSol.toString(),
        uniqueTraders: m.uniqueTraders.size,
        resolved: m.resolved,
        winner: m.winner,
        protocolFee: m.protocolFee?.toString() ?? null,
        graduated: m.graduated.length,
      })),
    };
  }

  // ─── Internal ──────────────────────────────────────────────────────────

  private mapEvent(event: Event): DuelEvent | null {
    switch (event.name) {
      case "MarketCreated":
        return { name: "MarketCreated", data: event.data as any };
      case "TokensBought":
        return { name: "TokensBought", data: event.data as any };
      case "TokensSold":
        return { name: "TokensSold", data: event.data as any };
      case "TwapSampled":
        return { name: "TwapSampled", data: event.data as any };
      case "MarketResolved":
        return { name: "MarketResolved", data: event.data as any };
      case "TokensGraduated":
        return { name: "TokensGraduated", data: event.data as any };
      default:
        return null;
    }
  }

  private getOrCreateMarket(marketKey: string): MarketAnalytics {
    if (!this.markets.has(marketKey)) {
      this.markets.set(marketKey, {
        market: marketKey,
        authority: "",
        deadline: 0,
        battleTaxBps: 0,
        createdAt: Math.floor(Date.now() / 1000),
        totalBuys: 0,
        totalSells: 0,
        totalVolumeSol: BigInt(0),
        totalTokensTraded: BigInt(0),
        totalPenalties: BigInt(0),
        uniqueTraders: new Set(),
        twapSamples: 0,
        resolved: false,
        winner: null,
        finalTwapA: null,
        finalTwapB: null,
        protocolFee: null,
        battleTaxCollected: null,
        graduated: [],
        priceHistory: [],
      });
    }
    return this.markets.get(marketKey)!;
  }

  private updateAnalytics(event: DuelEvent): void {
    const now = Math.floor(Date.now() / 1000);

    switch (event.name) {
      case "MarketCreated": {
        const d = event.data;
        const m = this.getOrCreateMarket(d.market.toBase58());
        m.authority = d.authority.toBase58();
        m.deadline = Number(d.deadline);
        m.battleTaxBps = d.battleTaxBps;
        m.createdAt = now;
        this.global.totalMarkets++;
        break;
      }

      case "TokensBought": {
        const d = event.data;
        const marketKey = d.market.toBase58();
        const m = this.getOrCreateMarket(marketKey);
        m.totalBuys++;
        m.totalVolumeSol += BigInt(d.solAmount.toString());
        m.totalTokensTraded += BigInt(d.tokensReceived.toString());
        m.uniqueTraders.add(d.buyer.toBase58());
        m.priceHistory.push({
          side: d.side,
          price: BigInt(d.newPrice.toString()),
          timestamp: now,
        });

        this.global.totalBuys++;
        this.global.totalVolumeSol += BigInt(d.solAmount.toString());
        this.global.uniqueTraders.add(d.buyer.toBase58());
        break;
      }

      case "TokensSold": {
        const d = event.data;
        const marketKey = d.market.toBase58();
        const m = this.getOrCreateMarket(marketKey);
        m.totalSells++;
        m.totalVolumeSol += BigInt(d.solReceived.toString());
        m.totalTokensTraded += BigInt(d.tokenAmount.toString());
        m.totalPenalties += BigInt(d.penaltyApplied.toString());
        m.uniqueTraders.add(d.seller.toBase58());
        m.priceHistory.push({
          side: d.side,
          price: BigInt(d.newPrice.toString()),
          timestamp: now,
        });

        this.global.totalSells++;
        this.global.totalVolumeSol += BigInt(d.solReceived.toString());
        this.global.totalPenalties += BigInt(d.penaltyApplied.toString());
        this.global.uniqueTraders.add(d.seller.toBase58());
        break;
      }

      case "TwapSampled": {
        const d = event.data;
        const m = this.getOrCreateMarket(d.market.toBase58());
        m.twapSamples++;
        break;
      }

      case "MarketResolved": {
        const d = event.data;
        const m = this.getOrCreateMarket(d.market.toBase58());
        m.resolved = true;
        m.winner = d.winner;
        m.finalTwapA = BigInt(d.finalTwapA.toString());
        m.finalTwapB = BigInt(d.finalTwapB.toString());
        m.protocolFee = BigInt(d.protocolFee.toString());
        m.battleTaxCollected = BigInt(d.transferAmount.toString());

        this.global.marketsResolved++;
        this.global.totalProtocolFees += BigInt(d.protocolFee.toString());
        break;
      }

      case "TokensGraduated": {
        const d = event.data;
        const m = this.getOrCreateMarket(d.market.toBase58());
        m.graduated.push({
          side: d.side,
          dexPool: d.dexPool.toBase58(),
          solSeeded: BigInt(d.solSeeded.toString()),
          tokensSeeded: BigInt(d.tokensSeeded.toString()),
        });

        this.global.totalGraduations++;
        break;
      }
    }
  }
}
