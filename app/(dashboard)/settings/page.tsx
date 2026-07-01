"use client";

import { useEffect, useState } from "react";
import { Settings2, Trash2, Globe2, CheckCircle2, Sparkles, Target, X } from "lucide-react";

import { SiteFavicon } from "@/components/site-favicon";
import { useSiteIntent } from "@/components/site-intent-provider";
import { TargetIntentEditor } from "@/components/target-intent-editor";
import { isOpenAIModelName } from "@/lib/llm/provider";

type SettingsTab = "general" | "websites";

const OPENAI_MODELS = [
  { value: "gpt-5.5", label: "GPT-5.5 - $5.00" },
  { value: "gpt-5.4", label: "GPT-5.4 - $2.50" },
  { value: "gpt-5.4-mini", label: "GPT-5.4 mini - $0.75" },
  { value: "gpt-5.4-nano", label: "GPT-5.4 nano - $0.20" },
  { value: "gpt-5-mini", label: "GPT-5 mini - $0.25" },
  { value: "gpt-4.1", label: "GPT-4.1 - $2.00" },
  { value: "gpt-4.1-mini", label: "GPT-4.1 mini - $0.40" },
  { value: "gpt-4.1-nano", label: "GPT-4.1 nano - $0.10" }
] as const;

const SETTINGS_TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: "general", label: "General" },
  { id: "websites", label: "Websites" }
];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("websites");
  const [editingTargetProjectId, setEditingTargetProjectId] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [localModelsAvailable, setLocalModelsAvailable] = useState(true);
  const { projects, activeProjectId, selectProject, deleteProject, preferences, updatePreferences } = useSiteIntent();

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
        const payload = (await response.json()) as { models?: string[]; error?: string };
        if (controller.signal.aborted) {
          return;
        }
        setAvailableModels(Array.isArray(payload.models) ? payload.models : []);
        setLocalModelsAvailable(!payload.error);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setAvailableModels([]);
        setLocalModelsAvailable(false);
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

          {projects.length ? (
            <div className="settings-list">
              {projects.map((project) => {
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
        <section className="card" aria-label="Model selection">
          <div className="card__header">
            <div>
              <h2 className="card__title">Select model for this scan</h2>
            </div>
          </div>

          <div className="settings-model-grid" style={{ display: "grid", gap: 16 }}>
            <label style={{ display: "grid", gap: 8 }}>
              <span className="settings-item__title">Page analysis model</span>
                <select
                  className="input"
                  value={preferences.pageAnalysisModel}
                  onChange={(event) => updatePreferences({ pageAnalysisModel: event.target.value })}
                >
                {renderModelOptions(availableModels, preferences.pageAnalysisModel, localModelsAvailable).map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.options.map((model) => (
                      <option key={model.value} value={model.value}>
                        {model.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>

            <label style={{ display: "grid", gap: 8 }}>
              <span className="settings-item__title">Scoring model</span>
                <select
                  className="input"
                  value={preferences.scoringModel}
                  onChange={(event) => updatePreferences({ scoringModel: event.target.value })}
                >
                {renderModelOptions(availableModels, preferences.scoringModel, localModelsAvailable).map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.options.map((model) => (
                      <option key={model.value} value={model.value}>
                        {model.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
          </div>
        </section>
      )}
    </div>
  );
}

function renderModelOptions(availableModels: string[], selectedModel: string, localModelsAvailable: boolean) {
  const localModels = [...new Set(availableModels)].sort();
  const localOptions = (localModels.length ? localModels : ["llama3.1:8b", "qwen2.5:14b"]).map((model) => ({
    value: model,
    label: `${model} - local`
  }));
  const selectedIsOpenAI = isOpenAIModelName(selectedModel);
  const openAIOptions =
    selectedIsOpenAI && selectedModel && !OPENAI_MODELS.some((model) => model.value === selectedModel)
      ? [{ value: selectedModel, label: `${formatModelLabel(selectedModel)} - $0.00` }, ...OPENAI_MODELS]
      : OPENAI_MODELS;
  return [
    ...(localModelsAvailable
      ? [
          {
            label: "Local models",
            options:
              selectedIsOpenAI || !selectedModel.trim()
                ? localOptions
                : localOptions.some((model) => model.value === selectedModel)
                  ? localOptions
                  : [{ value: selectedModel, label: `${selectedModel} - local` }, ...localOptions]
          }
        ]
      : []),
    {
      label: "OpenAI API models",
      options: openAIOptions
    }
  ];
}

function formatModelLabel(model: string) {
  return model.replace(/^gpt-/i, "GPT-").replace(/-/g, " ");
}
