import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarDays, CircleAlert, CircleCheck, Loader, Smartphone, Users } from "lucide-react";
import { api } from "@/lib/api";
import { formatPhone } from "@/lib/dashboard";
import { cn } from "@/lib/utils";
import { useSocket } from "@/providers/SocketProvider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { OptionsSelect } from "@/components/ui/options-select";
import { Spinner } from "@/components/ui/spinner";
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

// Status label + icon, so the state never relies on color alone.
const CONNECTION: Record<string, { label: string; tone: "good" | "warning" | "critical"; icon: typeof CircleCheck }> = {
  CONNECTED: { label: "Conectado", tone: "good", icon: CircleCheck },
  STARTING: { label: "Iniciando", tone: "warning", icon: Loader },
  QRCODE: { label: "Aguardando leitura do QR Code", tone: "warning", icon: Loader },
  DISCONNECTED: { label: "Desconectado", tone: "critical", icon: CircleAlert },
  ERROR: { label: "Erro na conexão", tone: "critical", icon: CircleAlert },
};

const TONE_CLASSES = {
  good: "bg-emerald-50 text-emerald-700",
  warning: "bg-amber-50 text-amber-700",
  critical: "bg-red-50 text-red-700",
};

function StatTile({ label, value, icon: Icon }: { label: string; value: number; icon: typeof Users }) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-4 pt-6">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-1 text-3xl font-semibold">{NUMBER.format(value)}</p>
        </div>
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </span>
      </CardContent>
    </Card>
  );
}

/** /dashboard/painel: WhatsApp connection + numbers of the selected year. */
export function DashboardPage() {
  const socket = useSocket();
  const navigate = useNavigate();
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

  const connection = CONNECTION[report?.whatsapp.status ?? ""] ?? {
    label: report?.whatsapp.status ?? "—",
    tone: "warning" as const,
    icon: Loader,
  };
  const ConnectionIcon = connection.icon;
  const interactions = report?.interactionsByMonth ?? null;

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Visão geral da empresa no ano selecionado.</p>
        </div>
        <div className="w-36 space-y-1.5">
          <p className="text-sm font-medium">Ano</p>
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
        <div className="flex justify-center py-16">
          <Spinner className="size-6 text-muted-foreground" />
        </div>
      ) : report ? (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardContent className="flex items-start justify-between gap-4 pt-6">
                <div className="min-w-0">
                  <p className="text-sm text-muted-foreground">Conexão com o WhatsApp</p>
                  <span
                    className={cn(
                      "mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-medium",
                      TONE_CLASSES[connection.tone],
                    )}
                  >
                    <ConnectionIcon className="h-4 w-4" />
                    {connection.label}
                  </span>
                  <p className="mt-2 truncate text-sm text-muted-foreground">
                    {report.whatsapp.status === "CONNECTED" && report.whatsapp.phoneNumber
                      ? `Número ${formatPhone(report.whatsapp.phoneNumber)}`
                      : "Nenhum número conectado no momento."}
                  </p>
                  {report.whatsapp.status !== "CONNECTED" && (
                    <Button
                      variant="link"
                      className="h-auto p-0 text-sm"
                      onClick={() => navigate("/dashboard/configuracoes")}
                    >
                      Ir para a conexão
                    </Button>
                  )}
                </div>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Smartphone className="h-5 w-5" />
                </span>
              </CardContent>
            </Card>
            <StatTile label={`Leads registrados em ${report.year}`} value={report.leadsRegistered} icon={Users} />
            <StatTile label={`Agendas criadas em ${report.year}`} value={report.eventsCreated} icon={CalendarDays} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Leads com interação por mês</CardTitle>
              <CardDescription>
                Leads diferentes que trocaram mensagens com a empresa em cada mês de {report.year}.
              </CardDescription>
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
        </>
      ) : null}
    </div>
  );
}
