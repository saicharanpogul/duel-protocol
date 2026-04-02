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
export const DAMM_V2_PROGRAM_ID = new PublicKey("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG");
export const POOL_AUTHORITY = new PublicKey("HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC");
export const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

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
 * Derive Meteora DAMM v2 PDAs for pool creation.
 */
export function deriveDammV2Pdas(tokenAMint: PublicKey, positionNftMint: PublicKey) {
  const buf1 = tokenAMint.toBuffer();
  const buf2 = NATIVE_MINT.toBuffer();
  const maxKey = Buffer.compare(buf1, buf2) > 0 ? tokenAMint : NATIVE_MINT;
  const minKey = Buffer.compare(buf1, buf2) > 0 ? NATIVE_MINT : tokenAMint;

  const [pool] = PublicKey.findProgramAddressSync(
    [Buffer.from("cpool"), maxKey.toBuffer(), minKey.toBuffer()],
    DAMM_V2_PROGRAM_ID
  );
  const [positionNftAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("position_nft_account"), positionNftMint.toBuffer()],
    DAMM_V2_PROGRAM_ID
  );
  const [position] = PublicKey.findProgramAddressSync(
    [Buffer.from("position"), positionNftMint.toBuffer()],
    DAMM_V2_PROGRAM_ID
  );
  const [tokenAVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_vault"), tokenAMint.toBuffer(), pool.toBuffer()],
    DAMM_V2_PROGRAM_ID
  );
  const [tokenBVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_vault"), NATIVE_MINT.toBuffer(), pool.toBuffer()],
    DAMM_V2_PROGRAM_ID
  );
  const [eventAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    DAMM_V2_PROGRAM_ID
  );
  return { pool, positionNftAccount, position, tokenAVault, tokenBVault, eventAuthority };
}

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
    // Wallet pays ATA creation rent, owner is the ATA holder
    tx.add(createAssociatedTokenAccountInstruction(
      signers && signers.length > 0 ? provider.wallet.publicKey : owner,
      ata, owner, NATIVE_MINT
    ));
  }

  tx.add(SystemProgram.transfer({ fromPubkey: owner, toPubkey: ata, lamports: amount }));
  tx.add(createSyncNativeInstruction(ata));

  if (signers && signers.length > 0) {
    await provider.sendAndConfirm(tx, signers);
  } else {
    await provider.sendAndConfirm(tx);
  }

  return ata;
}

/**
 * Setup protocol config + fee accounts for tests.
 * If config already exists, reads the stored protocolFeeAccount from it.
 * Otherwise creates a new one and calls initializeConfig(100, 5000, 0).
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

  // Check if config already exists
  let protocolFeeOwner: Keypair;
  let protocolFeeAccount: PublicKey;

  try {
    const config = await program.account.programConfig.fetch(configPda);
    // Config exists: use the stored protocol fee account
    protocolFeeAccount = (config as any).protocolFeeAccount;
    protocolFeeOwner = Keypair.generate(); // dummy, not used
  } catch {
    // Config doesn't exist: create protocol fee owner + ATA, then initialize
    protocolFeeOwner = Keypair.generate();
    protocolFeeAccount = await getAssociatedTokenAddress(NATIVE_MINT, protocolFeeOwner.publicKey);

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

    await (program.methods as any)
      .initializeConfig(100, 5000, new BN(0))
      .accounts({
        admin: creator.publicKey,
        protocolFeeAccount: protocolFeeAccount,
        systemProgram: SystemProgram.programId,
      })
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

export type TestContext = Awaited<ReturnType<typeof setupTestContext>>;

/**
 * Create a market with standard test params.
 * Simplified: only deadline, twapWindow, twapInterval are configurable.
 */
export async function createTestMarket(
  provider: anchor.AnchorProvider,
  program: Program<Duel>,
  creator: anchor.Wallet,
  ctx: TestContext,
  marketId: BN,
  opts: {
    deadline?: number;
    twapWindow?: number;
    twapInterval?: number;
  } = {},
) {
  const pdas = derivePdas(program.programId, creator.publicKey, marketId);
  const now = Math.floor(Date.now() / 1000);
  const {
    deadline = now + 3600,
    twapWindow = 600,
    twapInterval = 10,
  } = opts;

  await (program.methods as any)
    .initializeMarket(
      marketId,
      new BN(deadline),
      new BN(twapWindow),
      new BN(twapInterval),
      "Test A",
      "TA",
      "",
      "Test B",
      "TB",
      "",
    )
    .accounts({
      creator: creator.publicKey,
      market: pdas.market,
      sideA: pdas.sideA,
      sideB: pdas.sideB,
      tokenMintA: pdas.mintA,
      tokenMintB: pdas.mintB,
      tokenVaultA: pdas.tvA,
      tokenVaultB: pdas.tvB,
      quoteMint: NATIVE_MINT,
      quoteTokenProgram: TOKEN_PROGRAM_ID,
      quoteVaultA: pdas.qvA,
      quoteVaultB: pdas.qvB,
      protocolFeeAccount: ctx.protocolFeeAccount,
      config: ctx.configPda,
      metadataA: findMetadataPda(pdas.mintA),
      metadataB: findMetadataPda(pdas.mintB),
      tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
      creatorFeeAccount: ctx.creatorFeeAccount,
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
 * Needs protocolFeeAccount and creatorFeeAccount from context.
 */
export async function buyTestTokens(
  provider: anchor.AnchorProvider,
  program: Program<Duel>,
  creator: anchor.Wallet,
  ctx: TestContext,
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

  const builder = (program.methods as any)
    .buyTokens(side, solAmount, new BN(1))
    .accounts({
      buyer: payer,
      market: pdas.market,
      sideAccount,
      tokenMint: mint,
      tokenVault,
      buyerTokenAccount: ata,
      quoteMint: NATIVE_MINT,
      quoteVault,
      buyerQuoteAccount: buyerWsolAta,
      protocolFeeAccount: ctx.protocolFeeAccount,
      creatorFeeAccount: ctx.creatorFeeAccount,
      config: ctx.configPda,
      tokenProgram: TOKEN_PROGRAM_ID,
      quoteTokenProgram: TOKEN_PROGRAM_ID,
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
 * Needs protocolFeeAccount and creatorFeeAccount from context.
 */
export async function sellTestTokens(
  provider: anchor.AnchorProvider,
  program: Program<Duel>,
  creator: anchor.Wallet,
  ctx: TestContext,
  pdas: Pdas,
  side: number,
  tokenAmount: BN,
) {
  const mint = side === 0 ? pdas.mintA : pdas.mintB;
  const sideAccount = side === 0 ? pdas.sideA : pdas.sideB;
  const tokenVault = side === 0 ? pdas.tvA : pdas.tvB;
  const quoteVault = side === 0 ? pdas.qvA : pdas.qvB;
  const ata = await getAssociatedTokenAddress(mint, creator.publicKey);

  await (program.methods as any)
    .sellTokens(side, tokenAmount, new BN(1))
    .accounts({
      seller: creator.publicKey,
      market: pdas.market,
      sideAccount,
      tokenMint: mint,
      tokenVault,
      sellerTokenAccount: ata,
      quoteMint: NATIVE_MINT,
      quoteVault,
      sellerQuoteAccount: ctx.creatorWsolAta,
      protocolFeeAccount: ctx.protocolFeeAccount,
      creatorFeeAccount: ctx.creatorFeeAccount,
      config: ctx.configPda,
      tokenProgram: TOKEN_PROGRAM_ID,
      quoteTokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
}

/**
 * Resolve and graduate a market atomically.
 * Derives Meteora DAMM v2 PDAs, creates market ATAs, calls resolve_and_graduate.
 */
export async function resolveAndGraduateTest(
  provider: anchor.AnchorProvider,
  program: Program<Duel>,
  creator: anchor.Wallet,
  ctx: TestContext,
  pdas: Pdas,
  expectedWinner: number,
): Promise<{ tx: string; pool: PublicKey; positionNftMint: Keypair }> {
  const winnerMint = expectedWinner === 0 ? pdas.mintA : pdas.mintB;
  const loserMint = expectedWinner === 0 ? pdas.mintB : pdas.mintA;

  // Generate position NFT keypair
  const positionNftMint = Keypair.generate();

  // Derive Meteora DAMM v2 PDAs
  const damm = deriveDammV2Pdas(winnerMint, positionNftMint.publicKey);

  // Create resolver's ATAs for winning token + WSOL
  const marketTokenAta = await getAssociatedTokenAddress(winnerMint, creator.publicKey);
  const marketWsolAta = await getAssociatedTokenAddress(NATIVE_MINT, creator.publicKey);

  const preIxs: anchor.web3.TransactionInstruction[] = [];
  try { await getAccount(provider.connection, marketTokenAta); } catch {
    preIxs.push(createAssociatedTokenAccountInstruction(creator.publicKey, marketTokenAta, creator.publicKey, winnerMint));
  }
  try { await getAccount(provider.connection, marketWsolAta); } catch {
    preIxs.push(createAssociatedTokenAccountInstruction(creator.publicKey, marketWsolAta, creator.publicKey, NATIVE_MINT));
  }
  if (preIxs.length > 0) {
    await provider.sendAndConfirm(new Transaction().add(...preIxs));
  }

  // Derive losing token metadata PDA
  const losingTokenMetadata = findMetadataPda(loserMint);

  const tx = await (program.methods as any)
    .resolveAndGraduate(expectedWinner)
    .accounts({
      resolver: creator.publicKey,
      market: pdas.market,
      config: ctx.configPda,
      sideA: pdas.sideA,
      sideB: pdas.sideB,
      quoteVaultA: pdas.qvA,
      quoteVaultB: pdas.qvB,
      tokenVaultA: pdas.tvA,
      tokenVaultB: pdas.tvB,
      tokenMintA: pdas.mintA,
      tokenMintB: pdas.mintB,
      quoteMint: NATIVE_MINT,
      marketTokenAta,
      marketWsolAta,
      pool: damm.pool,
      positionNftMint: positionNftMint.publicKey,
      positionNftAccount: damm.positionNftAccount,
      position: damm.position,
      poolTokenVaultA: damm.tokenAVault,
      poolTokenVaultB: damm.tokenBVault,
      poolAuthority: POOL_AUTHORITY,
      eventAuthority: damm.eventAuthority,
      meteoraProgram: DAMM_V2_PROGRAM_ID,
      losingTokenMetadata,
      tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
      tokenProgram: TOKEN_PROGRAM_ID,
      quoteTokenProgram: TOKEN_PROGRAM_ID,
      token2022Program: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([positionNftMint])
    .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 })])
    .rpc();

  return { tx, pool: damm.pool, positionNftMint };
}

/**
 * Get quote vault token balance.
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
 * Get WSOL balance for an owner.
 */
export async function getWsolBalance(
  provider: anchor.AnchorProvider,
  owner: PublicKey,
): Promise<number> {
  const ata = await getAssociatedTokenAddress(NATIVE_MINT, owner);
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
