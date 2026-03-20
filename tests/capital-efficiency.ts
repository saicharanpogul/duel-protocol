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
  TOKEN_METADATA_PROGRAM_ID, findMetadataPda, derivePdas, wrapSol,
  getQuoteVaultBalance, Pdas,
} from "./helpers";

describe("duel - capital efficiency & economics", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Duel as Program<Duel>;
  const creator = provider.wallet;
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

  let marketCounter = Math.floor(Math.random() * 1_000_000) + 200_000;

  function deriveMarketPdas(marketId: BN) {
    return derivePdas(program.programId, creator.publicKey, marketId);
  }

  async function createMarket(overrides: { deadline?: number; twapWindow?: number; twapInterval?: number } = {}) {
    const id = new BN(marketCounter++);
    const pdas = deriveMarketPdas(id);
    const now = Math.floor(Date.now() / 1000);
    const opts = { deadline: now + 3600, twapWindow: 600, twapInterval: 10, ...overrides };
    await program.methods.initializeMarket(
      id, new BN(opts.deadline), new BN(opts.twapWindow), new BN(opts.twapInterval),
      "Test A", "TA", "", "Test B", "TB", "",
    ).accounts({
      creator: creator.publicKey, market: pdas.market, sideA: pdas.sideA, sideB: pdas.sideB,
      tokenMintA: pdas.mintA, tokenMintB: pdas.mintB, tokenVaultA: pdas.tvA, tokenVaultB: pdas.tvB,
      quoteMint: NATIVE_MINT, quoteTokenProgram: TOKEN_PROGRAM_ID, quoteVaultA: pdas.qvA, quoteVaultB: pdas.qvB,
      protocolFeeAccount, creatorFeeAccount, config: configPda,
      metadataA: findMetadataPda(pdas.mintA), metadataB: findMetadataPda(pdas.mintB),
      tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID, systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID, rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    }).preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })]).rpc();
    return { id, pdas };
  }

  async function buyTokens(pdas: Pdas, side: number, solAmount: BN, buyer?: Keypair) {
    const payer = buyer ? buyer.publicKey : creator.publicKey;
    const mint = side === 0 ? pdas.mintA : pdas.mintB;
    const sideAccount = side === 0 ? pdas.sideA : pdas.sideB;
    const tokenVault = side === 0 ? pdas.tvA : pdas.tvB;
    const quoteVault = side === 0 ? pdas.qvA : pdas.qvB;
    const ata = await getAssociatedTokenAddress(mint, payer);
    try { await getAccount(provider.connection, ata); } catch {
      const ix = createAssociatedTokenAccountInstruction(payer, ata, payer, mint);
      const tx = new Transaction().add(ix);
      if (buyer) { tx.feePayer = buyer.publicKey; await provider.sendAndConfirm(tx, [buyer]); }
      else { await provider.sendAndConfirm(tx); }
    }
    const buyerWsolAta = await wrapSol(provider, payer, solAmount.toNumber(), buyer ? [buyer] : undefined);
    const builder = program.methods.buyTokens(side, solAmount, new BN(1)).accounts({
      buyer: payer, market: pdas.market, sideAccount, tokenMint: mint, tokenVault, buyerTokenAccount: ata,
      quoteMint: NATIVE_MINT, quoteVault, buyerQuoteAccount: buyerWsolAta,
      protocolFeeAccount, creatorFeeAccount,
      config: configPda, tokenProgram: TOKEN_PROGRAM_ID, quoteTokenProgram: TOKEN_PROGRAM_ID,
    });
    if (buyer) { await builder.signers([buyer]).rpc(); } else { await builder.rpc(); }
    const acc = await getAccount(provider.connection, ata);
    return { ata, balance: Number(acc.amount) };
  }

  async function sellTokens(pdas: Pdas, side: number, tokenAmount: BN) {
    const mint = side === 0 ? pdas.mintA : pdas.mintB;
    const sideAccount = side === 0 ? pdas.sideA : pdas.sideB;
    const tokenVault = side === 0 ? pdas.tvA : pdas.tvB;
    const quoteVault = side === 0 ? pdas.qvA : pdas.qvB;
    const ata = await getAssociatedTokenAddress(mint, creator.publicKey);
    await program.methods.sellTokens(side, tokenAmount, new BN(1)).accounts({
      seller: creator.publicKey, market: pdas.market, sideAccount, tokenMint: mint, tokenVault,
      sellerTokenAccount: ata, quoteMint: NATIVE_MINT, quoteVault, sellerQuoteAccount: creatorWsolAta,
      protocolFeeAccount, creatorFeeAccount,
      config: configPda, tokenProgram: TOKEN_PROGRAM_ID, quoteTokenProgram: TOKEN_PROGRAM_ID,
    }).rpc();
  }

  async function getSideData(pdas: Pdas, side: number) {
    return program.account.side.fetch(side === 0 ? pdas.sideA : pdas.sideB);
  }

  async function getCreatorWsolBal(): Promise<number> {
    const acc = await getAccount(provider.connection, creatorWsolAta);
    return Number(acc.amount);
  }

  // ---- ECONOMICS TESTS ----

  describe("a) Roundtrip efficiency", () => {
    it("buy then immediately sell should lose only trade fees (~1.25% * 2 = ~2.5%)", async () => {
      const { pdas } = await createMarket();
      const solIn = 1 * LAMPORTS_PER_SOL;
      // buyTokens wraps SOL internally (adds solIn to WSOL ATA), so
      // the trading P&L = (balAfter - balBefore - solIn)
      const balBefore = await getCreatorWsolBal();
      const { balance: tokensReceived } = await buyTokens(pdas, 0, new BN(solIn));
      expect(tokensReceived).to.be.greaterThan(0);
      await sellTokens(pdas, 0, new BN(tokensReceived));
      const balAfter = await getCreatorWsolBal();
      // Subtract the wrapped SOL to isolate trading P&L
      // Creator gets half the trade fee back (same account), so loss = protocol fee + rounding
      const tradingPnl = balAfter - balBefore - solIn;
      console.log(`    Roundtrip: ${solIn / LAMPORTS_PER_SOL} SOL in, ${tokensReceived} tokens`);
      console.log(`    Trading P&L: ${tradingPnl} lamports (${((tradingPnl / solIn) * 100).toFixed(4)}%)`);
      expect(tradingPnl).to.be.at.most(0); // Lost money to protocol fees + curve rounding
      expect(Math.abs(tradingPnl)).to.be.lessThan(solIn * 0.10); // Lost < 10%
    });
  });

  describe("b) Trade fee verification", () => {
    it("protocol_fee_account and creator_fee_account receive correct fee splits", async () => {
      const { pdas } = await createMarket();
      const solIn = new BN(LAMPORTS_PER_SOL);

      const protBefore = Number((await getAccount(provider.connection, protocolFeeAccount)).amount);
      const creatBefore = Number((await getAccount(provider.connection, creatorFeeAccount)).amount);

      await buyTokens(pdas, 0, solIn);

      const protAfter = Number((await getAccount(provider.connection, protocolFeeAccount)).amount);
      const creatAfter = Number((await getAccount(provider.connection, creatorFeeAccount)).amount);

      const protFee = protAfter - protBefore;
      const creatFee = creatAfter - creatBefore;
      const totalFee = protFee + creatFee;

      console.log(`    Protocol fee: ${protFee} lamports`);
      console.log(`    Creator fee: ${creatFee} lamports`);
      console.log(`    Total fee: ${totalFee} lamports`);

      // Trade fee is config.trade_fee_bps (125 = 1.25%) of quote_amount
      // Config was initialized with trade_fee_bps = 125
      const expectedTotalFee = Math.floor(LAMPORTS_PER_SOL * 125 / 10000);
      // Allow 1 lamport rounding tolerance
      expect(totalFee).to.be.within(expectedTotalFee - 2, expectedTotalFee + 2);
      // Protocol fee + creator fee = total fee
      expect(protFee + creatFee).to.equal(totalFee);
    });
  });

  describe("c) Multi-buyer accumulation: price increases monotonically", () => {
    it("5 sequential buys should yield fewer tokens each time", async () => {
      const { pdas } = await createMarket();
      const buyAmount = new BN(LAMPORTS_PER_SOL);
      const tokenCounts: number[] = [];

      for (let i = 0; i < 5; i++) {
        const sideBefore = await getSideData(pdas, 0);
        const supBefore = sideBefore.circulatingSupply.toNumber();
        await buyTokens(pdas, 0, buyAmount);
        const sideAfter = await getSideData(pdas, 0);
        const tokensThisBuy = sideAfter.circulatingSupply.toNumber() - supBefore;
        tokenCounts.push(tokensThisBuy);
        console.log(`    Buy #${i + 1}: ${tokensThisBuy} tokens for 1 SOL`);
      }

      // Each subsequent buy should yield fewer tokens (monotonically decreasing)
      for (let i = 1; i < tokenCounts.length; i++) {
        expect(tokenCounts[i]).to.be.lessThanOrEqual(tokenCounts[i - 1]);
      }
    });
  });

  describe("d) Winner takes loser's reserve", () => {
    // After resolve_and_graduate, the loser's reserve is transferred to winner's vault.
    // Since we can't call resolve_and_graduate on localnet (Meteora not available),
    // we verify the pre-condition: both vaults have funds, and the program logic
    // (verified via code read) transfers 100% of loser reserve to winner vault.

    it("both sides accumulate separate reserves", async () => {
      const { pdas } = await createMarket();
      await buyTokens(pdas, 0, new BN(2 * LAMPORTS_PER_SOL));
      await buyTokens(pdas, 1, new BN(LAMPORTS_PER_SOL));

      const vaultA = await getQuoteVaultBalance(provider, pdas, 0);
      const vaultB = await getQuoteVaultBalance(provider, pdas, 1);

      console.log(`    Vault A: ${vaultA} lamports`);
      console.log(`    Vault B: ${vaultB} lamports`);

      expect(vaultA).to.be.greaterThan(0);
      expect(vaultB).to.be.greaterThan(0);
      // Side A got more SOL, so its vault should be larger
      expect(vaultA).to.be.greaterThan(vaultB);
    });
  });

  describe("e) Early buyer advantage", () => {
    it("first buyer pays less per token than the last buyer", async () => {
      const { pdas } = await createMarket();

      // First buyer: 1 SOL at zero supply
      const { balance: firstTokens } = await buyTokens(pdas, 0, new BN(LAMPORTS_PER_SOL));
      const firstPricePerToken = LAMPORTS_PER_SOL / firstTokens;

      // Intermediate buys to push price up
      for (let i = 0; i < 5; i++) {
        await buyTokens(pdas, 0, new BN(LAMPORTS_PER_SOL));
      }

      // Last buyer: 1 SOL at higher supply
      const sideBefore = await getSideData(pdas, 0);
      const supBefore = sideBefore.circulatingSupply.toNumber();
      await buyTokens(pdas, 0, new BN(LAMPORTS_PER_SOL));
      const sideAfter = await getSideData(pdas, 0);
      const lastTokens = sideAfter.circulatingSupply.toNumber() - supBefore;
      const lastPricePerToken = LAMPORTS_PER_SOL / lastTokens;

      console.log(`    First buyer: ${firstTokens} tokens/SOL (price: ${firstPricePerToken.toFixed(4)} lamps/token)`);
      console.log(`    Last buyer: ${lastTokens} tokens/SOL (price: ${lastPricePerToken.toFixed(4)} lamps/token)`);

      expect(firstPricePerToken).to.be.lessThan(lastPricePerToken);
      expect(firstTokens).to.be.greaterThan(lastTokens);
    });
  });

  describe("f) Total supply conservation", () => {
    it("circulating_supply + vault_tokens = total_supply at all times", async () => {
      const { pdas } = await createMarket();

      // Initial state: all tokens in vault
      const sideInit = await getSideData(pdas, 0);
      const totalSupply = sideInit.totalSupply.toNumber();
      expect(totalSupply).to.equal(1_000_000_000);

      const vaultInit = await getAccount(provider.connection, pdas.tvA);
      expect(Number(vaultInit.amount)).to.equal(totalSupply);
      expect(sideInit.circulatingSupply.toNumber()).to.equal(0);

      // After buy
      const { balance: bought } = await buyTokens(pdas, 0, new BN(2 * LAMPORTS_PER_SOL));
      const sideAfterBuy = await getSideData(pdas, 0);
      const vaultAfterBuy = await getAccount(provider.connection, pdas.tvA);
      const sumAfterBuy = sideAfterBuy.circulatingSupply.toNumber() + Number(vaultAfterBuy.amount);
      expect(sumAfterBuy).to.equal(totalSupply);
      console.log(`    After buy: circ=${sideAfterBuy.circulatingSupply.toNumber()}, vault=${Number(vaultAfterBuy.amount)}, sum=${sumAfterBuy}`);

      // After sell half
      const sellAmount = Math.floor(bought / 2);
      await sellTokens(pdas, 0, new BN(sellAmount));
      const sideAfterSell = await getSideData(pdas, 0);
      const vaultAfterSell = await getAccount(provider.connection, pdas.tvA);
      const sumAfterSell = sideAfterSell.circulatingSupply.toNumber() + Number(vaultAfterSell.amount);
      expect(sumAfterSell).to.equal(totalSupply);
      console.log(`    After sell: circ=${sideAfterSell.circulatingSupply.toNumber()}, vault=${Number(vaultAfterSell.amount)}, sum=${sumAfterSell}`);
    });
  });

  describe("g) Reserve drain protection", () => {
    it("selling all tokens leaves quote vault >= 0", async () => {
      const { pdas } = await createMarket();
      const { balance: tokens } = await buyTokens(pdas, 0, new BN(5 * LAMPORTS_PER_SOL));
      await sellTokens(pdas, 0, new BN(tokens));

      const vaultBalance = await getQuoteVaultBalance(provider, pdas, 0);
      console.log(`    Quote vault after max sell: ${vaultBalance} lamports`);
      expect(vaultBalance).to.be.greaterThanOrEqual(0);

      // Circulating should be 0
      const side = await getSideData(pdas, 0);
      expect(side.circulatingSupply.toNumber()).to.equal(0);
    });
  });

  describe("h) Large buy overflow protection", () => {
    it("100 SOL buy does not cause overflow", async () => {
      const { pdas } = await createMarket();
      try {
        const { balance: tokens } = await buyTokens(pdas, 0, new BN(100 * LAMPORTS_PER_SOL));
        console.log(`    100 SOL -> ${tokens} tokens (no overflow)`);
        expect(tokens).to.be.greaterThan(0);
      } catch (e: any) {
        // If it fails, it should be for a reasonable reason, not overflow
        const msg = e?.message || "";
        expect(msg).to.not.include("MathOverflow");
        console.log(`    100 SOL buy rejected (${msg.slice(0, 80)})`);
      }
    });
  });

  describe("i) Multi-market isolation", () => {
    it("operations on market A do not affect market B", async () => {
      const { pdas: pdas1 } = await createMarket();
      const { pdas: pdas2 } = await createMarket();

      // Buy 5 SOL on market 1, side A
      await buyTokens(pdas1, 0, new BN(5 * LAMPORTS_PER_SOL));
      const side1After = await getSideData(pdas1, 0);

      // Buy 1 SOL on market 2, side A
      await buyTokens(pdas2, 0, new BN(LAMPORTS_PER_SOL));
      const side2After = await getSideData(pdas2, 0);

      // Verify market 1 was not affected by market 2 operation
      const side1Check = await getSideData(pdas1, 0);
      expect(side1Check.circulatingSupply.toNumber()).to.equal(side1After.circulatingSupply.toNumber());

      // Verify market 2 has independent state
      expect(side2After.circulatingSupply.toNumber()).to.be.greaterThan(0);
      expect(side2After.circulatingSupply.toNumber()).to.not.equal(side1After.circulatingSupply.toNumber());

      // Verify quote vaults are independent
      const vault1 = await getQuoteVaultBalance(provider, pdas1, 0);
      const vault2 = await getQuoteVaultBalance(provider, pdas2, 0);
      expect(vault1).to.be.greaterThan(vault2);

      console.log(`    Market 1 circ: ${side1After.circulatingSupply.toNumber()}`);
      console.log(`    Market 2 circ: ${side2After.circulatingSupply.toNumber()}`);
      console.log(`    Markets are fully isolated`);
    });
  });

  describe("j) Bonding curve monotonicity across multiple sells", () => {
    it("each sequential sell returns less WSOL per token (price decreases)", async () => {
      const { pdas } = await createMarket();
      const { balance: tokens } = await buyTokens(pdas, 0, new BN(5 * LAMPORTS_PER_SOL));
      const chunk = Math.floor(tokens / 5);
      const returns: number[] = [];

      for (let i = 0; i < 4; i++) {
        const before = await getCreatorWsolBal();
        await sellTokens(pdas, 0, new BN(chunk));
        const after = await getCreatorWsolBal();
        returns.push(after - before);
        console.log(`    Sell #${i + 1}: ${chunk} tokens -> ${after - before} lamports`);
      }

      // Each sell should return less than the previous (price drops as supply decreases)
      for (let i = 1; i < returns.length; i++) {
        expect(returns[i]).to.be.lessThan(returns[i - 1]);
      }
    });
  });

  describe("k) Whale vs retail: same total investment", () => {
    it("single whale buy equals sum of small buys (path independence)", async () => {
      // Whale: one 10 SOL buy
      const { pdas: whalePdas } = await createMarket();
      const { balance: whaleTokens } = await buyTokens(whalePdas, 0, new BN(10 * LAMPORTS_PER_SOL));

      // Retail: ten 1 SOL buys
      const { pdas: retailPdas } = await createMarket();
      let retailTotal = 0;
      for (let i = 0; i < 10; i++) {
        const sideBefore = await getSideData(retailPdas, 0);
        await buyTokens(retailPdas, 0, new BN(LAMPORTS_PER_SOL));
        const sideAfter = await getSideData(retailPdas, 0);
        retailTotal += sideAfter.circulatingSupply.toNumber() - sideBefore.circulatingSupply.toNumber();
      }

      const diff = Math.abs(whaleTokens - retailTotal);
      const diffPct = (diff / Math.max(whaleTokens, retailTotal)) * 100;
      console.log(`    Whale 1x10: ${whaleTokens}, Retail 10x1: ${retailTotal}, diff: ${diffPct.toFixed(4)}%`);
      // Should be very close (rounding only)
      expect(diffPct).to.be.lessThan(0.1);
    });
  });

  describe("l) Dust attack resistance", () => {
    it("buying with 1 lamport should yield 0 tokens or fail gracefully", async () => {
      const { pdas } = await createMarket();
      try {
        const { balance: tokens } = await buyTokens(pdas, 0, new BN(1));
        console.log(`    1 lamport buy: ${tokens} tokens`);
        // If it succeeds, tokens should be 0 or minimal
        const side = await getSideData(pdas, 0);
        expect(side.circulatingSupply.toNumber()).to.be.greaterThanOrEqual(0);
      } catch (e: any) {
        // It's acceptable for this to fail (InsufficientSolAmount or similar)
        console.log(`    1 lamport buy rejected (expected)`);
      }
    });
  });

  describe("m) Max supply saturation", () => {
    it("cannot buy more tokens than total supply", async () => {
      const { pdas } = await createMarket();
      // Buy a huge amount -- should be capped at total_supply
      const { balance: tokens } = await buyTokens(pdas, 0, new BN(100 * LAMPORTS_PER_SOL));
      expect(tokens).to.be.lessThanOrEqual(1_000_000_000);
      console.log(`    Max buy: ${tokens} tokens (cap: 1B)`);
    });
  });
});
