import { useState } from "react";
import { withBase } from "../lib/base";
import { cx } from "../lib/util";

/**
 * Product photo, or a neutral monogram placeholder when no approved photo exists.
 * Lazy-loaded with explicit aspect ratio to avoid layout shift.
 */
export function ProductImage({ src, alt, className, eager = false }: { src: string | null; alt: string; className?: string; eager?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className={cx("product-placeholder", className)} aria-hidden="true">
        <span>{alt.trim().charAt(0).toUpperCase() || "N"}</span>
      </div>
    );
  }
  return (
    <img
      className={className}
      src={withBase(src)}
      alt={alt}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}
