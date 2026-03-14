"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "./page.module.css";

const FAQ_ITEMS = [
  {
    question: "Is this like gambling?",
    answer:
      "Duels are prediction markets — you buy tokens on the side you believe in. Unlike gambling, prices are determined by supply and demand through bonding curves. You can sell your position at any time before the duel ends.",
  },
  {
    question: "How are winners decided?",
    answer:
      "Winners are determined by market sentiment. The protocol tracks prices over a time window using a time-weighted average. The side with higher market demand wins. No one person can manipulate the outcome — it's pure crowd consensus.",
  },
  {
    question: "What happens when I win?",
    answer:
      "When your side wins, a portion of the losing side's reserve is transferred to the winning side (the Battle Tax). This means your tokens are now backed by more value. You can sell at a higher price, or hold — the winning token can graduate to a DEX for permanent trading.",
  },
  {
    question: "What happens if I lose?",
    answer:
      "If your side loses, the battle tax is deducted from your side's reserve. Your tokens still exist and have residual value based on the remaining reserve, but they'll be worth less than what winners get.",
  },
  {
    question: "Can I sell before the duel ends?",
    answer:
      "Yes! You can buy and sell freely at any time during the duel. Prices move based on demand — if you bought early and others are piling in, you can take profits. A small sell penalty applies as the deadline approaches to prevent last-second exits.",
  },
  {
    question: "Do I need a wallet?",
    answer:
      "Yes, you need a Solana wallet (like Phantom or Backpack) with some SOL to participate. Connect your wallet using the button in the top-right corner.",
  },
];

/* ─── SVG Icons ─── */
const IconSwords = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" y1="19" x2="19" y2="13"/><line x1="16" y1="16" x2="20" y2="20"/><line x1="19" y1="21" x2="21" y2="19"/><polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5"/><line x1="5" y1="14" x2="9" y2="18"/><line x1="7" y1="17" x2="4" y2="20"/><line x1="3" y1="19" x2="5" y2="21"/></svg>
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
            Pick a <span className={styles.heroTitleYellow}>side</span>.
            <br />
            Win the <span className={styles.heroTitleBlue}>duel</span>.
          </h1>

          <p className={styles.heroSub}>
            Create head-to-head battles on any topic. Buy tokens on the side
            you believe in. The crowd decides the winner — and the winning side
            takes from the losing side.
          </p>

          <div className={styles.heroActions}>
            <Link href="/duels" className="btn btn-yellow btn-lg">
              Enter The Arena <IconArrowRight />
            </Link>
            <Link href="/docs" className="btn btn-ghost btn-lg">
              How It Works <IconArrowRight />
            </Link>
          </div>
        </div>
      </section>

      {/* ─── Stats Bar ─── */}
      <section
        className={`${styles.statsBar} ${mounted ? "animate-fadeInUp animate-delay-2" : ""}`}
      >
        <div className={styles.statItem}>
          <div className={styles.statValue}>2</div>
          <div className={styles.statLabel}>Sides</div>
        </div>
        <div className={styles.statItem}>
          <div className={styles.statValue}>1</div>
          <div className={styles.statLabel}>Winner</div>
        </div>
        <div className={styles.statItem}>
          <div className={styles.statValue}>50%</div>
          <div className={styles.statLabel}>Battle Tax</div>
        </div>
        <div className={styles.statItem}>
          <div className={styles.statValue}>DEX</div>
          <div className={styles.statLabel}>Graduation</div>
        </div>
      </section>

      {/* ─── How It Works ─── */}
      <section className={styles.sectionWrapper}>
        <div className={styles.sectionBadge}>How it works</div>
        <h2 className={styles.sectionTitle}>
          Battle it out in four simple steps
        </h2>
        <p className={styles.sectionSub}>
          No sign-ups, no middlemen. Just connect your wallet and pick a side.
        </p>

        <div className={styles.stepsGrid}>
          <div className={styles.stepCard}>
            <div className={styles.stepNumber}>1</div>
            <div className={styles.stepTitle}>
              Pick a Side
              <span className={styles.stepBadge}>Choose</span>
            </div>
            <p className={styles.stepDescription}>
              Every duel has two sides — like &quot;Bitcoin&quot; vs &quot;Ethereum&quot; or
              &quot;Cats&quot; vs &quot;Dogs.&quot; Buy tokens on the side you believe will win.
            </p>
          </div>

          <div className={styles.stepCard}>
            <div className={styles.stepNumber}>2</div>
            <div className={styles.stepTitle}>
              Watch the Battle
              <span className={styles.stepBadge}>Trade</span>
            </div>
            <p className={styles.stepDescription}>
              As more people buy in, prices move. You can trade freely — buy
              more, sell for profit, or hold until the end.
            </p>
          </div>

          <div className={styles.stepCard}>
            <div className={styles.stepNumber}>3</div>
            <div className={styles.stepTitle}>
              Crowd Decides
              <span className={styles.stepBadge}>Settle</span>
            </div>
            <p className={styles.stepDescription}>
              When the timer ends, the protocol looks at market demand over
              time. The side with more support wins. No judges, no oracles.
            </p>
          </div>

          <div className={styles.stepCard}>
            <div className={styles.stepNumber}>4</div>
            <div className={styles.stepTitle}>
              Winners Take All
              <span className={styles.stepBadge}>Profit</span>
            </div>
            <p className={styles.stepDescription}>
              Winners get a share of the losers&apos; reserve. The winning token
              can graduate to a DEX for perpetual trading on Jupiter.
            </p>
          </div>
        </div>
      </section>

      {/* ─── Features ─── */}
      <section className={styles.sectionWrapper}>
        <div className={styles.sectionBadge}>Why Duels?</div>
        <h2 className={styles.sectionTitle}>Built different</h2>
        <p className={styles.sectionSub}>
          Duels aren&apos;t regular bets. Every mechanic is designed to make
          battles intense and rewarding.
        </p>

        <div className={styles.featuresGrid}>
          <div className={styles.featureCard}>
            <span className={styles.featureIcon}><IconTrendingUp /></span>
            <div className={styles.featureTitle}>Dynamic Pricing</div>
            <p className={styles.featureDesc}>
              Prices change based on demand. Early believers get better rates.
              Buy low, sell high — or hold for the win.
            </p>
          </div>

          <div className={styles.featureCard}>
            <span className={styles.featureIcon}><IconClock /></span>
            <div className={styles.featureTitle}>Fair Resolution</div>
            <p className={styles.featureDesc}>
              Winners are decided by sustained market sentiment over time,
              not a single final trade. No manipulation, no whales deciding.
            </p>
          </div>

          <div className={styles.featureCard}>
            <span className={styles.featureIcon}><IconSwords /></span>
            <div className={styles.featureTitle}>Battle Tax</div>
            <p className={styles.featureDesc}>
              The killer mechanic — a portion of the loser&apos;s reserve goes to
              winners. Higher stakes = bigger rewards.
            </p>
          </div>

          <div className={styles.featureCard}>
            <span className={styles.featureIcon}><IconDiamond /></span>
            <div className={styles.featureTitle}>DEX Graduation</div>
            <p className={styles.featureDesc}>
              Winning tokens don&apos;t die — they graduate to a real decentralized
              exchange. Trade them on Jupiter forever.
            </p>
          </div>

          <div className={styles.featureCard}>
            <span className={styles.featureIcon}><IconShield /></span>
            <div className={styles.featureTitle}>Anti-Dump Protection</div>
            <p className={styles.featureDesc}>
              A dynamic sell penalty near the deadline prevents last-second
              exits. No rug-pulling your own side.
            </p>
          </div>

          <div className={styles.featureCard}>
            <span className={styles.featureIcon}><IconZap /></span>
            <div className={styles.featureTitle}>Instant &amp; On-Chain</div>
            <p className={styles.featureDesc}>
              No sign-ups, no KYC, no waiting periods. Connect your Solana
              wallet and start duelling in seconds.
            </p>
          </div>
        </div>
      </section>

      {/* ─── FAQ ─── */}
      <section className={styles.sectionWrapper}>
        <div className={styles.sectionBadge}>FAQ</div>
        <h2 className={styles.sectionTitle}>Questions &amp; Answers</h2>
        <p className={styles.sectionSub}>
          Everything you need to know before jumping in.
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
          Ready to pick your <span className={styles.heroTitleYellow}>side</span>?
        </h2>
        <p className={styles.ctaSub}>
          Browse active duels or create your own battle.
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
              Head-to-head battles on any topic.
              The crowd picks the winner.
            </p>
          </div>

          <div>
            <div className={styles.footerColTitle}>Duels</div>
            <ul className={styles.footerLinks}>
              <li><Link href="/duels">Browse</Link></li>
              <li><Link href="/create">Create</Link></li>
              <li><Link href="/docs">How It Works</Link></li>
            </ul>
          </div>

          <div>
            <div className={styles.footerColTitle}>Developers</div>
            <ul className={styles.footerLinks}>
              <li><a href="https://github.com/saicharanpogul/duel-protocol" target="_blank" rel="noopener noreferrer">GitHub</a></li>
              <li><a href="https://www.npmjs.com/package/@duel-protocol/sdk" target="_blank" rel="noopener noreferrer">SDK</a></li>
              <li><Link href="/docs">Docs</Link></li>
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
