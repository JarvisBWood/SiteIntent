"use client";

import { useEffect, useState } from "react";
import { Settings2, Trash2, Globe2, CheckCircle2, Sparkles, Target, X } from "lucide-react";

import { SiteFavicon } from "@/components/site-favicon";
import { useSiteIntent } from "@/components/site-intent-provider";
import { TargetIntentEditor } from "@/components/target-intent-editor";
import type { ModelProvider, ProviderModelOption } from "@/lib/llm/provider-models";
type ModelConfigItem = {
  id: string;
  role: "worker" | "judge" | "analysis";
  name: string;
  description: string;
};

type SettingsTab = "general" | "websites";

const SETTINGS_TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: "general", label: "General" },
  { id: "websites", label: "Websites" }
];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("websites");
  const [editingTargetProjectId, setEditingTargetProjectId] = useState<string | null>(null);
  const [websiteSearch, setWebsiteSearch] = useState("");
  const [modelConfig, setModelConfig] = useState<ModelConfigItem[]>([]);
  const [providerOptions, setProviderOptions] = useState<Record<ModelProvider, ProviderModelOption[]>>({
    openai: [],
    anthropic: [],
    google: []
  });
  const { projects, activeProjectId, selectProject, deleteProject, preferences, updatePreferences } = useSiteIntent();
  const filteredProjects = projects.filter((project) => {
    const query = websiteSearch.trim().toLowerCase();
    if (!query) {
      return true;
    }

    return (
      project.name.toLowerCase().includes(query) ||
      project.websiteDisplayUrl.toLowerCase().includes(query) ||
      project.websiteUrl.toLowerCase().includes(query)
    );
  });

  useEffect(() => {
    const controller = new AbortController();

    async function loadModels() {
      if (activeTab !== "general") {
        return;
      }

      try {
        const response = await fetch("/api/local-models", {
          headers: { Accept: "application/json" },
          signal: controller.signal
        });
        const payload = (await response.json()) as {
          models?: ModelConfigItem[];
          providerOptions?: Record<ModelProvider, ProviderModelOption[]>;
        };
        if (controller.signal.aborted) {
          return;
        }
        setModelConfig(Array.isArray(payload.models) ? payload.models : []);
        setProviderOptions(
          payload.providerOptions ?? {
            openai: [],
            anthropic: [],
            google: []
          }
        );
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setModelConfig([]);
        setProviderOptions({
          openai: [],
          anthropic: [],
          google: []
        });
      }
    }

    void loadModels();
    return () => controller.abort();
  }, [activeTab]);

  return (
    <div className="page-shell">
      <section className="page-hero">
        <div className="eyebrow">
          <Settings2 size={14} />
          System
        </div>
        <h1 className="page-title">Settings</h1>
        <p className="page-copy">Manage dashboard preferences and saved websites.</p>
        <div className="settings-tabs" role="tablist" aria-label="Settings sections">
          {SETTINGS_TABS.map((tab) => (
            <button
              key={tab.id}
              className="settings-tab"
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </section>

      {activeTab === "websites" ? (
        <section className="card settings-panel" role="tabpanel" aria-label="Websites">
          <div className="card__header">
            <div>
              <h2 className="card__title">Current websites</h2>
              <p className="card__copy">
                {projects.length
                  ? `${projects.length} website${projects.length === 1 ? "" : "s"} saved.`
                  : "No websites have been created yet."}
              </p>
            </div>
            <div className="tag-list">
              <span className="tag">
                <Globe2 size={14} />
                Websites
              </span>
            </div>
          </div>
          <input
            className="input"
            type="search"
            value={websiteSearch}
            onChange={(event) => setWebsiteSearch(event.target.value)}
            placeholder="Search websites"
            aria-label="Search websites"
          />

          {projects.length ? (
            <div className="settings-list">
              {filteredProjects.map((project) => {
                const isActive = project.id === activeProjectId;

                return (
                  <article key={project.id} className="settings-item">
                    <div className="settings-item__main">
                      <div className="website-overview-card__identity">
                        <SiteFavicon
                          url={project.websiteUrl}
                          faviconUrl={project.websiteFaviconUrl}
                          alt={`${project.name} favicon`}
                        />
                        <div>
                          <div className="settings-item__title-row">
                            <h3 className="settings-item__title">{project.name}</h3>
                            {isActive ? (
                              <span className="tag">
                                <CheckCircle2 size={14} />
                                Active
                              </span>
                            ) : null}
                          </div>
                          <p className="settings-item__url">{project.websiteDisplayUrl}</p>
                        </div>
                      </div>
                      <div className="settings-item__meta">
                        <span>{project.competitorUrls.length} competitors</span>
                        <span>Scan depth {project.scanDepth}</span>
                      </div>
                    </div>
                    <div className="settings-item__actions">
                      <button
                        className="button button--secondary"
                        type="button"
                        onClick={() => selectProject(project.id)}
                        disabled={isActive}
                      >
                        {isActive ? "Current website" : "Set active"}
                      </button>
                      <button
                        className="button button--secondary"
                        type="button"
                        onClick={() => setEditingTargetProjectId(project.id)}
                      >
                        <Target size={16} />
                        Edit target
                      </button>
                      <button
                        className="button button--secondary button--danger"
                        type="button"
                        onClick={() => {
                          const confirmed = window.confirm(`Delete ${project.name}? This will remove its scans and saved settings.`);
                          if (confirmed) {
                            deleteProject(project.id);
                          }
                        }}
                      >
                        <Trash2 size={16} />
                        Delete
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="empty-state settings-empty">
              <Sparkles size={18} />
              <div>
                <strong>No websites yet</strong>
                <p>Create a website from the main dashboard, then it will appear here for management and deletion.</p>
              </div>
            </div>
          )}
          {projects.length && !filteredProjects.length ? (
            <div className="empty-state settings-empty">
              <Sparkles size={18} />
              <div>
                <strong>No websites match that search</strong>
                <p>Try a different website name or domain.</p>
              </div>
            </div>
          ) : null}

          {editingTargetProjectId ? (
            <div className="modal-backdrop" role="presentation">
              <section
                className="setup-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="edit-target-modal-title"
              >
                <header className="setup-modal__header">
                  <div>
                    <div className="eyebrow">Website target</div>
                    <h2 className="setup-modal__title" id="edit-target-modal-title">
                      Edit target for {projects.find((project) => project.id === editingTargetProjectId)?.name ?? "website"}
                    </h2>
                    <p className="setup-modal__copy">
                      This saved target gives the system extra context when it discovers and scores competitors on the next scan.
                      Updating it will not change the current results until you rerun the scan.
                    </p>
                  </div>
                  <button
                    className="icon-button"
                    type="button"
                    onClick={() => setEditingTargetProjectId(null)}
                    aria-label="Close target editor"
                  >
                    <X size={18} />
                  </button>
                </header>

                <div className="setup-form">
                  <TargetIntentEditor projectId={editingTargetProjectId} onSave={() => setEditingTargetProjectId(null)} />
                </div>
              </section>
            </div>
          ) : null}
        </section>
      ) : (
        <section className="card" aria-label="Model configuration">
          <div className="card__header">
            <div>
              <h2 className="card__title">AI model configuration</h2>
              <p className="card__copy">Choose one web-search-capable model from OpenAI, Anthropic, and Gemini for every scan run. The app records each provider's results separately.</p>
            </div>
          </div>

          <div className="settings-model-grid" style={{ display: "grid", gap: 16 }}>
            <div style={{ display: "grid", gap: 8 }}>
              <label className="settings-item__title" htmlFor="page-analysis-model">Page analysis model</label>
              <select
                id="page-analysis-model"
                className="input"
                value={preferences.pageAnalysisModel}
                onChange={(event) => updatePreferences({ pageAnalysisModel: event.target.value })}
              >
                {providerOptions.openai.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
              <p style={{ fontSize: "0.85em", color: "var(--text-2)" }}>
                Page analysis still runs on the OpenAI path because it works only from the stored crawl snapshot.
              </p>
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              <label className="settings-item__title" htmlFor="openai-model">OpenAI scan model</label>
              <select
                id="openai-model"
                className="input"
                value={preferences.comparisonModels.openai}
                onChange={(event) =>
                  updatePreferences({
                    comparisonModels: {
                      ...preferences.comparisonModels,
                      openai: event.target.value
                    },
                    scoringModel: event.target.value
                  })
                }
              >
                {providerOptions.openai.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
              <p style={{ fontSize: "0.85em", color: "var(--text-2)" }}>
                Used for OpenAI discoverability and rankability runs with native `web_search`.
              </p>
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              <label className="settings-item__title" htmlFor="anthropic-model">Anthropic scan model</label>
              <select
                id="anthropic-model"
                className="input"
                value={preferences.comparisonModels.anthropic}
                onChange={(event) =>
                  updatePreferences({
                    comparisonModels: {
                      ...preferences.comparisonModels,
                      anthropic: event.target.value
                    }
                  })
                }
              >
                {providerOptions.anthropic.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
              <p style={{ fontSize: "0.85em", color: "var(--text-2)" }}>
                Used for Claude web-search-backed discoverability and rankability runs.
              </p>
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              <label className="settings-item__title" htmlFor="gemini-model">Gemini scan model</label>
              <select
                id="gemini-model"
                className="input"
                value={preferences.comparisonModels.google}
                onChange={(event) =>
                  updatePreferences({
                    comparisonModels: {
                      ...preferences.comparisonModels,
                      google: event.target.value
                    }
                  })
                }
              >
                {providerOptions.google.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
              <p style={{ fontSize: "0.85em", color: "var(--text-2)" }}>
                Used for Google Search-grounded Gemini discoverability and rankability runs.
              </p>
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              <span className="settings-item__title">Current hosted defaults</span>
              <div style={{ display: "grid", gap: 4 }}>
                {modelConfig.map((item) => (
                  <code key={`${item.role}:${item.id}`} className="input" style={{ padding: "8px 12px", background: "var(--surface-2)", userSelect: "all" }}>
                    {item.role}: {item.id}
                  </code>
                ))}
              </div>
              <p style={{ fontSize: "0.85em", color: "var(--text-2)" }}>
                These are the environment-backed hosted defaults used when a saved preference is missing.
              </p>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
