"use client";

import { useState } from "react";
import Link from "next/link";
import styles from "./docs.module.css";

/* ─── SVG Icons ─── */
const IconChevronDown = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
);
const IconBolt = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
);
const IconTarget = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>
);
const IconTrendingUp = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>
);
const IconClock = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
);
const IconSwords = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" y1="19" x2="19" y2="13"/><line x1="16" y1="16" x2="20" y2="20"/><line x1="19" y1="21" x2="21" y2="19"/><polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5"/><line x1="5" y1="14" x2="9" y2="18"/><line x1="7" y1="17" x2="4" y2="20"/><line x1="3" y1="19" x2="5" y2="21"/></svg>
);
const IconDiamond = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2.7 10.3a2.41 2.41 0 0 0 0 3.41l7.59 7.59a2.41 2.41 0 0 0 3.41 0l7.59-7.59a2.41 2.41 0 0 0 0-3.41l-7.59-7.59a2.41 2.41 0 0 0-3.41 0Z"/></svg>
);
const IconShield = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
);
const IconArrowRight = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
);

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "lifecycle", label: "Duel Lifecycle" },
  { id: "trading", label: "Trading" },
  { id: "battle-tax", label: "Battle Tax" },
  { id: "resolution", label: "How Winners Are Decided" },
  { id: "graduation", label: "DEX Graduation" },
  { id: "sell-penalty", label: "Sell Penalty" },
  { id: "glossary", label: "Glossary" },
];

export default function DocsPage() {
  const [activeSection, setActiveSection] = useState("overview");

  const handleNavClick = (id: string) => {
    setActiveSection(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className={styles.docsLayout}>
      {/* ─── Sidebar Nav ─── */}
      <aside className={styles.sidebar}>
        <div className={styles.sidebarTitle}>Documentation</div>
        <nav className={styles.sidebarNav}>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              className={`${styles.sidebarLink} ${activeSection === s.id ? styles.sidebarLinkActive : ""}`}
              onClick={() => handleNavClick(s.id)}
            >
              {s.label}
            </button>
          ))}
        </nav>
        <div className={styles.sidebarCta}>
          <Link href="/duels" className="btn btn-yellow btn-sm" style={{ width: "100%" }}>
            Enter Arena <IconArrowRight />
          </Link>
        </div>
      </aside>

      {/* ─── Main Content ─── */}
      <main className={styles.content}>

        {/* ─── Overview ─── */}
        <section id="overview" className={styles.section}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionIcon}><IconBolt /></span>
            <h1 className={styles.sectionHeading}>What is Duels?</h1>
          </div>
          <p className={styles.paragraph}>
            Duels is a head-to-head battle platform on Solana. Create a duel between
            two sides — any topic, any matchup — and let the market decide the winner.
          </p>
          <div className={styles.calloutBox}>
            <strong>The core idea:</strong> Two sides battle. People buy tokens on the
            side they believe in. When the timer runs out, the side with more sustained
            market demand wins. The losing side&apos;s reserve gets taxed and redistributed
            to the winners.
          </div>
          <p className={styles.paragraph}>
            Duels are powered by <strong>bonding curves</strong>, which means instant pricing
            with no liquidity providers needed. You can buy and sell tokens at any time.
            Everything happens on-chain — no middlemen, no sign-ups, no waiting.
          </p>

          <div className={styles.cardGrid}>
            <div className={styles.infoCard}>
              <span className={styles.infoCardIcon}><IconTarget /></span>
              <h3>For Everyone</h3>
              <p>Create duels on anything — sports, crypto, memes, pop culture. If it has two sides, it can be a duel.</p>
            </div>
            <div className={styles.infoCard}>
              <span className={styles.infoCardIcon}><IconBolt /></span>
              <h3>Instant</h3>
              <p>Connect your Solana wallet and start in seconds. No accounts, no verification, no delays.</p>
            </div>
            <div className={styles.infoCard}>
              <span className={styles.infoCardIcon}><IconShield /></span>
              <h3>Fair</h3>
              <p>Winners are decided by sustained market demand, not a single big trade. Anti-manipulation by design.</p>
            </div>
          </div>
        </section>

        <div className={styles.divider} />

        {/* ─── Lifecycle ─── */}
        <section id="lifecycle" className={styles.section}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionIcon}><IconClock /></span>
            <h2 className={styles.sectionHeading}>Duel Lifecycle</h2>
          </div>
          <p className={styles.paragraph}>
            Every duel goes through a clear, predictable lifecycle:
          </p>

          <div className={styles.timeline}>
            <div className={styles.timelineItem}>
              <div className={styles.timelineNumber}>1</div>
              <div className={styles.timelineContent}>
                <h3>Creation</h3>
                <p>
                  A creator defines two sides (e.g., &quot;Bitcoin&quot; vs &quot;Ethereum&quot;), sets
                  a deadline, and configures the battle tax percentage. Two tokens are
                  automatically minted — one for each side — with their own bonding curves.
                </p>
              </div>
            </div>
            <div className={styles.timelineItem}>
              <div className={styles.timelineNumber}>2</div>
              <div className={styles.timelineContent}>
                <h3>Active Trading</h3>
                <p>
                  Anyone can buy or sell tokens on either side. Prices move based on demand
                  — more buyers = higher price. This phase lasts until the deadline.
                </p>
              </div>
            </div>
            <div className={styles.timelineItem}>
              <div className={styles.timelineNumber}>3</div>
              <div className={styles.timelineContent}>
                <h3>Observation Window</h3>
                <p>
                  In the final period before the deadline, the protocol starts recording
                  price samples at regular intervals. This builds a fair, time-weighted
                  picture of which side has more demand.
                </p>
              </div>
            </div>
            <div className={styles.timelineItem}>
              <div className={styles.timelineNumber}>4</div>
              <div className={styles.timelineContent}>
                <h3>Resolution</h3>
                <p>
                  After the deadline, the side with the higher time-weighted average price
                  is declared the winner. The Battle Tax is applied — a percentage of the
                  losing side&apos;s reserve is transferred to the winning side.
                </p>
              </div>
            </div>
            <div className={styles.timelineItem}>
              <div className={styles.timelineNumber}>5</div>
              <div className={styles.timelineContent}>
                <h3>Post-Resolution</h3>
                <p>
                  Winners can sell their tokens at a higher price (since the reserve grew).
                  The winning token can optionally graduate to Meteora, creating a permanent
                  DEX pool tradeable on Jupiter.
                </p>
              </div>
            </div>
          </div>
        </section>

        <div className={styles.divider} />

        {/* ─── Trading ─── */}
        <section id="trading" className={styles.section}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionIcon}><IconTrendingUp /></span>
            <h2 className={styles.sectionHeading}>Trading</h2>
          </div>
          <p className={styles.paragraph}>
            Trading on Duels works through <strong>bonding curves</strong> — a mathematical
            formula that automatically sets prices based on supply and demand.
          </p>

          <div className={styles.conceptBox}>
            <h3>How Pricing Works</h3>
            <div className={styles.conceptGrid}>
              <div>
                <div className={styles.conceptLabel}>Buying</div>
                <p>When you buy tokens, you pay SOL. The price goes up for the next buyer. Early believers get the best rates.</p>
              </div>
              <div>
                <div className={styles.conceptLabel}>Selling</div>
                <p>When you sell, you get SOL back. The price goes down. You can sell anytime during the active phase.</p>
              </div>
              <div>
                <div className={styles.conceptLabel}>Sentiment</div>
                <p>The sentiment bar shows how much SOL is on each side. It&apos;s a real-time indicator of which side the crowd favors.</p>
              </div>
              <div>
                <div className={styles.conceptLabel}>Quick Amounts</div>
                <p>Use the quick-buy buttons (0.1, 0.5, 1, 5 SOL) for fast entry, or type any custom amount.</p>
              </div>
            </div>
          </div>

          <div className={styles.tipBox}>
            <strong>Pro tip:</strong> Watch the sentiment bar. If you believe a side will win
            but it&apos;s currently behind, you might get tokens at a lower price — bigger potential
            upside if your side rallies.
          </div>
        </section>

        <div className={styles.divider} />

        {/* ─── Battle Tax ─── */}
        <section id="battle-tax" className={styles.section}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionIcon}><IconSwords /></span>
            <h2 className={styles.sectionHeading}>Battle Tax</h2>
          </div>
          <p className={styles.paragraph}>
            The Battle Tax is the core mechanic that makes Duels exciting.
            It&apos;s the &quot;winner takes from the loser&quot; mechanism.
          </p>

          <div className={styles.highlightGrid}>
            <div className={styles.highlightCard} style={{ borderColor: "rgba(251, 191, 36, 0.2)" }}>
              <div className={styles.highlightValue} style={{ color: "var(--text-yellow)" }}>Up to 50%</div>
              <div className={styles.highlightLabel}>of the losing side&apos;s reserve is transferred to winners</div>
            </div>
            <div className={styles.highlightCard} style={{ borderColor: "rgba(59, 130, 246, 0.2)" }}>
              <div className={styles.highlightValue} style={{ color: "var(--text-blue)" }}>Set Per Duel</div>
              <div className={styles.highlightLabel}>creators choose the tax rate when creating the duel</div>
            </div>
          </div>

          <div className={styles.exampleBox}>
            <h4>Example</h4>
            <p>
              A duel has 10 SOL on Side A and 10 SOL on Side B, with a 50% battle tax.
              Side A wins. <strong>5 SOL</strong> (50% of Side B&apos;s reserve) is moved to
              Side A&apos;s reserve. Now Side A has 15 SOL backing its tokens, while Side B
              has 5 SOL. If you held Side A tokens, each token is now worth more because
              the reserve grew.
            </p>
          </div>
        </section>

        <div className={styles.divider} />

        {/* ─── Resolution ─── */}
        <section id="resolution" className={styles.section}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionIcon}><IconTarget /></span>
            <h2 className={styles.sectionHeading}>How Winners Are Decided</h2>
          </div>
          <p className={styles.paragraph}>
            Winners aren&apos;t decided by a final snapshot — that would be easy to
            manipulate. Instead, Duels uses a <strong>Time-Weighted Average Price (TWAP)</strong>.
          </p>

          <div className={styles.conceptBox}>
            <h3>Why TWAP?</h3>
            <p className={styles.paragraph}>
              TWAP looks at prices over a window of time, not just one moment. This means
              a single whale can&apos;t swoop in at the last second to flip the result.
              Sustained demand over the observation window is what counts.
            </p>
            <div className={styles.conceptGrid}>
              <div>
                <div className={styles.conceptLabel}>Observation Window</div>
                <p>A period before the deadline where price samples are recorded on-chain at regular intervals.</p>
              </div>
              <div>
                <div className={styles.conceptLabel}>Price Samples</div>
                <p>The protocol records the current bonding curve price at each interval. These samples are averaged.</p>
              </div>
              <div>
                <div className={styles.conceptLabel}>Winner</div>
                <p>The side with the higher time-weighted average price across all samples wins the duel.</p>
              </div>
              <div>
                <div className={styles.conceptLabel}>Fully On-Chain</div>
                <p>No external oracles or judges. Everything is computed and verified on the Solana blockchain.</p>
              </div>
            </div>
          </div>
        </section>

        <div className={styles.divider} />

        {/* ─── Graduation ─── */}
        <section id="graduation" className={styles.section}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionIcon}><IconDiamond /></span>
            <h2 className={styles.sectionHeading}>DEX Graduation</h2>
          </div>
          <p className={styles.paragraph}>
            After resolution, the winning token can &quot;graduate&quot; to a real decentralized
            exchange. This means it gets a permanent trading pool — your winning token
            doesn&apos;t just earn from the battle tax, it becomes a tradeable asset on Jupiter.
          </p>

          <div className={styles.cardGrid}>
            <div className={styles.infoCard}>
              <h3>Meteora DAMM v2</h3>
              <p>Graduated tokens are deployed to Meteora&apos;s Dynamic AMM, which provides deep liquidity and efficient pricing.</p>
            </div>
            <div className={styles.infoCard}>
              <h3>Jupiter Routing</h3>
              <p>Once on Meteora, the token is automatically routed through Jupiter — Solana&apos;s largest DEX aggregator.</p>
            </div>
            <div className={styles.infoCard}>
              <h3>Trade Forever</h3>
              <p>The token lives on independently after graduation. It has its own liquidity pool and can be traded by anyone.</p>
            </div>
          </div>
        </section>

        <div className={styles.divider} />

        {/* ─── Sell Penalty ─── */}
        <section id="sell-penalty" className={styles.section}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionIcon}><IconShield /></span>
            <h2 className={styles.sectionHeading}>Sell Penalty</h2>
          </div>
          <p className={styles.paragraph}>
            To prevent last-second dumps that could unfairly affect the outcome,
            Duels applies a <strong>dynamic sell penalty</strong> as the deadline approaches.
          </p>

          <div className={styles.conceptBox}>
            <h3>How It Works</h3>
            <p className={styles.paragraph}>
              The penalty starts at 0% and gradually increases as the deadline gets closer.
              The maximum penalty is set by the duel creator (up to 15% by default).
              This encourages genuine conviction rather than last-second gaming.
            </p>
          </div>

          <div className={styles.tipBox}>
            <strong>Note:</strong> The sell penalty only applies during the active trading phase.
            After resolution, winners can sell freely at the new (higher) bonding curve price.
          </div>
        </section>

        <div className={styles.divider} />

        {/* ─── Glossary ─── */}
        <section id="glossary" className={styles.section}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionIcon}><IconBolt /></span>
            <h2 className={styles.sectionHeading}>Glossary</h2>
          </div>

          <div className={styles.glossaryGrid}>
            {[
              ["Duel", "A head-to-head market between two sides with a deadline and resolution mechanism."],
              ["Side", "One of the two options in a duel. Each side has its own token and bonding curve."],
              ["Bonding Curve", "A mathematical formula that automatically prices tokens based on supply. More buyers → higher price."],
              ["Battle Tax", "A percentage of the losing side's reserve that gets transferred to the winning side on resolution."],
              ["TWAP", "Time-Weighted Average Price — the method used to determine which side wins. It averages prices over a window of time for fairness."],
              ["Sentiment Bar", "The visual indicator showing how much SOL is on each side. It shifts as people buy and sell."],
              ["Observation Window", "The final period before deadline when price samples are recorded for TWAP calculation."],
              ["DEX Graduation", "When a winning token gets deployed to Meteora's DEX, creating a permanent trading pool."],
              ["Sell Penalty", "A gradually increasing fee for selling as the deadline approaches, preventing last-second dumps."],
              ["SOL", "Solana's native token, used as the payment currency for buying duel tokens."],
              ["Reserve", "The pool of SOL backing each side's tokens. Grows when people buy, shrinks when they sell."],
              ["Resolution", "The process of declaring a winner after the deadline, applying the battle tax, and settling the duel."],
            ].map(([term, def]) => (
              <div key={term as string} className={styles.glossaryItem}>
                <dt className={styles.glossaryTerm}>{term}</dt>
                <dd className={styles.glossaryDef}>{def}</dd>
              </div>
            ))}
          </div>
        </section>

        {/* ─── Bottom CTA ─── */}
        <div className={styles.bottomCta}>
          <h2>Ready to duel?</h2>
          <p>Browse active battles or create your own.</p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <Link href="/duels" className="btn btn-yellow">
              Browse Duels <IconArrowRight />
            </Link>
            <Link href="/create" className="btn btn-ghost">
              Create a Duel <IconArrowRight />
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
