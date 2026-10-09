import { authClient } from "@/lib/auth-client";
import { api } from "@/lib/api";
import { useOrganization, usePermission } from "@/providers/OrganizationProvider";
import { AgentFailureForm } from "@/components/settings/AgentFailureForm";
import { MembersCard } from "@/components/settings/MembersCard";
import { NameForm } from "@/components/settings/NameForm";
import { PermissionsCard } from "@/components/settings/PermissionsCard";
import { SecondsSettingForm } from "@/components/settings/SecondsSettingForm";
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
          <SecondsSettingForm
            id="organization-message-wait"
            field="messageWaitSeconds"
            label="Tempo de espera por novas mensagens (segundos)"
            help="O agente espera o contato ficar este tempo sem mandar mensagens antes de responder. Cada nova mensagem reinicia a contagem, e todas as mensagens recebidas no período são respondidas juntas, como uma pessoa lendo a conversa."
            min={0}
            max={600}
            initialValue={current?.organization.messageWaitSeconds ?? 20}
            disabled={!canEdit || !current}
            onSaved={refresh}
          />
          <SecondsSettingForm
            id="organization-agent-message-delay"
            field="agentMessageDelaySeconds"
            label="Intervalo entre as mensagens do agente (segundos)"
            help="Quando o agente divide a resposta em várias mensagens, ele espera este tempo depois de enviar cada uma antes de mandar a próxima. Use 0 para enviar todas de uma vez."
            min={0}
            max={60}
            initialValue={current?.organization.agentMessageDelaySeconds ?? 0}
            disabled={!canEdit || !current}
            onSaved={refresh}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Falhas do agente</CardTitle>
          <CardDescription>O que acontece quando o agente de IA não consegue responder um contato.</CardDescription>
        </CardHeader>
        <CardContent>
          <AgentFailureForm
            initialMessage={current?.organization.agentFailureMessage ?? ""}
            initialAlertPhone={current?.organization.alertPhoneNumber ?? ""}
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
