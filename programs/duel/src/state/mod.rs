pub mod market;
pub mod program_config;
pub mod side;

pub use market::*;
pub use program_config::*;
pub use side::*;

use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct CurveParams {
    /// Steepness coefficient (scaled by 10^9)
    pub a: u64,
    /// Exponent (1 = linear, 2 = quadratic, 3 = cubic)
    pub n: u8,
    /// Base price in quote token smallest units
    pub b: u64,
}
