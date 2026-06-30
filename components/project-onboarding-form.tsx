"use client";

import type { FormEvent } from "react";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, LoaderCircle } from "lucide-react";

import { useSiteIntent } from "@/components/site-intent-provider";
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
      scanDepth: 1
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
