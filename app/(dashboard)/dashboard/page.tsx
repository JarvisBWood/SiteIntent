"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Globe, PlayCircle, ScanLine, Sparkles } from "lucide-react";

import { ProjectSetupModal } from "@/components/project-setup-modal";
import { useSiteIntent } from "@/components/site-intent-provider";
import type { ProjectOverviewReport } from "@/lib/sqlite-queries";

export default function DashboardPage() {
  const {
    hydrated,
    projects,
    activeProjectId,
    startScan,
    isScanning,
    lastScanError,
    scanProgressByProject
  } = useSiteIntent();
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? projects[0] ?? null;
  const progress = activeProject ? scanProgressByProject[activeProject.id] ?? null : null;
  const [overview, setOverview] = useState<ProjectOverviewReport | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);

  useEffect(() => {
    if (!hydrated || !activeProject?.id) {
      setOverview(null);
      return;
    }

    const controller = new AbortController();

    async function loadOverview() {
      setOverviewLoading(true);
      try {
        const response = await fetch(`/api/projects/${encodeURIComponent(activeProject.id)}/overview`, {
          headers: { Accept: "application/json" },
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error("Unable to load project overview.");
        }

        const payload = (await response.json()) as { report?: ProjectOverviewReport };
        setOverview(payload.report ?? null);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setOverview(null);
      } finally {
        if (!controller.signal.aborted) {
          setOverviewLoading(false);
        }
      }
    }

    void loadOverview();
    return () => controller.abort();
  }, [activeProject?.id, hydrated, progress?.stage]);

  if (!activeProject) {
    return (
      <div className="page-shell">
        <ProjectSetupModal autoOpenWhenNoWebsites hideTrigger lockWhenNoWebsites />
        <section className="page-hero">
          <div className="eyebrow">
            <Sparkles size={14} />
            Dashboard
          </div>
          <h1 className="page-title">Start with your website</h1>
          <p className="page-copy">Add a website and Site Intent will score how rankable and discoverable it is for AI search.</p>
        </section>
      </div>
    );
  }

  const hasScores = overview?.aiSearchScore != null && overview.rankabilityScore != null && overview.discoverabilityScore != null;
  const isWebsiteGathering = Boolean(progress && progress.scanMode === "initial" && progress.stage !== "completed");
  const isCompetitorScoring = Boolean(progress && progress.scanMode === "full" && progress.stage !== "completed");
  const latestScanFailed = overview?.latestScan?.scoringStatus === "failed";

  return (
    <div className="page-shell">
      {lastScanError ? <section className="section-note">{lastScanError}</section> : null}

      <section className="card website-overview-card">
        <div className="card__header">
          <div className="website-overview-card__identity">
            <div>
              <div className="eyebrow">
                <Globe size={14} />
                Your website
              </div>
              <h1 className="card__title website-overview-card__title">{activeProject.name}</h1>
              <p className="card__copy">{activeProject.websiteDisplayUrl}</p>
              {overview?.latestScan ? <p className="card__copy">Last scan: {new Date(overview.latestScan.completedAt).toLocaleString()}</p> : null}
            </div>
          </div>
          <div className="hero-actions website-overview-card__actions">
            <button className="button button--primary" type="button" onClick={() => startScan(activeProject.id, { navigate: false })} disabled={isScanning}>
              {isScanning ? <ScanLine size={16} /> : <PlayCircle size={16} />}
              {isScanning ? "Scanning..." : "Run scan"}
            </button>
            <Link className="button button--secondary" href="/competitors">
              Competitors
              <ArrowRight size={16} />
            </Link>
          </div>
        </div>

        {isWebsiteGathering && progress ? <ScanStateCard progress={progress} label="Gathering website data" /> : null}
        {!isWebsiteGathering && isCompetitorScoring ? (
          <section className="section-note" style={{ marginTop: 16 }}>
            <strong>Competitor scoring in progress</strong>
            <div>{progress?.description ?? "Scoring the top competitors in the background."}</div>
          </section>
        ) : null}
      </section>

      {hasScores ? (
        <>
          <div className="metric-grid">
            <MetricCard
              label="AI Search Score"
              value={overview.aiSearchScore ?? 0}
              note="40% Rankability and 60% Discoverability, weighted toward being found first."
            />
            <MetricCard
              label="Rankability"
              value={overview.rankabilityScore ?? 0}
              note="How strong the website looks once AI includes it as a candidate."
            />
            <MetricCard
              label="Discoverability"
              value={overview.discoverabilityScore ?? 0}
              note="How likely AI is to find the website in repeated recommendation searches."
            />
          </div>

          <div className="dashboard-grid">
            <BreakdownCard
              title="Rankability Breakdown"
              summary={overview.summary.rankability}
              tone="rankability"
              items={overview.rankabilityBreakdown}
            />
            <BreakdownCard
              title="Discoverability Breakdown"
              summary={overview.summary.discoverability}
              tone="discoverability"
              items={overview.discoverabilityBreakdown}
            />
          </div>
        </>
      ) : latestScanFailed ? (
        <section className="card">
          <h2 className="card__title">Website scoring failed</h2>
          <p className="card__copy">
            The site crawl completed, but Site Intent could not finish computing the website scores for the latest scan.
          </p>
          {overview?.latestScan?.scoringError ? (
            <div className="section-note" style={{ marginTop: 16 }}>
              <strong>Scoring error</strong>
              <div>{overview.latestScan.scoringError}</div>
            </div>
          ) : null}
        </section>
      ) : (
        <section className="card">
          <h2 className="card__title">Website score pending</h2>
          <p className="card__copy">
            {overviewLoading
              ? "Loading the latest website snapshot."
              : "Your dashboard scores will appear here once the website scan finishes."}
          </p>
        </section>
      )}
    </div>
  );
}

function MetricCard({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <div className="card metric-card">
      <div className="metric-card__label">{label}</div>
      <div className="metric-card__value">{Math.round(value)}%</div>
      <div className="metric-card__note">{note}</div>
    </div>
  );
}

function ScanStateCard({
  progress,
  label
}: {
  progress: NonNullable<ReturnType<typeof useSiteIntent>["scanProgressByProject"][string]>;
  label: string;
}) {
  return (
    <section className="setup-scan" style={{ marginTop: 16 }}>
      <div className="setup-scan__hero">
        <div className="setup-scan__copy">
          <div className="setup-scan__eyebrow">{label}</div>
          <h2 className="setup-scan__title">{progress.title}</h2>
          <p className="setup-scan__description">{progress.description}</p>
        </div>
      </div>

      <div className="setup-scan__progress" aria-label="Scan progress">
        <div className="setup-scan__progress-track">
          <div className="setup-scan__progress-fill" style={{ width: `${progress.progress}%` }} />
        </div>
        <div className="setup-scan__progress-meta">
          <span>{progress.progress}% complete</span>
          {progress.analyzedPages !== undefined && progress.totalPages !== undefined ? (
            <span>{`${progress.analyzedPages} of ${progress.totalPages} pages analyzed`}</span>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function BreakdownCard({
  title,
  summary,
  tone,
  items
}: {
  title: string;
  summary: string | null;
  tone: "rankability" | "discoverability";
  items: Array<{
    id: string;
    label: string;
    description: string;
    score: number;
    weight: number;
    weightedContribution: number;
    evidence: string;
  }>;
}) {
  return (
    <section className={`card score-breakdown score-breakdown--${tone}`}>
      <div className="score-breakdown__header">
        <h2 className="card__title">{title}</h2>
        <span className="score-breakdown__badge">{items.length} factors</span>
      </div>
      {summary ? <p className="card__copy">{summary}</p> : null}
      <div className="score-breakdown__list">
        {items.map((item) => (
          <article key={item.id} className="score-factor-card">
            <div className="score-factor-card__top">
              <div>
                <strong className="score-factor-card__title">{item.label}</strong>
                <div className="score-factor-card__meta">
                  {item.weight}% weight · {item.weightedContribution.toFixed(1)} weighted points
                </div>
              </div>
              <div className="score-factor-card__score">{Math.round(item.score)}%</div>
            </div>
            <div className="score-factor-bar" aria-hidden="true">
              <div
                className="score-factor-bar__fill"
                style={{ width: `${Math.max(0, Math.min(100, item.score))}%` }}
              />
            </div>
            <div className="score-factor-card__description">{item.description}</div>
            {item.evidence ? <div className="score-factor-card__evidence">{item.evidence}</div> : null}
          </article>
        ))}
      </div>
    </section>
  );
}
