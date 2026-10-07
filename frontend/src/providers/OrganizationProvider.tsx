import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import type { AccessLevel, CurrentOrganization, Module } from "@/lib/organization";

type OrganizationContextValue = {
  current: CurrentOrganization | null;
  loading: boolean;
  refresh: () => Promise<void>;
};

const OrganizationContext = createContext<OrganizationContextValue>({
  current: null,
  loading: true,
  refresh: async () => {},
});

/** Role and permissions of the logged user in the active organization. */
export function OrganizationProvider({ children }: { children: React.ReactNode }) {
  const { data: activeOrganization } = authClient.useActiveOrganization();
  const organizationId = activeOrganization?.id ?? null;
  const [current, setCurrent] = useState<CurrentOrganization | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!organizationId) {
      setCurrent(null);
      return;
    }
    try {
      setCurrent(await api<CurrentOrganization>("/api/organizations/current"));
    } catch {
      setCurrent(null);
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  return <OrganizationContext.Provider value={{ current, loading, refresh }}>{children}</OrganizationContext.Provider>;
}

export function useOrganization() {
  return useContext(OrganizationContext);
}

const RANK: Record<AccessLevel, number> = { none: 0, view: 1, edit: 2 };

/** Access of the current member to a module: { canView, canEdit }. */
export function usePermission(module: Module) {
  const { current } = useOrganization();
  const level = current?.permissions[module] ?? "none";
  return { level, canView: RANK[level] >= RANK.view, canEdit: RANK[level] >= RANK.edit };
}
