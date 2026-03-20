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
  calculatePrice,
  formatSol,
  formatTokens,
  formatCountdown,
  shortenAddress,
  getMarketPhase,
  TOTAL_SUPPLY,
  CURVE_SCALE,
  CURVE_A,
  CURVE_B,
  type MarketAccount,
  type SideAccount,
  type MarketPhase,
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
const BG_SURFACE_3 = "#1C1C2A";
const TEXT_PRIMARY = "#E8E8ED";
const TEXT_SECONDARY = "#7A7A8E";
const TEXT_MUTED = "#44445A";
const BORDER = "rgba(255, 255, 255, 0.06)";
const BORDER_HOVER = "rgba(255, 255, 255, 0.12)";
const RADIUS = "2px";

const CHART_SUPPLY_MAX = 5_000_000;
const CHART_POINTS = 60;

/* ------------------------------------------------------------------ */
/*  SVG bonding curve helpers                                          */
/* ------------------------------------------------------------------ */

function buildCurvePoints(maxSupply: number, numPoints: number) {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= numPoints; i++) {
    const supply = (maxSupply / numPoints) * i;
    const price = calculatePrice(supply);
    pts.push({ x: supply, y: price });
  }
  return pts;
}

function pointsToPath(
  pts: { x: number; y: number }[],
  xMax: number,
  yMax: number,
  viewW: number,
  viewH: number
): string {
  if (pts.length === 0) return "";
  const sx = (x: number) => (x / xMax) * viewW;
  const sy = (y: number) => viewH - (y / yMax) * viewH;
  let d = `M ${sx(pts[0].x)} ${sy(pts[0].y)}`;
  for (let i = 1; i < pts.length; i++) {
    d += ` L ${sx(pts[i].x)} ${sy(pts[i].y)}`;
  }
  return d;
}

function pointsToAreaPath(
  pts: { x: number; y: number }[],
  xMax: number,
  yMax: number,
  viewW: number,
  viewH: number
): string {
  if (pts.length === 0) return "";
  const linePath = pointsToPath(pts, xMax, yMax, viewW, viewH);
  const sx = (x: number) => (x / xMax) * viewW;
  return `${linePath} L ${sx(pts[pts.length - 1].x)} ${viewH} L ${sx(pts[0].x)} ${viewH} Z`;
}

/* ------------------------------------------------------------------ */
/*  Estimate tokens out for a given SOL in (binary search)             */
/* ------------------------------------------------------------------ */

function estimateTokensOut(
  currentCirculating: number,
  solLamports: number
): number {
  // Walk along the curve summing cost per token until we exhaust the SOL.
  // For speed, use a coarse step then refine.
  if (solLamports <= 0 || currentCirculating >= TOTAL_SUPPLY) return 0;

  let remaining = solLamports;
  let supply = currentCirculating;
  let tokens = 0;
  const step = 100; // tokens per step

  while (remaining > 0 && supply < TOTAL_SUPPLY) {
    const price = calculatePrice(supply);
    if (price <= 0) {
      supply += step;
      tokens += step;
      continue;
    }
    const batchCost = price * step;
    if (batchCost <= remaining) {
      remaining -= batchCost;
      supply += step;
      tokens += step;
    } else {
      // partial
      const partial = Math.floor(remaining / price);
      tokens += partial;
      break;
    }
  }
  return tokens;
}

/* ------------------------------------------------------------------ */
/*  Estimate SOL out for selling tokens                                */
/* ------------------------------------------------------------------ */

function estimateSolOut(
  currentCirculating: number,
  tokenAmount: number
): number {
  if (tokenAmount <= 0 || currentCirculating <= 0) return 0;

  let lamports = 0;
  let supply = currentCirculating;
  let remaining = tokenAmount;
  const step = 100;

  while (remaining > 0 && supply > 0) {
    const batch = Math.min(step, remaining, supply);
    const price = calculatePrice(supply - batch);
    lamports += price * batch;
    supply -= batch;
    remaining -= batch;
  }
  return lamports;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function MarketDetailPage() {
  const params = useParams();
  const marketPubkey = params.id as string;
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const anchorWallet = useAnchorWallet();

  /* ---- state ---- */
  const [market, setMarket] = useState<MarketAccount | null>(null);
  const [sideA, setSideA] = useState<SideAccount | null>(null);
  const [sideB, setSideB] = useState<SideAccount | null>(null);
  const [reserveA, setReserveA] = useState(0);
  const [reserveB, setReserveB] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedSide, setSelectedSide] = useState<0 | 1>(0);
  const [amount, setAmount] = useState("");
  const [sellAmount, setSellAmount] = useState("");
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [userBalanceA, setUserBalanceA] = useState(0);
  const [userBalanceB, setUserBalanceB] = useState(0);
  const [countdown, setCountdown] = useState("");
  const [infoOpen, setInfoOpen] = useState(false);

  /* ---- derived ---- */
  const phase: MarketPhase | null = market ? getMarketPhase(market) : null;
  const totalReserve = reserveA + reserveB;
  const pctA = totalReserve > 0 ? (reserveA / totalReserve) * 100 : 50;
  const pctB = 100 - pctA;
  const circulatingA = sideA ? sideA.circulatingSupply.toNumber() : 0;
  const circulatingB = sideB ? sideB.circulatingSupply.toNumber() : 0;

  const sideALabel = sideA
    ? shortenAddress(sideA.tokenMint.toBase58())
    : "SIDE A";
  const sideBLabel = sideB
    ? shortenAddress(sideB.tokenMint.toBase58())
    : "SIDE B";

  /* ---- estimated output ---- */
  const estimatedTokens = useMemo(() => {
    const sol = parseFloat(amount);
    if (isNaN(sol) || sol <= 0) return 0;
    const lamports = Math.floor(sol * LAMPORTS_PER_SOL);
    const circ = selectedSide === 0 ? circulatingA : circulatingB;
    return estimateTokensOut(circ, lamports);
  }, [amount, selectedSide, circulatingA, circulatingB]);

  const estimatedSol = useMemo(() => {
    const tokens = parseFloat(sellAmount);
    if (isNaN(tokens) || tokens <= 0) return 0;
    const circ = selectedSide === 0 ? circulatingA : circulatingB;
    return estimateSolOut(circ, Math.floor(tokens));
  }, [sellAmount, selectedSide, circulatingA, circulatingB]);

  /* ---- SVG chart data ---- */
  const curveData = useMemo(() => {
    const pts = buildCurvePoints(CHART_SUPPLY_MAX, CHART_POINTS);
    const yMax = pts.length > 0 ? pts[pts.length - 1].y * 1.1 : 1;
    return { pts, yMax };
  }, []);

  /* ---- fetch ---- */
  const fetchData = useCallback(async () => {
    try {
      const program = getReadonlyProgram();
      const mk = new PublicKey(marketPubkey);
      const marketData = await program.account.market.fetch(mk);
      setMarket(marketData);

      const sA = await program.account.side.fetch(marketData.sideA);
      const sB = await program.account.side.fetch(marketData.sideB);
      setSideA(sA);
      setSideB(sB);

      try {
        const vA = await connection.getTokenAccountBalance(
          sA.quoteReserveVault
        );
        const vB = await connection.getTokenAccountBalance(
          sB.quoteReserveVault
        );
        setReserveA(Number(vA.value.amount));
        setReserveB(Number(vB.value.amount));
      } catch {
        /* vaults may not exist yet */
      }

      if (publicKey) {
        try {
          const ataA = await getAssociatedTokenAddress(
            sA.tokenMint,
            publicKey
          );
          const accA = await getAccount(connection, ataA);
          setUserBalanceA(Number(accA.amount));
        } catch {
          setUserBalanceA(0);
        }
        try {
          const ataB = await getAssociatedTokenAddress(
            sB.tokenMint,
            publicKey
          );
          const accB = await getAccount(connection, ataB);
          setUserBalanceB(Number(accB.amount));
        } catch {
          setUserBalanceB(0);
        }
      }
    } catch (err) {
      console.error("Fetch error:", err);
    }
    setLoading(false);
  }, [marketPubkey, connection, publicKey]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Refresh reserves every 5s
  useEffect(() => {
    const id = setInterval(fetchData, 5000);
    return () => clearInterval(id);
  }, [fetchData]);

  // Countdown every 1s
  useEffect(() => {
    if (!market) return;
    const tick = () =>
      setCountdown(formatCountdown(market.deadline.toNumber()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [market]);

  /* ---- buy handler ---- */
  async function handleBuy() {
    if (!anchorWallet || !market || !sideA || !sideB) return;
    const solAmount = parseFloat(amount);
    if (isNaN(solAmount) || solAmount <= 0) return;

    setTxStatus("Preparing transaction...");
    try {
      const provider = new AnchorProvider(connection, anchorWallet, {
        commitment: "confirmed",
      });
      const program = getProgram(provider);
      const mk = new PublicKey(marketPubkey);
      const side = selectedSide === 0 ? sideA : sideB;
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

      const tokenMint = side.tokenMint;
      const buyerAta = await getAssociatedTokenAddress(
        tokenMint,
        anchorWallet.publicKey
      );
      try {
        await getAccount(connection, buyerAta);
      } catch {
        tx.add(
          createAssociatedTokenAccountInstruction(
            anchorWallet.publicKey,
            buyerAta,
            anchorWallet.publicKey,
            tokenMint
          )
        );
      }

      const buyIx = await program.methods
        .buyTokens(selectedSide, new BN(lamports), new BN(1))
        .accounts({
          buyer: anchorWallet.publicKey,
          market: mk,
          sideAccount: selectedSide === 0 ? market.sideA : market.sideB,
          tokenMint,
          tokenVault: side.tokenReserveVault,
          buyerTokenAccount: buyerAta,
          quoteMint: NATIVE_MINT,
          quoteVault: side.quoteReserveVault,
          buyerQuoteAccount: wsolAta,
          config: findConfigPda(),
          tokenProgram: TOKEN_PROGRAM_ID,
          quoteTokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction();
      tx.add(buyIx);

      setTxStatus("Awaiting wallet approval...");
      const sig = await provider.sendAndConfirm(tx);
      setTxStatus(`Success -- ${sig.slice(0, 8)}...`);
      setAmount("");
      setTimeout(fetchData, 2000);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message.slice(0, 80) : String(err);
      setTxStatus(`Failed -- ${msg}`);
    }
  }

  /* ---- sell handler ---- */
  async function handleSell() {
    if (!anchorWallet || !market || !sideA || !sideB) return;
    const tokenAmt = parseFloat(sellAmount);
    if (isNaN(tokenAmt) || tokenAmt <= 0) return;

    setTxStatus("Preparing sell...");
    try {
      const provider = new AnchorProvider(connection, anchorWallet, {
        commitment: "confirmed",
      });
      const program = getProgram(provider);
      const mk = new PublicKey(marketPubkey);
      const side = selectedSide === 0 ? sideA : sideB;
      const tokenMint = side.tokenMint;
      const sellerAta = await getAssociatedTokenAddress(
        tokenMint,
        anchorWallet.publicKey
      );
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

      const sellBn = new BN(Math.floor(tokenAmt));

      let sellIx;
      if (phase === "resolved") {
        sellIx = await program.methods
          .sellPostResolution(selectedSide, sellBn, new BN(0))
          .accounts({
            seller: anchorWallet.publicKey,
            market: mk,
            sideAccount: selectedSide === 0 ? market.sideA : market.sideB,
            tokenMint,
            tokenVault: side.tokenReserveVault,
            sellerTokenAccount: sellerAta,
            quoteMint: NATIVE_MINT,
            quoteVault: side.quoteReserveVault,
            sellerQuoteAccount: wsolAta,
            config: findConfigPda(),
            tokenProgram: TOKEN_PROGRAM_ID,
            quoteTokenProgram: TOKEN_PROGRAM_ID,
          })
          .instruction();
      } else {
        sellIx = await program.methods
          .sellTokens(selectedSide, sellBn, new BN(1))
          .accounts({
            seller: anchorWallet.publicKey,
            market: mk,
            sideAccount: selectedSide === 0 ? market.sideA : market.sideB,
            tokenMint,
            tokenVault: side.tokenReserveVault,
            sellerTokenAccount: sellerAta,
            quoteMint: NATIVE_MINT,
            quoteVault: side.quoteReserveVault,
            sellerQuoteAccount: wsolAta,
            config: findConfigPda(),
            tokenProgram: TOKEN_PROGRAM_ID,
            quoteTokenProgram: TOKEN_PROGRAM_ID,
          })
          .instruction();
      }

      tx.add(sellIx);
      setTxStatus("Awaiting wallet approval...");
      const sig = await provider.sendAndConfirm(tx);
      setTxStatus(`Success -- ${sig.slice(0, 8)}...`);
      setSellAmount("");
      setTimeout(fetchData, 2000);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message.slice(0, 80) : String(err);
      setTxStatus(`Failed -- ${msg}`);
    }
  }

  /* ---- TWAP progress ---- */
  const twapProgress = useMemo(() => {
    if (!market) return null;
    const now = Math.floor(Date.now() / 1000);
    const deadline = market.deadline.toNumber();
    const window = market.twapWindow.toNumber();
    const interval = market.twapInterval.toNumber();
    const twapStart = deadline - window;
    if (now < twapStart) return null;
    const elapsed = Math.min(now - twapStart, window);
    const pct = (elapsed / window) * 100;
    const maxSamples = interval > 0 ? Math.floor(window / interval) : 0;
    const currentSamples = market.twapSamplesCount;
    return { pct, currentSamples, maxSamples };
  }, [market, countdown]); // countdown dep triggers re-calc each second

  /* ================================================================ */
  /*  RENDER                                                           */
  /* ================================================================ */

  if (loading) {
    return (
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "100px 24px" }}>
        <div
          className="skeleton"
          style={{ height: 40, marginBottom: 24, width: "60%" }}
        />
        <div className="skeleton" style={{ height: 80, marginBottom: 24 }} />
        <div className="skeleton" style={{ height: 12, marginBottom: 32 }} />
        <div className="skeleton" style={{ height: 300, marginBottom: 24 }} />
        <div className="skeleton" style={{ height: 240 }} />
      </div>
    );
  }

  if (!market) {
    return (
      <div
        style={{
          maxWidth: 720,
          margin: "0 auto",
          padding: "140px 24px",
          textAlign: "center",
        }}
      >
        <h2
          style={{
            fontFamily: "var(--font-heading)",
            marginBottom: 8,
          }}
        >
          Market not found
        </h2>
        <p style={{ color: TEXT_SECONDARY, marginBottom: 24 }}>
          Check the address and try again.
        </p>
        <Link
          href="/duels"
          style={{
            color: SIDE_A_COLOR,
            fontWeight: 600,
            fontSize: "0.85rem",
          }}
        >
          Back to Duels
        </Link>
      </div>
    );
  }

  const isResolved = phase === "resolved";
  const isTwap = phase === "twap";
  const winnerIndex = market.winner;
  const hasWinner = winnerIndex !== null && winnerIndex !== undefined;
  const sideColor = (idx: 0 | 1) =>
    idx === 0 ? SIDE_A_COLOR : SIDE_B_COLOR;

  /* SVG chart dimensions */
  const VIEW_W = 600;
  const VIEW_H = 300;
  const { pts: curvePts, yMax: chartYMax } = curveData;

  const linePath = pointsToPath(
    curvePts,
    CHART_SUPPLY_MAX,
    chartYMax,
    VIEW_W,
    VIEW_H
  );
  const areaPath = pointsToAreaPath(
    curvePts,
    CHART_SUPPLY_MAX,
    chartYMax,
    VIEW_W,
    VIEW_H
  );

  /* Current position dots */
  const dotA = {
    x: (circulatingA / CHART_SUPPLY_MAX) * VIEW_W,
    y:
      VIEW_H -
      (calculatePrice(circulatingA) / chartYMax) * VIEW_H,
  };
  const dotB = {
    x: (circulatingB / CHART_SUPPLY_MAX) * VIEW_W,
    y:
      VIEW_H -
      (calculatePrice(circulatingB) / chartYMax) * VIEW_H,
  };

  const userBal = selectedSide === 0 ? userBalanceA : userBalanceB;

  return (
    <div
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: "80px 24px 60px",
      }}
    >
      {/* ============================================================ */}
      {/*  1. HEADER BAR                                                */}
      {/* ============================================================ */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 28,
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Link
            href="/duels"
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
            aria-label="Back to duels"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
          </Link>

          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.8rem",
              color: TEXT_MUTED,
              letterSpacing: "0.02em",
            }}
          >
            {shortenAddress(marketPubkey, 6)}
          </span>

          {/* Phase badge */}
          <span
            style={{
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
                ? {
                    background: "rgba(64, 192, 128, 0.1)",
                    color: "#40C080",
                    border: "1px solid rgba(64, 192, 128, 0.2)",
                  }
                : phase === "twap"
                ? {
                    background: SIDE_B_DIM,
                    color: SIDE_B_COLOR,
                    border: `1px solid ${SIDE_B_BORDER}`,
                    animation: "pulse 2s ease-in-out infinite",
                  }
                : {
                    background: BG_SURFACE_2,
                    color: TEXT_MUTED,
                    border: `1px solid ${BORDER}`,
                  }),
            }}
          >
            {phase === "active"
              ? "ACTIVE"
              : phase === "twap"
              ? "TWAP"
              : "RESOLVED"}
          </span>
        </div>

        {/* Countdown */}
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "1rem",
            fontWeight: 600,
            color: isResolved ? TEXT_MUTED : TEXT_PRIMARY,
            letterSpacing: "0.02em",
          }}
        >
          {countdown}
        </span>
      </div>

      {/* ============================================================ */}
      {/*  2. VS SECTION                                                */}
      {/* ============================================================ */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          alignItems: "center",
          gap: 16,
          marginBottom: 28,
        }}
      >
        {/* Side A */}
        <div style={{ textAlign: "center" }}>
          <h2
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: "1.6rem",
              fontWeight: 800,
              color: SIDE_A_COLOR,
              lineHeight: 1.2,
              textDecoration:
                hasWinner && winnerIndex !== 0 ? "line-through" : "none",
              opacity: hasWinner && winnerIndex !== 0 ? 0.4 : 1,
            }}
          >
            {sideALabel}
          </h2>
          {hasWinner && winnerIndex === 0 && (
            <span
              style={{
                display: "inline-block",
                marginTop: 4,
                padding: "2px 8px",
                background: SIDE_A_DIM,
                border: `1px solid ${SIDE_A_BORDER}`,
                borderRadius: RADIUS,
                fontFamily: "var(--font-heading)",
                fontSize: "0.65rem",
                fontWeight: 700,
                color: SIDE_A_COLOR,
                textTransform: "uppercase" as const,
                letterSpacing: "0.1em",
              }}
            >
              W
            </span>
          )}
          {hasWinner && winnerIndex !== 0 && (
            <span
              style={{
                display: "inline-block",
                marginTop: 4,
                fontSize: "0.65rem",
                color: TEXT_MUTED,
                textTransform: "uppercase" as const,
                letterSpacing: "0.08em",
              }}
            >
              [DEFEATED]
            </span>
          )}
        </div>

        {/* VS */}
        <span
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: "1rem",
            fontWeight: 800,
            color: TEXT_MUTED,
            letterSpacing: "0.05em",
          }}
        >
          vs
        </span>

        {/* Side B */}
        <div style={{ textAlign: "center" }}>
          <h2
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: "1.6rem",
              fontWeight: 800,
              color: SIDE_B_COLOR,
              lineHeight: 1.2,
              textDecoration:
                hasWinner && winnerIndex !== 1 ? "line-through" : "none",
              opacity: hasWinner && winnerIndex !== 1 ? 0.4 : 1,
            }}
          >
            {sideBLabel}
          </h2>
          {hasWinner && winnerIndex === 1 && (
            <span
              style={{
                display: "inline-block",
                marginTop: 4,
                padding: "2px 8px",
                background: SIDE_B_DIM,
                border: `1px solid ${SIDE_B_BORDER}`,
                borderRadius: RADIUS,
                fontFamily: "var(--font-heading)",
                fontSize: "0.65rem",
                fontWeight: 700,
                color: SIDE_B_COLOR,
                textTransform: "uppercase" as const,
                letterSpacing: "0.1em",
              }}
            >
              W
            </span>
          )}
          {hasWinner && winnerIndex !== 1 && (
            <span
              style={{
                display: "inline-block",
                marginTop: 4,
                fontSize: "0.65rem",
                color: TEXT_MUTED,
                textTransform: "uppercase" as const,
                letterSpacing: "0.08em",
              }}
            >
              [DEFEATED]
            </span>
          )}
        </div>
      </div>

      {/* ============================================================ */}
      {/*  3. CONFLICT BAR                                              */}
      {/* ============================================================ */}
      <div style={{ marginBottom: 32 }}>
        <div
          style={{
            display: "flex",
            height: 12,
            overflow: "hidden",
            background: BG_SURFACE_3,
            borderRadius: 0,
          }}
        >
          <div
            style={{
              width: `${pctA}%`,
              background: SIDE_A_COLOR,
              transition: "width 0.5s ease",
            }}
          />
          <div
            style={{
              width: `${pctB}%`,
              background: SIDE_B_COLOR,
              transition: "width 0.5s ease",
            }}
          />
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 6,
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.8rem",
              fontWeight: 600,
              color: SIDE_A_COLOR,
            }}
          >
            {formatSol(reserveA)} SOL
          </span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.8rem",
              fontWeight: 600,
              color: SIDE_B_COLOR,
            }}
          >
            {formatSol(reserveB)} SOL
          </span>
        </div>
      </div>

      {/* ============================================================ */}
      {/*  4. BONDING CURVE CHART                                       */}
      {/* ============================================================ */}
      <div
        style={{
          marginBottom: 32,
          background: BG_SURFACE,
          border: `1px solid ${BORDER}`,
          borderRadius: RADIUS,
          padding: "20px 16px 12px",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: "0.7rem",
            fontWeight: 600,
            color: TEXT_MUTED,
            textTransform: "uppercase" as const,
            letterSpacing: "0.1em",
            marginBottom: 12,
          }}
        >
          Bonding Curve
        </div>
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          style={{
            width: "100%",
            maxWidth: 600,
            height: "auto",
            display: "block",
          }}
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Grid lines */}
          {[0.25, 0.5, 0.75].map((f) => (
            <line
              key={f}
              x1={0}
              y1={VIEW_H * f}
              x2={VIEW_W}
              y2={VIEW_H * f}
              stroke={BORDER}
              strokeWidth="1"
            />
          ))}

          {/* Area fills */}
          <path d={areaPath} fill={SIDE_A_COLOR} opacity="0.06" />
          <path d={areaPath} fill={SIDE_B_COLOR} opacity="0.04" />

          {/* Curve lines */}
          <path
            d={linePath}
            fill="none"
            stroke={SIDE_A_COLOR}
            strokeWidth="2"
            opacity="0.8"
          />
          <path
            d={linePath}
            fill="none"
            stroke={SIDE_B_COLOR}
            strokeWidth="2"
            opacity="0.5"
            strokeDasharray="6 4"
          />

          {/* Dot A */}
          {circulatingA > 0 && dotA.x <= VIEW_W && (
            <>
              <line
                x1={dotA.x}
                y1={dotA.y}
                x2={dotA.x}
                y2={VIEW_H}
                stroke={SIDE_A_COLOR}
                strokeWidth="1"
                opacity="0.2"
                strokeDasharray="3 3"
              />
              <circle
                cx={dotA.x}
                cy={dotA.y}
                r="5"
                fill={SIDE_A_COLOR}
                stroke="#08080C"
                strokeWidth="2"
              />
            </>
          )}

          {/* Dot B */}
          {circulatingB > 0 && dotB.x <= VIEW_W && (
            <>
              <line
                x1={dotB.x}
                y1={dotB.y}
                x2={dotB.x}
                y2={VIEW_H}
                stroke={SIDE_B_COLOR}
                strokeWidth="1"
                opacity="0.2"
                strokeDasharray="3 3"
              />
              <circle
                cx={dotB.x}
                cy={dotB.y}
                r="5"
                fill={SIDE_B_COLOR}
                stroke="#08080C"
                strokeWidth="2"
              />
            </>
          )}
        </svg>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 8,
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.7rem",
              color: SIDE_A_COLOR,
            }}
          >
            {formatTokens(circulatingA)} circ
          </span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.7rem",
              color: SIDE_B_COLOR,
            }}
          >
            {formatTokens(circulatingB)} circ
          </span>
        </div>
      </div>

      {/* ============================================================ */}
      {/*  5. TRADE PANEL                                               */}
      {/* ============================================================ */}
      <div
        style={{
          background: BG_SURFACE,
          border: `1px solid ${BORDER}`,
          borderRadius: RADIUS,
          padding: 24,
          marginBottom: 24,
        }}
      >
        {isResolved && hasWinner ? (
          /* Resolved banner */
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div
              style={{
                fontFamily: "var(--font-heading)",
                fontSize: "1.1rem",
                fontWeight: 700,
                color: sideColor(winnerIndex as 0 | 1),
                marginBottom: 8,
              }}
            >
              Market Resolved
            </div>
            <div
              style={{
                fontSize: "0.85rem",
                color: TEXT_SECONDARY,
                marginBottom: 20,
              }}
            >
              Winner:{" "}
              <span
                style={{
                  fontWeight: 700,
                  color: sideColor(winnerIndex as 0 | 1),
                }}
              >
                Side {winnerIndex === 0 ? "A" : "B"}
              </span>
              . Sell tokens below to exit.
            </div>

            {/* Sell section for resolved market */}
            {publicKey ? (
              <>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 8,
                    marginBottom: 16,
                  }}
                >
                  <button
                    onClick={() => setSelectedSide(0)}
                    style={{
                      padding: "10px 16px",
                      background:
                        selectedSide === 0 ? SIDE_A_COLOR : "transparent",
                      color:
                        selectedSide === 0 ? "#fff" : SIDE_A_COLOR,
                      border: `1px solid ${SIDE_A_BORDER}`,
                      borderRadius: RADIUS,
                      fontFamily: "var(--font-heading)",
                      fontSize: "0.8rem",
                      fontWeight: 600,
                      textTransform: "uppercase" as const,
                      letterSpacing: "0.05em",
                      cursor: "pointer",
                    }}
                  >
                    Side A
                  </button>
                  <button
                    onClick={() => setSelectedSide(1)}
                    style={{
                      padding: "10px 16px",
                      background:
                        selectedSide === 1 ? SIDE_B_COLOR : "transparent",
                      color:
                        selectedSide === 1 ? "#08080C" : SIDE_B_COLOR,
                      border: `1px solid ${SIDE_B_BORDER}`,
                      borderRadius: RADIUS,
                      fontFamily: "var(--font-heading)",
                      fontSize: "0.8rem",
                      fontWeight: 600,
                      textTransform: "uppercase" as const,
                      letterSpacing: "0.05em",
                      cursor: "pointer",
                    }}
                  >
                    Side B
                  </button>
                </div>

                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: 8,
                    fontSize: "0.75rem",
                    color: TEXT_SECONDARY,
                  }}
                >
                  <span>Your tokens:</span>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontWeight: 600,
                    }}
                  >
                    {userBal.toLocaleString()}
                  </span>
                </div>

                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                    marginBottom: 12,
                  }}
                >
                  <div style={{ position: "relative", flex: 1 }}>
                    <input
                      type="number"
                      placeholder="0"
                      value={sellAmount}
                      onChange={(e) => setSellAmount(e.target.value)}
                      style={{
                        width: "100%",
                        padding: "12px 60px 12px 16px",
                        background: BG_SURFACE_2,
                        border: `1px solid ${BORDER}`,
                        borderRadius: RADIUS,
                        color: TEXT_PRIMARY,
                        fontFamily: "var(--font-mono)",
                        fontSize: "0.9rem",
                        outline: "none",
                      }}
                    />
                    <span
                      style={{
                        position: "absolute",
                        right: 14,
                        top: "50%",
                        transform: "translateY(-50%)",
                        fontSize: "0.75rem",
                        color: TEXT_MUTED,
                        fontFamily: "var(--font-mono)",
                      }}
                    >
                      TOKENS
                    </span>
                  </div>
                  <button
                    onClick={() =>
                      setSellAmount(String(userBal))
                    }
                    style={{
                      padding: "12px 14px",
                      background: BG_SURFACE_2,
                      border: `1px solid ${BORDER_HOVER}`,
                      borderRadius: RADIUS,
                      color: TEXT_SECONDARY,
                      fontFamily: "var(--font-heading)",
                      fontSize: "0.7rem",
                      fontWeight: 600,
                      textTransform: "uppercase" as const,
                      letterSpacing: "0.05em",
                      cursor: "pointer",
                      whiteSpace: "nowrap" as const,
                    }}
                  >
                    MAX
                  </button>
                </div>

                {parseFloat(sellAmount) > 0 && (
                  <div
                    style={{
                      marginBottom: 12,
                      fontSize: "0.8rem",
                      color: TEXT_SECONDARY,
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    Est. output: ~{formatSol(estimatedSol)} SOL
                  </div>
                )}

                <button
                  onClick={handleSell}
                  disabled={!anchorWallet}
                  style={{
                    width: "100%",
                    padding: "14px 24px",
                    background: sideColor(selectedSide),
                    color: selectedSide === 1 ? "#08080C" : "#fff",
                    border: "none",
                    borderRadius: RADIUS,
                    fontFamily: "var(--font-heading)",
                    fontSize: "0.85rem",
                    fontWeight: 600,
                    textTransform: "uppercase" as const,
                    letterSpacing: "0.05em",
                    cursor: "pointer",
                    opacity: !anchorWallet ? 0.35 : 1,
                  }}
                >
                  SELL
                </button>
              </>
            ) : (
              <p
                style={{
                  fontSize: "0.85rem",
                  color: TEXT_MUTED,
                }}
              >
                Connect wallet to sell
              </p>
            )}
          </div>
        ) : (
          /* Active / TWAP trading */
          <>
            {/* Side selector */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 8,
                marginBottom: 20,
              }}
            >
              <button
                onClick={() => setSelectedSide(0)}
                style={{
                  padding: "12px 16px",
                  background:
                    selectedSide === 0 ? SIDE_A_COLOR : "transparent",
                  color: selectedSide === 0 ? "#fff" : SIDE_A_COLOR,
                  border: `1px solid ${
                    selectedSide === 0 ? SIDE_A_COLOR : SIDE_A_BORDER
                  }`,
                  borderRadius: RADIUS,
                  fontFamily: "var(--font-heading)",
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  textTransform: "uppercase" as const,
                  letterSpacing: "0.05em",
                  cursor: "pointer",
                }}
              >
                Back Side A
              </button>
              <button
                onClick={() => setSelectedSide(1)}
                style={{
                  padding: "12px 16px",
                  background:
                    selectedSide === 1 ? SIDE_B_COLOR : "transparent",
                  color: selectedSide === 1 ? "#08080C" : SIDE_B_COLOR,
                  border: `1px solid ${
                    selectedSide === 1 ? SIDE_B_COLOR : SIDE_B_BORDER
                  }`,
                  borderRadius: RADIUS,
                  fontFamily: "var(--font-heading)",
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  textTransform: "uppercase" as const,
                  letterSpacing: "0.05em",
                  cursor: "pointer",
                }}
              >
                Back Side B
              </button>
            </div>

            {/* BUY section */}
            <div
              style={{
                fontFamily: "var(--font-heading)",
                fontSize: "0.7rem",
                fontWeight: 600,
                color: TEXT_MUTED,
                textTransform: "uppercase" as const,
                letterSpacing: "0.1em",
                marginBottom: 8,
              }}
            >
              Buy
            </div>

            {/* Amount input */}
            <div style={{ position: "relative", marginBottom: 8 }}>
              <input
                type="number"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                step="0.01"
                min="0"
                style={{
                  width: "100%",
                  padding: "12px 50px 12px 16px",
                  background: BG_SURFACE_2,
                  border: `1px solid ${BORDER}`,
                  borderRadius: RADIUS,
                  color: TEXT_PRIMARY,
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.9rem",
                  outline: "none",
                }}
              />
              <span
                style={{
                  position: "absolute",
                  right: 14,
                  top: "50%",
                  transform: "translateY(-50%)",
                  fontSize: "0.75rem",
                  color: TEXT_MUTED,
                  fontFamily: "var(--font-mono)",
                }}
              >
                SOL
              </span>
            </div>

            {/* Quick amount buttons */}
            <div
              style={{
                display: "flex",
                gap: 6,
                marginBottom: 12,
              }}
            >
              {[0.1, 0.5, 1, 5].map((a) => (
                <button
                  key={a}
                  onClick={() => setAmount(String(a))}
                  style={{
                    flex: 1,
                    padding: "8px 0",
                    background: "transparent",
                    border: `1px solid ${BORDER_HOVER}`,
                    borderRadius: RADIUS,
                    color: TEXT_SECONDARY,
                    fontFamily: "var(--font-mono)",
                    fontSize: "0.75rem",
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  {a}
                </button>
              ))}
            </div>

            {/* Estimated tokens */}
            {estimatedTokens > 0 && (
              <div
                style={{
                  marginBottom: 12,
                  fontSize: "0.8rem",
                  color: TEXT_SECONDARY,
                  fontFamily: "var(--font-mono)",
                }}
              >
                Est. tokens: ~{formatTokens(estimatedTokens)}
              </div>
            )}

            {/* Buy button */}
            <button
              onClick={handleBuy}
              disabled={!anchorWallet || isResolved}
              style={{
                width: "100%",
                padding: "14px 24px",
                background: sideColor(selectedSide),
                color: selectedSide === 1 ? "#08080C" : "#fff",
                border: "none",
                borderRadius: RADIUS,
                fontFamily: "var(--font-heading)",
                fontSize: "0.85rem",
                fontWeight: 600,
                textTransform: "uppercase" as const,
                letterSpacing: "0.05em",
                cursor: "pointer",
                opacity: !anchorWallet || isResolved ? 0.35 : 1,
                marginBottom: 24,
              }}
            >
              BUY
            </button>

            {/* SELL section (only if user has tokens) */}
            {publicKey && userBal > 0 && (
              <>
                <div
                  style={{
                    borderTop: `1px solid ${BORDER}`,
                    paddingTop: 20,
                    marginBottom: 8,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 8,
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--font-heading)",
                        fontSize: "0.7rem",
                        fontWeight: 600,
                        color: TEXT_MUTED,
                        textTransform: "uppercase" as const,
                        letterSpacing: "0.1em",
                      }}
                    >
                      Sell
                    </span>
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: "0.75rem",
                        color: TEXT_SECONDARY,
                      }}
                    >
                      Balance: {userBal.toLocaleString()}
                    </span>
                  </div>
                </div>

                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                    marginBottom: 8,
                  }}
                >
                  <div style={{ position: "relative", flex: 1 }}>
                    <input
                      type="number"
                      placeholder="0"
                      value={sellAmount}
                      onChange={(e) => setSellAmount(e.target.value)}
                      min="0"
                      style={{
                        width: "100%",
                        padding: "12px 60px 12px 16px",
                        background: BG_SURFACE_2,
                        border: `1px solid ${BORDER}`,
                        borderRadius: RADIUS,
                        color: TEXT_PRIMARY,
                        fontFamily: "var(--font-mono)",
                        fontSize: "0.9rem",
                        outline: "none",
                      }}
                    />
                    <span
                      style={{
                        position: "absolute",
                        right: 14,
                        top: "50%",
                        transform: "translateY(-50%)",
                        fontSize: "0.75rem",
                        color: TEXT_MUTED,
                        fontFamily: "var(--font-mono)",
                      }}
                    >
                      TOKENS
                    </span>
                  </div>
                  <button
                    onClick={() => setSellAmount(String(userBal))}
                    style={{
                      padding: "12px 14px",
                      background: BG_SURFACE_2,
                      border: `1px solid ${BORDER_HOVER}`,
                      borderRadius: RADIUS,
                      color: TEXT_SECONDARY,
                      fontFamily: "var(--font-heading)",
                      fontSize: "0.7rem",
                      fontWeight: 600,
                      textTransform: "uppercase" as const,
                      letterSpacing: "0.05em",
                      cursor: "pointer",
                      whiteSpace: "nowrap" as const,
                    }}
                  >
                    MAX
                  </button>
                </div>

                {parseFloat(sellAmount) > 0 && (
                  <div
                    style={{
                      marginBottom: 8,
                      fontSize: "0.8rem",
                      color: TEXT_SECONDARY,
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    Est. output: ~{formatSol(estimatedSol)} SOL
                  </div>
                )}

                <button
                  onClick={handleSell}
                  disabled={!anchorWallet}
                  style={{
                    width: "100%",
                    padding: "12px 24px",
                    background: "transparent",
                    color: TEXT_PRIMARY,
                    border: `1px solid ${BORDER_HOVER}`,
                    borderRadius: RADIUS,
                    fontFamily: "var(--font-heading)",
                    fontSize: "0.85rem",
                    fontWeight: 600,
                    textTransform: "uppercase" as const,
                    letterSpacing: "0.05em",
                    cursor: "pointer",
                    opacity: !anchorWallet ? 0.35 : 1,
                  }}
                >
                  SELL
                </button>
              </>
            )}

            {/* Not connected */}
            {!publicKey && (
              <p
                style={{
                  textAlign: "center",
                  fontSize: "0.8rem",
                  color: TEXT_MUTED,
                }}
              >
                Connect wallet to trade
              </p>
            )}
          </>
        )}

        {/* Transaction status */}
        {txStatus && (
          <div
            style={{
              marginTop: 16,
              padding: "10px 14px",
              background: BG_SURFACE_2,
              borderRadius: RADIUS,
              fontFamily: "var(--font-mono)",
              fontSize: "0.8rem",
              color: TEXT_SECONDARY,
            }}
          >
            {txStatus}
          </div>
        )}
      </div>

      {/* ============================================================ */}
      {/*  6. TWAP PROGRESS (during TWAP phase)                         */}
      {/* ============================================================ */}
      {isTwap && twapProgress && (
        <div
          style={{
            background: BG_SURFACE,
            border: `1px solid ${SIDE_B_BORDER}`,
            borderRadius: RADIUS,
            padding: 20,
            marginBottom: 24,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 12,
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-heading)",
                fontSize: "0.7rem",
                fontWeight: 600,
                color: SIDE_B_COLOR,
                textTransform: "uppercase" as const,
                letterSpacing: "0.1em",
              }}
            >
              TWAP Observation
            </span>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "0.75rem",
                color: TEXT_SECONDARY,
              }}
            >
              {twapProgress.currentSamples} / {twapProgress.maxSamples} samples
            </span>
          </div>
          <div
            style={{
              height: 6,
              background: BG_SURFACE_3,
              borderRadius: 0,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${Math.min(twapProgress.pct, 100)}%`,
                height: "100%",
                background: SIDE_B_COLOR,
                transition: "width 1s linear",
              }}
            />
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginTop: 8,
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "0.7rem",
                color: TEXT_MUTED,
              }}
            >
              {twapProgress.pct.toFixed(1)}% elapsed
            </span>
            {sideA && sideB && (
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.7rem",
                  color: TEXT_SECONDARY,
                }}
              >
                Accum A: {sideA.twapAccumulator.toNumber()} | B:{" "}
                {sideB.twapAccumulator.toNumber()}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/*  7. MARKET INFO                                               */}
      {/* ============================================================ */}
      <div
        style={{
          background: BG_SURFACE,
          border: `1px solid ${BORDER}`,
          borderRadius: RADIUS,
          overflow: "hidden",
        }}
      >
        <button
          onClick={() => setInfoOpen(!infoOpen)}
          style={{
            width: "100%",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "16px 20px",
            background: "transparent",
            border: "none",
            color: TEXT_PRIMARY,
            cursor: "pointer",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: "0.8rem",
              fontWeight: 700,
              textTransform: "uppercase" as const,
              letterSpacing: "0.06em",
            }}
          >
            Market Info
          </span>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              color: TEXT_MUTED,
              transform: infoOpen ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 0.2s ease",
            }}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {infoOpen && (
          <div style={{ padding: "0 20px 16px" }}>
            {(
              [
                [
                  "Deadline",
                  new Date(
                    market.deadline.toNumber() * 1000
                  ).toLocaleString(),
                ],
                [
                  "TWAP Window",
                  `${market.twapWindow.toNumber()}s (${(
                    market.twapWindow.toNumber() / 60
                  ).toFixed(0)} min)`,
                ],
                [
                  "TWAP Interval",
                  `${market.twapInterval.toNumber()}s`,
                ],
                [
                  "Total Supply / Side",
                  `${formatTokens(TOTAL_SUPPLY)}`,
                ],
                ["Trade Fee", "1%"],
                ["Phase", phase || "unknown"],
                ["TWAP Samples", String(market.twapSamplesCount)],
                [
                  "Circulating A",
                  circulatingA.toLocaleString(),
                ],
                [
                  "Circulating B",
                  circulatingB.toLocaleString(),
                ],
                ...(hasWinner
                  ? [
                      [
                        "Winner",
                        `Side ${winnerIndex === 0 ? "A" : "B"}`,
                      ],
                      [
                        "Final TWAP A",
                        String(market.finalTwapA.toNumber()),
                      ],
                      [
                        "Final TWAP B",
                        String(market.finalTwapB.toNumber()),
                      ],
                    ]
                  : []),
              ] as [string, string][]
            ).map(([label, value]) => (
              <div
                key={label}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "8px 0",
                  borderBottom: `1px solid ${BORDER}`,
                  fontSize: "0.8rem",
                }}
              >
                <span style={{ color: TEXT_MUTED }}>{label}</span>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontWeight: 600,
                    color: TEXT_SECONDARY,
                  }}
                >
                  {value}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ============================================================ */}
      {/*  Inline keyframes for TWAP badge pulse                        */}
      {/* ============================================================ */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @keyframes pulse {
              0%, 100% { opacity: 1; }
              50% { opacity: 0.5; }
            }
            input[type="number"]::-webkit-inner-spin-button,
            input[type="number"]::-webkit-outer-spin-button {
              -webkit-appearance: none;
              margin: 0;
            }
            input[type="number"] {
              -moz-appearance: textfield;
            }
            input:focus {
              border-color: var(--side-a) !important;
            }
          `,
        }}
      />
    </div>
  );
}
