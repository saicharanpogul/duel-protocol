import { WalletContextProvider } from "./providers";
import "./globals.css";

export const metadata = {
  title: "Duel Protocol — Binary Outcome Markets",
  description:
    "Create prediction markets, trade on outcomes, and resolve using TWAP oracles on Solana.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <WalletContextProvider>{children}</WalletContextProvider>
      </body>
    </html>
  );
}
