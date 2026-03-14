"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

const IconBolt = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
);

export default function Navbar() {
  const pathname = usePathname();

  return (
    <nav className="navbar">
      <Link href="/" className="navbar-logo">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <IconBolt /> DUELS
        </span>
      </Link>

      <div className="navbar-links">
        <Link
          href="/duels"
          className={`navbar-link ${pathname === "/duels" || pathname.startsWith("/duels/") ? "active" : ""}`}
        >
          Browse
        </Link>
        <Link
          href="/create"
          className={`navbar-link ${pathname === "/create" ? "active" : ""}`}
        >
          Create
        </Link>
        <Link
          href="/docs"
          className={`navbar-link ${pathname === "/docs" ? "active" : ""}`}
        >
          Docs
        </Link>
        <WalletMultiButton />
      </div>
    </nav>
  );
}
