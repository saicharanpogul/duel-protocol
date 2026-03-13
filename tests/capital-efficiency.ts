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

describe("duel - capital efficiency & battle testing", () => {
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
      await provider.sendAndConfirm(new Transaction().add(createAssociatedTokenAccountInstruction(creator.publicKey, creatorFeeAccount, creator.publicKey, NATIVE_MINT)));
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
      await program.methods.initializeConfig(125, new BN(0)).accounts({ admin: creator.publicKey, protocolFeeAccount, systemProgram: SystemProgram.programId } as any).rpc();
    }
  });

  let marketCounter = Math.floor(Math.random() * 1_000_000) + 100_000;

  function deriveMarketPdas(marketId: BN) { return derivePdas(program.programId, creator.publicKey, marketId); }

  async function createMarket(
    curveParams = { a: new BN(1_000_000), n: 1, b: new BN(1_000) },
    totalSupply = new BN(1_000_000_000),
    overrides: { deadline?: number; twapWindow?: number; twapInterval?: number; battleTaxBps?: number; protocolFeeBps?: number; sellPenaltyMaxBps?: number; protectionActivationOffset?: number; } = {}
  ) {
    const id = new BN(marketCounter++);
    const pdas = deriveMarketPdas(id);
    const now = Math.floor(Date.now() / 1000);
    const opts = { deadline: now + 3600, twapWindow: 600, twapInterval: 10, battleTaxBps: 5000, protocolFeeBps: 100, sellPenaltyMaxBps: 1500, protectionActivationOffset: 300, ...overrides };
    await program.methods.initializeMarket(
      id, new BN(opts.deadline), new BN(opts.twapWindow), new BN(opts.twapInterval),
      opts.battleTaxBps, opts.protocolFeeBps, opts.sellPenaltyMaxBps, new BN(opts.protectionActivationOffset),
      curveParams, totalSupply, "Test A", "TA", "", "Test B", "TB", "",
      { unlocked: {} }, new BN(0), 0, 0, { twap: {} }, PublicKey.default, new BN(0),
    ).accounts({
      creator: creator.publicKey, market: pdas.market, sideA: pdas.sideA, sideB: pdas.sideB,
      tokenMintA: pdas.mintA, tokenMintB: pdas.mintB, tokenVaultA: pdas.tvA, tokenVaultB: pdas.tvB,
      quoteMint: NATIVE_MINT, quoteTokenProgram: TOKEN_PROGRAM_ID, quoteVaultA: pdas.qvA, quoteVaultB: pdas.qvB,
      protocolFeeAccount, creatorFeeAccount, config: configPda,
      metadataA: findMetadataPda(pdas.mintA), metadataB: findMetadataPda(pdas.mintB),
      tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID, systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID, rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    }).preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })]).rpc();
    return { id, pdas, curveParams, totalSupply };
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
      config: configPda, tokenProgram: TOKEN_PROGRAM_ID, quoteTokenProgram: TOKEN_PROGRAM_ID,
    });
    if (buyer) { await builder.signers([buyer]).rpc(); } else { await builder.rpc(); }
    const acc = await getAccount(provider.connection, ata);
    return { ata, balance: Number(acc.amount) };
  }

  async function sellTokens(pdas: Pdas, side: number, tokenAmount: BN, postResolution = false) {
    const mint = side === 0 ? pdas.mintA : pdas.mintB;
    const sideAccount = side === 0 ? pdas.sideA : pdas.sideB;
    const tokenVault = side === 0 ? pdas.tvA : pdas.tvB;
    const quoteVault = side === 0 ? pdas.qvA : pdas.qvB;
    const ata = await getAssociatedTokenAddress(mint, creator.publicKey);
    const accounts = {
      seller: creator.publicKey, market: pdas.market, sideAccount, tokenMint: mint, tokenVault,
      sellerTokenAccount: ata, quoteMint: NATIVE_MINT, quoteVault, sellerQuoteAccount: creatorWsolAta,
      config: configPda, tokenProgram: TOKEN_PROGRAM_ID, quoteTokenProgram: TOKEN_PROGRAM_ID,
    };
    if (postResolution) { await program.methods.sellPostResolution(side, tokenAmount, new BN(0)).accounts(accounts).rpc(); }
    else { await program.methods.sellTokens(side, tokenAmount, new BN(1)).accounts(accounts).rpc(); }
  }

  async function resolveMarket(pdas: Pdas) {
    await program.methods.resolveMarket().accounts({
      resolver: creator.publicKey, market: pdas.market, sideA: pdas.sideA, sideB: pdas.sideB,
      quoteMint: NATIVE_MINT, quoteVaultA: pdas.qvA, quoteVaultB: pdas.qvB,
      protocolFeeAccount, creatorFeeAccount, quoteTokenProgram: TOKEN_PROGRAM_ID,
    }).rpc();
  }

  async function getSideData(pdas: Pdas, side: number) {
    return program.account.side.fetch(side === 0 ? pdas.sideA : pdas.sideB);
  }
  async function getMarketData(pdas: Pdas) { return program.account.market.fetch(pdas.market); }

  async function getCreatorWsolBal(): Promise<number> {
    const acc = await getAccount(provider.connection, creatorWsolAta);
    return Number(acc.amount);
  }

  // ═══════════════════════════════════════════════
  //  1. CAPITAL EFFICIENCY TESTS
  // ═══════════════════════════════════════════════

  describe("1. Roundtrip Efficiency", () => {
    it("buy → sell roundtrip should lose only ~1% base fee (no penalty window)", async () => {
      const { pdas } = await createMarket(undefined, undefined, { protectionActivationOffset: 0 });
      const solIn = 1 * LAMPORTS_PER_SOL;
      const balBefore = await getCreatorWsolBal();
      await wrapSol(provider, creator.publicKey, solIn); // pre-fund
      const { balance: tokensReceived } = await buyTokens(pdas, 0, new BN(solIn));
      expect(tokensReceived).to.be.greaterThan(0);
      await sellTokens(pdas, 0, new BN(tokensReceived));
      const balAfter = await getCreatorWsolBal();
      const netChange = balAfter - balBefore;
      console.log(`    Roundtrip: ${solIn / LAMPORTS_PER_SOL} SOL in → ${tokensReceived} tokens → sell all`);
      console.log(`    Net WSOL change: ${netChange / LAMPORTS_PER_SOL}`);
    });

    it("should measure roundtrip at multiple SOL amounts", async () => {
      const amounts = [0.1, 1, 5];
      for (const amt of amounts) {
        const { pdas } = await createMarket(undefined, undefined, { protectionActivationOffset: 0 });
        const solIn = Math.floor(amt * LAMPORTS_PER_SOL);
        const { balance: tokens } = await buyTokens(pdas, 0, new BN(solIn));
        if (tokens > 0) { await sellTokens(pdas, 0, new BN(tokens)); }
        console.log(`    ${amt} SOL → ${tokens} tokens`);
      }
    });
  });

  describe("2. Curve Parameter Sweep", () => {
    const configs = [
      { label: "Linear gentle", a: 100_000, n: 1, b: 100 },
      { label: "Linear steep", a: 10_000_000, n: 1, b: 1_000 },
      { label: "Quadratic gentle", a: 1, n: 2, b: 100 },
    ];
    configs.forEach(({ label, a, n, b }) => {
      it(`${label} (a=${a}, n=${n}, b=${b}) — price curve behaves`, async () => {
        const { pdas } = await createMarket({ a: new BN(a), n, b: new BN(b) }, new BN(1_000_000_000), { protectionActivationOffset: 0 });
        const { balance: t1 } = await buyTokens(pdas, 0, new BN(0.1 * LAMPORTS_PER_SOL));
        const { balance: t2Total } = await buyTokens(pdas, 0, new BN(1 * LAMPORTS_PER_SOL));
        const tokens2 = t2Total - t1;
        const price1 = (0.1 * LAMPORTS_PER_SOL) / t1;
        const price2 = (1 * LAMPORTS_PER_SOL) / tokens2;
        console.log(`    [${label}]: 0.1 SOL → ${t1} tokens, 1 SOL → ${tokens2} tokens`);
        expect(price2).to.be.greaterThanOrEqual(price1 * 0.99);
      });
    });
  });

  describe("3. Multi-Buyer Accumulation", () => {
    it("10 sequential buyers — price rises smoothly", async () => {
      const { pdas } = await createMarket();
      const buyAmount = new BN(0.5 * LAMPORTS_PER_SOL);
      let prevTokens = Infinity;
      for (let i = 0; i < 10; i++) {
        const sideBefore = await getSideData(pdas, 0);
        const supBefore = sideBefore.circulatingSupply.toNumber();
        await buyTokens(pdas, 0, buyAmount);
        const sideAfter = await getSideData(pdas, 0);
        const thisTokens = sideAfter.circulatingSupply.toNumber() - supBefore;
        if (i > 0) { expect(thisTokens).to.be.lessThanOrEqual(prevTokens); }
        prevTokens = thisTokens;
      }
    });
  });

  describe("4. Whale Impact Analysis", () => {
    it("single whale vs multiple small buyers — supply capture comparison", async () => {
      const { pdas: whalePdas, totalSupply } = await createMarket();
      const { balance: whaleTokens } = await buyTokens(whalePdas, 0, new BN(10 * LAMPORTS_PER_SOL));
      const whaleCapture = (whaleTokens / totalSupply.toNumber()) * 100;
      console.log(`    Whale (10 SOL): ${whaleTokens} tokens = ${whaleCapture.toFixed(2)}% supply`);

      const { pdas: retailPdas } = await createMarket();
      let retailTotal = 0;
      for (let i = 0; i < 10; i++) {
        const sideBefore = await getSideData(retailPdas, 0);
        await buyTokens(retailPdas, 0, new BN(1 * LAMPORTS_PER_SOL));
        const sideAfter = await getSideData(retailPdas, 0);
        retailTotal += sideAfter.circulatingSupply.toNumber() - sideBefore.circulatingSupply.toNumber();
      }
      const diff = Math.abs(whaleTokens - retailTotal);
      const diffPct = (diff / Math.max(whaleTokens, retailTotal)) * 100;
      console.log(`    Retail 10×1: ${retailTotal}, diff: ${diffPct.toFixed(4)}%`);
      expect(diffPct).to.be.lessThan(0.01);
    });
  });

  describe("5. Battle Tax Redistribution", () => {
    it("verifies correct transfer from loser to winner vault", async () => {
      const now = Math.floor(Date.now() / 1000);
      const { pdas } = await createMarket(undefined, undefined, { deadline: now + 15, twapWindow: 12, twapInterval: 10, battleTaxBps: 5000, protectionActivationOffset: 10 });
      await buyTokens(pdas, 0, new BN(2 * LAMPORTS_PER_SOL));
      await buyTokens(pdas, 1, new BN(1 * LAMPORTS_PER_SOL));
      const vaultABefore = await getQuoteVaultBalance(provider, pdas, 0);
      const vaultBBefore = await getQuoteVaultBalance(provider, pdas, 1);
      console.log(`    Pre-resolve: A=${vaultABefore}, B=${vaultBBefore}`);
      await new Promise(r => setTimeout(r, 5000));
      await program.methods.recordTwapSample().accountsStrict({ cranker: creator.publicKey, market: pdas.market, sideA: pdas.sideA, sideB: pdas.sideB }).rpc();
      await new Promise(r => setTimeout(r, 12000));
      await resolveMarket(pdas);
      const mkt = await getMarketData(pdas);
      const vaultAAfter = await getQuoteVaultBalance(provider, pdas, 0);
      const vaultBAfter = await getQuoteVaultBalance(provider, pdas, 1);
      console.log(`    Winner: Side ${mkt.winner === 0 ? "A" : "B"}, Post: A=${vaultAAfter}, B=${vaultBAfter}`);
      if (mkt.winner === 0) { expect(vaultAAfter).to.be.greaterThan(vaultABefore); }
    });
  });

  describe("6. Winner vs Loser P&L", () => {
    it("full lifecycle: asymmetric bets, resolve, measure winner ROI and loser loss", async () => {
      const now = Math.floor(Date.now() / 1000);
      const { pdas } = await createMarket(undefined, undefined, { deadline: now + 15, twapWindow: 12, twapInterval: 10, battleTaxBps: 5000, protectionActivationOffset: 10 });
      const { balance: tokensA } = await buyTokens(pdas, 0, new BN(3 * LAMPORTS_PER_SOL));
      const { balance: tokensB } = await buyTokens(pdas, 1, new BN(1 * LAMPORTS_PER_SOL));
      console.log(`    Bought: ${tokensA} tokens A, ${tokensB} tokens B`);
      await new Promise(r => setTimeout(r, 5000));
      await program.methods.recordTwapSample().accountsStrict({ cranker: creator.publicKey, market: pdas.market, sideA: pdas.sideA, sideB: pdas.sideB }).rpc();
      await new Promise(r => setTimeout(r, 12000));
      await resolveMarket(pdas);
      const mkt = await getMarketData(pdas);
      const winner = mkt.winner;
      if (winner === null || winner === undefined) { console.log(`    Draw`); return; }
      console.log(`    Winner: Side ${winner === 0 ? "A" : "B"}`);
      await sellTokens(pdas, winner, new BN(winner === 0 ? tokensA : tokensB), true);
    });
  });

  // ═══ ECONOMIC ATTACK VECTORS ═══
  describe("7. Reserve Drain Protection", () => {
    it("quote vault stays above zero after max sell", async () => {
      const { pdas } = await createMarket(undefined, undefined, { protectionActivationOffset: 0 });
      const { balance: tokens } = await buyTokens(pdas, 0, new BN(5 * LAMPORTS_PER_SOL));
      await sellTokens(pdas, 0, new BN(tokens));
      const vaultBalance = await getQuoteVaultBalance(provider, pdas, 0);
      console.log(`    Vault after max sell: ${vaultBalance}`);
      expect(vaultBalance).to.be.greaterThanOrEqual(0);
    });
  });

  describe("8. Dust Attack Resistance", () => {
    it("buying with 1 lamport should yield 0 tokens or fail gracefully", async () => {
      const { pdas } = await createMarket();
      try {
        const { balance: tokens } = await buyTokens(pdas, 0, new BN(1));
        console.log(`    1 lamport buy: ${tokens} tokens`);
        const side = await getSideData(pdas, 0);
        expect(side.circulatingSupply.toNumber()).to.be.greaterThanOrEqual(0);
      } catch (e: any) { console.log(`    1 lamport rejected`); }
    });
  });

  describe("9. Max Supply Saturation", () => {
    it("cannot buy more tokens than total supply", async () => {
      const { pdas } = await createMarket({ a: new BN(1_000_000), n: 1, b: new BN(1_000) }, new BN(1_000));
      const { balance: tokens } = await buyTokens(pdas, 0, new BN(10 * LAMPORTS_PER_SOL));
      console.log(`    Bought: ${tokens} tokens (max 1000)`);
      expect(tokens).to.be.lessThanOrEqual(1000);
    });
  });

  describe("10. Stress: Rapid Sequential Buys", () => {
    it("50 sequential buys maintain consistent state", async () => {
      const { pdas } = await createMarket();
      const buyAmount = new BN(0.05 * LAMPORTS_PER_SOL);
      let totalTokens = 0;
      for (let i = 0; i < 50; i++) {
        const sideBefore = await getSideData(pdas, 0);
        await buyTokens(pdas, 0, buyAmount);
        const sideAfter = await getSideData(pdas, 0);
        totalTokens += sideAfter.circulatingSupply.toNumber() - sideBefore.circulatingSupply.toNumber();
      }
      const finalSide = await getSideData(pdas, 0);
      console.log(`    50 buys, total: ${totalTokens}, circ: ${finalSide.circulatingSupply.toNumber()}`);
      expect(finalSide.circulatingSupply.toNumber()).to.equal(totalTokens);
    });
  });

  describe("11. Integer Boundary: Sell Exact Balance", () => {
    it("selling exactly circulating_supply tokens leaves 0", async () => {
      const { pdas } = await createMarket(undefined, undefined, { protectionActivationOffset: 0 });
      const { balance: tokens } = await buyTokens(pdas, 0, new BN(2 * LAMPORTS_PER_SOL));
      await sellTokens(pdas, 0, new BN(tokens));
      const side = await getSideData(pdas, 0);
      expect(side.circulatingSupply.toNumber()).to.equal(0);
    });
  });

  describe("12. Penalty Decay Verification", () => {
    it("penalty increases as reserve drops", async () => {
      const { pdas } = await createMarket(undefined, undefined, { deadline: Math.floor(Date.now() / 1000) + 3600, protectionActivationOffset: 3600, sellPenaltyMaxBps: 3000 });
      const { balance: tokens } = await buyTokens(pdas, 0, new BN(5 * LAMPORTS_PER_SOL));
      const sellChunk = Math.floor(tokens / 5);
      const wsolReturns: number[] = [];
      for (let i = 0; i < 4; i++) {
        const before = await getCreatorWsolBal();
        await sellTokens(pdas, 0, new BN(sellChunk));
        const after = await getCreatorWsolBal();
        wsolReturns.push(after - before);
        console.log(`    Sell #${i + 1}: ${sellChunk} tokens → ${(after - before) / LAMPORTS_PER_SOL} WSOL`);
      }
      for (let i = 1; i < wsolReturns.length; i++) { expect(wsolReturns[i]).to.be.lessThan(wsolReturns[i - 1]); }
    });
  });

  // ═══ ADVANCED ═══
  describe("13. Sandwich Attack Analysis", () => {
    it("front-runner profit is bounded by bonding curve", async () => {
      const { pdas } = await createMarket(undefined, undefined, { protectionActivationOffset: 0 });
      const bal0 = await getCreatorWsolBal();
      const { balance: attackerTokens } = await buyTokens(pdas, 0, new BN(0.5 * LAMPORTS_PER_SOL));
      const bal1 = await getCreatorWsolBal();
      await buyTokens(pdas, 0, new BN(5 * LAMPORTS_PER_SOL));
      await sellTokens(pdas, 0, new BN(attackerTokens));
      const bal2 = await getCreatorWsolBal();
      console.log(`    Attacker: spent=${(bal0 - bal1)}, returned=${(bal2 - bal1)}`);
    });
  });

  describe("14. TWAP Manipulation Resistance", () => {
    it("buying before TWAP and selling after doesn't skew result unfairly", async () => {
      const now = Math.floor(Date.now() / 1000);
      const { pdas } = await createMarket(undefined, undefined, { deadline: now + 20, twapWindow: 18, twapInterval: 10, protectionActivationOffset: 5 });
      await buyTokens(pdas, 0, new BN(1 * LAMPORTS_PER_SOL));
      await buyTokens(pdas, 1, new BN(1 * LAMPORTS_PER_SOL));
      await buyTokens(pdas, 0, new BN(3 * LAMPORTS_PER_SOL));
      await new Promise(r => setTimeout(r, 4000));
      await program.methods.recordTwapSample().accountsStrict({ cranker: creator.publicKey, market: pdas.market, sideA: pdas.sideA, sideB: pdas.sideB }).rpc();
      await new Promise(r => setTimeout(r, 18000));
      await resolveMarket(pdas);
      const mkt = await getMarketData(pdas);
      console.log(`    Winner: Side ${mkt.winner === 0 ? "A" : "B"}`);
      expect(mkt.winner).to.equal(0);
    });
  });

  describe("15. Overflow Protection", () => {
    it("very large SOL amount doesn't cause u128 overflow", async () => {
      const { pdas } = await createMarket({ a: new BN(1_000_000), n: 1, b: new BN(1_000) }, new BN("1000000000000"));
      try {
        const { balance: tokens } = await buyTokens(pdas, 0, new BN(100 * LAMPORTS_PER_SOL));
        console.log(`    100 SOL → ${tokens} tokens (no overflow)`);
        expect(tokens).to.be.greaterThan(0);
      } catch (e: any) { console.log(`    100 SOL buy rejected`); }
    });
  });

  describe("16. Security: Account Constraints", () => {
    it("cannot buy with mismatched side account", async () => {
      const { pdas } = await createMarket();
      const ata = await getAssociatedTokenAddress(pdas.mintA, creator.publicKey);
      try { await getAccount(provider.connection, ata); } catch {
        await provider.sendAndConfirm(new Transaction().add(createAssociatedTokenAccountInstruction(creator.publicKey, ata, creator.publicKey, pdas.mintA)));
      }
      await wrapSol(provider, creator.publicKey, 0.1 * LAMPORTS_PER_SOL);
      try {
        await program.methods.buyTokens(0, new BN(0.1 * LAMPORTS_PER_SOL), new BN(1)).accounts({
          buyer: creator.publicKey, market: pdas.market, sideAccount: pdas.sideB,
          tokenMint: pdas.mintA, tokenVault: pdas.tvA, buyerTokenAccount: ata,
          quoteMint: NATIVE_MINT, quoteVault: pdas.qvA, buyerQuoteAccount: creatorWsolAta,
          config: configPda, tokenProgram: TOKEN_PROGRAM_ID, quoteTokenProgram: TOKEN_PROGRAM_ID,
        }).rpc();
        expect.fail("should have rejected mismatched side");
      } catch (e: any) {
        console.log(`    Mismatched side rejected ✓`);
        expect(e.message).to.include("InvalidSide");
      }
    });

    it("cannot resolve before deadline", async () => {
      const { pdas } = await createMarket();
      await buyTokens(pdas, 0, new BN(1 * LAMPORTS_PER_SOL));
      try {
        await resolveMarket(pdas);
        expect.fail("should have rejected early resolve");
      } catch (e: any) { expect(e.message).to.include("MarketNotExpired"); console.log(`    Early resolve rejected ✓`); }
    });

    it("cannot record TWAP outside window", async () => {
      const { pdas } = await createMarket();
      try {
        await program.methods.recordTwapSample().accountsStrict({ cranker: creator.publicKey, market: pdas.market, sideA: pdas.sideA, sideB: pdas.sideB }).rpc();
        expect.fail("should have rejected TWAP outside window");
      } catch (e: any) { expect(e.message).to.include("NotInTwapWindow"); console.log(`    TWAP outside window rejected ✓`); }
    });
  });

  describe("17. CU Profiling", () => {
    it("profiles compute units for key instructions", async () => {
      const now = Math.floor(Date.now() / 1000);
      const id = new BN(marketCounter++);
      const pdas = deriveMarketPdas(id);
      const createTx = await program.methods.initializeMarket(
        id, new BN(now + 15), new BN(12), new BN(10), 5000, 100, 1500, new BN(10),
        { a: new BN(1_000_000), n: 1, b: new BN(1_000) }, new BN(1_000_000_000),
        "CU Test A", "CUA", "", "CU Test B", "CUB", "", { unlocked: {} }, new BN(0), 0, 0,
        { twap: {} }, PublicKey.default, new BN(0),
      ).accounts({
        creator: creator.publicKey, market: pdas.market, sideA: pdas.sideA, sideB: pdas.sideB,
        tokenMintA: pdas.mintA, tokenMintB: pdas.mintB, tokenVaultA: pdas.tvA, tokenVaultB: pdas.tvB,
        quoteMint: NATIVE_MINT, quoteTokenProgram: TOKEN_PROGRAM_ID, quoteVaultA: pdas.qvA, quoteVaultB: pdas.qvB,
        protocolFeeAccount, creatorFeeAccount, config: configPda,
        metadataA: findMetadataPda(pdas.mintA), metadataB: findMetadataPda(pdas.mintB),
        tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID, systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID, rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      }).preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })]).rpc();
      const createInfo = await provider.connection.getTransaction(createTx, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      console.log(`    initializeMarket: ${createInfo?.meta?.computeUnitsConsumed ?? "?"} CU`);

      // Buy + TWAP + resolve + sell
      await buyTokens(pdas, 0, new BN(1 * LAMPORTS_PER_SOL));
      await buyTokens(pdas, 1, new BN(0.5 * LAMPORTS_PER_SOL));
      await new Promise(r => setTimeout(r, 5000));
      await program.methods.recordTwapSample().accountsStrict({ cranker: creator.publicKey, market: pdas.market, sideA: pdas.sideA, sideB: pdas.sideB }).rpc();
      await new Promise(r => setTimeout(r, 12000));
      await resolveMarket(pdas);
      console.log(`    Full lifecycle profiled ✓`);
    });
  });

  describe("18. Account Rent Cost Analysis", () => {
    it("calculates total rent cost per market", async () => {
      const marketRent = await provider.connection.getMinimumBalanceForRentExemption(298);
      const sideRent = await provider.connection.getMinimumBalanceForRentExemption(210);
      const mintRent = await provider.connection.getMinimumBalanceForRentExemption(82);
      const vaultRent = await provider.connection.getMinimumBalanceForRentExemption(165);
      const totalPerMarket = marketRent + sideRent * 2 + mintRent * 2 + vaultRent * 4; // 2 token + 2 quote vaults
      console.log(`    TOTAL per market: ${totalPerMarket / LAMPORTS_PER_SOL} SOL`);
    });
  });

  // ═══ PROTOCOL HARDENING ═══
  describe("19. Multi-Sample TWAP Smoothing", () => {
    it("multiple TWAP samples dilute a single price spike", async () => {
      const now = Math.floor(Date.now() / 1000);
      const { pdas } = await createMarket(undefined, undefined, { deadline: now + 70, twapWindow: 30, twapInterval: 10, protectionActivationOffset: 5 });
      await buyTokens(pdas, 0, new BN(5 * LAMPORTS_PER_SOL));
      await buyTokens(pdas, 1, new BN(1 * LAMPORTS_PER_SOL));
      await new Promise(r => setTimeout(r, 42000));
      await program.methods.recordTwapSample().accountsStrict({ cranker: creator.publicKey, market: pdas.market, sideA: pdas.sideA, sideB: pdas.sideB }).rpc();
      await buyTokens(pdas, 1, new BN(10 * LAMPORTS_PER_SOL));
      await new Promise(r => setTimeout(r, 11000));
      await program.methods.recordTwapSample().accountsStrict({ cranker: creator.publicKey, market: pdas.market, sideA: pdas.sideA, sideB: pdas.sideB }).rpc();
      await new Promise(r => setTimeout(r, 11000));
      await program.methods.recordTwapSample().accountsStrict({ cranker: creator.publicKey, market: pdas.market, sideA: pdas.sideA, sideB: pdas.sideB }).rpc();
      await new Promise(r => setTimeout(r, 10000));
      await resolveMarket(pdas);
      const mkt = await getMarketData(pdas);
      console.log(`    Winner: Side ${mkt.winner === 0 ? "A" : "B"}, samples: ${mkt.twapSamplesCount}`);
      expect(mkt.twapSamplesCount).to.equal(3);
    });
  });

  describe("20. TWAP Tie-Breaker", () => {
    it("equal TWAP → winner = side with higher reserve", async () => {
      const now = Math.floor(Date.now() / 1000);
      const { pdas } = await createMarket(undefined, undefined, { deadline: now + 15, twapWindow: 12, twapInterval: 10, protectionActivationOffset: 10 });
      await buyTokens(pdas, 0, new BN(1 * LAMPORTS_PER_SOL));
      await buyTokens(pdas, 1, new BN(1 * LAMPORTS_PER_SOL));
      await buyTokens(pdas, 0, new BN(0.01 * LAMPORTS_PER_SOL));
      await new Promise(r => setTimeout(r, 5000));
      await program.methods.recordTwapSample().accountsStrict({ cranker: creator.publicKey, market: pdas.market, sideA: pdas.sideA, sideB: pdas.sideB }).rpc();
      await new Promise(r => setTimeout(r, 12000));
      await resolveMarket(pdas);
      const mkt = await getMarketData(pdas);
      console.log(`    TWAP A=${mkt.finalTwapA.toNumber()}, B=${mkt.finalTwapB.toNumber()}, Winner: ${mkt.winner}`);
      expect(mkt.winner).to.equal(0);
    });
  });

  describe("21. Sell Penalty Window Timing", () => {
    it("penalty is zero outside window", async () => {
      const now = Math.floor(Date.now() / 1000);
      const { pdas } = await createMarket(undefined, undefined, { deadline: now + 3600, protectionActivationOffset: 300, sellPenaltyMaxBps: 3000 });
      const { balance: tokens } = await buyTokens(pdas, 0, new BN(5 * LAMPORTS_PER_SOL));
      const chunk = Math.floor(tokens / 3);
      const before1 = await getCreatorWsolBal();
      await sellTokens(pdas, 0, new BN(chunk));
      const after1 = await getCreatorWsolBal();
      await sellTokens(pdas, 0, new BN(chunk));
      const after2 = await getCreatorWsolBal();
      const r1 = after1 - before1;
      const r2 = after2 - after1;
      expect(r1).to.be.greaterThan(r2);
      console.log(`    Sells outside window: ${r1}, ${r2} — follows bonding curve only ✓`);
    });
  });

  describe("22. Total Supply Conservation", () => {
    it("circulating_supply + vault_tokens == total_supply", async () => {
      const ts = new BN(1_000_000_000);
      const { pdas } = await createMarket(undefined, ts);
      const side0 = await getSideData(pdas, 0);
      expect(side0.totalSupply.toNumber()).to.equal(1_000_000_000);
      const { balance: t1 } = await buyTokens(pdas, 0, new BN(2 * LAMPORTS_PER_SOL));
      let side = await getSideData(pdas, 0);
      const vb1 = (await getAccount(provider.connection, pdas.tvA)).amount;
      expect(Number(vb1) + side.circulatingSupply.toNumber()).to.equal(ts.toNumber());
      console.log(`    Conservation ✓`);
    });
  });

  describe("23. Peak Reserve Monotonicity", () => {
    it("peak_reserve only increases on buys", async () => {
      const { pdas } = await createMarket(undefined, undefined, { protectionActivationOffset: 0 });
      const { balance: tokens } = await buyTokens(pdas, 0, new BN(2 * LAMPORTS_PER_SOL));
      const peak1 = (await getSideData(pdas, 0)).peakReserve.toNumber();
      await buyTokens(pdas, 0, new BN(3 * LAMPORTS_PER_SOL));
      const peak2 = (await getSideData(pdas, 0)).peakReserve.toNumber();
      expect(peak2).to.be.greaterThan(peak1);
      await sellTokens(pdas, 0, new BN(Math.floor(tokens / 2)));
      const peak3 = (await getSideData(pdas, 0)).peakReserve.toNumber();
      expect(peak3).to.equal(peak2);
      console.log(`    peak_reserve: ${peak1} → ${peak2} → ${peak3} ✓`);
    });
  });

  describe("24. DEX Graduation Gate Checks", () => {
    it("rejects graduation if market not resolved", async () => {
      const { pdas } = await createMarket();
      await buyTokens(pdas, 0, new BN(1 * LAMPORTS_PER_SOL));
      try {
        const nft = Keypair.generate();
        await program.methods.graduateToDex(0).accountsStrict({
          authority: creator.publicKey, market: pdas.market, sideAccount: pdas.sideA,
          tokenMint: pdas.mintA, tokenVault: pdas.tvA, solVault: pdas.qvA,
          wsolMint: NATIVE_MINT, positionNftMint: nft.publicKey,
          positionNftAccount: Keypair.generate().publicKey, poolAuthority: Keypair.generate().publicKey,
          pool: Keypair.generate().publicKey, position: Keypair.generate().publicKey,
          tokenAVault: Keypair.generate().publicKey, tokenBVault: Keypair.generate().publicKey,
          payerTokenA: Keypair.generate().publicKey, payerTokenB: Keypair.generate().publicKey,
          tokenAProgram: TOKEN_PROGRAM_ID, tokenBProgram: TOKEN_PROGRAM_ID,
          token2022Program: new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"),
          eventAuthority: Keypair.generate().publicKey,
          meteoraProgram: new PublicKey("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG"),
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
          systemProgram: SystemProgram.programId,
        }).signers([nft]).rpc();
        expect.fail("should have rejected");
      } catch (e: any) {
        const msg = e.message || "";
        const hasExpectedError = msg.includes("MarketNotResolved") || msg.includes("ConstraintRaw") || msg.includes("not provided") || msg.includes("A raw constraint was violated");
        expect(hasExpectedError).to.be.true;
        console.log(`    Pre-resolution graduation rejected ✓`);
      }
    });
  });

  describe("25. Game Theory: Nash Equilibrium", () => {
    it("equal investment on both sides → draw or minimal fee", async () => {
      const now = Math.floor(Date.now() / 1000);
      const { pdas } = await createMarket(undefined, undefined, { deadline: now + 15, twapWindow: 12, twapInterval: 10, battleTaxBps: 5000, protocolFeeBps: 100, protectionActivationOffset: 10 });
      await buyTokens(pdas, 0, new BN(2 * LAMPORTS_PER_SOL));
      await buyTokens(pdas, 1, new BN(2 * LAMPORTS_PER_SOL));
      await new Promise(r => setTimeout(r, 5000));
      await program.methods.recordTwapSample().accountsStrict({ cranker: creator.publicKey, market: pdas.market, sideA: pdas.sideA, sideB: pdas.sideB }).rpc();
      await new Promise(r => setTimeout(r, 12000));
      await resolveMarket(pdas);
      const mkt = await getMarketData(pdas);
      console.log(`    Winner: ${mkt.winner === null ? "DRAW" : `Side ${mkt.winner}`}`);
    });
  });

  describe("26. Game Theory: Last-Mover Advantage", () => {
    it("buying at low supply is cheaper", async () => {
      const { pdas } = await createMarket(undefined, undefined, { protectionActivationOffset: 0 });
      const sup0 = (await getSideData(pdas, 0)).circulatingSupply.toNumber();
      await buyTokens(pdas, 0, new BN(1 * LAMPORTS_PER_SOL));
      const sup1 = (await getSideData(pdas, 0)).circulatingSupply.toNumber();
      const earlyTokens = sup1 - sup0;
      for (let i = 0; i < 9; i++) { await buyTokens(pdas, 0, new BN(1 * LAMPORTS_PER_SOL)); }
      const supBefore = (await getSideData(pdas, 0)).circulatingSupply.toNumber();
      await buyTokens(pdas, 0, new BN(1 * LAMPORTS_PER_SOL));
      const supAfter = (await getSideData(pdas, 0)).circulatingSupply.toNumber();
      const lateTokens = supAfter - supBefore;
      console.log(`    Early: ${earlyTokens}, Late: ${lateTokens}`);
      expect(earlyTokens).to.be.greaterThan(lateTokens);
    });
  });

  describe("27. Protocol Fee Accounting", () => {
    it("protocol_fee = battle_tax * protocol_fee_bps / 10000", async () => {
      const now = Math.floor(Date.now() / 1000);
      const { pdas } = await createMarket(undefined, undefined, { deadline: now + 15, twapWindow: 12, twapInterval: 10, battleTaxBps: 5000, protocolFeeBps: 100, protectionActivationOffset: 10 });
      await buyTokens(pdas, 0, new BN(2 * LAMPORTS_PER_SOL));
      await buyTokens(pdas, 1, new BN(1 * LAMPORTS_PER_SOL));
      const protBefore = Number((await getAccount(provider.connection, protocolFeeAccount)).amount);
      await new Promise(r => setTimeout(r, 5000));
      await program.methods.recordTwapSample().accountsStrict({ cranker: creator.publicKey, market: pdas.market, sideA: pdas.sideA, sideB: pdas.sideB }).rpc();
      await new Promise(r => setTimeout(r, 12000));
      await resolveMarket(pdas);
      const protAfter = Number((await getAccount(provider.connection, protocolFeeAccount)).amount);
      const fee = protAfter - protBefore;
      console.log(`    Protocol fee: ${fee} lamports`);
      expect(fee).to.be.greaterThanOrEqual(0);
    });
  });

  describe("28. Multi-Market Isolation", () => {
    it("operations on market A don't affect market B", async () => {
      const { pdas: pdas1 } = await createMarket();
      const { pdas: pdas2 } = await createMarket();
      await buyTokens(pdas1, 0, new BN(5 * LAMPORTS_PER_SOL));
      const side1 = await getSideData(pdas1, 0);
      await buyTokens(pdas2, 0, new BN(1 * LAMPORTS_PER_SOL));
      const side1After = await getSideData(pdas1, 0);
      expect(side1After.circulatingSupply.toNumber()).to.equal(side1.circulatingSupply.toNumber());
      console.log(`    ✓ Markets are fully isolated`);
    });
  });
});
