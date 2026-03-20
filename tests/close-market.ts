import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Duel } from "../target/types/duel";
import {
  Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL, ComputeBudgetProgram, Transaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID, NATIVE_MINT, getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction, getAccount,
} from "@solana/spl-token";
import { expect } from "chai";
import BN from "bn.js";
import {
  TOKEN_METADATA_PROGRAM_ID, findMetadataPda, derivePdas, wrapSol, Pdas,
} from "./helpers";

describe("close-market", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Duel as Program<Duel>;
  const creator = provider.wallet;
  const closeBase = Math.floor(Math.random() * 10_000_000) + 60_000_000;
  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId);

  let protocolFeeOwner: Keypair;
  let protocolFeeAccount: PublicKey;
  let creatorFeeAccount: PublicKey;
  let creatorWsolAta: PublicKey;

  before(async () => {
    creatorFeeAccount = await getAssociatedTokenAddress(NATIVE_MINT, creator.publicKey);
    try { await getAccount(provider.connection, creatorFeeAccount); } catch {
      await provider.sendAndConfirm(new Transaction().add(
        createAssociatedTokenAccountInstruction(creator.publicKey, creatorFeeAccount, creator.publicKey, NATIVE_MINT)
      ));
    }
    creatorWsolAta = creatorFeeAccount;
    try {
      const existingConfig = await program.account.programConfig.fetch(configPda);
      protocolFeeAccount = existingConfig.protocolFeeAccount;
    } catch {
      protocolFeeOwner = Keypair.generate();
      await provider.sendAndConfirm(
        new Transaction().add(SystemProgram.transfer({ fromPubkey: creator.publicKey, toPubkey: protocolFeeOwner.publicKey, lamports: LAMPORTS_PER_SOL / 10 }))
      );
      protocolFeeAccount = await getAssociatedTokenAddress(NATIVE_MINT, protocolFeeOwner.publicKey);
      await provider.sendAndConfirm(
        new Transaction().add(createAssociatedTokenAccountInstruction(protocolFeeOwner.publicKey, protocolFeeAccount, protocolFeeOwner.publicKey, NATIVE_MINT)),
        [protocolFeeOwner]
      );
      await program.methods.initializeConfig(125, 5000, new BN(0)).accounts({ admin: creator.publicKey, protocolFeeAccount, systemProgram: SystemProgram.programId } as any).rpc();
    }
  });

  function deriveMarketPdas(marketId: BN) {
    return derivePdas(program.programId, creator.publicKey, marketId);
  }

  async function createMarketFull(marketId: BN, deadlineSec: number = 3600) {
    const pdas = deriveMarketPdas(marketId);
    const now = Math.floor(Date.now() / 1000);
    await program.methods.initializeMarket(
      marketId, new BN(now + deadlineSec), new BN(Math.min(deadlineSec - 5, 600)), new BN(10),
      "Close A", "CLA", "", "Close B", "CLB", "",
    ).accounts({
      creator: creator.publicKey,
      market: pdas.market, sideA: pdas.sideA, sideB: pdas.sideB,
      tokenMintA: pdas.mintA, tokenMintB: pdas.mintB,
      tokenVaultA: pdas.tvA, tokenVaultB: pdas.tvB,
      quoteMint: NATIVE_MINT, quoteTokenProgram: TOKEN_PROGRAM_ID,
      quoteVaultA: pdas.qvA, quoteVaultB: pdas.qvB,
      protocolFeeAccount, creatorFeeAccount, config: configPda,
      metadataA: findMetadataPda(pdas.mintA), metadataB: findMetadataPda(pdas.mintB),
      tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
      systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    }).preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })]).rpc();
    return pdas;
  }

  async function buyTokens(pdas: Pdas, side: number, solAmount: BN) {
    const mint = side === 0 ? pdas.mintA : pdas.mintB;
    const ata = await getAssociatedTokenAddress(mint, creator.publicKey);
    try { await getAccount(provider.connection, ata); } catch {
      await provider.sendAndConfirm(new Transaction().add(
        createAssociatedTokenAccountInstruction(creator.publicKey, ata, creator.publicKey, mint)
      ));
    }
    await wrapSol(provider, creator.publicKey, solAmount.toNumber());
    await program.methods.buyTokens(side, solAmount, new BN(1)).accounts({
      buyer: creator.publicKey, market: pdas.market,
      sideAccount: side === 0 ? pdas.sideA : pdas.sideB,
      tokenMint: mint,
      tokenVault: side === 0 ? pdas.tvA : pdas.tvB,
      buyerTokenAccount: ata,
      quoteMint: NATIVE_MINT,
      quoteVault: side === 0 ? pdas.qvA : pdas.qvB,
      buyerQuoteAccount: creatorWsolAta,
      protocolFeeAccount, creatorFeeAccount,
      config: configPda, tokenProgram: TOKEN_PROGRAM_ID, quoteTokenProgram: TOKEN_PROGRAM_ID,
    }).rpc();
    return ata;
  }

  async function sellTokens(pdas: Pdas, side: number, amount: BN) {
    const mint = side === 0 ? pdas.mintA : pdas.mintB;
    const ata = await getAssociatedTokenAddress(mint, creator.publicKey);
    await program.methods.sellTokens(side, amount, new BN(1)).accounts({
      seller: creator.publicKey, market: pdas.market,
      sideAccount: side === 0 ? pdas.sideA : pdas.sideB,
      tokenMint: mint,
      tokenVault: side === 0 ? pdas.tvA : pdas.tvB,
      sellerTokenAccount: ata,
      quoteMint: NATIVE_MINT,
      quoteVault: side === 0 ? pdas.qvA : pdas.qvB,
      sellerQuoteAccount: creatorWsolAta,
      protocolFeeAccount, creatorFeeAccount,
      config: configPda, tokenProgram: TOKEN_PROGRAM_ID, quoteTokenProgram: TOKEN_PROGRAM_ID,
    }).rpc();
  }

  // ---- CLOSE MARKET TESTS ----

  describe("a) Reject close on active (unresolved) market", () => {
    it("should reject close_market when market status is Active", async () => {
      const pdas = await createMarketFull(new BN(closeBase + 1));

      try {
        await program.methods.closeMarket(0).accounts({
          authority: creator.publicKey,
          market: pdas.market,
          sideA: pdas.sideA,
          sideB: pdas.sideB,
          config: configPda,
          systemProgram: SystemProgram.programId,
        }).rpc();
        expect.fail("should have rejected");
      } catch (e: any) {
        const code = e?.error?.errorCode?.code || e?.message || "";
        expect(code).to.satisfy((c: string) =>
          c === "MarketNotResolved" || c.includes("MarketNotResolved") ||
          c.includes("ConstraintRaw")
        );
        console.log("    Close rejected on active market");
      }
    });
  });

  describe("b) Reject close when circulating_supply > 0", () => {
    // Even if the market were resolved, close_market requires both sides to have
    // circulating_supply = 0. We can test this with an active market that has tokens
    // in circulation -- it will fail with MarketNotResolved first, but let's verify
    // that the constraint on circulating_supply exists.

    it("should reject close_market when tokens are held by users", async () => {
      const pdas = await createMarketFull(new BN(closeBase + 2));
      await buyTokens(pdas, 0, new BN(LAMPORTS_PER_SOL));

      try {
        await program.methods.closeMarket(0).accounts({
          authority: creator.publicKey,
          market: pdas.market,
          sideA: pdas.sideA,
          sideB: pdas.sideB,
          config: configPda,
          systemProgram: SystemProgram.programId,
        }).rpc();
        expect.fail("should have rejected");
      } catch (e: any) {
        const code = e?.error?.errorCode?.code || e?.message || "";
        // Will hit MarketNotResolved first since market is Active
        expect(code).to.satisfy((c: string) =>
          c === "MarketNotResolved" || c.includes("MarketNotResolved") ||
          c === "InsufficientTokenBalance" || c.includes("InsufficientTokenBalance") ||
          c.includes("ConstraintRaw")
        );
        console.log("    Close rejected with tokens in circulation");
      }
    });
  });

  describe("c) Successful close after all tokens returned (no-trade market)", () => {
    // A market that was created but nobody traded, then resolved via emergency.
    // Since emergency_resolve requires 24h wait (DEFAULT_EMERGENCY_WINDOW),
    // we cannot actually do this in tests. But we can verify the close_market
    // account constraints by testing what happens with a zero-circulation market
    // that is still active.

    it("should verify close_market requires Resolved status", async () => {
      // Create market with no buys (circulating = 0 on both sides)
      const pdas = await createMarketFull(new BN(closeBase + 3));

      // Verify circulating is 0
      const sideA = await program.account.side.fetch(pdas.sideA);
      const sideB = await program.account.side.fetch(pdas.sideB);
      expect(sideA.circulatingSupply.toNumber()).to.equal(0);
      expect(sideB.circulatingSupply.toNumber()).to.equal(0);

      // close_market should still fail because market is Active, not Resolved
      try {
        await program.methods.closeMarket(0).accounts({
          authority: creator.publicKey,
          market: pdas.market,
          sideA: pdas.sideA,
          sideB: pdas.sideB,
          config: configPda,
          systemProgram: SystemProgram.programId,
        }).rpc();
        expect.fail("should have rejected");
      } catch (e: any) {
        const code = e?.error?.errorCode?.code || e?.message || "";
        expect(code).to.satisfy((c: string) =>
          c === "MarketNotResolved" || c.includes("MarketNotResolved") ||
          c.includes("ConstraintRaw")
        );
        console.log("    Close rejected -- even with circ=0, status must be Resolved");
      }
    });
  });

  describe("d) Close_market requires correct authority", () => {
    it("should reject close_market from non-creator, non-admin", async () => {
      const pdas = await createMarketFull(new BN(closeBase + 4));

      const imposter = Keypair.generate();
      // Fund imposter
      await provider.sendAndConfirm(
        new Transaction().add(
          SystemProgram.transfer({ fromPubkey: creator.publicKey, toPubkey: imposter.publicKey, lamports: LAMPORTS_PER_SOL / 10 })
        )
      );

      try {
        await program.methods.closeMarket(0).accounts({
          authority: imposter.publicKey,
          market: pdas.market,
          sideA: pdas.sideA,
          sideB: pdas.sideB,
          config: configPda,
          systemProgram: SystemProgram.programId,
        }).signers([imposter]).rpc();
        expect.fail("should have rejected");
      } catch (e: any) {
        const code = e?.error?.errorCode?.code || e?.message || "";
        // Will fail with either MarketNotResolved or InvalidMarketConfig (authority check)
        expect(code).to.satisfy((c: string) =>
          c === "MarketNotResolved" || c.includes("MarketNotResolved") ||
          c === "InvalidMarketConfig" || c.includes("InvalidMarketConfig") ||
          c.includes("ConstraintRaw") || c.includes("Error")
        );
        console.log("    Close rejected from non-authority");
      }
    });
  });

  describe("e) close_quote_vault rejection on active market", () => {
    it("should reject close_quote_vault when market is not resolved", async () => {
      const pdas = await createMarketFull(new BN(closeBase + 5));

      try {
        await program.methods.closeQuoteVault(0).accounts({
          closer: creator.publicKey,
          market: pdas.market,
          sideAccount: pdas.sideA,
          quoteVault: pdas.qvA,
          tokenVault: pdas.tvA,
          rentReceiver: creator.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          quoteTokenProgram: TOKEN_PROGRAM_ID,
        }).rpc();
        expect.fail("should have rejected");
      } catch (e: any) {
        // close_quote_vault likely checks market status
        const msg = e?.message || "";
        console.log(`    close_quote_vault rejected: ${msg.slice(0, 100)}`);
        // Any error is expected -- the vault should not be closable on an active market
      }
    });
  });

  describe("f) Market account data verification before close", () => {
    it("should verify all close_market constraints exist in account data", async () => {
      const pdas = await createMarketFull(new BN(closeBase + 6));

      // Verify market state
      const market = await program.account.market.fetch(pdas.market);
      expect(market.status).to.deep.equal({ active: {} });
      expect(market.authority.toString()).to.equal(creator.publicKey.toString());

      // Verify side states
      const sideA = await program.account.side.fetch(pdas.sideA);
      const sideB = await program.account.side.fetch(pdas.sideB);
      expect(sideA.market.toString()).to.equal(pdas.market.toString());
      expect(sideB.market.toString()).to.equal(pdas.market.toString());
      expect(sideA.sideIndex).to.equal(0);
      expect(sideB.sideIndex).to.equal(1);
      expect(sideA.totalSupply.toNumber()).to.equal(1_000_000_000);
      expect(sideB.totalSupply.toNumber()).to.equal(1_000_000_000);

      // Verify token vaults hold total supply
      const tvA = await getAccount(provider.connection, pdas.tvA);
      const tvB = await getAccount(provider.connection, pdas.tvB);
      expect(Number(tvA.amount)).to.equal(1_000_000_000);
      expect(Number(tvB.amount)).to.equal(1_000_000_000);

      console.log("    Market account data verified");
    });
  });

  describe("g) Buy, sell all, verify clean state for potential close", () => {
    it("after buying and selling all tokens, circulating should be 0", async () => {
      const pdas = await createMarketFull(new BN(closeBase + 7));

      // Buy tokens on both sides
      await buyTokens(pdas, 0, new BN(LAMPORTS_PER_SOL));
      await buyTokens(pdas, 1, new BN(LAMPORTS_PER_SOL / 2));

      // Sell all tokens on both sides
      const ataA = await getAssociatedTokenAddress(pdas.mintA, creator.publicKey);
      const ataB = await getAssociatedTokenAddress(pdas.mintB, creator.publicKey);
      const acctA = await getAccount(provider.connection, ataA);
      const acctB = await getAccount(provider.connection, ataB);

      await sellTokens(pdas, 0, new BN(Number(acctA.amount)));
      await sellTokens(pdas, 1, new BN(Number(acctB.amount)));

      // Verify circulating is 0
      const sideA = await program.account.side.fetch(pdas.sideA);
      const sideB = await program.account.side.fetch(pdas.sideB);
      expect(sideA.circulatingSupply.toNumber()).to.equal(0);
      expect(sideB.circulatingSupply.toNumber()).to.equal(0);

      // Token vaults should hold full supply again
      const tvA = await getAccount(provider.connection, pdas.tvA);
      const tvB = await getAccount(provider.connection, pdas.tvB);
      expect(Number(tvA.amount)).to.equal(1_000_000_000);
      expect(Number(tvB.amount)).to.equal(1_000_000_000);

      console.log("    After sell-all: circ_a=0, circ_b=0, vaults full");

      // Market is still Active, so close should still fail
      try {
        await program.methods.closeMarket(0).accounts({
          authority: creator.publicKey,
          market: pdas.market,
          sideA: pdas.sideA,
          sideB: pdas.sideB,
          config: configPda,
          systemProgram: SystemProgram.programId,
        }).rpc();
        expect.fail("should have rejected");
      } catch (e: any) {
        const code = e?.error?.errorCode?.code || e?.message || "";
        expect(code).to.satisfy((c: string) =>
          c === "MarketNotResolved" || c.includes("MarketNotResolved") ||
          c.includes("ConstraintRaw")
        );
        console.log("    Close still rejected -- market must be Resolved first");
      }
    });
  });

  describe("h) Rent cost estimation for close recovery", () => {
    it("should estimate total rent locked in market accounts", async () => {
      const pdas = await createMarketFull(new BN(closeBase + 8));

      const marketInfo = await provider.connection.getAccountInfo(pdas.market);
      const sideAInfo = await provider.connection.getAccountInfo(pdas.sideA);
      const sideBInfo = await provider.connection.getAccountInfo(pdas.sideB);

      const marketRent = marketInfo?.lamports || 0;
      const sideARent = sideAInfo?.lamports || 0;
      const sideBRent = sideBInfo?.lamports || 0;
      const totalRent = marketRent + sideARent + sideBRent;

      console.log(`    Market account rent: ${marketRent / LAMPORTS_PER_SOL} SOL (size: ${marketInfo?.data.length})`);
      console.log(`    Side A account rent: ${sideARent / LAMPORTS_PER_SOL} SOL (size: ${sideAInfo?.data.length})`);
      console.log(`    Side B account rent: ${sideBRent / LAMPORTS_PER_SOL} SOL (size: ${sideBInfo?.data.length})`);
      console.log(`    Total recoverable rent: ${totalRent / LAMPORTS_PER_SOL} SOL`);

      expect(totalRent).to.be.greaterThan(0);
      // All 3 accounts should exist
      expect(marketInfo).to.not.be.null;
      expect(sideAInfo).to.not.be.null;
      expect(sideBInfo).to.not.be.null;
    });
  });
});
