use anchor_lang::prelude::*;

#[event]
pub struct MarketCreated {
    pub market: Pubkey,
    pub authority: Pubkey,
    pub deadline: i64,
    pub battle_tax_bps: u16,
}

#[event]
pub struct TokensBought {
    pub market: Pubkey,
    pub side: u8,
    pub buyer: Pubkey,
    pub sol_amount: u64,
    pub tokens_received: u64,
    pub new_price: u64,
}

#[event]
pub struct TokensSold {
    pub market: Pubkey,
    pub side: u8,
    pub seller: Pubkey,
    pub token_amount: u64,
    pub sol_received: u64,
    pub penalty_applied: u64,
    pub new_price: u64,
}

#[event]
pub struct TwapSampled {
    pub market: Pubkey,
    pub price_a: u64,
    pub price_b: u64,
    pub observation_a: u64,
    pub observation_b: u64,
    pub sample_count: u32,
    pub timestamp: i64,
}

#[event]
pub struct MarketResolved {
    pub market: Pubkey,
    pub winner: u8,
    pub is_draw: bool,
    pub final_twap_a: u64,
    pub final_twap_b: u64,
    pub transfer_amount: u64,
    pub protocol_fee: u64,
    pub creator_fee: u64,
}

#[event]
pub struct TokensGraduated {
    pub market: Pubkey,
    pub side: u8,
    pub dex_pool: Pubkey,
    pub sol_seeded: u64,
    pub tokens_seeded: u64,
}
