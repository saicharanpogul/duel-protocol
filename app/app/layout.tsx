import type { Metadata } from "next";
import "./globals.css";
import WalletContextProvider from "./providers/WalletProvider";
import Navbar from "./components/Navbar";

export const metadata: Metadata = {
  title: "Duels — Choose Your Side",
  description: "Subjective prediction markets with TWAP resolution. Pick your pill. Win the duel.",
  icons: { icon: "/favicon.ico" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <WalletContextProvider>
          <Navbar />
          <main>{children}</main>
        </WalletContextProvider>
      </body>
    </html>
  );
}
