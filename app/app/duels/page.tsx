"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { supabase, hasSupabase } from "../lib/supabase";
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

/* ─── SVG Icons ─── */
const IconBolt = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
);
const IconBarChart = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>
);
const IconFlag = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
);
const IconTrophy = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>
);

/* ─── Fetch from Supabase ─── */
async function fetchFromSupabase(statusFilter: string): Promise<MarketData[] | null> {
  if (!hasSupabase || !supabase) return null;

  try {
    let query = supabase
      .from("markets")
      .select("pubkey, name_a, name_b, symbol_a, symbol_b, deadline, status, reserve_a, reserve_b, winner, battle_tax_bps")
      .order("created_at", { ascending: false });

    if (statusFilter === "active") {
      query = query.in("status", ["active", "twap"]);
    } else if (statusFilter === "resolved") {
      query = query.eq("status", "resolved");
    }

    const { data, error } = await query;
    if (error || !data) return null;

    return data.map((m: any) => ({
      publicKey: m.pubkey,
      nameA: m.name_a,
      nameB: m.name_b,
      symbolA: m.symbol_a,
      symbolB: m.symbol_b,
      deadline: m.deadline,
      status: m.status,
      reserveA: m.reserve_a,
      reserveB: m.reserve_b,
      winner: m.winner,
      battleTaxBps: m.battle_tax_bps,
    }));
  } catch {
    return null;
  }
}

/* ─── Fetch from Chain (fallback) ─── */
async function fetchFromChain(): Promise<MarketData[]> {
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

  return parsed;
}

export default function DuelsPage() {
  const [markets, setMarkets] = useState<MarketData[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "active" | "resolved">("all");
  const [source, setSource] = useState<"supabase" | "chain">("chain");

  const fetchMarkets = useCallback(async () => {
    setLoading(true);
    try {
      // Try Supabase first
      const sbData = await fetchFromSupabase(filter);
      if (sbData !== null) {
        setMarkets(sbData);
        setSource("supabase");
      } else {
        // Fallback to on-chain
        const chainData = await fetchFromChain();
        const filtered = chainData.filter((m) => {
          if (filter === "all") return true;
          if (filter === "active") return m.status === "active" || m.status === "twap";
          return m.status === "resolved";
        });
        setMarkets(filtered);
        setSource("chain");
      }
    } catch (err) {
      console.error("Failed to fetch markets:", err);
    }
    setLoading(false);
  }, [filter]);

  useEffect(() => { fetchMarkets(); }, [fetchMarkets]);

  return (
    <div className="page-container">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 32 }}>
        <div>
          <h1 className="section-title" style={{ margin: 0 }}>Active Duels</h1>
          <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
            via {source}
          </span>
        </div>
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
      ) : markets.length === 0 ? (
        <div style={{ textAlign: "center", padding: "80px 0" }}>
          <div style={{ fontSize: "3rem", marginBottom: 16, opacity: 0.3 }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><line x1="8" y1="15" x2="16" y2="15"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
          </div>
          <h2 style={{ fontFamily: "var(--font-heading)", marginBottom: 8 }}>No duels yet</h2>
          <p style={{ color: "var(--text-secondary)", marginBottom: 24 }}>Be the first to create a duel and choose your side.</p>
          <Link href="/create" className="btn btn-accent">Create a Duel</Link>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 20 }}>
          {markets.map((m, i) => (
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
                  {m.status === "active" ? <><IconBolt /> Live</> : m.status === "twap" ? <><IconBarChart /> TWAP</> : <><IconFlag /> Resolved</>}
                </span>
                <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                  {formatCountdown(m.deadline)}
                </span>
              </div>

              {/* VS Title */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                <span style={{ color: "var(--text-yellow)", fontWeight: 700, fontSize: "1.1rem", flex: 1, textAlign: "center" }}>
                  {m.nameA}
                </span>
                <span style={{ color: "var(--text-muted)", fontWeight: 800, fontSize: "0.75rem", letterSpacing: "0.08em" }}>VS</span>
                <span style={{ color: "var(--text-blue)", fontWeight: 700, fontSize: "1.1rem", flex: 1, textAlign: "center" }}>
                  {m.nameB}
                </span>
              </div>

              {/* Sentiment Bar */}
              <div className="sentiment-bar" style={{ marginBottom: 12 }}>
                <div
                  className="sentiment-bar-yellow"
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
                <span style={{ color: "var(--text-muted)" }}>Tax: {m.battleTaxBps / 100}%</span>
                <span>{formatSol(m.reserveB)} SOL</span>
              </div>

              {/* Winner indicator */}
              {m.winner !== null && (
                <div style={{
                  marginTop: 12,
                  padding: "8px 12px",
                  borderRadius: "var(--radius-md)",
                  background: m.winner === 0
                    ? "rgba(251, 191, 36, 0.08)"
                    : "rgba(59, 130, 246, 0.08)",
                  textAlign: "center",
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  color: m.winner === 0 ? "var(--text-yellow)" : "var(--text-blue)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                }}>
                  <IconTrophy />
                  {m.winner === 0 ? `${m.nameA} Wins` : `${m.nameB} Wins`}
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
