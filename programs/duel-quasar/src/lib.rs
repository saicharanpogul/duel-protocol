#![cfg_attr(not(test), no_std)]

use quasar_lang::prelude::*;

mod constants;
mod errors;
mod events;
mod instructions;
mod math;
mod state;

use instructions::*;

declare_id!("CYgcgUW2UxMWLxHdqufppvVzAnRWZhBqn5Cko3WMdH6W");

#[program]
mod duel_quasar {
    use super::*;

    #[instruction(discriminator = 0)]
    pub fn initialize(ctx: Ctx<Initialize>) -> Result<(), ProgramError> {
        ctx.accounts.initialize()
    }
}

#[cfg(test)]
mod tests;
