use crate::constants::CURVE_SCALE;
use crate::errors::DuelError;
use crate::state::CurveParams;
use anchor_lang::prelude::*;

/// Compute k^exp using u128 arithmetic.
/// Returns result scaled by CURVE_SCALE for the steepness coefficient.
fn pow_u128(base: u128, exp: u8) -> Option<u128> {
    let mut result: u128 = 1;
    for _ in 0..exp {
        result = result.checked_mul(base)?;
    }
    Some(result)
}

/// Price at a given circulating supply.
/// price(k) = a * k^n / CURVE_SCALE + b
/// Returns price in lamports.
pub fn price(supply: u64, params: &CurveParams) -> Result<u64> {
    let k = supply as u128;
    let a = params.a as u128;
    let b = params.b as u128;

    let k_pow_n = pow_u128(k, params.n).ok_or(DuelError::MathOverflow)?;

    let term = a
        .checked_mul(k_pow_n)
        .ok_or(DuelError::MathOverflow)?
        .checked_div(CURVE_SCALE)
        .ok_or(DuelError::MathOverflow)?;

    let result = term.checked_add(b).ok_or(DuelError::MathOverflow)?;

    require!(result <= u64::MAX as u128, DuelError::MathOverflow);
    Ok(result as u64)
}

/// Reserve integral R(k) = a * k^(n+1) / ((n+1) * CURVE_SCALE) + b * k
/// Returns result in lamports (u128 for intermediate precision).
pub fn reserve_integral(supply: u64, params: &CurveParams) -> Result<u128> {
    let k = supply as u128;
    let a = params.a as u128;
    let b = params.b as u128;
    let n_plus_1 = (params.n as u128).checked_add(1).ok_or(DuelError::MathOverflow)?;

    let k_pow_n1 = pow_u128(k, params.n + 1).ok_or(DuelError::MathOverflow)?;

    let term1 = a
        .checked_mul(k_pow_n1)
        .ok_or(DuelError::MathOverflow)?
        .checked_div(
            n_plus_1
                .checked_mul(CURVE_SCALE)
                .ok_or(DuelError::MathOverflow)?,
        )
        .ok_or(DuelError::MathOverflow)?;

    let term2 = b.checked_mul(k).ok_or(DuelError::MathOverflow)?;

    term1.checked_add(term2).ok_or_else(|| error!(DuelError::MathOverflow))
}

/// Calculate tokens received for a given SOL amount (buy).
/// Solves: R(supply + tokens) - R(supply) = sol_amount
/// Uses binary search for integer math.
pub fn tokens_out(sol_amount: u64, current_supply: u64, total_supply: u64, params: &CurveParams) -> Result<u64> {
    if sol_amount == 0 {
        return Ok(0);
    }

    let available_tokens = total_supply
        .checked_sub(current_supply)
        .ok_or(DuelError::MathOverflow)?;

    if available_tokens == 0 {
        return Ok(0);
    }

    let r_current = reserve_integral(current_supply, params)?;
    let sol = sol_amount as u128;

    // Binary search for the number of tokens
    let mut lo: u64 = 0;
    let mut hi: u64 = available_tokens;
    let mut best: u64 = 0;

    while lo <= hi {
        let mid = lo + (hi - lo) / 2;
        let new_supply = current_supply
            .checked_add(mid)
            .ok_or(DuelError::MathOverflow)?;
        let r_new = reserve_integral(new_supply, params)?;
        let cost = r_new.checked_sub(r_current).ok_or(DuelError::MathOverflow)?;

        if cost <= sol {
            best = mid;
            if mid == hi {
                break;
            }
            lo = mid + 1;
        } else {
            if mid == 0 {
                break;
            }
            hi = mid - 1;
        }
    }

    Ok(best)
}

/// Calculate SOL received for selling a given token amount.
/// sol_out = R(supply) - R(supply - token_amount)
pub fn sol_out(token_amount: u64, current_supply: u64, params: &CurveParams) -> Result<u64> {
    if token_amount == 0 {
        return Ok(0);
    }

    require!(current_supply >= token_amount, DuelError::InsufficientTokenBalance);

    let new_supply = current_supply
        .checked_sub(token_amount)
        .ok_or(DuelError::MathOverflow)?;

    let r_current = reserve_integral(current_supply, params)?;
    let r_new = reserve_integral(new_supply, params)?;

    let result = r_current.checked_sub(r_new).ok_or(DuelError::MathOverflow)?;

    require!(result <= u64::MAX as u128, DuelError::MathOverflow);
    Ok(result as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_params() -> CurveParams {
        CurveParams {
            a: 1_000_000, // 0.001 when divided by CURVE_SCALE
            n: 1,         // linear
            b: 1_000,     // 1000 lamports base price
        }
    }

    #[test]
    fn test_price_zero_supply() {
        let params = test_params();
        let p = price(0, &params).unwrap();
        // price(0) = a * 0 / CURVE_SCALE + b = b
        assert_eq!(p, 1_000);
    }

    #[test]
    fn test_price_nonzero_supply() {
        let params = test_params();
        let p = price(1_000_000, &params).unwrap();
        // price(1M) = 1_000_000 * 1_000_000 / 1_000_000_000 + 1_000
        // = 1_000_000_000_000 / 1_000_000_000 + 1_000
        // = 1_000 + 1_000 = 2_000
        assert_eq!(p, 2_000);
    }

    #[test]
    fn test_reserve_integral_zero() {
        let params = test_params();
        let r = reserve_integral(0, &params).unwrap();
        assert_eq!(r, 0);
    }

    #[test]
    fn test_sol_out_roundtrip() {
        let params = test_params();
        let supply = 100_000u64;
        let token_amount = 10_000u64;
        let sol = sol_out(token_amount, supply, &params).unwrap();
        assert!(sol > 0);
    }

    #[test]
    fn test_tokens_out_basic() {
        let params = test_params();
        let total_supply = 1_000_000u64;
        let tokens = tokens_out(100_000, 0, total_supply, &params).unwrap();
        assert!(tokens > 0);
    }

    #[test]
    fn test_tokens_out_zero_sol() {
        let params = test_params();
        let tokens = tokens_out(0, 0, 1_000_000, &params).unwrap();
        assert_eq!(tokens, 0);
    }
}
