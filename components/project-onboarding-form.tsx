"use client";

import type { FormEvent } from "react";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, LoaderCircle } from "lucide-react";

import { LocationTargetInput } from "@/components/location-target-input";
import { useSiteIntent } from "@/components/site-intent-provider";
import { normalizeLocationTargets } from "@/lib/location-targeting";
import {
  buildProjectDraft,
  sanitizeProjectName,
  sanitizeWebsiteUrl,
  validateHttpUrl
} from "@/lib/site-state";

type FormErrors = {
  websiteUrl?: string;
};

export function ProjectOnboardingForm() {
  const router = useRouter();
  const { createProject, startScan } = useSiteIntent();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [isLocationSpecific, setIsLocationSpecific] = useState(false);
  const [locationTargets, setLocationTargets] = useState(normalizeLocationTargets(undefined));
  const [errors, setErrors] = useState<FormErrors>({});

  const suggestedName = useMemo(() => buildProjectDraft(websiteUrl), [websiteUrl]);

  function validate() {
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
    if (!validate()) {
      return;
    }

    const project = createProject({
      name: sanitizeProjectName(name) || suggestedName,
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

    const initialScan = await startScan(project, { navigate: false, scanMode: "initial" });
    if (!initialScan) {
      return;
    }

    startTransition(() => {
      router.push("/dashboard");
    });
  }

  return (
    <form className="setup-form" onSubmit={handleSubmit}>
      <div className="setup-grid">
        <label className="field">
          <span className="field__label">Project name</span>
          <input
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={suggestedName}
          />
          <span className="field__hint">Optional. If blank, we&apos;ll use the website hostname.</span>
        </label>

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
          {errors.websiteUrl ? <span className="field__error">{errors.websiteUrl}</span> : <span className="field__hint">Required. This is the site we&apos;ll analyze first.</span>}
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
          <span className="field__hint">Turn this on if the business only competes in specific countries, states, towns, or suburbs.</span>
        </label>

        {isLocationSpecific ? (
          <label className="field">
            <span className="field__label">Target locations</span>
            <LocationTargetInput selected={locationTargets} onChange={setLocationTargets} />
            <span className="field__hint">Select one or more locations and we&apos;ll attach them to future discovery queries.</span>
          </label>
        ) : null}
      </div>

      <div className="setup-actions">
        <button className="button button--primary" type="submit" disabled={isPending}>
          {isPending ? "Creating project..." : "Create project and continue"}
          {isPending ? <LoaderCircle className="spin" size={16} /> : <ArrowRight size={16} />}
        </button>
      </div>
    </form>
  );
}
