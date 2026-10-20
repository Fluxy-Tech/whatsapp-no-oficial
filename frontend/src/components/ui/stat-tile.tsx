import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";

export type StatTone = "default" | "good" | "warning" | "critical";

// Black and white tiles; the tone only colors a small status dot.
const TONE_DOT: Record<StatTone, string | null> = {
  default: null,
  good: "bg-emerald-500",
  warning: "bg-amber-500",
  critical: "bg-red-500",
};

/** Number tile used by the dashboard, campaigns and agents. */
export function StatTile({
  label,
  value,
  detail,
  icon: Icon,
  tone = "default",
  className,
}: {
  label: string;
  value: string;
  detail?: string;
  icon: LucideIcon;
  tone?: StatTone;
  className?: string;
}) {
  const dot = TONE_DOT[tone];
  return (
    <Card className={cn("group relative overflow-hidden", className)}>
      <CardContent className="flex h-full flex-col justify-between gap-6 p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            {dot && <span className={cn("h-1.5 w-1.5 rounded-full", dot)} />}
            {label}
          </p>
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border bg-muted/50 text-foreground transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
            <Icon className="h-4 w-4" />
          </span>
        </div>
        <div>
          <p className="text-[2.1rem] font-semibold leading-none tracking-tight tabular-nums">{value}</p>
          {detail && <p className="mt-2 text-xs text-muted-foreground">{detail}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
