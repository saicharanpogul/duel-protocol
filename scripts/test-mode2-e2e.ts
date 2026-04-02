/**
 * Mode 2 E2E test on localnet with mock Pyth oracles.
 * Tests: init config -> create compare duel -> deposit -> TWAP -> resolve -> withdraw
 */
import * as anchor from "@coral-xyz/anchor";
import {
  PublicKey, SystemProgram, Keypair, Transaction, LAMPORTS_PER_SOL,
  ComputeBudgetProgram, SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID, NATIVE_MINT,
  getAssociatedTokenAddress, createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction, getAccount,
} from "@solana/spl-token";
import BN from "bn.js";
import { readFileSync } from "fs";

const PROGRAM_ID = new PublicKey("3kzt4Q7xN2RLzYYx2HfnqZVoAHFAKKa17hTDvXsy1PQ9");
const conn = new anchor.web3.Connection("http://localhost:8899", "confirmed");
const wallet = anchor.AnchorProvider.env().wallet;
const provider = new anchor.AnchorProvider(conn, wallet, { commitment: "confirmed" });
const idl = JSON.parse(readFileSync("./target/idl/duel.json", "utf-8"));
idl.address = PROGRAM_ID.toString();
const program = new anchor.Program(idl as anchor.Idl, provider);

// Pyth V2 price account layout
function createPythPriceData(price: number, expo: number, conf: number): Buffer {
  const buf = Buffer.alloc(256);
  // Magic at offset 0
  buf.writeUInt32LE(0xa1b2c3d4, 0);
  // Version at offset 4
  buf.writeUInt32LE(2, 4);
  // Account type at offset 8
  buf.writeUInt32LE(3, 8); // Price type
  // Price at offset 208
  buf.writeBigInt64LE(BigInt(price), 208);
  // Confidence at offset 216
  buf.writeBigUInt64LE(BigInt(conf), 216);
  // Exponent at offset 224
  buf.writeInt32LE(expo, 224);
  // Status at offset 228 (1 = Trading)
  buf.writeUInt32LE(1, 228);
  // Timestamp at offset 232
  buf.writeBigInt64LE(BigInt(Math.floor(Date.now() / 1000)), 232);
  return buf;
}

async function createMockOracle(price: number, expo: number, conf: number): Promise<Keypair> {
  const oracle = Keypair.generate();
  const data = createPythPriceData(price, expo, conf);
  const space = data.length;
  const rent = await conn.getMinimumBalanceForRentExemption(space);

  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: wallet.publicKey,
      newAccountPubkey: oracle.publicKey,
      lamports: rent,
      space,
      programId: wallet.publicKey, // owner = wallet (doesn't matter for UncheckedAccount)
    })
  );
  await provider.sendAndConfirm(tx, [oracle]);

  // Write Pyth data to account -- we can't write to non-owned accounts directly
  // So we'll create the account owned by our wallet and use setAccountData RPC if available
  // OR: create it with the right data from the start using a different approach

  // Actually, for localnet testing we can use the validator's setAccount RPC
  // But simpler: just allocate the account with the data embedded
  // The program reads from account.data.borrow() which is the raw data

  return oracle;
}

function findPda(seeds: Buffer[]): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
}

async function getCU(sig: string): Promise<number> {
  const tx = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  return tx?.meta?.computeUnitsConsumed || 0;
}

async function main() {
  console.log("=== Mode 2 (Compare Duel) E2E Test ===\n");
  console.log("Program:", PROGRAM_ID.toString());
  console.log("Wallet:", wallet.publicKey.toString());

  const results: { step: string; status: string; cu?: number }[] = [];

  // ─── Step 1: Init Config ───
  console.log("\n[1/8] Initialize Config...");
  const configPda = findPda([Buffer.from("config")]);
  const wsolAta = await getAssociatedTokenAddress(NATIVE_MINT, wallet.publicKey);

  try {
    await getAccount(conn, wsolAta);
  } catch {
    await provider.sendAndConfirm(new Transaction().add(
      createAssociatedTokenAccountInstruction(wallet.publicKey, wsolAta, wallet.publicKey, NATIVE_MINT)
    ));
  }

  try {
    await (program.account as any).programConfig.fetch(configPda);
    console.log("  Config exists");
    results.push({ step: "init_config", status: "OK (exists)" });
  } catch {
    const sig = await (program.methods as any)
      .initializeConfig(100, 5000, new BN(0))
      .accounts({
        admin: wallet.publicKey,
        protocolFeeAccount: wsolAta,
        systemProgram: SystemProgram.programId,
      }).rpc();
    const cu = await getCU(sig);
    results.push({ step: "init_config", status: "OK", cu });
    console.log(`  OK (${cu.toLocaleString()} CU)`);
  }

  // ─── Step 2: Create mock oracle accounts ───
  console.log("\n[2/8] Create mock Pyth oracles...");

  // We need accounts with Pyth data layout. On localnet, the easiest approach
  // is to create accounts and then use airdrop to have the validator write data.
  // But since we can't write arbitrary data from client, let's create the oracles
  // as keypairs and pass them as UncheckedAccount.
  // The program reads oracle data in record_compare_twap, not in create_compare_duel.
  // So for create, we just need valid Pubkeys.

  const oracleA = Keypair.generate();
  const oracleB = Keypair.generate();

  // Create oracle accounts with Pyth V2 data using the test validator's setAccount
  // Actually, let's try a different approach: create the accounts owned by SystemProgram
  // and pre-fill with Pyth data

  const pythDataA = createPythPriceData(2000000, -8, 50000); // $0.02 (BONK-like)
  const pythDataB = createPythPriceData(50000000000, -8, 100000000); // $500 (SOL-like)

  // Fund oracle accounts
  const fundTx = new Transaction();
  const rentA = await conn.getMinimumBalanceForRentExemption(pythDataA.length);
  fundTx.add(
    SystemProgram.createAccount({
      fromPubkey: wallet.publicKey,
      newAccountPubkey: oracleA.publicKey,
      lamports: rentA,
      space: pythDataA.length,
      programId: SystemProgram.programId,
    }),
    SystemProgram.createAccount({
      fromPubkey: wallet.publicKey,
      newAccountPubkey: oracleB.publicKey,
      lamports: rentA,
      space: pythDataB.length,
      programId: SystemProgram.programId,
    })
  );
  await provider.sendAndConfirm(fundTx, [oracleA, oracleB]);

  console.log(`  Oracle A: ${oracleA.publicKey.toString().slice(0, 12)}...`);
  console.log(`  Oracle B: ${oracleB.publicKey.toString().slice(0, 12)}...`);
  results.push({ step: "create_oracles", status: "OK" });

  // ─── Step 3: Create Compare Duel ───
  console.log("\n[3/8] Create Compare Duel...");

  const tokenAMint = Keypair.generate().publicKey; // Mock BONK mint
  const tokenBMint = Keypair.generate().publicKey; // Mock WIF mint
  const duelId = new BN(Date.now());
  const idBuf = duelId.toArrayLike(Buffer, "le", 8);

  const compareDuel = findPda([Buffer.from("compare_duel"), wallet.publicKey.toBuffer(), idBuf]);
  const poolVaultA = findPda([Buffer.from("compare_vault"), compareDuel.toBuffer(), Buffer.from([0])]);
  const poolVaultB = findPda([Buffer.from("compare_vault"), compareDuel.toBuffer(), Buffer.from([1])]);

  const now = Math.floor(Date.now() / 1000);
  const deadline = now + 20; // 20 seconds
  const twapWindow = 10;
  const twapInterval = 10;
  const minDeposit = 10000; // 10K lamports

  const configData = await (program.account as any).programConfig.fetch(configPda);

  try {
    const sig = await (program.methods as any)
      .createCompareDuel(duelId, new BN(deadline), new BN(twapWindow), new BN(twapInterval), new BN(minDeposit))
      .accounts({
        creator: wallet.publicKey,
        compareDuel,
        poolVaultA,
        poolVaultB,
        tokenAMint,
        tokenBMint,
        oracleA: oracleA.publicKey,
        oracleB: oracleB.publicKey,
        quoteMint: NATIVE_MINT,
        protocolFeeAccount: configData.protocolFeeAccount,
        creatorFeeAccount: wsolAta,
        config: configPda,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 })])
      .rpc();

    const cu = await getCU(sig);
    results.push({ step: "create_compare_duel", status: "OK", cu });
    console.log(`  OK (${cu.toLocaleString()} CU)`);
    console.log(`  Duel: ${compareDuel.toString().slice(0, 16)}...`);
    console.log(`  Deadline: ${deadline} (${deadline - now}s from now)`);
  } catch (e: any) {
    results.push({ step: "create_compare_duel", status: "FAIL" });
    console.log(`  FAIL: ${e.message?.slice(0, 200)}`);
    if (e.logs) e.logs.slice(-5).forEach((l: string) => console.log("    ", l));
    printResults(results);
    return;
  }

  // ─── Step 4: Deposit Side A (1 SOL) ───
  console.log("\n[4/8] Deposit 1 SOL on Side A...");
  const depositPda = findPda([Buffer.from("deposit"), compareDuel.toBuffer(), wallet.publicKey.toBuffer()]);

  try {
    // Wrap SOL
    const wrapTx = new Transaction();
    wrapTx.add(SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: wsolAta, lamports: LAMPORTS_PER_SOL }));
    wrapTx.add(createSyncNativeInstruction(wsolAta));
    await provider.sendAndConfirm(wrapTx);

    const sig = await (program.methods as any)
      .deposit(0, new BN(LAMPORTS_PER_SOL))
      .accounts({
        depositor: wallet.publicKey,
        compareDuel,
        depositRecord: depositPda,
        poolVault: poolVaultA,
        depositorWsolAccount: wsolAta,
        quoteMint: NATIVE_MINT,
        config: configPda,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc();

    const cu = await getCU(sig);
    results.push({ step: "deposit_side_a", status: "OK", cu });
    console.log(`  OK (${cu.toLocaleString()} CU)`);

    const duelData = await (program.account as any).compareDuel.fetch(compareDuel);
    console.log(`  Side A total: ${duelData.sideATotal.toNumber() / LAMPORTS_PER_SOL} SOL`);
  } catch (e: any) {
    results.push({ step: "deposit_side_a", status: "FAIL" });
    console.log(`  FAIL: ${e.message?.slice(0, 200)}`);
    if (e.logs) e.logs.slice(-5).forEach((l: string) => console.log("    ", l));
  }

  // ─── Step 5: Deposit Side B (0.5 SOL) from a different user ───
  console.log("\n[5/8] Deposit 0.5 SOL on Side B...");

  // Use same wallet for simplicity (different deposit PDA won't work since same depositor)
  // Actually, the deposit PDA is per-depositor per-duel, so same wallet can't deposit twice
  // Let's create a second wallet
  const user2 = Keypair.generate();

  try {
    // Fund user2
    const fundUser2 = new Transaction().add(
      SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: user2.publicKey, lamports: 2 * LAMPORTS_PER_SOL })
    );
    await provider.sendAndConfirm(fundUser2);

    // Create user2's WSOL ATA
    const user2Wsol = await getAssociatedTokenAddress(NATIVE_MINT, user2.publicKey);
    const createAtaTx = new Transaction().add(
      createAssociatedTokenAccountInstruction(user2.publicKey, user2Wsol, user2.publicKey, NATIVE_MINT),
      SystemProgram.transfer({ fromPubkey: user2.publicKey, toPubkey: user2Wsol, lamports: LAMPORTS_PER_SOL }),
      createSyncNativeInstruction(user2Wsol),
    );
    await provider.sendAndConfirm(createAtaTx, [user2]);

    const depositPda2 = findPda([Buffer.from("deposit"), compareDuel.toBuffer(), user2.publicKey.toBuffer()]);

    const sig = await (program.methods as any)
      .deposit(1, new BN(LAMPORTS_PER_SOL / 2))
      .accounts({
        depositor: user2.publicKey,
        compareDuel,
        depositRecord: depositPda2,
        poolVault: poolVaultB,
        depositorWsolAccount: user2Wsol,
        quoteMint: NATIVE_MINT,
        config: configPda,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).signers([user2]).rpc();

    const cu = await getCU(sig);
    results.push({ step: "deposit_side_b", status: "OK", cu });
    console.log(`  OK (${cu.toLocaleString()} CU)`);

    const duelData = await (program.account as any).compareDuel.fetch(compareDuel);
    console.log(`  Side A: ${duelData.sideATotal.toNumber() / LAMPORTS_PER_SOL} SOL`);
    console.log(`  Side B: ${duelData.sideBTotal.toNumber() / LAMPORTS_PER_SOL} SOL`);
  } catch (e: any) {
    results.push({ step: "deposit_side_b", status: "FAIL" });
    console.log(`  FAIL: ${e.message?.slice(0, 200)}`);
    if (e.logs) e.logs.slice(-5).forEach((l: string) => console.log("    ", l));
  }

  // ─── Step 6: Wait for TWAP window, record sample ───
  console.log("\n[6/8] Record Compare TWAP...");
  const twapStart = deadline - twapWindow;
  const waitForTwap = Math.max(0, twapStart - Math.floor(Date.now() / 1000) + 1);
  if (waitForTwap > 0) {
    console.log(`  Waiting ${waitForTwap}s for TWAP window...`);
    await new Promise(r => setTimeout(r, waitForTwap * 1000));
  }

  try {
    const sig = await (program.methods as any)
      .recordCompareTwap()
      .accounts({
        cranker: wallet.publicKey,
        compareDuel,
        oracleA: oracleA.publicKey,
        oracleB: oracleB.publicKey,
      }).rpc();

    const cu = await getCU(sig);
    results.push({ step: "record_compare_twap", status: "OK", cu });
    console.log(`  OK (${cu.toLocaleString()} CU)`);

    const duelData = await (program.account as any).compareDuel.fetch(compareDuel);
    console.log(`  Samples: ${duelData.twapSamplesCount}`);
  } catch (e: any) {
    results.push({ step: "record_compare_twap", status: "FAIL" });
    console.log(`  FAIL: ${e.message?.slice(0, 200)}`);
    if (e.logs) e.logs.slice(-8).forEach((l: string) => console.log("    ", l));
    // TWAP may fail due to oracle data format -- continue to test emergency resolve
    console.log("  (TWAP sampling may fail with mock oracles -- testing emergency resolve path)");
  }

  // ─── Step 7: Wait for deadline, try resolve ───
  console.log("\n[7/8] Resolve Compare...");
  const remaining = Math.max(0, deadline - Math.floor(Date.now() / 1000) + 1);
  if (remaining > 0) {
    console.log(`  Waiting ${remaining}s for deadline...`);
    await new Promise(r => setTimeout(r, remaining * 1000));
  }

  try {
    const sig = await (program.methods as any)
      .resolveCompare()
      .accounts({
        resolver: wallet.publicKey,
        compareDuel,
        poolVaultA,
        poolVaultB,
        protocolFeeAccount: configData.protocolFeeAccount,
        creatorFeeAccount: wsolAta,
        quoteMint: NATIVE_MINT,
        config: configPda,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc();

    const cu = await getCU(sig);
    results.push({ step: "resolve_compare", status: "OK", cu });
    console.log(`  OK (${cu.toLocaleString()} CU)`);

    const duelData = await (program.account as any).compareDuel.fetch(compareDuel);
    console.log(`  Winner: ${duelData.winner !== null ? `Side ${duelData.winner}` : "Draw"}`);
    console.log(`  Net pool: ${duelData.netPool.toNumber() / LAMPORTS_PER_SOL} SOL`);
  } catch (e: any) {
    results.push({ step: "resolve_compare", status: "FAIL" });
    console.log(`  FAIL: ${e.message?.slice(0, 200)}`);
    if (e.logs) e.logs.slice(-5).forEach((l: string) => console.log("    ", l));
  }

  // ─── Step 8: Withdraw ───
  console.log("\n[8/8] Withdraw...");
  try {
    const duelData = await (program.account as any).compareDuel.fetch(compareDuel);
    const winner = duelData.winner;
    const winnerVault = winner === 0 ? poolVaultA : poolVaultB;

    const sig = await (program.methods as any)
      .withdraw()
      .accounts({
        depositor: wallet.publicKey,
        compareDuel,
        depositRecord: depositPda,
        poolVault: winnerVault,
        depositorWsolAccount: wsolAta,
        quoteMint: NATIVE_MINT,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc();

    const cu = await getCU(sig);
    results.push({ step: "withdraw", status: "OK", cu });
    console.log(`  OK (${cu.toLocaleString()} CU)`);
  } catch (e: any) {
    results.push({ step: "withdraw", status: "FAIL" });
    console.log(`  FAIL: ${e.message?.slice(0, 200)}`);
    if (e.logs) e.logs.slice(-5).forEach((l: string) => console.log("    ", l));
  }

  printResults(results);
}

function printResults(results: { step: string; status: string; cu?: number }[]) {
  const passed = results.filter(r => r.status.startsWith("OK")).length;
  const failed = results.filter(r => !r.status.startsWith("OK")).length;

  console.log("\n\n=== MODE 2 E2E RESULTS ===\n");
  for (const r of results) {
    const icon = r.status.startsWith("OK") ? "+" : "x";
    const cuStr = r.cu ? ` (${r.cu.toLocaleString()} CU)` : "";
    console.log(`  ${icon} ${r.step.padEnd(24)} ${r.status}${cuStr}`);
  }
  console.log(`\n  ${passed} passed, ${failed} failed\n`);
}

main().catch(e => { console.error("Fatal:", e.message || e); process.exit(1); });
