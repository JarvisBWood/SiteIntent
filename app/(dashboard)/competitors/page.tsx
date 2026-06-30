"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, BarChart3 } from "lucide-react";

import { useSiteIntent } from "@/components/site-intent-provider";
import type { ProjectCompetitorReport } from "@/lib/sqlite-queries";
import { shortenDisplayUrl } from "@/lib/site-state";

export default function CompetitorsPage() {
  const { hydrated, projects, activeProjectId, competitorAnalyses, scanProgressByProject } = useSiteIntent();
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? projects[0] ?? null;
  const liveScanProgress = activeProject ? scanProgressByProject[activeProject.id] ?? null : null;
  const [report, setReport] = useState<ProjectCompetitorReport | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!hydrated || !activeProject?.id) {
      setReport(null);
      return;
    }

    const controller = new AbortController();

    async function loadReport() {
      setLoading(true);
      try {
        const response = await fetch(`/api/projects/${encodeURIComponent(activeProject.id)}/competitors`, {
          headers: { Accept: "application/json" },
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error("Unable to load competitor report.");
        }

        const payload = (await response.json()) as { report?: ProjectCompetitorReport };
        setReport(payload.report ?? null);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setReport(null);
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void loadReport();
    return () => controller.abort();
  }, [activeProject?.id, hydrated, liveScanProgress?.stage]);

  const competitorUrls = activeProject?.competitorUrls.slice(0, 5) ?? [];
  const isCompetitorScoring = liveScanProgress?.scanMode === "full" && liveScanProgress.stage !== "completed";

  return (
    <div className="page-shell">
      <section className="page-hero">
        <div className="eyebrow">
          <BarChart3 size={14} />
          Competitors
        </div>
        <h1 className="page-title">Top 5 competitor results</h1>
        <p className="page-copy">
          Competitor scoring starts after your website scoring finishes. This page only shows the discovered top five comparison sites.
        </p>
        <div className="hero-actions">
          <Link className="button button--secondary" href="/dashboard">
            Back to dashboard
            <ArrowRight size={16} />
          </Link>
        </div>
      </section>

      {isCompetitorScoring ? (
        <section className="card">
          <h2 className="card__title">Competitor scoring in progress</h2>
          <p className="card__copy">{liveScanProgress?.description ?? "Scoring the discovered top competitors now."}</p>
          <div className="section-note" style={{ marginTop: 16 }}>
            <strong>{liveScanProgress?.title}</strong>
            <div>
              {liveScanProgress?.totalCompetitors
                ? `${liveScanProgress.completedCompetitors ?? 0} of ${liveScanProgress.totalCompetitors} competitors processed.`
                : "Waiting for the top competitor set to be discovered."}
            </div>
          </div>
        </section>
      ) : null}

      {report?.competitors.length ? (
        <div className="stack">
          {report.competitors.map((competitor, index) => {
            const liveAnalysis = competitorAnalyses[index] ?? null;
            return (
              <section key={competitor.url} className="card">
                <h2 className="card__title">{competitor.displayUrl || shortenDisplayUrl(competitor.url)}</h2>
                <div className="dashboard-grid" style={{ marginTop: 16 }}>
                  <div className="section-note">
                    <strong>Discovery footprint</strong>
                    <div>
                      Best rank {competitor.bestRank ? `#${competitor.bestRank}` : "not observed"} · appeared {competitor.appearanceCount} time
                      {competitor.appearanceCount === 1 ? "" : "s"}
                    </div>
                  </div>
                  <div className="section-note">
                    <strong>Source paths</strong>
                    <div>{competitor.sourceDomains.join(", ") || "No discovery sources saved yet."}</div>
                  </div>
                </div>
                <div className="section-note" style={{ marginTop: 12 }}>
                  <strong>Audience</strong>
                  <div>{competitor.analysis?.audience ?? liveAnalysis?.audience ?? "No audience inference saved yet."}</div>
                </div>
                <div className="section-note" style={{ marginTop: 12 }}>
                  <strong>Positioning</strong>
                  <div>{competitor.analysis?.positioning ?? liveAnalysis?.positioning ?? "No positioning inference saved yet."}</div>
                </div>
                <div className="section-note" style={{ marginTop: 12 }}>
                  <strong>Outcomes</strong>
                  <div>{competitor.analysis?.outcomes.join(", ") || liveAnalysis?.outcomes.join(", ") || "No clear outcomes inferred yet."}</div>
                </div>
                <div className="section-note" style={{ marginTop: 12 }}>
                  <strong>Why it was discovered</strong>
                  <div>{competitor.topReasons.join(" ") || "No discovery rationale saved yet."}</div>
                </div>
              </section>
            );
          })}
        </div>
      ) : loading ? (
        <section className="card">
          <h2 className="card__title">Loading competitors</h2>
          <p className="card__copy">Reading the latest competitor set from SQLite.</p>
        </section>
      ) : competitorUrls.length ? (
        <section className="card">
          <h2 className="card__title">Competitor results pending</h2>
          <p className="card__copy">The top competitors have been discovered, but their detailed results are still being prepared.</p>
        </section>
      ) : (
        <section className="card">
          <h2 className="card__title">No competitors yet</h2>
          <p className="card__copy">Finish the website scoring pass and Site Intent will begin scoring the top five competitors automatically.</p>
        </section>
      )}
    </div>
  );
}
