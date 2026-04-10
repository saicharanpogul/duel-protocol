import Lake
open Lake DSL

package duelVerification where
  leanOptions := #[
    ⟨`autoImplicit, false⟩
  ]

@[default_target]
lean_lib Proofs where
  srcDir := "."
