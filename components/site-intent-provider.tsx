"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { normalizeDiscoverabilityScorecard } from "@/lib/discoverability/score-site";
import type { DiscoverabilityScorecard } from "@/lib/discoverability/types";
import {
  buildCategoryModel,
  buildCompetitorAnalyses,
  buildCompetitorAnalysisFromPage,
  buildObservedIntent,
  createDefaultTargetIntentModel,
  createTargetIntentModelFromObservedIntent,
  normalizeTargetIntentModel,
  type CategoryModel,
  type CompetitorAnalysis,
  summarizeConceptDelta,
  type TargetIntentModel
} from "@/lib/models";
import { normalizeRankabilityScorecard } from "@/lib/scoring/score-site";
import type { RankabilityScorecard } from "@/lib/scoring/types";
import { getIncludedPageRecords } from "@/lib/scan/storage";
import type { ScanDiscoverySource, ScanProgressEvent } from "@/lib/scan/types";
import {
  createEmptyState,
  createDefaultPreferences,
  normalizeProjectScanDepth,
  shortenDisplayUrl,
  type ObservedIntent,
  type AppPreferences,
  type ProjectOnboardingState,
  type ProjectScanRun,
  type SiteIntentProject,
  type SiteIntentProjectDraft,
  type SiteIntentSession,
  type SiteIntentSessionState,
  ensureProjectName
} from "@/lib/site-state";
import { ToastViewport } from "@/components/toast-viewport";

type ScanProgressByProject = Record<string, ScanProgressEvent | null>;

type ToastMessage = {
  id: string;
  title: string;
  description: string;
  tone?: "default" | "success" | "error";
};

type PinnedScanToast = {
  title: string;
  description: string;
  detail?: string | null;
  progress: number;
} | null;

type SiteIntentContextValue = SiteIntentSessionState & {
  hydrated: boolean;
  signIn: (email: string, password: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  signOut: () => Promise<void>;
  createProject: (draft: SiteIntentProjectDraft) => SiteIntentProject;
  deleteProject: (projectId: string) => void;
  deleteCompetitor: (projectId: string, competitorIndex: number) => void;
  refreshCompetitor: (projectId: string, competitorUrl: string) => Promise<void>;
  selectProject: (projectId: string) => void;
  startScan: (
    projectOrId?: string | SiteIntentProject,
    options?: {
      navigate?: boolean;
      onProgress?: (event: ScanProgressEvent) => void;
      scanMode?: "initial" | "full" | "competitors";
      background?: boolean;
    }
  ) => Promise<ProjectScanRun | null>;
  updateTargetIntentModel: (next: TargetIntentModel) => void;
  updateProjectTargetIntentModel: (projectId: string, next: TargetIntentModel) => void;
  getProjectCategoryModel: (projectId: string) => CategoryModel | null;
  getProjectTargetIntentModel: (projectId: string) => TargetIntentModel | null;
  categoryModel: CategoryModel | null;
  competitorAnalyses: CompetitorAnalysis[];
  targetIntentModel: TargetIntentModel | null;
  rankability: RankabilityScorecard | null;
  discoverability: DiscoverabilityScorecard | null;
  conceptDelta: ReturnType<typeof summarizeConceptDelta> | null;
  isScanning: boolean;
  lastScanError: string | null;
  scanProgressByProject: ScanProgressByProject;
  preferences: AppPreferences;
  updatePreferences: (next: Partial<AppPreferences>) => void;
};

const SiteIntentContext = createContext<SiteIntentContextValue | null>(null);

function normalizeLoadedState(parsed?: Partial<SiteIntentSessionState> | null): SiteIntentSessionState {
  if (!parsed) {
    return createEmptyState();
  }

  const projects = Array.isArray(parsed.projects)
    ? parsed.projects.map((project) => ({
        ...project,
        websiteDisplayUrl:
          typeof project.websiteDisplayUrl === "string" && project.websiteDisplayUrl
            ? project.websiteDisplayUrl
            : shortenDisplayUrl(project.websiteUrl ?? ""),
        websiteFaviconUrl:
          typeof project.websiteFaviconUrl === "string" || project.websiteFaviconUrl === null ? project.websiteFaviconUrl : null,
        competitorDisplayUrls: Array.isArray(project.competitorDisplayUrls)
          ? project.competitorDisplayUrls.map((value, index) =>
              typeof value === "string" && value ? value : shortenDisplayUrl(project.competitorUrls?.[index] ?? "")
            )
          : Array.isArray(project.competitorUrls)
            ? project.competitorUrls.map((value) => shortenDisplayUrl(value))
            : [],
        competitorFaviconUrls: Array.isArray(project.competitorFaviconUrls)
          ? project.competitorFaviconUrls.map((value) => (typeof value === "string" ? value : null))
          : Array.isArray(project.competitorUrls)
            ? project.competitorUrls.map(() => null)
            : [],
        competitorAnalysesByUrl:
          project.competitorAnalysesByUrl && typeof project.competitorAnalysesByUrl === "object"
            ? (project.competitorAnalysesByUrl as SiteIntentProject["competitorAnalysesByUrl"])
            : {},
        competitorRefreshStatusByUrl:
          project.competitorRefreshStatusByUrl && typeof project.competitorRefreshStatusByUrl === "object"
            ? (project.competitorRefreshStatusByUrl as SiteIntentProject["competitorRefreshStatusByUrl"])
            : {},
        scanDepth: normalizeProjectScanDepth(project.scanDepth)
      }))
    : [];
  const scanRuns = Array.isArray(parsed.scanRuns) ? hydrateScanRuns(parsed.scanRuns) : [];
  const projectOnboarding =
    parsed.projectOnboarding && typeof parsed.projectOnboarding === "object"
      ? (parsed.projectOnboarding as SiteIntentSessionState["projectOnboarding"])
      : {};
  const observedIntentByProject = new Map<string, ObservedIntent>();
  for (const scan of scanRuns) {
    if (scan.projectId && scan.observedIntent) {
      observedIntentByProject.set(scan.projectId, scan.observedIntent);
    }
  }
  for (const [projectId, onboarding] of Object.entries(projectOnboarding)) {
    if (onboarding?.observedIntent) {
      observedIntentByProject.set(projectId, onboarding.observedIntent);
    }
  }
  const targetIntentModels =
    parsed.targetIntentModels && typeof parsed.targetIntentModels === "object"
      ? Object.fromEntries(
          Object.entries(parsed.targetIntentModels as SiteIntentSessionState["targetIntentModels"]).map(([projectId, model]) => [
            projectId,
            normalizeTargetIntentModel(model, observedIntentByProject.get(projectId))
          ])
        )
      : {};

  return {
    session: parsed.session ?? null,
    projects,
    activeProjectId: typeof parsed.activeProjectId === "string" ? parsed.activeProjectId : null,
    scanRuns,
    scanProgressByProject:
      parsed.scanProgressByProject && typeof parsed.scanProgressByProject === "object"
        ? (parsed.scanProgressByProject as SiteIntentSessionState["scanProgressByProject"])
        : {},
    targetIntentModels,
    projectOnboarding,
    preferences:
      parsed.preferences && typeof parsed.preferences === "object"
        ? {
            ...createDefaultPreferences(),
            ...(parsed.preferences as Partial<AppPreferences>)
          }
        : createDefaultPreferences()
  };
}

export function SiteIntentProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);
  const [state, setState] = useState<SiteIntentSessionState>(createEmptyState());
  const [isScanning, setIsScanning] = useState(false);
  const [lastScanError, setLastScanError] = useState<string | null>(null);
  const [scanProgressByProject, setScanProgressByProject] = useState<ScanProgressByProject>({});
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const attemptedFaviconHydration = useRef(new Set<string>());
  const emittedToastKeys = useRef(new Set<string>());
  const stateRef = useRef<SiteIntentSessionState>(state);
  const scanProgressRef = useRef<ScanProgressByProject>(scanProgressByProject);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    scanProgressRef.current = scanProgressByProject;
  }, [scanProgressByProject]);

  useEffect(() => {
    let cancelled = false;

    async function loadState() {
      try {
        const response = await fetch("/api/state", {
          headers: {
            Accept: "application/json"
          }
        });

        if (response.status === 401) {
          if (!cancelled) {
            setState(createEmptyState());
            setScanProgressByProject({});
            router.replace("/login");
          }
          return;
        }

        if (!response.ok) {
          throw new Error("Unable to load persisted state.");
        }

        const payload = (await response.json()) as { state?: Partial<SiteIntentSessionState> };
        if (!payload.state || cancelled) {
          if (!cancelled) {
            setState(createEmptyState());
            setScanProgressByProject({});
          }
          return;
        }
        const normalized = normalizeLoadedState(payload.state);

        if (!cancelled) {
          setState(normalized);
          setScanProgressByProject(normalized.scanProgressByProject);
        }
      } catch {
        if (!cancelled) {
          setState(createEmptyState());
          setScanProgressByProject({});
        }
      } finally {
        if (!cancelled) {
          setHydrated(true);
        }
      }
    }

    void loadState();
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void fetch("/api/state", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({ state: { ...state, scanProgressByProject } }),
        signal: controller.signal
      })
        .then((response) => {
          if (response.status === 401) {
            router.replace("/login");
            return;
          }

          if (!response.ok) {
            throw new Error("Unable to save the latest state to SQLite.");
          }
        })
        .catch((error) => {
          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }
          setLastScanError("Unable to save the latest state.");
        });
    }, 150);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [hydrated, router, scanProgressByProject, state]);

  async function saveStateImmediately(nextState: SiteIntentSessionState) {
    try {
      const response = await fetch("/api/state", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          state: {
            ...nextState,
            scanProgressByProject: scanProgressRef.current
          }
        })
      });

      if (response.status === 401) {
        router.replace("/login");
        return;
      }

      if (!response.ok) {
        throw new Error("Unable to save the latest state to SQLite.");
      }
    } catch {
      setLastScanError("Unable to save the latest state.");
    }
  }

  useEffect(() => {
    if (!hydrated || isScanning || !Object.values(scanProgressByProject).some((progress) => progress && progress.stage !== "completed")) {
      return;
    }

    const interval = window.setInterval(() => {
      void fetch("/api/state", {
        headers: { Accept: "application/json" }
      })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error("Unable to refresh active scan state.");
          }

          const payload = (await response.json()) as { state?: Partial<SiteIntentSessionState> };
          const normalized = normalizeLoadedState(payload.state);
          setState((current) => ({
            ...current,
            projects: normalized.projects,
            activeProjectId: normalized.activeProjectId,
            scanRuns: normalized.scanRuns,
            targetIntentModels: normalized.targetIntentModels,
            projectOnboarding: normalized.projectOnboarding,
            preferences: normalized.preferences
          }));
          setScanProgressByProject(normalized.scanProgressByProject);
        })
        .catch(() => {});
    }, 2000);

    return () => window.clearInterval(interval);
  }, [hydrated, isScanning, scanProgressByProject]);

  useEffect(() => {
    if (!hydrated || !state.projects.length) {
      return;
    }

    if (!state.activeProjectId || !state.projects.some((project) => project.id === state.activeProjectId)) {
      setState((current) => ({
        ...current,
        activeProjectId: current.projects[0]?.id ?? null
      }));
    }
  }, [hydrated, state.activeProjectId, state.projects]);

  const activeProject = useMemo(() => {
    return state.projects.find((project) => project.id === state.activeProjectId) ?? state.projects[0] ?? null;
  }, [state.activeProjectId, state.projects]);

  const latestScan = useMemo(() => {
    if (!activeProject) {
      return null;
    }

    return state.scanRuns.find((scan) => scan.projectId === activeProject.id) ?? null;
  }, [activeProject, state.scanRuns]);

  const activeProjectOnboarding = useMemo<ProjectOnboardingState | null>(() => {
    if (!activeProject) {
      return null;
    }

    return (
      state.projectOnboarding[activeProject.id] ?? {
        status: "idle",
        observedIntent: null,
        firstScanAt: null,
        reviewedAt: null,
        backgroundScanStartedAt: null,
        reviewModalOpen: false
      }
    );
  }, [activeProject, state.projectOnboarding]);

  const competitorAnalyses = useMemo(() => {
    if (!activeProject) {
      return [];
    }

    return activeProject.competitorUrls.map((url, index) => {
      return (
        activeProject.competitorAnalysesByUrl[url] ??
        latestScan?.competitorAnalyses?.[index] ??
        buildCompetitorAnalyses([url])[0]
      );
    });
  }, [activeProject, latestScan]);

  const categoryModel = useMemo<CategoryModel | null>(() => {
    if (!activeProject) {
      return null;
    }

    return buildCategoryModel({
      project: activeProject,
      latestScan,
      competitorAnalyses
    });
  }, [activeProject, competitorAnalyses, latestScan]);

  const targetIntentModel = useMemo<TargetIntentModel | null>(() => {
    if (!categoryModel) {
      return null;
    }

    const projectId = activeProject?.id ?? "";
    const observedIntent = activeProjectOnboarding?.observedIntent ?? latestScan?.observedIntent ?? null;
    const existingModel = state.targetIntentModels[projectId];

    return existingModel ? normalizeTargetIntentModel(existingModel, observedIntent) : createDefaultTargetIntentModel(categoryModel);
  }, [activeProject?.id, activeProjectOnboarding?.observedIntent, categoryModel, latestScan?.observedIntent, state.targetIntentModels]);

  const rankability = useMemo<RankabilityScorecard | null>(() => latestScan?.rankability ?? null, [latestScan]);
  const discoverability = useMemo<DiscoverabilityScorecard | null>(() => latestScan?.discoverability ?? null, [latestScan]);

  const conceptDelta = useMemo(() => {
    if (!categoryModel || !targetIntentModel) {
      return null;
    }

    return summarizeConceptDelta(categoryModel, targetIntentModel);
  }, [categoryModel, targetIntentModel]);

  const pinnedScanToast = useMemo<PinnedScanToast>(() => {
    const activeScanEntry = Object.entries(scanProgressByProject).find(([, progress]) => progress && progress.stage !== "completed");
    const progress = activeScanEntry?.[1] ?? null;

    if (!progress) {
      return null;
    }

    const parts = [
      `Stage: ${progress.title}`,
      `Mode: ${progress.scanMode === "competitors" ? "Competitor scan" : progress.scanMode === "initial" ? "Initial website scan" : "Full scan"}`,
      `Analysis model: ${state.preferences.pageAnalysisModel}`,
      `Scoring model: ${state.preferences.scoringModel}`
    ];

    if (progress.currentUrl) {
      parts.push(`Current URL: ${progress.currentUrl}`);
    } else if (progress.currentLabel) {
      parts.push(`Current item: ${progress.currentLabel}`);
    }

    if (progress.analyzedPages !== undefined && progress.totalPages !== undefined) {
      parts.push(`Pages: ${progress.analyzedPages}/${progress.totalPages}`);
    }

    if (progress.completedCompetitors !== undefined && progress.totalCompetitors !== undefined) {
      parts.push(`Competitors: ${progress.completedCompetitors}/${progress.totalCompetitors}`);
    }

    return {
      title: progress.scanMode === "competitors" ? "Competitor Scan Running" : "Scan Running",
      description: progress.description,
      detail: parts.join(" | "),
      progress: progress.progress
    };
  }, [scanProgressByProject, state.preferences.pageAnalysisModel, state.preferences.scoringModel]);

  function showToast(input: Omit<ToastMessage, "id">) {
    const id = crypto.randomUUID();
    setToasts((current) => [...current, { id, ...input }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4200);
  }

  function dismissToast(id: string) {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }

  function notifyScanMilestone(project: SiteIntentProject, progress: ScanProgressEvent) {
    const scanMode = progress.scanMode ?? "full";

    if (progress.stage === "completed") {
      const key = `${project.id}:${scanMode}:completed`;
      if (!emittedToastKeys.current.has(key)) {
        emittedToastKeys.current.add(key);
        showToast({
          title: scanMode === "initial" ? "Website scoring complete" : "Competitor scoring complete",
          description:
            scanMode === "initial"
              ? "The dashboard now has your website's first score breakdown. Competitor scoring will start next."
              : "The competitor page now has the latest comparison results.",
          tone: "success"
        });
      }
      return;
    }

    if (progress.stage === "computing_discoverability" && progress.competitorUrls) {
      const key = `${project.id}:${scanMode}:competitor-slate`;
      if (!emittedToastKeys.current.has(key)) {
        emittedToastKeys.current.add(key);
        showToast({
          title: "Top competitors found",
          description: progress.competitorUrls.length
            ? `${progress.competitorUrls.length} competitors were discovered and added for comparison.`
            : "The scan is still running, but no competitors have been found yet."
        });
      }
      return;
    }

    if (
      progress.stage === "analyzing" &&
      scanMode === "full" &&
      progress.totalCompetitors &&
      progress.completedCompetitors &&
      progress.completedCompetitors === progress.totalCompetitors
    ) {
      const key = `${project.id}:${scanMode}:competitors-complete`;
      if (!emittedToastKeys.current.has(key)) {
        emittedToastKeys.current.add(key);
        showToast({
          title: "Competitor analysis complete",
          description: `Finished scoring ${progress.totalCompetitors} competitor homepage${progress.totalCompetitors === 1 ? "" : "s"}.`,
          tone: "success"
        });
      }
    }
  }

  function applyProgressUpdate(project: SiteIntentProject, progress: ScanProgressEvent) {
    setScanProgressByProject((current) => ({
      ...current,
      [project.id]: progress
    }));

    if (!progress.competitorUrls && !progress.competitorAnalyses) {
      return;
    }

    setState((current) => ({
      ...current,
      projects: current.projects.map((item) => {
        if (item.id !== project.id) {
          return item;
        }

        const nextCompetitorUrls = progress.competitorUrls ?? item.competitorUrls;
        const nextCompetitorAnalysesByUrl = { ...item.competitorAnalysesByUrl };
        for (const analysis of progress.competitorAnalyses ?? []) {
          nextCompetitorAnalysesByUrl[analysis.url] = analysis;
        }

        return {
          ...item,
          competitorUrls: nextCompetitorUrls,
          competitorDisplayUrls: nextCompetitorUrls.map((value) => shortenDisplayUrl(value)),
          competitorFaviconUrls: nextCompetitorUrls.map((value, index) => item.competitorFaviconUrls[index] ?? null),
          competitorAnalysesByUrl: nextCompetitorAnalysesByUrl,
          updatedAt: new Date().toISOString()
        };
      })
    }));
  }

  function getProjectCategoryModelForId(projectId: string) {
    const project = state.projects.find((item) => item.id === projectId) ?? null;
    if (!project) {
      return null;
    }

    const projectLatestScan = state.scanRuns.find((scan) => scan.projectId === projectId) ?? null;
    const projectCompetitorAnalyses = project.competitorUrls.map((url, index) => {
      return (
        project.competitorAnalysesByUrl[url] ??
        projectLatestScan?.competitorAnalyses?.[index] ??
        buildCompetitorAnalyses([url])[0]
      );
    });

    return buildCategoryModel({
      project,
      latestScan: projectLatestScan,
      competitorAnalyses: projectCompetitorAnalyses
    });
  }

  function getProjectTargetIntentModelForId(projectId: string) {
    const projectCategoryModel = getProjectCategoryModelForId(projectId);
    if (!projectCategoryModel) {
      return null;
    }

    const observedIntent =
      state.projectOnboarding[projectId]?.observedIntent ??
      state.scanRuns.find((scan) => scan.projectId === projectId)?.observedIntent ??
      null;
    const existingModel = state.targetIntentModels[projectId];

    return existingModel ? normalizeTargetIntentModel(existingModel, observedIntent) : createDefaultTargetIntentModel(projectCategoryModel);
  }

  const value = useMemo<SiteIntentContextValue>(() => {
    return {
      ...state,
      hydrated,
      isScanning,
      lastScanError,
      categoryModel,
      competitorAnalyses,
      targetIntentModel,
      rankability,
      discoverability,
      conceptDelta,
      scanProgressByProject,
      preferences: state.preferences,
      updatePreferences(next) {
        setState((current) => {
          const nextState = {
            ...current,
            preferences: {
              ...current.preferences,
              ...next
            }
          };
          void saveStateImmediately(nextState);
          return nextState;
        });
      },
      async signIn(email, password) {
        try {
          const response = await fetch("/api/auth/login", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json"
            },
            body: JSON.stringify({ email, password })
          });
          const payload = (await response.json().catch(() => null)) as { session?: SiteIntentSession; error?: string } | null;
          if (!response.ok || !payload?.session) {
            return { ok: false, error: payload?.error ?? "Unable to sign in." };
          }

          const stateResponse = await fetch("/api/state", {
            headers: { Accept: "application/json" }
          });
          const statePayload = (await stateResponse.json().catch(() => null)) as { state?: Partial<SiteIntentSessionState> } | null;
          const normalized = normalizeLoadedState(statePayload?.state ?? { session: payload.session });
          setState(normalized);
          setScanProgressByProject(normalized.scanProgressByProject);
          router.push(normalized.projects.length ? "/dashboard" : "/setup");
          return { ok: true };
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : "Unable to sign in." };
        }
      },
      async signOut() {
        await fetch("/api/auth/logout", {
          method: "POST",
          headers: { Accept: "application/json" }
        }).catch(() => {});
        setState(createEmptyState());
        router.push("/login");
      },
      createProject(draft) {
        const now = new Date().toISOString();
        const project: SiteIntentProject = {
          id: crypto.randomUUID(),
          name: ensureProjectName(draft.name, draft.websiteUrl),
          websiteUrl: draft.websiteUrl,
          websiteDisplayUrl: shortenDisplayUrl(draft.websiteUrl),
          websiteFaviconUrl: null,
          competitorUrls: [],
          competitorDisplayUrls: [],
          competitorFaviconUrls: [],
          competitorAnalysesByUrl: {},
          competitorRefreshStatusByUrl: {},
          scanDepth: normalizeProjectScanDepth(draft.scanDepth),
          createdAt: now,
          updatedAt: now
        };

        setState((current) => ({
          ...current,
          projects: [project, ...current.projects],
          activeProjectId: project.id,
          targetIntentModels: draft.targetIntentModel
            ? {
                ...current.targetIntentModels,
                [project.id]: {
                  ...draft.targetIntentModel,
                  updatedAt: draft.targetIntentModel.updatedAt || now
                }
              }
            : current.targetIntentModels,
          projectOnboarding: {
            ...current.projectOnboarding,
            [project.id]: {
              status: "setup_completed",
              observedIntent: null,
              firstScanAt: null,
              reviewedAt: null,
              backgroundScanStartedAt: null,
              reviewModalOpen: false
            }
          }
        }));

        void hydrateProjectFavicons(project);
        return project;
      },
      deleteProject(projectId) {
        let nextProjectCount = 0;
        setState((current) => {
          const projects = current.projects.filter((project) => project.id !== projectId);
          const scanRuns = current.scanRuns.filter((scan) => scan.projectId !== projectId);
          const targetIntentModels = Object.fromEntries(
            Object.entries(current.targetIntentModels).filter(([key]) => key !== projectId)
          );
          const projectOnboarding = Object.fromEntries(
            Object.entries(current.projectOnboarding).filter(([key]) => key !== projectId)
          );
          const nextActiveProjectId =
            current.activeProjectId === projectId ? projects[0]?.id ?? null : current.activeProjectId;
          nextProjectCount = projects.length;

          return {
            ...current,
            projects,
            activeProjectId: projects.some((project) => project.id === nextActiveProjectId) ? nextActiveProjectId : projects[0]?.id ?? null,
            scanRuns,
            targetIntentModels,
            projectOnboarding
          };
        });

        if (nextProjectCount === 0) {
          router.push("/setup");
        }
      },
      deleteCompetitor(projectId, competitorIndex) {
        setState((current) => ({
          ...current,
          projects: current.projects.map((project) => {
            if (project.id !== projectId) {
              return project;
            }

            return {
              ...project,
              competitorUrls: project.competitorUrls.filter((_, index) => index !== competitorIndex),
              competitorDisplayUrls: project.competitorDisplayUrls.filter((_, index) => index !== competitorIndex),
              competitorFaviconUrls: project.competitorFaviconUrls.filter((_, index) => index !== competitorIndex),
              competitorAnalysesByUrl: Object.fromEntries(
                Object.entries(project.competitorAnalysesByUrl).filter(([key]) => key !== project.competitorUrls[competitorIndex])
              ),
              competitorRefreshStatusByUrl: Object.fromEntries(
                Object.entries(project.competitorRefreshStatusByUrl).filter(([key]) => key !== project.competitorUrls[competitorIndex])
              ),
              updatedAt: new Date().toISOString()
            };
          })
        }));
      },
      async refreshCompetitor(projectId, competitorUrl) {
        const currentProject = state.projects.find((project) => project.id === projectId) ?? null;
        if (!currentProject) {
          return;
        }

        const startedAt = new Date().toISOString();
        setLastScanError(null);
        setState((current) => ({
          ...current,
          projects: current.projects.map((project) => {
            if (project.id !== projectId) {
              return project;
            }

            return {
              ...project,
              competitorRefreshStatusByUrl: {
                ...project.competitorRefreshStatusByUrl,
                [competitorUrl]: {
                  status: "scanning",
                  startedAt,
                  completedAt: null
                }
              },
              updatedAt: startedAt
            };
          })
        }));

        try {
          const completedScan = await runScanRequest(
            {
              projectId: `${projectId}:${competitorUrl}`,
              projectName: `${currentProject.name} competitor refresh`,
              websiteUrl: competitorUrl,
              competitorUrls: [],
              scanMode: "full",
              scanDepth: currentProject.scanDepth
            },
            () => {}
          );
          const homepage = completedScan.pages.find((page) => page.pageType === "homepage") ?? completedScan.pages[0] ?? null;
          const refreshedAnalysis = homepage ? buildCompetitorAnalysisFromPage(homepage) : buildCompetitorAnalyses([competitorUrl])[0];
          const refreshedFaviconUrl = await requestFaviconUrl(competitorUrl);

          setState((current) => ({
            ...current,
            projects: current.projects.map((project) => {
              if (project.id !== projectId) {
                return project;
              }

              const competitorIndex = project.competitorUrls.findIndex((value) => value === competitorUrl);
              const competitorFaviconUrls =
                competitorIndex >= 0
                  ? project.competitorFaviconUrls.map((value, index) => (index === competitorIndex ? refreshedFaviconUrl : value))
                  : project.competitorFaviconUrls;

              return {
                ...project,
                competitorAnalysesByUrl: {
                  ...project.competitorAnalysesByUrl,
                  [competitorUrl]: refreshedAnalysis
                },
                competitorFaviconUrls,
                competitorRefreshStatusByUrl: {
                  ...project.competitorRefreshStatusByUrl,
                  [competitorUrl]: {
                    status: "idle",
                    startedAt,
                    completedAt: completedScan.completedAt
                  }
                },
                updatedAt: completedScan.completedAt
              };
            })
          }));
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unable to refresh competitor.";
          setLastScanError(message);
          setState((current) => ({
            ...current,
            projects: current.projects.map((project) => {
              if (project.id !== projectId) {
                return project;
              }

              return {
                ...project,
                competitorRefreshStatusByUrl: {
                  ...project.competitorRefreshStatusByUrl,
                  [competitorUrl]: {
                    status: "idle",
                    startedAt,
                    completedAt: new Date().toISOString()
                  }
                },
                updatedAt: new Date().toISOString()
              };
            })
          }));
        }
      },
      selectProject(projectId) {
        setState((current) => ({
          ...current,
          activeProjectId: projectId
        }));
      },
      updateTargetIntentModel(next) {
        if (!activeProject) {
          return;
        }

        setState((current) => ({
          ...current,
          targetIntentModels: {
            ...current.targetIntentModels,
            [activeProject.id]: {
              ...next,
              updatedAt: new Date().toISOString(),
              isUserOwned: true
            }
          }
        }));
      },
      updateProjectTargetIntentModel(projectId, next) {
        setState((current) => ({
          ...current,
          targetIntentModels: {
            ...current.targetIntentModels,
            [projectId]: {
              ...next,
              updatedAt: new Date().toISOString(),
              isUserOwned: true
            }
          }
        }));
      },
      getProjectCategoryModel(projectId) {
        return getProjectCategoryModelForId(projectId);
      },
      getProjectTargetIntentModel(projectId) {
        return getProjectTargetIntentModelForId(projectId);
      },
      async startScan(projectOrId, options) {
        const scanMode: "initial" | "full" | "competitors" = options?.scanMode ?? "full";
        const isInitialScan = scanMode === "initial";
        const isCompetitorOnlyScan = scanMode === "competitors";
        const nextProject =
          typeof projectOrId === "string"
            ? state.projects.find((item) => item.id === projectOrId) ?? null
            : projectOrId ?? state.projects.find((item) => item.id === state.activeProjectId) ?? state.projects[0] ?? null;

        if (!nextProject) {
          router.push("/setup");
          return null;
        }

        const onboardingBeforeRun: ProjectOnboardingState = state.projectOnboarding[nextProject.id] ?? {
          status: "idle",
          observedIntent: null,
          firstScanAt: null,
          reviewedAt: null,
          backgroundScanStartedAt: null,
          reviewModalOpen: false
        };
        const scanLabel = isInitialScan ? "website scoring" : isCompetitorOnlyScan ? "competitor scan" : "full scan";

        setIsScanning(true);
        setLastScanError(null);
        emittedToastKeys.current.delete(`${nextProject.id}:${scanMode}:completed`);
        emittedToastKeys.current.delete(`${nextProject.id}:${scanMode}:competitor-slate`);
        emittedToastKeys.current.delete(`${nextProject.id}:${scanMode}:competitors-complete`);
        setScanProgressByProject((current) => ({
          ...current,
          [nextProject.id]: {
            stage: "queued",
            title:
              isInitialScan
                ? "Preparing website scoring"
                : isCompetitorOnlyScan
                  ? "Preparing competitor scan"
                  : "Preparing full scan",
            description:
              isInitialScan
                ? "Saving the website and starting the first dashboard scoring pass."
                : isCompetitorOnlyScan
                  ? "Starting a competitors-only scan from the latest saved website data."
                  : "Starting a fresh full scan for the current website.",
            progress: 5,
            scanMode
          }
        }));
        showToast({
          title: `Started ${scanLabel}`,
          description:
            isInitialScan
              ? "The dashboard will update as your website is crawled and scored."
              : isCompetitorOnlyScan
                ? "The competitors page will update as the comparison set is rediscovered and rescored."
                : "The dashboard and competitors page will update as the full scan finishes."
        });
        setState((current) => ({
          ...current,
          activeProjectId: nextProject.id,
          projectOnboarding: {
            ...current.projectOnboarding,
            [nextProject.id]: {
              ...(current.projectOnboarding[nextProject.id] ?? {
                status: "idle",
                observedIntent: null,
                firstScanAt: null,
                reviewedAt: null,
                backgroundScanStartedAt: null,
                reviewModalOpen: false
              }),
              backgroundScanStartedAt:
                options?.background && scanMode === "full"
                  ? (current.projectOnboarding[nextProject.id]?.backgroundScanStartedAt ?? new Date().toISOString())
                  : current.projectOnboarding[nextProject.id]?.backgroundScanStartedAt ?? null,
              status: isInitialScan ? "website_scanning" : "competitor_scoring",
              reviewModalOpen: false
            }
          }
        }));

        try {
          const completedScan = await runScanRequest(
            {
              projectId: nextProject.id,
              projectName: nextProject.name,
              websiteUrl: nextProject.websiteUrl,
              competitorUrls: nextProject.competitorUrls,
              scanMode,
              scanDepth: nextProject.scanDepth,
              pageAnalysisModel: state.preferences.pageAnalysisModel,
              scoringModel: state.preferences.scoringModel,
              targetIntentModel: state.targetIntentModels[nextProject.id] ?? undefined
            },
            (progress) => {
              const nextProgress = {
                ...progress,
                scanMode: progress.scanMode ?? scanMode
              };
              applyProgressUpdate(nextProject, nextProgress);
              notifyScanMilestone(nextProject, nextProgress);
              options?.onProgress?.(nextProgress);
            }
          );
          const autoCompetitorUrls = completedScan.competitorAnalyses?.map((analysis) => analysis.url) ?? [];
          const refreshedProjectForArtifacts = {
            ...nextProject,
            competitorUrls: autoCompetitorUrls,
            competitorDisplayUrls: autoCompetitorUrls.map((value) => shortenDisplayUrl(value)),
            competitorFaviconUrls: autoCompetitorUrls.map(() => null),
            competitorAnalysesByUrl: Object.fromEntries(
              (completedScan.competitorAnalyses ?? []).map((analysis) => [analysis.url, analysis])
            ),
            updatedAt: completedScan.completedAt ?? new Date().toISOString()
          };

          setState((current) => {
            const nextTargetIntentModels = { ...current.targetIntentModels };
            const nextProjectOnboarding = { ...current.projectOnboarding };
            const category = buildCategoryModel({
              project: refreshedProjectForArtifacts,
              latestScan: completedScan,
              competitorAnalyses: completedScan.competitorAnalyses ?? []
            });

            const observedIntent = completedScan.observedIntent ?? buildObservedIntent({
              categoryModel: category,
              latestScan: completedScan,
              competitorAnalyses: completedScan.competitorAnalyses ?? [],
              metrics: completedScan.rankability ?? null
            });

            if (!nextTargetIntentModels[nextProject.id]) {
              nextTargetIntentModels[nextProject.id] = createTargetIntentModelFromObservedIntent(observedIntent);
            }

            nextProjectOnboarding[nextProject.id] = {
              ...onboardingBeforeRun,
              status: isInitialScan ? "website_scored" : "competitor_scored",
              observedIntent,
              firstScanAt: onboardingBeforeRun.firstScanAt ?? completedScan.completedAt ?? new Date().toISOString(),
              reviewedAt: onboardingBeforeRun.reviewedAt,
              backgroundScanStartedAt:
                !isInitialScan && !isCompetitorOnlyScan
                  ? onboardingBeforeRun.backgroundScanStartedAt ?? new Date().toISOString()
                  : null,
              reviewModalOpen: false
            };

            return {
              ...current,
              projects: current.projects.map((project) => (project.id === nextProject.id ? refreshedProjectForArtifacts : project)),
              scanRuns: [completedScan, ...current.scanRuns],
              activeProjectId: nextProject.id,
              targetIntentModels: nextTargetIntentModels,
              projectOnboarding: nextProjectOnboarding
            };
          });

          attemptedFaviconHydration.current.delete(nextProject.id);
          void hydrateProjectFavicons(refreshedProjectForArtifacts);
          setScanProgressByProject((current) => ({
            ...current,
            [nextProject.id]: {
              stage: "completed",
              title: isInitialScan ? "Website scoring complete" : "Competitor scoring complete",
              description:
                isInitialScan
                  ? "The dashboard now has your website score breakdown."
                  : isCompetitorOnlyScan
                    ? "The competitor page now has the latest comparison results."
                    : "The dashboard and competitor results are fully refreshed.",
              progress: 100,
              scanMode,
              analyzedPages: completedScan.pages.length,
              totalPages: completedScan.pages.length,
              discoveredPages: completedScan.websiteScanPages.length,
              competitorUrls: autoCompetitorUrls,
              competitorAnalyses: completedScan.competitorAnalyses ?? [],
              completedCompetitors: completedScan.competitorAnalyses?.length ?? 0,
              totalCompetitors: autoCompetitorUrls.length
            }
          }));

          if (options?.navigate !== false) {
            router.push("/dashboard");
          }
          return completedScan;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unable to run scan.";
          setLastScanError(message);
          setScanProgressByProject((current) => ({
            ...current,
            [nextProject.id]: null
          }));
          showToast({
            title: "Scan failed",
            description: message,
            tone: "error"
          });
          setState((current) => ({
            ...current,
            projectOnboarding: nextProject
              ? {
                  ...current.projectOnboarding,
                  [nextProject.id]: {
                    ...(current.projectOnboarding[nextProject.id] ?? {
                      status: "idle",
                      observedIntent: null,
                      firstScanAt: null,
                      reviewedAt: null,
                      backgroundScanStartedAt: null,
                      reviewModalOpen: false
                    }),
                    status: isInitialScan ? "setup_completed" : "website_scored"
                  }
                }
              : current.projectOnboarding
          }));
          return null;
        } finally {
          setIsScanning(false);
        }
      }
    };
  }, [
    activeProject,
    categoryModel,
    competitorAnalyses,
    conceptDelta,
    hydrated,
    isScanning,
    lastScanError,
    latestScan,
    rankability,
    discoverability,
    router,
    scanProgressByProject,
    state,
    targetIntentModel
  ]);

  useEffect(() => {
    if (!hydrated || !state.projects.length) {
      return;
    }

    for (const project of state.projects) {
      const needsWebsiteFavicon = project.websiteFaviconUrl == null;
      const needsCompetitorFavicons =
        project.competitorUrls.length > 0 &&
        (project.competitorFaviconUrls.length !== project.competitorUrls.length ||
          project.competitorFaviconUrls.some((favicon, index) => favicon == null && Boolean(project.competitorUrls[index])));

      if ((needsWebsiteFavicon || needsCompetitorFavicons) && !attemptedFaviconHydration.current.has(project.id)) {
        attemptedFaviconHydration.current.add(project.id);
        void hydrateProjectFavicons(project);
      }
    }
  }, [hydrated, state.projects]);

  async function hydrateProjectFavicons(project: SiteIntentProject) {
    const [websiteFaviconUrl, ...competitorFaviconUrls] = await Promise.all([
      requestFaviconUrl(project.websiteUrl),
      ...project.competitorUrls.map((url) => requestFaviconUrl(url))
    ]);

    setState((current) => ({
      ...current,
      projects: current.projects.map((item) =>
        item.id === project.id
          ? {
              ...item,
              websiteFaviconUrl,
              competitorFaviconUrls
            }
          : item
      )
    }));
  }

  async function runScanRequest(
    request: {
      projectId: string;
      projectName: string;
      websiteUrl: string;
      competitorUrls: string[];
      scanMode: "initial" | "full" | "competitors";
      scanDepth: number;
      pageAnalysisModel?: string;
      scoringModel?: string;
      targetIntentModel?: TargetIntentModel;
    },
    onProgress?: (event: ScanProgressEvent) => void
  ) {
    const response = await fetch("/api/scans/run", {
      body: JSON.stringify(request),
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      method: "POST"
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error ?? "Unable to run scan.");
    }

    let completedScan: ProjectScanRun | null = null;
    const contentType = response.headers.get("content-type") ?? "";

    if (contentType.includes("application/x-ndjson") && response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) {
            continue;
          }

          const event = JSON.parse(line) as
            | { type: "progress"; progress: ScanProgressEvent }
            | { type: "result"; scan: ProjectScanRun }
            | { type: "error"; error?: string };

          if (event.type === "progress") {
            onProgress?.(event.progress);
          } else if (event.type === "result") {
            completedScan = event.scan;
          } else if (event.type === "error") {
            throw new Error(event.error ?? "Unable to run scan.");
          }
        }
      }

      if (buffer.trim()) {
        const event = JSON.parse(buffer) as
          | { type: "progress"; progress: ScanProgressEvent }
          | { type: "result"; scan: ProjectScanRun }
          | { type: "error"; error?: string };

        if (event.type === "progress") {
          onProgress?.(event.progress);
        } else if (event.type === "result") {
          completedScan = event.scan;
        } else if (event.type === "error") {
          throw new Error(event.error ?? "Unable to run scan.");
        }
      }
    } else {
      const payload = (await response.json().catch(() => null)) as { scan?: ProjectScanRun; error?: string } | null;
      if (!payload?.scan) {
        throw new Error(payload?.error ?? "Unable to run scan.");
      }
      completedScan = payload.scan;
    }

    if (!completedScan) {
      throw new Error("Unable to run scan.");
    }

    return completedScan;
  }

  async function requestFaviconUrl(websiteUrl: string) {
    try {
      const response = await fetch(`/api/favicon?url=${encodeURIComponent(websiteUrl)}`, {
        headers: {
          Accept: "application/json"
        }
      });

      if (!response.ok) {
        throw new Error("Unable to resolve favicon.");
      }

      const payload = (await response.json()) as { faviconUrl?: string | null };
      return payload.faviconUrl ?? null;
    } catch {
      return null;
    }
  }

  return (
    <SiteIntentContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} pinnedToast={pinnedScanToast} onDismiss={dismissToast} />
    </SiteIntentContext.Provider>
  );
}

export function useSiteIntent() {
  const context = useContext(SiteIntentContext);
  if (!context) {
    throw new Error("useSiteIntent must be used within SiteIntentProvider.");
  }

  return context;
}

function hydrateScanRuns(scanRuns: unknown[]): ProjectScanRun[] {
  return scanRuns
    .filter((scan): scan is Partial<ProjectScanRun> => Boolean(scan && typeof scan === "object"))
    .map((scan) => {
      const websiteScanPages = Array.isArray(scan.websiteScanPages)
        ? scan.websiteScanPages
        : Array.isArray(scan.pages)
          ? scan.pages.map((page) => {
              const legacyPage = page as Record<string, any>;
              return ({
              id: crypto.randomUUID(),
              scanId: typeof scan.id === "string" ? scan.id : crypto.randomUUID(),
              url: typeof legacyPage.url === "string" ? legacyPage.url : "",
              normalizedUrl: typeof legacyPage.normalizedUrl === "string" ? legacyPage.normalizedUrl : (typeof legacyPage.url === "string" ? legacyPage.url : ""),
              pageType: normalizePageType(legacyPage.pageType),
              pageTitle: typeof legacyPage.pageTitle === "string" ? legacyPage.pageTitle : legacyPage.metadata?.title ?? "",
              metaTitle: typeof legacyPage.metaTitle === "string" ? legacyPage.metaTitle : "",
              metaDescription: typeof legacyPage.metaDescription === "string" ? legacyPage.metaDescription : legacyPage.metadata?.description ?? "",
              h1: typeof legacyPage.h1 === "string" ? legacyPage.h1 : "",
              headings: Array.isArray(legacyPage.headings)
                ? legacyPage.headings
                : Array.isArray(legacyPage.metadata?.headings)
                  ? legacyPage.metadata.headings.map((heading: string) => ({ level: "h2" as const, text: heading }))
                  : [],
              mainText: typeof legacyPage.mainText === "string" ? legacyPage.mainText : legacyPage.cleanText ?? "",
              wordCount: typeof legacyPage.wordCount === "number" ? legacyPage.wordCount : countWords(legacyPage.mainText ?? legacyPage.cleanText ?? ""),
              contentHash: typeof legacyPage.contentHash === "string" ? legacyPage.contentHash : "",
              httpStatus: typeof legacyPage.httpStatus === "number" ? legacyPage.httpStatus : 200,
              crawlDepth: typeof legacyPage.crawlDepth === "number" ? legacyPage.crawlDepth : 0,
              includeInScoring: true,
              exclusionReason: "",
              scrapeTimestamp: typeof legacyPage.scrapeTimestamp === "string" ? legacyPage.scrapeTimestamp : (legacyPage.merged?.timestamp ?? scan.completedAt ?? new Date().toISOString()),
              internalLinks: Array.isArray(legacyPage.internalLinks) ? legacyPage.internalLinks : [],
              discoverySources: normalizeDiscoverySources(legacyPage.discoverySources),
              canonicalUrl: typeof legacyPage.canonicalUrl === "string" ? legacyPage.canonicalUrl : legacyPage.metadata?.canonicalUrl ?? null,
              passes: Array.isArray(legacyPage.passes) ? legacyPage.passes : [],
              merged: legacyPage.merged,
              mergeDecision: legacyPage.mergeDecision ?? "stable",
              unstableReason: legacyPage.unstableReason ?? null
            });
          })
          : [];

      return {
        ...scan,
        scanMode: scan.scanMode === "initial" ? "initial" : "full",
        scanDepth: normalizeProjectScanDepth(scan.scanDepth),
        websiteScanPages,
        pages: getIncludedPageRecords({ websiteScanPages }),
        pagesFound: typeof scan.pagesFound === "number" ? scan.pagesFound : websiteScanPages.length,
        pagesExcluded: typeof scan.pagesExcluded === "number" ? scan.pagesExcluded : websiteScanPages.filter((page) => !page.includeInScoring).length,
        pagesScored: typeof scan.pagesScored === "number" ? scan.pagesScored : websiteScanPages.filter((page) => page.includeInScoring).length,
        discoveredPages: typeof scan.discoveredPages === "number" ? scan.discoveredPages : websiteScanPages.length,
        analyzedPages: typeof scan.analyzedPages === "number" ? scan.analyzedPages : websiteScanPages.filter((page) => page.includeInScoring).length,
        excludedPageTypes: Array.isArray(scan.excludedPageTypes) ? scan.excludedPageTypes : [],
        totalWordCount: typeof scan.totalWordCount === "number" ? scan.totalWordCount : websiteScanPages.reduce((sum, page) => sum + page.wordCount, 0),
        totalCharacters: typeof scan.totalCharacters === "number" ? scan.totalCharacters : websiteScanPages.reduce((sum, page) => sum + page.mainText.length, 0),
        scoringStatus: scan.scoringStatus === "completed" || scan.scoringStatus === "failed" ? scan.scoringStatus : "completed",
        scoringError: typeof scan.scoringError === "string" ? scan.scoringError : null,
        rankability: hydrateRankabilityScorecard((scan as { rankability?: unknown }).rankability),
        discoverability:
          normalizeDiscoverabilityScorecard((scan as { discoverability?: unknown }).discoverability) ?? undefined,
        errors: Array.isArray(scan.errors) ? scan.errors : []
      } as ProjectScanRun;
    });
}

function hydrateRankabilityScorecard(value: unknown) {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const normalized = value as {
    weightedTotalScore?: unknown;
    factorScores?: unknown;
    summary?: unknown;
  };

  if (
    typeof normalized.weightedTotalScore === "number" &&
    normalized.factorScores &&
    typeof normalized.factorScores === "object" &&
    typeof normalized.summary === "string"
  ) {
    return normalized as RankabilityScorecard;
  }

  return normalizeRankabilityScorecard(value) ?? undefined;
}

function countWords(value: string) {
  if (!value.trim()) {
    return 0;
  }

  return value.trim().split(/\s+/).length;
}

function normalizeDiscoverySources(value: unknown): ScanDiscoverySource[] {
  return ["internal-link"];
}

function normalizePageType(value: unknown) {
  switch (value) {
    case "homepage":
    case "about":
    case "product":
    case "pricing":
    case "blog":
    case "contact":
    case "docs":
    case "content":
    case "unknown":
      return value;
    default:
      return "content";
  }
}
