# Duel Protocol

## TWAP-Resolved Bonding Curves: A General-Purpose On-Chain Resolution Primitive

### Technical Thesis v0.1

---

## 1. Overview

Duel Protocol is a standalone, composable on-chain primitive for creating binary outcome markets with self-contained liquidity and manipulation-resistant resolution. It combines bonding curve token issuance with time-weighted average price (TWAP) resolution into a single generalized mechanism.

Two independent bonding curve tokens are created for each market, representing two sides of a binary outcome. Participants buy and sell tokens on either curve at any time. The bonding curve is the always-available counterparty. No external liquidity providers, no market makers, no seeded pools. At deadline, the side with the higher TWAP over a configurable observation window wins. A configurable portion of the losing side's reserve is transferred to the winning side's reserve, and winners realize gains by selling into a fatter curve.

No existing protocol combines these two primitives into a single generalized mechanism. MetaDAO uses TWAP on conditional tokens for governance decisions. Pump.fun uses bonding curves for token launches. Duel unifies both concepts into a general-purpose program and SDK that any developer can build on top of.

The bonding curve architecture is inspired by Meteora's Dynamic Bonding Curve (DBC) program, specifically its 16-point customizable curve design using constant-product segments between configurable price points. However, Duel is built from scratch as a purpose-built resolution protocol rather than a wrapper around an existing launch pool. This is necessary because the protocol requires deadline enforcement, TWAP sampling, cross-pool reserve transfers, and configurable sell-side protections, none of which are supported by existing bonding curve programs.

---

## 2. The Problem

Binary outcome markets (prediction markets, battles, votes, disputes) need three things:

1. **Liquidity.** Participants must be able to enter and exit positions at any time.
2. **Price discovery.** The market must continuously express which side is favored.
3. **Manipulation resistance.** The outcome must not be purchasable by a single wealthy actor.

Existing approaches fail on at least one axis.

**Parimutuel pools** (traditional betting): No liquidity because positions are locked. No price discovery because odds are implicit. Low manipulation resistance because whales dominate.

**Order book prediction markets** (Polymarket): Good price discovery. But liquidity requires external market makers. Thin markets on long-tail outcomes break the UX.

**AMM prediction markets**: Require seeded liquidity pools. Someone bears impermanent loss. Cold start problem persists.

**Bonding curves with closing price resolution**: This was our original design before Duel. Bonding curves solve the liquidity and price discovery problems elegantly. The curve is the always-available counterparty, and the price is a direct function of supply. However, using the closing price (the instantaneous price at deadline) as the resolution mechanism introduces a critical vulnerability: last-second manipulation. An attacker can buy a massive position one second before the deadline, spike the price, and win. The cost of this attack is bounded only by the slippage on a single trade, which in many markets is affordable. This vulnerability led directly to the TWAP resolution design.

---

## 3. Mechanism Design

### 3.1 Market Structure

Each Duel market consists of:

- **Two bonding curve pools**, one for Side A and one for Side B.
- **A shared market state** that tracks configuration, deadline, TWAP accumulators, and resolution status.
- **A lifecycle** with three phases: Active Trading, TWAP Observation, and Resolved.

The two pools are independent. Buying Token A does not directly affect Token B's price. This is a deliberate design choice. Coupling the curves (where buying A automatically sells B) would enforce complementary pricing but adds cross-pool dependencies, increases instruction complexity, and makes the manipulation cost analysis harder to reason about. Independence keeps the system simple and composable.

### 3.2 Bonding Curve Specification

The curve architecture is inspired by Meteora DBC's Universal Curve design: an up-to-16-point customizable curve where each segment between two price points behaves as a constant-product curve. This allows market creators to shape the price/liquidity distribution with fine granularity.

For the thesis, we describe the simplified polynomial form. The implementation may use the multi-segment approach.

```
price(k) = a * k^n + b
```

Where:
- `k` = current token supply in the pool's token reserve
- `a` = curve steepness coefficient
- `n` = exponent (1 = linear, 2 = quadratic)
- `b` = base price (minimum price at zero circulating supply)

The reserve `R` at supply `k` is the integral:

```
R(k) = a * k^(n+1) / (n+1) + b * k
```

For a linear curve (n = 1):

```
price(k) = a * k + b
R(k) = (a/2) * k^2 + b * k
```

**Buying.** A participant sends SOL (or any configured quote token) to the pool. The protocol calculates how many tokens that SOL purchases given the current price and slippage along the curve. Tokens are transferred from the pool's token reserve to the buyer. The SOL reserve increases.

**Selling.** A participant sends tokens back to the pool's token reserve. The protocol calculates the SOL to return based on the current price and slippage. SOL reserve decreases. Tokens are not burned; they return to the pool's token reserve, available for future buyers.

This is an important distinction from burn-based bonding curves. The total token supply is fixed at market creation. The bonding curve tracks circulating supply (tokens held by participants) versus reserve supply (tokens held by the pool). Price is a function of circulating supply, not total supply.

### 3.3 TWAP Calculation

The protocol records the price of each token at fixed intervals during a configurable observation window `W` in the final portion of the market's lifetime.

The observation window begins at `deadline - W` and ends at `deadline`. During this window, a permissionless crank instruction records price samples at intervals of `dt` seconds.

Discrete TWAP with `N` observations at equal intervals:

```
TWAP_A = (1/N) * SUM(price_A(t_i)) for i = 1 to N
TWAP_B = (1/N) * SUM(price_B(t_i)) for i = 1 to N
```

Example: A 6-hour observation window with a 60-second sampling interval produces 360 price observations per side.

**Resolution rule.** If `TWAP_A > TWAP_B`, Side A wins. If `TWAP_B > TWAP_A`, Side B wins. In the unlikely event of exact equality, the side with higher SOL reserve at deadline wins as a tiebreaker.

### 3.4 Deadline Enforcement

The market program enforces a hard deadline. The buy and sell instructions check `Clock::get()?.unix_timestamp` against the market's deadline. After the deadline, all trading is rejected at the program level. This is a fundamental requirement that cannot be achieved by wrapping an external bonding curve program, because external programs have no concept of your market's lifecycle.

The lifecycle transitions are:

1. **Active Trading** (market creation to `deadline - W`): Normal buy/sell. No TWAP sampling.
2. **TWAP Observation** (`deadline - W` to `deadline`): Normal buy/sell continues. TWAP samples are recorded every `dt` seconds.
3. **Resolved** (after `deadline` + resolution call): No more trading. TWAP finalized. Reserve transfer executed. Winners can sell into their boosted curve.

---

## 4. Resolution and Settlement

### 4.1 Reserve Transfer (Battle Tax)

At resolution:

1. TWAP for both sides is finalized.
2. The winning side is determined.
3. A configurable percentage (`battle_tax`) of the losing side's SOL reserve is transferred directly into the winning side's SOL reserve.

This is the core settlement mechanic. The winning side's bonding curve now has more SOL backing the same circulating token supply, which means the price on the winning curve jumps. Winners realize gains by selling their tokens into this fatter curve.

**`battle_tax` is fully configurable per market**, ranging from 0% (no transfer, effectively a sentiment market) to 100% (full drain, losing tokens become worthless).

### 4.2 Post-Resolution Dynamics: The Race to Sell

This section exists to be honest about what happens after resolution. Do not skip it.

When the losing reserve dumps into the winning pool, the price on the winning curve is artificially elevated above what organic demand would support. Every rational winning holder knows this. The game theory is a prisoner's dilemma:

- If you sell immediately, you capture the inflated price.
- If you wait, other sellers drain the reserve before you, and you get less.
- If everyone sells at once, the price crashes back down and late sellers get wrecked.

This means **early sellers after resolution capture more value than late sellers**. This is not a bug, it is an inherent property of the dump-into-pool mechanic. The alternative (snapshot-based proportional claims) eliminates this dynamic but requires a separate claim instruction and doesn't allow the winning token to continue trading naturally.

We chose the race-to-sell mechanic for several reasons:

1. **Simplicity.** No claim instruction. No snapshot. No vesting. Winners just sell when they want.
2. **Immediate liquidity.** Winners can exit instantly. No waiting for claim periods.
3. **Rewards conviction.** Participants who held strong positions through the TWAP window and sell promptly after resolution are rewarded most. This aligns incentives with genuine participation rather than last-minute speculation.
4. **Natural price discovery.** The post-resolution sell pressure organically finds the token's "real" price, which matters for the Token Persistence extension (Section 6).

Applications building on Duel should communicate this dynamic clearly to their users. "Winners compete to realize gains" is the accurate framing, not "winners get X payout."

### 4.3 Payout Mechanics (Detailed)

Let `R_loser` be the losing side's SOL reserve at resolution. Let `R_winner` be the winning side's SOL reserve at resolution.

After resolution:

```
R_winner_new = R_winner + (battle_tax * R_loser * (1 - protocol_fee))
R_loser_new = R_loser * (1 - battle_tax)
```

The winning curve's price immediately reflects the new reserve:

```
price_winner_new = f(circulating_supply_winner, R_winner_new)
```

Since circulating supply hasn't changed but the reserve backing it has increased, the price jumps. The magnitude of the jump depends on the curve shape, the battle_tax percentage, the relative sizes of the two reserves, and the winning side's circulating supply.

If `battle_tax = 100%` and `protocol_fee = 1.25%`:

```
R_winner_new = R_winner + (0.9875 * R_loser)
R_loser_new = 0
```

Losing tokens become worthless (zero reserve backing). Winning token price jumps by the full transferred amount.

---

## 5. Manipulation Resistance

### 5.1 TWAP as a Defense

The TWAP observation window is the primary manipulation defense. To shift the TWAP outcome, an attacker must sustain elevated prices over a significant portion of the window, not just spike the price momentarily.

A single large buy at `T - 1 minute` with a 6-hour observation window and 60-second sampling intervals influences only 1 out of 360 data points (approximately 0.28% of the TWAP). To meaningfully shift the outcome, the attacker must sustain buying pressure for hours.

### 5.2 Cost of Manipulation

The cost to shift the TWAP by amount `d` over duration `t_hold` within the observation window:

```
C(d, t_hold) = slippage_cost(delta_supply) + opportunity_cost(capital_locked) + extraction_loss(arbitrage)
```

Where:

**Slippage cost.** The attacker must buy enough tokens to push the price up by `d`. On a polynomial curve, the cost to move from price `p` to price `p + d` is the integral of the curve between the corresponding supply levels. This grows superlinearly with `d` on any curve with `n >= 1`.

**Opportunity cost.** The capital is locked for `t_hold`. In crypto markets with high opportunity costs, this is non-trivial.

**Extraction loss.** This is the killer. While the attacker holds a position to sustain an artificially high price, every other participant sees a sell opportunity. Rational sellers dump into the inflated price, extracting SOL from the curve. The attacker's position loses value with every sell. The longer they hold, the more they bleed.

The extraction loss creates a dynamic where sustained manipulation is not just expensive but continuously punished. This is qualitatively different from order book manipulation, where a large limit order can sit passively. On a bonding curve, the attacker's capital is actively drained by rational counterparties.

### 5.3 Minimum Effective Manipulation Window

For a manipulation to change the outcome, the attacker must shift the TWAP of their side above the other side's TWAP. If Side A has TWAP of `p_a` and the attacker wants Side B to win, they need:

```
TWAP_B_manipulated > TWAP_A
```

If the attacker starts manipulating at time `t_start` within the observation window, and the observation window has `N` total samples:

```
TWAP_B_manipulated = (1/N) * [SUM(price_B(t_i) for i before t_start) + SUM(price_B_elevated(t_i) for i after t_start)]
```

The number of samples the attacker can influence is `(T - t_start) / dt`. For this to overcome an existing TWAP deficit, the price elevation must be proportionally larger the later the manipulation starts. A last-hour manipulation attempt against a 6-hour window requires 6x the price elevation compared to a full-window manipulation, which means 6x the capital at risk and 6x the extraction loss exposure.

---

## 6. Sell-Side Protection (Bank Run Prevention)

### 6.1 The Problem

If the losing side's participants see resolution approaching and sell all their tokens before deadline, the losing reserve approaches zero. The battle_tax transfer becomes meaningless because `battle_tax * 0 = 0`. Winners get nothing.

This is a rational bank run. If you hold losing tokens and can sell before deadline, you should. But if everyone does, the protocol's incentive structure collapses.

### 6.2 Asymmetric Sell Penalty

The protocol applies a progressive sell penalty that increases as the reserve ratio drops:

```
sell_penalty(r) = base_fee + max_penalty * (1 - r / r_peak)^2
```

Where:
- `r` = current SOL reserve
- `r_peak` = historical peak SOL reserve for this side
- `base_fee` = normal sell fee (e.g., 1%)
- `max_penalty` = maximum additional sell fee (configurable, e.g., 15%)

As the reserve drains relative to its peak, selling becomes progressively more expensive. At 50% of peak reserve, the penalty is modest. At 10% of peak reserve, it becomes severe.

This ensures a meaningful portion of the peak reserve (estimated 20-30%) remains locked at settlement even in worst-case exit scenarios.

### 6.3 Configurable Protection Activation

The sell penalty does not need to be active for the entire market lifetime. The `protection_activation_offset` parameter defines when the penalty begins, measured as time before the deadline.

```
penalty_active = Clock::get()?.unix_timestamp >= (deadline - protection_activation_offset)
```

If `protection_activation_offset = 7200` (2 hours), sell penalties only apply in the final 2 hours before deadline. Before that, selling is unrestricted.

This lets market creators tune the tradeoff:

- **Short offset (1-2 hours):** Maximum liquidity for most of the market's life. Bank run protection only in the critical final period. Risk: a coordinated early exit before the penalty window opens.
- **Long offset (12-24 hours):** Stronger reserve protection. But reduced sell-side liquidity discourages participation because traders feel locked in.
- **Full duration (offset = deadline - creation_time):** Penalty active from market creation. Maximum reserve protection but worst liquidity. Suitable only for very short-duration markets.

---

## 7. Normalized Probability Signal

Although the two bonding curves are independent, a normalized probability can be derived for display purposes:

```
P(A) = price(A) / [price(A) + price(B)]
```

This gives applications a clean "Side A: 68%" display familiar to prediction market users.

**Important caveat.** Because the curves are independent, both sides' prices can rise simultaneously if capital flows into both curves. This means the normalized probability can be noisy during periods of high bilateral inflow. The absolute prices of A and B might both double, while the probability ratio barely moves.

Applications can optionally implement a **coupling mechanism** where a portion of each buy is used to sell the opposing token, enforcing complementary pricing. This is discussed as an open question in Section 11.

---

## 8. Token Persistence (Optional Extension)

When `battle_tax < 100%`, the losing side retains residual reserve:

```
R_loser_residual = R_loser * (1 - battle_tax)
```

Both tokens survive post-resolution and can continue trading on their bonding curves, reflecting any ongoing cultural, commercial, or speculative value.

### 8.1 DEX Graduation

At settlement, surviving tokens can migrate to a DEX (e.g., Meteora DAMM v2) with their remaining reserves seeding the initial liquidity pool. The program creates a DAMM v2 pool via CPI, depositing the residual reserve as the quote token and the pool's remaining token reserve as the base token.

### 8.2 Revenue Attachment

External revenue streams (royalties, dividends, licensing fees) can be distributed to token holders proportionally by depositing SOL into the bonding curve's reserve, increasing the price for all holders. This gives tokens fundamental value beyond speculation.

### 8.3 Clean Finality

Applications that want binary finality set `battle_tax = 100%`. Both tokens go to zero reserve at resolution. No persistence, no graduation, no ambiguity.

---

## 9. Program Architecture (Conceptual)

This section describes the Solana program architecture at a conceptual level. Full implementation details (Anchor IDL, SDK interfaces, CPI specifications) will be covered in the Implementation PRD.

### 9.1 Account Structure

```
Market (PDA: [b"market", creator, market_id])
|
+-- SideA (PDA: [b"side", market, 0])
|   +-- token_mint: Pubkey (SPL Token or Token-2022)
|   +-- token_reserve_vault: Pubkey (holds unsold tokens)
|   +-- sol_reserve_vault: Pubkey (holds SOL from buys)
|   +-- circulating_supply: u64
|   +-- total_supply: u64
|   +-- peak_reserve: u64
|   +-- twap_accumulator: u128
|
+-- SideB (PDA: [b"side", market, 1])
|   +-- (same structure as SideA)
|
+-- MarketConfig
|   +-- deadline: i64
|   +-- twap_window: u64
|   +-- twap_interval: u64
|   +-- battle_tax_bps: u16
|   +-- protocol_fee_bps: u16
|   +-- sell_penalty_max_bps: u16
|   +-- protection_activation_offset: u64
|   +-- curve_params: CurveParams
|
+-- MarketState
    +-- status: enum { Active, TwapObservation, Resolved }
    +-- twap_samples_count: u32
    +-- last_sample_ts: i64
    +-- winner: Option<Side>
    +-- final_twap_a: u64
    +-- final_twap_b: u64
    +-- authority: Pubkey (market creator)
```

### 9.2 Instructions

**`initialize_market`**: Creates the market PDA, both side PDAs, mints the total token supply for each side into their respective reserve vaults, initializes all state. Requires rent deposit for all accounts.

**`buy_tokens(side, sol_amount)`**: Accepts SOL, calculates tokens to transfer from the side's token reserve vault to the buyer based on curve math, updates circulating supply and SOL reserve. Rejects if market status is Resolved or if `timestamp > deadline`.

**`sell_tokens(side, token_amount)`**: Accepts tokens back into the side's token reserve vault, calculates SOL to return based on curve math and any applicable sell penalty. Updates circulating supply and SOL reserve. Rejects if market status is Resolved or if `timestamp > deadline`.

**`record_twap_sample`**: Permissionless. Checks that timestamp is within the TWAP observation window. Checks that at least `dt` seconds have elapsed since `last_sample_ts`. Reads current price from both curves (derived from circulating supply). Adds both prices to their respective TWAP accumulators. Increments sample count. Caller can be incentivized by a small reward from protocol fees or by the application layer.

**`resolve_market`**: Callable by anyone after `deadline`. Finalizes TWAP values. Determines winner. Executes the reserve transfer: withdraws `battle_tax * R_loser * (1 - fee)` SOL from the losing side's reserve vault and deposits it into the winning side's reserve vault. Protocol fee is sent to the protocol fee account. Updates market status to Resolved. After this instruction, buy/sell are permanently disabled for this market. The winning and losing curves reflect their new reserves. Holders sell through a separate post-resolution sell instruction.

**`sell_post_resolution(side)`**: Available only after resolution. Allows any token holder on either side to sell their tokens back into the curve at the post-resolution price. This is the mechanism through which winners realize gains and losers exit remaining positions (if `battle_tax < 100%`).

**`graduate_to_dex(side, dex_program)`**: Optional. Creates a DEX pool via CPI using the side's residual reserve and remaining token supply. Only callable after resolution and only if the side has residual reserve.

### 9.3 TWAP Sampling Detail

The TWAP accumulator uses `u128` to prevent overflow. With 60-second intervals over a 24-hour window, maximum samples = 1,440. With token prices stored as u64 lamport values (max ~18.4 * 10^18), the accumulator needs at most `1440 * 18.4 * 10^18 ≈ 2.65 * 10^22`, which fits comfortably in u128 (max ~3.4 * 10^38).

Price at each sample is deterministic: it is derived from the current circulating supply using the curve formula. No oracle needed, no external price feed. The price is a pure function of on-chain state.

Sampling is permissionless and can be called by anyone. If a sample is missed (nobody cranked for one or more intervals), the TWAP simply has fewer data points. The protocol does not interpolate. Fewer samples slightly reduce manipulation resistance but the TWAP remains valid. Applications can run their own cranker service or use an automation network (Clockwork, Jito, etc.) to guarantee consistent sampling.

---

## 10. Parameter Space and Tradeoffs

### 10.1 Core Parameters

| Parameter | Description | Suggested Default | Range | Tradeoff |
|---|---|---|---|---|
| `a` | Curve steepness | 0.0001 | Application-specific | Higher = more slippage per trade = stronger manipulation resistance but worse UX for large trades |
| `n` | Curve exponent | 1 (linear) | 1-3 | Higher = superlinear slippage growth = better for large markets, worse for small ones |
| `b` | Base price (SOL) | 0.001 | > 0 | Lower = cheaper entry = more accessible but more tokens needed for meaningful price signal |
| `W` | TWAP observation window | 6 hours | 1-24 hours | Longer = stronger manipulation resistance but slower resolution |
| `dt` | TWAP sampling interval | 60 seconds | 10-300 seconds | Shorter = more data points = smoother TWAP but more crank transactions |
| `battle_tax` | % of losing reserve transferred | 60% | 0-100% | Higher = bigger winner payoff but more aggressive losing-side bank run incentive |
| `protocol_fee` | Fee on reserve transfers | 1.25% | 0-5% | Protocol revenue vs. participant returns |
| `deadline` | Market duration | 24 hours | 1 hour - 30 days | Longer = more time for price discovery but capital locked longer |
| `sell_penalty_max` | Max additional sell fee | 15% | 0-30% | Higher = stronger bank run protection but reduced sell-side liquidity |
| `protection_activation_offset` | When sell penalty begins (before deadline) | 2 hours | 0 - market duration | Longer = more protection but less liquidity for longer |
| `total_supply` | Tokens per side | 1,000,000 | Application-specific | Determines granularity of positions and curve resolution |

### 10.2 Parameter Interactions

**battle_tax vs. sell_penalty_max.** These are in tension. High battle_tax creates strong incentive for the losing side to exit before resolution. High sell_penalty_max prevents that exit. If battle_tax is 100% and sell_penalty_max is 0%, the losing side will rationally sell everything and the winner's prize is zero. If battle_tax is 100% and sell_penalty_max is 30%, meaningful reserve remains. The recommended pairing: battle_tax of 60-80% with sell_penalty_max of 10-20%.

**W (TWAP window) vs. deadline.** The observation window should be a significant fraction of the total market duration. A 6-hour TWAP window on a 24-hour market means the final 25% of market life determines the outcome. A 6-hour window on a 7-day market means less than 4% determines it, which frontloads all the meaningful trading into the last 6 hours. Recommended: W should be 15-30% of total market duration.

**dt (sampling interval) vs. W.** More samples per window = smoother TWAP = harder to manipulate but more crank transactions required. At 60-second intervals over 6 hours, 360 samples need 360 crank calls. At 10-second intervals, 2,160 calls. The crank cost (transaction fees + compute) sets a practical lower bound on `dt`.

---

## 11. Open Questions

### 11.1 Curve Coupling

Should buying Token A automatically sell a small amount of Token B? This would enforce complementary pricing where if P(A) goes up, P(B) goes down, giving a cleaner probability signal. The cost: cross-pool CPI on every trade, more compute units, and the coupling ratio itself becomes a parameter that is hard to set correctly. For the initial version, independent curves with normalized probability as a display layer is simpler and sufficient.

### 11.2 Dynamic Observation Window

Should the TWAP window scale with market size? Larger markets (more SOL at stake) are more attractive manipulation targets and could benefit from longer windows. Smaller markets need faster resolution. This could be implemented as a formula: `W = base_window + scale_factor * log(total_reserve)`. Adds complexity but improves adaptive security.

### 11.3 Multi-Outcome Extension

Duel is binary (two sides). Extending to N sides means N bonding curves with TWAP comparison across all of them. Resolution becomes highest-TWAP-wins. The reserve transfer logic scales: battle_tax of each losing side goes to the winner. Complexity is linear in N. The main challenge is that with N > 2, the probability normalization becomes `P(i) = price(i) / SUM(price(j) for all j)`, which is messier to reason about but still functional.

### 11.4 Oracle Hybrid

For use cases with objectively verifiable outcomes (sports, elections), TWAP can serve as a primary resolution mechanism, a fallback when an oracle is disputed or delayed, or a signal that is combined with oracle data (e.g., weighted average of TWAP outcome and oracle outcome). The cleanest design: use TWAP as the default and accept an oracle override only if submitted by a trusted authority within a dispute window after TWAP resolution.

### 11.5 Governance of Parameters

Who sets curve parameters, TWAP windows, and battle_tax for each market? Three options:

1. **Market creator decides.** Maximum flexibility. Risk of malicious parameter choices (e.g., zero TWAP window).
2. **Protocol-level parameter bounds.** The program enforces min/max ranges. Creators choose within bounds.
3. **Configuration templates.** The protocol provides pre-approved parameter sets. Creators pick a template. Simplest UX but least flexible.

Recommendation: Option 2. Hard-coded bounds in the program with creator freedom within those bounds.

### 11.6 Post-Resolution Sell Window

Should there be a time limit on post-resolution selling? If a token persists indefinitely with residual reserve, the sell_post_resolution instruction stays open forever. For clean finality, a configurable `claim_window` after which residual reserves are swept to a treasury or burned makes the lifecycle predictable.

---

## 12. Use Cases

This primitive is general-purpose. Any application that needs a binary outcome market with self-contained liquidity can use it.

**Governance.** DAOs use TWAP-resolved markets to decide proposals. Similar to MetaDAO's futarchy approach but with bonding curve liquidity instead of order books, eliminating the cold start problem.

**Content curation.** Two pieces of content compete. Capital flows signal quality. TWAP prevents last-second gaming. Winners earn from the losing side's reserve.

**Prediction markets.** Any yes/no question. "Will X happen by Y date?" Built-in liquidity from bonding curves solves the cold start problem that plagues traditional prediction market platforms.

**Competitive gaming.** Two teams or players compete. Fans buy tokens on their side. TWAP resolution prevents match-fixing manipulation because sustained price elevation over the full observation window is prohibitively expensive.

**Dispute resolution.** Two parties in a dispute. Community members buy tokens on the side they believe is right. TWAP-weighted consensus with economic skin in the game.

**Meme battles.** Two meme tokens compete head-to-head. TWAP over 24 hours decides which one wins. Losing reserve rewards winning holders.

**Music/creative battles.** Two artists or tracks compete. Capital flows curate quality. TWAP determines the winner. Battle tax rewards the supporters of the winning side.

**Sports and esports.** Side tokens for each team in a match. TWAP as a pre-game sentiment market, or resolution via oracle for objective outcomes.

---

## 13. Comparison to Existing Primitives

| Property | Polymarket | MetaDAO | Pump.fun | Duel |
|---|---|---|---|---|
| Market type | Binary outcome | Conditional governance | Token launch | Binary outcome |
| Liquidity source | External LPs / CLOB | External LPs | Bonding curve | Bonding curve |
| Cold start problem | Yes | Yes | No | No |
| Manipulation resistance | Moderate (large markets) | High (TWAP) | Low | High (TWAP) |
| Position flexibility | Full | Full | Full (buy/sell) | Full |
| Resolution mechanism | External oracle | TWAP | Graduation threshold | TWAP |
| Post-resolution token life | Dies (0 or 1) | Dies | Lives (graduates) | Configurable |
| Deadline enforcement | External | External | None (threshold) | On-chain, program-level |
| Open source SDK | No | Partial | No | Yes (planned) |
| General purpose | Yes | No (governance only) | No (launches only) | Yes |

---

## 14. Technical Considerations for Solana

**Clock.** Use `Clock::get()?.unix_timestamp` for deadline checks and TWAP sampling. Solana's clock is accurate to approximately 1 second. For TWAP sampling intervals of 60 seconds, this precision is more than sufficient.

**Precision.** Use u128 for TWAP accumulators. Use u64 for prices and reserves (denominated in lamports). All fee calculations in basis points to avoid floating point.

**Token program.** SPL Token for simplicity. Token-2022 if transfer hooks are needed for future extensions (e.g., on-transfer sell penalty enforcement). For the initial version, sell penalties are enforced at the instruction level, so SPL Token suffices.

**PDA derivation.** Market PDA: `[b"market", creator.key, market_id]`. Side PDA: `[b"side", market.key, side_enum]`. Reserve vaults: `[b"reserve", side.key, "sol"]` and `[b"reserve", side.key, "token"]`.

**Rent.** Each market creates approximately 7 accounts (market state, 2 side states, 2 token mints, 2 reserve vaults). Rent-exempt minimums must be covered by the market creation deposit. This deposit can be refunded to the creator when the market is closed (if all accounts are emptied).

**Compute budget.** Buy/sell instructions involve curve math (exponentiation, integration). For polynomial curves with small exponents (n <= 3), this fits within Solana's default compute budget (200K CU). Multi-segment curves (16-point) may require a compute budget increase request (up to 1.4M CU).

**CPI for graduation.** DEX pool creation (Meteora DAMM v2 or Raydium) via CPI. The program transfers residual SOL reserve and remaining token supply to seed the pool. CPI interfaces must be versioned in case DEX programs update.

**Cranking.** TWAP sampling is permissionless. Incentivize crankers with a small share of the protocol fee or rely on application-level automation. Clockwork, Jito bundles, or a simple cron-based bot can guarantee sampling at the configured interval.

---

## 15. What This Document Is Not

This is a mechanism design thesis. It describes what Duel does, why each design choice was made, and what tradeoffs exist. It does not contain:

- Full Anchor program code
- TypeScript SDK implementation
- Frontend specifications
- Deployment procedures
- Audit considerations
- Tokenomics for a protocol token

These will be covered in the Implementation PRD, which will be written once the thesis is reviewed and the mechanism design is finalized.

---

## License

MIT. Build whatever you want with it.
