// Shared dialog and notice primitives used across the CRM views.
import { AlertTriangle, Check, ShieldCheck, X } from "lucide-react";

export function Modal({ title, eyebrow, children, onClose, size = "medium" }) {
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className={`modal modal-${size}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="modal-header">
          <div>
            <span className="eyebrow">{eyebrow}</span>
            <h2>{title}</h2>
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label={`Close ${title}`}
          >
            <X size={19} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

export function Notice({ type = "info", children }) {
  return (
    <div className={`notice notice-${type}`}>
      {type === "error" || type === "warning" ? (
        <AlertTriangle size={16} />
      ) : type === "success" ? (
        <Check size={16} />
      ) : (
        <ShieldCheck size={16} />
      )}
      <span>{children}</span>
    </div>
  );
}

