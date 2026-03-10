"use client";
import "./docs.css";

// ─── Color palette for white-theme SVG diagrams ───
const C = {
  // Node fills (pastel backgrounds)
  gray: "#F3F4F6",
  teal: "#CCFBF1",
  purple: "#EDE9FE",
  amber: "#FEF3C7",
  green: "#D1FAE5",
  blue: "#DBEAFE",
  // Node strokes
  grayStroke: "#9CA3AF",
  tealStroke: "#14B8A6",
  purpleStroke: "#8B5CF6",
  amberStroke: "#F59E0B",
  greenStroke: "#10B981",
  blueStroke: "#3B82F6",
  // Text
  dark: "#111827",
  mid: "#6B7280",
};

// ─── SVG Flow Diagram: Market Lifecycle ───
function MarketLifecycleFlow() {
  // Node positions (center x, y) — clean left→right horizontal flow
  const nodes = [
    { x: 70,  y: 160, w: 120, h: 56, label: "Creator",      sub: "Any wallet",           fill: C.gray,   stroke: C.grayStroke },
    { x: 260, y: 160, w: 140, h: 72, label: "Market PDA",    sub: "Dual bonding curves",  fill: C.teal,   stroke: C.tealStroke, sub2: "TWAP oracle" },
    { x: 470, y: 160, w: 140, h: 56, label: "TWAP Window",   sub: "Manipulation-resistant",fill: C.purple, stroke: C.purpleStroke },
    { x: 670, y: 160, w: 130, h: 72, label: "Resolution",    sub: "Winner determined",    fill: C.amber,  stroke: C.amberStroke, sub2: "Battle tax applied" },
    { x: 860, y: 160, w: 130, h: 72, label: "Graduation",    sub: "→ Meteora DAMM v2",   fill: C.green,  stroke: C.greenStroke, sub2: "Permanent liquidity" },
  ];

  // Side nodes
  const sideA = { x: 260, y: 50,  w: 130, h: 50, label: "Side A", sub: "Token + SOL vault", fill: C.blue, stroke: C.blueStroke };
  const sideB = { x: 260, y: 280, w: 130, h: 50, label: "Side B", sub: "Token + SOL vault", fill: C.purple, stroke: C.purpleStroke };
  const protocolFee = { x: 670, y: 290, w: 120, h: 46, label: "Protocol Fee", sub: "Configurable bps", fill: C.amber, stroke: C.amberStroke };

  return (
    <div className="flow-container">
      <svg viewBox="0 0 960 350" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <marker id="arrowTeal" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0,0 8,3 0,6" fill={C.tealStroke} />
          </marker>
          <marker id="arrowPurple" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0,0 8,3 0,6" fill={C.purpleStroke} />
          </marker>
          <marker id="arrowGreen" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0,0 8,3 0,6" fill={C.greenStroke} />
          </marker>
          <marker id="arrowAmber" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0,0 8,3 0,6" fill={C.amberStroke} />
          </marker>
        </defs>

        {/* Main horizontal arrows */}
        <line x1={nodes[0].x + nodes[0].w/2} y1="160" x2={nodes[1].x - nodes[1].w/2 - 2} y2="160"
          stroke={C.tealStroke} strokeWidth="2" markerEnd="url(#arrowTeal)" />
        <line x1={nodes[1].x + nodes[1].w/2} y1="160" x2={nodes[2].x - nodes[2].w/2 - 2} y2="160"
          stroke={C.purpleStroke} strokeWidth="2" markerEnd="url(#arrowPurple)" />
        <line x1={nodes[2].x + nodes[2].w/2} y1="160" x2={nodes[3].x - nodes[3].w/2 - 2} y2="160"
          stroke={C.amberStroke} strokeWidth="2" markerEnd="url(#arrowAmber)" />
        <line x1={nodes[3].x + nodes[3].w/2} y1="160" x2={nodes[4].x - nodes[4].w/2 - 2} y2="160"
          stroke={C.greenStroke} strokeWidth="2" markerEnd="url(#arrowGreen)" />

        {/* Side A dashed connector */}
        <line x1="260" y1={sideA.y + sideA.h/2 + sideA.h/2} x2="260" y2={nodes[1].y - nodes[1].h/2}
          stroke={C.blueStroke} strokeWidth="1.5" strokeDasharray="5 3" />
        {/* Side B dashed connector */}
        <line x1="260" y1={nodes[1].y + nodes[1].h/2} x2="260" y2={sideB.y - sideB.h/2}
          stroke={C.purpleStroke} strokeWidth="1.5" strokeDasharray="5 3" />
        {/* Protocol fee dashed connector */}
        <line x1="670" y1={nodes[3].y + nodes[3].h/2} x2="670" y2={protocolFee.y - protocolFee.h/2}
          stroke={C.amberStroke} strokeWidth="1.5" strokeDasharray="5 3" />

        {/* Main nodes */}
        {nodes.map((n, i) => (
          <g key={i} className="flow-node">
            <rect x={n.x - n.w/2} y={n.y - n.h/2} width={n.w} height={n.h} rx="10"
              fill={n.fill} stroke={n.stroke} strokeWidth="1.5" />
            <text x={n.x} y={n.sub2 ? n.y - 6 : n.y - 2} textAnchor="middle"
              className="flow-label" fill={C.dark}>{n.label}</text>
            <text x={n.x} y={n.sub2 ? n.y + 10 : n.y + 14} textAnchor="middle"
              className="flow-sublabel" fill={C.mid}>{n.sub}</text>
            {n.sub2 && (
              <text x={n.x} y={n.y + 24} textAnchor="middle"
                className="flow-sublabel" fill={C.mid}>{n.sub2}</text>
            )}
          </g>
        ))}

        {/* Side A node */}
        <g className="flow-node">
          <rect x={sideA.x - sideA.w/2} y={sideA.y - sideA.h/2} width={sideA.w} height={sideA.h} rx="8"
            fill={sideA.fill} stroke={sideA.stroke} strokeWidth="1.5" />
          <text x={sideA.x} y={sideA.y - 4} textAnchor="middle" className="flow-label" fill={C.dark}>{sideA.label}</text>
          <text x={sideA.x} y={sideA.y + 12} textAnchor="middle" className="flow-sublabel" fill={C.mid}>{sideA.sub}</text>
        </g>

        {/* Side B node */}
        <g className="flow-node">
          <rect x={sideB.x - sideB.w/2} y={sideB.y - sideB.h/2} width={sideB.w} height={sideB.h} rx="8"
            fill={sideB.fill} stroke={sideB.stroke} strokeWidth="1.5" />
          <text x={sideB.x} y={sideB.y - 4} textAnchor="middle" className="flow-label" fill={C.dark}>{sideB.label}</text>
          <text x={sideB.x} y={sideB.y + 12} textAnchor="middle" className="flow-sublabel" fill={C.mid}>{sideB.sub}</text>
        </g>

        {/* Protocol Fee node */}
        <g className="flow-node">
          <rect x={protocolFee.x - protocolFee.w/2} y={protocolFee.y - protocolFee.h/2}
            width={protocolFee.w} height={protocolFee.h} rx="8"
            fill={protocolFee.fill} stroke={protocolFee.stroke} strokeWidth="1" />
          <text x={protocolFee.x} y={protocolFee.y - 4} textAnchor="middle" className="flow-label" fill={C.dark} style={{fontSize: 11}}>{protocolFee.label}</text>
          <text x={protocolFee.x} y={protocolFee.y + 12} textAnchor="middle" className="flow-sublabel" fill={C.mid}>{protocolFee.sub}</text>
        </g>

        {/* Animated flowing dot along main path */}
        <circle r="5" fill={C.tealStroke} opacity="0.8">
          <animateMotion
            dur="5s"
            repeatCount="indefinite"
            path={`M ${nodes[0].x + nodes[0].w/2},160 L ${nodes[1].x - nodes[1].w/2},160 L ${nodes[1].x + nodes[1].w/2},160 L ${nodes[2].x - nodes[2].w/2},160 L ${nodes[2].x + nodes[2].w/2},160 L ${nodes[3].x - nodes[3].w/2},160 L ${nodes[3].x + nodes[3].w/2},160 L ${nodes[4].x - nodes[4].w/2},160`}
          />
        </circle>

        {/* Second animated dot offset */}
        <circle r="4" fill={C.greenStroke} opacity="0.6">
          <animateMotion
            dur="5s"
            begin="2.5s"
            repeatCount="indefinite"
            path={`M ${nodes[0].x + nodes[0].w/2},160 L ${nodes[1].x - nodes[1].w/2},160 L ${nodes[1].x + nodes[1].w/2},160 L ${nodes[2].x - nodes[2].w/2},160 L ${nodes[2].x + nodes[2].w/2},160 L ${nodes[3].x - nodes[3].w/2},160 L ${nodes[3].x + nodes[3].w/2},160 L ${nodes[4].x - nodes[4].w/2},160`}
          />
        </circle>
      </svg>

      <div className="flow-legend">
        <div className="flow-legend-item">
          <div className="flow-legend-line" style={{background: C.tealStroke}} />
          <span>Direct flow</span>
        </div>
        <div className="flow-legend-item">
          <div className="flow-legend-line-dashed" style={{borderColor: C.blueStroke}} />
          <span>Side association</span>
        </div>
        <div className="flow-legend-item">
          <div className="flow-legend-line" style={{background: C.greenStroke}} />
          <span>Graduation</span>
        </div>
        <div className="flow-legend-item">
          <div className="flow-legend-line-dashed" style={{borderColor: C.amberStroke}} />
          <span>Fee collection</span>
        </div>
      </div>
    </div>
  );
}

// ─── SVG Flow Diagram: Fund Flow ───
function FundFlowDiagram() {
  const nodes = [
    { x: 80,  y: 140, w: 110, h: 56, label: "User",         sub: "Buys with SOL",      fill: C.blue,   stroke: C.blueStroke },
    { x: 260, y: 140, w: 120, h: 56, label: "SOL Vault",     sub: "Reserve pool",       fill: C.teal,   stroke: C.tealStroke },
    { x: 460, y: 140, w: 130, h: 56, label: "Winner Vault",  sub: "Enhanced reserve",   fill: C.purple, stroke: C.purpleStroke },
    { x: 660, y: 140, w: 150, h: 72, label: "Meteora Pool",  sub: "DAMM v2 liquidity",  fill: C.green,  stroke: C.greenStroke, sub2: "Token / WSOL pair" },
    { x: 860, y: 140, w: 100, h: 56, label: "LP Fees",       sub: "Claimable",          fill: C.gray,   stroke: C.grayStroke },
  ];
  const battleTax = { x: 390, y: 40, w: 130, h: 50, label: "Battle Tax", sub: "Winner gets loser's %", fill: C.amber, stroke: C.amberStroke };
  const protocolFee = { x: 260, y: 250, w: 120, h: 46, label: "Protocol Fee", sub: "0-5%", fill: C.amber, stroke: C.amberStroke };

  return (
    <div className="flow-container">
      <svg viewBox="0 0 960 300" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <marker id="arrowTeal2" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0,0 8,3 0,6" fill={C.tealStroke} />
          </marker>
          <marker id="arrowPurple2" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0,0 8,3 0,6" fill={C.purpleStroke} />
          </marker>
          <marker id="arrowGreen2" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0,0 8,3 0,6" fill={C.greenStroke} />
          </marker>
          <marker id="arrowAmber2" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0,0 8,3 0,6" fill={C.amberStroke} />
          </marker>
        </defs>

        {/* Main horizontal arrows */}
        <line x1={nodes[0].x + nodes[0].w/2} y1="140" x2={nodes[1].x - nodes[1].w/2 - 2} y2="140"
          stroke={C.tealStroke} strokeWidth="2" markerEnd="url(#arrowTeal2)" />
        <line x1={nodes[1].x + nodes[1].w/2} y1="140" x2={nodes[2].x - nodes[2].w/2 - 2} y2="140"
          stroke={C.purpleStroke} strokeWidth="2" markerEnd="url(#arrowPurple2)" />
        <line x1={nodes[2].x + nodes[2].w/2} y1="140" x2={nodes[3].x - nodes[3].w/2 - 2} y2="140"
          stroke={C.greenStroke} strokeWidth="2" markerEnd="url(#arrowGreen2)" />
        <line x1={nodes[3].x + nodes[3].w/2} y1="140" x2={nodes[4].x - nodes[4].w/2 - 2} y2="140"
          stroke={C.greenStroke} strokeWidth="2" markerEnd="url(#arrowGreen2)" />

        {/* Battle Tax diagonal arrow from SOL Vault up to Battle Tax */}
        <line x1={nodes[1].x + nodes[1].w/2 - 10} y1={nodes[1].y - nodes[1].h/2}
          x2={battleTax.x - battleTax.w/2} y2={battleTax.y + battleTax.h/2 - 5}
          stroke={C.amberStroke} strokeWidth="1.5" markerEnd="url(#arrowAmber2)" />

        {/* Protocol Fee dashed down */}
        <line x1="260" y1={nodes[1].y + nodes[1].h/2} x2="260" y2={protocolFee.y - protocolFee.h/2}
          stroke={C.amberStroke} strokeWidth="1.5" strokeDasharray="5 3" />

        {/* Main nodes */}
        {nodes.map((n, i) => (
          <g key={i} className="flow-node">
            <rect x={n.x - n.w/2} y={n.y - n.h/2} width={n.w} height={n.h} rx="10"
              fill={n.fill} stroke={n.stroke} strokeWidth="1.5" />
            <text x={n.x} y={n.sub2 ? n.y - 6 : n.y - 2} textAnchor="middle"
              className="flow-label" fill={C.dark}>{n.label}</text>
            <text x={n.x} y={n.sub2 ? n.y + 10 : n.y + 14} textAnchor="middle"
              className="flow-sublabel" fill={C.mid}>{n.sub}</text>
            {n.sub2 && (
              <text x={n.x} y={n.y + 24} textAnchor="middle"
                className="flow-sublabel" fill={C.mid}>{n.sub2}</text>
            )}
          </g>
        ))}

        {/* Battle Tax node */}
        <g className="flow-node">
          <rect x={battleTax.x - battleTax.w/2} y={battleTax.y - battleTax.h/2}
            width={battleTax.w} height={battleTax.h} rx="8"
            fill={battleTax.fill} stroke={battleTax.stroke} strokeWidth="1.5" />
          <text x={battleTax.x} y={battleTax.y - 4} textAnchor="middle" className="flow-label" fill={C.dark}>{battleTax.label}</text>
          <text x={battleTax.x} y={battleTax.y + 12} textAnchor="middle" className="flow-sublabel" fill={C.mid}>{battleTax.sub}</text>
        </g>

        {/* Protocol Fee node */}
        <g className="flow-node">
          <rect x={protocolFee.x - protocolFee.w/2} y={protocolFee.y - protocolFee.h/2}
            width={protocolFee.w} height={protocolFee.h} rx="8"
            fill={protocolFee.fill} stroke={protocolFee.stroke} strokeWidth="1" />
          <text x={protocolFee.x} y={protocolFee.y - 4} textAnchor="middle" className="flow-label" fill={C.dark} style={{fontSize: 11}}>{protocolFee.label}</text>
          <text x={protocolFee.x} y={protocolFee.y + 12} textAnchor="middle" className="flow-sublabel" fill={C.mid}>{protocolFee.sub}</text>
        </g>

        {/* Animated flowing dot */}
        <circle r="5" fill={C.tealStroke} opacity="0.8">
          <animateMotion
            dur="4s"
            repeatCount="indefinite"
            path={`M ${nodes[0].x + nodes[0].w/2},140 L ${nodes[1].x - nodes[1].w/2},140 L ${nodes[1].x + nodes[1].w/2},140 L ${nodes[2].x - nodes[2].w/2},140 L ${nodes[2].x + nodes[2].w/2},140 L ${nodes[3].x - nodes[3].w/2},140 L ${nodes[3].x + nodes[3].w/2},140 L ${nodes[4].x - nodes[4].w/2},140`}
          />
        </circle>

        {/* Second dot with offset */}
        <circle r="4" fill={C.greenStroke} opacity="0.6">
          <animateMotion
            dur="4s"
            begin="2s"
            repeatCount="indefinite"
            path={`M ${nodes[0].x + nodes[0].w/2},140 L ${nodes[1].x - nodes[1].w/2},140 L ${nodes[1].x + nodes[1].w/2},140 L ${nodes[2].x - nodes[2].w/2},140 L ${nodes[2].x + nodes[2].w/2},140 L ${nodes[3].x - nodes[3].w/2},140 L ${nodes[3].x + nodes[3].w/2},140 L ${nodes[4].x - nodes[4].w/2},140`}
          />
        </circle>
      </svg>

      <div className="flow-legend">
        <div className="flow-legend-item">
          <div className="flow-legend-line" style={{background: C.tealStroke}} />
          <span>SOL flow</span>
        </div>
        <div className="flow-legend-item">
          <div className="flow-legend-line" style={{background: C.greenStroke}} />
          <span>Graduation flow</span>
        </div>
        <div className="flow-legend-item">
          <div className="flow-legend-line-dashed" style={{borderColor: C.amberStroke}} />
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
            <h3>Token-2022 Support</h3>
            <p>Full support for both SPL Token and Token-2022 mints. Transfer fees, metadata extensions, and more.</p>
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
            <p>Stores authority, deadline, TWAP config, battle tax, LP lock mode, quote mint, graduation status, and curve parameters.</p>
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
            <p>Customizable constant-product AMM. Configurable quote token (WSOL default) with configurable fees and sqrt price range.</p>
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
          <pre>{`// Create a market with permanent LP lock
await program.methods
  .initializeMarket(
    marketId,
    new BN(deadline),
    new BN(twapWindow),
    new BN(twapInterval),
    5000,           // 50% battle tax
    100,            // 1% protocol fee
    1000,           // 10% max sell penalty
    new BN(300),    // 5 min protection offset
    curveParams,
    totalSupply,
    "Side A", "DUEL-A", "",
    "Side B", "DUEL-B", "",
    { permanentLock: {} }  // LP locked forever
  )
  .accountsStrict({ /* ... */ })
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
