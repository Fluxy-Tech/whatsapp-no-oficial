import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Calendar,
  CircleAlert,
  ClipboardList,
  FileText,
  Mail,
  Megaphone,
  MessageCircleReply,
  Pause,
  Phone,
  Play,
  Send,
  Timer,
  User,
  Users,
  XCircle,
} from "lucide-react";
import { api } from "@/lib/api";
import {
  campaignStatus,
  DISPATCH_TYPE_LABEL,
  TARGET_STATUS,
  TONE_CLASSES,
  type CampaignDetail,
  type CampaignTargetItem,
} from "@/lib/campaigns";
import { formatPhone } from "@/lib/dashboard";
import { cn } from "@/lib/utils";
import { usePermission } from "@/providers/OrganizationProvider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { TabsNav, type TabItem } from "@/components/ui/tabs-nav";
import { WhatsappPreview } from "@/components/campaigns/WhatsappPreview";

const NUMBER = new Intl.NumberFormat("pt-BR");
const DATE_TIME = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });
const SENT_STATUSES = ["SENT", "DELIVERED", "READ"];

type TargetTab = "contacts" | "sent" | "failures" | "responses";

const TARGET_TABS: TabItem<TargetTab>[] = [
  { id: "contacts", label: "Contatos", icon: Users },
  { id: "sent", label: "Enviados", icon: Send },
  { id: "failures", label: "Falhas", icon: XCircle },
  { id: "responses", label: "Respostas", icon: MessageCircleReply },
];

const TAB_DESCRIPTION: Record<TargetTab, string> = {
  contacts: "Todos os contatos que já entraram no disparo desta campanha.",
  sent: "Contatos com confirmação de envio, entrega ou leitura.",
  failures: "Contatos que tiveram falha no envio da campanha.",
  responses: "Contatos que responderam a mensagem da campanha.",
};

function Pill({ tone, children }: { tone: keyof typeof TONE_CLASSES; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium", TONE_CLASSES[tone])}>{children}</span>
  );
}

function TargetsTable({ targets, showResponse }: { targets: CampaignTargetItem[]; showResponse: boolean }) {
  const navigate = useNavigate();
  if (targets.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Nenhum contato nesta categoria.</p>;
  }
  return (
    <div className="max-h-[32rem] overflow-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-muted text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-4 py-2 font-medium">Contato</th>
            <th className="px-4 py-2 font-medium">Variáveis</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium">{showResponse ? "Resposta" : "Data"}</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {targets.map((t) => {
            const status = TARGET_STATUS[t.status] ?? { label: t.status, tone: "neutral" as const };
            return (
              <tr key={t.id}>
                <td className="px-4 py-3">
                  {t.targetId ? (
                    <button
                      type="button"
                      className="font-medium hover:underline"
                      onClick={() => navigate(`/dashboard/lead/${t.targetId}`)}
                    >
                      {t.name || "Sem nome"}
                    </button>
                  ) : (
                    <p className="font-medium">{t.name || "Sem nome"}</p>
                  )}
                  <p className="text-xs text-muted-foreground">{formatPhone(t.phone) || t.phone}</p>
                </td>
                <td className="max-w-48 truncate px-4 py-3 text-muted-foreground">{t.variables.join(", ") || "—"}</td>
                <td className="px-4 py-3">
                  <Pill tone={status.tone}>{status.label}</Pill>
                  {t.error && <p className="mt-1 max-w-56 truncate text-xs text-destructive" title={t.error}>{t.error}</p>}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {showResponse ? (
                    <span className="line-clamp-2 max-w-64">{t.campaignResponse || "—"}</span>
                  ) : (
                    DATE_TIME.format(new Date(t.createdAt))
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Pause / resume of the batches and where the campaign is. */
function DispatchControl({
  campaign,
  canEdit,
  onUpdated,
}: {
  campaign: CampaignDetail;
  canEdit: boolean;
  onUpdated: (c: CampaignDetail) => void;
}) {
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const completed = campaign.status === "COMPLETED";

  async function toggleActive() {
    setSaving(true);
    setError(null);
    try {
      onUpdated(
        await api<CampaignDetail>(`/api/campaigns/${campaign.id}/active`, {
          method: "PATCH",
          body: JSON.stringify({ active: !campaign.active }),
        }),
      );
    } catch (err) {
      setError((err as Error).message || "Não foi possível atualizar a campanha.");
    } finally {
      setSaving(false);
    }
  }

  const fields = [
    { label: "Início agendado", value: campaign.scheduledAt ? DATE_TIME.format(new Date(campaign.scheduledAt)) : "Imediato" },
    {
      label: "Próximo lote",
      value:
        completed || !campaign.nextBatchAt
          ? "—"
          : !campaign.active
            ? "Pausada"
            : DATE_TIME.format(new Date(campaign.nextBatchAt)),
    },
    { label: "Aguardando envio", value: `${NUMBER.format(campaign.pendingContacts)} contato(s)` },
    { label: "Na fila do WhatsApp", value: `${NUMBER.format(campaign.targets.filter((t) => t.status === "QUEUED").length)} mensagem(ns)` },
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Timer className="h-5 w-5" />
            </span>
            <div>
              <CardTitle>Disparo em lotes</CardTitle>
              <CardDescription>
                {campaign.dispatchType === "MANUAL"
                  ? "Disparo manual (1 contato)."
                  : `${campaign.batchSize} contato(s) por lote, a cada ${campaign.batchIntervalMinutes} min.`}
              </CardDescription>
            </div>
          </div>
          {canEdit && !completed && (
            <Button
              type="button"
              variant={campaign.active ? "outline" : "default"}
              disabled={saving}
              onClick={() => void toggleActive()}
              className="gap-2"
            >
              {campaign.active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {campaign.active ? "Pausar" : "Retomar"}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!completed && !campaign.active && campaign.pausedReason === "DISCONNECTED" && (
          <div className={cn("flex flex-wrap items-center gap-2 rounded-lg p-3 text-sm", TONE_CLASSES.critical)}>
            <CircleAlert className="h-4 w-4 shrink-0" />
            <span className="flex-1">
              A campanha foi pausada porque o WhatsApp desconectou. Reconecte e clique em Retomar.
            </span>
            <Button variant="link" className="h-auto p-0 text-sm" onClick={() => navigate("/dashboard/configuracoes")}>
              Ir para a conexão
            </Button>
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {fields.map((field) => (
            <div key={field.label} className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">{field.label}</p>
              <p className="truncate text-sm font-semibold">{field.value}</p>
            </div>
          ))}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

/** /dashboard/campanhas/:id */
export function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { canEdit } = usePermission("campanhas");
  const [campaign, setCampaign] = useState<CampaignDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TargetTab>("contacts");

  const load = useCallback(async () => {
    try {
      setCampaign(await api<CampaignDetail>(`/api/campaigns/${id}`));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // In progress (or messages still in the WhatsApp queue): refresh by itself.
  const live = Boolean(
    campaign && ((campaign.status !== "COMPLETED" && campaign.active) || campaign.targets.some((t) => t.status === "QUEUED")),
  );
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => void load(), 10_000);
    return () => clearInterval(timer);
  }, [live, load]);

  const filtered = useMemo(() => {
    const targets = campaign?.targets ?? [];
    if (tab === "sent") return targets.filter((t) => SENT_STATUSES.includes(t.status));
    if (tab === "failures") return targets.filter((t) => t.status === "FAILED");
    if (tab === "responses") return targets.filter((t) => t.respondedCampaign);
    return targets;
  }, [campaign, tab]);

  if (!campaign) {
    return error ? (
      <p className="text-sm text-destructive">{error}</p>
    ) : (
      <div className="flex justify-center py-16">
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    );
  }

  const state = campaignStatus(campaign);
  const responses = campaign.targets.filter((t) => t.respondedCampaign).length;

  return (
    <div className="w-full space-y-6">
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="icon" aria-label="Voltar para campanhas" onClick={() => navigate("/dashboard/campanhas")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Megaphone className="h-5 w-5" />
        </span>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">{campaign.name}</h1>
            <Pill tone={state.tone}>{state.label}</Pill>
          </div>
          <p className="text-sm text-muted-foreground">Detalhes do disparo desta campanha de WhatsApp.</p>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ClipboardList className="h-5 w-5" />
            </span>
            <div>
              <CardTitle>Dados do disparo</CardTitle>
              <CardDescription>Quem disparou essa campanha, quando e por qual número.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Disparado por", value: campaign.createdByName ?? "—", icon: User },
              { label: "E-mail", value: campaign.createdByEmail ?? "—", icon: Mail },
              { label: "Data do disparo", value: DATE_TIME.format(new Date(campaign.sentAt)), icon: Calendar },
              { label: "Tipo de disparo", value: DISPATCH_TYPE_LABEL[campaign.dispatchType] ?? campaign.dispatchType, icon: Send },
              { label: "WhatsApp", value: campaign.phoneNumber ? formatPhone(campaign.phoneNumber) : "—", icon: Phone },
              { label: "Variáveis", value: String(campaign.variableCount), icon: FileText },
            ].map((field) => (
              <div key={field.label} className="flex items-center gap-3 rounded-lg border p-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm bg-primary/10 text-primary">
                  <field.icon className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">{field.label}</p>
                  <p className="truncate text-sm font-semibold">{field.value}</p>
                </div>
              </div>
            ))}
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">Template</p>
            <WhatsappPreview text={campaign.templateText} />
          </div>
        </CardContent>
      </Card>

      <DispatchControl campaign={campaign} canEdit={canEdit} onUpdated={setCampaign} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Contatos", value: campaign.expectedContacts, sublabel: `${NUMBER.format(campaign.totalContacts)} já disparados`, icon: Users, tone: "bg-primary/10 text-primary" },
          { label: "Enviados", value: campaign.totalSent, sublabel: "Confirmados pelo WhatsApp", icon: Send, tone: TONE_CLASSES.good },
          {
            label: "Falhas",
            value: campaign.totalFailures,
            sublabel: campaign.totalFailures > 0 ? "Precisam de atenção" : "Nenhuma falha",
            icon: XCircle,
            tone: TONE_CLASSES.critical,
          },
          { label: "Respostas", value: responses, sublabel: "Contatos que responderam", icon: MessageCircleReply, tone: "bg-blue-50 text-blue-700" },
        ].map((metric) => (
          <Card key={metric.label}>
            <CardContent className="flex items-start justify-between gap-4 pt-6">
              <div>
                <p className="text-sm text-muted-foreground">{metric.label}</p>
                <p className="mt-1 text-3xl font-semibold">{NUMBER.format(metric.value)}</p>
                <p className="mt-1 text-xs text-muted-foreground">{metric.sublabel}</p>
              </div>
              <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full", metric.tone)}>
                <metric.icon className="h-5 w-5" />
              </span>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="space-y-4">
        <TabsNav tabs={TARGET_TABS} value={tab} onChange={setTab} />
        <Card>
          <CardHeader>
            <CardDescription>{TAB_DESCRIPTION[tab]}</CardDescription>
          </CardHeader>
          <CardContent>
            <TargetsTable targets={filtered} showResponse={tab === "responses"} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
