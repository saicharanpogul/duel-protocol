import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  ComputeBudgetProgram,
  TransactionInstruction,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
} from "@solana/spl-token";
import { Duel } from "./types";
import IDL_JSON from "../idl/duel.json";
import {
  PROGRAM_ID,
  METEORA_DAMM_V2_PROGRAM_ID,
  WSOL_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_METADATA_PROGRAM_ID,
  CURVE_SCALE,
  CURVE_A,
  CURVE_N,
  CURVE_B,
  BPS_DENOMINATOR,
} from "./constants";
import {
  deriveDammV2Accounts,
  deriveMarketAccounts,
  findSidePda,
  findConfigPda,
  findMetadataPda,
  findMintPda,
} from "./pda";

// ── Program Instance ────────────────────────────────────────────────────

/**
 * Cast IDL JSON to the typed Duel IDL. The IDL may be stale after program
 * refactoring, so we use `as any` to bypass strict type checks until the
 * IDL is regenerated via `anchor build`.
 */
const IDL = IDL_JSON as any;

/**
 * Create a Duel Protocol program instance.
 */
export function createDuelProgram(provider: AnchorProvider): Program<Duel> {
  return new Program<Duel>(IDL, provider);
}

// ── Account Fetchers ────────────────────────────────────────────────────

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
  const [configPda] = findConfigPda();
  return program.account.programConfig.fetch(configPda);
}

// ── Math Helpers ────────────────────────────────────────────────────────

/**
 * Price at a given circulating supply.
 * price(k) = CURVE_A * k^CURVE_N / CURVE_SCALE + CURVE_B
 *
 * Uses hardcoded curve constants (a=1, n=2, b=1).
 *
 * @param circulatingSupply - Number of tokens currently in circulation
 * @returns Price in lamports (integer)
 */
export function calculatePrice(circulatingSupply: number): number {
  const k = circulatingSupply;
  const term = (CURVE_A * Math.pow(k, CURVE_N)) / CURVE_SCALE;
  return Math.floor(term + CURVE_B);
}

/**
 * Reserve integral R(k) = CURVE_A * k^(CURVE_N+1) / ((CURVE_N+1) * CURVE_SCALE) + CURVE_B * k
 *
 * @param supply - Circulating supply
 * @returns Reserve in lamports (may lose precision for very large values)
 */
export function calculateReserve(supply: number): number {
  const nPlus1 = CURVE_N + 1;
  const term1 = (CURVE_A * Math.pow(supply, nPlus1)) / (nPlus1 * CURVE_SCALE);
  const term2 = CURVE_B * supply;
  return Math.floor(term1 + term2);
}

/**
 * Calculate tokens received for a given quote amount (buy).
 * Uses binary search matching the on-chain implementation.
 *
 * @param quoteAmount - Amount of quote tokens to spend (lamports)
 * @param currentSupply - Current circulating supply
 * @param totalSupply - Total supply per side
 * @returns Number of tokens received
 */
export function calculateTokensOut(
  quoteAmount: number,
  currentSupply: number,
  totalSupply: number
): number {
  if (quoteAmount === 0) return 0;
  const available = totalSupply - currentSupply;
  if (available <= 0) return 0;

  const rCurrent = calculateReserve(currentSupply);

  let lo = 0;
  let hi = available;
  let best = 0;

  while (lo <= hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    const rNew = calculateReserve(currentSupply + mid);
    const cost = rNew - rCurrent;

    if (cost <= quoteAmount) {
      best = mid;
      if (mid === hi) break;
      lo = mid + 1;
    } else {
      if (mid === 0) break;
      hi = mid - 1;
    }
  }

  return best;
}

/**
 * Calculate quote tokens received for selling tokens.
 * quoteOut = R(supply) - R(supply - tokenAmount)
 *
 * @param tokenAmount - Number of tokens to sell
 * @param currentSupply - Current circulating supply
 * @returns Quote tokens received (lamports, before fees)
 */
export function calculateQuoteOut(
  tokenAmount: number,
  currentSupply: number
): number {
  if (tokenAmount === 0) return 0;
  if (currentSupply < tokenAmount) throw new Error("Insufficient supply");
  const rCurrent = calculateReserve(currentSupply);
  const rNew = calculateReserve(currentSupply - tokenAmount);
  return Math.floor(rCurrent - rNew);
}

/**
 * Calculate sentiment ratio.
 * sentiment(A) = priceA / (priceA + priceB)
 *
 * @returns Number between 0 and 1 representing Side A's sentiment share
 */
export function calculateSentiment(priceA: number, priceB: number): number {
  const total = priceA + priceB;
  if (total === 0) return 0.5;
  return priceA / total;
}

/**
 * Calculate trade fee split between protocol and creator.
 *
 * @param amount - Trade amount (quote tokens)
 * @param feeBps - Trade fee in basis points
 * @param creatorSplitBps - Creator's share of trade fee in basis points
 * @returns { protocolFee, creatorFee, netAmount }
 */
export function calculateTradeFee(
  amount: number,
  feeBps: number,
  creatorSplitBps: number
): { protocolFee: number; creatorFee: number; netAmount: number } {
  const totalFee = Math.floor((amount * feeBps) / BPS_DENOMINATOR);
  const creatorFee = Math.floor((totalFee * creatorSplitBps) / BPS_DENOMINATOR);
  const protocolFee = totalFee - creatorFee;
  const netAmount = amount - totalFee;
  return { protocolFee, creatorFee, netAmount };
}

// ── Instruction Builders ────────────────────────────────────────────────

// ── Admin Instructions ──────────────────────────────────────────────────

/**
 * Build an initialize_config instruction.
 */
export async function buildInitializeConfigInstruction(
  program: Program<Duel>,
  admin: PublicKey,
  protocolFeeAccount: PublicKey,
  tradeFeeBps: number,
  creatorFeeSplitBps: number,
  marketCreationFee: BN
) {
  const [configPda] = findConfigPda();

  const instruction = await (program.methods as any)
    .initializeConfig(tradeFeeBps, creatorFeeSplitBps, marketCreationFee)
    .accountsPartial({
      admin,
      config: configPda,
      protocolFeeAccount,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  return { instruction };
}

/**
 * Build an update_config instruction.
 */
export async function buildUpdateConfigInstruction(
  program: Program<Duel>,
  admin: PublicKey,
  opts: {
    paused?: boolean;
    tradeFeeBps?: number;
    creatorFeeSplitBps?: number;
    marketCreationFee?: BN;
    minMarketDuration?: BN;
    newProtocolFeeAccount?: PublicKey;
    newAdmin?: PublicKey;
  }
) {
  const [configPda] = findConfigPda();

  const instruction = await (program.methods as any)
    .updateConfig(
      opts.paused ?? null,
      opts.tradeFeeBps ?? null,
      opts.creatorFeeSplitBps ?? null,
      opts.marketCreationFee ?? null,
      opts.minMarketDuration ?? null
    )
    .accountsPartial({
      admin,
      config: configPda,
      newProtocolFeeAccount: opts.newProtocolFeeAccount ?? null,
      newAdmin: opts.newAdmin ?? null,
    })
    .instruction();

  return { instruction };
}

// ── Market Lifecycle Instructions ───────────────────────────────────────

/**
 * Build an initialize_market instruction.
 *
 * Simplified: no battle_tax, no penalty, no curve params, no resolution mode,
 * no oracle. All of those are now hardcoded on-chain.
 *
 * @param program - Duel program instance
 * @param creator - Market creator public key (payer)
 * @param marketId - Unique market ID per creator
 * @param params - Market creation parameters
 * @param quoteMint - Quote token mint (default: NATIVE_MINT / WSOL)
 */
export async function buildInitializeMarketInstruction(
  program: Program<Duel>,
  creator: PublicKey,
  marketId: number | bigint,
  params: {
    deadline: BN;
    twapWindow: BN;
    twapInterval: BN;
    nameA: string;
    symbolA: string;
    uriA: string;
    nameB: string;
    symbolB: string;
    uriB: string;
    creatorFeeAccount: PublicKey;
  },
  quoteMint: PublicKey = NATIVE_MINT
) {
  const accounts = deriveMarketAccounts(creator, marketId);
  const [configPda] = findConfigPda();
  const [metadataA] = findMetadataPda(accounts.mintA);
  const [metadataB] = findMetadataPda(accounts.mintB);

  const instruction = await (program.methods as any)
    .initializeMarket(
      new BN(marketId.toString()),
      params.deadline,
      params.twapWindow,
      params.twapInterval,
      params.nameA,
      params.symbolA,
      params.uriA,
      params.nameB,
      params.symbolB,
      params.uriB
    )
    .accountsPartial({
      creator,
      market: accounts.market,
      sideA: accounts.sideA,
      sideB: accounts.sideB,
      tokenMintA: accounts.mintA,
      tokenMintB: accounts.mintB,
      tokenVaultA: accounts.tokenVaultA,
      tokenVaultB: accounts.tokenVaultB,
      quoteMint,
      quoteTokenProgram: TOKEN_PROGRAM_ID,
      quoteVaultA: accounts.quoteVaultA,
      quoteVaultB: accounts.quoteVaultB,
      protocolFeeAccount: (await fetchConfig(program)).protocolFeeAccount,
      config: configPda,
      metadataA,
      metadataB,
      tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
      creatorFeeAccount: params.creatorFeeAccount,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .instruction();

  return { instruction, accounts };
}

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

  const [configPda] = findConfigPda();
  const configData = await program.account.programConfig.fetch(configPda);

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

  const instruction = await (program.methods as any)
    .buyTokens(side, quoteAmount, minTokensOut)
    .accountsPartial({
      buyer,
      market,
      sideAccount: sideKey,
      tokenMint: sideData.tokenMint,
      tokenVault: sideData.tokenReserveVault,
      buyerTokenAccount,
      quoteMint,
      quoteVault: sideData.quoteReserveVault,
      buyerQuoteAccount,
      protocolFeeAccount: configData.protocolFeeAccount,
      creatorFeeAccount: (marketData as any).creatorFeeAccount,
      config: configPda,
      tokenProgram: TOKEN_PROGRAM_ID,
      quoteTokenProgram: TOKEN_PROGRAM_ID,
    })
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

  const [configPda] = findConfigPda();
  const configData = await program.account.programConfig.fetch(configPda);

  const sellerTokenAccount = await getAssociatedTokenAddress(
    sideData.tokenMint,
    seller
  );
  const sellerQuoteAccount = await getAssociatedTokenAddress(quoteMint, seller);

  const instruction = await (program.methods as any)
    .sellTokens(side, tokenAmount, minQuoteOut)
    .accountsPartial({
      seller,
      market,
      sideAccount: sideKey,
      tokenMint: sideData.tokenMint,
      tokenVault: sideData.tokenReserveVault,
      sellerTokenAccount,
      quoteMint,
      quoteVault: sideData.quoteReserveVault,
      sellerQuoteAccount,
      protocolFeeAccount: configData.protocolFeeAccount,
      creatorFeeAccount: (marketData as any).creatorFeeAccount,
      config: configPda,
      tokenProgram: TOKEN_PROGRAM_ID,
      quoteTokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();

  return { instruction };
}

/**
 * Build a record_twap_sample instruction (permissionless cranker).
 */
export async function buildRecordTwapSampleInstruction(
  program: Program<Duel>,
  market: PublicKey,
  cranker: PublicKey
) {
  const marketData = await program.account.market.fetch(market);

  const instruction = await (program.methods as any)
    .recordTwapSample()
    .accountsPartial({
      cranker,
      market,
      sideA: marketData.sideA,
      sideB: marketData.sideB,
    })
    .instruction();

  return { instruction };
}

/**
 * Build a resolve_and_graduate instruction.
 *
 * Atomically resolves the market via TWAP, transfers loser reserve to winner,
 * creates a Meteora DAMM v2 pool with winning side tokens + all SOL, and
 * permanently locks the LP position.
 *
 * @param program - Duel program instance
 * @param market - Market public key
 * @param expectedWinner - Expected winning side (0 = A, 1 = B)
 * @param resolver - Signer/payer public key
 * @param positionNftMint - Keypair for position NFT mint (must be signer)
 * @param quoteMint - Quote token mint (default: NATIVE_MINT / WSOL)
 */
export async function buildResolveAndGraduateInstruction(
  program: Program<Duel>,
  market: PublicKey,
  expectedWinner: number,
  resolver: PublicKey,
  positionNftMint: Keypair,
  quoteMint: PublicKey = NATIVE_MINT
) {
  const marketData = await program.account.market.fetch(market);
  const sideAData = await program.account.side.fetch(marketData.sideA);
  const sideBData = await program.account.side.fetch(marketData.sideB);

  const [configPda] = findConfigPda();

  // Determine winning side data for Meteora account derivation
  const winningSideData = expectedWinner === 0 ? sideAData : sideBData;
  const losingMint = expectedWinner === 0 ? sideBData.tokenMint : sideAData.tokenMint;
  const winningTokenMint = winningSideData.tokenMint;

  // Derive DAMM v2 PDAs
  const damm = deriveDammV2Accounts(
    winningTokenMint,
    positionNftMint.publicKey,
    WSOL_MINT
  );

  // Market PDA's ATAs for seeding the pool
  const marketTokenAta = await getAssociatedTokenAddress(
    winningTokenMint,
    market,
    true // allowOwnerOffCurve (PDA)
  );
  const marketWsolAta = await getAssociatedTokenAddress(
    WSOL_MINT,
    market,
    true
  );

  // Derive losing token metadata PDA
  const [losingTokenMetadata] = findMetadataPda(losingMint);

  // Pre-instructions: create market PDA's ATAs + compute budget
  const connection = program.provider.connection;
  const preInstructions: TransactionInstruction[] = [];

  // Compute budget
  preInstructions.push(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 800_000 })
  );

  const marketTokenAtaInfo = await connection.getAccountInfo(marketTokenAta);
  if (!marketTokenAtaInfo) {
    preInstructions.push(
      createAssociatedTokenAccountInstruction(
        resolver,
        marketTokenAta,
        market,
        winningTokenMint
      )
    );
  }

  const marketWsolAtaInfo = await connection.getAccountInfo(marketWsolAta);
  if (!marketWsolAtaInfo) {
    preInstructions.push(
      createAssociatedTokenAccountInstruction(
        resolver,
        marketWsolAta,
        market,
        WSOL_MINT
      )
    );
  }

  const instruction = await (program.methods as any)
    .resolveAndGraduate(expectedWinner)
    .accountsPartial({
      resolver,
      market,
      config: configPda,
      sideA: marketData.sideA,
      sideB: marketData.sideB,
      quoteVaultA: sideAData.quoteReserveVault,
      quoteVaultB: sideBData.quoteReserveVault,
      tokenVaultA: sideAData.tokenReserveVault,
      tokenVaultB: sideBData.tokenReserveVault,
      tokenMintA: sideAData.tokenMint,
      tokenMintB: sideBData.tokenMint,
      quoteMint,
      marketTokenAta,
      marketWsolAta,
      pool: damm.pool,
      positionNftMint: positionNftMint.publicKey,
      positionNftAccount: damm.positionNftAccount,
      position: damm.position,
      poolTokenVaultA: damm.tokenAVault,
      poolTokenVaultB: damm.tokenBVault,
      poolAuthority: damm.poolAuthority,
      eventAuthority: damm.eventAuthority,
      meteoraProgram: METEORA_DAMM_V2_PROGRAM_ID,
      losingTokenMetadata,
      tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
      tokenProgram: TOKEN_PROGRAM_ID,
      quoteTokenProgram: TOKEN_PROGRAM_ID,
      token2022Program: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: new PublicKey(
        "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
      ),
      systemProgram: SystemProgram.programId,
    })
    .signers([positionNftMint])
    .instruction();

  return {
    preInstructions,
    instruction,
    positionNftMint,
    accounts: {
      pool: damm.pool,
      position: damm.position,
      marketTokenAta,
      marketWsolAta,
    },
  };
}

/**
 * Build a sell_post_resolution instruction (after emergency resolve -- draw only).
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

  const [configPda] = findConfigPda();

  const sellerTokenAccount = await getAssociatedTokenAddress(
    sideData.tokenMint,
    seller
  );
  const sellerQuoteAccount = await getAssociatedTokenAddress(quoteMint, seller);

  const instruction = await (program.methods as any)
    .sellPostResolution(side, tokenAmount, minQuoteOut)
    .accountsPartial({
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
    })
    .instruction();

  return { instruction };
}

// ── Post-Graduation Instructions ────────────────────────────────────────

/**
 * Build claim_pool_fees instruction.
 * Claims accrued trading fees from a graduated Meteora DAMM v2 pool.
 * No side parameter -- claims for the winning side's pool.
 */
export async function buildClaimPoolFeesInstruction(
  program: Program<Duel>,
  market: PublicKey,
  authority: PublicKey,
  positionNftMint: PublicKey,
  winningTokenMint: PublicKey,
  feeReceiverTokenA: PublicKey,
  feeReceiverTokenB: PublicKey
) {
  const [configPda] = findConfigPda();

  const damm = deriveDammV2Accounts(
    winningTokenMint,
    positionNftMint,
    WSOL_MINT
  );

  const instruction = await (program.methods as any)
    .claimPoolFees()
    .accountsPartial({
      authority,
      market,
      config: configPda,
      tokenMint: winningTokenMint,
      wsolMint: WSOL_MINT,
      poolAuthority: damm.poolAuthority,
      pool: damm.pool,
      position: damm.position,
      feeReceiverTokenA,
      feeReceiverTokenB,
      tokenAVault: damm.tokenAVault,
      tokenBVault: damm.tokenBVault,
      positionNftAccount: damm.positionNftAccount,
      tokenAProgram: TOKEN_PROGRAM_ID,
      tokenBProgram: TOKEN_PROGRAM_ID,
      eventAuthority: damm.eventAuthority,
      meteoraProgram: METEORA_DAMM_V2_PROGRAM_ID,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();

  return { instruction };
}

// ── Cleanup & Emergency Instructions ────────────────────────────────────

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

  const instruction = await (program.methods as any)
    .closeQuoteVault(side)
    .accountsPartial({
      closer: rentReceiver,
      market,
      sideAccount: sideKey,
      quoteVault: sideData.quoteReserveVault,
      tokenVault: sideData.tokenReserveVault,
      rentReceiver,
      tokenProgram: TOKEN_PROGRAM_ID,
      quoteTokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();

  return { instruction };
}

/**
 * Build close_market instruction.
 * Closes market and side accounts to reclaim rent (resolved markets only).
 */
export async function buildCloseMarketInstruction(
  program: Program<Duel>,
  market: PublicKey,
  side: number,
  authority: PublicKey
) {
  const marketData = await program.account.market.fetch(market);
  const [configPda] = findConfigPda();

  const instruction = await (program.methods as any)
    .closeMarket(side)
    .accountsPartial({
      authority,
      market,
      sideA: marketData.sideA,
      sideB: marketData.sideB,
      config: configPda,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  return { instruction };
}

/**
 * Build emergency_resolve instruction.
 * Resolves as a draw when TWAP cranking fails and emergency window has passed.
 */
export async function buildEmergencyResolveInstruction(
  program: Program<Duel>,
  market: PublicKey,
  resolver: PublicKey
) {
  const marketData = await program.account.market.fetch(market);
  const [configPda] = findConfigPda();

  const instruction = await (program.methods as any)
    .emergencyResolve()
    .accountsPartial({
      resolver,
      market,
      config: configPda,
      sideA: marketData.sideA,
      sideB: marketData.sideB,
    })
    .instruction();

  return { instruction };
}
