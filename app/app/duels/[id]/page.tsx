"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { AnchorProvider } from "@coral-xyz/anchor";
import {
  PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID, NATIVE_MINT, getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction, createSyncNativeInstruction,
  getAccount,
} from "@solana/spl-token";
import BN from "bn.js";
import {
  getProgram, getReadonlyProgram, findConfigPda,
  formatSol, formatCountdown, getMarketStatus,
} from "../../lib/program";
import { supabase, hasSupabase } from "../../lib/supabase";

/* ─── SVG Icons ─── */
const IconTrophy = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>
);
const IconBolt = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
);
const IconBarChart = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>
);
const IconFlag = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
);

export default function MarketDetailPage() {
  const params = useParams();
  const marketPubkey = params.id as string;
  const { connection } = useConnection();
  const wallet = useWallet();

  const [market, setMarket] = useState<any>(null);
  const [sideA, setSideA] = useState<any>(null);
  const [sideB, setSideB] = useState<any>(null);
  const [reserveA, setReserveA] = useState(0);
  const [reserveB, setReserveB] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedSide, setSelectedSide] = useState<0 | 1>(0);
  const [amount, setAmount] = useState("");
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [userBalanceA, setUserBalanceA] = useState(0);
  const [userBalanceB, setUserBalanceB] = useState(0);
  const [countdown, setCountdown] = useState("");
  const [trades, setTrades] = useState<any[]>([]);

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
        const vA = await connection.getTokenAccountBalance(sA.quoteReserveVault);
        const vB = await connection.getTokenAccountBalance(sB.quoteReserveVault);
        setReserveA(Number(vA.value.amount));
        setReserveB(Number(vB.value.amount));
      } catch {}

      if (wallet.publicKey) {
        try {
          const ataA = await getAssociatedTokenAddress(sA.tokenMint, wallet.publicKey);
          const accA = await getAccount(connection, ataA);
          setUserBalanceA(Number(accA.amount));
        } catch { setUserBalanceA(0); }
        try {
          const ataB = await getAssociatedTokenAddress(sB.tokenMint, wallet.publicKey);
          const accB = await getAccount(connection, ataB);
          setUserBalanceB(Number(accB.amount));
        } catch { setUserBalanceB(0); }
      }
    } catch (err) {
      console.error("Fetch error:", err);
    }
    setLoading(false);
  }, [marketPubkey, connection, wallet.publicKey]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Fetch trade history from Supabase
  useEffect(() => {
    if (!hasSupabase || !supabase) return;
    supabase
      .from("trades")
      .select("*")
      .eq("market_pubkey", marketPubkey)
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data }) => { if (data) setTrades(data); });
  }, [marketPubkey]);

  useEffect(() => {
    if (!market) return;
    const id = setInterval(() => {
      setCountdown(formatCountdown(Number(market.deadline)));
    }, 1000);
    return () => clearInterval(id);
  }, [market]);

  async function handleBuy() {
    if (!wallet.publicKey || !wallet.signTransaction || !market || !sideA || !sideB) return;
    const solAmount = parseFloat(amount);
    if (isNaN(solAmount) || solAmount <= 0) return;

    setTxStatus("Preparing transaction...");
    try {
      const provider = new AnchorProvider(connection, wallet as any, { commitment: "confirmed" });
      const program = getProgram(provider);
      const mk = new PublicKey(marketPubkey);
      const side = selectedSide === 0 ? sideA : sideB;
      const lamports = Math.floor(solAmount * LAMPORTS_PER_SOL);

      const wsolAta = await getAssociatedTokenAddress(NATIVE_MINT, wallet.publicKey);
      const tx = new Transaction();

      try { await getAccount(connection, wsolAta); } catch {
        tx.add(createAssociatedTokenAccountInstruction(wallet.publicKey, wsolAta, wallet.publicKey, NATIVE_MINT));
      }
      tx.add(
        SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: wsolAta, lamports }),
        createSyncNativeInstruction(wsolAta)
      );

      const tokenMint = side.tokenMint;
      const buyerAta = await getAssociatedTokenAddress(tokenMint, wallet.publicKey);
      try { await getAccount(connection, buyerAta); } catch {
        tx.add(createAssociatedTokenAccountInstruction(wallet.publicKey, buyerAta, wallet.publicKey, tokenMint));
      }

      const buyIx = await program.methods
        .buyTokens(selectedSide, new BN(lamports), new BN(1))
        .accounts({
          buyer: wallet.publicKey,
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
      setTxStatus(`Success — ${sig.slice(0, 8)}...`);
      setAmount("");
      setTimeout(fetchData, 2000);
    } catch (err: any) {
      setTxStatus(`Failed — ${err.message?.slice(0, 80)}`);
    }
  }

  async function handleSell() {
    if (!wallet.publicKey || !wallet.signTransaction || !market || !sideA || !sideB) return;
    const tokenAmt = parseFloat(amount);
    if (isNaN(tokenAmt) || tokenAmt <= 0) return;

    setTxStatus("Preparing sell...");
    try {
      const provider = new AnchorProvider(connection, wallet as any, { commitment: "confirmed" });
      const program = getProgram(provider);
      const mk = new PublicKey(marketPubkey);
      const side = selectedSide === 0 ? sideA : sideB;
      const tokenMint = side.tokenMint;
      const sellerAta = await getAssociatedTokenAddress(tokenMint, wallet.publicKey);
      const wsolAta = await getAssociatedTokenAddress(NATIVE_MINT, wallet.publicKey);

      const tx = new Transaction();
      try { await getAccount(connection, wsolAta); } catch {
        tx.add(createAssociatedTokenAccountInstruction(wallet.publicKey, wsolAta, wallet.publicKey, NATIVE_MINT));
      }

      const status = getMarketStatus(market);
      const sellAmount = new BN(Math.floor(tokenAmt));

      let sellIx;
      if (status === "resolved") {
        sellIx = await program.methods
          .sellPostResolution(selectedSide, sellAmount, new BN(0))
          .accounts({
            seller: wallet.publicKey,
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
          .sellTokens(selectedSide, sellAmount, new BN(1))
          .accounts({
            seller: wallet.publicKey,
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
      setTxStatus(`Success — ${sig.slice(0, 8)}...`);
      setAmount("");
      setTimeout(fetchData, 2000);
    } catch (err: any) {
      setTxStatus(`Failed — ${err.message?.slice(0, 80)}`);
    }
  }

  if (loading) {
    return (
      <div className="page-container">
        <div className="skeleton" style={{ height: 400, marginBottom: 24 }} />
        <div className="skeleton" style={{ height: 200 }} />
      </div>
    );
  }

  if (!market) {
    return (
      <div className="page-container" style={{ textAlign: "center", padding: "120px 0" }}>
        <h2>Market not found</h2>
        <p style={{ color: "var(--text-secondary)" }}>Check the URL and try again.</p>
      </div>
    );
  }

  const status = getMarketStatus(market);
  const totalReserve = reserveA + reserveB;
  const pctA = totalReserve > 0 ? (reserveA / totalReserve) * 100 : 50;
  const pctB = 100 - pctA;

  return (
    <div className="page-container">
      {/* ─── Header ─── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 32 }} className="animate-fadeInUp">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span className={`pill-badge ${status === "active" ? "pill-badge-active" : status === "twap" ? "pill-badge-twap" : "pill-badge-resolved"}`}>
            {status === "active" ? <><IconBolt /> Live</> : status === "twap" ? <><IconBarChart /> TWAP Active</> : <><IconFlag /> Resolved</>}
          </span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: "var(--text-muted)" }}>
            {countdown || formatCountdown(Number(market.deadline))}
          </span>
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: "var(--text-muted)" }}>
          {marketPubkey.slice(0, 6)}...{marketPubkey.slice(-4)}
        </div>
      </div>

      {/* ─── VS Header ─── */}
      <div className="animate-fadeInUp animate-delay-1" style={{
        display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 24,
        alignItems: "center", marginBottom: 32,
      }}>
        <div style={{ textAlign: "center" }}>
          <div style={{
            width: 48, height: 48, borderRadius: "50%", display: "inline-flex",
            alignItems: "center", justifyContent: "center", marginBottom: 12,
            background: "rgba(251, 191, 36, 0.1)", border: "1px solid rgba(251, 191, 36, 0.2)",
          }}>
            <span style={{ fontFamily: "var(--font-heading)", fontWeight: 900, color: "var(--text-yellow)", fontSize: "1.1rem" }}>A</span>
          </div>
          <h2 style={{ fontFamily: "var(--font-heading)", fontSize: "1.5rem", fontWeight: 800, color: "var(--text-yellow)" }}>
            {market.nameA}
          </h2>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: "var(--text-muted)" }}>
            ${market.symbolA}
          </div>
        </div>

        <div style={{
          fontFamily: "var(--font-heading)", fontSize: "1.5rem", fontWeight: 900,
          color: "var(--text-muted)", textShadow: "0 0 20px var(--accent-glow)",
        }}>
          VS
        </div>

        <div style={{ textAlign: "center" }}>
          <div style={{
            width: 48, height: 48, borderRadius: "50%", display: "inline-flex",
            alignItems: "center", justifyContent: "center", marginBottom: 12,
            background: "rgba(59, 130, 246, 0.1)", border: "1px solid rgba(59, 130, 246, 0.2)",
          }}>
            <span style={{ fontFamily: "var(--font-heading)", fontWeight: 900, color: "var(--text-blue)", fontSize: "1.1rem" }}>B</span>
          </div>
          <h2 style={{ fontFamily: "var(--font-heading)", fontSize: "1.5rem", fontWeight: 800, color: "var(--text-blue)" }}>
            {market.nameB}
          </h2>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: "var(--text-muted)" }}>
            ${market.symbolB}
          </div>
        </div>
      </div>

      {/* ─── Sentiment Bar ─── */}
      <div className="animate-fadeInUp animate-delay-2" style={{ marginBottom: 32 }}>
        <div className="sentiment-bar" style={{ height: 14, borderRadius: 7, marginBottom: 8 }}>
          <div className="sentiment-bar-yellow" style={{ width: `${pctA}%` }} />
          <div className="sentiment-bar-blue" style={{ width: `${pctB}%` }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem" }}>
          <span style={{ color: "var(--text-yellow)", fontWeight: 600 }}>{pctA.toFixed(1)}% · {formatSol(reserveA)} SOL</span>
          <span style={{ color: "var(--text-blue)", fontWeight: 600 }}>{formatSol(reserveB)} SOL · {pctB.toFixed(1)}%</span>
        </div>
      </div>

      {/* ─── Winner Banner ─── */}
      {market.winner !== null && market.winner !== undefined && (
        <div className="animate-fadeInUp" style={{
          padding: "20px 24px", borderRadius: "var(--radius-lg)", marginBottom: 32,
          background: market.winner === 0 ? "rgba(251, 191, 36, 0.08)" : "rgba(59, 130, 246, 0.08)",
          border: `1px solid ${market.winner === 0 ? "rgba(251, 191, 36, 0.2)" : "rgba(59, 130, 246, 0.2)"}`,
          textAlign: "center",
        }}>
          <div style={{ marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "center", color: market.winner === 0 ? "var(--text-yellow)" : "var(--text-blue)" }}>
            <IconTrophy />
          </div>
          <h3 style={{ fontFamily: "var(--font-heading)", fontWeight: 800, marginBottom: 4,
            color: market.winner === 0 ? "var(--text-yellow)" : "var(--text-blue)" }}>
            {market.winner === 0 ? market.nameA : market.nameB} Wins
          </h3>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>
            Battle tax has been redistributed to the winning side.
          </p>
        </div>
      )}

      {/* ─── Trade Panel ─── */}
      <div className="card animate-fadeInUp animate-delay-3" style={{ maxWidth: 500, margin: "0 auto" }}>
        <h3 style={{ fontFamily: "var(--font-heading)", fontSize: "1.1rem", fontWeight: 700, marginBottom: 20 }}>
          Trade
        </h3>

        {/* Side selector */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 20 }}>
          <button
            className={`btn ${selectedSide === 0 ? "btn-yellow" : "btn-ghost"}`}
            onClick={() => setSelectedSide(0)}
            style={{ width: "100%" }}
          >
            {market.nameA}
          </button>
          <button
            className={`btn ${selectedSide === 1 ? "btn-blue" : "btn-ghost"}`}
            onClick={() => setSelectedSide(1)}
            style={{ width: "100%" }}
          >
            {market.nameB}
          </button>
        </div>

        {/* User balance */}
        {wallet.publicKey && (
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12, fontSize: "0.8rem", color: "var(--text-secondary)" }}>
            <span>Your {selectedSide === 0 ? market.symbolA : market.symbolB} tokens:</span>
            <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>
              {(selectedSide === 0 ? userBalanceA : userBalanceB).toLocaleString()}
            </span>
          </div>
        )}

        {/* Amount input */}
        <input
          type="number"
          className="input"
          placeholder={status === "resolved" ? "Token amount to sell" : "SOL amount to buy"}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          step="0.01"
          min="0"
          style={{ marginBottom: 16 }}
        />

        {/* Quick amounts */}
        {status !== "resolved" && (
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            {[0.1, 0.5, 1, 5].map((a) => (
              <button key={a} className="btn btn-ghost btn-sm" onClick={() => setAmount(String(a))} style={{ flex: 1 }}>
                {a} SOL
              </button>
            ))}
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <button
            className={`btn ${selectedSide === 0 ? "btn-yellow" : "btn-blue"}`}
            onClick={handleBuy}
            disabled={!wallet.publicKey || status === "resolved"}
            style={{ width: "100%" }}
          >
            Buy {selectedSide === 0 ? market.symbolA : market.symbolB}
          </button>
          <button
            className="btn btn-ghost"
            onClick={handleSell}
            disabled={!wallet.publicKey}
            style={{ width: "100%" }}
          >
            Sell
          </button>
        </div>

        {/* Tx status */}
        {txStatus && (
          <div style={{
            marginTop: 16, padding: "10px 14px", borderRadius: "var(--radius-md)",
            background: "var(--bg-surface-2)", fontSize: "0.8rem",
            fontFamily: "var(--font-mono)", color: "var(--text-secondary)",
          }}>
            {txStatus}
          </div>
        )}

        {!wallet.publicKey && (
          <p style={{ textAlign: "center", marginTop: 16, fontSize: "0.8rem", color: "var(--text-muted)" }}>
            Connect wallet to trade
          </p>
        )}
      </div>

      {/* ─── Market Info ─── */}
      <div className="card animate-fadeInUp animate-delay-4" style={{ marginTop: 24 }}>
        <h3 style={{ fontFamily: "var(--font-heading)", fontSize: "1rem", fontWeight: 700, marginBottom: 16 }}>
          Market Details
        </h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
          {[
            ["Battle Tax", `${market.battleTaxBps / 100}%`],
            ["Protocol Fee", `${market.protocolFeeBps / 100}%`],
            ["Sell Penalty Max", `${market.sellPenaltyMaxBps / 100}%`],
            ["TWAP Window", `${Number(market.twapWindow)}s`],
            ["TWAP Interval", `${Number(market.twapInterval)}s`],
            ["TWAP Samples", `${market.twapSamplesCount}`],
            ["Circulating A", sideA ? sideA.circulatingSupply.toNumber().toLocaleString() : "—"],
            ["Circulating B", sideB ? sideB.circulatingSupply.toNumber().toLocaleString() : "—"],
          ].map(([label, value]) => (
            <div key={label as string} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
              <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{label}</span>
              <span style={{ fontSize: "0.8rem", fontFamily: "var(--font-mono)", fontWeight: 600 }}>{value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ─── Trade History ─── */}
      {trades.length > 0 && (
        <div className="card animate-fadeInUp" style={{ marginTop: 24 }}>
          <h3 style={{ fontFamily: "var(--font-heading)", fontSize: "1rem", fontWeight: 700, marginBottom: 16 }}>
            Recent Trades
          </h3>
          <div style={{ display: "grid", gap: 0 }}>
            <div style={{
              display: "grid", gridTemplateColumns: "60px 1fr 120px 80px",
              gap: 8, padding: "8px 0", borderBottom: "1px solid var(--border)",
              fontSize: "0.7rem", fontWeight: 600, color: "var(--text-muted)",
              textTransform: "uppercase", letterSpacing: "0.06em",
            }}>
              <span>Type</span>
              <span>Trader</span>
              <span style={{ textAlign: "right" }}>Amount</span>
              <span style={{ textAlign: "right" }}>Side</span>
            </div>
            {trades.map((t: any, i: number) => (
              <div key={t.id || i} style={{
                display: "grid", gridTemplateColumns: "60px 1fr 120px 80px",
                gap: 8, padding: "8px 0", borderBottom: "1px solid var(--border)",
                fontSize: "0.8rem",
              }}>
                <span style={{
                  color: t.trade_type === "buy" ? "var(--success)" : "#ef4444",
                  fontWeight: 600, textTransform: "uppercase", fontSize: "0.75rem",
                }}>
                  {t.trade_type}
                </span>
                <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
                  {t.trader?.slice(0, 4)}...{t.trader?.slice(-4)}
                </span>
                <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 600 }}>
                  {formatSol(t.sol_amount)} SOL
                </span>
                <span style={{
                  textAlign: "right", fontWeight: 600,
                  color: t.side === 0 ? "var(--text-yellow)" : "var(--text-blue)",
                }}>
                  {t.side === 0 ? market?.nameA : market?.nameB}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
