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

describe("close-market", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Duel as Program<Duel>;
  const creator = provider.wallet;
  const closeBase = Math.floor(Math.random() * 10_000_000) + 60_000_000;

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

  async function createMarketFull(marketId: BN, deadlineSec: number = 15, battleTaxBps: number = 5000) {
    const pdas = deriveMarketPdas(marketId);
    const now = Math.floor(Date.now() / 1000);
    await program.methods
      .initializeMarket(
        marketId, new BN(now + deadlineSec), new BN(10), new BN(10),
        battleTaxBps, 100, 0, new BN(10),
        { a: new BN(1_000_000), n: 1, b: new BN(1_000) },
        new BN(1_000_000_000),
        "Close A", "CLA", "", "Close B", "CLB", "",
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

  async function sellTokens(pdas: Pdas, side: number, amount: BN) {
    const mint = side === 0 ? pdas.mintA : pdas.mintB;
    const ata = await getAssociatedTokenAddress(mint, creator.publicKey);
    await program.methods
      .sellTokens(side, amount, new BN(1))
      .accounts({
        seller: creator.publicKey, market: pdas.market,
        sideAccount: side === 0 ? pdas.sideA : pdas.sideB,
        tokenMint: mint,
        tokenVault: side === 0 ? pdas.tvA : pdas.tvB,
        sellerTokenAccount: ata,
        quoteMint: NATIVE_MINT,
        quoteVault: side === 0 ? pdas.qvA : pdas.qvB,
        sellerQuoteAccount: creatorWsolAta,
        config: configPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        quoteTokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
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

  describe("Rejection Gates", () => {
    it("should reject close_market on active (unresolved) market", async () => {
      const pdas = await createMarketFull(new BN(closeBase + 1), 3600);

      try {
        await program.methods
          .closeMarket(0)
          .accounts({
            authority: creator.publicKey,
            market: pdas.market,
            sideA: pdas.sideA,
            sideB: pdas.sideB,
            config: configPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("should have rejected");
      } catch (e: any) {
        expect(e.message).to.include("MarketNotResolved");
        console.log(`    Close rejected on active market ✓`);
      }
    });

    it("should reject close_market when circulating_supply > 0", async () => {
      const pdas = await createMarketFull(new BN(closeBase + 2));

      await buyTokens(pdas, 0, new BN(LAMPORTS_PER_SOL));
      await buyTokens(pdas, 1, new BN(0.5 * LAMPORTS_PER_SOL));

      // TWAP + resolve
      await new Promise(r => setTimeout(r, 5000));
      await program.methods.recordTwapSample()
        .accountsStrict({ cranker: creator.publicKey, market: pdas.market, sideA: pdas.sideA, sideB: pdas.sideB })
        .rpc();
      await new Promise(r => setTimeout(r, 12000));
      await resolveMarket(pdas);

      try {
        await program.methods
          .closeMarket(0)
          .accounts({
            authority: creator.publicKey,
            market: pdas.market,
            sideA: pdas.sideA,
            sideB: pdas.sideB,
            config: configPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("should have rejected");
      } catch (e: any) {
        expect(e.message).to.include("InsufficientTokenBalance");
        console.log(`    Close rejected with circulating_supply > 0 ✓`);
      }
    });
  });

  describe("Successful Close + Rent Recovery", () => {
    it("should close market after all tokens sold and recover rent", async () => {
      const pdas = await createMarketFull(new BN(closeBase + 3), 15, 0);

      await buyTokens(pdas, 0, new BN(LAMPORTS_PER_SOL));
      await buyTokens(pdas, 1, new BN(0.5 * LAMPORTS_PER_SOL));

      // Sell all tokens
      const ataA = await getAssociatedTokenAddress(pdas.mintA, creator.publicKey);
      const ataB = await getAssociatedTokenAddress(pdas.mintB, creator.publicKey);
      const acctA = await provider.connection.getTokenAccountBalance(ataA);
      const tokensA = new BN(acctA.value.amount);
      await sellTokens(pdas, 0, tokensA);

      const acctB = await provider.connection.getTokenAccountBalance(ataB);
      const tokensB = new BN(acctB.value.amount);
      await sellTokens(pdas, 1, tokensB);

      // Resolve
      await new Promise(r => setTimeout(r, 5000));
      await program.methods.recordTwapSample()
        .accountsStrict({ cranker: creator.publicKey, market: pdas.market, sideA: pdas.sideA, sideB: pdas.sideB })
        .rpc();
      await new Promise(r => setTimeout(r, 12000));
      await resolveMarket(pdas);

      const balBefore = await provider.connection.getBalance(creator.publicKey);

      await program.methods
        .closeMarket(0)
        .accounts({
          authority: creator.publicKey,
          market: pdas.market,
          sideA: pdas.sideA,
          sideB: pdas.sideB,
          config: configPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const balAfter = await provider.connection.getBalance(creator.publicKey);
      const recovered = balAfter - balBefore;

      const marketInfo = await provider.connection.getAccountInfo(pdas.market);
      const sideAInfo = await provider.connection.getAccountInfo(pdas.sideA);
      const sideBInfo = await provider.connection.getAccountInfo(pdas.sideB);

      expect(marketInfo).to.be.null;
      expect(sideAInfo).to.be.null;
      expect(sideBInfo).to.be.null;
      expect(recovered).to.be.greaterThan(0);

      console.log(`    Market + Sides closed, rent recovered: ${recovered / LAMPORTS_PER_SOL} SOL ✓`);
    });
  });
});
