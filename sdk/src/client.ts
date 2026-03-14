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
import { Duel } from "../../target/types/duel";
import IDL from "../idl/duel.json";
import {
  PROGRAM_ID,
  METEORA_DAMM_V2_PROGRAM_ID,
  WSOL_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_METADATA_PROGRAM_ID,
  CURVE_SCALE,
  BASE_SELL_FEE_BPS,
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
  const [configPda] = findConfigPda();
  return program.account.programConfig.fetch(configPda);
}

// ─── Math Helpers ────────────────────────────────────────────────────────

/**
 * Price at a given circulating supply.
 * price(k) = a * k^n / CURVE_SCALE + b
 *
 * @param circulatingSupply - Number of tokens currently in circulation (raw u64, 6 decimals)
 * @param curveParams - { a, n, b } from on-chain CurveParams
 * @returns Price in lamports (integer)
 */
export function calculatePrice(
  circulatingSupply: number,
  curveParams: { a: number; n: number; b: number }
): number {
  const { a, n, b } = curveParams;
  const k = circulatingSupply;
  const term = (a * Math.pow(k, n)) / CURVE_SCALE;
  return Math.floor(term + b);
}

/**
 * Reserve integral R(k) = a * k^(n+1) / ((n+1) * CURVE_SCALE) + b * k
 *
 * @param supply - Circulating supply
 * @param curveParams - { a, n, b }
 * @returns Reserve in lamports (may lose precision for very large values)
 */
export function calculateReserve(
  supply: number,
  curveParams: { a: number; n: number; b: number }
): number {
  const { a, n, b } = curveParams;
  const nPlus1 = n + 1;
  const term1 = (a * Math.pow(supply, nPlus1)) / (nPlus1 * CURVE_SCALE);
  const term2 = b * supply;
  return Math.floor(term1 + term2);
}

/**
 * Calculate tokens received for a given quote amount (buy).
 * Uses binary search matching the on-chain implementation.
 *
 * @param quoteAmount - Amount of quote tokens to spend (lamports)
 * @param currentSupply - Current circulating supply
 * @param totalSupply - Total supply per side
 * @param curveParams - { a, n, b }
 * @returns Number of tokens received
 */
export function calculateTokensOut(
  quoteAmount: number,
  currentSupply: number,
  totalSupply: number,
  curveParams: { a: number; n: number; b: number }
): number {
  if (quoteAmount === 0) return 0;
  const available = totalSupply - currentSupply;
  if (available <= 0) return 0;

  const rCurrent = calculateReserve(currentSupply, curveParams);

  let lo = 0;
  let hi = available;
  let best = 0;

  while (lo <= hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    const rNew = calculateReserve(currentSupply + mid, curveParams);
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
 * @param curveParams - { a, n, b }
 * @returns Quote tokens received (lamports, before penalty)
 */
export function calculateQuoteOut(
  tokenAmount: number,
  currentSupply: number,
  curveParams: { a: number; n: number; b: number }
): number {
  if (tokenAmount === 0) return 0;
  if (currentSupply < tokenAmount) throw new Error("Insufficient supply");
  const rCurrent = calculateReserve(currentSupply, curveParams);
  const rNew = calculateReserve(currentSupply - tokenAmount, curveParams);
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
 * Calculate sell penalty in basis points.
 * penalty = BASE_SELL_FEE + maxPenalty * (1 - r/rPeak)^2
 *
 * @param currentReserve - Current quote reserve
 * @param peakReserve - Historical peak reserve
 * @param maxPenaltyBps - Maximum additional penalty in bps
 * @returns Penalty in basis points
 */
export function calculateSellPenalty(
  currentReserve: number,
  peakReserve: number,
  maxPenaltyBps: number
): number {
  if (peakReserve === 0) return BASE_SELL_FEE_BPS;
  const ratio = currentReserve / peakReserve;
  const deficit = Math.max(0, 1 - ratio);
  const penalty = BASE_SELL_FEE_BPS + maxPenaltyBps * deficit * deficit;
  return Math.min(Math.floor(penalty), BPS_DENOMINATOR);
}

// ─── Instruction Builders ────────────────────────────────────────────────

// ── Admin Instructions ──────────────────────────────────────────────────

/**
 * Build an initialize_config instruction.
 */
export async function buildInitializeConfigInstruction(
  program: Program<Duel>,
  admin: PublicKey,
  protocolFeeAccount: PublicKey,
  defaultProtocolFeeBps: number,
  marketCreationFee: BN
) {
  const [configPda] = findConfigPda();

  const instruction = await program.methods
    .initializeConfig(defaultProtocolFeeBps, marketCreationFee)
    .accounts({
      admin,
      config: configPda,
      protocolFeeAccount,
      systemProgram: SystemProgram.programId,
    } as any)
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
    defaultProtocolFeeBps?: number;
    marketCreationFee?: BN;
    minMarketDuration?: BN;
    newProtocolFeeAccount?: PublicKey;
    newAdmin?: PublicKey;
  }
) {
  const [configPda] = findConfigPda();

  const instruction = await program.methods
    .updateConfig(
      opts.paused ?? null,
      opts.defaultProtocolFeeBps ?? null,
      opts.marketCreationFee ?? null,
      opts.minMarketDuration ?? null
    )
    .accounts({
      admin,
      config: configPda,
      newProtocolFeeAccount: opts.newProtocolFeeAccount ?? null,
      newAdmin: opts.newAdmin ?? null,
    } as any)
    .instruction();

  return { instruction };
}

// ── Market Lifecycle Instructions ───────────────────────────────────────

/**
 * Build an initialize_market instruction.
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
    battleTaxBps: number;
    protocolFeeBps: number;
    sellPenaltyMaxBps: number;
    protectionActivationOffset: BN;
    curveParams: { a: BN; n: number; b: BN };
    totalSupplyPerSide: BN;
    nameA: string;
    symbolA: string;
    uriA: string;
    nameB: string;
    symbolB: string;
    uriB: string;
    lpLockMode: any;
    maxObservationChangePerUpdate: BN;
    minTwapSpreadBps: number;
    creatorFeeBps: number;
    resolutionMode: any;
    oracleAuthority: PublicKey;
    oracleDisputeWindow: BN;
    creatorFeeAccount: PublicKey;
  },
  quoteMint: PublicKey = NATIVE_MINT
) {
  const accounts = deriveMarketAccounts(creator, marketId);
  const [configPda] = findConfigPda();
  const [metadataA] = findMetadataPda(accounts.mintA);
  const [metadataB] = findMetadataPda(accounts.mintB);

  const instruction = await program.methods
    .initializeMarket(
      new BN(marketId.toString()),
      params.deadline,
      params.twapWindow,
      params.twapInterval,
      params.battleTaxBps,
      params.protocolFeeBps,
      params.sellPenaltyMaxBps,
      params.protectionActivationOffset,
      params.curveParams,
      params.totalSupplyPerSide,
      params.nameA,
      params.symbolA,
      params.uriA,
      params.nameB,
      params.symbolB,
      params.uriB,
      params.lpLockMode,
      params.maxObservationChangePerUpdate,
      params.minTwapSpreadBps,
      params.creatorFeeBps,
      params.resolutionMode,
      params.oracleAuthority,
      params.oracleDisputeWindow
    )
    .accounts({
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
    } as any)
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

  const [configPda] = findConfigPda();

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
 * Build a record_twap_sample instruction (permissionless cranker).
 */
export async function buildRecordTwapSampleInstruction(
  program: Program<Duel>,
  market: PublicKey,
  cranker: PublicKey
) {
  const marketData = await program.account.market.fetch(market);

  const instruction = await program.methods
    .recordTwapSample()
    .accounts({
      cranker,
      market,
      sideA: marketData.sideA,
      sideB: marketData.sideB,
    } as any)
    .instruction();

  return { instruction };
}

/**
 * Build a resolve_market instruction (permissionless TWAP resolution).
 */
export async function buildResolveMarketInstruction(
  program: Program<Duel>,
  market: PublicKey,
  resolver: PublicKey
) {
  const marketData = await program.account.market.fetch(market);
  const sideAData = await program.account.side.fetch(marketData.sideA);
  const sideBData = await program.account.side.fetch(marketData.sideB);

  const instruction = await program.methods
    .resolveMarket()
    .accounts({
      resolver,
      market,
      sideA: marketData.sideA,
      sideB: marketData.sideB,
      quoteMint: marketData.quoteMint,
      quoteVaultA: sideAData.quoteReserveVault,
      quoteVaultB: sideBData.quoteReserveVault,
      protocolFeeAccount: marketData.protocolFeeAccount,
      creatorFeeAccount: marketData.creatorFeeAccount,
      quoteTokenProgram: TOKEN_PROGRAM_ID,
    } as any)
    .instruction();

  return { instruction };
}

/**
 * Build a resolve_with_oracle instruction (oracle-submitted resolution).
 */
export async function buildResolveWithOracleInstruction(
  program: Program<Duel>,
  market: PublicKey,
  oracle: PublicKey,
  winningSide: number
) {
  const marketData = await program.account.market.fetch(market);
  const sideAData = await program.account.side.fetch(marketData.sideA);
  const sideBData = await program.account.side.fetch(marketData.sideB);

  const instruction = await program.methods
    .resolveWithOracle(winningSide)
    .accounts({
      oracle,
      market,
      sideA: marketData.sideA,
      sideB: marketData.sideB,
      quoteMint: marketData.quoteMint,
      quoteVaultA: sideAData.quoteReserveVault,
      quoteVaultB: sideBData.quoteReserveVault,
      protocolFeeAccount: marketData.protocolFeeAccount,
      creatorFeeAccount: marketData.creatorFeeAccount,
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

  const [configPda] = findConfigPda();

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

// ── Graduation & Post-Graduation Instructions ───────────────────────────

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
 * Build claim_pool_fees instruction.
 * Claims accrued trading fees from a graduated Meteora DAMM v2 pool.
 */
export async function buildClaimPoolFeesInstruction(
  program: Program<Duel>,
  market: PublicKey,
  side: number,
  authority: PublicKey,
  positionNftMint: PublicKey,
  feeReceiverTokenA: PublicKey,
  feeReceiverTokenB: PublicKey
) {
  const marketData = await program.account.market.fetch(market);
  const sideKey = side === 0 ? marketData.sideA : marketData.sideB;
  const sideData = await program.account.side.fetch(sideKey);
  const [configPda] = findConfigPda();

  const damm = deriveDammV2Accounts(
    sideData.tokenMint,
    positionNftMint,
    WSOL_MINT
  );

  const instruction = await program.methods
    .claimPoolFees(side)
    .accounts({
      authority,
      market,
      config: configPda,
      sideAccount: sideKey,
      tokenMint: sideData.tokenMint,
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
    } as any)
    .instruction();

  return { instruction };
}

/**
 * Build lock_position instruction.
 * Permanently locks LP liquidity in a Meteora DAMM v2 position.
 */
export async function buildLockPositionInstruction(
  program: Program<Duel>,
  market: PublicKey,
  side: number,
  authority: PublicKey,
  positionNftMint: PublicKey,
  lockLiquidity: BN
) {
  const marketData = await program.account.market.fetch(market);
  const sideKey = side === 0 ? marketData.sideA : marketData.sideB;
  const sideData = await program.account.side.fetch(sideKey);

  const damm = deriveDammV2Accounts(
    sideData.tokenMint,
    positionNftMint,
    WSOL_MINT
  );

  const instruction = await program.methods
    .lockPosition(side, lockLiquidity)
    .accounts({
      authority,
      market,
      sideAccount: sideKey,
      pool: damm.pool,
      position: damm.position,
      positionNftAccount: damm.positionNftAccount,
      eventAuthority: damm.eventAuthority,
      meteoraProgram: METEORA_DAMM_V2_PROGRAM_ID,
    } as any)
    .instruction();

  return { instruction };
}

/**
 * Build remove_liquidity instruction.
 * Removes LP liquidity from a Meteora DAMM v2 pool (only when lp_lock_mode == Unlocked).
 */
export async function buildRemoveLiquidityInstruction(
  program: Program<Duel>,
  market: PublicKey,
  side: number,
  authority: PublicKey,
  positionNftMint: PublicKey,
  liquidityDelta: BN,
  minTokenA: BN,
  minTokenB: BN,
  tokenAAccount: PublicKey,
  tokenBAccount: PublicKey
) {
  const marketData = await program.account.market.fetch(market);
  const sideKey = side === 0 ? marketData.sideA : marketData.sideB;
  const sideData = await program.account.side.fetch(sideKey);
  const [configPda] = findConfigPda();

  const damm = deriveDammV2Accounts(
    sideData.tokenMint,
    positionNftMint,
    WSOL_MINT
  );

  const instruction = await program.methods
    .removeLiquidity(side, liquidityDelta, minTokenA, minTokenB)
    .accounts({
      authority,
      market,
      config: configPda,
      sideAccount: sideKey,
      tokenMint: sideData.tokenMint,
      wsolMint: WSOL_MINT,
      poolAuthority: damm.poolAuthority,
      pool: damm.pool,
      position: damm.position,
      tokenAAccount,
      tokenBAccount,
      tokenAVault: damm.tokenAVault,
      tokenBVault: damm.tokenBVault,
      positionNftAccount: damm.positionNftAccount,
      tokenAProgram: TOKEN_PROGRAM_ID,
      tokenBProgram: TOKEN_PROGRAM_ID,
      eventAuthority: damm.eventAuthority,
      meteoraProgram: METEORA_DAMM_V2_PROGRAM_ID,
    } as any)
    .instruction();

  return { instruction };
}

/**
 * Build close_position instruction.
 * Closes a Meteora position NFT and reclaims rent (only when lp_lock_mode == Unlocked).
 */
export async function buildClosePositionInstruction(
  program: Program<Duel>,
  market: PublicKey,
  side: number,
  authority: PublicKey,
  positionNftMint: PublicKey,
  rentReceiver: PublicKey
) {
  const marketData = await program.account.market.fetch(market);
  const sideKey = side === 0 ? marketData.sideA : marketData.sideB;
  const sideData = await program.account.side.fetch(sideKey);
  const [configPda] = findConfigPda();

  const damm = deriveDammV2Accounts(
    sideData.tokenMint,
    positionNftMint,
    WSOL_MINT
  );

  const instruction = await program.methods
    .closePosition(side)
    .accounts({
      authority,
      market,
      config: configPda,
      sideAccount: sideKey,
      positionNftMint,
      positionNftAccount: damm.positionNftAccount,
      pool: damm.pool,
      position: damm.position,
      poolAuthority: damm.poolAuthority,
      rentReceiver,
      token2022Program: TOKEN_2022_PROGRAM_ID,
      eventAuthority: damm.eventAuthority,
      meteoraProgram: METEORA_DAMM_V2_PROGRAM_ID,
    } as any)
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

  const instruction = await program.methods
    .closeMarket(side)
    .accounts({
      authority,
      market,
      sideA: marketData.sideA,
      sideB: marketData.sideB,
      config: configPda,
      systemProgram: SystemProgram.programId,
    } as any)
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

  const instruction = await program.methods
    .emergencyResolve()
    .accounts({
      resolver,
      market,
      config: configPda,
      sideA: marketData.sideA,
      sideB: marketData.sideB,
    } as any)
    .instruction();

  return { instruction };
}
