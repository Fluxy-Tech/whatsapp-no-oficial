import { useEffect, useState } from "react";
import logo from "@/assets/getleads-marca.png";
import {
  ArrowLeftRight,
  Bot,
  BriefcaseBusiness,
  CalendarDays,
  ChevronDown,
  ChevronsUpDown,
  KanbanSquare,
  LayoutDashboard,
  LogOut,
  Megaphone,
  MessageSquare,
  Settings,
  Target,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { authClient } from "@/lib/auth-client";
import { roleLabel, type Module } from "@/lib/organization";
import { cn } from "@/lib/utils";
import { useOrganization } from "@/providers/OrganizationProvider";
import { Button } from "@/components/ui/button";
import { MemberAvatar } from "@/components/dashboard/MemberAvatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type NavLink = { label: string; href: string; icon: LucideIcon; module: Module; match?: string[] };
type NavGroup = { label: string; icon: LucideIcon; module: Module; children: NavLink[] };

const navItems: (NavLink | NavGroup)[] = [
  { label: "Dashboard", href: "/dashboard/painel", icon: LayoutDashboard, module: "dashboard" },
  {
    label: "CRM",
    icon: BriefcaseBusiness,
    module: "crm",
    children: [
      { label: "Quadro", href: "/dashboard/quadro", icon: KanbanSquare, module: "crm" },
      { label: "Calendário", href: "/dashboard/calendario", icon: CalendarDays, module: "crm" },
    ],
  },
  { label: "Conversas", href: "/dashboard/conversas", icon: MessageSquare, module: "conversas" },
  // /dashboard/lead/:id is a lead page too.
  { label: "Leads", href: "/dashboard/leads", icon: Target, module: "leads", match: ["/dashboard/lead/"] },
  {
    label: "Campanhas",
    href: "/dashboard/campanhas",
    icon: Megaphone,
    module: "campanhas",
    match: ["/dashboard/campanhas/"],
  },
  { label: "Agentes de IA", href: "/dashboard/agentes", icon: Bot, module: "agentes", match: ["/dashboard/agentes/"] },
  { label: "Configurações", href: "/dashboard/configuracoes", icon: Settings, module: "configuracoes" },
];

const isGroup = (item: NavLink | NavGroup): item is NavGroup => "children" in item;

export function AppSidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: session } = authClient.useSession();
  const { data: activeOrganization } = authClient.useActiveOrganization();
  const { current } = useOrganization();

  const isActive = (link: NavLink) =>
    location.pathname === link.href || (link.match ?? []).some((prefix) => location.pathname.startsWith(prefix));

  const crmActive = navItems.some((item) => isGroup(item) && item.children.some(isActive));
  const [crmOpen, setCrmOpen] = useState(crmActive);
  // Opening a CRM page from elsewhere (e.g. a link) expands the group.
  useEffect(() => {
    if (crmActive) setCrmOpen(true);
  }, [crmActive]);

  const canSee = (module: Module) => Boolean(current && current.permissions[module] !== "none");

  async function handleSignOut() {
    await authClient.signOut();
    navigate("/login");
  }

  function renderLink(link: NavLink, nested = false) {
    const Icon = link.icon;
    const active = isActive(link);
    return (
      <button
        key={link.href}
        type="button"
        onClick={() => navigate(link.href)}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
          nested && "pl-9",
          active
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        )}
      >
        <Icon className="h-4 w-4" />
        {link.label}
      </button>
    );
  }

  return (
    <aside className="flex h-screen w-64 shrink-0 flex-col border-r bg-background">
      <div className="border-b px-4 py-4">
        <img src={logo} alt="GetLeads" className="h-10 w-auto" />
      </div>
      <div className="flex items-center gap-2 border-b px-4 py-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-muted-foreground">Empresa:</p>
          <p className="truncate text-lg font-semibold">{activeOrganization?.name ?? "—"}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          title="Trocar de empresa"
          aria-label="Trocar de empresa"
          onClick={() => navigate("/organizacoes")}
        >
          <ArrowLeftRight className="h-4 w-4" />
        </Button>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-2">
        {navItems.map((item) => {
          if (!canSee(item.module)) return null;
          if (!isGroup(item)) return renderLink(item);

          const Icon = item.icon;
          return (
            <div key={item.label} className="space-y-1">
              <button
                type="button"
                onClick={() => setCrmOpen((open) => !open)}
                aria-expanded={crmOpen}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground",
                  crmActive ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                <span className="flex-1 text-left">{item.label}</span>
                <ChevronDown className={cn("h-4 w-4 transition-transform", crmOpen && "rotate-180")} />
              </button>
              {crmOpen && item.children.map((child) => renderLink(child, true))}
            </div>
          );
        })}
      </nav>

      {/* Profile menu: Perfil / Sair. */}
      <div className="border-t p-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent data-[state=open]:bg-accent"
            >
              <MemberAvatar
                id={session?.user.id ?? "me"}
                name={session?.user.name}
                image={session?.user.image}
                className="h-9 w-9 text-xs ring-0"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{session?.user.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{roleLabel(current?.role)}</span>
              </span>
              <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-[var(--radix-dropdown-menu-trigger-width)]">
            <DropdownMenuLabel className="truncate">{session?.user.email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => navigate("/dashboard/perfil")}>
              <UserRound />
              Perfil
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => navigate("/organizacoes")}>
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
      </div>
    </aside>
  );
}
