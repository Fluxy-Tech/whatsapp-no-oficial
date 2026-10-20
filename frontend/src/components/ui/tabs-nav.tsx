import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type TabItem<T extends string> = { id: T; label: string; icon: LucideIcon };

type TabsNavProps<T extends string> = {
  tabs: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
};

/** Segmented tab bar (icon + label): the selected tab is a black pill. */
export function TabsNav<T extends string>({ tabs, value, onChange, className }: TabsNavProps<T>) {
  return (
    <nav
      className={cn(
        "scrollbar-thin flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl border border-border/80 bg-background p-1 shadow-soft",
        className,
      )}
      role="tablist"
    >
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
              "flex h-9 shrink-0 items-center gap-2 rounded-lg px-3.5 text-sm font-medium transition-all",
              selected
                ? "bg-primary text-primary-foreground shadow-[inset_0_1px_0_oklch(100%_0_0/0.1),0_4px_12px_-4px_oklch(0%_0_0/0.35)]"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        );
      })}
    </nav>
  );
}
