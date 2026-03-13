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

describe("duel - edge cases & security", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Duel as Program<Duel>;
  const creator = provider.wallet;

  const curveParams = { a: new BN(1_000_000), n: 1, b: new BN(1_000) };
  const totalSupply = new BN(1_000_000_000);
  const edgeBase = Math.floor(Math.random() * 10_000_000) + 40_000_000;

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );

  let protocolFeeOwner: Keypair;
  let protocolFeeAccount: PublicKey;
  let creatorFeeAccount: PublicKey;
  let creatorWsolAta: PublicKey;

  before(async () => {
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

    try {
      const existingConfig = await program.account.programConfig.fetch(configPda);
      protocolFeeAccount = existingConfig.protocolFeeAccount;
    } catch {
      protocolFeeOwner = Keypair.generate();
      const fundTx = new Transaction().add(
        SystemProgram.transfer({ fromPubkey: creator.publicKey, toPubkey: protocolFeeOwner.publicKey, lamports: LAMPORTS_PER_SOL / 10 })
      );
      await provider.sendAndConfirm(fundTx);
      protocolFeeAccount = await getAssociatedTokenAddress(NATIVE_MINT, protocolFeeOwner.publicKey);
      await provider.sendAndConfirm(
        new Transaction().add(createAssociatedTokenAccountInstruction(protocolFeeOwner.publicKey, protocolFeeAccount, protocolFeeOwner.publicKey, NATIVE_MINT)),
        [protocolFeeOwner]
      );
      await program.methods
        .initializeConfig(125, new BN(0))
        .accounts({ admin: creator.publicKey, protocolFeeAccount, systemProgram: SystemProgram.programId } as any)
        .rpc();
    }
  });

  function deriveMarketPdas(marketId: BN) {
    return derivePdas(program.programId, creator.publicKey, marketId);
  }

  async function createMarket(
    marketId: BN,
    overrides?: {
      deadline?: number;
      twapWindow?: number;
      twapInterval?: number;
      battleTaxBps?: number;
      protocolFeeBps?: number;
      sellPenaltyMaxBps?: number;
      protectionActivationOffset?: number;
    }
  ) {
    const now = Math.floor(Date.now() / 1000);
    const opts = {
      deadline: now + 3600,
      twapWindow: 600,
      twapInterval: 10,
      battleTaxBps: 5000,
      protocolFeeBps: 100,
      sellPenaltyMaxBps: 1500,
      protectionActivationOffset: 300,
      ...overrides,
    };

    const pdas = deriveMarketPdas(marketId);

    await program.methods
      .initializeMarket(
        marketId,
        new BN(opts.deadline),
        new BN(opts.twapWindow),
        new BN(opts.twapInterval),
        opts.battleTaxBps,
        opts.protocolFeeBps,
        opts.sellPenaltyMaxBps,
        new BN(opts.protectionActivationOffset),
        curveParams,
        totalSupply,
        "Edge A", "EA", "",
        "Edge B", "EB", "",
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

  async function buyTokens(pdas: Pdas, side: number, solAmount: BN) {
    const mint = side === 0 ? pdas.mintA : pdas.mintB;
    const ata = await getAssociatedTokenAddress(mint, creator.publicKey);
    try {
      await getAccount(provider.connection, ata);
    } catch {
      const ix = createAssociatedTokenAccountInstruction(creator.publicKey, ata, creator.publicKey, mint);
      await provider.sendAndConfirm(new Transaction().add(ix));
    }

    await wrapSol(provider, creator.publicKey, solAmount.toNumber());

    await program.methods
      .buyTokens(side, solAmount, new BN(1))
      .accounts({
        buyer: creator.publicKey, market: pdas.market,
        sideAccount: side === 0 ? pdas.sideA : pdas.sideB,
        tokenMint: mint,
        tokenVault: side === 0 ? pdas.tvA : pdas.tvB,
        buyerTokenAccount: ata,
        quoteMint: NATIVE_MINT,
        quoteVault: side === 0 ? pdas.qvA : pdas.qvB,
        buyerQuoteAccount: creatorWsolAta,
        config: configPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        quoteTokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    return ata;
  }

  async function resolveMarket(pdas: Pdas) {
    await program.methods.resolveMarket()
      .accounts({
        resolver: creator.publicKey, market: pdas.market,
        sideA: pdas.sideA, sideB: pdas.sideB,
        quoteMint: NATIVE_MINT,
        quoteVaultA: pdas.qvA, quoteVaultB: pdas.qvB,
        protocolFeeAccount: protocolFeeAccount,
        creatorFeeAccount: creatorFeeAccount,
        quoteTokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
  }

  // ---- EDGE CASE TESTS ----

  describe("invalid side index", () => {
    let m: Pdas;

    before(async () => {
      m = await createMarket(new BN(edgeBase + 0));
    });

    it("should reject buy with side = 2", async () => {
      const ata = await getAssociatedTokenAddress(m.mintA, creator.publicKey);
      try { await getAccount(provider.connection, ata); } catch {
        const ix = createAssociatedTokenAccountInstruction(creator.publicKey, ata, creator.publicKey, m.mintA);
        await provider.sendAndConfirm(new Transaction().add(ix));
      }

      await wrapSol(provider, creator.publicKey, LAMPORTS_PER_SOL);

      try {
        await program.methods
          .buyTokens(2, new BN(LAMPORTS_PER_SOL), new BN(1))
          .accounts({
            buyer: creator.publicKey, market: m.market, sideAccount: m.sideA,
            tokenMint: m.mintA, tokenVault: m.tvA, buyerTokenAccount: ata,
            quoteMint: NATIVE_MINT, quoteVault: m.qvA, buyerQuoteAccount: creatorWsolAta,
            config: configPda, tokenProgram: TOKEN_PROGRAM_ID, quoteTokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        expect.fail("should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("InvalidSide");
      }
    });
  });

  describe("zero amount operations", () => {
    let m: Pdas;

    before(async () => {
      m = await createMarket(new BN(edgeBase + 1));
    });

    it("should reject buy with 0 SOL", async () => {
      const ata = await getAssociatedTokenAddress(m.mintA, creator.publicKey);
      try { await getAccount(provider.connection, ata); } catch {
        const ix = createAssociatedTokenAccountInstruction(creator.publicKey, ata, creator.publicKey, m.mintA);
        await provider.sendAndConfirm(new Transaction().add(ix));
      }

      try {
        await program.methods
          .buyTokens(0, new BN(0), new BN(0))
          .accounts({
            buyer: creator.publicKey, market: m.market, sideAccount: m.sideA,
            tokenMint: m.mintA, tokenVault: m.tvA, buyerTokenAccount: ata,
            quoteMint: NATIVE_MINT, quoteVault: m.qvA, buyerQuoteAccount: creatorWsolAta,
            config: configPda, tokenProgram: TOKEN_PROGRAM_ID, quoteTokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        expect.fail("should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("InsufficientSolAmount");
      }
    });

    it("should reject sell with 0 tokens", async () => {
      const ata = await getAssociatedTokenAddress(m.mintA, creator.publicKey);

      try {
        await program.methods
          .sellTokens(0, new BN(0), new BN(0))
          .accounts({
            seller: creator.publicKey, market: m.market, sideAccount: m.sideA,
            tokenMint: m.mintA, tokenVault: m.tvA, sellerTokenAccount: ata,
            quoteMint: NATIVE_MINT, quoteVault: m.qvA, sellerQuoteAccount: creatorWsolAta,
            config: configPda, tokenProgram: TOKEN_PROGRAM_ID, quoteTokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        expect.fail("should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("InsufficientTokenBalance");
      }
    });
  });

  describe("double resolve attack", () => {
    let m: Pdas;

    before(async () => {
      const now = Math.floor(Date.now() / 1000);
      m = await createMarket(new BN(edgeBase + 2), {
        deadline: now + 12,
        twapWindow: 8,
        twapInterval: 10,
        sellPenaltyMaxBps: 0,
        protectionActivationOffset: 0,
      });

      await buyTokens(m, 0, new BN(2 * LAMPORTS_PER_SOL));
      await buyTokens(m, 1, new BN(LAMPORTS_PER_SOL));

      await new Promise((r) => setTimeout(r, 5000));
      await program.methods.recordTwapSample()
        .accounts({ cranker: creator.publicKey, market: m.market, sideA: m.sideA, sideB: m.sideB })
        .rpc();

      await new Promise((r) => setTimeout(r, 10000));
      await resolveMarket(m);
    });

    it("should reject second resolve", async () => {
      try {
        await resolveMarket(m);
        expect.fail("should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("MarketAlreadyResolved");
      }
    });

    it("should reject buy after resolution", async () => {
      const ata = await getAssociatedTokenAddress(m.mintA, creator.publicKey);
      await wrapSol(provider, creator.publicKey, LAMPORTS_PER_SOL);
      try {
        await program.methods
          .buyTokens(0, new BN(LAMPORTS_PER_SOL), new BN(1))
          .accounts({
            buyer: creator.publicKey, market: m.market, sideAccount: m.sideA,
            tokenMint: m.mintA, tokenVault: m.tvA, buyerTokenAccount: ata,
            quoteMint: NATIVE_MINT, quoteVault: m.qvA, buyerQuoteAccount: creatorWsolAta,
            config: configPda, tokenProgram: TOKEN_PROGRAM_ID, quoteTokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        expect.fail("should have thrown");
      } catch (err: any) {
        expect(["MarketExpired", "MarketAlreadyResolved"]).to.include(err.error.errorCode.code);
      }
    });

    it("should reject sell_tokens (not sell_post_resolution) after resolution", async () => {
      const ata = await getAssociatedTokenAddress(m.mintA, creator.publicKey);
      try {
        await program.methods
          .sellTokens(0, new BN(1), new BN(0))
          .accounts({
            seller: creator.publicKey, market: m.market, sideAccount: m.sideA,
            tokenMint: m.mintA, tokenVault: m.tvA, sellerTokenAccount: ata,
            quoteMint: NATIVE_MINT, quoteVault: m.qvA, sellerQuoteAccount: creatorWsolAta,
            config: configPda, tokenProgram: TOKEN_PROGRAM_ID, quoteTokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        expect.fail("should have thrown");
      } catch (err: any) {
        expect(["MarketExpired", "MarketAlreadyResolved"]).to.include(err.error.errorCode.code);
      }
    });
  });

  describe("sell all tokens", () => {
    let m: Pdas;
    let ataA: PublicKey;

    before(async () => {
      m = await createMarket(new BN(edgeBase + 3));
      ataA = await buyTokens(m, 0, new BN(LAMPORTS_PER_SOL));
    });

    it("should sell all tokens and leave zero balance", async () => {
      const account = await getAccount(provider.connection, ataA);
      const allTokens = new BN(Number(account.amount));

      await program.methods
        .sellTokens(0, allTokens, new BN(1))
        .accounts({
          seller: creator.publicKey, market: m.market, sideAccount: m.sideA,
          tokenMint: m.mintA, tokenVault: m.tvA, sellerTokenAccount: ataA,
          quoteMint: NATIVE_MINT, quoteVault: m.qvA, sellerQuoteAccount: creatorWsolAta,
          config: configPda, tokenProgram: TOKEN_PROGRAM_ID, quoteTokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      const accountAfter = await getAccount(provider.connection, ataA);
      expect(Number(accountAfter.amount)).to.equal(0);

      const side = await program.account.side.fetch(m.sideA);
      expect(side.circulatingSupply.toNumber()).to.equal(0);
    });

    it("should still allow buying after all tokens sold", async () => {
      await wrapSol(provider, creator.publicKey, LAMPORTS_PER_SOL / 2);
      await program.methods
        .buyTokens(0, new BN(LAMPORTS_PER_SOL / 2), new BN(1))
        .accounts({
          buyer: creator.publicKey, market: m.market, sideAccount: m.sideA,
          tokenMint: m.mintA, tokenVault: m.tvA, buyerTokenAccount: ataA,
          quoteMint: NATIVE_MINT, quoteVault: m.qvA, buyerQuoteAccount: creatorWsolAta,
          config: configPda, tokenProgram: TOKEN_PROGRAM_ID, quoteTokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      const accountAfter = await getAccount(provider.connection, ataA);
      expect(Number(accountAfter.amount)).to.be.greaterThan(0);
    });
  });

  describe("slippage protection", () => {
    let m: Pdas;

    before(async () => {
      m = await createMarket(new BN(edgeBase + 4));
    });

    it("should reject buy when min_tokens_out not met", async () => {
      const ata = await getAssociatedTokenAddress(m.mintA, creator.publicKey);
      try { await getAccount(provider.connection, ata); } catch {
        const ix = createAssociatedTokenAccountInstruction(creator.publicKey, ata, creator.publicKey, m.mintA);
        await provider.sendAndConfirm(new Transaction().add(ix));
      }

      await wrapSol(provider, creator.publicKey, 1000);

      try {
        await program.methods
          .buyTokens(0, new BN(1000), new BN(999_999_999))
          .accounts({
            buyer: creator.publicKey, market: m.market, sideAccount: m.sideA,
            tokenMint: m.mintA, tokenVault: m.tvA, buyerTokenAccount: ata,
            quoteMint: NATIVE_MINT, quoteVault: m.qvA, buyerQuoteAccount: creatorWsolAta,
            config: configPda, tokenProgram: TOKEN_PROGRAM_ID, quoteTokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        expect.fail("should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("SlippageExceeded");
      }
    });
  });

  describe("invalid market config", () => {
    it("should reject battle_tax_bps > 10000", async () => {
      try {
        await createMarket(new BN(edgeBase + 100), { battleTaxBps: 10001 });
        expect.fail("should have thrown");
      } catch (err: any) {
        const code = err?.error?.errorCode?.code || err?.message || "";
        expect(code).to.satisfy((c: string) =>
          c === "InvalidMarketConfig" || c.includes("InvalidMarketConfig") || c.includes("custom program error")
        );
      }
    });

    it("should reject protocol_fee_bps > 500", async () => {
      try {
        await createMarket(new BN(edgeBase + 101), { protocolFeeBps: 600 });
        expect.fail("should have thrown");
      } catch (err: any) {
        const code = err?.error?.errorCode?.code || err?.message || "";
        expect(code).to.satisfy((c: string) =>
          c === "InvalidMarketConfig" || c.includes("InvalidMarketConfig") || c.includes("custom program error")
        );
      }
    });

    it("should reject sell_penalty_max_bps > 3000", async () => {
      try {
        await createMarket(new BN(edgeBase + 102), { sellPenaltyMaxBps: 4000 });
        expect.fail("should have thrown");
      } catch (err: any) {
        const code = err?.error?.errorCode?.code || err?.message || "";
        expect(code).to.satisfy((c: string) =>
          c === "InvalidMarketConfig" || c.includes("InvalidMarketConfig") || c.includes("custom program error")
        );
      }
    });

    it("should reject deadline in the past", async () => {
      try {
        await createMarket(new BN(edgeBase + 103), { deadline: 1000 });
        expect.fail("should have thrown");
      } catch (err: any) {
        const code = err?.error?.errorCode?.code || err?.message || "";
        expect(code).to.satisfy((c: string) =>
          c === "InvalidMarketConfig" || c.includes("InvalidMarketConfig") || c.includes("custom program error")
        );
      }
    });
  });

  describe("TWAP sample interval enforcement", () => {
    let m: Pdas;

    before(async () => {
      const now = Math.floor(Date.now() / 1000);
      m = await createMarket(new BN(edgeBase + 5), {
        deadline: now + 20,
        twapWindow: 15,
        twapInterval: 10,
        sellPenaltyMaxBps: 0,
        protectionActivationOffset: 0,
      });
      await buyTokens(m, 0, new BN(LAMPORTS_PER_SOL));
      await buyTokens(m, 1, new BN(LAMPORTS_PER_SOL / 2));

      await new Promise((r) => setTimeout(r, 6000));
      await program.methods.recordTwapSample()
        .accounts({ cranker: creator.publicKey, market: m.market, sideA: m.sideA, sideB: m.sideB })
        .rpc();
    });

    it("should reject second sample before interval elapsed", async () => {
      try {
        await program.methods.recordTwapSample()
          .accounts({ cranker: creator.publicKey, market: m.market, sideA: m.sideA, sideB: m.sideB })
          .rpc();
        expect.fail("should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("TwapSampleTooEarly");
      }
    });
  });

  describe("sell post-resolution on losing side", () => {
    let m: Pdas;
    let atB: PublicKey;

    before(async () => {
      const now = Math.floor(Date.now() / 1000);
      m = await createMarket(new BN(edgeBase + 6), {
        deadline: now + 12,
        twapWindow: 8,
        twapInterval: 10,
        sellPenaltyMaxBps: 0,
        protectionActivationOffset: 0,
        battleTaxBps: 5000,
      });

      await buyTokens(m, 0, new BN(2 * LAMPORTS_PER_SOL));
      atB = await buyTokens(m, 1, new BN(LAMPORTS_PER_SOL));

      await new Promise((r) => setTimeout(r, 5000));
      await program.methods.recordTwapSample()
        .accounts({ cranker: creator.publicKey, market: m.market, sideA: m.sideA, sideB: m.sideB })
        .rpc();
      await new Promise((r) => setTimeout(r, 10000));
      await resolveMarket(m);
    });

    it("should allow losing side to sell post-resolution (partial, at reduced value)", async () => {
      const accountBefore = await getAccount(provider.connection, atB);
      const totalTokens = Number(accountBefore.amount);
      const tokenAmount = new BN(Math.floor(totalTokens / 10));

      const wsolBefore = await getAccount(provider.connection, creatorWsolAta);
      const wsolBalBefore = Number(wsolBefore.amount);

      await program.methods
        .sellPostResolution(1, tokenAmount, new BN(0))
        .accounts({
          seller: creator.publicKey, market: m.market, sideAccount: m.sideB,
          tokenMint: m.mintB, tokenVault: m.tvB, sellerTokenAccount: atB,
          quoteMint: NATIVE_MINT, quoteVault: m.qvB, sellerQuoteAccount: creatorWsolAta,
          config: configPda, tokenProgram: TOKEN_PROGRAM_ID, quoteTokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      const wsolAfter = await getAccount(provider.connection, creatorWsolAta);
      const gained = Number(wsolAfter.amount) - wsolBalBefore;
      console.log("  losing side WSOL recovered (partial):", gained);
      expect(gained).to.be.greaterThan(0);
    });
  });
});
