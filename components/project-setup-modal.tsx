"use client";

import type { FormEvent, ReactNode } from "react";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowRight, LoaderCircle, Plus, Sparkles, X } from "lucide-react";

import { LocationTargetInput } from "@/components/location-target-input";
import { useSiteIntent } from "@/components/site-intent-provider";
import { normalizeLocationTargets } from "@/lib/location-targeting";
import type { ScanProgressEvent } from "@/lib/scan/types";
import {
  buildProjectDraft,
  sanitizeWebsiteUrl,
  type SiteIntentProject,
  validateHttpUrl
} from "@/lib/site-state";

type FormErrors = {
  websiteUrl?: string;
};

type ProjectSetupModalProps = {
  buttonClassName?: string;
  buttonLabel?: string;
  defaultOpen?: boolean;
  autoOpenWhenNoWebsites?: boolean;
  lockWhenNoWebsites?: boolean;
  hideTrigger?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: ReactNode;
};

type ModalView = "form" | "scanning" | "error";

export function ProjectSetupModal({
  buttonClassName = "button button--primary",
  buttonLabel = "Add website",
  defaultOpen = false,
  autoOpenWhenNoWebsites = false,
  lockWhenNoWebsites = false,
  hideTrigger = false,
  onOpenChange,
  trigger
}: ProjectSetupModalProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { createProject, startScan, hydrated, projects } = useSiteIntent();
  const isFirstWebsite = hydrated && projects.length === 0;
  const [open, setOpen] = useState(defaultOpen);
  const [modalView, setModalView] = useState<ModalView>("form");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [isLocationSpecific, setIsLocationSpecific] = useState(false);
  const [locationTargets, setLocationTargets] = useState(normalizeLocationTargets(undefined));
  const [errors, setErrors] = useState<FormErrors>({});
  const [scanProgress, setScanProgress] = useState<ScanProgressEvent>(buildInitialScanProgress());
  const [scanError, setScanError] = useState<string | null>(null);
  const [createdProject, setCreatedProject] = useState<SiteIntentProject | null>(null);

  useEffect(() => {
    if (autoOpenWhenNoWebsites && isFirstWebsite) {
      setOpen(true);
      onOpenChange?.(true);
    }
  }, [autoOpenWhenNoWebsites, isFirstWebsite, onOpenChange]);

  function setModalOpen(nextOpen: boolean) {
    if (lockWhenNoWebsites && isFirstWebsite && !nextOpen) {
      return;
    }
    if (!nextOpen) {
      resetTransientState();
    }
    setOpen(nextOpen);
    onOpenChange?.(nextOpen);
  }

  function resetTransientState() {
    setModalView("form");
    setIsSubmitting(false);
    setWebsiteUrl("");
    setIsLocationSpecific(false);
    setLocationTargets([]);
    setErrors({});
    setScanProgress(buildInitialScanProgress());
    setScanError(null);
    setCreatedProject(null);
  }

  function validateForm() {
    const nextErrors: FormErrors = {};
    const websiteError = validateHttpUrl(websiteUrl);
    if (websiteError) {
      nextErrors.websiteUrl = websiteError;
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);
    const project = createProject({
      name: buildProjectDraft(websiteUrl),
      websiteUrl: sanitizeWebsiteUrl(websiteUrl),
      competitorUrls: [],
      scanDepth: 1,
      targetIntentModel: isLocationSpecific
        ? {
            category: "",
            lockedConcepts: [],
            removableConcepts: [],
            addableConcepts: [],
            notes: "",
            isLocationSpecific: true,
            locationTargets,
            updatedAt: new Date().toISOString(),
            isUserOwned: true
          }
        : undefined
    });
    setCreatedProject(project);
    setModalOpen(false);
    if (pathname !== "/dashboard") {
      router.push("/dashboard");
    }
    void startScan(project, {
      navigate: false,
      scanMode: "initial",
      onProgress(progress) {
        setScanProgress(progress);
      }
    });
  }

  return (
    <>
      {!hideTrigger ? (
        <button className={buttonClassName} type="button" onClick={() => setModalOpen(true)}>
          {trigger ?? (
            <>
              <Plus size={16} />
              {buttonLabel}
            </>
          )}
        </button>
      ) : null}

      {open ? (
        <div className="modal-backdrop" role="presentation">
          <section
            className={`setup-modal${modalView === "scanning" ? " setup-modal--scanning" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="setup-modal-title"
          >
            <header className="setup-modal__header">
              <div>
                {modalView === "form" ? (
                  <>
                    <div className="eyebrow">New website</div>
                    <h2 className="setup-modal__title" id="setup-modal-title">Add a website to scan</h2>
                    <p className="setup-modal__copy">Set the website and we&apos;ll use the domain name as the project name. When you finish, the dashboard will open and start website scoring immediately.</p>
                  </>
                ) : (
                  <>
                    <div className="eyebrow">Scan interrupted</div>
                    <h2 className="setup-modal__title" id="setup-modal-title">The first scan needs another try</h2>
                    <p className="setup-modal__copy">
                      The website was added, but the initial scan did not complete. You can go back and adjust the inputs or retry now.
                    </p>
                  </>
                )}
              </div>
              {!lockWhenNoWebsites || !isFirstWebsite ? (
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => setModalOpen(false)}
                  aria-label="Close setup wizard"
                >
                  <X size={18} />
                </button>
              ) : null}
            </header>

            {modalView === "form" ? (
              <>
                <form className="setup-form" onSubmit={handleSubmit}>
                  <div className="setup-panel">
                    <label className="field">
                      <span className="field__label">Website URL</span>
                      <input
                        className="input"
                        required
                        value={websiteUrl}
                        onChange={(event) => {
                          setWebsiteUrl(event.target.value);
                          if (errors.websiteUrl) {
                            setErrors((current) => ({ ...current, websiteUrl: undefined }));
                          }
                        }}
                        placeholder="https://example.com"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                      />
                      {errors.websiteUrl ? <span className="field__error">{errors.websiteUrl}</span> : <span className="field__hint">Required. This is the site we will analyze first.</span>}
                    </label>

                    <label className="field field--checkbox">
                      <span className="field__checkbox">
                        <input
                          type="checkbox"
                          checked={isLocationSpecific}
                          onChange={(event) => setIsLocationSpecific(event.target.checked)}
                        />
                        <span>This business is location specific</span>
                      </span>
                      <span className="field__hint">Use this when competitor discovery should stay inside specific locations.</span>
                    </label>

                    {isLocationSpecific ? (
                      <label className="field">
                        <span className="field__label">Target locations</span>
                        <LocationTargetInput selected={locationTargets} onChange={setLocationTargets} />
                        <span className="field__hint">Add one or more countries, states, towns, or suburbs.</span>
                      </label>
                    ) : null}

                  </div>

                  <footer className="setup-modal__actions">
                    <button className="button button--primary" type="submit" disabled={isSubmitting}>
                      {isSubmitting ? "Creating website..." : "Create website"}
                      {isSubmitting ? <LoaderCircle className="spin" size={16} /> : <ArrowRight size={16} />}
                    </button>
                  </footer>
                </form>
              </>
            ) : null}

            {modalView === "error" ? (
              <div className="setup-form">
                <div className="setup-panel">
                  <div className="section-note">
                    <strong>Scan error</strong>
                    <div>{scanError ?? "The scan could not be completed."}</div>
                  </div>
                </div>
                <footer className="setup-modal__actions">
                  {!lockWhenNoWebsites || !isFirstWebsite ? (
                    <button
                      className="button button--secondary"
                      type="button"
                      onClick={() => setModalOpen(false)}
                    >
                      Close
                    </button>
                  ) : null}
                  <button
                    className="button button--primary"
                    type="button"
                    onClick={async () => {
                      if (!createdProject) {
                        return;
                      }

                      setScanError(null);
                      setIsSubmitting(true);
                      setScanProgress(buildInitialScanProgress());
                      setModalOpen(false);
                      if (pathname !== "/dashboard") {
                        router.push("/dashboard");
                      }
                      void startScan(createdProject, {
                        navigate: false,
                        scanMode: "initial",
                        onProgress(progress) {
                          setScanProgress(progress);
                        }
                      });
                    }}
                  >
                    Retry scan
                    <ArrowRight size={16} />
                  </button>
                </footer>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </>
  );
}

function buildInitialScanProgress(): ScanProgressEvent {
  return {
    stage: "queued",
    title: "Preparing the first scan",
    description: "Saving your website and getting the onboarding scan ready.",
    progress: 8
  };
}
