/-
  Bonding Curve Formal Verification
  price(k) = a * k^n / CURVE_SCALE + b
-/

def CURVE_SCALE : Nat := 1000000000
def U64_MAX : Nat := 18446744073709551615
def U128_MAX : Nat := 340282366920938463463374607431768211455

def price (k a b n scale : Nat) : Nat :=
  a * k ^ n / scale + b

def reserveIntegral (k a b n scale : Nat) : Nat :=
  a * k ^ (n + 1) / ((n + 1) * scale) + b * k

-- BC-1: Price floor is always >= b
theorem price_ge_base (k a b n scale : Nat) :
    price k a b n scale ≥ b := by
  unfold price; exact Nat.le_add_left b _

-- BC-2: Reserve at zero is zero
theorem reserve_at_zero (a b n scale : Nat) :
    reserveIntegral 0 a b n scale = 0 := by
  unfold reserveIntegral
  simp

-- BC-4: price(10^9) with production params fits u64
theorem price_max_supply_u64 :
    price 1000000000 1 1 2 CURVE_SCALE ≤ U64_MAX := by
  native_decide

-- BC-4b: reserve(10^9) with production params fits u128
theorem reserve_max_supply_u128 :
    reserveIntegral 1000000000 1 1 2 CURVE_SCALE ≤ U128_MAX := by
  native_decide

-- ═══════════════════════════════════════════════════════════════════
-- BC-3: sol_out correctness
-- sol_out(t, k) = R(k) - R(k - t) by definition
-- ═══════════════════════════════════════════════════════════════════

def solOut (tokenAmount supply a b n scale : Nat) : Nat :=
  reserveIntegral supply a b n scale - reserveIntegral (supply - tokenAmount) a b n scale

-- BC-3: sol_out is defined as R(supply) - R(supply - amount)
-- This is a definitional equality (the Rust code does exactly this)
theorem sol_out_is_reserve_diff (t k a b n scale : Nat) :
    solOut t k a b n scale =
    reserveIntegral k a b n scale - reserveIntegral (k - t) a b n scale := by
  rfl

-- BC-3b: Selling zero tokens returns zero SOL
theorem sol_out_zero_tokens (k a b n scale : Nat) :
    solOut 0 k a b n scale = 0 := by
  unfold solOut; simp

-- BC-3c: Selling all tokens returns full reserve
theorem sol_out_all_tokens (k a b n scale : Nat) :
    solOut k k a b n scale = reserveIntegral k a b n scale := by
  unfold solOut
  simp [Nat.sub_self, reserve_at_zero]

-- BC-3d: Concrete roundtrip with production params
-- Buy 1000 tokens at supply=0, sell 1000 tokens → returns R(1000)
theorem concrete_roundtrip :
    solOut 1000 1000 1 1 2 CURVE_SCALE = reserveIntegral 1000 1 1 2 CURVE_SCALE := by
  native_decide
