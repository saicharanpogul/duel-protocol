# Duel Protocol

## TWAP-Resolved Bonding Curves for Community-Scale Competitive Markets

### Technical Thesis v0.3

---

## 1. Overview

Imagine a three-person team in Bangalore wants to build a "Messi vs Ronaldo: Greatest of All Time" debate market. Fans pick a side, put SOL behind their opinion, argue their case with content, and after 7 days the market resolves. The winning side takes a portion of the losing side's pot.

This team has no venture funding. They cannot afford market makers. They have no relationship with liquidity providers. And there is no oracle that returns `{ winner: "messi" }` because the question is subjective.

Today, this team cannot build their product. Every existing market infrastructure requires either external liquidity they cannot afford, or an objective data feed that does not exist for their use case.

Duel Protocol solves both problems.

Duel is a standalone, composable on-chain primitive for community-scale competitive markets. It combines bonding curve token issuance (which provides self-contained liquidity with zero external capital) with time-weighted average price resolution (which resolves subjective outcomes through sustained capital-weighted conviction). The bonding curve is the market maker. The TWAP is the judge.

Two independent bonding curve tokens are created for each market, representing two sides. Participants buy and sell tokens on either curve at any time. At deadline, the side with the higher TWAP over a configurable observation window wins. A configurable portion of the losing side's reserve is transferred to the winning side's reserve. Winners realize gains by selling into a boosted curve.

**What Duel is.** A gamified engagement primitive where communities put skin in the game on opinions, debates, and competitions. The target user is a fan putting $5 to $500 on their side, not a hedge fund trader pricing risk. The real comparable is pump.fun meets Twitter polls meets fantasy sports: pump.fun proved people will throw money at tokens for entertainment, Twitter polls proved people want to vote on subjective opinions, fantasy sports proved people will pay for skin-in-the-game on outcomes they care about. Duel combines all three into a fair, manipulation-resistant mechanism.

**What Duel is not.** A prediction market for sophisticated traders. It does not produce calibrated probability signals. It does not offer fixed payouts. It does not compete with Polymarket on price efficiency, liquidity depth, or payout clarity. The thesis is honest about these limitations (see Section 4: Honest Limitations).

No existing protocol combines bonding curves with TWAP resolution. MetaDAO proved TWAP resolution works for manipulation-resistant on-chain decisions. Pump.fun and Meteora's DBC proved bonding curves work for bootstrapping liquidity from zero. Duel unifies both into a general-purpose program and SDK so that any team, regardless of funding, can ship competitive community markets.

The bonding curve architecture is inspired by Meteora's Dynamic Bonding Curve (DBC) program. However, Duel is built from scratch because the protocol requires deadline enforcement, TWAP sampling, cross-pool reserve transfers, and configurable sell-side protections, none of which are supported by existing bonding curve programs.

---

## 2. The Problem

### 2.1 Who This Is For

A small team wants to build a product where two sides compete and one side wins. Maybe it is Messi vs Ronaldo. Maybe it is two indie musicians battling for fan support. Maybe it is a DAO deciding between two proposals. Maybe it is two meme tokens in a head-to-head popularity contest.

These teams share three characteristics:

1. They have no budget for market making infrastructure.
2. Their outcomes are often subjective (no oracle exists).
3. They need the market itself to be the product, not a sidecar to something else.

The users of these markets are fans, community members, content consumers, and degens who want skin in the game on an opinion. They are putting $5 to $500 behind their belief, not $100K. They want to see "Messi: 68%" and either agree or disagree with their wallet. The market is entertainment with real stakes.

### 2.2 Why Existing Infrastructure Fails Them

**Polymarket and order book prediction markets.** Polymarket works because it has institutional market makers providing liquidity and a sophisticated user base that calibrates probabilities. A small team cannot replicate either of these. Without market makers, the order book is thin, spreads are wide, and the user experience is broken. Without sophisticated traders, the probabilities are meaningless. Additionally, Polymarket resolves markets using external oracles and human committees. "Who is the GOAT: Messi or Ronaldo?" cannot be resolved by an oracle because there is no objective answer.

**Parimutuel pools (traditional betting).** Positions are locked after entry. No ability to exit early. No continuous price discovery. A user who buys Messi at the start and wants to sell halfway through cannot do so. This kills engagement for longer-duration markets.

**AMM prediction markets.** Require someone to seed the initial liquidity pool. That someone bears impermanent loss. For a small team, this means the founders put up their own capital as the initial LP, which is a non-starter for a team with limited funds. Cold start problem remains.

**Bonding curves with closing price resolution.** This was our original design before Duel. Bonding curves elegantly solve the liquidity problem because the curve IS the counterparty. No external capital needed. Price discovery is continuous because price is a direct function of supply. But using the closing price (the instantaneous price at deadline) as the resolution mechanism is fatally flawed. An attacker can buy a massive position one second before the deadline, spike the price, and win. The cost is bounded only by the slippage on a single trade. For small-to-medium markets, this attack is affordable. This vulnerability led directly to the TWAP resolution design.

### 2.3 The Three Requirements

Any competitive community market needs:

1. **Self-contained liquidity.** Participants must be able to enter and exit at any time without relying on external market makers or LPs. The mechanism itself must provide the counterparty.
2. **Real-time sentiment signal.** The market must express which side is favored, updating continuously. This IS the product. Users come to see "Messi: 68%" and react.
3. **Manipulation-resistant resolution.** The outcome must not be purchasable by a single wealthy actor. A whale should not be able to buy the result at the last second.

Duel satisfies all three. The bonding curve handles requirements 1 and 2. The TWAP handles requirement 3.

---

## 3. The Solution: How It Works

This section uses the Messi vs Ronaldo market as a running example. The parameters are: 7-day market duration, 12-hour TWAP observation window, 60-second sampling interval, 70% battle_tax, linear bonding curve.

### 3.1 Market Creation

A developer calls `initialize_market` with their chosen parameters. The protocol creates:

- A "Messi" bonding curve pool with 1,000,000 MESSI tokens in reserve and 0 SOL.
- A "Ronaldo" bonding curve pool with 1,000,000 CR7 tokens in reserve and 0 SOL.
- A shared market state tracking the deadline (7 days from now), TWAP config, battle_tax (70%), and status.

Both pools start empty. No SOL has entered the system. No external liquidity was required. The market is live.

### 3.2 Trading

A Messi fan sends 2 SOL to the Messi pool. The bonding curve calculates how many MESSI tokens that 2 SOL buys given the current price (which starts at the base price `b` since no tokens are circulating). The fan receives tokens. The SOL sits in the Messi pool's reserve.

Price is a function of circulating supply:

```
price(k) = a * k^n + b
```

Where `k` is the number of tokens currently held by participants (circulating supply), `a` is the curve steepness, `n` is the exponent (1 for linear), and `b` is the base price.

As more people buy Messi tokens, the circulating supply increases and the price rises. As people sell, tokens return to the pool's reserve (they are not burned), circulating supply decreases, and the price falls.

The reserve `R` at circulating supply `k` is the integral of the price function:

```
R(k) = a * k^(n+1) / (n+1) + b * k
```

For our linear curve (n = 1):

```
price(k) = a * k + b
R(k) = (a/2) * k^2 + b * k
```

Buying and selling happen against the curve at any time. The bonding curve is the always-available counterparty. If 1,000 people buy Messi and only 3 buy Ronaldo, the Messi price is high, the Ronaldo price is low, and the normalized sentiment shows "Messi: 94%, Ronaldo: 6%." Anyone who thinks Ronaldo is undervalued can buy cheap CR7 tokens and profit if sentiment shifts.

**Important: the two curves are independent.** Buying Messi does not directly change Ronaldo's price. A normalized sentiment ratio for display purposes is derived as:

```
Sentiment(Messi) = price(MESSI) / [price(MESSI) + price(CR7)]
```

This can be noisy if capital flows into both sides simultaneously, but it gives users a familiar "Messi: 68%" display. This is a sentiment gauge, not a calibrated probability (see Section 4).

### 3.3 TWAP Observation

On day 6.5 (12 hours before the deadline), the TWAP observation window opens. A permissionless crank instruction, callable by anyone, records the current price of both MESSI and CR7 every 60 seconds.

```
TWAP_MESSI = (1/N) * SUM(price_MESSI(t_i)) for i = 1 to N
TWAP_CR7 = (1/N) * SUM(price_CR7(t_i)) for i = 1 to N
```

With a 12-hour window and 60-second intervals, that is 720 price samples per side. Trading continues during this window. Every buy and sell shifts the price, which is captured in subsequent samples.

This is where the manipulation resistance lives. A whale who tries to pump CR7 at the last minute affects only a tiny fraction of the 720 data points. To meaningfully shift the TWAP, they would need to sustain elevated prices for hours, bleeding capital the entire time as rational sellers dump into the inflated price.

### 3.4 Resolution

Day 7. The deadline passes. Anyone can call `resolve_market`.

Let's say the final TWAPs are:
- TWAP_MESSI: 0.085 SOL
- TWAP_CR7: 0.042 SOL

Messi wins. The Messi pool had 150 SOL in reserve. The Ronaldo pool had 80 SOL in reserve.

Resolution mechanics:
1. battle_tax = 70%, so 70% of Ronaldo's reserve is transferred: `0.70 * 80 = 56 SOL`.
2. Protocol fee of 1.25%: `56 * 0.0125 = 0.7 SOL` goes to the protocol.
3. Net transfer to Messi pool: `56 - 0.7 = 55.3 SOL`.
4. Messi pool's new reserve: `150 + 55.3 = 205.3 SOL`.
5. Ronaldo pool's remaining reserve: `80 - 56 = 24 SOL`.

The Messi pool now has 205.3 SOL backing the same circulating supply of MESSI tokens. The price on the Messi curve jumps. MESSI holders can sell into this fatter curve to realize gains.

Ronaldo holders still have 24 SOL of residual reserve (because battle_tax was 70%, not 100%). They can sell at a loss, or if the token persists, hold for whatever residual value remains.

### 3.5 Post-Resolution: The Race to Sell

After resolution, the Messi curve's price is artificially elevated. It is backed by more SOL than organic demand would justify. Every rational MESSI holder knows this. The game theory is a prisoner's dilemma:

- Sell immediately: capture the inflated price.
- Wait: other sellers drain the reserve before you, and you get less.
- Everyone sells at once: price crashes, late sellers get wrecked.

Early sellers after resolution capture more value than late sellers. This is an inherent property of the reserve-dump mechanic.

At the target scale of $5 to $500 per participant, this dynamic is exciting rather than stressful. A fan who put 0.5 SOL on Messi doesn't need to race bots. The difference between selling first and selling 10 minutes later on a 200 SOL pool is marginal. The race-to-sell becomes a real problem only at high individual stakes (see Section 4: Honest Limitations).

### 3.6 Token Persistence (Optional)

Since battle_tax was 70% and not 100%, both tokens survive with residual reserves. The MESSI and CR7 tokens can continue trading on their bonding curves. Optionally, the market creator can trigger `graduate_to_dex`, which migrates surviving tokens to a Meteora DAMM v2 pool. The residual SOL reserve and remaining token reserve seed the initial liquidity.

This means a Messi vs Ronaldo debate market can become a persistent meme token pair after resolution. The market was the launch mechanism. The culture keeps the tokens alive.

If the creator sets battle_tax to 100%, both tokens go to zero at resolution. Clean finality, no ambiguity.

---

## 4. Honest Limitations

This section exists because protocol docs that hide their weaknesses aren't trustworthy. If you're building on Duel, you should understand what it cannot do.

### 4.1 This Is Not a Calibrated Prediction Market

On Polymarket, the price of a "Yes" contract is a calibrated probability. If the price is $0.73, sophisticated traders have collectively decided the event has approximately a 73% chance of occurring. This works because the payout is binary ($0 or $1), the market structure enforces complementary pricing (Yes + No = $1), and informed traders actively arbitrage mispricings.

Duel's bonding curves do not produce calibrated probabilities. The "Messi: 68%" display is a sentiment ratio derived from independent curve prices. It reflects how much capital has flowed into each side relative to the other, not a calibrated estimate of anything. Both sides can rise simultaneously. The ratio can be noisy. A hundred uninformed fans and a hundred informed analysts move the price equally.

If your application needs real probability signals, use a proper prediction market. Duel is for sentiment-driven competition, not probabilistic forecasting.

### 4.2 Bonding Curves Don't Scale to Institutional Size

A $1M buy on a bonding curve would produce enormous slippage. The price impact is deterministic and unavoidable because there is no order book depth to absorb large orders. Duel works well at community scale ($5 to $500 per participant, $1K to $50K total pool). It breaks down at institutional scale.

Applications should not market Duel as infrastructure for high-value markets. The target is many small participants, not a few large ones.

### 4.3 Post-Resolution Payout Is Not Fixed

On Polymarket, correct bettors get exactly $1 per contract. On Duel, correct bettors sell into a boosted curve and their payout depends on when they sell relative to other sellers. This makes expected return hard to calculate. Applications should frame the reward as "you'll profit by selling into a bigger pool" rather than quoting specific payout multiples.

### 4.4 MEV Exposure After Resolution

The race-to-sell mechanic rewards speed. MEV searchers with Jito bundles will frontrun human sellers after resolution. At community scale ($5 to $500 positions), the MEV opportunity is small enough that searchers may not bother. At larger scales, sophisticated actors capture a disproportionate share of the prize. Possible future mitigations: a brief cooldown period after resolution before selling opens, or batched settlement where all sell requests in a window are processed at the same price. Neither is implemented in v1.

### 4.5 Thin Market Vulnerability

In low-participation markets (fewer than 20 active participants), a single actor can dominate both sides and potentially game the TWAP. The sell-side protection and optional lagging observation help but cannot prevent all manipulation on markets with negligible liquidity. Applications should set minimum reserve thresholds and encourage sufficient participation before markets become meaningful.

---

## 5. Mechanism Design Details

### 5.1 Bonding Curve Specification

Each side's token is priced on a polynomial bonding curve. The architecture is inspired by Meteora DBC's customizable curve design, but implemented from scratch within the Duel program to support deadline enforcement and cross-pool reserve transfers.

```
price(k) = a * k^n + b
```

Where:
- `k` = circulating supply (tokens held by participants, not total supply)
- `a` = curve steepness coefficient
- `n` = exponent (1 = linear, 2 = quadratic, 3 = cubic)
- `b` = base price (minimum price at zero circulating supply)

The reserve at circulating supply `k`:

```
R(k) = a * k^(n+1) / (n+1) + b * k
```

**Buying.** A participant sends SOL to the pool. The protocol calculates tokens to transfer from the pool's token reserve vault based on the curve math. Tokens move from the vault to the buyer. SOL reserve increases.

**Selling.** A participant sends tokens back to the pool's token reserve vault. The protocol calculates SOL to return. SOL reserve decreases. Tokens are not burned. They return to the reserve, available for future buyers.

Total token supply is fixed at market creation. Price is driven by circulating supply, not total supply.

### 5.2 TWAP Calculation

The protocol records prices at fixed intervals during the observation window `W` in the final portion of the market's lifetime. The window begins at `deadline - W` and ends at `deadline`.

Discrete TWAP with `N` observations:

```
TWAP = (1/N) * SUM(observation(t_i)) for i = 1 to N
```

Price at each sample is deterministic: derived from circulating supply using the curve formula. No oracle. No external price feed. Pure function of on-chain state.

**Resolution rule.** Higher TWAP wins. If exactly equal, higher SOL reserve at deadline wins as tiebreaker.

Sampling is permissionless. Anyone can call `record_twap_sample`. If a sample is missed, the TWAP has fewer data points but remains valid. Applications can run their own cranker or use automation services (Clockwork, Jito) for consistent sampling.

The TWAP accumulator uses u128 to prevent overflow.

### 5.3 Lagging Observation (Optional)

The standard TWAP feeds the raw bonding curve price into the accumulator on each sample. This is sufficient for most community-scale markets because moving the bonding curve price requires real SOL.

However, on thin markets with few active participants, a single large buy can spike the price dramatically. If that spike lands on a TWAP sample, it gets full weight. The lagging observation is an optional defense.

Instead of sampling the raw spot price, maintain a separate "observation" value that chases the spot price but is speed-limited:

```
if spot_price > observation:
    observation = min(spot_price, observation + max_change)
    
if spot_price < observation:
    observation = max(spot_price, observation - max_change)
    
accumulator += observation
```

Where `max_change` is a configurable maximum amount the observation can move per sample. Slow, sustained price movements pass through. Fast spikes get suppressed.

This design is borrowed from MetaDAO, which uses a similar lagging mechanism on their TWAP oracle for futarchy governance. MetaDAO needs it because order book midpoint prices can be spiked with cancellable orders at near-zero cost. Duel's bonding curve provides natural slippage resistance (moving the price costs real SOL), so the need is less acute. But for thin markets, the lagging observation is a valuable safety net.

Configuration: if `max_observation_change_per_update = 0`, the oracle uses raw price (standard TWAP). If set to a non-zero value, the lagging filter activates.

### 5.4 Deadline Enforcement

The market program enforces a hard deadline at the instruction level. Buy and sell instructions check `Clock::get()?.unix_timestamp` against the market's deadline. After deadline, all trading is rejected by the program itself.

This is the fundamental reason Duel is built from scratch rather than wrapping an external bonding curve program.

Lifecycle phases:

1. **Active** (creation to `deadline - W`): Buy and sell are open. No TWAP sampling.
2. **TWAP Observation** (`deadline - W` to `deadline`): Buy and sell continue. TWAP samples are recorded every `dt` seconds.
3. **Resolved** (after deadline + resolve call): No more trading. Reserve transfer executed. Post-resolution selling enabled.

---

## 6. Manipulation Resistance

### 6.1 Why TWAP Works

A Ronaldo whale wants to flip the Messi vs Ronaldo outcome. The TWAP window is 12 hours with 60-second intervals: 720 data points.

If the whale buys 10 minutes before deadline, they influence 10 out of 720 samples (1.4%). If the whale starts 6 hours before deadline, they influence 50% of samples but must sustain the elevated price for 6 hours while rational actors dump into the inflated price.

### 6.2 Cost of Manipulation

**Slippage cost.** Grows superlinearly on polynomial curves. **Opportunity cost.** Capital locked for manipulation duration. **Extraction loss.** Rational sellers dump into inflated prices, actively draining the attacker's capital. This is qualitatively different from order book manipulation, where limit orders sit passively.

### 6.3 Manipulation on Thin Markets

On thin markets (few participants, low engagement), manipulation may go uncontested for hours. This is where the lagging observation (Section 5.3) provides defense. Additionally, applications should set minimum participation thresholds.

### 6.4 Worked Manipulation Example

Messi vs Ronaldo, 80 SOL in Ronaldo pool. Flipping a 2:1 TWAP deficit in the last hour would require approximately tripling the Ronaldo price for 60 consecutive minutes. On a linear bonding curve, this means buying enough tokens to triple the circulating supply, which costs more SOL than the entire winning pot. Economically irrational.

---

## 7. Sell-Side Protection (Bank Run Prevention)

### 7.1 The Problem

If losing-side participants sell everything before deadline, the reserve approaches zero. battle_tax of 70% times zero is zero. Winners get nothing.

### 7.2 Progressive Sell Penalty

```
sell_penalty(r) = base_fee + max_penalty * (1 - r / r_peak)^2
```

As the reserve drops relative to its peak, selling becomes progressively more expensive. Penalty SOL stays in the reserve.

### 7.3 Configurable Activation Window

`protection_activation_offset` defines when penalties begin. In Messi vs Ronaldo, set to 4 hours: unrestricted selling for 6 days and 20 hours, progressive penalties in the final 4 hours.

---

## 8. Settlement Mechanics

### 8.1 Reserve Transfer

```
transfer_amount = R_loser * battle_tax_bps / 10000
protocol_fee = transfer_amount * protocol_fee_bps / 10000
net_transfer = transfer_amount - protocol_fee

R_winner_new = R_winner + net_transfer
R_loser_new = R_loser - transfer_amount
```

### 8.2 Worked Example

Before resolution: Messi 150 SOL / 420K circulating, Ronaldo 80 SOL / 310K circulating.
After resolution (70% battle_tax, 1.25% fee): Messi 205.3 SOL, Ronaldo 24 SOL.

At community scale (individual positions of 0.5 to 5 SOL), the difference between selling first and selling 10 minutes later is marginal.

### 8.3 battle_tax Configurability

- **100%:** Full drain. Clean finality.
- **70%:** Default. Large reward. Tokens persist.
- **50%:** Moderate. Both sides retain value.
- **0%:** Pure sentiment market. No transfer. Information only.

---

## 9. Sentiment Signal

```
Sentiment(Messi) = price(MESSI) / [price(MESSI) + price(CR7)]
```

Applications should label this as "sentiment" or "community support," not "probability." It reflects capital-weighted conviction, which is valuable but not calibrated.

---

## 10. Token Persistence and DEX Graduation

### 10.1 DEX Graduation

The optional `graduate_to_dex` instruction creates a Meteora DAMM v2 pool via CPI. Residual SOL reserve and remaining token reserve seed the pool. The token becomes tradeable on Jupiter and every Solana aggregator.

### 10.2 The Battle as a Launch Mechanic

A competitive market with token persistence is effectively a token launch with a built-in engagement narrative. Instead of "here's a new token, buy it," it's "here's a battle, pick your side." This is pump.fun with a story.

### 10.3 Clean Finality

battle_tax = 100% means both tokens die at resolution.

---

## 11. Program Architecture (Conceptual)

### 11.1 Account Structure

```
Market (PDA: [b"market", creator, market_id])
|
+-- SideA (PDA: [b"side", market, 0])
|   +-- token_mint, token_reserve_vault, sol_reserve_vault
|   +-- circulating_supply, total_supply, peak_reserve
|   +-- twap_accumulator (u128), last_observation (u64)
|
+-- SideB (PDA: [b"side", market, 1])
|   +-- (same structure)
|
+-- MarketConfig
|   +-- deadline, twap_window, twap_interval
|   +-- battle_tax_bps, protocol_fee_bps
|   +-- sell_penalty_max_bps, protection_activation_offset
|   +-- curve_params (a, n, b)
|   +-- max_observation_change_per_update (0 = disabled)
|
+-- MarketState
    +-- status: Active | TwapObservation | Resolved
    +-- twap_samples_count, last_sample_ts
    +-- winner, final_twap_a, final_twap_b
```

### 11.2 Instructions

**`initialize_market`**: Creates all accounts, mints total supply into token reserve vaults, initializes state.

**`buy_tokens(side, sol_amount, min_tokens_out)`**: Transfers SOL in, tokens out. Rejects after deadline.

**`sell_tokens(side, token_amount, min_sol_out)`**: Transfers tokens in, SOL out. Applies sell penalty if within protection window. Rejects after deadline.

**`record_twap_sample`**: Permissionless crank. Records current price (or lagging observation) of both sides.

**`resolve_market`**: Permissionless. Finalizes TWAPs, determines winner, executes reserve transfer.

**`sell_post_resolution(side, token_amount, min_sol_out)`**: Post-resolution only. No sell penalty.

**`graduate_to_dex(side)`**: Optional. Creates Meteora DAMM v2 pool via CPI.

---

## 12. Parameter Space

| Parameter | Description | Messi vs Ronaldo | Range |
|---|---|---|---|
| `a` | Curve steepness | 0.0000001 | Application-specific |
| `n` | Curve exponent | 1 (linear) | 1-3 |
| `b` | Base price (SOL) | 0.001 | > 0 |
| `W` | TWAP observation window | 12 hours | 1-24 hours |
| `dt` | TWAP sampling interval | 60 seconds | 10-300 seconds |
| `battle_tax` | % of losing reserve transferred | 70% (7000 bps) | 0-100% |
| `protocol_fee` | Fee on reserve transfers | 1.25% (125 bps) | 0-5% |
| `deadline` | Market duration | 7 days | 1 hour - 30 days |
| `sell_penalty_max` | Max additional sell fee | 15% (1500 bps) | 0-30% |
| `protection_activation_offset` | When sell penalty begins | 4 hours | 0 - market duration |
| `max_observation_change` | Lagging TWAP speed limit | 0 (disabled) | 0 - application-specific |
| `total_supply` | Tokens per side | 1,000,000 | Application-specific |

---

## 13. Use Cases

All of these share the same characteristic: the team building them has limited resources and the outcome is community-driven, not oracle-driven.

**Subjective debates.** Messi vs Ronaldo. Vim vs Emacs. Capital-weighted TWAP captures sustained community conviction. This is the core use case.

**Creative battles.** Two musicians or content creators compete. The market IS the engagement mechanic. The competition drives content creation.

**Token launch via competition.** Two meme tokens compete. Surviving tokens graduate to DAMM v2. The battle is the launch narrative. This is pump.fun with a story.

**Small DAO governance.** A 50-person DAO deciding between proposals. Cheaper and simpler than any alternative at this scale.

**Community-driven prediction.** "Is this project legitimate?" Not as precise as Polymarket, but infinitely more accessible for small communities.

**Competitive gaming.** Fan tokens for each team. TWAP as sentiment market.

**Dispute resolution.** Community members buy tokens on the side they believe is right. Economic skin in the game.

---

## 14. What Duel Is Not (Positioning Clarity)

| Property | Polymarket | Duel |
|---|---|---|
| Target user | Sophisticated traders, institutions | Fans, communities, small teams |
| Position size | $100 - $1M+ | $5 - $500 |
| Total market size | $100K - $100M+ | $1K - $50K |
| Price signal | Calibrated probability | Sentiment gauge |
| Payout | Fixed ($0 or $1 per contract) | Variable (sell into boosted curve) |
| Liquidity source | External market makers | Self-contained bonding curve |
| Resolution | Oracle / human committee | TWAP (capital-weighted conviction) |
| Cold start | Needs market makers | No external capital needed |
| Setup cost | High (MM relationships, oracle) | Zero (permissionless) |
| Outcome types | Objective (needs verifiable truth) | Subjective or objective |

This is not a competition. They serve different users at different scales for different purposes.

---

## 15. Comparison to Existing Primitives

| Property | Polymarket | MetaDAO | Pump.fun | Duel |
|---|---|---|---|---|
| Market type | Binary outcome | Conditional governance | Token launch | Competitive market |
| Liquidity source | External LPs / CLOB | External LPs | Bonding curve | Bonding curve |
| Cold start problem | Yes | Yes | No | No |
| External capital required | Yes | Yes | No | No |
| Manipulation resistance | Moderate | High (TWAP) | Low | High (TWAP) |
| Subjective outcome support | No | No | N/A | Yes |
| Target scale | Institutional | DAO-scale | Retail | Community-scale |
| Post-resolution token life | Dies | Dies | Lives | Configurable |
| Open source SDK | No | Partial | No | Yes (planned) |

---

## 16. Open Questions

### 16.1 Curve Coupling
Should buying Messi automatically sell a small amount of Ronaldo? Decision for v1: no coupling.

### 16.2 Dynamic Observation Window
Should TWAP window scale with market size? Adds complexity but improves adaptive security.

### 16.3 Multi-Outcome Extension
N sides, N bonding curves, highest-TWAP-wins. Useful for brackets or multi-option governance.

### 16.4 Oracle Hybrid
TWAP as default, oracle override for objective outcomes within a dispute window.

### 16.5 Batched Post-Resolution Settlement
All sell requests in a window processed at the same price. Eliminates speed advantage. Worth exploring for v2.

### 16.6 Minimum Participation Threshold
Should markets require minimum total reserve before TWAP begins? Prevents meaningless markets from resolving.

### 16.7 Lagging Observation Calibration
The `max_observation_change` parameter needs empirical tuning through simulation. Too low suppresses legitimate movements. Too high provides no protection. Recommended starting point: 5-10% of base price per sample, but this needs testing.

---

## 17. Technical Considerations for Solana

**Clock.** `Clock::get()?.unix_timestamp` for deadline checks and TWAP sampling.

**Precision.** u128 for TWAP accumulators. u64 for prices and reserves in lamports. Basis points for fees.

**Token program.** SPL Token. Token-2022 reserved for future.

**PDA derivation.** Market: `[b"market", creator, market_id]`. Side: `[b"side", market, side_index]`. Vaults: `[b"reserve", side, "sol"]` and `[b"reserve", side, "token"]`.

**Compute budget.** Polynomial curve math fits within default 200K CU for n <= 3. Binary search may need increase.

**CPI for graduation.** Meteora DAMM v2 program ID: `cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG`.

**Cranking.** Permissionless. Application-level automation or protocol fee incentives.

---

## 18. What This Document Is Not

This is a mechanism design thesis. It does not contain program code, SDK implementation, frontend specs, deployment procedures, or audit considerations. Those will be in the Implementation PRD.

---

## License

MIT. Build whatever you want with it.
