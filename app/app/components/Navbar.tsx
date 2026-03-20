"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

export default function Navbar() {
  const pathname = usePathname();

  return (
    <nav
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 24px",
        height: 56,
        background: "#08080C",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        fontFamily: "'DM Sans', sans-serif",
      }}
    >
      {/* Left: wordmark + torn divider */}
      <Link
        href="/"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          textDecoration: "none",
        }}
      >
        <span
          style={{
            fontFamily: "'Space Grotesk', sans-serif",
            fontWeight: 700,
            fontSize: "1.2rem",
            color: "#eaeaef",
            letterSpacing: "-0.03em",
          }}
        >
          duels.fun
        </span>
        {/* Torn diagonal divider */}
        <svg
          width="12"
          height="24"
          viewBox="0 0 12 24"
          fill="none"
          style={{ display: "block" }}
        >
          <path
            d="M10 0 L8 4 L10 6 L7 10 L9 13 L6 17 L8 20 L5 24"
            stroke="rgba(255,255,255,0.15)"
            strokeWidth="1.5"
            fill="none"
          />
        </svg>
      </Link>

      {/* Center: desktop nav links */}
      <div
        style={{
          display: "flex",
          gap: 4,
          alignItems: "center",
        }}
        className="navbar-center-links"
      >
        <Link
          href="/duels"
          style={{
            padding: "6px 16px",
            fontSize: "0.85rem",
            fontWeight: 500,
            color:
              pathname === "/duels" || pathname?.startsWith("/duels/")
                ? "#eaeaef"
                : "#8a8a9a",
            background:
              pathname === "/duels" || pathname?.startsWith("/duels/")
                ? "rgba(255,255,255,0.06)"
                : "transparent",
            textDecoration: "none",
            transition: "color 0.15s",
          }}
        >
          Duels
        </Link>
        <Link
          href="/create"
          style={{
            padding: "6px 16px",
            fontSize: "0.85rem",
            fontWeight: 500,
            color: pathname === "/create" ? "#eaeaef" : "#8a8a9a",
            background:
              pathname === "/create"
                ? "rgba(255,255,255,0.06)"
                : "transparent",
            textDecoration: "none",
            transition: "color 0.15s",
          }}
        >
          Create
        </Link>
      </div>

      {/* Right: wallet */}
      <WalletMultiButton />

      {/* Hide center links on mobile */}
      <style jsx global>{`
        @media (max-width: 640px) {
          .navbar-center-links {
            display: none !important;
          }
        }
      `}</style>
    </nav>
  );
}
