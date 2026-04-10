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
