use anchor_lang::prelude::*;

#[event]
pub struct MarketCreated {
    pub market: Pubkey,
    pub authority: Pubkey,
    pub deadline: i64,
    pub market_id: u64,
    pub quote_mint: Pubkey,
}

#[event]
pub struct TokensBought {
    pub market: Pubkey,
    pub side: u8,
    pub buyer: Pubkey,
    pub quote_amount: u64,
    pub tokens_received: u64,
    pub fee_amount: u64,
    pub new_price: u64,
}

#[event]
pub struct TokensSold {
    pub market: Pubkey,
    pub side: u8,
    pub seller: Pubkey,
    pub token_amount: u64,
    pub quote_received: u64,
    pub fee_amount: u64,
    pub new_price: u64,
}

#[event]
pub struct TwapSampled {
    pub market: Pubkey,
    pub price_a: u64,
    pub price_b: u64,
    pub sample_count: u32,
    pub timestamp: i64,
}

/// Emitted when market resolves and graduates to DEX atomically
#[event]
pub struct MarketResolved {
    pub market: Pubkey,
    pub winner: u8,
    pub final_twap_a: u64,
    pub final_twap_b: u64,
    pub loser_reserve_transferred: u64,
    pub dex_pool: Pubkey,
    pub sol_seeded: u64,
    pub tokens_seeded: u64,
}

#[event]
pub struct ConfigUpdated {
    pub admin: Pubkey,
    pub paused: bool,
    pub trade_fee_bps: u16,
    pub creator_fee_split_bps: u16,
    pub market_creation_fee: u64,
}

#[event]
pub struct MarketClosed {
    pub market: Pubkey,
    pub authority: Pubkey,
}

#[event]
pub struct EmergencyResolved {
    pub market: Pubkey,
    pub resolver: Pubkey,
    pub timestamp: i64,
}

// Mode 2 (Compare Duel) events

#[event]
pub struct CompareDuelCreated {
    pub duel: Pubkey,
    pub authority: Pubkey,
    pub token_a_mint: Pubkey,
    pub token_b_mint: Pubkey,
    pub deadline: i64,
}

#[event]
pub struct Deposited {
    pub duel: Pubkey,
    pub depositor: Pubkey,
    pub side: u8,
    pub amount: u64,
}

#[event]
pub struct CompareTwapSampled {
    pub duel: Pubkey,
    pub price_a: u64,
    pub price_b: u64,
    pub sample_count: u32,
    pub timestamp: i64,
}

#[event]
pub struct CompareResolved {
    pub duel: Pubkey,
    pub winner: Option<u8>,
    pub perf_a_bps: i64,
    pub perf_b_bps: i64,
    pub net_pool: u64,
}

#[event]
pub struct Withdrawn {
    pub duel: Pubkey,
    pub depositor: Pubkey,
    pub payout: u64,
}
