extern crate std;

use quasar_svm::{Account, Instruction, Pubkey, QuasarSvm};
use solana_address::Address;

use duel_quasar_client::*;

// ---------------------------------------------------------------------------
// Constants mirroring the on-chain error codes (DuelError enum, starts at 0)
// ---------------------------------------------------------------------------
const ERR_MARKET_EXPIRED: u32 = 0;
const ERR_MARKET_NOT_EXPIRED: u32 = 1;
const ERR_MARKET_ALREADY_RESOLVED: u32 = 2;
const ERR_MARKET_NOT_RESOLVED: u32 = 3;
const ERR_NOT_IN_TWAP_WINDOW: u32 = 4;
const ERR_TWAP_SAMPLE_TOO_EARLY: u32 = 5;
const ERR_INVALID_SIDE: u32 = 11;
const ERR_INVALID_MARKET_CONFIG: u32 = 12;
const ERR_PROTOCOL_PAUSED: u32 = 14;
const ERR_INVALID_FEE_CONFIG: u32 = 15;
const ERR_EMERGENCY_RESOLVE_TOO_EARLY: u32 = 17;

// On-chain constants
const MIN_MARKET_DURATION: u64 = 10;
const DEFAULT_EMERGENCY_WINDOW: u64 = 86_400;
const MAX_TRADE_FEE_BPS: u16 = 500;

// Status values
const STATUS_ACTIVE: u8 = 0;
const STATUS_TWAP_OBSERVATION: u8 = 1;
const STATUS_RESOLVED: u8 = 2;

const RENT_SYSVAR: Address = solana_address::address!("SysvarRent111111111111111111111111111111111");
const SYSTEM_PROGRAM: Address =
    solana_address::address!("11111111111111111111111111111111");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn setup() -> QuasarSvm {
    let elf = include_bytes!("../../../target/deploy/duel_quasar.so");
    QuasarSvm::new().with_program(&Pubkey::from(crate::ID), elf)
}

fn config_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"config"], &Pubkey::from(crate::ID))
}

fn system_account(address: Pubkey, lamports: u64) -> Account {
    Account {
        address,
        lamports,
        data: vec![],
        owner: quasar_svm::system_program::ID,
        executable: false,
    }
}

/// Build an InitializeConfig instruction with default values.
fn init_config_ix(admin: Pubkey, config: Pubkey, protocol_fee_account: Pubkey) -> Instruction {
    InitializeConfigInstruction {
        admin: Address::from(admin.to_bytes()),
        config: Address::from(config.to_bytes()),
        protocol_fee_account: Address::from(protocol_fee_account.to_bytes()),
        system_program: SYSTEM_PROGRAM,
        rent: RENT_SYSVAR,
        trade_fee_bps: 100,
        creator_fee_split_bps: 5000,
        market_creation_fee: 0,
    }
    .into()
}

/// Build an UpdateConfig instruction. For the "no-op" case when you want to
/// skip updating protocol_fee_account or admin, pass the CURRENT value so the
/// handler writes the same address (effectively a no-op) instead of using
/// Address::default() for both (which causes AccountBorrowFailed since both
/// new_protocol_fee_account and new_admin would be the same pubkey).
fn update_config_ix(
    admin: Pubkey,
    config: Pubkey,
    new_protocol_fee_account: Pubkey,
    new_admin: Pubkey,
    paused: u8,
    trade_fee_bps: u16,
    creator_fee_split_bps: u16,
    market_creation_fee: u64,
    min_market_duration: u64,
) -> Instruction {
    UpdateConfigInstruction {
        admin: Address::from(admin.to_bytes()),
        config: Address::from(config.to_bytes()),
        new_protocol_fee_account: Address::from(new_protocol_fee_account.to_bytes()),
        new_admin: Address::from(new_admin.to_bytes()),
        paused,
        trade_fee_bps,
        creator_fee_split_bps,
        market_creation_fee,
        min_market_duration,
    }
    .into()
}

/// Run initialize_config and persist state into the SVM.
/// Returns (admin, protocol_fee_account) pubkeys.
fn setup_config(svm: &mut QuasarSvm) -> (Pubkey, Pubkey) {
    let admin = Pubkey::new_unique();
    let protocol_fee_account = Pubkey::new_unique();
    let (config, _) = config_pda();

    let ix = init_config_ix(admin, config, protocol_fee_account);
    let result = svm.process_instruction(
        &ix,
        &[
            system_account(admin, 10_000_000_000),
            Account {
                address: config,
                lamports: 0,
                data: vec![],
                owner: quasar_svm::system_program::ID,
                executable: false,
            },
        ],
    );
    result.assert_success();
    (admin, protocol_fee_account)
}

// ---------------------------------------------------------------------------
// ProgramConfig data helpers
// ---------------------------------------------------------------------------

/// Parse a ProgramConfig from raw account data.
/// Layout: 1-byte disc (3) + fields in declaration order.
struct ParsedConfig {
    admin: [u8; 32],
    paused: u8,
    protocol_fee_account: [u8; 32],
    market_creation_fee: u64,
    min_market_duration: u64,
    trade_fee_bps: u16,
    creator_fee_split_bps: u16,
    bump: u8,
}

fn parse_config(data: &[u8]) -> ParsedConfig {
    assert!(data.len() >= 151, "config data too short: {}", data.len());
    assert_eq!(data[0], 3, "wrong discriminator");
    let mut off = 1;

    let mut admin = [0u8; 32];
    admin.copy_from_slice(&data[off..off + 32]);
    off += 32;

    let paused = data[off];
    off += 1;

    let mut protocol_fee_account = [0u8; 32];
    protocol_fee_account.copy_from_slice(&data[off..off + 32]);
    off += 32;

    let market_creation_fee = u64::from_le_bytes(data[off..off + 8].try_into().unwrap());
    off += 8;

    let min_market_duration = u64::from_le_bytes(data[off..off + 8].try_into().unwrap());
    off += 8;

    let trade_fee_bps = u16::from_le_bytes(data[off..off + 2].try_into().unwrap());
    off += 2;

    let creator_fee_split_bps = u16::from_le_bytes(data[off..off + 2].try_into().unwrap());
    off += 2;

    let bump = data[off];

    ParsedConfig {
        admin,
        paused,
        protocol_fee_account,
        market_creation_fee,
        min_market_duration,
        trade_fee_bps,
        creator_fee_split_bps,
        bump,
    }
}

// ---------------------------------------------------------------------------
// Market / Side data builder helpers
//
// The program's initialize_market writes Market data with an 8-byte disc
// (1u64 LE) followed by struct fields starting at byte 8. However, the
// #[account(discriminator = 1)] macro expects disc_len=1, so when
// Account<Market> reads data it accesses struct fields starting at byte 1.
//
// For manually-constructed accounts in tests, we follow the macro's layout:
//   byte 0 = discriminator, bytes 1+ = ZC struct fields.
// This matches what #[account(init)] would produce and what Account<Market>
// reads back through its Deref impl.
// ---------------------------------------------------------------------------

/// Build a Market account data blob following the 1-byte discriminator layout.
/// Fields: version(u8) bump(u8) authority(32) market_id(u64) side_a(32)
///         side_b(32) quote_mint(32) deadline(i64) twap_window(u64)
///         twap_interval(u64) creator_fee_account(32) protocol_fee_account(32)
///         status(u8) twap_samples_count(u32) last_sample_ts(i64)
///         has_winner(u8) winner(u8) final_twap_a(u64) final_twap_b(u64)
///         emergency_window(u64) locked(u8) _reserved(128)
fn build_market_data(
    bump: u8,
    authority: &Pubkey,
    market_id: u64,
    side_a: &Pubkey,
    side_b: &Pubkey,
    quote_mint: &Pubkey,
    deadline: i64,
    twap_window: u64,
    twap_interval: u64,
    creator_fee_account: &Pubkey,
    protocol_fee_account: &Pubkey,
    status: u8,
    twap_samples_count: u32,
    last_sample_ts: i64,
    has_winner: u8,
    winner: u8,
    emergency_window: u64,
) -> Vec<u8> {
    let mut data = vec![0u8; 395]; // 1 disc + 394 struct
    data[0] = 1; // Market discriminator
    let mut off = 1;

    // version
    data[off] = 1;
    off += 1;
    // bump
    data[off] = bump;
    off += 1;
    // authority
    data[off..off + 32].copy_from_slice(authority.as_ref());
    off += 32;
    // market_id
    data[off..off + 8].copy_from_slice(&market_id.to_le_bytes());
    off += 8;
    // side_a
    data[off..off + 32].copy_from_slice(side_a.as_ref());
    off += 32;
    // side_b
    data[off..off + 32].copy_from_slice(side_b.as_ref());
    off += 32;
    // quote_mint
    data[off..off + 32].copy_from_slice(quote_mint.as_ref());
    off += 32;
    // deadline
    data[off..off + 8].copy_from_slice(&deadline.to_le_bytes());
    off += 8;
    // twap_window
    data[off..off + 8].copy_from_slice(&twap_window.to_le_bytes());
    off += 8;
    // twap_interval
    data[off..off + 8].copy_from_slice(&twap_interval.to_le_bytes());
    off += 8;
    // creator_fee_account
    data[off..off + 32].copy_from_slice(creator_fee_account.as_ref());
    off += 32;
    // protocol_fee_account
    data[off..off + 32].copy_from_slice(protocol_fee_account.as_ref());
    off += 32;
    // status
    data[off] = status;
    off += 1;
    // twap_samples_count
    data[off..off + 4].copy_from_slice(&twap_samples_count.to_le_bytes());
    off += 4;
    // last_sample_ts
    data[off..off + 8].copy_from_slice(&last_sample_ts.to_le_bytes());
    off += 8;
    // has_winner
    data[off] = has_winner;
    off += 1;
    // winner
    data[off] = winner;
    off += 1;
    // final_twap_a
    data[off..off + 8].copy_from_slice(&0u64.to_le_bytes());
    off += 8;
    // final_twap_b
    data[off..off + 8].copy_from_slice(&0u64.to_le_bytes());
    off += 8;
    // emergency_window
    data[off..off + 8].copy_from_slice(&emergency_window.to_le_bytes());
    off += 8;
    // locked
    data[off] = 0;
    off += 1;
    // _reserved (128 bytes) -- already zeroed
    let _ = off;

    data
}

/// Build a Side account data blob.
/// Layout: 1-byte disc (2) + fields.
fn build_side_data(
    bump: u8,
    market: &Pubkey,
    side_index: u8,
    token_mint: &Pubkey,
    token_reserve_vault: &Pubkey,
    quote_reserve_vault: &Pubkey,
    total_supply: u64,
    circulating_supply: u64,
    twap_accumulator: u128,
) -> Vec<u8> {
    let mut data = vec![0u8; 195]; // 1 disc + 194 struct
    data[0] = 2; // Side discriminator
    let mut off = 1;

    // market
    data[off..off + 32].copy_from_slice(market.as_ref());
    off += 32;
    // side_index
    data[off] = side_index;
    off += 1;
    // token_mint
    data[off..off + 32].copy_from_slice(token_mint.as_ref());
    off += 32;
    // token_reserve_vault
    data[off..off + 32].copy_from_slice(token_reserve_vault.as_ref());
    off += 32;
    // quote_reserve_vault
    data[off..off + 32].copy_from_slice(quote_reserve_vault.as_ref());
    off += 32;
    // total_supply
    data[off..off + 8].copy_from_slice(&total_supply.to_le_bytes());
    off += 8;
    // circulating_supply
    data[off..off + 8].copy_from_slice(&circulating_supply.to_le_bytes());
    off += 8;
    // twap_accumulator (u128)
    data[off..off + 16].copy_from_slice(&twap_accumulator.to_le_bytes());
    off += 16;
    // bump
    data[off] = bump;
    off += 1;
    // _reserved (32 bytes) -- already zeroed
    let _ = off;

    data
}

fn program_owned_account(address: Pubkey, data: Vec<u8>, lamports: u64) -> Account {
    Account {
        address,
        lamports,
        data,
        owner: Pubkey::from(crate::ID),
        executable: false,
    }
}

/// Parse Market status from raw account data (1-byte disc layout).
fn parse_market_status(data: &[u8]) -> u8 {
    // disc(1) + version(1) + bump(1) + authority(32) + market_id(8) +
    // side_a(32) + side_b(32) + quote_mint(32) + deadline(8) + twap_window(8) +
    // twap_interval(8) + creator_fee_account(32) + protocol_fee_account(32)
    // = offset 227
    data[227]
}

fn parse_market_twap_samples_count(data: &[u8]) -> u32 {
    // offset 228 (after status at 227)
    u32::from_le_bytes(data[228..232].try_into().unwrap())
}

fn parse_market_last_sample_ts(data: &[u8]) -> i64 {
    // offset 232
    i64::from_le_bytes(data[232..240].try_into().unwrap())
}

fn parse_market_has_winner(data: &[u8]) -> u8 {
    data[240]
}

fn parse_market_winner(data: &[u8]) -> u8 {
    data[241]
}

fn parse_side_twap_accumulator(data: &[u8]) -> u128 {
    // disc(1) + market(32) + side_index(1) + token_mint(32) +
    // token_reserve_vault(32) + quote_reserve_vault(32) +
    // total_supply(8) + circulating_supply(8) = offset 146
    u128::from_le_bytes(data[146..162].try_into().unwrap())
}

fn parse_side_circulating_supply(data: &[u8]) -> u64 {
    // disc(1) + market(32) + side_index(1) + token_mint(32) +
    // token_reserve_vault(32) + quote_reserve_vault(32) +
    // total_supply(8) = offset 138
    u64::from_le_bytes(data[138..146].try_into().unwrap())
}

// ===================================================================
// Test 1: initialize_config - basic success + verify account state
// ===================================================================

#[test]
fn test_initialize_config() {
    let mut svm = setup();

    let admin = Pubkey::new_unique();
    let protocol_fee_account = Pubkey::new_unique();
    let (config, _bump) = config_pda();

    let instruction: Instruction = InitializeConfigInstruction {
        admin: Address::from(admin.to_bytes()),
        config: Address::from(config.to_bytes()),
        protocol_fee_account: Address::from(protocol_fee_account.to_bytes()),
        system_program: SYSTEM_PROGRAM,
        rent: RENT_SYSVAR,
        trade_fee_bps: 100,
        creator_fee_split_bps: 5000,
        market_creation_fee: 0,
    }
    .into();

    let result = svm.process_instruction(
        &instruction,
        &[
            system_account(admin, 10_000_000_000),
            Account {
                address: config,
                lamports: 0,
                data: vec![],
                owner: quasar_svm::system_program::ID,
                executable: false,
            },
        ],
    );

    result.assert_success();
    std::println!("initialize_config: {} CU", result.compute_units_consumed);
}

// ===================================================================
// Test 2: initialize_config - verify account state after init
// ===================================================================

#[test]
fn test_initialize_config_verify_state() {
    let mut svm = setup();

    let admin = Pubkey::new_unique();
    let protocol_fee_account = Pubkey::new_unique();
    let (config, expected_bump) = config_pda();

    let ix = InitializeConfigInstruction {
        admin: Address::from(admin.to_bytes()),
        config: Address::from(config.to_bytes()),
        protocol_fee_account: Address::from(protocol_fee_account.to_bytes()),
        system_program: SYSTEM_PROGRAM,
        rent: RENT_SYSVAR,
        trade_fee_bps: 200,
        creator_fee_split_bps: 7000,
        market_creation_fee: 50_000,
    }
    .into();

    let result = svm.process_instruction(
        &ix,
        &[
            system_account(admin, 10_000_000_000),
            Account {
                address: config,
                lamports: 0,
                data: vec![],
                owner: quasar_svm::system_program::ID,
                executable: false,
            },
        ],
    );
    result.assert_success();

    // Read back the config account
    let config_account = svm.get_account(&config).expect("config account missing");
    let parsed = parse_config(&config_account.data);

    assert_eq!(parsed.admin, admin.to_bytes(), "admin mismatch");
    assert_eq!(parsed.paused, 0, "should be unpaused");
    assert_eq!(
        parsed.protocol_fee_account,
        protocol_fee_account.to_bytes(),
        "protocol_fee_account mismatch"
    );
    assert_eq!(parsed.market_creation_fee, 50_000, "market_creation_fee");
    assert_eq!(
        parsed.min_market_duration, MIN_MARKET_DURATION,
        "min_market_duration default"
    );
    assert_eq!(parsed.trade_fee_bps, 200, "trade_fee_bps");
    assert_eq!(parsed.creator_fee_split_bps, 7000, "creator_fee_split_bps");
    assert_eq!(parsed.bump, expected_bump, "bump mismatch");

    std::println!(
        "initialize_config (verify state): {} CU",
        result.compute_units_consumed
    );
}

// ===================================================================
// Test 3: initialize_config - reject trade_fee_bps > MAX (500)
// ===================================================================

#[test]
fn test_initialize_config_reject_excessive_trade_fee() {
    let mut svm = setup();

    let admin = Pubkey::new_unique();
    let protocol_fee_account = Pubkey::new_unique();
    let (config, _) = config_pda();

    let ix: Instruction = InitializeConfigInstruction {
        admin: Address::from(admin.to_bytes()),
        config: Address::from(config.to_bytes()),
        protocol_fee_account: Address::from(protocol_fee_account.to_bytes()),
        system_program: SYSTEM_PROGRAM,
        rent: RENT_SYSVAR,
        trade_fee_bps: MAX_TRADE_FEE_BPS + 1, // 501 bps, exceeds max
        creator_fee_split_bps: 5000,
        market_creation_fee: 0,
    }
    .into();

    let result = svm.process_instruction(
        &ix,
        &[
            system_account(admin, 10_000_000_000),
            Account {
                address: config,
                lamports: 0,
                data: vec![],
                owner: quasar_svm::system_program::ID,
                executable: false,
            },
        ],
    );

    result.assert_error(quasar_svm::ProgramError::Custom(ERR_INVALID_FEE_CONFIG));
    std::println!(
        "initialize_config (reject excessive fee): {} CU",
        result.compute_units_consumed
    );
}

// ===================================================================
// Test 4: initialize_config - reject creator_fee_split > 10000
// ===================================================================

#[test]
fn test_initialize_config_reject_excessive_creator_split() {
    let mut svm = setup();

    let admin = Pubkey::new_unique();
    let protocol_fee_account = Pubkey::new_unique();
    let (config, _) = config_pda();

    let ix: Instruction = InitializeConfigInstruction {
        admin: Address::from(admin.to_bytes()),
        config: Address::from(config.to_bytes()),
        protocol_fee_account: Address::from(protocol_fee_account.to_bytes()),
        system_program: SYSTEM_PROGRAM,
        rent: RENT_SYSVAR,
        trade_fee_bps: 100,
        creator_fee_split_bps: 10001, // > 10000
        market_creation_fee: 0,
    }
    .into();

    let result = svm.process_instruction(
        &ix,
        &[
            system_account(admin, 10_000_000_000),
            Account {
                address: config,
                lamports: 0,
                data: vec![],
                owner: quasar_svm::system_program::ID,
                executable: false,
            },
        ],
    );

    result.assert_error(quasar_svm::ProgramError::Custom(ERR_INVALID_FEE_CONFIG));
    std::println!(
        "initialize_config (reject excessive creator split): {} CU",
        result.compute_units_consumed
    );
}

// ===================================================================
// Test 5: initialize_config - reject duplicate init (already initialized)
// ===================================================================

#[test]
fn test_initialize_config_reject_duplicate() {
    let mut svm = setup();

    let admin = Pubkey::new_unique();
    let protocol_fee_account = Pubkey::new_unique();
    let (config, _) = config_pda();

    // First init succeeds
    let ix = init_config_ix(admin, config, protocol_fee_account);
    let result = svm.process_instruction(
        &ix,
        &[
            system_account(admin, 10_000_000_000),
            Account {
                address: config,
                lamports: 0,
                data: vec![],
                owner: quasar_svm::system_program::ID,
                executable: false,
            },
        ],
    );
    result.assert_success();

    // Second init should fail -- the config account is already initialized
    // (owned by the program, has data)
    let ix2 = init_config_ix(admin, config, protocol_fee_account);
    let result2 = svm.process_instruction(
        &ix2,
        &[system_account(admin, 10_000_000_000)],
    );

    assert!(result2.is_err(), "duplicate init should fail");
    std::println!(
        "initialize_config (reject duplicate): {} CU",
        result2.compute_units_consumed
    );
}

// ===================================================================
// Test 6: update_config - update fees
// ===================================================================

#[test]
fn test_update_config_fees() {
    let mut svm = setup();
    let (admin, protocol_fee_account) = setup_config(&mut svm);
    let (config, _) = config_pda();

    let new_protocol_fee = Pubkey::new_unique();

    // Use unique dummy for new_admin to avoid borrow conflicts
    let dummy_admin = Pubkey::new_unique();

    let ix = update_config_ix(
        admin, config, new_protocol_fee, dummy_admin,
        0xFF, 250, 6000, 100_000, 60,
    );

    let result = svm.process_instruction(
        &ix,
        &[
            system_account(admin, 10_000_000_000),
            system_account(new_protocol_fee, 0),
            system_account(dummy_admin, 0),
        ],
    );
    result.assert_success();

    let config_account = svm.get_account(&config).expect("config account missing");
    let parsed = parse_config(&config_account.data);

    assert_eq!(parsed.trade_fee_bps, 250, "trade_fee_bps updated");
    assert_eq!(parsed.creator_fee_split_bps, 6000, "creator_fee_split_bps updated");
    assert_eq!(parsed.market_creation_fee, 100_000, "market_creation_fee updated");
    assert_eq!(parsed.min_market_duration, 60, "min_market_duration updated");
    assert_eq!(parsed.protocol_fee_account, new_protocol_fee.to_bytes(), "protocol_fee_account updated");
    // Admin was updated to dummy_admin (non-default addresses always update)
    assert_eq!(parsed.admin, dummy_admin.to_bytes(), "admin updated to dummy");

    std::println!("update_config (fees): {} CU", result.compute_units_consumed);
}

// ===================================================================
// Test 7: update_config - pause protocol
// ===================================================================

#[test]
fn test_update_config_pause() {
    let mut svm = setup();
    let (admin, protocol_fee_account) = setup_config(&mut svm);
    let (config, _) = config_pda();

    // Use unique addresses for new_protocol_fee_account and new_admin
    // (all 4 accounts must be distinct in Quasar).
    // These will update the config's protocol_fee_account and admin, but
    // we're only testing the pause flag here so that's fine.
    let new_pf = Pubkey::new_unique();
    let new_ad = Pubkey::new_unique();

    let ix = update_config_ix(
        admin, config, new_pf, new_ad,
        1, 0, 0, 0, 0,
    );

    let result = svm.process_instruction(
        &ix,
        &[
            system_account(admin, 10_000_000_000),
            system_account(new_pf, 0),
            system_account(new_ad, 0),
        ],
    );
    result.assert_success();

    let parsed = parse_config(&svm.get_account(&config).unwrap().data);
    assert_eq!(parsed.paused, 1, "protocol should be paused");

    // Unpause (admin was updated to new_ad)
    let new_pf2 = Pubkey::new_unique();
    let new_ad2 = Pubkey::new_unique();

    let ix2 = update_config_ix(
        new_ad, config, new_pf2, new_ad2,
        0, 0, 0, 0, 0,
    );

    let result2 = svm.process_instruction(
        &ix2,
        &[
            system_account(new_ad, 10_000_000_000),
            system_account(new_pf2, 0),
            system_account(new_ad2, 0),
        ],
    );
    result2.assert_success();

    let parsed = parse_config(&svm.get_account(&config).unwrap().data);
    assert_eq!(parsed.paused, 0, "protocol should be unpaused");

    std::println!(
        "update_config (pause/unpause): {} + {} CU",
        result.compute_units_consumed, result2.compute_units_consumed
    );
}

// ===================================================================
// Test 8: update_config - transfer admin
// ===================================================================

#[test]
fn test_update_config_transfer_admin() {
    let mut svm = setup();
    let (admin, protocol_fee_account) = setup_config(&mut svm);
    let (config, _) = config_pda();

    let new_admin = Pubkey::new_unique();

    let ix = update_config_ix(
        admin, config, protocol_fee_account, new_admin,
        0xFF, 0, 0, 0, 0,
    );

    let result = svm.process_instruction(
        &ix,
        &[
            system_account(admin, 10_000_000_000),
            system_account(new_admin, 0),
        ],
    );
    result.assert_success();

    let parsed = parse_config(&svm.get_account(&config).unwrap().data);
    assert_eq!(parsed.admin, new_admin.to_bytes(), "admin transferred");

    // Old admin should no longer be able to update
    let dummy = Pubkey::new_unique();
    let ix2 = update_config_ix(
        admin, config, protocol_fee_account, dummy,
        1, 0, 0, 0, 0,
    );

    let result2 = svm.process_instruction(
        &ix2,
        &[
            system_account(admin, 10_000_000_000),
            system_account(dummy, 0),
        ],
    );

    result2.assert_error(quasar_svm::ProgramError::Custom(ERR_INVALID_MARKET_CONFIG));

    std::println!("update_config (transfer admin): {} CU", result.compute_units_consumed);
}

// ===================================================================
// Test 9: update_config - reject non-admin
// ===================================================================

#[test]
fn test_update_config_reject_non_admin() {
    let mut svm = setup();
    let (_admin, protocol_fee_account) = setup_config(&mut svm);
    let (config, _) = config_pda();

    let impostor = Pubkey::new_unique();
    let dummy = Pubkey::new_unique();

    let ix = update_config_ix(
        impostor, config, protocol_fee_account, dummy,
        1, 0, 0, 0, 0,
    );

    let result = svm.process_instruction(
        &ix,
        &[
            system_account(impostor, 10_000_000_000),
            system_account(dummy, 0),
        ],
    );

    result.assert_error(quasar_svm::ProgramError::Custom(ERR_INVALID_MARKET_CONFIG));
    std::println!("update_config (reject non-admin): {} CU", result.compute_units_consumed);
}

// ===================================================================
// Test 10: update_config - reject trade_fee_bps > MAX
// ===================================================================

#[test]
fn test_update_config_reject_excessive_fee() {
    let mut svm = setup();
    let (admin, protocol_fee_account) = setup_config(&mut svm);
    let (config, _) = config_pda();

    let new_pf = Pubkey::new_unique();
    let new_ad = Pubkey::new_unique();

    let ix = update_config_ix(
        admin, config, new_pf, new_ad,
        0xFF, 501, 0, 0, 0, // 501 > MAX_TRADE_FEE_BPS (500)
    );

    let result = svm.process_instruction(
        &ix,
        &[
            system_account(admin, 10_000_000_000),
            system_account(new_pf, 0),
            system_account(new_ad, 0),
        ],
    );

    result.assert_error(quasar_svm::ProgramError::Custom(ERR_INVALID_FEE_CONFIG));
    std::println!("update_config (reject excessive fee): {} CU", result.compute_units_consumed);
}

// ===================================================================
// Test 11: update_config - reject min_market_duration below minimum
// ===================================================================

#[test]
fn test_update_config_reject_low_duration() {
    let mut svm = setup();
    let (admin, protocol_fee_account) = setup_config(&mut svm);
    let (config, _) = config_pda();

    let new_pf = Pubkey::new_unique();
    let new_ad = Pubkey::new_unique();

    let ix = update_config_ix(
        admin, config, new_pf, new_ad,
        0xFF, 0, 0, 0, 5, // 5 < MIN_MARKET_DURATION (10)
    );

    let result = svm.process_instruction(
        &ix,
        &[
            system_account(admin, 10_000_000_000),
            system_account(new_pf, 0),
            system_account(new_ad, 0),
        ],
    );

    result.assert_error(quasar_svm::ProgramError::Custom(ERR_INVALID_MARKET_CONFIG));
    std::println!("update_config (reject low duration): {} CU", result.compute_units_consumed);
}

// ===================================================================
// Test 12: record_twap_sample - success in TWAP window
// ===================================================================

#[test]
fn test_record_twap_sample_success() {
    let mut svm = setup();
    let (admin, protocol_fee_account) = setup_config(&mut svm);
    let (config, _) = config_pda();

    // Create market and side accounts manually.
    // Market with deadline in the future, TWAP window = 300s, interval = 10s.
    let market_key = Pubkey::new_unique();
    let side_a_key = Pubkey::new_unique();
    let side_b_key = Pubkey::new_unique();
    let quote_mint = Pubkey::new_unique();
    let creator_fee_account = Pubkey::new_unique();
    let cranker = Pubkey::new_unique();

    let now = 1000i64;
    let deadline = now + 600; // 600s in the future
    let twap_window = 300u64; // TWAP starts at deadline - 300 = now + 300
    let twap_interval = 10u64;

    // We need to be inside the TWAP window: now >= deadline - twap_window
    // deadline - twap_window = 1600 - 300 = 1300
    // We need now >= 1300. So warp to 1300.
    let sample_time = deadline - twap_window as i64; // 1300
    svm.warp_to_timestamp(sample_time);

    let market_data = build_market_data(
        0, // bump (doesn't matter for non-PDA access)
        &Pubkey::new_unique(), // authority
        1, // market_id
        &side_a_key,
        &side_b_key,
        &quote_mint,
        deadline,
        twap_window,
        twap_interval,
        &creator_fee_account,
        &protocol_fee_account,
        STATUS_ACTIVE,
        0,    // twap_samples_count
        0,    // last_sample_ts
        0, 0, // no winner
        DEFAULT_EMERGENCY_WINDOW,
    );

    let token_mint_a = Pubkey::new_unique();
    let token_vault_a = Pubkey::new_unique();
    let quote_vault_a = Pubkey::new_unique();
    let token_mint_b = Pubkey::new_unique();
    let token_vault_b = Pubkey::new_unique();
    let quote_vault_b = Pubkey::new_unique();

    let side_a_data = build_side_data(
        0,
        &market_key,
        0,
        &token_mint_a,
        &token_vault_a,
        &quote_vault_a,
        1_000_000_000,
        100_000, // some circulating supply
        0,
    );

    let side_b_data = build_side_data(
        0,
        &market_key,
        1,
        &token_mint_b,
        &token_vault_b,
        &quote_vault_b,
        1_000_000_000,
        200_000, // different circulating supply
        0,
    );

    let ix: Instruction = RecordTwapSampleInstruction {
        cranker: Address::from(cranker.to_bytes()),
        market: Address::from(market_key.to_bytes()),
        side_a: Address::from(side_a_key.to_bytes()),
        side_b: Address::from(side_b_key.to_bytes()),
    }
    .into();

    let result = svm.process_instruction(
        &ix,
        &[
            system_account(cranker, 1_000_000_000),
            program_owned_account(market_key, market_data, 10_000_000),
            program_owned_account(side_a_key, side_a_data, 10_000_000),
            program_owned_account(side_b_key, side_b_data, 10_000_000),
        ],
    );

    result.assert_success();

    // Verify market state was updated
    let market_acc = svm.get_account(&market_key).unwrap();
    let samples = parse_market_twap_samples_count(&market_acc.data);
    assert_eq!(samples, 1, "twap_samples_count should be 1");

    let last_ts = parse_market_last_sample_ts(&market_acc.data);
    assert_eq!(last_ts, sample_time, "last_sample_ts should be updated");

    let status = parse_market_status(&market_acc.data);
    assert_eq!(
        status, STATUS_TWAP_OBSERVATION,
        "status should transition to TWAP_OBSERVATION"
    );

    // Verify side accumulators were updated
    let side_a_acc = svm.get_account(&side_a_key).unwrap();
    let acc_a = parse_side_twap_accumulator(&side_a_acc.data);
    assert!(acc_a > 0, "side_a accumulator should be > 0");

    let side_b_acc = svm.get_account(&side_b_key).unwrap();
    let acc_b = parse_side_twap_accumulator(&side_b_acc.data);
    assert!(acc_b > 0, "side_b accumulator should be > 0");

    // Side B has more circulating supply so its price should be higher
    assert!(
        acc_b > acc_a,
        "side_b accumulator ({}) should be > side_a ({})",
        acc_b,
        acc_a
    );

    std::println!(
        "record_twap_sample (success): {} CU",
        result.compute_units_consumed
    );
}

// ===================================================================
// Test 13: record_twap_sample - reject when not in TWAP window
// ===================================================================

#[test]
fn test_record_twap_sample_reject_before_window() {
    let mut svm = setup();
    let (_admin, protocol_fee_account) = setup_config(&mut svm);

    let market_key = Pubkey::new_unique();
    let side_a_key = Pubkey::new_unique();
    let side_b_key = Pubkey::new_unique();
    let cranker = Pubkey::new_unique();

    let now = 1000i64;
    let deadline = now + 600;
    let twap_window = 300u64;
    let twap_interval = 10u64;

    // Stay before the TWAP window starts
    svm.warp_to_timestamp(now); // twap starts at deadline - 300 = 1300, we're at 1000

    let market_data = build_market_data(
        0,
        &Pubkey::new_unique(),
        1,
        &side_a_key,
        &side_b_key,
        &Pubkey::new_unique(),
        deadline,
        twap_window,
        twap_interval,
        &Pubkey::new_unique(),
        &protocol_fee_account,
        STATUS_ACTIVE,
        0, 0, 0, 0,
        DEFAULT_EMERGENCY_WINDOW,
    );

    let side_a_data = build_side_data(0, &market_key, 0, &Pubkey::new_unique(), &Pubkey::new_unique(), &Pubkey::new_unique(), 1_000_000_000, 0, 0);
    let side_b_data = build_side_data(0, &market_key, 1, &Pubkey::new_unique(), &Pubkey::new_unique(), &Pubkey::new_unique(), 1_000_000_000, 0, 0);

    let ix: Instruction = RecordTwapSampleInstruction {
        cranker: Address::from(cranker.to_bytes()),
        market: Address::from(market_key.to_bytes()),
        side_a: Address::from(side_a_key.to_bytes()),
        side_b: Address::from(side_b_key.to_bytes()),
    }
    .into();

    let result = svm.process_instruction(
        &ix,
        &[
            system_account(cranker, 1_000_000_000),
            program_owned_account(market_key, market_data, 10_000_000),
            program_owned_account(side_a_key, side_a_data, 10_000_000),
            program_owned_account(side_b_key, side_b_data, 10_000_000),
        ],
    );

    result.assert_error(quasar_svm::ProgramError::Custom(ERR_NOT_IN_TWAP_WINDOW));
    std::println!(
        "record_twap_sample (reject before window): {} CU",
        result.compute_units_consumed
    );
}

// ===================================================================
// Test 14: record_twap_sample - reject after deadline
// ===================================================================

#[test]
fn test_record_twap_sample_reject_after_deadline() {
    let mut svm = setup();
    let (_admin, protocol_fee_account) = setup_config(&mut svm);

    let market_key = Pubkey::new_unique();
    let side_a_key = Pubkey::new_unique();
    let side_b_key = Pubkey::new_unique();
    let cranker = Pubkey::new_unique();

    let deadline = 1600i64;
    let twap_window = 300u64;
    let twap_interval = 10u64;

    // Warp past the deadline
    svm.warp_to_timestamp(deadline + 1);

    let market_data = build_market_data(
        0,
        &Pubkey::new_unique(),
        1,
        &side_a_key,
        &side_b_key,
        &Pubkey::new_unique(),
        deadline,
        twap_window,
        twap_interval,
        &Pubkey::new_unique(),
        &protocol_fee_account,
        STATUS_ACTIVE,
        0, 0, 0, 0,
        DEFAULT_EMERGENCY_WINDOW,
    );

    let side_a_data = build_side_data(0, &market_key, 0, &Pubkey::new_unique(), &Pubkey::new_unique(), &Pubkey::new_unique(), 1_000_000_000, 0, 0);
    let side_b_data = build_side_data(0, &market_key, 1, &Pubkey::new_unique(), &Pubkey::new_unique(), &Pubkey::new_unique(), 1_000_000_000, 0, 0);

    let ix: Instruction = RecordTwapSampleInstruction {
        cranker: Address::from(cranker.to_bytes()),
        market: Address::from(market_key.to_bytes()),
        side_a: Address::from(side_a_key.to_bytes()),
        side_b: Address::from(side_b_key.to_bytes()),
    }
    .into();

    let result = svm.process_instruction(
        &ix,
        &[
            system_account(cranker, 1_000_000_000),
            program_owned_account(market_key, market_data, 10_000_000),
            program_owned_account(side_a_key, side_a_data, 10_000_000),
            program_owned_account(side_b_key, side_b_data, 10_000_000),
        ],
    );

    result.assert_error(quasar_svm::ProgramError::Custom(ERR_MARKET_EXPIRED));
    std::println!(
        "record_twap_sample (reject after deadline): {} CU",
        result.compute_units_consumed
    );
}

// ===================================================================
// Test 15: record_twap_sample - reject if sample too early (interval)
// ===================================================================

#[test]
fn test_record_twap_sample_reject_too_early() {
    let mut svm = setup();
    let (_admin, protocol_fee_account) = setup_config(&mut svm);

    let market_key = Pubkey::new_unique();
    let side_a_key = Pubkey::new_unique();
    let side_b_key = Pubkey::new_unique();
    let cranker = Pubkey::new_unique();

    let deadline = 2000i64;
    let twap_window = 300u64;
    let twap_interval = 60u64;

    let twap_start = deadline - twap_window as i64; // 1700

    // First sample: warp to TWAP window start
    svm.warp_to_timestamp(twap_start);

    let market_data = build_market_data(
        0,
        &Pubkey::new_unique(),
        1,
        &side_a_key,
        &side_b_key,
        &Pubkey::new_unique(),
        deadline,
        twap_window,
        twap_interval,
        &Pubkey::new_unique(),
        &protocol_fee_account,
        STATUS_ACTIVE,
        0,  // twap_samples_count
        0,  // last_sample_ts = 0 (no prev sample)
        0, 0,
        DEFAULT_EMERGENCY_WINDOW,
    );

    let side_a_data = build_side_data(0, &market_key, 0, &Pubkey::new_unique(), &Pubkey::new_unique(), &Pubkey::new_unique(), 1_000_000_000, 50_000, 0);
    let side_b_data = build_side_data(0, &market_key, 1, &Pubkey::new_unique(), &Pubkey::new_unique(), &Pubkey::new_unique(), 1_000_000_000, 50_000, 0);

    let ix: Instruction = RecordTwapSampleInstruction {
        cranker: Address::from(cranker.to_bytes()),
        market: Address::from(market_key.to_bytes()),
        side_a: Address::from(side_a_key.to_bytes()),
        side_b: Address::from(side_b_key.to_bytes()),
    }
    .into();

    // First sample succeeds
    let result = svm.process_instruction(
        &ix,
        &[
            system_account(cranker, 1_000_000_000),
            program_owned_account(market_key, market_data, 10_000_000),
            program_owned_account(side_a_key, side_a_data, 10_000_000),
            program_owned_account(side_b_key, side_b_data, 10_000_000),
        ],
    );
    result.assert_success();

    // Second sample too soon (only 5 seconds later, interval is 60)
    svm.warp_to_timestamp(twap_start + 5);

    let ix2: Instruction = RecordTwapSampleInstruction {
        cranker: Address::from(cranker.to_bytes()),
        market: Address::from(market_key.to_bytes()),
        side_a: Address::from(side_a_key.to_bytes()),
        side_b: Address::from(side_b_key.to_bytes()),
    }
    .into();

    // The accounts are already persisted in the SVM from the first call
    let result2 = svm.process_instruction(
        &ix2,
        &[system_account(cranker, 1_000_000_000)],
    );

    result2.assert_error(quasar_svm::ProgramError::Custom(ERR_TWAP_SAMPLE_TOO_EARLY));
    std::println!(
        "record_twap_sample (reject too early): {} CU",
        result.compute_units_consumed + result2.compute_units_consumed
    );
}

// ===================================================================
// Test 16: record_twap_sample - reject already resolved market
// ===================================================================

#[test]
fn test_record_twap_sample_reject_resolved() {
    let mut svm = setup();
    let (_admin, protocol_fee_account) = setup_config(&mut svm);

    let market_key = Pubkey::new_unique();
    let side_a_key = Pubkey::new_unique();
    let side_b_key = Pubkey::new_unique();
    let cranker = Pubkey::new_unique();

    let deadline = 2000i64;
    let twap_window = 300u64;
    let twap_interval = 10u64;

    svm.warp_to_timestamp(deadline - twap_window as i64);

    let market_data = build_market_data(
        0,
        &Pubkey::new_unique(),
        1,
        &side_a_key,
        &side_b_key,
        &Pubkey::new_unique(),
        deadline,
        twap_window,
        twap_interval,
        &Pubkey::new_unique(),
        &protocol_fee_account,
        STATUS_RESOLVED, // already resolved
        0, 0, 0, 0,
        DEFAULT_EMERGENCY_WINDOW,
    );

    let side_a_data = build_side_data(0, &market_key, 0, &Pubkey::new_unique(), &Pubkey::new_unique(), &Pubkey::new_unique(), 1_000_000_000, 0, 0);
    let side_b_data = build_side_data(0, &market_key, 1, &Pubkey::new_unique(), &Pubkey::new_unique(), &Pubkey::new_unique(), 1_000_000_000, 0, 0);

    let ix: Instruction = RecordTwapSampleInstruction {
        cranker: Address::from(cranker.to_bytes()),
        market: Address::from(market_key.to_bytes()),
        side_a: Address::from(side_a_key.to_bytes()),
        side_b: Address::from(side_b_key.to_bytes()),
    }
    .into();

    let result = svm.process_instruction(
        &ix,
        &[
            system_account(cranker, 1_000_000_000),
            program_owned_account(market_key, market_data, 10_000_000),
            program_owned_account(side_a_key, side_a_data, 10_000_000),
            program_owned_account(side_b_key, side_b_data, 10_000_000),
        ],
    );

    result.assert_error(quasar_svm::ProgramError::Custom(ERR_MARKET_ALREADY_RESOLVED));
    std::println!(
        "record_twap_sample (reject resolved): {} CU",
        result.compute_units_consumed
    );
}

// ===================================================================
// Test 17: record_twap_sample - multiple samples accumulate
// ===================================================================

#[test]
fn test_record_twap_sample_multiple() {
    let mut svm = setup();
    let (_admin, protocol_fee_account) = setup_config(&mut svm);

    let market_key = Pubkey::new_unique();
    let side_a_key = Pubkey::new_unique();
    let side_b_key = Pubkey::new_unique();
    let cranker = Pubkey::new_unique();

    let deadline = 2000i64;
    let twap_window = 300u64;
    let twap_interval = 10u64;
    let twap_start = deadline - twap_window as i64;

    svm.warp_to_timestamp(twap_start);

    let market_data = build_market_data(
        0,
        &Pubkey::new_unique(),
        1,
        &side_a_key,
        &side_b_key,
        &Pubkey::new_unique(),
        deadline,
        twap_window,
        twap_interval,
        &Pubkey::new_unique(),
        &protocol_fee_account,
        STATUS_ACTIVE,
        0, 0, 0, 0,
        DEFAULT_EMERGENCY_WINDOW,
    );

    let side_a_data = build_side_data(0, &market_key, 0, &Pubkey::new_unique(), &Pubkey::new_unique(), &Pubkey::new_unique(), 1_000_000_000, 100_000, 0);
    let side_b_data = build_side_data(0, &market_key, 1, &Pubkey::new_unique(), &Pubkey::new_unique(), &Pubkey::new_unique(), 1_000_000_000, 200_000, 0);

    // Place initial accounts
    svm.set_account(system_account(cranker, 1_000_000_000));
    svm.set_account(program_owned_account(market_key, market_data, 10_000_000));
    svm.set_account(program_owned_account(side_a_key, side_a_data, 10_000_000));
    svm.set_account(program_owned_account(side_b_key, side_b_data, 10_000_000));

    let build_ix = || -> Instruction {
        RecordTwapSampleInstruction {
            cranker: Address::from(cranker.to_bytes()),
            market: Address::from(market_key.to_bytes()),
            side_a: Address::from(side_a_key.to_bytes()),
            side_b: Address::from(side_b_key.to_bytes()),
        }
        .into()
    };

    // Sample 1
    let r1 = svm.process_instruction(&build_ix(), &[]);
    r1.assert_success();

    // Sample 2 after interval
    svm.warp_to_timestamp(twap_start + twap_interval as i64);
    let r2 = svm.process_instruction(&build_ix(), &[]);
    r2.assert_success();

    // Sample 3 after another interval
    svm.warp_to_timestamp(twap_start + 2 * twap_interval as i64);
    let r3 = svm.process_instruction(&build_ix(), &[]);
    r3.assert_success();

    // Verify 3 samples recorded
    let market_acc = svm.get_account(&market_key).unwrap();
    let samples = parse_market_twap_samples_count(&market_acc.data);
    assert_eq!(samples, 3, "should have 3 samples");

    // Verify accumulator grew (3 identical price samples)
    let side_a_acc = svm.get_account(&side_a_key).unwrap();
    let acc_a = parse_side_twap_accumulator(&side_a_acc.data);
    // Price for supply 100_000 with default params: a=1, n=2, b=1, scale=1e9
    // price = 1 * 100_000^2 / 1e9 + 1 = 10 + 1 = 11
    // After 3 samples: accumulator = 3 * 11 = 33
    assert_eq!(acc_a, 33, "side_a accumulator should be 3 * 11 = 33");

    let side_b_acc = svm.get_account(&side_b_key).unwrap();
    let acc_b = parse_side_twap_accumulator(&side_b_acc.data);
    // Price for supply 200_000: 1 * 200_000^2 / 1e9 + 1 = 40 + 1 = 41
    // After 3 samples: accumulator = 3 * 41 = 123
    assert_eq!(acc_b, 123, "side_b accumulator should be 3 * 41 = 123");

    std::println!(
        "record_twap_sample (multiple): {} + {} + {} CU",
        r1.compute_units_consumed,
        r2.compute_units_consumed,
        r3.compute_units_consumed
    );
}

// ===================================================================
// Test 18: record_twap_sample - reject mismatched side accounts
// ===================================================================

#[test]
fn test_record_twap_sample_reject_wrong_side() {
    let mut svm = setup();
    let (_admin, protocol_fee_account) = setup_config(&mut svm);

    let market_key = Pubkey::new_unique();
    let side_a_key = Pubkey::new_unique();
    let side_b_key = Pubkey::new_unique();
    let wrong_side = Pubkey::new_unique();
    let cranker = Pubkey::new_unique();

    let deadline = 2000i64;
    let twap_window = 300u64;
    let twap_interval = 10u64;

    svm.warp_to_timestamp(deadline - twap_window as i64);

    let market_data = build_market_data(
        0,
        &Pubkey::new_unique(),
        1,
        &side_a_key,
        &side_b_key,
        &Pubkey::new_unique(),
        deadline,
        twap_window,
        twap_interval,
        &Pubkey::new_unique(),
        &protocol_fee_account,
        STATUS_ACTIVE,
        0, 0, 0, 0,
        DEFAULT_EMERGENCY_WINDOW,
    );

    // side_a is correct, but for side_b we use a wrong side pointing to a
    // different market
    let side_a_data = build_side_data(0, &market_key, 0, &Pubkey::new_unique(), &Pubkey::new_unique(), &Pubkey::new_unique(), 1_000_000_000, 0, 0);
    let wrong_side_data = build_side_data(0, &Pubkey::new_unique(), 1, &Pubkey::new_unique(), &Pubkey::new_unique(), &Pubkey::new_unique(), 1_000_000_000, 0, 0);

    let ix: Instruction = RecordTwapSampleInstruction {
        cranker: Address::from(cranker.to_bytes()),
        market: Address::from(market_key.to_bytes()),
        side_a: Address::from(side_a_key.to_bytes()),
        side_b: Address::from(wrong_side.to_bytes()),
    }
    .into();

    let result = svm.process_instruction(
        &ix,
        &[
            system_account(cranker, 1_000_000_000),
            program_owned_account(market_key, market_data, 10_000_000),
            program_owned_account(side_a_key, side_a_data, 10_000_000),
            program_owned_account(wrong_side, wrong_side_data, 10_000_000),
        ],
    );

    result.assert_error(quasar_svm::ProgramError::Custom(ERR_INVALID_SIDE));
    std::println!(
        "record_twap_sample (reject wrong side): {} CU",
        result.compute_units_consumed
    );
}

// ===================================================================
// Test 19: emergency_resolve - success after emergency window
// ===================================================================

#[test]
fn test_emergency_resolve_success() {
    let mut svm = setup();
    let (admin, protocol_fee_account) = setup_config(&mut svm);
    let (config, _) = config_pda();

    let market_key = Pubkey::new_unique();
    let side_a_key = Pubkey::new_unique();
    let side_b_key = Pubkey::new_unique();
    let resolver = Pubkey::new_unique();

    let deadline = 1000i64;
    let emergency_window = DEFAULT_EMERGENCY_WINDOW;

    // Warp past deadline + emergency_window
    let resolve_time = deadline + emergency_window as i64;
    svm.warp_to_timestamp(resolve_time);

    let market_data = build_market_data(
        0,
        &Pubkey::new_unique(),
        1,
        &side_a_key,
        &side_b_key,
        &Pubkey::new_unique(),
        deadline,
        300,
        10,
        &Pubkey::new_unique(),
        &protocol_fee_account,
        STATUS_TWAP_OBSERVATION, // not yet resolved
        5,     // some samples
        deadline - 10,
        0, 0, // no winner
        emergency_window,
    );

    let side_a_data = build_side_data(0, &market_key, 0, &Pubkey::new_unique(), &Pubkey::new_unique(), &Pubkey::new_unique(), 1_000_000_000, 100_000, 500);
    let side_b_data = build_side_data(0, &market_key, 1, &Pubkey::new_unique(), &Pubkey::new_unique(), &Pubkey::new_unique(), 1_000_000_000, 200_000, 1000);

    let ix: Instruction = EmergencyResolveInstruction {
        resolver: Address::from(resolver.to_bytes()),
        market: Address::from(market_key.to_bytes()),
        config: Address::from(config.to_bytes()),
        side_a: Address::from(side_a_key.to_bytes()),
        side_b: Address::from(side_b_key.to_bytes()),
    }
    .into();

    let result = svm.process_instruction(
        &ix,
        &[
            system_account(resolver, 1_000_000_000),
            program_owned_account(market_key, market_data, 10_000_000),
            program_owned_account(side_a_key, side_a_data, 10_000_000),
            program_owned_account(side_b_key, side_b_data, 10_000_000),
        ],
    );

    result.assert_success();

    // Verify market is now resolved with no winner (draw)
    let market_acc = svm.get_account(&market_key).unwrap();
    let status = parse_market_status(&market_acc.data);
    assert_eq!(status, STATUS_RESOLVED, "status should be RESOLVED");

    let has_winner = parse_market_has_winner(&market_acc.data);
    assert_eq!(has_winner, 0, "should have no winner (emergency = draw)");

    std::println!(
        "emergency_resolve (success): {} CU",
        result.compute_units_consumed
    );
}

// ===================================================================
// Test 20: emergency_resolve - reject before emergency window
// ===================================================================

#[test]
fn test_emergency_resolve_reject_too_early() {
    let mut svm = setup();
    let (admin, protocol_fee_account) = setup_config(&mut svm);
    let (config, _) = config_pda();

    let market_key = Pubkey::new_unique();
    let side_a_key = Pubkey::new_unique();
    let side_b_key = Pubkey::new_unique();
    let resolver = Pubkey::new_unique();

    let deadline = 1000i64;
    let emergency_window = DEFAULT_EMERGENCY_WINDOW;

    // Warp to just after deadline but before emergency_window
    svm.warp_to_timestamp(deadline + 100); // 100s past deadline, window is 86400

    let market_data = build_market_data(
        0,
        &Pubkey::new_unique(),
        1,
        &side_a_key,
        &side_b_key,
        &Pubkey::new_unique(),
        deadline,
        300,
        10,
        &Pubkey::new_unique(),
        &protocol_fee_account,
        STATUS_TWAP_OBSERVATION,
        0, 0, 0, 0,
        emergency_window,
    );

    let side_a_data = build_side_data(0, &market_key, 0, &Pubkey::new_unique(), &Pubkey::new_unique(), &Pubkey::new_unique(), 1_000_000_000, 0, 0);
    let side_b_data = build_side_data(0, &market_key, 1, &Pubkey::new_unique(), &Pubkey::new_unique(), &Pubkey::new_unique(), 1_000_000_000, 0, 0);

    let ix: Instruction = EmergencyResolveInstruction {
        resolver: Address::from(resolver.to_bytes()),
        market: Address::from(market_key.to_bytes()),
        config: Address::from(config.to_bytes()),
        side_a: Address::from(side_a_key.to_bytes()),
        side_b: Address::from(side_b_key.to_bytes()),
    }
    .into();

    let result = svm.process_instruction(
        &ix,
        &[
            system_account(resolver, 1_000_000_000),
            program_owned_account(market_key, market_data, 10_000_000),
            program_owned_account(side_a_key, side_a_data, 10_000_000),
            program_owned_account(side_b_key, side_b_data, 10_000_000),
        ],
    );

    result.assert_error(quasar_svm::ProgramError::Custom(ERR_EMERGENCY_RESOLVE_TOO_EARLY));
    std::println!(
        "emergency_resolve (reject too early): {} CU",
        result.compute_units_consumed
    );
}

// ===================================================================
// Test 21: emergency_resolve - reject before deadline
// ===================================================================

#[test]
fn test_emergency_resolve_reject_before_deadline() {
    let mut svm = setup();
    let (_admin, protocol_fee_account) = setup_config(&mut svm);
    let (config, _) = config_pda();

    let market_key = Pubkey::new_unique();
    let side_a_key = Pubkey::new_unique();
    let side_b_key = Pubkey::new_unique();
    let resolver = Pubkey::new_unique();

    let deadline = 2000i64;

    // Before deadline
    svm.warp_to_timestamp(1500);

    let market_data = build_market_data(
        0,
        &Pubkey::new_unique(),
        1,
        &side_a_key,
        &side_b_key,
        &Pubkey::new_unique(),
        deadline,
        300,
        10,
        &Pubkey::new_unique(),
        &protocol_fee_account,
        STATUS_ACTIVE,
        0, 0, 0, 0,
        DEFAULT_EMERGENCY_WINDOW,
    );

    let side_a_data = build_side_data(0, &market_key, 0, &Pubkey::new_unique(), &Pubkey::new_unique(), &Pubkey::new_unique(), 1_000_000_000, 0, 0);
    let side_b_data = build_side_data(0, &market_key, 1, &Pubkey::new_unique(), &Pubkey::new_unique(), &Pubkey::new_unique(), 1_000_000_000, 0, 0);

    let ix: Instruction = EmergencyResolveInstruction {
        resolver: Address::from(resolver.to_bytes()),
        market: Address::from(market_key.to_bytes()),
        config: Address::from(config.to_bytes()),
        side_a: Address::from(side_a_key.to_bytes()),
        side_b: Address::from(side_b_key.to_bytes()),
    }
    .into();

    let result = svm.process_instruction(
        &ix,
        &[
            system_account(resolver, 1_000_000_000),
            program_owned_account(market_key, market_data, 10_000_000),
            program_owned_account(side_a_key, side_a_data, 10_000_000),
            program_owned_account(side_b_key, side_b_data, 10_000_000),
        ],
    );

    result.assert_error(quasar_svm::ProgramError::Custom(ERR_MARKET_NOT_EXPIRED));
    std::println!(
        "emergency_resolve (reject before deadline): {} CU",
        result.compute_units_consumed
    );
}

// ===================================================================
// Test 22: emergency_resolve - reject already resolved
// ===================================================================

#[test]
fn test_emergency_resolve_reject_already_resolved() {
    let mut svm = setup();
    let (_admin, protocol_fee_account) = setup_config(&mut svm);
    let (config, _) = config_pda();

    let market_key = Pubkey::new_unique();
    let side_a_key = Pubkey::new_unique();
    let side_b_key = Pubkey::new_unique();
    let resolver = Pubkey::new_unique();

    let deadline = 1000i64;
    let emergency_window = DEFAULT_EMERGENCY_WINDOW;

    svm.warp_to_timestamp(deadline + emergency_window as i64);

    let market_data = build_market_data(
        0,
        &Pubkey::new_unique(),
        1,
        &side_a_key,
        &side_b_key,
        &Pubkey::new_unique(),
        deadline,
        300,
        10,
        &Pubkey::new_unique(),
        &protocol_fee_account,
        STATUS_RESOLVED, // already resolved
        0, 0,
        1, 0, // has_winner = 1, winner = 0
        emergency_window,
    );

    let side_a_data = build_side_data(0, &market_key, 0, &Pubkey::new_unique(), &Pubkey::new_unique(), &Pubkey::new_unique(), 1_000_000_000, 0, 0);
    let side_b_data = build_side_data(0, &market_key, 1, &Pubkey::new_unique(), &Pubkey::new_unique(), &Pubkey::new_unique(), 1_000_000_000, 0, 0);

    let ix: Instruction = EmergencyResolveInstruction {
        resolver: Address::from(resolver.to_bytes()),
        market: Address::from(market_key.to_bytes()),
        config: Address::from(config.to_bytes()),
        side_a: Address::from(side_a_key.to_bytes()),
        side_b: Address::from(side_b_key.to_bytes()),
    }
    .into();

    let result = svm.process_instruction(
        &ix,
        &[
            system_account(resolver, 1_000_000_000),
            program_owned_account(market_key, market_data, 10_000_000),
            program_owned_account(side_a_key, side_a_data, 10_000_000),
            program_owned_account(side_b_key, side_b_data, 10_000_000),
        ],
    );

    result.assert_error(quasar_svm::ProgramError::Custom(ERR_MARKET_ALREADY_RESOLVED));
    std::println!(
        "emergency_resolve (reject already resolved): {} CU",
        result.compute_units_consumed
    );
}

// ===================================================================
// Test 23: emergency_resolve - permissionless (any resolver)
// ===================================================================

#[test]
fn test_emergency_resolve_permissionless() {
    let mut svm = setup();
    let (_admin, protocol_fee_account) = setup_config(&mut svm);
    let (config, _) = config_pda();

    let market_key = Pubkey::new_unique();
    let side_a_key = Pubkey::new_unique();
    let side_b_key = Pubkey::new_unique();

    // Random user (not admin, not creator) can resolve
    let random_user = Pubkey::new_unique();

    let deadline = 1000i64;
    let emergency_window = DEFAULT_EMERGENCY_WINDOW;

    svm.warp_to_timestamp(deadline + emergency_window as i64);

    let market_data = build_market_data(
        0,
        &Pubkey::new_unique(),
        1,
        &side_a_key,
        &side_b_key,
        &Pubkey::new_unique(),
        deadline,
        300,
        10,
        &Pubkey::new_unique(),
        &protocol_fee_account,
        STATUS_ACTIVE,
        0, 0, 0, 0,
        emergency_window,
    );

    let side_a_data = build_side_data(0, &market_key, 0, &Pubkey::new_unique(), &Pubkey::new_unique(), &Pubkey::new_unique(), 1_000_000_000, 0, 0);
    let side_b_data = build_side_data(0, &market_key, 1, &Pubkey::new_unique(), &Pubkey::new_unique(), &Pubkey::new_unique(), 1_000_000_000, 0, 0);

    let ix: Instruction = EmergencyResolveInstruction {
        resolver: Address::from(random_user.to_bytes()),
        market: Address::from(market_key.to_bytes()),
        config: Address::from(config.to_bytes()),
        side_a: Address::from(side_a_key.to_bytes()),
        side_b: Address::from(side_b_key.to_bytes()),
    }
    .into();

    let result = svm.process_instruction(
        &ix,
        &[
            system_account(random_user, 1_000_000_000),
            program_owned_account(market_key, market_data, 10_000_000),
            program_owned_account(side_a_key, side_a_data, 10_000_000),
            program_owned_account(side_b_key, side_b_data, 10_000_000),
        ],
    );

    result.assert_success();

    let market_acc = svm.get_account(&market_key).unwrap();
    assert_eq!(parse_market_status(&market_acc.data), STATUS_RESOLVED);
    assert_eq!(parse_market_has_winner(&market_acc.data), 0);

    std::println!(
        "emergency_resolve (permissionless): {} CU",
        result.compute_units_consumed
    );
}

// ===================================================================
// Test 24: close_market - success after emergency resolution
// ===================================================================

#[test]
fn test_close_market_after_emergency_resolve() {
    let mut svm = setup();
    let (admin, protocol_fee_account) = setup_config(&mut svm);
    let (config, _) = config_pda();

    let authority = Pubkey::new_unique();
    let market_key = Pubkey::new_unique();
    let side_a_key = Pubkey::new_unique();
    let side_b_key = Pubkey::new_unique();

    // Resolved market with no circulating supply
    let market_data = build_market_data(
        0,
        &authority,
        1,
        &side_a_key,
        &side_b_key,
        &Pubkey::new_unique(),
        1000, // deadline (in the past)
        300,
        10,
        &Pubkey::new_unique(),
        &protocol_fee_account,
        STATUS_RESOLVED, // resolved
        0, 0, 0, 0,
        DEFAULT_EMERGENCY_WINDOW,
    );

    let side_a_data = build_side_data(0, &market_key, 0, &Pubkey::new_unique(), &Pubkey::new_unique(), &Pubkey::new_unique(), 1_000_000_000, 0, 0); // circulating = 0
    let side_b_data = build_side_data(0, &market_key, 1, &Pubkey::new_unique(), &Pubkey::new_unique(), &Pubkey::new_unique(), 1_000_000_000, 0, 0); // circulating = 0

    let ix: Instruction = CloseMarketInstruction {
        authority: Address::from(authority.to_bytes()),
        market: Address::from(market_key.to_bytes()),
        side_a: Address::from(side_a_key.to_bytes()),
        side_b: Address::from(side_b_key.to_bytes()),
        config: Address::from(config.to_bytes()),
        system_program: SYSTEM_PROGRAM,
    }
    .into();

    let result = svm.process_instruction(
        &ix,
        &[
            system_account(authority, 1_000_000_000),
            program_owned_account(market_key, market_data, 10_000_000),
            program_owned_account(side_a_key, side_a_data, 10_000_000),
            program_owned_account(side_b_key, side_b_data, 10_000_000),
        ],
    );

    result.assert_success();
    std::println!(
        "close_market (success): {} CU",
        result.compute_units_consumed
    );
}

// ===================================================================
// Test 25: close_market - reject if not resolved
// ===================================================================

#[test]
fn test_close_market_reject_not_resolved() {
    let mut svm = setup();
    let (_admin, protocol_fee_account) = setup_config(&mut svm);
    let (config, _) = config_pda();

    let authority = Pubkey::new_unique();
    let market_key = Pubkey::new_unique();
    let side_a_key = Pubkey::new_unique();
    let side_b_key = Pubkey::new_unique();

    let market_data = build_market_data(
        0,
        &authority,
        1,
        &side_a_key,
        &side_b_key,
        &Pubkey::new_unique(),
        1000,
        300,
        10,
        &Pubkey::new_unique(),
        &protocol_fee_account,
        STATUS_ACTIVE, // not resolved
        0, 0, 0, 0,
        DEFAULT_EMERGENCY_WINDOW,
    );

    let side_a_data = build_side_data(0, &market_key, 0, &Pubkey::new_unique(), &Pubkey::new_unique(), &Pubkey::new_unique(), 1_000_000_000, 0, 0);
    let side_b_data = build_side_data(0, &market_key, 1, &Pubkey::new_unique(), &Pubkey::new_unique(), &Pubkey::new_unique(), 1_000_000_000, 0, 0);

    let ix: Instruction = CloseMarketInstruction {
        authority: Address::from(authority.to_bytes()),
        market: Address::from(market_key.to_bytes()),
        side_a: Address::from(side_a_key.to_bytes()),
        side_b: Address::from(side_b_key.to_bytes()),
        config: Address::from(config.to_bytes()),
        system_program: SYSTEM_PROGRAM,
    }
    .into();

    let result = svm.process_instruction(
        &ix,
        &[
            system_account(authority, 1_000_000_000),
            program_owned_account(market_key, market_data, 10_000_000),
            program_owned_account(side_a_key, side_a_data, 10_000_000),
            program_owned_account(side_b_key, side_b_data, 10_000_000),
        ],
    );

    result.assert_error(quasar_svm::ProgramError::Custom(ERR_MARKET_NOT_RESOLVED));
    std::println!(
        "close_market (reject not resolved): {} CU",
        result.compute_units_consumed
    );
}

// ===================================================================
// Test 26: close_market - reject wrong authority
// ===================================================================

#[test]
fn test_close_market_reject_wrong_authority() {
    let mut svm = setup();
    let (_admin, protocol_fee_account) = setup_config(&mut svm);
    let (config, _) = config_pda();

    let real_authority = Pubkey::new_unique();
    let wrong_authority = Pubkey::new_unique();
    let market_key = Pubkey::new_unique();
    let side_a_key = Pubkey::new_unique();
    let side_b_key = Pubkey::new_unique();

    let market_data = build_market_data(
        0,
        &real_authority,
        1,
        &side_a_key,
        &side_b_key,
        &Pubkey::new_unique(),
        1000,
        300,
        10,
        &Pubkey::new_unique(),
        &protocol_fee_account,
        STATUS_RESOLVED,
        0, 0, 0, 0,
        DEFAULT_EMERGENCY_WINDOW,
    );

    let side_a_data = build_side_data(0, &market_key, 0, &Pubkey::new_unique(), &Pubkey::new_unique(), &Pubkey::new_unique(), 1_000_000_000, 0, 0);
    let side_b_data = build_side_data(0, &market_key, 1, &Pubkey::new_unique(), &Pubkey::new_unique(), &Pubkey::new_unique(), 1_000_000_000, 0, 0);

    let ix: Instruction = CloseMarketInstruction {
        authority: Address::from(wrong_authority.to_bytes()),
        market: Address::from(market_key.to_bytes()),
        side_a: Address::from(side_a_key.to_bytes()),
        side_b: Address::from(side_b_key.to_bytes()),
        config: Address::from(config.to_bytes()),
        system_program: SYSTEM_PROGRAM,
    }
    .into();

    let result = svm.process_instruction(
        &ix,
        &[
            system_account(wrong_authority, 1_000_000_000),
            program_owned_account(market_key, market_data, 10_000_000),
            program_owned_account(side_a_key, side_a_data, 10_000_000),
            program_owned_account(side_b_key, side_b_data, 10_000_000),
        ],
    );

    result.assert_error(quasar_svm::ProgramError::Custom(ERR_INVALID_MARKET_CONFIG));
    std::println!(
        "close_market (reject wrong authority): {} CU",
        result.compute_units_consumed
    );
}

// ===================================================================
// Test 27: close_market - admin can close any market
// ===================================================================

#[test]
fn test_close_market_admin_can_close() {
    let mut svm = setup();
    let (admin, protocol_fee_account) = setup_config(&mut svm);
    let (config, _) = config_pda();

    let creator = Pubkey::new_unique();
    let market_key = Pubkey::new_unique();
    let side_a_key = Pubkey::new_unique();
    let side_b_key = Pubkey::new_unique();

    let market_data = build_market_data(
        0,
        &creator, // not admin
        1,
        &side_a_key,
        &side_b_key,
        &Pubkey::new_unique(),
        1000,
        300,
        10,
        &Pubkey::new_unique(),
        &protocol_fee_account,
        STATUS_RESOLVED,
        0, 0, 0, 0,
        DEFAULT_EMERGENCY_WINDOW,
    );

    let side_a_data = build_side_data(0, &market_key, 0, &Pubkey::new_unique(), &Pubkey::new_unique(), &Pubkey::new_unique(), 1_000_000_000, 0, 0);
    let side_b_data = build_side_data(0, &market_key, 1, &Pubkey::new_unique(), &Pubkey::new_unique(), &Pubkey::new_unique(), 1_000_000_000, 0, 0);

    // Admin (not creator) calls close
    let ix: Instruction = CloseMarketInstruction {
        authority: Address::from(admin.to_bytes()),
        market: Address::from(market_key.to_bytes()),
        side_a: Address::from(side_a_key.to_bytes()),
        side_b: Address::from(side_b_key.to_bytes()),
        config: Address::from(config.to_bytes()),
        system_program: SYSTEM_PROGRAM,
    }
    .into();

    let result = svm.process_instruction(
        &ix,
        &[
            system_account(admin, 1_000_000_000),
            program_owned_account(market_key, market_data, 10_000_000),
            program_owned_account(side_a_key, side_a_data, 10_000_000),
            program_owned_account(side_b_key, side_b_data, 10_000_000),
        ],
    );

    result.assert_success();
    std::println!(
        "close_market (admin can close): {} CU",
        result.compute_units_consumed
    );
}

// ===================================================================
// Test 28: update_config - zero values skip update (sentinel behavior)
// ===================================================================

#[test]
fn test_update_config_zero_skips_update() {
    let mut svm = setup();
    let (admin, protocol_fee_account) = setup_config(&mut svm);
    let (config, _) = config_pda();

    // Get initial state
    let config_before = svm.get_account(&config).unwrap();
    let parsed_before = parse_config(&config_before.data);

    // Use unique addresses (all 4 accounts must differ in Quasar).
    // The protocol_fee_account and admin will change but numeric fields
    // stay the same, which is what we're testing.
    let new_pf = Pubkey::new_unique();
    let new_ad = Pubkey::new_unique();

    let ix = update_config_ix(
        admin, config, new_pf, new_ad,
        0xFF, 0, 0, 0, 0,
    );

    let result = svm.process_instruction(
        &ix,
        &[
            system_account(admin, 10_000_000_000),
            system_account(new_pf, 0),
            system_account(new_ad, 0),
        ],
    );
    result.assert_success();

    let config_after = svm.get_account(&config).unwrap();
    let parsed_after = parse_config(&config_after.data);

    assert_eq!(
        parsed_before.trade_fee_bps, parsed_after.trade_fee_bps,
        "trade_fee_bps unchanged"
    );
    assert_eq!(
        parsed_before.creator_fee_split_bps, parsed_after.creator_fee_split_bps,
        "creator_fee_split_bps unchanged"
    );
    assert_eq!(
        parsed_before.min_market_duration, parsed_after.min_market_duration,
        "min_market_duration unchanged"
    );
    // Note: admin and protocol_fee_account DO change because we must use
    // unique addresses for all 4 accounts (Quasar borrow constraint).
    // The zero-sentinel skip only applies to numeric fields.

    std::println!(
        "update_config (zero skips): {} CU",
        result.compute_units_consumed
    );
}

// ===================================================================
// Test 29: record_twap_sample - second sample at exact interval boundary
// ===================================================================

#[test]
fn test_record_twap_sample_at_exact_interval() {
    let mut svm = setup();
    let (_admin, protocol_fee_account) = setup_config(&mut svm);

    let market_key = Pubkey::new_unique();
    let side_a_key = Pubkey::new_unique();
    let side_b_key = Pubkey::new_unique();
    let cranker = Pubkey::new_unique();

    let deadline = 2000i64;
    let twap_window = 300u64;
    let twap_interval = 30u64;
    let twap_start = deadline - twap_window as i64;

    svm.warp_to_timestamp(twap_start);

    let market_data = build_market_data(
        0,
        &Pubkey::new_unique(),
        1,
        &side_a_key,
        &side_b_key,
        &Pubkey::new_unique(),
        deadline,
        twap_window,
        twap_interval,
        &Pubkey::new_unique(),
        &protocol_fee_account,
        STATUS_ACTIVE,
        0, 0, 0, 0,
        DEFAULT_EMERGENCY_WINDOW,
    );

    let side_a_data = build_side_data(0, &market_key, 0, &Pubkey::new_unique(), &Pubkey::new_unique(), &Pubkey::new_unique(), 1_000_000_000, 50_000, 0);
    let side_b_data = build_side_data(0, &market_key, 1, &Pubkey::new_unique(), &Pubkey::new_unique(), &Pubkey::new_unique(), 1_000_000_000, 50_000, 0);

    svm.set_account(system_account(cranker, 1_000_000_000));
    svm.set_account(program_owned_account(market_key, market_data, 10_000_000));
    svm.set_account(program_owned_account(side_a_key, side_a_data, 10_000_000));
    svm.set_account(program_owned_account(side_b_key, side_b_data, 10_000_000));

    let build_ix = || -> Instruction {
        RecordTwapSampleInstruction {
            cranker: Address::from(cranker.to_bytes()),
            market: Address::from(market_key.to_bytes()),
            side_a: Address::from(side_a_key.to_bytes()),
            side_b: Address::from(side_b_key.to_bytes()),
        }
        .into()
    };

    // Sample 1
    let r1 = svm.process_instruction(&build_ix(), &[]);
    r1.assert_success();

    // Sample 2 at exactly the interval boundary
    svm.warp_to_timestamp(twap_start + twap_interval as i64);
    let r2 = svm.process_instruction(&build_ix(), &[]);
    r2.assert_success();

    let market_acc = svm.get_account(&market_key).unwrap();
    assert_eq!(parse_market_twap_samples_count(&market_acc.data), 2);

    std::println!(
        "record_twap_sample (exact interval): {} + {} CU",
        r1.compute_units_consumed,
        r2.compute_units_consumed
    );
}

// ===================================================================
// Test 30: record_twap_sample - zero circulating supply produces
//          base price (b=1 lamport)
// ===================================================================

#[test]
fn test_record_twap_sample_zero_supply_base_price() {
    let mut svm = setup();
    let (_admin, protocol_fee_account) = setup_config(&mut svm);

    let market_key = Pubkey::new_unique();
    let side_a_key = Pubkey::new_unique();
    let side_b_key = Pubkey::new_unique();
    let cranker = Pubkey::new_unique();

    let deadline = 2000i64;
    let twap_window = 300u64;
    let twap_interval = 10u64;
    let twap_start = deadline - twap_window as i64;

    svm.warp_to_timestamp(twap_start);

    let market_data = build_market_data(
        0,
        &Pubkey::new_unique(),
        1,
        &side_a_key,
        &side_b_key,
        &Pubkey::new_unique(),
        deadline,
        twap_window,
        twap_interval,
        &Pubkey::new_unique(),
        &protocol_fee_account,
        STATUS_ACTIVE,
        0, 0, 0, 0,
        DEFAULT_EMERGENCY_WINDOW,
    );

    // Both sides have 0 circulating supply
    let side_a_data = build_side_data(0, &market_key, 0, &Pubkey::new_unique(), &Pubkey::new_unique(), &Pubkey::new_unique(), 1_000_000_000, 0, 0);
    let side_b_data = build_side_data(0, &market_key, 1, &Pubkey::new_unique(), &Pubkey::new_unique(), &Pubkey::new_unique(), 1_000_000_000, 0, 0);

    let ix: Instruction = RecordTwapSampleInstruction {
        cranker: Address::from(cranker.to_bytes()),
        market: Address::from(market_key.to_bytes()),
        side_a: Address::from(side_a_key.to_bytes()),
        side_b: Address::from(side_b_key.to_bytes()),
    }
    .into();

    let result = svm.process_instruction(
        &ix,
        &[
            system_account(cranker, 1_000_000_000),
            program_owned_account(market_key, market_data, 10_000_000),
            program_owned_account(side_a_key, side_a_data, 10_000_000),
            program_owned_account(side_b_key, side_b_data, 10_000_000),
        ],
    );

    result.assert_success();

    // price(0) = a * 0^n / CURVE_SCALE + b = 0 + 1 = 1
    let side_a_acc = svm.get_account(&side_a_key).unwrap();
    let acc_a = parse_side_twap_accumulator(&side_a_acc.data);
    assert_eq!(acc_a, 1, "zero supply should accumulate base price (1)");

    let side_b_acc = svm.get_account(&side_b_key).unwrap();
    let acc_b = parse_side_twap_accumulator(&side_b_acc.data);
    assert_eq!(acc_b, 1, "zero supply should accumulate base price (1)");

    std::println!(
        "record_twap_sample (zero supply base price): {} CU",
        result.compute_units_consumed
    );
}

// ===================================================================
// Test 31: emergency_resolve then close_market full lifecycle
// ===================================================================

#[test]
fn test_emergency_resolve_then_close_market() {
    let mut svm = setup();
    let (admin, protocol_fee_account) = setup_config(&mut svm);
    let (config, _) = config_pda();

    let authority = Pubkey::new_unique();
    let market_key = Pubkey::new_unique();
    let side_a_key = Pubkey::new_unique();
    let side_b_key = Pubkey::new_unique();
    let resolver = Pubkey::new_unique();

    let deadline = 1000i64;
    let emergency_window = 100u64; // Short emergency window for testing

    // Step 1: Set up market in TWAP_OBSERVATION state
    let market_data = build_market_data(
        0,
        &authority,
        1,
        &side_a_key,
        &side_b_key,
        &Pubkey::new_unique(),
        deadline,
        300,
        10,
        &Pubkey::new_unique(),
        &protocol_fee_account,
        STATUS_TWAP_OBSERVATION,
        3,
        deadline - 10,
        0, 0,
        emergency_window,
    );

    let side_a_data = build_side_data(0, &market_key, 0, &Pubkey::new_unique(), &Pubkey::new_unique(), &Pubkey::new_unique(), 1_000_000_000, 0, 0);
    let side_b_data = build_side_data(0, &market_key, 1, &Pubkey::new_unique(), &Pubkey::new_unique(), &Pubkey::new_unique(), 1_000_000_000, 0, 0);

    svm.set_account(system_account(resolver, 1_000_000_000));
    svm.set_account(system_account(authority, 1_000_000_000));
    svm.set_account(program_owned_account(market_key, market_data, 10_000_000));
    svm.set_account(program_owned_account(side_a_key, side_a_data, 10_000_000));
    svm.set_account(program_owned_account(side_b_key, side_b_data, 10_000_000));

    // Step 2: Warp past emergency window and resolve
    svm.warp_to_timestamp(deadline + emergency_window as i64);

    let resolve_ix: Instruction = EmergencyResolveInstruction {
        resolver: Address::from(resolver.to_bytes()),
        market: Address::from(market_key.to_bytes()),
        config: Address::from(config.to_bytes()),
        side_a: Address::from(side_a_key.to_bytes()),
        side_b: Address::from(side_b_key.to_bytes()),
    }
    .into();

    let r1 = svm.process_instruction(&resolve_ix, &[]);
    r1.assert_success();

    // Step 3: Close market
    let close_ix: Instruction = CloseMarketInstruction {
        authority: Address::from(authority.to_bytes()),
        market: Address::from(market_key.to_bytes()),
        side_a: Address::from(side_a_key.to_bytes()),
        side_b: Address::from(side_b_key.to_bytes()),
        config: Address::from(config.to_bytes()),
        system_program: SYSTEM_PROGRAM,
    }
    .into();

    let r2 = svm.process_instruction(&close_ix, &[]);
    r2.assert_success();

    std::println!(
        "emergency_resolve + close_market lifecycle: {} + {} CU",
        r1.compute_units_consumed,
        r2.compute_units_consumed
    );
}

// ===================================================================
// Test 32: update_config - boundary value: max trade fee (500 bps)
// ===================================================================

#[test]
fn test_update_config_max_trade_fee() {
    let mut svm = setup();
    let (admin, _protocol_fee_account) = setup_config(&mut svm);
    let (config, _) = config_pda();

    let new_pf = Pubkey::new_unique();
    let new_ad = Pubkey::new_unique();

    let ix = update_config_ix(
        admin, config, new_pf, new_ad,
        0xFF, MAX_TRADE_FEE_BPS, 0, 0, 0, // exactly 500
    );

    let result = svm.process_instruction(
        &ix,
        &[
            system_account(admin, 10_000_000_000),
            system_account(new_pf, 0),
            system_account(new_ad, 0),
        ],
    );
    result.assert_success();

    let config_account = svm.get_account(&config).unwrap();
    let parsed = parse_config(&config_account.data);
    assert_eq!(parsed.trade_fee_bps, 500, "max trade fee should be set");

    std::println!(
        "update_config (max trade fee): {} CU",
        result.compute_units_consumed
    );
}

// ===================================================================
// Test 33: update_config - boundary value: 100% creator fee split
// ===================================================================

#[test]
fn test_update_config_full_creator_split() {
    let mut svm = setup();
    let (admin, _protocol_fee_account) = setup_config(&mut svm);
    let (config, _) = config_pda();

    let new_pf = Pubkey::new_unique();
    let new_ad = Pubkey::new_unique();

    let ix = update_config_ix(
        admin, config, new_pf, new_ad,
        0xFF, 0, 10000, 0, 0, // 100%
    );

    let result = svm.process_instruction(
        &ix,
        &[
            system_account(admin, 10_000_000_000),
            system_account(new_pf, 0),
            system_account(new_ad, 0),
        ],
    );
    result.assert_success();

    let config_account = svm.get_account(&config).unwrap();
    let parsed = parse_config(&config_account.data);
    assert_eq!(
        parsed.creator_fee_split_bps, 10000,
        "100% creator split should be set"
    );

    std::println!(
        "update_config (100% creator split): {} CU",
        result.compute_units_consumed
    );
}

// ===================================================================
// Test 34: close_market - reject with circulating supply
// ===================================================================

#[test]
fn test_close_market_reject_circulating_supply() {
    let mut svm = setup();
    let (_admin, protocol_fee_account) = setup_config(&mut svm);
    let (config, _) = config_pda();

    let authority = Pubkey::new_unique();
    let market_key = Pubkey::new_unique();
    let side_a_key = Pubkey::new_unique();
    let side_b_key = Pubkey::new_unique();

    let market_data = build_market_data(
        0,
        &authority,
        1,
        &side_a_key,
        &side_b_key,
        &Pubkey::new_unique(),
        1000,
        300,
        10,
        &Pubkey::new_unique(),
        &protocol_fee_account,
        STATUS_RESOLVED,
        0, 0, 0, 0,
        DEFAULT_EMERGENCY_WINDOW,
    );

    // Side A has non-zero circulating supply
    let side_a_data = build_side_data(0, &market_key, 0, &Pubkey::new_unique(), &Pubkey::new_unique(), &Pubkey::new_unique(), 1_000_000_000, 100, 0);
    let side_b_data = build_side_data(0, &market_key, 1, &Pubkey::new_unique(), &Pubkey::new_unique(), &Pubkey::new_unique(), 1_000_000_000, 0, 0);

    let ix: Instruction = CloseMarketInstruction {
        authority: Address::from(authority.to_bytes()),
        market: Address::from(market_key.to_bytes()),
        side_a: Address::from(side_a_key.to_bytes()),
        side_b: Address::from(side_b_key.to_bytes()),
        config: Address::from(config.to_bytes()),
        system_program: SYSTEM_PROGRAM,
    }
    .into();

    let result = svm.process_instruction(
        &ix,
        &[
            system_account(authority, 1_000_000_000),
            program_owned_account(market_key, market_data, 10_000_000),
            program_owned_account(side_a_key, side_a_data, 10_000_000),
            program_owned_account(side_b_key, side_b_data, 10_000_000),
        ],
    );

    // InsufficientTokenBalance = error code 8
    result.assert_error(quasar_svm::ProgramError::Custom(8));
    std::println!(
        "close_market (reject circulating supply): {} CU",
        result.compute_units_consumed
    );
}

// ===================================================================
// Test 35: initialize_config with exact boundary values
// ===================================================================

#[test]
fn test_initialize_config_boundary_max_fee() {
    let mut svm = setup();

    let admin = Pubkey::new_unique();
    let protocol_fee_account = Pubkey::new_unique();
    let (config, _) = config_pda();

    // Exactly MAX_TRADE_FEE_BPS = 500 -- should succeed
    let ix: Instruction = InitializeConfigInstruction {
        admin: Address::from(admin.to_bytes()),
        config: Address::from(config.to_bytes()),
        protocol_fee_account: Address::from(protocol_fee_account.to_bytes()),
        system_program: SYSTEM_PROGRAM,
        rent: RENT_SYSVAR,
        trade_fee_bps: 500,
        creator_fee_split_bps: 10000, // exactly 100%
        market_creation_fee: u64::MAX, // large value
    }
    .into();

    let result = svm.process_instruction(
        &ix,
        &[
            system_account(admin, 10_000_000_000),
            Account {
                address: config,
                lamports: 0,
                data: vec![],
                owner: quasar_svm::system_program::ID,
                executable: false,
            },
        ],
    );

    result.assert_success();

    let config_account = svm.get_account(&config).unwrap();
    let parsed = parse_config(&config_account.data);
    assert_eq!(parsed.trade_fee_bps, 500);
    assert_eq!(parsed.creator_fee_split_bps, 10000);
    assert_eq!(parsed.market_creation_fee, u64::MAX);

    std::println!(
        "initialize_config (boundary max): {} CU",
        result.compute_units_consumed
    );
}
