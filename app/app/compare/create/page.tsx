"use client";

import { useState, useMemo } from "react";
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
import {
  getProgram,
  findConfigPda,
  PROGRAM_ID,
  KNOWN_TOKENS,
} from "../../lib/program";

const DURATION_OPTIONS = [
  { label: "1 hour", value: 1 },
  { label: "6 hours", value: 6 },
  { label: "12 hours", value: 12 },
  { label: "24 hours", value: 24 },
  { label: "48 hours", value: 48 },
  { label: "7 days", value: 168 },
];

const TOKEN_LIST = Object.values(KNOWN_TOKENS);

export default function CreateCompareDuelPage() {
  const router = useRouter();
  const { connection } = useConnection();
  const wallet = useAnchorWallet();

  const [tokenAMint, setTokenAMint] = useState("");
  const [tokenBMint, setTokenBMint] = useState("");
  const [oracleA, setOracleA] = useState("");
  const [oracleB, setOracleB] = useState("");
  const [durationHours, setDurationHours] = useState(24);
  const [minDeposit, setMinDeposit] = useState("0.01");
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [quickSelectA, setQuickSelectA] = useState("");
  const [quickSelectB, setQuickSelectB] = useState("");

  function handleQuickSelectA(symbol: string) {
    const token = KNOWN_TOKENS[symbol];
    if (token) {
      setTokenAMint(token.mint);
      setOracleA(token.oracle);
      setQuickSelectA(symbol);
    }
  }

  function handleQuickSelectB(symbol: string) {
    const token = KNOWN_TOKENS[symbol];
    if (token) {
      setTokenBMint(token.mint);
      setOracleB(token.oracle);
      setQuickSelectB(symbol);
    }
  }

  const isValidMint = (s: string) => {
    try { new PublicKey(s); return true; } catch { return false; }
  };

  const canCreate = useMemo(() => {
    return (
      isValidMint(tokenAMint) &&
      isValidMint(tokenBMint) &&
      isValidMint(oracleA) &&
      isValidMint(oracleB) &&
      tokenAMint !== tokenBMint &&
      !!wallet &&
      !submitting
    );
  }, [tokenAMint, tokenBMint, oracleA, oracleB, wallet, submitting]);

  async function handleCreate() {
    if (!wallet || !canCreate) return;
    setSubmitting(true);
    setTxStatus("Building transaction...");

    try {
      const provider = new AnchorProvider(connection, wallet, {
        commitment: "confirmed",
      });
      const program = getProgram(provider);

      const duelId = new BN(Date.now());
      const idBuf = duelId.toArrayLike(Buffer, "le", 8);

      const [compareDuel] = PublicKey.findProgramAddressSync(
        [Buffer.from("compare_duel"), wallet.publicKey.toBuffer(), idBuf],
        PROGRAM_ID
      );

      const [poolVaultA] = PublicKey.findProgramAddressSync(
        [Buffer.from("compare_vault"), compareDuel.toBuffer(), Buffer.from([0])],
        PROGRAM_ID
      );
      const [poolVaultB] = PublicKey.findProgramAddressSync(
        [Buffer.from("compare_vault"), compareDuel.toBuffer(), Buffer.from([1])],
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

      const twapWindow = Math.max(
        60,
        Math.min(43200, Math.floor(durationSeconds * 0.25))
      );
      const twapInterval = Math.max(10, Math.floor(twapWindow / 720));

      const minDepositLamports = Math.floor(
        parseFloat(minDeposit || "0.01") * 1e9
      );

      setTxStatus("Awaiting wallet approval...");

      const tx = await (program.methods as any)
        .createCompareDuel(
          duelId,
          new BN(deadline),
          new BN(twapWindow),
          new BN(twapInterval),
          new BN(minDepositLamports),
        )
        .accounts({
          creator: wallet.publicKey,
          compareDuel,
          quoteMint: NATIVE_MINT,
          poolVaultA,
          poolVaultB,
          oracleA: new PublicKey(oracleA),
          oracleB: new PublicKey(oracleB),
          config: findConfigPda(),
          protocolFeeAccount,
          creatorFeeAccount,
          tokenAMint: new PublicKey(tokenAMint),
          tokenBMint: new PublicKey(tokenBMint),
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: new PublicKey("SysvarRent111111111111111111111111111111111"),
        })
        .preInstructions([
          ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
        ])
        .rpc();

      setTxStatus(`Created. TX: ${tx.slice(0, 8)}...`);
      setTimeout(() => router.push(`/compare/${compareDuel.toBase58()}`), 2000);
    } catch (err: any) {
      console.error(err);
      setTxStatus(`Failed: ${err.message?.slice(0, 120)}`);
      setSubmitting(false);
    }
  }

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: "0.65rem",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    color: "var(--text-secondary)",
    marginBottom: 8,
    fontFamily: "var(--font-heading)",
  };

  return (
    <div className="page-container" style={{ maxWidth: 640, margin: "0 auto" }}>
      <h1 style={{
        fontFamily: "var(--font-heading)",
        fontSize: "1.75rem",
        fontWeight: 700,
        letterSpacing: "-0.02em",
        marginBottom: 8,
        textTransform: "uppercase",
      }}>
        Create Compare Duel
      </h1>
      <p style={{
        color: "var(--text-secondary)",
        fontSize: "0.85rem",
        marginBottom: 36,
        lineHeight: 1.6,
      }}>
        Pick two existing tokens. Depositors bet on which performs better.
        Winner takes the pool.
      </p>

      {/* Token A */}
      <div style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        borderLeft: "3px solid var(--side-a)",
        borderRadius: "var(--radius-sm)",
        padding: 20,
        marginBottom: 16,
      }}>
        <label style={{ ...labelStyle, color: "var(--side-a)" }}>Token A</label>

        {/* Quick select */}
        <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
          {TOKEN_LIST.map((t) => (
            <button
              key={`a-${t.symbol}`}
              onClick={() => handleQuickSelectA(t.symbol)}
              style={{
                padding: "4px 12px",
                background: quickSelectA === t.symbol ? "var(--side-a-dim)" : "var(--bg-surface-2)",
                border: `1px solid ${quickSelectA === t.symbol ? "var(--side-a-border)" : "var(--border)"}`,
                borderRadius: "var(--radius-sm)",
                color: quickSelectA === t.symbol ? "var(--side-a)" : "var(--text-secondary)",
                fontFamily: "var(--font-mono)",
                fontSize: "0.75rem",
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              {t.symbol}
            </button>
          ))}
        </div>

        <input
          className="input input-mono"
          type="text"
          placeholder="Token mint address"
          value={tokenAMint}
          onChange={(e) => { setTokenAMint(e.target.value); setQuickSelectA(""); }}
          style={{ marginBottom: 10, fontSize: "0.8rem" }}
        />
        <label style={labelStyle}>Oracle A (Pyth Feed)</label>
        <input
          className="input input-mono"
          type="text"
          placeholder="Pyth price feed address"
          value={oracleA}
          onChange={(e) => setOracleA(e.target.value)}
          style={{ fontSize: "0.8rem" }}
        />
      </div>

      {/* Token B */}
      <div style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        borderLeft: "3px solid var(--side-b)",
        borderRadius: "var(--radius-sm)",
        padding: 20,
        marginBottom: 16,
      }}>
        <label style={{ ...labelStyle, color: "var(--side-b)" }}>Token B</label>

        {/* Quick select */}
        <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
          {TOKEN_LIST.map((t) => (
            <button
              key={`b-${t.symbol}`}
              onClick={() => handleQuickSelectB(t.symbol)}
              style={{
                padding: "4px 12px",
                background: quickSelectB === t.symbol ? "var(--side-b-dim)" : "var(--bg-surface-2)",
                border: `1px solid ${quickSelectB === t.symbol ? "var(--side-b-border)" : "var(--border)"}`,
                borderRadius: "var(--radius-sm)",
                color: quickSelectB === t.symbol ? "var(--side-b)" : "var(--text-secondary)",
                fontFamily: "var(--font-mono)",
                fontSize: "0.75rem",
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              {t.symbol}
            </button>
          ))}
        </div>

        <input
          className="input input-mono"
          type="text"
          placeholder="Token mint address"
          value={tokenBMint}
          onChange={(e) => { setTokenBMint(e.target.value); setQuickSelectB(""); }}
          style={{ marginBottom: 10, fontSize: "0.8rem" }}
        />
        <label style={labelStyle}>Oracle B (Pyth Feed)</label>
        <input
          className="input input-mono"
          type="text"
          placeholder="Pyth price feed address"
          value={oracleB}
          onChange={(e) => setOracleB(e.target.value)}
          style={{ fontSize: "0.8rem" }}
        />
      </div>

      {/* Duration + Min Deposit row */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 16,
        marginBottom: 24,
      }}>
        <div style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-sm)",
          padding: 20,
        }}>
          <label style={labelStyle}>Duration</label>
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

        <div style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-sm)",
          padding: 20,
        }}>
          <label style={labelStyle}>Min Deposit (SOL)</label>
          <input
            className="input input-mono"
            type="number"
            step="0.001"
            min="0.00001"
            placeholder="0.01"
            value={minDeposit}
            onChange={(e) => setMinDeposit(e.target.value)}
          />
        </div>
      </div>

      {/* Validation hint */}
      {tokenAMint && tokenBMint && tokenAMint === tokenBMint && (
        <div style={{
          marginBottom: 16,
          padding: "8px 14px",
          background: "rgba(232, 64, 64, 0.1)",
          border: "1px solid rgba(232, 64, 64, 0.2)",
          borderRadius: "var(--radius-sm)",
          fontSize: "0.75rem",
          color: "var(--danger)",
        }}>
          Token A and Token B must be different.
        </div>
      )}

      {/* Create button */}
      <button
        className={canCreate ? "btn btn-a btn-lg" : "btn btn-ghost btn-lg"}
        onClick={handleCreate}
        disabled={!canCreate}
        style={{ width: "100%", fontWeight: 800 }}
      >
        {!wallet ? "Connect Wallet" : submitting ? "Creating..." : "Create Compare Duel"}
      </button>

      {/* Status */}
      {txStatus && (
        <div style={{
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
        }}>
          {txStatus}
        </div>
      )}

      <style>{`
        @media (max-width: 520px) {
          .page-container > div {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}
