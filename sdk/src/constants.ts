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

/** Metaplex Token Metadata program ID */
export const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

/** Native SOL mint (wrapped SOL) */
export { NATIVE_MINT } from "@solana/spl-token";

// ── Token Economics (hardcoded, not configurable) ───────────────────────

/** Total supply per side (1B tokens) */
export const TOTAL_SUPPLY_PER_SIDE = 1_000_000_000;

/** Token decimals (whole tokens only) */
export const TOKEN_DECIMALS = 0;

// ── Bonding Curve Constants ─────────────────────────────────────────────

/** Bonding curve steepness coefficient */
export const CURVE_A = 1;

/** Bonding curve exponent (quadratic) */
export const CURVE_N = 2;

/** Bonding curve base price in lamports */
export const CURVE_B = 1;

/** Curve scaling factor (10^9) -- matches on-chain CURVE_SCALE */
export const CURVE_SCALE = 1_000_000_000;

// ── Fees ────────────────────────────────────────────────────────────────

/** BPS denominator (10_000) */
export const BPS_DENOMINATOR = 10_000;

/** Default trade fee in basis points (1%) */
export const DEFAULT_TRADE_FEE_BPS = 100;

/** Default creator fee split in basis points (50% of trade fee) */
export const DEFAULT_CREATOR_FEE_SPLIT_BPS = 5_000;

/** Maximum trade fee in basis points (5%) */
export const MAX_TRADE_FEE_BPS = 500;

// ── TWAP ────────────────────────────────────────────────────────────────

/** Minimum TWAP interval in seconds */
export const MIN_TWAP_INTERVAL = 10;

/** Maximum TWAP interval in seconds */
export const MAX_TWAP_INTERVAL = 300;

// ── Market ──────────────────────────────────────────────────────────────

/** Minimum market duration in seconds */
export const MIN_MARKET_DURATION = 10;

/** Default emergency window in seconds (24 hours) */
export const DEFAULT_EMERGENCY_WINDOW = 86_400;

// ── Graduation ──────────────────────────────────────────────────────────

/** Graduation pool fee in basis points (0.25%) */
export const GRADUATION_POOL_FEE_BPS = 25;

/** Minimum graduation reserve in lamports (0.1 SOL) */
export const MIN_GRADUATION_RESERVE = 100_000_000;

// ── Meteora DAMM v2 ────────────────────────────────────────────────────

/** Meteora DAMM v2 MIN_SQRT_PRICE */
export const MIN_SQRT_PRICE = BigInt("4295048016");

/** Meteora DAMM v2 MAX_SQRT_PRICE */
export const MAX_SQRT_PRICE = BigInt("79226673521066979257578248091");
