import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Duel } from "../target/types/duel";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import { expect } from "chai";
import BN from "bn.js";

const TOKEN_METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

function findMetadataPda(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), TOKEN_METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    TOKEN_METADATA_PROGRAM_ID
  );
  return pda;
}

const RENT_EXEMPT_MIN = 890_880;

describe("protocol-config", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Duel as Program<Duel>;
  const creator = provider.wallet;
  const protocolFeeAccount = Keypair.generate();
  const configBase = Math.floor(Math.random() * 10_000_000) + 50_000_000;

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );

  async function prefundPda(pda: PublicKey) {
    const tx = new anchor.web3.Transaction().add(
      SystemProgram.transfer({ fromPubkey: creator.publicKey, toPubkey: pda, lamports: RENT_EXEMPT_MIN })
    );
    await provider.sendAndConfirm(tx);
  }

  function derivePdas(marketId: BN) {
    const [market] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), creator.publicKey.toBuffer(), marketId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    const pda = (seed: string, idx: number) =>
      PublicKey.findProgramAddressSync(
        [Buffer.from(seed), market.toBuffer(), Buffer.from([idx])],
        program.programId
      )[0];
    return {
      market,
      sideA: pda("side", 0), sideB: pda("side", 1),
      mintA: pda("mint", 0), mintB: pda("mint", 1),
      tvA: pda("token_vault", 0), tvB: pda("token_vault", 1),
      svA: pda("sol_vault", 0), svB: pda("sol_vault", 1),
    };
  }

  async function createMarket(marketId: BN) {
    const pdas = derivePdas(marketId);
    const now = Math.floor(Date.now() / 1000);
    await prefundPda(protocolFeeAccount.publicKey);
    await program.methods
      .initializeMarket(
        marketId, new BN(now + 3600), new BN(600), new BN(10),
        5000, 100, 1500, new BN(300),
        { a: new BN(1_000_000), n: 1, b: new BN(1_000) },
        new BN(1_000_000_000),
        "Config Test A", "CTA", "", "Config Test B", "CTB", "",
        { unlocked: {} },
        new BN(0), 0, 0,
      )
      .accounts({
        creator: creator.publicKey,
        market: pdas.market, sideA: pdas.sideA, sideB: pdas.sideB,
        tokenMintA: pdas.mintA, tokenMintB: pdas.mintB,
        tokenVaultA: pdas.tvA, tokenVaultB: pdas.tvB,
        solVaultA: pdas.svA, solVaultB: pdas.svB,
        protocolFeeAccount: protocolFeeAccount.publicKey,
        config: configPda,
        metadataA: findMetadataPda(pdas.mintA),
        metadataB: findMetadataPda(pdas.mintB),
        tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })])
      .rpc();
    return pdas;
  }

  before(async () => {
    // Ensure config is initialized
    try {
      await program.account.programConfig.fetch(configPda);
    } catch {
      await prefundPda(protocolFeeAccount.publicKey);
      await program.methods
        .initializeConfig(125, new BN(0))
        .accounts({
          admin: creator.publicKey,
          config: configPda,
          protocolFeeAccount: protocolFeeAccount.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }
  });

  describe("Config State", () => {
    it("reads config state correctly", async () => {
      const config = await program.account.programConfig.fetch(configPda);
      expect(config.admin.toString()).to.equal(creator.publicKey.toString());
      expect(config.paused).to.be.false;
      expect(config.defaultProtocolFeeBps).to.be.a("number");
      console.log(`    Config: admin=${config.admin.toString().slice(0, 8)}..., paused=${config.paused}, fee=${config.defaultProtocolFeeBps}bps`);
    });
  });

  describe("Pause / Unpause", () => {
    it("should pause protocol via update_config", async () => {
      await program.methods
        .updateConfig(true, null, null)
        .accounts({
          admin: creator.publicKey,
          config: configPda,
          newProtocolFeeAccount: null,
          newAdmin: null,
        })
        .rpc();

      const config = await program.account.programConfig.fetch(configPda);
      expect(config.paused).to.be.true;
      console.log(`    Protocol paused: ${config.paused}`);
    });

    it("should reject market creation when paused", async () => {
      try {
        await createMarket(new BN(configBase + 10));
        expect.fail("should have rejected");
      } catch (e: any) {
        expect(e.message).to.include("ProtocolPaused");
        console.log(`    Market creation rejected while paused`);
      }
    });

    it("should reject buy when paused", async () => {
      // Unpause temporarily to create market, then re-pause to test buy rejection
      await program.methods
        .updateConfig(false, null, null)
        .accounts({ admin: creator.publicKey, config: configPda, newProtocolFeeAccount: null, newAdmin: null })
        .rpc();

      const pdas = await createMarket(new BN(configBase + 11));

      // Re-pause
      await program.methods
        .updateConfig(true, null, null)
        .accounts({ admin: creator.publicKey, config: configPda, newProtocolFeeAccount: null, newAdmin: null })
        .rpc();

      // Try buying — should fail
      const ata = await getAssociatedTokenAddress(pdas.mintA, creator.publicKey);
      try {
        const createAtaIx = createAssociatedTokenAccountInstruction(
          creator.publicKey, ata, creator.publicKey, pdas.mintA
        );
        await provider.sendAndConfirm(new anchor.web3.Transaction().add(createAtaIx));
      } catch { }

      try {
        await program.methods
          .buyTokens(0, new BN(LAMPORTS_PER_SOL), new BN(1))
          .accounts({
            buyer: creator.publicKey,
            market: pdas.market,
            sideAccount: pdas.sideA,
            tokenMint: pdas.mintA,
            tokenVault: pdas.tvA,
            buyerTokenAccount: ata,
            solVault: pdas.svA,
            config: configPda,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        expect.fail("should have rejected buy");
      } catch (e: any) {
        expect(e.message).to.include("ProtocolPaused");
        console.log(`    Buy rejected while paused`);
      }
    });

    it("should unpause and resume trading", async () => {
      await program.methods
        .updateConfig(false, null, null)
        .accounts({ admin: creator.publicKey, config: configPda, newProtocolFeeAccount: null, newAdmin: null })
        .rpc();

      const config = await program.account.programConfig.fetch(configPda);
      expect(config.paused).to.be.false;
      console.log(`    Protocol unpaused: trading resumed`);
    });
  });

  describe("Fee Updates", () => {
    it("should update default_protocol_fee_bps", async () => {
      await program.methods
        .updateConfig(null, 200, null)
        .accounts({ admin: creator.publicKey, config: configPda, newProtocolFeeAccount: null, newAdmin: null })
        .rpc();

      const config = await program.account.programConfig.fetch(configPda);
      expect(config.defaultProtocolFeeBps).to.equal(200);
      console.log(`    Updated default_protocol_fee_bps to 200`);

      // Restore
      await program.methods
        .updateConfig(null, 125, null)
        .accounts({ admin: creator.publicKey, config: configPda, newProtocolFeeAccount: null, newAdmin: null })
        .rpc();
    });

    it("should reject fee_bps > 500", async () => {
      try {
        await program.methods
          .updateConfig(null, 600, null)
          .accounts({ admin: creator.publicKey, config: configPda, newProtocolFeeAccount: null, newAdmin: null })
          .rpc();
        expect.fail("should have rejected");
      } catch (e: any) {
        expect(e.message).to.include("InvalidFeeConfig");
        console.log(`    Rejected fee_bps=600 (max 500)`);
      }
    });

    it("should update market_creation_fee", async () => {
      await program.methods
        .updateConfig(null, null, new BN(10_000))
        .accounts({ admin: creator.publicKey, config: configPda, newProtocolFeeAccount: null, newAdmin: null })
        .rpc();

      const config = await program.account.programConfig.fetch(configPda);
      expect(config.marketCreationFee.toNumber()).to.equal(10_000);
      console.log(`    Updated market_creation_fee to 10000 lamports`);

      // Restore to 0
      await program.methods
        .updateConfig(null, null, new BN(0))
        .accounts({ admin: creator.publicKey, config: configPda, newProtocolFeeAccount: null, newAdmin: null })
        .rpc();
    });
  });

  describe("Admin Transfer", () => {
    it("should transfer admin to new key", async () => {
      const newAdmin = Keypair.generate();
      // Fund new admin
      const tx = new anchor.web3.Transaction().add(
        SystemProgram.transfer({
          fromPubkey: creator.publicKey,
          toPubkey: newAdmin.publicKey,
          lamports: 0.1 * LAMPORTS_PER_SOL,
        })
      );
      await provider.sendAndConfirm(tx);

      // Transfer admin to newAdmin
      await program.methods
        .updateConfig(null, null, null)
        .accounts({
          admin: creator.publicKey,
          config: configPda,
          newProtocolFeeAccount: null,
          newAdmin: newAdmin.publicKey,
        })
        .rpc();

      const config = await program.account.programConfig.fetch(configPda);
      expect(config.admin.toString()).to.equal(newAdmin.publicKey.toString());
      console.log(`    Admin transferred to ${newAdmin.publicKey.toString().slice(0, 8)}...`);

      // Transfer back (need newAdmin to sign)
      await program.methods
        .updateConfig(null, null, null)
        .accounts({
          admin: newAdmin.publicKey,
          config: configPda,
          newProtocolFeeAccount: null,
          newAdmin: creator.publicKey,
        })
        .signers([newAdmin])
        .rpc();

      const configRestored = await program.account.programConfig.fetch(configPda);
      expect(configRestored.admin.toString()).to.equal(creator.publicKey.toString());
      console.log(`    Admin transferred back to original`);
    });

    it("should reject non-admin update", async () => {
      const nonAdmin = Keypair.generate();
      const tx = new anchor.web3.Transaction().add(
        SystemProgram.transfer({
          fromPubkey: creator.publicKey,
          toPubkey: nonAdmin.publicKey,
          lamports: 0.01 * LAMPORTS_PER_SOL,
        })
      );
      await provider.sendAndConfirm(tx);

      try {
        await program.methods
          .updateConfig(true, null, null)
          .accounts({
            admin: nonAdmin.publicKey,
            config: configPda,
            newProtocolFeeAccount: null,
            newAdmin: null,
          })
          .signers([nonAdmin])
          .rpc();
        expect.fail("should have rejected non-admin");
      } catch (e: any) {
        expect(e.message).to.include("InvalidMarketConfig");
        console.log(`    Non-admin update rejected`);
      }
    });
  });
});
