/**
 * E2E test for the Quasar-built Duel Protocol.
 * Uses raw transaction construction since Quasar IDL isn't Anchor-compatible.
 */
import {
  Connection,
  PublicKey,
  SystemProgram,
  Keypair,
  Transaction,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
  ComputeBudgetProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
  getAccount,
} from "@solana/spl-token";
import * as anchor from "@coral-xyz/anchor";

const PROGRAM_ID = new PublicKey("J7pWj28bnEz7AEANx8o6q3MuC5Ugcqa2EXo7RAFdcb3G");
const TOKEN_METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

const conn = new Connection("http://localhost:8899", "confirmed");
const wallet = anchor.AnchorProvider.env().wallet;
const provider = new anchor.AnchorProvider(conn, wallet, { commitment: "confirmed" });

function findPda(seeds: Buffer[]): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(seeds, PROGRAM_ID);
}

function findMetadataPda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), TOKEN_METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    TOKEN_METADATA_PROGRAM_ID
  )[0];
}

async function getCU(sig: string): Promise<number> {
  const tx = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  return tx?.meta?.computeUnitsConsumed || 0;
}

// Quasar uses 1-byte discriminators. Build instruction data manually.
function buildIxData(discriminator: number, ...args: Buffer[]): Buffer {
  const totalLen = 1 + args.reduce((s, a) => s + a.length, 0);
  const buf = Buffer.alloc(totalLen);
  buf.writeUInt8(discriminator, 0);
  let offset = 1;
  for (const a of args) {
    a.copy(buf, offset);
    offset += a.length;
  }
  return buf;
}

function u16LE(v: number): Buffer { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; }
function u64LE(v: number | bigint): Buffer { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; }
function i64LE(v: number | bigint): Buffer { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(v)); return b; }
function u8Buf(v: number): Buffer { return Buffer.from([v]); }

// Borsh string: 4-byte LE length + UTF-8 bytes
function bString(s: string): Buffer {
  const strBuf = Buffer.from(s, "utf-8");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(strBuf.length);
  return Buffer.concat([lenBuf, strBuf]);
}

async function main() {
  console.log("=== Quasar Duel Protocol E2E Test ===\n");
  console.log("Program:", PROGRAM_ID.toString());
  console.log("Wallet:", wallet.publicKey.toString());

  const results: { step: string; status: string; cu?: number }[] = [];

  // ─── Step 1: Initialize Config (discriminator = 0) ───
  console.log("\n[1/7] Initialize Config...");
  const [configPda] = findPda([Buffer.from("config")]);
  const protocolFeeAta = await getAssociatedTokenAddress(NATIVE_MINT, wallet.publicKey);

  try {
    const setupTx = new Transaction().add(
      createAssociatedTokenAccountInstruction(wallet.publicKey, protocolFeeAta, wallet.publicKey, NATIVE_MINT)
    );
    await provider.sendAndConfirm(setupTx);
  } catch { /* exists */ }

  try {
    // disc=0, trade_fee_bps=100 (u16), creator_fee_split_bps=5000 (u16), market_creation_fee=0 (u64)
    const data = buildIxData(0, u16LE(100), u16LE(5000), u64LE(0));
    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true },  // admin
        { pubkey: configPda, isSigner: false, isWritable: true },        // config (PDA)
        { pubkey: protocolFeeAta, isSigner: false, isWritable: false },  // protocolFeeAccount
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      ],
      data,
    });
    const tx = new Transaction().add(ix);
    const sig = await provider.sendAndConfirm(tx);
    const cu = await getCU(sig);
    results.push({ step: "initialize_config", status: "OK", cu });
    console.log(`  OK (${cu.toLocaleString()} CU)`);
  } catch (e: any) {
    const msg = e.message?.slice(0, 120) || String(e);
    if (msg.includes("already in use")) {
      results.push({ step: "initialize_config", status: "OK (exists)" });
      console.log("  OK (already exists)");
    } else {
      results.push({ step: "initialize_config", status: `FAIL: ${msg}` });
      console.log(`  FAIL: ${msg}`);
      if (e.logs) e.logs.slice(-5).forEach((l: string) => console.log("    ", l));
      printResults(results);
      return;
    }
  }

  // ─── Step 2: Initialize Market (discriminator = 2) ───
  console.log("\n[2/7] Initialize Market...");
  const marketId = BigInt(Date.now());
  const idBuf = Buffer.alloc(8); idBuf.writeBigUInt64LE(marketId);
  const [market] = findPda([Buffer.from("market"), wallet.publicKey.toBuffer(), idBuf]);
  const [sideA] = findPda([Buffer.from("side"), market.toBuffer(), Buffer.from([0])]);
  const [sideB] = findPda([Buffer.from("side"), market.toBuffer(), Buffer.from([1])]);
  const [mintA] = findPda([Buffer.from("mint"), market.toBuffer(), Buffer.from([0])]);
  const [mintB] = findPda([Buffer.from("mint"), market.toBuffer(), Buffer.from([1])]);
  const [tvA] = findPda([Buffer.from("token_vault"), market.toBuffer(), Buffer.from([0])]);
  const [tvB] = findPda([Buffer.from("token_vault"), market.toBuffer(), Buffer.from([1])]);
  const [qvA] = findPda([Buffer.from("quote_vault"), market.toBuffer(), Buffer.from([0])]);
  const [qvB] = findPda([Buffer.from("quote_vault"), market.toBuffer(), Buffer.from([1])]);

  const now = Math.floor(Date.now() / 1000);
  const deadline = now + 25;
  const twapWindow = 15;
  const twapInterval = 10;

  try {
    // disc=2, market_id (u64), deadline (i64), twap_window (u64), twap_interval (u64),
    // name_a (string), symbol_a (string), uri_a (string),
    // name_b (string), symbol_b (string), uri_b (string)
    const data = buildIxData(2,
      u64LE(marketId), i64LE(deadline), u64LE(twapWindow), u64LE(twapInterval),
      bString("MESSI"), bString("MESSI"), bString(""),
      bString("RONALDO"), bString("CR7"), bString(""),
    );

    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true },   // creator
        { pubkey: market, isSigner: false, isWritable: true },             // market
        { pubkey: sideA, isSigner: false, isWritable: true },              // side_a
        { pubkey: sideB, isSigner: false, isWritable: true },              // side_b
        { pubkey: mintA, isSigner: false, isWritable: true },              // token_mint_a
        { pubkey: mintB, isSigner: false, isWritable: true },              // token_mint_b
        { pubkey: tvA, isSigner: false, isWritable: true },                // token_vault_a
        { pubkey: tvB, isSigner: false, isWritable: true },                // token_vault_b
        { pubkey: NATIVE_MINT, isSigner: false, isWritable: false },       // quote_mint
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },  // quote_token_program
        { pubkey: qvA, isSigner: false, isWritable: true },                // quote_vault_a
        { pubkey: qvB, isSigner: false, isWritable: true },                // quote_vault_b
        { pubkey: protocolFeeAta, isSigner: false, isWritable: false },    // protocol_fee_account
        { pubkey: configPda, isSigner: false, isWritable: false },         // config
        { pubkey: findMetadataPda(mintA), isSigner: false, isWritable: true }, // metadata_a
        { pubkey: findMetadataPda(mintB), isSigner: false, isWritable: true }, // metadata_b
        { pubkey: TOKEN_METADATA_PROGRAM_ID, isSigner: false, isWritable: false }, // token_metadata_program
        { pubkey: protocolFeeAta, isSigner: false, isWritable: false },    // creator_fee_account
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },  // token_program
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction()
      .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }))
      .add(ix);
    const sig = await provider.sendAndConfirm(tx);
    const cu = await getCU(sig);
    results.push({ step: "initialize_market", status: "OK", cu });
    console.log(`  OK (${cu.toLocaleString()} CU)`);
    console.log(`  Market: ${market.toString().slice(0, 16)}...`);
  } catch (e: any) {
    results.push({ step: "initialize_market", status: `FAIL` });
    console.log(`  FAIL: ${e.message?.slice(0, 200)}`);
    if (e.logs) e.logs.slice(-8).forEach((l: string) => console.log("    ", l));
    printResults(results);
    return;
  }

  // ─── Step 3: Buy Tokens Side A (discriminator = 3) ───
  console.log("\n[3/7] Buy Tokens (Side A, 1 SOL)...");
  const buyerAtaA = await getAssociatedTokenAddress(mintA, wallet.publicKey);

  try {
    // Read config to get protocolFeeAccount
    const configInfo = await conn.getAccountInfo(configPda);
    // For now use protocolFeeAta as both protocol and creator fee account

    const buyTx = new Transaction();
    try { await getAccount(conn, buyerAtaA); } catch {
      buyTx.add(createAssociatedTokenAccountInstruction(wallet.publicKey, buyerAtaA, wallet.publicKey, mintA));
    }
    buyTx.add(SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: protocolFeeAta, lamports: LAMPORTS_PER_SOL }));
    buyTx.add(createSyncNativeInstruction(protocolFeeAta));

    // disc=3, side (u8), quote_amount (u64), min_tokens_out (u64)
    const data = buildIxData(3, u8Buf(0), u64LE(LAMPORTS_PER_SOL), u64LE(1));
    buyTx.add(new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: market, isSigner: false, isWritable: true },
        { pubkey: sideA, isSigner: false, isWritable: true },
        { pubkey: mintA, isSigner: false, isWritable: false },
        { pubkey: tvA, isSigner: false, isWritable: true },
        { pubkey: buyerAtaA, isSigner: false, isWritable: true },
        { pubkey: NATIVE_MINT, isSigner: false, isWritable: false },
        { pubkey: qvA, isSigner: false, isWritable: true },
        { pubkey: protocolFeeAta, isSigner: false, isWritable: true },  // buyer's WSOL
        { pubkey: protocolFeeAta, isSigner: false, isWritable: true },  // protocol_fee_account
        { pubkey: protocolFeeAta, isSigner: false, isWritable: true },  // creator_fee_account
        { pubkey: configPda, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data,
    }));

    const sig = await provider.sendAndConfirm(buyTx);
    const cu = await getCU(sig);
    const tokenBal = await getAccount(conn, buyerAtaA);
    results.push({ step: "buy_tokens (A)", status: "OK", cu });
    console.log(`  OK (${cu.toLocaleString()} CU)`);
    console.log(`  Tokens: ${Number(tokenBal.amount).toLocaleString()}`);
  } catch (e: any) {
    results.push({ step: "buy_tokens (A)", status: "FAIL" });
    console.log(`  FAIL: ${e.message?.slice(0, 200)}`);
    if (e.logs) e.logs.slice(-8).forEach((l: string) => console.log("    ", l));
  }

  // ─── Step 4: Buy Side B (0.5 SOL) ───
  console.log("\n[4/7] Buy Tokens (Side B, 0.5 SOL)...");
  const buyerAtaB = await getAssociatedTokenAddress(mintB, wallet.publicKey);

  try {
    const buyTx = new Transaction();
    try { await getAccount(conn, buyerAtaB); } catch {
      buyTx.add(createAssociatedTokenAccountInstruction(wallet.publicKey, buyerAtaB, wallet.publicKey, mintB));
    }
    buyTx.add(SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: protocolFeeAta, lamports: LAMPORTS_PER_SOL / 2 }));
    buyTx.add(createSyncNativeInstruction(protocolFeeAta));

    const data = buildIxData(3, u8Buf(1), u64LE(LAMPORTS_PER_SOL / 2), u64LE(1));
    buyTx.add(new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: market, isSigner: false, isWritable: true },
        { pubkey: sideB, isSigner: false, isWritable: true },
        { pubkey: mintB, isSigner: false, isWritable: false },
        { pubkey: tvB, isSigner: false, isWritable: true },
        { pubkey: buyerAtaB, isSigner: false, isWritable: true },
        { pubkey: NATIVE_MINT, isSigner: false, isWritable: false },
        { pubkey: qvB, isSigner: false, isWritable: true },
        { pubkey: protocolFeeAta, isSigner: false, isWritable: true },
        { pubkey: protocolFeeAta, isSigner: false, isWritable: true },
        { pubkey: protocolFeeAta, isSigner: false, isWritable: true },
        { pubkey: configPda, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data,
    }));

    const sig = await provider.sendAndConfirm(buyTx);
    const cu = await getCU(sig);
    const tokenBal = await getAccount(conn, buyerAtaB);
    results.push({ step: "buy_tokens (B)", status: "OK", cu });
    console.log(`  OK (${cu.toLocaleString()} CU)`);
    console.log(`  Tokens: ${Number(tokenBal.amount).toLocaleString()}`);
  } catch (e: any) {
    results.push({ step: "buy_tokens (B)", status: "FAIL" });
    console.log(`  FAIL: ${e.message?.slice(0, 200)}`);
    if (e.logs) e.logs.slice(-8).forEach((l: string) => console.log("    ", l));
  }

  // ─── Step 5: Sell half of Side A (discriminator = 4) ───
  console.log("\n[5/7] Sell Tokens (half of Side A)...");
  try {
    const tokenBal = await getAccount(conn, buyerAtaA);
    const sellAmount = Number(tokenBal.amount) / 2;

    const data = buildIxData(4, u8Buf(0), u64LE(sellAmount), u64LE(1));
    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: market, isSigner: false, isWritable: true },
        { pubkey: sideA, isSigner: false, isWritable: true },
        { pubkey: mintA, isSigner: false, isWritable: false },
        { pubkey: tvA, isSigner: false, isWritable: true },
        { pubkey: buyerAtaA, isSigner: false, isWritable: true },
        { pubkey: NATIVE_MINT, isSigner: false, isWritable: false },
        { pubkey: qvA, isSigner: false, isWritable: true },
        { pubkey: protocolFeeAta, isSigner: false, isWritable: true },
        { pubkey: protocolFeeAta, isSigner: false, isWritable: true },
        { pubkey: protocolFeeAta, isSigner: false, isWritable: true },
        { pubkey: configPda, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data,
    });

    const sig = await provider.sendAndConfirm(new Transaction().add(ix));
    const cu = await getCU(sig);
    results.push({ step: "sell_tokens", status: "OK", cu });
    console.log(`  OK (${cu.toLocaleString()} CU)`);
    console.log(`  Sold: ${sellAmount.toLocaleString()} tokens`);
  } catch (e: any) {
    results.push({ step: "sell_tokens", status: "FAIL" });
    console.log(`  FAIL: ${e.message?.slice(0, 200)}`);
    if (e.logs) e.logs.slice(-8).forEach((l: string) => console.log("    ", l));
  }

  // ─── Step 6: TWAP Sample (discriminator = 5) ───
  console.log("\n[6/7] Record TWAP Sample...");
  const waitForTwap = Math.max(0, (deadline - twapWindow) - Math.floor(Date.now() / 1000) + 1);
  if (waitForTwap > 0) {
    console.log(`  Waiting ${waitForTwap}s for TWAP window...`);
    await new Promise(r => setTimeout(r, waitForTwap * 1000));
  }

  try {
    const data = buildIxData(5);
    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: wallet.publicKey, isSigner: true, isWritable: false },
        { pubkey: market, isSigner: false, isWritable: true },
        { pubkey: sideA, isSigner: false, isWritable: true },
        { pubkey: sideB, isSigner: false, isWritable: true },
      ],
      data,
    });
    const sig = await provider.sendAndConfirm(new Transaction().add(ix));
    const cu = await getCU(sig);
    results.push({ step: "record_twap_sample", status: "OK", cu });
    console.log(`  OK (${cu.toLocaleString()} CU)`);
  } catch (e: any) {
    results.push({ step: "record_twap_sample", status: "FAIL" });
    console.log(`  FAIL: ${e.message?.slice(0, 200)}`);
    if (e.logs) e.logs.slice(-8).forEach((l: string) => console.log("    ", l));
  }

  // ─── Step 7: Wait for deadline, read final state ───
  console.log("\n[7/7] Final state...");
  const remaining = Math.max(0, deadline - Math.floor(Date.now() / 1000) + 1);
  if (remaining > 0) {
    console.log(`  Waiting ${remaining}s for deadline...`);
    await new Promise(r => setTimeout(r, remaining * 1000));
  }

  try {
    const qvABal = await getAccount(conn, qvA);
    const qvBBal = await getAccount(conn, qvB);
    console.log(`  Quote vault A: ${(Number(qvABal.amount) / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
    console.log(`  Quote vault B: ${(Number(qvBBal.amount) / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
    results.push({ step: "final_state", status: "OK" });
  } catch (e: any) {
    results.push({ step: "final_state", status: "FAIL" });
    console.log(`  FAIL: ${e.message?.slice(0, 120)}`);
  }

  printResults(results);
}

function printResults(results: { step: string; status: string; cu?: number }[]) {
  const passed = results.filter(r => r.status.startsWith("OK")).length;
  const failed = results.filter(r => !r.status.startsWith("OK")).length;

  console.log("\n\n=== QUASAR E2E RESULTS ===\n");
  for (const r of results) {
    const icon = r.status.startsWith("OK") ? "+" : "x";
    const cuStr = r.cu ? ` (${r.cu.toLocaleString()} CU)` : "";
    console.log(`  ${icon} ${r.step.padEnd(24)} ${r.status}${cuStr}`);
  }
  console.log(`\n  ${passed} passed, ${failed} failed\n`);

  const cuResults = results.filter(r => r.cu);
  if (cuResults.length > 0) {
    console.log("  Quasar CU (measured on-chain):");
    for (const r of cuResults) {
      console.log(`    ${r.step.padEnd(24)} ${r.cu!.toLocaleString().padStart(10)} CU`);
    }
    console.log("");
  }
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
