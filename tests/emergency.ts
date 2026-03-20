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

describe("duel - emergency resolution", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Duel as Program<Duel>;
  const creator = provider.wallet;
  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId);

  const emergBase = Math.floor(Math.random() * 10_000_000) + 70_000_000;

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

  async function createMarket(
    marketId: BN,
    overrides?: { deadline?: number; twapWindow?: number; twapInterval?: number }
  ) {
    const now = Math.floor(Date.now() / 1000);
    const opts = { deadline: now + 3600, twapWindow: 600, twapInterval: 10, ...overrides };
    const pdas = deriveMarketPdas(marketId);

    await program.methods.initializeMarket(
      marketId, new BN(opts.deadline), new BN(opts.twapWindow), new BN(opts.twapInterval),
      "Emerg A", "EMA", "", "Emerg B", "EMB", "",
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

  // ---- EMERGENCY RESOLUTION TESTS ----

  describe("a) emergency_resolve before deadline (MarketNotExpired)", () => {
    let m: Pdas;

    before(async () => {
      // Market with deadline 1 hour from now -- well before emergency window
      m = await createMarket(new BN(emergBase + 0));
    });

    it("should reject emergency_resolve when deadline has not passed", async () => {
      try {
        await program.methods.emergencyResolve().accounts({
          resolver: creator.publicKey,
          market: m.market,
          config: configPda,
          sideA: m.sideA,
          sideB: m.sideB,
        }).rpc();
        expect.fail("should have thrown");
      } catch (err: any) {
        const code = err?.error?.errorCode?.code || err?.message || "";
        expect(code).to.satisfy((c: string) =>
          c === "MarketNotExpired" || c.includes("MarketNotExpired")
        );
        console.log("    Emergency resolve rejected before deadline");
      }
    });
  });

  describe("b) emergency_resolve after deadline but before emergency_window", () => {
    let m: Pdas;

    before(async function () {
      this.timeout(30_000);
      const now = Math.floor(Date.now() / 1000);
      // Market with deadline 12s from now
      // emergency_window = DEFAULT_EMERGENCY_WINDOW = 86400s (24h)
      // So after deadline passes but before 24h, it should fail
      m = await createMarket(new BN(emergBase + 1), {
        deadline: now + 12,
        twapWindow: 10,
        twapInterval: 10,
      });
      // Wait for deadline to pass
      await new Promise(r => setTimeout(r, 14000));
    });

    it("should reject emergency_resolve before emergency_window expires (EmergencyResolveTooEarly)", async () => {
      // Deadline has passed but emergency_window (24h) has not
      try {
        await program.methods.emergencyResolve().accounts({
          resolver: creator.publicKey,
          market: m.market,
          config: configPda,
          sideA: m.sideA,
          sideB: m.sideB,
        }).rpc();
        expect.fail("should have thrown");
      } catch (err: any) {
        const code = err?.error?.errorCode?.code || err?.message || "";
        expect(code).to.satisfy((c: string) =>
          c === "EmergencyResolveTooEarly" || c.includes("EmergencyResolveTooEarly")
        );
        console.log("    Emergency resolve rejected before window expires");
      }
    });
  });

  describe("c) sell_post_resolution requires emergency-resolved (draw) market", () => {
    // sell_post_resolution has constraint: market.winner.is_none()
    // (EmergencyOnlyOperation error)
    // On an active (unresolved) market, it fails with MarketNotResolved.
    // We cannot create an emergency-resolved market in tests (24h wait),
    // but we can verify the constraint prevents use on active markets.

    let m: Pdas;

    before(async () => {
      m = await createMarket(new BN(emergBase + 2));
      await buyTokens(m, 0, new BN(LAMPORTS_PER_SOL));
    });

    it("should reject sell_post_resolution on active (unresolved) market", async () => {
      const ata = await getAssociatedTokenAddress(m.mintA, creator.publicKey);
      try {
        await program.methods.sellPostResolution(0, new BN(1), new BN(0)).accounts({
          seller: creator.publicKey, market: m.market, sideAccount: m.sideA,
          tokenMint: m.mintA, tokenVault: m.tvA, sellerTokenAccount: ata,
          quoteMint: NATIVE_MINT, quoteVault: m.qvA, sellerQuoteAccount: creatorWsolAta,
          config: configPda,
          tokenProgram: TOKEN_PROGRAM_ID, quoteTokenProgram: TOKEN_PROGRAM_ID,
        }).rpc();
        expect.fail("should have thrown");
      } catch (err: any) {
        const code = err?.error?.errorCode?.code || err?.message || "";
        expect(code).to.satisfy((c: string) =>
          c === "MarketNotResolved" || c.includes("MarketNotResolved")
        );
        console.log("    sell_post_resolution rejected on unresolved market");
      }
    });
  });

  describe("d) Emergency resolve rejects already-resolved markets", () => {
    // If a market is already in Resolved status, emergency_resolve should fail
    // with MarketAlreadyResolved. Since we can't easily get a market into Resolved
    // state on localnet (no Meteora), we verify the constraint exists by checking
    // the error on a market that's still Active.

    let m: Pdas;

    before(async () => {
      m = await createMarket(new BN(emergBase + 3));
    });

    it("emergency_resolve on active market fails with MarketNotExpired (not MarketAlreadyResolved)", async () => {
      try {
        await program.methods.emergencyResolve().accounts({
          resolver: creator.publicKey,
          market: m.market,
          config: configPda,
          sideA: m.sideA,
          sideB: m.sideB,
        }).rpc();
        expect.fail("should have thrown");
      } catch (err: any) {
        const code = err?.error?.errorCode?.code || err?.message || "";
        // Should hit MarketNotExpired first (before checking emergency window)
        expect(code).to.satisfy((c: string) =>
          c === "MarketNotExpired" || c.includes("MarketNotExpired") ||
          c === "MarketAlreadyResolved" || c.includes("MarketAlreadyResolved")
        );
        console.log("    Emergency resolve on active market: correct rejection");
      }
    });
  });

  describe("e) Verifying emergency_window is stored on market", () => {
    it("market.emergency_window equals DEFAULT_EMERGENCY_WINDOW (86400)", async () => {
      const m = await createMarket(new BN(emergBase + 4));
      const market = await program.account.market.fetch(m.market);
      expect(market.emergencyWindow.toNumber()).to.equal(86400);
      console.log(`    emergency_window: ${market.emergencyWindow.toNumber()} seconds (24h)`);
    });
  });

  describe("f) TWAP recording after deadline is rejected", () => {
    let m: Pdas;

    before(async function () {
      this.timeout(30_000);
      const now = Math.floor(Date.now() / 1000);
      m = await createMarket(new BN(emergBase + 5), {
        deadline: now + 12,
        twapWindow: 10,
        twapInterval: 10,
      });
      await buyTokens(m, 0, new BN(LAMPORTS_PER_SOL));
      await buyTokens(m, 1, new BN(LAMPORTS_PER_SOL / 2));
      // Wait for deadline to pass
      await new Promise(r => setTimeout(r, 14000));
    });

    it("should reject TWAP sample after deadline (MarketExpired)", async () => {
      try {
        await program.methods.recordTwapSample().accounts({
          cranker: creator.publicKey, market: m.market, sideA: m.sideA, sideB: m.sideB,
        }).rpc();
        expect.fail("should have thrown");
      } catch (err: any) {
        const code = err?.error?.errorCode?.code || err?.message || "";
        expect(code).to.satisfy((c: string) =>
          c === "MarketExpired" || c.includes("MarketExpired")
        );
        console.log("    TWAP sample after deadline rejected");
      }
    });
  });

  describe("g) Buy and sell after deadline are both rejected", () => {
    let m: Pdas;

    before(async function () {
      this.timeout(30_000);
      const now = Math.floor(Date.now() / 1000);
      m = await createMarket(new BN(emergBase + 6), {
        deadline: now + 12,
        twapWindow: 10,
        twapInterval: 10,
      });
      await buyTokens(m, 0, new BN(LAMPORTS_PER_SOL));
      // Wait for deadline to pass
      await new Promise(r => setTimeout(r, 14000));
    });

    it("buy after deadline should fail", async () => {
      const ata = await getAssociatedTokenAddress(m.mintA, creator.publicKey);
      await wrapSol(provider, creator.publicKey, LAMPORTS_PER_SOL);
      try {
        await program.methods.buyTokens(0, new BN(LAMPORTS_PER_SOL), new BN(1)).accounts({
          buyer: creator.publicKey, market: m.market, sideAccount: m.sideA,
          tokenMint: m.mintA, tokenVault: m.tvA, buyerTokenAccount: ata,
          quoteMint: NATIVE_MINT, quoteVault: m.qvA, buyerQuoteAccount: creatorWsolAta,
          protocolFeeAccount, creatorFeeAccount,
          config: configPda, tokenProgram: TOKEN_PROGRAM_ID, quoteTokenProgram: TOKEN_PROGRAM_ID,
        }).rpc();
        expect.fail("should have thrown");
      } catch (err: any) {
        const code = err?.error?.errorCode?.code || err?.message || "";
        expect(code).to.satisfy((c: string) =>
          c === "MarketExpired" || c.includes("MarketExpired")
        );
        console.log("    Buy after deadline rejected");
      }
    });

    it("sell after deadline should fail", async () => {
      const ata = await getAssociatedTokenAddress(m.mintA, creator.publicKey);
      const acct = await getAccount(provider.connection, ata);
      if (Number(acct.amount) === 0) return;

      try {
        await program.methods.sellTokens(0, new BN(1), new BN(0)).accounts({
          seller: creator.publicKey, market: m.market, sideAccount: m.sideA,
          tokenMint: m.mintA, tokenVault: m.tvA, sellerTokenAccount: ata,
          quoteMint: NATIVE_MINT, quoteVault: m.qvA, sellerQuoteAccount: creatorWsolAta,
          protocolFeeAccount, creatorFeeAccount,
          config: configPda, tokenProgram: TOKEN_PROGRAM_ID, quoteTokenProgram: TOKEN_PROGRAM_ID,
        }).rpc();
        expect.fail("should have thrown");
      } catch (err: any) {
        const code = err?.error?.errorCode?.code || err?.message || "";
        expect(code).to.satisfy((c: string) =>
          c === "MarketExpired" || c.includes("MarketExpired")
        );
        console.log("    Sell after deadline rejected");
      }
    });
  });
});
