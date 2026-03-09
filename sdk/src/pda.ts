import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { PROGRAM_ID } from "./constants";

/**
 * Derive the Market PDA.
 */
export function findMarketPda(
  creator: PublicKey,
  marketId: BN | number
): [PublicKey, number] {
  const id = BN.isBN(marketId) ? marketId : new BN(marketId);
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("market"),
      creator.toBuffer(),
      id.toArrayLike(Buffer, "le", 8),
    ],
    PROGRAM_ID
  );
}

/**
 * Derive a Side PDA.
 * @param sideIndex 0 for Side A, 1 for Side B
 */
export function findSidePda(
  market: PublicKey,
  sideIndex: number
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("side"), market.toBuffer(), Buffer.from([sideIndex])],
    PROGRAM_ID
  );
}

/**
 * Derive a Token Mint PDA.
 */
export function findMintPda(
  market: PublicKey,
  sideIndex: number
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("mint"), market.toBuffer(), Buffer.from([sideIndex])],
    PROGRAM_ID
  );
}

/**
 * Derive a Token Vault PDA.
 */
export function findTokenVaultPda(
  market: PublicKey,
  sideIndex: number
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("token_vault"), market.toBuffer(), Buffer.from([sideIndex])],
    PROGRAM_ID
  );
}

/**
 * Derive a SOL Vault PDA.
 */
export function findSolVaultPda(
  market: PublicKey,
  sideIndex: number
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("sol_vault"), market.toBuffer(), Buffer.from([sideIndex])],
    PROGRAM_ID
  );
}

/**
 * Derive all PDAs for a market in one call.
 */
export function deriveMarketAccounts(creator: PublicKey, marketId: BN | number) {
  const [market] = findMarketPda(creator, marketId);
  const [sideA] = findSidePda(market, 0);
  const [sideB] = findSidePda(market, 1);
  const [mintA] = findMintPda(market, 0);
  const [mintB] = findMintPda(market, 1);
  const [tokenVaultA] = findTokenVaultPda(market, 0);
  const [tokenVaultB] = findTokenVaultPda(market, 1);
  const [solVaultA] = findSolVaultPda(market, 0);
  const [solVaultB] = findSolVaultPda(market, 1);

  return {
    market,
    sideA,
    sideB,
    mintA,
    mintB,
    tokenVaultA,
    tokenVaultB,
    solVaultA,
    solVaultB,
  };
}
