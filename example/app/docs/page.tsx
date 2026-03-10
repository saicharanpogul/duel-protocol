"use client";
import "./docs.css";

// ─── SVG Flow Diagram: Market Lifecycle ───
function MarketLifecycleFlow() {
  return (
    <div className="flow-container">
      <svg viewBox="0 0 900 340" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* Creator Node */}
        <g className="flow-node">
          <rect x="20" y="130" width="120" height="56" rx="8" fill="#1E293B" stroke="#334155" strokeWidth="1.5"/>
          <text x="80" y="153" className="flow-label" textAnchor="middle">Creator</text>
          <text x="80" y="170" className="flow-sublabel" textAnchor="middle">Any wallet</text>
        </g>

        {/* Arrow: Creator → Market */}
        <line x1="140" y1="158" x2="180" y2="158" stroke="#06B6D4" strokeWidth="2" className="flow-line"/>
        <polygon points="178,153 188,158 178,163" fill="#06B6D4"/>

        {/* Market PDA */}
        <g className="flow-node">
          <rect x="190" y="120" width="130" height="76" rx="8" fill="#0F766E" stroke="#14B8A6" strokeWidth="1.5"/>
          <text x="255" y="148" className="flow-label" textAnchor="middle">Market PDA</text>
          <text x="255" y="165" className="flow-sublabel" textAnchor="middle">Dual bonding curves</text>
          <text x="255" y="180" className="flow-sublabel" textAnchor="middle">TWAP oracle</text>
        </g>

        {/* Side A */}
        <g className="flow-node">
          <rect x="190" y="30" width="130" height="56" rx="8" fill="#1E293B" stroke="#06B6D4" strokeWidth="1.5"/>
          <text x="255" y="53" className="flow-label" textAnchor="middle">Side A</text>
          <text x="255" y="70" className="flow-sublabel" textAnchor="middle">Token + SOL vault</text>
        </g>
        <line x1="255" y1="86" x2="255" y2="120" stroke="#06B6D4" strokeWidth="1.5" strokeDasharray="5 3"/>

        {/* Side B */}
        <g className="flow-node">
          <rect x="190" y="230" width="130" height="56" rx="8" fill="#1E293B" stroke="#8B5CF6" strokeWidth="1.5"/>
          <text x="255" y="253" className="flow-label" textAnchor="middle">Side B</text>
          <text x="255" y="270" className="flow-sublabel" textAnchor="middle">Token + SOL vault</text>
        </g>
        <line x1="255" y1="196" x2="255" y2="230" stroke="#8B5CF6" strokeWidth="1.5" strokeDasharray="5 3"/>

        {/* Arrow: Market → TWAP */}
        <line x1="320" y1="158" x2="375" y2="158" stroke="#06B6D4" strokeWidth="2" className="flow-line" style={{animationDelay: "0.3s"}}/>
        <polygon points="373,153 383,158 373,163" fill="#06B6D4"/>

        {/* TWAP Observation */}
        <g className="flow-node">
          <rect x="385" y="130" width="130" height="56" rx="8" fill="#7C3AED" stroke="#A78BFA" strokeWidth="1.5"/>
          <text x="450" y="153" className="flow-label" textAnchor="middle">TWAP Window</text>
          <text x="450" y="170" className="flow-sublabel" textAnchor="middle">Manipulation-resistant</text>
        </g>

        {/* Arrow: TWAP → Resolution */}
        <line x1="515" y1="158" x2="560" y2="158" stroke="#06B6D4" strokeWidth="2" className="flow-line" style={{animationDelay: "0.6s"}}/>
        <polygon points="558,153 568,158 558,163" fill="#06B6D4"/>

        {/* Resolution */}
        <g className="flow-node">
          <rect x="570" y="120" width="130" height="76" rx="8" fill="#1E293B" stroke="#F59E0B" strokeWidth="1.5"/>
          <text x="635" y="148" className="flow-label" textAnchor="middle">Resolution</text>
          <text x="635" y="165" className="flow-sublabel" textAnchor="middle">Winner determined</text>
          <text x="635" y="180" className="flow-sublabel" textAnchor="middle">Battle tax applied</text>
        </g>

        {/* Arrow: Resolution → Graduation */}
        <line x1="700" y1="158" x2="745" y2="158" stroke="#10B981" strokeWidth="2" className="flow-line" style={{animationDelay: "0.9s"}}/>
        <polygon points="743,153 753,158 743,163" fill="#10B981"/>

        {/* Graduation / DEX */}
        <g className="flow-node">
          <rect x="755" y="120" width="130" height="76" rx="8" fill="#065F46" stroke="#10B981" strokeWidth="1.5"/>
          <text x="820" y="148" className="flow-label" textAnchor="middle">Graduation</text>
          <text x="820" y="165" className="flow-sublabel" textAnchor="middle">→ Meteora DAMM v2</text>
          <text x="820" y="180" className="flow-sublabel" textAnchor="middle">Permanent liquidity</text>
        </g>

        {/* Protocol Fee - branching down from Resolution */}
        <line x1="635" y1="196" x2="635" y2="250" stroke="#F59E0B" strokeWidth="1.5" strokeDasharray="5 3"/>
        <g className="flow-node">
          <rect x="570" y="255" width="130" height="50" rx="8" fill="#1E293B" stroke="#F59E0B" strokeWidth="1"/>
          <text x="635" y="276" className="flow-label" textAnchor="middle" style={{fontSize: 11}}>Protocol Fee</text>
          <text x="635" y="292" className="flow-sublabel" textAnchor="middle">Configurable bps</text>
        </g>

        {/* Status dots along the timeline */}
        <circle cx="165" cy="158" r="4" fill="#06B6D4">
          <animate attributeName="opacity" values="1;0.3;1" dur="2s" repeatCount="indefinite"/>
        </circle>
        <circle cx="360" cy="158" r="4" fill="#06B6D4">
          <animate attributeName="opacity" values="1;0.3;1" dur="2s" begin="0.5s" repeatCount="indefinite"/>
        </circle>
        <circle cx="545" cy="158" r="4" fill="#F59E0B">
          <animate attributeName="opacity" values="1;0.3;1" dur="2s" begin="1s" repeatCount="indefinite"/>
        </circle>
        <circle cx="730" cy="158" r="4" fill="#10B981">
          <animate attributeName="opacity" values="1;0.3;1" dur="2s" begin="1.5s" repeatCount="indefinite"/>
        </circle>
      </svg>

      <div className="flow-legend">
        <div className="flow-legend-item">
          <div className="flow-legend-line" style={{background: "#06B6D4"}}/>
          <span>Direct flow</span>
        </div>
        <div className="flow-legend-item">
          <div className="flow-legend-line" style={{background: "#06B6D4", borderTop: "2px dashed #06B6D4", height: 0}}/>
          <span>Side association</span>
        </div>
        <div className="flow-legend-item">
          <div className="flow-legend-line" style={{background: "#10B981"}}/>
          <span>Graduation</span>
        </div>
        <div className="flow-legend-item">
          <div className="flow-legend-line" style={{background: "#F59E0B", borderTop: "2px dashed #F59E0B", height: 0}}/>
          <span>Fee collection</span>
        </div>
      </div>
    </div>
  );
}

// ─── SVG Flow Diagram: Fund Flow ───
function FundFlowDiagram() {
  return (
    <div className="flow-container">
      <svg viewBox="0 0 900 280" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* User */}
        <g className="flow-node">
          <rect x="30" y="100" width="110" height="56" rx="8" fill="#1E293B" stroke="#06B6D4" strokeWidth="1.5"/>
          <text x="85" y="123" className="flow-label" textAnchor="middle">User</text>
          <text x="85" y="140" className="flow-sublabel" textAnchor="middle">Buys with SOL</text>
        </g>

        {/* Arrow */}
        <line x1="140" y1="128" x2="185" y2="128" stroke="#06B6D4" strokeWidth="2" className="flow-line"/>
        <polygon points="183,123 193,128 183,133" fill="#06B6D4"/>

        {/* SOL Vault */}
        <g className="flow-node">
          <rect x="195" y="100" width="110" height="56" rx="8" fill="#0F766E" stroke="#14B8A6" strokeWidth="1.5"/>
          <text x="250" y="123" className="flow-label" textAnchor="middle">SOL Vault</text>
          <text x="250" y="140" className="flow-sublabel" textAnchor="middle">Reserve pool</text>
        </g>

        {/* Branch up: Battle Tax */}
        <line x1="305" y1="100" x2="370" y2="50" stroke="#F59E0B" strokeWidth="1.5" className="flow-line" style={{animationDelay: "0.4s"}}/>
        <g className="flow-node">
          <rect x="370" y="22" width="130" height="56" rx="8" fill="#1E293B" stroke="#F59E0B" strokeWidth="1"/>
          <text x="435" y="45" className="flow-label" textAnchor="middle">Battle Tax</text>
          <text x="435" y="62" className="flow-sublabel" textAnchor="middle">Winner gets loser&apos;s %</text>
        </g>

        {/* Main flow continues */}
        <line x1="305" y1="128" x2="370" y2="128" stroke="#06B6D4" strokeWidth="2" className="flow-line" style={{animationDelay: "0.3s"}}/>
        <polygon points="368,123 378,128 368,133" fill="#06B6D4"/>

        {/* Winner Vault */}
        <g className="flow-node">
          <rect x="380" y="100" width="130" height="56" rx="8" fill="#7C3AED" stroke="#A78BFA" strokeWidth="1.5"/>
          <text x="445" y="123" className="flow-label" textAnchor="middle">Winner Vault</text>
          <text x="445" y="140" className="flow-sublabel" textAnchor="middle">Enhanced reserve</text>
        </g>

        {/* Arrow to Pool */}
        <line x1="510" y1="128" x2="575" y2="128" stroke="#10B981" strokeWidth="2" className="flow-line" style={{animationDelay: "0.6s"}}/>
        <polygon points="573,123 583,128 573,133" fill="#10B981"/>

        {/* Meteora Pool */}
        <g className="flow-node">
          <rect x="585" y="90" width="140" height="76" rx="8" fill="#065F46" stroke="#10B981" strokeWidth="1.5"/>
          <text x="655" y="118" className="flow-label" textAnchor="middle">Meteora Pool</text>
          <text x="655" y="135" className="flow-sublabel" textAnchor="middle">DAMM v2 liquidity</text>
          <text x="655" y="150" className="flow-sublabel" textAnchor="middle">Token / WSOL pair</text>
        </g>

        {/* Arrow to LP Fees */}
        <line x1="725" y1="128" x2="770" y2="128" stroke="#10B981" strokeWidth="2" className="flow-line" style={{animationDelay: "0.9s"}}/>
        <polygon points="768,123 778,128 768,133" fill="#10B981"/>

        {/* LP Fees */}
        <g className="flow-node">
          <rect x="780" y="100" width="100" height="56" rx="8" fill="#1E293B" stroke="#10B981" strokeWidth="1"/>
          <text x="830" y="123" className="flow-label" textAnchor="middle" style={{fontSize: 12}}>LP Fees</text>
          <text x="830" y="140" className="flow-sublabel" textAnchor="middle">Claimable</text>
        </g>

        {/* Branch down: Protocol Fee */}
        <line x1="250" y1="156" x2="250" y2="210" stroke="#F59E0B" strokeWidth="1.5" strokeDasharray="5 3"/>
        <g className="flow-node">
          <rect x="195" y="210" width="110" height="50" rx="8" fill="#1E293B" stroke="#F59E0B" strokeWidth="1"/>
          <text x="250" y="231" className="flow-label" textAnchor="middle" style={{fontSize: 11}}>Protocol Fee</text>
          <text x="250" y="247" className="flow-sublabel" textAnchor="middle">0-5%</text>
        </g>

        {/* Animated dot along path */}
        <circle r="3.5" fill="#06B6D4">
          <animateMotion dur="4s" repeatCount="indefinite" path="M85,128 L250,128 L445,128 L655,128 L830,128"/>
        </circle>
      </svg>

      <div className="flow-legend">
        <div className="flow-legend-item">
          <div className="flow-legend-line" style={{background: "#06B6D4"}}/>
          <span>SOL flow</span>
        </div>
        <div className="flow-legend-item">
          <div className="flow-legend-line" style={{background: "#10B981"}}/>
          <span>Graduation flow</span>
        </div>
        <div className="flow-legend-item">
          <div className="flow-legend-line" style={{background: "#F59E0B"}}/>
          <span>Fee extraction</span>
        </div>
      </div>
    </div>
  );
}

export default function DocsPage() {
  return (
    <div className="docs-page">
      {/* Navigation */}
      <nav className="docs-nav">
        <div className="docs-nav-inner">
          <a href="/" className="docs-nav-logo">
            <span className="docs-nav-logo-text">Duel Protocol</span>
            <span className="docs-nav-logo-badge">v0.1</span>
          </a>
          <ul className="docs-nav-links">
            <li><a href="#overview">Overview</a></li>
            <li><a href="#how-it-works">How It Works</a></li>
            <li><a href="#fund-flow">Fund Flow</a></li>
            <li><a href="#features">Features</a></li>
            <li><a href="#sdk">SDK</a></li>
            <li><a href="https://github.com" target="_blank" rel="noopener">GitHub →</a></li>
          </ul>
        </div>
      </nav>

      {/* Hero */}
      <section className="docs-hero">
        <h1>TWAP-Resolved Bonding Curves</h1>
        <p>
          A general-purpose on-chain primitive for binary outcome markets with
          self-contained liquidity, manipulation-resistant resolution, and
          automated DEX graduation on Solana.
        </p>
        <div className="docs-hero-badges">
          <span className="docs-badge"><span className="docs-badge-dot"/> Solana Mainnet</span>
          <span className="docs-badge">⚡ Meteora DAMM v2</span>
          <span className="docs-badge">🔒 Configurable LP Lock</span>
          <span className="docs-badge">📊 TWAP Oracle</span>
        </div>
      </section>

      {/* Market Lifecycle Flow */}
      <section className="docs-section" id="how-it-works">
        <div className="docs-section-header">
          <h2>Market Lifecycle</h2>
          <p>
            Every market flows through four distinct phases — from creation to permanent 
            DEX liquidity. The TWAP oracle ensures manipulation-resistant resolution.
          </p>
        </div>
        <MarketLifecycleFlow />
      </section>

      {/* Fund Flow */}
      <section className="docs-section" id="fund-flow" style={{paddingTop: 0}}>
        <div className="docs-section-header">
          <h2>Fund Flow &amp; Capital Efficiency</h2>
          <p>
            SOL flows into bonding curve vaults, winners inherit a portion of losing reserves 
            via configurable battle tax, then graduated liquidity earns LP fees forever.
          </p>
        </div>
        <FundFlowDiagram />
      </section>

      {/* Features */}
      <section className="docs-section" id="features" style={{paddingTop: 0}}>
        <div className="docs-section-header">
          <h2>Key Features</h2>
          <p>Every component is composable, permissionless, and fully on-chain.</p>
        </div>
        <div className="feature-grid">
          <div className="feature-card">
            <div className="feature-card-icon">🎯</div>
            <h3>Dual Bonding Curves</h3>
            <p>Each market has two independent curves (Side A &amp; B). Price is a pure function of supply — no external liquidity needed.</p>
          </div>
          <div className="feature-card">
            <div className="feature-card-icon" style={{background: "linear-gradient(135deg, #EDE9FE, #DDD6FE)"}}>📊</div>
            <h3>TWAP Resolution</h3>
            <p>Time-weighted average price over a configurable window. Eliminates last-second manipulation attacks.</p>
          </div>
          <div className="feature-card">
            <div className="feature-card-icon" style={{background: "linear-gradient(135deg, #FEF3C7, #FDE68A)"}}>⚔️</div>
            <h3>Battle Tax</h3>
            <p>Configurable percentage of loser&apos;s reserve transfers to winner&apos;s curve. Winners sell into a fatter curve.</p>
          </div>
          <div className="feature-card">
            <div className="feature-card-icon" style={{background: "linear-gradient(135deg, #ECFDF5, #A7F3D0)"}}>🎓</div>
            <h3>DEX Graduation</h3>
            <p>Post-resolution, token liquidity automatically graduates to Meteora DAMM v2 pools for permanent trading.</p>
          </div>
          <div className="feature-card">
            <div className="feature-card-icon" style={{background: "linear-gradient(135deg, #FEE2E2, #FECACA)"}}>🔒</div>
            <h3>Configurable LP Lock</h3>
            <p>Market creators choose: PermanentLock (LP locked forever, fees only) or Unlocked (full LP management).</p>
          </div>
          <div className="feature-card">
            <div className="feature-card-icon" style={{background: "linear-gradient(135deg, #DBEAFE, #BFDBFE)"}}>🛡️</div>
            <h3>Sell Protection</h3>
            <p>Configurable sell penalty near deadline prevents front-running the resolution outcome.</p>
          </div>
        </div>
      </section>

      {/* Architecture */}
      <section className="docs-section" style={{paddingTop: 0}}>
        <div className="docs-section-header">
          <h2>Architecture</h2>
          <p>On-chain accounts and their relationships.</p>
        </div>
        <div className="arch-grid">
          <div className="arch-card">
            <div className="arch-card-header">
              <span style={{fontSize: "1.2rem"}}>📄</span>
              <h3>Market Account</h3>
            </div>
            <p>Stores authority, deadline, TWAP config, battle tax, LP lock mode, graduation status, and curve parameters. ~300 bytes with 61 bytes reserved.</p>
          </div>
          <div className="arch-card">
            <div className="arch-card-header">
              <span style={{fontSize: "1.2rem"}}>🪙</span>
              <h3>Side Account (×2)</h3>
            </div>
            <p>Each side tracks its token mint, token vault, SOL vault, supply, and TWAP accumulator. Linked to the Market PDA.</p>
          </div>
          <div className="arch-card">
            <div className="arch-card-header">
              <span style={{fontSize: "1.2rem"}}>💧</span>
              <h3>Meteora Position</h3>
            </div>
            <p>Created during graduation via CPI. Market PDA owns the position NFT, enabling fee claiming and LP management.</p>
          </div>
          <div className="arch-card">
            <div className="arch-card-header">
              <span style={{fontSize: "1.2rem"}}>🏊</span>
              <h3>DAMM v2 Pool</h3>
            </div>
            <p>Customizable constant-product AMM. Token/WSOL pair with configurable fees ands sqrt price range.</p>
          </div>
        </div>
      </section>

      {/* SDK Reference */}
      <section className="docs-section" id="sdk" style={{paddingTop: 0}}>
        <div className="docs-section-header">
          <h2>On-Chain Instructions</h2>
          <p>Complete instruction set for the Duel Protocol program.</p>
        </div>
        <div className="sdk-table-wrap">
          <table className="sdk-table">
            <thead>
              <tr>
                <th>Instruction</th>
                <th>Phase</th>
                <th>Description</th>
                <th>Gate</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code>initialize_market</code></td>
                <td>Setup</td>
                <td>Creates market with dual bonding curves, mints, vaults, and metadata</td>
                <td>—</td>
              </tr>
              <tr>
                <td><code>buy_tokens</code></td>
                <td>Trading</td>
                <td>Buy tokens on either side&apos;s bonding curve with SOL</td>
                <td>Market active</td>
              </tr>
              <tr>
                <td><code>sell_tokens</code></td>
                <td>Trading</td>
                <td>Sell tokens back to the bonding curve for SOL</td>
                <td>Market active</td>
              </tr>
              <tr>
                <td><code>record_twap_sample</code></td>
                <td>TWAP</td>
                <td>Record a price observation during the TWAP window</td>
                <td>In observation window</td>
              </tr>
              <tr>
                <td><code>resolve_market</code></td>
                <td>Resolution</td>
                <td>Determine winner from TWAP, apply battle tax, collect protocol fee</td>
                <td>Past deadline</td>
              </tr>
              <tr>
                <td><code>sell_post_resolution</code></td>
                <td>Claims</td>
                <td>Sell winning tokens at enhanced curve (post-battle-tax)</td>
                <td>Resolved</td>
              </tr>
              <tr>
                <td><code>graduate_to_dex</code></td>
                <td>Graduation</td>
                <td>Migrate side&apos;s remaining liquidity to Meteora DAMM v2 pool</td>
                <td>Resolved, not yet graduated</td>
              </tr>
              <tr>
                <td><code>claim_pool_fees</code></td>
                <td>Post-Grad</td>
                <td>Claim LP trading fees from the Meteora pool</td>
                <td>Graduated</td>
              </tr>
              <tr>
                <td><code>lock_position</code></td>
                <td>Post-Grad</td>
                <td>Permanently lock LP liquidity (fees still claimable)</td>
                <td>Graduated</td>
              </tr>
              <tr>
                <td><code>remove_liquidity</code></td>
                <td>Post-Grad</td>
                <td>Withdraw LP position from Meteora pool</td>
                <td>Graduated + Unlocked mode</td>
              </tr>
              <tr>
                <td><code>close_position</code></td>
                <td>Post-Grad</td>
                <td>Close position NFT and recover rent</td>
                <td>Graduated + Unlocked + empty</td>
              </tr>
              <tr>
                <td><code>close_sol_vault</code></td>
                <td>Cleanup</td>
                <td>Close SOL vault and recover rent-exempt lamports</td>
                <td>Graduated</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Code example */}
        <div className="code-block">
          <pre>{`<span class="code-comment">// Create a market with permanent LP lock</span>
<span class="code-keyword">await</span> program.methods
  .initializeMarket(
    marketId,
    <span class="code-keyword">new</span> BN(deadline),
    <span class="code-keyword">new</span> BN(twapWindow),
    <span class="code-keyword">new</span> BN(twapInterval),
    <span class="code-number">5000</span>,           <span class="code-comment">// 50% battle tax</span>
    <span class="code-number">100</span>,            <span class="code-comment">// 1% protocol fee</span>
    <span class="code-number">1000</span>,           <span class="code-comment">// 10% max sell penalty</span>
    <span class="code-keyword">new</span> BN(<span class="code-number">300</span>),     <span class="code-comment">// 5 min protection offset</span>
    curveParams,
    totalSupply,
    <span class="code-string">"Side A"</span>, <span class="code-string">"DUEL-A"</span>, <span class="code-string">""</span>,
    <span class="code-string">"Side B"</span>, <span class="code-string">"DUEL-B"</span>, <span class="code-string">""</span>,
    { <span class="code-keyword">permanentLock</span>: {} }  <span class="code-comment">// LP locked forever</span>
  )
  .accountsStrict({ <span class="code-comment">/* ... */</span> })
  .rpc();`}</pre>
        </div>
      </section>

      {/* Footer */}
      <footer className="docs-footer">
        <p>Duel Protocol — Built on Solana · Liquidity on Meteora · Open Source</p>
      </footer>
    </div>
  );
}
