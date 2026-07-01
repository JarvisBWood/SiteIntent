"use client";

import { useEffect, useState } from "react";
import { BarChart3, PlayCircle, ScanLine } from "lucide-react";

import { SiteFavicon } from "@/components/site-favicon";
import { useSiteIntent } from "@/components/site-intent-provider";
import type { ProjectCompetitorReport } from "@/lib/reports";
import { shortenDisplayUrl } from "@/lib/site-state";

export default function CompetitorsPage() {
  const { hydrated, projects, activeProjectId, scanProgressByProject, startScan, isScanning } = useSiteIntent();
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? projects[0] ?? null;
  const liveScanProgress = activeProject ? scanProgressByProject[activeProject.id] ?? null : null;
  const [report, setReport] = useState<ProjectCompetitorReport | null>(null);

  useEffect(() => {
    if (!hydrated || !activeProject?.id) {
      setReport(null);
      return;
    }

    const controller = new AbortController();

    async function loadReport() {
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
      }
    }

    void loadReport();
    return () => controller.abort();
  }, [
    activeProject?.id,
    hydrated,
    liveScanProgress?.stage,
    liveScanProgress?.progress,
    liveScanProgress?.completedCompetitors,
    liveScanProgress?.totalCompetitors
  ]);

  const competitorUrls = activeProject?.competitorUrls.slice(0, 5) ?? [];
  const sortedCompetitors = report?.competitors
    ? [...report.competitors].sort((left, right) => {
        const leftScore = left.aiSearchScore ?? -1;
        const rightScore = right.aiSearchScore ?? -1;

        if (rightScore !== leftScore) {
          return rightScore - leftScore;
        }

        return (left.displayUrl || left.url).localeCompare(right.displayUrl || right.url);
      })
    : [];
  const placeholderCompetitors = (competitorUrls.length ? competitorUrls : [""]).map((url, index) => ({
    url,
    displayUrl: url ? shortenDisplayUrl(url) : `Competitor ${index + 1}`
  }));
  const showPlaceholderCards = !sortedCompetitors.length;

  return (
    <div className="page-shell">
      <div className="page-header-inline">
        <div className="page-header-inline__content">
          <div className="eyebrow">
            <BarChart3 size={14} />
            Competitors
          </div>
          <h1 className="page-title">Competitor results</h1>
          <p className="page-copy">
            Competitor scoring starts after your website scoring finishes. This page shows up to five validated competitors, and only keeps
            websites that AI scored as true competitors with high confidence.
          </p>
        </div>
        <div className="page-header-inline__actions">
          <button
            className="button button--primary"
            type="button"
            onClick={() => activeProject && startScan(activeProject.id, { navigate: false, scanMode: "competitors" })}
            disabled={isScanning || !activeProject}
          >
            {isScanning ? <ScanLine size={16} /> : <PlayCircle size={16} />}
            {isScanning ? "Scanning..." : "Run Competitor Scan"}
          </button>
        </div>
      </div>
      {sortedCompetitors.length ? (
        <div className="stack">
          {sortedCompetitors.map((competitor, index) => {
            const rank = index + 1;
            const competitorLabel = getCompetitorLabel(competitor.url, competitor.displayUrl);
            const competitorDomain = getCompetitorDomain(competitor.url, competitor.displayUrl);
            return (
              <section key={competitor.url} className="card">
                <div className="website-overview-card__identity">
                  <div className="competitor-rank-lockup">
                    <span className="competitor-rank-badge" aria-label={`Rank ${rank}`}>
                      {rank}
                    </span>
                    <SiteFavicon
                      url={competitor.url}
                      faviconUrl={competitor.faviconUrl}
                      alt={`${competitor.displayUrl || shortenDisplayUrl(competitor.url)} favicon`}
                    />
                  </div>
                  <div>
                    <h2 className="card__title">
                      <a href={competitor.url} target="_blank" rel="noreferrer noopener">
                        {competitorLabel}
                      </a>
                    </h2>
                    <p className="card__copy">{competitorDomain}</p>
                  </div>
                </div>
                <div className="metric-grid" style={{ marginTop: 16 }}>
                  <MetricStat
                    label="AI Search Score"
                    value={competitor.aiSearchScore}
                    note="Overall AI visibility strength across discovery and website quality."
                  />
                  <MetricStat
                    label="Rankability"
                    value={competitor.rankabilityScore}
                    note="How strong the website looks once AI includes it as a candidate."
                  />
                  <MetricStat
                    label="Discoverability"
                    value={competitor.discoverabilityScore}
                    note="How likely AI is to surface the site in repeated searches."
                  />
                </div>
                <div className="section-note" style={{ marginTop: 12 }}>
                  <strong>Why it was discovered</strong>
                  <div>{competitor.topReasons.join(" ") || "No discovery rationale saved yet."}</div>
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="stack">
          {placeholderCompetitors.map((competitor, index) => (
            <section key={`${competitor.displayUrl}-${index}`} className="card">
              <div className="website-overview-card__identity">
                <div className="competitor-rank-lockup">
                  <span className="competitor-rank-badge" aria-label={`Rank ${index + 1}`}>
                    {index + 1}
                  </span>
                  <SiteFavicon
                    url={competitor.url}
                    faviconUrl={null}
                    alt={`${competitor.displayUrl} favicon`}
                  />
                </div>
                <div>
                  <h2 className="card__title">
                    {competitor.url ? (
                      <a href={competitor.url} target="_blank" rel="noreferrer noopener">
                        {getCompetitorLabel(competitor.url, competitor.displayUrl)}
                      </a>
                    ) : (
                      competitor.displayUrl
                    )}
                  </h2>
                  <p className="card__copy">
                    {competitor.url
                      ? getCompetitorDomain(competitor.url, competitor.displayUrl)
                      : "Validated competitor details will appear here once the scan completes."}
                  </p>
                </div>
              </div>
              <div className="metric-grid" style={{ marginTop: 16 }}>
                <MetricStat
                  label="AI Search Score"
                  value={null}
                  note="Overall AI visibility strength across discovery and website quality."
                />
                <MetricStat
                  label="Rankability"
                  value={null}
                  note="How strong the website looks once AI includes it as a candidate."
                />
                <MetricStat
                  label="Discoverability"
                  value={null}
                  note="How likely AI is to surface the site in repeated searches."
                />
              </div>
              <div className="section-note" style={{ marginTop: 12 }}>
                <strong>Why it was discovered</strong>
                <div>This explanation will be added once the competitor scan completes.</div>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function MetricStat({
  label,
  value,
  note
}: {
  label: string;
  value: number | null;
  note: string;
}) {
  const scoreTone = value == null ? null : getScoreTone(value);

  return (
    <section className="card metric-card">
      <div className="metric-card__label">{label}</div>
      <div className="metric-card__value-row">
        <div className={scoreTone ? `metric-card__value metric-card__value--${scoreTone}` : "metric-card__value"}>
          {value == null ? "Pending" : `${Math.round(value)}%`}
        </div>
      </div>
      <div className="metric-card__note">{note}</div>
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

function getCompetitorLabel(url: string, displayUrl?: string | null) {
  const domain = getCompetitorDomain(url, displayUrl);
  const base = domain.split(".")[0] || domain;
  const words = base
    .split(/[-_]+/g)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1));

  return words.join(" ") || domain;
}

function getCompetitorDomain(url: string, displayUrl?: string | null) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return shortenDisplayUrl(displayUrl || url).split("/")[0] || shortenDisplayUrl(displayUrl || url);
  }
}
