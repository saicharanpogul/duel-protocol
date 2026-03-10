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
  getAccount,
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

// Rent-exempt minimum for a 0-data account
const RENT_EXEMPT_MIN = 890_880;

describe("duel", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Duel as Program<Duel>;
  const creator = provider.wallet;

  // Market params
  const marketId = new BN(Math.floor(Math.random() * 10_000_000) + 20_000_000);
  const totalSupplyPerSide = new BN(1_000_000_000); // 1B tokens (6 decimals = 1000 tokens)
  const curveParams = {
    a: new BN(1_000_000),
    n: 1,
    b: new BN(1_000),
  };

  // PDAs
  let marketPda: PublicKey;
  let sideAPda: PublicKey;
  let sideBPda: PublicKey;
  let mintA: PublicKey;
  let mintB: PublicKey;
  let tokenVaultA: PublicKey;
  let tokenVaultB: PublicKey;
  let solVaultA: PublicKey;
  let solVaultB: PublicKey;
  let protocolFeeAccount: Keypair;
  let configPda: PublicKey;

  before(async () => {
    [marketPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("market"),
        creator.publicKey.toBuffer(),
        marketId.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    [sideAPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("side"), marketPda.toBuffer(), Buffer.from([0])],
      program.programId
    );
    [sideBPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("side"), marketPda.toBuffer(), Buffer.from([1])],
      program.programId
    );
    [mintA] = PublicKey.findProgramAddressSync(
      [Buffer.from("mint"), marketPda.toBuffer(), Buffer.from([0])],
      program.programId
    );
    [mintB] = PublicKey.findProgramAddressSync(
      [Buffer.from("mint"), marketPda.toBuffer(), Buffer.from([1])],
      program.programId
    );
    [tokenVaultA] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_vault"), marketPda.toBuffer(), Buffer.from([0])],
      program.programId
    );
    [tokenVaultB] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_vault"), marketPda.toBuffer(), Buffer.from([1])],
      program.programId
    );
    [solVaultA] = PublicKey.findProgramAddressSync(
      [Buffer.from("sol_vault"), marketPda.toBuffer(), Buffer.from([0])],
      program.programId
    );
    [solVaultB] = PublicKey.findProgramAddressSync(
      [Buffer.from("sol_vault"), marketPda.toBuffer(), Buffer.from([1])],
      program.programId
    );
    protocolFeeAccount = Keypair.generate();

    [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program.programId
    );

    // Initialize ProgramConfig (once)
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

  // Helper: pre-fund a PDA so it's rent-exempt
  async function prefundPda(pda: PublicKey) {
    const tx = new anchor.web3.Transaction().add(
      SystemProgram.transfer({
        fromPubkey: creator.publicKey,
        toPubkey: pda,
        lamports: RENT_EXEMPT_MIN,
      })
    );
    await provider.sendAndConfirm(tx);
  }

  describe("initialize_market", () => {
    it("should create a market with valid params", async () => {
      // Pre-fund protocol fee account so it's rent-exempt
      await prefundPda(protocolFeeAccount.publicKey);

      const now = Math.floor(Date.now() / 1000);
      const deadline = now + 3600;
      const twapWindow = 600;
      const twapInterval = 10;
      const battleTaxBps = 6000;
      const protocolFeeBps = 125;
      const sellPenaltyMaxBps = 1500;
      const protectionActivationOffset = 300;

      const tx = await program.methods
        .initializeMarket(
          marketId,
          new BN(deadline),
          new BN(twapWindow),
          new BN(twapInterval),
          battleTaxBps,
          protocolFeeBps,
          sellPenaltyMaxBps,
          new BN(protectionActivationOffset),
          curveParams,
          totalSupplyPerSide,
          "Duel Side A",
          "DUEL-A",
          "https://duel.protocol/tokens/a",
          "Duel Side B",
          "DUEL-B",
          "https://duel.protocol/tokens/b",
          { unlocked: {} },
          new BN(0),  // maxObservationChangePerUpdate (disabled)
          0,          // minTwapSpreadBps (any difference resolves)
          200,        // creatorFeeBps (2%)
        )
        .accounts({
          creator: creator.publicKey,
          market: marketPda,
          sideA: sideAPda,
          sideB: sideBPda,
          tokenMintA: mintA,
          tokenMintB: mintB,
          tokenVaultA: tokenVaultA,
          tokenVaultB: tokenVaultB,
          solVaultA: solVaultA,
          solVaultB: solVaultB,
          protocolFeeAccount: protocolFeeAccount.publicKey,
          config: configPda,
          metadataA: findMetadataPda(mintA),
          metadataB: findMetadataPda(mintB),
          tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })])
        .rpc();

      console.log("  initialize_market tx:", tx);

      // Verify market state
      const market = await program.account.market.fetch(marketPda);
      expect(market.authority.toString()).to.equal(creator.publicKey.toString());
      expect(market.marketId.toNumber()).to.equal(marketId.toNumber());
      expect(market.battleTaxBps).to.equal(battleTaxBps);
      expect(market.protocolFeeBps).to.equal(protocolFeeBps);
      expect(market.status).to.deep.equal({ active: {} });
      expect(market.twapSamplesCount).to.equal(0);
      expect(market.winner).to.be.null;

      // Verify sides
      const sideA = await program.account.side.fetch(sideAPda);
      expect(sideA.sideIndex).to.equal(0);
      expect(sideA.totalSupply.toNumber()).to.equal(1_000_000_000);
      expect(sideA.circulatingSupply.toNumber()).to.equal(0);

      // Verify token vaults
      const vaultA = await getAccount(provider.connection, tokenVaultA);
      expect(Number(vaultA.amount)).to.equal(1_000_000_000);
    });
  });

  describe("buy_tokens", () => {
    let buyerTokenAccountA: PublicKey;

    before(async () => {
      buyerTokenAccountA = await getAssociatedTokenAddress(mintA, creator.publicKey);
      const createAtaIx = createAssociatedTokenAccountInstruction(
        creator.publicKey, buyerTokenAccountA, creator.publicKey, mintA
      );
      const tx = new anchor.web3.Transaction().add(createAtaIx);
      await provider.sendAndConfirm(tx);
    });

    it("should buy tokens on Side A", async () => {
      const solAmount = new BN(LAMPORTS_PER_SOL); // 1 SOL
      const minTokensOut = new BN(1);

      const tx = await program.methods
        .buyTokens(0, solAmount, minTokensOut)
        .accounts({
          buyer: creator.publicKey,
          market: marketPda,
          sideAccount: sideAPda,
          tokenMint: mintA,
          tokenVault: tokenVaultA,
          buyerTokenAccount: buyerTokenAccountA,
          solVault: solVaultA,
          config: configPda,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      console.log("  buy_tokens tx:", tx);

      const buyerAccount = await getAccount(provider.connection, buyerTokenAccountA);
      expect(Number(buyerAccount.amount)).to.be.greaterThan(0);
      console.log("  tokens received:", Number(buyerAccount.amount));

      const sideA = await program.account.side.fetch(sideAPda);
      expect(sideA.circulatingSupply.toNumber()).to.be.greaterThan(0);
      expect(sideA.peakReserve.toNumber()).to.be.greaterThan(0);
      console.log("  circulating supply:", sideA.circulatingSupply.toNumber());
      console.log("  peak reserve:", sideA.peakReserve.toNumber());
    });
  });

  describe("sell_tokens", () => {
    it("should sell tokens on Side A", async () => {
      const buyerTokenAccountA = await getAssociatedTokenAddress(mintA, creator.publicKey);
      const accountBefore = await getAccount(provider.connection, buyerTokenAccountA);
      const tokensHeld = Number(accountBefore.amount);
      console.log("  tokens held before sell:", tokensHeld);

      // Sell half
      const tokenAmount = new BN(Math.floor(tokensHeld / 2));
      const minSolOut = new BN(1);

      const balBefore = await provider.connection.getBalance(creator.publicKey);

      const tx = await program.methods
        .sellTokens(0, tokenAmount, minSolOut)
        .accounts({
          seller: creator.publicKey,
          market: marketPda,
          sideAccount: sideAPda,
          tokenMint: mintA,
          tokenVault: tokenVaultA,
          sellerTokenAccount: buyerTokenAccountA,
          solVault: solVaultA,
          config: configPda,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      console.log("  sell_tokens tx:", tx);

      const accountAfter = await getAccount(provider.connection, buyerTokenAccountA);
      expect(Number(accountAfter.amount)).to.be.lessThan(tokensHeld);
      console.log("  tokens remaining:", Number(accountAfter.amount));

      const balAfter = await provider.connection.getBalance(creator.publicKey);
      console.log("  SOL gained:", balAfter - balBefore);
    });
  });

  describe("buy tokens on Side B", () => {
    let buyerTokenAccountB: PublicKey;

    before(async () => {
      buyerTokenAccountB = await getAssociatedTokenAddress(mintB, creator.publicKey);
      const createAtaIx = createAssociatedTokenAccountInstruction(
        creator.publicKey, buyerTokenAccountB, creator.publicKey, mintB
      );
      const tx = new anchor.web3.Transaction().add(createAtaIx);
      await provider.sendAndConfirm(tx);
    });

    it("should buy tokens on Side B with less SOL", async () => {
      const solAmount = new BN(LAMPORTS_PER_SOL / 2); // 0.5 SOL
      const minTokensOut = new BN(1);

      const tx = await program.methods
        .buyTokens(1, solAmount, minTokensOut)
        .accounts({
          buyer: creator.publicKey,
          market: marketPda,
          sideAccount: sideBPda,
          tokenMint: mintB,
          tokenVault: tokenVaultB,
          buyerTokenAccount: buyerTokenAccountB,
          solVault: solVaultB,
          config: configPda,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      console.log("  buy_tokens Side B tx:", tx);
      const sideB = await program.account.side.fetch(sideBPda);
      console.log("  Side B circulating:", sideB.circulatingSupply.toNumber());
    });
  });

  describe("record_twap_sample", () => {
    it("should fail if not in TWAP window", async () => {
      try {
        await program.methods
          .recordTwapSample()
          .accounts({
            cranker: creator.publicKey,
            market: marketPda,
            sideA: sideAPda,
            sideB: sideBPda,
          })
          .rpc();
        expect.fail("should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("NotInTwapWindow");
      }
    });
  });

  describe("resolve_market", () => {
    it("should fail if market has not reached deadline", async () => {
      try {
        await program.methods
          .resolveMarket()
          .accounts({
            resolver: creator.publicKey,
            market: marketPda,
            sideA: sideAPda,
            sideB: sideBPda,
            solVaultA: solVaultA,
            solVaultB: solVaultB,
            protocolFeeAccount: protocolFeeAccount.publicKey,
            creatorFeeAccount: creator.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("MarketNotExpired");
      }
    });
  });

  describe("sell_post_resolution", () => {
    it("should fail if market is not resolved", async () => {
      const buyerTokenAccountA = await getAssociatedTokenAddress(mintA, creator.publicKey);

      try {
        await program.methods
          .sellPostResolution(0, new BN(1), new BN(0))
          .accounts({
            seller: creator.publicKey,
            market: marketPda,
            sideAccount: sideAPda,
            tokenMint: mintA,
            tokenVault: tokenVaultA,
            sellerTokenAccount: buyerTokenAccountA,
            solVault: solVaultA,
            config: configPda,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        expect.fail("should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("MarketNotResolved");
      }
    });
  });

  // ---- Full lifecycle with short deadline ----
  describe("full lifecycle (short deadline)", () => {
    const shortMarketId = new BN(Math.floor(Math.random() * 10_000_000) + 30_000_000);
    let m: PublicKey;
    let sA: PublicKey, sB: PublicKey;
    let mA: PublicKey, mB: PublicKey;
    let tvA: PublicKey, tvB: PublicKey;
    let svA: PublicKey, svB: PublicKey;
    let btA: PublicKey, btB: PublicKey;

    before(async () => {
      [m] = PublicKey.findProgramAddressSync(
        [Buffer.from("market"), creator.publicKey.toBuffer(), shortMarketId.toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      [sA] = PublicKey.findProgramAddressSync([Buffer.from("side"), m.toBuffer(), Buffer.from([0])], program.programId);
      [sB] = PublicKey.findProgramAddressSync([Buffer.from("side"), m.toBuffer(), Buffer.from([1])], program.programId);
      [mA] = PublicKey.findProgramAddressSync([Buffer.from("mint"), m.toBuffer(), Buffer.from([0])], program.programId);
      [mB] = PublicKey.findProgramAddressSync([Buffer.from("mint"), m.toBuffer(), Buffer.from([1])], program.programId);
      [tvA] = PublicKey.findProgramAddressSync([Buffer.from("token_vault"), m.toBuffer(), Buffer.from([0])], program.programId);
      [tvB] = PublicKey.findProgramAddressSync([Buffer.from("token_vault"), m.toBuffer(), Buffer.from([1])], program.programId);
      [svA] = PublicKey.findProgramAddressSync([Buffer.from("sol_vault"), m.toBuffer(), Buffer.from([0])], program.programId);
      [svB] = PublicKey.findProgramAddressSync([Buffer.from("sol_vault"), m.toBuffer(), Buffer.from([1])], program.programId);

      // Pre-fund protocol fee account
      await prefundPda(protocolFeeAccount.publicKey);
    });

    it("should create a market with a very short deadline", async () => {
      const now = Math.floor(Date.now() / 1000);
      const deadline = now + 15;
      const twapWindow = 10;
      const twapInterval = 10;

      await program.methods
        .initializeMarket(
          shortMarketId,
          new BN(deadline),
          new BN(twapWindow),
          new BN(twapInterval),
          5000, // battle_tax
          100,  // protocol_fee
          0,    // no sell penalty
          new BN(0),
          curveParams,
          totalSupplyPerSide,
          "Short A",
          "SH-A",
          "",
          "Short B",
          "SH-B",
          "",
          { unlocked: {} },
          new BN(0),  // maxObservationChangePerUpdate
          0,          // minTwapSpreadBps
          0,          // creatorFeeBps
        )
        .accounts({
          creator: creator.publicKey,
          market: m, sideA: sA, sideB: sB,
          tokenMintA: mA, tokenMintB: mB,
          tokenVaultA: tvA, tokenVaultB: tvB,
          solVaultA: svA, solVaultB: svB,
          protocolFeeAccount: protocolFeeAccount.publicKey,
          config: configPda,
          metadataA: findMetadataPda(mA),
          metadataB: findMetadataPda(mB),
          tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })])
        .rpc();

      console.log("  short market created");
    });

    it("should buy tokens on both sides", async () => {
      btA = await getAssociatedTokenAddress(mA, creator.publicKey);
      btB = await getAssociatedTokenAddress(mB, creator.publicKey);

      const createAtaA = createAssociatedTokenAccountInstruction(creator.publicKey, btA, creator.publicKey, mA);
      const createAtaB = createAssociatedTokenAccountInstruction(creator.publicKey, btB, creator.publicKey, mB);
      const tx = new anchor.web3.Transaction().add(createAtaA).add(createAtaB);
      await provider.sendAndConfirm(tx);

      // Side A: 2 SOL (winner)
      await program.methods
        .buyTokens(0, new BN(2 * LAMPORTS_PER_SOL), new BN(1))
        .accounts({
          buyer: creator.publicKey, market: m, sideAccount: sA,
          tokenMint: mA, tokenVault: tvA, buyerTokenAccount: btA, solVault: svA,
          config: configPda,
          systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      // Side B: 0.5 SOL
      await program.methods
        .buyTokens(1, new BN(LAMPORTS_PER_SOL / 2), new BN(1))
        .accounts({
          buyer: creator.publicKey, market: m, sideAccount: sB,
          tokenMint: mB, tokenVault: tvB, buyerTokenAccount: btB, solVault: svB,
          config: configPda,
          systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      console.log("  bought on both sides");
    });

    it("should wait for TWAP window and record sample", async () => {
      console.log("  waiting for TWAP window...");
      await new Promise((resolve) => setTimeout(resolve, 6000));

      await program.methods
        .recordTwapSample()
        .accounts({ cranker: creator.publicKey, market: m, sideA: sA, sideB: sB })
        .rpc();

      const market = await program.account.market.fetch(m);
      expect(market.twapSamplesCount).to.equal(1);
      expect(market.status).to.deep.equal({ twapObservation: {} });
      console.log("  TWAP sample recorded");
    });

    it("should wait for deadline and resolve market", async () => {
      console.log("  waiting for deadline...");
      await new Promise((resolve) => setTimeout(resolve, 12000));

      await program.methods
        .resolveMarket()
        .accounts({
          resolver: creator.publicKey, market: m, sideA: sA, sideB: sB,
          solVaultA: svA, solVaultB: svB,
          protocolFeeAccount: protocolFeeAccount.publicKey,
          creatorFeeAccount: creator.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const market = await program.account.market.fetch(m);
      expect(market.status).to.deep.equal({ resolved: {} });
      expect(market.winner).to.equal(0); // Side A wins
      console.log("  resolved, winner:", market.winner);
      console.log("  final TWAP A:", market.finalTwapA.toNumber());
      console.log("  final TWAP B:", market.finalTwapB.toNumber());
    });

    it("should sell post-resolution on winning side", async () => {
      const accountBefore = await getAccount(provider.connection, btA);
      const tokenAmount = new BN(Number(accountBefore.amount));
      console.log("  selling", Number(accountBefore.amount), "tokens");

      const sellerBalBefore = await provider.connection.getBalance(creator.publicKey);

      await program.methods
        .sellPostResolution(0, tokenAmount, new BN(1))
        .accounts({
          seller: creator.publicKey, market: m, sideAccount: sA,
          tokenMint: mA, tokenVault: tvA, sellerTokenAccount: btA, solVault: svA,
          config: configPda,
          systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      const sellerBalAfter = await provider.connection.getBalance(creator.publicKey);
      const gained = sellerBalAfter - sellerBalBefore;
      console.log("  SOL gained from selling:", gained);
      expect(gained).to.be.greaterThan(0);

      const accountAfter = await getAccount(provider.connection, btA);
      expect(Number(accountAfter.amount)).to.equal(0);
    });
  });
});
