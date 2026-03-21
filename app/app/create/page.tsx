"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useConnection, useAnchorWallet } from "@solana/wallet-adapter-react";
import { AnchorProvider } from "@coral-xyz/anchor";
import {
  PublicKey,
  SystemProgram,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  getAssociatedTokenAddress,
  getAccount,
} from "@solana/spl-token";
import BN from "bn.js";
import { getProgram, findConfigPda, PROGRAM_ID } from "../lib/program";

const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

function findMetadataPda(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    TOKEN_METADATA_PROGRAM_ID
  );
  return pda;
}

const DURATION_OPTIONS = [
  { label: "1 hour", value: 1 },
  { label: "6 hours", value: 6 },
  { label: "12 hours", value: 12 },
  { label: "24 hours", value: 24 },
  { label: "48 hours", value: 48 },
  { label: "72 hours", value: 72 },
  { label: "1 week", value: 168 },
];

export default function CreatePage() {
  const router = useRouter();
  const { connection } = useConnection();
  const wallet = useAnchorWallet();

  const [nameA, setNameA] = useState("");
  const [symbolA, setSymbolA] = useState("");
  const [nameB, setNameB] = useState("");
  const [symbolB, setSymbolB] = useState("");
  const [durationHours, setDurationHours] = useState(24);
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canCreate =
    nameA.trim().length > 0 &&
    symbolA.trim().length > 0 &&
    nameB.trim().length > 0 &&
    symbolB.trim().length > 0 &&
    !!wallet &&
    !submitting;

  async function handleCreate() {
    if (!wallet || !canCreate) return;
    setSubmitting(true);
    setTxStatus("Building transaction...");

    try {
      const provider = new AnchorProvider(connection, wallet, {
        commitment: "confirmed",
      });
      const program = getProgram(provider);

      const marketId = new BN(Date.now());
      const idBuf = marketId.toArrayLike(Buffer, "le", 8);

      const [market] = PublicKey.findProgramAddressSync(
        [Buffer.from("market"), wallet.publicKey.toBuffer(), idBuf],
        PROGRAM_ID
      );
      const [sideA] = PublicKey.findProgramAddressSync(
        [Buffer.from("side"), market.toBuffer(), Buffer.from([0])],
        PROGRAM_ID
      );
      const [sideB] = PublicKey.findProgramAddressSync(
        [Buffer.from("side"), market.toBuffer(), Buffer.from([1])],
        PROGRAM_ID
      );
      const [mintA] = PublicKey.findProgramAddressSync(
        [Buffer.from("mint"), market.toBuffer(), Buffer.from([0])],
        PROGRAM_ID
      );
      const [mintB] = PublicKey.findProgramAddressSync(
        [Buffer.from("mint"), market.toBuffer(), Buffer.from([1])],
        PROGRAM_ID
      );
      const [tvA] = PublicKey.findProgramAddressSync(
        [Buffer.from("token_vault"), market.toBuffer(), Buffer.from([0])],
        PROGRAM_ID
      );
      const [tvB] = PublicKey.findProgramAddressSync(
        [Buffer.from("token_vault"), market.toBuffer(), Buffer.from([1])],
        PROGRAM_ID
      );
      const [qvA] = PublicKey.findProgramAddressSync(
        [Buffer.from("quote_vault"), market.toBuffer(), Buffer.from([0])],
        PROGRAM_ID
      );
      const [qvB] = PublicKey.findProgramAddressSync(
        [Buffer.from("quote_vault"), market.toBuffer(), Buffer.from([1])],
        PROGRAM_ID
      );

      const configData = await program.account.programConfig.fetch(
        findConfigPda()
      );
      const protocolFeeAccount = configData.protocolFeeAccount;

      const creatorFeeAccount = await getAssociatedTokenAddress(
        NATIVE_MINT,
        wallet.publicKey
      );
      try {
        await getAccount(connection, creatorFeeAccount);
      } catch {
        // Create creator's WSOL ATA if it doesn't exist
        const { createAssociatedTokenAccountInstruction } = await import("@solana/spl-token");
        const { Transaction } = await import("@solana/web3.js");
        const createTx = new Transaction().add(
          createAssociatedTokenAccountInstruction(
            wallet.publicKey, creatorFeeAccount, wallet.publicKey, NATIVE_MINT
          )
        );
        await provider.sendAndConfirm(createTx);
      }

      const now = Math.floor(Date.now() / 1000);
      const durationSeconds = durationHours * 3600;
      const deadline = now + durationSeconds;

      // twapWindow: 25% of duration, clamped [60s, 43200s (12h)]
      const twapWindow = Math.max(
        60,
        Math.min(43200, Math.floor(durationSeconds * 0.25))
      );
      // twapInterval: target ~720 samples, minimum 10s
      const twapInterval = Math.max(10, Math.floor(twapWindow / 720));

      setTxStatus("Awaiting wallet approval...");

      const tx = await (program.methods as any)
        .initializeMarket(
          marketId,
          new BN(deadline),
          new BN(twapWindow),
          new BN(twapInterval),
          nameA.trim(),
          symbolA.trim().toUpperCase(),
          "",
          nameB.trim(),
          symbolB.trim().toUpperCase(),
          "",
        )
        .accounts({
          creator: wallet.publicKey,
          market,
          sideA,
          sideB,
          tokenMintA: mintA,
          tokenMintB: mintB,
          tokenVaultA: tvA,
          tokenVaultB: tvB,
          quoteMint: NATIVE_MINT,
          quoteTokenProgram: TOKEN_PROGRAM_ID,
          quoteVaultA: qvA,
          quoteVaultB: qvB,
          protocolFeeAccount,
          creatorFeeAccount,
          config: findConfigPda(),
          metadataA: findMetadataPda(mintA),
          metadataB: findMetadataPda(mintB),
          tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: new PublicKey("SysvarRent111111111111111111111111111111111"),
        })
        .preInstructions([
          ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
        ])
        .rpc();

      setTxStatus(`Created. TX: ${tx.slice(0, 8)}...`);
      setTimeout(() => router.push(`/duels/${market.toBase58()}`), 2000);
    } catch (err: any) {
      console.error(err);
      setTxStatus(`Failed: ${err.message?.slice(0, 120)}`);
      setSubmitting(false);
    }
  }

  return (
    <div className="page-container" style={{ maxWidth: 640, margin: "0 auto" }}>
      {/* Title */}
      <h1
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: "1.75rem",
          fontWeight: 700,
          letterSpacing: "-0.02em",
          marginBottom: 40,
          textTransform: "uppercase",
        }}
      >
        Create a Duel
      </h1>

      {/* Two side-by-side panels, stack on mobile */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
          marginBottom: 24,
        }}
      >
        {/* Side A panel (blue left border) */}
        <div
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border)",
            borderLeft: "3px solid var(--side-a)",
            borderRadius: "var(--radius-sm)",
            padding: 20,
          }}
        >
          <label
            style={{
              display: "block",
              fontSize: "0.65rem",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              color: "var(--side-a)",
              marginBottom: 14,
              fontFamily: "var(--font-heading)",
            }}
          >
            Side A
          </label>
          <input
            className="input"
            type="text"
            placeholder="Name"
            value={nameA}
            onChange={(e) => setNameA(e.target.value)}
            maxLength={32}
            style={{ marginBottom: 10 }}
          />
          <input
            className="input input-mono"
            type="text"
            placeholder="Symbol (max 10)"
            value={symbolA}
            onChange={(e) =>
              setSymbolA(e.target.value.toUpperCase().slice(0, 10))
            }
            maxLength={10}
            style={{ textTransform: "uppercase", letterSpacing: "0.06em" }}
          />
        </div>

        {/* Side B panel (yellow left border) */}
        <div
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border)",
            borderLeft: "3px solid var(--side-b)",
            borderRadius: "var(--radius-sm)",
            padding: 20,
          }}
        >
          <label
            style={{
              display: "block",
              fontSize: "0.65rem",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              color: "var(--side-b)",
              marginBottom: 14,
              fontFamily: "var(--font-heading)",
            }}
          >
            Side B
          </label>
          <input
            className="input"
            type="text"
            placeholder="Name"
            value={nameB}
            onChange={(e) => setNameB(e.target.value)}
            maxLength={32}
            style={{ marginBottom: 10 }}
          />
          <input
            className="input input-mono"
            type="text"
            placeholder="Symbol (max 10)"
            value={symbolB}
            onChange={(e) =>
              setSymbolB(e.target.value.toUpperCase().slice(0, 10))
            }
            maxLength={10}
            style={{ textTransform: "uppercase", letterSpacing: "0.06em" }}
          />
        </div>
      </div>

      {/* Duration */}
      <div
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-sm)",
          padding: 20,
          marginBottom: 24,
        }}
      >
        <label
          style={{
            display: "block",
            fontSize: "0.65rem",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            color: "var(--text-secondary)",
            marginBottom: 10,
            fontFamily: "var(--font-heading)",
          }}
        >
          Duration
        </label>
        <select
          value={durationHours}
          onChange={(e) => setDurationHours(Number(e.target.value))}
          className="input"
          style={{
            cursor: "pointer",
            appearance: "none",
            WebkitAppearance: "none",
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='%237A7A8E' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
            backgroundRepeat: "no-repeat",
            backgroundPosition: "right 14px center",
          }}
        >
          {DURATION_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Create button */}
      <button
        className={canCreate ? "btn btn-b btn-lg" : "btn btn-ghost btn-lg"}
        onClick={handleCreate}
        disabled={!canCreate}
        style={{
          width: "100%",
          fontWeight: 800,
        }}
      >
        {!wallet ? "Connect Wallet" : submitting ? "Creating..." : "Create"}
      </button>

      {/* Status message */}
      {txStatus && (
        <div
          style={{
            marginTop: 16,
            padding: "10px 14px",
            background: "var(--bg-surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            fontFamily: "var(--font-mono)",
            fontSize: "0.75rem",
            color: txStatus.startsWith("Failed")
              ? "var(--danger)"
              : "var(--text-secondary)",
            wordBreak: "break-all",
          }}
        >
          {txStatus}
        </div>
      )}

      {/* Responsive: stack panels on small screens */}
      <style>{`
        @media (max-width: 520px) {
          .page-container > div:nth-child(2) {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}
