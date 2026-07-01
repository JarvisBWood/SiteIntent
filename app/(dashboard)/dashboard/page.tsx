"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, PlayCircle, ScanLine, Sparkles } from "lucide-react";

import { ProjectSetupModal } from "@/components/project-setup-modal";
import { SiteFavicon } from "@/components/site-favicon";
import { useSiteIntent } from "@/components/site-intent-provider";
import type { ProjectOverviewReport } from "@/lib/reports";

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
  }, [activeProject?.id, hydrated, progress?.stage, progress?.progress, progress?.analyzedPages, progress?.completedCompetitors]);

  if (!activeProject) {
    return (
      <div className="page-shell">
        <ProjectSetupModal autoOpenWhenNoWebsites hideTrigger lockWhenNoWebsites />
        <div className="page-header-inline">
          <div className="page-header-inline__content">
            <div className="eyebrow">
              <Sparkles size={14} />
              Dashboard
            </div>
            <h1 className="page-title">Start with your website</h1>
            <p className="page-copy">Add a website and Site Intent will score how rankable and discoverable it is for AI search.</p>
          </div>
        </div>
      </div>
    );
  }

  const hasAnyScore =
    overview?.aiSearchScore != null || overview?.rankabilityScore != null || overview?.discoverabilityScore != null;
  const hasRankability = overview?.rankabilityScore != null;
  const hasDiscoverability = overview?.discoverabilityScore != null;
  const pendingMessage = overviewLoading
    ? "Loading the latest website snapshot. The score cards below will update once the scan completes."
    : "The score cards below will update once the current scan completes.";

  return (
    <div className="page-shell">
      {lastScanError ? <section className="section-note">{lastScanError}</section> : null}

      <div className="page-header-inline">
        <div className="page-header-inline__content">
          <div className="eyebrow">
            <Sparkles size={14} />
            Dashboard
          </div>
          <div className="dashboard-title-row">
            <SiteFavicon
              url={activeProject.websiteUrl}
              faviconUrl={activeProject.websiteFaviconUrl}
              alt={`${activeProject.name} favicon`}
              className="site-favicon dashboard-title-row__favicon"
            />
            <h1 className="page-title">{activeProject.name}</h1>
          </div>
          <p className="page-copy">Track how strong your website looks to AI systems and where it is still getting missed.</p>
        </div>
        <div className="page-header-inline__actions">
          <button
            className="button button--primary"
            type="button"
            onClick={() => startScan(activeProject.id, { navigate: false, scanMode: "full" })}
            disabled={isScanning}
          >
            {isScanning ? <ScanLine size={16} /> : <PlayCircle size={16} />}
            {isScanning ? "Scanning..." : "Run Scan"}
          </button>
          <Link className="button button--secondary" href="/competitors">
            Competitors
            <ArrowRight size={16} />
          </Link>
        </div>
      </div>

      {!hasAnyScore ? (
        <section className="section-note">
          <strong>Scores pending</strong>
          <div>{pendingMessage}</div>
        </section>
      ) : null}

      <div className="metric-grid">
        <MetricCard
          label="AI Search Score"
          value={overview?.aiSearchScore ?? null}
          benchmark={overview?.competitorBenchmarks.aiSearchScore ?? null}
          note="A blended view of how strong the site looks and how often it gets discovered."
        />
        <MetricCard
          label="Rankability"
          value={overview?.rankabilityScore ?? null}
          benchmark={overview?.competitorBenchmarks.rankabilityScore ?? null}
          note="How strong the website looks once AI includes it as a candidate."
        />
        <MetricCard
          label="Discoverability"
          value={overview?.discoverabilityScore ?? null}
          benchmark={overview?.competitorBenchmarks.discoverabilityScore ?? null}
          note="How likely AI is to find the website in repeated recommendation searches."
        />
      </div>

      <div className="dashboard-grid">
        <BreakdownCard
          title="Rankability Breakdown"
          summary={overview?.summary.rankability ?? null}
          tone="rankability"
          items={overview?.rankabilityBreakdown ?? []}
          pending={!hasRankability}
        />
        <BreakdownCard
          title="Discoverability Breakdown"
          summary={overview?.summary.discoverability ?? null}
          tone="discoverability"
          items={overview?.discoverabilityBreakdown ?? []}
          pending={!hasDiscoverability}
        />
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  benchmark,
  note
}: {
  label: string;
  value: number | null;
  benchmark: ProjectOverviewReport["competitorBenchmarks"]["aiSearchScore"] | null;
  note: string;
}) {
  const scoreTone = value == null ? null : getScoreTone(value);

  return (
    <div className="card metric-card">
      <div className="metric-card__label">{label}</div>
      <div className="metric-card__value-row">
        <div className={scoreTone ? `metric-card__value metric-card__value--${scoreTone}` : "metric-card__value"}>
          {value == null ? "Pending" : `${Math.round(value)}%`}
        </div>
        {benchmark ? <MetricBenchmark benchmark={benchmark} /> : null}
      </div>
      <div className="metric-card__note">{note}</div>
    </div>
  );
}

function MetricBenchmark({
  benchmark
}: {
  benchmark: NonNullable<ProjectOverviewReport["competitorBenchmarks"]["aiSearchScore"]>;
}) {
  return (
    <div className="metric-card__benchmark">
      <BenchmarkPill benchmark={benchmark} />
    </div>
  );
}

function BreakdownCard({
  title,
  summary,
  tone,
  items,
  pending
}: {
  title: string;
  summary: string | null;
  tone: "rankability" | "discoverability";
  pending: boolean;
  items: Array<{
    id: string;
    label: string;
    description: string;
    score: number;
    weight: number;
    weightedContribution: number;
    evidence: string;
    bestCompetitor: ProjectOverviewReport["competitorBenchmarks"]["aiSearchScore"];
  }>;
}) {
  return (
    <section className={`card score-breakdown score-breakdown--${tone}`}>
      <div className="score-breakdown__header">
        <h2 className="card__title">{title}</h2>
        <span className="score-breakdown__badge">{items.length} factors</span>
      </div>
      {summary ? <p className="card__copy">{summary}</p> : null}
      {items.length ? (
        <div className="score-breakdown__list">
          {items.map((item) => (
            <article key={item.id} className="score-factor-card">
              <div className="score-factor-card__top">
                <div>
                  <strong className="score-factor-card__title">{item.label}</strong>
                </div>
                <div className={`score-factor-card__score score-factor-card__score--${getScoreTone(item.score)}`}>
                  {Math.round(item.score)}%
                </div>
              </div>
              <div className="score-factor-bar" aria-hidden="true">
                <div
                  className="score-factor-bar__fill"
                  style={{ width: `${Math.max(0, Math.min(100, item.score))}%` }}
                />
              </div>
              {item.bestCompetitor ? (
                <div className="score-factor-card__benchmark">
                  Best: <BenchmarkPill benchmark={item.bestCompetitor} />
                </div>
              ) : null}
              <div className="score-factor-card__description">{item.description}</div>
              {item.evidence ? <div className="score-factor-card__evidence">{item.evidence}</div> : null}
            </article>
          ))}
        </div>
      ) : (
        <div className="section-note" style={{ marginTop: 16 }}>
          <strong>{pending ? "Breakdown pending" : "No breakdown available"}</strong>
          <div>
            {pending
              ? "This breakdown will populate once the current scan completes."
              : "No factor-level breakdown has been saved yet."}
          </div>
        </div>
      )}
    </section>
  );
}

function getScoreTone(score: number) {
  if (score >= 80) {
    return "good";
  }

  if (score >= 50) {
    return "warn";
  }

  return "bad";
}

function BenchmarkPill({
  benchmark
}: {
  benchmark: NonNullable<ProjectOverviewReport["competitorBenchmarks"]["aiSearchScore"]>;
}) {
  return (
    <span className="benchmark-pill">
      <SiteFavicon
        url={benchmark.competitorUrl}
        faviconUrl={benchmark.competitorFaviconUrl}
        alt={`${benchmark.competitorName} favicon`}
        className="site-favicon benchmark-pill__favicon"
      />
      <span className="benchmark-pill__text">
        <strong>{benchmark.competitorName}</strong>
        <span>{Math.round(benchmark.score)}%</span>
      </span>
    </span>
  );
}
