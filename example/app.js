// Duel Protocol E2E Tester
// Connects to localnet (localhost:8899) and interacts with the Duel program

const PROGRAM_ID = "CgR6V1AxC7exDFNoh3Q5JP9aea9YuPqq283EwACUGpZE";
const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const ASSOCIATED_TOKEN_PROGRAM_ID = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const LAMPORTS_PER_SOL = 1_000_000_000;

let connection = null;
let wallet = null;
let provider = null;
let program = null;
let marketAccounts = null; // Cached PDAs after market creation

// ---- IDL (loaded from file) ----
let IDL = null;

async function loadIDL() {
  const response = await fetch("../target/idl/duel.json");
  IDL = await response.json();
}

// ---- Logging ----
function log(msg, type = "") {
  const el = document.getElementById("event-log");
  const time = new Date().toLocaleTimeString();
  const div = document.createElement("div");
  div.className = `log-entry ${type}`;
  div.innerHTML = `<span class="log-time">${time}</span>${msg}`;
  el.prepend(div);
}

// ---- PDA Derivation ----
function findPda(seeds) {
  const programKey = new solanaWeb3.PublicKey(PROGRAM_ID);
  return solanaWeb3.PublicKey.findProgramAddressSync(seeds, programKey);
}

function deriveMarket(creator, marketId) {
  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64LE(BigInt(marketId));

  const [market] = findPda([Buffer.from("market"), creator.toBuffer(), idBuf]);
  const [sideA] = findPda([Buffer.from("side"), market.toBuffer(), Buffer.from([0])]);
  const [sideB] = findPda([Buffer.from("side"), market.toBuffer(), Buffer.from([1])]);
  const [mintA] = findPda([Buffer.from("mint"), market.toBuffer(), Buffer.from([0])]);
  const [mintB] = findPda([Buffer.from("mint"), market.toBuffer(), Buffer.from([1])]);
  const [tvA] = findPda([Buffer.from("token_vault"), market.toBuffer(), Buffer.from([0])]);
  const [tvB] = findPda([Buffer.from("token_vault"), market.toBuffer(), Buffer.from([1])]);
  const [svA] = findPda([Buffer.from("sol_vault"), market.toBuffer(), Buffer.from([0])]);
  const [svB] = findPda([Buffer.from("sol_vault"), market.toBuffer(), Buffer.from([1])]);

  return { market, sideA, sideB, mintA, mintB, tvA, tvB, svA, svB };
}

// ---- Wallet ----
async function connectWallet() {
  try {
    // For localnet testing, use Phantom or file system wallet
    if (window.solana && window.solana.isPhantom) {
      await window.solana.connect();
      wallet = window.solana;
      const pubkey = wallet.publicKey.toString();
      document.getElementById("wallet-label").textContent = pubkey.slice(0, 4) + "..." + pubkey.slice(-4);
      document.getElementById("wallet-status").className = "wallet-status connected";
      document.getElementById("connect-btn").textContent = "Connected";

      // Setup provider and program
      connection = new solanaWeb3.Connection("http://localhost:8899", "confirmed");
      provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
      program = new anchor.Program(IDL, provider);

      enableButtons();
      log("Wallet connected: " + pubkey, "success");

      // Check balance
      const bal = await connection.getBalance(wallet.publicKey);
      log(`Balance: ${(bal / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
    } else {
      log("Phantom wallet not found! Install Phantom and switch to localnet.", "error");
    }
  } catch (e) {
    log("Connection failed: " + e.message, "error");
  }
}

function enableButtons() {
  document.getElementById("create-market-btn").disabled = false;
}

// ---- Create Market ----
async function createMarket() {
  try {
    const marketId = parseInt(document.getElementById("market-id").value);
    const deadlineSecs = parseInt(document.getElementById("deadline-secs").value);
    const twapWindow = parseInt(document.getElementById("twap-window").value);
    const twapInterval = parseInt(document.getElementById("twap-interval").value);
    const battleTax = parseInt(document.getElementById("battle-tax").value);
    const protocolFee = parseInt(document.getElementById("protocol-fee").value);
    const sellPenalty = parseInt(document.getElementById("sell-penalty").value);
    const protectionOffset = parseInt(document.getElementById("protection-offset").value);

    const now = Math.floor(Date.now() / 1000);
    const deadline = now + deadlineSecs;

    const accs = deriveMarket(wallet.publicKey, marketId);
    marketAccounts = accs;

    // Generate protocol fee keypair
    const protocolFeeAccount = solanaWeb3.Keypair.generate();

    // Pre-fund protocol fee account
    const prefundTx = new solanaWeb3.Transaction().add(
      solanaWeb3.SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: protocolFeeAccount.publicKey,
        lamports: 890_880,
      })
    );
    await provider.sendAndConfirm(prefundTx);

    log("Creating market #" + marketId + "...");

    const tx = await program.methods
      .initializeMarket(
        new BN(marketId),
        new BN(deadline),
        new BN(twapWindow),
        new BN(twapInterval),
        battleTax,
        protocolFee,
        sellPenalty,
        new BN(protectionOffset),
        { a: new BN(1_000_000), n: 1, b: new BN(1_000) },
        new BN(1_000_000_000) // 1B tokens
      )
      .accounts({
        creator: wallet.publicKey,
        market: accs.market,
        sideA: accs.sideA,
        sideB: accs.sideB,
        tokenMintA: accs.mintA,
        tokenMintB: accs.mintB,
        tokenVaultA: accs.tvA,
        tokenVaultB: accs.tvB,
        solVaultA: accs.svA,
        solVaultB: accs.svB,
        protocolFeeAccount: protocolFeeAccount.publicKey,
        systemProgram: solanaWeb3.SystemProgram.programId,
        tokenProgram: new solanaWeb3.PublicKey(TOKEN_PROGRAM_ID),
        rent: solanaWeb3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    log(`✅ Market created! TX: ${tx.slice(0, 12)}...`, "success");

    // Store protocol fee account for resolve
    marketAccounts.protocolFeeAccount = protocolFeeAccount.publicKey;

    // Show UI sections
    document.getElementById("market-section").style.display = "block";
    document.getElementById("sides-section").style.display = "grid";
    document.getElementById("actions-section").style.display = "block";

    // Enable trade buttons
    ["buy-a-btn", "buy-b-btn", "sell-a-btn", "sell-b-btn", "twap-btn", "resolve-btn", "sell-post-a-btn", "sell-post-b-btn"].forEach(id => {
      document.getElementById(id).disabled = false;
    });

    await refreshState();
  } catch (e) {
    log("❌ Create failed: " + (e.message || e), "error");
    console.error(e);
  }
}

// ---- Refresh Market State ----
async function refreshState() {
  if (!marketAccounts) return;
  try {
    const market = await program.account.market.fetch(marketAccounts.market);
    const sideA = await program.account.side.fetch(marketAccounts.sideA);
    const sideB = await program.account.side.fetch(marketAccounts.sideB);

    const status = market.status.active ? "Active" :
                   market.status.twapObservation ? "TWAP Observation" : "Resolved";
    const statusClass = market.status.active ? "status-active" :
                        market.status.twapObservation ? "status-twap" : "status-resolved";

    const deadline = new Date(market.deadline.toNumber() * 1000);
    const remaining = Math.max(0, Math.floor((deadline - Date.now()) / 1000));

    document.getElementById("market-state").innerHTML = `
      <div class="stat-row"><span class="stat-label">Status</span><span class="stat-value"><span class="status ${statusClass}">${status}</span></span></div>
      <div class="stat-row"><span class="stat-label">Market ID</span><span class="stat-value">${market.marketId.toNumber()}</span></div>
      <div class="stat-row"><span class="stat-label">Deadline</span><span class="stat-value">${deadline.toLocaleTimeString()} (${remaining}s left)</span></div>
      <div class="stat-row"><span class="stat-label">Battle Tax</span><span class="stat-value">${market.battleTaxBps / 100}%</span></div>
      <div class="stat-row"><span class="stat-label">TWAP Samples</span><span class="stat-value">${market.twapSamplesCount}</span></div>
      <div class="stat-row"><span class="stat-label">Winner</span><span class="stat-value">${market.winner !== null ? (market.winner === 0 ? "Side A 🔴" : "Side B 🔵") : "—"}</span></div>
      ${market.status.resolved ? `
        <div class="stat-row"><span class="stat-label">Final TWAP A</span><span class="stat-value">${market.finalTwapA.toNumber()}</span></div>
        <div class="stat-row"><span class="stat-label">Final TWAP B</span><span class="stat-value">${market.finalTwapB.toNumber()}</span></div>
      ` : ""}
    `;

    // Side stats
    const svABal = await connection.getBalance(marketAccounts.svA);
    const svBBal = await connection.getBalance(marketAccounts.svB);

    const priceA = sideA.circulatingSupply.toNumber() > 0
      ? (1_000_000 * sideA.circulatingSupply.toNumber() + 1_000)
      : 1_000;
    const priceB = sideB.circulatingSupply.toNumber() > 0
      ? (1_000_000 * sideB.circulatingSupply.toNumber() + 1_000)
      : 1_000;

    const renderSide = (side, prefix, bal, price) => `
      <div class="stat-row"><span class="stat-label">Supply</span><span class="stat-value">${side.circulatingSupply.toNumber().toLocaleString()} / ${side.totalSupply.toNumber().toLocaleString()}</span></div>
      <div class="stat-row"><span class="stat-label">SOL Reserve</span><span class="stat-value">${(bal / LAMPORTS_PER_SOL).toFixed(4)} SOL</span></div>
      <div class="stat-row"><span class="stat-label">Peak Reserve</span><span class="stat-value">${(side.peakReserve.toNumber() / LAMPORTS_PER_SOL).toFixed(4)} SOL</span></div>
      <div class="stat-row"><span class="stat-label">Price</span><span class="stat-value">${(price / LAMPORTS_PER_SOL).toFixed(9)} SOL</span></div>
    `;

    document.getElementById("side-a-stats").innerHTML = renderSide(sideA, "a", svABal, priceA);
    document.getElementById("side-b-stats").innerHTML = renderSide(sideB, "b", svBBal, priceB);

    // Update token balances for sell inputs
    try {
      const ataA = await getAta(marketAccounts.mintA);
      const ataAInfo = await connection.getTokenAccountBalance(ataA);
      document.getElementById("sell-a-amount").value = ataAInfo.value.amount;
    } catch { document.getElementById("sell-a-amount").value = "0"; }

    try {
      const ataB = await getAta(marketAccounts.mintB);
      const ataBInfo = await connection.getTokenAccountBalance(ataB);
      document.getElementById("sell-b-amount").value = ataBInfo.value.amount;
    } catch { document.getElementById("sell-b-amount").value = "0"; }

  } catch (e) {
    log("Refresh failed: " + e.message, "error");
  }
}

// ---- ATA Helper ----
async function getAta(mint) {
  const mintKey = mint instanceof solanaWeb3.PublicKey ? mint : new solanaWeb3.PublicKey(mint);
  const [ata] = solanaWeb3.PublicKey.findProgramAddressSync(
    [wallet.publicKey.toBuffer(), new solanaWeb3.PublicKey(TOKEN_PROGRAM_ID).toBuffer(), mintKey.toBuffer()],
    new solanaWeb3.PublicKey(ASSOCIATED_TOKEN_PROGRAM_ID)
  );
  return ata;
}

async function ensureAta(mint) {
  const ata = await getAta(mint);
  const info = await connection.getAccountInfo(ata);
  if (!info) {
    const mintKey = mint instanceof solanaWeb3.PublicKey ? mint : new solanaWeb3.PublicKey(mint);
    const ix = createAssociatedTokenAccountIx(wallet.publicKey, ata, wallet.publicKey, mintKey);
    const tx = new solanaWeb3.Transaction().add(ix);
    await provider.sendAndConfirm(tx);
    log("Created ATA: " + ata.toString().slice(0, 8) + "...");
  }
  return ata;
}

function createAssociatedTokenAccountIx(payer, ata, owner, mint) {
  return new solanaWeb3.TransactionInstruction({
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: solanaWeb3.SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: new solanaWeb3.PublicKey(TOKEN_PROGRAM_ID), isSigner: false, isWritable: false },
    ],
    programId: new solanaWeb3.PublicKey(ASSOCIATED_TOKEN_PROGRAM_ID),
    data: Buffer.alloc(0),
  });
}

// ---- Buy Tokens ----
async function buyTokens(side) {
  try {
    const amountEl = side === 0 ? "buy-a-amount" : "buy-b-amount";
    const solAmount = parseFloat(document.getElementById(amountEl).value);
    const lamports = Math.floor(solAmount * LAMPORTS_PER_SOL);

    const mint = side === 0 ? marketAccounts.mintA : marketAccounts.mintB;
    const sideAccount = side === 0 ? marketAccounts.sideA : marketAccounts.sideB;
    const tokenVault = side === 0 ? marketAccounts.tvA : marketAccounts.tvB;
    const solVault = side === 0 ? marketAccounts.svA : marketAccounts.svB;

    const ata = await ensureAta(mint);
    log(`Buying Side ${side === 0 ? "A" : "B"} with ${solAmount} SOL...`);

    const tx = await program.methods
      .buyTokens(side, new BN(lamports), new BN(1))
      .accounts({
        buyer: wallet.publicKey,
        market: marketAccounts.market,
        sideAccount,
        tokenVault,
        buyerTokenAccount: ata,
        solVault,
        systemProgram: solanaWeb3.SystemProgram.programId,
        tokenProgram: new solanaWeb3.PublicKey(TOKEN_PROGRAM_ID),
      })
      .rpc();

    log(`✅ Bought Side ${side === 0 ? "A" : "B"}! TX: ${tx.slice(0, 12)}...`, "success");
    await refreshState();
  } catch (e) {
    log(`❌ Buy failed: ${e.message || e}`, "error");
    console.error(e);
  }
}

// ---- Sell Tokens ----
async function sellTokens(side) {
  try {
    const amountEl = side === 0 ? "sell-a-amount" : "sell-b-amount";
    const tokenAmount = parseInt(document.getElementById(amountEl).value);

    const mint = side === 0 ? marketAccounts.mintA : marketAccounts.mintB;
    const sideAccount = side === 0 ? marketAccounts.sideA : marketAccounts.sideB;
    const tokenVault = side === 0 ? marketAccounts.tvA : marketAccounts.tvB;
    const solVault = side === 0 ? marketAccounts.svA : marketAccounts.svB;

    const ata = await getAta(mint);
    log(`Selling ${tokenAmount} tokens on Side ${side === 0 ? "A" : "B"}...`);

    const tx = await program.methods
      .sellTokens(side, new BN(tokenAmount), new BN(0))
      .accounts({
        seller: wallet.publicKey,
        market: marketAccounts.market,
        sideAccount,
        tokenVault,
        sellerTokenAccount: ata,
        solVault,
        systemProgram: solanaWeb3.SystemProgram.programId,
        tokenProgram: new solanaWeb3.PublicKey(TOKEN_PROGRAM_ID),
      })
      .rpc();

    log(`✅ Sold Side ${side === 0 ? "A" : "B"}! TX: ${tx.slice(0, 12)}...`, "success");
    await refreshState();
  } catch (e) {
    log(`❌ Sell failed: ${e.message || e}`, "error");
    console.error(e);
  }
}

// ---- Record TWAP Sample ----
async function recordTwapSample() {
  try {
    log("Recording TWAP sample...");
    const tx = await program.methods
      .recordTwapSample()
      .accounts({
        cranker: wallet.publicKey,
        market: marketAccounts.market,
        sideA: marketAccounts.sideA,
        sideB: marketAccounts.sideB,
      })
      .rpc();

    log(`✅ TWAP sample recorded! TX: ${tx.slice(0, 12)}...`, "success");
    await refreshState();
  } catch (e) {
    log(`❌ TWAP failed: ${e.message || e}`, "error");
    console.error(e);
  }
}

// ---- Resolve Market ----
async function resolveMarket() {
  try {
    log("Resolving market...");
    const tx = await program.methods
      .resolveMarket()
      .accounts({
        resolver: wallet.publicKey,
        market: marketAccounts.market,
        sideA: marketAccounts.sideA,
        sideB: marketAccounts.sideB,
        solVaultA: marketAccounts.svA,
        solVaultB: marketAccounts.svB,
        protocolFeeAccount: marketAccounts.protocolFeeAccount,
        systemProgram: solanaWeb3.SystemProgram.programId,
      })
      .rpc();

    log(`✅ Market resolved! TX: ${tx.slice(0, 12)}...`, "success");
    await refreshState();
  } catch (e) {
    log(`❌ Resolve failed: ${e.message || e}`, "error");
    console.error(e);
  }
}

// ---- Sell Post-Resolution ----
async function sellPostResolution(side) {
  try {
    const mint = side === 0 ? marketAccounts.mintA : marketAccounts.mintB;
    const sideAccount = side === 0 ? marketAccounts.sideA : marketAccounts.sideB;
    const tokenVault = side === 0 ? marketAccounts.tvA : marketAccounts.tvB;
    const solVault = side === 0 ? marketAccounts.svA : marketAccounts.svB;

    const ata = await getAta(mint);
    const balance = await connection.getTokenAccountBalance(ata);
    const tokenAmount = parseInt(balance.value.amount);

    if (tokenAmount === 0) {
      log("No tokens to sell!", "error");
      return;
    }

    log(`Selling ${tokenAmount} tokens post-resolution on Side ${side === 0 ? "A" : "B"}...`);

    const tx = await program.methods
      .sellPostResolution(side, new BN(tokenAmount), new BN(0))
      .accounts({
        seller: wallet.publicKey,
        market: marketAccounts.market,
        sideAccount,
        tokenVault,
        sellerTokenAccount: ata,
        solVault,
        systemProgram: solanaWeb3.SystemProgram.programId,
        tokenProgram: new solanaWeb3.PublicKey(TOKEN_PROGRAM_ID),
      })
      .rpc();

    log(`✅ Sold post-resolution! TX: ${tx.slice(0, 12)}...`, "success");
    await refreshState();
  } catch (e) {
    log(`❌ Post-resolution sell failed: ${e.message || e}`, "error");
    console.error(e);
  }
}

// ---- Auto-refresh timer ----
let refreshInterval = null;
function startAutoRefresh() {
  if (refreshInterval) clearInterval(refreshInterval);
  refreshInterval = setInterval(() => {
    if (marketAccounts) refreshState();
  }, 5000);
}

// ---- Init ----
async function init() {
  await loadIDL();
  log("IDL loaded. Connect your Phantom wallet (set to localhost:8899).");

  // Bind events
  document.getElementById("connect-btn").addEventListener("click", connectWallet);
  document.getElementById("create-market-btn").addEventListener("click", createMarket);
  document.getElementById("refresh-btn").addEventListener("click", refreshState);
  document.getElementById("buy-a-btn").addEventListener("click", () => buyTokens(0));
  document.getElementById("buy-b-btn").addEventListener("click", () => buyTokens(1));
  document.getElementById("sell-a-btn").addEventListener("click", () => sellTokens(0));
  document.getElementById("sell-b-btn").addEventListener("click", () => sellTokens(1));
  document.getElementById("twap-btn").addEventListener("click", recordTwapSample);
  document.getElementById("resolve-btn").addEventListener("click", resolveMarket);
  document.getElementById("sell-post-a-btn").addEventListener("click", () => sellPostResolution(0));
  document.getElementById("sell-post-b-btn").addEventListener("click", () => sellPostResolution(1));

  startAutoRefresh();
}

init();
