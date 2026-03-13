import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  ComputeBudgetProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
} from "@solana/spl-token";
import { Duel } from "../../target/types/duel";
import IDL from "../idl/duel.json";
import {
  PROGRAM_ID,
  METEORA_DAMM_V2_PROGRAM_ID,
  WSOL_MINT,
  TOKEN_2022_PROGRAM_ID,
} from "./constants";
import { deriveDammV2Accounts, deriveMarketAccounts, findSidePda } from "./pda";

// ─── Program Instance ────────────────────────────────────────────────────

/**
 * Create a Duel Protocol program instance.
 */
export function createDuelProgram(provider: AnchorProvider): Program<Duel> {
  return new Program(IDL as any, provider);
}

// ─── Account Fetchers ────────────────────────────────────────────────────

/**
 * Fetch a Market account.
 */
export async function fetchMarket(program: Program<Duel>, market: PublicKey) {
  return program.account.market.fetch(market);
}

/**
 * Fetch a Side account.
 */
export async function fetchSide(program: Program<Duel>, side: PublicKey) {
  return program.account.side.fetch(side);
}

/**
 * Fetch all markets (optionally filtered by authority).
 */
export async function fetchAllMarkets(
  program: Program<Duel>,
  authority?: PublicKey
) {
  if (authority) {
    return program.account.market.all([
      { memcmp: { offset: 8, bytes: authority.toBase58() } },
    ]);
  }
  return program.account.market.all();
}

/**
 * Fetch the ProgramConfig account.
 */
export async function fetchConfig(program: Program<Duel>) {
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );
  return program.account.programConfig.fetch(configPda);
}

// ─── Price Helpers ───────────────────────────────────────────────────────

/**
 * Get the current price of a side's token given the side account data.
 * price = a * supply^n + b
 */
export function calculatePrice(
  circulatingSupply: number,
  curveParams: { a: number; n: number; b: number }
): number {
  const { a, n, b } = curveParams;
  return a * Math.pow(circulatingSupply, n) + b;
}

// ─── Instruction Builders ────────────────────────────────────────────────

/**
 * Build a buy_tokens instruction.
 *
 * @param program - Duel program instance
 * @param market - Market public key
 * @param side - Side index (0 = A, 1 = B)
 * @param quoteAmount - Amount of quote tokens to spend
 * @param minTokensOut - Minimum tokens expected (slippage protection)
 * @param buyer - Buyer's public key
 * @param quoteMint - Quote token mint (default: NATIVE_MINT / WSOL)
 */
export async function buildBuyTokensInstruction(
  program: Program<Duel>,
  market: PublicKey,
  side: number,
  quoteAmount: BN,
  minTokensOut: BN,
  buyer: PublicKey,
  quoteMint: PublicKey = NATIVE_MINT
) {
  const marketData = await program.account.market.fetch(market);
  const sideKey = side === 0 ? marketData.sideA : marketData.sideB;
  const sideData = await program.account.side.fetch(sideKey);

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );

  const buyerTokenAccount = await getAssociatedTokenAddress(
    sideData.tokenMint,
    buyer
  );
  const buyerQuoteAccount = await getAssociatedTokenAddress(quoteMint, buyer);

  // Pre-instructions: create buyer's token ATA if needed
  const preInstructions: TransactionInstruction[] = [];
  const buyerTokenInfo = await program.provider.connection.getAccountInfo(
    buyerTokenAccount
  );
  if (!buyerTokenInfo) {
    preInstructions.push(
      createAssociatedTokenAccountInstruction(
        buyer,
        buyerTokenAccount,
        buyer,
        sideData.tokenMint
      )
    );
  }

  const instruction = await program.methods
    .buyTokens(side, quoteAmount, minTokensOut)
    .accounts({
      buyer,
      market,
      sideAccount: sideKey,
      tokenMint: sideData.tokenMint,
      tokenVault: sideData.tokenReserveVault,
      buyerTokenAccount,
      quoteMint,
      quoteVault: sideData.quoteReserveVault,
      buyerQuoteAccount,
      config: configPda,
      tokenProgram: TOKEN_PROGRAM_ID,
      quoteTokenProgram: TOKEN_PROGRAM_ID,
    } as any)
    .instruction();

  return { preInstructions, instruction };
}

/**
 * Build a sell_tokens instruction (pre-resolution).
 */
export async function buildSellTokensInstruction(
  program: Program<Duel>,
  market: PublicKey,
  side: number,
  tokenAmount: BN,
  minQuoteOut: BN,
  seller: PublicKey,
  quoteMint: PublicKey = NATIVE_MINT
) {
  const marketData = await program.account.market.fetch(market);
  const sideKey = side === 0 ? marketData.sideA : marketData.sideB;
  const sideData = await program.account.side.fetch(sideKey);

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );

  const sellerTokenAccount = await getAssociatedTokenAddress(
    sideData.tokenMint,
    seller
  );
  const sellerQuoteAccount = await getAssociatedTokenAddress(quoteMint, seller);

  const instruction = await program.methods
    .sellTokens(side, tokenAmount, minQuoteOut)
    .accounts({
      seller,
      market,
      sideAccount: sideKey,
      tokenMint: sideData.tokenMint,
      tokenVault: sideData.tokenReserveVault,
      sellerTokenAccount,
      quoteMint,
      quoteVault: sideData.quoteReserveVault,
      sellerQuoteAccount,
      config: configPda,
      tokenProgram: TOKEN_PROGRAM_ID,
      quoteTokenProgram: TOKEN_PROGRAM_ID,
    } as any)
    .instruction();

  return { instruction };
}

/**
 * Build a sell_post_resolution instruction (after market is resolved).
 */
export async function buildSellPostResolutionInstruction(
  program: Program<Duel>,
  market: PublicKey,
  side: number,
  tokenAmount: BN,
  minQuoteOut: BN,
  seller: PublicKey,
  quoteMint: PublicKey = NATIVE_MINT
) {
  const marketData = await program.account.market.fetch(market);
  const sideKey = side === 0 ? marketData.sideA : marketData.sideB;
  const sideData = await program.account.side.fetch(sideKey);

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );

  const sellerTokenAccount = await getAssociatedTokenAddress(
    sideData.tokenMint,
    seller
  );
  const sellerQuoteAccount = await getAssociatedTokenAddress(quoteMint, seller);

  const instruction = await program.methods
    .sellPostResolution(side, tokenAmount, minQuoteOut)
    .accounts({
      seller,
      market,
      sideAccount: sideKey,
      tokenMint: sideData.tokenMint,
      tokenVault: sideData.tokenReserveVault,
      sellerTokenAccount,
      quoteMint,
      quoteVault: sideData.quoteReserveVault,
      sellerQuoteAccount,
      config: configPda,
      tokenProgram: TOKEN_PROGRAM_ID,
      quoteTokenProgram: TOKEN_PROGRAM_ID,
    } as any)
    .instruction();

  return { instruction };
}

/**
 * Build graduation instruction with all required accounts.
 *
 * @param program - Duel program instance
 * @param market - Market public key
 * @param side - Side index (0 = A, 1 = B)
 * @param authority - Signer/payer public key
 * @param positionNftMint - Keypair for position NFT mint (must be signer)
 * @param quoteMint - Quote token mint (default: NATIVE_MINT / WSOL)
 */
export async function buildGraduateInstruction(
  program: Program<Duel>,
  market: PublicKey,
  side: number,
  authority: PublicKey,
  positionNftMint: Keypair,
  quoteMint: PublicKey = NATIVE_MINT
) {
  const marketData = await program.account.market.fetch(market);
  const sideKey = side === 0 ? marketData.sideA : marketData.sideB;
  const sideData = await program.account.side.fetch(sideKey);

  const tokenMint = sideData.tokenMint;

  // Derive DAMM v2 PDAs
  const damm = deriveDammV2Accounts(
    tokenMint,
    positionNftMint.publicKey,
    WSOL_MINT
  );

  // Authority-owned ATAs
  const payerTokenA = await getAssociatedTokenAddress(tokenMint, authority);
  const payerTokenB = await getAssociatedTokenAddress(WSOL_MINT, authority);

  // Pre-instructions: create ATAs if they don't exist
  const connection = program.provider.connection;
  const preInstructions: TransactionInstruction[] = [];

  const payerTokenAInfo = await connection.getAccountInfo(payerTokenA);
  if (!payerTokenAInfo) {
    preInstructions.push(
      createAssociatedTokenAccountInstruction(
        authority,
        payerTokenA,
        authority,
        tokenMint
      )
    );
  }

  const payerTokenBInfo = await connection.getAccountInfo(payerTokenB);
  if (!payerTokenBInfo) {
    preInstructions.push(
      createAssociatedTokenAccountInstruction(
        authority,
        payerTokenB,
        authority,
        WSOL_MINT
      )
    );
  }

  // Add compute budget
  preInstructions.unshift(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 800_000 })
  );

  // Build the graduation instruction
  const graduateInstruction = await program.methods
    .graduateToDex(side)
    .accounts({
      authority,
      market,
      sideAccount: sideKey,
      tokenMint,
      tokenVault: sideData.tokenReserveVault,
      quoteMint,
      quoteVault: sideData.quoteReserveVault,
      quoteTokenProgram: TOKEN_PROGRAM_ID,
      wsolMint: WSOL_MINT,
      positionNftMint: positionNftMint.publicKey,
      positionNftAccount: damm.positionNftAccount,
      poolAuthority: damm.poolAuthority,
      pool: damm.pool,
      position: damm.position,
      tokenAVault: damm.tokenAVault,
      tokenBVault: damm.tokenBVault,
      payerTokenA,
      payerTokenB,
      tokenAProgram: TOKEN_PROGRAM_ID,
      tokenBProgram: TOKEN_PROGRAM_ID,
      token2022Program: TOKEN_2022_PROGRAM_ID,
      eventAuthority: damm.eventAuthority,
      meteoraProgram: METEORA_DAMM_V2_PROGRAM_ID,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: new PublicKey(
        "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
      ),
      systemProgram: SystemProgram.programId,
    } as any)
    .signers([positionNftMint])
    .instruction();

  return {
    preInstructions,
    graduateInstruction,
    positionNftMint,
    accounts: {
      pool: damm.pool,
      position: damm.position,
      payerTokenA,
      payerTokenB,
    },
  };
}

/**
 * Build close_quote_vault instruction.
 * Closes empty quote and token vaults to reclaim rent.
 */
export async function buildCloseQuoteVaultInstruction(
  program: Program<Duel>,
  market: PublicKey,
  side: number,
  rentReceiver: PublicKey
) {
  const marketData = await program.account.market.fetch(market);
  const sideKey = side === 0 ? marketData.sideA : marketData.sideB;
  const sideData = await program.account.side.fetch(sideKey);

  return program.methods
    .closeQuoteVault(side)
    .accounts({
      closer: rentReceiver,
      market,
      sideAccount: sideKey,
      quoteVault: sideData.quoteReserveVault,
      tokenVault: sideData.tokenReserveVault,
      rentReceiver,
      tokenProgram: TOKEN_PROGRAM_ID,
      quoteTokenProgram: TOKEN_PROGRAM_ID,
    } as any)
    .instruction();
}
