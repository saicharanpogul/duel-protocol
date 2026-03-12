"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

export default function Navbar() {
  const pathname = usePathname();

  return (
    <nav className="navbar">
      <Link href="/" className="navbar-logo">
        ⚡ DUELS
      </Link>

      <div className="navbar-links">
        <Link
          href="/duels"
          className={`navbar-link ${pathname === "/duels" ? "active" : ""}`}
        >
          Browse
        </Link>
        <Link
          href="/create"
          className={`navbar-link ${pathname === "/create" ? "active" : ""}`}
        >
          Create
        </Link>
        <WalletMultiButton />
      </div>
    </nav>
  );
}
