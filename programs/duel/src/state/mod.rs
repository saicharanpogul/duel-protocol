pub mod compare_duel;
pub mod deposit;
pub mod market;
pub mod program_config;
pub mod side;

pub use compare_duel::*;
pub use deposit::*;
pub use market::*;
pub use program_config::*;
pub use side::*;

use anchor_lang::prelude::*;

/// Bonding curve parameters. Hardcoded via constants, not user-configurable.
/// Kept as a struct for math module compatibility.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct CurveParams {
    /// Steepness coefficient (scaled by CURVE_SCALE)
    pub a: u64,
    /// Exponent (2 = quadratic)
    pub n: u8,
    /// Base price in lamports
    pub b: u64,
}

impl CurveParams {
    pub fn default_params() -> Self {
        use crate::constants::*;
        Self {
            a: CURVE_A,
            n: CURVE_N,
            b: CURVE_B,
        }
    }
}
