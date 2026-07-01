import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { DashboardShell } from "@/components/dashboard-shell";

export default async function DashboardLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const cookieStore = await cookies();
  if (!cookieStore.get("siteintent_session")?.value) {
    redirect("/login");
  }

  return <DashboardShell>{children}</DashboardShell>;
}
