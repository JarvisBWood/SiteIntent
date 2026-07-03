"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, PlayCircle, ScanLine, Sparkles } from "lucide-react";

import { ProjectSetupModal } from "@/components/project-setup-modal";
import { SiteFavicon } from "@/components/site-favicon";
import { useSiteIntent } from "@/components/site-intent-provider";
import { DISCOVERABILITY_FACTORS, type DiscoverabilityFactorId } from "@/lib/discoverability/types";
import { type ModelProvider } from "@/lib/llm/provider-models";
import type { ProjectOverviewReport } from "@/lib/reports";
import { RANKABILITY_FACTORS, type RankabilityFactorId } from "@/lib/scoring/types";
import type { ProjectScanRun } from "@/lib/site-state";

type ProviderScoreRow = {
  provider: ModelProvider;
  model: string;
  label: string;
  score: number | null;
};

const PROVIDER_META: Record<ModelProvider, { label: string; iconSrc: string }> = {
  openai: { label: "OpenAI", iconSrc: "/provider-icons/openai.svg" },
  anthropic: { label: "Anthropic", iconSrc: "/provider-icons/anthropic.svg" },
  google: { label: "Gemini", iconSrc: "/provider-icons/google.svg" }
};

export default function DashboardPage() {
  const {
    hydrated,
    projects,
    activeProjectId,
    scanRuns,
    overviewReportsByProject,
    loadProjectOverviewReport,
    startScan,
    isScanning,
    lastScanError,
    scanProgressByProject
  } = useSiteIntent();
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? projects[0] ?? null;
  const latestScan = useMemo(
    () => (activeProject ? scanRuns.find((scan) => scan.projectId === activeProject.id) ?? null : null),
    [activeProject, scanRuns]
  );
  const progress = activeProject ? scanProgressByProject[activeProject.id] ?? null : null;
  const [overviewLoading, setOverviewLoading] = useState(false);
  const overview = activeProject ? overviewReportsByProject[activeProject.id] ?? null : null;

  useEffect(() => {
    if (!hydrated || !activeProject?.id) {
      return;
    }

    async function loadOverview() {
      if (Object.prototype.hasOwnProperty.call(overviewReportsByProject, activeProject.id)) {
        return;
      }
      setOverviewLoading(true);
      try {
        await loadProjectOverviewReport(activeProject.id);
      } finally {
        setOverviewLoading(false);
      }
    }

    void loadOverview();
  }, [activeProject?.id, hydrated, loadProjectOverviewReport, overviewReportsByProject]);

  const aiSearchProviderScores = useMemo(() => buildAiSearchProviderScores(latestScan), [latestScan]);
  const rankabilityProviderScores = useMemo(
    () => buildProviderMetricRows(latestScan, (entry) => entry.rankability?.weightedTotalScore ?? null),
    [latestScan]
  );
  const discoverabilityProviderScores = useMemo(
    () => buildProviderMetricRows(latestScan, (entry) => entry.discoverability?.discoverabilityScore ?? null),
    [latestScan]
  );

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
          <p className="page-copy">Track the averaged score plus the individual OpenAI, Anthropic, and Gemini results behind it.</p>
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
          note="Average blended score across the three provider runs."
          providerRows={aiSearchProviderScores}
        />
        <MetricCard
          label="Rankability"
          value={overview?.rankabilityScore ?? null}
          benchmark={overview?.competitorBenchmarks.rankabilityScore ?? null}
          note="Average of the provider-specific rankability scores."
          providerRows={rankabilityProviderScores}
        />
        <MetricCard
          label="Discoverability"
          value={overview?.discoverabilityScore ?? null}
          benchmark={overview?.competitorBenchmarks.discoverabilityScore ?? null}
          note="Average of the provider-specific discoverability scores."
          providerRows={discoverabilityProviderScores}
        />
      </div>

      <div className="dashboard-grid">
        <BreakdownCard
          title="Rankability Breakdown"
          summary={overview?.summary.rankability ?? null}
          tone="rankability"
          items={overview?.rankabilityBreakdown ?? []}
          pending={!hasRankability}
          providerFactorScores={buildRankabilityFactorMap(latestScan)}
        />
        <BreakdownCard
          title="Discoverability Breakdown"
          summary={overview?.summary.discoverability ?? null}
          tone="discoverability"
          items={overview?.discoverabilityBreakdown ?? []}
          pending={!hasDiscoverability}
          providerFactorScores={buildDiscoverabilityFactorMap(latestScan)}
        />
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  benchmark,
  note,
  providerRows
}: {
  label: string;
  value: number | null;
  benchmark: ProjectOverviewReport["competitorBenchmarks"]["aiSearchScore"] | null;
  note: string;
  providerRows: ProviderScoreRow[];
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
      {providerRows.length ? (
        <div className="metric-card__providers">
          {providerRows.map((row) => (
            <ProviderScoreRowCard key={row.provider} row={row} />
          ))}
        </div>
      ) : null}
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
  pending,
  providerFactorScores
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
  providerFactorScores: Record<string, ProviderScoreRow[]>;
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
              <div className="score-factor-card__bar-group">
                <ScoreBar score={item.score} />
                {(providerFactorScores[item.id] ?? []).length ? (
                  <div className="score-factor-card__providers">
                    {(providerFactorScores[item.id] ?? []).map((row) => (
                      <ProviderBarRow key={`${item.id}-${row.provider}`} row={row} />
                    ))}
                  </div>
                ) : null}
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

function ScoreBar({ score }: { score: number }) {
  return (
    <div className="score-factor-bar" aria-hidden="true">
      <div className="score-factor-bar__fill" style={{ width: `${Math.max(0, Math.min(100, score))}%` }} />
    </div>
  );
}

function ProviderScoreRowCard({ row }: { row: ProviderScoreRow }) {
  return (
    <div className="provider-score-row">
      <div className="provider-score-row__identity">
        <ProviderIcon provider={row.provider} />
        <div className="provider-score-row__copy">
          <strong>{row.label}</strong>
          <span>{formatModelName(row.model)}</span>
        </div>
      </div>
      <div className={row.score == null ? "provider-score-row__score" : `provider-score-row__score provider-score-row__score--${getScoreTone(row.score)}`}>
        {row.score == null ? "N/A" : `${Math.round(row.score)}%`}
      </div>
    </div>
  );
}

function ProviderBarRow({ row }: { row: ProviderScoreRow }) {
  return (
    <div className="provider-bar-row">
      <div className="provider-bar-row__label">
        <ProviderIcon provider={row.provider} />
        <span>{row.label}</span>
      </div>
      <div className="provider-bar-row__track" aria-hidden="true">
        <div className="provider-bar-row__fill" style={{ width: `${Math.max(0, Math.min(100, row.score ?? 0))}%` }} />
      </div>
      <div className="provider-bar-row__score">{row.score == null ? "N/A" : `${Math.round(row.score)}%`}</div>
    </div>
  );
}

function ProviderIcon({ provider }: { provider: ModelProvider }) {
  const meta = PROVIDER_META[provider];
  return <img className="provider-icon" src={meta.iconSrc} alt={`${meta.label} icon`} />;
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

function buildProviderMetricRows(
  scan: ProjectScanRun | null,
  selector: (entry: NonNullable<ProjectScanRun["providerScanResults"]>[number]) => number | null
) {
  return (scan?.providerScanResults ?? [])
    .map((entry) => ({
      provider: entry.provider,
      model: entry.model,
      label: PROVIDER_META[entry.provider].label,
      score: selector(entry)
    }))
    .filter((entry) => entry.score != null);
}

function buildAiSearchProviderScores(scan: ProjectScanRun | null) {
  return buildProviderMetricRows(scan, (entry) => {
    const rankability = entry.rankability?.weightedTotalScore ?? null;
    const discoverability = entry.discoverability?.discoverabilityScore ?? null;
    return rankability == null || discoverability == null ? null : roundOne(rankability * 0.4 + discoverability * 0.6);
  });
}

function buildRankabilityFactorMap(scan: ProjectScanRun | null) {
  const entries = scan?.providerScanResults ?? [];
  return Object.fromEntries(
    RANKABILITY_FACTORS.map((factor) => [
      factor.id,
      entries
        .map((entry) => ({
          provider: entry.provider,
          model: entry.model,
          label: PROVIDER_META[entry.provider].label,
          score: entry.rankability?.factorScores[factor.id as RankabilityFactorId]?.score ?? null
        }))
        .filter((row) => row.score != null)
    ])
  ) as Record<RankabilityFactorId, ProviderScoreRow[]>;
}

function buildDiscoverabilityFactorMap(scan: ProjectScanRun | null) {
  const entries = scan?.providerScanResults ?? [];
  return Object.fromEntries(
    DISCOVERABILITY_FACTORS.map((factor) => [
      factor.id,
      entries
        .map((entry) => ({
          provider: entry.provider,
          model: entry.model,
          label: PROVIDER_META[entry.provider].label,
          score: entry.discoverability?.factorScores[factor.id as DiscoverabilityFactorId]?.score ?? null
        }))
        .filter((row) => row.score != null)
    ])
  ) as Record<DiscoverabilityFactorId, ProviderScoreRow[]>;
}

function formatModelName(model: string) {
  return model.replace(/-/g, " ");
}

function roundOne(value: number) {
  return Math.round(value * 10) / 10;
}
