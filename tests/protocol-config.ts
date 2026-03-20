import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Duel } from "../target/types/duel";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
  Transaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
} from "@solana/spl-token";
import { expect } from "chai";
import BN from "bn.js";
import {
  findMetadataPda,
  derivePdas,
  wrapSol,
  setupTestContext,
  createTestMarket,
  buyTestTokens,
  TOKEN_METADATA_PROGRAM_ID,
  Pdas,
  TestContext,
} from "./helpers";

describe("protocol-config", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Duel as Program<Duel>;
  const creator = provider.wallet;
  const configBase = Math.floor(Math.random() * 10_000_000) + 50_000_000;

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );

  let ctx: TestContext;

  before(async () => {
    ctx = await setupTestContext(provider, program, creator);
  });

  describe("Config State", () => {
    it("reads config state correctly", async () => {
      const config = await program.account.programConfig.fetch(configPda);
      expect(config.admin.toString()).to.equal(creator.publicKey.toString());
      expect(config.paused).to.be.false;
      // Config may have been initialized by another test suite; just verify fields exist
      expect(config.tradeFeeBps).to.be.a("number");
      expect(config.creatorFeeSplitBps).to.be.a("number");
      console.log(`    Config: admin=${config.admin.toString().slice(0, 8)}..., paused=${config.paused}, trade_fee=${config.tradeFeeBps}bps, creator_split=${config.creatorFeeSplitBps}bps`);
    });
  });

  describe("Pause / Unpause", () => {
    it("should pause protocol via update_config", async () => {
      await (program.methods as any)
        .updateConfig(true, null, null, null, null)
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
        await createTestMarket(provider, program, creator, ctx, new BN(configBase + 10));
        expect.fail("should have rejected");
      } catch (e: any) {
        expect(e.message).to.include("ProtocolPaused");
        console.log(`    Market creation rejected while paused`);
      }
    });

    it("should reject buy when paused", async () => {
      // Unpause temporarily to create market, then re-pause to test buy rejection
      await (program.methods as any)
        .updateConfig(false, null, null, null, null)
        .accounts({ admin: creator.publicKey, config: configPda, newProtocolFeeAccount: null, newAdmin: null })
        .rpc();

      const pdas = await createTestMarket(provider, program, creator, ctx, new BN(configBase + 11));

      // Re-pause
      await (program.methods as any)
        .updateConfig(true, null, null, null, null)
        .accounts({ admin: creator.publicKey, config: configPda, newProtocolFeeAccount: null, newAdmin: null })
        .rpc();

      // Create token ATA and wrap SOL
      const ata = await getAssociatedTokenAddress(pdas.mintA, creator.publicKey);
      try {
        const createAtaIx = createAssociatedTokenAccountInstruction(
          creator.publicKey, ata, creator.publicKey, pdas.mintA
        );
        await provider.sendAndConfirm(new Transaction().add(createAtaIx));
      } catch { /* ATA may already exist */ }

      await wrapSol(provider, creator.publicKey, LAMPORTS_PER_SOL);

      try {
        await (program.methods as any)
          .buyTokens(0, new BN(LAMPORTS_PER_SOL), new BN(1))
          .accounts({
            buyer: creator.publicKey,
            market: pdas.market,
            sideAccount: pdas.sideA,
            tokenMint: pdas.mintA,
            tokenVault: pdas.tvA,
            buyerTokenAccount: ata,
            quoteMint: NATIVE_MINT,
            quoteVault: pdas.qvA,
            buyerQuoteAccount: ctx.creatorWsolAta,
            protocolFeeAccount: ctx.protocolFeeAccount,
            creatorFeeAccount: ctx.creatorFeeAccount,
            config: configPda,
            tokenProgram: TOKEN_PROGRAM_ID,
            quoteTokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        expect.fail("should have rejected buy");
      } catch (e: any) {
        expect(e.message).to.include("ProtocolPaused");
        console.log(`    Buy rejected while paused`);
      }
    });

    it("should unpause and resume trading", async () => {
      await (program.methods as any)
        .updateConfig(false, null, null, null, null)
        .accounts({ admin: creator.publicKey, config: configPda, newProtocolFeeAccount: null, newAdmin: null })
        .rpc();

      const config = await program.account.programConfig.fetch(configPda);
      expect(config.paused).to.be.false;
      console.log(`    Protocol unpaused: trading resumed`);
    });
  });

  describe("Fee Updates", () => {
    it("should update trade_fee_bps", async () => {
      await (program.methods as any)
        .updateConfig(null, 200, null, null, null)
        .accounts({ admin: creator.publicKey, config: configPda, newProtocolFeeAccount: null, newAdmin: null })
        .rpc();

      const config = await program.account.programConfig.fetch(configPda);
      expect(config.tradeFeeBps).to.equal(200);
      console.log(`    Updated trade_fee_bps to 200`);

      // Restore to 100
      await (program.methods as any)
        .updateConfig(null, 100, null, null, null)
        .accounts({ admin: creator.publicKey, config: configPda, newProtocolFeeAccount: null, newAdmin: null })
        .rpc();
    });

    it("should reject trade_fee_bps > 500", async () => {
      try {
        await (program.methods as any)
          .updateConfig(null, 600, null, null, null)
          .accounts({ admin: creator.publicKey, config: configPda, newProtocolFeeAccount: null, newAdmin: null })
          .rpc();
        expect.fail("should have rejected");
      } catch (e: any) {
        expect(e.message).to.include("InvalidFeeConfig");
        console.log(`    Rejected trade_fee_bps=600 (max 500)`);
      }
    });

    it("should update creator_fee_split_bps", async () => {
      await (program.methods as any)
        .updateConfig(null, null, 7000, null, null)
        .accounts({ admin: creator.publicKey, config: configPda, newProtocolFeeAccount: null, newAdmin: null })
        .rpc();

      const config = await program.account.programConfig.fetch(configPda);
      expect(config.creatorFeeSplitBps).to.equal(7000);
      console.log(`    Updated creator_fee_split_bps to 7000`);

      // Restore to 5000
      await (program.methods as any)
        .updateConfig(null, null, 5000, null, null)
        .accounts({ admin: creator.publicKey, config: configPda, newProtocolFeeAccount: null, newAdmin: null })
        .rpc();
    });

    it("should update market_creation_fee", async () => {
      await (program.methods as any)
        .updateConfig(null, null, null, new BN(10_000), null)
        .accounts({ admin: creator.publicKey, config: configPda, newProtocolFeeAccount: null, newAdmin: null })
        .rpc();

      const config = await program.account.programConfig.fetch(configPda);
      expect(config.marketCreationFee.toNumber()).to.equal(10_000);
      console.log(`    Updated market_creation_fee to 10000 lamports`);

      // Restore to 0
      await (program.methods as any)
        .updateConfig(null, null, null, new BN(0), null)
        .accounts({ admin: creator.publicKey, config: configPda, newProtocolFeeAccount: null, newAdmin: null })
        .rpc();
    });

    it("should update min_market_duration", async () => {
      await (program.methods as any)
        .updateConfig(null, null, null, null, new BN(30))
        .accounts({ admin: creator.publicKey, config: configPda, newProtocolFeeAccount: null, newAdmin: null })
        .rpc();

      const config = await program.account.programConfig.fetch(configPda);
      expect(config.minMarketDuration.toNumber()).to.equal(30);
      console.log(`    Updated min_market_duration to 30`);

      // Restore to 10
      await (program.methods as any)
        .updateConfig(null, null, null, null, new BN(10))
        .accounts({ admin: creator.publicKey, config: configPda, newProtocolFeeAccount: null, newAdmin: null })
        .rpc();
    });
  });

  describe("Admin Transfer", () => {
    it("should transfer admin to new key", async () => {
      const newAdmin = Keypair.generate();
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: creator.publicKey,
          toPubkey: newAdmin.publicKey,
          lamports: 0.1 * LAMPORTS_PER_SOL,
        })
      );
      await provider.sendAndConfirm(tx);

      await (program.methods as any)
        .updateConfig(null, null, null, null, null)
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

      // Transfer back
      await (program.methods as any)
        .updateConfig(null, null, null, null, null)
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
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: creator.publicKey,
          toPubkey: nonAdmin.publicKey,
          lamports: 0.01 * LAMPORTS_PER_SOL,
        })
      );
      await provider.sendAndConfirm(tx);

      try {
        await (program.methods as any)
          .updateConfig(true, null, null, null, null)
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
