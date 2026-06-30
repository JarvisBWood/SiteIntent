"use client";

import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";

import { ProjectSetupModal } from "@/components/project-setup-modal";
import { useSiteIntent } from "@/components/site-intent-provider";

export default function SetupPage() {
  const { session } = useSiteIntent();

  return (
    <div className="page-shell">
      <section className="page-hero">
        <div className="eyebrow">
          <Sparkles size={14} />
          Create project
        </div>
        <h1 className="page-title">Start your first project</h1>
        <p className="page-copy">
          Add the website you want to understand. We&apos;ll start by scoring your website first, then move on to the top five competitors in
          the background. The default crawl depth of 1 covers the homepage and directly linked internal pages.
        </p>
        <div className="hero-actions">
          <Link className="button button--secondary" href="/dashboard">
            Back to dashboard
            <ArrowRight size={16} />
          </Link>
          <div className="section-note">
            {session ? `Signed in as ${session.displayName}.` : "You can continue locally without full auth."}
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card__header">
          <div>
            <h2 className="card__title">Project setup wizard</h2>
            <p className="card__copy">The wizard opens as a modal, saves the website, and sends you straight to the dashboard.</p>
          </div>
          <ProjectSetupModal defaultOpen />
        </div>
      </section>
    </div>
  );
}
