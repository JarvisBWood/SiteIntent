"use client";

type ToastMessage = {
  id: string;
  title: string;
  description: string;
  tone?: "default" | "success" | "error";
};

type ToastViewportProps = {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
};

export function ToastViewport({ toasts, onDismiss }: ToastViewportProps) {
  if (!toasts.length) {
    return null;
  }

  return (
    <div className="toast-viewport" aria-live="polite" aria-atomic="false">
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
