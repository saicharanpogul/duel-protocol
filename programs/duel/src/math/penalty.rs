use crate::constants::{BASE_SELL_FEE_BPS, BPS_DENOMINATOR};
use crate::errors::DuelError;
use anchor_lang::prelude::*;

/// Calculate sell penalty rate in basis points.
/// penalty = base_fee + max_penalty * (1 - r/r_peak)^2
/// All math in u128 with BPS precision.
pub fn sell_penalty_bps(
    current_reserve: u64,
    peak_reserve: u64,
    max_penalty_bps: u16,
) -> Result<u16> {
    if peak_reserve == 0 {
        return Ok(BASE_SELL_FEE_BPS);
    }

    let r = current_reserve as u128;
    let r_peak = peak_reserve as u128;

    // ratio = r / r_peak (in BPS)
    let ratio_bps = r
        .checked_mul(BPS_DENOMINATOR as u128)
        .ok_or(DuelError::MathOverflow)?
        .checked_div(r_peak)
        .ok_or(DuelError::MathOverflow)?;

    // deficit = (1 - r/r_peak) in BPS = BPS_DENOMINATOR - ratio_bps
    let deficit_bps = (BPS_DENOMINATOR as u128)
        .saturating_sub(ratio_bps);

    // penalty_component = max_penalty * deficit^2 / BPS_DENOMINATOR
    let penalty_component = (max_penalty_bps as u128)
        .checked_mul(deficit_bps)
        .ok_or(DuelError::MathOverflow)?
        .checked_mul(deficit_bps)
        .ok_or(DuelError::MathOverflow)?
        .checked_div(BPS_DENOMINATOR as u128)
        .ok_or(DuelError::MathOverflow)?
        .checked_div(BPS_DENOMINATOR as u128)
        .ok_or(DuelError::MathOverflow)?;

    let total = (BASE_SELL_FEE_BPS as u128)
        .checked_add(penalty_component)
        .ok_or(DuelError::MathOverflow)?;

    // Cap at BPS_DENOMINATOR (100%)
    let capped = total.min(BPS_DENOMINATOR as u128);

    Ok(capped as u16)
}

/// Apply sell penalty to a SOL amount.
/// Returns SOL after penalty deduction.
pub fn apply_sell_penalty(
    sol_amount: u64,
    penalty_bps: u16,
) -> Result<u64> {
    let remaining_bps = (BPS_DENOMINATOR as u64)
        .checked_sub(penalty_bps as u64)
        .ok_or(DuelError::MathOverflow)?;

    let result = (sol_amount as u128)
        .checked_mul(remaining_bps as u128)
        .ok_or(DuelError::MathOverflow)?
        .checked_div(BPS_DENOMINATOR as u128)
        .ok_or(DuelError::MathOverflow)?;

    Ok(result as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_penalty_at_peak() {
        // At peak reserve, penalty = base_fee only
        let penalty = sell_penalty_bps(1000, 1000, 1500).unwrap();
        assert_eq!(penalty, BASE_SELL_FEE_BPS); // 100 bps (1%)
    }

    #[test]
    fn test_penalty_at_zero_reserve() {
        // At zero reserve, penalty = base_fee + max_penalty
        let penalty = sell_penalty_bps(0, 1000, 1500).unwrap();
        assert_eq!(penalty, BASE_SELL_FEE_BPS + 1500); // 100 + 1500 = 1600 bps
    }

    #[test]
    fn test_penalty_at_half_reserve() {
        // At 50% of peak: deficit = 0.5, penalty = base + max * 0.25
        let penalty = sell_penalty_bps(500, 1000, 1600).unwrap();
        // deficit_bps = 5000, deficit^2/BPS^2 = 25000000/100000000 = 0.25
        // penalty_component = 1600 * 0.25 = 400
        // total = 100 + 400 = 500
        assert_eq!(penalty, 500);
    }

    #[test]
    fn test_apply_penalty() {
        let result = apply_sell_penalty(10_000, 500).unwrap(); // 5% penalty
        assert_eq!(result, 9_500);
    }

    #[test]
    fn test_penalty_zero_peak() {
        let penalty = sell_penalty_bps(0, 0, 1500).unwrap();
        assert_eq!(penalty, BASE_SELL_FEE_BPS);
    }
}
