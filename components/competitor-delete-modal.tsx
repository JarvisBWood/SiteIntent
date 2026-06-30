"use client";

import { useEffect } from "react";
import { Trash2, X } from "lucide-react";

import { shortenDisplayUrl } from "@/lib/site-state";

type CompetitorDeleteModalProps = {
  open: boolean;
  competitorUrl: string;
  onCancel: () => void;
  onConfirm: () => void;
};

export function CompetitorDeleteModal({ open, competitorUrl, onCancel, onConfirm }: CompetitorDeleteModalProps) {
  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCancel();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onCancel}>
      <section
        className="setup-modal competitor-delete-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="competitor-delete-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="setup-modal__header">
          <div>
            <div className="eyebrow">
              <Trash2 size={14} />
              Remove competitor
            </div>
            <h2 className="setup-modal__title" id="competitor-delete-title">
              Delete this competitor?
            </h2>
            <p className="setup-modal__copy">
              {shortenDisplayUrl(competitorUrl)} will be removed from the dashboard and future scans will no longer include it.
            </p>
          </div>
          <button className="icon-button" type="button" onClick={onCancel} aria-label="Close delete confirmation">
            <X size={18} />
          </button>
        </header>

        <div className="setup-panel">
          <div className="section-note">
            <strong>Heads up</strong>
            <div>This only removes the competitor from the current website. Your existing scan history stays intact.</div>
          </div>
        </div>

        <div className="setup-modal__actions">
          <button className="button button--secondary" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="button button--secondary button--danger" type="button" onClick={onConfirm}>
            <Trash2 size={16} />
            Delete competitor
          </button>
        </div>
      </section>
    </div>
  );
}
