#![allow(ambiguous_glob_reexports)]

// Mode 1 (Duel Mint) instructions
pub mod initialize_market;
pub mod initialize_config;
pub mod update_config;
pub mod buy_tokens;
pub mod sell_tokens;
pub mod record_twap_sample;
pub mod resolve_and_graduate;
pub mod sell_post_resolution;
pub mod close_quote_vault;
pub mod claim_pool_fees;
pub mod close_market;
pub mod emergency_resolve;

pub use initialize_market::*;
pub use initialize_config::*;
pub use update_config::*;
pub use buy_tokens::*;
pub use sell_tokens::*;
pub use record_twap_sample::*;
pub use resolve_and_graduate::*;
pub use sell_post_resolution::*;
pub use close_quote_vault::*;
pub use claim_pool_fees::*;
pub use close_market::*;
pub use emergency_resolve::*;

// Mode 2 (Duel Compare) instructions
pub mod create_compare_duel;
pub mod deposit;
pub mod record_compare_twap;
pub mod resolve_compare;
pub mod withdraw;
pub mod emergency_resolve_compare;
pub mod close_compare_duel;
pub mod close_deposit;

pub use create_compare_duel::*;
pub use deposit::*;
pub use record_compare_twap::*;
pub use resolve_compare::*;
pub use withdraw::*;
pub use emergency_resolve_compare::*;
pub use close_compare_duel::*;
pub use close_deposit::*;
