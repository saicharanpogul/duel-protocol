import { Program, AnchorProvider, Idl, type Wallet } from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair, Transaction, VersionedTransaction } from "@solana/web3.js";
import IDL from "./idl.json";

export const PROGRAM_ID = new PublicKey("CgR6V1AxC7exDFNoh3Q5JP9aea9YuPqq283EwACUGpZE");
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "http://localhost:8999";

/**
 * ──────────────────────────────────────────────────
 * Typed program — one cast at the boundary; everything
 * downstream is properly typed.
 * ──────────────────────────────────────────────────
 */

/** Minimal wallet for readonly operations — satisfies Anchor's Wallet interface */
const READONLY_KEYPAIR = Keypair.generate();
const READONLY_WALLET: Wallet = {
  payer: READONLY_KEYPAIR,
  publicKey: READONLY_KEYPAIR.publicKey,
  signTransaction: <T extends Transaction | VersionedTransaction>(tx: T) => Promise.resolve(tx),
  signAllTransactions: <T extends Transaction | VersionedTransaction>(txs: T[]) => Promise.resolve(txs),
};

/**
 * Anchor's generic `Program<Idl>` doesn't expose named account namespaces.
 * Instead of casting everywhere, we type the program once with a `DuelAccounts`
 * interface that describes only what we actually use.
 */
interface AccountFetcher<T> {
  fetch(address: PublicKey): Promise<T>;
  all(): Promise<{ publicKey: PublicKey; account: T }[]>;
}

export interface DuelProgram {
  account: {
    market: AccountFetcher<MarketAccount>;
    side: AccountFetcher<SideAccount>;
    programConfig: AccountFetcher<ProgramConfigAccount>;
  };
  methods: Program["methods"];
  programId: PublicKey;
}

function createDuelProgram(provider: AnchorProvider): DuelProgram {
  const program = new Program(IDL as Idl, provider);
  // Single narrowing cast: everything returned is properly typed from here
  return program as unknown as DuelProgram;
}

export function getProgram(provider: AnchorProvider): DuelProgram {
  return createDuelProgram(provider);
}

export function getReadonlyProgram(): DuelProgram {
  const connection = new Connection(RPC_URL, "confirmed");
  const provider = new AnchorProvider(connection, READONLY_WALLET, {
    commitment: "confirmed",
  });
  return createDuelProgram(provider);
}

/* ─── Account Types ─── */

export interface MarketAccount {
  authority: PublicKey;
  sideA: PublicKey;
  sideB: PublicKey;
  tokenMintA: PublicKey | null;
  tokenMintB: PublicKey | null;
  nameA: string;
  nameB: string;
  symbolA: string;
  symbolB: string;
  deadline: { toNumber(): number };
  twapWindow: { toNumber(): number };
  twapInterval: { toNumber(): number };
  battleTaxBps: number;
  protocolFeeBps: number;
  sellPenaltyMaxBps: number;
  twapSamplesCount: number;
  winner: number | null;
  status: { active?: object; resolved?: object };
}

export interface SideAccount {
  tokenMint: PublicKey;
  quoteReserveVault: PublicKey;
  tokenReserveVault: PublicKey;
  circulatingSupply: { toNumber(): number };
}

export interface ProgramConfigAccount {
  protocolFeeAccount: PublicKey;
}

/* ─── PDA Derivations ─── */

export function findMarketPda(creator: PublicKey, marketId: bigint): PublicKey {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(marketId));
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), creator.toBuffer(), buf],
    PROGRAM_ID
  );
  return pda;
}

export function findSidePda(market: PublicKey, sideIndex: number): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("side"), market.toBuffer(), Buffer.from([sideIndex])],
    PROGRAM_ID
  );
  return pda;
}

export function findQuoteVaultPda(market: PublicKey, sideIndex: number): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("quote_vault"), market.toBuffer(), Buffer.from([sideIndex])],
    PROGRAM_ID
  );
  return pda;
}

export function findTokenVaultPda(market: PublicKey, sideIndex: number): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_vault"), market.toBuffer(), Buffer.from([sideIndex])],
    PROGRAM_ID
  );
  return pda;
}

export function findMintPda(market: PublicKey, sideIndex: number): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("mint"), market.toBuffer(), Buffer.from([sideIndex])],
    PROGRAM_ID
  );
  return pda;
}

export function findConfigPda(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    PROGRAM_ID
  );
  return pda;
}

/* ─── Market Status Helpers ─── */
export type MarketStatus = "active" | "twap" | "resolved";

export function getMarketStatus(market: MarketAccount): MarketStatus {
  if (market.status?.resolved) return "resolved";
  const now = Date.now() / 1000;
  const twapStart = Number(market.deadline) - Number(market.twapWindow);
  if (now >= twapStart && now < Number(market.deadline)) return "twap";
  return "active";
}

export function formatSol(lamports: number | bigint): string {
  return (Number(lamports) / 1e9).toFixed(4);
}

export function formatCountdown(deadline: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = deadline - now;
  if (diff <= 0) return "Ended";
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s}s`;
}
