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

describe("duel - edge cases & security", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Duel as Program<Duel>;
  const creator = provider.wallet;

  const curveParams = { a: new BN(1_000_000), n: 1, b: new BN(1_000) };
  const totalSupply = new BN(1_000_000_000);
  const protocolFeeAccount = Keypair.generate();

  // Helper: pre-fund a PDA so it's rent-exempt
  async function prefundPda(pda: PublicKey) {
    const tx = new anchor.web3.Transaction().add(
      SystemProgram.transfer({
        fromPubkey: creator.publicKey,
        toPubkey: pda,
        lamports: 890_880,
      })
    );
    await provider.sendAndConfirm(tx);
  }

  // Helper: create a market with specific params
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

    const [market] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), creator.publicKey.toBuffer(), marketId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    const [sideA] = PublicKey.findProgramAddressSync([Buffer.from("side"), market.toBuffer(), Buffer.from([0])], program.programId);
    const [sideB] = PublicKey.findProgramAddressSync([Buffer.from("side"), market.toBuffer(), Buffer.from([1])], program.programId);
    const [mintA] = PublicKey.findProgramAddressSync([Buffer.from("mint"), market.toBuffer(), Buffer.from([0])], program.programId);
    const [mintB] = PublicKey.findProgramAddressSync([Buffer.from("mint"), market.toBuffer(), Buffer.from([1])], program.programId);
    const [tvA] = PublicKey.findProgramAddressSync([Buffer.from("token_vault"), market.toBuffer(), Buffer.from([0])], program.programId);
    const [tvB] = PublicKey.findProgramAddressSync([Buffer.from("token_vault"), market.toBuffer(), Buffer.from([1])], program.programId);
    const [svA] = PublicKey.findProgramAddressSync([Buffer.from("sol_vault"), market.toBuffer(), Buffer.from([0])], program.programId);
    const [svB] = PublicKey.findProgramAddressSync([Buffer.from("sol_vault"), market.toBuffer(), Buffer.from([1])], program.programId);

    await prefundPda(protocolFeeAccount.publicKey);

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
        "Edge A",
        "EA",
        "",
        "Edge B",
        "EB",
        "",
        { unlocked: {} },
      )
      .accounts({
        creator: creator.publicKey,
        market, sideA, sideB,
        tokenMintA: mintA, tokenMintB: mintB,
        tokenVaultA: tvA, tokenVaultB: tvB,
        solVaultA: svA, solVaultB: svB,
        protocolFeeAccount: protocolFeeAccount.publicKey,
        metadataA: findMetadataPda(mintA),
        metadataB: findMetadataPda(mintB),
        tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })])
      .rpc();

    return { market, sideA, sideB, mintA, mintB, tvA, tvB, svA, svB };
  }

  // Helper: buy tokens
  async function buyTokens(
    market: PublicKey,
    sideAccount: PublicKey,
    tokenVault: PublicKey,
    solVault: PublicKey,
    mint: PublicKey,
    side: number,
    solAmount: BN
  ) {
    const ata = await getAssociatedTokenAddress(mint, creator.publicKey);
    try {
      await getAccount(provider.connection, ata);
    } catch {
      const createAtaIx = createAssociatedTokenAccountInstruction(
        creator.publicKey, ata, creator.publicKey, mint
      );
      await provider.sendAndConfirm(new anchor.web3.Transaction().add(createAtaIx));
    }

    await program.methods
      .buyTokens(side, solAmount, new BN(1))
      .accounts({
        buyer: creator.publicKey, market, sideAccount,
        tokenVault, buyerTokenAccount: ata, solVault,
        systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    return ata;
  }

  // ---- EDGE CASE TESTS ----

  describe("invalid side index", () => {
    let m: Awaited<ReturnType<typeof createMarket>>;

    before(async () => {
      m = await createMarket(new BN(100));
    });

    it("should reject buy with side = 2", async () => {
      const ata = await getAssociatedTokenAddress(m.mintA, creator.publicKey);
      try {
        await getAccount(provider.connection, ata);
      } catch {
        const ix = createAssociatedTokenAccountInstruction(creator.publicKey, ata, creator.publicKey, m.mintA);
        await provider.sendAndConfirm(new anchor.web3.Transaction().add(ix));
      }

      try {
        await program.methods
          .buyTokens(2, new BN(LAMPORTS_PER_SOL), new BN(1))
          .accounts({
            buyer: creator.publicKey, market: m.market, sideAccount: m.sideA,
            tokenVault: m.tvA, buyerTokenAccount: ata, solVault: m.svA,
            systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        expect.fail("should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("InvalidSide");
      }
    });
  });

  describe("zero amount operations", () => {
    let m: Awaited<ReturnType<typeof createMarket>>;

    before(async () => {
      m = await createMarket(new BN(101));
    });

    it("should reject buy with 0 SOL", async () => {
      const ata = await getAssociatedTokenAddress(m.mintA, creator.publicKey);
      try { await getAccount(provider.connection, ata); } catch {
        const ix = createAssociatedTokenAccountInstruction(creator.publicKey, ata, creator.publicKey, m.mintA);
        await provider.sendAndConfirm(new anchor.web3.Transaction().add(ix));
      }

      try {
        await program.methods
          .buyTokens(0, new BN(0), new BN(0))
          .accounts({
            buyer: creator.publicKey, market: m.market, sideAccount: m.sideA,
            tokenVault: m.tvA, buyerTokenAccount: ata, solVault: m.svA,
            systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
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
            tokenVault: m.tvA, sellerTokenAccount: ata, solVault: m.svA,
            systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        expect.fail("should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("InsufficientTokenBalance");
      }
    });
  });

  describe("double resolve attack", () => {
    let m: Awaited<ReturnType<typeof createMarket>>;

    before(async () => {
      const now = Math.floor(Date.now() / 1000);
      m = await createMarket(new BN(102), {
        deadline: now + 12,
        twapWindow: 8,
        twapInterval: 10,
        sellPenaltyMaxBps: 0,
        protectionActivationOffset: 0,
      });

      // Buy on both sides
      await buyTokens(m.market, m.sideA, m.tvA, m.svA, m.mintA, 0, new BN(2 * LAMPORTS_PER_SOL));
      await buyTokens(m.market, m.sideB, m.tvB, m.svB, m.mintB, 1, new BN(LAMPORTS_PER_SOL));

      // Wait for TWAP window and record sample
      await new Promise((r) => setTimeout(r, 5000));
      await program.methods.recordTwapSample()
        .accounts({ cranker: creator.publicKey, market: m.market, sideA: m.sideA, sideB: m.sideB })
        .rpc();

      // Wait for deadline
      await new Promise((r) => setTimeout(r, 10000));

      // First resolve
      await program.methods.resolveMarket()
        .accounts({
          resolver: creator.publicKey, market: m.market, sideA: m.sideA, sideB: m.sideB,
          solVaultA: m.svA, solVaultB: m.svB,
          protocolFeeAccount: protocolFeeAccount.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    });

    it("should reject second resolve", async () => {
      try {
        await program.methods.resolveMarket()
          .accounts({
            resolver: creator.publicKey, market: m.market, sideA: m.sideA, sideB: m.sideB,
            solVaultA: m.svA, solVaultB: m.svB,
            protocolFeeAccount: protocolFeeAccount.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("MarketAlreadyResolved");
      }
    });

    it("should reject buy after resolution", async () => {
      const ata = await getAssociatedTokenAddress(m.mintA, creator.publicKey);
      try {
        await program.methods
          .buyTokens(0, new BN(LAMPORTS_PER_SOL), new BN(1))
          .accounts({
            buyer: creator.publicKey, market: m.market, sideAccount: m.sideA,
            tokenVault: m.tvA, buyerTokenAccount: ata, solVault: m.svA,
            systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        expect.fail("should have thrown");
      } catch (err: any) {
        // MarketExpired or MarketAlreadyResolved
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
            tokenVault: m.tvA, sellerTokenAccount: ata, solVault: m.svA,
            systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        expect.fail("should have thrown");
      } catch (err: any) {
        // Deadline has passed, so MarketExpired or MarketAlreadyResolved both valid
        expect(["MarketExpired", "MarketAlreadyResolved"]).to.include(err.error.errorCode.code);
      }
    });
  });

  describe("sell all tokens", () => {
    let m: Awaited<ReturnType<typeof createMarket>>;
    let ataA: PublicKey;

    before(async () => {
      m = await createMarket(new BN(103));
      ataA = await buyTokens(m.market, m.sideA, m.tvA, m.svA, m.mintA, 0, new BN(LAMPORTS_PER_SOL));
    });

    it("should sell all tokens and leave zero balance", async () => {
      const account = await getAccount(provider.connection, ataA);
      const allTokens = new BN(Number(account.amount));

      await program.methods
        .sellTokens(0, allTokens, new BN(1))
        .accounts({
          seller: creator.publicKey, market: m.market, sideAccount: m.sideA,
          tokenVault: m.tvA, sellerTokenAccount: ataA, solVault: m.svA,
          systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      const accountAfter = await getAccount(provider.connection, ataA);
      expect(Number(accountAfter.amount)).to.equal(0);

      const side = await program.account.side.fetch(m.sideA);
      expect(side.circulatingSupply.toNumber()).to.equal(0);
    });

    it("should still allow buying after all tokens sold", async () => {
      await program.methods
        .buyTokens(0, new BN(LAMPORTS_PER_SOL / 2), new BN(1))
        .accounts({
          buyer: creator.publicKey, market: m.market, sideAccount: m.sideA,
          tokenVault: m.tvA, buyerTokenAccount: ataA, solVault: m.svA,
          systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      const accountAfter = await getAccount(provider.connection, ataA);
      expect(Number(accountAfter.amount)).to.be.greaterThan(0);
    });
  });

  describe("slippage protection", () => {
    let m: Awaited<ReturnType<typeof createMarket>>;

    before(async () => {
      m = await createMarket(new BN(104));
    });

    it("should reject buy when min_tokens_out not met", async () => {
      const ata = await getAssociatedTokenAddress(m.mintA, creator.publicKey);
      try { await getAccount(provider.connection, ata); } catch {
        const ix = createAssociatedTokenAccountInstruction(creator.publicKey, ata, creator.publicKey, m.mintA);
        await provider.sendAndConfirm(new anchor.web3.Transaction().add(ix));
      }

      try {
        // Request impossibly high minimum tokens
        await program.methods
          .buyTokens(0, new BN(1000), new BN(999_999_999))
          .accounts({
            buyer: creator.publicKey, market: m.market, sideAccount: m.sideA,
            tokenVault: m.tvA, buyerTokenAccount: ata, solVault: m.svA,
            systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
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
        await createMarket(new BN(200), { battleTaxBps: 10001 });
        expect.fail("should have thrown");
      } catch (err: any) {
        // Error may be AnchorError or SendTransactionError
        const code = err?.error?.errorCode?.code || err?.message || "";
        expect(code).to.satisfy((c: string) =>
          c === "InvalidMarketConfig" || c.includes("InvalidMarketConfig") || c.includes("custom program error")
        );
      }
    });

    it("should reject protocol_fee_bps > 500", async () => {
      try {
        await createMarket(new BN(201), { protocolFeeBps: 600 });
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
        await createMarket(new BN(202), { sellPenaltyMaxBps: 4000 });
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
        await createMarket(new BN(203), { deadline: 1000 });
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
    let m: Awaited<ReturnType<typeof createMarket>>;

    before(async () => {
      const now = Math.floor(Date.now() / 1000);
      m = await createMarket(new BN(105), {
        deadline: now + 20,
        twapWindow: 15,
        twapInterval: 10,
        sellPenaltyMaxBps: 0,
        protectionActivationOffset: 0,
      });
      await buyTokens(m.market, m.sideA, m.tvA, m.svA, m.mintA, 0, new BN(LAMPORTS_PER_SOL));
      await buyTokens(m.market, m.sideB, m.tvB, m.svB, m.mintB, 1, new BN(LAMPORTS_PER_SOL / 2));

      // Wait for TWAP window
      await new Promise((r) => setTimeout(r, 6000));

      // Record first sample
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
    let m: Awaited<ReturnType<typeof createMarket>>;
    let atB: PublicKey;

    before(async () => {
      const now = Math.floor(Date.now() / 1000);
      m = await createMarket(new BN(106), {
        deadline: now + 12,
        twapWindow: 8,
        twapInterval: 10,
        sellPenaltyMaxBps: 0,
        protectionActivationOffset: 0,
        battleTaxBps: 5000,
      });

      // Side A wins (more SOL)
      await buyTokens(m.market, m.sideA, m.tvA, m.svA, m.mintA, 0, new BN(2 * LAMPORTS_PER_SOL));
      atB = await buyTokens(m.market, m.sideB, m.tvB, m.svB, m.mintB, 1, new BN(LAMPORTS_PER_SOL));

      // TWAP & resolve
      await new Promise((r) => setTimeout(r, 5000));
      await program.methods.recordTwapSample()
        .accounts({ cranker: creator.publicKey, market: m.market, sideA: m.sideA, sideB: m.sideB })
        .rpc();
      await new Promise((r) => setTimeout(r, 10000));
      await program.methods.resolveMarket()
        .accounts({
          resolver: creator.publicKey, market: m.market, sideA: m.sideA, sideB: m.sideB,
          solVaultA: m.svA, solVaultB: m.svB,
          protocolFeeAccount: protocolFeeAccount.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    });

    it("should allow losing side to sell post-resolution (partial, at reduced value)", async () => {
      const accountBefore = await getAccount(provider.connection, atB);
      const totalTokens = Number(accountBefore.amount);
      // Sell only 10% of holdings to account for depleted vault
      const tokenAmount = new BN(Math.floor(totalTokens / 10));
      const balBefore = await provider.connection.getBalance(creator.publicKey);

      await program.methods
        .sellPostResolution(1, tokenAmount, new BN(0))
        .accounts({
          seller: creator.publicKey, market: m.market, sideAccount: m.sideB,
          tokenVault: m.tvB, sellerTokenAccount: atB, solVault: m.svB,
          systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      const balAfter = await provider.connection.getBalance(creator.publicKey);
      const gained = balAfter - balBefore;
      console.log("  losing side SOL recovered (partial):", gained);
      expect(gained).to.be.greaterThan(0);
    });
  });
});
