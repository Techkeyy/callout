import type { Metadata } from "next";
import { Bricolage_Grotesque, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { WalletProvider } from "@/lib/wallet";
import Header from "@/components/Header";

const bricolage = Bricolage_Grotesque({ variable: "--font-bricolage", subsets: ["latin"], display: "swap" });
const jetbrains = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "Callout", template: "%s | Callout" },
  description: "Post a trade call once. Anyone can take it with the stop and target already set. It can never be edited.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${bricolage.variable} ${jetbrains.variable}`}>
      <body>
        <WalletProvider>
          <Header />
          <main>{children}</main>
          <footer className="footer">
            <div className="wrap">
              <p>Callout runs on the Somnia Tokyo testnet with paper money. A call is written on chain and cannot be changed after it is posted.</p>
            </div>
          </footer>
        </WalletProvider>
      </body>
    </html>
  );
}
