"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "./page.module.css";

const FAQ_ITEMS = [
  {
    question: "What is a Duel?",
    answer:
      "A Duel is a binary outcome market where two sides compete — Red Pill vs Blue Pill. Each side has its own bonding curve token. Buy tokens on the side you believe in, and the market resolves via TWAP (Time-Weighted Average Price).",
  },
  {
    question: "How does TWAP resolution work?",
    answer:
      "Instead of relying on an oracle, the winning side is determined by which token maintained a higher time-weighted average price during the observation window. This makes resolution manipulation-resistant and fully on-chain.",
  },
  {
    question: "What are bonding curves?",
    answer:
      "Bonding curves provide instant, algorithmic pricing. When you buy tokens, the price increases. When you sell, the price decreases. Early believers get better rates. No AMM liquidity pools needed.",
  },
  {
    question: "What is the Battle Tax?",
    answer:
      "The Battle Tax is a configurable fee (up to 50%) that redistributes from the losing side's liquidity to the winning side upon resolution. It's the core incentive mechanism that makes duels zero-sum and exciting.",
  },
  {
    question: "What happens after a duel resolves?",
    answer:
      "The winning side's token can graduate to Meteora DLMM (a Solana DEX), creating permanent on-chain liquidity. Winning token holders can sell on the DEX or hold for continued price discovery.",
  },
  {
    question: "What quote tokens are supported?",
    answer:
      "Currently SOL (wrapped SOL) is the primary quote token. The protocol is designed to support any SPL token including USDC and Token-2022 assets via the quoteTokenProgram interface.",
  },
];

export default function LandingPage() {
  const [mounted, setMounted] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  useEffect(() => setMounted(true), []);

  return (
    <div className={styles.landing}>
      {/* ─── Hero Section ─── */}
      <section className={styles.hero}>
        <div className={styles.heroMesh} />
        <div className={styles.heroGrid} />

        <div
          className={`${styles.heroContent} ${mounted ? "animate-fadeInUp" : ""}`}
        >
          <div className={styles.heroBadge}>
            <span className={styles.heroBadgeDot} />
            Live on Solana Devnet
          </div>

          <h1 className={styles.heroTitle}>
            Choose Your{" "}
            <span className={styles.heroTitleRed}>Side</span>.
            <br />
            Win The <span className={styles.heroTitleBlue}>Duel</span>.
          </h1>

          <p className={styles.heroSub}>
            Subjective prediction markets powered by bonding curves and
            TWAP&nbsp;resolution. No oracles. Pure market&nbsp;consensus.
          </p>

          <div className={styles.heroActions}>
            <Link href="/duels" className="btn btn-red btn-lg">
              🔴 Enter The Arena
            </Link>
            <Link href="/create" className="btn btn-blue btn-lg">
              🔵 Create a Duel
            </Link>
          </div>
        </div>

        {/* ─── Pill Visualization ─── */}
        <div
          className={`${styles.pillContainer} ${mounted ? "animate-fadeInUp animate-delay-2" : ""}`}
        >
          <div className={styles.pillRed}>
            <div className={styles.pillInner}>
              <span className={styles.pillEmoji}>🔴</span>
              <span className={styles.pillLabel}>RED PILL</span>
              <span className={styles.pillDesc}>Conviction</span>
            </div>
          </div>
          <div className={styles.pillVs}>VS</div>
          <div className={styles.pillBlue}>
            <div className={styles.pillInner}>
              <span className={styles.pillEmoji}>🔵</span>
              <span className={styles.pillLabel}>BLUE PILL</span>
              <span className={styles.pillDesc}>Contrarian</span>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Stats Bar ─── */}
      <section
        className={`${styles.statsBar} ${mounted ? "animate-fadeInUp animate-delay-3" : ""}`}
      >
        <div className={styles.statItem}>
          <div className={styles.statValue}>∞</div>
          <div className={styles.statLabel}>Active Duels</div>
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
        <div className={styles.sectionBadge}>🎯 How it works?</div>
        <h2 className={styles.sectionTitle}>
          From creation to resolution
          <br />
          in four steps
        </h2>
        <p className={styles.sectionSub}>
          Each duel follows a transparent lifecycle. No hidden mechanics, no
          centralized control.
        </p>

        <div className={styles.stepsGrid}>
          <div className={styles.stepCard}>
            <div className={styles.stepNumber}>1</div>
            <div className={styles.stepTitle}>
              Pick a Side
              <span className={styles.stepBadge}>Entry</span>
            </div>
            <p className={styles.stepDescription}>
              Every duel has two sides — Red Pill vs Blue Pill. Buy tokens on
              the side you believe in using SOL. The bonding curve sets the
              price automatically.
            </p>
          </div>

          <div className={styles.stepCard}>
            <div className={styles.stepNumber}>2</div>
            <div className={styles.stepTitle}>
              Price Discovery
              <span className={styles.stepBadge}>Trading</span>
            </div>
            <p className={styles.stepDescription}>
              Bonding curves ensure fair, algorithmic pricing. Early believers
              get better rates. Buy and sell freely before the deadline — no
              liquidity pools needed.
            </p>
          </div>

          <div className={styles.stepCard}>
            <div className={styles.stepNumber}>3</div>
            <div className={styles.stepTitle}>
              TWAP Resolution
              <span className={styles.stepBadge}>Settlement</span>
            </div>
            <p className={styles.stepDescription}>
              Time-weighted average price determines the winner. Observation
              samples are recorded on-chain during the TWAP window. No oracles
              — pure market consensus.
            </p>
          </div>

          <div className={styles.stepCard}>
            <div className={styles.stepNumber}>4</div>
            <div className={styles.stepTitle}>
              Winner Graduates
              <span className={styles.stepBadge}>DEX</span>
            </div>
            <p className={styles.stepDescription}>
              The winning side graduates to Meteora DLMM, creating permanent
              DEX liquidity. Battle tax flows from losers to winners. Hold or
              trade on the open market.
            </p>
          </div>
        </div>
      </section>

      {/* ─── Features ─── */}
      <section className={styles.sectionWrapper}>
        <div className={styles.sectionBadge}>⚡ Built for Solana</div>
        <h2 className={styles.sectionTitle}>Protocol primitives</h2>
        <p className={styles.sectionSub}>
          Every component is designed from first principles for composability,
          security, and performance.
        </p>

        <div className={styles.featuresGrid}>
          <div className={styles.featureCard}>
            <span className={styles.featureIcon}>📈</span>
            <div className={styles.featureTitle}>Bonding Curves</div>
            <p className={styles.featureDesc}>
              Algorithmic pricing with configurable parameters. Instant
              liquidity, no AMM setup required.
            </p>
          </div>

          <div className={styles.featureCard}>
            <span className={styles.featureIcon}>⏱️</span>
            <div className={styles.featureTitle}>TWAP Oracle</div>
            <p className={styles.featureDesc}>
              On-chain time-weighted average price with clamping,
              manipulation-resistant by design.
            </p>
          </div>

          <div className={styles.featureCard}>
            <span className={styles.featureIcon}>🔒</span>
            <div className={styles.featureTitle}>Re-entrancy Guards</div>
            <p className={styles.featureDesc}>
              Market-level lock prevents flash loan attacks and re-entrancy
              exploits during trades.
            </p>
          </div>

          <div className={styles.featureCard}>
            <span className={styles.featureIcon}>💎</span>
            <div className={styles.featureTitle}>DEX Graduation</div>
            <p className={styles.featureDesc}>
              Winners graduate to Meteora DLMM with automated position
              creation and liquidity bootstrapping.
            </p>
          </div>

          <div className={styles.featureCard}>
            <span className={styles.featureIcon}>🛡️</span>
            <div className={styles.featureTitle}>Sell Penalty</div>
            <p className={styles.featureDesc}>
              Dynamic penalty near deadline prevents last-second dumps.
              Accumulated penalties boost winner rewards.
            </p>
          </div>

          <div className={styles.featureCard}>
            <span className={styles.featureIcon}>🪙</span>
            <div className={styles.featureTitle}>Token-2022 Ready</div>
            <p className={styles.featureDesc}>
              Full TokenInterface support for both classic SPL tokens and
              Token-2022 extensions.
            </p>
          </div>
        </div>
      </section>

      {/* ─── FAQ ─── */}
      <section className={styles.sectionWrapper}>
        <div className={styles.sectionBadge}>❓ FAQ</div>
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
                  ▾
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
          Ready to enter the <span className={styles.heroTitleRed}>arena</span>?
        </h2>
        <p className={styles.ctaSub}>
          Create a duel or pick your side. Markets settle on-chain.
        </p>
        <div className={styles.ctaActions}>
          <Link href="/duels" className="btn btn-red btn-lg">
            Browse Duels
          </Link>
          <Link href="/create" className="btn btn-ghost btn-lg">
            Create a Duel →
          </Link>
        </div>
      </section>

      {/* ─── Footer ─── */}
      <footer className={styles.footer}>
        <div className={styles.footerGrid}>
          <div>
            <div className={styles.footerBrand}>⚡ DUELS</div>
            <p className={styles.footerBrandDesc}>
              Subjective prediction markets with bonding curves and TWAP
              resolution. Built on Solana.
            </p>
          </div>

          <div>
            <div className={styles.footerColTitle}>Protocol</div>
            <ul className={styles.footerLinks}>
              <li>
                <Link href="/duels">Browse Duels</Link>
              </li>
              <li>
                <Link href="/create">Create</Link>
              </li>
              <li>
                <a href="#">Documentation</a>
              </li>
            </ul>
          </div>

          <div>
            <div className={styles.footerColTitle}>Resources</div>
            <ul className={styles.footerLinks}>
              <li>
                <a href="#">SDK</a>
              </li>
              <li>
                <a href="#">GitHub</a>
              </li>
              <li>
                <a href="#">Bug Bounty</a>
              </li>
            </ul>
          </div>

          <div>
            <div className={styles.footerColTitle}>Community</div>
            <ul className={styles.footerLinks}>
              <li>
                <a href="#">Twitter</a>
              </li>
              <li>
                <a href="#">Discord</a>
              </li>
              <li>
                <a href="#">Telegram</a>
              </li>
            </ul>
          </div>
        </div>

        <div className={styles.footerBottom}>
          <span className={styles.footerCopyright}>
            © 2024 Duel Protocol. All rights reserved.
          </span>
          <div className={styles.footerSocials}>
            <a href="#">𝕏</a>
            <a href="#">Discord</a>
            <a href="#">GitHub</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
