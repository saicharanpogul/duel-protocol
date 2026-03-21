use quasar_lang::prelude::*;

#[event(discriminator = 0)]
pub struct MarketCreated {
    pub market: Address,
    pub authority: Address,
    pub deadline: i64,
    pub market_id: u64,
    pub quote_mint: Address,
}

#[event(discriminator = 1)]
pub struct TokensBought {
    pub market: Address,
    pub side: u64,
    pub buyer: Address,
    pub quote_amount: u64,
    pub tokens_received: u64,
    pub fee_amount: u64,
    pub new_price: u64,
}

#[event(discriminator = 2)]
pub struct TokensSold {
    pub market: Address,
    pub side: u64,
    pub seller: Address,
    pub token_amount: u64,
    pub quote_received: u64,
    pub fee_amount: u64,
    pub new_price: u64,
}

#[event(discriminator = 3)]
pub struct TwapSampled {
    pub market: Address,
    pub price_a: u64,
    pub price_b: u64,
    pub sample_count: u64,
    pub timestamp: i64,
}

#[event(discriminator = 4)]
pub struct MarketResolved {
    pub market: Address,
    pub winner: u64,
    pub final_twap_a: u64,
    pub final_twap_b: u64,
    pub loser_reserve_transferred: u64,
    pub dex_pool: Address,
    pub sol_seeded: u64,
    pub tokens_seeded: u64,
}

#[event(discriminator = 5)]
pub struct ConfigUpdated {
    pub admin: Address,
    pub paused: u64,
    pub trade_fee_bps: u64,
    pub creator_fee_split_bps: u64,
    pub market_creation_fee: u64,
}

#[event(discriminator = 6)]
pub struct MarketClosed {
    pub market: Address,
    pub authority: Address,
}

#[event(discriminator = 7)]
pub struct EmergencyResolved {
    pub market: Address,
    pub resolver: Address,
    pub timestamp: i64,
}
