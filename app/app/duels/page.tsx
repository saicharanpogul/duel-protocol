"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getReadonlyProgram, getMarketStatus, formatSol, formatCountdown, RPC_URL } from "../lib/program";

type MarketData = {
  publicKey: string;
  nameA: string;
  nameB: string;
  deadline: number;
  status: string;
  reserveA: number;
  reserveB: number;
  winner: number | null;
  symbolA: string;
  symbolB: string;
  battleTaxBps: number;
};

export default function DuelsPage() {
  const [markets, setMarkets] = useState<MarketData[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "active" | "resolved">("all");

  const fetchMarkets = useCallback(async () => {
    try {
      const program = getReadonlyProgram();
      const allMarkets = await program.account.market.all();
      const connection = new Connection(RPC_URL, "confirmed");

      const parsed: MarketData[] = await Promise.all(
        allMarkets.map(async (m: any) => {
          const market = m.account;
          let reserveA = 0, reserveB = 0;
          try {
            const sideA = await program.account.side.fetch(market.sideA);
            const sideB = await program.account.side.fetch(market.sideB);
            const vaultA = await connection.getTokenAccountBalance(sideA.quoteReserveVault);
            const vaultB = await connection.getTokenAccountBalance(sideB.quoteReserveVault);
            reserveA = Number(vaultA.value.amount);
            reserveB = Number(vaultB.value.amount);
          } catch {}

          return {
            publicKey: m.publicKey.toBase58(),
            nameA: market.nameA,
            nameB: market.nameB,
            symbolA: market.symbolA,
            symbolB: market.symbolB,
            deadline: Number(market.deadline),
            status: getMarketStatus(market),
            reserveA,
            reserveB,
            winner: market.winner !== null && market.winner !== undefined ? market.winner : null,
            battleTaxBps: market.battleTaxBps,
          };
        })
      );

      parsed.sort((a, b) => {
        if (a.status === "active" && b.status !== "active") return -1;
        if (a.status !== "active" && b.status === "active") return 1;
        return b.deadline - a.deadline;
      });

      setMarkets(parsed);
    } catch (err) {
      console.error("Failed to fetch markets:", err);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchMarkets(); }, [fetchMarkets]);

  const filtered = markets.filter((m) => {
    if (filter === "all") return true;
    if (filter === "active") return m.status === "active" || m.status === "twap";
    return m.status === "resolved";
  });

  return (
    <div className="page-container">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 32 }}>
        <h1 className="section-title" style={{ margin: 0 }}>⚔️ Active Duels</h1>
        <div style={{ display: "flex", gap: 8 }}>
          {(["all", "active", "resolved"] as const).map((f) => (
            <button
              key={f}
              className={`btn btn-sm ${filter === f ? "btn-accent" : "btn-ghost"}`}
              onClick={() => setFilter(f)}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 20 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 200 }} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "80px 0" }}>
          <div style={{ fontSize: "3rem", marginBottom: 16 }}>🏜️</div>
          <h2 style={{ fontFamily: "var(--font-heading)", marginBottom: 8 }}>No duels yet</h2>
          <p style={{ color: "var(--text-secondary)", marginBottom: 24 }}>Be the first to create a duel and choose your side.</p>
          <Link href="/create" className="btn btn-accent">Create a Duel</Link>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 20 }}>
          {filtered.map((m, i) => (
            <Link
              key={m.publicKey}
              href={`/duels/${m.publicKey}`}
              className="card animate-fadeInUp"
              style={{ animationDelay: `${i * 0.05}s`, textDecoration: "none" }}
            >
              {/* Status Badge */}
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
                <span className={`pill-badge ${
                  m.status === "active" ? "pill-badge-active" :
                  m.status === "twap" ? "pill-badge-twap" : "pill-badge-resolved"
                }`}>
                  {m.status === "active" ? "⚡ Live" : m.status === "twap" ? "📊 TWAP" : "🏁 Resolved"}
                </span>
                <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                  {formatCountdown(m.deadline)}
                </span>
              </div>

              {/* VS Title */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                <span style={{ color: "var(--text-red)", fontWeight: 700, fontSize: "1.1rem", flex: 1, textAlign: "center" }}>
                  🔴 {m.nameA}
                </span>
                <span style={{ color: "var(--text-muted)", fontWeight: 800, fontSize: "0.8rem" }}>VS</span>
                <span style={{ color: "var(--text-blue)", fontWeight: 700, fontSize: "1.1rem", flex: 1, textAlign: "center" }}>
                  🔵 {m.nameB}
                </span>
              </div>

              {/* Sentiment Bar */}
              <div className="sentiment-bar" style={{ marginBottom: 12 }}>
                <div
                  className="sentiment-bar-red"
                  style={{ width: `${m.reserveA + m.reserveB > 0 ? (m.reserveA / (m.reserveA + m.reserveB)) * 100 : 50}%` }}
                />
                <div
                  className="sentiment-bar-blue"
                  style={{ width: `${m.reserveA + m.reserveB > 0 ? (m.reserveB / (m.reserveA + m.reserveB)) * 100 : 50}%` }}
                />
              </div>

              {/* Reserve Info */}
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                <span>{formatSol(m.reserveA)} SOL</span>
                <span style={{ color: "var(--text-muted)" }}>Battle Tax: {m.battleTaxBps / 100}%</span>
                <span>{formatSol(m.reserveB)} SOL</span>
              </div>

              {/* Winner indicator */}
              {m.winner !== null && (
                <div style={{
                  marginTop: 12,
                  padding: "8px 12px",
                  borderRadius: "var(--radius-md)",
                  background: m.winner === 0
                    ? "rgba(255, 45, 85, 0.1)"
                    : "rgba(0, 122, 255, 0.1)",
                  textAlign: "center",
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  color: m.winner === 0 ? "var(--text-red)" : "var(--text-blue)",
                }}>
                  {m.winner === 0 ? `🔴 ${m.nameA} Wins!` : `🔵 ${m.nameB} Wins!`}
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
