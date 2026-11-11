import type { Metadata } from "next";
import { Bricolage_Grotesque, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import "./app-ui.css";
import { WalletProvider } from "@/lib/wallet";
import { Suspense } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { ToastProvider } from "@/components/Toast";

const bricolage = Bricolage_Grotesque({ variable: "--font-bricolage", subsets: ["latin"], display: "swap" });
const jetbrains = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "Callout", template: "%s | Callout" },
  description: "Call it. Back it. Prove it. Post a perps trade call with a bond behind it. Followers take it with the stop and target already set, and every outcome is settled on chain.",
  openGraph: { siteName: "Callout", type: "website" },
  twitter: { card: "summary_large_image" },
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${bricolage.variable} ${jetbrains.variable}`}>
      <body>
        <a className="skip" href="#main">
          Skip to content
        </a>
        <WalletProvider>
          <ToastProvider>
            <Suspense fallback={<header className="topbar" />}>
              <Header />
            </Suspense>
            <main id="main">{children}</main>
            <Footer />
          </ToastProvider>
        </WalletProvider>
      </body>
    </html>
  );
}
