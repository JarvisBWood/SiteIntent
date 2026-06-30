"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Save, RotateCcw, X } from "lucide-react";

import { useSiteIntent } from "@/components/site-intent-provider";
import { createDefaultTargetIntentModel } from "@/lib/models";
import type { TargetIntentModel } from "@/lib/site-state";

type TargetIntentEditorProps = {
  onSave?: () => void;
};

export function TargetIntentEditor({ onSave }: TargetIntentEditorProps) {
  const { targetIntentModel, updateTargetIntentModel, categoryModel } = useSiteIntent();
  const draft = useMemo<TargetIntentModel | null>(() => {
    if (targetIntentModel) {
      return targetIntentModel;
    }

    return categoryModel ? createDefaultTargetIntentModel(categoryModel) : null;
  }, [categoryModel, targetIntentModel]);

  const [category, setCategory] = useState(draft?.category ?? "");
  const [notes, setNotes] = useState(draft?.notes ?? "");
  const [lockedConcepts, setLockedConcepts] = useState<string[]>(draft?.lockedConcepts ?? []);
  const [removableConcepts, setRemovableConcepts] = useState<string[]>(draft?.removableConcepts ?? []);
  const [addableConcepts, setAddableConcepts] = useState<string[]>(draft?.addableConcepts ?? []);
  const [newLocked, setNewLocked] = useState("");
  const [newRemovable, setNewRemovable] = useState("");
  const [newAddable, setNewAddable] = useState("");

  useEffect(() => {
    setCategory(draft?.category ?? "");
    setNotes(draft?.notes ?? "");
    setLockedConcepts(draft?.lockedConcepts ?? []);
    setRemovableConcepts(draft?.removableConcepts ?? []);
    setAddableConcepts(draft?.addableConcepts ?? []);
  }, [draft]);

  if (!draft) {
    return (
      <div className="empty-state">
        Create and scan a project first so the target intent editor has a category model to work from.
      </div>
    );
  }

  const draftModel = draft;

  function save() {
    updateTargetIntentModel({
      category: category.trim() || draftModel.category,
      lockedConcepts: normalizeConcepts(lockedConcepts),
      removableConcepts: normalizeConcepts(removableConcepts),
      addableConcepts: normalizeConcepts(addableConcepts),
      notes: notes.trim(),
      updatedAt: new Date().toISOString()
    });

    onSave?.();
  }

  function reset() {
    setCategory(categoryModel?.category ?? draftModel.category);
    setNotes(draftModel.notes);
    setLockedConcepts(draftModel.lockedConcepts);
    setRemovableConcepts(draftModel.removableConcepts);
    setAddableConcepts(draftModel.addableConcepts);
  }

  return (
    <div className="stack">
      <label className="field">
        <span className="field__label">Category</span>
        <input className="input" value={category} onChange={(event) => setCategory(event.target.value)} />
        <span className="field__hint">Adjust the optimization target without changing the shared category model.</span>
      </label>

      <label className="field">
        <span className="field__label">Notes</span>
        <textarea className="input" rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} />
        <span className="field__hint">Keep the target practical and easy to explain to the team.</span>
      </label>

      <ConceptSection
        label="Locked concepts"
        hint="These stay fixed as part of the target."
        values={lockedConcepts}
        newValue={newLocked}
        onNewValueChange={setNewLocked}
        onAdd={() => {
          const next = normalizeSingleConcept(newLocked);
          if (!next) {
            return;
          }
          setLockedConcepts((current) => [...current, next]);
          setNewLocked("");
        }}
        onRemove={(index) => setLockedConcepts((current) => current.filter((_, currentIndex) => currentIndex !== index))}
      />

      <ConceptSection
        label="Removable concepts"
        hint="These are candidates to cut or de-emphasize."
        values={removableConcepts}
        newValue={newRemovable}
        onNewValueChange={setNewRemovable}
        onAdd={() => {
          const next = normalizeSingleConcept(newRemovable);
          if (!next) {
            return;
          }
          setRemovableConcepts((current) => [...current, next]);
          setNewRemovable("");
        }}
        onRemove={(index) => setRemovableConcepts((current) => current.filter((_, currentIndex) => currentIndex !== index))}
      />

      <ConceptSection
        label="Addable concepts"
        hint="These are ideas you want the site to introduce more strongly."
        values={addableConcepts}
        newValue={newAddable}
        onNewValueChange={setNewAddable}
        onAdd={() => {
          const next = normalizeSingleConcept(newAddable);
          if (!next) {
            return;
          }
          setAddableConcepts((current) => [...current, next]);
          setNewAddable("");
        }}
        onRemove={(index) => setAddableConcepts((current) => current.filter((_, currentIndex) => currentIndex !== index))}
      />

      <div className="hero-actions">
        <button className="button button--primary" type="button" onClick={save}>
          <Save size={16} />
          Save target
        </button>
        <button className="button button--secondary" type="button" onClick={reset}>
          <RotateCcw size={16} />
          Reset draft
        </button>
      </div>
    </div>
  );
}

function ConceptSection({
  label,
  hint,
  values,
  newValue,
  onNewValueChange,
  onAdd,
  onRemove
}: {
  label: string;
  hint: string;
  values: string[];
  newValue: string;
  onNewValueChange: (value: string) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}) {
  return (
    <section className="card card--subtle">
      <div className="card__title">{label}</div>
      <p className="card__copy">{hint}</p>
      <div className="tag-list" style={{ marginTop: 12 }}>
        {values.length ? values.map((value, index) => (
          <button key={`${label}-${value}-${index}`} className="tag tag--interactive" type="button" onClick={() => onRemove(index)}>
            {value}
            <X size={12} />
          </button>
        )) : <span className="muted">None yet.</span>}
      </div>
      <div className="hero-actions" style={{ marginTop: 12 }}>
        <input className="input" value={newValue} onChange={(event) => onNewValueChange(event.target.value)} placeholder={`Add ${label.toLowerCase()}`} />
        <button className="button button--secondary" type="button" onClick={onAdd}>
          <Plus size={16} />
          Add
        </button>
      </div>
    </section>
  );
}

function normalizeSingleConcept(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeConcepts(values: string[]) {
  return values.map(normalizeSingleConcept).filter(Boolean);
}
