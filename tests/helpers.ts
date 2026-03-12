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
  createSyncNativeInstruction,
  getAccount,
} from "@solana/spl-token";
import BN from "bn.js";

export const TOKEN_METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

export function findMetadataPda(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), TOKEN_METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    TOKEN_METADATA_PROGRAM_ID
  );
  return pda;
}

export function derivePdas(programId: PublicKey, creator: PublicKey, marketId: BN) {
  const [market] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), creator.toBuffer(), marketId.toArrayLike(Buffer, "le", 8)],
    programId
  );
  const pda = (seed: string, idx: number) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from(seed), market.toBuffer(), Buffer.from([idx])],
      programId
    )[0];
  return {
    market,
    sideA: pda("side", 0), sideB: pda("side", 1),
    mintA: pda("mint", 0), mintB: pda("mint", 1),
    tvA: pda("token_vault", 0), tvB: pda("token_vault", 1),
    qvA: pda("quote_vault", 0), qvB: pda("quote_vault", 1),
  };
}

export type Pdas = ReturnType<typeof derivePdas>;

/**
 * Wrap SOL into a WSOL ATA for the given owner.
 * Creates ATA if needed, transfers lamports, syncs.
 */
export async function wrapSol(
  provider: anchor.AnchorProvider,
  owner: PublicKey,
  amount: number,
  signers?: Keypair[],
): Promise<PublicKey> {
  const ata = await getAssociatedTokenAddress(NATIVE_MINT, owner);
  const tx = new Transaction();

  try {
    await getAccount(provider.connection, ata);
  } catch {
    tx.add(createAssociatedTokenAccountInstruction(owner, ata, owner, NATIVE_MINT));
  }

  tx.add(SystemProgram.transfer({ fromPubkey: owner, toPubkey: ata, lamports: amount }));
  tx.add(createSyncNativeInstruction(ata));

  if (signers && signers.length > 0) {
    tx.feePayer = owner;
    await provider.sendAndConfirm(tx, signers);
  } else {
    await provider.sendAndConfirm(tx);
  }

  return ata;
}

/**
 * Setup protocol config + fee accounts for tests. Returns shared state.
 */
export async function setupTestContext(
  provider: anchor.AnchorProvider,
  program: Program<Duel>,
  creator: anchor.Wallet,
) {
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );

  // Create protocol fee owner + their WSOL ATA for receiving fees
  const protocolFeeOwner = Keypair.generate();
  const protocolFeeAccount = await getAssociatedTokenAddress(NATIVE_MINT, protocolFeeOwner.publicKey);

  // Fund protocol fee owner
  const fundTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: creator.publicKey,
      toPubkey: protocolFeeOwner.publicKey,
      lamports: LAMPORTS_PER_SOL / 10,
    })
  );
  await provider.sendAndConfirm(fundTx);

  // Create protocol fee WSOL ATA
  const createProtocolAtaTx = new Transaction().add(
    createAssociatedTokenAccountInstruction(
      protocolFeeOwner.publicKey,
      protocolFeeAccount,
      protocolFeeOwner.publicKey,
      NATIVE_MINT
    )
  );
  await provider.sendAndConfirm(createProtocolAtaTx, [protocolFeeOwner]);

  // Create/ensure creator fee WSOL ATA
  const creatorFeeAccount = await getAssociatedTokenAddress(NATIVE_MINT, creator.publicKey);
  try {
    await getAccount(provider.connection, creatorFeeAccount);
  } catch {
    const createCreatorAtaTx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        creator.publicKey,
        creatorFeeAccount,
        creator.publicKey,
        NATIVE_MINT
      )
    );
    await provider.sendAndConfirm(createCreatorAtaTx);
  }

  // Initialize ProgramConfig if not already done
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

  return {
    configPda,
    protocolFeeOwner,
    protocolFeeAccount,
    creatorFeeAccount,
    creatorWsolAta: creatorFeeAccount,
  };
}

/**
 * Create a market with standard test params.
 */
export async function createTestMarket(
  provider: anchor.AnchorProvider,
  program: Program<Duel>,
  creator: anchor.Wallet,
  ctx: Awaited<ReturnType<typeof setupTestContext>>,
  marketId: BN,
  opts: {
    deadline?: number;
    twapWindow?: number;
    twapInterval?: number;
    battleTaxBps?: number;
    protocolFeeBps?: number;
    sellPenaltyMaxBps?: number;
    protectionActivationOffset?: number;
    curveParams?: { a: BN; n: number; b: BN };
    totalSupply?: BN;
    minTwapSpreadBps?: number;
    creatorFeeBps?: number;
    maxObservationChangePerUpdate?: number;
    resolutionMode?: any;
    oracleAuthority?: PublicKey;
    oracleDisputeWindow?: BN;
  } = {},
) {
  const pdas = derivePdas(program.programId, creator.publicKey, marketId);
  const now = Math.floor(Date.now() / 1000);
  const {
    deadline = now + 3600,
    twapWindow = 600,
    twapInterval = 10,
    battleTaxBps = 5000,
    protocolFeeBps = 100,
    sellPenaltyMaxBps = 1500,
    protectionActivationOffset = 300,
    curveParams = { a: new BN(1_000_000), n: 1, b: new BN(1_000) },
    totalSupply = new BN(1_000_000_000),
    minTwapSpreadBps = 0,
    creatorFeeBps = 0,
    maxObservationChangePerUpdate = 0,
    resolutionMode = { twap: {} },
    oracleAuthority = PublicKey.default,
    oracleDisputeWindow = new BN(0),
  } = opts;

  await program.methods
    .initializeMarket(
      marketId, new BN(deadline), new BN(twapWindow), new BN(twapInterval),
      battleTaxBps, protocolFeeBps, sellPenaltyMaxBps,
      new BN(protectionActivationOffset),
      curveParams, totalSupply,
      "Test A", "TA", "", "Test B", "TB", "",
      { unlocked: {} },
      new BN(maxObservationChangePerUpdate), minTwapSpreadBps, creatorFeeBps,
      resolutionMode, oracleAuthority, oracleDisputeWindow,
    )
    .accounts({
      creator: creator.publicKey,
      market: pdas.market, sideA: pdas.sideA, sideB: pdas.sideB,
      tokenMintA: pdas.mintA, tokenMintB: pdas.mintB,
      tokenVaultA: pdas.tvA, tokenVaultB: pdas.tvB,
      quoteMint: NATIVE_MINT,
      quoteTokenProgram: TOKEN_PROGRAM_ID,
      quoteVaultA: pdas.qvA, quoteVaultB: pdas.qvB,
      protocolFeeAccount: ctx.protocolFeeAccount,
      creatorFeeAccount: ctx.creatorFeeAccount,
      config: ctx.configPda,
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

/**
 * Buy tokens on a side. Wraps SOL automatically.
 */
export async function buyTestTokens(
  provider: anchor.AnchorProvider,
  program: Program<Duel>,
  creator: anchor.Wallet,
  ctx: Awaited<ReturnType<typeof setupTestContext>>,
  pdas: Pdas,
  side: number,
  solAmount: BN,
  buyer?: Keypair,
) {
  const payer = buyer ? buyer.publicKey : creator.publicKey;
  const mint = side === 0 ? pdas.mintA : pdas.mintB;
  const sideAccount = side === 0 ? pdas.sideA : pdas.sideB;
  const tokenVault = side === 0 ? pdas.tvA : pdas.tvB;
  const quoteVault = side === 0 ? pdas.qvA : pdas.qvB;

  // Create token ATA if needed
  const ata = await getAssociatedTokenAddress(mint, payer);
  try {
    await getAccount(provider.connection, ata);
  } catch {
    const ix = createAssociatedTokenAccountInstruction(payer, ata, payer, mint);
    const tx = new Transaction().add(ix);
    if (buyer) {
      tx.feePayer = buyer.publicKey;
      await provider.sendAndConfirm(tx, [buyer]);
    } else {
      await provider.sendAndConfirm(tx);
    }
  }

  // Wrap SOL to WSOL
  const buyerWsolAta = await wrapSol(provider, payer, solAmount.toNumber(), buyer ? [buyer] : undefined);

  const builder = program.methods
    .buyTokens(side, solAmount, new BN(1))
    .accounts({
      buyer: payer, market: pdas.market, sideAccount,
      tokenMint: mint, tokenVault, buyerTokenAccount: ata,
      quoteMint: NATIVE_MINT, quoteVault, buyerQuoteAccount: buyerWsolAta,
      config: ctx.configPda,
      tokenProgram: TOKEN_PROGRAM_ID, quoteTokenProgram: TOKEN_PROGRAM_ID,
    });

  if (buyer) {
    await builder.signers([buyer]).rpc();
  } else {
    await builder.rpc();
  }

  const acc = await getAccount(provider.connection, ata);
  return { ata, balance: Number(acc.amount) };
}

/**
 * Sell tokens on a side.
 */
export async function sellTestTokens(
  provider: anchor.AnchorProvider,
  program: Program<Duel>,
  creator: anchor.Wallet,
  ctx: Awaited<ReturnType<typeof setupTestContext>>,
  pdas: Pdas,
  side: number,
  tokenAmount: BN,
  postResolution = false,
) {
  const mint = side === 0 ? pdas.mintA : pdas.mintB;
  const sideAccount = side === 0 ? pdas.sideA : pdas.sideB;
  const tokenVault = side === 0 ? pdas.tvA : pdas.tvB;
  const quoteVault = side === 0 ? pdas.qvA : pdas.qvB;
  const ata = await getAssociatedTokenAddress(mint, creator.publicKey);

  const accounts = {
    seller: creator.publicKey, market: pdas.market, sideAccount,
    tokenMint: mint, tokenVault, sellerTokenAccount: ata,
    quoteMint: NATIVE_MINT, quoteVault, sellerQuoteAccount: ctx.creatorWsolAta,
    config: ctx.configPda,
    tokenProgram: TOKEN_PROGRAM_ID, quoteTokenProgram: TOKEN_PROGRAM_ID,
  };

  if (postResolution) {
    await program.methods.sellPostResolution(side, tokenAmount, new BN(0)).accounts(accounts).rpc();
  } else {
    await program.methods.sellTokens(side, tokenAmount, new BN(1)).accounts(accounts).rpc();
  }
}

/**
 * Resolve a market via TWAP.
 */
export async function resolveTestMarket(
  program: Program<Duel>,
  creator: anchor.Wallet,
  ctx: Awaited<ReturnType<typeof setupTestContext>>,
  pdas: Pdas,
) {
  await program.methods.resolveMarket()
    .accounts({
      resolver: creator.publicKey, market: pdas.market,
      sideA: pdas.sideA, sideB: pdas.sideB,
      quoteMint: NATIVE_MINT,
      quoteVaultA: pdas.qvA, quoteVaultB: pdas.qvB,
      protocolFeeAccount: ctx.protocolFeeAccount,
      creatorFeeAccount: ctx.creatorFeeAccount,
      quoteTokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
}

/**
 * Get quote vault token balance (replaces getBalance for sol vaults).
 */
export async function getQuoteVaultBalance(
  provider: anchor.AnchorProvider,
  pdas: Pdas,
  side: number,
): Promise<number> {
  const vault = side === 0 ? pdas.qvA : pdas.qvB;
  const acc = await getAccount(provider.connection, vault);
  return Number(acc.amount);
}

/**
 * Get WSOL balance for creator.
 */
export async function getCreatorWsolBalance(
  provider: anchor.AnchorProvider,
  creator: PublicKey,
): Promise<number> {
  const ata = await getAssociatedTokenAddress(NATIVE_MINT, creator);
  try {
    const acc = await getAccount(provider.connection, ata);
    return Number(acc.amount);
  } catch {
    return 0;
  }
}

// Re-export commonly used items
export { NATIVE_MINT, TOKEN_PROGRAM_ID, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, getAccount };
export { BN, Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL, ComputeBudgetProgram, Transaction };
