import { useEffect, useMemo, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useNavigate } from "react-router-dom";
import { ArrowLeftRight, CornerDownLeft, LogOut, Search, Smartphone, Target, UserRound, type LucideIcon } from "lucide-react";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { formatPhone } from "@/lib/dashboard";
import { targetLabel, type Target as Lead } from "@/lib/leads";
import { NAV_LINKS } from "@/lib/navigation";
import type { Module } from "@/lib/organization";
import { cn } from "@/lib/utils";
import { useOrganization } from "@/providers/OrganizationProvider";

type Item = {
  id: string;
  group: "Ir para" | "Leads" | "Ações";
  label: string;
  hint?: string;
  icon: LucideIcon;
  shortcut?: string;
  run: () => void;
};

// "Conversão" matches "conversao": search ignores accents and case.
const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** ⌘K / Ctrl+K: jump to any area, find a lead or run an account action. */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const { current } = useOrganization();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const canSee = (module: Module) =>
    Boolean(current && current.permissions[module] !== "none");

  // Leads are loaded the first time the palette opens, then reused.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    if (leads === null && canSee("leads")) {
      api<Lead[]>("/api/whatsapp/targets")
        .then((data) => setLeads(data.filter((lead) => !lead.isGroup)))
        .catch(() => setLeads([]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const go = (href: string) => () => navigate(href);
    const search = normalize(query.trim());

    const pages: Item[] = NAV_LINKS.filter((link) => canSee(link.module)).map((link) => ({
      id: link.href,
      group: "Ir para",
      label: link.label,
      hint: link.hint,
      icon: link.icon,
      shortcut: link.shortcut ? `G ${link.shortcut}` : undefined,
      run: go(link.href),
    }));

    const actions: Item[] = [
      ...(canSee("configuracoes")
        ? [
            {
              id: "connect",
              group: "Ações" as const,
              label: "Conexão do WhatsApp",
              hint: "QR Code, número e reconexão",
              icon: Smartphone,
              run: go("/dashboard/configuracoes"),
            },
          ]
        : []),
      { id: "profile", group: "Ações", label: "Meu perfil", hint: "Nome e foto", icon: UserRound, run: go("/dashboard/perfil") },
      { id: "switch", group: "Ações", label: "Trocar de empresa", icon: ArrowLeftRight, run: go("/organizacoes") },
      {
        id: "signout",
        group: "Ações",
        label: "Sair",
        icon: LogOut,
        run: () => {
          void authClient.signOut().then(() => navigate("/login"));
        },
      },
    ];

    const matches = (item: Item) => !search || normalize(`${item.label} ${item.hint ?? ""}`).includes(search);

    // Leads only show up while typing, otherwise the list would be the whole base.
    const foundLeads: Item[] =
      search && leads
        ? leads
            .filter((lead) => normalize(`${targetLabel(lead)} ${lead.number ?? ""}`).includes(search))
            .slice(0, 6)
            .map((lead) => ({
              id: `lead:${lead.id}`,
              group: "Leads",
              label: targetLabel(lead),
              hint: lead.number ? formatPhone(lead.number) : undefined,
              icon: Target,
              run: go(`/dashboard/lead/${lead.id}`),
            }))
        : [];

    return [...pages.filter(matches), ...foundLeads, ...actions.filter(matches)];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, leads, current, navigate]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function run(item: Item) {
    onOpenChange(false);
    item.run();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => Math.min(index + 1, items.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && items[active]) {
      event.preventDefault();
      run(items[active]);
    }
  }

  let lastGroup = "";

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-zinc-950/40 backdrop-blur-[3px] data-[state=open]:animate-overlay-in data-[state=closed]:animate-overlay-out" />
        <DialogPrimitive.Content
          onKeyDown={onKeyDown}
          className="fixed left-1/2 top-[12vh] z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border border-border/70 bg-background shadow-float outline-none data-[state=open]:animate-pop-in"
        >
          <DialogPrimitive.Title className="sr-only">Buscar na plataforma</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Digite para encontrar páginas, leads e ações. Use as setas e Enter.
          </DialogPrimitive.Description>
          <div className="flex items-center gap-3 border-b px-4">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar páginas, leads ou ações..."
              className="h-14 w-full bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
              aria-label="Buscar"
            />
            <kbd className="hidden rounded-md border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:block">
              ESC
            </kbd>
          </div>

          <div ref={listRef} className="scrollbar-thin max-h-[min(60vh,26rem)] overflow-y-auto p-2" role="listbox">
            {items.length === 0 ? (
              <p className="px-3 py-10 text-center text-sm text-muted-foreground">Nada encontrado para “{query}”.</p>
            ) : (
              items.map((item, index) => {
                const Icon = item.icon;
                const header = item.group !== lastGroup ? item.group : null;
                lastGroup = item.group;
                return (
                  <div key={item.id}>
                    {header && (
                      <p className="px-3 pb-1.5 pt-3 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground first:pt-1">
                        {header}
                      </p>
                    )}
                    <button
                      type="button"
                      role="option"
                      aria-selected={index === active}
                      data-index={index}
                      onMouseMove={() => setActive(index)}
                      onClick={() => run(item)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                        index === active ? "bg-primary text-primary-foreground" : "text-foreground",
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-md border",
                          index === active ? "border-white/15 bg-white/10" : "bg-background",
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{item.label}</span>
                        {item.hint && (
                          <span
                            className={cn(
                              "block truncate text-xs",
                              index === active ? "text-primary-foreground/60" : "text-muted-foreground",
                            )}
                          >
                            {item.hint}
                          </span>
                        )}
                      </span>
                      {item.shortcut && (
                        <kbd
                          className={cn(
                            "hidden font-mono text-[10px] tracking-widest sm:block",
                            index === active ? "text-primary-foreground/60" : "text-muted-foreground",
                          )}
                        >
                          {item.shortcut}
                        </kbd>
                      )}
                      {index === active && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 opacity-60" />}
                    </button>
                  </div>
                );
              })
            )}
          </div>

          <div className="flex items-center justify-between gap-4 border-t bg-muted/40 px-4 py-2.5 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-3">
              <span>
                <kbd className="font-mono">↑↓</kbd> navegar
              </span>
              <span>
                <kbd className="font-mono">↵</kbd> abrir
              </span>
            </span>
            <span className="hidden sm:inline">
              Dica: <kbd className="font-mono">G</kbd> + letra abre uma área direto
            </span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
