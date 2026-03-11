import { PublicKey } from "@solana/web3.js";
import { PROGRAM_ID } from "./constants";

/**
 * Derive the Market PDA.
 */
export function findMarketPda(
  creator: PublicKey,
  marketId: number | bigint
): [PublicKey, number] {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(marketId));
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market"), creator.toBuffer(), buf],
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
 * Derive a Quote Vault PDA (holds WSOL, USDC, etc.).
 */
export function findQuoteVaultPda(
  market: PublicKey,
  sideIndex: number
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("quote_vault"), market.toBuffer(), Buffer.from([sideIndex])],
    PROGRAM_ID
  );
}

/**
 * Derive all PDAs for a market in one call.
 */
export function deriveMarketAccounts(creator: PublicKey, marketId: number | bigint) {
  const [market] = findMarketPda(creator, marketId);
  const [sideA] = findSidePda(market, 0);
  const [sideB] = findSidePda(market, 1);
  const [mintA] = findMintPda(market, 0);
  const [mintB] = findMintPda(market, 1);
  const [tokenVaultA] = findTokenVaultPda(market, 0);
  const [tokenVaultB] = findTokenVaultPda(market, 1);
  const [quoteVaultA] = findQuoteVaultPda(market, 0);
  const [quoteVaultB] = findQuoteVaultPda(market, 1);

  return {
    market,
    sideA,
    sideB,
    mintA,
    mintB,
    tokenVaultA,
    tokenVaultB,
    quoteVaultA,
    quoteVaultB,
  };
}

// ─── DAMM v2 PDA Helpers ───────────────────────────────────────────────

import { METEORA_DAMM_V2_PROGRAM_ID, WSOL_MINT } from "./constants";

/**
 * Derive Meteora DAMM v2 pool PDA for a customizable pool.
 * Seeds: ["cpool", max_key(tokenA, tokenB), min_key(tokenA, tokenB)]
 */
export function deriveDammV2Pool(
  tokenAMint: PublicKey,
  tokenBMint: PublicKey = WSOL_MINT
): [PublicKey, number] {
  const bufA = tokenAMint.toBuffer();
  const bufB = tokenBMint.toBuffer();
  const maxKey = Buffer.compare(bufA, bufB) > 0 ? bufA : bufB;
  const minKey = Buffer.compare(bufA, bufB) > 0 ? bufB : bufA;

  return PublicKey.findProgramAddressSync(
    [Buffer.from("cpool"), maxKey, minKey],
    METEORA_DAMM_V2_PROGRAM_ID
  );
}

/**
 * Derive the DAMM v2 pool authority (constant PDA).
 */
export function deriveDammV2PoolAuthority(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pool_authority")],
    METEORA_DAMM_V2_PROGRAM_ID
  );
}

/**
 * Derive the DAMM v2 event authority PDA.
 */
export function deriveDammV2EventAuthority(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    METEORA_DAMM_V2_PROGRAM_ID
  );
}

/**
 * Derive a position address from the position NFT mint.
 * Seeds: ["position", position_nft_mint]
 */
export function derivePositionAddress(
  positionNftMint: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("position"), positionNftMint.toBuffer()],
    METEORA_DAMM_V2_PROGRAM_ID
  );
}

/**
 * Derive the position NFT token account PDA.
 * Seeds: ["position_nft_account", position_nft_mint]
 */
export function derivePositionNftAccount(
  positionNftMint: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("position_nft_account"), positionNftMint.toBuffer()],
    METEORA_DAMM_V2_PROGRAM_ID
  );
}

/**
 * Derive a DAMM v2 token vault PDA.
 * Seeds: ["token_vault", mint, pool]
 */
export function deriveDammV2TokenVault(
  pool: PublicKey,
  mint: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("token_vault"), mint.toBuffer(), pool.toBuffer()],
    METEORA_DAMM_V2_PROGRAM_ID
  );
}

/**
 * Derive all DAMM v2 PDAs needed for graduation.
 */
export function deriveDammV2Accounts(
  tokenAMint: PublicKey,
  positionNftMint: PublicKey,
  tokenBMint: PublicKey = WSOL_MINT
) {
  const [pool] = deriveDammV2Pool(tokenAMint, tokenBMint);
  const [poolAuthority] = deriveDammV2PoolAuthority();
  const [eventAuthority] = deriveDammV2EventAuthority();
  const [position] = derivePositionAddress(positionNftMint);
  const [positionNftAccount] = derivePositionNftAccount(positionNftMint);
  const [tokenAVault] = deriveDammV2TokenVault(pool, tokenAMint);
  const [tokenBVault] = deriveDammV2TokenVault(pool, tokenBMint);

  return {
    pool,
    poolAuthority,
    eventAuthority,
    position,
    positionNftAccount,
    tokenAVault,
    tokenBVault,
  };
}
