import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import IDL from "./idl.json";

export const PROGRAM_ID = new PublicKey("CgR6V1AxC7exDFNoh3Q5JP9aea9YuPqq283EwACUGpZE");
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "http://localhost:8999";

export function getProgram(provider: AnchorProvider) {
  return new Program(IDL as any, provider);
}

export function getReadonlyProgram() {
  const connection = new Connection(RPC_URL, "confirmed");
  // Readonly provider (no wallet)
  const provider = new AnchorProvider(connection, {} as any, {
    commitment: "confirmed",
  });
  return new Program(IDL as any, provider);
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

export function getMarketStatus(market: any): MarketStatus {
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
