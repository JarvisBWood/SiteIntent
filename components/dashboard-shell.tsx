"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { LogIn, Menu } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";

import { AppSidebar } from "@/components/app-sidebar";
import { getDashboardActiveTitle } from "@/components/dashboard-nav";
import { useSiteIntent } from "@/components/site-intent-provider";
import siteLogo from "../Si-Logo.png";

export function DashboardShell({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { hydrated, session, projects, activeProjectId } = useSiteIntent();

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (hydrated && !session) {
      router.replace("/login");
    }
  }, [hydrated, router, session]);

  const activeTitle = getDashboardActiveTitle(pathname);
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? projects[0] ?? null;

  return (
    <div className="app-shell">
      <AppSidebar open={mobileOpen} onClose={() => setMobileOpen(false)} />
      {mobileOpen ? <button className="app-overlay" type="button" aria-label="Close navigation" onClick={() => setMobileOpen(false)} /> : null}
      <div className="app-main">
        <div className="app-main__inner">
          <header className="mobile-topbar">
            <div className="mobile-topbar__brand">
              <Image className="app-logo app-logo--mobile" src={siteLogo} alt="Site Intent" width={32} height={32} priority />
              <button className="icon-button" type="button" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
                <Menu size={18} />
              </button>
              <div>
                <div className="mobile-topbar__title">{activeTitle}</div>
                <div className="mobile-topbar__subtitle">Site Intent dashboard</div>
              </div>
            </div>
            <Link className="button button--secondary" href="/login">
              Login
              <LogIn size={16} />
            </Link>
          </header>
          {!hydrated ? <div className="section-note">Loading workspace...</div> : null}
          {hydrated && !session ? <div className="section-note">Redirecting to sign in...</div> : children}
        </div>
      </div>
    </div>
  );
}
