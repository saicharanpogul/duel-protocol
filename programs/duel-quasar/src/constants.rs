// Token economics (hardcoded, not configurable)
pub const TOTAL_SUPPLY_PER_SIDE: u64 = 1_000_000_000; // 1B tokens per side
pub const TOKEN_DECIMALS: u8 = 0; // Whole tokens only

// Bonding curve: price(k) = CURVE_A * k^CURVE_N / CURVE_SCALE + CURVE_B
pub const CURVE_A: u64 = 1;
pub const CURVE_N: u8 = 2; // Quadratic
pub const CURVE_B: u64 = 1; // 1 lamport base price
pub const CURVE_SCALE: u128 = 1_000_000_000; // 10^9

// Fees (defaults, adjustable via ProgramConfig)
pub const DEFAULT_TRADE_FEE_BPS: u16 = 100; // 1% on every buy/sell
pub const DEFAULT_CREATOR_FEE_SPLIT_BPS: u16 = 5_000; // 50% of trade fee to creator
pub const MAX_TRADE_FEE_BPS: u16 = 500; // 5% max trade fee
pub const BPS_DENOMINATOR: u64 = 10_000;

// TWAP
pub const MIN_TWAP_INTERVAL: u64 = 10; // 10 seconds minimum
pub const MAX_TWAP_INTERVAL: u64 = 300; // 5 minutes maximum

// Market
pub const MIN_MARKET_DURATION: u64 = 10; // 10 seconds minimum
pub const DEFAULT_EMERGENCY_WINDOW: u64 = 86_400; // 24 hours after deadline

// Graduation
pub const MIN_GRADUATION_RESERVE: u64 = 100_000_000; // 0.1 SOL minimum to graduate
pub const GRADUATION_POOL_FEE_BPS: u16 = 25; // 0.25% Meteora pool trading fee
