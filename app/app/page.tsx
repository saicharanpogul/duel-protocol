"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "./page.module.css";

const FAQ_ITEMS = [
  {
    question: "What is a Duel?",
    answer:
      "A Duel is a binary outcome market where two sides compete. Each side has its own bonding curve token. Buy tokens on the side you believe in, and the market resolves via TWAP (Time-Weighted Average Price) — fully on-chain, no oracles.",
  },
  {
    question: "How does TWAP resolution work?",
    answer:
      "During the final observation window, the protocol samples prices at fixed intervals on-chain. The side with the higher time-weighted average price wins. This is manipulation-resistant — no single trade can swing the outcome.",
  },
  {
    question: "What are bonding curves?",
    answer:
      "Bonding curves provide instant, algorithmic pricing. When you buy tokens, the price increases. When you sell, it decreases. Early believers get better rates. No AMM pools or liquidity providers needed.",
  },
  {
    question: "What is the Battle Tax?",
    answer:
      "The Battle Tax (up to 50%) redistributes from the losing side's reserve to the winning side on resolution. It's the core incentive that makes duels competitive — winners take from losers.",
  },
  {
    question: "What happens after resolution?",
    answer:
      "Winners sell at an inflated curve (fatter from battle tax). The winning token can also graduate to Meteora DAMM v2, creating a permanent DEX pool that Jupiter routes through automatically.",
  },
  {
    question: "What tokens are supported?",
    answer:
      "SOL (wrapped SOL) is the primary quote token. The protocol supports any SPL token including USDC and Token-2022 assets via the quoteTokenProgram interface.",
  },
];

/* ─── Inline SVG Icons (solanafunded style) ─── */
const IconBolt = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
);
const IconTarget = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>
);
const IconTrendingUp = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>
);
const IconClock = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
);
const IconShield = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
);
const IconDiamond = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2.7 10.3a2.41 2.41 0 0 0 0 3.41l7.59 7.59a2.41 2.41 0 0 0 3.41 0l7.59-7.59a2.41 2.41 0 0 0 0-3.41l-7.59-7.59a2.41 2.41 0 0 0-3.41 0Z"/></svg>
);
const IconLock = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
);
const IconZap = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
);
const IconChevronDown = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
);
const IconArrowRight = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
);

export default function LandingPage() {
  const [mounted, setMounted] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  useEffect(() => setMounted(true), []);

  return (
    <div className={styles.landing}>
      {/* ─── Hero ─── */}
      <section className={styles.hero}>
        <div className={styles.heroMesh} />

        <div className={mounted ? "animate-fadeInUp" : ""} style={{ opacity: mounted ? 1 : 0 }}>
          <div className={styles.heroBadge}>
            <span className={styles.heroBadgeDot} />
            Live on Solana Devnet
          </div>

          <h1 className={styles.heroTitle}>
            Choose your{" "}
            <span className={styles.heroTitleYellow}>side</span>.
            <br />
            Win the <span className={styles.heroTitleBlue}>duel</span>.
          </h1>

          <p className={styles.heroSub}>
            Subjective prediction markets powered by bonding curves and
            TWAP&nbsp;resolution. No oracles. No liquidity providers.
            Pure&nbsp;market&nbsp;consensus.
          </p>

          <div className={styles.heroActions}>
            <Link href="/duels" className="btn btn-yellow btn-lg">
              Enter The Arena <IconArrowRight />
            </Link>
            <Link href="/create" className="btn btn-ghost btn-lg">
              Create a Duel <IconArrowRight />
            </Link>
          </div>
        </div>
      </section>

      {/* ─── Stats Bar ─── */}
      <section
        className={`${styles.statsBar} ${mounted ? "animate-fadeInUp animate-delay-2" : ""}`}
      >
        <div className={styles.statItem}>
          <div className={styles.statValue}>18</div>
          <div className={styles.statLabel}>Instructions</div>
        </div>
        <div className={styles.statItem}>
          <div className={styles.statValue}>TWAP</div>
          <div className={styles.statLabel}>Resolution</div>
        </div>
        <div className={styles.statItem}>
          <div className={styles.statValue}>50%</div>
          <div className={styles.statLabel}>Max Battle Tax</div>
        </div>
        <div className={styles.statItem}>
          <div className={styles.statValue}>SOL</div>
          <div className={styles.statLabel}>Quote Token</div>
        </div>
      </section>

      {/* ─── How It Works ─── */}
      <section className={styles.sectionWrapper}>
        <div className={styles.sectionBadge}>How it works</div>
        <h2 className={styles.sectionTitle}>
          From creation to resolution in four steps
        </h2>
        <p className={styles.sectionSub}>
          Each duel follows a transparent lifecycle. No hidden mechanics,
          no centralized control.
        </p>

        <div className={styles.stepsGrid}>
          <div className={styles.stepCard}>
            <div className={styles.stepNumber}>1</div>
            <div className={styles.stepTitle}>
              Pick a Side
              <span className={styles.stepBadge}>Entry</span>
            </div>
            <p className={styles.stepDescription}>
              Every duel has two sides. Buy tokens on the side you believe
              in using SOL. The bonding curve sets the price.
            </p>
          </div>

          <div className={styles.stepCard}>
            <div className={styles.stepNumber}>2</div>
            <div className={styles.stepTitle}>
              Price Discovery
              <span className={styles.stepBadge}>Trading</span>
            </div>
            <p className={styles.stepDescription}>
              Bonding curves ensure fair, algorithmic pricing. Early
              believers get better rates. Buy and sell freely before
              the deadline.
            </p>
          </div>

          <div className={styles.stepCard}>
            <div className={styles.stepNumber}>3</div>
            <div className={styles.stepTitle}>
              TWAP Resolution
              <span className={styles.stepBadge}>Settlement</span>
            </div>
            <p className={styles.stepDescription}>
              Time-weighted average price determines the winner.
              Observation samples are recorded on-chain. No oracles.
            </p>
          </div>

          <div className={styles.stepCard}>
            <div className={styles.stepNumber}>4</div>
            <div className={styles.stepTitle}>
              Winner Graduates
              <span className={styles.stepBadge}>DEX</span>
            </div>
            <p className={styles.stepDescription}>
              The winning token graduates to Meteora DAMM v2, creating
              permanent DEX liquidity. Tradeable on Jupiter instantly.
            </p>
          </div>
        </div>
      </section>

      {/* ─── Features ─── */}
      <section className={styles.sectionWrapper}>
        <div className={styles.sectionBadge}>Built for Solana</div>
        <h2 className={styles.sectionTitle}>Protocol primitives</h2>
        <p className={styles.sectionSub}>
          Every component designed from first principles for composability,
          security, and performance.
        </p>

        <div className={styles.featuresGrid}>
          <div className={styles.featureCard}>
            <span className={styles.featureIcon}><IconTrendingUp /></span>
            <div className={styles.featureTitle}>Bonding Curves</div>
            <p className={styles.featureDesc}>
              Algorithmic pricing with configurable steepness, exponent,
              and base price. Instant liquidity with no AMM setup.
            </p>
          </div>

          <div className={styles.featureCard}>
            <span className={styles.featureIcon}><IconClock /></span>
            <div className={styles.featureTitle}>TWAP Oracle</div>
            <p className={styles.featureDesc}>
              On-chain time-weighted average with lagging filter and
              observation clamping. Manipulation-resistant by design.
            </p>
          </div>

          <div className={styles.featureCard}>
            <span className={styles.featureIcon}><IconLock /></span>
            <div className={styles.featureTitle}>Re-entrancy Guards</div>
            <p className={styles.featureDesc}>
              Market-level lock prevents flash loan attacks during
              buy/sell operations. Active on every trade.
            </p>
          </div>

          <div className={styles.featureCard}>
            <span className={styles.featureIcon}><IconDiamond /></span>
            <div className={styles.featureTitle}>DEX Graduation</div>
            <p className={styles.featureDesc}>
              Winners graduate to Meteora DAMM v2 via CPI. Automated pool
              creation with integer-only sqrt pricing.
            </p>
          </div>

          <div className={styles.featureCard}>
            <span className={styles.featureIcon}><IconShield /></span>
            <div className={styles.featureTitle}>Sell Penalty</div>
            <p className={styles.featureDesc}>
              Dynamic quadratic penalty near deadline prevents last-second
              dumps. Penalties boost winner rewards.
            </p>
          </div>

          <div className={styles.featureCard}>
            <span className={styles.featureIcon}><IconZap /></span>
            <div className={styles.featureTitle}>Permissionless</div>
            <p className={styles.featureDesc}>
              Anyone can create markets, crank TWAP samples, resolve
              outcomes, and graduate tokens. No gatekeepers.
            </p>
          </div>
        </div>
      </section>

      {/* ─── FAQ ─── */}
      <section className={styles.sectionWrapper}>
        <div className={styles.sectionBadge}>FAQ</div>
        <h2 className={styles.sectionTitle}>Frequently asked questions</h2>
        <p className={styles.sectionSub}>
          Everything you need to know about Duel Protocol.
        </p>

        <div className={styles.faqList}>
          {FAQ_ITEMS.map((item, i) => (
            <div key={i} className={styles.faqItem}>
              <button
                className={styles.faqQuestion}
                onClick={() => setOpenFaq(openFaq === i ? null : i)}
              >
                {item.question}
                <span
                  className={`${styles.faqChevron} ${openFaq === i ? styles.faqChevronOpen : ""}`}
                >
                  <IconChevronDown />
                </span>
              </button>
              {openFaq === i && (
                <div className={styles.faqAnswer}>{item.answer}</div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ─── CTA ─── */}
      <section className={styles.ctaSection}>
        <h2 className={styles.ctaTitle}>
          Ready to enter the <span className={styles.heroTitleYellow}>arena</span>?
        </h2>
        <p className={styles.ctaSub}>
          Create a duel or pick your side. Markets settle on-chain.
        </p>
        <div className={styles.ctaActions}>
          <Link href="/duels" className="btn btn-yellow btn-lg">
            Browse Duels <IconArrowRight />
          </Link>
          <Link href="/create" className="btn btn-ghost btn-lg">
            Create a Duel <IconArrowRight />
          </Link>
        </div>
      </section>

      {/* ─── Footer ─── */}
      <footer className={styles.footer}>
        <div className={styles.footerGrid}>
          <div>
            <div className={styles.footerBrand}>DUELS</div>
            <p className={styles.footerBrandDesc}>
              Subjective prediction markets with bonding curves and TWAP
              resolution. Built on Solana.
            </p>
          </div>

          <div>
            <div className={styles.footerColTitle}>Protocol</div>
            <ul className={styles.footerLinks}>
              <li><Link href="/duels">Browse Duels</Link></li>
              <li><Link href="/create">Create</Link></li>
              <li><a href="https://github.com/saicharanpogul/duel-protocol" target="_blank" rel="noopener noreferrer">Documentation</a></li>
            </ul>
          </div>

          <div>
            <div className={styles.footerColTitle}>Developers</div>
            <ul className={styles.footerLinks}>
              <li><a href="https://github.com/saicharanpogul/duel-protocol" target="_blank" rel="noopener noreferrer">GitHub</a></li>
              <li><a href="https://www.npmjs.com/package/@duel-protocol/sdk" target="_blank" rel="noopener noreferrer">SDK</a></li>
              <li><a href="https://github.com/saicharanpogul/duel-protocol/blob/main/docs/THESIS.md" target="_blank" rel="noopener noreferrer">Thesis</a></li>
            </ul>
          </div>

          <div>
            <div className={styles.footerColTitle}>Community</div>
            <ul className={styles.footerLinks}>
              <li><a href="#">Twitter</a></li>
              <li><a href="#">Discord</a></li>
              <li><a href="#">Telegram</a></li>
            </ul>
          </div>
        </div>

        <div className={styles.footerBottom}>
          <span className={styles.footerCopyright}>
            © 2024 Duel Protocol. All rights reserved.
          </span>
          <div className={styles.footerSocials}>
            <a href="#">𝕏</a>
            <a href="https://github.com/saicharanpogul/duel-protocol" target="_blank" rel="noopener noreferrer">GitHub</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
