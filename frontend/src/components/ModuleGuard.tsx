import { Navigate } from "react-router-dom";
import { ShieldOff } from "lucide-react";
import { MODULES, type Module } from "@/lib/organization";
import { useOrganization, usePermission } from "@/providers/OrganizationProvider";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";

export const MODULE_PATHS: Record<Module, string> = {
  dashboard: "/dashboard/painel",
  crm: "/dashboard/quadro",
  conversas: "/dashboard/conversas",
  leads: "/dashboard/leads",
  campanhas: "/dashboard/campanhas",
  agentes: "/dashboard/agentes",
  configuracoes: "/dashboard/configuracoes",
};

function Loading() {
  return (
    <div className="flex justify-center py-16">
      <Spinner className="size-6 text-muted-foreground" />
    </div>
  );
}

/** Renders the page only if the member's role can at least view the module. */
export function ModuleGuard({ module, children }: { module: Module; children: React.ReactNode }) {
  const { loading } = useOrganization();
  const { canView } = usePermission(module);

  if (loading) return <Loading />;
  if (!canView) {
    return (
      <Card className="flex min-h-60 flex-col items-center justify-center gap-2 text-center">
        <ShieldOff className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm font-medium">Sem acesso</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Seu cargo não tem acesso a esta área. Fale com o gerente da empresa.
        </p>
      </Card>
    );
  }
  return <>{children}</>;
}

/** /dashboard: opens the first area the member can see. */
export function ModuleHome() {
  const { current, loading } = useOrganization();
  if (loading) return <Loading />;
  const first = MODULES.find((module) => current && current.permissions[module] !== "none");
  return <Navigate to={first ? MODULE_PATHS[first] : "/dashboard/perfil"} replace />;
}
