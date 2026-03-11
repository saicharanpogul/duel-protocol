use anchor_lang::prelude::*;

#[error_code]
pub enum DuelError {
    #[msg("Market has passed its deadline")]
    MarketExpired,
    #[msg("Market has not reached its deadline yet")]
    MarketNotExpired,
    #[msg("Market is already resolved")]
    MarketAlreadyResolved,
    #[msg("Market is not resolved yet")]
    MarketNotResolved,
    #[msg("Not within TWAP observation window")]
    NotInTwapWindow,
    #[msg("TWAP sample too early, interval not elapsed")]
    TwapSampleTooEarly,
    #[msg("No TWAP samples recorded")]
    NoTwapSamples,
    #[msg("Insufficient SOL amount")]
    InsufficientSolAmount,
    #[msg("Insufficient token balance")]
    InsufficientTokenBalance,
    #[msg("Insufficient reserve for withdrawal")]
    InsufficientReserve,
    #[msg("Slippage tolerance exceeded")]
    SlippageExceeded,
    #[msg("Invalid side index")]
    InvalidSide,
    #[msg("Invalid curve parameters")]
    InvalidCurveParams,
    #[msg("Invalid market configuration")]
    InvalidMarketConfig,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Side already graduated to DEX")]
    AlreadyGraduated,
    #[msg("Insufficient reserve for DEX graduation")]
    InsufficientReserveForGraduation,
    #[msg("Side must be graduated before vault closure")]
    NotGraduated,
    #[msg("LP is permanently locked, cannot remove liquidity or close position")]
    LpLocked,
    #[msg("Protocol is paused")]
    ProtocolPaused,
    #[msg("TWAP spread below minimum threshold, resolved as draw")]
    DrawResult,
    #[msg("Invalid fee configuration")]
    InvalidFeeConfig,
    #[msg("Oracle resolution not allowed for this market")]
    OracleNotAllowed,
    #[msg("TWAP resolution not allowed for this market (oracle-only mode)")]
    TwapNotAllowed,
    #[msg("Oracle dispute window has not expired yet")]
    OracleDisputeWindowActive,
    #[msg("Unauthorized oracle authority")]
    UnauthorizedOracle,
    #[msg("Invalid winning side (must be 0 or 1)")]
    InvalidWinningSide,
}
