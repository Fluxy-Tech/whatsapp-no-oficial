import { useEffect, useState } from "react";
import { Bot, Building2, ShieldCheck, Smartphone, Users, type LucideIcon } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useOrganization, usePermission } from "@/providers/OrganizationProvider";
import { AgentFailureForm } from "@/components/settings/AgentFailureForm";
import { MembersCard } from "@/components/settings/MembersCard";
import { NameForm } from "@/components/settings/NameForm";
import { PermissionsCard } from "@/components/settings/PermissionsCard";
import { SecondsSettingForm } from "@/components/settings/SecondsSettingForm";
import { WhatsappConnectionCard } from "@/components/WhatsappConnectionCard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";

type Section = { id: string; label: string; icon: LucideIcon };

/** Company settings (the user's own profile is at /dashboard/perfil). */
export function SettingsPage() {
  const { data: activeOrganization } = authClient.useActiveOrganization();
  const { current, refresh } = useOrganization();
  const { canEdit } = usePermission("configuracoes");
  const canManage = current?.canManage ?? false;

  const sections: Section[] = [
    { id: "whatsapp", label: "WhatsApp", icon: Smartphone },
    { id: "empresa", label: "Empresa", icon: Building2 },
    { id: "falhas", label: "Falhas do agente", icon: Bot },
    { id: "membros", label: "Membros", icon: Users },
    ...(canManage ? [{ id: "acessos", label: "Acessos por cargo", icon: ShieldCheck }] : []),
  ];
  const [active, setActive] = useState(sections[0].id);

  // Highlights the section being read in the side navigation.
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (visible.length) setActive(visible[0].target.id);
      },
      { rootMargin: "-10% 0px -70% 0px" },
    );
    sections.forEach((section) => {
      const element = document.getElementById(section.id);
      if (element) observer.observe(element);
    });
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage]);

  function goTo(id: string) {
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

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
    <div className="mx-auto w-full max-w-6xl space-y-8">
      <PageHeader
        eyebrow="Sistema"
        title="Configurações"
        description="Gerencie a empresa, os membros e a conexão com o WhatsApp."
      />

      <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
        <nav className="lg:sticky lg:top-0 lg:self-start" aria-label="Seções">
          <ul className="scrollbar-thin flex gap-1 overflow-x-auto lg:flex-col">
            {sections.map((section) => {
              const Icon = section.icon;
              return (
                <li key={section.id} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => goTo(section.id)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors",
                      active === section.id
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {section.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="min-w-0 space-y-6">
          <section id="whatsapp" className="scroll-mt-4">
            <WhatsappConnectionCard canConnect={canEdit} />
          </section>

          <section id="empresa" className="scroll-mt-4">
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
              </CardContent>
            </Card>
          </section>

          <section id="falhas" className="scroll-mt-4">
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
          </section>

          <section id="membros" className="scroll-mt-4">
            <MembersCard canEdit={canEdit} canManage={canManage} />
          </section>

          {canManage && (
            <section id="acessos" className="scroll-mt-4">
              <PermissionsCard />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
