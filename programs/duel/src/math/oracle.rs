use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::DuelError;

/// Read price, confidence, and exponent from a Pyth V2 price account.
/// Validates the magic number and returns raw values.
pub fn read_pyth_price(data: &[u8]) -> Result<(i64, u64, i32)> {
    // Pyth V2 price account must be at least 228 bytes
    require!(data.len() >= PYTH_PRICE_OFFSET + 20, DuelError::InvalidOracle);

    let magic = u32::from_le_bytes(
        data[0..4].try_into().map_err(|_| DuelError::InvalidOracle)?,
    );
    require!(magic == PYTH_PRICE_MAGIC, DuelError::InvalidOracle);

    let price = i64::from_le_bytes(
        data[PYTH_PRICE_OFFSET..PYTH_PRICE_OFFSET + 8]
            .try_into()
            .map_err(|_| DuelError::InvalidOracle)?,
    );
    let conf = u64::from_le_bytes(
        data[PYTH_PRICE_OFFSET + 8..PYTH_PRICE_OFFSET + 16]
            .try_into()
            .map_err(|_| DuelError::InvalidOracle)?,
    );
    let expo = i32::from_le_bytes(
        data[PYTH_PRICE_OFFSET + 16..PYTH_PRICE_OFFSET + 20]
            .try_into()
            .map_err(|_| DuelError::InvalidOracle)?,
    );

    Ok((price, conf, expo))
}

/// Validate oracle price: must be positive, confidence within bounds.
pub fn validate_pyth_price(price: i64, conf: u64) -> Result<()> {
    require!(price > 0, DuelError::InvalidOracle);

    // Confidence must be <= MAX_CONFIDENCE_PCT% of price
    let price_abs = price.unsigned_abs();
    let max_conf = price_abs
        .checked_mul(MAX_CONFIDENCE_PCT)
        .ok_or(DuelError::MathOverflow)?
        / 100;
    require!(conf <= max_conf, DuelError::OracleConfidenceTooWide);

    Ok(())
}

/// Scale a Pyth price (with exponent) to u64 with 10^9 precision.
/// For example: price=2500, expo=-2 means $25.00
/// We scale to: 25 * 10^9 = 25_000_000_000
pub fn scale_price(price: i64, expo: i32) -> Result<u64> {
    require!(price > 0, DuelError::InvalidOracle);
    let p = price as u64;

    if expo >= 0 {
        // Price already in whole units, scale up by 10^expo * 10^9
        let factor = 10u64
            .checked_pow(expo as u32)
            .ok_or(DuelError::MathOverflow)?;
        p.checked_mul(factor)
            .and_then(|v| v.checked_mul(PRICE_SCALE))
            .ok_or_else(|| error!(DuelError::MathOverflow))
    } else {
        let abs_expo = (-expo) as u32;
        if abs_expo <= 9 {
            // Scale: price * 10^(9 - abs_expo)
            let factor = 10u64
                .checked_pow(9 - abs_expo)
                .ok_or(DuelError::MathOverflow)?;
            p.checked_mul(factor)
                .ok_or_else(|| error!(DuelError::MathOverflow))
        } else {
            // abs_expo > 9: need to divide
            let divisor = 10u64
                .checked_pow(abs_expo - 9)
                .ok_or(DuelError::MathOverflow)?;
            Ok(p / divisor)
        }
    }
}

/// Read and validate a Pyth oracle account, returning the scaled price.
pub fn get_oracle_price(oracle_data: &[u8]) -> Result<u64> {
    let (price, conf, expo) = read_pyth_price(oracle_data)?;
    validate_pyth_price(price, conf)?;
    scale_price(price, expo)
}
