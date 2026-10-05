import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { authClient } from "@/lib/auth-client";
import { AppSidebar } from "@/components/AppSidebar";

export function DashboardLayout() {
  const { data: organizations } = authClient.useListOrganizations();
  const { data: activeOrganization } = authClient.useActiveOrganization();

  // A freshly signed-in session may not have an active organization set yet;
  // default to the user's first one.
  useEffect(() => {
    if (!activeOrganization && organizations && organizations.length > 0) {
      authClient.organization.setActive({ organizationId: organizations[0].id });
    }
  }, [activeOrganization, organizations]);

  return (
    <div className="flex h-screen bg-muted/30">
      <AppSidebar />
      <main className="w-full space-y-6 overflow-y-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}
