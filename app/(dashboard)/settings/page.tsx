"use client";

import { useState } from "react";
import { Settings2, Trash2, Globe2, CheckCircle2, Sparkles } from "lucide-react";

import { useSiteIntent } from "@/components/site-intent-provider";

type SettingsTab = "general" | "websites";

const SETTINGS_TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: "general", label: "General" },
  { id: "websites", label: "Websites" }
];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("websites");
  const { projects, activeProjectId, selectProject, deleteProject } = useSiteIntent();

  return (
    <div className="page-shell">
      <section className="page-hero">
        <div className="eyebrow">
          <Settings2 size={14} />
          System
        </div>
        <h1 className="page-title">Settings</h1>
        <p className="page-copy">Manage local workspace preferences and the websites saved in this browser.</p>
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
                  ? `${projects.length} website${projects.length === 1 ? "" : "s"} saved locally.`
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
        </section>
      ) : (
        <div className="page-grid">
          <section className="card">
            <h2 className="card__title">General settings</h2>
            <p className="card__copy">
              Local-first defaults, provider configuration, and workspace preferences will live here.
            </p>
            <ul className="list" style={{ marginTop: 16 }}>
              <li className="list__item">
                <span className="list__bullet" aria-hidden="true" />
                <div className="list__content">
                  <p className="list__title">Local analysis defaults</p>
                  <p className="list__description">Choose the default local model and page-analysis settings.</p>
                </div>
              </li>
              <li className="list__item">
                <span className="list__bullet" aria-hidden="true" />
                <div className="list__content">
                  <p className="list__title">Environment and provider settings</p>
                  <p className="list__description">Tune OpenAI and local-model integrations without changing each website.</p>
                </div>
              </li>
              <li className="list__item">
                <span className="list__bullet" aria-hidden="true" />
                <div className="list__content">
                  <p className="list__title">Workspace preferences</p>
                  <p className="list__description">Set defaults that apply across saved websites in this browser.</p>
                </div>
              </li>
            </ul>
          </section>

          <aside className="card">
            <h2 className="card__title">Build note</h2>
            <p className="card__copy">
              The settings shell is now tabbed, and the websites tab gives you direct control over saved projects.
            </p>
            <div className="section-note" style={{ marginTop: 16 }}>
              The delete action removes the website, its scan history, and any saved target intent model from local storage.
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
