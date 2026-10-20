import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, CalendarDays, Smartphone, Sparkles, TrendingUp, Users } from "lucide-react";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { formatPhone } from "@/lib/dashboard";
import { NAV_LINKS } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { describeConnection } from "@/lib/whatsapp-status";
import { useOrganization } from "@/providers/OrganizationProvider";
import { useSocket } from "@/providers/SocketProvider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { OptionsSelect } from "@/components/ui/options-select";
import { Spinner } from "@/components/ui/spinner";
import { StatTile } from "@/components/ui/stat-tile";
import { ColumnChart } from "@/components/charts/ColumnChart";

type YearReport = {
  year: number;
  years: number[];
  whatsapp: { status: string; phoneNumber: string | null };
  /** January..December; null when the WhatsApp worker is unavailable. */
  interactionsByMonth: number[] | null;
  leadsRegistered: number;
  eventsCreated: number;
};

const MONTHS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const MONTH_NAMES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];
const NUMBER = new Intl.NumberFormat("pt-BR");
const TODAY = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long" });

const TONE_DOT = { good: "bg-emerald-400", warning: "bg-amber-400", critical: "bg-red-400" };

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

/** /dashboard/painel: WhatsApp connection + numbers of the selected year. */
export function DashboardPage() {
  const socket = useSocket();
  const navigate = useNavigate();
  const { data: session } = authClient.useSession();
  const { current } = useOrganization();
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [report, setReport] = useState<YearReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setReport(await api<YearReport>(`/api/dashboard/reports?year=${year}`));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  // Connection status changes live.
  useEffect(() => {
    function onStatus({ status, phoneNumber }: { status: string; phoneNumber?: string | null }) {
      setReport((current) =>
        current ? { ...current, whatsapp: { status, phoneNumber: phoneNumber ?? current.whatsapp.phoneNumber } } : current,
      );
    }
    socket.on("whatsapp:status", onStatus);
    return () => {
      socket.off("whatsapp:status", onStatus);
    };
  }, [socket]);

  const connection = describeConnection(report?.whatsapp.status ?? null);
  const connected = report?.whatsapp.status === "CONNECTED";
  const interactions = report?.interactionsByMonth ?? null;

  // Insights derived from the monthly series (no extra request).
  const totalInteractions = interactions?.reduce((sum, value) => sum + value, 0) ?? 0;
  const bestMonth = interactions
    ? interactions.reduce((best, value, index) => (value > interactions[best] ? index : best), 0)
    : -1;
  const isCurrentYear = report?.year === new Date().getFullYear();
  const monthIndex = new Date().getMonth();
  const monthDelta =
    interactions && isCurrentYear && monthIndex > 0
      ? interactions[monthIndex] - interactions[monthIndex - 1]
      : null;

  const shortcuts = NAV_LINKS.filter(
    (link) => link.module !== "dashboard" && current && current.permissions[link.module] !== "none",
  );
  const firstName = session?.user.name?.split(" ")[0];

  return (
    <div className="mx-auto w-full max-w-7xl space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm capitalize text-muted-foreground">{TODAY.format(new Date())}</p>
          <h1 className="mt-1 text-3xl font-semibold sm:text-4xl">
            {greeting()}
            {firstName ? (
              <>
                , <span className="font-display font-normal italic">{firstName}</span>
              </>
            ) : null}
            .
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">Aqui está o resumo da sua operação no WhatsApp.</p>
        </div>
        <div className="w-32">
          <OptionsSelect
            value={String(year)}
            onValueChange={(value) => setYear(Number(value))}
            options={(report?.years ?? [year]).map((option) => ({ value: String(option), label: String(option) }))}
            aria-label="Ano"
          />
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading && !report ? (
        <div className="flex justify-center py-24">
          <Spinner className="size-6 text-muted-foreground" />
        </div>
      ) : report ? (
        <>
          <div className="grid gap-4 lg:grid-cols-4">
            {/* Connection */}
            <div className="relative overflow-hidden rounded-xl bg-zinc-950 p-6 text-white shadow-float lg:col-span-2">
              <div className="bg-grid pointer-events-none absolute inset-0 opacity-60" />
              <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
              <div className="relative flex h-full flex-col justify-between gap-8">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-[0.12em] text-white/50">Conexão com o WhatsApp</p>
                    <p className="mt-3 flex items-center gap-2.5 text-2xl font-semibold">
                      <span className="relative flex h-2.5 w-2.5">
                        {connected && (
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
                        )}
                        <span className={cn("relative inline-flex h-2.5 w-2.5 rounded-full", TONE_DOT[connection.tone])} />
                      </span>
                      {connection.label}
                    </p>
                    <p className="mt-1 text-sm text-white/60">
                      {connected && report.whatsapp.phoneNumber
                        ? `Número ${formatPhone(report.whatsapp.phoneNumber)} · agentes e campanhas liberados`
                        : "Conecte um número para o agente atender e as campanhas dispararem."}
                    </p>
                  </div>
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5">
                    <Smartphone className="h-5 w-5" />
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    className="bg-white text-zinc-950 hover:bg-white/90"
                    onClick={() => navigate(connected ? "/dashboard/conversas" : "/dashboard/configuracoes")}
                  >
                    {connected ? "Abrir conversas" : "Conectar agora"}
                    <ArrowUpRight className="h-4 w-4" />
                  </Button>
                  {connected && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70">
                      <Sparkles className="h-3 w-3" />
                      Reconexão automática ativa
                    </span>
                  )}
                </div>
              </div>
            </div>

            <StatTile
              label="Leads registrados"
              value={NUMBER.format(report.leadsRegistered)}
              detail={`Novos contatos em ${report.year}`}
              icon={Users}
            />
            <StatTile
              label="Agendas criadas"
              value={NUMBER.format(report.eventsCreated)}
              detail={`Reuniões manuais e pela IA em ${report.year}`}
              icon={CalendarDays}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader className="flex-row flex-wrap items-start justify-between gap-4 space-y-0">
                <div className="space-y-1.5">
                  <CardTitle>Leads com interação por mês</CardTitle>
                  <CardDescription>
                    Leads diferentes que trocaram mensagens com a empresa em cada mês de {report.year}.
                  </CardDescription>
                </div>
                {monthDelta !== null && (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium tabular-nums",
                      monthDelta >= 0 ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    <TrendingUp className={cn("h-3.5 w-3.5", monthDelta < 0 && "rotate-180")} />
                    {monthDelta >= 0 ? "+" : ""}
                    {NUMBER.format(monthDelta)} vs. mês anterior
                  </span>
                )}
              </CardHeader>
              <CardContent>
                {interactions ? (
                  <ColumnChart
                    caption={`Leads com interação por mês em ${report.year}`}
                    data={interactions.map((value, index) => ({
                      label: MONTHS[index],
                      fullLabel: `${MONTH_NAMES[index]} de ${report.year}`,
                      value,
                    }))}
                    formatValue={(value) => `${NUMBER.format(value)} ${value === 1 ? "lead" : "leads"}`}
                  />
                ) : (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    Não foi possível carregar as conversas agora (serviço do WhatsApp indisponível).
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Destaques do ano</CardTitle>
                <CardDescription>Calculados a partir das conversas de {report.year}.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-lg border bg-muted/30 p-4">
                  <p className="text-xs text-muted-foreground">Interações somadas</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">
                    {interactions ? NUMBER.format(totalInteractions) : "—"}
                  </p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-4">
                  <p className="text-xs text-muted-foreground">Melhor mês</p>
                  <p className="mt-1 text-2xl font-semibold">
                    {interactions && totalInteractions > 0 ? MONTH_NAMES[bestMonth] : "—"}
                  </p>
                  {interactions && totalInteractions > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {NUMBER.format(interactions[bestMonth])} leads em conversa
                    </p>
                  )}
                </div>
                <div className="rounded-lg border bg-muted/30 p-4">
                  <p className="text-xs text-muted-foreground">Agendas por lead novo</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">
                    {report.leadsRegistered > 0
                      ? `${Math.round((report.eventsCreated / report.leadsRegistered) * 100)}%`
                      : "—"}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          {shortcuts.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-end justify-between gap-4">
                <h2 className="text-lg font-semibold">Acesso rápido</h2>
                <p className="hidden text-xs text-muted-foreground sm:block">
                  Dica: pressione <kbd className="rounded border bg-background px-1 font-mono">G</kbd> + a letra
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {shortcuts.map((link) => {
                  const Icon = link.icon;
                  return (
                    <button
                      key={link.href}
                      type="button"
                      onClick={() => navigate(link.href)}
                      className="group flex items-start gap-3 rounded-xl border border-border/80 bg-card p-4 text-left shadow-soft transition-all hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-float"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2 text-sm font-medium">
                          {link.label}
                          {link.shortcut && (
                            <kbd className="font-mono text-[10px] tracking-widest text-muted-foreground">
                              G {link.shortcut}
                            </kbd>
                          )}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">{link.hint}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
