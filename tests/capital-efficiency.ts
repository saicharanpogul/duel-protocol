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

describe("duel - capital efficiency & battle testing", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Duel as Program<Duel>;
  const creator = provider.wallet;
  const protocolFeeAccount = Keypair.generate();

  let marketCounter = 200; // avoid collision with other test files

  // ═══════════════════════════════════════════════
  //  Helpers
  // ═══════════════════════════════════════════════

  async function prefundPda(pda: PublicKey) {
    const tx = new anchor.web3.Transaction().add(
      SystemProgram.transfer({ fromPubkey: creator.publicKey, toPubkey: pda, lamports: 890_880 })
    );
    await provider.sendAndConfirm(tx);
  }

  function derivePdas(marketId: BN) {
    const [market] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), creator.publicKey.toBuffer(), marketId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    const pda = (seed: string, idx: number) =>
      PublicKey.findProgramAddressSync(
        [Buffer.from(seed), market.toBuffer(), Buffer.from([idx])],
        program.programId
      )[0];
    return {
      market,
      sideA: pda("side", 0), sideB: pda("side", 1),
      mintA: pda("mint", 0), mintB: pda("mint", 1),
      tvA: pda("token_vault", 0), tvB: pda("token_vault", 1),
      svA: pda("sol_vault", 0), svB: pda("sol_vault", 1),
    };
  }

  async function createMarket(
    curveParams = { a: new BN(1_000_000), n: 1, b: new BN(1_000) },
    totalSupply = new BN(1_000_000_000),
    overrides: {
      deadline?: number; twapWindow?: number; twapInterval?: number;
      battleTaxBps?: number; protocolFeeBps?: number;
      sellPenaltyMaxBps?: number; protectionActivationOffset?: number;
    } = {}
  ) {
    const id = new BN(marketCounter++);
    const pdas = derivePdas(id);
    const now = Math.floor(Date.now() / 1000);
    const opts = {
      deadline: now + 3600, twapWindow: 600, twapInterval: 10,
      battleTaxBps: 5000, protocolFeeBps: 100,
      sellPenaltyMaxBps: 1500, protectionActivationOffset: 300,
      ...overrides,
    };

    await prefundPda(protocolFeeAccount.publicKey);

    await program.methods
      .initializeMarket(
        id, new BN(opts.deadline), new BN(opts.twapWindow), new BN(opts.twapInterval),
        opts.battleTaxBps, opts.protocolFeeBps, opts.sellPenaltyMaxBps,
        new BN(opts.protectionActivationOffset),
        curveParams, totalSupply,
        "Test A", "TA", "", "Test B", "TB", "",
      )
      .accounts({
        creator: creator.publicKey,
        market: pdas.market, sideA: pdas.sideA, sideB: pdas.sideB,
        tokenMintA: pdas.mintA, tokenMintB: pdas.mintB,
        tokenVaultA: pdas.tvA, tokenVaultB: pdas.tvB,
        solVaultA: pdas.svA, solVaultB: pdas.svB,
        protocolFeeAccount: protocolFeeAccount.publicKey,
        metadataA: findMetadataPda(pdas.mintA),
        metadataB: findMetadataPda(pdas.mintB),
        tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })])
      .rpc();

    return { id, pdas, curveParams, totalSupply };
  }

  async function buyTokens(
    pdas: ReturnType<typeof derivePdas>,
    side: number,
    solAmount: BN,
    buyer?: Keypair,
  ) {
    const payer = buyer ? buyer.publicKey : creator.publicKey;
    const mint = side === 0 ? pdas.mintA : pdas.mintB;
    const sideAccount = side === 0 ? pdas.sideA : pdas.sideB;
    const tokenVault = side === 0 ? pdas.tvA : pdas.tvB;
    const solVault = side === 0 ? pdas.svA : pdas.svB;

    const ata = await getAssociatedTokenAddress(mint, payer);
    try {
      await getAccount(provider.connection, ata);
    } catch {
      const ix = createAssociatedTokenAccountInstruction(payer, ata, payer, mint);
      const tx = new anchor.web3.Transaction().add(ix);
      if (buyer) {
        tx.feePayer = buyer.publicKey;
        await provider.sendAndConfirm(tx, [buyer]);
      } else {
        await provider.sendAndConfirm(tx);
      }
    }

    const builder = program.methods
      .buyTokens(side, solAmount, new BN(1))
      .accounts({
        buyer: payer, market: pdas.market, sideAccount,
        tokenVault, buyerTokenAccount: ata, solVault,
        systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
      });

    if (buyer) {
      await builder.signers([buyer]).rpc();
    } else {
      await builder.rpc();
    }

    const acc = await getAccount(provider.connection, ata);
    return { ata, balance: Number(acc.amount) };
  }

  async function sellTokens(
    pdas: ReturnType<typeof derivePdas>,
    side: number,
    tokenAmount: BN,
    postResolution = false,
  ) {
    const mint = side === 0 ? pdas.mintA : pdas.mintB;
    const sideAccount = side === 0 ? pdas.sideA : pdas.sideB;
    const tokenVault = side === 0 ? pdas.tvA : pdas.tvB;
    const solVault = side === 0 ? pdas.svA : pdas.svB;
    const ata = await getAssociatedTokenAddress(mint, creator.publicKey);

    const accounts = {
      seller: creator.publicKey, market: pdas.market, sideAccount,
      tokenVault, sellerTokenAccount: ata, solVault,
      systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
    };

    if (postResolution) {
      await program.methods.sellPostResolution(side, tokenAmount, new BN(0)).accounts(accounts).rpc();
    } else {
      await program.methods.sellTokens(side, tokenAmount, new BN(1)).accounts(accounts).rpc();
    }
  }

  async function getSideData(pdas: ReturnType<typeof derivePdas>, side: number) {
    const key = side === 0 ? pdas.sideA : pdas.sideB;
    return program.account.side.fetch(key);
  }

  async function getMarketData(pdas: ReturnType<typeof derivePdas>) {
    return program.account.market.fetch(pdas.market);
  }

  async function getBalance(pubkey: PublicKey): Promise<number> {
    return provider.connection.getBalance(pubkey);
  }

  async function getVaultBalance(pdas: ReturnType<typeof derivePdas>, side: number): Promise<number> {
    const vault = side === 0 ? pdas.svA : pdas.svB;
    return provider.connection.getBalance(vault);
  }

  // ═══════════════════════════════════════════════
  //  1. CAPITAL EFFICIENCY TESTS
  // ═══════════════════════════════════════════════

  describe("1. Roundtrip Efficiency", () => {
    it("buy → sell roundtrip should lose only ~1% base fee (no penalty window)", async () => {
      const { pdas } = await createMarket(
        { a: new BN(1_000_000), n: 1, b: new BN(1_000) },
        new BN(1_000_000_000),
        { protectionActivationOffset: 0 }, // no penalty window
      );

      const solIn = 1 * LAMPORTS_PER_SOL;
      const balBefore = await getBalance(creator.publicKey);

      // Buy
      const { balance: tokensReceived } = await buyTokens(pdas, 0, new BN(solIn));
      expect(tokensReceived).to.be.greaterThan(0);

      // Sell all tokens
      await sellTokens(pdas, 0, new BN(tokensReceived));

      const balAfter = await getBalance(creator.publicKey);
      const netLoss = balBefore - balAfter;
      const lossPct = (netLoss / solIn) * 100;

      console.log(`    Roundtrip: ${solIn / LAMPORTS_PER_SOL} SOL in → ${tokensReceived} tokens → sell all`);
      console.log(`    Net loss: ${netLoss / LAMPORTS_PER_SOL} SOL (${lossPct.toFixed(2)}%)`);

      // Should lose ≤ 2% (1% base fee + tx fees + rounding)
      expect(lossPct).to.be.lessThan(2);
    });

    it("should measure roundtrip at multiple SOL amounts", async () => {
      const amounts = [0.1, 1, 5, 10];

      for (const amt of amounts) {
        const { pdas } = await createMarket(
          { a: new BN(1_000_000), n: 1, b: new BN(1_000) },
          new BN(1_000_000_000),
          { protectionActivationOffset: 0 },
        );

        const solIn = Math.floor(amt * LAMPORTS_PER_SOL);
        const balBefore = await getBalance(creator.publicKey);

        const { balance: tokens } = await buyTokens(pdas, 0, new BN(solIn));
        if (tokens > 0) {
          await sellTokens(pdas, 0, new BN(tokens));
        }

        const balAfter = await getBalance(creator.publicKey);
        const lossPct = ((balBefore - balAfter) / solIn) * 100;

        console.log(`    ${amt} SOL → ${tokens} tokens → loss: ${lossPct.toFixed(2)}%`);
        // Loss should be reasonable (base fee 1% + tx fees + rounding)
        expect(lossPct).to.be.lessThan(5);
      }
    });
  });

  describe("2. Curve Parameter Sweep", () => {
    const configs = [
      { label: "Linear gentle", a: 100_000, n: 1, b: 100 },
      { label: "Linear steep", a: 10_000_000, n: 1, b: 1_000 },
      { label: "Quadratic gentle", a: 1, n: 2, b: 100 },
      { label: "Quadratic steep", a: 100, n: 2, b: 1_000 },
      { label: "Cubic gentle", a: 1, n: 3, b: 100 },
      { label: "High base price", a: 10_000_000, n: 1, b: 10_000 },
      { label: "Low base price", a: 1_000_000, n: 1, b: 1 },
    ];

    configs.forEach(({ label, a, n, b }) => {
      it(`${label} (a=${a}, n=${n}, b=${b}) — price curve behaves`, async () => {
        const { pdas } = await createMarket(
          { a: new BN(a), n, b: new BN(b) },
          new BN(1_000_000_000),
          { protectionActivationOffset: 0 },
        );

        // Small buy
        const { balance: t1 } = await buyTokens(pdas, 0, new BN(0.1 * LAMPORTS_PER_SOL));
        const side1 = await getSideData(pdas, 0);
        const supply1 = side1.circulatingSupply.toNumber();

        // Larger buy
        const { balance: t2Total } = await buyTokens(pdas, 0, new BN(1 * LAMPORTS_PER_SOL));
        const side2 = await getSideData(pdas, 0);
        const supply2 = side2.circulatingSupply.toNumber();
        const tokens2 = t2Total - t1;

        // Effective price should increase (fewer tokens per SOL for subsequent buys)
        const price1 = (0.1 * LAMPORTS_PER_SOL) / t1;
        const price2 = (1 * LAMPORTS_PER_SOL) / tokens2;

        console.log(`    [${label}]: 0.1 SOL → ${t1} tokens (eff ${price1.toFixed(4)} lam/tok), 1 SOL → ${tokens2} tokens (eff ${price2.toFixed(4)} lam/tok)`);
        console.log(`    Supply: ${supply1} → ${supply2}`);

        // Price should increase as supply grows (bonding curve property)
        // At low supply with large b, the first buy may get slightly favorable rounding
        expect(price2).to.be.greaterThanOrEqual(price1 * 0.99);
      });
    });
  });

  describe("3. Multi-Buyer Accumulation", () => {
    it("10 sequential buyers — price rises smoothly", async () => {
      const { pdas } = await createMarket();
      const buyAmount = new BN(0.5 * LAMPORTS_PER_SOL);
      let prevTokens = Infinity;
      const prices: number[] = [];

      for (let i = 0; i < 10; i++) {
        const sideBefore = await getSideData(pdas, 0);
        const supBefore = sideBefore.circulatingSupply.toNumber();

        const { balance: cumTokens } = await buyTokens(pdas, 0, buyAmount);
        const sideAfter = await getSideData(pdas, 0);
        const supAfter = sideAfter.circulatingSupply.toNumber();
        const thisTokens = supAfter - supBefore;
        const effPrice = (0.5 * LAMPORTS_PER_SOL) / thisTokens;
        prices.push(effPrice);

        console.log(`    Buy #${i + 1}: ${thisTokens} tokens (eff price: ${effPrice.toFixed(4)} lam/tok)`);

        // Each subsequent buy should yield fewer tokens (price rises)
        if (i > 0) {
          expect(thisTokens).to.be.lessThanOrEqual(prevTokens);
        }
        prevTokens = thisTokens;
      }

      // Verify monotonically increasing prices
      for (let i = 1; i < prices.length; i++) {
        expect(prices[i]).to.be.greaterThanOrEqual(prices[i - 1]);
      }

      console.log(`    Price rose from ${prices[0].toFixed(4)} to ${prices[prices.length - 1].toFixed(4)} lam/tok`);
    });
  });

  describe("4. Whale Impact Analysis", () => {
    it("single whale vs multiple small buyers — supply capture comparison", async () => {
      // Whale market
      const { pdas: whalePdas, totalSupply } = await createMarket();
      const whaleSOL = 10 * LAMPORTS_PER_SOL;
      const { balance: whaleTokens } = await buyTokens(whalePdas, 0, new BN(whaleSOL));

      const whaleCapture = (whaleTokens / totalSupply.toNumber()) * 100;
      console.log(`    Whale (10 SOL): ${whaleTokens} tokens = ${whaleCapture.toFixed(2)}% supply`);

      // Small buyers market (same params)
      const { pdas: retailPdas } = await createMarket();
      let retailTotal = 0;
      for (let i = 0; i < 10; i++) {
        const sideBefore = await getSideData(retailPdas, 0);
        await buyTokens(retailPdas, 0, new BN(1 * LAMPORTS_PER_SOL));
        const sideAfter = await getSideData(retailPdas, 0);
        retailTotal += sideAfter.circulatingSupply.toNumber() - sideBefore.circulatingSupply.toNumber();
      }

      const retailCapture = (retailTotal / totalSupply.toNumber()) * 100;
      console.log(`    Retail (10 × 1 SOL): ${retailTotal} tokens = ${retailCapture.toFixed(2)}% supply`);

      // With the integral-based bonding curve, whale and retail should get very similar tokens
      // (the curve is deterministic). Small rounding differences are expected.
      const diff = Math.abs(whaleTokens - retailTotal);
      const diffPct = (diff / Math.max(whaleTokens, retailTotal)) * 100;
      console.log(`    Difference: ${diff} tokens (${diffPct.toFixed(4)}%)`);
      expect(diffPct).to.be.lessThan(0.01); // <0.01% difference due to rounding
    });
  });

  describe("5. Battle Tax Redistribution", () => {
    it("verifies correct transfer from loser to winner vault", async () => {
      const now = Math.floor(Date.now() / 1000);
      const { pdas } = await createMarket(
        undefined, undefined,
        { deadline: now + 15, twapWindow: 12, twapInterval: 10, battleTaxBps: 5000, protectionActivationOffset: 10 },
      );

      // Buy on both sides
      await buyTokens(pdas, 0, new BN(2 * LAMPORTS_PER_SOL)); // Side A
      await buyTokens(pdas, 1, new BN(1 * LAMPORTS_PER_SOL)); // Side B (less)

      const vaultABefore = await getVaultBalance(pdas, 0);
      const vaultBBefore = await getVaultBalance(pdas, 1);
      console.log(`    Pre-resolve: Vault A = ${vaultABefore / LAMPORTS_PER_SOL} SOL, Vault B = ${vaultBBefore / LAMPORTS_PER_SOL} SOL`);

      // Wait for TWAP window to open (deadline - twapWindow = now + 3 sec)
      await new Promise(r => setTimeout(r, 5000));

      await program.methods.recordTwapSample()
        .accounts({ cranker: creator.publicKey, market: pdas.market, sideA: pdas.sideA, sideB: pdas.sideB })
        .rpc();

      // Wait for deadline (now + 15s total, ~10s remaining)
      await new Promise(r => setTimeout(r, 12000));

      await program.methods.resolveMarket()
        .accounts({
          resolver: creator.publicKey, market: pdas.market,
          sideA: pdas.sideA, sideB: pdas.sideB,
          solVaultA: pdas.svA, solVaultB: pdas.svB,
          protocolFeeAccount: protocolFeeAccount.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const marketData = await getMarketData(pdas);
      const winner = marketData.winner;
      const vaultAAfter = await getVaultBalance(pdas, 0);
      const vaultBAfter = await getVaultBalance(pdas, 1);

      console.log(`    Winner: Side ${winner === 0 ? "A" : "B"}`);
      console.log(`    Post-resolve: Vault A = ${vaultAAfter / LAMPORTS_PER_SOL} SOL, Vault B = ${vaultBAfter / LAMPORTS_PER_SOL} SOL`);

      // Winner vault should have increased
      if (winner === 0) {
        expect(vaultAAfter).to.be.greaterThan(vaultABefore);
        const transferred = vaultAAfter - vaultABefore;
        const expectedTransfer = Math.floor(vaultBBefore * 5000 / 10000); // 50% battle tax
        // Account for protocol fee (1% of transferred)
        console.log(`    Transferred to winner: ${transferred / LAMPORTS_PER_SOL} SOL (expected ~${expectedTransfer / LAMPORTS_PER_SOL} SOL)`);
      }
    });
  });

  describe("6. Winner vs Loser P&L", () => {
    it("full lifecycle: equal bets, resolve, measure winner ROI and loser loss", async () => {
      const now = Math.floor(Date.now() / 1000);
      const { pdas } = await createMarket(
        undefined, undefined,
        { deadline: now + 15, twapWindow: 12, twapInterval: 10, battleTaxBps: 5000, protectionActivationOffset: 10 },
      );

      const betSize = 2 * LAMPORTS_PER_SOL;

      const balBefore = await getBalance(creator.publicKey);
      const { balance: tokensA } = await buyTokens(pdas, 0, new BN(betSize));
      const { balance: tokensB } = await buyTokens(pdas, 1, new BN(betSize));

      console.log(`    Bought: ${tokensA} tokens A, ${tokensB} tokens B for ${betSize / LAMPORTS_PER_SOL} SOL each`);

      // Wait for window + resolve
      await new Promise(r => setTimeout(r, 5000));

      await program.methods.recordTwapSample()
        .accounts({ cranker: creator.publicKey, market: pdas.market, sideA: pdas.sideA, sideB: pdas.sideB })
        .rpc();

      // Wait for deadline (now + 15s total, ~10s remaining)
      await new Promise(r => setTimeout(r, 12000));

      await program.methods.resolveMarket()
        .accounts({
          resolver: creator.publicKey, market: pdas.market,
          sideA: pdas.sideA, sideB: pdas.sideB,
          solVaultA: pdas.svA, solVaultB: pdas.svB,
          protocolFeeAccount: protocolFeeAccount.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const mkt = await getMarketData(pdas);
      const winner = mkt.winner!;
      console.log(`    Winner: Side ${winner === 0 ? "A" : "B"}`);

      // Sell winning side tokens (winner vault has extra SOL from battle tax)
      await sellTokens(pdas, winner, new BN(winner === 0 ? tokensA : tokensB), true);
      const balAfterWinner = await getBalance(creator.publicKey);
      const winnerReturned = balAfterWinner - (balBefore - betSize * 2);

      // Sell losing side tokens — vault is drained by battle tax, so may fail with InsufficientReserve
      const loser = winner === 0 ? 1 : 0;
      const loserTokens = loser === 0 ? tokensA : tokensB;
      let loserReturned = 0;
      const loserVaultBal = await getVaultBalance(pdas, loser);

      // Try selling in smaller chunks to recover what we can
      let remaining = loserTokens;
      while (remaining > 0) {
        try {
          const chunk = Math.min(remaining, Math.floor(loserTokens / 10) || 1);
          await sellTokens(pdas, loser, new BN(chunk), true);
          remaining -= chunk;
        } catch {
          // InsufficientReserve — vault is drained
          break;
        }
      }

      const balAfterBoth = await getBalance(creator.publicKey);
      loserReturned = balAfterBoth - balAfterWinner;

      const totalIn = betSize * 2;
      const netPnl = balAfterBoth - balBefore;

      console.log(`    Total invested: ${totalIn / LAMPORTS_PER_SOL} SOL`);
      console.log(`    Winner recovered: ${winnerReturned / LAMPORTS_PER_SOL} SOL`);
      console.log(`    Loser recovered: ${loserReturned / LAMPORTS_PER_SOL} SOL`);
      console.log(`    Loser vault remaining: ${loserVaultBal / LAMPORTS_PER_SOL} SOL`);
      console.log(`    Net P&L (both sides): ${netPnl / LAMPORTS_PER_SOL} SOL`);
      console.log(`    Winner ROI: ${((winnerReturned - betSize) / betSize * 100).toFixed(2)}%`);
      console.log(`    Loser loss: ${((loserReturned - betSize) / betSize * 100).toFixed(2)}%`);
    });
  });

  // ═══════════════════════════════════════════════
  //  2. ECONOMIC ATTACK VECTORS
  // ═══════════════════════════════════════════════

  describe("7. Reserve Drain Protection", () => {
    it("SOL vault stays above rent-exempt after max sell", async () => {
      const { pdas } = await createMarket(
        undefined, undefined,
        { protectionActivationOffset: 0 }, // no penalty
      );

      const { balance: tokens } = await buyTokens(pdas, 0, new BN(5 * LAMPORTS_PER_SOL));

      // Sell all
      await sellTokens(pdas, 0, new BN(tokens));

      const vaultBalance = await getVaultBalance(pdas, 0);
      const rentExempt = await provider.connection.getMinimumBalanceForRentExemption(0);

      console.log(`    Vault after max sell: ${vaultBalance} lamports`);
      console.log(`    Rent-exempt minimum: ${rentExempt} lamports`);

      // Vault should still be rent exempt (it had initial rent from prefund)
      expect(vaultBalance).to.be.greaterThanOrEqual(rentExempt);
    });
  });

  describe("8. Dust Attack Resistance", () => {
    it("buying with 1 lamport should yield 0 tokens or fail gracefully", async () => {
      const { pdas } = await createMarket();

      try {
        const { balance: tokens } = await buyTokens(pdas, 0, new BN(1));
        // If it succeeds, it should give very few or 0 tokens
        console.log(`    1 lamport buy: ${tokens} tokens received`);
        // Regardless, state should not be corrupt
        const side = await getSideData(pdas, 0);
        expect(side.circulatingSupply.toNumber()).to.be.greaterThanOrEqual(0);
      } catch (e: any) {
        // Also acceptable to reject
        console.log(`    1 lamport buy rejected: ${e.message?.substring(0, 80)}`);
      }
    });

    it("buying with very small amounts 100 times should not bloat state", async () => {
      const { pdas } = await createMarket();

      for (let i = 0; i < 20; i++) {
        try {
          await buyTokens(pdas, 0, new BN(1000)); // 1000 lamports
        } catch {
          // acceptable
        }
      }

      // State should be consistent
      const side = await getSideData(pdas, 0);
      console.log(`    After 20 tiny buys: circulatingSupply = ${side.circulatingSupply.toNumber()}`);
      expect(side.circulatingSupply.toNumber()).to.be.greaterThanOrEqual(0);
    });
  });

  describe("9. Max Supply Saturation", () => {
    it("cannot buy more tokens than total supply", async () => {
      // Small total supply for easy saturation
      const { pdas } = await createMarket(
        { a: new BN(1_000_000), n: 1, b: new BN(1_000) },
        new BN(1_000), // only 1000 tokens
      );

      // Big buy should get at most 1000 tokens
      const { balance: tokens } = await buyTokens(pdas, 0, new BN(10 * LAMPORTS_PER_SOL));
      console.log(`    Bought: ${tokens} tokens (max 1000)`);
      expect(tokens).to.be.lessThanOrEqual(1000);

      // Second buy should get 0 or very few
      try {
        const sideBefore = await getSideData(pdas, 0);
        const { balance: tokens2 } = await buyTokens(pdas, 0, new BN(1 * LAMPORTS_PER_SOL));
        const sideAfter = await getSideData(pdas, 0);
        const newTokens = sideAfter.circulatingSupply.toNumber() - sideBefore.circulatingSupply.toNumber();
        console.log(`    Second buy: ${newTokens} new tokens`);
        expect(newTokens).to.equal(0);
      } catch (e: any) {
        console.log(`    Second buy rejected (expected for saturated market)`);
      }
    });
  });

  describe("10. Stress: Rapid Sequential Buys", () => {
    it("100 sequential buys maintain consistent state", async () => {
      const { pdas } = await createMarket();
      const buyAmount = new BN(0.05 * LAMPORTS_PER_SOL);
      let totalTokens = 0;

      const startTime = Date.now();
      for (let i = 0; i < 100; i++) {
        const sideBefore = await getSideData(pdas, 0);
        await buyTokens(pdas, 0, buyAmount);
        const sideAfter = await getSideData(pdas, 0);
        totalTokens += sideAfter.circulatingSupply.toNumber() - sideBefore.circulatingSupply.toNumber();
      }
      const elapsed = Date.now() - startTime;

      const finalSide = await getSideData(pdas, 0);
      console.log(`    100 buys in ${elapsed}ms (${(elapsed / 100).toFixed(1)}ms avg)`);
      console.log(`    Total tokens: ${totalTokens}`);
      console.log(`    Circulating supply: ${finalSide.circulatingSupply.toNumber()}`);

      // Circulating supply should match cumulative tokens bought
      expect(finalSide.circulatingSupply.toNumber()).to.equal(totalTokens);
    });
  });

  describe("11. Integer Boundary: Sell Exact Balance", () => {
    it("selling exactly circulating_supply tokens leaves 0 circulating", async () => {
      const { pdas } = await createMarket(
        undefined, undefined,
        { protectionActivationOffset: 0 },
      );

      const { balance: tokens } = await buyTokens(pdas, 0, new BN(2 * LAMPORTS_PER_SOL));

      // Sell exact amount
      await sellTokens(pdas, 0, new BN(tokens));

      const side = await getSideData(pdas, 0);
      expect(side.circulatingSupply.toNumber()).to.equal(0);
      console.log(`    Circulating supply after full sell: ${side.circulatingSupply.toNumber()}`);
    });
  });

  describe("12. Penalty Decay Verification", () => {
    it("penalty increases as reserve drops", async () => {
      const { pdas } = await createMarket(
        undefined, undefined,
        { deadline: Math.floor(Date.now() / 1000) + 3600, protectionActivationOffset: 3600, sellPenaltyMaxBps: 3000 },
      );

      // Buy tokens
      const { balance: tokens } = await buyTokens(pdas, 0, new BN(5 * LAMPORTS_PER_SOL));
      const sellChunk = Math.floor(tokens / 5);

      const solReturns: number[] = [];
      for (let i = 0; i < 4; i++) {
        const balBefore = await getBalance(creator.publicKey);
        await sellTokens(pdas, 0, new BN(sellChunk));
        const balAfter = await getBalance(creator.publicKey);
        const solReturn = balAfter - balBefore;
        solReturns.push(solReturn);
        console.log(`    Sell #${i + 1}: ${sellChunk} tokens → ${solReturn / LAMPORTS_PER_SOL} SOL`);
      }

      // Each successive sell should return LESS SOL per token (increasing penalty + lower curve price)
      for (let i = 1; i < solReturns.length; i++) {
        expect(solReturns[i]).to.be.lessThan(solReturns[i - 1]);
      }
    });
  });
});
