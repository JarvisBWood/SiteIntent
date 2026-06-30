"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Lightbulb } from "lucide-react";

import { useSiteIntent } from "@/components/site-intent-provider";
import type { ProjectRecommendationsReport } from "@/lib/sqlite-queries";

export default function RecommendationsPage() {
  const { hydrated, projects, activeProjectId, scanProgressByProject } = useSiteIntent();
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? projects[0] ?? null;
  const liveScanProgress = activeProject ? scanProgressByProject[activeProject.id] ?? null : null;
  const [report, setReport] = useState<ProjectRecommendationsReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [notReady, setNotReady] = useState(false);

  useEffect(() => {
    if (!hydrated || !activeProject?.id) {
      setReport(null);
      setNotReady(false);
      return;
    }

    const controller = new AbortController();

    async function loadReport() {
      setLoading(true);
      setNotReady(false);
      try {
        const response = await fetch(`/api/projects/${encodeURIComponent(activeProject.id)}/recommendations`, {
          headers: { Accept: "application/json" },
          signal: controller.signal
        });

        if (response.status === 404) {
          setReport(null);
          setNotReady(true);
          return;
        }

        if (!response.ok) {
          throw new Error("Unable to load recommendations.");
        }

        const payload = (await response.json()) as { report?: ProjectRecommendationsReport };
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

  const recommendations = report?.recommendations ?? [];
  const grouped = {
    CHANGE: recommendations.filter((item) => item.action === "CHANGE"),
    REMOVE: recommendations.filter((item) => item.action === "REMOVE"),
    ADD: recommendations.filter((item) => item.action === "ADD")
  };
  const competitorScoringActive = liveScanProgress?.scanMode === "full" && liveScanProgress.stage !== "completed";
  const actionsReady = Boolean(report && recommendations.length);

  return (
    <div className="page-shell">
      <section className="page-hero">
        <div className="eyebrow">
          <Lightbulb size={14} />
          Actions
        </div>
        <h1 className="page-title">What to do next</h1>
        <p className="page-copy">
          This page turns the completed website and competitor analysis into concrete changes, removals, and additions that should improve
          rankability and discoverability.
        </p>
        <div className="hero-actions">
          <Link className="button button--secondary" href="/dashboard">
            Back to dashboard
            <ArrowRight size={16} />
          </Link>
        </div>
      </section>

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

      {actionsReady ? (
        <div className="stack">
          {(["CHANGE", "REMOVE", "ADD"] as const).map((action) => (
            <section key={action} className="card">
              <div className="card__header">
                <div>
                  <h2 className="card__title">{action}</h2>
                  <p className="card__copy">
                    {action === "CHANGE"
                      ? "Refine wording, hierarchy, or page role."
                      : action === "REMOVE"
                        ? "Cut weak, generic, or noisy language."
                        : "Add proof, coverage, or missing category signals."}
                  </p>
                </div>
                <span className="tag">{grouped[action].length} items</span>
              </div>

              <div className="stack" style={{ marginTop: 16 }}>
                {grouped[action].length ? (
                  grouped[action].map((recommendation) => (
                    <article key={`${recommendation.action}-${recommendation.title}`} className="recommendation-card">
                      <div className="recommendation-card__top">
                        <span className={`badge badge--${recommendation.action.toLowerCase()}`}>{recommendation.action}</span>
                        <span className="tag">Priority {recommendation.priority}</span>
                      </div>
                      <h3 className="recommendation-card__title">{recommendation.title}</h3>
                      <p className="card__copy">{recommendation.rationale}</p>
                      <div className="section-note" style={{ marginTop: 12 }}>
                        <strong>Why this surfaced</strong>
                        <div>{recommendation.source}</div>
                      </div>
                      {recommendation.evidence.length ? (
                        <div className="stack" style={{ marginTop: 12 }}>
                          {recommendation.evidence.map((item, index) => (
                            <div key={`${recommendation.title}-${index}`} className="section-note">
                              <div>{item}</div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </article>
                  ))
                ) : (
                  <div className="section-note">No recommendations in this group yet.</div>
                )}
              </div>
            </section>
          ))}
        </div>
      ) : loading ? (
        <section className="card">
          <h2 className="card__title">Loading actions</h2>
          <p className="card__copy">Reading the latest recommendations from SQLite.</p>
        </section>
      ) : (
        <section className="card">
          <h2 className="card__title">No actions ready yet</h2>
          <p className="card__copy">
            Once the website scoring and competitor scan finish, this page will show the most useful changes to improve rankability and
            discoverability.
          </p>
          <div className="section-note" style={{ marginTop: 16 }}>
            <strong>What will appear here</strong>
            <div>
              A prioritized list of changes, removals, and additions. The recommendations are based on the website&apos;s score breakdown,
              discoverability signals, and how the top competitors are performing.
            </div>
          </div>
          {notReady ? (
            <div className="section-note" style={{ marginTop: 12 }}>
              <strong>Waiting for competitor analysis</strong>
              <div>Actions unlock after the competitor scan has completed and the app can compare your site against the top 5 results.</div>
            </div>
          ) : null}
        </section>
      )}
    </div>
  );
}
