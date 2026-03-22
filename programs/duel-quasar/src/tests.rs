extern crate std;

use quasar_svm::{Account, Instruction, Pubkey, QuasarSvm};
use solana_address::Address;

use duel_quasar_client::InitializeConfigInstruction;

fn setup() -> QuasarSvm {
    let elf = include_bytes!("../../../target/deploy/duel_quasar.so");
    QuasarSvm::new()
        .with_program(&Pubkey::from(crate::ID), elf)
}

fn config_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"config"], &Pubkey::from(crate::ID))
}

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
        system_program: Address::from(quasar_svm::system_program::ID.to_bytes()),
        rent: solana_address::address!("SysvarRent111111111111111111111111111111111"),
        trade_fee_bps: 100,
        creator_fee_split_bps: 5000,
        market_creation_fee: 0,
    }
    .into();

    let result = svm.process_instruction(
        &instruction,
        &[
            Account {
                address: admin,
                lamports: 10_000_000_000,
                data: vec![],
                owner: quasar_svm::system_program::ID,
                executable: false,
            },
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
