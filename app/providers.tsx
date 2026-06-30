"use client";

import { SiteIntentProvider } from "@/components/site-intent-provider";

export function Providers({ children }: Readonly<{ children: React.ReactNode }>) {
  return <SiteIntentProvider>{children}</SiteIntentProvider>;
}
