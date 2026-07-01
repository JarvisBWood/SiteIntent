"use client";

type ToastMessage = {
  id: string;
  title: string;
  description: string;
  tone?: "default" | "success" | "error";
};

type PinnedToast = {
  title: string;
  description: string;
  detail?: string | null;
  progress: number;
};

type ToastViewportProps = {
  toasts: ToastMessage[];
  pinnedToast?: PinnedToast | null;
  onDismiss: (id: string) => void;
};

export function ToastViewport({ toasts, pinnedToast, onDismiss }: ToastViewportProps) {
  if (!toasts.length && !pinnedToast) {
    return null;
  }

  return (
    <div className="toast-viewport" aria-live="polite" aria-atomic="false">
      {pinnedToast ? (
        <section className="toast toast--pinned" data-tone="default">
          <div className="toast__title">{pinnedToast.title}</div>
          <p className="toast__description">{pinnedToast.description}</p>
          {pinnedToast.detail ? <div className="toast__detail">{pinnedToast.detail}</div> : null}
          <div className="toast__progress" aria-label="Scan progress">
            <div className="toast__progress-track">
              <div className="toast__progress-fill" style={{ width: `${pinnedToast.progress}%` }} />
            </div>
            <div className="toast__progress-meta">{pinnedToast.progress}% complete</div>
          </div>
        </section>
      ) : null}
      {toasts.map((toast) => (
        <section key={toast.id} className="toast" data-tone={toast.tone ?? "default"}>
          <div className="toast__title">{toast.title}</div>
          <p className="toast__description">{toast.description}</p>
          <button className="toast__dismiss" type="button" onClick={() => onDismiss(toast.id)} aria-label="Dismiss notification">
            Dismiss
          </button>
        </section>
      ))}
    </div>
  );
}
