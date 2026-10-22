import logo from "@/assets/getleads-marca.png";
import icon from "@/assets/IconeSemFundo.png";
import { ArrowLeftRight, ChevronsUpDown, LogOut, PanelLeftClose, PanelLeftOpen, UserRound } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { authClient } from "@/lib/auth-client";
import { formatPhone } from "@/lib/dashboard";
import { NAV_SECTIONS, isLinkActive, type NavLink } from "@/lib/navigation";
import { roleLabel, type Module } from "@/lib/organization";
import { cn } from "@/lib/utils";
import { useWhatsappStatus } from "@/lib/whatsapp-status";
import { useHandoffs } from "@/providers/HandoffProvider";
import { useOrganization } from "@/providers/OrganizationProvider";
import { MemberAvatar } from "@/components/dashboard/MemberAvatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const TONE_DOT = {
  good: "bg-emerald-500 shadow-[0_0_0_3px_oklch(72%_0.17_155/0.18)]",
  warning: "bg-amber-500 shadow-[0_0_0_3px_oklch(77%_0.16_70/0.2)]",
  critical: "bg-red-500 shadow-[0_0_0_3px_oklch(63%_0.22_27/0.18)]",
};

export function AppSidebar({
  collapsed = false,
  onToggleCollapsed,
  onNavigate,
}: {
  /** Icon rail (desktop only). */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  /** Called after a link is chosen (closes the mobile drawer). */
  onNavigate?: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: session } = authClient.useSession();
  const { data: activeOrganization } = authClient.useActiveOrganization();
  const { current } = useOrganization();
  const whatsapp = useWhatsappStatus();
  const { pendingChatIds } = useHandoffs();

  const canSee = (module: Module) => Boolean(current && current.permissions[module] !== "none");

  function go(href: string) {
    navigate(href);
    onNavigate?.();
  }

  async function handleSignOut() {
    await authClient.signOut();
    navigate("/login");
  }

  function renderLink(link: NavLink) {
    const Icon = link.icon;
    const active = isLinkActive(link, location.pathname);
    // Conversations waiting for an attendant (the contact asked for a person).
    const badge = link.module === "conversas" ? pendingChatIds.size : 0;
    return (
      <button
        key={link.href}
        type="button"
        onClick={() => go(link.href)}
        title={collapsed ? link.label : undefined}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group relative flex w-full items-center gap-3 rounded-lg text-[13.5px] font-medium transition-all",
          collapsed ? "h-10 justify-center" : "px-3 py-2",
          active
            ? "bg-primary text-primary-foreground shadow-[inset_0_1px_0_oklch(100%_0_0/0.1),0_4px_12px_-4px_oklch(0%_0_0/0.35)]"
            : "text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
      >
        <Icon className={cn("h-[18px] w-[18px] shrink-0", !active && "opacity-80 group-hover:opacity-100")} />
        {!collapsed && <span className="flex-1 truncate text-left">{link.label}</span>}
        {badge > 0 && (
          <span
            title={`${badge} cliente(s) pediram atendimento humano`}
            className={cn(
              "flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-semibold tabular-nums text-white ring-2 ring-background",
              collapsed && "absolute right-1.5 top-1",
            )}
          >
            {badge}
          </span>
        )}
      </button>
    );
  }

  const sections = NAV_SECTIONS.map((section) => ({
    ...section,
    links: section.links.filter((link) => canSee(link.module)),
  })).filter((section) => section.links.length > 0);

  return (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col border-r border-border/70 bg-background transition-[width] duration-300 ease-out",
        collapsed ? "w-[76px]" : "w-[264px]",
      )}
    >
      {/* Brand */}
      <div className={cn("flex h-16 items-center", collapsed ? "justify-center" : "justify-between px-5")}>
        {collapsed ? (
          <img src={icon} alt="GetLeads" className="h-8 w-8" />
        ) : (
          <img src={logo} alt="GetLeads" className="h-8 w-auto" />
        )}
        {onToggleCollapsed && !collapsed && (
          <button
            type="button"
            onClick={onToggleCollapsed}
            title="Recolher menu"
            aria-label="Recolher menu"
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Company */}
      <div className={cn("pb-3", collapsed ? "px-3" : "px-3")}>
        <button
          type="button"
          onClick={() => go("/organizacoes")}
          title="Trocar de empresa"
          className={cn(
            "flex w-full items-center gap-3 rounded-xl border border-border/80 bg-muted/40 text-left transition-colors hover:border-foreground/15 hover:bg-muted",
            collapsed ? "h-11 justify-center" : "p-2.5",
          )}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary font-display text-base italic text-primary-foreground">
            {(activeOrganization?.name ?? "G").charAt(0).toUpperCase()}
          </span>
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1">
                <span className="block text-[10.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  Empresa
                </span>
                <span className="block truncate text-sm font-semibold">{activeOrganization?.name ?? "—"}</span>
              </span>
              <ArrowLeftRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </>
          )}
        </button>
      </div>

      <nav className="scrollbar-thin flex-1 space-y-5 overflow-y-auto px-3 py-2">
        {sections.map((section) => (
          <div key={section.label} className="space-y-1">
            {collapsed ? (
              <div className="mx-auto mb-2 h-px w-6 bg-border first:hidden" />
            ) : (
              <p className="px-3 pb-1 text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground/80">
                {section.label}
              </p>
            )}
            {section.links.map(renderLink)}
          </div>
        ))}
      </nav>

      {/* WhatsApp status */}
      <div className="px-3 pb-2">
        <button
          type="button"
          onClick={() => canSee("configuracoes") && go("/dashboard/configuracoes")}
          title={`WhatsApp: ${whatsapp.label}`}
          className={cn(
            "flex w-full items-center gap-3 rounded-xl text-left transition-colors hover:bg-accent",
            collapsed ? "h-10 justify-center" : "px-3 py-2.5",
          )}
        >
          <span className={cn("h-2 w-2 shrink-0 rounded-full", TONE_DOT[whatsapp.tone])} />
          {!collapsed && (
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-medium">WhatsApp · {whatsapp.label}</span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {whatsapp.status === "CONNECTED" && whatsapp.phoneNumber
                  ? formatPhone(whatsapp.phoneNumber)
                  : "Nenhum número conectado"}
              </span>
            </span>
          )}
        </button>
      </div>

      {/* Profile menu */}
      <div className="border-t border-border/70 p-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                "flex w-full items-center gap-3 rounded-xl text-left transition-colors hover:bg-accent data-[state=open]:bg-accent",
                collapsed ? "justify-center p-1.5" : "p-2",
              )}
            >
              <MemberAvatar
                id={session?.user.id ?? "me"}
                name={session?.user.name}
                image={session?.user.image}
                className="h-9 w-9 text-xs ring-0"
              />
              {!collapsed && (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{session?.user.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{roleLabel(current?.role)}</span>
                  </span>
                  <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                </>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-60">
            <DropdownMenuLabel className="truncate">{session?.user.email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => go("/dashboard/perfil")}>
              <UserRound />
              Perfil
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => go("/organizacoes")}>
              <ArrowLeftRight />
              Trocar de empresa
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => void handleSignOut()}>
              <LogOut />
              Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {onToggleCollapsed && collapsed && (
          <button
            type="button"
            onClick={onToggleCollapsed}
            title="Expandir menu"
            aria-label="Expandir menu"
            className="mt-2 flex h-9 w-full items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        )}
      </div>
    </aside>
  );
}
