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
