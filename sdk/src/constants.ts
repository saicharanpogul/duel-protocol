import { PublicKey } from "@solana/web3.js";

/** Duel Protocol program ID */
export const PROGRAM_ID = new PublicKey(
  "CgR6V1AxC7exDFNoh3Q5JP9aea9YuPqq283EwACUGpZE"
);

/** Meteora DAMM v2 program ID */
export const METEORA_DAMM_V2_PROGRAM_ID = new PublicKey(
  "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG"
);

/** WSOL mint */
export const WSOL_MINT = new PublicKey(
  "So11111111111111111111111111111111111111112"
);

/** Token-2022 program ID */
export const TOKEN_2022_PROGRAM_ID = new PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
);

/** DAMM v2 pool authority (constant PDA) */
export const DAMM_V2_POOL_AUTHORITY = new PublicKey(
  "HLnpSz9hBF7wsohdFRYBzi4BNGzar3bPVq34JFsEfnY"
);

/** BPS denominator (10_000) */
export const BPS_DENOMINATOR = 10_000;

/** Maximum battle tax BPS (100%) */
export const MAX_BATTLE_TAX_BPS = 10_000;

/** Maximum protocol fee BPS */
export const MAX_PROTOCOL_FEE_BPS = 500;

/** Maximum sell penalty BPS */
export const MAX_SELL_PENALTY_BPS = 3_000;

/** Minimum TWAP interval (seconds) */
export const MIN_TWAP_INTERVAL = 10;

/** Maximum TWAP interval (seconds) */
export const MAX_TWAP_INTERVAL = 3_600;

/** Minimum graduation reserve (lamports) */
export const MIN_GRADUATION_RESERVE = 100_000_000; // 0.1 SOL

/** Meteora DAMM v2 MIN_SQRT_PRICE */
export const MIN_SQRT_PRICE = BigInt("4295048016");

/** Meteora DAMM v2 MAX_SQRT_PRICE */
export const MAX_SQRT_PRICE = BigInt("79226673521066979257578248091");
