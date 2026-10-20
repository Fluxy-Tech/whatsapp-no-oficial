import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Activity, Bot, ChevronRight, ListChecks, Search, Users } from "lucide-react";
import { api } from "@/lib/api";
import { formatPhone, initials } from "@/lib/dashboard";
import { targetLabel, type Target } from "@/lib/leads";
import { cn } from "@/lib/utils";
import { useSocket } from "@/providers/SocketProvider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Spinner } from "@/components/ui/spinner";
import { StatTile } from "@/components/ui/stat-tile";

const DATE_TIME = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });
const NUMBER = new Intl.NumberFormat("pt-BR");

/** /dashboard/leads: every lead with the date of the last conversation. */
export function LeadsPage() {
  const socket = useSocket();
  const navigate = useNavigate();
  const [targets, setTargets] = useState<Target[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    try {
      setTargets(await api<Target[]>("/api/whatsapp/targets"));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // New leads, new messages (last conversation) and edits show up live.
  useEffect(() => {
    const refresh = () => void load();
    socket.on("whatsapp:message", refresh);
    socket.on("whatsapp:contact-updated", refresh);
    return () => {
      socket.off("whatsapp:message", refresh);
      socket.off("whatsapp:contact-updated", refresh);
    };
  }, [socket, load]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    const digits = term.replace(/\D/g, "");
    if (!term) return targets;
    return targets.filter(
      (target) =>
        targetLabel(target).toLowerCase().includes(term) || (digits.length > 0 && (target.number ?? "").includes(digits)),
    );
  }, [targets, search]);

  // Numbers of the whole base (not only the filtered rows).
  const withAgent = targets.filter((target) => target.agentActive).length;
  const withData = targets.filter((target) => Object.values(target.extras).some((value) => String(value).trim())).length;
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const activeWeek = targets.filter((target) => target.lastMessageAt && new Date(target.lastMessageAt).getTime() >= weekAgo).length;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-8">
      <PageHeader
        eyebrow="Relacionamento"
        title="Leads"
        description={loading ? "Carregando..." : `${targets.length} lead(s) que já conversaram com a empresa.`}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Leads" value={loading ? "—" : NUMBER.format(targets.length)} detail="Na base da empresa" icon={Users} />
        <StatTile
          label="Ativos na semana"
          value={loading ? "—" : NUMBER.format(activeWeek)}
          detail="Conversaram nos últimos 7 dias"
          icon={Activity}
          tone="good"
        />
        <StatTile
          label="Com agente ligado"
          value={loading ? "—" : NUMBER.format(withAgent)}
          detail="Atendidos pela IA"
          icon={Bot}
        />
        <StatTile
          label="Com dados coletados"
          value={loading ? "—" : NUMBER.format(withData)}
          detail="Ao menos um metadado preenchido"
          icon={ListChecks}
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4 space-y-0">
          <div>
            <CardTitle>Base de leads</CardTitle>
            <CardDescription>Clique em um lead para ver a ficha e os dados coletados.</CardDescription>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome ou telefone"
              className="h-9 w-72 rounded-lg bg-muted/40 pl-9"
              aria-label="Buscar lead"
            />
          </div>
        </CardHeader>
        <CardContent>
          {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
          {loading ? (
            <div className="flex justify-center py-10">
              <Spinner className="size-6 text-muted-foreground" />
            </div>
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-12 text-center">
              <Users className="h-6 w-6 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {search ? "Nenhum lead encontrado." : "Nenhum lead capturado ainda."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Lead</th>
                    <th className="px-4 py-2.5 font-medium">Agente de IA</th>
                    <th className="px-4 py-2.5 font-medium">Dados coletados</th>
                    <th className="px-4 py-2.5 font-medium">Última conversa</th>
                    <th className="w-8 px-2 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {visible.map((target) => {
                    const collected = Object.values(target.extras).filter((value) => String(value).trim()).length;
                    return (
                      <tr
                        key={target.id}
                        onClick={() => navigate(`/dashboard/lead/${target.id}`)}
                        className="group cursor-pointer transition-colors hover:bg-muted/40"
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border bg-muted/60 text-xs font-semibold transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                              {initials(targetLabel(target))}
                            </span>
                            <div className="min-w-0">
                              <a
                                href={`/dashboard/lead/${target.id}`}
                                onClick={(event) => {
                                  event.preventDefault();
                                  navigate(`/dashboard/lead/${target.id}`);
                                }}
                                className="block truncate font-medium hover:underline"
                              >
                                {targetLabel(target)}
                              </a>
                              <p className="truncate text-xs text-muted-foreground">{formatPhone(target.number) || "—"}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                              target.agentActive ? "bg-primary text-primary-foreground" : "border text-muted-foreground",
                            )}
                          >
                            <Bot className="h-3.5 w-3.5" />
                            {target.agentActive ? "Ligado" : "Desligado"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex min-w-7 justify-center rounded-md border bg-muted/40 px-2 py-0.5 text-xs font-semibold tabular-nums">
                            {collected}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {target.lastMessageAt ? DATE_TIME.format(new Date(target.lastMessageAt)) : "—"}
                        </td>
                        <td className="px-2 py-3 text-muted-foreground">
                          <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
