import { cn } from "@/lib/utils";

/** Small blinking dot that calls attention (red by default; "primary" for the upcoming meeting). */
export function AttentionDot({
  tone = "danger",
  className,
  label,
}: {
  tone?: "danger" | "primary";
  className?: string;
  /** Tooltip / screen reader text; without it the dot is decorative. */
  label?: string;
}) {
  const color = tone === "danger" ? "bg-red-500" : "bg-primary";
  return (
    <span
      className={cn("relative flex h-2.5 w-2.5 shrink-0", className)}
      title={label}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
    >
      <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-75", color)} />
      <span className={cn("relative inline-flex h-full w-full rounded-full", color)} />
    </span>
  );
}
