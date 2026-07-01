"use client";

import Link from "next/link";
import { ArrowRight, Lightbulb } from "lucide-react";

import { useSiteIntent } from "@/components/site-intent-provider";

export default function RecommendationsPage() {
  const { projects, activeProjectId, scanProgressByProject } = useSiteIntent();
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? projects[0] ?? null;
  const liveScanProgress = activeProject ? scanProgressByProject[activeProject.id] ?? null : null;
  const competitorScoringActive = liveScanProgress?.scanMode === "full" && liveScanProgress.stage !== "completed";

  return (
    <div className="page-shell">
      <div className="page-header-inline">
        <div className="page-header-inline__content">
          <div className="eyebrow">
            <Lightbulb size={14} />
            Actions
          </div>
          <h1 className="page-title">What to do next</h1>
          <p className="page-copy">
            This page turns the completed website and competitor analysis into concrete changes, removals, and additions that should improve
            rankability and discoverability.
          </p>
        </div>
        <div className="page-header-inline__actions">
          <Link className="button button--secondary" href="/dashboard">
            Back to dashboard
            <ArrowRight size={16} />
          </Link>
        </div>
      </div>

      {competitorScoringActive ? (
        <section className="card">
          <h2 className="card__title">Competitor analysis still running</h2>
          <p className="card__copy">
            Actions are generated after the competitor scan finishes and the app can compare why competitors are scoring the way they do.
          </p>
          <div className="section-note" style={{ marginTop: 16 }}>
            <strong>{liveScanProgress?.title ?? "Scoring competitors"}</strong>
            <div>{liveScanProgress?.description ?? "Waiting for competitor scoring to complete."}</div>
          </div>
        </section>
      ) : null}

      <section className="card">
        <h2 className="card__title">Actions are not enabled yet</h2>
        <p className="card__copy">
          Recommendations are being separated from the scan pipeline and will be added later as their own workflow.
        </p>
        <div className="section-note" style={{ marginTop: 16 }}>
          <strong>What will appear here</strong>
          <div>
            A prioritized action list based on your website scores, the saved target context, and the top 5 competitor comparison once that
            separate recommendations system is switched on.
          </div>
        </div>
      </section>
    </div>
  );
}
