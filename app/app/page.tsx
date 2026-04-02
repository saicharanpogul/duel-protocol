"use client";

import Link from "next/link";
import styles from "./page.module.css";

export default function LandingPage() {
  return (
    <div className={styles.landing}>
      {/* ─── Hero ─── */}
      <section className={styles.hero}>
        {/* Split background tints */}
        <div className={styles.heroBgBlue} />
        <div className={styles.heroBgYellow} />

        {/* Torn diagonal divider line */}
        <svg
          className={styles.heroDivider}
          viewBox="0 0 1440 900"
          preserveAspectRatio="none"
          fill="none"
        >
          <path
            d="M0 0 L320 180 L310 200 L520 330 L515 345 L680 450 L670 470 L850 560 L845 575 L1020 660 L1015 680 L1200 770 L1195 790 L1440 900"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth="1.5"
            fill="none"
          />
        </svg>

        <div className={styles.heroContent}>
          <h1 className={styles.heroTitle}>
            Two tokens enter.
            <br />
            One survives.
          </h1>

          <p className={styles.heroSub}>
            Back a side. Winner takes all liquidity. Loser dies.
            The surviving token graduates to DEX.
          </p>

          <Link href="/duels" className={styles.btnA}>
            Enter the arena
          </Link>

          <div className={styles.heroBadge}>
            <span className={styles.heroBadgeDot} />
            Live on Solana Devnet
          </div>
        </div>
      </section>

      {/* ─── Two Modes ─── */}
      <section className={styles.howSection}>
        <div className={styles.sectionLabel}>Two ways to duel</div>

        <div className={styles.modesRow}>
          {/* Mode 1 */}
          <div className={styles.modeCard}>
            <div className={styles.modeTag} style={{ color: "#2BA4E0" }}>Mode 1</div>
            <div className={styles.modeTitle}>Mint &amp; Battle</div>
            <p className={styles.modeDesc}>
              Two brand-new tokens launch on bonding curves.
              Buy the one you believe in. Sell anytime.
              Winner gets loser&#39;s liquidity and graduates to DEX.
            </p>
            <Link href="/duels" className={styles.modeLink}>
              Browse duels
            </Link>
          </div>

          {/* Mode 2 */}
          <div className={styles.modeCard}>
            <div className={styles.modeTag} style={{ color: "#FFE233" }}>Mode 2</div>
            <div className={styles.modeTitle}>Compare &amp; Win</div>
            <p className={styles.modeDesc}>
              Pick two existing tokens like $BONK and $WIF.
              Deposit SOL on the one you think outperforms.
              Oracle-based TWAP decides. Winner takes the pool.
            </p>
            <Link href="/compare" className={styles.modeLinkB}>
              Browse compare duels
            </Link>
          </div>
        </div>
      </section>

      {/* ─── How It Works ─── */}
      <section className={styles.howSection}>
        <div className={styles.sectionLabel}>How it works</div>

        <div className={styles.stepsRow}>
          <div className={styles.step}>
            <div className={`${styles.stepNumber} ${styles.stepNumberBlue}`}>
              01
            </div>
            <div className={styles.stepTitle}>Pick a side</div>
            <p className={styles.stepDesc}>
              Two tokens fight. Buy one or deposit on one.
            </p>
          </div>

          <div className={styles.step}>
            <div className={`${styles.stepNumber} ${styles.stepNumberYellow}`}>
              02
            </div>
            <div className={styles.stepTitle}>Market moves</div>
            <p className={styles.stepDesc}>
              Bonding curve or oracle prices. The market decides sentiment.
            </p>
          </div>

          <div className={styles.step}>
            <div className={`${styles.stepNumber} ${styles.stepNumberBlue}`}>
              03
            </div>
            <div className={styles.stepTitle}>TWAP decides</div>
            <p className={styles.stepDesc}>
              Time-weighted average price over the final window. No manipulation.
            </p>
          </div>

          <div className={styles.step}>
            <div className={`${styles.stepNumber} ${styles.stepNumberYellow}`}>
              04
            </div>
            <div className={styles.stepTitle}>Winner takes all</div>
            <p className={styles.stepDesc}>
              Loser&#39;s SOL goes to winner. Token graduates or pool pays out.
            </p>
          </div>
        </div>
      </section>

      {/* ─── Stats Row ─── */}
      <div className={styles.statsRow}>
        <div className={styles.statsItem}>1% trade fee</div>
        <div className={styles.statsDivider} />
        <div className={styles.statsItem}>Winner takes all</div>
        <div className={styles.statsDivider} />
        <div className={styles.statsItem}>Oracle-powered</div>
      </div>

      {/* ─── Bottom CTA ─── */}
      <section className={styles.ctaSection}>
        <h2 className={styles.ctaTitle}>Pick your side.</h2>

        <div className={styles.ctaLinks}>
          <Link href="/create" className={styles.ctaLinkPrimary}>
            Create a duel
          </Link>
          <Link href="/compare/create" className={styles.ctaLinkPrimary}>
            Create a compare duel
          </Link>
          <Link href="/duels" className={styles.ctaLinkSecondary}>
            Browse duels
          </Link>
          <Link href="/compare" className={styles.ctaLinkSecondary}>
            Browse compare
          </Link>
        </div>
      </section>

      {/* ─── Footer ─── */}
      <footer className={styles.footer}>
        <div className={styles.footerLeft}>duels.fun</div>
        <div className={styles.footerRight}>
          Built on Solana &middot; 2026
        </div>
      </footer>
    </div>
  );
}
