"use client";

import { useEffect, useMemo, useState } from "react";
import { Save } from "lucide-react";

import { LocationTargetInput } from "@/components/location-target-input";
import { useSiteIntent } from "@/components/site-intent-provider";
import { createDefaultTargetIntentModel } from "@/lib/models";
import { normalizeLocationTargets } from "@/lib/location-targeting";
import type { TargetIntentModel } from "@/lib/site-state";

type TargetIntentEditorProps = {
  projectId?: string;
  onSave?: () => void;
};

export function TargetIntentEditor({ projectId, onSave }: TargetIntentEditorProps) {
  const {
    targetIntentModel,
    updateTargetIntentModel,
    categoryModel,
    getProjectTargetIntentModel,
    getProjectCategoryModel,
    updateProjectTargetIntentModel
  } = useSiteIntent();
  const scopedCategoryModel = projectId ? getProjectCategoryModel(projectId) : categoryModel;
  const scopedTargetIntentModel = projectId ? getProjectTargetIntentModel(projectId) : targetIntentModel;
  const draft = useMemo<TargetIntentModel | null>(() => {
    if (scopedTargetIntentModel) {
      return scopedTargetIntentModel;
    }

    return scopedCategoryModel ? createDefaultTargetIntentModel(scopedCategoryModel) : null;
  }, [scopedCategoryModel, scopedTargetIntentModel]);

  const [productTarget, setProductTarget] = useState(draft?.category ?? "");
  const [description, setDescription] = useState(draft?.notes ?? "");
  const [isLocationSpecific, setIsLocationSpecific] = useState(Boolean(draft?.isLocationSpecific));
  const [locationTargets, setLocationTargets] = useState(normalizeLocationTargets(draft?.locationTargets));

  useEffect(() => {
    setProductTarget(draft?.category ?? "");
    setDescription(draft?.notes ?? "");
    setIsLocationSpecific(Boolean(draft?.isLocationSpecific));
    setLocationTargets(normalizeLocationTargets(draft?.locationTargets));
  }, [draft]);

  if (!draft) {
    return (
      <div className="empty-state">
        Create and scan a project first so the target editor has enough website context to work from.
      </div>
    );
  }

  const draftModel = draft;

  function save() {
    const normalizedTarget = normalizeText(productTarget) || draftModel.category;
    const nextModel = {
      category: normalizedTarget,
      lockedConcepts: normalizedTarget ? [normalizedTarget] : [],
      removableConcepts: [],
      addableConcepts: [],
      notes: normalizeText(description),
      isLocationSpecific,
      locationTargets,
      updatedAt: new Date().toISOString()
    };

    if (projectId) {
      updateProjectTargetIntentModel(projectId, nextModel);
    } else {
      updateTargetIntentModel(nextModel);
    }

    onSave?.();
  }

  return (
    <div className="stack target-intent-editor">
      <label className="field">
        <span className="field__label">Product or service target</span>
        <input
          className="input"
          value={productTarget}
          onChange={(event) => setProductTarget(event.target.value)}
          placeholder="Visitor management system for workplaces"
        />
        <span className="field__hint">A simple one-line description of what the website should be known for.</span>
      </label>

      <label className="field">
        <span className="field__label">Deeper description</span>
        <textarea
          className="input"
          rows={6}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Describe the product, audience, problem it solves, and the context you want competitor discovery to use."
        />
        <span className="field__hint">This gives future competitor scans richer context without changing the current results.</span>
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
        <span className="field__hint">When enabled, these places get attached to competitor discovery and scoring queries.</span>
      </label>

      {isLocationSpecific ? (
        <label className="field">
          <span className="field__label">Target locations</span>
          <LocationTargetInput selected={locationTargets} onChange={setLocationTargets} />
          <span className="field__hint">Add one or more countries, states, towns, or suburbs to keep the comparison set local.</span>
        </label>
      ) : null}

      <div className="setup-modal__actions setup-modal__actions--target-editor">
        <button className="button button--primary" type="button" onClick={save}>
          <Save size={16} />
          Save target
        </button>
      </div>
    </div>
  );
}

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}
