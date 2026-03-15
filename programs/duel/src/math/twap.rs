use crate::errors::DuelError;
use crate::state::side::MAX_TWAP_SAMPLES;
use anchor_lang::prelude::*;

/// Calculate trimmed mean from ring buffer samples.
///
/// - `samples`: the ring buffer array (MAX_TWAP_SAMPLES entries)
/// - `count`: number of valid samples (may be < MAX_TWAP_SAMPLES if buffer hasn't filled)
/// - `trim_pct`: percentage to trim from each tail (e.g., 5 = remove top 5% and bottom 5%)
///
/// Returns the mean of the remaining (non-trimmed) samples.
pub fn trimmed_mean(samples: &[u64; MAX_TWAP_SAMPLES], count: u16, trim_pct: u8) -> Result<u64> {
    let n = count.min(MAX_TWAP_SAMPLES as u16) as usize;
    require!(n > 0, DuelError::NoTwapSamples);

    // Copy valid samples into a sortable vec
    // Use a fixed-size stack buffer to avoid heap allocation
    let mut sorted = [0u64; MAX_TWAP_SAMPLES];
    sorted[..n].copy_from_slice(&samples[..n]);
    sorted[..n].sort_unstable();

    // Calculate trim count
    let trim_count = (n as u64)
        .checked_mul(trim_pct as u64)
        .ok_or(DuelError::MathOverflow)?
        .checked_div(100)
        .ok_or(DuelError::MathOverflow)? as usize;

    // Ensure we have at least 1 sample after trimming
    let start = trim_count;
    let end = n.saturating_sub(trim_count);
    require!(end > start, DuelError::NoTwapSamples);

    let trimmed_count = end - start;

    // Sum the remaining samples
    let mut sum: u128 = 0;
    for i in start..end {
        sum = sum
            .checked_add(sorted[i] as u128)
            .ok_or(DuelError::MathOverflow)?;
    }

    let mean = sum
        .checked_div(trimmed_count as u128)
        .ok_or(DuelError::MathOverflow)?;

    require!(mean <= u64::MAX as u128, DuelError::MathOverflow);
    Ok(mean as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_samples(values: &[u64]) -> [u64; MAX_TWAP_SAMPLES] {
        let mut arr = [0u64; MAX_TWAP_SAMPLES];
        for (i, &v) in values.iter().enumerate() {
            if i < MAX_TWAP_SAMPLES {
                arr[i] = v;
            }
        }
        arr
    }

    #[test]
    fn test_trimmed_mean_no_trim() {
        let samples = make_samples(&[100, 200, 300, 400, 500]);
        let mean = trimmed_mean(&samples, 5, 0).unwrap();
        assert_eq!(mean, 300); // (100+200+300+400+500)/5
    }

    #[test]
    fn test_trimmed_mean_with_trim() {
        // 20 samples, trim 10% = remove 2 from each end
        let values: Vec<u64> = (1..=20).collect();
        let samples = make_samples(&values);
        let mean = trimmed_mean(&samples, 20, 10).unwrap();
        // After trimming bottom 2 and top 2: values 3..=18
        // Sum = 3+4+5+...+18 = (3+18)*16/2 = 168
        // Mean = 168/16 = 10 (integer division)
        assert_eq!(mean, 10);
    }

    #[test]
    fn test_trimmed_mean_outlier_resistance() {
        // 20 samples: 18 normal values + 2 extreme outliers
        let mut values: Vec<u64> = vec![100; 18];
        values.push(1_000_000); // outlier high
        values.push(0);         // outlier low
        let samples = make_samples(&values);
        let mean_trimmed = trimmed_mean(&samples, 20, 10).unwrap();
        let mean_raw = trimmed_mean(&samples, 20, 0).unwrap();
        // Trimmed should be closer to 100 (the true value)
        assert!(mean_trimmed <= 100);
        assert!(mean_raw > 100); // raw mean heavily biased by outlier
    }

    #[test]
    fn test_trimmed_mean_single_sample() {
        let samples = make_samples(&[42]);
        let mean = trimmed_mean(&samples, 1, 0).unwrap();
        assert_eq!(mean, 42);
    }
}
