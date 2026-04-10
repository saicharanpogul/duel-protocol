/-
  Oracle Validation Formal Verification
-/

def MAX_CONF_PCT : Nat := 10

def validateConf (price conf : Nat) : Bool :=
  decide (conf ≤ price * MAX_CONF_PCT / 100)

-- OR-1: Valid confidence passes
theorem valid_conf_passes :
    validateConf 13982000000 1398200000 = true := by native_decide

-- OR-1b: Over-limit confidence fails
theorem over_conf_fails :
    validateConf 13982000000 1398200001 = false := by native_decide

-- Price scaling
def scalePrice (price absExpo : Nat) : Nat :=
  if absExpo ≤ 9 then price * 10 ^ (9 - absExpo)
  else price / 10 ^ (absExpo - 9)

-- SOL: $139.82
theorem sol_scaling : scalePrice 13982000000 8 = 139820000000 := by native_decide

-- BONK: $0.02
theorem bonk_scaling : scalePrice 2000000 8 = 20000000 := by native_decide

-- Large expo divides
theorem large_expo : scalePrice 100 12 = 0 := by native_decide
