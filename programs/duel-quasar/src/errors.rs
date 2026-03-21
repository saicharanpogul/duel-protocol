use quasar_lang::prelude::*;

#[error_code]
pub enum DuelError {
    MarketExpired,
    MarketNotExpired,
    MarketAlreadyResolved,
    MarketNotResolved,
    NotInTwapWindow,
    TwapSampleTooEarly,
    NoTwapSamples,
    InsufficientSolAmount,
    InsufficientTokenBalance,
    InsufficientReserve,
    SlippageExceeded,
    InvalidSide,
    InvalidMarketConfig,
    MathOverflow,
    ProtocolPaused,
    InvalidFeeConfig,
    ReentrancyLocked,
    EmergencyResolveTooEarly,
    WinnerMismatch,
    EmergencyOnlyOperation,
    InsufficientReserveForGraduation,
}
