"use client";
import React, { useState, useCallback, useEffect } from "react";
import {
  useConnection,
  useWallet,
} from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import {
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
  ComputeBudgetProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
} from "@solana/spl-token";
import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import { deriveMarket, findMetadataPda, TOKEN_METADATA_PROGRAM_ID } from "./utils/pda";
import IDL from "./utils/duel.json";

type LogEntry = { ts: string; msg: string; type: "info" | "success" | "error" };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MarketData = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SideData = any;

const PROGRAM_ID = new PublicKey("CgR6V1AxC7exDFNoh3Q5JP9aea9YuPqq283EwACUGpZE");

export default function DuelApp() {
  const { connection } = useConnection();
  const wallet = useWallet();

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [marketId, setMarketId] = useState(1);
  const [deadline, setDeadline] = useState(600);
  const [twapWindow, setTwapWindow] = useState(300);
  const [twapInterval, setTwapInterval] = useState(60);
  const [battleTaxBps, setBattleTaxBps] = useState(5000);
  const [nameA, setNameA] = useState("Side A Token");
  const [symbolA, setSymbolA] = useState("SIDE-A");
  const [nameB, setNameB] = useState("Side B Token");
  const [symbolB, setSymbolB] = useState("SIDE-B");
  const [buyAmountA, setBuyAmountA] = useState("0.1");
  const [buyAmountB, setBuyAmountB] = useState("0.1");
  const [sellAmountA, setSellAmountA] = useState("");
  const [sellAmountB, setSellAmountB] = useState("");

  const [market, setMarket] = useState<MarketData | null>(null);
  const [sideAData, setSideAData] = useState<SideData | null>(null);
  const [sideBData, setSideBData] = useState<SideData | null>(null);
  const [balA, setBalA] = useState(0);
  const [balB, setBalB] = useState(0);
  const [loading, setLoading] = useState<string | null>(null);
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const log = useCallback(
    (msg: string, type: LogEntry["type"] = "info") => {
      setLogs((p) => [
        { ts: new Date().toLocaleTimeString(), msg, type },
        ...p.slice(0, 49),
      ]);
    },
    []
  );

  const getProgram = useCallback(() => {
    if (!wallet.publicKey || !wallet.signTransaction) return null;
    const provider = new anchor.AnchorProvider(
      connection,
      wallet as unknown as anchor.Wallet,
      { commitment: "confirmed" }
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new anchor.Program(IDL as any, provider) as any;
  }, [connection, wallet]);

  const fetchMarketState = useCallback(async () => {
    const program = getProgram() as any;
    if (!program || !wallet.publicKey) return;
    try {
      const pdas = deriveMarket(wallet.publicKey, marketId);
      const mkt = await program.account.market.fetch(pdas.market);
      setMarket(mkt);
      const sA = await program.account.side.fetch(pdas.sideA);
      const sB = await program.account.side.fetch(pdas.sideB);
      setSideAData(sA);
      setSideBData(sB);

      try {
        const ataA = await getAssociatedTokenAddress(
          pdas.mintA,
          wallet.publicKey
        );
        const acc = await getAccount(connection, ataA);
        setBalA(Number(acc.amount));
      } catch {
        setBalA(0);
      }
      try {
        const ataB = await getAssociatedTokenAddress(
          pdas.mintB,
          wallet.publicKey
        );
        const acc = await getAccount(connection, ataB);
        setBalB(Number(acc.amount));
      } catch {
        setBalB(0);
      }
    } catch {
      setMarket(null);
      setSideAData(null);
      setSideBData(null);
    }
  }, [getProgram, wallet.publicKey, marketId, connection]);

  useEffect(() => {
    if (wallet.publicKey) fetchMarketState();
    const iv = setInterval(() => {
      if (wallet.publicKey) fetchMarketState();
    }, 5000);
    return () => clearInterval(iv);
  }, [wallet.publicKey, fetchMarketState]);

  const handleCreateMarket = async () => {
    const program = getProgram() as any;
    if (!program || !wallet.publicKey) return;
    setLoading("Creating market...");
    try {
      const pdas = deriveMarket(wallet.publicKey, marketId);
      const now = Math.floor(Date.now() / 1000);
      const protocolFee = wallet.publicKey; // self for demo

      await program.methods
        .initializeMarket(
          new BN(marketId),
          new BN(now + deadline),
          new BN(twapWindow),
          new BN(twapInterval),
          battleTaxBps,
          100, // protocol_fee_bps
          1500, // sell_penalty_max
          new BN(300),
          { a: new BN(1_000_000), n: 1, b: new BN(1_000) },
          new BN(1_000_000_000),
          nameA,
          symbolA,
          "",
          nameB,
          symbolB,
          ""
        )
        .accounts({
          creator: wallet.publicKey,
          market: pdas.market,
          sideA: pdas.sideA,
          sideB: pdas.sideB,
          tokenMintA: pdas.mintA,
          tokenMintB: pdas.mintB,
          tokenVaultA: pdas.tvA,
          tokenVaultB: pdas.tvB,
          solVaultA: pdas.svA,
          solVaultB: pdas.svB,
          protocolFeeAccount: protocolFee,
          metadataA: findMetadataPda(pdas.mintA),
          metadataB: findMetadataPda(pdas.mintB),
          tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .preInstructions([
          ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
        ])
        .rpc();

      log("Market created successfully!", "success");
      await fetchMarketState();
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      log(`Create failed: ${errMsg}`, "error");
    }
    setLoading(null);
  };

  const handleBuy = async (side: number) => {
    const program = getProgram() as any;
    if (!program || !wallet.publicKey) return;
    const amt = side === 0 ? buyAmountA : buyAmountB;
    setLoading(`Buying side ${side === 0 ? "A" : "B"}...`);
    try {
      const pdas = deriveMarket(wallet.publicKey, marketId);
      const mint = side === 0 ? pdas.mintA : pdas.mintB;
      const sideAccount = side === 0 ? pdas.sideA : pdas.sideB;
      const tokenVault = side === 0 ? pdas.tvA : pdas.tvB;
      const solVault = side === 0 ? pdas.svA : pdas.svB;

      const ata = await getAssociatedTokenAddress(mint, wallet.publicKey);
      const tx = new anchor.web3.Transaction();
      try {
        await getAccount(connection, ata);
      } catch {
        tx.add(
          createAssociatedTokenAccountInstruction(
            wallet.publicKey,
            ata,
            wallet.publicKey,
            mint
          )
        );
      }

      await program.methods
        .buyTokens(side, new BN(parseFloat(amt) * LAMPORTS_PER_SOL), new BN(1))
        .accounts({
          buyer: wallet.publicKey,
          market: pdas.market,
          sideAccount,
          tokenVault,
          buyerTokenAccount: ata,
          solVault,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .preInstructions(tx.instructions)
        .rpc();

      log(
        `Bought on side ${side === 0 ? "A" : "B"} with ${amt} SOL`,
        "success"
      );
      await fetchMarketState();
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      log(`Buy failed: ${errMsg}`, "error");
    }
    setLoading(null);
  };

  const handleSell = async (side: number) => {
    const program = getProgram() as any;
    if (!program || !wallet.publicKey) return;
    const amt = side === 0 ? sellAmountA : sellAmountB;
    if (!amt) return;
    setLoading(`Selling side ${side === 0 ? "A" : "B"}...`);
    try {
      const pdas = deriveMarket(wallet.publicKey, marketId);
      const mint = side === 0 ? pdas.mintA : pdas.mintB;
      const sideAccount = side === 0 ? pdas.sideA : pdas.sideB;
      const tokenVault = side === 0 ? pdas.tvA : pdas.tvB;
      const solVault = side === 0 ? pdas.svA : pdas.svB;
      const ata = await getAssociatedTokenAddress(mint, wallet.publicKey);

      const isResolved =
        market && market.status && "resolved" in market.status;

      if (isResolved) {
        await program.methods
          .sellPostResolution(side, new BN(parseInt(amt)), new BN(0))
          .accounts({
            seller: wallet.publicKey,
            market: pdas.market,
            sideAccount,
            tokenVault,
            sellerTokenAccount: ata,
            solVault,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
      } else {
        await program.methods
          .sellTokens(side, new BN(parseInt(amt)), new BN(1))
          .accounts({
            seller: wallet.publicKey,
            market: pdas.market,
            sideAccount,
            tokenVault,
            sellerTokenAccount: ata,
            solVault,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
      }

      log(`Sold ${amt} tokens on side ${side === 0 ? "A" : "B"}`, "success");
      await fetchMarketState();
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      log(`Sell failed: ${errMsg}`, "error");
    }
    setLoading(null);
  };

  const handleRecordTwap = async () => {
    const program = getProgram() as any;
    if (!program || !wallet.publicKey) return;
    setLoading("Recording TWAP sample...");
    try {
      const pdas = deriveMarket(wallet.publicKey, marketId);
      await program.methods
        .recordTwapSample()
        .accounts({
          cranker: wallet.publicKey,
          market: pdas.market,
          sideA: pdas.sideA,
          sideB: pdas.sideB,
        })
        .rpc();
      log("TWAP sample recorded", "success");
      await fetchMarketState();
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      log(`TWAP failed: ${errMsg}`, "error");
    }
    setLoading(null);
  };

  const handleResolve = async () => {
    const program = getProgram() as any;
    if (!program || !wallet.publicKey) return;
    setLoading("Resolving market...");
    try {
      const pdas = deriveMarket(wallet.publicKey, marketId);
      await program.methods
        .resolveMarket()
        .accounts({
          resolver: wallet.publicKey,
          market: pdas.market,
          sideA: pdas.sideA,
          sideB: pdas.sideB,
          solVaultA: pdas.svA,
          solVaultB: pdas.svB,
          protocolFeeAccount: wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      log("Market resolved!", "success");
      await fetchMarketState();
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      log(`Resolve failed: ${errMsg}`, "error");
    }
    setLoading(null);
  };

  const getStatusText = () => {
    if (!market) return "Not Created";
    if ("active" in market.status) return "Active";
    if ("twapObservation" in market.status) return "TWAP Observation";
    if ("resolved" in market.status) return "Resolved";
    return "Unknown";
  };

  const getWinner = () => {
    if (!market || market.winner === null) return "—";
    return market.winner === 0 ? "Side A 🏆" : "Side B 🏆";
  };

  const fmtSol = (lamports: number) => (lamports / LAMPORTS_PER_SOL).toFixed(4);
  const fmtTokens = (amt: number) => (amt / 1_000_000).toFixed(6);

  const fmtCountdown = (seconds: number) => {
    if (seconds <= 0) return "NOW ✅";
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
  };

  const getTwapWindowOpens = () => {
    if (!market) return null;
    const dl = market.deadline.toNumber();
    const tw = market.twapWindow.toNumber();
    return dl - tw;
  };

  const getDeadline = () => {
    if (!market) return null;
    return market.deadline.toNumber();
  };

  return (
    <div className="app">
      <header>
        <div className="header-left">
          <h1>⚔️ Duel Protocol</h1>
          <span className="subtitle">Binary Outcome Markets</span>
        </div>
        <WalletMultiButton />
      </header>

      {loading && <div className="loading-bar">{loading}</div>}

      {!wallet.publicKey ? (
        <div className="hero">
          <h2>Connect your wallet to get started</h2>
          <p>
            Create prediction markets, trade on outcomes, and resolve using
            TWAP oracles.
          </p>
        </div>
      ) : (
        <div className="grid">
          {/* Create Market Panel */}
          <section className="card create-card">
            <h2>Create Market</h2>
            <div className="form-grid">
              <div className="field">
                <label>Market ID</label>
                <input
                  type="number"
                  value={marketId}
                  onChange={(e) => setMarketId(parseInt(e.target.value) || 1)}
                />
              </div>
              <div className="field">
                <label>Deadline (sec from now)</label>
                <input
                  type="number"
                  value={deadline}
                  onChange={(e) => setDeadline(parseInt(e.target.value) || 600)}
                />
              </div>
              <div className="field">
                <label>TWAP Window (sec)</label>
                <input
                  type="number"
                  value={twapWindow}
                  onChange={(e) =>
                    setTwapWindow(parseInt(e.target.value) || 300)
                  }
                />
              </div>
              <div className="field">
                <label>TWAP Interval (sec)</label>
                <input
                  type="number"
                  value={twapInterval}
                  onChange={(e) =>
                    setTwapInterval(parseInt(e.target.value) || 60)
                  }
                />
              </div>
              <div className="field">
                <label>Battle Tax (bps)</label>
                <input
                  type="number"
                  value={battleTaxBps}
                  onChange={(e) =>
                    setBattleTaxBps(parseInt(e.target.value) || 0)
                  }
                />
              </div>
              <div className="field">
                <label>Side A Name</label>
                <input
                  value={nameA}
                  onChange={(e) => setNameA(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Side A Symbol</label>
                <input
                  value={symbolA}
                  onChange={(e) => setSymbolA(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Side B Name</label>
                <input
                  value={nameB}
                  onChange={(e) => setNameB(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Side B Symbol</label>
                <input
                  value={symbolB}
                  onChange={(e) => setSymbolB(e.target.value)}
                />
              </div>
            </div>
            <button className="btn-primary" onClick={handleCreateMarket}>
              Create Market
            </button>
          </section>

          {/* Market Status Panel */}
          <section className="card status-card">
            <h2>Market Status</h2>
            <div className="status-grid">
              <div className="stat">
                <span className="stat-label">Status</span>
                <span className={`stat-value status-${getStatusText().toLowerCase().replace(' ', '-')}`}>
                  {getStatusText()}
                </span>
              </div>
              <div className="stat">
                <span className="stat-label">Winner</span>
                <span className="stat-value">{getWinner()}</span>
              </div>
              <div className="stat">
                <span className="stat-label">TWAP Samples</span>
                <span className="stat-value">
                  {market?.twapSamplesCount ?? "—"}
                </span>
              </div>
              <div className="stat">
                <span className="stat-label">Deadline</span>
                <span className="stat-value">
                  {market
                    ? new Date(
                        market.deadline.toNumber() * 1000
                      ).toLocaleTimeString()
                    : "—"}
                </span>
              </div>
              <div className="stat">
                <span className="stat-label">TWAP Window Opens</span>
                <span className="stat-value">
                  {getTwapWindowOpens() !== null
                    ? fmtCountdown(getTwapWindowOpens()! - now)
                    : "—"}
                </span>
              </div>
              <div className="stat">
                <span className="stat-label">Time to Deadline</span>
                <span className="stat-value">
                  {getDeadline() !== null
                    ? fmtCountdown(getDeadline()! - now)
                    : "—"}
                </span>
              </div>
            </div>

            <div className="actions-row">
              <button className="btn-secondary" onClick={handleRecordTwap}>
                📊 Record TWAP
              </button>
              <button className="btn-danger" onClick={handleResolve}>
                ⚖️ Resolve
              </button>
            </div>
          </section>

          {/* Trading Panels */}
          <section className="card trade-card side-a">
            <h2>
              <span className="side-dot dot-a" /> Side A
            </h2>
            {sideAData && (
              <div className="side-stats">
                <div className="stat">
                  <span className="stat-label">Supply</span>
                  <span className="stat-value">
                    {fmtTokens(sideAData.circulatingSupply.toNumber())}
                  </span>
                </div>
                <div className="stat">
                  <span className="stat-label">Reserve</span>
                  <span className="stat-value">
                    {fmtSol(sideAData.peakReserve.toNumber())} SOL
                  </span>
                </div>
                <div className="stat">
                  <span className="stat-label">Your Balance</span>
                  <span className="stat-value">{fmtTokens(balA)}</span>
                </div>
              </div>
            )}
            <div className="trade-row">
              <div className="trade-input">
                <label>Buy (SOL)</label>
                <input
                  type="number"
                  step="0.01"
                  value={buyAmountA}
                  onChange={(e) => setBuyAmountA(e.target.value)}
                />
                <button className="btn-buy" onClick={() => handleBuy(0)}>
                  Buy A
                </button>
              </div>
              <div className="trade-input">
                <label>Sell (tokens)</label>
                <input
                  type="number"
                  value={sellAmountA}
                  placeholder={balA.toString()}
                  onChange={(e) => setSellAmountA(e.target.value)}
                />
                <button className="btn-sell" onClick={() => handleSell(0)}>
                  Sell A
                </button>
              </div>
            </div>
          </section>

          <section className="card trade-card side-b">
            <h2>
              <span className="side-dot dot-b" /> Side B
            </h2>
            {sideBData && (
              <div className="side-stats">
                <div className="stat">
                  <span className="stat-label">Supply</span>
                  <span className="stat-value">
                    {fmtTokens(sideBData.circulatingSupply.toNumber())}
                  </span>
                </div>
                <div className="stat">
                  <span className="stat-label">Reserve</span>
                  <span className="stat-value">
                    {fmtSol(sideBData.peakReserve.toNumber())} SOL
                  </span>
                </div>
                <div className="stat">
                  <span className="stat-label">Your Balance</span>
                  <span className="stat-value">{fmtTokens(balB)}</span>
                </div>
              </div>
            )}
            <div className="trade-row">
              <div className="trade-input">
                <label>Buy (SOL)</label>
                <input
                  type="number"
                  step="0.01"
                  value={buyAmountB}
                  onChange={(e) => setBuyAmountB(e.target.value)}
                />
                <button className="btn-buy" onClick={() => handleBuy(1)}>
                  Buy B
                </button>
              </div>
              <div className="trade-input">
                <label>Sell (tokens)</label>
                <input
                  type="number"
                  value={sellAmountB}
                  placeholder={balB.toString()}
                  onChange={(e) => setSellAmountB(e.target.value)}
                />
                <button className="btn-sell" onClick={() => handleSell(1)}>
                  Sell B
                </button>
              </div>
            </div>
          </section>

          {/* Event Log */}
          <section className="card log-card">
            <h2>Event Log</h2>
            <div className="log-scroll">
              {logs.length === 0 ? (
                <p className="log-empty">No events yet</p>
              ) : (
                logs.map((l, i) => (
                  <div key={i} className={`log-entry log-${l.type}`}>
                    <span className="log-ts">{l.ts}</span>
                    <span className="log-msg">{l.msg}</span>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
