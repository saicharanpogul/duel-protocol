/-
  Mode 2 Withdrawal Math Formal Verification
-/

structure DuelPool where
  sideATotal : Nat
  sideBTotal : Nat
  netPool : Nat
  winner : Option Nat

structure Deposit where
  side : Nat
  amount : Nat

def winnerPayout (d : Deposit) (pool : DuelPool) : Nat :=
  match pool.winner with
  | some w =>
    if d.side = w then
      let winningTotal := if w = 0 then pool.sideATotal else pool.sideBTotal
      if winningTotal > 0 then d.amount * pool.netPool / winningTotal else 0
    else 0
  | none => d.amount

-- M2-2: Draw returns exact deposit
theorem draw_exact (d : Deposit) (pool : DuelPool)
    (h : pool.winner = none) :
    winnerPayout d pool = d.amount := by
  unfold winnerPayout; simp [h]

-- Loser gets zero
theorem loser_zero (d : Deposit) (pool : DuelPool) (w : Nat)
    (hw : pool.winner = some w) (hl : d.side ≠ w) :
    winnerPayout d pool = 0 := by
  unfold winnerPayout; simp [hw, hl]

-- Concrete: 1 SOL deposit, 1.5 SOL net pool, 1 SOL side total → 1.5 SOL payout
theorem concrete_winner_payout :
    winnerPayout ⟨0, 1000000000⟩ ⟨1000000000, 500000000, 1500000000, some 0⟩ = 1500000000 := by
  native_decide

-- Concrete: draw refund
theorem concrete_draw_refund :
    winnerPayout ⟨0, 500000000⟩ ⟨500000000, 500000000, 0, none⟩ = 500000000 := by
  native_decide

-- Concrete: loser gets nothing
theorem concrete_loser_zero :
    winnerPayout ⟨1, 500000000⟩ ⟨1000000000, 500000000, 1500000000, some 0⟩ = 0 := by
  native_decide

-- ═══════════════════════════════════════════════════════════════════
-- M2-3: Net pool conservation
-- net_pool = total_pool - fees
-- ═══════════════════════════════════════════════════════════════════

def BPS_DENOM : Nat := 10000

-- Fee calculation: fee = total * fee_bps / BPS_DENOM
def calcFee (total feeBps : Nat) : Nat :=
  total * feeBps / BPS_DENOM

-- Net pool after fees
def calcNetPool (sideATotal sideBTotal feeBps : Nat) : Nat :=
  let totalPool := sideATotal + sideBTotal
  let fee := calcFee totalPool feeBps
  totalPool - fee

-- M2-3: net_pool = total - fee (by definition)
theorem net_pool_is_total_minus_fee (sideA sideB feeBps : Nat) :
    calcNetPool sideA sideB feeBps =
    (sideA + sideB) - calcFee (sideA + sideB) feeBps := by
  rfl

-- M2-3b: net_pool <= total pool (fees are non-negative)
theorem net_pool_le_total (sideA sideB feeBps : Nat) :
    calcNetPool sideA sideB feeBps ≤ sideA + sideB := by
  unfold calcNetPool calcFee
  exact Nat.sub_le _ _

-- M2-3c: With 1% fee (100 bps), net_pool is 99% of total
-- Concrete: 1.5 SOL pool, 1% fee → fee = 15M lamports, net = 1.485 SOL
theorem concrete_fee_calculation :
    calcFee 1500000000 100 = 15000000 := by native_decide

theorem concrete_net_pool :
    calcNetPool 1000000000 500000000 100 = 1485000000 := by native_decide

-- M2-3d: Zero fee means net_pool = total
theorem zero_fee_no_deduction (sideA sideB : Nat) :
    calcNetPool sideA sideB 0 = sideA + sideB := by
  unfold calcNetPool calcFee
  simp [Nat.zero_div, Nat.sub_zero]
