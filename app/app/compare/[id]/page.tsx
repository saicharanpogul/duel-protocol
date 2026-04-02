"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
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
  formatCountdown,
  shortenAddress,
  type CompareDuelAccount,
  type DepositAccount,
  type ComparePhase,
} from "../../lib/program";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const SIDE_A_COLOR = "#2BA4E0";
const SIDE_A_DIM = "rgba(43, 164, 224, 0.12)";
const SIDE_A_BORDER = "rgba(43, 164, 224, 0.25)";
const SIDE_B_COLOR = "#FFE233";
const SIDE_B_DIM = "rgba(255, 226, 51, 0.10)";
const SIDE_B_BORDER = "rgba(255, 226, 51, 0.25)";
const BG_SURFACE = "#0E0E14";
const BG_SURFACE_2 = "#141420";
const TEXT_PRIMARY = "#E8E8ED";
const TEXT_SECONDARY = "#7A7A8E";
const TEXT_MUTED = "#44445A";
const BORDER = "rgba(255, 255, 255, 0.06)";
const BORDER_HOVER = "rgba(255, 255, 255, 0.12)";
const RADIUS = "2px";

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function CompareDuelDetailPage() {
  const params = useParams();
  const duelPubkey = params.id as string;
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const anchorWallet = useAnchorWallet();

  /* state */
  const [duel, setDuel] = useState<CompareDuelAccount | null>(null);
  const [deposit, setDeposit] = useState<DepositAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedSide, setSelectedSide] = useState<0 | 1>(0);
  const [amount, setAmount] = useState("");
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [countdown, setCountdown] = useState("");

  /* derived */
  const phase: ComparePhase | null = duel ? getComparePhase(duel) : null;
  const sideATotal = duel ? duel.sideATotal.toNumber() : 0;
  const sideBTotal = duel ? duel.sideBTotal.toNumber() : 0;
  const totalPool = sideATotal + sideBTotal;
  const pctA = totalPool > 0 ? (sideATotal / totalPool) * 100 : 50;
  const pctB = 100 - pctA;

  const symbolA = duel ? (getTokenSymbolFromMint(duel.tokenAMint.toBase58()) || shortenAddress(duel.tokenAMint.toBase58())) : "A";
  const symbolB = duel ? (getTokenSymbolFromMint(duel.tokenBMint.toBase58()) || shortenAddress(duel.tokenBMint.toBase58())) : "B";

  /* potential payout multiplier */
  const potentialA = useMemo(() => {
    if (totalPool === 0 || sideATotal === 0) return 0;
    return totalPool / sideATotal;
  }, [totalPool, sideATotal]);

  const potentialB = useMemo(() => {
    if (totalPool === 0 || sideBTotal === 0) return 0;
    return totalPool / sideBTotal;
  }, [totalPool, sideBTotal]);

  /* estimated payout for entered amount */
  const estimatedPayout = useMemo(() => {
    const sol = parseFloat(amount);
    if (isNaN(sol) || sol <= 0 || totalPool === 0) return 0;
    const lamports = sol * LAMPORTS_PER_SOL;
    const sideTotal = selectedSide === 0 ? sideATotal : sideBTotal;
    const newSideTotal = sideTotal + lamports;
    const newTotalPool = totalPool + lamports;
    // payout = (deposit / newSideTotal) * newTotalPool
    return (lamports / newSideTotal) * newTotalPool;
  }, [amount, selectedSide, sideATotal, sideBTotal, totalPool]);

  /* user position info */
  const userDeposit = deposit && !deposit.withdrawn ? deposit.amount.toNumber() : 0;
  const userSide = deposit ? deposit.side : null;
  const userSideTotal = userSide === 0 ? sideATotal : userSide === 1 ? sideBTotal : 0;
  const userPctOfSide = userSideTotal > 0 ? (userDeposit / userSideTotal) * 100 : 0;
  const userPotentialPayout = userSideTotal > 0
    ? (userDeposit / userSideTotal) * totalPool
    : 0;

  /* TWAP progress */
  const twapProgress = useMemo(() => {
    if (!duel) return null;
    const now = Math.floor(Date.now() / 1000);
    const deadline = duel.deadline.toNumber();
    const window = duel.twapWindow.toNumber();
    const interval = duel.twapInterval.toNumber();
    const twapStart = deadline - window;
    if (now < twapStart) return null;
    const elapsed = Math.min(now - twapStart, window);
    const pct = (elapsed / window) * 100;
    const maxSamples = interval > 0 ? Math.floor(window / interval) : 0;
    const currentSamples = duel.twapSamplesCount;
    const nextSampleIn = interval > 0 && duel.lastSampleTs.toNumber() > 0
      ? Math.max(0, interval - (now - duel.lastSampleTs.toNumber()))
      : 0;
    return { pct, currentSamples, maxSamples, nextSampleIn };
  }, [duel, countdown]);

  /* fetch */
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
    const id = setInterval(fetchData, 5000);
    return () => clearInterval(id);
  }, [fetchData]);

  useEffect(() => {
    if (!duel) return;
    const tick = () => setCountdown(formatCountdown(duel.deadline.toNumber()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [duel]);

  /* deposit handler */
  async function handleDeposit() {
    if (!anchorWallet || !duel) return;
    const solAmount = parseFloat(amount);
    if (isNaN(solAmount) || solAmount <= 0) return;

    setTxStatus("Preparing transaction...");
    try {
      const provider = new AnchorProvider(connection, anchorWallet, {
        commitment: "confirmed",
      });
      const program = getProgram(provider);
      const dk = new PublicKey(duelPubkey);
      const lamports = Math.floor(solAmount * LAMPORTS_PER_SOL);

      // Wrap SOL
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
      const poolVault = selectedSide === 0 ? duel.poolVaultA : duel.poolVaultB;

      const depositIx = await (program.methods as any)
        .deposit(selectedSide, new BN(lamports))
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
      setTxStatus(`Success -- ${sig.slice(0, 8)}...`);
      setAmount("");
      setTimeout(fetchData, 2000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message.slice(0, 80) : String(err);
      setTxStatus(`Failed -- ${msg}`);
    }
  }

  /* withdraw handler */
  async function handleWithdraw() {
    if (!anchorWallet || !duel || !deposit) return;

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

      // For withdraw, we need the winning side vault (or depositor's side vault for draw)
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
      setTxStatus(`Withdrawn -- ${sig.slice(0, 8)}...`);
      setTimeout(fetchData, 2000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message.slice(0, 80) : String(err);
      setTxStatus(`Failed -- ${msg}`);
    }
  }

  /* ================================================================ */
  /*  RENDER                                                           */
  /* ================================================================ */

  if (loading) {
    return (
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "100px 24px" }}>
        <div className="skeleton" style={{ height: 40, marginBottom: 24, width: "60%" }} />
        <div className="skeleton" style={{ height: 12, marginBottom: 32 }} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
          <div className="skeleton" style={{ height: 260 }} />
          <div className="skeleton" style={{ height: 260 }} />
        </div>
        <div className="skeleton" style={{ height: 60, marginBottom: 24 }} />
        <div className="skeleton" style={{ height: 120 }} />
      </div>
    );
  }

  if (!duel) {
    return (
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "140px 24px", textAlign: "center" }}>
        <h2 style={{ fontFamily: "var(--font-heading)", marginBottom: 8 }}>
          Compare duel not found
        </h2>
        <p style={{ color: TEXT_SECONDARY, marginBottom: 24 }}>
          Check the address and try again.
        </p>
        <Link href="/compare" style={{ color: SIDE_A_COLOR, fontWeight: 600, fontSize: "0.85rem" }}>
          Back to Compare
        </Link>
      </div>
    );
  }

  const isResolved = phase === "resolved";
  const isTwap = phase === "twap";
  const winnerIndex = duel.winner;
  const hasWinner = winnerIndex !== null && winnerIndex !== undefined;
  const isUserWinner = hasWinner && deposit && deposit.side === winnerIndex;
  const isUserLoser = hasWinner && deposit && deposit.side !== winnerIndex;
  const canDeposit = phase === "active" && !deposit;
  const canWithdraw = isResolved && deposit && !deposit.withdrawn && (isUserWinner || !hasWinner);

  const quickAmounts = [0.1, 0.5, 1, 5];

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "80px 24px 60px" }}>

      {/* ============================================================ */}
      {/*  HEADER BAR                                                   */}
      {/* ============================================================ */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 28,
        gap: 12,
        flexWrap: "wrap",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Link
            href="/compare"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 32,
              height: 32,
              background: BG_SURFACE_2,
              border: `1px solid ${BORDER}`,
              borderRadius: RADIUS,
              color: TEXT_SECONDARY,
            }}
            aria-label="Back to compare"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
          </Link>

          <span style={{
            fontFamily: "var(--font-heading)",
            fontSize: "1.25rem",
            fontWeight: 700,
            letterSpacing: "-0.02em",
          }}>
            <span style={{ color: SIDE_A_COLOR }}>${symbolA}</span>
            <span style={{ color: TEXT_MUTED, margin: "0 8px", fontSize: "0.75rem" }}>vs</span>
            <span style={{ color: SIDE_B_COLOR }}>${symbolB}</span>
          </span>

          {/* Phase badge */}
          <span style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "4px 10px",
            borderRadius: RADIUS,
            fontFamily: "var(--font-heading)",
            fontSize: "0.7rem",
            fontWeight: 600,
            textTransform: "uppercase" as const,
            letterSpacing: "0.08em",
            ...(phase === "active"
              ? { background: "rgba(64, 192, 128, 0.1)", color: "#40C080", border: "1px solid rgba(64, 192, 128, 0.2)" }
              : phase === "twap"
              ? { background: SIDE_B_DIM, color: SIDE_B_COLOR, border: `1px solid ${SIDE_B_BORDER}` }
              : { background: BG_SURFACE_2, color: TEXT_MUTED, border: `1px solid ${BORDER}` }),
          }}>
            {phase === "active" ? "ACTIVE" : phase === "twap" ? "TWAP" : "RESOLVED"}
          </span>
        </div>

        <span style={{
          fontFamily: "var(--font-mono)",
          fontSize: "1rem",
          fontWeight: 600,
          color: isResolved ? TEXT_MUTED : TEXT_PRIMARY,
          letterSpacing: "0.02em",
        }}>
          {countdown}
        </span>
      </div>

      {/* ============================================================ */}
      {/*  WINNER BANNER (if resolved)                                  */}
      {/* ============================================================ */}
      {hasWinner && (
        <div style={{
          padding: "16px 20px",
          marginBottom: 24,
          background: winnerIndex === 0 ? SIDE_A_DIM : SIDE_B_DIM,
          border: `1px solid ${winnerIndex === 0 ? SIDE_A_BORDER : SIDE_B_BORDER}`,
          borderRadius: RADIUS,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={winnerIndex === 0 ? SIDE_A_COLOR : SIDE_B_COLOR} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
            <path d="M4 22h16" /><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
          </svg>
          <span style={{
            fontFamily: "var(--font-heading)",
            fontWeight: 700,
            fontSize: "0.9rem",
            color: winnerIndex === 0 ? SIDE_A_COLOR : SIDE_B_COLOR,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}>
            ${winnerIndex === 0 ? symbolA : symbolB} wins
          </span>
        </div>
      )}

      {/* ============================================================ */}
      {/*  SIDE CARDS                                                   */}
      {/* ============================================================ */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 16,
        marginBottom: 24,
      }}>
        {/* Side A */}
        <div style={{
          background: BG_SURFACE,
          border: `1px solid ${selectedSide === 0 && canDeposit ? SIDE_A_BORDER : BORDER}`,
          borderTop: `3px solid ${SIDE_A_COLOR}`,
          borderRadius: RADIUS,
          padding: 20,
          cursor: canDeposit ? "pointer" : "default",
          transition: "border-color 0.15s",
          opacity: hasWinner && winnerIndex !== 0 ? 0.5 : 1,
        }}
        onClick={() => canDeposit && setSelectedSide(0)}
        >
          <div style={{
            fontFamily: "var(--font-heading)",
            fontSize: "0.65rem",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            color: SIDE_A_COLOR,
            marginBottom: 12,
          }}>
            Side A (${symbolA})
          </div>

          <div style={{
            fontFamily: "var(--font-mono)",
            fontSize: "0.8rem",
            color: TEXT_SECONDARY,
            marginBottom: 8,
          }}>
            {pctA.toFixed(1)}% of pool
          </div>

          {/* Bar */}
          <div style={{
            height: 8,
            background: "rgba(255,255,255,0.04)",
            marginBottom: 12,
            overflow: "hidden",
          }}>
            <div style={{
              width: `${pctA}%`,
              height: "100%",
              background: SIDE_A_COLOR,
              transition: "width 0.4s ease",
            }} />
          </div>

          <div style={{
            fontFamily: "var(--font-mono)",
            fontSize: "1.1rem",
            fontWeight: 600,
            color: TEXT_PRIMARY,
            marginBottom: 16,
          }}>
            {formatSol(sideATotal)} SOL
          </div>

          {canDeposit && (
            <>
              <button
                className={selectedSide === 0 ? "btn btn-a" : "btn btn-ghost"}
                onClick={(e) => { e.stopPropagation(); setSelectedSide(0); }}
                style={{ width: "100%", marginBottom: 8 }}
              >
                Back ${symbolA}
              </button>
              {potentialA > 0 && (
                <div style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.75rem",
                  color: TEXT_MUTED,
                  textAlign: "center",
                }}>
                  Potential: {potentialA.toFixed(2)}x
                </div>
              )}
            </>
          )}

          {hasWinner && winnerIndex === 0 && (
            <div style={{
              marginTop: 8,
              padding: "4px 10px",
              background: SIDE_A_DIM,
              border: `1px solid ${SIDE_A_BORDER}`,
              borderRadius: RADIUS,
              textAlign: "center",
              fontFamily: "var(--font-heading)",
              fontSize: "0.7rem",
              fontWeight: 700,
              color: SIDE_A_COLOR,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}>
              Winner
            </div>
          )}
        </div>

        {/* Side B */}
        <div style={{
          background: BG_SURFACE,
          border: `1px solid ${selectedSide === 1 && canDeposit ? SIDE_B_BORDER : BORDER}`,
          borderTop: `3px solid ${SIDE_B_COLOR}`,
          borderRadius: RADIUS,
          padding: 20,
          cursor: canDeposit ? "pointer" : "default",
          transition: "border-color 0.15s",
          opacity: hasWinner && winnerIndex !== 1 ? 0.5 : 1,
        }}
        onClick={() => canDeposit && setSelectedSide(1)}
        >
          <div style={{
            fontFamily: "var(--font-heading)",
            fontSize: "0.65rem",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            color: SIDE_B_COLOR,
            marginBottom: 12,
          }}>
            Side B (${symbolB})
          </div>

          <div style={{
            fontFamily: "var(--font-mono)",
            fontSize: "0.8rem",
            color: TEXT_SECONDARY,
            marginBottom: 8,
          }}>
            {pctB.toFixed(1)}% of pool
          </div>

          <div style={{
            height: 8,
            background: "rgba(255,255,255,0.04)",
            marginBottom: 12,
            overflow: "hidden",
          }}>
            <div style={{
              width: `${pctB}%`,
              height: "100%",
              background: SIDE_B_COLOR,
              transition: "width 0.4s ease",
            }} />
          </div>

          <div style={{
            fontFamily: "var(--font-mono)",
            fontSize: "1.1rem",
            fontWeight: 600,
            color: TEXT_PRIMARY,
            marginBottom: 16,
          }}>
            {formatSol(sideBTotal)} SOL
          </div>

          {canDeposit && (
            <>
              <button
                className={selectedSide === 1 ? "btn btn-b" : "btn btn-ghost"}
                onClick={(e) => { e.stopPropagation(); setSelectedSide(1); }}
                style={{ width: "100%", marginBottom: 8 }}
              >
                Back ${symbolB}
              </button>
              {potentialB > 0 && (
                <div style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.75rem",
                  color: TEXT_MUTED,
                  textAlign: "center",
                }}>
                  Potential: {potentialB.toFixed(2)}x
                </div>
              )}
            </>
          )}

          {hasWinner && winnerIndex === 1 && (
            <div style={{
              marginTop: 8,
              padding: "4px 10px",
              background: SIDE_B_DIM,
              border: `1px solid ${SIDE_B_BORDER}`,
              borderRadius: RADIUS,
              textAlign: "center",
              fontFamily: "var(--font-heading)",
              fontSize: "0.7rem",
              fontWeight: 700,
              color: SIDE_B_COLOR,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}>
              Winner
            </div>
          )}
        </div>
      </div>

      {/* ============================================================ */}
      {/*  DEPOSIT FORM (active phase, no existing deposit)             */}
      {/* ============================================================ */}
      {canDeposit && (
        <div style={{
          background: BG_SURFACE,
          border: `1px solid ${BORDER}`,
          borderRadius: RADIUS,
          padding: 20,
          marginBottom: 24,
        }}>
          <div style={{
            fontFamily: "var(--font-heading)",
            fontSize: "0.65rem",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            color: selectedSide === 0 ? SIDE_A_COLOR : SIDE_B_COLOR,
            marginBottom: 12,
          }}>
            Deposit on {selectedSide === 0 ? `$${symbolA}` : `$${symbolB}`}
          </div>

          {/* Quick amount buttons */}
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            {quickAmounts.map((qa) => (
              <button
                key={qa}
                onClick={() => setAmount(qa.toString())}
                style={{
                  flex: 1,
                  padding: "8px 0",
                  background: amount === qa.toString() ? (selectedSide === 0 ? SIDE_A_DIM : SIDE_B_DIM) : BG_SURFACE_2,
                  border: `1px solid ${amount === qa.toString() ? (selectedSide === 0 ? SIDE_A_BORDER : SIDE_B_BORDER) : BORDER}`,
                  borderRadius: RADIUS,
                  color: amount === qa.toString() ? (selectedSide === 0 ? SIDE_A_COLOR : SIDE_B_COLOR) : TEXT_SECONDARY,
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.8rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
              >
                {qa}
              </button>
            ))}
          </div>

          {/* Amount input */}
          <div style={{ position: "relative", marginBottom: 12 }}>
            <input
              className="input input-mono"
              type="number"
              step="0.001"
              min="0"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              style={{
                fontSize: "1.1rem",
                fontWeight: 600,
                paddingRight: 60,
              }}
            />
            <span style={{
              position: "absolute",
              right: 16,
              top: "50%",
              transform: "translateY(-50%)",
              fontFamily: "var(--font-mono)",
              fontSize: "0.8rem",
              color: TEXT_MUTED,
              fontWeight: 600,
            }}>
              SOL
            </span>
          </div>

          {/* Estimated payout */}
          {estimatedPayout > 0 && (
            <div style={{
              padding: "8px 14px",
              background: selectedSide === 0 ? SIDE_A_DIM : SIDE_B_DIM,
              border: `1px solid ${selectedSide === 0 ? SIDE_A_BORDER : SIDE_B_BORDER}`,
              borderRadius: RADIUS,
              fontFamily: "var(--font-mono)",
              fontSize: "0.8rem",
              color: selectedSide === 0 ? SIDE_A_COLOR : SIDE_B_COLOR,
              marginBottom: 12,
              display: "flex",
              justifyContent: "space-between",
            }}>
              <span>Estimated payout</span>
              <span style={{ fontWeight: 600 }}>
                {formatSol(estimatedPayout)} SOL ({(estimatedPayout / (parseFloat(amount) * LAMPORTS_PER_SOL) * 100 - 100).toFixed(0)}% return)
              </span>
            </div>
          )}

          {/* Deposit button */}
          <button
            className={selectedSide === 0 ? "btn btn-a btn-lg" : "btn btn-b btn-lg"}
            onClick={handleDeposit}
            disabled={!anchorWallet || !amount || parseFloat(amount) <= 0}
            style={{ width: "100%", fontWeight: 800 }}
          >
            {!anchorWallet ? "Connect Wallet" : `Back $${selectedSide === 0 ? symbolA : symbolB}`}
          </button>
        </div>
      )}

      {/* Already deposited message */}
      {phase === "active" && deposit && !deposit.withdrawn && (
        <div style={{
          padding: "12px 16px",
          background: BG_SURFACE,
          border: `1px solid ${BORDER}`,
          borderRadius: RADIUS,
          fontFamily: "var(--font-body)",
          fontSize: "0.8rem",
          color: TEXT_SECONDARY,
          marginBottom: 24,
          textAlign: "center",
        }}>
          You have already deposited on this duel. One deposit per wallet.
        </div>
      )}

      {/* ============================================================ */}
      {/*  WITHDRAW (resolved, user is winner or draw)                  */}
      {/* ============================================================ */}
      {canWithdraw && (
        <div style={{
          background: BG_SURFACE,
          border: `1px solid ${BORDER}`,
          borderRadius: RADIUS,
          padding: 20,
          marginBottom: 24,
          textAlign: "center",
        }}>
          <div style={{
            fontFamily: "var(--font-heading)",
            fontSize: "0.85rem",
            fontWeight: 700,
            color: TEXT_PRIMARY,
            marginBottom: 12,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}>
            {hasWinner ? "Claim your winnings" : "Withdraw refund (draw)"}
          </div>
          <button
            className="btn btn-a btn-lg"
            onClick={handleWithdraw}
            style={{ fontWeight: 800 }}
          >
            Withdraw
          </button>
        </div>
      )}

      {/* Loser state */}
      {isUserLoser && !deposit?.withdrawn && (
        <div style={{
          padding: "16px 20px",
          background: "rgba(232, 64, 64, 0.06)",
          border: "1px solid rgba(232, 64, 64, 0.15)",
          borderRadius: RADIUS,
          textAlign: "center",
          marginBottom: 24,
        }}>
          <div style={{
            fontFamily: "var(--font-heading)",
            fontSize: "0.85rem",
            fontWeight: 700,
            color: "#E84040",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}>
            Lost
          </div>
          <div style={{
            fontFamily: "var(--font-body)",
            fontSize: "0.8rem",
            color: TEXT_SECONDARY,
            marginTop: 6,
          }}>
            Your deposit of {formatSol(userDeposit)} SOL on ${userSide === 0 ? symbolA : symbolB} did not win.
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/*  POOL STATS                                                   */}
      {/* ============================================================ */}
      <div style={{
        display: "flex",
        background: BG_SURFACE,
        border: `1px solid ${BORDER}`,
        borderRadius: RADIUS,
        marginBottom: 24,
        overflow: "hidden",
      }}>
        <div style={{ flex: 1, padding: "14px 20px", textAlign: "center", borderRight: `1px solid ${BORDER}` }}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "1rem", fontWeight: 600, color: TEXT_PRIMARY }}>
            {formatSol(totalPool)} SOL
          </div>
          <div style={{
            fontFamily: "var(--font-heading)", fontSize: "0.6rem", color: TEXT_MUTED,
            textTransform: "uppercase", letterSpacing: "0.1em", marginTop: 2,
          }}>Pool</div>
        </div>
        <div style={{ flex: 1, padding: "14px 20px", textAlign: "center", borderRight: `1px solid ${BORDER}` }}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "1rem", fontWeight: 600, color: TEXT_PRIMARY }}>
            {formatSol(duel.minDeposit.toNumber())}
          </div>
          <div style={{
            fontFamily: "var(--font-heading)", fontSize: "0.6rem", color: TEXT_MUTED,
            textTransform: "uppercase", letterSpacing: "0.1em", marginTop: 2,
          }}>Min Deposit</div>
        </div>
        <div style={{ flex: 1, padding: "14px 20px", textAlign: "center" }}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "1rem", fontWeight: 600, color: TEXT_PRIMARY }}>
            1%
          </div>
          <div style={{
            fontFamily: "var(--font-heading)", fontSize: "0.6rem", color: TEXT_MUTED,
            textTransform: "uppercase", letterSpacing: "0.1em", marginTop: 2,
          }}>Fee</div>
        </div>
      </div>

      {/* ============================================================ */}
      {/*  YOUR POSITION                                                */}
      {/* ============================================================ */}
      {deposit && userDeposit > 0 && (
        <div style={{
          background: BG_SURFACE,
          border: `1px solid ${BORDER}`,
          borderRadius: RADIUS,
          padding: 20,
          marginBottom: 24,
        }}>
          <div style={{
            fontFamily: "var(--font-heading)",
            fontSize: "0.65rem",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            color: TEXT_MUTED,
            marginBottom: 12,
          }}>
            Your Position
          </div>
          <div style={{
            fontFamily: "var(--font-body)",
            fontSize: "0.85rem",
            color: TEXT_PRIMARY,
            lineHeight: 1.7,
          }}>
            Backed <span style={{ color: userSide === 0 ? SIDE_A_COLOR : SIDE_B_COLOR, fontWeight: 600 }}>
              ${userSide === 0 ? symbolA : symbolB}
            </span> with{" "}
            <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>
              {formatSol(userDeposit)} SOL
            </span>{" "}
            ({userPctOfSide.toFixed(1)}% of side)
          </div>
          {!isResolved && (
            <div style={{
              fontFamily: "var(--font-body)",
              fontSize: "0.85rem",
              color: TEXT_SECONDARY,
              marginTop: 4,
            }}>
              Potential payout:{" "}
              <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: TEXT_PRIMARY }}>
                {formatSol(userPotentialPayout)} SOL
              </span>{" "}
              ({userDeposit > 0 ? ((userPotentialPayout / userDeposit - 1) * 100).toFixed(0) : 0}% return)
            </div>
          )}
        </div>
      )}

      {/* ============================================================ */}
      {/*  TWAP PROGRESS                                                */}
      {/* ============================================================ */}
      {twapProgress && (
        <div style={{
          background: BG_SURFACE,
          border: `1px solid ${BORDER}`,
          borderRadius: RADIUS,
          padding: 20,
          marginBottom: 24,
        }}>
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 10,
          }}>
            <span style={{
              fontFamily: "var(--font-heading)",
              fontSize: "0.65rem",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              color: TEXT_MUTED,
            }}>
              TWAP Progress
            </span>
            <span style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.75rem",
              color: TEXT_SECONDARY,
            }}>
              {twapProgress.pct.toFixed(0)}%
            </span>
          </div>

          {/* Progress bar */}
          <div style={{
            height: 6,
            background: "rgba(255,255,255,0.04)",
            marginBottom: 10,
            overflow: "hidden",
          }}>
            <div style={{
              width: `${Math.min(twapProgress.pct, 100)}%`,
              height: "100%",
              background: `linear-gradient(90deg, ${SIDE_A_COLOR}, ${SIDE_B_COLOR})`,
              transition: "width 0.4s ease",
            }} />
          </div>

          <div style={{
            display: "flex",
            justifyContent: "space-between",
            fontFamily: "var(--font-mono)",
            fontSize: "0.7rem",
            color: TEXT_MUTED,
          }}>
            <span>Samples: {twapProgress.currentSamples}/{twapProgress.maxSamples}</span>
            {twapProgress.nextSampleIn > 0 && (
              <span>Next: {Math.floor(twapProgress.nextSampleIn / 60)}m {twapProgress.nextSampleIn % 60}s</span>
            )}
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/*  MARKET INFO                                                  */}
      {/* ============================================================ */}
      <div style={{
        background: BG_SURFACE,
        border: `1px solid ${BORDER}`,
        borderRadius: RADIUS,
        padding: 20,
        marginBottom: 24,
      }}>
        <div style={{
          fontFamily: "var(--font-heading)",
          fontSize: "0.65rem",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          color: TEXT_MUTED,
          marginBottom: 16,
        }}>
          Market Info
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 24px" }}>
          {[
            { label: "Token A", value: `$${symbolA}`, color: SIDE_A_COLOR },
            { label: "Token B", value: `$${symbolB}`, color: SIDE_B_COLOR },
            { label: "Oracle A", value: shortenAddress(duel.oracleA.toBase58(), 6), color: TEXT_SECONDARY },
            { label: "Oracle B", value: shortenAddress(duel.oracleB.toBase58(), 6), color: TEXT_SECONDARY },
            { label: "Deadline", value: new Date(duel.deadline.toNumber() * 1000).toUTCString().replace("GMT", "UTC"), color: TEXT_SECONDARY },
            { label: "TWAP Window", value: `${Math.floor(duel.twapWindow.toNumber() / 60)} min`, color: TEXT_SECONDARY },
            { label: "TWAP Interval", value: `${duel.twapInterval.toNumber()}s`, color: TEXT_SECONDARY },
            { label: "Address", value: shortenAddress(duelPubkey, 6), color: TEXT_SECONDARY },
          ].map((item, i) => (
            <div key={i}>
              <div style={{
                fontFamily: "var(--font-heading)",
                fontSize: "0.6rem",
                color: TEXT_MUTED,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                marginBottom: 2,
              }}>
                {item.label}
              </div>
              <div style={{
                fontFamily: "var(--font-mono)",
                fontSize: "0.8rem",
                color: item.color,
                fontWeight: 500,
              }}>
                {item.value}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ============================================================ */}
      {/*  TX STATUS                                                    */}
      {/* ============================================================ */}
      {txStatus && (
        <div style={{
          padding: "10px 14px",
          background: BG_SURFACE,
          border: `1px solid ${BORDER}`,
          borderRadius: RADIUS,
          fontFamily: "var(--font-mono)",
          fontSize: "0.75rem",
          color: txStatus.startsWith("Failed") ? "#E84040" : TEXT_SECONDARY,
          wordBreak: "break-all",
        }}>
          {txStatus}
        </div>
      )}

      {/* Responsive */}
      <style>{`
        @media (max-width: 640px) {
          div[style*="grid-template-columns: 1fr 1fr"] {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}
