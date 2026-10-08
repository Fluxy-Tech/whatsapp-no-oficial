import { authClient } from "@/lib/auth-client";
import { api } from "@/lib/api";
import { useOrganization, usePermission } from "@/providers/OrganizationProvider";
import { MembersCard } from "@/components/settings/MembersCard";
import { MessageWaitForm } from "@/components/settings/MessageWaitForm";
import { NameForm } from "@/components/settings/NameForm";
import { PermissionsCard } from "@/components/settings/PermissionsCard";
import { WhatsappConnectionCard } from "@/components/WhatsappConnectionCard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** Company settings (the user's own profile is at /dashboard/perfil). */
export function SettingsPage() {
  const { data: activeOrganization } = authClient.useActiveOrganization();
  const { current, refresh } = useOrganization();
  const { canEdit } = usePermission("configuracoes");
  const canManage = current?.canManage ?? false;

  async function renameOrganization(name: string) {
    try {
      await api("/api/organizations/current", { method: "PATCH", body: JSON.stringify({ name }) });
      // Reloads the active organization (name shown in the sidebar).
      await authClient.organization.setActive({ organizationId: activeOrganization!.id });
      await refresh();
      return { error: null };
    } catch (err) {
      return { error: { message: (err as Error).message } };
    }
  }

  return (
    <div className="w-full space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Configurações</h1>
        <p className="text-sm text-muted-foreground">Gerencie a empresa, os membros e a conexão com o WhatsApp.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Empresa</CardTitle>
          {!canEdit && <CardDescription>Seu cargo só pode ver os dados da empresa.</CardDescription>}
        </CardHeader>
        <CardContent className="space-y-6">
          <NameForm
            id="organization-name"
            label="Nome da empresa"
            initialValue={activeOrganization?.name ?? ""}
            disabled={!canEdit || !activeOrganization}
            onSave={renameOrganization}
          />
          <MessageWaitForm
            initialValue={current?.organization.messageWaitSeconds ?? 20}
            disabled={!canEdit || !current}
            onSaved={refresh}
          />
        </CardContent>
      </Card>

      <MembersCard canEdit={canEdit} canManage={canManage} />

      {canManage && <PermissionsCard />}

      <WhatsappConnectionCard canConnect={canEdit} />
    </div>
  );
}
