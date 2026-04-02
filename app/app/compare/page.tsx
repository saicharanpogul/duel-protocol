"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import {
  getReadonlyProgram,
  getComparePhase,
  getTokenSymbolFromMint,
  formatSol,
  formatCountdown,
  shortenAddress,
  type CompareDuelAccount,
  type ComparePhase,
} from "../lib/program";

type CompareDuelData = {
  publicKey: string;
  tokenAMint: string;
  tokenBMint: string;
  symbolA: string;
  symbolB: string;
  deadline: number;
  status: ComparePhase;
  sideATotal: number;
  sideBTotal: number;
  winner: number | null;
};

/* SVG Icons */

const IconBolt = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" style={{ display: "inline" }}>
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

const IconBarChart = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ display: "inline" }}>
    <line x1="12" y1="20" x2="12" y2="10" /><line x1="18" y1="20" x2="18" y2="4" /><line x1="6" y1="20" x2="6" y2="16" />
  </svg>
);

const IconFlag = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ display: "inline" }}>
    <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" y1="22" x2="4" y2="15" />
  </svg>
);

const IconTrophy = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "inline", verticalAlign: "middle" }}>
    <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
    <path d="M4 22h16" /><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
  </svg>
);

/* Fetch from chain */

async function fetchCompareDuels(): Promise<CompareDuelData[]> {
  const program = getReadonlyProgram();
  const allDuels = await program.account.compareDuel.all();

  const parsed: CompareDuelData[] = allDuels.map((d: { publicKey: { toBase58(): string }; account: CompareDuelAccount }) => {
    const duel = d.account;
    const mintA = duel.tokenAMint.toBase58();
    const mintB = duel.tokenBMint.toBase58();
    return {
      publicKey: d.publicKey.toBase58(),
      tokenAMint: mintA,
      tokenBMint: mintB,
      symbolA: getTokenSymbolFromMint(mintA) || shortenAddress(mintA),
      symbolB: getTokenSymbolFromMint(mintB) || shortenAddress(mintB),
      deadline: duel.deadline.toNumber(),
      status: getComparePhase(duel),
      sideATotal: duel.sideATotal.toNumber(),
      sideBTotal: duel.sideBTotal.toNumber(),
      winner: duel.winner !== null && duel.winner !== undefined ? duel.winner : null,
    };
  });

  parsed.sort((a, b) => {
    const order: Record<string, number> = { active: 0, twap: 1, resolved: 2 };
    const diff = (order[a.status] ?? 3) - (order[b.status] ?? 3);
    if (diff !== 0) return diff;
    return b.deadline - a.deadline;
  });

  return parsed;
}

/* Live countdown */

function LiveCountdown({ deadline }: { deadline: number }) {
  const [text, setText] = useState(() => formatCountdown(deadline));
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const tick = () => setText(formatCountdown(deadline));
    tick();
    ref.current = setInterval(tick, 1000);
    return () => { if (ref.current) clearInterval(ref.current); };
  }, [deadline]);

  return (
    <span style={{
      fontFamily: "var(--font-mono)",
      fontSize: "0.7rem",
      color: "var(--text-muted)",
      letterSpacing: "0.04em",
    }}>
      {text}
    </span>
  );
}

/* Compare duel card */

function CompareDuelCard({ duel }: { duel: CompareDuelData }) {
  const total = duel.sideATotal + duel.sideBTotal;
  const pctA = total > 0 ? (duel.sideATotal / total) * 100 : 50;
  const pctB = 100 - pctA;
  const isWinnerA = duel.winner === 0;
  const isWinnerB = duel.winner === 1;

  return (
    <Link
      href={`/compare/${duel.publicKey}`}
      className="card"
      style={{
        display: "block",
        textDecoration: "none",
        color: "inherit",
        borderRadius: "var(--radius-sm)",
      }}
    >
      {/* Top row: badge + countdown */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <span className={`badge ${
          duel.status === "active" ? "badge-active" :
          duel.status === "twap" ? "badge-twap" : "badge-resolved"
        }`}>
          {duel.status === "active" && <><IconBolt /> Active</>}
          {duel.status === "twap" && <><IconBarChart /> TWAP</>}
          {duel.status === "resolved" && <><IconFlag /> Resolved</>}
        </span>
        <LiveCountdown deadline={duel.deadline} />
      </div>

      {/* VS title */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        marginBottom: 18,
      }}>
        <span style={{
          color: "var(--side-a)",
          fontFamily: "var(--font-heading)",
          fontWeight: 700,
          fontSize: "1rem",
          flex: 1,
          textAlign: "right",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}>
          {isWinnerA && <IconTrophy />} ${duel.symbolA}
        </span>
        <span style={{
          color: "var(--text-muted)",
          fontWeight: 700,
          fontSize: "0.6rem",
          letterSpacing: "0.14em",
          flexShrink: 0,
          fontFamily: "var(--font-heading)",
          textTransform: "uppercase",
        }}>
          vs
        </span>
        <span style={{
          color: "var(--side-b)",
          fontFamily: "var(--font-heading)",
          fontWeight: 700,
          fontSize: "1rem",
          flex: 1,
          textAlign: "left",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}>
          ${duel.symbolB} {isWinnerB && <IconTrophy />}
        </span>
      </div>

      {/* Sentiment bar (deposit ratio) */}
      <div className="sentiment-bar" style={{ marginBottom: 10 }}>
        <div className="sentiment-bar-a" style={{ width: `${pctA}%` }} />
        <div className="sentiment-bar-b" style={{ width: `${pctB}%` }} />
      </div>

      {/* Deposit totals */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        fontSize: "0.7rem",
        fontFamily: "var(--font-mono)",
      }}>
        <span style={{ color: "var(--side-a)" }}>{formatSol(duel.sideATotal)} SOL</span>
        <span style={{ color: "var(--side-b)" }}>{formatSol(duel.sideBTotal)} SOL</span>
      </div>

      {/* Winner indicator */}
      {duel.winner !== null && (
        <div style={{
          marginTop: 14,
          padding: "6px 12px",
          borderRadius: "var(--radius-sm)",
          background: isWinnerA ? "var(--side-a-dim)" : "var(--side-b-dim)",
          border: `1px solid ${isWinnerA ? "var(--side-a-border)" : "var(--side-b-border)"}`,
          textAlign: "center",
          fontSize: "0.7rem",
          fontWeight: 700,
          fontFamily: "var(--font-heading)",
          color: isWinnerA ? "var(--side-a)" : "var(--side-b)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}>
          <IconTrophy />
          ${isWinnerA ? duel.symbolA : duel.symbolB} wins
        </div>
      )}
    </Link>
  );
}

/* Skeleton card */

function SkeletonCard() {
  return (
    <div className="card" style={{ borderRadius: "var(--radius-sm)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 18 }}>
        <div className="skeleton" style={{ width: 72, height: 22 }} />
        <div className="skeleton" style={{ width: 48, height: 16 }} />
      </div>
      <div style={{ display: "flex", justifyContent: "center", gap: 12, marginBottom: 18 }}>
        <div className="skeleton" style={{ width: 80, height: 18 }} />
        <div className="skeleton" style={{ width: 16, height: 18 }} />
        <div className="skeleton" style={{ width: 80, height: 18 }} />
      </div>
      <div className="skeleton" style={{ height: 6, marginBottom: 10 }} />
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <div className="skeleton" style={{ width: 64, height: 14 }} />
        <div className="skeleton" style={{ width: 64, height: 14 }} />
      </div>
    </div>
  );
}

/* Page */

export default function ComparePage() {
  const [duels, setDuels] = useState<CompareDuelData[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "active" | "resolved">("all");

  const fetchDuels = useCallback(async () => {
    setLoading(true);
    try {
      const all = await fetchCompareDuels();
      const filtered = all.filter((d) => {
        if (filter === "all") return true;
        if (filter === "active") return d.status === "active" || d.status === "twap";
        return d.status === "resolved";
      });
      setDuels(filtered);
    } catch (err) {
      console.error("Failed to fetch compare duels:", err);
    }
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    fetchDuels();
  }, [fetchDuels]);

  const filters = [
    { key: "all" as const, label: "All" },
    { key: "active" as const, label: "Active" },
    { key: "resolved" as const, label: "Resolved" },
  ];

  return (
    <div className="page-container">
      {/* Title + Create button */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 24,
        flexWrap: "wrap",
        gap: 12,
      }}>
        <h1 style={{
          fontFamily: "var(--font-heading)",
          fontSize: "1.75rem",
          fontWeight: 700,
          letterSpacing: "-0.02em",
          textTransform: "uppercase",
        }}>
          Compare Duels
        </h1>
        <Link href="/compare/create" className="btn btn-a btn-sm">
          New Compare Duel
        </Link>
      </div>

      {/* Filter row */}
      <div style={{
        display: "flex",
        gap: 0,
        marginBottom: 32,
        borderBottom: "1px solid var(--border)",
      }}>
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            style={{
              background: "none",
              border: "none",
              borderBottom: filter === f.key ? "2px solid var(--side-b)" : "2px solid transparent",
              cursor: "pointer",
              padding: "8px 0",
              marginRight: 28,
              fontFamily: "var(--font-body)",
              fontSize: "0.85rem",
              fontWeight: filter === f.key ? 600 : 400,
              color: filter === f.key ? "var(--text-primary)" : "var(--text-secondary)",
              transition: "color 0.15s, border-color 0.15s",
              letterSpacing: "0.02em",
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
          gap: 16,
        }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : duels.length === 0 ? (
        <div style={{ textAlign: "center", padding: "100px 0" }}>
          <div style={{
            width: 48,
            height: 48,
            borderRadius: "var(--radius-sm)",
            background: "var(--bg-surface)",
            border: "1px solid var(--border)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 20,
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5">
              <circle cx="12" cy="12" r="10" />
              <line x1="8" y1="15" x2="16" y2="15" />
              <line x1="9" y1="9" x2="9.01" y2="9" />
              <line x1="15" y1="9" x2="15.01" y2="9" />
            </svg>
          </div>
          <h2 style={{
            fontFamily: "var(--font-heading)",
            fontSize: "1rem",
            fontWeight: 600,
            marginBottom: 6,
            textTransform: "uppercase",
            letterSpacing: "-0.01em",
          }}>
            No compare duels yet
          </h2>
          <p style={{
            color: "var(--text-secondary)",
            fontSize: "0.85rem",
            marginBottom: 28,
          }}>
            Create one.
          </p>
          <Link href="/compare/create" className="btn btn-a">
            Create a Compare Duel
          </Link>
        </div>
      ) : (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
          gap: 16,
        }}>
          {duels.map((d) => (
            <CompareDuelCard key={d.publicKey} duel={d} />
          ))}
        </div>
      )}
    </div>
  );
}
