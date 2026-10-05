import { Bot, LogOut, MessageSquare, Plug, Target } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const navItems = [
  { label: "Conversas", href: "/dashboard/conversas", icon: MessageSquare },
  { label: "Targets", href: "/dashboard/targets", icon: Target },
  { label: "Agentes de IA", href: "/dashboard/agentes", icon: Bot },
  { label: "Conexão", href: "/dashboard/conexao", icon: Plug },
];

export function AppSidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: session } = authClient.useSession();
  const { data: activeOrganization } = authClient.useActiveOrganization();
  const { data: activeMember } = authClient.useActiveMember();

  const role = activeMember?.role;

  async function handleSignOut() {
    await authClient.signOut();
    navigate("/login");
  }

  return (
    <aside className="flex h-screen w-64 shrink-0 flex-col border-r bg-background">
      <div className="border-b px-4 py-4">
        <p className="truncate text-sm font-semibold">{activeOrganization?.name ?? "Sturnus Flows"}</p>
        <p className="text-xs text-muted-foreground">WhatsApp</p>
      </div>

      <nav className="flex-1 space-y-1 p-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = location.pathname === item.href;

          return (
            <button
              key={item.href}
              type="button"
              onClick={() => navigate(item.href)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="border-t p-3">
        <p className="truncate text-sm font-medium">{session?.user.name}</p>
        <p className="truncate text-xs text-muted-foreground">{role ?? "membro"}</p>
        <Button
          variant="outline"
          size="sm"
          className="mt-2 w-full justify-start gap-2"
          onClick={handleSignOut}
        >
          <LogOut className="h-4 w-4" />
          Sair
        </Button>
      </div>
    </aside>
  );
}
