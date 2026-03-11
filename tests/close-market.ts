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

const RENT_EXEMPT_MIN = 890_880;

describe("close-market", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Duel as Program<Duel>;
  const creator = provider.wallet;
  const protocolFeeAccount = Keypair.generate();
  const closeBase = Math.floor(Math.random() * 10_000_000) + 60_000_000;

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );

  async function prefundPda(pda: PublicKey) {
    const tx = new anchor.web3.Transaction().add(
      SystemProgram.transfer({ fromPubkey: creator.publicKey, toPubkey: pda, lamports: RENT_EXEMPT_MIN })
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

  async function createMarketFull(marketId: BN, deadlineSec: number = 15, battleTaxBps: number = 5000) {
    const pdas = derivePdas(marketId);
    const now = Math.floor(Date.now() / 1000);
    await prefundPda(protocolFeeAccount.publicKey);
    await program.methods
      .initializeMarket(
        marketId, new BN(now + deadlineSec), new BN(10), new BN(10),
        battleTaxBps, 100, 0, new BN(10),
        { a: new BN(1_000_000), n: 1, b: new BN(1_000) },
        new BN(1_000_000_000),
        "Close A", "CLA", "", "Close B", "CLB", "",
        { unlocked: {} },
        new BN(0), 0, 0,
      )
      .accounts({
        creator: creator.publicKey,
        market: pdas.market, sideA: pdas.sideA, sideB: pdas.sideB,
        tokenMintA: pdas.mintA, tokenMintB: pdas.mintB,
        tokenVaultA: pdas.tvA, tokenVaultB: pdas.tvB,
        solVaultA: pdas.svA, solVaultB: pdas.svB,
        protocolFeeAccount: protocolFeeAccount.publicKey,
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

  before(async () => {
    try {
      await program.account.programConfig.fetch(configPda);
    } catch {
      await prefundPda(protocolFeeAccount.publicKey);
      await program.methods
        .initializeConfig(125, new BN(0))
        .accounts({
          admin: creator.publicKey,
          config: configPda,
          protocolFeeAccount: protocolFeeAccount.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }
  });

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

      // Buy tokens on BOTH sides (both vaults need SOL to survive battle_tax)
      const ata = await getAssociatedTokenAddress(pdas.mintA, creator.publicKey);
      const ataB = await getAssociatedTokenAddress(pdas.mintB, creator.publicKey);
      try {
        const createAtaIx = createAssociatedTokenAccountInstruction(
          creator.publicKey, ata, creator.publicKey, pdas.mintA
        );
        const createAtaBIx = createAssociatedTokenAccountInstruction(
          creator.publicKey, ataB, creator.publicKey, pdas.mintB
        );
        await provider.sendAndConfirm(new anchor.web3.Transaction().add(createAtaIx).add(createAtaBIx));
      } catch { }
      await program.methods
        .buyTokens(0, new BN(LAMPORTS_PER_SOL), new BN(1))
        .accounts({
          buyer: creator.publicKey, market: pdas.market, sideAccount: pdas.sideA,
          tokenMint: pdas.mintA, tokenVault: pdas.tvA, buyerTokenAccount: ata, solVault: pdas.svA,
          config: configPda, systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      await program.methods
        .buyTokens(1, new BN(0.5 * LAMPORTS_PER_SOL), new BN(1))
        .accounts({
          buyer: creator.publicKey, market: pdas.market, sideAccount: pdas.sideB,
          tokenMint: pdas.mintB, tokenVault: pdas.tvB, buyerTokenAccount: ataB, solVault: pdas.svB,
          config: configPda, systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      // Fast-forward: TWAP + resolve
      await new Promise(r => setTimeout(r, 5000));
      await program.methods.recordTwapSample()
        .accountsStrict({ cranker: creator.publicKey, market: pdas.market, sideA: pdas.sideA, sideB: pdas.sideB })
        .rpc();
      await new Promise(r => setTimeout(r, 12000));
      await prefundPda(protocolFeeAccount.publicKey);
      await program.methods.resolveMarket()
        .accountsStrict({
          resolver: creator.publicKey, market: pdas.market,
          sideA: pdas.sideA, sideB: pdas.sideB,
          solVaultA: pdas.svA, solVaultB: pdas.svB,
          protocolFeeAccount: protocolFeeAccount.publicKey, creatorFeeAccount: creator.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Try close — should fail because circulating_supply > 0
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
      const pdas = await createMarketFull(new BN(closeBase + 3), 15, 0); // battleTaxBps=0 for clean close test

      // Buy on both sides (both vaults need SOL to survive battle_tax)
      const ataA = await getAssociatedTokenAddress(pdas.mintA, creator.publicKey);
      const ataB = await getAssociatedTokenAddress(pdas.mintB, creator.publicKey);
      try {
        const createAtaAIx = createAssociatedTokenAccountInstruction(
          creator.publicKey, ataA, creator.publicKey, pdas.mintA
        );
        const createAtaBIx = createAssociatedTokenAccountInstruction(
          creator.publicKey, ataB, creator.publicKey, pdas.mintB
        );
        await provider.sendAndConfirm(new anchor.web3.Transaction().add(createAtaAIx).add(createAtaBIx));
      } catch { }
      await program.methods
        .buyTokens(0, new BN(LAMPORTS_PER_SOL), new BN(1))
        .accounts({
          buyer: creator.publicKey, market: pdas.market, sideAccount: pdas.sideA,
          tokenMint: pdas.mintA, tokenVault: pdas.tvA, buyerTokenAccount: ataA, solVault: pdas.svA,
          config: configPda, systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      await program.methods
        .buyTokens(1, new BN(0.5 * LAMPORTS_PER_SOL), new BN(1))
        .accounts({
          buyer: creator.publicKey, market: pdas.market, sideAccount: pdas.sideB,
          tokenMint: pdas.mintB, tokenVault: pdas.tvB, buyerTokenAccount: ataB, solVault: pdas.svB,
          config: configPda, systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      // Sell all tokens back on both sides
      const acctA = await provider.connection.getTokenAccountBalance(ataA);
      const tokensA = new BN(acctA.value.amount);
      await program.methods
        .sellTokens(0, tokensA, new BN(1))
        .accounts({
          seller: creator.publicKey, market: pdas.market, sideAccount: pdas.sideA,
          tokenMint: pdas.mintA, tokenVault: pdas.tvA, sellerTokenAccount: ataA, solVault: pdas.svA,
          config: configPda, systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      const acctB = await provider.connection.getTokenAccountBalance(ataB);
      const tokensB = new BN(acctB.value.amount);
      await program.methods
        .sellTokens(1, tokensB, new BN(1))
        .accounts({
          seller: creator.publicKey, market: pdas.market, sideAccount: pdas.sideB,
          tokenMint: pdas.mintB, tokenVault: pdas.tvB, sellerTokenAccount: ataB, solVault: pdas.svB,
          config: configPda, systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      // Resolve
      await new Promise(r => setTimeout(r, 5000));
      await program.methods.recordTwapSample()
        .accountsStrict({ cranker: creator.publicKey, market: pdas.market, sideA: pdas.sideA, sideB: pdas.sideB })
        .rpc();
      await new Promise(r => setTimeout(r, 12000));
      await prefundPda(protocolFeeAccount.publicKey);
      await program.methods.resolveMarket()
        .accountsStrict({
          resolver: creator.publicKey, market: pdas.market,
          sideA: pdas.sideA, sideB: pdas.sideB,
          solVaultA: pdas.svA, solVaultB: pdas.svB,
          protocolFeeAccount: protocolFeeAccount.publicKey, creatorFeeAccount: creator.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Check balances before close
      const balBefore = await provider.connection.getBalance(creator.publicKey);

      // Close market (rent recovery)
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

      // Verify accounts are closed
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
