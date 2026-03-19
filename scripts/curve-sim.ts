/**
 * Curve parameter simulation for Duel Protocol.
 * Tests different configurations to find pump.fun-like price dynamics.
 *
 * Formula: price(k) = a * k^n / CURVE_SCALE + b
 * Reserve: R(k) = a * k^(n+1) / ((n+1) * CURVE_SCALE) + b * k
 */

const CURVE_SCALE = 1_000_000_000n; // 10^9
const SOL_PRICE_USD = 150; // approx
const LAMPORTS_PER_SOL = 1_000_000_000n;

interface CurveConfig {
  name: string;
  a: bigint;
  n: number;
  b: bigint;
  totalSupply: bigint;
  decimals: number;
}

function powBig(base: bigint, exp: number): bigint {
  let result = 1n;
  for (let i = 0; i < exp; i++) result *= base;
  return result;
}

function price(k: bigint, config: CurveConfig): bigint {
  const kPowN = powBig(k, config.n);
  return (config.a * kPowN) / CURVE_SCALE + config.b;
}

function reserveIntegral(k: bigint, config: CurveConfig): bigint {
  const nPlus1 = BigInt(config.n + 1);
  const kPowN1 = powBig(k, config.n + 1);
  const term1 = (config.a * kPowN1) / (nPlus1 * CURVE_SCALE);
  const term2 = config.b * k;
  return term1 + term2;
}

function tokensOut(
  solAmount: bigint,
  currentSupply: bigint,
  config: CurveConfig
): bigint {
  const available = config.totalSupply - currentSupply;
  if (available <= 0n) return 0n;

  const rCurrent = reserveIntegral(currentSupply, config);
  let lo = 0n;
  let hi = available;
  let best = 0n;

  while (lo <= hi) {
    const mid = lo + (hi - lo) / 2n;
    const rNew = reserveIntegral(currentSupply + mid, config);
    const cost = rNew - rCurrent;

    if (cost <= solAmount) {
      best = mid;
      if (mid === hi) break;
      lo = mid + 1n;
    } else {
      if (mid === 0n) break;
      hi = mid - 1n;
    }
  }
  return best;
}

function toHumanTokens(raw: bigint, decimals: number): string {
  const divisor = 10 ** decimals;
  const whole = Number(raw) / divisor;
  if (whole >= 1_000_000) return `${(whole / 1_000_000).toFixed(1)}M`;
  if (whole >= 1_000) return `${(whole / 1_000).toFixed(1)}K`;
  return whole.toFixed(decimals > 0 ? 2 : 0);
}

function lamportsToSol(lamports: bigint): string {
  const sol = Number(lamports) / 1e9;
  if (sol < 0.001) return `${sol.toFixed(9)} SOL`;
  if (sol < 1) return `${sol.toFixed(6)} SOL`;
  if (sol >= 1000) return `${sol.toFixed(0)} SOL`;
  return `${sol.toFixed(3)} SOL`;
}

function usdFromLamports(lamports: bigint): string {
  const usd = (Number(lamports) / 1e9) * SOL_PRICE_USD;
  if (usd < 0.01) return `$${usd.toFixed(6)}`;
  if (usd < 1) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function simulate(config: CurveConfig) {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`CONFIG: ${config.name}`);
  console.log(
    `  a=${config.a}, n=${config.n}, b=${config.b}, supply=${config.totalSupply} (${config.decimals} decimals)`
  );
  console.log(
    `  Human-readable supply: ${toHumanTokens(config.totalSupply, config.decimals)} tokens per side`
  );
  console.log(`${"=".repeat(70)}`);

  // Price at different supply levels
  console.log("\n--- Price at supply levels ---");
  const levels = [0, 1, 5, 10, 25, 50, 75, 100];
  for (const pct of levels) {
    const supply = (config.totalSupply * BigInt(pct)) / 100n;
    try {
      const p = price(supply, config);
      const humanSupply = toHumanTokens(supply, config.decimals);
      console.log(
        `  ${pct.toString().padStart(3)}% supply (${humanSupply.padStart(10)}): ${lamportsToSol(p).padStart(18)} per token (${usdFromLamports(p)})`
      );
    } catch {
      console.log(`  ${pct}%: OVERFLOW`);
    }
  }

  // Total reserve at different levels
  console.log("\n--- Total reserve (SOL in pool) ---");
  for (const pct of [10, 25, 50, 75, 100]) {
    const supply = (config.totalSupply * BigInt(pct)) / 100n;
    try {
      const r = reserveIntegral(supply, config);
      console.log(
        `  ${pct.toString().padStart(3)}% sold: ${lamportsToSol(r).padStart(18)} (${usdFromLamports(r)})`
      );
    } catch {
      console.log(`  ${pct}%: OVERFLOW`);
    }
  }

  // What does $5, $50, $500 buy at different supply levels?
  console.log("\n--- Buy simulation ---");
  const buyAmountsUSD = [5, 50, 500];
  const startLevels = [0, 10, 25, 50];

  for (const startPct of startLevels) {
    const startSupply = (config.totalSupply * BigInt(startPct)) / 100n;
    console.log(
      `\n  At ${startPct}% circulating (${toHumanTokens(startSupply, config.decimals)} tokens out):`
    );
    for (const usd of buyAmountsUSD) {
      const solAmount = BigInt(Math.floor((usd / SOL_PRICE_USD) * 1e9));
      try {
        const tokens = tokensOut(solAmount, startSupply, config);
        const pctOfSupply =
          (Number(tokens) / Number(config.totalSupply)) * 100;
        console.log(
          `    $${usd.toString().padStart(3)} buy -> ${toHumanTokens(tokens, config.decimals).padStart(10)} tokens (${pctOfSupply.toFixed(2)}% of supply)`
        );
      } catch {
        console.log(`    $${usd}: OVERFLOW`);
      }
    }
  }

  // Early buyer ROI
  console.log("\n--- Early buyer ROI ---");
  const earlyBuyUSD = 5;
  const earlySolAmount = BigInt(
    Math.floor((earlyBuyUSD / SOL_PRICE_USD) * 1e9)
  );
  try {
    const earlyTokens = tokensOut(earlySolAmount, 0n, config);
    if (earlyTokens > 0n) {
      console.log(
        `  First buyer: $${earlyBuyUSD} buys ${toHumanTokens(earlyTokens, config.decimals)} tokens`
      );

      // Value at different pool sizes
      for (const poolPct of [10, 25, 50]) {
        const futureSupply =
          (config.totalSupply * BigInt(poolPct)) / 100n;
        if (futureSupply > earlyTokens) {
          const rBefore = reserveIntegral(futureSupply, config);
          const rAfter = reserveIntegral(
            futureSupply - earlyTokens,
            config
          );
          const sellValue = rBefore - rAfter;
          const roi =
            (Number(sellValue) / Number(earlySolAmount) - 1) * 100;
          console.log(
            `  Sell at ${poolPct}% supply: ${lamportsToSol(sellValue)} (${usdFromLamports(sellValue)}) = ${roi.toFixed(0)}% ROI`
          );
        }
      }
    }
  } catch {
    console.log(`  OVERFLOW in early buyer simulation`);
  }

  // Price multiplier
  console.log("\n--- Price multiplier ---");
  try {
    const p0 = price(1n, config); // price of first token
    for (const pct of [10, 25, 50]) {
      const supply = (config.totalSupply * BigInt(pct)) / 100n;
      const pN = price(supply, config);
      const multiple = Number(pN) / Number(p0);
      console.log(
        `  First token -> ${pct}% supply: ${multiple.toFixed(1)}x price increase`
      );
    }
  } catch {
    console.log(`  OVERFLOW`);
  }
}

// ========== CONFIGURATIONS TO TEST ==========

const configs: CurveConfig[] = [
  // Current test params
  {
    name: "CURRENT (linear, 1K tokens, 6 dec)",
    a: 1_000_000n,
    n: 1,
    b: 1_000n,
    totalSupply: 1_000_000_000n, // 1K tokens with 6 decimals
    decimals: 6,
  },

  // Quadratic with moderate supply
  {
    name: "QUADRATIC (100K tokens, 0 dec)",
    a: 1_000_000n,
    n: 2,
    b: 100n,
    totalSupply: 100_000n,
    decimals: 0,
  },

  // Quadratic with smaller a
  {
    name: "QUADRATIC GENTLE (100K tokens, 0 dec)",
    a: 100n,
    n: 2,
    b: 100n,
    totalSupply: 100_000n,
    decimals: 0,
  },

  // Linear with larger supply
  {
    name: "LINEAR (1M tokens, 0 dec)",
    a: 1n,
    n: 1,
    b: 100n,
    totalSupply: 1_000_000n,
    decimals: 0,
  },

  // Quadratic with 1M supply and 0 dec
  {
    name: "QUADRATIC (1M tokens, 0 dec)",
    a: 1n,
    n: 2,
    b: 1n,
    totalSupply: 1_000_000n,
    decimals: 0,
  },

  // Try to get pump.fun feel: lots of tokens, dramatic curve
  {
    name: "PUMP-FEEL (10M tokens, 0 dec)",
    a: 1n,
    n: 2,
    b: 1n,
    totalSupply: 10_000_000n,
    decimals: 0,
  },

  // What about virtual AMM style params?
  // Large supply, very small a, quadratic
  {
    name: "PUMP-FEEL-100M (100M tokens, 0 dec)",
    a: 1n,
    n: 2,
    b: 1n,
    totalSupply: 100_000_000n,
    decimals: 0,
  },
];

console.log("DUEL PROTOCOL - BONDING CURVE PARAMETER SIMULATION");
console.log(`SOL price: $${SOL_PRICE_USD}`);
console.log(`Curve: price(k) = a * k^n / 10^9 + b`);

for (const config of configs) {
  simulate(config);
}
