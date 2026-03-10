import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { PublicKey, Connection, Keypair, SystemProgram } from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Duel } from "../../target/types/duel";
import IDL from "../idl/duel.json";
import {
  PROGRAM_ID,
  METEORA_DAMM_V2_PROGRAM_ID,
  WSOL_MINT,
  TOKEN_2022_PROGRAM_ID,
} from "./constants";
import { deriveDammV2Accounts, deriveMarketAccounts } from "./pda";

/**
 * Create a Duel Protocol program instance.
 */
export function createDuelProgram(provider: AnchorProvider): Program<Duel> {
  return new Program(IDL as any, provider);
}

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

/**
 * Build graduation instruction with all required accounts.
 * Creates ATAs if needed and returns pre-instructions + graduation instruction.
 *
 * @param program - Duel program instance
 * @param market - Market public key
 * @param side - Side index (0 = A, 1 = B)
 * @param authority - Signer/payer public key
 * @param positionNftMint - Keypair for position NFT mint (must be signer)
 * @returns { preInstructions, graduateInstruction, positionNftMint }
 */
export async function buildGraduateInstruction(
  program: Program<Duel>,
  market: PublicKey,
  side: number,
  authority: PublicKey,
  positionNftMint: Keypair
) {
  // Fetch market to get the creator and side info
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

  // Authority-owned ATAs (payer_token_a, payer_token_b)
  const payerTokenA = await getAssociatedTokenAddress(tokenMint, authority);
  const payerTokenB = await getAssociatedTokenAddress(WSOL_MINT, authority);

  // Pre-instructions: create ATAs if they don't exist
  const connection = program.provider.connection;
  const preInstructions = [];

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

  // Build the graduation instruction
  const graduateInstruction = await program.methods
    .graduateToDex(side)
    .accounts({
      authority,
      market,
      sideAccount: sideKey,
      tokenMint,
      tokenVault: sideData.tokenReserveVault,
      solVault: sideData.solReserveVault,
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
 * Build close_sol_vault instruction.
 */
export async function buildCloseSolVaultInstruction(
  program: Program<Duel>,
  market: PublicKey,
  side: number,
  rentReceiver: PublicKey
) {
  const marketData = await program.account.market.fetch(market);
  const sideKey = side === 0 ? marketData.sideA : marketData.sideB;
  const sideData = await program.account.side.fetch(sideKey);

  return program.methods
    .closeSolVault(side)
    .accounts({
      closer: rentReceiver,
      market,
      sideAccount: sideKey,
      solVault: sideData.solReserveVault,
      tokenVault: sideData.tokenReserveVault,
      rentReceiver,
      tokenProgram: TOKEN_PROGRAM_ID,
    } as any)
    .instruction();
}
