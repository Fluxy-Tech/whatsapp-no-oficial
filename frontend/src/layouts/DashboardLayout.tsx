import { Navigate, Outlet } from "react-router-dom";
import { authClient } from "@/lib/auth-client";
import { OrganizationProvider } from "@/providers/OrganizationProvider";
import { AppSidebar } from "@/components/AppSidebar";
import { Spinner } from "@/components/ui/spinner";

export function DashboardLayout() {
  const { data: activeOrganization, isPending } = authClient.useActiveOrganization();

  if (isPending) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    );
  }

  // Every login starts without a company: the user picks one first.
  if (!activeOrganization) return <Navigate to="/organizacoes" replace />;

  return (
    <OrganizationProvider>
      <div className="flex h-screen bg-muted/30">
        <AppSidebar />
        <main className="w-full space-y-6 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </OrganizationProvider>
  );
}
