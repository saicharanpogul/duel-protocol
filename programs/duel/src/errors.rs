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
    #[msg("Invalid market configuration")]
    InvalidMarketConfig,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Protocol is paused")]
    ProtocolPaused,
    #[msg("Invalid fee configuration")]
    InvalidFeeConfig,
    #[msg("Market is currently locked (re-entrancy protection)")]
    ReentrancyLocked,
    #[msg("Emergency resolution window has not passed yet")]
    EmergencyResolveTooEarly,
    #[msg("Expected winner does not match TWAP result")]
    WinnerMismatch,
    #[msg("This operation is only available for emergency-resolved (draw) markets")]
    EmergencyOnlyOperation,
    #[msg("Insufficient reserve for DEX graduation (minimum 0.1 SOL)")]
    InsufficientReserveForGraduation,
}
