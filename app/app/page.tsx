"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "./page.module.css";

export default function LandingPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className={styles.landing}>
      {/* ─── Hero Section ─── */}
      <section className={styles.hero}>
        {/* Animated pill particles */}
        <div className={styles.particles}>
          {mounted && Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className={`${styles.particle} ${i % 2 === 0 ? styles.particleRed : styles.particleBlue}`}
              style={{
                left: `${10 + Math.random() * 80}%`,
                top: `${10 + Math.random() * 80}%`,
                animationDelay: `${Math.random() * 5}s`,
                animationDuration: `${4 + Math.random() * 6}s`,
              }}
            />
          ))}
        </div>

        <div className={`${styles.heroContent} ${mounted ? 'animate-fadeInUp' : ''}`}>
          <div className={styles.heroBadge}>
            <span className={styles.heroBadgeDot} />
            Subjective Markets on Solana
          </div>

          <h1 className={styles.heroTitle}>
            Choose Your <span className={styles.heroTitleRed}>Side</span>.
            <br />
            Win The <span className={styles.heroTitleBlue}>Duel</span>.
          </h1>

          <p className={styles.heroSub}>
            Pick a pill. Back your conviction with SOL. TWAP decides the winner.
            <br />
            No oracles needed. Pure market consensus.
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
        <div className={`${styles.pillContainer} ${mounted ? 'animate-fadeInUp animate-delay-2' : ''}`}>
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
      <section className={`${styles.statsBar} ${mounted ? 'animate-fadeInUp animate-delay-3' : ''}`}>
        <div className="stat-box">
          <div className="stat-value">∞</div>
          <div className="stat-label">Active Duels</div>
        </div>
        <div className="stat-box">
          <div className="stat-value">TWAP</div>
          <div className="stat-label">Resolution</div>
        </div>
        <div className="stat-box">
          <div className="stat-value">50%</div>
          <div className="stat-label">Max Battle Tax</div>
        </div>
        <div className="stat-box">
          <div className="stat-value">SOL</div>
          <div className="stat-label">Quote Token</div>
        </div>
      </section>

      {/* ─── How It Works ─── */}
      <section className={`${styles.howItWorks} ${mounted ? 'animate-fadeInUp animate-delay-4' : ''}`}>
        <h2 className="section-title" style={{ textAlign: 'center' }}>How Duels Work</h2>
        <div className={styles.steps}>
          <div className={styles.step}>
            <div className={styles.stepIcon}>🎯</div>
            <h3>1. Pick a Side</h3>
            <p>Every duel has two sides — Red Pill vs Blue Pill. Buy tokens on the side you believe in.</p>
          </div>
          <div className={styles.step}>
            <div className={styles.stepIcon}>📈</div>
            <h3>2. Price Discovery</h3>
            <p>Bonding curves ensure fair pricing. Early believers get better rates. No liquidity pools needed.</p>
          </div>
          <div className={styles.step}>
            <div className={styles.stepIcon}>⏱️</div>
            <h3>3. TWAP Resolution</h3>
            <p>Time-weighted average price determines the winner. Manipulation-resistant by design.</p>
          </div>
          <div className={styles.step}>
            <div className={styles.stepIcon}>🏆</div>
            <h3>4. Winner Takes All</h3>
            <p>Battle tax transfers from losers to winners. Protocol fees are minimal. Your conviction pays.</p>
          </div>
        </div>
      </section>

      {/* ─── Footer ─── */}
      <footer className={styles.footer}>
        <p>⚡ DUELS — built on Solana</p>
        <p className={styles.footerSub}>Subjective markets, TWAP resolution, bonding curves</p>
      </footer>
    </div>
  );
}
