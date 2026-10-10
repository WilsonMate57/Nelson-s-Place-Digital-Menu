import { useEffect, useId, useRef, type ReactNode } from "react";
import { cx } from "../lib/util";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  variant?: "modal" | "sheet" | "wide";
  closeLabel?: string;
}

/**
 * Accessible dialog built on the native <dialog> element: focus is trapped,
 * Escape closes it and the page behind is inert.
 */
export function Dialog({ open, onClose, title, children, footer, variant = "modal", closeLabel = "Fechar" }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      document.body.style.overflow = "hidden";
    } else if (!open && dialog.open) {
      dialog.close();
      document.body.style.overflow = "";
    }
  }, [open]);

  useEffect(() => () => void (document.body.style.overflow = ""), []);

  return (
    <dialog
      ref={ref}
      className={cx("modal", variant === "sheet" && "sheet", variant === "wide" && "modal-wide")}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClose={() => {
        document.body.style.overflow = "";
        if (open) onClose();
      }}
      onClick={(e) => {
        // Click on the backdrop (the dialog element itself) closes it.
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <>
          <div className="modal-header">
            <h2 id={titleId}>{title}</h2>
            <button type="button" className="icon-btn" onClick={onClose} aria-label={closeLabel}>
              ×
            </button>
          </div>
          <div className="modal-body">{children}</div>
          {footer && <div className="modal-footer">{footer}</div>}
        </>
      )}
    </dialog>
  );
}
