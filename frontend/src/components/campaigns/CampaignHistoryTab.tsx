import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, CheckCircle2, ChevronRight, List, Megaphone, Send } from "lucide-react";
import { api } from "@/lib/api";
import {
  campaignStatus,
  DISPATCH_TYPE_LABEL,
  TONE_CLASSES,
  type CampaignListResult,
  type CampaignStats,
} from "@/lib/campaigns";
import { formatPhone } from "@/lib/dashboard";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OptionsSelect } from "@/components/ui/options-select";
import { Spinner } from "@/components/ui/spinner";

const NUMBER = new Intl.NumberFormat("pt-BR");
const DATE = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" });
const TIME = new Intl.DateTimeFormat("pt-BR", { timeStyle: "short" });
const DATE_TIME = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

const STATUS_OPTIONS = [
  { value: "", label: "Todos" },
  { value: "PROCESSING", label: "Em andamento" },
  { value: "COMPLETED", label: "Concluída" },
];
const TYPE_OPTIONS = [
  { value: "", label: "Todos" },
  { value: "CSV", label: "Lista (CSV)" },
  { value: "MANUAL", label: "Manual" },
];
const PAGE_SIZE_OPTIONS = [10, 20, 50].map((size) => ({ value: String(size), label: `${size} por página` }));

function StatTile({ label, value, sublabel, icon: Icon, tone }: {
  label: string;
  value: string;
  sublabel: string;
  icon: typeof Send;
  tone: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-4 pt-6">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-1 text-3xl font-semibold">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{sublabel}</p>
        </div>
        <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full", tone)}>
          <Icon className="h-5 w-5" />
        </span>
      </CardContent>
    </Card>
  );
}

/** Campaigns already created: numbers on top, filters and the paged report. */
export function CampaignHistoryTab() {
  const navigate = useNavigate();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [dispatchType, setDispatchType] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [stats, setStats] = useState<CampaignStats | null>(null);
  const [result, setResult] = useState<CampaignListResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filterParams = new URLSearchParams();
  if (search.trim()) filterParams.set("search", search.trim());
  if (status) filterParams.set("status", status);
  if (dispatchType) filterParams.set("dispatchType", dispatchType);
  // <input type="date"> is local; the whole day is included.
  if (startDate) filterParams.set("startDate", new Date(`${startDate}T00:00:00`).toISOString());
  if (endDate) filterParams.set("endDate", new Date(`${endDate}T23:59:59.999`).toISOString());
  const filterQuery = filterParams.toString();

  const listParams = new URLSearchParams(filterParams);
  listParams.set("page", String(page));
  listParams.set("pageSize", String(pageSize));
  listParams.set("sortDir", sortDir);
  const listQuery = listParams.toString();

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      Promise.all([
        api<CampaignStats>(`/api/campaigns/stats?${filterQuery}`),
        api<CampaignListResult>(`/api/campaigns?${listQuery}`),
      ])
        .then(([nextStats, nextResult]) => {
          if (cancelled) return;
          setStats(nextStats);
          setResult(nextResult);
          setError(null);
        })
        .catch((err) => !cancelled && setError((err as Error).message));
    void load();
    // Campaigns in progress: the progress refreshes by itself.
    const timer = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [filterQuery, listQuery]);

  const totalPages = result ? Math.max(1, Math.ceil(result.total / pageSize)) : 1;
  const hasFilters = Boolean(search || status || dispatchType || startDate || endDate);

  function resetFilters() {
    setSearch("");
    setStatus("");
    setDispatchType("");
    setStartDate("");
    setEndDate("");
    setPage(1);
  }

  const failureRate = stats && stats.totalMessagesQueued > 0 ? (stats.totalFailures / stats.totalMessagesQueued) * 100 : 0;
  const completionRate = stats && stats.totalCampaigns > 0 ? (stats.completedCampaigns / stats.totalCampaigns) * 100 : 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          icon={Megaphone}
          tone="bg-primary/10 text-primary"
          label="Campanhas"
          value={stats ? NUMBER.format(stats.totalCampaigns) : "—"}
          sublabel="Total criadas"
        />
        <StatTile
          icon={CheckCircle2}
          tone={TONE_CLASSES.good}
          label="Concluídas"
          value={stats ? NUMBER.format(stats.completedCampaigns) : "—"}
          sublabel={`${completionRate.toFixed(0)}% do total`}
        />
        <StatTile
          icon={Send}
          tone="bg-blue-50 text-blue-700"
          label="Mensagens enviadas"
          value={stats ? NUMBER.format(stats.totalMessagesSent) : "—"}
          sublabel={stats ? `${NUMBER.format(stats.totalMessagesQueued)} disparadas` : "Total disparado"}
        />
        <StatTile
          icon={AlertTriangle}
          tone={TONE_CLASSES.warning}
          label="Falhas"
          value={stats ? NUMBER.format(stats.totalFailures) : "—"}
          sublabel={`${failureRate.toFixed(2).replace(".", ",")}% do total`}
        />
      </div>

      <Card className="p-4">
        <div className="grid gap-3 lg:grid-cols-[1fr_170px_170px_150px_150px_auto] lg:items-end">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs" htmlFor="campaign-search">Buscar</Label>
            <Input
              id="campaign-search"
              placeholder="Buscar campanha..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Status</Label>
            <OptionsSelect
              value={status}
              onValueChange={(v) => {
                setStatus(v);
                setPage(1);
              }}
              options={STATUS_OPTIONS}
              aria-label="Status"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Tipo de disparo</Label>
            <OptionsSelect
              value={dispatchType}
              onValueChange={(v) => {
                setDispatchType(v);
                setPage(1);
              }}
              options={TYPE_OPTIONS}
              aria-label="Tipo de disparo"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs" htmlFor="campaign-start">De</Label>
            <Input
              id="campaign-start"
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs" htmlFor="campaign-end">Até</Label>
            <Input
              id="campaign-end"
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <Button variant="outline" disabled={!hasFilters} onClick={resetFilters}>
            Limpar filtros
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <List className="h-5 w-5" />
            </span>
            <div>
              <CardTitle>Relatório dos disparos</CardTitle>
              <CardDescription>Histórico de campanhas com mensagem, quem disparou e o progresso de envio.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
          {!result ? (
            <div className="flex justify-center py-10">
              <Spinner className="size-6 text-muted-foreground" />
            </div>
          ) : result.items.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma campanha encontrada.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Campanha</th>
                    <th className="px-4 py-2 font-medium">Mensagem / Tipo</th>
                    <th className="px-4 py-2 font-medium">Enviado por</th>
                    <th className="px-4 py-2 font-medium">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 hover:text-foreground"
                        onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
                      >
                        Data / Hora {sortDir === "desc" ? "↓" : "↑"}
                      </button>
                    </th>
                    <th className="px-4 py-2 font-medium">Progresso</th>
                    <th className="w-8 px-2 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {result.items.map((c) => {
                    const progressPct = c.expectedContacts > 0 ? Math.round((c.totalContacts / c.expectedContacts) * 100) : 0;
                    const sentAt = new Date(c.sentAt);
                    const state = campaignStatus(c);
                    return (
                      <tr
                        key={c.id}
                        onClick={() => navigate(`/dashboard/campanhas/${c.id}`)}
                        className="cursor-pointer transition-colors hover:bg-accent/50"
                      >
                        <td className="px-4 py-3">
                          <p className="font-medium">{c.name}</p>
                          <span
                            className={cn("mt-1 inline-flex rounded-full px-2 py-0.5 text-xs font-medium", TONE_CLASSES[state.tone])}
                          >
                            {state.label}
                            {state.label === "Agendada" && c.scheduledAt ? ` · ${DATE_TIME.format(new Date(c.scheduledAt))}` : ""}
                          </span>
                        </td>
                        <td className="max-w-64 px-4 py-3">
                          <p className="truncate">{c.templateText}</p>
                          <p className="text-xs text-muted-foreground">
                            {DISPATCH_TYPE_LABEL[c.dispatchType] ?? c.dispatchType}
                            {c.phoneNumber ? ` · ${formatPhone(c.phoneNumber)}` : ""}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          <p>{c.createdByName ?? "—"}</p>
                          <p className="text-xs">{c.createdByEmail ?? ""}</p>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                          <p>{DATE.format(sentAt)}</p>
                          <p className="text-xs">{TIME.format(sentAt)}</p>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1">
                            <span className="text-xs">
                              {NUMBER.format(c.totalContacts)} / {NUMBER.format(c.expectedContacts)} · {progressPct}%
                            </span>
                            <div className="h-1.5 w-28 overflow-hidden rounded-sm bg-muted">
                              <div
                                className={progressPct >= 100 ? "h-full bg-emerald-600" : "h-full bg-primary"}
                                style={{ width: `${Math.min(progressPct, 100)}%` }}
                              />
                            </div>
                            {c.totalFailures > 0 && <span className="text-xs text-destructive">{c.totalFailures} falha(s)</span>}
                          </div>
                        </td>
                        <td className="px-2 py-3 text-muted-foreground">
                          <ChevronRight className="h-4 w-4" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {result && result.total > 0 && (
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-sm text-muted-foreground">
                Exibindo {(page - 1) * pageSize + 1} a {Math.min(page * pageSize, result.total)} de {result.total} campanhas
              </span>
              <div className="flex items-center gap-3">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Anterior
                </Button>
                <span className="flex h-8 min-w-8 items-center justify-center rounded-md bg-primary px-2 text-sm font-medium text-primary-foreground">
                  {page}
                </span>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                  Próxima
                </Button>
                <OptionsSelect
                  size="sm"
                  className="w-[140px]"
                  value={String(pageSize)}
                  onValueChange={(v) => {
                    setPageSize(Number(v));
                    setPage(1);
                  }}
                  options={PAGE_SIZE_OPTIONS}
                  aria-label="Itens por página"
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
