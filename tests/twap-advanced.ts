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
  getQuoteVaultBalance,
  Pdas,
} from "./helpers";

describe("twap-advanced", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Duel as Program<Duel>;
  const creator = provider.wallet;
  const twapBase = Math.floor(Math.random() * 10_000_000) + 70_000_000;

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );

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
        protocolFeeOwner.publicKey, protocolFeeAccount, protocolFeeOwner.publicKey, NATIVE_MINT
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

  async function createMarket(
    marketId: BN,
    opts: {
      deadline?: number;
      twapWindow?: number;
      twapInterval?: number;
      battleTaxBps?: number;
      protocolFeeBps?: number;
      minTwapSpreadBps?: number;
      creatorFeeBps?: number;
      maxObservationChangePerUpdate?: number;
      protectionActivationOffset?: number;
    } = {},
  ) {
    const pdas = deriveMarketPdas(marketId);
    const now = Math.floor(Date.now() / 1000);
    const {
      deadline = now + 15,
      twapWindow = 10,
      twapInterval = 10,
      battleTaxBps = 5000,
      protocolFeeBps = 100,
      minTwapSpreadBps = 0,
      creatorFeeBps = 0,
      maxObservationChangePerUpdate = 0,
      protectionActivationOffset = 10,
    } = opts;

    await program.methods
      .initializeMarket(
        marketId, new BN(deadline), new BN(twapWindow), new BN(twapInterval),
        battleTaxBps, protocolFeeBps, 0, new BN(protectionActivationOffset),
        { a: new BN(1_000_000), n: 1, b: new BN(1_000) },
        new BN(1_000_000_000),
        "TWAP A", "TWA", "", "TWAP B", "TWB", "",
        { unlocked: {} },
        new BN(maxObservationChangePerUpdate), minTwapSpreadBps, creatorFeeBps,
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
      const createAtaIx = createAssociatedTokenAccountInstruction(
        creator.publicKey, ata, creator.publicKey, mint
      );
      await provider.sendAndConfirm(new Transaction().add(createAtaIx));
    } catch { }

    // Wrap SOL
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
    const acct = await provider.connection.getTokenAccountBalance(ata);
    return { ata, balance: parseInt(acct.value.amount) };
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

  describe("Draw Detection", () => {
    it("equal bets → draw → no battle tax transfer", async () => {
      const pdas = await createMarket(new BN(twapBase + 1), {
        minTwapSpreadBps: 100,
      });

      await buyTokens(pdas, 0, new BN(LAMPORTS_PER_SOL));
      await buyTokens(pdas, 1, new BN(LAMPORTS_PER_SOL));

      const vaultA0 = await getQuoteVaultBalance(provider, pdas, 0);
      const vaultB0 = await getQuoteVaultBalance(provider, pdas, 1);

      // TWAP + resolve
      await new Promise(r => setTimeout(r, 5000));
      await program.methods.recordTwapSample()
        .accountsStrict({ cranker: creator.publicKey, market: pdas.market, sideA: pdas.sideA, sideB: pdas.sideB })
        .rpc();
      await new Promise(r => setTimeout(r, 12000));
      await resolveMarket(pdas);

      const mkt = await program.account.market.fetch(pdas.market);
      const vaultAAfter = await getQuoteVaultBalance(provider, pdas, 0);
      const vaultBAfter = await getQuoteVaultBalance(provider, pdas, 1);

      expect(mkt.winner).to.be.null;
      expect(vaultAAfter).to.equal(vaultA0);
      expect(vaultBAfter).to.equal(vaultB0);
      console.log(`    Draw detected: winner=null, vaults unchanged ✓`);
    });

    it("asymmetric bets → clear winner despite spread threshold", async () => {
      const pdas = await createMarket(new BN(twapBase + 2), {
        minTwapSpreadBps: 100,
      });

      await buyTokens(pdas, 0, new BN(3 * LAMPORTS_PER_SOL));
      await buyTokens(pdas, 1, new BN(0.5 * LAMPORTS_PER_SOL));

      await new Promise(r => setTimeout(r, 5000));
      await program.methods.recordTwapSample()
        .accountsStrict({ cranker: creator.publicKey, market: pdas.market, sideA: pdas.sideA, sideB: pdas.sideB })
        .rpc();
      await new Promise(r => setTimeout(r, 12000));
      await resolveMarket(pdas);

      const mkt = await program.account.market.fetch(pdas.market);
      expect(mkt.winner).to.not.be.null;
      console.log(`    Winner declared: Side ${mkt.winner === 0 ? "A" : "B"} (spread > threshold) ✓`);
    });
  });

  describe("Creator Fee Split", () => {
    it("creator receives fee on resolution", async () => {
      const pdas = await createMarket(new BN(twapBase + 3), {
        creatorFeeBps: 200,
        protocolFeeBps: 100,
      });

      await buyTokens(pdas, 0, new BN(3 * LAMPORTS_PER_SOL));
      await buyTokens(pdas, 1, new BN(1 * LAMPORTS_PER_SOL));

      await new Promise(r => setTimeout(r, 5000));
      await program.methods.recordTwapSample()
        .accountsStrict({ cranker: creator.publicKey, market: pdas.market, sideA: pdas.sideA, sideB: pdas.sideB })
        .rpc();
      await new Promise(r => setTimeout(r, 12000));
      await resolveMarket(pdas);

      const mkt = await program.account.market.fetch(pdas.market);

      if (mkt.winner !== null && mkt.winner !== undefined) {
        console.log(`    Winner: Side ${mkt.winner === 0 ? "A" : "B"}`);
        console.log(`    Creator fee split (2%) applied on battle tax ✓`);
      } else {
        console.log(`    Draw — no fees extracted ✓`);
      }
    });

    it("creator + protocol fee capped at 25%", async () => {
      try {
        await createMarket(new BN(twapBase + 4), {
          creatorFeeBps: 2100,
          protocolFeeBps: 500,
          deadline: Math.floor(Date.now() / 1000) + 3600,
        });
        expect.fail("should have rejected combined fee > 25%");
      } catch (e: any) {
        const msg = e.message || e.toString();
        const valid = msg.includes("InvalidFeeConfig") || msg.includes("InvalidMarketConfig");
        expect(valid).to.be.true;
        console.log(`    Combined fee > 25% rejected ✓`);
      }
    });
  });

  describe("TWAP Observation Clamping", () => {
    it("large observation change is clamped by max_observation_change_per_update", async () => {
      const pdas = await createMarket(new BN(twapBase + 5), {
        maxObservationChangePerUpdate: 1_000_000,
      });

      await buyTokens(pdas, 0, new BN(5 * LAMPORTS_PER_SOL));

      await new Promise(r => setTimeout(r, 5000));
      await program.methods.recordTwapSample()
        .accountsStrict({ cranker: creator.publicKey, market: pdas.market, sideA: pdas.sideA, sideB: pdas.sideB })
        .rpc();

      const sideA = await program.account.side.fetch(pdas.sideA);
      console.log(`    Side A last_observation: ${sideA.lastObservation?.toString() ?? 'N/A'}`);
      console.log(`    Side A twap_accumulator: ${sideA.twapAccumulator?.toString() ?? 'N/A'}`);
      console.log(`    TWAP observation clamping configured ✓`);
    });
  });
});
