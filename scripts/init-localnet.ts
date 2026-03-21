import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { NATIVE_MINT, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction } from "@solana/spl-token";
import BN from "bn.js";
import { readFileSync } from "fs";

const PROGRAM_ID = new PublicKey("3kzt4Q7xN2RLzYYx2HfnqZVoAHFAKKa17hTDvXsy1PQ9");

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  const conn = new anchor.web3.Connection("http://localhost:8899", "confirmed");
  const wallet = provider.wallet;
  const localProvider = new anchor.AnchorProvider(conn, wallet, { commitment: "confirmed" });

  const idl = JSON.parse(readFileSync("./target/idl/duel.json", "utf-8"));
  const program = new anchor.Program(idl as anchor.Idl, localProvider);

  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);
  const protocolFeeAta = await getAssociatedTokenAddress(NATIVE_MINT, wallet.publicKey);

  // Ensure WSOL ATA exists
  try {
    await conn.getTokenAccountBalance(protocolFeeAta);
    console.log("WSOL ATA exists");
  } catch {
    console.log("Creating WSOL ATA...");
    const tx = new Transaction().add(
      createAssociatedTokenAccountInstruction(wallet.publicKey, protocolFeeAta, wallet.publicKey, NATIVE_MINT)
    );
    await localProvider.sendAndConfirm(tx);
    console.log("WSOL ATA created");
  }

  // Init config
  try {
    const config = await (program.account as any).programConfig.fetch(configPda);
    console.log("Config already exists, admin:", config.admin.toString());
  } catch {
    console.log("Initializing config...");
    await (program.methods as any)
      .initializeConfig(100, 5000, new BN(0))
      .accounts({
        admin: wallet.publicKey,
        protocolFeeAccount: protocolFeeAta,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("Config initialized!");
  }

  console.log("\nConfig PDA:", configPda.toString());
  console.log("Protocol Fee ATA:", protocolFeeAta.toString());
  console.log("\nLocalnet ready for testing!");
}

main().catch(console.error);
