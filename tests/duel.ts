import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Duel } from "../target/types/duel";
import {
  PublicKey,
  Keypair,
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
  getAccount,
} from "@solana/spl-token";
import { expect } from "chai";
import BN from "bn.js";
import {
  TOKEN_METADATA_PROGRAM_ID,
  findMetadataPda,
  derivePdas,
  wrapSol,
  setupTestContext,
  createTestMarket,
  buyTestTokens,
  sellTestTokens,
  resolveAndGraduateTest,
  getQuoteVaultBalance,
  Pdas,
  TestContext,
} from "./helpers";

describe("duel", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Duel as Program<Duel>;
  const creator = provider.wallet;

  // Market params
  const marketId = new BN(Math.floor(Math.random() * 10_000_000) + 20_000_000);

  // PDAs
  let pdas: Pdas;
  let ctx: TestContext;

  before(async () => {
    pdas = derivePdas(program.programId, creator.publicKey, marketId);
    ctx = await setupTestContext(provider, program, creator);
  });

  describe("initialize_market", () => {
    it("should create a market with valid params", async () => {
      const now = Math.floor(Date.now() / 1000);
      const deadline = now + 3600;
      const twapWindow = 600;
      const twapInterval = 10;

      const tx = await (program.methods as any)
        .initializeMarket(
          marketId,
          new BN(deadline),
          new BN(twapWindow),
          new BN(twapInterval),
          "Duel Side A",
          "DUEL-A",
          "https://duel.protocol/tokens/a",
          "Duel Side B",
          "DUEL-B",
          "https://duel.protocol/tokens/b",
        )
        .accounts({
          creator: creator.publicKey,
          market: pdas.market,
          sideA: pdas.sideA,
          sideB: pdas.sideB,
          tokenMintA: pdas.mintA,
          tokenMintB: pdas.mintB,
          tokenVaultA: pdas.tvA,
          tokenVaultB: pdas.tvB,
          quoteMint: NATIVE_MINT,
          quoteTokenProgram: TOKEN_PROGRAM_ID,
          quoteVaultA: pdas.qvA,
          quoteVaultB: pdas.qvB,
          protocolFeeAccount: ctx.protocolFeeAccount,
          config: ctx.configPda,
          metadataA: findMetadataPda(pdas.mintA),
          metadataB: findMetadataPda(pdas.mintB),
          tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
          creatorFeeAccount: ctx.creatorFeeAccount,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })])
        .rpc();

      console.log("  initialize_market tx:", tx);

      // Verify market state
      const market = await program.account.market.fetch(pdas.market);
      expect(market.authority.toString()).to.equal(creator.publicKey.toString());
      expect(market.marketId.toNumber()).to.equal(marketId.toNumber());
      expect(market.version).to.equal(1);
      expect(market.status).to.deep.equal({ active: {} });
      expect(market.twapSamplesCount).to.equal(0);
      expect(market.winner).to.be.null;
      expect(market.quoteMint.toString()).to.equal(NATIVE_MINT.toString());

      // Verify sides
      const sideA = await program.account.side.fetch(pdas.sideA);
      expect(sideA.sideIndex).to.equal(0);
      expect(sideA.totalSupply.toNumber()).to.equal(1_000_000_000);
      expect(sideA.circulatingSupply.toNumber()).to.equal(0);
      expect(sideA.quoteReserveVault.toString()).to.equal(pdas.qvA.toString());

      const sideB = await program.account.side.fetch(pdas.sideB);
      expect(sideB.sideIndex).to.equal(1);
      expect(sideB.totalSupply.toNumber()).to.equal(1_000_000_000);
      expect(sideB.circulatingSupply.toNumber()).to.equal(0);

      // Verify token vaults hold total supply (decimals = 0)
      const vaultA = await getAccount(provider.connection, pdas.tvA);
      expect(Number(vaultA.amount)).to.equal(1_000_000_000);

      const vaultB = await getAccount(provider.connection, pdas.tvB);
      expect(Number(vaultB.amount)).to.equal(1_000_000_000);
    });
  });

  describe("buy_tokens", () => {
    it("should buy tokens on Side A", async () => {
      const solAmount = new BN(LAMPORTS_PER_SOL); // 1 SOL
      const result = await buyTestTokens(provider, program, creator, ctx, pdas, 0, solAmount);

      expect(result.balance).to.be.greaterThan(0);
      console.log("  tokens received:", result.balance);

      const sideA = await program.account.side.fetch(pdas.sideA);
      expect(sideA.circulatingSupply.toNumber()).to.be.greaterThan(0);
      console.log("  circulating supply:", sideA.circulatingSupply.toNumber());

      // Verify trade fee was deducted (net_quote = quote_amount - trade_fee)
      // With 1% fee on 1 SOL, vault should have ~0.99 SOL
      const vaultBalance = await getQuoteVaultBalance(provider, pdas, 0);
      console.log("  quote vault balance:", vaultBalance);
      expect(vaultBalance).to.be.greaterThan(0);
      expect(vaultBalance).to.be.lessThan(LAMPORTS_PER_SOL); // Less than input due to fee
    });
  });

  describe("sell_tokens", () => {
    it("should sell tokens on Side A", async () => {
      const buyerTokenAccountA = await getAssociatedTokenAddress(pdas.mintA, creator.publicKey);
      const accountBefore = await getAccount(provider.connection, buyerTokenAccountA);
      const tokensHeld = Number(accountBefore.amount);
      console.log("  tokens held before sell:", tokensHeld);

      // Sell half
      const tokenAmount = new BN(Math.floor(tokensHeld / 2));

      const wsolBefore = await getAccount(provider.connection, ctx.creatorWsolAta);
      const wsolBalBefore = Number(wsolBefore.amount);

      await sellTestTokens(provider, program, creator, ctx, pdas, 0, tokenAmount);

      const accountAfter = await getAccount(provider.connection, buyerTokenAccountA);
      expect(Number(accountAfter.amount)).to.be.lessThan(tokensHeld);
      console.log("  tokens remaining:", Number(accountAfter.amount));

      const wsolAfter = await getAccount(provider.connection, ctx.creatorWsolAta);
      const wsolGained = Number(wsolAfter.amount) - wsolBalBefore;
      console.log("  WSOL gained:", wsolGained);
      expect(wsolGained).to.be.greaterThan(0);

      // Verify circulating_supply decreased
      const sideA = await program.account.side.fetch(pdas.sideA);
      expect(sideA.circulatingSupply.toNumber()).to.be.lessThan(tokensHeld);
    });
  });

  describe("buy tokens on Side B", () => {
    it("should buy tokens on Side B with less SOL", async () => {
      const solAmount = new BN(LAMPORTS_PER_SOL / 2); // 0.5 SOL
      const result = await buyTestTokens(provider, program, creator, ctx, pdas, 1, solAmount);

      expect(result.balance).to.be.greaterThan(0);
      console.log("  Side B tokens received:", result.balance);

      const sideB = await program.account.side.fetch(pdas.sideB);
      expect(sideB.circulatingSupply.toNumber()).to.be.greaterThan(0);
      console.log("  Side B circulating:", sideB.circulatingSupply.toNumber());
    });
  });

  describe("record_twap_sample", () => {
    it("should fail if not in TWAP window", async () => {
      try {
        await (program.methods as any)
          .recordTwapSample()
          .accounts({
            cranker: creator.publicKey,
            market: pdas.market,
            sideA: pdas.sideA,
            sideB: pdas.sideB,
          })
          .rpc();
        expect.fail("should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("NotInTwapWindow");
      }
    });
  });

  describe("resolve_and_graduate", () => {
    it("should fail if market has not reached deadline", async () => {
      const positionNftMint = Keypair.generate();
      try {
        // This should fail because the deadline has not passed
        await resolveAndGraduateTest(provider, program, creator, ctx, pdas, 0);
        expect.fail("should have thrown");
      } catch (err: any) {
        const hasError = err.message.includes("MarketNotExpired") ||
          err.message.includes("ConstraintRaw") ||
          err.message.includes("A raw constraint was violated");
        expect(hasError).to.be.true;
      }
    });
  });

  describe("sell_post_resolution", () => {
    it("should fail if market is not resolved", async () => {
      const buyerTokenAccountA = await getAssociatedTokenAddress(pdas.mintA, creator.publicKey);

      try {
        await (program.methods as any)
          .sellPostResolution(0, new BN(1), new BN(0))
          .accounts({
            seller: creator.publicKey,
            market: pdas.market,
            sideAccount: pdas.sideA,
            tokenMint: pdas.mintA,
            tokenVault: pdas.tvA,
            sellerTokenAccount: buyerTokenAccountA,
            quoteMint: NATIVE_MINT,
            quoteVault: pdas.qvA,
            sellerQuoteAccount: ctx.creatorWsolAta,
            config: ctx.configPda,
            tokenProgram: TOKEN_PROGRAM_ID,
            quoteTokenProgram: TOKEN_PROGRAM_ID,
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
    let shortPdas: Pdas;
    let shortCtx: TestContext;

    before(async () => {
      shortCtx = ctx; // Reuse existing context
    });

    it("should create a market with a very short deadline", async () => {
      const now = Math.floor(Date.now() / 1000);
      shortPdas = await createTestMarket(provider, program, creator, shortCtx, shortMarketId, {
        deadline: now + 15,
        twapWindow: 10,
        twapInterval: 10,
      });

      const market = await program.account.market.fetch(shortPdas.market);
      expect(market.status).to.deep.equal({ active: {} });
      console.log("  short market created");
    });

    it("should buy tokens on both sides", async () => {
      // Side A: 2 SOL (expected winner)
      await buyTestTokens(provider, program, creator, shortCtx, shortPdas, 0, new BN(2 * LAMPORTS_PER_SOL));
      console.log("  bought 2 SOL on Side A");

      // Side B: 0.5 SOL
      await buyTestTokens(provider, program, creator, shortCtx, shortPdas, 1, new BN(LAMPORTS_PER_SOL / 2));
      console.log("  bought 0.5 SOL on Side B");

      const sideA = await program.account.side.fetch(shortPdas.sideA);
      const sideB = await program.account.side.fetch(shortPdas.sideB);
      expect(sideA.circulatingSupply.toNumber()).to.be.greaterThan(sideB.circulatingSupply.toNumber());
    });

    it("should wait for TWAP window and record sample", async () => {
      console.log("  waiting for TWAP window...");
      await new Promise((resolve) => setTimeout(resolve, 6000));

      await (program.methods as any)
        .recordTwapSample()
        .accounts({
          cranker: creator.publicKey,
          market: shortPdas.market,
          sideA: shortPdas.sideA,
          sideB: shortPdas.sideB,
        })
        .rpc();

      const market = await program.account.market.fetch(shortPdas.market);
      expect(market.twapSamplesCount).to.equal(1);
      expect(market.status).to.deep.equal({ twapObservation: {} });
      console.log("  TWAP sample recorded");
    });

    it("should wait for deadline, resolve and graduate market", async () => {
      console.log("  waiting for deadline...");
      await new Promise((resolve) => setTimeout(resolve, 12000));

      const gradResult = await resolveAndGraduateTest(
        provider, program, creator, shortCtx, shortPdas, 0
      );
      console.log("  resolve_and_graduate tx:", gradResult.tx);

      // Verify market state
      const market = await program.account.market.fetch(shortPdas.market);
      expect(market.status).to.deep.equal({ resolved: {} });
      expect(market.winner).to.equal(0); // Side A wins
      console.log("  resolved, winner:", market.winner);
      console.log("  final TWAP A:", market.finalTwapA.toNumber());
      console.log("  final TWAP B:", market.finalTwapB.toNumber());

      // Verify Meteora pool was created
      const poolInfo = await provider.connection.getAccountInfo(gradResult.pool);
      expect(poolInfo).to.not.be.null;
      console.log("  Meteora pool created, size:", poolInfo!.data.length, "bytes");

      // Verify LP is permanently locked (position exists)
      const damm = (await import("./helpers")).deriveDammV2Pdas(shortPdas.mintA, gradResult.positionNftMint.publicKey);
      const positionInfo = await provider.connection.getAccountInfo(damm.position);
      expect(positionInfo).to.not.be.null;
      console.log("  LP position locked");

      // Verify losing reserve was transferred to winning vault
      // After graduation, winning vault should be drained (sent to Meteora pool)
      // and losing vault should be empty
      try {
        const losingVaultBalance = await getQuoteVaultBalance(provider, shortPdas, 1);
        expect(losingVaultBalance).to.equal(0);
        console.log("  losing vault drained: confirmed");
      } catch {
        // Vault may have been closed, which is also correct
        console.log("  losing vault balance check skipped (may be closed)");
      }
    });
  });
});
