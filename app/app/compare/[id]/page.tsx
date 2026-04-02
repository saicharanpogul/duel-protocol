"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  useConnection,
  useWallet,
  useAnchorWallet,
} from "@solana/wallet-adapter-react";
import { AnchorProvider } from "@coral-xyz/anchor";
import {
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
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
import {
  getProgram,
  getReadonlyProgram,
  findConfigPda,
  findDepositPda,
  getComparePhase,
  getTokenSymbolFromMint,
  formatSol,
  shortenAddress,
  type CompareDuelAccount,
  type DepositAccount,
  type ComparePhase,
} from "../../lib/program";

/* ------------------------------------------------------------------ */
/*  Design tokens                                                      */
/* ------------------------------------------------------------------ */

const C = {
  sideA: "#2BA4E0",
  sideADim: "rgba(43, 164, 224, 0.10)",
  sideABorder: "rgba(43, 164, 224, 0.25)",
  sideAHover: "#239AD4",
  sideB: "#FFE233",
  sideBDim: "rgba(255, 226, 51, 0.08)",
  sideBBorder: "rgba(255, 226, 51, 0.25)",
  sideBHover: "#F0D52E",
  bg: "#08080C",
  surface: "#0E0E14",
  surface2: "#141420",
  surface3: "#1C1C2A",
  textPrimary: "#E8E8ED",
  textSecondary: "#7A7A8E",
  textMuted: "#44445A",
  border: "rgba(255, 255, 255, 0.06)",
  borderHover: "rgba(255, 255, 255, 0.12)",
  success: "#40C080",
  danger: "#E84040",
} as const;

const FONT = {
  heading: "'Space Grotesk', sans-serif",
  body: "'DM Sans', sans-serif",
  mono: "'JetBrains Mono', monospace",
} as const;

/* ------------------------------------------------------------------ */
/*  Countdown hook (ticks every second)                                */
/* ------------------------------------------------------------------ */

function useCountdown(deadline: number | null): string {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  if (deadline === null) return "--:--:--";
  const diff = deadline - now;
  if (diff <= 0) return "00:00:00";
  const d = Math.floor(diff / 86400);
  const h = Math.floor((diff % 86400) / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (d > 0) return `${d}d ${pad(h)}h ${pad(m)}m`;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function solDisplay(lamports: number): string {
  const sol = lamports / LAMPORTS_PER_SOL;
  if (sol >= 10000) return `${(sol / 1000).toFixed(1)}K`;
  if (sol >= 100) return sol.toFixed(1);
  if (sol >= 1) return sol.toFixed(2);
  if (sol >= 0.01) return sol.toFixed(3);
  return sol.toFixed(4);
}

function formatUTCDate(ts: number): string {
  const d = new Date(ts * 1000);
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()} ${d.getUTCHours().toString().padStart(2, "0")}:${d.getUTCMinutes().toString().padStart(2, "0")} UTC`;
}

function formatDuration(seconds: number): string {
  if (seconds >= 3600) {
    const h = seconds / 3600;
    return h === Math.floor(h) ? `${h} hours` : `${h.toFixed(1)} hours`;
  }
  if (seconds >= 60) {
    const m = seconds / 60;
    return m === Math.floor(m) ? `${m} minutes` : `${m.toFixed(1)} minutes`;
  }
  return `${seconds} seconds`;
}

/* ------------------------------------------------------------------ */
/*  Inline style helpers                                               */
/* ------------------------------------------------------------------ */

const label = (color: string = C.textMuted): React.CSSProperties => ({
  fontFamily: FONT.heading,
  fontSize: "0.65rem",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  color,
  lineHeight: 1,
});

const mono = (size: string = "0.85rem", weight: number = 600): React.CSSProperties => ({
  fontFamily: FONT.mono,
  fontSize: size,
  fontWeight: weight,
  fontVariantNumeric: "tabular-nums",
});

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function CompareDuelDetailPage() {
  const params = useParams();
  const duelPubkey = params.id as string;
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const anchorWallet = useAnchorWallet();

  /* ---- State ---- */
  const [duel, setDuel] = useState<CompareDuelAccount | null>(null);
  const [deposit, setDeposit] = useState<DepositAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState("");
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [depositing, setDepositing] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const amountInputRef = useRef<HTMLInputElement>(null);

  /* ---- Derived ---- */
  const phase: ComparePhase | null = duel ? getComparePhase(duel) : null;
  const deadline = duel ? duel.deadline.toNumber() : null;
  const countdown = useCountdown(deadline);
  const sideATotal = duel ? duel.sideATotal.toNumber() : 0;
  const sideBTotal = duel ? duel.sideBTotal.toNumber() : 0;
  const totalPool = sideATotal + sideBTotal;
  const pctA = totalPool > 0 ? (sideATotal / totalPool) * 100 : 50;
  const pctB = 100 - pctA;

  const symbolA = duel
    ? getTokenSymbolFromMint(duel.tokenAMint.toBase58()) || shortenAddress(duel.tokenAMint.toBase58())
    : "A";
  const symbolB = duel
    ? getTokenSymbolFromMint(duel.tokenBMint.toBase58()) || shortenAddress(duel.tokenBMint.toBase58())
    : "B";

  const payoutA = useMemo(() => {
    if (totalPool === 0 || sideATotal === 0) return 0;
    return totalPool / sideATotal;
  }, [totalPool, sideATotal]);

  const payoutB = useMemo(() => {
    if (totalPool === 0 || sideBTotal === 0) return 0;
    return totalPool / sideBTotal;
  }, [totalPool, sideBTotal]);

  /* User position */
  const userDeposit = deposit && !deposit.withdrawn ? deposit.amount.toNumber() : 0;
  const userSide = deposit ? deposit.side : null;
  const userSideTotal = userSide === 0 ? sideATotal : userSide === 1 ? sideBTotal : 0;
  const userPctOfSide = userSideTotal > 0 ? (userDeposit / userSideTotal) * 100 : 0;
  const userPotentialPayout = userSideTotal > 0 ? (userDeposit / userSideTotal) * totalPool : 0;

  /* Resolution */
  const isResolved = phase === "resolved";
  const isTwap = phase === "twap";
  const winnerIndex = duel?.winner ?? null;
  const hasWinner = winnerIndex !== null && winnerIndex !== undefined;
  const isDraw = isResolved && !hasWinner;
  const isUserWinner = hasWinner && deposit != null && deposit.side === winnerIndex;
  const isUserLoser = hasWinner && deposit != null && deposit.side !== winnerIndex;
  const canDeposit = phase === "active" && !deposit;
  const canWithdraw = isResolved && deposit != null && !deposit.withdrawn && (isUserWinner || isDraw);

  /* TWAP progress */
  const twapProgress = useMemo(() => {
    if (!duel) return null;
    const now = Math.floor(Date.now() / 1000);
    const dl = duel.deadline.toNumber();
    const window = duel.twapWindow.toNumber();
    const interval = duel.twapInterval.toNumber();
    const twapStart = dl - window;
    if (now < twapStart) return null;
    const elapsed = Math.min(now - twapStart, window);
    const pct = Math.min((elapsed / window) * 100, 100);
    const maxSamples = interval > 0 ? Math.floor(window / interval) : 0;
    const currentSamples = duel.twapSamplesCount;
    const nextSampleIn =
      interval > 0 && duel.lastSampleTs.toNumber() > 0
        ? Math.max(0, interval - (now - duel.lastSampleTs.toNumber()))
        : 0;
    return { pct, currentSamples, maxSamples, nextSampleIn, window, interval };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duel, countdown]);

  /* Estimated payout for entered amount */
  const estimate = useMemo(() => {
    const sol = parseFloat(amount);
    if (isNaN(sol) || sol <= 0 || totalPool === 0) return null;
    const lamports = sol * LAMPORTS_PER_SOL;
    // Estimate for both sides
    const newTotalPool = totalPool + lamports;
    const estA = (lamports / (sideATotal + lamports)) * newTotalPool;
    const estB = (lamports / (sideBTotal + lamports)) * newTotalPool;
    return {
      a: { payout: estA, multiplier: estA / lamports },
      b: { payout: estB, multiplier: estB / lamports },
    };
  }, [amount, sideATotal, sideBTotal, totalPool]);

  /* ---- Data fetching ---- */
  const fetchData = useCallback(async () => {
    try {
      const program = getReadonlyProgram();
      const dk = new PublicKey(duelPubkey);
      const duelData = await program.account.compareDuel.fetch(dk);
      setDuel(duelData);

      if (publicKey) {
        try {
          const depositPda = findDepositPda(dk, publicKey);
          const depositData = await program.account.deposit.fetch(depositPda);
          setDeposit(depositData);
        } catch {
          setDeposit(null);
        }
      }
    } catch (err) {
      console.error("Fetch error:", err);
    }
    setLoading(false);
  }, [duelPubkey, publicKey]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    const id = setInterval(fetchData, 10_000);
    return () => clearInterval(id);
  }, [fetchData]);

  /* ---- Deposit handler ---- */
  async function handleDeposit(side: 0 | 1) {
    if (!anchorWallet || !duel) return;
    const solAmount = parseFloat(amount);
    if (isNaN(solAmount) || solAmount <= 0) return;

    setDepositing(true);
    setTxStatus("Preparing transaction...");
    try {
      const provider = new AnchorProvider(connection, anchorWallet, {
        commitment: "confirmed",
      });
      const program = getProgram(provider);
      const dk = new PublicKey(duelPubkey);
      const lamports = Math.floor(solAmount * LAMPORTS_PER_SOL);

      const wsolAta = await getAssociatedTokenAddress(
        NATIVE_MINT,
        anchorWallet.publicKey
      );
      const tx = new Transaction();

      try {
        await getAccount(connection, wsolAta);
      } catch {
        tx.add(
          createAssociatedTokenAccountInstruction(
            anchorWallet.publicKey,
            wsolAta,
            anchorWallet.publicKey,
            NATIVE_MINT
          )
        );
      }
      tx.add(
        SystemProgram.transfer({
          fromPubkey: anchorWallet.publicKey,
          toPubkey: wsolAta,
          lamports,
        }),
        createSyncNativeInstruction(wsolAta)
      );

      const depositPda = findDepositPda(dk, anchorWallet.publicKey);
      const poolVault = side === 0 ? duel.poolVaultA : duel.poolVaultB;

      const depositIx = await (program.methods as any)
        .deposit(side, new BN(lamports))
        .accounts({
          depositor: anchorWallet.publicKey,
          compareDuel: dk,
          depositRecord: depositPda,
          poolVault,
          depositorWsolAccount: wsolAta,
          quoteMint: NATIVE_MINT,
          config: findConfigPda(),
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction();

      tx.add(depositIx);

      setTxStatus("Awaiting wallet approval...");
      const sig = await provider.sendAndConfirm(tx);
      setTxStatus(`Confirmed: ${sig.slice(0, 12)}...`);
      setAmount("");
      setTimeout(fetchData, 2000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message.slice(0, 100) : String(err);
      setTxStatus(`Failed: ${msg}`);
    }
    setDepositing(false);
  }

  /* ---- Withdraw handler ---- */
  async function handleWithdraw() {
    if (!anchorWallet || !duel || !deposit) return;

    setWithdrawing(true);
    setTxStatus("Preparing withdrawal...");
    try {
      const provider = new AnchorProvider(connection, anchorWallet, {
        commitment: "confirmed",
      });
      const program = getProgram(provider);
      const dk = new PublicKey(duelPubkey);

      const wsolAta = await getAssociatedTokenAddress(
        NATIVE_MINT,
        anchorWallet.publicKey
      );
      const tx = new Transaction();

      try {
        await getAccount(connection, wsolAta);
      } catch {
        tx.add(
          createAssociatedTokenAccountInstruction(
            anchorWallet.publicKey,
            wsolAta,
            anchorWallet.publicKey,
            NATIVE_MINT
          )
        );
      }

      let poolVault: PublicKey;
      if (duel.winner !== null) {
        poolVault = duel.winner === 0 ? duel.poolVaultA : duel.poolVaultB;
      } else {
        poolVault = deposit.side === 0 ? duel.poolVaultA : duel.poolVaultB;
      }

      const depositPda = findDepositPda(dk, anchorWallet.publicKey);

      const withdrawIx = await (program.methods as any)
        .withdraw()
        .accounts({
          depositor: anchorWallet.publicKey,
          compareDuel: dk,
          depositRecord: depositPda,
          poolVault,
          depositorWsolAccount: wsolAta,
          quoteMint: NATIVE_MINT,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction();

      tx.add(withdrawIx);

      setTxStatus("Awaiting wallet approval...");
      const sig = await provider.sendAndConfirm(tx);
      setTxStatus(`Withdrawn: ${sig.slice(0, 12)}...`);
      setTimeout(fetchData, 2000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message.slice(0, 100) : String(err);
      setTxStatus(`Failed: ${msg}`);
    }
    setWithdrawing(false);
  }

  /* ================================================================ */
  /*  Loading skeleton                                                 */
  /* ================================================================ */

  if (loading) {
    return (
      <div style={{ maxWidth: 880, margin: "0 auto", padding: "80px 20px 60px" }}>
        <div className="skeleton" style={{ height: 32, width: "40%", marginBottom: 20 }} />
        <div className="skeleton" style={{ height: 24, marginBottom: 24 }} />
        <div className="skeleton" style={{ height: 6, marginBottom: 32 }} />
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}
          className="trading-grid"
        >
          <div className="skeleton" style={{ height: 320 }} />
          <div className="skeleton" style={{ height: 320 }} />
        </div>
        <div className="skeleton" style={{ height: 80, marginBottom: 16 }} />
        <div className="skeleton" style={{ height: 100 }} />
      </div>
    );
  }

  /* ================================================================ */
  /*  Not found                                                        */
  /* ================================================================ */

  if (!duel) {
    return (
      <div
        style={{
          maxWidth: 880,
          margin: "0 auto",
          padding: "160px 20px",
          textAlign: "center",
        }}
      >
        <h2
          style={{
            fontFamily: FONT.heading,
            fontSize: "1.5rem",
            fontWeight: 700,
            marginBottom: 8,
          }}
        >
          Duel not found
        </h2>
        <p style={{ color: C.textSecondary, marginBottom: 24, fontSize: "0.9rem" }}>
          The address may be invalid or the duel has not been created yet.
        </p>
        <Link
          href="/compare"
          style={{
            color: C.sideA,
            fontFamily: FONT.heading,
            fontWeight: 600,
            fontSize: "0.85rem",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          Back to Compare
        </Link>
      </div>
    );
  }

  /* ================================================================ */
  /*  Quick amounts                                                    */
  /* ================================================================ */

  const quickAmounts = [0.1, 0.5, 1, 5];

  /* Helper: payout line text */
  const payoutLine = (multiplier: number) => {
    if (multiplier <= 0) return "";
    return `${multiplier.toFixed(2)}x`;
  };

  /* ================================================================ */
  /*  Render a side trading card                                       */
  /* ================================================================ */

  function renderSideCard(side: 0 | 1) {
    const isSideA = side === 0;
    const color = isSideA ? C.sideA : C.sideB;
    const dimBg = isSideA ? C.sideADim : C.sideBDim;
    const borderColor = isSideA ? C.sideABorder : C.sideBBorder;
    const symbol = isSideA ? symbolA : symbolB;
    const sideTotal = isSideA ? sideATotal : sideBTotal;
    const pct = isSideA ? pctA : pctB;
    const multiplier = isSideA ? payoutA : payoutB;
    const est = estimate ? (isSideA ? estimate.a : estimate.b) : null;
    const isWinner = hasWinner && winnerIndex === side;
    const isLoser = hasWinner && winnerIndex !== side;

    return (
      <div
        style={{
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderLeft: `3px solid ${color}`,
          padding: "20px 20px 24px",
          opacity: isLoser ? 0.45 : 1,
          transition: "opacity 0.3s",
          position: "relative",
        }}
      >
        {/* Winner tag */}
        {isWinner && (
          <div
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              padding: "4px 12px",
              background: color,
              color: isSideA ? "#fff" : "#08080C",
              fontFamily: FONT.heading,
              fontSize: "0.6rem",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            Winner
          </div>
        )}

        {/* Symbol + pct */}
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            marginBottom: 16,
          }}
        >
          <span
            style={{
              fontFamily: FONT.heading,
              fontSize: "1.25rem",
              fontWeight: 700,
              color,
              letterSpacing: "-0.02em",
            }}
          >
            ${symbol}
          </span>
          <span
            style={{
              ...mono("0.8rem", 500),
              color: C.textSecondary,
            }}
          >
            {pct.toFixed(1)}% of pool
          </span>
        </div>

        {/* Progress bar */}
        <div
          style={{
            height: 4,
            background: "rgba(255,255,255,0.04)",
            marginBottom: 12,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${pct}%`,
              height: "100%",
              background: color,
              transition: "width 0.6s ease",
            }}
          />
        </div>

        {/* SOL deposited */}
        <div
          style={{
            ...mono("1.25rem"),
            color: C.textPrimary,
            marginBottom: 4,
          }}
        >
          {solDisplay(sideTotal)} SOL
        </div>
        <div
          style={{
            fontFamily: FONT.body,
            fontSize: "0.75rem",
            color: C.textMuted,
            marginBottom: 20,
          }}
        >
          deposited
        </div>

        {/* Deposit button + input (only when active and no existing deposit) */}
        {canDeposit && (
          <>
            {/* Quick amount chips */}
            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              {quickAmounts.map((qa) => {
                const isSelected = amount === qa.toString();
                return (
                  <button
                    key={qa}
                    onClick={() => {
                      setAmount(qa.toString());
                      amountInputRef.current?.focus();
                    }}
                    style={{
                      flex: 1,
                      padding: "6px 0",
                      background: isSelected ? dimBg : C.surface2,
                      border: `1px solid ${isSelected ? borderColor : C.border}`,
                      color: isSelected ? color : C.textSecondary,
                      fontFamily: FONT.mono,
                      fontSize: "0.75rem",
                      fontWeight: 600,
                      cursor: "pointer",
                      transition: "all 0.15s",
                    }}
                  >
                    {qa}
                  </button>
                );
              })}
            </div>

            {/* Amount input */}
            <div style={{ position: "relative", marginBottom: 12 }}>
              <input
                ref={amountInputRef}
                type="number"
                step="0.001"
                min="0"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 50px 10px 14px",
                  background: C.surface2,
                  border: `1px solid ${C.border}`,
                  color: C.textPrimary,
                  fontFamily: FONT.mono,
                  fontSize: "1rem",
                  fontWeight: 600,
                  outline: "none",
                  transition: "border-color 0.15s",
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = color;
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = C.border;
                }}
              />
              <span
                style={{
                  position: "absolute",
                  right: 14,
                  top: "50%",
                  transform: "translateY(-50%)",
                  fontFamily: FONT.mono,
                  fontSize: "0.75rem",
                  color: C.textMuted,
                  fontWeight: 600,
                  pointerEvents: "none",
                }}
              >
                SOL
              </span>
            </div>

            {/* Estimated payout */}
            {est && (
              <div
                style={{
                  padding: "8px 12px",
                  background: dimBg,
                  border: `1px solid ${borderColor}`,
                  marginBottom: 12,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span
                  style={{
                    fontFamily: FONT.body,
                    fontSize: "0.75rem",
                    color: C.textSecondary,
                  }}
                >
                  Est. payout if you win
                </span>
                <span style={{ ...mono("0.8rem"), color }}>
                  {est.multiplier.toFixed(2)}x
                </span>
              </div>
            )}

            {/* Deposit button */}
            <button
              onClick={() => handleDeposit(side)}
              disabled={
                depositing || !anchorWallet || !amount || parseFloat(amount) <= 0
              }
              style={{
                width: "100%",
                padding: "14px 0",
                background: depositing ? C.surface3 : color,
                color: isSideA ? "#fff" : "#08080C",
                border: "none",
                fontFamily: FONT.heading,
                fontSize: "0.9rem",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                cursor:
                  depositing || !anchorWallet || !amount || parseFloat(amount) <= 0
                    ? "not-allowed"
                    : "pointer",
                opacity:
                  !anchorWallet || !amount || parseFloat(amount) <= 0 ? 0.4 : 1,
                transition: "background 0.15s, opacity 0.15s",
              }}
            >
              {!anchorWallet
                ? "Connect Wallet"
                : depositing
                ? "Depositing..."
                : `Back $${symbol}`}
            </button>
          </>
        )}

        {/* Payout multiplier when not in deposit mode */}
        {!canDeposit && multiplier > 0 && !isResolved && (
          <div
            style={{
              padding: "8px 12px",
              background: dimBg,
              border: `1px solid ${borderColor}`,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span
              style={{
                fontFamily: FONT.body,
                fontSize: "0.75rem",
                color: C.textSecondary,
              }}
            >
              Payout if wins
            </span>
            <span style={{ ...mono("0.85rem"), color }}>
              {payoutLine(multiplier)}
            </span>
          </div>
        )}
      </div>
    );
  }

  /* ================================================================ */
  /*  RENDER                                                           */
  /* ================================================================ */

  return (
    <div style={{ maxWidth: 880, margin: "0 auto", padding: "80px 20px 60px" }}>

      {/* ============================================================ */}
      {/*  1. HEADER BAR                                                */}
      {/* ============================================================ */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 20,
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {/* Back button */}
          <Link
            href="/compare"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 32,
              height: 32,
              background: C.surface2,
              border: `1px solid ${C.border}`,
              color: C.textSecondary,
              textDecoration: "none",
              flexShrink: 0,
            }}
            aria-label="Back to compare"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
          </Link>

          {/* Token pair */}
          <h1
            style={{
              fontFamily: FONT.heading,
              fontSize: "1.5rem",
              fontWeight: 700,
              letterSpacing: "-0.03em",
              lineHeight: 1,
              margin: 0,
            }}
          >
            <span style={{ color: C.sideA }}>${symbolA}</span>
            <span
              style={{
                color: C.textMuted,
                margin: "0 10px",
                fontSize: "0.85rem",
                fontWeight: 500,
              }}
            >
              vs
            </span>
            <span style={{ color: C.sideB }}>${symbolB}</span>
          </h1>

          {/* Phase badge */}
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "4px 10px",
              fontFamily: FONT.heading,
              fontSize: "0.65rem",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              lineHeight: 1,
              ...(phase === "active"
                ? {
                    background: "rgba(64, 192, 128, 0.1)",
                    color: C.success,
                    border: "1px solid rgba(64, 192, 128, 0.2)",
                  }
                : phase === "twap"
                ? {
                    background: "rgba(43, 164, 224, 0.1)",
                    color: C.sideA,
                    border: `1px solid ${C.sideABorder}`,
                    animation: "twapPulse 2s ease-in-out infinite",
                  }
                : {
                    background: "rgba(255, 255, 255, 0.06)",
                    color: C.textPrimary,
                    border: `1px solid ${C.borderHover}`,
                  }),
            }}
          >
            {phase === "active" && (
              <span
                style={{
                  width: 6,
                  height: 6,
                  background: C.success,
                  display: "inline-block",
                }}
              />
            )}
            {phase === "active" ? "ACTIVE" : phase === "twap" ? "TWAP" : "RESOLVED"}
          </span>
        </div>

        {/* Countdown */}
        <span
          style={{
            ...mono("1.1rem"),
            color: isResolved ? C.textMuted : C.textPrimary,
            letterSpacing: "0.04em",
          }}
        >
          {countdown}
        </span>
      </div>

      {/* ============================================================ */}
      {/*  7. RESOLUTION BANNER (if resolved)                           */}
      {/* ============================================================ */}
      {isResolved && (
        <div
          style={{
            width: "100%",
            padding: "14px 20px",
            marginBottom: 20,
            background: hasWinner
              ? winnerIndex === 0
                ? C.sideADim
                : C.sideBDim
              : "rgba(255, 255, 255, 0.04)",
            borderLeft: `3px solid ${
              hasWinner
                ? winnerIndex === 0
                  ? C.sideA
                  : C.sideB
                : C.textMuted
            }`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          {hasWinner ? (
            <>
              <span
                style={{
                  fontFamily: FONT.heading,
                  fontWeight: 700,
                  fontSize: "0.9rem",
                  color: winnerIndex === 0 ? C.sideA : C.sideB,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}
              >
                ${winnerIndex === 0 ? symbolA : symbolB} Won
              </span>
              <span
                style={{
                  fontFamily: FONT.mono,
                  fontSize: "0.75rem",
                  color: C.textSecondary,
                }}
              >
                Net pool: {solDisplay(duel.netPool.toNumber())} SOL
              </span>
            </>
          ) : (
            <span
              style={{
                fontFamily: FONT.heading,
                fontWeight: 700,
                fontSize: "0.9rem",
                color: C.textPrimary,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              Draw -- both tokens performed equally
            </span>
          )}
        </div>
      )}

      {/* ============================================================ */}
      {/*  2. CONFLICT BAR                                              */}
      {/* ============================================================ */}
      <div style={{ marginBottom: 8 }}>
        {/* The bar */}
        <div
          style={{
            display: "flex",
            height: 24,
            overflow: "hidden",
            width: "100%",
          }}
        >
          <div
            style={{
              width: `${pctA}%`,
              background: C.sideA,
              transition: "width 0.6s ease",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minWidth: pctA > 5 ? undefined : 0,
              overflow: "hidden",
            }}
          >
            {pctA >= 12 && (
              <span
                style={{
                  fontFamily: FONT.mono,
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  color: "#fff",
                  whiteSpace: "nowrap",
                }}
              >
                {pctA.toFixed(1)}%
              </span>
            )}
          </div>
          <div
            style={{
              width: `${pctB}%`,
              background: C.sideB,
              transition: "width 0.6s ease",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minWidth: pctB > 5 ? undefined : 0,
              overflow: "hidden",
            }}
          >
            {pctB >= 12 && (
              <span
                style={{
                  fontFamily: FONT.mono,
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  color: "#08080C",
                  whiteSpace: "nowrap",
                }}
              >
                {pctB.toFixed(1)}%
              </span>
            )}
          </div>
        </div>
        {/* Labels below bar */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 6,
            marginBottom: 20,
          }}
        >
          <span style={{ ...mono("0.75rem", 500), color: C.sideA }}>
            Side A: {solDisplay(sideATotal)} SOL
          </span>
          <span style={{ ...mono("0.75rem", 500), color: C.sideB }}>
            Side B: {solDisplay(sideBTotal)} SOL
          </span>
        </div>
      </div>

      {/* ============================================================ */}
      {/*  3. TWO-COLUMN TRADING PANEL                                  */}
      {/* ============================================================ */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
          marginBottom: 24,
        }}
        className="trading-grid"
      >
        {renderSideCard(0)}
        {renderSideCard(1)}
      </div>

      {/* Already deposited notice */}
      {phase === "active" && deposit && !deposit.withdrawn && (
        <div
          style={{
            padding: "10px 16px",
            background: C.surface,
            border: `1px solid ${C.border}`,
            fontFamily: FONT.body,
            fontSize: "0.8rem",
            color: C.textSecondary,
            marginBottom: 24,
            textAlign: "center",
          }}
        >
          You have already deposited on this duel. One deposit per wallet.
        </div>
      )}

      {/* ============================================================ */}
      {/*  4. YOUR POSITION                                             */}
      {/* ============================================================ */}
      {deposit && userDeposit > 0 && (
        <div
          style={{
            background: C.surface,
            border: `1px solid ${C.border}`,
            padding: 20,
            marginBottom: 24,
          }}
        >
          <div style={{ ...label(), marginBottom: 14 }}>Your Position</div>

          <div
            style={{
              fontFamily: FONT.body,
              fontSize: "0.85rem",
              color: C.textPrimary,
              lineHeight: 1.8,
            }}
          >
            Backed{" "}
            <span
              style={{
                color: userSide === 0 ? C.sideA : C.sideB,
                fontWeight: 600,
              }}
            >
              ${userSide === 0 ? symbolA : symbolB}
            </span>{" "}
            with{" "}
            <span style={{ ...mono("0.85rem"), color: C.textPrimary }}>
              {solDisplay(userDeposit)} SOL
            </span>{" "}
            <span style={{ color: C.textSecondary }}>
              ({userPctOfSide.toFixed(1)}% of{" "}
              {userSide === 0 ? "Side A" : "Side B"})
            </span>
          </div>

          {/* Active/TWAP: show potential payout */}
          {!isResolved && userPotentialPayout > 0 && (
            <div
              style={{
                fontFamily: FONT.body,
                fontSize: "0.85rem",
                color: C.textSecondary,
                marginTop: 4,
              }}
            >
              Est. payout:{" "}
              <span style={{ ...mono("0.85rem"), color: C.textPrimary }}>
                {solDisplay(userPotentialPayout)} SOL
              </span>{" "}
              <span style={{ color: C.success }}>
                ({userDeposit > 0
                  ? `${((userPotentialPayout / userDeposit - 1) * 100).toFixed(0)}% return`
                  : ""}
                )
              </span>
            </div>
          )}

          {/* Resolved: winner */}
          {isResolved && isUserWinner && !deposit.withdrawn && (
            <div style={{ marginTop: 16 }}>
              <div
                style={{
                  fontFamily: FONT.heading,
                  fontSize: "0.85rem",
                  fontWeight: 700,
                  color: C.success,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  marginBottom: 12,
                }}
              >
                Won -- Withdraw {solDisplay(userPotentialPayout)} SOL
              </div>
              <button
                onClick={handleWithdraw}
                disabled={withdrawing}
                style={{
                  padding: "12px 32px",
                  background: C.success,
                  color: "#fff",
                  border: "none",
                  fontFamily: FONT.heading,
                  fontSize: "0.85rem",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  cursor: withdrawing ? "not-allowed" : "pointer",
                  opacity: withdrawing ? 0.5 : 1,
                }}
              >
                {withdrawing ? "Withdrawing..." : "Withdraw"}
              </button>
            </div>
          )}

          {/* Resolved: draw */}
          {isResolved && isDraw && !deposit.withdrawn && (
            <div style={{ marginTop: 16 }}>
              <div
                style={{
                  fontFamily: FONT.heading,
                  fontSize: "0.85rem",
                  fontWeight: 700,
                  color: C.textPrimary,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  marginBottom: 12,
                }}
              >
                Draw -- Withdraw {solDisplay(userDeposit)} SOL (refund)
              </div>
              <button
                onClick={handleWithdraw}
                disabled={withdrawing}
                style={{
                  padding: "12px 32px",
                  background: C.textPrimary,
                  color: C.bg,
                  border: "none",
                  fontFamily: FONT.heading,
                  fontSize: "0.85rem",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  cursor: withdrawing ? "not-allowed" : "pointer",
                  opacity: withdrawing ? 0.5 : 1,
                }}
              >
                {withdrawing ? "Withdrawing..." : "Withdraw Refund"}
              </button>
            </div>
          )}

          {/* Resolved: loser */}
          {isResolved && isUserLoser && (
            <div style={{ marginTop: 16 }}>
              <span
                style={{
                  fontFamily: FONT.heading,
                  fontSize: "0.85rem",
                  fontWeight: 700,
                  color: C.danger,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}
              >
                Lost -- No payout
              </span>
            </div>
          )}

          {/* Already withdrawn */}
          {deposit.withdrawn && (
            <div style={{ marginTop: 12 }}>
              <span
                style={{
                  fontFamily: FONT.heading,
                  fontSize: "0.8rem",
                  fontWeight: 600,
                  color: C.textMuted,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                Withdrawn
              </span>
            </div>
          )}
        </div>
      )}

      {/* ============================================================ */}
      {/*  5. TWAP PROGRESS                                             */}
      {/* ============================================================ */}
      {twapProgress && (
        <div
          style={{
            background: C.surface,
            border: `1px solid ${C.border}`,
            padding: 20,
            marginBottom: 24,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 12,
            }}
          >
            <span style={label()}>TWAP Observation</span>
            <span style={{ ...mono("0.75rem", 500), color: C.textSecondary }}>
              {twapProgress.pct.toFixed(0)}% complete
            </span>
          </div>

          {/* Block progress bar */}
          <div
            style={{
              height: 8,
              background: "rgba(255,255,255,0.04)",
              marginBottom: 12,
              overflow: "hidden",
              display: "flex",
            }}
          >
            <div
              style={{
                width: `${Math.min(twapProgress.pct, 100)}%`,
                height: "100%",
                background: C.sideA,
                transition: "width 1s linear",
              }}
            />
          </div>

          {/* Stats row */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 16,
              flexWrap: "wrap",
            }}
          >
            <span style={{ ...mono("0.7rem", 500), color: C.textMuted }}>
              Samples: {twapProgress.currentSamples}/{twapProgress.maxSamples}
            </span>
            {twapProgress.nextSampleIn > 0 && (
              <span style={{ ...mono("0.7rem", 500), color: C.textMuted }}>
                Next sample in:{" "}
                {Math.floor(twapProgress.nextSampleIn / 60)}m{" "}
                {twapProgress.nextSampleIn % 60}s
              </span>
            )}
            <span style={{ ...mono("0.7rem", 500), color: C.textMuted }}>
              Window: {formatDuration(twapProgress.window)}
            </span>
            <span style={{ ...mono("0.7rem", 500), color: C.textMuted }}>
              Interval: {twapProgress.interval}s
            </span>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/*  6. MARKET DETAILS (collapsible)                              */}
      {/* ============================================================ */}
      <div
        style={{
          background: C.surface,
          border: `1px solid ${C.border}`,
          marginBottom: 24,
        }}
      >
        <button
          onClick={() => setDetailsOpen(!detailsOpen)}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 20px",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: C.textMuted,
          }}
        >
          <span style={label()}>Market Details</span>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              transform: detailsOpen ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 0.2s",
            }}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {detailsOpen && (
          <div style={{ padding: "0 20px 20px" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
              }}
            >
              <tbody>
                {[
                  { key: "Token A", value: `$${symbolA}`, color: C.sideA },
                  { key: "Token B", value: `$${symbolB}`, color: C.sideB },
                  {
                    key: "Oracle A",
                    value: shortenAddress(duel.oracleA.toBase58(), 6),
                    color: C.textSecondary,
                  },
                  {
                    key: "Oracle B",
                    value: shortenAddress(duel.oracleB.toBase58(), 6),
                    color: C.textSecondary,
                  },
                  {
                    key: "Deadline",
                    value: formatUTCDate(duel.deadline.toNumber()),
                    color: C.textSecondary,
                  },
                  {
                    key: "TWAP Window",
                    value: formatDuration(duel.twapWindow.toNumber()),
                    color: C.textSecondary,
                  },
                  {
                    key: "TWAP Interval",
                    value: `${duel.twapInterval.toNumber()} seconds`,
                    color: C.textSecondary,
                  },
                  {
                    key: "Min Deposit",
                    value: `${solDisplay(duel.minDeposit.toNumber())} SOL`,
                    color: C.textSecondary,
                  },
                  {
                    key: "Total Pool",
                    value: `${solDisplay(totalPool)} SOL`,
                    color: C.textPrimary,
                  },
                  { key: "Fee", value: "1%", color: C.textSecondary },
                  {
                    key: "Market Address",
                    value: shortenAddress(duelPubkey, 6),
                    color: C.textSecondary,
                  },
                ].map((row) => (
                  <tr key={row.key}>
                    <td
                      style={{
                        padding: "8px 0",
                        fontFamily: FONT.body,
                        fontSize: "0.8rem",
                        color: C.textMuted,
                        borderBottom: `1px solid ${C.border}`,
                        width: "40%",
                      }}
                    >
                      {row.key}
                    </td>
                    <td
                      style={{
                        padding: "8px 0",
                        fontFamily: FONT.mono,
                        fontSize: "0.8rem",
                        fontWeight: 500,
                        color: row.color,
                        borderBottom: `1px solid ${C.border}`,
                        textAlign: "right",
                      }}
                    >
                      {row.value}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ============================================================ */}
      {/*  TX STATUS BAR                                                */}
      {/* ============================================================ */}
      {txStatus && (
        <div
          style={{
            padding: "10px 16px",
            background: C.surface,
            border: `1px solid ${
              txStatus.startsWith("Failed") ? "rgba(232, 64, 64, 0.2)" : C.border
            }`,
            fontFamily: FONT.mono,
            fontSize: "0.75rem",
            color: txStatus.startsWith("Failed") ? C.danger : C.textSecondary,
            wordBreak: "break-all",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <span>{txStatus}</span>
          <button
            onClick={() => setTxStatus(null)}
            style={{
              background: "transparent",
              border: "none",
              color: C.textMuted,
              cursor: "pointer",
              fontFamily: FONT.mono,
              fontSize: "0.7rem",
              flexShrink: 0,
            }}
          >
            dismiss
          </button>
        </div>
      )}

      {/* ============================================================ */}
      {/*  RESPONSIVE + ANIMATIONS                                      */}
      {/* ============================================================ */}
      <style>{`
        @keyframes twapPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
        @media (max-width: 640px) {
          .trading-grid {
            grid-template-columns: 1fr !important;
          }
        }
        /* Remove number input spinners */
        input[type="number"]::-webkit-inner-spin-button,
        input[type="number"]::-webkit-outer-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        input[type="number"] {
          -moz-appearance: textfield;
        }
      `}</style>
    </div>
  );
}
