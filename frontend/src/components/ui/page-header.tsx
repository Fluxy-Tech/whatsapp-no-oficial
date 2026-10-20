import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Title block of a page, same language as the dashboard: small eyebrow, big title
 * with an optional serif italic word, description and actions on the right.
 */
export function PageHeader({
  eyebrow,
  title,
  accent,
  description,
  actions,
  leading,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  /** Rendered after the title in Instrument Serif italic. */
  accent?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Left of the title (back button, icon). */
  leading?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="flex min-w-0 items-start gap-3">
        {leading}
        <div className="min-w-0">
          {eyebrow && <div className="text-sm text-muted-foreground">{eyebrow}</div>}
          <h1 className="mt-1 text-3xl font-semibold sm:text-4xl">
            {title}
            {accent && (
              <>
                {" "}
                <span className="font-display font-normal italic">{accent}</span>
              </>
            )}
          </h1>
          {description && <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
