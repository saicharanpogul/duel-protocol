"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { AnchorProvider } from "@coral-xyz/anchor";
import {
  PublicKey, SystemProgram, LAMPORTS_PER_SOL, ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID, NATIVE_MINT, getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction, getAccount,
} from "@solana/spl-token";
import BN from "bn.js";
import { getProgram, findConfigPda, PROGRAM_ID } from "../lib/program";

const TOKEN_METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

function findMetadataPda(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), TOKEN_METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    TOKEN_METADATA_PROGRAM_ID
  );
  return pda;
}

/* ─── SVG Icons ─── */
const IconArrowLeft = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
);
const IconArrowRight = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
);
const IconBolt = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
);

export default function CreatePage() {
  const router = useRouter();
  const { connection } = useConnection();
  const wallet = useWallet();
  const [step, setStep] = useState(1);
  const [txStatus, setTxStatus] = useState<string | null>(null);

  // Step 1: Side names
  const [nameA, setNameA] = useState("");
  const [symbolA, setSymbolA] = useState("");
  const [nameB, setNameB] = useState("");
  const [symbolB, setSymbolB] = useState("");

  // Step 2: Parameters
  const [deadlineHours, setDeadlineHours] = useState("24");
  const [battleTaxPct, setBattleTaxPct] = useState("50");
  const [twapWindowMin, setTwapWindowMin] = useState("60");

  async function handleCreate() {
    if (!wallet.publicKey || !wallet.signTransaction) return;
    setTxStatus("Building transaction...");

    try {
      const provider = new AnchorProvider(connection, wallet as any, { commitment: "confirmed" });
      const program = getProgram(provider);

      const marketId = new BN(Date.now());
      const idBuf = Buffer.alloc(8);
      idBuf.writeBigUInt64LE(BigInt(marketId.toNumber()));

      const [market] = PublicKey.findProgramAddressSync(
        [Buffer.from("market"), wallet.publicKey.toBuffer(), idBuf], PROGRAM_ID
      );
      const [sideA] = PublicKey.findProgramAddressSync(
        [Buffer.from("side"), market.toBuffer(), Buffer.from([0])], PROGRAM_ID
      );
      const [sideB] = PublicKey.findProgramAddressSync(
        [Buffer.from("side"), market.toBuffer(), Buffer.from([1])], PROGRAM_ID
      );
      const [mintA] = PublicKey.findProgramAddressSync(
        [Buffer.from("mint"), market.toBuffer(), Buffer.from([0])], PROGRAM_ID
      );
      const [mintB] = PublicKey.findProgramAddressSync(
        [Buffer.from("mint"), market.toBuffer(), Buffer.from([1])], PROGRAM_ID
      );
      const [tvA] = PublicKey.findProgramAddressSync(
        [Buffer.from("token_vault"), market.toBuffer(), Buffer.from([0])], PROGRAM_ID
      );
      const [tvB] = PublicKey.findProgramAddressSync(
        [Buffer.from("token_vault"), market.toBuffer(), Buffer.from([1])], PROGRAM_ID
      );
      const [qvA] = PublicKey.findProgramAddressSync(
        [Buffer.from("quote_vault"), market.toBuffer(), Buffer.from([0])], PROGRAM_ID
      );
      const [qvB] = PublicKey.findProgramAddressSync(
        [Buffer.from("quote_vault"), market.toBuffer(), Buffer.from([1])], PROGRAM_ID
      );

      const configData = await program.account.programConfig.fetch(findConfigPda());
      const protocolFeeAccount = configData.protocolFeeAccount;

      const creatorFeeAccount = await getAssociatedTokenAddress(NATIVE_MINT, wallet.publicKey);
      try { await getAccount(connection, creatorFeeAccount); } catch {}

      const now = Math.floor(Date.now() / 1000);
      const deadline = now + Math.floor(parseFloat(deadlineHours) * 3600);
      const twapWindow = Math.floor(parseFloat(twapWindowMin) * 60);
      const battleTaxBps = Math.floor(parseFloat(battleTaxPct) * 100);

      setTxStatus("Awaiting wallet approval...");

      const tx = await program.methods
        .initializeMarket(
          marketId,
          new BN(deadline),
          new BN(twapWindow),
          new BN(60),
          battleTaxBps,
          100,
          1500,
          new BN(Math.floor(twapWindow * 0.5)),
          { a: new BN(1_000_000), n: 1, b: new BN(1_000) },
          new BN(1_000_000_000),
          nameA, symbolA, "",
          nameB, symbolB, "",
          { unlocked: {} },
          new BN(0),
          0,
          0,
          { twap: {} },
          PublicKey.default,
          new BN(0),
        )
        .accounts({
          creator: wallet.publicKey, market, sideA, sideB,
          tokenMintA: mintA, tokenMintB: mintB,
          tokenVaultA: tvA, tokenVaultB: tvB,
          quoteMint: NATIVE_MINT,
          quoteTokenProgram: TOKEN_PROGRAM_ID,
          quoteVaultA: qvA, quoteVaultB: qvB,
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
        .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })])
        .rpc();

      setTxStatus(`Market created — ${tx.slice(0, 8)}...`);
      setTimeout(() => router.push(`/duels/${market.toBase58()}`), 2000);
    } catch (err: any) {
      console.error(err);
      setTxStatus(`Failed — ${err.message?.slice(0, 100)}`);
    }
  }

  return (
    <div className="page-container" style={{ maxWidth: 600, margin: "0 auto", padding: "40px 24px" }}>
      <h1 className="section-title" style={{ textAlign: "center", marginBottom: 8 }}>Create a Duel</h1>
      <p style={{ textAlign: "center", color: "var(--text-secondary)", marginBottom: 40, fontSize: "0.9rem" }}>
        Define two sides, set the rules, and let the market decide.
      </p>

      {/* Step indicator */}
      <div style={{
        display: "flex", justifyContent: "center", gap: 8, marginBottom: 40,
      }}>
        {[1, 2, 3].map((s) => (
          <div
            key={s}
            style={{
              width: 40, height: 4, borderRadius: 2,
              background: s <= step ? "var(--accent)" : "var(--bg-surface-3)",
              transition: "all 0.3s",
            }}
          />
        ))}
      </div>

      {/* ─── Step 1: Names ─── */}
      {step === 1 && (
        <div className="card animate-fadeInUp">
          <h3 style={{ fontFamily: "var(--font-heading)", fontWeight: 700, marginBottom: 20 }}>
            Step 1: Define the Sides
          </h3>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
            <div>
              <div style={{
                padding: "16px", borderRadius: "var(--radius-md)", marginBottom: 12,
                background: "rgba(251, 191, 36, 0.05)", border: "1px solid rgba(251, 191, 36, 0.15)",
              }}>
                <span style={{ color: "var(--text-yellow)", fontWeight: 700, fontSize: "0.85rem" }}>SIDE A</span>
              </div>
              <input className="input" placeholder="Side A Name" value={nameA} onChange={(e) => setNameA(e.target.value)} style={{ marginBottom: 8 }} />
              <input className="input" placeholder="Symbol (e.g. BULL)" value={symbolA} onChange={(e) => setSymbolA(e.target.value.toUpperCase())} />
            </div>
            <div>
              <div style={{
                padding: "16px", borderRadius: "var(--radius-md)", marginBottom: 12,
                background: "rgba(59, 130, 246, 0.05)", border: "1px solid rgba(59, 130, 246, 0.15)",
              }}>
                <span style={{ color: "var(--text-blue)", fontWeight: 700, fontSize: "0.85rem" }}>SIDE B</span>
              </div>
              <input className="input" placeholder="Side B Name" value={nameB} onChange={(e) => setNameB(e.target.value)} style={{ marginBottom: 8 }} />
              <input className="input" placeholder="Symbol (e.g. BEAR)" value={symbolB} onChange={(e) => setSymbolB(e.target.value.toUpperCase())} />
            </div>
          </div>

          <button
            className="btn btn-accent"
            style={{ width: "100%" }}
            onClick={() => setStep(2)}
            disabled={!nameA || !symbolA || !nameB || !symbolB}
          >
            Next <IconArrowRight />
          </button>
        </div>
      )}

      {/* ─── Step 2: Parameters ─── */}
      {step === 2 && (
        <div className="card animate-fadeInUp">
          <h3 style={{ fontFamily: "var(--font-heading)", fontWeight: 700, marginBottom: 20 }}>
            Step 2: Set the Rules
          </h3>

          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: 6, display: "block" }}>
              Duration (hours)
            </label>
            <input className="input" type="number" value={deadlineHours} onChange={(e) => setDeadlineHours(e.target.value)} min="1" max="720" />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: 6, display: "block" }}>
              Battle Tax (% of loser&apos;s reserve transferred to winner)
            </label>
            <input className="input" type="number" value={battleTaxPct} onChange={(e) => setBattleTaxPct(e.target.value)} min="0" max="100" />
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: 6, display: "block" }}>
              TWAP Window (minutes before deadline)
            </label>
            <input className="input" type="number" value={twapWindowMin} onChange={(e) => setTwapWindowMin(e.target.value)} min="1" max="1440" />
          </div>

          <div style={{ display: "flex", gap: 12 }}>
            <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setStep(1)}><IconArrowLeft /> Back</button>
            <button className="btn btn-accent" style={{ flex: 2 }} onClick={() => setStep(3)}>Review <IconArrowRight /></button>
          </div>
        </div>
      )}

      {/* ─── Step 3: Review ─── */}
      {step === 3 && (
        <div className="card animate-fadeInUp">
          <h3 style={{ fontFamily: "var(--font-heading)", fontWeight: 700, marginBottom: 20 }}>
            Step 3: Review &amp; Create
          </h3>

          <div style={{
            display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 16,
            alignItems: "center", marginBottom: 24, padding: "20px",
            background: "var(--bg-surface-2)", borderRadius: "var(--radius-md)",
          }}>
            <div style={{ textAlign: "center" }}>
              <div style={{
                width: 36, height: 36, borderRadius: "50%", display: "inline-flex",
                alignItems: "center", justifyContent: "center", marginBottom: 8,
                background: "rgba(251, 191, 36, 0.1)", border: "1px solid rgba(251, 191, 36, 0.2)",
              }}>
                <span style={{ fontFamily: "var(--font-heading)", fontWeight: 900, color: "var(--text-yellow)", fontSize: "0.85rem" }}>A</span>
              </div>
              <div style={{ fontWeight: 700, color: "var(--text-yellow)" }}>{nameA}</div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>${symbolA}</div>
            </div>
            <div style={{ fontWeight: 900, color: "var(--text-muted)" }}>VS</div>
            <div style={{ textAlign: "center" }}>
              <div style={{
                width: 36, height: 36, borderRadius: "50%", display: "inline-flex",
                alignItems: "center", justifyContent: "center", marginBottom: 8,
                background: "rgba(59, 130, 246, 0.1)", border: "1px solid rgba(59, 130, 246, 0.2)",
              }}>
                <span style={{ fontFamily: "var(--font-heading)", fontWeight: 900, color: "var(--text-blue)", fontSize: "0.85rem" }}>B</span>
              </div>
              <div style={{ fontWeight: 700, color: "var(--text-blue)" }}>{nameB}</div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>${symbolB}</div>
            </div>
          </div>

          <div style={{ marginBottom: 24 }}>
            {[
              ["Duration", `${deadlineHours} hours`],
              ["Battle Tax", `${battleTaxPct}%`],
              ["TWAP Window", `${twapWindowMin} min`],
              ["Resolution", "TWAP"],
              ["Quote Token", "SOL (WSOL)"],
              ["Curve", "Linear (a=1M, n=1, b=1K)"],
            ].map(([label, value]) => (
              <div key={label as string} style={{
                display: "flex", justifyContent: "space-between", padding: "10px 0",
                borderBottom: "1px solid var(--border)", fontSize: "0.85rem",
              }}>
                <span style={{ color: "var(--text-secondary)" }}>{label}</span>
                <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>{value}</span>
              </div>
            ))}
          </div>

          {txStatus && (
            <div style={{
              padding: "12px 16px", borderRadius: "var(--radius-md)",
              background: "var(--bg-surface-2)", fontSize: "0.8rem",
              fontFamily: "var(--font-mono)", color: "var(--text-secondary)",
              marginBottom: 16,
            }}>
              {txStatus}
            </div>
          )}

          <div style={{ display: "flex", gap: 12 }}>
            <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setStep(2)}><IconArrowLeft /> Back</button>
            <button
              className="btn btn-accent"
              style={{ flex: 2 }}
              onClick={handleCreate}
              disabled={!wallet.publicKey}
            >
              {wallet.publicKey ? <><IconBolt /> Create Duel</> : "Connect Wallet First"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
