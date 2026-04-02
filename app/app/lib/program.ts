import { Program, AnchorProvider, Idl, type Wallet } from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair, Transaction, VersionedTransaction } from "@solana/web3.js";
import IDL from "./idl.json";

export const PROGRAM_ID = new PublicKey("3kzt4Q7xN2RLzYYx2HfnqZVoAHFAKKa17hTDvXsy1PQ9");
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";

// Hardcoded curve constants (match program)
export const CURVE_A = 1;
export const CURVE_N = 2;
export const CURVE_B = 1;
export const CURVE_SCALE = 1_000_000_000; // 10^9
export const TOTAL_SUPPLY = 1_000_000_000; // 1B tokens, 0 decimals
export const TRADE_FEE_BPS = 100; // 1%
export const BPS_DENOMINATOR = 10_000;

const READONLY_KEYPAIR = Keypair.generate();
const READONLY_WALLET: Wallet = {
  payer: READONLY_KEYPAIR,
  publicKey: READONLY_KEYPAIR.publicKey,
  signTransaction: <T extends Transaction | VersionedTransaction>(tx: T) => Promise.resolve(tx),
  signAllTransactions: <T extends Transaction | VersionedTransaction>(txs: T[]) => Promise.resolve(txs),
};

interface AccountFetcher<T> {
  fetch(address: PublicKey): Promise<T>;
  all(): Promise<{ publicKey: PublicKey; account: T }[]>;
}

export interface DuelProgram {
  account: {
    market: AccountFetcher<MarketAccount>;
    side: AccountFetcher<SideAccount>;
    programConfig: AccountFetcher<ProgramConfigAccount>;
    compareDuel: AccountFetcher<CompareDuelAccount>;
    deposit: AccountFetcher<DepositAccount>;
  };
  methods: Program["methods"];
  programId: PublicKey;
}

function createDuelProgram(provider: AnchorProvider): DuelProgram {
  const program = new Program(IDL as Idl, provider);
  return program as unknown as DuelProgram;
}

export function getProgram(provider: AnchorProvider): DuelProgram {
  return createDuelProgram(provider);
}

export function getReadonlyProgram(): DuelProgram {
  const connection = new Connection(RPC_URL, "confirmed");
  const provider = new AnchorProvider(connection, READONLY_WALLET, { commitment: "confirmed" });
  return createDuelProgram(provider);
}

/* Account types (match refactored program) */

export interface MarketAccount {
  version: number;
  bump: number;
  authority: PublicKey;
  marketId: { toNumber(): number };
  sideA: PublicKey;
  sideB: PublicKey;
  quoteMint: PublicKey;
  deadline: { toNumber(): number };
  twapWindow: { toNumber(): number };
  twapInterval: { toNumber(): number };
  creatorFeeAccount: PublicKey;
  protocolFeeAccount: PublicKey;
  status: { active?: object; twapObservation?: object; resolved?: object };
  twapSamplesCount: number;
  lastSampleTs: { toNumber(): number };
  winner: number | null;
  finalTwapA: { toNumber(): number };
  finalTwapB: { toNumber(): number };
  emergencyWindow: { toNumber(): number };
  locked: boolean;
}

export interface SideAccount {
  market: PublicKey;
  sideIndex: number;
  tokenMint: PublicKey;
  tokenReserveVault: PublicKey;
  quoteReserveVault: PublicKey;
  totalSupply: { toNumber(): number };
  circulatingSupply: { toNumber(): number };
  twapAccumulator: { toNumber(): number };
  bump: number;
}

export interface ProgramConfigAccount {
  admin: PublicKey;
  paused: boolean;
  protocolFeeAccount: PublicKey;
  marketCreationFee: { toNumber(): number };
  minMarketDuration: { toNumber(): number };
  tradeFeeBps: number;
  creatorFeeSplitBps: number;
  bump: number;
}

/* PDA derivations */

export function findMarketPda(creator: PublicKey, marketId: bigint | number): PublicKey {
  const bn = new (require("bn.js"))(marketId.toString());
  const buf = bn.toArrayLike(Buffer, "le", 8);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market"), creator.toBuffer(), buf],
    PROGRAM_ID
  )[0];
}

export function findSidePda(market: PublicKey, sideIndex: number): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("side"), market.toBuffer(), Buffer.from([sideIndex])],
    PROGRAM_ID
  )[0];
}

export function findQuoteVaultPda(market: PublicKey, sideIndex: number): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("quote_vault"), market.toBuffer(), Buffer.from([sideIndex])],
    PROGRAM_ID
  )[0];
}

export function findTokenVaultPda(market: PublicKey, sideIndex: number): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("token_vault"), market.toBuffer(), Buffer.from([sideIndex])],
    PROGRAM_ID
  )[0];
}

export function findMintPda(market: PublicKey, sideIndex: number): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("mint"), market.toBuffer(), Buffer.from([sideIndex])],
    PROGRAM_ID
  )[0];
}

export function findConfigPda(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    PROGRAM_ID
  )[0];
}

export const TOKEN_METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

export function findMetadataPda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), TOKEN_METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    TOKEN_METADATA_PROGRAM_ID
  )[0];
}

/* Market status */

export type MarketPhase = "active" | "twap" | "resolved";

export function getMarketPhase(market: MarketAccount): MarketPhase {
  if (market.status?.resolved) return "resolved";
  const now = Date.now() / 1000;
  const deadline = market.deadline.toNumber();
  const twapStart = deadline - market.twapWindow.toNumber();
  if (now >= twapStart && now < deadline) return "twap";
  if (now >= deadline) return "resolved"; // past deadline but not yet resolved on-chain
  return "active";
}

/* Bonding curve math (client-side, matches on-chain) */

export function calculatePrice(circulatingSupply: number): number {
  // price(k) = a * k^2 / CURVE_SCALE + b
  const k = circulatingSupply;
  return Math.floor((CURVE_A * k * k) / CURVE_SCALE + CURVE_B);
}

export function calculateSentiment(reserveA: number, reserveB: number): number {
  const total = reserveA + reserveB;
  if (total === 0) return 0.5;
  return reserveA / total;
}

/* Formatting */

export function formatSol(lamports: number | bigint): string {
  const sol = Number(lamports) / 1e9;
  if (sol >= 1000) return `${(sol / 1000).toFixed(1)}K`;
  if (sol >= 1) return sol.toFixed(2);
  if (sol >= 0.01) return sol.toFixed(3);
  return sol.toFixed(4);
}

export function formatTokens(amount: number): string {
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(1)}K`;
  return amount.toLocaleString();
}

export function formatCountdown(deadline: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = deadline - now;
  if (diff <= 0) return "Ended";
  const d = Math.floor(diff / 86400);
  const h = Math.floor((diff % 86400) / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function shortenAddress(addr: string, chars = 4): string {
  return `${addr.slice(0, chars)}...${addr.slice(-chars)}`;
}

/* ================================================================ */
/*  Mode 2 (Compare Duel) types                                      */
/* ================================================================ */

export interface CompareDuelAccount {
  version: number;
  bump: number;
  authority: PublicKey;
  duelId: { toNumber(): number };
  tokenAMint: PublicKey;
  tokenBMint: PublicKey;
  oracleA: PublicKey;
  oracleB: PublicKey;
  poolVaultA: PublicKey;
  poolVaultB: PublicKey;
  sideATotal: { toNumber(): number };
  sideBTotal: { toNumber(): number };
  deadline: { toNumber(): number };
  twapWindow: { toNumber(): number };
  twapInterval: { toNumber(): number };
  startPriceA: { toNumber(): number };
  startPriceB: { toNumber(): number };
  twapAccumulatorA: { toNumber(): number };
  twapAccumulatorB: { toNumber(): number };
  twapSamplesCount: number;
  lastSampleTs: { toNumber(): number };
  status: { active?: object; twapObservation?: object; resolved?: object };
  winner: number | null;
  netPool: { toNumber(): number };
  minDeposit: { toNumber(): number };
  creatorFeeAccount: PublicKey;
  protocolFeeAccount: PublicKey;
  emergencyWindow: { toNumber(): number };
}

export interface DepositAccount {
  duel: PublicKey;
  depositor: PublicKey;
  side: number;
  amount: { toNumber(): number };
  withdrawn: boolean;
  bump: number;
}

/* Mode 2 PDA derivations */

export function findCompareDuelPda(creator: PublicKey, duelId: bigint | number): PublicKey {
  const bn = new (require("bn.js"))(duelId.toString());
  const buf = bn.toArrayLike(Buffer, "le", 8);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("compare_duel"), creator.toBuffer(), buf],
    PROGRAM_ID
  )[0];
}

export function findCompareVaultPda(compareDuel: PublicKey, sideIndex: number): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("compare_vault"), compareDuel.toBuffer(), Buffer.from([sideIndex])],
    PROGRAM_ID
  )[0];
}

export function findDepositPda(compareDuel: PublicKey, depositor: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("deposit"), compareDuel.toBuffer(), depositor.toBuffer()],
    PROGRAM_ID
  )[0];
}

/* Mode 2 status helper */

export type ComparePhase = "active" | "twap" | "resolved";

export function getComparePhase(duel: CompareDuelAccount): ComparePhase {
  if (duel.status?.resolved) return "resolved";
  const now = Date.now() / 1000;
  const deadline = duel.deadline.toNumber();
  const twapStart = deadline - duel.twapWindow.toNumber();
  if (now >= twapStart && now < deadline) return "twap";
  if (now >= deadline) return "resolved";
  return "active";
}

/* Known token oracle mapping for Mode 2 */

export const KNOWN_TOKENS: Record<string, { symbol: string; mint: string; oracle: string }> = {
  SOL: {
    symbol: "SOL",
    mint: "So11111111111111111111111111111111111111112",
    oracle: "H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG",
  },
  BONK: {
    symbol: "BONK",
    mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    oracle: "8ihFLu5FimgTQ1Unh4dVyEHUGodJ5gJQCR9BMy3NKCQ5",
  },
  WIF: {
    symbol: "WIF",
    mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
    oracle: "6ABgrEZk8urs6kJ1JNdC1sspH5zKXRqxy8sg3ZG2cQps",
  },
  JUP: {
    symbol: "JUP",
    mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
    oracle: "g6eRCbboSwK4tSWngn773RCMexr1APQr4uA9bGZBYfo",
  },
  RENDER: {
    symbol: "RENDER",
    mint: "rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof",
    oracle: "HAm5DZhrgrWa12heKSNj4fLvoAuJR4M8pMridwRGE8Sn",
  },
};

export function getTokenSymbolFromMint(mint: string): string | null {
  for (const [, info] of Object.entries(KNOWN_TOKENS)) {
    if (info.mint === mint) return info.symbol;
  }
  return null;
}
