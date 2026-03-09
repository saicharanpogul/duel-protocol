/// Max battle tax: 100% (10000 bps)
pub const MAX_BATTLE_TAX_BPS: u16 = 10_000;

/// Max protocol fee: 5% (500 bps)
pub const MAX_PROTOCOL_FEE_BPS: u16 = 500;

/// Max sell penalty: 30% (3000 bps)
pub const MAX_SELL_PENALTY_BPS: u16 = 3_000;

/// Minimum TWAP sampling interval in seconds
pub const MIN_TWAP_INTERVAL: u64 = 10;

/// Maximum TWAP sampling interval in seconds
pub const MAX_TWAP_INTERVAL: u64 = 300;

/// Base sell fee in basis points (1%)
pub const BASE_SELL_FEE_BPS: u16 = 100;

/// Basis points denominator
pub const BPS_DENOMINATOR: u64 = 10_000;

/// Scaling factor for curve parameter a (10^9)
pub const CURVE_SCALE: u128 = 1_000_000_000;

/// Minimum curve exponent
pub const MIN_CURVE_EXPONENT: u8 = 1;

/// Maximum curve exponent
pub const MAX_CURVE_EXPONENT: u8 = 3;
