/-
  State Machine Formal Verification
  Market status only moves forward. Winner set once. Deposits immutable.
-/

inductive MarketStatus where
  | active
  | twapObservation
  | resolved
  deriving DecidableEq, Repr

def statusOrd : MarketStatus → Nat
  | .active => 0
  | .twapObservation => 1
  | .resolved => 2

def validTransition : MarketStatus → MarketStatus → Bool
  | .active, .twapObservation => true
  | .active, .resolved => true
  | .twapObservation, .resolved => true
  | _, _ => false

-- SM-1: Resolved is terminal (no valid transition from resolved)
theorem resolved_terminal (s : MarketStatus) :
    validTransition .resolved s = false := by
  cases s <;> rfl

-- SM-1b: All valid transitions increase status ordinal
theorem valid_increases_ord (s1 s2 : MarketStatus)
    (h : validTransition s1 s2 = true) :
    statusOrd s1 < statusOrd s2 := by
  cases s1 <;> cases s2 <;> simp [validTransition] at h <;> simp [statusOrd]

-- SM-1c: No backward transitions
theorem no_backward (s1 s2 : MarketStatus)
    (h : validTransition s1 s2 = true) :
    validTransition s2 s1 = false := by
  cases s1 <;> cases s2 <;> simp [validTransition] at *

-- SM-2: Winner immutability via resolve transition
structure ResolvedMarket where
  winner : Option Nat
  status : MarketStatus

def resolveTransition (m : ResolvedMarket) (w : Nat) : Option ResolvedMarket :=
  if m.status ≠ .resolved then
    some { winner := some w, status := .resolved }
  else none

theorem resolve_sets_winner (pre post : ResolvedMarket) (w : Nat)
    (h : resolveTransition pre w = some post) :
    post.winner = some w := by
  unfold resolveTransition at h
  split at h
  · simp at h; cases h; rfl
  · simp at h

theorem resolved_blocks_re_resolve (m : ResolvedMarket) (w : Nat)
    (h : m.status = .resolved) :
    resolveTransition m w = none := by
  unfold resolveTransition
  simp [h]

-- ═══════════════════════════════════════════════════════════════════
-- SM-3: Deposit immutability
-- Side and amount never change. Only withdrawn can flip false -> true.
-- ═══════════════════════════════════════════════════════════════════

structure DepositRecord where
  side : Nat
  amount : Nat
  withdrawn : Bool
  deriving DecidableEq

-- Only allowed mutation: set withdrawn = true
def withdrawDeposit (d : DepositRecord) : Option DepositRecord :=
  if d.withdrawn = false then
    some { side := d.side, amount := d.amount, withdrawn := true }
  else none

theorem withdraw_preserves_side (d : DepositRecord) (d' : DepositRecord)
    (h : withdrawDeposit d = some d') :
    d'.side = d.side := by
  unfold withdrawDeposit at h
  split at h
  · simp at h; cases h; rfl
  · simp at h

theorem withdraw_preserves_amount (d : DepositRecord) (d' : DepositRecord)
    (h : withdrawDeposit d = some d') :
    d'.amount = d.amount := by
  unfold withdrawDeposit at h
  split at h
  · simp at h; cases h; rfl
  · simp at h

theorem withdraw_sets_true (d : DepositRecord) (d' : DepositRecord)
    (h : withdrawDeposit d = some d') :
    d'.withdrawn = true := by
  unfold withdrawDeposit at h
  split at h
  · simp at h; cases h; rfl
  · simp at h

theorem double_withdraw_blocked (d : DepositRecord)
    (h : d.withdrawn = true) :
    withdrawDeposit d = none := by
  unfold withdrawDeposit; simp [h]
