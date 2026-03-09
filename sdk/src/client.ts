import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { PublicKey, Connection } from "@solana/web3.js";
import { Duel } from "../../target/types/duel";
import IDL from "../idl/duel.json";
import { PROGRAM_ID } from "./constants";

/**
 * Create a Duel Protocol program instance.
 */
export function createDuelProgram(provider: AnchorProvider): Program<Duel> {
  return new Program(IDL as any, provider);
}

/**
 * Fetch a Market account.
 */
export async function fetchMarket(
  program: Program<Duel>,
  market: PublicKey
) {
  return program.account.market.fetch(market);
}

/**
 * Fetch a Side account.
 */
export async function fetchSide(
  program: Program<Duel>,
  side: PublicKey
) {
  return program.account.side.fetch(side);
}

/**
 * Fetch all markets (optionally filtered by authority).
 */
export async function fetchAllMarkets(
  program: Program<Duel>,
  authority?: PublicKey
) {
  if (authority) {
    return program.account.market.all([
      { memcmp: { offset: 8, bytes: authority.toBase58() } },
    ]);
  }
  return program.account.market.all();
}

/**
 * Get the current price of a side's token given the side account data.
 * price = a * supply^n + b
 */
export function calculatePrice(
  circulatingSupply: number,
  curveParams: { a: number; n: number; b: number }
): number {
  const { a, n, b } = curveParams;
  return a * Math.pow(circulatingSupply, n) + b;
}
