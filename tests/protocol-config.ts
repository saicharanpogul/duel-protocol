import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Duel } from "../target/types/duel";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
  ComputeBudgetProgram,
  Transaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
  getAccount,
} from "@solana/spl-token";
import { expect } from "chai";
import BN from "bn.js";
import {
  TOKEN_METADATA_PROGRAM_ID,
  findMetadataPda,
  derivePdas,
  wrapSol,
  Pdas,
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

  // Protocol fee = WSOL token account
  let protocolFeeOwner: Keypair;
  let protocolFeeAccount: PublicKey;
  let creatorFeeAccount: PublicKey;
  let creatorWsolAta: PublicKey;

  before(async () => {
    // Setup protocol fee owner and their WSOL ATA
    protocolFeeOwner = Keypair.generate();
    const fundTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: creator.publicKey,
        toPubkey: protocolFeeOwner.publicKey,
        lamports: LAMPORTS_PER_SOL / 10,
      })
    );
    await provider.sendAndConfirm(fundTx);

    protocolFeeAccount = await getAssociatedTokenAddress(NATIVE_MINT, protocolFeeOwner.publicKey);
    const createAtaTx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        protocolFeeOwner.publicKey,
        protocolFeeAccount,
        protocolFeeOwner.publicKey,
        NATIVE_MINT
      )
    );
    await provider.sendAndConfirm(createAtaTx, [protocolFeeOwner]);

    // Creator fee WSOL ATA
    creatorFeeAccount = await getAssociatedTokenAddress(NATIVE_MINT, creator.publicKey);
    try {
      await getAccount(provider.connection, creatorFeeAccount);
    } catch {
      const tx = new Transaction().add(
        createAssociatedTokenAccountInstruction(creator.publicKey, creatorFeeAccount, creator.publicKey, NATIVE_MINT)
      );
      await provider.sendAndConfirm(tx);
    }
    creatorWsolAta = creatorFeeAccount;

    // Initialize config
    try {
      await program.account.programConfig.fetch(configPda);
    } catch {
      await program.methods
        .initializeConfig(125, new BN(0))
        .accounts({
          admin: creator.publicKey,
          protocolFeeAccount: protocolFeeAccount,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();
    }
  });

  function deriveMarketPdas(marketId: BN) {
    return derivePdas(program.programId, creator.publicKey, marketId);
  }

  async function createMarket(marketId: BN) {
    const pdas = deriveMarketPdas(marketId);
    const now = Math.floor(Date.now() / 1000);
    await program.methods
      .initializeMarket(
        marketId, new BN(now + 3600), new BN(600), new BN(10),
        5000, 100, 1500, new BN(300),
        { a: new BN(1_000_000), n: 1, b: new BN(1_000) },
        new BN(1_000_000_000),
        "Config Test A", "CTA", "", "Config Test B", "CTB", "",
        { unlocked: {} },
        new BN(0), 0, 0,
        { twap: {} }, PublicKey.default, new BN(0),
      )
      .accounts({
        creator: creator.publicKey,
        market: pdas.market, sideA: pdas.sideA, sideB: pdas.sideB,
        tokenMintA: pdas.mintA, tokenMintB: pdas.mintB,
        tokenVaultA: pdas.tvA, tokenVaultB: pdas.tvB,
        quoteMint: NATIVE_MINT,
        quoteTokenProgram: TOKEN_PROGRAM_ID,
        quoteVaultA: pdas.qvA, quoteVaultB: pdas.qvB,
        protocolFeeAccount: protocolFeeAccount,
        creatorFeeAccount: creatorFeeAccount,
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

      // Create token ATA and wrap SOL
      const ata = await getAssociatedTokenAddress(pdas.mintA, creator.publicKey);
      try {
        const createAtaIx = createAssociatedTokenAccountInstruction(
          creator.publicKey, ata, creator.publicKey, pdas.mintA
        );
        await provider.sendAndConfirm(new Transaction().add(createAtaIx));
      } catch { }

      await wrapSol(provider, creator.publicKey, LAMPORTS_PER_SOL);

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
            quoteMint: NATIVE_MINT,
            quoteVault: pdas.qvA,
            buyerQuoteAccount: creatorWsolAta,
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
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: creator.publicKey,
          toPubkey: newAdmin.publicKey,
          lamports: 0.1 * LAMPORTS_PER_SOL,
        })
      );
      await provider.sendAndConfirm(tx);

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

      // Transfer back
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
      const tx = new Transaction().add(
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
