import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";

import { Providers } from "@/app/providers";

import "./globals.css";

const inter = Inter({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-inter"
});

export const metadata: Metadata = {
  title: "Site Intent",
  description: "See what your website actually communicates.",
  metadataBase: new URL("http://localhost:3000"),
  icons: {
    icon: "/icon.png"
  }
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#F7F8FA"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} app-root`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
