import { ChevronRight, Menu, Search } from "lucide-react";
import { useLocation } from "react-router-dom";
import { findSection } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { useWhatsappStatus } from "@/lib/whatsapp-status";

const EXTRA_TITLES: Record<string, string> = { "/dashboard/perfil": "Perfil" };

const TONE_PILL = {
  good: "border-emerald-200/80 bg-emerald-50 text-emerald-700",
  warning: "border-amber-200/80 bg-amber-50 text-amber-700",
  critical: "border-red-200/80 bg-red-50 text-red-700",
};
const TONE_DOT = { good: "bg-emerald-500", warning: "bg-amber-500", critical: "bg-red-500" };

const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);

/** Breadcrumb, global search trigger and live WhatsApp status above every page. */
export function Topbar({ onOpenMenu, onOpenSearch }: { onOpenMenu: () => void; onOpenSearch: () => void }) {
  const { pathname } = useLocation();
  const found = findSection(pathname);
  const whatsapp = useWhatsappStatus();

  const title = found?.link.label ?? EXTRA_TITLES[pathname] ?? "GetLeads";

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-border/70 bg-background/80 px-4 backdrop-blur-xl sm:px-6">
      <button
        type="button"
        onClick={onOpenMenu}
        aria-label="Abrir menu"
        className="-ml-1 flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground lg:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      <nav aria-label="Você está em" className="flex min-w-0 items-center gap-1.5 text-sm">
        {found && (
          <>
            <span className="hidden truncate text-muted-foreground sm:inline">{found.section.label}</span>
            <ChevronRight className="hidden h-3.5 w-3.5 shrink-0 text-muted-foreground/60 sm:block" />
          </>
        )}
        <span className="truncate font-medium">{title}</span>
      </nav>

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={onOpenSearch}
          className="flex h-9 items-center gap-2 rounded-lg border border-border/80 bg-muted/40 px-3 text-sm text-muted-foreground transition-colors hover:border-foreground/15 hover:bg-muted hover:text-foreground md:w-72"
        >
          <Search className="h-4 w-4" />
          <span className="hidden flex-1 text-left md:inline">Buscar páginas, leads...</span>
          <kbd className="hidden rounded border bg-background px-1.5 py-0.5 font-mono text-[10px] md:inline">
            {isMac ? "⌘" : "Ctrl"} K
          </kbd>
        </button>

        <span
          className={cn(
            "hidden h-9 items-center gap-2 rounded-lg border px-3 text-xs font-medium sm:flex",
            TONE_PILL[whatsapp.tone],
          )}
          title={`WhatsApp: ${whatsapp.label}`}
        >
          <span className="relative flex h-2 w-2">
            {whatsapp.tone === "good" && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            )}
            <span className={cn("relative inline-flex h-2 w-2 rounded-full", TONE_DOT[whatsapp.tone])} />
          </span>
          {whatsapp.tone === "good" ? "Online" : whatsapp.label}
        </span>
      </div>
    </header>
  );
}
