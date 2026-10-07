import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type TabItem<T extends string> = { id: T; label: string; icon: LucideIcon };

type TabsNavProps<T extends string> = {
  tabs: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
};

/** Underlined tab bar (icon + label) used on the agent and dashboard screens. */
export function TabsNav<T extends string>({ tabs, value, onChange, className }: TabsNavProps<T>) {
  return (
    <nav className={cn("flex gap-1 overflow-x-auto rounded-lg bg-muted/60 px-3 pt-2", className)} role="tablist">
      {tabs.map(({ id, label, icon: Icon }) => {
        const selected = value === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(id)}
            className={cn(
              "relative flex shrink-0 items-center gap-2 px-3 pb-3 pt-2 text-sm font-medium transition-colors",
              selected ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
            {selected && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary" />}
          </button>
        );
      })}
    </nav>
  );
}
